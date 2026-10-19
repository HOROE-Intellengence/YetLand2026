"""Run over SSH on the test host. Does not replace the production API or phone."""
import hashlib, json, pathlib, shutil, sqlite3, subprocess, sys, time
root = pathlib.Path('/root/yelan-community-test-20261015')
edge = pathlib.Path('/root/yelan-maintenance-20261007/Caddyfile')
release = pathlib.Path('/root/yelan-releases/phone-c68ffa1/infra/deploy')
backup = root / 'backup'
def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode:
        # Keep diagnostics local, where configuration values are not exposed in chat.
        (root / 'last-command-error.log').write_text(result.stderr + result.stdout)
        raise RuntimeError('Command failed: ' + ' '.join(args[:3]) + '; see private last-command-error.log')
    return result.stdout.strip()
def verify(name):
    receipt = json.loads((root / (name + '.json')).read_text())
    with (root / name).open('rb') as file: digest = hashlib.file_digest(file, 'sha256').hexdigest()
    assert digest == receipt['sha256'], 'Archive checksum mismatch: ' + name
    return receipt
def compose(*args):
    return run(['docker','compose','--project-directory',str(root),'-f',str(root/'compose.yml'),*args])
def reload_edge():
    run(['docker','exec','yelan-maintenance','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
    run(['docker','exec','yelan-maintenance','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
action = sys.argv[1]
if action == 'prepare':
    verify('community-snapshot.tar.gz')
    receipt = verify('infra-images.tar.gz')
    if not backup.exists():
        backup.mkdir(mode=0o700)
        shutil.copy2(edge, backup/'Caddyfile')
        shutil.copy2(release/'docker-compose.release.yml', backup/'release.yml')
        names = ['yelan-maintenance','yelan-release-api','yelan-release-web','yelan-release-phone','yelan-ingress-web','yelan-ingress-phone']
        details = json.loads(run(['docker','inspect',*names]))
        (backup/'containers.json').write_text(json.dumps({d['Name'].lstrip('/'): {'image':d['Config']['Image'],'id':d['Image'],'containerId':d['Id']} for d in details},indent=2))
        (backup/'edge.sha256').write_text(hashlib.sha256(edge.read_bytes()).hexdigest())
    if not (root/'snapshot-restored').exists():
        assert not (root/'data').exists(), 'Refuse to overwrite existing destination data'
        run(['tar','xzf',str(root/'community-snapshot.tar.gz'),'-C',str(root)])
        (root/'data/build').mkdir(exist_ok=True)
        run(['tar','xzf',str(root/'community-build.tgz'),'-C',str(root/'data/build')])
        for name in ['config','uploads','build']: run(['chown','-R','1001:1001',str(root/'data'/name)])
        for name in ['.env','secrets/gate.json','data/state/runtime.json']: (root/name).chmod(0o600)
        db = sqlite3.connect('file:'+str(root/'data/state/installations.sqlite')+'?mode=ro',uri=True)
        assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
        db.close()
        (root/'snapshot-restored').write_text(str(time.time()))
    if (root/'source-update.tar.gz').exists():
        verify('source-update.tar.gz')
        run(['tar','xzf',str(root/'source-update.tar.gz'),'-C',str(root)])
    run(['docker','load','-i',str(root/'infra-images.tar.gz')])
    for name, expected in receipt['images'].items(): assert run(['docker','image','inspect','--format','{{.Id}}',name]) == expected
    compose('config','--quiet')
    compose('up','-d','--no-build','--pull','never','gate','bridge','redis','nodebb')
    # Fresh restores retain the old build volume; compile the adapted client URLs once.
    if (root/'source-update.tar.gz.json').exists():
        source_hash=json.loads((root/'source-update.tar.gz.json').read_text())['sha256']
        built=root/'forum-client-source.sha256'
        if not built.exists() or built.read_text()!=source_hash:
            run(['docker','exec','-e','NODE_OPTIONS=--max-old-space-size=512','community-test-forum','./nodebb','build','--config=/opt/config/config.json'])
            built.write_text(source_hash)
    # Persist the edge's membership in the isolated network for ordinary restarts.
    networks = json.loads(run(['docker','inspect','yelan-maintenance']))[0]['NetworkSettings']['Networks']
    if 'yelan-community-test' not in networks: run(['docker','network','connect','yelan-community-test','yelan-maintenance'])
    print('COMMUNITY_BASE_STARTED; production services unchanged',flush=True)
elif action == 'phone':
    receipt = verify('phone-image.tar.gz')
    run(['docker','load','-i',str(root/'phone-image.tar.gz')])
    for name, expected in receipt['images'].items(): assert run(['docker','image','inspect','--format','{{.Id}}',name]) == expected
    compose('up','-d','--no-build','--no-deps','--pull','never','phone')
    print('COMMUNITY_PHONE_STARTED',flush=True)
elif action == 'edge':
    before = (backup/'Caddyfile').read_text()
    fragment = (root/'source/prototype/community/server-test/Caddyfile.fragment').read_text()
    expected = before + '\n# Community private test 20261015\n' + fragment
    assert edge.read_text() in [before, expected], 'Edge config changed concurrently'
    edge.write_text(expected)
    try: reload_edge()
    except Exception:
        edge.write_text(before); reload_edge(); raise
    print('COMMUNITY_HTTPS_GATE_ROUTED',flush=True)
elif action == 'web':
    scope = json.loads((root/'web-scope.json').read_text())
    assert scope['baselineMatch'], 'Unrelated web differences not allowed'
    file = release/'docker-compose.release.yml'
    old = 'yelan-web-caddy:admin-voices-cn-20261012'
    new = 'yelan-web-caddy:community-entry-cn-20261015'
    text = file.read_text()
    assert text.count(old) == 1 or new in text
    file.write_text(text.replace(old,new))
    args = ['docker','compose','-p','yelan-release','-f',str(release/'docker-compose.yml'),'-f',str(release/'docker-compose.phone.yml'),'-f',str(file)]
    run(args+['config','--quiet'])
    run(args+['up','-d','--no-build','--no-deps','--pull','never','caddy'])
    print('MAIN_LANDING_COMMUNITY_ENTRY_DEPLOYED',flush=True)
elif action == 'rollback':
    # Keep all test data and images. Restore only this rollout's routing and web image.
    previous=(backup/'Caddyfile').read_text()
    fragment=(root/'source/prototype/community/server-test/Caddyfile.fragment').read_text()
    assert edge.read_text()==previous+'\n# Community private test 20261015\n'+fragment, 'Edge changed since rollout; review before rollback'
    release_before=(backup/'release.yml').read_text()
    assert (release/'docker-compose.release.yml').read_text()==release_before.replace('yelan-web-caddy:admin-voices-cn-20261012','yelan-web-caddy:community-entry-cn-20261015'), 'Release config changed; review before rollback'
    shutil.copy2(backup/'release.yml',release/'docker-compose.release.yml')
    args = ['docker','compose','-p','yelan-release','-f',str(release/'docker-compose.yml'),'-f',str(release/'docker-compose.phone.yml'),'-f',str(release/'docker-compose.release.yml')]
    run(args+['up','-d','--no-build','--no-deps','--pull','never','caddy'])
    shutil.copy2(backup/'Caddyfile',edge); reload_edge()
    compose('stop')
    print('ROLLED_BACK; community data retained',flush=True)
else: raise ValueError(action)

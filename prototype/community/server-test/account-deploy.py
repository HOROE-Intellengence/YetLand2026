"""Scoped account integration rollout; execute only on the authorized test server."""
import json, pathlib, subprocess, sys, shutil, hashlib, tarfile, sqlite3, time, secrets
import yaml
class ResetList(list): pass
yaml.SafeLoader.add_constructor('!reset', lambda loader,node: ResetList(loader.construct_sequence(node)))
yaml.SafeDumper.add_representer(ResetList, lambda dumper,value: dumper.represent_sequence('!reset',value))
root = pathlib.Path('/root/yelan-community-account-20261015')
community = pathlib.Path('/root/yelan-community-test-20261015')
release = pathlib.Path('/root/yelan-releases/phone-c68ffa1/infra/deploy')
edge = pathlib.Path('/root/yelan-maintenance-20261007/Caddyfile')
root.mkdir(exist_ok=True, mode=0o700)
def run(args):
    p=subprocess.run(args,capture_output=True,text=True)
    if p.returncode:
        (root/'command-error.log').write_text(p.stdout+p.stderr)
        raise RuntimeError('Command failed; private command-error.log')
    return p.stdout.strip()
def compose(*args):
    return run(['docker','compose','-p','yelan-release','-f',str(release/'docker-compose.yml'),'-f',str(release/'docker-compose.phone.yml'),'-f',str(release/'docker-compose.release.yml'),*args])
action=sys.argv[1]
if action=='inspect':
    import yaml
    for f in release.glob('docker-compose*.yml'):
        data=yaml.safe_load(f.read_text())
        print(json.dumps({'file':f.name,'services':{k:{x:v.get(x) for x in ['image','volumes','networks','command']} for k,v in data.get('services',{}).items()},'networks':data.get('networks')},ensure_ascii=False))
    print(run(['du','-sh',str(release/'_data'),str(community/'data/state')]))
    state=json.loads((release/'_data/state.json').read_text())
    old=json.loads((community/'data/state/accounts/state.json').read_text())
    assert not (set(old['users']) & set(state['users'])), 'Account ID collision'
    assert not (set(old.get('emailIndex',{})) & set(state.get('emailIndex',{}))), 'Email collision; never merge by email'
    print(json.dumps({'legacyAccountCount':len(old['users']),'privateCharacters':sum(1 for c in old.get('characters',{}).values() if c.get('ownerUserId') in old['users'])}))
    inv=state.get('llmApiInventory',{})
    print(json.dumps({'models':{'main':inv.get('mainApiId'),'phone':inv.get('phoneApiId'),'entries':[{k:v for k,v in e.items() if k in ['id','name','model','protocol','enabled']} for e in inv.get('entries',{}).values()]}},ensure_ascii=False))
elif action=='load':
    expected=(root/'images.sha256').read_text().split()[0]
    with (root/'images.tar.gz').open('rb') as f: assert hashlib.file_digest(f,'sha256').hexdigest()==expected
    run(['docker','load','-i',str(root/'images.tar.gz')]); print('IMAGES_VERIFIED_LOADED')
elif action=='finalize':
    assert (root/'deployed.json').exists()
    data=yaml.safe_load((community/'compose.yml').read_text())
    data['services']['bridge']['profiles']=['isolated-archive']
    data['services']['bridge']['restart']='no'
    (community/'compose.yml').write_text(yaml.safe_dump(data,sort_keys=False))
    run(['docker','compose','--project-directory',str(community),'-f',str(community/'compose.yml'),'config','--quiet'])
    (root/'deployed-release.yml').write_text((release/'docker-compose.release.yml').read_text())
    (root/'deployed-edge.sha256').write_text(hashlib.sha256(edge.read_bytes()).hexdigest())
    print('Legacy bridge archived from default compose startup; rollback guards saved')
elif action=='rollback':
    backup=root/'backup'
    assert (release/'docker-compose.release.yml').read_text()==(root/'deployed-release.yml').read_text(), 'Release changed since this rollout'
    assert hashlib.sha256(edge.read_bytes()).hexdigest()==(root/'deployed-edge.sha256').read_text(), 'Edge changed since this rollout'
    shutil.copy2(backup/'release.yml',release/'docker-compose.release.yml')
    compose('up','-d','--no-build','--no-deps','--pull','never','api','caddy')
    shutil.copy2(backup/'community.yml',community/'compose.yml')
    run(['docker','network','connect','--alias','bridge','yelan-community-test','community-test-bridge'])
    run(['docker','update','--restart=unless-stopped','community-test-bridge']);run(['docker','start','community-test-bridge'])
    shutil.copy2(backup/'Caddyfile',edge)
    run(['docker','exec','yelan-maintenance','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
    print('Service routing rolled back; migrated accounts, new chats and shared assets retained on disk, not overwritten')
elif action=='deploy':
    import yaml
    backup=root/'backup'
    assert not backup.exists(), 'Already deployed; inspect receipt before retrying'
    backup.mkdir(mode=0o700)
    shutil.copy2(release/'docker-compose.release.yml',backup/'release.yml')
    shutil.copy2(community/'compose.yml',backup/'community.yml')
    shutil.copy2(edge,backup/'Caddyfile')
    for label, folder in [('formal',release),('community',community)]:
        if (folder/'.env').exists(): shutil.copy2(folder/'.env',backup/(label+'.env'))
    values=dict(line.split('=',1) for line in (community/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    run(['docker','exec','-e','REDISCLI_AUTH='+values['COMMUNITY_REDIS_PASSWORD'].strip('"\''),'community-test-redis','redis-cli','SAVE'])
    run(['docker','cp','community-test-redis:/data/dump.rdb',str(backup/'forum-redis.rdb')])
    for name in ['config','uploads']:
        if (community/'data'/name).exists(): shutil.copytree(community/'data'/name,backup/('forum-'+name))
    # Block writes at the independent edge while creating a complete consistent snapshot.
    before=edge.read_text()
    edge.write_text(before.replace('reverse_proxy yelan-release-api:8787','respond "Account upgrade in progress" 503').replace('reverse_proxy community-test-bridge:3038','respond "Account upgrade in progress" 503'))
    run(['docker','exec','yelan-maintenance','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
    try:
        run(['docker','stop','yelan-release-api','community-test-bridge'])
        for name, source in [('formal-data',release/'_data'),('community-state',community/'data/state')]:
            with tarfile.open(backup/(name+'.tar.gz'),'w:gz') as t: t.add(source,arcname=name)
            with tarfile.open(backup/(name+'.tar.gz')) as t: assert len(t.getmembers())>0
        # Separate shared-mode community database; preserve the isolated prototype for rollback.
        shared=root/'state'; shutil.copytree(community/'data/state',shared)
        old=json.loads((shared/'accounts/state.json').read_text())
        formal=json.loads((release/'_data/state.json').read_text())
        overlap=set(old['users']) & set(formal['users']); assert not overlap, 'Account identity collision: stop for review'
        assert not (set(old.get('emailIndex',{})) & set(formal.get('emailIndex',{}))), 'Email collision: no implicit account linking'
        # Preserve stable community identities and their private copies, but never import
        # local balances, chat history, settings, model keys, or old bearer sessions.
        original_users=dict(formal['users']); original_characters=dict(formal.get('characters',{}))
        imported=[]; imported_characters=[]
        for uid, source in old['users'].items():
            user={k:v for k,v in source.items() if k in ['id','name','nickname','email','passwordHash','passwordUpdatedAt','createdAt','deletedAt','ageVerified','narrativeBoundary','ifUnlocked','registrationIdentity']}
            user.update({'tokenVersion':(source.get('tokenVersion') or 0)+1,'candle':0,'registerGrant':0,'conversationRounds':0})
            user['token']='tok_v'+str(user['tokenVersion'])+'_'+secrets.token_hex(16)
            formal['users'][uid]=user; formal['tokenIndex'][user['token']]=uid
            if user.get('email'): formal['emailIndex'][user['email']]=uid
            imported.append(uid)
        for cid, character in old.get('characters',{}).items():
            if character.get('ownerUserId') not in old['users']: continue
            assert cid not in formal['characters'], 'Private character identity collision'
            formal['characters'][cid]=character; imported_characters.append(cid)
        assert all(formal['users'][k]==v for k,v in original_users.items())
        assert all(formal['characters'][k]==v for k,v in original_characters.items())
        temporary=release/'_data/state.community-migration.tmp'
        temporary.write_text(json.dumps(formal,ensure_ascii=False)); temporary.chmod(0o600)
        temporary.replace(release/'_data/state.json')
        (root/'migration.json').write_text(json.dumps({'accountIds':imported,'characterIds':imported_characters,'existingUsersUnchanged':True,'existingCharactersUnchanged':True,'localBalancesAndChatNotImported':True,'oldTokensRevoked':True},indent=2))
        (shared/'legacy-identities.json').write_text(json.dumps({k:{'name':u.get('nickname') or u.get('name') or '历史社区作者'} for k,u in old['users'].items()},ensure_ascii=False))
        db=sqlite3.connect(shared/'installations.sqlite'); db.execute('DELETE FROM community_sessions'); db.commit(); db.close()
        data=yaml.safe_load((release/'docker-compose.release.yml').read_text())
        api=data['services']['api']; api['image']='yelan-api:community-account-20261015'
        api.setdefault('environment',{}).update({'COMMUNITY_ACCOUNT_MODE':'shared','COMMUNITY_STATE_DIR':'/app/.local/community-shared','COMMUNITY_LISTEN_HOST':'0.0.0.0','COMMUNITY_MAIN_ORIGIN':'https://yetland.cn','COMMUNITY_PUBLIC_ORIGIN':'https://community.yetland.cn','COMMUNITY_FORUM_ORIGIN':'https://forum.community.yetland.cn','COMMUNITY_PHONE_ORIGIN':'https://phone.community.yetland.cn','COMMUNITY_COOKIE_DOMAIN':'community.yetland.cn','COMMUNITY_NODEBB_URL':'http://community-test-forum:4567'})
        api.setdefault('volumes',[]).append(str(shared)+':/app/.local/community-shared')
        api['networks']={'web':None,'community-account':{'aliases':['bridge']}}
        data.setdefault('networks',{})['community-account']={'external':True,'name':'yelan-community-test'}
        data['services']['caddy']['image']='yelan-web-caddy:community-account-cn-20261015'
        (release/'docker-compose.release.yml').write_text(yaml.safe_dump(data,sort_keys=False))
        # Retire the old isolated writer without deleting its data or container.
        run(['docker','network','disconnect','yelan-community-test','community-test-bridge'])
        run(['docker','update','--restart=no','community-test-bridge'])
        compose('config','--quiet'); compose('up','-d','--no-build','--no-deps','--pull','never','api','caddy')
        for _ in range(45):
            if run(['docker','inspect','--format','{{.State.Health.Status}}','yelan-release-api'])=='healthy': break
            time.sleep(2)
        else: raise RuntimeError('API did not become healthy')
        out=run(['docker','exec','yelan-release-api','node','-e',"fetch('http://localhost:3038/api/account-mode').then(r=>r.json()).then(x=>{if(!x.integrated)process.exit(1);console.log('shared')})"])
        assert out=='shared'
        edge.write_text(before.replace('community-test-bridge:3038','yelan-release-api:3038'))
        run(['docker','exec','yelan-maintenance','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
        (root/'deployed.json').write_text(json.dumps({'at':time.time(),'api':'yelan-api:community-account-20261015','web':'yelan-web-caddy:community-account-cn-20261015','backup':str(backup)}))
        print('SHARED_ACCOUNT_DEPLOYED; snapshots verified; original isolated state retained')
    except Exception:
        # Restore configuration/services; production data retains any successful new writes.
        shutil.copy2(backup/'release.yml',release/'docker-compose.release.yml')
        compose('up','-d','--no-build','--no-deps','--pull','never','api','caddy')
        run(['docker','network','connect','--alias','bridge','yelan-community-test','community-test-bridge'])
        run(['docker','update','--restart=unless-stopped','community-test-bridge']); run(['docker','start','community-test-bridge'])
        edge.write_text(before); run(['docker','exec','yelan-maintenance','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
        raise
else: raise ValueError(action)

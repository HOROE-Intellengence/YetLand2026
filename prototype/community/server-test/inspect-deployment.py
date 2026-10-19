import hashlib, json, pathlib, sqlite3, subprocess, tarfile
root=pathlib.Path('/root/yelan-community-test-20261015')
def run(a): return subprocess.check_output(a,text=True).strip()
receipt=json.loads((root/'source-update.tar.gz.json').read_text())
with (root/'source-update.tar.gz').open('rb') as f: assert hashlib.file_digest(f,'sha256').hexdigest()==receipt['sha256']
subprocess.run(['tar','xzf',str(root/'source-update.tar.gz'),'-C',str(root)],check=True)
baseline=root/'backup/installations-pre-server-test.sqlite'
if not baseline.exists():
    with tarfile.open(root/'community-snapshot.tar.gz') as archive:
        baseline.write_bytes(archive.extractfile('data/state/installations.sqlite').read())
old=sqlite3.connect('file:'+str(baseline)+'?mode=ro',uri=True)
new=sqlite3.connect('file:'+str(root/'data/state/installations.sqlite')+'?mode=ro',uri=True)
report={'publicationTables':{},'originalAuditPreserved':False}
for table in ['community_resources','community_revisions','community_sync']:
    a=old.execute('SELECT * FROM '+table+' ORDER BY 1,2').fetchall()
    b=new.execute('SELECT * FROM '+table+' ORDER BY 1,2').fetchall()
    assert a==b, 'Published content or sync state changed: '+table
    report['publicationTables'][table]={'rows':len(a),'sha256':hashlib.sha256(json.dumps(a,ensure_ascii=False).encode()).hexdigest(),'unchanged':True}
rows=old.execute('SELECT * FROM community_audit ORDER BY id').fetchall()
assert rows==new.execute('SELECT * FROM community_audit WHERE id<=? ORDER BY id',(rows[-1][0],)).fetchall()
report['originalAuditPreserved']=True
report['originalAuditRows']=len(rows)
old.close();new.close()
before=json.loads((root/'backup/containers.json').read_text())
prod={d['Name'].lstrip('/'):d for d in json.loads(run(['docker','inspect',*before.keys()]))}
report['unchangedProductionContainers']={n:prod[n]['Id']==before[n]['containerId'] and prod[n]['Image']==before[n]['id'] for n in before if n!='yelan-release-web'}
assert all(report['unchangedProductionContainers'].values())
names=['community-test-gate','community-test-bridge','community-test-forum','community-test-redis','community-test-phone']
test=json.loads(run(['docker','inspect',*names]))
report['containers']={d['Name'].lstrip('/'): {'running':d['State']['Running'],'health':d['State'].get('Health',{}).get('Status'),'image':d['Config']['Image'],'publishedPorts':d['HostConfig']['PortBindings']} for d in test}
assert all(d['State']['Running'] and not d['HostConfig']['PortBindings'] for d in test)
report['productionApiHealthy']=prod['yelan-release-api']['State']['Health']['Status']=='healthy'
assert report['productionApiHealthy']
report['webImage']=prod['yelan-release-web']['Config']['Image']
report['schemaIntegrity']=sqlite3.connect('file:'+str(root/'data/state/installations.sqlite')+'?mode=ro',uri=True).execute('PRAGMA quick_check').fetchone()[0]
(root/'deployment-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))

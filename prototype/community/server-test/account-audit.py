"""Read only: validate migrated source IDs and only the designated synthetic chat logs."""
import pathlib, json, sqlite3, tarfile
root=pathlib.Path('/root/yelan-community-account-20261015')
formal=pathlib.Path('/root/yelan-releases/phone-c68ffa1/infra/deploy/_data')
old=sqlite3.connect('file:/root/yelan-community-test-20261015/data/state/installations.sqlite?mode=ro',uri=True)
new=sqlite3.connect('file:'+str(root/'state/installations.sqlite')+'?mode=ro',uri=True)
report={'publicationTablesUnchanged':{},'originalInstallationsPreserved':{},'calls':[]}
for table in ['community_resources','community_revisions']:
    a=old.execute('SELECT * FROM '+table+' ORDER BY 1,2').fetchall();b=new.execute('SELECT * FROM '+table+' ORDER BY 1,2').fetchall()
    assert a==b,table;report['publicationTablesUnchanged'][table]=len(a)
for table in ['installations','community_assets','community_bindings']:
    a=old.execute('SELECT * FROM '+table).fetchall();b=new.execute('SELECT * FROM '+table).fetchall()
    assert all(row in b for row in a),table;report['originalInstallationsPreserved'][table]=len(a)
with tarfile.open(root/'backup/formal-data.tar.gz') as t: previous=json.load(t.extractfile('formal-data/state.json'))
current=json.loads((formal/'state.json').read_text())
assert current['llmApiInventory']==previous['llmApiInventory'];report['modelConfigurationUnchanged']=True
for uid,user in previous['users'].items(): assert current['users'][uid]==user,'Existing user changed'
for cid,char in previous['characters'].items(): assert current['characters'][cid]==char,'Existing character changed'
report['existingFormalUsersUnchanged']=len(previous['users']);report['existingFormalCharactersUnchanged']=len(previous['characters'])
ids=json.loads((root/'acceptance-ids.json').read_text())
report['accountResourceBindings']=[]
for uid in ids:
    installed=new.execute('SELECT resource_id,version,character_id FROM installations WHERE user_id=?',(uid,)).fetchall()
    for rid,version,cid in installed:
        assert current['characters'][cid]['ownerUserId']==uid
        report['accountResourceBindings'].append({'userId':uid,'resourceId':rid,'version':version,'characterId':cid,'ownerVerifiedOnDisk':True})
logs=sqlite3.connect('file:'+str(formal/'phone-chat/phone-chat.sqlite')+'?mode=ro',uri=True);logs.row_factory=sqlite3.Row
for uid in ids:
    for row in logs.execute('SELECT id,userId,characterId,model,status,elapsedMs,upstreamStatus,errorCode,request,response FROM calls WHERE userId=? ORDER BY createdAt',(uid,)):
        r=dict(row);request=r.pop('request');response=r.pop('response');r.update({'constantPresent':'观察先于命名' in request,'keywordPresent':'两张固定凳' in request,'storedResponseCharacters':len(response),'finished':r['status']=='complete'})
        report['calls'].append(r)
assert len(report['calls'])>=2
assert all(r['finished'] and r['constantPresent'] and r['keywordPresent'] for r in report['calls'])
(root/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

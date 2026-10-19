// Run with the API's tsx loader. Planning is read-only; --apply is explicit.
import { resolve,join } from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ImageMaterials } from '../apps/api/src/services/image-materials.ts';
import { PhoneInspections } from '../apps/api/src/phone/inspection.ts';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const Database=require('better-sqlite3');
const args=process.argv.slice(2),position=args.indexOf('--root');
if(position<0||!args[position+1])throw new Error('Pass --root <API persistent directory>. Add --apply only after backup.');
const root=resolve(args[position+1]),apply=args.includes('--apply');
const inspectionRead=new Database(join(root,'phone-inspection/inspection.sqlite'),{readonly:true,fileMustExist:true});
const assetRows=inspectionRead.prepare('SELECT userId,id,mime,length(data) bytes FROM assets').all();
const plan={apply,assets:assetRows.length,bytes:assetRows.reduce((n,a)=>n+a.bytes,0),chatImageReferences:0,uniqueChatImages:0,recoveredChatImages:0,unreadableCalls:0,failedAssets:0};
const materials=apply?new ImageMaterials(join(root,'materials')):null,inspection=apply?new PhoneInspections(join(root,'phone-inspection'),materials):null;
const initialTotal=materials?.list(1).total??0;
try{
  if(apply)for(const asset of assetRows){
    if(inspection.db.prepare('SELECT 1 FROM asset_materials WHERE userId=? AND id=?').get(asset.userId,asset.id))continue;
    const row=inspectionRead.prepare('SELECT data FROM assets WHERE userId=? AND id=?').get(asset.userId,asset.id);
    try{await inspection.retainAsset(asset.userId,asset.id,asset.mime,row.data);}catch{plan.failedAssets++;}
  }
  const callsPath=join(root,'phone-chat/phone-chat.sqlite');
  const calls=existsSync(callsPath)?new Database(callsPath,{readonly:true,fileMustExist:true}):null;
  const seen=new Set();
  try{
    for(const {userId,request} of calls?.prepare("SELECT userId,request FROM calls WHERE instr(request,'data:image/')>0").iterate()??[]){
      let messages;try{messages=JSON.parse(request);}catch{plan.unreadableCalls++;continue;}
      if(!Array.isArray(messages))continue;
      for(const message of messages){
        if(message.role!=='user'||!Array.isArray(message.content))continue;
        for(const part of message.content){
          const url=part?.image_url?.url;if(typeof url!=='string')continue;
          const match=/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]+=*)$/.exec(url);if(!match)continue;
          const data=Buffer.from(match[2],'base64');if(data.length>16*1024*1024)continue;
          plan.chatImageReferences++;
          const identity=userId+':'+createHash('sha256').update(data).digest('hex');
          if(seen.has(identity))continue;seen.add(identity);plan.uniqueChatImages++;
          if(apply)try{await materials.retain({userId,data,mime:match[1],source:'user-upload',prompt:'历史聊天图片'});plan.recoveredChatImages++;}catch{plan.failedAssets++;}
        }
      }
    }
  }finally{calls?.close();}
  if(apply){plan.linkedResources=inspection.reindexMaterials();plan.libraryTotal=materials.list(1).total;plan.addedMaterials=plan.libraryTotal-initialTotal;}
  console.log(JSON.stringify(plan));
}finally{inspectionRead.close();inspection?.db.close();materials?.db.close();}

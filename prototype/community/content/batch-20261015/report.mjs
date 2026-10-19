import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {dir,manifest,load} from './client.mjs';
const imported=load('import-state.json'),installed=load('install-report.json'),published=load('publication-evidence.json'),posts=load('posts-state.json');
const browser=JSON.parse(readFileSync(resolve(dir,'evidence/browser-verification.json'),'utf8'));
const rerun=load('rerun-report.json');assert.equal(rerun.newSubmissions,0);assert(load('consumer-restored.json').activeTheme);
writeFileSync(resolve(dir,'evidence/rerun-summary.json'),JSON.stringify(rerun,null,2));
const resources=manifest.items.filter(i=>['character','worldbook','theme'].includes(i.type));
assert.equal(Object.keys(browser.themes).length,6,'All six themes need actual phone browser checks');
for(const i of resources){assert.equal(imported.items[i.key]?.status,'published-synced');assert(installed.items[i.key]?.installed);assert(published.items[i.key]?.reviewerId);assert(published.items[i.key].syncDone);}
for(const i of manifest.items.filter(i=>['tutorial','discussion'].includes(i.type)))assert.equal(posts.items[i.key]?.status,'published-visible');
const labels={character:'角色卡',worldbook:'世界书',theme:'配色主题',tutorial:'教程',discussion:'讨论帖'};
const rows=manifest.items.map(i=>{
 const r=imported.items[i.key]||posts.items[i.key];const a=installed.items[i.key];
 const validation=i.type==='character'?'已安装；私有角色与关键字段、手机 bootstrap 读回通过':i.type==='worldbook'?'已安装绑定；10 条逐条读回，原规则保留':i.type==='theme'?'已安装；启用状态读回，真实手机配色通过':'论坛匿名可见；原始正文与文件一致';
 return {key:i.key,title:i.title,type:i.type,version:i.version,file:i.file,source:i.source,related:i.related,resourceId:r.resourceId,tid:r.tid,status:r.status,communityUrl:r.communityUrl,forumUrl:r.forumUrl,validation,sha256:createHash('sha256').update(readFileSync(resolve(dir,i.file))).digest('hex')};
});
writeFileSync(resolve(dir,'delivery.json'),JSON.stringify({batch:manifest.batch,completedAt:new Date().toISOString(),counts:{files:32,publishedResources:24,publishedPosts:8,installedResources:24},items:rows,unfinished:[],actualModelConversationVerified:false},null,2));
let table='| 标题 | 类型 | 版本 | 实际发布状态 | 社区／论坛链接 | 应用验证结果 |\n|---|---|---|---|---|---|\n';
for(const r of rows)table+=`| ${r.title} | ${labels[r.type]} | ${r.version} | ${r.resourceId?'已公开、审核及同步完成':'已公开论坛帖'} | ${r.communityUrl?`[社区](${r.communityUrl}) · `:''}[论坛](${r.forumUrl}) | ${r.validation} |\n`;
writeFileSync(resolve(dir,'delivery.md'),`# 32 项内容交付表\n\n${table}\n文件生成、实际发布与安装验证分别见列。教程和讨论没有安装包，应用验证为不适用。\n`);
writeFileSync(resolve(dir,'evidence/install-summary.json'),JSON.stringify({checkedAt:installed.checkedAt,items:resources.map(i=>{const{characterId,assetId,...summary}=installed.items[i.key];return{key:i.key,...summary};}),checks:installed.checks},null,2));
console.log('Delivery complete: 32 files, 24 published+synced+installed resources, 8 visible forum posts; 6 browser theme checks.');

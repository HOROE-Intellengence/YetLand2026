import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
export const dir = import.meta.dirname;
export const root = resolve(dir, '../../../..');
export const local = resolve(root, '.local/community-prototype/batch-20261015');
mkdirSync(local,{recursive:true});
export const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
export const load=(name,fallback={})=>existsSync(resolve(local,name))?JSON.parse(readFileSync(resolve(local,name),'utf8')):fallback;
export function save(name,data){const p=resolve(local,name);writeFileSync(p+'.tmp',JSON.stringify(data,null,2));renameSync(p+'.tmp',p);}
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function request(path,cookie='',body,extra={}) {
 const r=await fetch('http://localhost:3038'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...extra,signal:AbortSignal.timeout(25000)});
 const j=await r.json(); if(!r.ok){let e=new Error(`${r.status}: ${j.message||JSON.stringify(j)}`); e.status=r.status;throw e;}return j;
}
export async function login(key) {
 const r=await fetch('http://localhost:3038/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:key})});
 if(!r.ok)throw new Error(`Login ${key}: ${r.status}`);
 const cookie=r.headers.get('set-cookie').split(';')[0]; const identity=await request('/api/private/me',cookie);
 const sessions=load('sessions.json');sessions[key]={cookie,identity};save('sessions.json',sessions);return cookie;
}
export async function session(key){const row=load('sessions.json')[key];if(row)try{await request('/api/private/me',row.cookie);return row.cookie;}catch(e){if(e.status!==401)throw e;}return login(key);}
export async function phone(cookie){const p=await request('/api/private/phone-session',cookie,{});return {Authorization:`Bearer ${p.token}`};}
export function content(item){return JSON.parse(readFileSync(resolve(dir,item.file),'utf8'));}

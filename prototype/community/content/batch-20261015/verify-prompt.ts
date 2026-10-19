import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as managedModule from '../../../../ai-virtual-phone/lib/yelan-role-rules';
import * as promptModule from '../../../../ai-virtual-phone/lib/llm-prompt-assembler';
import { communityPhonePersona } from '../../../../apps/api/src/community-prototype/phone-persona';
import { compileUserCharacter } from '../../../../packages/shared/src/contracts/user-character';
const dir=import.meta.dirname;
const {buildManagedRoleSettings}=(managedModule as any).default || managedModule;
const {assemblePromptPayload}=(promptModule as any).default || promptModule;
const role=JSON.parse(readFileSync(resolve(dir,'../../../../.local/community-prototype/batch-20261015/prompt-input.json'),'utf8'));
const pkg=JSON.parse(readFileSync(resolve(dir,'resources/w-star-ridge.json'),'utf8')).worldbook;
const character=JSON.parse(readFileSync(resolve(dir,'resources/c-observatory.json'),'utf8')).payload;
const compiled=compileUserCharacter({...character,worldbook:{...character.worldbook,notes:'community:secret-install-marker'}});
const persona=communityPhonePersona({...compiled,description:''});
assert(persona.includes(character.worldbook.background));assert(persona.includes(character.card.initialState.location));assert(!persona.includes('secret-install-marker'));
const settings=buildManagedRoleSettings(role);
function prompt(context:string){return JSON.stringify(assemblePromptPayload({character:{...role,createdAt:new Date().toISOString()},history:[{id:'synthetic',role:'user',content:context,timestamp:new Date().toISOString()}],preset:settings.preset,worldBooks:[settings.worldBook],regexes:[settings.regex],timeAware:false} as any));}
const active=prompt('我想去折光镜台。'),inactive=prompt('今天想先在这里坐一会儿。');
for(const e of pkg.entries.filter((e:any)=>e.constant)){assert(active.includes(e.content));assert(inactive.includes(e.content));}
assert(active.includes(pkg.entries[2].content));assert(!inactive.includes(pkg.entries[2].content));assert(!active.includes(pkg.entries[3].content));
assert(active.includes(character.worldbook.background));assert(active.includes(character.card.initialState.location));
const report={checkedAt:new Date().toISOString(),resourceKey:'c-observatory',chain:['installed private character + phoneRules readback','buildManagedRoleSettings','assemblePromptPayload (real managed preset)'],constantEntries:2,positiveKeyword:'折光镜台',positiveMatched:true,negativeContextDidNotMatch:true,unrelatedKeywordExcluded:true,characterPersonaIncluded:true,installationMarkerExcluded:true,modelCalls:0,actualDialogueTested:false};
writeFileSync(resolve(dir,'evidence/prompt-assembly.json'),JSON.stringify(report,null,2));console.log('Prompt assembly passed: constants + keyword positive/negative + character fields; zero model calls.');

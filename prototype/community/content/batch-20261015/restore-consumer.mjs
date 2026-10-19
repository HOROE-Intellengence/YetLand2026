import assert from 'node:assert/strict';
import {load,save,session,request} from './client.mjs';
const a=await session('a');const before=load('consumer-before.json');
const result=await request('/api/private/themes/activate',a,{id:before.activeTheme.installationId});
assert.equal(result.installationId,before.activeTheme.installationId);assert.deepEqual(result.theme,before.activeTheme.theme);
save('consumer-restored.json',{restoredAt:new Date().toISOString(),activeTheme:result,notes:'Restored pre-batch active theme; all new private installations and six worldbook bindings retained.'});
console.log('Consumer pre-batch active theme restored.');

import {afterEach,describe,it,expect,vi} from 'vitest';
import worker from './worker.mjs';
afterEach(()=>vi.unstubAllGlobals());
const env={RELAY_TOKEN:'test-relay',FISH_API_KEY:'test-fish'};
describe('fixed voice service bridge',()=>{
 it.each(['/unknown','/fish/v1/tts?url=https://evil.test','/google-live?key=x'])('rejects unlisted targets %s',async p=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);expect((await worker.fetch(new Request('https://ingress.yetland.com'+p),env)).status).toBe(404);expect(f).not.toHaveBeenCalled();
 });
 it.each(['/google-live','/fish/model'])('requires authentication %s',async p=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);expect((await worker.fetch(new Request('https://ingress.yetland.com'+p),env)).status).toBe(401);expect(f).not.toHaveBeenCalled();
 });
 it('reconstructs provider headers and never forwards caller-selected routing',async()=>{
  const f=vi.fn(async()=>new Response('audio'));vi.stubGlobal('fetch',f);
  const r=await worker.fetch(new Request('https://ingress.yetland.com/fish/v1/tts',{method:'POST',headers:{Authorization:'Bearer test-fish','x-forwarded-host':'evil.test',model:'other'},body:'{}'}),env);
  expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');
  const call=f.mock.calls[0] as unknown as [string,RequestInit];expect(call[0]).toBe('https://api.fish.audio/v1/tts');expect(call[1].headers).toEqual({Authorization:'Bearer test-fish','Content-Type':'application/json',model:'s2.1-pro-free'});
 });
 it('does not retry failed requests',async()=>{
  const f=vi.fn(async()=>{throw Error('network')});vi.stubGlobal('fetch',f);
  expect((await worker.fetch(new Request('https://ingress.yetland.com/fish/model',{headers:{Authorization:'Bearer test-fish'}}),env)).status).toBe(502);expect(f).toHaveBeenCalledTimes(1);
 });
});


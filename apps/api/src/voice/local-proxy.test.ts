import { afterEach, describe, expect, it, vi } from 'vitest';
import { localVoiceProxyUrl } from './local-proxy';

afterEach(() => vi.unstubAllEnvs());
describe('local voice proxy boundary', () => {
  it('never enables a developer proxy on the server', () => {
    vi.stubEnv('DEPLOY_MODE', 'server');
    vi.stubEnv('VOICE_LOCAL_PROXY_URL', 'http://127.0.0.1:7897');
    expect(localVoiceProxyUrl('https://api.fish.audio/v1/tts')).toBeUndefined();
  });
  it('routes external HTTP and WebSocket but preserves loopback services', () => {
    vi.stubEnv('DEPLOY_MODE', 'local');
    vi.stubEnv('VOICE_LOCAL_PROXY_URL', 'http://127.0.0.1:7897');
    expect(localVoiceProxyUrl('https://api.fish.audio/v1/tts')).toBe('http://127.0.0.1:7897');
    expect(localVoiceProxyUrl('wss://relay.example/google-live')).toBe('http://127.0.0.1:7897');
    expect(localVoiceProxyUrl('ws://127.0.0.1:9000/google-live')).toBeUndefined();
    expect(localVoiceProxyUrl('http://[::1]/audio')).toBeUndefined();
  });
  it('requires explicit opt-in and rejects malformed proxy settings', () => {
    vi.stubEnv('DEPLOY_MODE', 'local');
    vi.stubEnv('VOICE_LOCAL_PROXY_URL', '');
    expect(localVoiceProxyUrl('https://api.fish.audio')).toBeUndefined();
    vi.stubEnv('VOICE_LOCAL_PROXY_URL', 'http://user:secret@localhost:7897/path');
    expect(() => localVoiceProxyUrl('https://api.fish.audio')).toThrow('VOICE_LOCAL_PROXY_URL');
  });
});

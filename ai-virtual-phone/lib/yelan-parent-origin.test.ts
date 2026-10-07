import { describe, it, expect } from 'vitest';
import { yelanParentOrigins } from './yelan-parent-origin';
describe('parent origin allowlist', () => {
  it('allows the two local development hostnames on the configured port', () => {
    expect(yelanParentOrigins('http://localhost:5173')).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(yelanParentOrigins('http://127.0.0.1:5173')).not.toContain('http://localhost:5174');
  });
  it('does not broaden HTTPS or non-loopback production origins', () => {
    expect(yelanParentOrigins('https://yelan.example')).toEqual(['https://yelan.example']);
    expect(yelanParentOrigins('http://yelan.example')).toEqual(['http://yelan.example']);
  });
});

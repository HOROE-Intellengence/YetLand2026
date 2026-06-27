import { describe, it, expect } from 'vitest';
import type { Env } from '../types/bindings';
import { getMockFallbackBase } from '../routes/mock-fallback';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    UNLIM_WORKER_URL: '',
    DATABASE_URL: '',
    REDIS_URL: '',
    NARRATIVE_BOUNDARY_GLOBAL: '2',
    ADMIN_TOKEN: 'admin-test',
    INTERNAL_TOKEN: '',
    ...overrides,
  } as Env;
}

describe('getMockFallbackBase', () => {
  it('returns null when neither enabled nor explicit base', () => {
    expect(getMockFallbackBase(env())).toBeNull();
  });

  it('returns default localhost when ENABLE_MOCK_FALLBACK=true', () => {
    expect(getMockFallbackBase(env({ ENABLE_MOCK_FALLBACK: 'true' }))).toBe('http://127.0.0.1:8787');
  });

  it('returns explicit base', () => {
    expect(
      getMockFallbackBase(env({ MOCK_SERVER_BASE: 'https://api.example.com' })),
    ).toBe('https://api.example.com');
  });

  it('strips trailing slash', () => {
    expect(
      getMockFallbackBase(env({ MOCK_SERVER_BASE: 'https://api.example.com/' })),
    ).toBe('https://api.example.com');
  });

  it('allows HTTPS base in production', () => {
    expect(
      getMockFallbackBase(
        env({ ENV: 'production', MOCK_SERVER_BASE: 'https://api.example.com' }),
      ),
    ).toBe('https://api.example.com');
  });

  it('allows localhost in production', () => {
    expect(
      getMockFallbackBase(
        env({ ENV: 'production', ENABLE_MOCK_FALLBACK: 'true' }),
      ),
    ).toBe('http://127.0.0.1:8787');
  });

  it('rejects non-HTTPS non-localhost in production', () => {
    expect(
      getMockFallbackBase(
        env({ ENV: 'production', MOCK_SERVER_BASE: 'http://insecure.example.com' }),
      ),
    ).toBeNull();
  });

  it('allows non-HTTPS in non-production', () => {
    expect(
      getMockFallbackBase(
        env({ ENV: 'development', MOCK_SERVER_BASE: 'http://dev.example.com' }),
      ),
    ).toBe('http://dev.example.com');
  });
});

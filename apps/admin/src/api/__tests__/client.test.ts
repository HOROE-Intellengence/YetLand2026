import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// We need to manually re-import because the module reads localStorage at import time
// The admin client code:
import { getAuthHeaders, getBase, getToken, setBase, setToken } from '../client';

describe('admin API client', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    mockFetch.mockReset();
  });

  it('getBase defaults to localhost:8787 when nothing saved', () => {
    expect(getBase()).toBe('http://localhost:8787');
  });

  it('setBase and getBase roundtrip', () => {
    setBase('https://admin.example.com');
    expect(getBase()).toBe('https://admin.example.com');
  });

  it('getToken returns empty when no token saved', () => {
    expect(getToken()).toBe('');
  });

  it('setToken and getToken roundtrip', () => {
    setToken('admin-secret-token');
    expect(getToken()).toBe('admin-secret-token');
  });

  it('getAuthHeaders includes Authorization when token set', () => {
    setToken('test-token');
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer test-token' });
  });

  it('getAuthHeaders is empty when no token', () => {
    expect(getAuthHeaders()).toEqual({});
  });
});

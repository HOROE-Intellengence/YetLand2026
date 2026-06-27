import { AuthVerifyResponseSchema, AuthMeResponseSchema } from '@yelan/shared';
import type { AuthVerifyResponse, AuthMeResponse } from '@yelan/shared';

const LS_TOKEN = 'yelan.adminToken';
const LS_BASE = 'yelan.adminApiBase';

function base(): string {
  const saved = localStorage.getItem(LS_BASE);
  if (saved) return saved;
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return window.location.origin;
  }
  return 'http://localhost:8787';
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...getAuthHeaders() };
}

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(LS_TOKEN);
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function getBase(): string { return base(); }
export function getToken(): string { return localStorage.getItem(LS_TOKEN) || ''; }
export function setBase(url: string) { localStorage.setItem(LS_BASE, url); }
export function setToken(token: string) { localStorage.setItem(LS_TOKEN, token); }

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  get<T>(path: string): Promise<T> {
    return fetchJSON<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return fetchJSON<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return fetchJSON<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return fetchJSON<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  delete<T>(path: string): Promise<T> {
    return fetchJSON<T>(path, { method: 'DELETE' });
  },
};

export async function checkAuth(): Promise<boolean> {
  try {
    const data = await api.get<AuthMeResponse>('/api/auth/me');
    AuthMeResponseSchema.parse(data);
    return true;
  } catch {
    return false;
  }
}

// 统一 fetch 封装：base URL / 鉴权头 / 错误归一
// token 落 localStorage 'yelan.token'，用户 id 单独落本地用于浏览器缓存隔离。
import { env } from '../config/env';

const TOKEN_KEY = 'yelan.token';
const USER_ID_KEY = 'yelan.userId';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_ID_KEY);
    }
  } catch {
    /* noop */
  }
}

export function setCurrentUserId(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(USER_ID_KEY, userId);
    else localStorage.removeItem(USER_ID_KEY);
  } catch {
    /* noop */
  }
}

export function setAuthSession(token: string, userId: string): void {
  setToken(token);
  setCurrentUserId(userId);
}

/** 从 JWT payload 中提取 userId（sub 字段），失败返回 null */
export function getUserIdFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

export function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem(USER_ID_KEY) ?? getUserIdFromToken();
  } catch {
    return getUserIdFromToken();
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(env.apiBase + path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: { code?: string; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

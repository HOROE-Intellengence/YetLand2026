// 鉴权 — 手机号 + 验证码（Phase 1 暂不做年龄验证）
// verifyOtp 成功后调用 setToken，让后续所有 api() 自动带 Bearer
import { api, getCurrentUserId, getDeviceId, setAuthSession, setToken } from './client';
import type { Me, MeProfilePatch } from '@yelan/shared';
import { clearLocalUserData } from '../lib/clear-local-user-data';
import { migrateLocalChatOwner } from '../chat/local-history';

export const requestOtp = (phone: string) =>
  api<{ ok: true }>('/api/auth/otp', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });

async function adoptAuthSession(r: { token: string; me: Me }): Promise<void> {
  // 登录前的访客对话挂在设备 id 名下 —— 先过户到真实账号，
  // 再走 clearLocalUserData（它只保留 keepChatUserId 的 key，会清掉设备 id 的）。
  migrateLocalChatOwner(getDeviceId(), r.me.id);
  await clearLocalUserData({ keepChatUserId: r.me.id });
  setAuthSession(r.token, r.me.id);
}

export async function verifyOtp(phone: string, code: string): Promise<{ token: string; me: Me }> {
  const r = await api<{ token: string; me: Me }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  });
  await adoptAuthSession(r);
  return r;
}

export const me = () => api<Me>('/api/auth/me');

export const currentMe = () => api<Me>('/api/me');

export const updateMyName = (name: string) =>
  api<Me>('/api/me/name', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });

export const updateMyProfile = (patch: MeProfilePatch) =>
  api<Me>('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// —— 邮箱 + 密码（email-auth phase）—— 新用户主路径
export async function registerWithEmail(email: string, password: string, name?: string): Promise<{ token: string; me: Me }> {
  const body: Record<string, string> = { email, password };
  if (name) body.name = name;
  const r = await api<{ token: string; me: Me }>('/api/auth/email/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await adoptAuthSession(r);
  return r;
}

export async function loginWithEmail(email: string, password: string): Promise<{ token: string; me: Me }> {
  const r = await api<{ token: string; me: Me }>('/api/auth/email/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await adoptAuthSession(r);
  return r;
}

// 绑定 / 更换邮箱；首次绑定（无密码用户）必须传 password —— 后端 400 NO_PASSWORD 时不会发新 token
export async function bindMyEmail(email: string, password?: string): Promise<{ me: Me; token?: string }> {
  const body: Record<string, string> = { email };
  if (password) body.password = password;
  const r = await api<{ me: Me; token?: string }>('/api/me/email/bind', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (r.token) setToken(r.token);
  return r;
}

// —— 密码登录 / 设置 / 重置（Phase 3） ——

export async function loginWithPassword(phone: string, password: string): Promise<{ token: string; me: Me }> {
  const r = await api<{ token: string; me: Me }>('/api/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  await adoptAuthSession(r);
  return r;
}

export async function resetPassword(phone: string, code: string, newPassword: string): Promise<{ token: string; me: Me }> {
  const r = await api<{ token: string; me: Me }>('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ phone, code, newPassword }),
  });
  await adoptAuthSession(r);
  return r;
}

export async function setMyPassword(newPassword: string, currentPassword?: string): Promise<{ token: string; me: Me }> {
  const body: Record<string, string> = { newPassword };
  if (currentPassword !== undefined) body.currentPassword = currentPassword;
  const r = await api<{ token: string; me: Me }>('/api/me/password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // 设置/修改密码会返回新 token（旧 token 已失效）
  setToken(r.token);
  return r;
}

// —— 账户管理（Phase 4） ——

export const changeMyPhone = (newPhone: string, code: string) =>
  api<Me>('/api/me/phone/change', {
    method: 'POST',
    body: JSON.stringify({ newPhone, code }),
  });

export async function revokeAllMySessions(): Promise<{ token: string }> {
  const r = await api<{ ok: true; token: string }>('/api/me/sessions/revoke-all', {
    method: 'POST',
  });
  const userId = getCurrentUserId();
  await clearLocalUserData({ keepChatUserId: userId ?? undefined });
  setToken(r.token);
  return { token: r.token };
}

export async function deleteMyAccount(confirmation: { currentPassword?: string; code?: string }): Promise<void> {
  await api<{ ok: true }>('/api/me/delete', {
    method: 'POST',
    body: JSON.stringify(confirmation),
  });
  await clearLocalUserData();
  setToken(null);
}

export async function logout(): Promise<void> {
  await clearLocalUserData();
  setToken(null);
}

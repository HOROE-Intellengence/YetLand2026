import type { ApiKeyView } from '@yelan/shared';

export const keyPhoneLabel = (key: ApiKeyView) =>
  key.verification === 'email' && key.verifiedEmail
    ? key.verifiedEmail
    : key.verification === 'sms' && key.verifiedPhone
      ? key.verifiedPhone
      : key.verification === 'admin_test'
        ? '未验证手机号 · 管理员测试'
        : '未绑定验证手机号';

export function groupKeysByPhone(keys: ApiKeyView[]) {
  const groups = new Map<string, ApiKeyView[]>();
  for (const key of keys) {
    const phone = keyPhoneLabel(key);
    const group = groups.get(phone) ?? [];
    group.push(key);
    groups.set(phone, group);
  }
  return [...groups].map(([phone, items]) => ({ phone, keys: items }));
}

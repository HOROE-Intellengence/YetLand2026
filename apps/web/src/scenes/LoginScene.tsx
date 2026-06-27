// 登录场景 — 邮箱+密码（默认） / 邮箱+密码注册 / 手机号 3 模式（legacy 折叠）
// 由 OpeningScene 与 YouPanel 触发，跨 scene 流入
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  loginWithEmail,
  loginWithPassword,
  registerWithEmail,
  requestOtp,
  resetPassword,
  verifyOtp,
} from '../api/auth';
import { useSessionStore } from '../stores/sessionStore';
import styles from './NameScene.module.css';

type Mode = 'email-login' | 'email-register' | 'phone-password' | 'phone-otp' | 'phone-reset';

const PHONE_RE = /^\+?\d{8,15}$/;
const CODE_RE = /^\d{4,8}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isPhoneMode = (m: Mode) => m === 'phone-password' || m === 'phone-otp' || m === 'phone-reset';

export function LoginScene() {
  const setUserName = useSessionStore((s) => s.setUserName);
  const restart = useSessionStore((s) => s.restart);
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('email-login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);

  const sendOtp = async () => {
    if (!PHONE_RE.test(phone)) {
      setError('请输入有效的手机号');
      return;
    }
    setError(null);
    try {
      await requestOtp(phone);
      setOtpSent(true);
    } catch (e) {
      setError((e as Error).message || '验证码发送失败');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);

    setBusy(true);
    try {
      let result;
      if (mode === 'email-login') {
        if (!EMAIL_RE.test(email)) { setError('请输入有效的邮箱'); return; }
        if (!password) { setError('请输入密码'); return; }
        result = await loginWithEmail(email, password);
      } else if (mode === 'email-register') {
        if (!EMAIL_RE.test(email)) { setError('请输入有效的邮箱'); return; }
        if (!PASSWORD_RE.test(password)) { setError('密码至少 8 位，需包含字母与数字'); return; }
        result = await registerWithEmail(email, password, name.trim() || undefined);
      } else {
        if (!PHONE_RE.test(phone)) { setError('请输入有效的手机号'); return; }
        if (mode === 'phone-password') {
          if (!password) { setError('请输入密码'); return; }
          result = await loginWithPassword(phone, password);
        } else if (mode === 'phone-otp') {
          if (!CODE_RE.test(code)) { setError('请输入有效的验证码'); return; }
          result = await verifyOtp(phone, code);
        } else {
          if (!CODE_RE.test(code)) { setError('请输入有效的验证码'); return; }
          if (!PASSWORD_RE.test(newPassword)) { setError('新密码至少 8 位，需包含字母与数字'); return; }
          result = await resetPassword(phone, code, newPassword);
        }
      }
      queryClient.setQueryData(['me'], result.me);
      if (result.me.name) setUserName(result.me.name);
      restart();
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      const msg = err.message || '';
      if (err.status === 423 || /锁定/.test(msg)) {
        setError('账号已锁定，请稍后再试');
      } else if (err.code === 'PASSWORD_NOT_SET' || err.code === 'NO_PASSWORD') {
        setError('此账号尚未设置密码');
      } else if (err.code === 'EMAIL_TAKEN' || err.status === 409) {
        setError('该邮箱已被注册');
      } else if (err.status === 401) {
        setError('账号或密码不正确');
      } else if (err.status === 410 || err.code === 'ACCOUNT_DELETED') {
        setError('该账号已注销');
      } else {
        setError(msg || '登录失败，请重试');
      }
    } finally {
      setBusy(false);
    }
  };

  // 切换模式时清理无关字段 + 错误 + OTP 发送态
  const switchMode = (next: Mode) => {
    setError(null);
    setOtpSent(false);
    setCode('');
    setNewPassword('');
    setMode(next);
    if (isPhoneMode(next)) setLegacyOpen(true);
  };

  const title = mode === 'email-register'
    ? '加入夜阑'
    : mode === 'phone-reset'
      ? '重置密码'
      : '回到夜阑';

  return (
    <div className={styles.root}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.prompt}>
          <span>{title}</span>
        </div>

        {(mode === 'email-login' || mode === 'email-register') && (
          <>
            <input
              className={styles.input}
              inputMode="email"
              maxLength={120}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱"
              type="email"
              value={email}
            />
            {mode === 'email-register' && (
              <input
                className={styles.input}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder="希望被怎样称呼（可选）"
                value={name}
              />
            )}
            <input
              className={styles.input}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'email-register' ? '设置密码（≥8 位，字母+数字）' : '密码'}
              type="password"
              value={password}
            />
            <p className={styles.subtitle}>
              {mode === 'email-login' ? '还没有账户？' : '已有账户？'}
              {' '}
              <button
                onClick={() => switchMode(mode === 'email-login' ? 'email-register' : 'email-login')}
                style={{
                  background: 'none', border: 0, color: 'var(--gold-light)',
                  cursor: 'pointer', textDecoration: 'underline',
                }}
                type="button"
              >
                {mode === 'email-login' ? '注册' : '直接登录'}
              </button>
            </p>
          </>
        )}

        {isPhoneMode(mode) && (
          <>
            <input
              className={styles.input}
              inputMode="tel"
              maxLength={20}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="手机号"
              value={phone}
            />

            {mode === 'phone-password' && (
              <input
                className={styles.input}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
                type="password"
                value={password}
              />
            )}

            {(mode === 'phone-otp' || mode === 'phone-reset') && (
              <>
                <input
                  className={styles.input}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="验证码"
                  value={code}
                />
                <button
                  className={styles.input}
                  disabled={!PHONE_RE.test(phone) || otpSent}
                  onClick={sendOtp}
                  style={{ cursor: 'pointer', textAlign: 'center', borderBottomStyle: 'dashed' }}
                  type="button"
                >
                  {otpSent ? '验证码已发送' : '发送验证码'}
                </button>
              </>
            )}

            {mode === 'phone-reset' && (
              <input
                className={styles.input}
                maxLength={128}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="新密码（≥8 位，字母+数字）"
                type="password"
                value={newPassword}
              />
            )}

            <p className={styles.subtitle}>
              {mode === 'phone-password' ? '没有密码？' : mode === 'phone-otp' ? '已设密码？' : '想起密码了？'}
              {' '}
              <button
                onClick={() => switchMode(mode === 'phone-password' ? 'phone-otp' : 'phone-password')}
                style={{
                  background: 'none', border: 0, color: 'var(--gold-light)',
                  cursor: 'pointer', textDecoration: 'underline',
                }}
                type="button"
              >
                {mode === 'phone-password' ? '用验证码登录' : '用密码登录'}
              </button>
              {' · '}
              <button
                onClick={() => switchMode(mode === 'phone-reset' ? 'phone-password' : 'phone-reset')}
                style={{
                  background: 'none', border: 0, color: 'var(--gold-light)',
                  cursor: 'pointer', textDecoration: 'underline',
                }}
                type="button"
              >
                {mode === 'phone-reset' ? '取消' : '忘记密码'}
              </button>
            </p>
          </>
        )}

        {/* 其他登录方式 —— 旧 phone 链路收在折叠区 */}
        <details
          open={legacyOpen}
          onToggle={(e) => setLegacyOpen((e.target as HTMLDetailsElement).open)}
          style={{ marginTop: 12, opacity: 0.7 }}
        >
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>
            其他登录方式（手机号）
          </summary>
          <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 13, justifyContent: 'center' }}>
            <button
              onClick={() => switchMode('phone-password')}
              style={{
                background: 'none', border: 0, color: 'var(--gold-light)',
                cursor: 'pointer', textDecoration: mode === 'phone-password' ? 'underline' : 'none',
              }}
              type="button"
            >
              手机号 + 密码
            </button>
            <button
              onClick={() => switchMode('phone-otp')}
              style={{
                background: 'none', border: 0, color: 'var(--gold-light)',
                cursor: 'pointer', textDecoration: mode === 'phone-otp' ? 'underline' : 'none',
              }}
              type="button"
            >
              手机号 + 验证码
            </button>
            {!isPhoneMode(mode) && (
              <button
                onClick={() => switchMode('email-login')}
                style={{
                  background: 'none', border: 0, color: 'var(--gold-light)',
                  cursor: 'pointer', textDecoration: 'none',
                }}
                type="button"
              >
                回到邮箱登录
              </button>
            )}
            {isPhoneMode(mode) && (
              <button
                onClick={() => switchMode('email-login')}
                style={{
                  background: 'none', border: 0, color: 'var(--gold-light)',
                  cursor: 'pointer', textDecoration: 'none',
                }}
                type="button"
              >
                回到邮箱登录
              </button>
            )}
          </div>
        </details>

        {error && <p className={styles.error}>{error}</p>}

        <button
          className={styles.enterBtn}
          disabled={busy}
          type="submit"
        >
          {busy ? <span className={styles.spin}>...</span> : '>'}
        </button>
      </form>
    </div>
  );
}

// 邮箱注册/登录及已有手机号账号的密码登录。短信服务尚未开放。
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loginWithEmail, loginWithPassword, registerWithEmail } from '../api/auth';
import { useSessionStore } from '../stores/sessionStore';
import styles from './NameScene.module.css';
import loginStyles from './LoginScene.module.css';

type Mode = 'email-login' | 'email-register' | 'phone-password';
const PHONE_RE = /^\+?\d{8,15}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScene() {
  const finishLogin = useSessionStore((s) => s.finishLogin);
  const cancelLogin = useSessionStore((s) => s.cancelLogin);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('email-login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const registering = mode === 'email-register';
  const phoneMode = mode === 'phone-password';
  const action = registering ? '注册并进入' : '登录';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    if (phoneMode ? !PHONE_RE.test(cleanPhone) : !EMAIL_RE.test(cleanEmail)) {
      setError(phoneMode ? '请输入有效的手机号' : '请输入有效的邮箱');
      return;
    }
    if (!password) { setError('请输入密码'); return; }
    if (registering && !PASSWORD_RE.test(password)) {
      setError('密码至少 8 位，需包含字母与数字'); return;
    }
    if (!registering && password.length < 8) {
      setError('账号或密码不正确'); return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = phoneMode
        ? await loginWithPassword(cleanPhone, password)
        : registering
          ? await registerWithEmail(cleanEmail, password, name.trim() || undefined)
          : await loginWithEmail(cleanEmail, password);
      // 身份切换后不可沿用上个账户的查询缓存。
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(['me'], result.me);
      finishLogin(result.me.name);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      if (err.status === 423) setError('账号已锁定，请稍后再试');
      else if (err.code === 'PASSWORD_NOT_SET' || err.code === 'NO_PASSWORD') setError('此账号尚未设置密码');
      else if (err.code === 'EMAIL_TAKEN') setError('该邮箱已被注册，请直接登录');
      else if (err.status === 401 || err.code === 'NOT_FOUND') setError('账号或密码不正确');
      else if (err.status === 410 || err.code === 'ACCOUNT_DELETED') setError('该账号已注销');
      else if (err.code === 'VALIDATION_ERROR') setError('请检查邮箱、手机号及密码格式');
      else if (e instanceof TypeError) setError('暂时无法连接服务，请稍后重试');
      else setError(err.message || '登录失败，请重试');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    if (submitting.current) return;
    setError(null);
    setPassword('');
    setMode(next);
  };

  return (
    <div className={`${styles.root} ${loginStyles.root}`}>
      <form className={styles.form} onSubmit={submit} noValidate aria-label={registering ? '注册账号' : '账号登录'}>
        <div className={styles.prompt}><span>{registering ? '加入夜阑' : '回到夜阑'}</span></div>
        {phoneMode ? (
          <input className={styles.input} aria-label="手机号" autoComplete="username" inputMode="tel" maxLength={20}
            disabled={busy} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" type="tel" value={phone} />
        ) : (
          <input className={styles.input} aria-label="邮箱" autoComplete="username" inputMode="email" maxLength={120}
            disabled={busy} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" type="email" value={email} />
        )}
        {registering && (
          <input className={styles.input} aria-label="称呼（可选）" autoComplete="nickname" maxLength={24}
            disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="希望被怎样称呼（可选）" value={name} />
        )}
        <input className={styles.input} aria-label="密码" autoComplete={registering ? 'new-password' : 'current-password'}
          maxLength={128} disabled={busy} onChange={(e) => setPassword(e.target.value)}
          placeholder={registering ? '设置密码（≥8 位，字母+数字）' : '密码'} type="password" value={password} />
        {!phoneMode && (
          <p className={styles.subtitle}>
            {registering ? '已有账户？' : '还没有账户？'}{' '}
            <button className={loginStyles.link} disabled={busy} type="button"
              onClick={() => switchMode(registering ? 'email-login' : 'email-register')}>
              {registering ? '直接登录' : '注册'}
            </button>
          </p>
        )}
        <details className={loginStyles.alternatives}>
          <summary>其他登录方式</summary>
          <div className={loginStyles.options}>
            <button className={loginStyles.link} disabled={busy} type="button" onClick={() => switchMode(phoneMode ? 'email-login' : 'phone-password')}>
              {phoneMode ? '回到邮箱登录' : '手机号 + 密码'}
            </button>
            <p className={styles.subtitle}>短信验证暂未开放，暂不支持验证码登录和短信找回密码。</p>
          </div>
        </details>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={`${styles.enterBtn} ${loginStyles.submit}`} disabled={busy} type="submit">
          {busy ? '请稍候…' : action}
        </button>
        <button className={loginStyles.link} disabled={busy} onClick={cancelLogin} type="button">返回</button>
      </form>
    </div>
  );
}

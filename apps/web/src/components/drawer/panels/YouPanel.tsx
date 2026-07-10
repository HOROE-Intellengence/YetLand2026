import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import {
  bindMyEmail,
  changeMyPhone,
  currentMe,
  deleteMyAccount,
  logout,
  revokeAllMySessions,
  setMyPassword,
  updateMyName,
  updateMyProfile,
} from '../../../api/auth';
import { getChatScopeId, getToken } from '../../../api/client';
import { createLocalSessionId, clearLocalChat } from '../../../chat/local-history';
import { useChatStore } from '../../../stores/chatStore';
import { useDrawerStore } from '../../../stores/drawerStore';
import { useSessionStore } from '../../../stores/sessionStore';
import s from './panel.module.css';

// nickname 字段后端保留（不删 schema/列），但 UI 不再暴露 —— 与「称呼」语义重叠，
// 产品口径合并到「称呼」一条路径。详见 docs/audit/user-account-2026-05-20.md §2。
// email 字段拉出去单独处理（首次绑定需要密码 / 走 bind endpoint；已绑定走 patch）
// 详见 docs/audit/user-account-2026-05-20.md §7 邮箱登录 phase。
type ProfileField = 'avatarUrl' | 'bio';

const FIELD_META: Record<ProfileField, { label: string; maxLength: number; multiline?: boolean; placeholder?: string }> = {
  avatarUrl: { label: '头像 URL', maxLength: 500, placeholder: 'https://...' },
  bio: { label: '简介', maxLength: 280, multiline: true, placeholder: '一句话介绍你自己（可选）' },
};

export function YouPanel() {
  const character = useSessionStore((state) => state.character);
  const setUserName = useSessionStore((state) => state.setUserName);
  const sending = useChatStore((state) => state.sending);
  const queryClient = useQueryClient();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [name, setName] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

  const [profile, setProfile] = useState<Record<ProfileField, string>>({
    avatarUrl: '',
    bio: '',
  });
  const [savedField, setSavedField] = useState<ProfileField | null>(null);

  // 邮箱：首次绑定 vs 更换。首次绑定无密码用户必须同时设密码。
  const [emailDraft, setEmailDraft] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailSaved, setEmailSaved] = useState(false);

  // 密码管理
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwSaved, setPwSaved] = useState(false);

  // 改手机号
  const [newPhone, setNewPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);

  // 注销账户
  const [showDelete, setShowDelete] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ currentPassword: '', code: '' });

  // 登出全部设备
  const [revokeConfirming, setRevokeConfirming] = useState(false);

  const isLoggedIn = Boolean(getToken());
  const meQuery = useQuery({ queryKey: ['me'], queryFn: currentMe, retry: 1 });

  const nameMutation = useMutation({
    mutationFn: updateMyName,
    onSuccess: (me) => {
      const nextName = me.name ?? name.trim();
      queryClient.setQueryData(['me'], me);
      setUserName(nextName);
      setNameSaved(true);
    },
  });

  const profileMutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: (me, vars) => {
      queryClient.setQueryData(['me'], me);
      const touched = Object.keys(vars)[0] as ProfileField | undefined;
      if (touched) setSavedField(touched);
    },
  });

  const emailMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password?: string }) => bindMyEmail(email, password),
    onSuccess: ({ me }) => {
      queryClient.setQueryData(['me'], me);
      setEmailSaved(true);
      setEmailPw('');
    },
  });

  const passwordMutation = useMutation({
    mutationFn: ({ current, next }: { current?: string; next: string }) =>
      setMyPassword(next, current),
    onSuccess: ({ me }) => {
      queryClient.setQueryData(['me'], me);
      setPwSaved(true);
      setPwCurrent('');
      setPwNew('');
    },
  });

  const phoneMutation = useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) => changeMyPhone(phone, code),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me);
      setPhoneSaved(true);
      setNewPhone('');
      setPhoneCode('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeAllMySessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setRevokeConfirming(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMyAccount,
    onSuccess: () => {
      queryClient.clear();
      useDrawerStore.getState().close();
      useSessionStore.getState().restart();
    },
  });

  useEffect(() => {
    if (meQuery.data?.name) setName(meQuery.data.name);
  }, [meQuery.data?.name]);

  useEffect(() => {
    if (!meQuery.data) return;
    setProfile({
      avatarUrl: meQuery.data.avatarUrl ?? '',
      bio: meQuery.data.bio ?? '',
    });
    setEmailDraft(meQuery.data.email ?? '');
  }, [meQuery.data?.email, meQuery.data?.avatarUrl, meQuery.data?.bio]);

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  useEffect(() => {
    if (!savedField) return;
    const timer = window.setTimeout(() => setSavedField(null), 2500);
    return () => window.clearTimeout(timer);
  }, [savedField]);

  useEffect(() => {
    if (!pwSaved) return;
    const timer = window.setTimeout(() => setPwSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [pwSaved]);

  useEffect(() => {
    if (!phoneSaved) return;
    const timer = window.setTimeout(() => setPhoneSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [phoneSaved]);

  useEffect(() => {
    if (!revokeConfirming) return;
    const timer = window.setTimeout(() => setRevokeConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [revokeConfirming]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  useEffect(() => {
    if (!emailSaved) return;
    const timer = window.setTimeout(() => setEmailSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [emailSaved]);

  const handleNameSave = () => {
    const cleanName = name.trim();
    if (!cleanName || nameMutation.isPending) return;
    setNameSaved(false);
    nameMutation.mutate(cleanName);
  };

  const handleProfileSave = (field: ProfileField) => {
    if (profileMutation.isPending) return;
    const currentValue = profile[field].trim();
    const serverValue = (meQuery.data?.[field] ?? '') as string;
    if (currentValue === serverValue) return; // 没变就不打
    profileMutation.mutate({ [field]: currentValue === '' ? null : currentValue });
  };

  const handleEmailSave = () => {
    if (emailMutation.isPending) return;
    const trimmed = emailDraft.trim();
    if (!trimmed) return;
    setEmailSaved(false);
    // 已有 email → 是更换；调 bind（后端 emailIndex 原子 swap + 唯一性）
    // 没有 email 且没有密码 → 首次绑定，必须同时设 password
    // 没有 email 且已有密码 → 首次绑定，不需要 password
    const needsPassword = !meQuery.data?.hasPassword;
    emailMutation.mutate({
      email: trimmed,
      ...(needsPassword ? { password: emailPw } : {}),
    });
  };

  const handleClearLocalChat = () => {
    if (!character || sending) return;
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearLocalChat(character.id, getChatScopeId() ?? undefined);
    useChatStore
      .getState()
      .resetForLocalSession(createLocalSessionId(character.id), character.openingLines.firstVisit);
    useSessionStore.getState().setStage('daily');
    useSessionStore.getState().setBoundary(DEFAULT_USER_BOUNDARY);
    useSessionStore.getState().setTemperature(3);
    setConfirmingClear(false);
  };

  const handleSetPassword = () => {
    if (passwordMutation.isPending) return;
    if (pwNew.length < 8 || !/[A-Za-z]/.test(pwNew) || !/[0-9]/.test(pwNew)) return;
    const hasPassword = Boolean(meQuery.data?.hasPassword);
    setPwSaved(false);
    passwordMutation.mutate({
      next: pwNew,
      current: hasPassword ? pwCurrent : undefined,
    });
  };

  const handleChangePhone = () => {
    if (phoneMutation.isPending) return;
    if (!/^\+?\d{8,15}$/.test(newPhone.trim())) return;
    if (!/^\d{4,8}$/.test(phoneCode.trim())) return;
    setPhoneSaved(false);
    phoneMutation.mutate({ phone: newPhone.trim(), code: phoneCode.trim() });
  };

  const handleRevokeAll = () => {
    if (revokeMutation.isPending) return;
    if (!revokeConfirming) {
      setRevokeConfirming(true);
      return;
    }
    revokeMutation.mutate();
  };

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const conf: { currentPassword?: string; code?: string } = {};
    if (deleteConfirm.currentPassword) conf.currentPassword = deleteConfirm.currentPassword;
    if (deleteConfirm.code) conf.code = deleteConfirm.code;
    if (!conf.currentPassword && !conf.code) return;
    deleteMutation.mutate(conf);
  };

  const handleLogout = () => {
    if (sending) return;
    void logout().then(() => {
      queryClient.removeQueries({ queryKey: ['me'] });
      useDrawerStore.getState().close();
      useSessionStore.getState().restart();
      setName('');
      setNameSaved(false);
    });
  };

  return (
    <div className={s.panel}>
      <h2 className={s.title}>你</h2>
      <p className={s.dim}>你的个人资料与账户设置。</p>

      <div className={s.section}>
        <p className={s.mute}>账户</p>
        {(() => {
          // 显示优先级：email > phone（非匿名）> 访客
          // email-only 用户没 phone，email 用户优先展示 email 作为 login 标识
          const data = meQuery.data;
          const isAnon = !data?.phone || data.phone === '00000000000';
          const hasEmail = Boolean(data?.email);
          const hasRealPhone = Boolean(data?.phone) && data!.phone !== '00000000000';
          const loggedInLabel = hasEmail
            ? `已登录 · ${data!.email}`
            : hasRealPhone
              ? `已登录 · ${data!.phone}`
              : '访客模式 · 未绑定登录标识';
          const showLoginCta = !isLoggedIn || (isAnon && !hasEmail);
          const showRegisteredAt = isLoggedIn && data?.createdAt && (!isAnon || hasEmail);
          return (
            <>
              <p className={s.dim}>{isLoggedIn ? loggedInLabel : '访客模式 · 未登录'}</p>
              {showRegisteredAt && (
                <p className={s.mute}>
                  注册于 {new Date(data!.createdAt).toLocaleDateString('zh-CN')}
                </p>
              )}
              {/* id 给运营 / 排错用 —— 用户也能看到，方便 support 时报上来 */}
              {isLoggedIn && data?.id && (
                <p className={s.mute} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  ID · {data.id}
                </p>
              )}
              {showLoginCta && (
                <button
                  className={s.submitBtn}
                  onClick={() => {
                    useDrawerStore.getState().close();
                    useSessionStore.getState().goLogin();
                  }}
                  type="button"
                >
                  现在登录
                </button>
              )}
            </>
          );
        })()}
      </div>

      <div className={s.section}>
        <p className={s.mute}>称呼（角色对你的称呼）</p>
        <input
          className={s.textInput}
          maxLength={24}
          onChange={(event) => {
            setName(event.target.value);
            setNameSaved(false);
          }}
          value={name}
        />
        <button
          className={s.submitBtn}
          disabled={!name.trim() || nameMutation.isPending}
          onClick={handleNameSave}
          type="button"
        >
          {nameMutation.isPending ? '保存中' : '保存称呼'}
        </button>
        {nameSaved && <p className={s.success}>已保存</p>}
        {nameMutation.isError && (
          <p className={s.error}>{(nameMutation.error as Error).message}</p>
        )}
      </div>

      {isLoggedIn && (() => {
        const serverEmail = meQuery.data?.email ?? '';
        const hasPassword = Boolean(meQuery.data?.hasPassword);
        const isFirstBind = !serverEmail;
        const needsPassword = isFirstBind && !hasPassword;
        const draft = emailDraft.trim();
        const dirty = draft !== serverEmail && Boolean(draft);
        const canSubmit = dirty && (!needsPassword || emailPw.length >= 8);
        return (
          <div className={s.section}>
            <p className={s.mute}>邮箱（用于登录）</p>
            <input
              className={s.textInput}
              inputMode="email"
              maxLength={120}
              onChange={(e) => { setEmailDraft(e.target.value); setEmailSaved(false); }}
              placeholder="name@example.com"
              type="email"
              value={emailDraft}
            />
            {needsPassword && (
              <input
                className={s.textInput}
                maxLength={128}
                onChange={(e) => setEmailPw(e.target.value)}
                placeholder="同时设置密码（≥8 位，字母+数字）"
                type="password"
                value={emailPw}
              />
            )}
            <button
              className={s.submitBtn}
              disabled={!canSubmit || emailMutation.isPending}
              onClick={handleEmailSave}
              type="button"
            >
              {emailMutation.isPending
                ? '保存中'
                : isFirstBind
                  ? (needsPassword ? '绑定邮箱并设密码' : '绑定邮箱')
                  : '更换邮箱'}
            </button>
            {emailSaved && <p className={s.success}>已保存</p>}
            {emailMutation.isError && (
              <p className={s.error}>
                {(() => {
                  const err = emailMutation.error as { code?: string; message?: string };
                  if (err?.code === 'EMAIL_TAKEN') return '该邮箱已被注册';
                  return err?.message || '保存失败';
                })()}
              </p>
            )}
          </div>
        );
      })()}

      {(['avatarUrl', 'bio'] as ProfileField[]).map((field) => {
        const meta = FIELD_META[field];
        const value = profile[field];
        const serverValue = (meQuery.data?.[field] ?? '') as string;
        const isDirty = value.trim() !== serverValue;
        return (
          <div className={s.section} key={field}>
            <p className={s.mute}>{meta.label}</p>
            {meta.multiline ? (
              <textarea
                className={s.textarea}
                maxLength={meta.maxLength}
                onChange={(event) =>
                  setProfile((prev) => ({ ...prev, [field]: event.target.value }))
                }
                placeholder={meta.placeholder}
                value={value}
              />
            ) : (
              <input
                className={s.textInput}
                maxLength={meta.maxLength}
                onChange={(event) =>
                  setProfile((prev) => ({ ...prev, [field]: event.target.value }))
                }
                placeholder={meta.placeholder}
                value={value}
              />
            )}
            <button
              className={s.submitBtn}
              disabled={!isDirty || profileMutation.isPending}
              onClick={() => handleProfileSave(field)}
              type="button"
            >
              {profileMutation.isPending && profileMutation.variables && field in profileMutation.variables
                ? '保存中'
                : '保存'}
            </button>
            {savedField === field && <p className={s.success}>已保存</p>}
          </div>
        );
      })}

      {profileMutation.isError && (
        <p className={s.error}>{(profileMutation.error as Error).message}</p>
      )}

      {isLoggedIn && (
        <div className={s.section}>
          <p className={s.mute}>
            密码 · {meQuery.data?.hasPassword ? '已设置' : '未设置（OTP 登录中）'}
          </p>
          {meQuery.data?.hasPassword && (
            <input
              className={s.textInput}
              maxLength={128}
              onChange={(event) => setPwCurrent(event.target.value)}
              placeholder="当前密码"
              type="password"
              value={pwCurrent}
            />
          )}
          <input
            className={s.textInput}
            maxLength={128}
            onChange={(event) => setPwNew(event.target.value)}
            placeholder={meQuery.data?.hasPassword ? '新密码（≥8 位，字母+数字）' : '设置密码（≥8 位，字母+数字）'}
            type="password"
            value={pwNew}
          />
          <button
            className={s.submitBtn}
            disabled={
              passwordMutation.isPending ||
              pwNew.length < 8 ||
              !/[A-Za-z]/.test(pwNew) ||
              !/[0-9]/.test(pwNew) ||
              (Boolean(meQuery.data?.hasPassword) && !pwCurrent)
            }
            onClick={handleSetPassword}
            type="button"
          >
            {passwordMutation.isPending
              ? '保存中'
              : meQuery.data?.hasPassword
                ? '修改密码'
                : '设置密码'}
          </button>
          {pwSaved && <p className={s.success}>密码已更新，其他设备将需要重新登录</p>}
          {passwordMutation.isError && (
            <p className={s.error}>{(passwordMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {isLoggedIn && (
        <div className={s.section}>
          <p className={s.mute}>更换手机号（OTP 验证新号）</p>
          <input
            className={s.textInput}
            onChange={(event) => setNewPhone(event.target.value)}
            placeholder="新手机号"
            value={newPhone}
          />
          <input
            className={s.textInput}
            onChange={(event) => setPhoneCode(event.target.value)}
            placeholder="新号收到的验证码"
            value={phoneCode}
          />
          <button
            className={s.submitBtn}
            disabled={
              phoneMutation.isPending ||
              !/^\+?\d{8,15}$/.test(newPhone.trim()) ||
              !/^\d{4,8}$/.test(phoneCode.trim())
            }
            onClick={handleChangePhone}
            type="button"
          >
            {phoneMutation.isPending ? '更换中' : '更换手机号'}
          </button>
          {phoneSaved && <p className={s.success}>手机号已更新</p>}
          {phoneMutation.isError && (
            <p className={s.error}>{(phoneMutation.error as Error).message}</p>
          )}
        </div>
      )}

      <div className={s.section}>
        <p className={s.mute}>当前设备</p>
        <button
          className={s.dangerBtn}
          onClick={handleClearLocalChat}
          disabled={!character || sending}
          type="button"
        >
          {confirmingClear ? '确认删除' : '清除本机对话'}
        </button>
      </div>

      {isLoggedIn && (
        <div className={s.section}>
          <p className={s.mute}>其他设备</p>
          <button
            className={s.dangerBtn}
            onClick={handleRevokeAll}
            disabled={revokeMutation.isPending}
            type="button"
          >
            {revokeConfirming
              ? '确认让其他设备登出'
              : revokeMutation.isPending
                ? '处理中'
                : '让其他设备登出'}
          </button>
          {revokeMutation.isSuccess && <p className={s.success}>其他设备已登出</p>}
        </div>
      )}

      <div className={s.section}>
        <p className={s.mute}>账号</p>
        <button
          className={s.dangerBtn}
          onClick={handleLogout}
          disabled={sending}
          type="button"
        >
          退出账号
        </button>
      </div>

      {isLoggedIn && (
        <div className={s.section}>
          <p className={s.mute}>注销账户（不可恢复）</p>
          {!showDelete ? (
            <button
              className={s.dangerBtn}
              onClick={() => setShowDelete(true)}
              type="button"
            >
              我要注销账户
            </button>
          ) : (
            <>
              <p className={s.dim}>
                注销后账号将无法再登录。请提供当前密码或新收到的验证码以确认。
              </p>
              {meQuery.data?.hasPassword && (
                <input
                  className={s.textInput}
                  onChange={(event) =>
                    setDeleteConfirm((prev) => ({ ...prev, currentPassword: event.target.value }))
                  }
                  placeholder="当前密码"
                  type="password"
                  value={deleteConfirm.currentPassword}
                />
              )}
              <input
                className={s.textInput}
                onChange={(event) =>
                  setDeleteConfirm((prev) => ({ ...prev, code: event.target.value }))
                }
                placeholder="或验证码（4-8 位数字）"
                value={deleteConfirm.code}
              />
              <button
                className={s.dangerBtn}
                disabled={
                  deleteMutation.isPending ||
                  (!deleteConfirm.currentPassword && !deleteConfirm.code)
                }
                onClick={handleDelete}
                type="button"
              >
                {confirmingDelete
                  ? '再次确认：确实要注销'
                  : deleteMutation.isPending
                    ? '注销中'
                    : '确认注销账户'}
              </button>
              {deleteMutation.isError && (
                <p className={s.error}>{(deleteMutation.error as Error).message}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

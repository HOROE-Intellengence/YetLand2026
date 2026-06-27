import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentMe, updateMyName } from '../api/auth';
import { useSessionStore } from '../stores/sessionStore';
import styles from './NameScene.module.css';

export function NameScene() {
  const setUserName = useSessionStore((s) => s.setUserName);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: currentMe,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: updateMyName,
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me);
      setUserName(me.name ?? name.trim());
    },
  });

  useEffect(() => {
    if (data?.name) setUserName(data.name);
  }, [data?.name, setUserName]);

  const cleanName = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!cleanName || mutation.isPending) return;
    mutation.mutate(cleanName);
  };

  return (
    <div className={styles.root}>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.prompt}>
          <span>你来了，</span>
          <input
            autoFocus
            className={styles.input}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            placeholder="你的名字"
            value={name}
          />
        </label>
        <p className={styles.subtitle}>灵魂只为你而生，而非 {data?.id ?? 'user_1234'}</p>
        {mutation.isError && (
          <p className={styles.error}>{(mutation.error as Error).message}</p>
        )}
        <button
          aria-label="进入角色选择"
          className={styles.enterBtn}
          disabled={!cleanName || mutation.isPending || isLoading}
          type="submit"
        >
          {mutation.isPending ? <span className={styles.spin}>...</span> : '>'}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface AdminUserNameRow {
  id: string;
  name?: string | null;
}

export function useUserNameMap(limit = 500): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api.get<AdminUserNameRow[]>(`/api/admin/users?limit=${limit}`)
      .then((rows) => {
        if (!alive) return;
        setNames(Object.fromEntries(
          rows
            .filter((row) => row.name?.trim())
            .map((row) => [row.id, row.name!.trim()]),
        ));
      })
      .catch(() => {
        if (alive) setNames({});
      });
    return () => { alive = false; };
  }, [limit]);

  return names;
}

export function formatUserLabel(userId: string, names: Record<string, string>): string {
  return names[userId] ? `${names[userId]}\n${userId}` : userId;
}

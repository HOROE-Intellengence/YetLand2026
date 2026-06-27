// 书阁 — 角色卡浏览
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCharacters, myCharacters } from '../../../api/characters';
import { useDrawerStore } from '../../../stores/drawerStore';
import { useSessionStore } from '../../../stores/sessionStore';
import s from './panel.module.css';

const rarityLabel: Record<string, string> = {
  free: '可进入',
  paid: '灰测预览',
  hidden: '隐藏',
};

export function LibraryPanel() {
  const character = useSessionStore((state) => state.character);
  const pickCharacter = useSessionStore((state) => state.pickCharacter);
  const close = useDrawerStore((state) => state.close);
  const charactersQuery = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const myCharactersQuery = useQuery({ queryKey: ['me', 'characters'], queryFn: myCharacters });

  const unlockedIds = useMemo(() => {
    const ids = new Set(myCharactersQuery.data?.map((row) => row.characterId) ?? []);
    for (const item of charactersQuery.data ?? []) {
      if (item.rarity === 'free' || item.priceCandle === 0) ids.add(item.id);
    }
    return ids;
  }, [charactersQuery.data, myCharactersQuery.data]);

  return (
    <div className={s.panel}>
      <h2 className={s.title}>书阁</h2>
      <p className={s.dim}>在这里浏览你遇到过的每一扇门。</p>

      {charactersQuery.isLoading ? (
        <div className={s.placeholder}><p>正在整理书阁...</p></div>
      ) : charactersQuery.isError ? (
        <div className={s.placeholder}><p>角色卡暂时取不到。</p></div>
      ) : charactersQuery.data && charactersQuery.data.length > 0 ? (
        <div className={s.cardList}>
          {charactersQuery.data.map((item) => {
            const unlocked = unlockedIds.has(item.id);
            const active = character?.id === item.id;
            return (
              <article className={s.itemCard} key={item.id}>
                <div className={s.itemHeader}>
                  <div>
                    <h3 className={s.itemName}>{item.name}</h3>
                    <p className={s.rowMeta}>{item.description ?? item.openingLines.firstVisit}</p>
                  </div>
                  <span className={s.badge}>{active ? '当前' : rarityLabel[item.rarity]}</span>
                </div>

                {item.styleTags.length > 0 && (
                  <div className={s.tagRow}>
                    {item.styleTags.map((tag) => <span className={s.tag} key={tag}>{tag}</span>)}
                  </div>
                )}

                <p className={s.quote}>“{item.openingLines.firstVisit}”</p>

                {unlocked ? (
                  <button
                    className={s.submitBtn}
                    disabled={active}
                    onClick={() => {
                      pickCharacter(item);
                      close();
                    }}
                    type="button"
                  >
                    {active ? '已在此门中' : '进入'}
                  </button>
                ) : (
                  <div className={s.lockedNote}>
                    灰测只开放预览，消耗烛解锁入口暂不上线。
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={s.placeholder}><p>暂无角色卡。</p></div>
      )}
    </div>
  );
}

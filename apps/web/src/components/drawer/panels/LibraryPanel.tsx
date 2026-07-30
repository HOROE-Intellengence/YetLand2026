// 书阁 — 角色卡浏览
import { useMemo, useState } from 'react';
import type { Character } from '@yelan/shared';
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

// 上半部分（角色简介）折叠阈值：超过则默认收起，仅显示前 N 字 + 展开箭头
const COLLAPSE_LEN = 30;

// 单张角色卡：自带简介折叠状态
function LibraryCard({
  item,
  unlocked,
  active,
  onEnter,
}: {
  item: Character;
  unlocked: boolean;
  active: boolean;
  onEnter: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = item.description ?? item.openingLines.firstVisit;
  const collapsible = summary.length > COLLAPSE_LEN;
  const shown = collapsible && !expanded ? summary.slice(0, COLLAPSE_LEN) : summary;

  return (
    <article className={s.itemCard}>
      <div className={s.itemHeader}>
        <div>
          <h3 className={s.itemName}>{item.name}</h3>
          <p className={s.rowMeta}>
            {shown}
            {collapsible && !expanded && '…'}
            {collapsible && (
              <button
                aria-expanded={expanded}
                aria-label={expanded ? '收起简介' : '展开简介'}
                className={s.expandToggle}
                onClick={() => setExpanded((v) => !v)}
                type="button"
              >
                <span className={expanded ? s.chevronUp : s.chevronDown} aria-hidden="true" />
              </button>
            )}
          </p>
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
        <button className={s.submitBtn} disabled={active} onClick={onEnter} type="button">
          {active ? '已在此门中' : '进入'}
        </button>
      ) : (
        <div className={s.lockedNote}>灰测只开放预览，消耗烛解锁入口暂不上线。</div>
      )}
    </article>
  );
}

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
          {charactersQuery.data.map((item) => (
            <LibraryCard
              active={character?.id === item.id}
              item={item}
              key={item.id}
              onEnter={() => {
                pickCharacter(item);
                close();
              }}
              unlocked={unlockedIds.has(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className={s.placeholder}><p>暂无角色卡。</p></div>
      )}
    </div>
  );
}

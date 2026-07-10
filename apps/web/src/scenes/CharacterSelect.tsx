// "门"的隐喻 — 角色卡列表，最近互动的门更亮
// 数据: GET /characters + GET /me/characters
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCharacters } from '../api/characters';
import { getToken } from '../api/client';
import { useSessionStore } from '../stores/sessionStore';
import { circularOffset, slotForOffset } from './CharacterSelect.carousel';
import { resolveConstellation } from './CharacterSelect.constellation';
import { ConstellationField } from './ConstellationField';
import styles from './CharacterSelect.module.css';

const RARITY_LABEL: Record<string, string> = {
  free: '常客',
  paid: '稀客',
  hidden: '传说',
};

const CHARACTER_REFETCH_INTERVAL_MS = 5000;

const LeftArrowIcon = () => (
  <svg className={styles.arrowIcon} viewBox="0 0 24 24">
    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);

const RightArrowIcon = () => (
  <svg className={styles.arrowIcon} viewBox="0 0 24 24">
    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
  </svg>
);

export function CharacterSelect() {
  const pickCharacter = useSessionStore((s) => s.pickCharacter);
  const goCreate = useSessionStore((s) => s.goCreate);
  const goLogin = useSessionStore((s) => s.goLogin);

  // 入口：已登录（有 token）→ 进创建流程；游客 → 先去登录（创建角色卡需登录）。
  const handleCreateEntry = () => {
    if (getToken()) goCreate();
    else goLogin();
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ['characters'],
    queryFn: listCharacters,
    refetchInterval: CHARACTER_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    refetchOnMount: 'always',
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const wheelAccumulator = useRef(0);
  const wheelLock = useRef(false);
  const dragStart = useRef<{ x: number; active: boolean }>({ x: 0, active: false });
  const suppressClick = useRef(false);

  // 过滤激活的角色
  const activeCharacters = data ? data.filter((c) => c.isActive) : [];
  const n = activeCharacters.length;
  const currentActive = n > 0 ? ((activeIndex % n) + n) % n : 0;

  // 切换方向
  const step = useCallback(
    (dir: number) => {
      if (n <= 0) return;
      setActiveIndex((prev) => ((prev + dir) % n + n) % n);
    },
    [n]
  );

  // 1. 键盘监听 ArrowLeft / ArrowRight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        step(-1);
      } else if (e.key === 'ArrowRight') {
        step(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step]);

  // 2. 鼠标滚轮监听（带节流与锁）
  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // 阻止页面滚动
      if (wheelLock.current) return;

      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelAccumulator.current += delta;

      if (Math.abs(wheelAccumulator.current) >= 40) {
        const dir = Math.sign(wheelAccumulator.current);
        step(dir);
        wheelAccumulator.current = 0;
        wheelLock.current = true;
        setTimeout(() => {
          wheelLock.current = false;
        }, 400); // 400ms 锁定防止连切
      }
    };

    viewportEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewportEl.removeEventListener('wheel', handleWheel);
    };
  }, [step]);

  // 3. 触摸/拖拽 Pointer 事件
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, active: true };
    suppressClick.current = false;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current.active) return;
    const el = e.currentTarget;
    el.releasePointerCapture(e.pointerId);
    const dx = e.clientX - dragStart.current.x;
    dragStart.current.active = false;

    if (Math.abs(dx) > 60) {
      suppressClick.current = true;
      step(dx > 0 ? -1 : 1); // 右滑切至上一张，左滑切至下一张
    }
  };

  const handlePointerCancel = () => {
    dragStart.current.active = false;
  };

  // 4. 点侧卡居中 & 点中卡进入
  const handleCardClick = (index: number, offset: number, c: typeof activeCharacters[0]) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (offset !== 0) {
      setActiveIndex(index);
    } else {
      pickCharacter(c);
    }
  };

  return (
    <div className={styles.root}>
      <h2 className={styles.heading}>选择一扇门</h2>

      {isLoading && <p className={styles.loading}>门正在打开...</p>}

      {error && (
        <p className={styles.error}>
          无法加载角色列表：{(error as Error).message}
        </p>
      )}

      {data && data.length > 0 && (
        <div className={styles.viewport} ref={viewportRef}>
          {n > 1 && (
            <button
              className={`${styles.arrow} ${styles.arrowLeft}`}
              onClick={() => step(-1)}
              aria-label="Previous character"
            >
              <LeftArrowIcon />
            </button>
          )}

          <div className={styles.track}>
            {activeCharacters.map((c, i) => {
              const offset = circularOffset(i, currentActive, n);
              const slot = slotForOffset(offset);

              const inlineStyle = {
                '--slot-x': slot.x,
                '--slot-w': slot.w,
                '--slot-h': slot.h,
                '--slot-scale': slot.scale,
                '--slot-opacity': slot.opacity,
                '--slot-blur': slot.blur,
                '--slot-text-opacity': slot.textOpacity,
                '--slot-z-index': slot.zIndex,
              } as React.CSSProperties;

              // 星座显示强度分级：中心最亮（1），两侧低强度（0.35），远端极淡氛围（0.12），更远不渲染（0）
              const absOffset = Math.abs(offset);
              const constellationIntensity =
                absOffset === 0 ? 1 : absOffset === 1 ? 0.35 : absOffset === 2 ? 0.12 : 0;
              const constellation = resolveConstellation(c);

              return (
                <button
                  key={c.id}
                  className={styles.card}
                  style={inlineStyle}
                  data-tier={absOffset}
                  onClick={() => handleCardClick(i, offset, c)}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  aria-current={offset === 0 ? 'true' : undefined}
                >
                  {/* 矢量星座叠加层 */}
                  <ConstellationField
                    constellation={constellation}
                    intensity={constellationIntensity}
                    active={offset === 0}
                    tier={absOffset}
                  />

                  <div className={styles.cardContent}>
                    <div className={styles.cardRarity}>
                      {RARITY_LABEL[c.rarity] ?? c.rarity}
                    </div>
                    <div className={styles.cardName}>{c.name}</div>
                    <div className={styles.cardTags}>
                      {c.styleTags.slice(0, 3).map((t) => (
                        <span key={t} className={styles.tag}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {n > 1 && (
            <button
              className={`${styles.arrow} ${styles.arrowRight}`}
              onClick={() => step(1)}
              aria-label="Next character"
            >
              <RightArrowIcon />
            </button>
          )}
        </div>
      )}

      {data && data.length === 0 && (
        <p className={styles.loading}>暂无可用角色</p>
      )}

      <button className={styles.createEntry} onClick={handleCreateEntry}>
        创建属于你的那位
      </button>
    </div>
  );
}

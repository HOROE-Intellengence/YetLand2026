import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, animate, motion } from 'framer-motion';
import { useSessionStore } from '../stores/sessionStore';
import styles from './LandingScene.module.css';

const NAV_LINKS = [
  { label: '产品介绍', target: 'intro' },
  { label: '设计理念', target: 'philosophy' },
  { label: '关于我们', target: 'about' },
  { label: '反馈中心', target: 'feedback' },
  { label: '开发组 2 计划', target: 'roadmap' },
];

const FEATURES = [
  { number: '01', title: '角色对话', description: '与不同气质的角色展开私人对话。不论倾诉或是沉默，总有回音。' },
  { number: '02', title: '情绪承接', description: '不急着给答案，先接住当下的语气。在缓慢的交流中，感受被听见。' },
  { number: '03', title: '长期陪伴', description: '让关系、记忆和语境慢慢生长。这不仅是一次问答，而是一场长谈。' },
];

const ROADMAP = [
  { title: '更细腻的长期记忆', description: '让角色记得关系中真正重要的事，哪怕是一次随口的提及。' },
  { title: '更好的夜间阅读体验', description: '字号、留白、节奏和暗色舒适度继续优化，保护深夜的眼睛。' },
  { title: '更自然的角色关系推进', description: '让对话不是一次次重启，而是像树木一样慢慢发生、生根。' },
  { title: '反馈驱动的角色打磨', description: '根据真实体验不断调整角色表达和边界，去除非人的机器感。' },
  { title: '隐私与账号同步', description: '让数据归属更清晰，跨设备体验更稳定。' },
  { title: '创作者角色生态', description: '未来支持更多角色与世界观扩展，让夜阑拥有更辽阔的声音。' },
];

const SCROLL_EASE = [0.76, 0, 0.24, 1] as const;
const FADE_EASE = [0.25, 0.1, 0.25, 1] as const;
const WHEEL_THRESHOLD = 30;
const SNAP_DEAD_ZONE_PX = 84;
const SNAP_ARM_DELAY_MS = 110;
const SNAP_LOCK_RELEASE_MS = 600;

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 1, ease: FADE_EASE } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

function useElegantScroll(rootRef: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.innerWidth < 768) return;

    let isAnimating = false;
    let wheelLocked = false;
    let snapTimer: number | null = null;
    let pendingTarget: HTMLElement | null = null;

    const getWheelPixels = (event: WheelEvent) => {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * root.clientHeight;
      return event.deltaY;
    };

    const findNearestSectionIndex = (sections: HTMLElement[], currentY: number) => {
      let currentIndex = 0;
      let minDiff = Infinity;
      sections.forEach((section, index) => {
        const diff = Math.abs(currentY - section.offsetTop);
        if (diff < minDiff) {
          minDiff = diff;
          currentIndex = index;
        }
      });
      return currentIndex;
    };

    const handleWheel = (event: WheelEvent) => {
      const deltaY = getWheelPixels(event);
      if (Math.abs(deltaY) < WHEEL_THRESHOLD) return;

      event.preventDefault();
      if (isAnimating || wheelLocked) return;

      const direction = deltaY > 0 ? 1 : -1;
      const sections = Array.from(root.querySelectorAll<HTMLElement>('section, footer'));
      const currentY = root.scrollTop;
      const currentIndex = findNearestSectionIndex(sections, currentY);
      const targetIndex = Math.max(0, Math.min(sections.length - 1, currentIndex + direction));
      if (targetIndex === currentIndex) return;
      const targetSection = sections[targetIndex];
      if (!targetSection) return;

      pendingTarget = targetSection;

      const deadZoneDelta = Math.max(
        -SNAP_DEAD_ZONE_PX,
        Math.min(SNAP_DEAD_ZONE_PX, deltaY),
      );
      const maxScrollTop = root.scrollHeight - root.clientHeight;
      root.scrollTop = Math.max(0, Math.min(maxScrollTop, root.scrollTop + deadZoneDelta));

      if (snapTimer !== null) return;

      snapTimer = window.setTimeout(() => {
        snapTimer = null;
        const target = pendingTarget;
        pendingTarget = null;
        if (!target) return;

        isAnimating = true;
        wheelLocked = true;

        animate(root.scrollTop, target.offsetTop, {
          duration: 1.4,
          ease: SCROLL_EASE,
          onUpdate: (latest) => {
            root.scrollTop = latest;
          },
          onComplete: () => {
            isAnimating = false;
            window.setTimeout(() => {
              wheelLocked = false;
            }, SNAP_LOCK_RELEASE_MS);
          },
        });
      }, SNAP_ARM_DELAY_MS);
    };

    root.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', handleWheel);
      if (snapTimer !== null) window.clearTimeout(snapTimer);
    };
  }, [rootRef]);
}

export function LandingScene() {
  const goIntro = useSessionStore((state) => state.goIntro);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useElegantScroll(rootRef);

  const scrollToSection = (target: string) => {
    const root = rootRef.current;
    const section = root?.querySelector<HTMLElement>(`[data-section="${target}"], [data-footer="${target}"]`);
    if (!root || !section) return;

    animate(root.scrollTop, section.offsetTop, {
      duration: 1.4,
      ease: SCROLL_EASE,
      onUpdate: (latest) => {
        root.scrollTop = latest;
      },
    });
  };

  const handleNavClick = (target: string) => {
    setMenuOpen(false);
    scrollToSection(target);
  };

  const handleFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <div
      className={styles.root}
      data-landing-root
      onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 50)}
      ref={rootRef}
    >
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <button className={styles.brand} onClick={() => scrollToSection('hero')} type="button">
          <span className={styles.brandCn}>夜阑</span>
          <span className={styles.brandEn}>YELAN</span>
        </button>

        <div className={styles.navLinks}>
          {NAV_LINKS.map((link) => (
            <button key={link.target} onClick={() => handleNavClick(link.target)} type="button">
              {link.label}
            </button>
          ))}
        </div>

        <button className={styles.navStart} onClick={goIntro} type="button">
          开始
        </button>

        <button
          aria-label={menuOpen ? '关闭导航' : '打开导航'}
          className={styles.menuToggle}
          onClick={() => setMenuOpen(true)}
          type="button"
        >
          <span />
          <span />
        </button>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            animate={{ opacity: 1 }}
            className={styles.mobileMenu}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <button aria-label="关闭导航" className={styles.menuClose} onClick={() => setMenuOpen(false)} type="button">
              ×
            </button>
            <div className={styles.mobileMenuInner}>
              {NAV_LINKS.map((link) => (
                <button key={link.target} onClick={() => handleNavClick(link.target)} type="button">
                  {link.label}
                </button>
              ))}
              <button className={styles.mobileStart} onClick={goIntro} type="button">
                开始
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={styles.main}>
        <section className={styles.hero} data-section="hero">
          <div className={styles.sky} aria-hidden="true">
            <span className={`${styles.star} ${styles.starOne}`} />
            <span className={`${styles.star} ${styles.starTwo}`} />
            <span className={`${styles.star} ${styles.starThree}`} />
            <span className={`${styles.star} ${styles.starFour}`} />
            <span className={`${styles.star} ${styles.starFive}`} />
            <span className={styles.orbit} />
            <span className={styles.candle} />
            <motion.span
              animate={{ opacity: [0.2, 0.45, 0.2], scale: [1, 1.05, 1] }}
              className={styles.motionGlow}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          <div className={styles.heroContent}>
            <motion.div
              className={styles.heroStack}
              initial="hidden"
              variants={staggerContainer}
              viewport={{ once: true }}
              whileInView="visible"
            >
              <motion.p className={styles.kicker} variants={fadeUp}>YELAN</motion.p>
              <motion.h1 variants={fadeUp}>夜阑</motion.h1>
              <motion.p className={styles.heroCopy} variants={fadeUp}>
                夜深了。
                <br className={styles.mobileOnly} />
                这里有一段等着你的对白。
              </motion.p>
              <motion.div className={styles.heroActions} variants={fadeUp}>
                <button className={styles.primaryAction} onClick={goIntro} type="button">
                  开始体验
                </button>
                <button className={styles.secondaryAction} onClick={() => scrollToSection('intro')} type="button">
                  了解夜阑
                  <span aria-hidden="true">›</span>
                </button>
              </motion.div>
            </motion.div>
          </div>

          <motion.button
            animate={{ opacity: 1 }}
            className={styles.scrollCue}
            initial={{ opacity: 0 }}
            onClick={() => scrollToSection('intro')}
            transition={{ delay: 1.5, duration: 1 }}
            type="button"
          >
            <span>Scroll</span>
            <i>
              <motion.em
                animate={{ y: ['-100%', '100%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </i>
          </motion.button>
        </section>

        <section className={styles.introSection} data-section="intro">
          <div className={styles.sectionInner}>
            <motion.div
              className={styles.introHeader}
              initial="hidden"
              variants={fadeUp}
              viewport={{ once: true, margin: '-100px' }}
              whileInView="visible"
            >
              <div className={styles.sectionHeader}>
                <span />
                <p>产品介绍</p>
              </div>
              <h2>
                慢慢来，这片土地没有束缚。
              </h2>
              <p className={styles.lead}>
                当你不想被评价、不想解释太多、不想把情绪整理成漂亮句子时，你可以在这里慢慢说。
              </p>
            </motion.div>

            <div className={styles.featureGrid}>
              {FEATURES.map((feature, index) => (
                <motion.article
                  className={styles.feature}
                  initial="hidden"
                  key={feature.number}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0, transition: { delay: index * 0.2, duration: 0.8 } },
                  }}
                  viewport={{ once: true, margin: '-50px' }}
                  whileInView="visible"
                >
                  <p>NUMBER_{feature.number}</p>
                  <h3>{feature.title}</h3>
                  <span>{feature.description}</span>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.philosophy} data-section="philosophy">
          <motion.div
            animate={{ opacity: [0.03, 0.08, 0.03] }}
            className={styles.philosophyGlow}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className={styles.philosophyBody}>
            <motion.div
              initial="hidden"
              variants={staggerContainer}
              viewport={{ once: true, margin: '-100px' }}
              whileInView="visible"
            >
              <motion.p variants={fadeUp}>—— 设计理念 ——</motion.p>
              <div className={styles.philosophyLines}>
                <motion.p variants={fadeUp}>克制，比热闹重要。</motion.p>
                <motion.p variants={fadeUp}>
                  陪伴不是立刻给建议，
                  <br className={styles.mobileOnly} />
                  好的对话应该给人留白。
                </motion.p>
                <motion.p variants={fadeUp}>
                  夜阑不试图替代现实关系，
                  <br className={styles.mobileOnly} />
                  而是在深夜提供一个能说话的地方。
                </motion.p>
              </div>
              <motion.span variants={fadeUp}>
                我们在深夜说话时，往往不需要一个立刻给出结论的系统。
                <br />
                <strong>我们需要一束不刺眼的光。</strong>
              </motion.span>
            </motion.div>
          </div>
        </section>

        <section className={styles.about} data-section="about">
          <motion.div
            className={styles.timeline}
            initial="hidden"
            variants={fadeUp}
            viewport={{ once: true, margin: '-100px' }}
            whileInView="visible"
          >
            <div className={styles.sectionHeader}>
              <span />
              <p>关于我们</p>
            </div>

            <article className={styles.aboutRow}>
              <h2>为什么做夜阑</h2>
              <p>
                很多人并不是没有话说，而是没有一个适合说话的地方。白天的世界太快，
                深夜的情绪又太诚实。我们想做一个更慢、更安静、更有边界感的对话空间。
              </p>
            </article>

            <article className={styles.aboutRow}>
              <h2>我们不做什么</h2>
              <ul>
                <li>不制造焦虑，不要求你每一步都做对。</li>
                <li>不假装懂你的一切，保持应有的克制与距离。</li>
                <li>不用热闹掩盖空洞，没有弹窗、没有签到打卡。</li>
                <li>不把每次对话都变成需要解决的“任务”。</li>
              </ul>
            </article>
          </motion.div>
        </section>

        <section className={styles.feedback} data-section="feedback">
          <div className={styles.feedbackInner}>
            <motion.div
              className={styles.feedbackCopy}
              initial="hidden"
              variants={fadeUp}
              viewport={{ once: true, margin: '-100px' }}
              whileInView="visible"
            >
              <h2>反馈中心</h2>
              <p>告诉我们哪一句话照亮过你，哪一处又让你出戏。</p>
            </motion.div>

            <motion.form
              className={styles.feedbackForm}
              initial="hidden"
              onSubmit={handleFeedback}
              variants={fadeUp}
              viewport={{ once: true, margin: '-100px' }}
              whileInView="visible"
            >
              <div>
                <label htmlFor="landing-name">你的称呼</label>
                <input id="landing-name" placeholder="客" type="text" />
              </div>
              <div>
                <label htmlFor="landing-feedback">想告诉我们的事</label>
                <textarea id="landing-feedback" placeholder="在这里写下..." rows={4} />
              </div>
              <button type="submit">递交信笺</button>
            </motion.form>
          </div>
        </section>

        <section className={styles.roadmap} data-section="roadmap">
          <motion.div
            className={styles.roadmapContent}
            initial="hidden"
            variants={fadeUp}
            viewport={{ once: true, margin: '-100px' }}
            whileInView="visible"
          >
            <div className={styles.roadmapHeader}>
              <h2>开发组 2 计划</h2>
              <span />
              <p>未来，我们将走向哪里</p>
            </div>

            <div className={styles.roadmapList}>
              {ROADMAP.map((item, index) => (
                <motion.article
                  className={styles.roadmapItem}
                  initial={{ opacity: 0, x: -10 }}
                  key={item.title}
                  transition={{ delay: index * 0.15, duration: 0.8 }}
                  viewport={{ once: true, margin: '-50px' }}
                  whileInView={{ opacity: 1, x: 0 }}
                >
                  <p>Point.0{index + 1}</p>
                  <h3>{item.title}</h3>
                  <span>{item.description}</span>
                </motion.article>
              ))}
            </div>
          </motion.div>
        </section>
      </main>

      <footer className={styles.footer} data-footer="footer">
        <button className={styles.footerBrand} onClick={() => scrollToSection('hero')} type="button">
          <span>夜阑</span>
          <i>YELAN</i>
        </button>
        <p>夜未央，对白未完。</p>
        <div>
          <button onClick={() => scrollToSection('about')} type="button">关于我们</button>
          <button onClick={() => scrollToSection('feedback')} type="button">反馈</button>
          <button onClick={goIntro} type="button">开始对话</button>
        </div>
      </footer>
    </div>
  );
}

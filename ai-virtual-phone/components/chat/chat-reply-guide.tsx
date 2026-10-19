"use client";

import { useId, useLayoutEffect, useState, type RefObject } from "react";
import { kvGet, kvSet } from "@/lib/kv-db";

type GuideBounds = { width: number; height: number; x: number; y: number; size: number };

export function ChatReplyGuide({ sessionId, enabled, targetRef, containerRef }: {
    sessionId: string;
    enabled: boolean;
    targetRef: RefObject<HTMLButtonElement | null>;
    containerRef: RefObject<HTMLElement | null>;
}) {
    const hintId = useId();
    const [dismissedSession, setDismissedSession] = useState<string | null>(null);
    const [bounds, setBounds] = useState<GuideBounds | null>(null);
    const storageKey = `chat-reply-guide-seen:${sessionId}`;
    const visible = enabled && dismissedSession !== sessionId && kvGet(storageKey) !== "1";

    useLayoutEffect(() => {
        if (!visible) {
            setBounds(null);
            return;
        }
        const target = targetRef.current;
        const container = containerRef.current;
        if (!target || !container) return;

        const measure = () => {
            const outer = container.getBoundingClientRect();
            const button = target.getBoundingClientRect();
            if (!outer.width || !outer.height || !button.width || !button.height) {
                setBounds(null);
                return;
            }
            // 手机外壳可能整体缩放，定位须换算为聊天容器的 CSS 像素。
            const scaleX = container.clientWidth / outer.width;
            const scaleY = container.clientHeight / outer.height;
            const size = Math.max(44, button.width * scaleX + 20, button.height * scaleY + 20);
            setBounds({ width: container.clientWidth, height: container.clientHeight, size,
                x: (button.left + button.width / 2 - outer.left) * scaleX - size / 2,
                y: (button.top + button.height / 2 - outer.top) * scaleY - size / 2 });
        };
        const dismiss = () => {
            kvSet(storageKey, "1");
            setDismissedSession(sessionId);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && container.getBoundingClientRect().width > 0) dismiss();
        };
        target.addEventListener("click", dismiss);
        target.setAttribute("aria-describedby", hintId);
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(target);
        window.addEventListener("resize", measure);
        window.visualViewport?.addEventListener("resize", measure);
        document.addEventListener("keydown", onKeyDown);
        measure();
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
            window.visualViewport?.removeEventListener("resize", measure);
            document.removeEventListener("keydown", onKeyDown);
            target.removeEventListener("click", dismiss);
            target.removeAttribute("aria-describedby");
        };
    }, [visible, sessionId, storageKey, targetRef, containerRef, hintId]);

    if (!visible || !bounds) return null;
    const { width, height, x, y, size } = bounds;
    const radius = size / 2;
    // 镂空区域不拦截事件，点击的仍是原来的星星按钮。
    const mask = `M0 0H${width}V${height}H0Z M${x} ${y + radius}a${radius} ${radius} 0 1 0 ${size} 0a${radius} ${radius} 0 1 0 ${-size} 0Z`;
    return (
        <div className="chat-reply-guide">
            <svg className="chat-reply-guide-mask" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                <path d={mask} fillRule="evenodd" onClick={() => {
                    kvSet(storageKey, "1");
                    setDismissedSession(sessionId);
                }} />
            </svg>
            <div className="chat-reply-guide-spotlight" style={{ left: x, top: y, width: size, height: size }} />
            <div id={hintId} className="chat-reply-guide-hint" role="tooltip" aria-live="polite"
                style={{ right: Math.max(12, width - x - size), bottom: height - y + 18 }}>
                点击✨触发回复
            </div>
        </div>
    );
}

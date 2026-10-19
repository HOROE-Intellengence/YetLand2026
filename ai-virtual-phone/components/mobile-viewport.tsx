"use client";

import { useEffect } from "react";

// Resize the managed phone while a software keyboard covers the visual viewport.
// The existing Android caret translation must not also move this resized shell.
export function MobileViewport() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.yelanManaged !== "true") return;
    const viewport = window.visualViewport;
    const media = window.matchMedia("(max-width: 650px)");
    let frame = 0;
    const reset = () => {
      root.style.removeProperty("--phone-visible-height");
      delete root.dataset.mobileKeyboardOpen;
    };
    const update = () => {
      frame = 0;
      const focused = document.activeElement;
      const editable = focused instanceof HTMLElement &&
        (focused.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="file"]), textarea') || focused.isContentEditable);
      if (!media.matches || !viewport || !editable || Math.abs(viewport.scale - 1) > 0.05 || window.innerHeight - viewport.height < 120) {
        reset();
        return;
      }
      root.style.setProperty("--phone-visible-height", `${Math.round(viewport.height)}px`);
      root.dataset.mobileKeyboardOpen = "true";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    viewport?.addEventListener("resize", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    media.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      media.removeEventListener("change", schedule);
      reset();
    };
  }, []);
  return null;
}

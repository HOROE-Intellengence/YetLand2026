"use client";

import { ArrowLeft, Construction } from "lucide-react";

export function DevelopmentNotice({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <section aria-label={title} style={{ height: "100%", display: "flex", flexDirection: "column", padding: 24, background: "#f6f7f2", color: "#24382e" }}>
      <button type="button" onClick={onClose} aria-label="返回桌面" style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start", border: 0, background: "transparent", color: "inherit", padding: "8px 0", cursor: "pointer" }}>
        <ArrowLeft size={20} aria-hidden="true" />返回桌面
      </button>
      <div role="status" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", paddingBottom: 48 }}>
        <Construction size={48} strokeWidth={1.5} aria-hidden="true" style={{ color: "#687e62" }} />
        <h1 style={{ margin: 0, fontSize: 21 }}>{title}</h1>
        <p style={{ margin: 0, color: "#68766c", fontSize: 15 }}>开发中，敬请期待</p>
      </div>
    </section>
  );
}

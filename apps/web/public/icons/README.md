# PWA 图标（占位）

这些是**占位**图标，由脚本生成（深色底 + 金色月牙，呼应「夜」主题）：

```
node apps/web/scripts/gen-pwa-icons.mjs
```

换正式品牌图标时，直接覆盖同名文件即可（manifest 与 index.html 的路径不变）：

- `icon-192.png` / `icon-512.png` —— `purpose: any`
- `icon-maskable-512.png` —— `purpose: maskable`（内容收在中心安全区内）
- `../apple-touch-icon.png` —— iOS「添加到主屏」图标（180×180）

// 生成 PWA 占位图标 —— 移动端适配长期方案 Phase 1
//
// 纯 Node 内置模块（zlib）手写 PNG 编码，零外部依赖。
// 设计：深色底 #0a0a0f + 金色月牙（呼应「夜阑 / 夜」主题），抗锯齿软边。
// 这是【占位】素材，后续换正式品牌图标时直接覆盖同名文件即可（manifest/html 路径不变）。
//
// 用法：node apps/web/scripts/gen-pwa-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public');
const ICON_DIR = resolve(OUT_DIR, 'icons');

const BG = [0x0a, 0x0a, 0x0f]; // --bg
const GOLD = [0xc8, 0xa8, 0x78]; // --gold-light

// ---- PNG 编码（RGBA / color type 6 / 8-bit）----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = 0 (compression / filter / interlace)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    rgba.copy(raw, p, y * width * 4, (y + 1) * width * 4);
    p += width * 4;
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 1px 抗锯齿圆覆盖：d<=r-0.5 → 1，d>=r+0.5 → 0，中间线性
function coverCircle(d, r) {
  return Math.max(0, Math.min(1, r + 0.5 - d));
}

// 生成月牙图标。crescentScale 控制月牙占比（普通 0.30，maskable 收进安全区 0.22）
function makeIcon(size, crescentScale) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size * 0.47;
  const cy = size * 0.5;
  const rOut = size * crescentScale;
  // 裁切圆向右上偏移，挖出月牙开口
  const cutCx = cx + rOut * 0.42;
  const cutCy = cy - rOut * 0.30;
  const rCut = rOut * 0.92;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dOut = Math.hypot(px - cx, py - cy);
      const dCut = Math.hypot(px - cutCx, py - cutCy);
      const aOut = coverCircle(dOut, rOut);
      const aCut = coverCircle(dCut, rCut);
      const aGold = aOut * (1 - aCut);
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] * (1 - aGold) + GOLD[0] * aGold);
      rgba[i + 1] = Math.round(BG[1] * (1 - aGold) + GOLD[1] * aGold);
      rgba[i + 2] = Math.round(BG[2] * (1 - aGold) + GOLD[2] * aGold);
      rgba[i + 3] = 255; // 全不透明：full-bleed，maskable 也安全
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(ICON_DIR, { recursive: true });

const targets = [
  [resolve(ICON_DIR, 'icon-192.png'), 192, 0.3],
  [resolve(ICON_DIR, 'icon-512.png'), 512, 0.3],
  [resolve(ICON_DIR, 'icon-maskable-512.png'), 512, 0.22],
  [resolve(OUT_DIR, 'apple-touch-icon.png'), 180, 0.3],
];

for (const [path, size, scale] of targets) {
  writeFileSync(path, makeIcon(size, scale));
  console.log(`wrote ${path} (${size}x${size})`);
}

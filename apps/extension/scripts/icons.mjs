// Sinh icon PNG (16/32/48/128) cho extension, không cần thư viện ngoài.
// Hình: nền bo góc xanh, chiếc khiên trắng với bong bóng chat bên trong.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const out = resolve(import.meta.dirname, '../public/icons');
mkdirSync(out, { recursive: true });

const BG = [47, 91, 211];
const FG = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Các hình trong hệ tọa độ 0..1
const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inShield = (x, y) => {
  const top = 0.17;
  const mid = 0.5;
  const bottom = 0.86;
  if (y < top || y > bottom) return false;
  const halfW = y <= mid ? 0.31 : 0.31 * Math.sqrt(1 - ((y - mid) / (bottom - mid)) ** 2);
  return Math.abs(x - 0.5) <= halfW;
};
const inBubble = (x, y) => {
  // bong bóng chat: hình elip + đuôi nhỏ
  const e = ((x - 0.5) / 0.17) ** 2 + ((y - 0.46) / 0.12) ** 2 <= 1;
  const tail = y > 0.52 && y < 0.62 && x > 0.4 && x < 0.47 && x - 0.4 < (0.62 - y) * 0.9;
  return e || tail;
};

function shade(x, y) {
  if (!inRoundRect(x, y, 0.22)) return null;
  if (inShield(x, y)) return inBubble(x, y) ? BG : FG;
  return BG;
}

for (const size of [16, 32, 48, 128]) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  writeFileSync(resolve(out, `icon-${size}.png`), png(size, buf));
}
console.log('Đã tạo icon trong', out);

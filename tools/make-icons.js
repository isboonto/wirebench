// Generates the app icons (PNG + ICO) without any dependencies: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = path.join(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Signed-distance helpers in a 0..1 coordinate space
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => { const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
function sdBezier(x, y, p0, p1, p2, p3) {
  let best = Infinity;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, u = 1 - t;
    const bx = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const by = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    best = Math.min(best, Math.hypot(x - bx, y - by));
  }
  return best;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
      let col = null;
      if (sdRoundRect(x, y, 0.5, 0.5, 0.47, 0.47, 0.2) < 0) col = [27, 34, 44];
      if (col && sdRoundRect(x, y, 0.5, 0.52, 0.34, 0.26, 0.07) < 0 && sdRoundRect(x, y, 0.5, 0.52, 0.30, 0.22, 0.05) > 0) col = [53, 185, 168];
      for (const [cx, cy] of [[0.33, 0.43], [0.5, 0.43], [0.67, 0.61]]) if (col && sdCircle(x, y, cx, cy, 0.045) < 0) col = [53, 185, 168];
      if (col && sdBezier(x, y, [0.33, 0.43], [0.4, 0.75], [0.6, 0.75], [0.67, 0.61]) < 0.035) col = [255, 176, 32];
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = ss * ss, i = (py * size + px) * 4;
    const al = a / n;
    buf[i] = al ? r / (a / 255) : 0; buf[i + 1] = al ? g / (a / 255) : 0; buf[i + 2] = al ? b / (a / 255) : 0; buf[i + 3] = al;
  }
  return png(size, buf);
}

const sizes = { '32x32.png': 32, '128x128.png': 128, 'icon.png': 512 };
for (const [name, s] of Object.entries(sizes)) fs.writeFileSync(path.join(out, name), render(s));

// ICO containing PNG images (16, 32, 48, 256)
const icoSizes = [16, 32, 48, 256];
const imgs = icoSizes.map(render);
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
const dir = Buffer.alloc(16 * imgs.length);
let offset = 6 + dir.length;
imgs.forEach((img, i) => {
  const s = icoSizes[i];
  dir[i * 16] = s >= 256 ? 0 : s; dir[i * 16 + 1] = s >= 256 ? 0 : s;
  dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6);
  dir.writeUInt32LE(img.length, i * 16 + 8); dir.writeUInt32LE(offset, i * 16 + 12);
  offset += img.length;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, dir, ...imgs]));
console.log('Icons written to', out);

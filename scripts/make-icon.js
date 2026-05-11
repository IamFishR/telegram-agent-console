// Generate media/icon-128.png from primitives. Pure-Node, no npm deps.
// Placeholder marketplace icon: Telegram-blue rounded square with a
// white right-pointing triangle ("send" glyph).
// Re-run with: node scripts/make-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 128;
const H = 128;
const CORNER_RADIUS = 18;
const BG = { r: 0x00, g: 0x88, b: 0xCC };
const FG = { r: 0xFF, g: 0xFF, b: 0xFF };

// Stylized paper plane: two triangles forming a "swept" send arrow.
const PLANE = [
  // primary body
  [[28, 32], [104, 64], [28, 96]],
  // fold crease (a little inner triangle removed-feel via overdraw of bg later? simpler: skip)
];

const stride = W * 4 + 1; // 1 filter byte per row + RGBA
const raw = Buffer.alloc(H * stride);

function insideRounded(x, y) {
  const r = CORNER_RADIUS;
  // top-left
  if (x < r && y < r) {
    const dx = r - x;
    const dy = r - y;
    return dx * dx + dy * dy <= r * r;
  }
  // top-right
  if (x >= W - r && y < r) {
    const dx = x - (W - r);
    const dy = r - y;
    return dx * dx + dy * dy <= r * r;
  }
  // bottom-left
  if (x < r && y >= H - r) {
    const dx = r - x;
    const dy = y - (H - r);
    return dx * dx + dy * dy <= r * r;
  }
  // bottom-right
  if (x >= W - r && y >= H - r) {
    const dx = x - (W - r);
    const dy = y - (H - r);
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function inTriangle(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function setPx(x, y, r, g, b, a) {
  const i = y * stride + 1 + x * 4;
  raw[i] = r;
  raw[i + 1] = g;
  raw[i + 2] = b;
  raw[i + 3] = a;
}

for (let y = 0; y < H; y++) {
  raw[y * stride] = 0; // filter type: None
  for (let x = 0; x < W; x++) {
    if (!insideRounded(x, y)) {
      setPx(x, y, 0, 0, 0, 0); // transparent outside rounded mask
      continue;
    }
    let isFg = false;
    for (const tri of PLANE) {
      if (inTriangle(x + 0.5, y + 0.5, tri[0], tri[1], tri[2])) {
        isFg = true;
        break;
      }
    }
    if (isFg) {
      setPx(x, y, FG.r, FG.g, FG.b, 0xFF);
    } else {
      setPx(x, y, BG.r, BG.g, BG.b, 0xFF);
    }
  }
}

// --- PNG encoding ---
const crcTable = (function () {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([len, typeBuf, body, crcBuf]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace
const idat = zlib.deflateSync(raw);

const png = Buffer.concat([
  signature,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', idat),
  makeChunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'media');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon-128.png');
fs.writeFileSync(outPath, png);
console.log('Wrote ' + outPath + ' (' + png.length + ' bytes)');

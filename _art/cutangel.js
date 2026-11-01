// 天使奶娃（200×200 纯白底）→ 透明 WebP。
// 翅膀本身是白色的，所以必须从边缘 flood fill 只清「和画面边界连通的纯白」，
// 否则一刀切会把翅膀一起削掉。
const fs = require('fs');
const W = 200, H = 200, SCALE = 3.2, T = 234, CHROMA = 14;

const buf = Buffer.from(fs.readFileSync('_art/angel.rgba'));

// 1) 从四边 flood fill 抠白
const seen = new Uint8Array(W * H), st = [];
for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
let cleared = 0;
while (st.length) {
  const p = st.pop(); if (seen[p]) continue; seen[p] = 1;
  const o = p * 4, r = buf[o], g = buf[o + 1], b = buf[o + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  if (!(mn >= T && mx - mn <= CHROMA)) continue;
  buf[o + 3] = 0; cleared++;
  const x = p % W, y = (p - x) / W;
  if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1);
  if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
}
console.log('cleared', cleared, '/', W * H, '=', (cleared / (W * H) * 100).toFixed(1) + '%');

// 2) 边缘羽化 + 反白混合。
//    原图是白底拍的，边缘像素 P 实际是「前景色 F 和白底」按 alpha 混出来的，
//    直接把 P 当实心色用，轮廓上就会挂一圈浅白边。这里把边缘色往邻域实心色拉。
const copy = Buffer.from(buf);
const edge = [];
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const p = y * W + x, o = p * 4;
  if (copy[o + 3] === 0) continue;
  if (copy[(p - 1) * 4 + 3] === 0 || copy[(p + 1) * 4 + 3] === 0 ||
      copy[(p - W) * 4 + 3] === 0 || copy[(p + W) * 4 + 3] === 0) { buf[o + 3] = 168; edge.push(p); }
}
for (const p of edge) {
  const o = p * 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = (p % W) + dx, ny = ((p - (p % W)) / W) + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const q = (ny * W + nx) * 4;
    if (copy[q + 3] < 250) continue;
    r += copy[q]; g += copy[q + 1]; b += copy[q + 2]; n++;
  }
  if (!n) continue;
  buf[o]     = copy[o]     * 0.35 + (r / n) * 0.65;
  buf[o + 1] = copy[o + 1] * 0.35 + (g / n) * 0.65;
  buf[o + 2] = copy[o + 2] * 0.35 + (b / n) * 0.65;
}
// 3) 颜色外扩，避免放大/缩放时白边渗出
for (let it = 0; it < 16; it++) {
  const snap = Buffer.from(buf);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const o = (y * W + x) * 4;
    if (snap[o + 3] !== 0) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (const q of [o - 4, o + 4, o - W * 4, o + W * 4]) {
      if (snap[q + 3] > 40) { r += snap[q]; g += snap[q + 1]; b += snap[q + 2]; n++; }
    }
    if (n) { buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n; }
  }
}

// 4) 放大到 640（premultiplied 双线性，避免透明边缘发黑）
const OW = Math.round(W * SCALE), OH = Math.round(H * SCALE);
const pm = new Float32Array(W * H * 4);
for (let p = 0; p < W * H; p++) {
  const a = buf[p * 4 + 3] / 255;
  pm[p * 4] = buf[p * 4] * a; pm[p * 4 + 1] = buf[p * 4 + 1] * a; pm[p * 4 + 2] = buf[p * 4 + 2] * a; pm[p * 4 + 3] = a;
}
const big = new Float32Array(OW * OH * 4);
for (let y = 0; y < OH; y++) {
  const sy = Math.min(H - 1, Math.max(0, (y + 0.5) / SCALE - 0.5));
  const y0 = Math.floor(sy), y1 = Math.min(H - 1, y0 + 1), fy = sy - y0;
  for (let x = 0; x < OW; x++) {
    const sx = Math.min(W - 1, Math.max(0, (x + 0.5) / SCALE - 0.5));
    const x0 = Math.floor(sx), x1 = Math.min(W - 1, x0 + 1), fx = sx - x0;
    const o = (y * OW + x) * 4;
    for (let c = 0; c < 4; c++) {
      const a = pm[(y0 * W + x0) * 4 + c], b = pm[(y0 * W + x1) * 4 + c];
      const cc = pm[(y1 * W + x0) * 4 + c], d = pm[(y1 * W + x1) * 4 + c];
      big[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
    }
  }
}
// 5) 轻锐化（只在 alpha>0 的地方），补一点放大丢掉的轮廓
let sharp = Float32Array.from(big);
for (let y = 1; y < OH - 1; y++) for (let x = 1; x < OW - 1; x++) {
  const o = (y * OW + x) * 4;
  if (big[o + 3] <= 0.02) continue;
  for (let c = 0; c < 3; c++) {
    const center = big[o + c];
    const avg = (big[o - 4 + c] + big[o + 4 + c] + big[o - OW * 4 + c] + big[o + OW * 4 + c]) / 4;
    sharp[o + c] = center + (center - avg) * 0.18;
  }
}
// 6) 收边：3x3 高斯一遍，把放大带来的锯齿和硬边抹平（深色底上尤其明显）
{
  const src = sharp, out2 = Float32Array.from(src);
  for (let y = 1; y < OH - 1; y++) for (let x = 1; x < OW - 1; x++) {
    const o = (y * OW + x) * 4;
    for (let c = 0; c < 4; c++) {
      out2[o + c] = (src[o - 4 + c] + src[o + 4 + c] + src[o - OW * 4 + c] + src[o + OW * 4 + c] + src[o + c] * 4) / 8;
    }
  }
  sharp = out2;
}

const out = Buffer.alloc(OW * OH * 4);
for (let p = 0; p < OW * OH; p++) {
  const a = Math.min(1, Math.max(0, sharp[p * 4 + 3])), o = p * 4;
  out[o] = Math.min(255, Math.max(0, sharp[o] / (a || 1)));
  out[o + 1] = Math.min(255, Math.max(0, sharp[o + 1] / (a || 1)));
  out[o + 2] = Math.min(255, Math.max(0, sharp[o + 2] / (a || 1)));
  out[o + 3] = Math.round(a * 255);
}
fs.writeFileSync('_art/angel.rgba.out', out);

// 预览：叠在深灰底上，方便肉眼判断抠图质量
const bg = Buffer.alloc(OW * OH * 3, 0);
for (let p = 0; p < OW * OH; p++) {
  const a = out[p * 4 + 3] / 255;
  for (let c = 0; c < 3; c++) bg[p * 3 + c] = Math.round(out[p * 4 + c] * a + [20, 22, 28][c] * (1 - a));
}
fs.writeFileSync('_art/angel_preview.rgb', bg);
console.log('out', OW + 'x' + OH);

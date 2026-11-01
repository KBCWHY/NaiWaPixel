// 把两张奶娃图的白/浅灰背景抠掉，输出透明 WebP + 头像裁切
const fs = require('fs');
const { execFileSync } = require('child_process');
const FF = 'D:/Program Files (x86)/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';

function writeWebp(buf, w, h, out) {
  const raw = out + '.rgba';
  fs.writeFileSync(raw, buf);
  execFileSync(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw,
    '-c:v', 'libwebp', '-lossless', '0', '-q:v', '92', '-compression_level', '6', out], { stdio: 'ignore' });
  fs.unlinkSync(raw);
  console.log(out, (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
}

function cutout(src, w, h, out, bgTest) {
  const buf = fs.readFileSync(src);
  const N = w * h;
  const seen = new Uint8Array(N);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const o = p * 4;
    const r = buf[o], g = buf[o + 1], b = buf[o + 2];
    if (!bgTest(r, g, b)) continue;
    buf[o + 3] = 0; cleared++;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // 边缘羽化
  const copy = Buffer.from(buf);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, o = p * 4;
      if (copy[o + 3] === 0) continue;
      if (copy[(p - 1) * 4 + 3] === 0 || copy[(p + 1) * 4 + 3] === 0 ||
          copy[(p - w) * 4 + 3] === 0 || copy[(p + w) * 4 + 3] === 0) buf[o + 3] = 150;
    }
  }
  console.log(out, 'cleared', cleared, '/', N);
  return { buf, w, h };
}

// 奶娃头顶被原图切掉约 12px：用椭圆拟合把头补齐，避免头像出现平顶
function padDome(buf, w, h, pad) {
  const out = Buffer.alloc(w * (h + pad) * 4);
  out.fill(0);
  buf.copy(out, w * pad * 4);                       // 原图下移
  const cx = 385.5, a = 115.7, R = 126.4;           // 由轮廓拟合
  for (let y = 0; y < pad; y++) {
    const yy = y - pad;                              // 负数：图像上方
    const dy = a - yy;
    if (Math.abs(dy) >= R) continue;
    const hw = Math.sqrt(R * R - dy * dy);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      if (x < 0 || x >= w) continue;
      const sx = Math.max(335, Math.min(436, x));    // 取原图顶行的颜色
      const s = sx * 4, d = ((y * w) + x) * 4;
      out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2];
      out[d + 3] = 255;
    }
  }
  return { buf: out, w, h: h + pad };
}

function cropTo(buf, w, h, x0, y0, cw, ch, out) {
  const o = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = ((y + y0) * w + (x + x0)) * 4, d = (y * cw + x) * 4;
      o[d] = buf[s]; o[d + 1] = buf[s + 1]; o[d + 2] = buf[s + 2]; o[d + 3] = buf[s + 3];
    }
  }
  return o;
}

// 脚底淡淡的投影会残留在两脚之间，底部区域按“浅+低饱和”直接清掉
function cleanBottom(buf, w, h, from) {
  let n = 0;
  for (let y = Math.floor(h * from); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (buf[o + 3] === 0) continue;
      const r = buf[o], g = buf[o + 1], b = buf[o + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b), mn = Math.min(r, g, b);
      if (buf[o + 3] < 250 || mn >= 140 && sat <= 48 || (mn >= 182 && sat <= 75)) { buf[o + 3] = 0; n++; }
    }
  }
  console.log('bottom cleaned', n);
}

// 透明像素保留白色 RGB 会在缩小时渗出白边：把边缘颜色向外扩散几像素
function bleedColor(buf, w, h, iters) {
  for (let it = 0; it < iters; it++) {
    const snap = Buffer.from(buf);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const o = (y * w + x) * 4;
        if (snap[o + 3] !== 0) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const q of [o - 4, o + 4, o - w * 4, o + w * 4]) {
          if (snap[q + 3] > 40) { r += snap[q]; g += snap[q + 1]; b += snap[q + 2]; n++; }
        }
        if (n) { buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n; }
      }
    }
  }
}

// 1) 奶娃（含头顶补齐）
let baby = cutout('_art/baby.rgba', 787, 1080, '', (r, g, b) => Math.min(r, g, b) >= 195 && Math.max(r, g, b) - Math.min(r, g, b) <= 18);
bleedColor(baby.buf, 787, 1080, 14);
baby = padDome(baby.buf, 787, 1080, 16);
writeWebp(baby.buf, baby.w, baby.h, '_art/baby.webp');
writeWebp(cropTo(baby.buf, baby.w, baby.h, 245, 24, 300, 300), 300, 300, '_art/face.webp');

// 2) 大笑（连地面淡阴影一起去掉）
let laugh = cutout('_art/laugh.rgba', 380, 830, '', (r, g, b) => Math.min(r, g, b) >= 185 && Math.max(r, g, b) - Math.min(r, g, b) <= 32);
cleanBottom(laugh.buf, laugh.w, laugh.h, 0.75);
bleedColor(laugh.buf, laugh.w, laugh.h, 14);
writeWebp(laugh.buf, laugh.w, laugh.h, '_art/laugh.webp');


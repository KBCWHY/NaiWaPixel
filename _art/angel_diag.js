const fs = require('fs');
const W = 200, H = 200;
const b = fs.readFileSync('_art/angel.rgba');
const isWhite = p => {
  const o = p * 4, r = b[o], g = b[o + 1], bl = b[o + 2];
  const mn = Math.min(r, g, bl), mx = Math.max(r, g, bl);
  return mn >= 246 && mx - mn <= 12;
};
const seen = new Uint8Array(W * H);
const doms = [];
for (let p0 = 0; p0 < W * H; p0++) {
  if (seen[p0] || !isWhite(p0)) continue;
  const q = [p0]; seen[p0] = 1;
  let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, touchSolid = 0;
  while (q.length) {
    const p = q.pop(); n++;
    const x = p % W, y = (p - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { touchSolid = 1; continue; }  // 触到画面边缘
      const np = ny * W + nx;
      if (!isWhite(np)) touchSolid = 1;                                          // 紧贴非白
      else if (!seen[np]) { seen[np] = 1; q.push(np); }
    }
  }
  doms.push({ n, box: [x0, y0, x1, y1], touchSolid });
}
doms.sort((a, b) => b.n - a.n);
console.log('白色连通域数', doms.length);
for (const d of doms.slice(0, 8)) console.log('  面积', d.n, '包围盒', d.box.join(','), '贴边/贴主体', d.touchSolid);
console.log('面积>=200 且不贴主体/边界：', doms.filter(d => d.n >= 60 && !d.touchSolid).map(d => d.n + '@' + d.box.join(',')).join(' | ') || '无');

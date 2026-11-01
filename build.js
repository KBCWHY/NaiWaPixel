const fs = require('fs');
const crypto = require('crypto');

const read = (p, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');

const art = {
  __BABY_DATAURI__: read('_art/src.jpg', 'image/jpeg'),   // 分析用原图
  __BABY_ART__: read('_art/baby.webp', 'image/webp'),     // 透明抠图（开场大图 / 背景）
  __LAUGH_ART__: read('_art/laugh.webp', 'image/webp'),
  __FACE_ART__: read('_art/face.webp', 'image/webp'),
  __ANGEL_ART__: read('_art/angel.webp', 'image/webp'),   // 开场降临用的天使形态
  // 5 秒大笑音效（用户素材裁出来的那段），base64 内嵌，保证单文件拷走也有声
  __LAUGH_AUDIO__: read('audio/laugh.mp3', 'audio/mpeg'),
};

let html = fs.readFileSync('index_template.html', 'utf8');
for (const [k, v] of Object.entries(art)) html = html.split(k).join(v);

// CSP：把每个内联 <script> 的 sha256 写进白名单，只放行这一个确切的字节序列。
// 代码被改动哪怕一个字符，hash 就对不上，浏览器直接拒绝执行 —— 页面白屏，篡改当场暴露。
// 注意：HTML 解析器会先把 CRLF/CR 规范成 LF 再做 hash，这里必须同步做，否则会误判。
function inlineScriptHashes(doc) {
  const hashes = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(doc)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;      // 外链脚本由 host 白名单负责
    if (!m[2].trim()) continue;
    const normalized = m[2].replace(/\r\n?/g, '\n');
    const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('base64');
    hashes.push("'sha256-" + digest + "'");
  }
  return hashes;
}

const hashes = inlineScriptHashes(html);
const csp = [
  "default-src 'none'",
  'script-src ' + (hashes.length ? hashes.join(' ') : "'none'"),
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // 大笑音效：本地 audio/laugh.mp3（项目自带 5s 素材，已 base64 内嵌）。
  // file: 是给「双击打开 index.html」的场景用的 —— 那时 origin 是 null，'self' 匹配不到同目录文件。
  "media-src 'self' file: data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

html = html.replace('__CSP__', () => csp);
fs.writeFileSync('index.html', html, 'utf8');

// 自检：CSP 必须落到 head 里，且没有占位符残留
const headEnd = html.indexOf('</head>');
const cspAt = html.indexOf('Content-Security-Policy');

const left = ['__BABY_DATAURI__', '__BABY_ART__', '__LAUGH_ART__', '__FACE_ART__', '__ANGEL_ART__', '__LAUGH_AUDIO__', '__CSP__'].filter((k) =>
  html.includes(k),
);

if (cspAt < 0 || cspAt > headEnd) throw new Error('CSP 未进入 head');
if (left.length) throw new Error('占位符未替换: ' + left.join(', '));

console.log('OK  ' + (html.length / 1024).toFixed(0) + 'KB  脚本 hash: ' +
  hashes.map((h) => h.slice(8, 16)).join(' ') + '  （共 ' + hashes.length + ' 块）');

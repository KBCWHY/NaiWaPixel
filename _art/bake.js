// 用 headless 浏览器把 _art/src.jpg 缩到长边 512（页面里 MAX_OUT 就是 512），
// 再重编码回文件。原图 787×1096 在运行时要先缩到 368×512 才用，等于白白多背了 200KB。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 10200 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

const getJson = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try { const l = await getJson('/json/list'); const p = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await new Promise(r => setTimeout(r, 150));
  }
  const ws = new WebSocket(wsUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  await new Promise(r => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'file:///D:/dsh/%E5%BC%B9%E7%AA%97%E5%B9%BF%E5%91%8A/index.html' });
  await new Promise(r => setTimeout(r, 2500));

  const expr = `(async () => {
    const img = new Image(); img.src = BABY_DATAURI; await img.decode();
    const s = 512 / Math.max(img.width, img.height);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    return w + 'x' + h + ' ' + c.toDataURL('image/jpeg', 0.9);
  })()`;
  const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const val = out.result && out.result.result && out.result.result.value;
  if (!val) { console.log('FAIL ' + JSON.stringify(out.result)); process.exit(1); }
  const sp = val.indexOf(' ');
  const dim = val.slice(0, sp);
  const b64 = val.slice(val.indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync('_art/src.jpg', buf);
  console.log('baked ' + dim + '  ' + Math.round(buf.length / 1024) + 'KB');
  ws.close(); edge.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(0); }, 300);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });

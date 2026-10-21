/* 自包含预览版：把全部头像压成 webp dataURL 内嵌进 index.html，
   产出一个不依赖 assets/ 目录的单文件，任何预览环境 / file:// 都能看到头像。
   前置：python -m http.server 8123 与 chrome --headless=new --remote-debugging-port=9223 已在跑 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = 9223;
const PAGE = 'http://127.0.0.1:8123/index.html';
const OUT = path.join(ROOT, 'dist', 'standalone-preview.html');
const SIZE = 80;          // 内嵌头像边长（页面里显示 40px，2 倍正好）
const QUALITY = 0.85;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pend = new Map();
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    return {
      async send(method, params = {}) {
        const id = ++seq;
        const rx = new Promise(res => pend.set(id, res));
        ws.send(JSON.stringify({ id, method, params }));
        const r = await Promise.race([rx, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + method)), 120000))]);
        pend.delete(id);
        if (r.error) throw new Error(method + ': ' + JSON.stringify(r.error));
        return r.result;
      }
    };
  }
}
async function ev(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}

const CONVERT = `(async (idx) => {
  const out = {}; let fail = [];
  for (const nm of Object.keys(idx)) {
    try {
      const im = new Image();
      im.src = encodeURI(idx[nm]);
      await new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('load')); });
      const c = document.createElement('canvas');
      c.width = ${SIZE}; c.height = ${SIZE};
      c.getContext('2d').drawImage(im, 0, 0, ${SIZE}, ${SIZE});
      const u = c.toDataURL('image/webp', ${QUALITY});
      if (u && u.indexOf('data:image') === 0) out[nm] = u; else fail.push(nm);
    } catch (e) { fail.push(nm); }
  }
  return { out, fail };
})`;

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const idx = cfg.assets.avatarIndex;
  const names = Object.keys(idx);
  console.log('头像索引 ' + names.length + ' 条，开始压缩为 ' + SIZE + 'px webp…');

  let list = await getJSON('/json/list');
  let page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    page = await new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?about:blank', method: 'PUT' },
        r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); });
      req.on('error', rej); req.end();
    });
  }
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(1500);

  const inline = {}; const failed = [];
  const BATCH = 40;
  for (let i = 0; i < names.length; i += BATCH) {
    const part = {};
    for (const n of names.slice(i, i + BATCH)) part[n] = idx[n];
    const r = await ev(cdp, CONVERT + '(' + JSON.stringify(part) + ')');
    Object.assign(inline, r.out);
    failed.push(...(r.fail || []));
    console.log('  批次 ' + (i / BATCH + 1) + '：' + Object.keys(r.out).length + '/' + Object.keys(part).length +
      (r.fail && r.fail.length ? ' 失败 ' + r.fail.join(',') : ''));
  }
  if (failed.length) console.log('  未内嵌（会退回相对路径）：' + failed.join(', '));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const json = JSON.stringify(inline);
  if (json.indexOf('</script') >= 0) throw new Error('内嵌数据里出现了 </script，需额外转义');
  const tag = '<script>window.__AV_INLINE__=' + json + ';</script>\n';
  const at = html.indexOf('</head>');
  if (at < 0) throw new Error('index.html 里找不到 </head>');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html.slice(0, at) + tag + html.slice(at), 'utf8');

  const kb = n => (n / 1024).toFixed(1) + ' KB';
  console.log('内嵌头像 ' + Object.keys(inline).length + ' 个，' + kb(Buffer.byteLength(json)));
  console.log('已生成 ' + OUT + '（' + kb(fs.statSync(OUT).size) + '）');
  await cdp.send('Page.close').catch(() => { });
  process.exit(0);          // CDP 的 WebSocket 不关会让进程挂住
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

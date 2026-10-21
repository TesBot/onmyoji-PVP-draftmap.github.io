/* 定向排查：真实浏览器里点右键，看菜单到底有没有出现 / 抛了什么错
   无依赖 CDP，自己拉一个无头 Chrome（file:// 直开，不需要静态服务）
   用法：node src/probe_ctx.js [页面相对路径] */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9224;
const ROOT = 'E:/temp/onmyoji-draft-map/';
const PAGE = process.argv[2] || 'index.html';
const URL_PAGE = /^https?:/.test(PAGE) ? PAGE : ('file:///' + ROOT.replace(/\\/g, '/') + PAGE);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=E:/temp/yys_probe_profile',
    '--window-size=1600,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    let list = null;
    for (let i = 0; i < 40 && !list; i++) {
      try { list = await getJSON('/json/list'); } catch (e) { await sleep(250); }
    }
    if (!list) throw new Error('Chrome 没起来（端口 ' + PORT + ' 无响应）');
    const tgt = list.find(t => t.type === 'page');
    ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连不上')); });

    let seq = 0; const pend = new Map(); const errors = []; const logs = [];
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
      if (d.method === 'Runtime.exceptionThrown') {
        const e = d.params.exceptionDetails;
        errors.push((e.exception && e.exception.description) || e.text);
      }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        logs.push(d.params.args.map(a => a.value || a.description || '').join(' '));
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq;
      pend.set(id, d => d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evl = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL_PAGE });
    await sleep(2500);

    console.log('页面：' + URL_PAGE);
    console.log('READONLY =', await evl('String(window.READONLY)'));
    console.log('节点数 =', await evl('document.querySelectorAll("#world .node").length'));
    // 先「适应窗口」，否则整棵图比视口高，节点中心可能在视口外、鼠标事件落不到它身上
    await evl(`(()=>{const b=[...document.querySelectorAll('#tools button')].find(x=>/适应窗口/.test(x.textContent)); if(b) b.click(); return true;})()`);
    await sleep(600);
    console.log('缩放 sc_ =', await evl('typeof sc_ === "number" ? +sc_.toFixed(3) : "读不到"'));

    // 取一个「确实在视口里」的节点的中心点（真实坐标）
    const box = await evl(`(() => {
      const ns = [...document.querySelectorAll('#world .node')];
      const vis = ns.filter(e => { const r = e.getBoundingClientRect();
        return r.width > 20 && r.height > 20 && r.top > 8 && r.left > 8 &&
               r.bottom < innerHeight - 8 && r.right < innerWidth - 8; });
      const el = vis.find(e => e.__inst && e.__inst.nid) || vis[0];
      if(!el) return {none: true, count: ns.length,
        sample: ns.slice(0,3).map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];})};
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width/2), cy = Math.round(r.top + r.height/2);
      const hit = document.elementFromPoint(cx, cy);
      return {x: cx, y: cy, nid: el.__inst && el.__inst.nid, hasInst: !!el.__inst,
              cls: el.className, hitCls: hit && hit.className, hitTag: hit && hit.tagName};
    })()`);
    console.log('目标节点 =', JSON.stringify(box));
    if (!box) throw new Error('页面上没有节点，后面都不用测了');

    // 真实右键：mousePressed(button=right) 在 Chrome 里会派发 contextmenu
    // 先挂一个 document 级计数器，用来区分「浏览器压根没派 contextmenu」和「派了但我的代码没接住」
    await evl(`(()=>{ window.__ctxSeen = 0; window.__ctxTarget = '';
      document.addEventListener('contextmenu', e => { window.__ctxSeen++;
        window.__ctxTarget = (e.target && (e.target.className || e.target.tagName)) + ''; }, true);
      window.__calls = 0;
      const oldOpen = window.openCtx;
      if (typeof oldOpen === 'function') window.openCtx = function(){ window.__calls++; return oldOpen.apply(this, arguments); };
      return true; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', buttons: 2, clickCount: 1 });
    await sleep(400);
    console.log('document 层收到 contextmenu 次数 =', await evl('window.__ctxSeen'), 'target =', await evl('window.__ctxTarget'));
    const afterReal = await evl(`(() => {
      const m = document.getElementById('ctxMenu');
      const cs = getComputedStyle(m);
      const r = m.getBoundingClientRect();
      return {display: cs.display, zIndex: cs.zIndex, items: m.children.length,
              rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
              text: m.textContent.slice(0, 60)};
    })()`);
    console.log('真实右键后 =', JSON.stringify(afterReal));
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'right', buttons: 0, clickCount: 1 });

    // 若真实右键没出，补一发合成事件，区分「没收听」还是「收了但画不出来」
    if (afterReal.display === 'none') {
      const synth = await evl(`(() => {
        const ns = [...document.querySelectorAll('#world .node')];
        const el = ns.find(e => e.__inst) || ns[0];
        const r = el.getBoundingClientRect();
        const e2 = new MouseEvent('contextmenu', {bubbles:true, cancelable:true,
          clientX: Math.round(r.left+r.width/2), clientY: Math.round(r.top+r.height/2), button: 2});
        const notCancelled = el.dispatchEvent(e2);
        const m = document.getElementById('ctxMenu');
        return {prevented: !notCancelled, display: getComputedStyle(m).display,
                items: m.children.length, left: m.style.left, top: m.style.top};
      })()`);
      console.log('合成右键后 =', JSON.stringify(synth));
    }

    // 截图留证
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = 'E:/temp/yys_shots/probe-ctx.png';
    require('fs').mkdirSync('E:/temp/yys_shots', { recursive: true });
    require('fs').writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('截图 -> ' + f);

    // 顺带验一下拖动：按下-移动 60px-松开，看偏移量是否只走 60（复用同一坐标，别再挑视口外的节点）
    await evl(`document.getElementById('ctxMenu').style.display='none'`);
    const before = await evl(`(() => {
      const el = document.elementFromPoint(${box.x}, ${box.y});
      const nd = el && el.closest('.node');
      const inst = nd && nd.__inst;
      return {dx: inst ? (inst.node.dx||0) : null, dy: inst ? (inst.node.dy||0) : null};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    // 记下每一次 mousemove 后的偏移量，看是「只吃了第一帧」还是「每一帧都在算但被覆盖」
    await evl(`(()=>{ window.__mv = [];
      window.addEventListener('mousemove', e => {
        window.__mv.push({x: e.clientX, y: e.clientY,
          nd: (typeof ND !== 'undefined' && ND) ? (ND.moved ? 'moved' : 'fresh') : 'null',
          dx: (typeof ND !== 'undefined' && ND) ? ND.inst.node.dx : null,
          cfgdx: (typeof ND !== 'undefined' && ND) ? (CFG && ND.nid ? null : null) : null});
      });
      return true; })()`);
    for (const k of [1, 2, 3]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 20 * k, y: box.y + 10 * k, button: 'none', buttons: 1 });
      await sleep(60);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 60, y: box.y + 30, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    const after = await evl(`(() => {
      const el = document.elementFromPoint(${box.x + 60}, ${box.y + 30});
      const nd = el && el.closest('.node');
      const inst = nd && nd.__inst;
      return {dx: inst ? (inst.node.dx||0) : null, dy: inst ? (inst.node.dy||0) : null};
    })()`);
    console.log('拖动前 =', JSON.stringify(before), '拖动后 =', JSON.stringify(after), '（期望 dx≈60 dy≈30）');
    console.log('每帧 =', JSON.stringify(await evl('window.__mv')));

    if (errors.length) console.log('页面异常：\n  ' + errors.join('\n  '));
    if (logs.length) console.log('console.error：\n  ' + logs.join('\n  '));
    if (!errors.length && !logs.length) console.log('页面无异常');
  } catch (e) {
    console.log('排查中断：' + e.message);
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    chrome.kill();
    setTimeout(() => process.exit(0), 300);
  }
})();

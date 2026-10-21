/* 无依赖 CDP 冒烟：驱动无头 Chrome 验证配置版页面交互并截图
   前置：python -m http.server 8123 与 chrome --headless=new --remote-debugging-port=9223 都要先起来 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = 'E:/temp/onmyoji-draft-map/';          // 仓库根：导出产物临时落在这里才能被静态服务访问到
const PORT = 9223;
const URL_PAGE = 'http://127.0.0.1:8123/index.html' +
  '?nocache=' + Date.now();          // 带 nocache 避免命中本地旧改动
const OUT = 'E:/temp/yys_shots/';
const IMP_JSON = OUT + 'smoke_import.json';   // 导入测试用的方案文件
const DEBUG = false;

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });
    let seq = 0; const pend = new Map(); const events = [];
    const HANDLERS = {};
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
      else if (d.method) { events.push(d); (HANDLERS[d.method] || []).forEach(f => { try { f(d.params); } catch (e) {} }); }
    };
    return {
      on(method, fn) { (HANDLERS[method] = HANDLERS[method] || []).push(fn); },
      async send(method, params = {}) {
        const id = ++seq;
        const rx = new Promise(res => pend.set(id, res));
        if (DEBUG) console.log('  >> ' + method);
        ws.send(JSON.stringify({ id, method, params }));
        const r = await Promise.race([
          rx,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + method)), 20000))
        ]);
        pend.delete(id);
        if (DEBUG) console.log('  << ' + method + ' ' + (r.error ? 'ERR' : 'ok'));
        if (r.error) throw new Error(method + ': ' + JSON.stringify(r.error));
        return r.result;
      }
    };
  }
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
  console.log('  截图 -> ' + name);
}
/* 两段代码写法不一致：前面都写 ev(cdp, expr)，第 11 段起写成 ev(expr)。
   这里两种都吃，谁的调用都不用改。 */
let MAIN = null;
async function ev(a, b) {
  const cdp = (b === undefined) ? MAIN : a;
  const expr = (b === undefined) ? a : b;
  if (!cdp) throw new Error('ev() 还没绑定连接');
  let last = null;
  for (let i = 0; i < 2; i++) {                 // 机器上有杀毒软件往页面里注入脚本，偶发 fetch 失败，重试一次就过
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (!r.exceptionDetails) return r.result.value;
    last = r.exceptionDetails;
    await new Promise(s => setTimeout(s, 350));
  }
  throw new Error('eval 失败: ' + JSON.stringify(last.exception));
}
/* 页面里弹原生 confirm/prompt 时渲染线程会停住，后面的 evaluate 全部超时。
   这里统一自动确认，别让对话框把冒烟卡死。 */
const DIALOG_LOG = [];
async function autoDialog(cdp) {
  cdp.on('Page.javascriptDialogOpening', p => {
    DIALOG_LOG.push(p.type + ':' + String(p.message || '').slice(0, 40));
    cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
}

/* 页面里常用的小取值器 */
const TAB_NAMES = `[...document.querySelectorAll('#schemeBar .tab')].map(t=>t.firstChild.textContent)`;
const PINS = `[...document.querySelectorAll('#schemeBar .tab .pin')].map(p=>p.textContent)`;
const BAR_R = `[...document.querySelectorAll('#schemeBar .barR button')].map(b=>b.textContent)`;

(async () => {
  // 静态服务没人听就自己起一个（纯 Node 实现，不再依赖 python）；导出产物也要靠它回读
  let web = false;
  for (let i = 0; i < 5; i++) {
    try { await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 8123, path: '/' }, res).on('error', rej)); web = true; break; }
    catch (e) { await sleep(200); }
  }
  if (!web) {
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
      '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css', '.ico': 'image/x-icon' };
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^[\\/]+/, '');
      // ROOT 是正斜杠字面量，path.join 会给出反斜杠 —— 两边都 resolve 再比，否则全被 403
      const base = path.resolve(ROOT);
      let f = path.resolve(base, p === '' ? 'index.html' : p);
      if (f !== base && !f.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(f, (e, d) => {
        if (e) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(d);
      });
    });
    srv.listen(8123, '127.0.0.1');
    process.on('exit', () => { try { srv.close(); } catch (e) {} });
    for (let i = 0; i < 30; i++) {          // listen() 是异步的，必须真等端口能通才继续
      try { await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 8123, path: '/' }, res).on('error', rej)); web = true; break; }
      catch (e) { await sleep(200); }
    }
  }

  // 调试端口没人听就自己拉一个无头 Chrome（外部已启动的照样能用，不重复拉）
  let ok = false;
  for (let i = 0; i < 8; i++) { try { await getJSON('/json/version'); ok = true; break; } catch (e) { await sleep(200); } }
  if (!ok) {
    const dir = 'E:/temp/yys_shot_profile_' + Date.now();      // 每次用新 profile，避免上一份被占住导致 Chrome 秒退
    const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir,
      '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
    process.on('exit', () => { try { ch.kill(); } catch (e) {} });
    for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); ok = true; break; } catch (e) { await sleep(300); } }
  }
  if (!ok) throw new Error('Chrome 调试端口未就绪（先启动：chrome --headless=new --remote-debugging-port=9223 about:blank）');

  let targets = await getJSON('/json/list');
  let page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    // 没有 page 目标（上次 Page.close 过）就开一个新标签
    const r = await new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?about:blank', method: 'PUT' },
        r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); });
      req.on('error', rej); req.end();
    });
    page = r;
  }
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  MAIN = cdp;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await autoDialog(cdp);
  await cdp.send('Page.navigate', { url: URL_PAGE });
  await sleep(1500);
  // 清掉上次冒烟留下的浏览器本地改动，回到 config.json 的干净状态
  await ev(cdp, `(()=>{ try{ localStorage.clear(); }catch(e){} location.reload(); return 1; })()`);
  await sleep(2500);

  const fails = [];
  const ck = (c, m) => { if (c) console.log('  OK   ' + m); else { fails.push(m); console.log('  FAIL ' + m); } };
  /* 等页面真正就绪（reload 后立刻取值会撞上还没渲染完的空文档，ttl 都拿不到） */
  async function waitReady(tries = 50) {
    for (let i = 0; i < tries; i++) {
      const r = await ev(cdp, `({ttl: !!document.getElementById('ttl'), nodes: document.querySelectorAll('.node').length})`).catch(() => null);
      if (r && r.ttl && r.nodes > 0) return true;
      // chrome-error 页（比如起服务那一刻端口还没通）就重导航一次，别对着错误页空等
      const href = await ev(cdp, `location.href`).catch(() => '');
      if (/^chrome-error:/.test(href || '')) { await cdp.send('Page.navigate', { url: URL_PAGE }); await sleep(1200); continue; }
      await sleep(300);
    }
    const probe = await ev(cdp, `({href: location.href, ready: document.readyState,
      bodyLen: (document.body && document.body.innerHTML.length) || 0,
      head: (document.body && document.body.innerHTML.slice(0, 120)) || '(no body)'})`).catch(e => ({err: e.message}));
    console.log('  未就绪现场 =', JSON.stringify(probe));
    throw new Error('页面迟迟没就绪（ttl / 节点都没出来）');
  }
  await waitReady();

  /* ================= 1. 初始渲染 ================= */
  console.log('== 1. 初始渲染 ==');
  let r = await ev(cdp, `({
    title: document.getElementById('ttl').textContent,
    tabs: ${TAB_NAMES},
    barR: ${BAR_R},
    nodes: document.querySelectorAll('.node').length,
    paths: [...document.querySelectorAll('#wires path')].filter(p=>p.getAttribute('stroke')).length,
    btns: [...document.querySelectorAll('#tools button')].map(b=>b.textContent),
    pins: ${PINS},
    pinTip: document.querySelector('#schemeBar .tab .pin').title,
    noteOn: document.getElementById('schemeNote').classList.contains('on'),
    brokenAv: [...document.querySelectorAll('.node img')].filter(i=>i.complete && i.naturalWidth===0).length,
    avCount: document.querySelectorAll('.node img').length
  })`);
  console.log('  ', JSON.stringify(r));
  ck(r.title === '翻牌上卡导引图', '页面名 = 翻牌上卡导引图（实际 ' + r.title + '）');
  ck(r.tabs.length === 1 && r.tabs[0] === '示例方案-禅吞', '干净状态只有 1 个示例方案标签');
  ck(r.barR.join(',') === '式神配置 · 2,＋ 新建,复制,导出,导入', '方案栏右侧操作组 = ' + r.barR.join(' / '));
  ck(r.nodes >= 97, '可见节点 >= 97（' + r.nodes + '）');
  ck(r.paths >= 90, '连线 >= 90（' + r.paths + '）');
  ck(r.btns.join(',') === '适应窗口,只看体系,暗色',
    '顶栏只剩三个按钮（实际 ' + r.btns.join(' / ') + '）');
  ck(!r.btns.includes('编辑') && !r.btns.includes('页面设置'), '「编辑」与「页面设置」入口已移除');
  ck(r.pins.length === 1 && r.pins[0] === '示例', '示例方案标着「示例」徽标');
  ck(r.pinTip === '示例导图，无法删除', '徽标提示精简为「示例导图，无法删除」（实际 ' + r.pinTip + '）');
  ck(!r.noteOn, '只有示例方案时不显示丢失提醒条');
  ck(r.avCount > 0 && r.brokenAv === 0,
    '头像全部加载成功（' + r.avCount + ' 张，坏图 ' + r.brokenAv + ' 张）');
  await shot(cdp, '10-初始.png');

  /* ================= 2. 双击节点 -> 编辑面板（式神选择器）================= */
  console.log('== 2. 双击节点框 -> 编辑面板 ==');
  r = await ev(cdp, `(()=>{
    const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
    if(!el) return {found:false};
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return {found:true, sideOpen:document.getElementById('side').classList.contains('open'),
            t:document.getElementById('sideTitle').textContent,
            labels:[...document.querySelectorAll('#sideBody .fld label')].map(x=>x.textContent),
            grid:document.querySelectorAll('#ss_grid img').length,
            chips:document.querySelectorAll('#ss_now .chip').length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.found && r.sideOpen, '不用「编辑」开关，双击节点框就打开面板');
  ck(/^编辑节点：n\d+/.test(r.t), '面板标题 = 编辑节点：<节点 ID> + 浅色描述（实际 ' + r.t + '）');
  ck(r.labels[0] === '描述' && !r.labels.includes('标题'), '字段标签「标题」已改为「描述」');
  ck(r.grid > 0, '式神选择器渲染出 ' + r.grid + ' 个头像');
  await shot(cdp, '11-编辑面板.png');

  /* ============ 2b. 单击 = 折叠 / 展开子节点（与双击开面板解耦）============ */
  console.log('== 2b. 单击折叠 / 展开，双击才开面板 ==');
  const visCount = `[...document.querySelectorAll('.node')].filter(n=>getComputedStyle(n).display!=='none').length`;
  r = await ev(cdp, `(async()=>{
    const el=[...document.querySelectorAll('.node.clickable')].find(n=>!n.querySelector('.badge'));
    if(!el) return {found:false};
    const before=${visCount};
    el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await new Promise(s=>setTimeout(s, 600));
    const mid={badge:!!el.querySelector('.badge'), nodes:${visCount},
               sideOpen:document.getElementById('side').classList.contains('open'),
               title:document.getElementById('sideTitle').textContent};
    el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    await new Promise(s=>setTimeout(s, 600));
    return {found:true, before, mid,
            after:{badge:!!el.querySelector('.badge'), nodes:${visCount}}};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.found, '找到可折叠的分支节点用于单击测试');
  ck(r.found && r.mid.badge && r.mid.nodes < r.before,
    '单击父节点收起子框并显示数量徽标（' + r.before + ' -> ' + r.mid.nodes + ' 个可见节点）');
  ck(r.mid.sideOpen && /^编辑节点：/.test(r.mid.title),
    '单击只做折叠，不会把编辑面板顶掉或重新打开（面板仍为「' + r.mid.title + '」）');
  ck(r.after.badge === false && r.after.nodes === r.before,
    '再单击一次恢复展开（回到 ' + r.after.nodes + ' 个可见节点）');

  /* ============ 2c. 点「应用」不搬镜头 ============ */
  console.log('== 2c. 点「应用」不搬镜头 ==');
  const wpt = await ev(cdp, `(()=>{const rc=document.getElementById('stage').getBoundingClientRect();
    return {x:Math.round(rc.left+rc.width*0.32), y:Math.round(rc.top+rc.height*0.42)};})()`);
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: wpt.x, y: wpt.y, deltaX: 0, deltaY: -120, modifiers: 0 });
  await sleep(250);
  const tf0 = await ev(cdp, `document.getElementById('world').style.transform`);
  r = await ev(cdp, `(()=>{
    const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    document.getElementById('f_title').value='禅吞内战（改过）';
    document.getElementById('f_note').value='应用测试';
    [...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='应用').click();
    const box=[...document.querySelectorAll('.node')].find(n=>n.textContent.indexOf('禅吞内战（改过）')===0);
    return {tf:document.getElementById('world').style.transform,
            open:document.getElementById('side').classList.contains('open'),
            sel:document.querySelectorAll('.node.sel').length,
            title:document.getElementById('sideTitle').textContent,
            renamed:!!box};
  })()`);
  console.log('  ', JSON.stringify({ tf0, tf1: r.tf, renamed: r.renamed, sel: r.sel }));
  ck(tf0 && r.tf === tf0, '点「应用」后画布缩放 / 位置完全不动（' + tf0 + '）');
  ck(r.renamed, '「应用」确实改了框里的描述');
  ck(r.open && r.sel === 1 && r.title.indexOf('禅吞内战（改过）') > 0,
    '应用后面板没关、节点仍高亮、面板标题同步刷新');
  await shot(cdp, '11b-应用不搬镜头.png');
  // 改回原名，别影响后面按标题找节点的步骤
  await ev(cdp, `(()=>{
    document.getElementById('f_title').value='禅吞内战';
    document.getElementById('f_note').value='';
    [...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='应用').click();
    return 1;})()`);
  await sleep(200);

  /* ================= 3. 别名反查 ================= */
  console.log('== 3. 搜索别名「炎魔」应命中「阎魔」==');
  r = await ev(cdp, `(()=>{
    const q=document.getElementById('ss_q'); q.value='炎魔'; q.oninput();
    return [...document.querySelectorAll('#ss_grid img')].map(i=>i.title);
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r[0] === '阎魔', '别名反查命中阎魔');

  /* ==== 3b. 点头像格子 / 点已选标签，都不能把编辑面板关掉 ====
     回归：格子自己的 onclick 会 grid.innerHTML='' 重建整片网格，被点中的元素当场脱离 #side，
     等 click 冒泡到 window 的「点空白关面板」时 closest('#side') 已判不出来 → 面板被误关。 */
  console.log('== 3b. 点式神头像：面板必须留着 ==');
  await ev(cdp, `(()=>{const q=document.getElementById('ss_q'); q.value=''; q.oninput();
    document.getElementById('ss_grid').scrollIntoView({block:'center'}); return 1;})()`);
  await sleep(220);
  const avT = await ev(cdp, `(()=>{
    const im=document.querySelector('#ss_grid img'); if(!im) return null;
    const rc=im.getBoundingClientRect();
    return {x:Math.round(rc.left+rc.width/2), y:Math.round(rc.top+rc.height/2), name:im.title,
            inView: rc.top>=0 && rc.bottom<=innerHeight && rc.left>=0 && rc.right<=innerWidth,
            chipsBefore:[...document.querySelectorAll('#ss_now .chip')].map(c=>c.textContent)};})()`);
  console.log('  ', JSON.stringify(avT));
  ck(!!avT, '网格里有可点的头像');
  ck(avT.inView, '头像格子落在视口内（坐标可用于真实点击）');
  const nBefore = (avT.chipsBefore || []).length;
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: avT.x, y: avT.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: avT.x, y: avT.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  r = await ev(cdp, `(()=>({
    open:document.getElementById('side').classList.contains('open'),
    sel:document.querySelectorAll('.node.sel').length,
    alive:!!document.getElementById('ss_grid') && !!document.getElementById('f_title'),
    chips:[...document.querySelectorAll('#ss_now .chip')].map(c=>c.textContent)}))()`);
  console.log('  ', JSON.stringify({ clicked: avT.name, open: r.open, sel: r.sel, chips: r.chips }));
  ck(r.open, '★ 点头像后编辑面板还在（没被当成「点画布空白」关掉）');
  ck(r.alive, '面板内容还在：描述输入框与头像网格都没消失');
  ck(r.sel === 1, '节点仍保持选中态');
  ck(r.chips.length === nBefore + 1 && r.chips[r.chips.length - 1].indexOf(avT.name) === 0,
    '头像点一下即选中并进入「已选式神」（' + nBefore + ' -> ' + r.chips.length + '）');
  await shot(cdp, '11c-点式神头像后面板还在.png');
  // 同一类 bug：点「已选式神」标签移除时也会 now.innerHTML='' 重建
  r = await ev(cdp, `(()=>{
    const cs=[...document.querySelectorAll('#ss_now .chip')]; const c=cs[cs.length-1];
    if(!c) return {none:true};
    c.click();
    return {none:false, open:document.getElementById('side').classList.contains('open'),
            chips:document.querySelectorAll('#ss_now .chip').length};})()`);
  ck(!r.none && r.open, '★ 点「已选式神」标签移除，面板同样留着');
  ck(r.chips === nBefore, '标签点一下即移除，回到点之前的 ' + nBefore + ' 个');

  /* ==== 3c. 选中之后点「应用」必须真的落到节点上 ====
     回归：expandNames 里 `if(Array.isArray(hit)) for(...) if(...) push(n); else if(...) push(raw);`
     的 else 粘到了 for 体内那个 if 上 → 不在 aliases 表里的名字（276 个式神有 253 个）被静默丢掉，
     症状就是「能选中、点应用没反应」。这里挑一个确定不是别名键的式神走完整流程。 */
  console.log('== 3c. 点「应用」真的生效（非别名式神）==');
  r = await ev(cdp, `(()=>{
    const before=document.getElementById('f_ss').value;
    const inp=document.getElementById('f_ss');
    inp.value = before + '、一反木绵';        // 「一反木绵」不是别名表的键，正是会被吞掉的那一类
    inp.oninput();
    const chips=[...document.querySelectorAll('#ss_now .chip')].map(c=>c.textContent);
    [...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='应用').click();
    const applied=[...document.querySelectorAll('.node.sel .avs img')].map(i=>i.alt);
    const open=document.getElementById('side').classList.contains('open');
    const missing=[...document.querySelectorAll('.node.sel .avs .av-miss')].length;
    // 还原成点之前的选择，别影响后面的步骤
    const inp2=document.getElementById('f_ss'); inp2.value = before; inp2.oninput();
    [...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='应用').click();
    return {before, chips, applied, open, missing,
            back:[...document.querySelectorAll('.node.sel .avs img')].map(i=>i.alt)};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.applied.indexOf('一反木绵') >= 0,
    '★ 点「应用」后非别名式神真的落到节点上（画布：' + r.applied.join('/') + '）');
  ck(r.applied.length === r.chips.length,
    '画布头像数 = 面板选中数（' + r.applied.length + ' = ' + r.chips.length + '）');
  ck(r.missing === 0, '没有退化成「头像缺失」占位框');
  ck(r.open, '应用后面板还开着');
  ck(r.back.join('、') === r.before, '还原回原来的选择（' + r.back.join('、') + '）');
  await shot(cdp, '11d-应用真的生效.png');
  await ev(cdp, `(()=>{const q=document.getElementById('ss_q'); q.value='炎魔'; q.oninput(); return 1;})()`);
  await sleep(150);

  /* ================= 4. 复用面板 ================= */
  console.log('== 4. 复用已有 -> 建立汇合 ==');
  r = await ev(cdp, `(()=>{
    const btn=[...document.querySelectorAll('#sideFoot button')].find(x=>x.textContent==='＋ 复用已有');
    btn.click();
    return {open:document.getElementById('side').classList.contains('open'),
            t:document.getElementById('sideTitle').textContent,
            rows:document.querySelectorAll('#pk_list > div').length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.open && r.rows > 0, '复用面板打开并列出 ' + r.rows + ' 个候选');
  await shot(cdp, '12-复用面板.png');
  await ev(cdp, `[...document.querySelectorAll('#sideFoot button')].find(x=>x.textContent==='关闭').click()`);

  // 点画布空白 -> 面板收起、选中态清掉（放在这里，避免提前关掉后面步骤要用的面板）
  r = await ev(cdp, `(()=>{
    const st=document.getElementById('stage');
    const rc=st.getBoundingClientRect();
    st.dispatchEvent(new MouseEvent('click',{bubbles:true,
      clientX:Math.round(rc.left+8), clientY:Math.round(rc.bottom-8)}));
    return {open:document.getElementById('side').classList.contains('open'),
            sel:document.querySelectorAll('.node.sel').length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(!r.open, '点画布空白处面板收起');
  ck(r.sel === 0, '收起后节点选中态也清掉');

  /* ========= 4b. 汇合：复用已有 -> 只画一个框 + 虚线箭头 + 文字截断 ========= */
  console.log('== 4b. 汇合节点：单一框 + 汇合箭头 + 截断 ==');
  const SHR = '我方：SP雪女、平将门（肉平）';
  r = await ev(cdp, `(()=>{
    const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    [...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='＋ 复用已有').click();
    const rows=[...document.querySelectorAll('#pk_list > div')];
    const pick=rows.find(x=>x.children[0].textContent==='${SHR}');
    if(!pick) return {found:false, rows:rows.length};
    const before=document.querySelectorAll('.node').length;
    pick.click();
    // 选中候选项后 reselect 会重建整个面板，那一行当场脱离 #side——面板同样不能被误关
    const openAfterPick=document.getElementById('side').classList.contains('open');
    const sh=[...document.querySelectorAll('.node')].find(n=>n.textContent.indexOf('我方：SP雪女')===0);
    sh.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));      // 打开共享节点自己的面板
    const txts=[...document.querySelectorAll('.node .txt')].filter(t=>t.textContent.indexOf('我方：SP雪女')===0);
    const mb=document.querySelector('.node .mgbadge');
    return {found:true, before, after:document.querySelectorAll('.node').length, openAfterPick,
            boxes:txts.length, cut:txts[0]?txts[0].textContent:'', tip:txts[0]?txts[0].title:'',
            mg:document.querySelectorAll('.node .mgbadge').length, mgText:mb?mb.textContent:'',
            dash:document.querySelectorAll('#wires path[stroke-dasharray]').length,
            dashTop:document.querySelectorAll('#wiresTop path[stroke-dasharray]').length,
            casing:document.querySelectorAll('#wiresTop path[data-casing]').length,
            arrows:document.querySelectorAll('#wires marker').length,
            title:document.getElementById('sideTitle').textContent};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.found, '在复用面板里找到目标节点候选');
  ck(r.openAfterPick, '★ 在复用面板里点中一个节点后，编辑面板没被误关');
  ck(r.after === r.before, '汇合后节点总数不变（没有多渲染一份副本）：' + r.before + ' -> ' + r.after);
  ck(r.boxes === 1, '被两处引用的节点在图上只有一个框（实际 ' + r.boxes + '）');
  ck(r.dashTop === 1 && r.casing === 1, '虚线画在节点之上那一层，且带一条半透明底衬（dash ' +
    r.dashTop + ' / casing ' + r.casing + '）');
  ck(r.dash === 0, '普通连线那层不再混着汇合虚线（实际 ' + r.dash + '）');
  ck(r.mg === 1 && r.mgText === '⤵2', '汇合徽标 ⤵2（实际 ' + r.mgText + '）');
  ck(r.cut.length === 11 && r.cut.slice(-1) === '…',
    '图内文字截断成 10 字 + 省略号（实际「' + r.cut + '」）');
  ck(r.tip.indexOf(SHR) >= 0, '悬停提示里带全文');
  ck(r.title.indexOf('2 处引用同步') > 0, '共享节点的编辑面板标明「2 处引用同步」（' + r.title + '）');
  await shot(cdp, '13b-汇合节点.png');

  // 被复用的框上：只说明「被哪些分支引用」，不给任何解除入口
  await ev(cdp, `(()=>{ window.__c0 = window.confirm; window.confirm = ()=>true; return 1; })()`);
  r = await ev(cdp, `(()=>{
    const rows=[...document.querySelectorAll('#ref_list .refrow')];
    const btns=[...document.querySelectorAll('#sideFoot button')].map(b=>b.textContent);
    return {rows:rows.length, rowTxt:rows.map(x=>x.innerText.replace(/\\s+/g,' ').trim()),
            crosses:document.querySelectorAll('#ref_list .rx').length,
            btns:btns.join(','),
            nodes:document.querySelectorAll('.node').length,
            mg:document.querySelectorAll('.node .mgbadge').length,
            dashTop:document.querySelectorAll('#wiresTop path[stroke-dasharray]').length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.rows === 2, '共享节点的编辑面板列出 2 条引用来源（实际 ' + r.rows + '）');
  ck(r.crosses === 0, '★ 那两行没有 ✕（解除统一在源头那一处做）');
  ck(r.btns.indexOf('解除复用') < 0, '★ 被复用的框上没有「解除复用」按钮（' + r.btns + '）');
  ck(r.btns.indexOf('删除整个节点') >= 0, '被复用的框上给的是「删除整个节点」');
  ck(r.mg === 1 && r.dashTop === 1, '此时汇合徽标和虚线都还在（证明上面只是「没给入口」，没误操作）');

  /* ==== 4c. 源头那一处解除：复用它的那个框上点 ✕，只断这一条 ==== */
  console.log('== 4c. 源头解除：只在「本框复用了」里 ✕，只断一条 + 面板不关 ==');
  r = await ev(cdp, `(()=>{ window.confirm = ()=>true;          // ✕ 也带确认框
    const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('敌方：石长姬'));
    if(!el) return {found:false, why:'找不到 石长姬 节点'};
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const reuse=[...document.querySelectorAll('#sideFoot button')].find(b=>b.textContent==='＋ 复用已有');
    if(!reuse) return {found:false, why:'面板里没有「复用已有」'};
    reuse.click();
    const pick=[...document.querySelectorAll('#pk_list > div')].find(x=>x.children[0].textContent==='${SHR}');
    if(!pick) return {found:false, why:'复用面板里没有目标候选'};
    pick.click();                                              // 重新造出 2 处引用
    // 解除要从源头那一处做：也就是刚刚复用别人的「石长姬」这个框
    const src=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('敌方：石长姬'));
    if(!src) return {found:false, why:'复用后找不到源头那个框'};
    src.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const before=document.querySelectorAll('.node').length;
    const rr=[...document.querySelectorAll('#outref_list .refrow')];
    if(rr.length !== 1) return {found:false, why:'「本框复用了」里的行数不是 1（实际 ' + rr.length + '）'};
    const which=rr[0].querySelector('.rid').textContent;
    rr[0].querySelector('.rx').click();                        // 只 ✕ 掉这一条
    const sh=[...document.querySelectorAll('.node .txt')].filter(t=>t.textContent.indexOf('我方：SP雪女')===0);
    return {found:true, before, after:document.querySelectorAll('.node').length, which,
            mg:document.querySelectorAll('.node .mgbadge').length,
            dashTop:document.querySelectorAll('#wiresTop path[stroke-dasharray]').length,
            full:sh.length, text:sh[0]?sh[0].textContent:'',
            open:document.getElementById('side').classList.contains('open')};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.found, '能从「石长姬」重新造出汇合，并在源头那一处看到「本框复用了」' +
    (r.found ? '' : '（' + r.why + '）'));
  ck(r.after === r.before, '★ 源头 ✕ 只断一条引用，节点本身留着（' + r.before + ' -> ' + r.after + ' 个框）');
  ck(r.full === 1 && r.text === SHR, '断掉这条引用后它不再是汇合点，就一个框、文字恢复全文');
  ck(r.mg === 0 && r.dashTop === 0, '汇合徽标与虚线箭头一起撤掉');
  ck(r.open, '★ 点 ✕ 之后面板也没被误关');
  await ev(cdp, `(()=>{ window.confirm = window.__c0; return 1; })()`);
  await ev(cdp, `[...document.querySelectorAll('#sideFoot button')].find(x=>x.textContent==='关闭').click()`);
  // 这一段的汇合是临时改在示例方案上的，清掉并重载，别影响后面的步骤
  await ev(cdp, `(()=>{ try{localStorage.clear();}catch(e){} location.reload(); return 1; })()`);
  await sleep(2500);

  /* ================= 5. 页面设置面板（与方案解耦）================= */
  console.log('== 5. 顶栏按钮由配置驱动（只剩三个）==');
  r = await ev(cdp, `(()=>{
    const s=document.getElementById('tools').style;
    return {btns:[...document.querySelectorAll('#tools button')].map(b=>b.textContent),
            radius:getComputedStyle(document.querySelector('#tools button')).borderRadius,
            head:document.getElementById('ttl').textContent, docTitle:document.title};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.btns.join(',') === '适应窗口,只看体系,暗色', '顶栏 = ' + r.btns.join(' / '));
  ck(parseFloat(r.radius) >= 99, '按钮改成胶囊形（border-radius ' + r.radius + '）');
  ck(r.head === '翻牌上卡导引图' && r.docTitle === '翻牌上卡导引图',
    '页面名与浏览器标签名都取自配置 meta.title');
  await shot(cdp, '15-顶栏.png');

  /* ================= 6. 暗色主题 ================= */
  console.log('== 6. 暗色主题 ==');
  r = await ev(cdp, `(()=>{
    const b=[...document.querySelectorAll('#tools button')].find(x=>x.textContent==='暗色');
    b.click();
    return {page:getComputedStyle(document.documentElement).getPropertyValue('--page'), btn:b.textContent};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.btn === '浅色', '点一下切成「浅色」（明暗切换）');
  await shot(cdp, '16-暗色.png');

  /* ========= 6b. 只看体系：连子孙一起收起，展开一层露一层 ========= */
  console.log('== 6b. 只看体系 -> 按需一级级展开 ==');
  const probe = `(()=>{
    const vis=[...document.querySelectorAll('.node')].filter(n=>getComputedStyle(n).display!=='none');
    const noBadge=vis.filter(n=>n.classList.contains('clickable') && !n.querySelector('.badge'));
    const wires=[...document.querySelectorAll('#wires path')].filter(p=>p.getAttribute('stroke')).length;
    return {nodes:vis.length, expanded:noBadge.length,
            badged:vis.filter(n=>!!n.querySelector('.badge')).length, wires};
  })()`;
  const b0 = await ev(cdp, probe);
  await ev(cdp, `[...document.querySelectorAll('#tools button')].find(b=>b.textContent==='只看体系').click()`);
  await sleep(300);
  const b1 = await ev(cdp, probe);
  console.log('  ', JSON.stringify({ before: b0, folded: b1 }));
  ck(b1.nodes < b0.nodes / 3, '「只看体系」后可见节点大幅减少（' + b0.nodes + ' -> ' + b1.nodes + '）');
  ck(b1.badged > 0, '留下的分支框都带折叠徽标（' + b1.badged + ' 个）');
  ck(b1.expanded * 3 <= b0.expanded,
    '收起时连子孙一起收：带子框却没折叠的框只剩 ' + b1.expanded + ' 个（原本 ' + b0.expanded + ' 个，即只有几个根还开着）');

  // 展开其中一个一级分支 -> 只露出一层
  r = await ev(cdp, `(()=>{
    const vis=[...document.querySelectorAll('.node')].filter(n=>getComputedStyle(n).display!=='none');
    const t=vis.find(n=>n.querySelector('.badge') && n.classList.contains('clickable'));
    if(!t) return {found:false};
    const kids=t.querySelector('.badge').textContent;
    t.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return {found:true, kids};
  })()`);
  await sleep(500);                       // 单击折叠有 160ms 延迟
  const b2 = await ev(cdp, probe);
  console.log('  ', JSON.stringify({ expanded: b2 }));
  ck(r.found, '找到一个已收起的一级分支用于展开');
  ck(b2.nodes > b1.nodes, '展开后露出下一层（' + b1.nodes + ' -> ' + b2.nodes + '）');
  ck(b2.expanded === b1.expanded + 1,
    '只多开我点的这一个框（带子框且未折叠的：' + b1.expanded + ' -> ' + b2.expanded + '），不会把更深的后代一起展开');
  ck(b2.wires - b1.wires === b2.nodes - b1.nodes,
    '新露出的框与新增连线一一对应（不多不少就一层）：+' + (b2.nodes - b1.nodes) + ' 框 / +' + (b2.wires - b1.wires) + ' 线');
  await shot(cdp, '16b-只看体系逐级展开.png');

  /* ================= 7. 侧栏滚轮 / 键盘不误伤导图 ================= */
  console.log('== 7. 侧栏滚轮 / 键盘不误伤导图 ==');
  await ev(cdp, `(()=>{ try{localStorage.clear();}catch(e){} location.reload(); return 1; })()`);
  await sleep(2500);
  const scaleOf = `(()=>{const m=/scale\\(([\\d.]+)\\)/.exec(document.getElementById('world').style.transform);return m?parseFloat(m[1]):null;})()`;
  await ev(cdp, `(()=>{
    const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    return 1;
  })()`);
  await sleep(400);
  await ev(cdp, `(()=>{const o=document.getElementById('side').classList.contains('open');
    if(!o) throw new Error('双击节点未打开侧栏'); return 1;})()`);
  const sidePt = await ev(cdp, `(()=>{const r=document.getElementById('side').getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+120)};})()`);
  const diaPt = await ev(cdp, `(()=>{const r=document.getElementById('stage').getBoundingClientRect();
    return {x:Math.round(r.left+r.width*0.25), y:Math.round(r.top+r.height*0.5)};})()`);
  const wheelAt = async p => {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -120, modifiers: 0
    });
    await sleep(150);
  };

  let s0 = await ev(cdp, scaleOf);
  await wheelAt(sidePt);
  let s1 = await ev(cdp, scaleOf);
  ck(Math.abs(s1 - s0) < 1e-6, '侧栏上滚轮不缩放导图（' + s0 + ' -> ' + s1 + '）');

  s0 = await ev(cdp, scaleOf);
  await wheelAt(diaPt);
  s1 = await ev(cdp, scaleOf);
  ck(s1 > s0, '导图区域滚轮仍能缩放（' + s0 + ' -> ' + s1 + '）');
  await shot(cdp, '17-侧栏滚轮.png');

  // 焦点在侧栏文本框时按方向键，不应平移导图
  const tOf = `document.getElementById('world').style.transform`;
  await ev(cdp, `document.getElementById('ss_q').focus()`);
  const t0 = await ev(cdp, tOf);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' });
  await sleep(200);
  const t1 = await ev(cdp, tOf);
  ck(t0 === t1, '侧栏输入框里方向键不平移导图');

  /* ================= 8. 方案栏：新建 / 复制 / 拖动排序 ================= */
  console.log('== 8. 方案栏：新建 / 复制 / 拖动排序 ==');
  await ev(cdp, `(()=>{ try{localStorage.clear();}catch(e){} location.reload(); return 1; })()`);
  await sleep(2500);
  const clickBar = async label => ev(cdp,
    `document.querySelectorAll('#schemeBar .barR button').forEach(b=>{ if(b.textContent==='${label}') b.click(); }), 1`);
  const fakePrompt = async v => ev(cdp, `window.prompt=()=> '${v}'; 1`);

  await fakePrompt('冒烟A'); await clickBar('＋ 新建'); await sleep(150);
  await fakePrompt('冒烟B'); await clickBar('＋ 新建'); await sleep(150);
  await clickBar('复制'); await sleep(150);
  r = await ev(cdp, `({tabs:${TAB_NAMES}, pins:${PINS}, nodes:document.querySelectorAll('.node').length})`);
  console.log('  ', JSON.stringify(r));
  ck(r.tabs.join(',') === '示例方案-禅吞,冒烟A,冒烟B,冒烟B 副本', '新建/复制后标签顺序 = ' + r.tabs.join(' / '));
  ck(r.pins.join(',') === '示例,自建,自建,自建', '示例/自建 徽标正确');
  await shot(cdp, '18-新建与复制.png');

  // 拖动：把 idx1 的「冒烟A」拖到最前面
  r = await ev(cdp, `(()=>{
    const tabs=[...document.querySelectorAll('#schemeBar .tab')];
    const src=tabs[1], dst=tabs[0];
    const rb=dst.getBoundingClientRect();
    const dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true, dataTransfer:dt}));
    dst.dispatchEvent(new DragEvent('dragover',{bubbles:true, cancelable:true, dataTransfer:dt,
      clientX:rb.left+2, clientY:rb.top+rb.height/2}));
    const marked = dst.className;
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true, cancelable:true, dataTransfer:dt,
      clientX:rb.left+2, clientY:rb.top+rb.height/2}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
    return {marked, tabs:${TAB_NAMES}, drag:document.querySelectorAll('#schemeBar .tab.dragging').length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.marked.indexOf('drop-l') >= 0, '拖动经过时目标显示插入标记');
  ck(r.tabs.join(',') === '冒烟A,示例方案-禅吞,冒烟B,冒烟B 副本',
    '拖动后顺序 = ' + r.tabs.join(' / '));
  ck(r.drag === 0, '拖动结束后不留残留状态');
  // 顺序要能持久化（刷新后仍在）
  await sleep(200);
  await ev(cdp, `location.reload(); 1`);
  await sleep(2200);
  r = await ev(cdp, `({tabs:${TAB_NAMES}})`);
  ck(r.tabs.join(',') === '冒烟A,示例方案-禅吞,冒烟B,冒烟B 副本', '刷新后排序仍是拖过的顺序');
  await shot(cdp, '19-拖动排序.png');

  /* ================= 9. 导出 JSON / 导入回环 ================= */
  console.log('== 9. 导出当前方案为 JSON ==');
  r = await ev(cdp, `(async()=>{
    window.__dl=null; window.__blob=null;
    const OC=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){ window.__dl={name:this.download, href:this.href}; };
    const OB=window.Blob;
    window.Blob=function(parts,opt){ window.__blob=parts.join(''); return new OB(parts,opt); };
    document.querySelectorAll('#schemeBar .barR button').forEach(b=>{ if(b.textContent==='导出') b.click(); });
    // 「导出」先弹方式选择框，再点 JSON 那一项（导出按钮不再直接下载）
    const opt=document.querySelector('#expOpts .opt[data-k="json"]');
    if(!opt) return {dl:null, len:0, why:'导出面板没弹出 JSON 选项',
                     active:document.querySelector('#schemeBar .tab.on').firstChild.textContent};
    opt.click();
    await new Promise(s=>setTimeout(s, 700));
    HTMLAnchorElement.prototype.click = OC;
    return {dl:window.__dl, len:(window.__blob||'').length,
            active:document.querySelector('#schemeBar .tab.on').firstChild.textContent};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(!!r.dl && /\.json$/.test(r.dl.name), '导出触发下载，文件名 = ' + (r.dl && r.dl.name));
  ck(/^[^\\\\/:*?"<>|]+\.json$/.test(r.dl.name), '文件名里的非法字符被转义');
  r = await ev(cdp, `(()=>{ const o=JSON.parse(window.__blob);
    return {name:o.name, nodes:Object.keys(o.nodes||{}).length, builtin:'builtin' in o, rev:'rev' in o, start:o.start}; })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.nodes >= 1 && !r.builtin && !r.rev, '导出内容是单方案 JSON（' + r.nodes + ' 节点，不含 builtin/rev）');

  console.log('== 9b. 导入 JSON -> 变成自建方案 ==');
  fs.writeFileSync(IMP_JSON, JSON.stringify({
    name: '导入测试', start: 'r1', floating: [],
    nodes: { r1: { id: 'r1', title: '导入根', camp: 'root', shishen: ['阎魔'], yuhun: [], note: '', children: [] } }
  }));
  await ev(cdp, `(()=>{
    window.__imp=null;
    const oc=document.createElement.bind(document);
    document.createElement=function(t){ const e=oc(t); if(String(t).toLowerCase()==='input') window.__imp=e; return e; };
    document.querySelectorAll('#schemeBar .barR button').forEach(b=>{ if(b.textContent==='导入') b.click(); });
    document.createElement=oc;
    if(window.__imp) document.body.appendChild(window.__imp);
    return !!window.__imp;
  })()`);
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'body > input[type=file]' });
  await cdp.send('DOM.setFileInputFiles', { files: [IMP_JSON], nodeId: q.nodeId });   // 这一步自身会派发 change
  await sleep(800);
  r = await ev(cdp, `({tabs:${TAB_NAMES}, pins:${PINS},
    on:document.querySelector('#schemeBar .tab.on').firstChild.textContent,
    nodes:document.querySelectorAll('.node').length,
    note:document.getElementById('schemeNote').innerText})`);
  console.log('  ', JSON.stringify(r));
  ck(r.tabs.includes('导入测试'), '导入的方案出现在标签栏（' + r.tabs.join(' / ') + '）');
  ck(r.pins[r.tabs.indexOf('导入测试')] === '自建', '导入的方案标记为自建');
  ck(r.on === '导入测试', '导入后自动切到该方案');
  ck(r.nodes === 1, '导入方案的节点已渲染（' + r.nodes + '）');
  await shot(cdp, '20-导入方案.png');

  /* ================= 9c. 式神配置表 ================= */
  console.log('== 9c. 式神配置表：空态 / 加行 / 行内编辑 / 头像 ==');
  const sheetBtnSel = `[...document.querySelectorAll('#schemeBar .barR button')].find(b=>b.textContent.indexOf('式神配置')===0)`;
  r = await ev(cdp, `(()=>{
    const bar=document.getElementById('sheetBar'), btn=${sheetBtnSel};
    return {defaultOpen:bar.classList.contains('open'),
            display:getComputedStyle(bar).display,
            btnText:btn.textContent,
            barBox:Math.round(bar.getBoundingClientRect().height),
            stageH:Math.round(document.getElementById('stage').getBoundingClientRect().height)};
  })()`);
  console.log('  ', JSON.stringify(r));
  const stageH0 = r.stageH;
  ck(!r.defaultOpen && r.display === 'none', '进页面时配置表默认不显示（不占底部空间）');
  ck(r.barBox === 0, '收起状态高度为 0（画布不被挤压）');
  ck(r.btnText === '式神配置', '方案栏按钮保持「式神配置」（空表不带行数徽标）');

  // 展开 -> 浮层抽屉；再收起 -> 彻底消失
  r = await ev(cdp, `(()=>{
    const btn=${sheetBtnSel};
    btn.click();
    const bar=document.getElementById('sheetBar');
    const open=bar.classList.contains('open'), pos=getComputedStyle(bar).position;
    const empty=!!document.getElementById('sheetEmpty');
    const hint=(document.getElementById('sheetEmpty')||{}).innerText||'';
    const label=document.getElementById('sheetToggle').textContent;
    const btnHi=btn.classList.contains('open');
    const stageH=Math.round(document.getElementById('stage').getBoundingClientRect().height);
    btn.click();
    return {open, pos, empty, hint, label, btnHi, stageH,
            back:bar.classList.contains('open'), btnText:btn.textContent};
  })()`);
  console.log('  ', JSON.stringify(r).slice(0, 260));
  ck(r.open && r.empty && r.hint.indexOf('添加一行') >= 0, '展开后显示空态引导文案');
  ck(r.pos === 'absolute', '配置表是浮层抽屉（position:absolute），不参与页面流式布局');
  ck(r.stageH === stageH0, '展开抽屉后画布高度不变（' + stageH0 + 'px -> ' + r.stageH + 'px）');
  ck(r.label === '收起 ▾' && !r.back && r.btnText === '式神配置', '可收起 / 展开，按钮文字跟着变');

  // 添加一行 -> 自动进入编辑态 -> 输入「阎魔」回车
  r = await ev(cdp, `(()=>{
    document.getElementById('sheetAdd').click();
    const tds=document.querySelectorAll('#sheetBody tbody tr');
    const last=tds[tds.length-1];
    if(!last) return {rows:0};
    const inp=last.children[1].querySelector('input');
    if(!inp) return {rows:tds.length, noInput:true};
    inp.value='阎魔';
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    const tr=document.querySelectorAll('#sheetBody tbody tr');
    const tdNow=tr[tr.length-1].children[1];
    const im=tdNow.querySelector('img');
    return {rows:tr.length, no:tr[tr.length-1].children[0].textContent,
            text:tdNow.innerText.trim(), hasImg:!!im,
            imgW:im?im.naturalWidth:0, imgAlt:im?im.alt:null,
            cnt:document.getElementById('sheetCnt').textContent};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.rows === 1 && String(r.no) === '1', '添加 1 行，序号自动为 1');
  ck(r.text === '阎魔', '回车保存后单元格显示「阎魔」');
  ck(r.hasImg && r.imgW > 0 && r.imgAlt === '阎魔', '式神列自动带出 26px 头像（' + r.imgAlt + ' ' + r.imgW + 'px）');
  ck(r.cnt === '1 行', '行数统计 = ' + r.cnt);
  await shot(cdp, '22-式神配置表.png');

  // 简称也能匹配到头像
  r = await ev(cdp, `(()=>{
    document.getElementById('sheetAdd').click();
    const tr=document.querySelectorAll('#sheetBody tbody tr');
    const inp=tr[tr.length-1].children[1].querySelector('input');
    inp.value='炎魔';
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    const last=document.querySelectorAll('#sheetBody tbody tr');
    const im=last[last.length-1].children[1].querySelector('img');
    return {rows:last.length, alt:im?im.alt:null, w:im?im.naturalWidth:0};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(r.rows === 2 && r.alt === '阎魔' && r.w > 0, '简称「炎魔」按别名匹配到阎魔头像');

  // 换方案 -> 表跟着换（互不影响）；示例方案里预填了两行范例
  const readSheet = `(()=>{
    const trs=[...document.querySelectorAll('#sheetBody tbody tr')];
    const cell=(tr,i)=>{const td=tr.children[i]; const im=td.querySelector('img');
      return {t:td.innerText.trim(), alt:im?im.alt:null, w:im?im.naturalWidth:0};};
    return {rows:trs.length,
            empty:!!document.getElementById('sheetEmpty'),
            cnt:document.getElementById('sheetCnt').textContent,
            btn:[...document.querySelectorAll('#schemeBar .barR button')].map(b=>b.textContent)[0],
            no:trs.map(t=>t.children[0].textContent).join('/'),
            r0:[1,2,3,4,5].map(i=>cell(trs[0],i)),
            r1:[1,2,3,4,5].map(i=>cell(trs[1],i))};
  })()`;
  await ev(cdp, `(()=>{
    [...document.querySelectorAll('#schemeBar .tab')].find(t=>t.firstChild.textContent==='示例方案-禅吞').click();
    return 1;
  })()`);
  await sleep(400);                          // 等头像解码完再读 naturalWidth
  r = await ev(cdp, readSheet);
  console.log('  ', JSON.stringify(r));
  ck(r.rows === 2 && !r.empty, '切到示例方案 -> 显示它自己的 2 行配置（方案间互不影响）');
  ck(r.cnt === '2 行' && r.btn === '式神配置 · 2', '行数徽标随之变成「式神配置 · 2」');
  ck(r.no === '1/2', '序号自动编号 1 / 2');
  ck(r.r0[0].alt === '阎魔' && r.r0[0].w > 0 && r.r0[1].t === '速度' &&
     r.r0[2].t === '散件' && r.r0[3].t === '速XX' && r.r0[4].t === '攻击>4600',
    '预填第 1 行 = 阎魔 / 速度 / 散件 / 速XX / 攻击>4600（式神列带 120px 头像）');
  ck(r.r1[0].alt === '鬼王酒吞童子' && r.r1[0].w > 0 && r.r1[1].t === '生命' &&
     r.r1[2].t === '火灵+防御两件套' && r.r1[3].t === '速生生' && r.r1[4].t === '速度>210',
    '预填第 2 行 = 鬼吞 / 生命 / 火灵+防御两件套 / 速生生 / 速度>210（简称「鬼吞」解析成 SP 鬼王酒吞童子头像）');
  await shot(cdp, '23-示例方案配置表.png');

  /* ================= 10. 示例 / 自建 标注 + 临时提醒 + 清缓存 ================= */
  console.log('== 10. 示例/自建 标注 + 切换方案时的临时提醒 ==');
  // 点一下当前激活的方案标签 -> 只闪提醒，不切方案
  await ev(cdp, `(()=>{ document.querySelector('#schemeBar .tab.on').click(); return 1; })()`);
  r = await ev(cdp, `({
    pins:${PINS},
    pinTips:[...document.querySelectorAll('#schemeBar .tab .pin')].map(p=>p.title),
    pinOf:Object.fromEntries([...document.querySelectorAll('#schemeBar .tab .pin')].map(p=>[p.textContent,p.title])),
    delCount:document.querySelectorAll('#schemeBar .tab .x').length,
    noteOn:document.getElementById('schemeNote').classList.contains('on'),
    note:document.getElementById('schemeNote').innerText,
    noteKids:document.getElementById('schemeNote').children.length,
    nbtn:document.querySelector('#schemeNote .nbtn')
  })`);
  console.log('  徽标 ->', JSON.stringify(r.pins), '| 提示:', JSON.stringify(r.pinTips));
  console.log('  提醒条:', r.note);
  ck(r.pinOf['示例'] === '示例导图，无法删除', '示例徽标提示 = ' + r.pinOf['示例']);
  ck(r.pinOf['自建'] === '自建导图，仅存本机浏览器', '自建徽标提示 = ' + r.pinOf['自建']);
  ck(r.delCount === r.pins.length - 1, '只有非示例方案带删除按钮（' + r.delCount + ' 个）');
  ck(r.noteOn && r.noteKids === 1, '切换方案后提醒条出现（只有一行）');
  ck(r.note.length < 140, '提醒条文案精简（' + r.note.length + ' 字）');
  ck(r.note.includes('清缓存') && r.note.includes('导出 JSON 备份'), '提醒条点出清缓存风险与导出备份');
  ck(!r.nbtn, '提醒条里不再有按钮（导出已移到方案栏）');
  await shot(cdp, '21-方案栏总览.png');

  // 不常驻：几秒后自动消失
  await sleep(4600);
  r = await ev(cdp, `({
    noteOn:document.getElementById('schemeNote').classList.contains('on'),
    opacity:getComputedStyle(document.getElementById('schemeNote')).opacity
  })`);
  console.log('  ', JSON.stringify(r));
  ck(!r.noteOn, '提醒条几秒后自动消失（不再常驻）');

  // 清缓存后示例方案必须还在、自建方案消失
  await ev(cdp, `(()=>{ try{localStorage.clear();}catch(e){} location.reload(); return 1; })()`);
  await sleep(2500);
  r = await ev(cdp, `({
    tabs:${TAB_NAMES}, pins:${PINS},
    noteOn:document.getElementById('schemeNote').classList.contains('on'),
    nodes:document.querySelectorAll('.node').length,
    brokenAv:[...document.querySelectorAll('.node img')].filter(i=>i.complete && i.naturalWidth===0).length
  })`);
  console.log('  ', JSON.stringify(r));
  ck(r.tabs.length === 1 && r.tabs[0] === '示例方案-禅吞', '清缓存后示例方案仍在');
  ck(r.pins.join(',') === '示例', '清缓存后只剩示例方案');
  ck(!r.noteOn, '没有自建方案时提醒条隐藏');
  ck(r.nodes >= 97 && r.brokenAv === 0, '清缓存后导图内容完整、头像无坏图（' + r.nodes + ' 节点）');

  try { fs.unlinkSync(IMP_JSON); } catch (e) {}

  /* ================= 11. 导出：JSON / 单 HTML / PNG =================
     不去接真实下载：把 <a download>.click() 拦下来，直接读它指向的 blob，
     这样能在页面里校验「真正被送出去的那份数据」长什么样。 */
  console.log('== 11. 导出：JSON / 单 HTML / PNG ==');
  await ev(`(()=>{
    window.__dl = [];
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){
      if(this.download){ window.__dl.push({name:this.download, href:this.href}); return; }
      return oc.apply(this, arguments);
    };
    window.__read = async (i) => {
      const d = window.__dl[i]; if(!d) return {none:true};
      const b = await (await fetch(d.href)).blob();
      return {name:d.name, size:b.size, type:b.type};
    };
    return 1;})()`);

  // 11a 导出面板
  await ev(`(()=>{[...document.querySelectorAll('#schemeBar .barR button')]
      .find(b=>b.textContent==='导出').click(); return 1;})()`);
  await sleep(250);
  r = await ev(`({open:document.getElementById('expBox').classList.contains('open'),
    opts:[...document.querySelectorAll('#expOpts .opt')].map(b=>b.dataset.k),
    name:document.getElementById('expName').textContent,
    hasTip:document.getElementById('expTip').textContent.length>0})`);
  console.log('  ', JSON.stringify(r));
  ck(r.open, '点「导出」弹出选择面板');
  ck(r.opts.join(',') === 'json,html,png', '三种导出方式都在（' + r.opts.join(' / ') + '）');
  ck(r.hasTip, '面板里有说明文字');
  await sleep(900);
  r = await ev(`({pack: !!window.__AV_INLINE__,
    n: window.__AV_INLINE__ ? Object.keys(window.__AV_INLINE__).length : 0,
    tip: document.getElementById('expTip').textContent})`);
  console.log('  ', JSON.stringify(r));
  ck(r.pack && r.n > 200, '★ 打开面板时会备好头像包（' + r.n + ' 张，file:// 下也能固化）');
  ck(/就绪|退化/.test(r.tip), '提示里说明了头像固化情况（' + r.tip + '）');
  await shot(cdp, '17-导出面板.png');

  // 11b JSON
  await ev(`(()=>{document.querySelector('#expOpts .opt[data-k="json"]').click(); return 1;})()`);
  await sleep(400);
  r = await ev(`(async()=>{
    const meta = await window.__read(window.__dl.length-1);
    if(meta.none) return {none:true};
    const txt = await (await fetch(window.__dl[window.__dl.length-1].href)).text();
    let ok=null, err=null;
    try{ const o = JSON.parse(txt); ok = {hasNodes:!!o.nodes, hasSheet:!!(o.sheet&&o.sheet.rows), builtin:o.builtin, id:o.id}; }
    catch(e){ err = String(e); }
    return {meta, ok, err, closed:!document.getElementById('expBox').classList.contains('open')};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(!r.none && !!r.ok, '导出 JSON：拿到真正落盘的那份数据');
  ck(!!r.ok && r.ok.hasNodes && r.ok.builtin === undefined, 'JSON 里是单个方案（带节点表、不带 builtin）');
  ck(!!r.ok && r.ok.hasSheet, 'JSON 里带着式神配置表');
  ck(r.closed, '导出完面板自动收起来');

  // 11c 单 HTML（只读）
  await ev(`(()=>{[...document.querySelectorAll('#schemeBar .barR button')]
      .find(b=>b.textContent==='导出').click(); return 1;})()`);
  await sleep(200);
  await ev(`(()=>{document.querySelector('#expOpts .opt[data-k="html"]').click(); return 1;})()`);
  await sleep(2500);
  r = await ev(`(async()=>{
    const d = window.__dl[window.__dl.length-1]; if(!d) return {none:true};
    const txt = await (await fetch(d.href)).text();
    const m = /<script id="cfg-embed"[^>]*>([\\s\\S]*?)<\\/script>/.exec(txt);
    let cfg=null; try{ cfg = JSON.parse(m[1].replace(/<\\\\\\//g,'</')); }catch(e){}
    return {name:d.name, size:txt.length,
      doctype: txt.indexOf('<!DOCTYPE html>')===0,
      ro: txt.indexOf('window.__READONLY__=1')>0,
      avi: txt.indexOf('window.__AV_INLINE__=')>0,
      avCount: (txt.match(/data:image\\//g)||[]).length,
      schemes: cfg && cfg.schemes ? cfg.schemes.length : -1,
      active: cfg ? cfg.activeScheme : null,
      nodes_inline: (txt.match(/<\\/script>/g)||[]).length};
  })()`);
  console.log('  ', JSON.stringify(r));
  ck(!r.none && r.doctype, '导出单 HTML：产物是完整 HTML（以 DOCTYPE 开头）');
  ck(r.ro, '★ 注入了只读开关 __READONLY__=1');
  ck(r.avi && r.avCount > 0, '★ 头像已内联进这个文件（' + r.avCount + ' 张 data 图）');
  ck(r.schemes === 1, '★ 产物里只装着这一个问题（实际 ' + r.schemes + ' 个方案）');
  ck((r.name || '').endsWith('.html'), '文件名后缀是 .html（' + r.name + '）');

  // 把这份产物落盘，开新标签验证它「看得 / 改不了」
  const EXPORT_HTML = 'dist/_export_smoke.html';
  const htmlTxt = await ev(`(async()=>{ const d=window.__dl[window.__dl.length-1];
    return await (await fetch(d.href)).text(); })()`);
  fs.writeFileSync(ROOT + EXPORT_HTML, htmlTxt);
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8123/' + EXPORT_HTML + '?t=' + Date.now() });
  await sleep(2600);
  r = await ev(`({nodes:document.querySelectorAll('.node').length,
    av:[...document.querySelectorAll('.node img')].filter(i=>i.complete&&i.naturalWidth>0).length,
    ro:document.documentElement.classList.contains('ro'),
    sideShown:getComputedStyle(document.getElementById('side')).display!=='none',
    barR:[...document.querySelectorAll('#schemeBar .barR button')].map(b=>b.textContent),
    sheetRows:document.querySelectorAll('#sheetBody tbody tr').length,
    editable:document.querySelectorAll('#sheetBody td.edit').length,
    del:document.querySelectorAll('#sheetBody td.del').length})`);
  console.log('  ', JSON.stringify(r));
  ck(r.nodes >= 97, '导出的单文件能自己画出导图（' + r.nodes + ' 个节点）');
  ck(r.av > 0, '离线打开也能看到头像（内联生效，' + r.av + ' 张正常加载）');
  ck(r.ro && !r.sideShown, '★ 只读：编辑面板不存在');
  // 只读版方案栏只留「式神配置」（带行数徽标），新建/复制/导出/导入 全撤
  ck(/^式神配置/.test(r.barR.join(',')) && !/新建|复制|导出|导入/.test(r.barR.join(',')),
    '★ 只读：方案管理按钮（新建 / 复制 / 导出 / 导入）全都撤掉（' + r.barR.join('/') + '）');
  ck(r.editable === 0 && r.del === 0, '★ 只读：配置表不可编辑、没有删除列');
  await shot(cdp, '18-导出的只读单文件.png');
  // 单击收起 / 展开仍然好使，且双击不开出编辑面板
  // 只读版单击收起仍然好使（收起是 display:none，节点还在 DOM 里，所以必须数「可见」的）
  const VIS = `[...document.querySelectorAll('.node')].filter(n=>getComputedStyle(n).display!=='none').length`;
  const before = await ev(VIS);
  await ev(`(()=>{const el=[...document.querySelectorAll('.node.clickable')].find(n=>!n.querySelector('.badge')) ||
      [...document.querySelectorAll('.node.clickable')][0];
    if(!el) return 0;
    el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;})()`);
  await sleep(400);
  r = await ev(`({nodes:${VIS}, open:document.getElementById('side').classList.contains('open')})`);
  ck(r.nodes < before, '★ 只读版单击仍能收起子树（' + before + ' -> ' + r.nodes + '）');
  ck(!r.open, '只读版单击不会弹出编辑面板');
  await ev(`(()=>{const el=document.querySelector('.node');
    el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 1;})()`);
  await sleep(300);
  r = await ev(`({open:document.getElementById('side').classList.contains('open')})`);
  ck(!r.open, '★ 只读版双击也打不开编辑面板');
  // 式神配置抽屉能展开
  await ev(`(()=>{document.getElementById('sheetToggle').click(); return 1;})()`);
  await sleep(300);
  r = await ev(`({open:document.getElementById('sheetBar').classList.contains('open'),
    rows:document.querySelectorAll('#sheetBody tbody tr').length})`);
  ck(r.open && r.rows >= 2, '★ 只读版能翻开式神配置表（' + r.rows + ' 行）');
  await shot(cdp, '19-只读版的配置表.png');
  fs.unlinkSync(ROOT + EXPORT_HTML);

  // 11d PNG：导图在上，式神配置表拼在下面
  await cdp.send('Page.navigate', { url: URL_PAGE });
  await sleep(1600);
  await ev(`(()=>{try{localStorage.clear()}catch(e){}; return 1})()`);
  await sleep(2400);
  await ev(`(()=>{
    window.__dl = [];
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){
      if(this.download){ window.__dl.push({name:this.download, href:this.href}); return; }
      return oc.apply(this, arguments);
    };
    window.__read = async (i) => { const d = window.__dl[i]; if(!d) return {none:true};
      const b = await (await fetch(d.href)).blob(); return {name:d.name, size:b.size, type:b.type}; };
    return 1;})()`);
  await ev(`(()=>{ if(!document.getElementById('sheetBar').classList.contains('open'))
      document.querySelector('#schemeBar .barR button').click(); return 1;})()`);
  await sleep(600);
  await ev(`(()=>{[...document.querySelectorAll('#schemeBar .barR button')]
      .find(b=>b.textContent==='导出').click(); return 1;})()`);
  await sleep(200);
  await ev(`(()=>{document.querySelector('#expOpts .opt[data-k="png"]').click(); return 1;})()`);
  await sleep(4000);
  r = await ev(`(async()=>{
    const metas=[]; for(let i=0;i<window.__dl.length;i++) metas.push(await window.__read(i));
    return metas;})()`);
  console.log('  ', JSON.stringify(r));
  const png = (r || []).find(v => v && (v.name || '').endsWith('.png'));
  ck(!!png, '导出 PNG：拿到文件');
  if (png) {
    ck(png.size > 20000, 'PNG 有实际内容（' + png.size + ' 字节）');
    ck(png.type === 'image/png', 'MIME 是 image/png（' + png.type + '）');
    const dim = await ev(`(async()=>{
      const b = await (await fetch(window.__dl[window.__dl.length-1].href)).blob();
      const head = new Uint8Array(await b.slice(0,8).arrayBuffer());
      const bd = await createImageBitmap(b);
      return {magic:[...head], w:bd.width, h:bd.height};})()`);
    console.log('  ', JSON.stringify(dim));
    ck(dim.magic.join(',') === '137,80,78,71,13,10,26,10', '文件头确实是 PNG');
    ck(dim.w > 800 && dim.h > 400, '尺寸合理（' + dim.w + '×' + dim.h + '）');
    ck(dim.h > dim.w * 0.4, '高度包含导出的式神配置表（不是只截了导图那一条）');
  }

  /* ================= 12. 拖节点（dx/dy）与右键菜单 ================= */
  console.log('== 12. 拖节点 + 右键菜单 ==');
  // 上一段导出 PNG 时把式神配置抽屉翻开了，它会盖住画布下沿 —— 先收起来再适应窗口，
  // 否则鼠标按在抽屉上，节点根本没接到事件（表现为「拖不动、右键也没菜单」）
  await ev(`(()=>{const bar=document.getElementById('sheetBar');
    if(bar && bar.classList.contains('open')) document.getElementById('sheetToggle').click();
    const fit=[...document.querySelectorAll('#tools button')].find(b=>/适应窗口/.test(b.textContent));
    if(fit) fit.click(); return 1;})()`);
  await sleep(700);
  r = await ev(`(()=>{
    let el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
    if(!el) return {found:false, why:'找不到 禅吞内战 节点'};
    let box=el.getBoundingClientRect();
    // 视口外的话鼠标落不到它身上，换一个确实可见的框（真实点击才有意义）
    if(box.top < 8 || box.bottom > innerHeight - 8 || box.left < 8 || box.right > innerWidth - 8){
      const vis=[...document.querySelectorAll('.node')].filter(n=>{const b=n.getBoundingClientRect();
        return b.width>40 && b.height>30 && b.top>8 && b.left>8 && b.bottom<innerHeight-8 && b.right<innerWidth-8;});
      if(vis.length) el=vis[0];
      box=el.getBoundingClientRect();
    }
    const cx=Math.round(box.left+box.width/2), cy=Math.round(box.top+box.height/2);
    const hit=document.elementFromPoint(cx,cy);
    return {found:true, x:cx, y:cy,
            left:Math.round(parseFloat(el.style.left)), top:Math.round(parseFloat(el.style.top)),
            title:el.textContent.slice(0,12), nid:(el.__inst && el.__inst.nid) || '',
            hitNode: !!(hit && hit.closest && hit.closest('.node')),
            hitWhat: hit ? (hit.id || hit.className || hit.tagName) : 'null'};})()`);
  console.log('  ', JSON.stringify(r));
  ck(r.found, '找得到用来试拖的节点' + (r.found ? '' : '（' + r.why + '）'));
  ck(r.found && r.hitNode, '鼠标落点确实在节点上（落在 ' + r.hitWhat + '）');
  if (r.found) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    // 移动的 button 必须是 'none'：写成 'left' 的话 Chrome 只认第一帧，位移会只走一小截（踩过）
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 30, y: r.y + 20, button: 'none', buttons: 1 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 60, y: r.y + 40, button: 'none', buttons: 1 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 60, y: r.y + 40, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
    const d = await ev(`(()=>{
      const el=[...document.querySelectorAll('.node')].find(n=>n.__inst && n.__inst.nid==='${r.nid}');
      if(!el) return {gone:true};
      return {left:Math.round(parseFloat(el.style.left)), top:Math.round(parseFloat(el.style.top)),
              open:document.getElementById('side').classList.contains('open'),
              sel:document.querySelectorAll('.node.sel').length};})()`);
    console.log('  ', JSON.stringify(d));
    ck(d.left - r.left >= 25 && d.top - r.top >= 15, '★ 拖完框真的挪了（Δ ' +
      (d.left - r.left) + ',' + (d.top - r.top) + '）');
    ck(d.open === false && d.sel === 0, '★ 拖完没有顺手弹出编辑面板（那下 click 被吃掉）');
    await shot(cdp, '14a-拖节点后.png');
    // 右键菜单：在拖过的那个框上右键，「复位位置」应该可用
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + 60, y: r.y + 40, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 60, y: r.y + 40, button: 'right', buttons: 0, clickCount: 1 });
    await sleep(250);
    const m = await ev(`(()=>{
      const cm=document.getElementById('ctxMenu');
      return {show:getComputedStyle(cm).display,
              items:[...cm.querySelectorAll('.mi')].map(x=>x.textContent),
              off:[...cm.querySelectorAll('.mi.off')].map(x=>x.textContent)};})()`);
    console.log('  ', JSON.stringify(m));
    ck(m.show !== 'none', '右键弹出了菜单');
    if (m.show !== 'none') {
      ck(m.items.join('/') === '编辑/添加子节点/添加同级节点/复位位置/删除节点', '菜单项 = ' + m.items.join(' / '));
      ck(m.off.indexOf('复位位置') < 0, '★ 刚拖过 -> 「复位位置」可用（灰项里没有它）');
    }
    await shot(cdp, '14b-节点右键菜单.png');
    r = await ev(`(()=>{
      const mi=[...document.getElementById('ctxMenu').querySelectorAll('.mi')].find(x=>x.textContent==='复位位置');
      if(!mi) return {left:null, show:getComputedStyle(document.getElementById('ctxMenu')).display, why:'菜单里没有「复位位置」'};
      mi.click();
      const el=[...document.querySelectorAll('.node')].find(n=>n.__inst && n.__inst.nid==='${r.nid}');
      return {left: el ? Math.round(parseFloat(el.style.left)) : null,
              show:getComputedStyle(document.getElementById('ctxMenu')).display};})()`);
    console.log('  ', JSON.stringify(r));
    ck(r.show === 'none', '点完菜单项菜单自己收了');
    ck(r.left !== null && r.left < d.left - 10, '★ 复位把框挪回自动排位（' + d.left + ' -> ' + r.left + '）');
  }

  try { fs.unlinkSync(IMP_JSON); } catch (e) {}
  await cdp.send('Page.close').catch(() => { });
  console.log(fails.length ? '\nSMOKE FAILED: ' + fails.length + ' 项 -> ' + fails.join(' | ') : '\nSMOKE ALL PASSED');
  // 内置静态服务的监听会让进程挂着，收完结果必须显式退出
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });

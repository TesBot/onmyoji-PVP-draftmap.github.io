/* 反向验证：把已知的两个「已经修好的坑」各自还原成坏代码，确认对应的断言真的会 FAIL。
   只在需要自证回归测试有效时跑；跑完自己删掉临时文件。
   A 例（浏览器）：点面板内的头像 → 老的冒泡写法会把编辑面板误关。
   B 例（Node）  ：expandNames 的悬空 else → 不在 aliases 表里的式神名被静默丢掉。 */
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');
const PORT = 9223;

const NEW_BLOCK_START = 'function isUIEl(t){';
const OLD_BLOCK = `window.addEventListener('click', ev=>{
  if(moved){ moved=false; return; }
  const t = ev.target;
  if(t && t.closest){
    if(t.closest('#side') || t.closest('#schemeBar') || t.closest('.node')) return;
    if(t.closest('#sheetBar')) return;
    if(t.closest('button')) return;
  }
  if(inUI(ev)) return;
  if(SEL && SEL.el) SEL.el.classList.remove('sel');
  SEL = null; closeSide();
});`;

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 用一份临时页面跑配置层全量校验，回来看它到底报没报 FAIL
function runCheck(file) {
  const r = spawnSync(process.execPath, ['src/check_cfg.js'],
    { env: Object.assign({}, process.env, { CHECK_HTML: file }), encoding: 'utf8' });
  const out = r.stdout || '';
  const failed = /FAILED: \d+ 项/.test(out);
  const passed = /ALL CHECKS PASSED/.test(out);
  // 既没 PASS 也没 FAILED = 用例自己崩了。这不能算「断言通过」，否则反向验证会骗人
  const crashed = !failed && !passed;
  const lines = (out.match(/^  FAIL .*$/gm) || []);
  if (crashed) lines.push('  [用例自身崩了] ' + out.trim().split(/\r?\n/).slice(-2).join(' | '));
  return { failed: failed || crashed, crashed: crashed, lines: lines };
}

class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    let seq = 0; const pend = new Map();
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    };
    return {
      async send(method, params = {}) {
        const id = ++seq;
        const rx = new Promise(res => pend.set(id, res));
        ws.send(JSON.stringify({ id, method, params }));
        const r = await rx;
        if (r.error) throw new Error(method + ': ' + JSON.stringify(r.error));
        return r.result;
      }
    };
  }
}

(async () => {
  // 造一份「老逻辑」的临时页面：把新的捕获判定整段换成老的单个冒泡监听
  const src = fs.readFileSync('index.html', 'utf8');
  const i = src.indexOf(NEW_BLOCK_START);
  if (i < 0) throw new Error('找不到新的 isUIEl 块');
  const j = src.indexOf('window.addEventListener(\'click\', ev=>{', i);       // 捕获监听
  const k = src.indexOf('});', src.indexOf('if(moved){ moved=false; return; }', j)) + 3;
  const neg = src.slice(0, i) + OLD_BLOCK + src.slice(k);
  fs.writeFileSync('_neg.html', neg);

  let targets = null, page = null;
  try { targets = await getJSON('/json/list'); } catch (e) { /* 没开无头 Chrome */ }
  if (!targets) {
    console.log('跳过 A 例（浏览器用例）：连不上 127.0.0.1:' + PORT +
      ' 的无头 Chrome。需要时先起 chrome --headless=new --remote-debugging-port=' + PORT);
  }
  if (targets) {
  page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {                                    // 上次跑完把标签关了，新开一个
    page = await new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?about:blank', method: 'PUT' },
        r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); });
      req.on('error', rej); req.end();
    });
  }
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const ev = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  };

  for (const [label, file] of [['老逻辑 _neg.html', '_neg.html'], ['新逻辑 index.html', 'index.html']]) {
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8123/' + file + '?t=' + Date.now() });
    await sleep(1200);
    await ev(`(()=>{try{localStorage.clear()}catch(e){}; return 1})()`);
    await sleep(2200);
    const t = await ev(`(()=>{
      const el=[...document.querySelectorAll('.node')].find(n=>n.textContent.includes('禅吞内战'));
      el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      const q=document.getElementById('ss_q'); q.value=''; q.oninput();
      document.getElementById('ss_grid').scrollIntoView({block:'center'});
      return 1;})()`);
    await sleep(300);
    const pt = await ev(`(()=>{const im=document.querySelector('#ss_grid img');
      const rc=im.getBoundingClientRect();
      return {x:Math.round(rc.left+rc.width/2), y:Math.round(rc.top+rc.height/2), name:im.title};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(350);
    const res = await ev(`({open:document.getElementById('side').classList.contains('open'),
      chips:[...document.querySelectorAll('#ss_now .chip')].length})`);
    console.log((res.open ? '面板留着  ' : '面板被关 ★') + '  [' + label + '] 点了「' + pt.name + '」 -> ' +
      JSON.stringify(res));
  }
  fs.unlinkSync('_neg.html');
  }

  /* ---------- B 例：expandNames 的悬空 else ---------- */
  // 注意 index.html 是 CRLF（构建时被转换），多行匹配必须用 \s* 跨行，别写字面换行
  const GOOD_RE = /if\(Array\.isArray\(hit\)\)\{\s*for\(const n of hit\) if\(out\.indexOf\(n\) < 0\) out\.push\(n\);\s*\}else if\(out\.indexOf\(raw\) < 0\)\{\s*out\.push\(raw\);\s*\}/;
  const BAD = `if(Array.isArray(hit)) for(const n of hit) if(out.indexOf(n)<0) out.push(n);` +
    `\r\n    else if(out.indexOf(raw)<0) out.push(raw);`;
  const m2 = GOOD_RE.exec(src);
  if (!m2) throw new Error('找不到修好后的 expandNames 写法（B 例失效）');
  fs.writeFileSync('_neg2.html', src.slice(0, m2.index) + BAD + src.slice(m2.index + m2[0].length));
  const r2 = runCheck('_neg2.html');
  const bad = r2.failed;
  const lines = r2.lines;
  fs.unlinkSync('_neg2.html');
  console.log((bad ? '断言生效  ' : '断言失效 ★') + '  [老 expandNames] 配置层应该报 FAIL -> ' + (bad ? 'FAILED' : 'ALL PASSED'));
  lines.slice(0, 4).forEach(l => console.log(l));
  const r3 = spawnSync(process.execPath, ['src/check_cfg.js'], { encoding: 'utf8' });
  console.log((/ALL CHECKS PASSED/.test(r3.stdout) ? '断言通过  ' : '断言失效 ★') + '  [修好后的 index.html] 配置层 ALL CHECKS PASSED');

  /* ---------- C 例：layout 版本同步（syncLayoutRev）被拿掉 ----------
     症状：老页面存过的 sharedNodeMode:"collapse" 把新版默认的 merge 压回去，
           表现就是「复用节点还是多画一个框」。 */
  const CALL_C = '  syncLayoutRev(cfg, raw);';
  if (src.indexOf(CALL_C) < 0) throw new Error('找不到 syncLayoutRev 调用（C 例失效）');
  fs.writeFileSync('_neg3.html', src.replace(CALL_C, ''));
  const rc = runCheck('_neg3.html');
  fs.unlinkSync('_neg3.html');
  console.log((rc.failed ? '断言生效  ' : '断言失效 ★') + '  [去掉 syncLayoutRev] 旧偏好反压新版 -> ' +
    (rc.failed ? 'FAILED' : 'ALL PASSED（说明 S 段没盯住）'));
  rc.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- D 例：validate 不深拷贝，CFG 与 EMBED 共用引用 ----------
     症状：往 cfg.layout 上写一次值，EMBED 那份「默认值」也被改掉，
           之后每次 validate 拿到的都已经是脏的默认值。 */
  const GOOD_D = '  const cfg = JSON.parse(JSON.stringify(deepMerge(EMBED, raw)));';
  if (src.indexOf(GOOD_D) < 0) throw new Error('找不到深拷贝那行（D 例失效）');
  fs.writeFileSync('_neg4.html', src.replace(GOOD_D, '  const cfg = deepMerge(EMBED, raw);'));
  const rd = runCheck('_neg4.html');
  fs.unlinkSync('_neg4.html');
  console.log((rd.failed ? '断言生效  ' : '断言失效 ★') + '  [validate 不深拷贝] EMBED 被写脏 -> ' +
    (rd.failed ? 'FAILED' : 'ALL PASSED（说明没人盯住这处）'));
  rd.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- E 例：汇合虚线又画回节点底下那层 ----------
     症状：长距离那条虚线被沿途的框盖住，看着像连到了别的框。 */
  const CALL_E = '  svgTop.innerHTML = pt;';
  if (src.indexOf(CALL_E) < 0) throw new Error('找不到汇合线那层的赋值（E 例失效）');
  fs.writeFileSync('_neg5.html', src.replace(CALL_E, ''));
  const re = runCheck('_neg5.html');
  fs.unlinkSync('_neg5.html');
  console.log((re.failed ? '断言生效  ' : '断言失效 ★') + '  [汇合线不在顶层] 会被框盖住 -> ' +
    (re.failed ? 'FAILED' : 'ALL PASSED（说明 N 段没盯住）'));
  re.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- F 例：发起复用的那个框上没有了「本框复用了」 ----------
     症状：解除复用只能跑到被复用的框上去做。 */
  // 注意：DOM 桩里 getElementById 永远返回一个元素（不会是 null），
  // 所以「把那段 HTML 删掉」骗不过它 —— 得让 sharedOut 算出来是空数组，面板才真的不长那段
  const SHARED_OUT = '  const sharedOut = (node.children || []).filter(cid=> sc.nodes[cid] && inRefs(cid).length > 1);';
  if (src.indexOf(SHARED_OUT) < 0) throw new Error('找不到 sharedOut 那行（F 例失效）');
  fs.writeFileSync('_neg6.html', src.replace(SHARED_OUT, '  const sharedOut = [];'));
  const rf = runCheck('_neg6.html');
  fs.unlinkSync('_neg6.html');
  console.log((rf.failed ? '断言生效  ' : '断言失效 ★') + '  [去掉本框复用了列表] 只能去被复用的框上解除 -> ' +
    (rf.failed ? 'FAILED' : 'ALL PASSED（说明 G 段没盯住）'));
  rf.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- G 例：被复用的框上又把「解除」入口加回来 ----------
     用户定的口径：解除只在源头那一处做，两头都能点很容易点错一侧。 */
  // index.html 是 CRLF（构建脚本经 Python 写出），拼多行字符串得按实际换行来，否则匹配不上
  const NL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const RX_LINE = [
    "      const x = document.createElement('span'); x.className = 'rx'; x.textContent = '✕';",
    "      x.title = '只解除「' + pid + ' → ' + n.nid + '」这一条引用，节点本身保留';",
    "      x.onclick = ()=>{",
    "        if(!confirm('解除这条复用？\\n' + pid + '（' + (sc.nodes[pid] ? sc.nodes[pid].title : '') + '）→ ' + n.nid +",
    "                    '\\n节点本身和其它引用都会保留。')) return;",
    "        sc.nodes[pid].children = sc.nodes[pid].children.filter(c => c !== n.nid);",
    "        saveLocal(); rebuild(true); reselect(n.nid);",
    "      };",
    "      row.appendChild(a); row.appendChild(b); row.appendChild(x);",
    "      refList.appendChild(row);"
  ].join(NL);
  const PLAIN = ["      row.appendChild(a); row.appendChild(b);", "      refList.appendChild(row);"].join(NL);
  if (src.indexOf(PLAIN) < 0) throw new Error('找不到只读的引用来源行（G 例失效）');
  fs.writeFileSync('_neg7.html', src.replace(PLAIN, RX_LINE));
  const rg = runCheck('_neg7.html');
  fs.unlinkSync('_neg7.html');
  console.log((rg.failed ? '断言生效  ' : '断言失效 ★') + '  [被复用的框上又给了 ✕] 两头都能点 -> ' +
    (rg.failed ? 'FAILED' : 'ALL PASSED（说明 G 段没盯住）'));
  rg.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- H 例：拖节点的偏移量没叠进布局 ----------
     症状：拖了半天框不动。 */
  const OFF_LINE = '    const off = nodeOffset(n.node);';
  if (src.indexOf(OFF_LINE) < 0) throw new Error('找不到偏移量那行（H 例失效）');
  fs.writeFileSync('_neg8.html', src.replace(OFF_LINE, '    const off = {x:0, y:0};'));
  const rh = runCheck('_neg8.html');
  fs.unlinkSync('_neg8.html');
  console.log((rh.failed ? '断言生效  ' : '断言失效 ★') + '  [偏移量没叠进布局] 拖了框不动 -> ' +
    (rh.failed ? 'FAILED' : 'ALL PASSED（说明 T 段没盯住）'));
  rh.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- I 例：「添加同级节点」不再挡边界 ----------
     症状：根节点 / 被多处复用的节点上也能加同级，插到哪儿说不清。 */
  const SIB_GUARD = '    disabled: pars.length !== 1,';
  if (src.indexOf(SIB_GUARD) < 0) throw new Error('找不到同级节点的边界判断（I 例失效）');
  fs.writeFileSync('_neg9.html', src.replace(SIB_GUARD, '    disabled: false,'));
  const ri = runCheck('_neg9.html');
  fs.unlinkSync('_neg9.html');
  console.log((ri.failed ? '断言生效  ' : '断言失效 ★') + '  [同级不挡边界] 根节点也能加同级 -> ' +
    (ri.failed ? 'FAILED' : 'ALL PASSED（说明 T 段没盯住）'));
  ri.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- J 例：拖完那一下 click 没被吃掉 ----------
     症状：拖完放开，节点顺手被折叠了（或弹出编辑面板）。 */
  const EAT_CLICK = "    if(ND_MOVED){ ND_MOVED = false; return; }       // 刚才是拖动，不是单击";
  if (src.indexOf(EAT_CLICK) < 0) throw new Error('找不到拖动后吃掉 click 那行（J 例失效）');
  fs.writeFileSync('_neg10.html', src.replace(EAT_CLICK, ''));
  const rj = runCheck('_neg10.html');
  fs.unlinkSync('_neg10.html');
  console.log((rj.failed ? '断言生效  ' : '断言失效 ★') + '  [拖完的 click 没被吃掉] 顺手折叠/弹面板 -> ' +
    (rj.failed ? 'FAILED' : 'ALL PASSED（说明 T 段没盯住）'));
  rj.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- K 例：右键只挂 contextmenu，没有 mousedown 兜底 ----------
     症状：某些环境/输入方式根本不派 contextmenu，用户看到的就是「右键一点反应都没有」。 */
  const CTX_FALLBACK = "world.addEventListener('mousedown', ev=>{ if(ev.button === 2) ctxTrigger(ev); });";
  if (src.indexOf(CTX_FALLBACK) < 0) throw new Error('找不到右键 mousedown 兜底（K 例失效）');
  fs.writeFileSync('_neg11.html', src.replace(CTX_FALLBACK, ''));
  const rk = runCheck('_neg11.html');
  fs.unlinkSync('_neg11.html');
  console.log((rk.failed ? '断言生效  ' : '断言失效 ★') + '  [右键只靠 contextmenu] 不派发时就毫无反应 -> ' +
    (rk.failed ? 'FAILED' : 'ALL PASSED（说明 T 段没盯住）'));
  rk.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- L 例：菜单放回 #stage 里 ----------
     症状：被 #stage 的 overflow:hidden 裁掉，靠右/靠下时整块看不见。 */
  const CTX_HOME = '<div id="ctxMenu"></div>';
  if (src.indexOf(CTX_HOME) < 0) throw new Error('找不到 #ctxMenu 骨架（L 例失效）');
  const moved = src.replace(CTX_HOME + '\n', '')
                   .replace('<div id="world"><svg id="wires"></svg><svg id="wiresTop"></svg></div>',
                            '<div id="world"><svg id="wires"></svg><svg id="wiresTop"></svg></div>\n  ' + CTX_HOME);
  fs.writeFileSync('_neg12.html', moved);
  const rl = runCheck('_neg12.html');
  fs.unlinkSync('_neg12.html');
  console.log((rl.failed ? '断言生效  ' : '断言失效 ★') + '  [菜单放回 #stage] 被 overflow:hidden 裁掉 -> ' +
    (rl.failed ? 'FAILED' : 'ALL PASSED（说明 T 段没盯住）'));
  rl.lines.slice(0, 3).forEach(l => console.log(l));

  /* ---------- M 例：顶栏按钮不按发布版刷新 ----------
     症状：老页面把「编辑 / 配置」存进了 localStorage，打开新版还是那 5 个按钮。 */
  const UI_SYNC = '  syncUiButtons(cfg, raw);';
  if (src.indexOf(UI_SYNC) < 0) throw new Error('找不到 syncUiButtons 调用（M 例失效）');
  fs.writeFileSync('_neg13.html', src.replace(UI_SYNC, ''));
  const rm = runCheck('_neg13.html');
  fs.unlinkSync('_neg13.html');
  console.log((rm.failed ? '断言生效  ' : '断言失效 ★') + '  [顶栏不刷新] 旧本地配置把「编辑」压回来 -> ' +
    (rm.failed ? 'FAILED' : 'ALL PASSED（说明 S 段没盯住）'));
  rm.lines.slice(0, 3).forEach(l => console.log(l));
  process.exit(0);
})();

// 配置驱动版校验：布局正确性 + 配置校验兜底
// 布局断言：无 NaN / 无重叠 / 无孤立方框 / 无幽灵节点 / 连线数==可见边数
// 配置断言：非法字段降级为默认值并列告警；悬空 id、成环、空方案等均能兜底且不崩
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');                    // 仓库根
const CFG0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
// 默认校验仓库根的正品页面；CHECK_HTML 可指向一份故意改坏的副本，
// 用来反向验证「某条断言真的抓得到这个 bug」（见 src/neg_check.js 的 B 例）
const HTML_FILE = process.env.CHECK_HTML || 'index.html';
const html = fs.readFileSync(path.join(ROOT, HTML_FILE), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

const SZ = {
  AV: CFG0.style.avatar.size, AVGAP: CFG0.style.avatar.gap,
  FS: CFG0.style.font.node, LH: CFG0.style.lineHeight,
  PADX: CFG0.style.node.padX, PADY: CFG0.style.node.padTop + CFG0.style.node.padBottom,
  MINW: CFG0.style.node.minWidth, MAXW: CFG0.style.node.maxWidth,
};

function mkStyle() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'setProperty' || k === 'removeProperty') return () => {};
      if (k === 'getPropertyValue') return () => '';
      return t[k] === undefined ? '' : t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase(); this.children = []; this.parentEl = null;
    this.style = mkStyle(); this.dataset = {}; this._cls = new Set();
    this._tc = ''; this._html = '';                 // textContent 优先；没设过就从 innerHTML 剥标签
    this.title = ''; this._attrs = {}; this._listeners = {}; this._w = 0; this._h = 0;
    this.classList = {
      add: c => this._cls.add(c), remove: c => this._cls.delete(c), contains: c => this._cls.has(c),
      toggle: (c, f) => { const h = this._cls.has(c), w = f === undefined ? !h : !!f; w ? this._cls.add(c) : this._cls.delete(c); return w; }
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  // 真实 DOM 里 innerHTML 会决定 textContent；桩里补上「没显式设过就剥标签」的取法
  get textContent() { return this._tc ? this._tc : (this._html ? this._html.replace(/<[^>]*>/g, '') : ''); }
  set textContent(v) { this._tc = String(v == null ? '' : v); }
  appendChild(c) { c.parentEl = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  remove() { if (this.parentEl) this.parentEl.removeChild(this); }
  replaceWith(n) { if (this.parentEl) { const i = this.parentEl.children.indexOf(this); this.parentEl.children[i] = n; n.parentEl = this.parentEl; } }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  focus() { this._focused = true; }               // 桩：输入框聚焦 / 全选是空操作
  select() { }
  blur() { this._focused = false; if (this.onblur) this.onblur(); }
  querySelector(s) { return this._find(s); }
  querySelectorAll(s) { const r = []; this._walk(e => { if (this._match(e, s)) r.push(e); }); return r; }
  closest(s) { let n = this; while (n) { if (this._match(n, s)) return n; n = n.parentEl; } return null; }
  _match(e, s) { if (s.startsWith('.')) return e._cls.has(s.slice(1)); if (s.startsWith('#')) return e._attrs.id === s.slice(1); return e.tagName === s.toUpperCase(); }
  _find(s) { let r = null; this._walk(e => { if (!r && this._match(e, s)) r = e; }); return r; }
  _walk(f) { for (const c of this.children) { f(c); c._walk(f); } }
  measure() {
    if (!this._cls.has('node')) return { w: 0, h: 0 };
    const camp = this.dataset.camp;
    const avs = this.children.find(c => c._cls.has('avs'));
    const txt = this.children.find(c => c._cls.has('txt'));
    const yh = this.children.find(c => c._cls.has('yh'));
    const auto = (camp === 'root' || camp === 'free');
    const padX = auto ? 52 : SZ.PADX * 2;
    const fs = camp === 'root' ? 22 : (camp === 'free' ? 17 : SZ.FS);
    const inner = auto ? 10000 : (SZ.MAXW - SZ.PADX * 2);
    let avW = 0, avRows = 0;
    if (avs && avs.children.length) {
      const n = avs.children.length;
      const perRow = Math.max(1, Math.floor((inner + SZ.AVGAP) / (SZ.AV + SZ.AVGAP)));
      avRows = Math.ceil(n / perRow);
      avW = Math.min(n, perRow) * (SZ.AV + SZ.AVGAP) - SZ.AVGAP;
    }
    const s = txt ? txt.textContent : '';
    const cjk = (s.match(/[^\x00-\xff]/g) || []).length;
    const eff = cjk * fs + (s.length - cjk) * fs * 0.55;
    const textW = Math.min(eff, inner);
    const rows = Math.max(1, Math.ceil(eff / inner));
    let yhW = (yh && yh.children.length)
      ? yh.children.reduce((a, c) => a + c.textContent.length * 12 + 20, 0) : 0;
    yhW = Math.min(yhW, inner);
    // 「复用」折叠节点额外一行提示
    const refExtra = this.children.some(c => c._cls.has('refmark')) ? 22 : 0;
    const contentW = Math.max(avW, textW, yhW);
    const w = auto ? Math.max(contentW, 100) + padX
                   : Math.min(SZ.MAXW, Math.max(SZ.MINW, contentW + padX));
    const h = SZ.PADY + (avRows ? avRows * (SZ.AV + SZ.AVGAP) - SZ.AVGAP + 8 : 0)
            + rows * fs * SZ.LH + (yh ? 27 : 0) + refExtra;
    return { w: Math.round(w), h: Math.round(h) };
  }
  get offsetWidth() { if (!this._w) { const s = this.measure(); this._w = s.w; this._h = s.h; } return this._w; }
  get offsetHeight() { if (!this._h) { const s = this.measure(); this._w = s.w; this._h = s.h; } return this._h; }
  get clientWidth() { return 1600; }
  get clientHeight() { return 900; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 900 }; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v == null ? '' : v); this._tc = ''; this.children = stubChildren(this._html); }
  // 导出「单 HTML」时要读 SRC_HTML = documentElement.outerHTML，桩里就返回整份 HTML 文本
  get outerHTML() { return this._html || ''; }
}

/* 把 innerHTML 里的顶层标签粗略还原成子节点，使「清空/重绘」在桩里也真实生效 */
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'path', 'circle',
  'rect', 'line', 'polyline', 'polygon', 'use', 'source', 'col', 'area', 'base', 'embed', 'track', 'wbr']);
function topTags(html) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, depth = 0, cur = null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    const attrs = m[3] || '', self = m[4] === '/' || VOID_TAGS.has(tag);
    if (closing) {
      if (depth > 0) { depth--; if (depth === 0 && cur) { cur.inner = html.slice(cur._o, m.index); out.push(cur); cur = null; } }
      continue;
    }
    if (depth === 0) { cur = { tag, attrs, inner: '', _o: re.lastIndex }; if (self) { out.push(cur); cur = null; } else depth = 1; }
    else depth++;
  }
  if (cur) out.push(cur);
  return out;
}
function stubChildren(html) {
  if (!html) return [];
  return topTags(html).map(t => {
    const e = new El(t.tag), re = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let m; while ((m = re.exec(t.attrs))) {
      const k = m[1].toLowerCase();
      if (k === 'class') e.className = m[2]; else e._attrs[k] = m[2];
    }
    e._html = t.inner || '';        // 保留内层文字：title/span 之类的 textContent 才读得出来
    return e;
  });
}
const reg = {};
const get = id => (reg[id] = reg[id] || Object.assign(new El('div'), { _attrs: { id } }));
['stage', 'world', 'wires', 'wiresTop', 'ctxMenu', 'ttl', 'tools', 'side', 'sideTitle', 'sideBody', 'sideFoot', 'schemeBar'].forEach(get);
let EMBED_EL = new El('script');
EMBED_EL._attrs.id = 'cfg-embed';
EMBED_EL.textContent = JSON.stringify(CFG0);
reg['cfg-embed'] = EMBED_EL;

const document = {
  documentElement: new El('html'), body: new El('body'),
  createElement: t => new El(t), getElementById: get,
  querySelectorAll: s => get('world').querySelectorAll(s), addEventListener: () => {}
};
// 给撑起一份「页面原始骨架」（含 cfg-embed 原本的内容），
// 这样模板里 SRC_HTML = documentElement.outerHTML 能拿到东西，导出单 HTML 的那条路径才测得动
const __DOCELS = ['expBox', 'expName', 'expOpts', 'expTip', 'expClose',
                  'sheetAdd', 'sheetToggle', 'sheetBody', 'sheetCnt'].forEach(get);
document.documentElement._html =
  '<html lang="zh-CN"><head><title>t</title><style>a{}</style></head><body>' +
  '<div id="app"></div>' +
  '<script id="cfg-embed" type="application/json">' + EMBED_EL.textContent + '</scr' + 'ipt>' +
  '<script>/* main */</scr' + 'ipt></body></html>';
// 页面里会看 location.protocol 决定要不要挂头像包；桩里按 http 走（不触发那条分支）
const location = { protocol: 'http:', href: 'http://127.0.0.1:8123/index.html' };
const winL = {};
// 捕获标记挂在 window 桩自己身上：new Function 里的代码看不到外面的变量
const window = { addEventListener: (t, f, cap) => {
  (winL[t] = winL[t] || []).push(f);
  (window.__cap[t] = window.__cap[t] || []).push(!!cap);
}, __cap: {} };

/* 交互桩：prompt / confirm / alert / localStorage 在 Node 里不存在，用可编排的假实现 */
let PROMPT_ANSWER = null, CONFIRM_ANSWER = true;
const ALERT_LOG = [];
const stubPrompt = () => PROMPT_ANSWER;
const stubConfirm = () => CONFIRM_ANSWER;
const stubAlert = m => { ALERT_LOG.push(String(m)); };
const LS = {};
const stubLS = {
  getItem: k => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
  removeItem: k => { delete LS[k]; },
  clear: () => { for (const k in LS) delete LS[k]; }
};

const api = new Function('document', 'window', 'console', 'prompt', 'confirm', 'alert',
  'localStorage', 'XMLHttpRequest', 'location', code + `
;return {
  validate: validate, getCFG: ()=>CFG, getWARN: ()=>WARN,
  getROOTS: ()=>ROOTS, getBB: ()=>BB, layout: layout, rebuild: rebuild,
  setCFG: (c)=>{CFG=c;}, expandNames: expandNames, scheme: scheme,
  newScheme: newScheme, copyScheme: copyScheme, newNodeId: newNodeId,
  findInst: findInst, openPicker: openPicker, selectNode: selectNode,
  getSEL: ()=>SEL, buildSchemeBar: buildSchemeBar,
  loadLocal: loadLocal, saveLocal: saveLocal, clearLocal: clearLocal,
  fetchExt: fetchExt, getLSKEY: ()=>LS_KEY,
  getStage: ()=>stage, getView: ()=>({sc:sc_, tx:tx, ty:ty}), getDrag: ()=>dragging,
  inUI: inUI,
  setPublished: setPublished, publishedSchemes: publishedSchemes,
  setPublishedList: setPublishedList, setPublishedBase: setPublishedBase,
  publishedBase: publishedBase, syncLayoutRev: syncLayoutRev,
  getPubBase: ()=>PUB_BASE,
  mergePublished: mergePublished, localSchemes: localSchemes,
  newSchemeId: newSchemeId, flashNote: flashNote,
  normSheet: normSheet, SHEET_HEADERS: SHEET_HEADERS,
  renderSheet: renderSheet, addSheetRow: addSheetRow, toggleSheet: toggleSheet,
  mergeEdges: mergeEdges, getMergeEdges: ()=>MERGE_EDGES, getFirst: ()=>FIRST_INST,
  scheme: ()=>scheme(),
  moveScheme: moveScheme, uniqueSchemeId: uniqueSchemeId,
  schemeExportJson: schemeExportJson, schemesFromJson: schemesFromJson,
  addSchemes: addSchemes, slug: slug, pageConfigOf: pageConfigOf,
  exportScheme: openExport, runExport: runExport, importScheme: importScheme,
  viewerConfig: viewerConfig, buildViewerHtml: buildViewerHtml,
  collectAvatarData: collectAvatarData, schemeAvatarNames: schemeAvatarNames,
  visibleInsts: visibleInsts, measureNode: measureNode, wrapText: wrapText,
  getREADONLY: ()=>READONLY, openExportBox: openExport, closeExportBox: closeExport,
  isUIEl: isUIEl, getWinCap: ()=>window.__cap,
  openCtx: openCtx, closeCtx: closeCtx, ctxItems: ctxItems, parentOf: parentOf,
  ctxTrigger: ctxTrigger, ctxMenuEl: ()=>ctxMenu,
  nodeOffset: nodeOffset, getND: ()=>ND, getNDMoved: ()=>ND_MOVED,
  setNDMoved: v=>{ ND_MOVED = v; }, NODE_DRAG_MIN: NODE_DRAG_MIN
};`)(document, window, console, stubPrompt, stubConfirm, stubAlert, stubLS, undefined, location);

let FAIL = 0;
function ok(cond, msg) { if (!cond) { FAIL++; console.log('  FAIL  ' + msg); } }

// A~I 段把 validate() 当纯配置校验函数用，先关掉「示例方案同步」，J 段再单独验证它
api.setPublishedList([]);

/* ---------- A. 布局正确性 ---------- */
function laidSet() {
  const s = new Set();
  for (const r of api.getROOTS()) (function w(n) {
    s.add(n); if (!n.collapsed) for (const c of n.children) w(c);
  })(r);
  return s;
}
function checkLayout(tag) {
  const laid = laidSet(), L = [...laid];
  let nan = 0, ov = 0;
  for (const n of L) if (![n.x, n.y, n.w, n.h].every(v => typeof v === 'number' && isFinite(v))) {
    nan++; if (nan <= 3) console.log('  ! NaN: ' + n.node.title);
  }
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) {
      ov++; if (ov <= 2) console.log('  ! 重叠: ' + a.node.title + ' <-> ' + b.node.title);
    }
  }
  let orphan = 0, ghost = 0;
  get('world').querySelectorAll('.node').forEach(e => {
    const vis = e.style.display !== 'none';
    let n = null;
    for (const x of allInst()) if (x.el === e) { n = x; break; }
    if (!n) return;
    if (vis && !laid.has(n)) orphan++;
    if (!vis && laid.has(n)) ghost++;
  });
  let edges = 0;
  for (const n of laid) if (!n.collapsed) edges += n.children.length;
  edges += api.mergeEdges().length;          // merge 模式：汇合的虚线箭头也算一条边
  const paths = wirePathCount();
  console.log('  %s | 节点 %d | NaN %d | 重叠 %d | 孤立 %d | 幽灵 %d | 连线 %d/%d %s',
    tag.padEnd(12), L.length, nan, ov, orphan, ghost, paths, edges,
    (nan || ov || orphan || ghost || paths !== edges) ? 'FAIL' : 'OK');
  ok(!nan && !ov && !orphan && !ghost && paths === edges, tag);
}
function allInst() {
  const out = [];
  for (const r of api.getROOTS()) (function w(n) { out.push(n); for (const c of n.children) w(c); })(r);
  return out;
}
/* 真正的连线数：defs/marker 里的箭头图形不算，汇合虚线的底衬也不算。
   汇合线画在 #wiresTop 那一层（压在节点之上），所以两层都要数。 */
function wirePathCount() {
  let n = 0;
  for (const id of ['wires', 'wiresTop']) {
    const h = get(id).innerHTML || '';
    const mk = (/<marker[\s\S]*?<\/marker>/g.exec(h) || [''])[0];
    const all = (h.match(/<path /g) || []).length - (mk.match(/<path /g) || []).length;
    const casing = (h.match(/<path [^>]*data-casing/g) || []).length;
    n += all - casing;
  }
  return n;
}

console.log('=== A. 布局 ===');
checkLayout('默认全展开');
(function foldTop() {
  for (const r of api.getROOTS()) (function f(n, d) {
    n.collapsed = d >= 1; if (!n.collapsed) for (const c of n.children) f(c, d + 1);
  })(r, 0);
  api.layout();
})();
checkLayout('只留体系');
(function all() { for (const n of allInst()) n.collapsed = false; api.layout(); })();
checkLayout('恢复全展开');

let seed = 20261016;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const branchable = allInst().filter(n => n.children.length);
let bad = 0;
for (let t = 0; t < 200; t++) {
  for (const n of allInst()) n.collapsed = false;
  const k = 1 + Math.floor(rnd() * branchable.length);
  for (let i = 0; i < k; i++) branchable[Math.floor(rnd() * branchable.length)].collapsed = true;
  api.layout();
  const laid = laidSet(), L = [...laid];
  let e = 0;
  for (const n of L) if (![n.x, n.y, n.w, n.h].every(v => isFinite(v))) e++;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) e++;
  }
  let edges = 0; for (const n of laid) if (!n.collapsed) edges += n.children.length;
  edges += api.mergeEdges().length;
  if (wirePathCount() !== edges) e++;
  if (e) { bad++; if (bad === 1) console.log('  ! 随机场景首次失败于第 ' + t + ' 轮'); }
}
console.log('  随机折叠 200 轮：失败 ' + bad + ' 轮');
ok(bad === 0, '随机折叠压力测试');
for (const n of allInst()) n.collapsed = false;
api.layout();
const bb = api.getBB();
console.log('  全展开画布 = %d x %d', Math.round(bb.w), Math.round(bb.h));

/* ---------- B. 配置校验兜底 ---------- */
console.log('\n=== B. 配置校验兜底 ===');
function t(name, raw, expect) {
  let c, w = [];
  try {
    c = api.validate(raw);
    w = api.getWARN();
  } catch (e) {
    console.log('  FAIL  ' + name + ' -> 抛异常: ' + e.message); FAIL++; return;
  }
  const hit = expect.kw ? w.some(x => x.indexOf(expect.kw) >= 0) : true;
  const val = expect.check ? expect.check(c) : true;
  const good = hit && val;
  console.log('  %s | 告警 %d 条 %s %s', name.padEnd(22), w.length,
    good ? 'OK' : 'FAIL', good ? '' : '(期望关键字: ' + expect.kw + ')');
  ok(good, name + ' 兜底');
}

// layout 带 rev（= 当前版本）时才会走「逐字段兜底」这条路；不带 rev 表示这是旧版存下来的
// 整份视图设置，会被 syncLayoutRev 整体换成发布版（那条单独在 S 段测）
t('hGap 传字符串', { layout: { rev: CFG0.layout.rev, hGap: 'abc' } },
  { kw: 'layout.hGap', check: c => c.layout.hGap === 54 });
t('avatar.size 越界', { style: { avatar: { size: 500 } } },
  { kw: 'style.avatar.size', check: c => c.style.avatar.size === 40 });
t('sharedNodeMode 非法', { layout: { rev: CFG0.layout.rev, sharedNodeMode: 'xxx' } },
  { kw: 'sharedNodeMode', check: c => c.layout.sharedNodeMode === 'merge' });
t('startTheme 非法', { style: { startTheme: 'blue' } },
  { kw: 'startTheme', check: c => c.style.startTheme === 'light' });
t('minWidth > maxWidth', { style: { node: { minWidth: 500, maxWidth: 300 } } },
  { kw: 'maxWidth', check: c => c.style.node.maxWidth > c.style.node.minWidth });
t('children 悬空 id', { schemes: [{ id: 's1', name: 'T', start: 'a', floating: [], nodes: { a: { id: 'a', title: 'A', camp: 'root', children: ['ghost'] } } }] },
  { kw: '不存在的 id', check: c => c.schemes[0].nodes.a.children.length === 0 });
t('成环 A->B->A', { schemes: [{ id: 's1', name: 'T', start: 'a', floating: [], nodes: { a: { id: 'a', title: 'A', camp: 'root', children: ['b'] }, b: { id: 'b', title: 'B', camp: 'mine', children: ['a'] } } }] },
  { kw: '环', check: c => c.schemes[0].nodes.b.children.length === 0 });
t('schemes 为空数组', { schemes: [] },
  { kw: 'schemes', check: c => c.schemes.length === 1 && !!c.schemes[0].start });
t('activeScheme 不存在', { activeScheme: 'nope' },
  { kw: 'activeScheme', check: c => !!c.schemes.find(s => s.id === c.activeScheme) });
t('节点缺 title', { schemes: [{ id: 's1', name: 'T', start: 'a', floating: [], nodes: { a: { id: 'a', camp: 'mine', children: [] } } }] },
  { kw: '缺 title', check: c => c.schemes[0].nodes.a.title === 'a' });
t('camp 非法', { schemes: [{ id: 's1', name: 'T', start: 'a', floating: [], nodes: { a: { id: 'a', title: 'A', camp: 'wat', children: [] } } }] },
  { kw: 'camp 不合法', check: c => c.schemes[0].nodes.a.camp === 'neutral' });
t('shishen 不是数组', { schemes: [{ id: 's1', name: 'T', start: 'a', floating: [], nodes: { a: { id: 'a', title: 'A', camp: 'mine', shishen: '阎魔', children: [] } } }] },
  { kw: 'shishen', check: c => Array.isArray(c.schemes[0].nodes.a.shishen) });
t('空对象（全缺）', {}, { check: c => !!(c && c.layout && c.style && c.schemes.length) });
t('null（最坏情况）', null, { check: c => !!(c && c.layout && c.schemes.length) });

/* ---------- C. 非法配置也能渲染 ---------- */
console.log('\n=== C. 非法配置渲染不崩 ===');
[null, {}, { layout: { hGap: 'x', vGap: null } },
 { schemes: [{ id: 's1', name: 'T', start: 'zzz', floating: [], nodes: { a: { id: 'a', title: 'A', camp: 'zz', children: ['a'] } } }] }
].forEach((raw, i) => {
  try {
    api.setCFG(api.validate(raw));
    api.rebuild();
    const n = laidSet().size;
    console.log('  用例 %d -> 渲染成功，可见节点 %d  OK', i + 1, n);
  } catch (e) {
    console.log('  用例 %d -> 抛异常: %s  FAIL', i + 1, e.message); FAIL++;
  }
});

/* ---------- D. 简称展开 ---------- */
console.log('\n=== D. 简称展开 ===');
api.setCFG(api.validate(null));
const cases = [['禅吞', ['禅心云外镜', '鬼王酒吞童子']], ['炎魔', ['阎魔']], ['摩托', ['大夜摩天阎魔']], ['神乐', ['__神乐__']]];
for (const [input, want] of cases) {
  const got = api.expandNames(input);
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log('  %s -> %s %s', input.padEnd(6), JSON.stringify(got), good ? 'OK' : 'FAIL 期望 ' + JSON.stringify(want));
  ok(good, '简称展开 ' + input);
}
// 回归（真踩过）：`if(Array.isArray(hit)) for(...) if(...) push(n); else if(...) push(raw);`
// 的 else 会粘到 for 体内那个 if 上，导致**不在 aliases 表里的名字被整批静默丢掉**。
// 头像库 276 个式神里有 253 个不是 aliases 的键 —— 表现就是「在面板里选了式神、点应用没反应」。
const AV_NAMES = Object.keys(api.getCFG().assets.avatarIndex);
const dropped = AV_NAMES.filter(n => api.expandNames(n).indexOf(n) < 0);
ok(AV_NAMES.length > 100, '头像库读得到（实际 ' + AV_NAMES.length + ' 个）');
ok(dropped.length === 0, '头像库里每个式神名都能原样展开（被丢掉 ' + dropped.length +
  ' 个：' + dropped.slice(0, 6).join('/') + '…）');
const mixed = api.expandNames('禅心云外镜、鬼王酒吞童子、一反木绵');
ok(JSON.stringify(mixed) === JSON.stringify(['禅心云外镜', '鬼王酒吞童子', '一反木绵']),
  'aliases 键 + 普通名混排时一个都不能少（实际 ' + JSON.stringify(mixed) + '）');
ok(JSON.stringify(api.expandNames('某个不存在的名字')) === JSON.stringify(['某个不存在的名字']),
  '别名表里没有的名字原样保留（自由文本不能被静默吃掉）');
ok(JSON.stringify(api.expandNames('禅吞')) === JSON.stringify(['禅心云外镜', '鬼王酒吞童子']),
  '别名键仍然展开成多项');
ok(JSON.stringify(api.expandNames('阎魔,阎魔,炎魔')) === JSON.stringify(['阎魔']), '重复项去重');
console.log('  别名展开 ' + cases.length + ' 例 + 头像库 ' + AV_NAMES.length + ' 个名字全量回环 OK');

/* ---------- E. 汇合（DAG）：多路径指向同一套方案 ---------- */
console.log('\n=== E. 汇合（DAG）===');
const dagRaw = {
  activeScheme: 'dag',
  schemes: [{
    id: 'dag', name: '汇合测试', start: 'a', floating: [],
    nodes: {
      a: { id: 'a', title: '我方1手：禅吞', camp: 'root', shishen: ['禅心云外镜'], children: ['b', 'c'] },
      b: { id: 'b', title: '敌方A：先出毗', camp: 'enemy', shishen: ['毗沙门天'], children: ['s'] },
      c: { id: 'c', title: '敌方B：先出龙珏', camp: 'enemy', shishen: ['龙珏'], children: ['s'] },
      s: { id: 's', title: '共享：我方5手方案', camp: 'mine', shishen: ['阎魔'], children: ['d'] },
      d: { id: 'd', title: '后续收尾', camp: 'mine', shishen: [], children: [] }
    }
  }]
};
api.setCFG(api.validate(dagRaw));
api.getCFG().layout.sharedNodeMode = 'collapse';   // 这一段专测老行为：每个引用处一个副本
api.rebuild();
const R0 = api.getROOTS()[0];
const b1 = R0.children[0], c1 = R0.children[1];
ok(b1.nid === 'b' && c1.nid === 'c', '根节点挂了两条敌方分支');
ok(b1.children[0] && b1.children[0].nid === 's', '分支 A 指向共享方案');
ok(c1.children[0] && c1.children[0].nid === 's', '分支 B 指向共享方案');
ok(b1.children[0] !== c1.children[0], '共享节点生成了两个独立实例');
const primary = b1.children[0], ref = c1.children[0];
console.log('  首次出现 isRef=%s / 第二次出现 isRef=%s collapsed=%s %s',
  primary.isRef, ref.isRef, ref.collapsed,
  (!primary.isRef && ref.isRef && ref.collapsed) ? 'OK' : 'FAIL');
ok(!primary.isRef, '首次出现不作为复用副本');
ok(ref.isRef && ref.collapsed, '第二次出现按折叠复用标记渲染');
checkLayout('汇合·副本折叠');
ref.collapsed = false;
api.layout();
checkLayout('汇合·副本展开');
// 编辑共享节点 -> 两处实例应同步（inst.node 是同一对象引用）
api.scheme().nodes.s.title = '共享：改过的标题';
ok(primary.node.title === '共享：改过的标题' && ref.node.title === '共享：改过的标题',
  '编辑共享节点后所有引用处同步');
console.log('  共享节点改名后两处实例标题 = %s / %s OK', primary.node.title, ref.node.title);

/* ---------- F. 多方案标签 ---------- */
console.log('\n=== F. 多方案标签 ===');
const BASE = JSON.parse(JSON.stringify(CFG0));
api.setCFG(api.validate(JSON.parse(JSON.stringify(BASE))));
api.rebuild();
const barEl = () => reg['schemeBar'];
function tabAt(i) { return barEl().children[i]; }

ok(api.getCFG().schemes.length === 1, '初始只有 1 个方案');
ok(api.scheme().name === '示例方案-禅吞', '初始方案名 = 示例方案-禅吞');
ok(Object.keys(api.scheme().nodes).length === 97, '示例方案含 97 个节点');

api.buildSchemeBar();
ok(barEl().children.length === 2, '标签栏 = 1 个方案标签 + 右侧操作组');
ok(tabAt(1)._cls.has('barR'), '末位是右侧操作组');
ok(tabAt(1).children.map(b => b.textContent).join(',') === '式神配置,＋ 新建,复制,导出,导入',
  '操作组 = 式神配置 / 新建 / 复制 / 导出 / 导入');
ok(!tabAt(0).querySelector('.x'), '示例导图不显示删除 ×（无法删除）');
console.log('  初始：方案 1 个 / 标签 + 操作组 / 示例无删除按钮 OK');

PROMPT_ANSWER = '测试方案';
api.newScheme();
PROMPT_ANSWER = null;
ok(api.getCFG().schemes.length === 2, '新建后方案数 = 2');
ok(api.getCFG().activeScheme !== 'chantun', '新建后自动切到新方案');
const NS = api.scheme();
ok(Object.keys(NS.nodes).length === 1, '新方案只有 1 个根节点');
ok(NS.nodes[NS.start].title === '我方1手', '新方案根节点标题 = 我方1手');
ok(api.getROOTS().length === 1 && api.getROOTS()[0].nid === NS.start, '新方案只渲染出 1 个根');
checkLayout('新方案（单根）');

api.buildSchemeBar();
ok(barEl().children.length === 3, '2 个方案时标签栏 = 2 标签 + 操作组');
ok(!tabAt(0).querySelector('.x'), '示例导图仍无删除按钮');
ok(!!tabAt(1).querySelector('.x'), '自建导图有删除 ×');

tabAt(0).onclick();
ok(api.getCFG().activeScheme === 'chantun', '点标签切回示例方案');
ok(Object.keys(api.scheme().nodes).length === 97, '切回后仍是 97 节点');
checkLayout('切回示例方案');

// 重命名
PROMPT_ANSWER = '禅吞·改';
tabAt(0).ondblclick({ preventDefault() {} });
PROMPT_ANSWER = null;
ok(api.getCFG().schemes[0].name === '禅吞·改', '双击标签可重命名');

api.copyScheme();
ok(api.getCFG().schemes.length === 3, '复制后方案数 = 3');
const CP = api.scheme();
ok(Object.keys(CP.nodes).length === 97, '副本含 97 节点');
ok(CP.name === '禅吞·改 副本', '副本名带「副本」后缀');
const ORIG = api.getCFG().schemes.find(s => s.id === 'chantun');
CP.nodes[CP.start].title = '副本改过的根';
ok(ORIG.nodes[ORIG.start].title !== '副本改过的根', '副本与原件深拷贝，互不影响');
console.log('  副本 97 节点 / 改名不影响原件 OK');

// 删除：确认 -> 删，取消 -> 不删
api.buildSchemeBar();
let n0 = api.getCFG().schemes.length;
CONFIRM_ANSWER = true;
tabAt(1).querySelector('.x').onclick({ stopPropagation() {} });
ok(api.getCFG().schemes.length === n0 - 1, '确认后方案数 -1');
ok(!api.getCFG().schemes.some(s => s.name === '测试方案'), '被删方案已不存在');
api.buildSchemeBar();
n0 = api.getCFG().schemes.length;
CONFIRM_ANSWER = false;
tabAt(1).querySelector('.x').onclick({ stopPropagation() {} });
ok(api.getCFG().schemes.length === n0, '取消确认时不删除');
CONFIRM_ANSWER = true;
console.log('  删除：确认生效 / 取消不生效 OK');
checkLayout('删除方案后');

/* ---------- G. 节点编辑：式神选择器 / 新增子卡 / 复用汇合 ---------- */
console.log('\n=== G. 节点编辑 ===');
const gRaw = {
  activeScheme: 'g',
  schemes: [{
    id: 'g', name: '编辑测试', start: 'r', floating: [],
    nodes: {
      r: { id: 'r', title: '我方1手：禅吞', camp: 'root', hand: 1,
           shishen: ['禅心云外镜', '鬼王酒吞童子'], yuhun: [], note: '', children: ['e1'] },
      e1: { id: 'e1', title: '敌方：先出毗', camp: 'enemy', hand: 2,
            shishen: ['毗沙门天'], yuhun: [], note: '', children: [] },
      x1: { id: 'x1', title: '备选：我方收尾', camp: 'mine', hand: 5,
            shishen: [], yuhun: [], note: '', children: [] }
    }
  }]
};
api.setCFG(api.validate(gRaw));
api.rebuild();

function foot(label) { return reg['sideFoot'].children.find(b => b.textContent === label); }
function gridNames() { return reg['ss_grid'].children.map(b => b.children[0].title); }

const e1 = api.findInst('e1');
ok(!!e1, 'findInst 能按 id 找到实例');
api.selectNode(e1, e1.el);
ok(api.getSEL() === e1, 'selectNode 记录当前选中节点');
ok(reg['ss_grid'].children.length > 0, '式神网格渲染出可选头像');
ok(reg['ss_grid'].children.length <= 80, '网格最多 80 项（防卡顿）');
ok(reg['ss_now'].children.length === 1, '已选区显示 1 个 chip（毗沙门天）');

// 别名反查：搜「炎魔」应命中「阎魔」
reg['ss_q'].value = '炎魔'; reg['ss_q'].oninput();
ok(gridNames().indexOf('阎魔') >= 0, '搜「炎魔」经别名反查命中「阎魔」');
ok(gridNames()[0] === '阎魔', '别名命中项排在最前');
// 组合别名
reg['ss_q'].value = '禅吞'; reg['ss_q'].oninput();
ok(gridNames().indexOf('禅心云外镜') >= 0 && gridNames().indexOf('鬼王酒吞童子') >= 0,
  '搜「禅吞」同时命中禅心云外镜 + 鬼王酒吞童子');
// 无匹配
reg['ss_q'].value = 'zzzz不存在'; reg['ss_q'].oninput();
ok(reg['ss_grid'].children.length === 1 && reg['ss_grid'].children[0]._cls.has('hint'),
  '无匹配时只显示一条提示，不再列出式神');
console.log('  式神搜索：别名反查 / 组合别名 / 空态 OK');

// 点选 -> 写回文本框 -> 再点取消
reg['ss_q'].value = '阎魔'; reg['ss_q'].oninput();
const ymCell = reg['ss_grid'].children.find(b => b.children[0].title === '阎魔');
ok(!!ymCell, '网格里有「阎魔」可选');
ymCell.onclick();
ok(reg['f_ss'].value.indexOf('阎魔') >= 0, '点选后写回式神文本框');
ok(reg['f_ss'].value.indexOf('毗沙门天') >= 0, '点选不覆盖已有的式神');
ok(reg['ss_now'].children.length === 2, '已选区变为 2 个 chip');
reg['ss_grid'].children.find(b => b.children[0].title === '阎魔').onclick();
ok(reg['f_ss'].value.indexOf('阎魔') < 0, '再点一次可取消选择');
ok(reg['ss_now'].children.length === 1, '取消后回到 1 个 chip');
// 点 chip 移除
reg['ss_now'].children[0].onclick();
ok(reg['ss_now'].children.length === 0 || reg['ss_now'].querySelectorAll('.chip').length === 0,
  '点已选 chip 也能移除');
console.log('  点选 / 取消 / chip 移除 OK');

// 应用
get('f_title').value = '敌方：先出毗 + 龙珏';
get('f_camp').value = 'enemy';
get('f_hand').value = '2';
get('f_yh').value = '薙魂、共潜';
get('f_note').value = '注意一速';
foot('应用').onclick();
ok(api.scheme().nodes.e1.title === '敌方：先出毗 + 龙珏', '应用后标题已保存');
ok(api.scheme().nodes.e1.yuhun.join(',') === '薙魂,共潜', '应用后御魂已保存');
ok(api.scheme().nodes.e1.note === '注意一速', '应用后备注已保存');
checkLayout('编辑后');

// 新增子卡
const e1b = api.findInst('e1');
api.selectNode(e1b, e1b.el);
const before = Object.keys(api.scheme().nodes).length;
foot('＋ 新增子卡').onclick();
ok(Object.keys(api.scheme().nodes).length === before + 1, '新增子卡后节点数 +1');
ok(api.scheme().nodes.e1.children.length === 1, '新节点挂在当前节点下');
const newId = api.scheme().nodes.e1.children[0];
ok(api.scheme().nodes[newId].camp === 'mine', '敌方节点的子卡默认是我方（交替阵营）');
ok(api.scheme().nodes[newId].hand === 3, '子卡手数自动 +1');
ok(api.newNodeId(api.scheme()) !== newId, 'newNodeId 不会返回已占用的 id');
checkLayout('新增子卡后');

// 复用已有节点 -> 建立汇合
const e1c = api.findInst('e1');
api.selectNode(e1c, e1c.el);
foot('＋ 复用已有').onclick();
ok(reg['pk_list'].children.length > 0, '复用面板列出了可选节点');
// 复用 x1 挂到 e1 下；此时 x1 只有 1 个父，不折叠
const pickX = () => reg['pk_list'].children.find(r => r.children[0].textContent === '备选：我方收尾');
ok(!!pickX(), '列表里能搜到「备选：我方收尾」');
pickX().onclick();
ok(api.scheme().nodes.e1.children.indexOf('x1') >= 0, '复用后 e1 的 children 里出现 x1');
ok(api.getROOTS()[0].children[0].children.some(c => c.nid === 'x1'), '复用节点已挂到树上');
const x1a = api.getROOTS()[0].children[0].children.find(c => c.nid === 'x1');
ok(!x1a.isRef, '单次引用不标记为复用副本');
checkLayout('复用 1 次');

// 第二条路径也复用 x1 -> 老行为（collapse）：第二次出现折叠成「复用」标记
// 这一小段专测老的副本模式，所以显式把模式切成 collapse（默认是 merge，见 N/S 段）
api.getCFG().layout.sharedNodeMode = 'collapse';
api.scheme().nodes.r.children.push('x1');
api.rebuild();
const Rg = api.getROOTS()[0];
const xRoot = Rg.children.find(c => c.nid === 'x1');
const xDeep = Rg.children.find(c => c.nid === 'e1').children.find(c => c.nid === 'x1');
ok(!!xRoot && !!xDeep, '两条路径都指向 x1');
ok(xRoot.isRef !== xDeep.isRef, '两处实例中恰有一个是复用副本');
ok((xRoot.isRef ? xRoot : xDeep).collapsed, '复用副本默认折叠');
checkLayout('复用 2 次（汇合折叠）');
console.log('  复用汇合：%s 处引用 -> 副本 isRef=%s collapsed=%s OK',
  '2', (xRoot.isRef ? xRoot : xDeep).isRef, (xRoot.isRef ? xRoot : xDeep).collapsed);

/* 解除复用只在「源头那一处」做：也就是复用别人的那个框（汇合虚线的起点）。
   被复用的框上只列出「被哪些分支引用」作说明，不给任何解除入口 ——
   同一件事两头都能点的话，很容易点错一侧，把不该断的那条断掉。 */
const rInst = api.findInst('r');
api.selectNode(rInst, rInst.el);
const outL = reg['outref_list'];
// DOM 桩里 getElementById 永远不返回 null，所以光看元素在不在骗得过自己 —— 源码里那段也必须真的在
ok(/id="outref_list"/.test(html) && /const sharedOut = /.test(html),
  '面板源码里真的有「本框复用了」这一段（桩里元素永远存在，这条才抓得住）');
ok(!!outL, '发起复用的框（r）面板里有「本框复用了」这一段');
ok(outL && outL.children.length === 1, '列出 1 条复用出去的引用（实际 ' + (outL ? outL.children.length : 0) + '）');
ok(outL && outL.children.length === 1 &&
   String(outL.children[0].children[0].textContent) === 'x1', '那一条指向被复用的 x1');
// 被复用的框上：只说明「被哪些分支引用」，没有 ✕、也没有「解除复用」按钮
const xInst = api.findInst('x1');
api.selectNode(xInst, xInst.el);
const inL = reg['ref_list'];
ok(!!inL && inL.children.length === 2, '被复用的框（x1）上列出 2 条引用来源（实际 ' +
  (inL ? inL.children.length : 0) + '）');
ok(inL && inL.children.every(r => !r.children.some(c => c._cls.has('rx'))),
  '★ 被复用的框上那几行没有 ✕（解除只在源头那一处做）');
ok(!foot('解除复用'), '★ 被复用的框上没有「解除复用」按钮');
ok(!!foot('删除整个节点') && !foot('删除节点'), '被复用的框上给的是「删除整个节点」，措辞不歧义');
// 点「本框复用了」那行的 ✕：只断 r → x1 这一条，x1 本身和 e1 那条都还在
api.selectNode(rInst, rInst.el);
CONFIRM_ANSWER = true;
if (outL && outL.children.length) {             // 列表没渲染出来就别硬点，让断言自己报 FAIL、用例别崩
  outL.children[0].children[2].onclick();
  ok(api.scheme().nodes.r.children.indexOf('x1') < 0, '在发起复用的框上 ✕ -> 断掉了 r → x1 这一条');
  ok(api.scheme().nodes.e1.children.indexOf('x1') >= 0, 'e1 → x1 那条引用还在（只断当前这一条）');
  ok(!!api.scheme().nodes.x1, '被复用的 x1 节点本身还在，没被一起删掉');
}
api.scheme().nodes.r.children.push('x1');       // 还原，后面还要用
api.rebuild();

// 重复挂同一子节点应被拦下并提示
api.setCFG(api.validate(JSON.parse(JSON.stringify(gRaw))));
api.rebuild();
api.scheme().nodes.e1.children.push('x1');
api.rebuild();
const e1d = api.findInst('e1');
api.selectNode(e1d, e1d.el);
foot('＋ 复用已有').onclick();
ALERT_LOG.length = 0;
const dupRow = reg['pk_list'].children.find(r => r.children[0].textContent === '备选：我方收尾');
if (dupRow) dupRow.onclick();
ok(ALERT_LOG.length === 1 && ALERT_LOG[0].indexOf('已经是当前节点的子节点') >= 0,
  '重复挂同一节点时给出提示且不重复添加');
ok(api.scheme().nodes.e1.children.filter(x => x === 'x1').length === 1, '重复项未被加入');

// 共享节点（2 处引用）：解除只在源头那一处做；被复用的框上只能「删除整个节点」
const refCount = id => Object.keys(api.scheme().nodes)
  .filter(x => api.scheme().nodes[x].children.indexOf(id) >= 0).length;
api.setCFG(api.validate(JSON.parse(JSON.stringify(gRaw))));
api.getCFG().layout.sharedNodeMode = 'collapse';    // 副本模式：两处都有框，便于选中
api.rebuild();
api.scheme().nodes.e1.children.push('x1'); api.scheme().nodes.r.children.push('x1');
api.rebuild();
let x1e = api.findInst('x1');
api.selectNode(x1e, x1e.el);
ok(get('ref_list').children.length === 2, '共享节点面板列出 2 条引用来源');
ok(!foot('解除复用'), '★ 被复用的框上不再有「解除复用」按钮（统一由源头解除）');
ok(!!foot('删除整个节点') && !foot('删除节点'), '共享节点给的是「删除整个节点」，措辞不歧义');
ok(get('ref_list').children.every(r => r.children.length === 2),
  '每一行只有「ID + 描述」，不再带 ✕');

// 从源头（e1）那侧解除：只断 e1 → x1 这一条
const e1src = api.findInst('e1');
api.selectNode(e1src, e1src.el);
CONFIRM_ANSWER = true;
const srcRow = reg['outref_list'].children[0];
ok(!!srcRow && srcRow.children.length === 3, '源头那侧每行是「ID + 描述 + ✕」（实际 ' +
  (srcRow ? srcRow.children.length : 0) + ' 段）');
srcRow.children[2].onclick();
ok(!!api.scheme().nodes.x1, '★ 源头解除后节点本身还在（不能顺手把被引用的节点删掉）');
ok(refCount('x1') === 1, '只断开源头这一条引用（还剩 ' + refCount('x1') + ' 条）');
ok(api.scheme().nodes.e1.children.indexOf('x1') < 0, '断的正是 e1 → x1 这一条');
ok(api.scheme().nodes.r.children.indexOf('x1') >= 0, '另一条 r → x1 原样保留');

// 删除整个节点 → 节点与所有引用一起清掉（这个动作还在被复用的框上）
api.scheme().nodes.e1.children.push('x1'); api.rebuild();
x1e = api.findInst('x1'); api.selectNode(x1e, x1e.el);
foot('删除整个节点').onclick();
ok(!api.scheme().nodes.x1, '点「删除整个节点」才真的删掉');
ok(refCount('x1') === 0, '所有指向它的引用都已断开');
checkLayout('删除节点后');
console.log('  解除复用（只在源头）/ 删除整个节点：只断一条 vs 全删，都不留悬空 OK');

/* ---------- H. 配置读写与三层合并 ---------- */
console.log('\n=== H. 配置读写（内嵌 < config.json < 本地）===');
api.clearLocal();
ok(api.loadLocal() === null, '清空后读不到本地配置（回落 config.json / 内嵌）');
ok(api.fetchExt() === null, '取不到 config.json 时 fetchExt 返回 null 而不抛异常');
ok(api.validate(null).meta.title === '翻牌上卡导引图', '无任何外部配置时回落内嵌默认值');

api.setCFG(api.validate(JSON.parse(JSON.stringify(BASE))));
ok(api.saveLocal() === true, '保存到本地成功');
const back = api.loadLocal();
ok(back && Array.isArray(back.schemes) && back.schemes.length === 1, '保存后能原样读回');
ok(back.meta.title === '翻牌上卡导引图', '读回内容与写入一致');
ok(back.schemes[0].name === '示例方案-禅吞', '读回的方案名一致');
console.log('  写入 / 读回 / 键名 %s OK', api.getLSKEY());

// 本地内容非法时，校验层仍能兜底
LS[api.getLSKEY()] = JSON.stringify({ layout: { hGap: 'x' }, schemes: 'oops' });
const fixed = api.validate(api.loadLocal());
ok(fixed.layout.hGap === 54 && Array.isArray(fixed.schemes) && fixed.schemes.length >= 1,
  '本地内容非法也能被校验层修正');
api.clearLocal();
ok(api.loadLocal() === null, '清除本地配置后读回 null');

/* ---------- I. 滚轮 / 键盘只在导图区域生效 ---------- */
console.log('\n=== I. 滚轮/键盘作用域（侧栏不误伤导图）===');
api.setCFG(api.validate(JSON.parse(JSON.stringify(BASE))));
api.rebuild();

const view = () => api.getView();
// #side 就在 #stage 内部：面板里的滚轮/按键会冒泡到导图监听器，必须被拦掉
const sideEl = get('side');
const sideTa = new El('textarea'); sideEl.appendChild(sideTa);   // 侧栏内的文本框
const worldEl = get('world');
const nodeEl = worldEl.children.find(c => c._cls.has('node')) || worldEl;  // 导图内的节点

const wheelEv = target => {
  let prevented = false;
  api.getStage()._listeners.wheel[0]({
    target, clientX: 100, clientY: 100, deltaY: -100,
    preventDefault() { prevented = true; }
  });
  return prevented;
};
const keyEv = (target, key) => {
  let prevented = false;
  winL.keydown[0]({ target, key, preventDefault() { prevented = true; } });
  return prevented;
};

let z0 = view().sc;
ok(wheelEv(nodeEl) === true, '导图上滚轮会 preventDefault（不带动页面滚动）');
ok(view().sc > z0, '导图上滚轮放大 ' + z0.toFixed(3) + ' -> ' + view().sc.toFixed(3));

z0 = view().sc;
ok(wheelEv(sideTa) === false, '侧栏内滚轮不 preventDefault（面板自己滚）');
ok(Math.abs(view().sc - z0) < 1e-9, '侧栏内滚轮不再缩放导图（修复点）');
// 面板任意位置（含标题/底栏这类非表单元素）都不应触发缩放
const sideH2 = new El('h2'); sideEl.appendChild(sideH2);
z0 = view().sc;
wheelEv(sideH2);
ok(Math.abs(view().sc - z0) < 1e-9, '侧栏非表单区域滚轮同样不缩放导图');
console.log('  滚轮：导图缩放 / 侧栏不缩放 OK');

let t0 = view().tx;
ok(keyEv(nodeEl, 'ArrowLeft') === true, '导图上方向键会 preventDefault');
ok(view().tx === t0 + 70, '导图上方向键平移生效');
t0 = view().tx;
ok(keyEv(sideTa, 'ArrowLeft') === false, '侧栏文本框里方向键不 preventDefault（光标可移动）');
ok(view().tx === t0, '侧栏文本框里方向键不平移导图（修复点）');
let s0 = view().sc;
keyEv(sideTa, '+');
ok(Math.abs(view().sc - s0) < 1e-9, '侧栏文本框里按 + 不缩放导图');
s0 = view().sc;
keyEv(nodeEl, '+');
ok(view().sc > s0, '导图上按 + 仍能缩放');
console.log('  键盘：导图平移缩放 / 侧栏不拦截 OK');

ok(api.inUI({ target: sideTa }) === true, 'inUI 认得侧栏内的元素');
ok(api.inUI({ target: new El('input') }) === true, 'inUI 认得裸 input/textarea/select');
ok(api.inUI({ target: nodeEl }) === false, 'inUI 不误判导图节点');
ok(api.inUI({ target: null }) === false, 'inUI 对空 target 安全');
ok(api.inUI({}) === false, 'inUI 对无 target 的事件安全');

const down = api.getStage()._listeners.mousedown[0];
down({ target: sideTa, clientX: 5, clientY: 5, button: 0 });
ok(api.getDrag() === false, '侧栏内按下不触发导图拖拽');
down({ target: nodeEl, clientX: 5, clientY: 5, button: 0 });
ok(api.getDrag() === true, '导图上按下开始拖拽');
// 右键不该开始平移（否则右键一拖，画布跟着跑，还顺手把弹出菜单关掉）
(winL.mouseup || []).forEach(f => f({ clientX: 5, clientY: 5, button: 0 }));
ok(api.getDrag() === false, '松开后拖拽结束');
down({ target: nodeEl, clientX: 5, clientY: 5, button: 2 });
ok(api.getDrag() === false, '右键不开始画布平移');
winL.mouseup.forEach(f => f({}));    // 画布平移 / 拖节点各自有一个 mouseup，都要跑到
ok(api.getDrag() === false, '松开后拖拽结束');
console.log('  拖拽：侧栏不误触发 OK');

/* ---------- J. 示例方案 / 本地方案（防清缓存丢失）---------- */
console.log('\n=== J. 示例 vs 本地 ===');
const EMBEDDED = api.publishedSchemes(null);
ok(EMBEDDED.length === 1 && EMBEDDED[0].id === 'chantun' && EMBEDDED[0].builtin === true,
  '内嵌基线里有 1 个示例方案 chantun');
ok(!!EMBEDDED[0].rev, '示例方案带内容版本号 rev = ' + EMBEDDED[0].rev);
ok(Object.keys(EMBEDDED[0].nodes).length === 97, '示例方案含 97 个节点');

// 未注入发布基线时，validate 行为与以前完全一致（纯配置校验，不掺入示例方案）
api.setPublished(null);   // 注入：PUBLISHED = 内嵌/build_config 产出的示例方案
const REV = EMBEDDED[0].rev;

// 1) 本地那份 rev 相同 -> 保留本地（含访客微调），只是补回示例标记
const localSame = {
  activeScheme: 'chantun',
  schemes: [
    {id:'chantun', name:'我改过的示例', builtin:true, rev:REV, start:'a', floating:[], nodes:{
      a:{id:'a', title:'我改过的根', camp:'root', shishen:[], yuhun:[], note:'', children:[]}}},
    {id:'my1', name:'我的方案', builtin:false, start:'m', floating:[], nodes:{
      m:{id:'m', title:'我的根', camp:'root', shishen:[], yuhun:[], note:'', children:[]}}}
  ]
};
let c = api.validate(localSame);
ok(c.schemes.length === 2, '示例 + 本地 合并后共 2 个方案');
const ch = c.schemes.find(s => s.id === 'chantun');
ok(ch.name === '我改过的示例' && Object.keys(ch.nodes).length === 1, 'rev 相同：保留本地那份（含微调）');
ok(ch.builtin === true, '保留的那份仍标记为示例');
ok(c.schemes.find(s => s.id === 'my1').builtin === false, '本地方案标记 builtin=false');
ok(api.localSchemes(c).length === 1 && api.localSchemes(c)[0].id === 'my1', 'localSchemes 只返回本地方案');
ok(c.schemes.map(s => s.id).join(',') === 'chantun,my1', '示例方案排在前面、本地方案在后');
console.log('  rev 相同：保留访客微调 / 示例排前 OK');

// 2) 本地那份 rev 不同（作者更新过）-> 用发布版覆盖并告警
const localOld = JSON.parse(JSON.stringify(localSame));
localOld.schemes[0].rev = 'rev-changed-by-author';
c = api.validate(localOld);
ok(c.schemes.find(s => s.id === 'chantun').rev === REV, 'rev 不同：用发布版覆盖');
ok(c.schemes.find(s => s.id === 'chantun').name === '示例方案-禅吞', '覆盖后回到发布版内容');
ok(api.getWARN().some(w => w.indexOf('已随页面更新') >= 0), '覆盖时给出告警说明');
console.log('  rev 不同：发布版覆盖并告警 OK');

// 3) 本地完全没有示例方案（首次访问 / 清了缓存）-> 自动补回
c = api.validate({schemes:[{id:'x', name:'只有我', start:'r', floating:[], nodes:{
  r:{id:'r', title:'根', camp:'root', shishen:[], yuhun:[], note:'', children:[]}}}]});
ok(c.schemes.some(s => s.id === 'chantun' && s.builtin), '本地缺失时自动补回示例方案（清缓存也不怕）');
ok(c.schemes.some(s => s.id === 'x' && !s.builtin), '本地方案同时保留');
ok(c.activeScheme === 'chantun', 'activeScheme 失效时切到第一个可用方案');
console.log('  清缓存后：示例方案自动补回 OK');

// 4) 新建 / 复制出来的都是本地方案
api.setCFG(api.validate(null));
api.rebuild();
ok(api.getCFG().schemes.length === 1 && api.getCFG().schemes[0].builtin, '干净状态下只有 1 个示例方案');
PROMPT_ANSWER = '方案A'; api.newScheme(); PROMPT_ANSWER = null;
ok(api.scheme().builtin === false && api.scheme().rev === undefined, '新建的方案是本地方案（无 rev）');
ok(api.localSchemes().length === 1, 'localSchemes 统计到 1 个本地方案');
const idA = api.scheme().id;
PROMPT_ANSWER = null; api.newScheme();                 // prompt 返回 null -> 不应创建
ok(api.getCFG().schemes.length === 2, '取消命名时不创建方案');
// 切到示例方案再复制 -> 得到一份本地的副本
api.getCFG().activeScheme = api.getCFG().schemes[0].id;
api.rebuild();
ok(api.getCFG().schemes[0].builtin, '第 1 个是示例方案');
api.copyScheme();
ok(api.getCFG().schemes.length === 3, '复制后 3 个方案');
const cpy = api.getCFG().schemes[2];
ok(cpy.builtin === false && cpy.rev === undefined, '示例方案的副本是本地方案（不带 rev）');
ok(cpy.name === '示例方案-禅吞 副本', '副本名沿用来源方案名');
ok(Object.keys(cpy.nodes).length === 97, '副本节点数与来源一致');
ok(new Set(api.getCFG().schemes.map(s => s.id)).size === 3, '方案 id 不重复（连续新建不会撞号）');
cpy.nodes[cpy.start].title = '副本改过的根';
const orig = api.getCFG().schemes.find(s => s.id === 'chantun');
ok(orig.nodes[orig.start].title !== '副本改过的根', '副本与示例方案互不影响（深拷贝）');
console.log('  新建/复制 -> 本地方案，id 不撞号、与来源互不影响 OK');

// 5) UI：标签徽标 + 提醒条（文案要短）
api.buildSchemeBar();
const tabs = reg['schemeBar'].children.filter(t => t._cls.has('tab'));
const pinOf = t => { const p = t.children.find(x => x._cls.has('pin')); return p ? p.textContent : ''; };
const pinElOf = t => t.children.find(x => x._cls.has('pin'));
ok(tabs.length === 3, '标签栏渲染 3 个方案');
ok(reg['schemeBar'].children.some(c => c._cls.has('barR')), '标签栏右侧有操作组');
ok(pinOf(tabs[0]) === '示例', '示例导图的徽标 = 示例');
ok(pinOf(tabs[1]) === '自建' && pinOf(tabs[2]) === '自建', '新建/复制的徽标 = 自建');
ok(pinElOf(tabs[0]).title === '示例导图，无法删除', '示例徽标悬浮说明精简为「示例导图，无法删除」');
ok(pinElOf(tabs[1]).title === '自建导图，仅存本机浏览器', '自建徽标悬浮说明精简为「自建导图，仅存本机浏览器」');
ok(!tabs[0].querySelector('.x'), '示例导图无删除按钮');

const note = reg['schemeNote'];
ok(note._cls.has('on'), '存在自建导图时显示提醒条');
ok(note.children.length === 1, '提醒条只有一行文字（不再堆一大坨）');
const noteTxt = note.children[0];
ok(noteTxt.innerHTML.length < 140, '提醒条文案够短（' + noteTxt.innerHTML.length + ' 字）');
ok(noteTxt.innerHTML.indexOf('方案A') >= 0, '提醒条点名了自建导图');
ok(noteTxt.innerHTML.indexOf('清缓存') >= 0, '提醒条说明了会丢的原因');

// 只有示例导图时不提醒
api.getCFG().schemes = api.getCFG().schemes.filter(s => s.builtin);
api.flashNote();
ok(!note._cls.has('on'), '只有示例导图时不显示提醒条');
console.log('  徽标：示例/自建 + 短说明 OK；提醒条：一行短文案 OK');

/* ---------- K. 方案排序 / 导出 / 导入（与页面配置解耦）---------- */
console.log('\n=== K. 方案排序 / 导出 / 导入 ===');
api.setPublishedList([]);
const kRaw = {
  activeScheme: 's1',
  schemes: [
    {id:'s1', name:'甲', start:'a', floating:[], nodes:{a:{id:'a',title:'甲根',camp:'root',shishen:[],yuhun:[],note:'',children:[]}}},
    {id:'s2', name:'乙', start:'b', floating:[], nodes:{b:{id:'b',title:'乙根',camp:'root',shishen:[],yuhun:[],note:'',children:[]}}},
    {id:'s3', name:'丙', start:'c', floating:[], nodes:{c:{id:'c',title:'丙根',camp:'root',shishen:[],yuhun:[],note:'',children:[]}}}
  ]
};
api.setCFG(api.validate(kRaw));
api.rebuild();
const order = () => api.getCFG().schemes.map(s => s.name).join('');

// 拖动排序：把第 1 个拖到第 3 个之后
ok(order() === '甲乙丙', '初始顺序 甲乙丙');
ok(api.moveScheme(0, 3) === true, 'moveScheme(0,3) 生效');
ok(order() === '乙丙甲', '把「甲」拖到最后 -> 乙丙甲（实际 ' + order() + '）');
ok(api.moveScheme(2, 0) === true, '向前拖动也支持');
ok(order() === '甲乙丙', '再拖回最前 -> 甲乙丙');
ok(api.moveScheme(1, 1) === false, '拖到原位不改变顺序');
// 拖拽事件：ondragover 标出落点，ondrop 真正换序
api.buildSchemeBar();
const kt = reg['schemeBar'].children.filter(t => t._cls.has('tab'));
kt[0].ondragstart({ dataTransfer: { setData(){} } });
ok(kt[0]._cls.has('dragging'), 'dragstart 给源标签加 dragging 样式');
kt[2].ondragover({ preventDefault(){}, clientX: 999, dataTransfer: { } });
ok(kt[2]._cls.has('drop-r') || kt[2]._cls.has('drop-l'), 'dragover 标出落点');
kt[2].ondrop({ preventDefault(){}, clientX: 999 });
ok(order() === '乙丙甲', '拖到「丙」右侧后顺序变为乙丙甲（实际 ' + order() + '）');
kt[0].ondragend();
ok(!kt[0]._cls.has('dragging'), 'dragend 清掉拖拽样式');
console.log('  拖动排序：甲/乙/丙 顺序变更 OK');

// 导出：当前选中的方案 -> 单方案 JSON，去掉 builtin
api.getCFG().activeScheme = 's2';
const j = api.schemeExportJson();
const parsed = JSON.parse(j);
ok(parsed.id === 's2' && parsed.name === '乙', '导出的是当前选中的方案');
ok(parsed.nodes && parsed.nodes.b, '导出内容含节点表');
ok(parsed.builtin === undefined && parsed.rev === undefined, '导出的 JSON 不带 builtin / rev（由导入方决定）');
ok(api.slug('乙 方案/A') === '乙_方案_A', '文件名做了安全处理');
console.log('  导出：单方案 JSON + 文件名转义 OK');

// 导入：支持 单个方案 / 方案数组 / {schemes:[...]}
function mkScheme(id, name){
  const r = id + '_r';
  const n = {}; n[r] = {id:r, title:name+'根', camp:'root', shishen:[], yuhun:[], note:'', children:[]};
  return {id, name, start:r, floating:[], nodes:n};
}
ok(api.schemesFromJson(mkScheme('x1','单个')) !== null, '识别单个方案对象');
ok(api.schemesFromJson([mkScheme('x1','A'), mkScheme('x2','B')]).length === 2, '识别方案数组');
ok(api.schemesFromJson({schemes:[mkScheme('x1','A')]}).length === 1, '识别 {schemes:[...]}');
ok(api.schemesFromJson({meta:{}, style:{}}) === null, '普通配置对象不会被当成方案');
ok(api.schemesFromJson({}) === null, '空对象不会被当成方案');
ok(api.schemesFromJson('nope') === null, '非对象不会被当成方案');

const before3 = api.getCFG().schemes.length;
ok(api.addSchemes([mkScheme('s1','重名导入'), mkScheme('s2','也重名')]) === 2, '导入 2 个方案');
ok(api.getCFG().schemes.length === before3 + 2, '方案数 +2');
const imported = api.getCFG().schemes.slice(-2);
ok(imported[0].id !== 's1' && imported[1].id !== 's2', 'id 撞号时自动改号（' + imported[0].id + ' / ' + imported[1].id + '）');
ok(imported.every(s => s.builtin === false && s.rev === undefined), '导入的一律是自建方案');
ok(api.getCFG().activeScheme === imported[1].id, '导入后自动切到最后一个导入的方案');
ok(new Set(api.getCFG().schemes.map(s => s.id)).size === api.getCFG().schemes.length, '所有方案 id 唯一');
ok(api.getCFG().schemes.map(s => s.name).join('') === '乙丙甲重名导入也重名', '导入追加到末尾（实际 ' + api.getCFG().schemes.map(s => s.name).join('') + '）');
checkLayout('导入方案后');
console.log('  导入：三种写法 / id 改号 / 追加末尾 OK');

// 页面配置与方案解耦
const pc = api.pageConfigOf(api.getCFG());
ok(pc.schemes === undefined && pc.activeScheme === undefined, '页面配置里不含 schemes / activeScheme');
ok(!!pc.style && !!pc.layout && !!pc.meta, '页面配置保留 style / layout / meta');
console.log('  页面配置：已与方案解耦 OK');

/* ---------- L. 式神配置表（每方案一张）---------- */
console.log('\n=== L. 式神配置表 ===');
api.setPublishedList([]);
const sheetRaw = {
  activeScheme: 'a',
  schemes: [{
    id: 'a', name: '甲', start: 'r', floating: [],
    sheet: {
      headers: ['式神', '指标', '御魂套装', '246号位', '其他要求'],
      rows: [['阎魔', '速度', '散件', '速XX', '攻击>4600'],
             ['鬼吞', '生命', '火灵+防御两件套', '速生生', '速度>210']]
    },
    nodes: { r: { id:'r', title:'甲根', camp:'root', shishen:[], yuhun:[], note:'', children:[] } }
  }]
};
api.setCFG(api.validate(sheetRaw));
api.rebuild();
const scA = api.scheme();
ok(Array.isArray(scA.sheet.rows) && scA.sheet.rows.length === 2, '方案带着 2 行配置读进来');
ok(scA.sheet.headers.length === 5, '表头 5 列（式神/指标/御魂套装/246号位/其他要求）');
const sheetDom = reg['sheetBody'];
const tbl = sheetDom.children.find(c => c.tagName === 'TABLE');
ok(!!tbl, '配置表渲染出 table');
const trs = tbl.children.find(c => c.tagName === 'TBODY').children;
ok(trs.length === 2, '渲染出 2 行数据');
const cellsOf = tr => tr.children;
ok(cellsOf(trs[0]).length === 7, '每行 = 序号 + 5 列 + 删除（7 格）');
ok(String(cellsOf(trs[0])[0].textContent) === '1' && String(cellsOf(trs[1])[0].textContent) === '2', '序号自动编号 1 / 2');

// 抽屉式：默认完全隐藏（不占画布），点方案栏按钮才浮出来
const sheetBarEl = reg['sheetBar'];
const barROf = () => reg['schemeBar'].children.find(c => c._cls.has('barR'));
const sheetBtnOf = () => barROf().children.find(b => String(b.textContent).indexOf('式神配置') === 0);
ok(!sheetBarEl._cls.has('open'), '配置表默认收起（不占画布空间）');
ok(String(sheetBtnOf().textContent) === '式神配置 · 2',
  '方案栏按钮带行数徽标（实际 ' + sheetBtnOf().textContent + '）');
api.toggleSheet();
ok(sheetBarEl._cls.has('open') && reg['sheetToggle'].textContent === '收起 ▾',
  '点一下浮出抽屉，面板按钮文字变「收起 ▾」');
ok(sheetBtnOf()._cls.has('open'), '打开时方案栏按钮进高亮态');
api.toggleSheet();
ok(!sheetBarEl._cls.has('open') && reg['sheetToggle'].textContent === '展开 ▴', '再点一下收起，彻底不占地方');

// 缺省兜底：方案没带 sheet 时自动补空表
const noSheet = api.validate({ schemes: [{ id:'z', name:'无表', start:'r', floating:[],
  nodes:{ r:{id:'r', title:'r', camp:'root', shishen:[], yuhun:[], note:'', children:[]} } }] });
ok(Array.isArray(noSheet.schemes[0].sheet.headers) && noSheet.schemes[0].sheet.rows.length === 0,
  '方案没带 sheet 时自动补空表（表头 ' + noSheet.schemes[0].sheet.headers.join('/') + '）');

// 非法 sheet 兜底
const badSheet = api.validate({ schemes: [{ id:'b', name:'坏表', start:'r', floating:[],
  sheet: { headers: '不是数组', rows: '也不是数组' },
  nodes:{ r:{id:'r', title:'r', camp:'root', shishen:[], yuhun:[], note:'', children:[]} } }] });
ok(Array.isArray(badSheet.schemes[0].sheet.headers) && Array.isArray(badSheet.schemes[0].sheet.rows),
  'sheet 类型非法时回落成空表');

// 行长度对齐表头
const ragged = api.validate({ schemes: [{ id:'c', name:'长短不一', start:'r', floating:[],
  sheet: { headers: ['式神','指标'], rows: [['阎魔'], ['鬼吞','速度','多出来的']] },
  nodes:{ r:{id:'r', title:'r', camp:'root', shishen:[], yuhun:[], note:'', children:[]} } }] });
ok(ragged.schemes[0].sheet.rows.every(r => r.length === 2), '每行长度对齐表头（多余截断、缺的补空）');

// 添加一行 -> 进入编辑态
api.setCFG(api.validate(sheetRaw)); api.rebuild();
api.addSheetRow();
ok(api.scheme().sheet.rows.length === 3, '「＋ 添加一行」后 3 行');
ok(reg['sheetBar']._cls.has('open'), '「＋ 添加一行」时抽屉自动打开（不然看不见刚加的行）');
const lastTr = reg['sheetBody'].children.find(c => c.tagName === 'TABLE').children
  .find(c => c.tagName === 'TBODY').children[2];
ok(!!lastTr.children[1].querySelector('input'), '新行第一格直接进入编辑态（input）');

// 方案之间互不影响
const twoRaw = JSON.parse(JSON.stringify(sheetRaw));
twoRaw.schemes.push({ id:'d', name:'乙', start:'r2', floating:[],
  nodes:{ r2:{id:'r2', title:'乙根', camp:'root', shishen:[], yuhun:[], note:'', children:[]} } });
api.setCFG(api.validate(twoRaw)); api.rebuild();
api.getCFG().activeScheme = 'd'; api.rebuild();
ok(api.scheme().sheet.rows.length === 0, '切到另一个方案 -> 配置表是它自己的（空）');
api.getCFG().activeScheme = 'a'; api.rebuild();
ok(api.scheme().sheet.rows.length === 2, '切回来还是原来的 2 行');

// 导出带上配置表
const exp = JSON.parse(api.schemeExportJson());
ok(exp.sheet && exp.sheet.rows.length === 2, '导出 JSON 里包含配置表（' + exp.sheet.rows.length + ' 行）');
ok(exp.builtin === undefined && exp.rev === undefined, '导出仍不带 builtin/rev');
console.log('  配置表：渲染 / 兜底 / 行编辑 / 方案隔离 / 随方案导出 OK');

/* ---------- M. 节点交互：单击折叠 / 双击编辑 ---------- */
(async () => {
  console.log('\n== M. 节点交互：单击折叠 / 双击编辑 ==');
  const clickRaw = { schemes: [{ id: 'clk', name: '点击', start: 'r', floating: [],
    nodes: {
      r:  { id: 'r',  title: '根', camp: 'root',  shishen: [], yuhun: [], note: '', children: ['c1'] },
      c1: { id: 'c1', title: '子', camp: 'mine',  shishen: [], yuhun: [], note: '', children: ['c2'] },
      c2: { id: 'c2', title: '孙', camp: 'enemy', shishen: [], yuhun: [], note: '', children: [] }
    } }] };
  api.setCFG(api.validate(clickRaw)); api.rebuild();

  const delay = api.getCFG().ui.clickFoldDelay;
  ok(typeof delay === 'number' && delay >= 0 && delay <= 600,
    '折叠延迟 CFG.ui.clickFoldDelay 可配（当前 ' + delay + 'ms）');

  const parent = api.findInst('r'), leaf = api.findInst('c2');
  ok(!!parent && !!leaf, '取到父节点与叶子节点实例');
  ok(parent.el._listeners.click && parent.el._listeners.click.length === 1 &&
     parent.el._listeners.dblclick && parent.el._listeners.dblclick.length === 1,
    '父节点各绑定一个 click / dblclick');
  ok(leaf.el._listeners.dblclick && leaf.el._listeners.dblclick.length === 1,
    '叶子节点也绑定 dblclick（照样能编辑）');
  ok(parent.el.title.indexOf('单击：收起 / 展开子框 · 双击：编辑') === 0,
    '父节点悬停说明写清两个手势（' + parent.el.title + '）');
  ok(leaf.el.title.indexOf('双击：编辑') === 0, '叶子节点只提示双击编辑');

  const mkEv = () => ({ preventDefault() {}, stopPropagation() { this._sp = true; } });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // 1) 单击 -> 延迟后才折叠
  const before = laidSet().size;
  let e = mkEv(); parent.el._listeners.click[0](e);
  ok(e._sp === true, '单击 stopPropagation，不会冒到画布被当成「点空白」');
  ok(parent.collapsed === false, '单击当下不折叠（把机会留给双击）');
  await wait(delay + 250);
  ok(parent.collapsed === true, '延迟 ' + delay + 'ms 后父节点折叠');
  ok(laidSet().size === 1 && before === 3,
    '折叠后参与布局的节点只剩根（' + before + ' -> ' + laidSet().size + ' 个）');
  ok(leaf.el.style.display === 'none', '折叠后子节点被 display:none 隐藏');

  // 2) 再单击 -> 展开还原
  e = mkEv(); parent.el._listeners.click[0](e);
  await wait(delay + 250);
  ok(parent.collapsed === false && leaf.el.style.display === '',
    '再单击一次展开还原（子节点重新可见）');

  // 3) 双击：click, click, dblclick 三连 —— 不能误折叠
  parent.el._listeners.click[0](mkEv());
  parent.el._listeners.click[0](mkEv());
  e = mkEv(); parent.el._listeners.dblclick[0](e);
  ok(e._sp === true, '双击 stopPropagation');
  ok(api.getSEL() === parent, '双击选中该节点');
  ok(reg['side']._cls.has('open'), '双击打开编辑面板');
  ok(reg['sideTitle'].textContent.indexOf('编辑节点：r') === 0,
    '面板标题以节点 ID 打头（实际 ' + reg['sideTitle'].textContent + '）');
  const tNid = reg['sideTitle'].children.find(c => c._cls.has('nid'));
  ok(!!tNid && String(tNid.textContent) === 'r', '标题里的 ID 是独立 span（可点复制）');
  ok(String(reg['sideTitle'].textContent).indexOf('根') > 0, '标题里仍带一条浅色描述做提示');
  await wait(delay + 250);
  ok(parent.collapsed === false, '双击不会误触发折叠（第一下 click 已被取消）');

  // 4) 叶子节点单击 -> 无子节点，什么都不发生
  e = mkEv(); leaf.el._listeners.click[0](e);
  await wait(delay + 250);
  ok(leaf.collapsed === false && !leaf.el.querySelector('.badge'),
    '叶子节点单击不折叠、不给数量徽标');

  console.log('  单击折叠 / 双击编辑互不打架 OK');

  /* ---------- N. 汇合节点：只画一个框 + 每个父节点补一条虚线箭头 + 文字截断 ---------- */
  console.log('\n=== N. 汇合节点（merge）===');
  const mergeRaw = { activeScheme: 'mg', schemes: [{
    id: 'mg', name: '汇合', start: 'r', floating: [],
    nodes: {
      r: { id:'r', title:'根', camp:'root', shishen:[], yuhun:[], note:'', children:['a','b'] },
      a: { id:'a', title:'路线甲', camp:'mine', shishen:[], yuhun:[], note:'', children:['s'] },
      b: { id:'b', title:'路线乙', camp:'enemy', shishen:[], yuhun:[], note:'', children:['s'] },
      s: { id:'s', title:'殊途同归：两条路都走这套御魂配置', camp:'mine', shishen:[], yuhun:[], note:'', children:['z'] },
      z: { id:'z', title:'收尾', camp:'mine', shishen:[], yuhun:[], note:'', children:[] }
    } }] };
  api.setCFG(api.validate(mergeRaw));
  api.getCFG().layout.sharedNodeMode = 'merge';
  api.rebuild();

  const instOf = nid => allInst().filter(n => n.nid === nid);
  ok(instOf('s').length === 1, 'merge 模式：共享节点全图只渲染 1 个框（实际 ' + instOf('s').length + '）');
  ok(instOf('b') && instOf('b')[0].children.length === 0, '多余的父节点不再挂重复子树（乙变成叶子）');
  const mg = api.mergeEdges();
  ok(mg.length === 1, '补出 1 条汇合虚线箭头（实际 ' + mg.length + '）');
  ok(mg[0][0].nid === 'b' && mg[0][1].nid === 's', '箭头从乙指到共享节点 s');
  ok(api.getMergeEdges().length === 1 && api.getFirst()['s'] === mg[0][1], '记下了汇合边与首个实例');
  checkLayout('汇合merge');

  const sEl = instOf('s')[0].el;
  const sTxt = sEl.children.find(c => c._cls.has('txt'));
  const full = '殊途同归：两条路都走这套御魂配置';
  ok(String(sTxt.textContent) === full.slice(0, 10) + '…',
    '汇合点图内文字截断到 10 字 + 省略号（实际 ' + sTxt.textContent + '）');
  ok(String(sTxt.title).indexOf(full) >= 0, '悬停提示里带全文（' + full.length + ' 字）');
  const mgb = sEl.children.find(c => c._cls.has('mgbadge'));
  ok(!!mgb && String(mgb.textContent) === '⤵2', '汇合徽标显示入度 ⤵2（实际 ' + (mgb && mgb.textContent) + '）');
  ok(!sEl.querySelector('.badge'), '汇合徽标不占用折叠计数的 .badge 类名');
  ok(instOf('a')[0].el.children.some(c => c._cls.has('mgbadge')) === false, '普通节点没有汇合徽标');

  // sharedTitleMax = 0 -> 不截断
  api.getCFG().layout.sharedTitleMax = 0; api.rebuild();
  ok(String(instOf('s')[0].el.children.find(c => c._cls.has('txt')).textContent) === full,
    'sharedTitleMax=0 时恢复显示全文');
  api.getCFG().layout.sharedTitleMax = 10;

  // collapse 模式回退：保留「↻ 复用」副本，且不再有汇合箭头
  api.getCFG().layout.sharedNodeMode = 'collapse'; api.rebuild();
  ok(allInst().filter(n => n.nid === 's').length === 2, 'collapse 模式仍是两个副本（老行为保留）');
  ok(api.mergeEdges().length === 0, 'collapse 模式不画汇合箭头');
  const refInst = allInst().filter(n => n.nid === 's' && n.isRef)[0];
  ok(!!refInst && refInst.collapsed === true && instOf('s').length === 2, '第 2 处仍是折叠的「↻ 复用」副本');
  checkLayout('汇合collapse');
  api.getCFG().layout.sharedNodeMode = 'merge'; api.rebuild();

  /* 汇合线画在节点之上：不然长距离那条虚线会被沿途的框盖住，看着像连错了框 */
  const topH = get('wiresTop').innerHTML || '', botH = get('wires').innerHTML || '';
  ok((topH.match(/<path /g) || []).length === 2,
    '汇合线单独一层 #wiresTop：1 条半透明底衬 + 1 条虚线（实际 ' + ((topH.match(/<path /g) || []).length) + '）');
  ok((topH.match(/data-casing/g) || []).length === 1, '底衬带 data-casing 标记（导出 PNG 时要降透明度）');
  ok(!/stroke-dasharray/.test(botH), '普通父子线还在 #wires 那层，汇合线不再混在底下');

  /* 共享框在左边（深度更浅）时的绕行走线：不能从一堆框身上压过去 */
  const backRaw = { activeScheme: 'bk', schemes: [{
    id: 'bk', name: '回指', start: 'r', floating: [],
    nodes: {
      // 注意别写成环：回指的目标不能是自己的祖先（validate 会断环，那就测不到汇合了）
      r:  { id:'r',  title:'根',        camp:'root',  shishen:[], yuhun:[], note:'', children:['a','b'] },
      a:  { id:'a',  title:'浅层共享点', camp:'mine',  shishen:[], yuhun:[], note:'', children:['a2'] },
      a2: { id:'a2', title:'二层',      camp:'mine',  shishen:[], yuhun:[], note:'', children:['a3'] },
      a3: { id:'a3', title:'三层',      camp:'mine',  shishen:[], yuhun:[], note:'', children:[] },
      b:  { id:'b',  title:'另一条路',   camp:'enemy', shishen:[], yuhun:[], note:'', children:['b2'] },
      b2: { id:'b2', title:'二层乙',    camp:'enemy', shishen:[], yuhun:[], note:'', children:['b3'] },
      b3: { id:'b3', title:'三层乙',    camp:'enemy', shishen:[], yuhun:[], note:'', children:['a'] }
    } }] };
  api.setCFG(api.validate(backRaw));
  api.getCFG().layout.sharedNodeMode = 'merge';
  api.rebuild();
  const bkE = api.mergeEdges();
  ok(bkE.length === 1 && bkE[0][0].nid === 'b3' && bkE[0][1].nid === 'a',
    '深层分支回指浅层共享点：补 1 条汇合边（' + bkE.map(e => e[0].nid + '→' + e[1].nid).join(',') + '）');
  const bkDs = [...(get('wiresTop').innerHTML || '').matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  ok(bkDs.length === 2, '回指那条也是 1 底衬 + 1 虚线');
  const bkLast = bkDs[bkDs.length - 1] || '';
  ok(!/NaN|undefined/.test(bkLast), '绕行折线里没有 NaN');
  const bn = (bkLast.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const ex = bn[bn.length - 2], ey = bn[bn.length - 1];
  const tg = allInst().filter(n => n.nid === 'a')[0];
  ok(isFinite(ex) && isFinite(ey), '末端坐标有效（' + ex + ',' + ey + '）');
  ok(ex >= tg.x && ex <= tg.x + tg.w, '末端落在共享框横向范围内（x=' + ex + '，框 ' + tg.x + '~' + (tg.x + tg.w) + '）');
  ok(Math.abs(ey - tg.y) < 1 || Math.abs(ey - (tg.y + tg.h)) < 1,
    '末端扎在共享框的上/下边缘（y=' + ey + '，框 ' + tg.y + '~' + (tg.y + tg.h) + '）');
  checkLayout('回指汇合');
  api.setCFG(api.validate(mergeRaw));
  api.getCFG().layout.sharedNodeMode = 'merge';
  api.rebuild();
  console.log('  汇合：单一框 + 汇合箭头 + 截断 / 悬停全文 / 徽标 + 绕行不压框 OK');

  /* ---------- O. 原地编辑不动当前视角 ---------- */
  console.log('\n== O. 编辑节点不搬镜头 ==');
  const wheelAt = (x, y) => api.getStage()._listeners.wheel[0]({
    target: { closest: () => null, tagName: 'DIV' }, deltaY: -120, clientX: x, clientY: y,
    preventDefault() {}
  });
  const sameView = (a, b) => a.sc === b.sc && a.tx === b.tx && a.ty === b.ty;

  // 造一个「用户已经缩放/平移到某处」的视角
  wheelAt(400, 300); wheelAt(520, 360);
  const vUser = api.getView();
  ok(!sameView(vUser, { sc: 1, tx: 24, ty: 24 }), '先用滚轮构造一个非默认视角（sc=' + vUser.sc + '）');

  const rootInst = api.getROOTS()[0];
  api.selectNode(rootInst, rootInst.el);
  reg['f_title'].value = '根：改过的描述';
  reg['f_hand'].value = '1';
  reg['f_yh'].value = '';
  reg['f_note'].value = '改备注';
  foot('应用').onclick();
  ok(api.scheme().nodes[rootInst.nid].title === '根：改过的描述', '「应用」确实写回了内容');
  ok(sameView(api.getView(), vUser),
    '点「应用」后视角纹丝不动（sc/tx/ty 全保持：' + JSON.stringify(api.getView()) + '）');
  ok(api.getSEL() && api.getSEL().nid === rootInst.nid, '应用后仍选中该节点（面板没被顶掉）');

  // 新增子卡 / 复用 这些原地编辑同样不动镜头
  foot('＋ 新增子卡').onclick();
  ok(sameView(api.getView(), vUser), '「＋ 新增子卡」后视角也不动');

  // 但默认 rebuild()（换方案等场景）仍会重新适配
  api.rebuild();
  ok(!sameView(api.getView(), vUser), '默认 rebuild() 仍会重新适配视图（只用于换图场景）');
  console.log('  编辑 / 加卡 / 复用 都不动镜头，换方案才会重新适配 OK');

  /* ---------- P. 只看体系：收起的框把子孙一并收起，之后按需一级级展开 ---------- */
  console.log('\n== P. 只看体系：按需一级级展开 ==');
  api.setCFG(api.validate(JSON.parse(JSON.stringify(CFG0))));
  api.rebuild();
  const foldBtn = reg['tools'].children.find(b => b.textContent === '只看体系');
  ok(!!foldBtn, '顶栏有「只看体系」按钮');
  foldBtn.onclick();
  // 用户确认这两个入口不需要了：顶栏按钮、动作表、面板实现都不该再出现
  ok(!/openConfig\s*\(/.test(html), '「页面设置」面板实现已删除（源码里不再有 openConfig()）');
  ok(!/EDITMODE|toggleEdit/.test(html), '顶栏「编辑」开关已删除（不再有 EDITMODE / toggleEdit）');

  const visCount = () => allInst().filter(n => n.el.style.display !== 'none').length;
  const leaked = allInst().filter(n => n.d >= 1 && !n.collapsed);
  ok(leaked.length === 0,
    '「只看体系」后所有 d>=1 的节点都收起了（含子孙，实际漏了 ' + leaked.length + ' 个）');
  const roots = api.getROOTS().length, d1 = allInst().filter(n => n.d === 1);
  const base = visCount();
  ok(base === roots + d1.length, '收起后可见 = 各根 + 一级分支（' + base + ' = ' + roots + ' + ' + d1.length + '）');

  const pick = d1.find(n => n.children.length >= 1);
  pick.collapsed = false; api.layout();
  ok(visCount() === base + pick.children.length,
    '展开一个一级分支只多露出它那一层（' + visCount() + ' = ' + base + ' + ' + pick.children.length + '）');
  ok(allInst().filter(n => n.el.style.display !== 'none' && n.d >= 3).length === 0, '不会顺带把更深的后代也展开');

  const deeper = pick.children.find(c => c.children.length >= 1);
  if (deeper) {
    const mid = visCount();
    deeper.collapsed = false; api.layout();
    ok(visCount() === mid + deeper.children.length, '再展开下一级才露出再下一层（可逐级按需展开）');
  }
  console.log('  逐级展开：收起时连子孙一起收，展开一层露一层 OK');

  /* ================= Q. 点空白关面板：判定必须在捕获阶段 =================
     真 bug：面板里点头像格子时，格子自己的 onclick 会 grid.innerHTML='' 重建整片网格，
     被点中的元素当场脱离 #side；若「是否点在 UI 内」等到冒泡到 window 再算，
     closest('#side') 已经找不到祖先 → 被当成「点画布空白」把面板关掉（选不了式神）。
     这里只能验结构（判定函数的真值表 + 捕获阶段确实注册了监听器）；
     真实点击的行为由 shot.js 的 3b / 4b / 4c 三步在浏览器里验。 */
  console.log('\n== Q. 「点空白关面板」的判定时机 ==');
  const cap = api.getWinCap();
  ok((cap.click || []).some(Boolean),
    'window 的 click 监听里有一个是捕获阶段注册的（先在 DOM 被改之前判定）');

  const inst0 = api.getROOTS()[0];
  api.selectNode(inst0, inst0.el);                // 确保面板渲染过（顺带验证渲染不炸）
  ok(!!reg['ss_grid'] && reg['ss_grid'].children.length > 0, '编辑面板能渲染出头像格子（Q 段前提）');
  // 桩只解析顶层 innerHTML、不把子元素 parentEl 接到容器上，所以这里手搭父子链来跑真实 closest()；
  // 真实点击行为由 shot.js 的 3b / 4b / 4c 三步在浏览器里验。
  const chain = (tag, cls, parentId) => {
    const p = new El('div'); p._attrs = { id: parentId };
    const kid = new El(tag); if (cls) kid.className = cls;
    p.appendChild(kid); return kid;
  };
  const blank = { tagName: 'DIV', closest: () => null };
  ok(api.isUIEl(chain('img', '', 'side')), '面板里的头像格子算「UI 内」（点它不该关面板）');
  ok(api.isUIEl(chain('input', '', 'side')), '面板里的输入框算「UI 内」');
  ok(api.isUIEl(chain('div', '', 'side')), '面板里的任意 div（已选标签 / 引用行）算「UI 内」');
  ok(api.isUIEl(chain('div', 'node', 'world')), '导图节点框算「UI 内」（点它不该关面板）');
  ok(api.isUIEl({ tagName: 'DIV', closest: s => (s === 'button' ? {} : null) }),
    '面板里的按钮算「UI 内」（面板常被重建，按钮脱离 #side 后靠这层兜底）');
  ok(api.isUIEl({ tagName: 'DIV', closest: s => (s === '#sheetBar' ? {} : null) }),
    '式神配置表算「UI 内」');
  ok(!api.isUIEl(blank), '画布空白不算「UI 内」（该关面板）');
  ok(!api.isUIEl(null), 'null / 非元素不会误判成 UI');
  console.log('  判定真值表 + 捕获阶段注册 OK');

  /* ============ R. 导出：JSON / 单 HTML（只读）/ PNG ============ */
  console.log('\n== R. 导出三种格式 ==');
  const scR = api.scheme();
  ok(!!scR, '取得到当前方案');

  // R1 —— JSON：单方案、去掉 builtin、还能被 schemesFromJson 认回来
  const rj = JSON.parse(api.schemeExportJson());
  ok(!rj.builtin, 'JSON 导出里不带 builtin（导入方自己决定是不是固化）');
  ok(!!(Array.isArray(api.schemesFromJson(rj)) && api.schemesFromJson(rj).length === 1),
    '导出的 JSON 能被 schemesFromJson 认回来');
  ok(!!rj.nodes && (rj.sheet === undefined || Array.isArray(rj.sheet && rj.sheet.rows)),
    'JSON 带着节点表（有配置表时一并带上）');

  // R2 —— 单 HTML：只装这一个方案 + 注入只读开关和内联头像
  const vc = api.viewerConfig(scR);
  ok(Array.isArray(vc.schemes) && vc.schemes.length === 1, '它只看得到这一个方案（实际 ' +
    ((vc.schemes || []).length) + ' 个）');
  ok(vc.activeScheme === scR.id, 'activeScheme 指向这个方案');
  ok(vc.schemes[0].builtin === true, '方案标成固化，导出页不会闪「仅存本机」的提醒');
  ok(vc.schemes[0].id === scR.id && !!vc.schemes[0].nodes, '节点数据在');
  ok(!('Meta' in vc) && Array.isArray(vc.yuhun || []) && !!vc.assets, '页面配置（样式 / 别名 / 头像索引）跟着走');

  const avNames = api.schemeAvatarNames(scR);
  ok(avNames.length > 0, '能列出方案里用到的式神（' + avNames.length + ' 个）');
  const inline = {}; avNames.forEach((n, i) => inline[n] = 'data:image/png;base64,STUB' + i);
  const vh = api.buildViewerHtml(scR, inline);
  ok(!!vh, '能生成单 HTML（骨架找到了 cfg-embed）');
  if (vh) {
    ok(vh.indexOf('<!DOCTYPE html>') === 0, '产物以 DOCTYPE 开头，双击就能打开');
    ok(vh.indexOf('window.__READONLY__=1') > 0, '注入了只读开关 __READONLY__=1');
    ok(vh.indexOf('window.__AV_INLINE__=') > 0, '注入了内联头像表 __AV_INLINE__');
    ok(vh.indexOf('window.__AV_INLINE__=') < vh.indexOf('id="cfg-embed"'),
      '注入脚本排在内嵌配置之前（渲染时才读得到头像）');
    avNames.slice(0, 3).forEach(n =>
      ok(vh.indexOf(JSON.stringify(n)) >= 0 || vh.indexOf(n) >= 0, '内联头像表里带上了「' + n + '」'));
    const m = /<script id="cfg-embed"[^>]*>([\s\S]*?)<\/script>/.exec(vh);
    ok(!!m, '产物里只有一份 cfg-embed');
    if (m) {
      const got = JSON.parse(m[1].replace(/<\\\//g, '</'));
      ok(got.schemes.length === 1, '产物里原来的多方案配置被换掉了（剩下 ' + got.schemes.length + ' 个方案）');
      ok(got.activeScheme === scR.id, '产物的默认方案指向导出的那个');
    }
  }
  console.log('  导出：JSON 可回导 / 单 HTML 自带数据与头像且只读 OK' +
    (vh ? '（产物 ' + Math.round(vh.length / 1024) + ' KB · 内联头像 ' + avNames.length + ' 张 · 节点 ' +
      Object.keys(scR.nodes || {}).length + ' 个）' : ''));

  // 静态自检：HTML 解析器不管 JS 里的注释 / 字符串，主脚本里一旦出现字面 script 结束标签，
  // 浏览器就会在那里提前把脚本截断 —— 整页直接不渲染。踩过一次，这里钉住。
  const tagCloses = (html.match(/<\/script/g) || []).length;
  ok(tagCloses === 2, 'index.html 里字面 script 结束标签恰好 2 个（cfg-embed + 主脚本），实际 ' +
    tagCloses + ' 个 —— 多一个就会把主脚本提前截断');
  ok((vh.match(/<\/script/g) || []).length === 3,
    '导出的单 HTML 里脚本标签成对（3 开 3 闭），实际 ' + ((vh.match(/<\/script/g) || []).length) + ' 个');
  // 只读产物必须自带数据：启动时既不能读旁边的 config.json，也不能读浏览器 localStorage
  // （同源时会把原页面的方案一起带进来），否则「只导出选定方案」就不成立
  ok(/setPublished\(READONLY \? null : fetchExt\(\)\)/.test(html) &&
     /validate\(READONLY \? null : loadLocal\(\)\)/.test(html),
    '只读产物的启动过程不读外部 config.json 与 localStorage（否则别的方案会被带进来）');
  ok(/assets\/avatars-inline\.js/.test(html), '页面知道去哪儿加载头像包（file:// 下导出靠它）');
  console.log('  静态自检：脚本标签闭合计数 OK（' + tagCloses + ' / 导出产物 3）· 只读自带数据 · 头像包入口在');

  /* === S. 视图设置（layout）的版本同步 ===
     踩过的坑：老版本页面往 localStorage 存过 sharedNodeMode:"collapse"，
     浏览器那份会和当前页面共用同一个 key（file:// 下更是全站同一 origin），
     于是一打开新版就被旧偏好压回去 —— 表现就是「复用节点还是多画一个框」。
     layout 是显示方式、没有编辑入口，本地那份旧了就该整体换成发布版。 */
  console.log('\n=== S. 视图设置版本同步（旧偏好不再反压新版）===');
  const EMB = JSON.parse(html.match(/<script id="cfg-embed"[^>]*>([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
  ok(EMB.layout && typeof EMB.layout.rev === 'number' && EMB.layout.rev >= 1,
    '发布版 layout 带 rev 版本号（实际 ' + (EMB.layout && EMB.layout.rev) + '）');
  ok(EMB.layout.sharedNodeMode === 'merge', '发布版默认就是 merge（只画一个框 + 虚线箭头）');

  // 1) 老访客：本地存着 collapse 且完全没有 rev —— 应当被升级成发布版
  const staleRaw = { layout: { sharedNodeMode: 'collapse', sharedTitleMax: 10, defaultExpanded: true } };
  const staleCfg = api.validate(JSON.parse(JSON.stringify(staleRaw)));
  ok(staleCfg.layout.sharedNodeMode === 'merge',
    '无 rev 的旧本地 layout 被升级为发布版（实际 ' + staleCfg.layout.sharedNodeMode + '）');
  ok(api.getWARN().some(w => w.indexOf('视图设置已升级') >= 0), '升级时给出告警说明');

  // 2) 当访客本地就是最新版（rev 相同）：尊重他这份，哪怕是 collapse
  const curRaw = { layout: { rev: EMB.layout.rev, sharedNodeMode: 'collapse' } };
  const curCfg = api.validate(JSON.parse(JSON.stringify(curRaw)));
  ok(curCfg.layout.sharedNodeMode === 'collapse', 'rev 相同的本地 layout 保留访客这份（collapse 可用作回退）');
  ok(!api.getWARN().some(w => w.indexOf('视图设置已升级') >= 0), 'rev 相同时不再反复重置、也不误报告警');

  // 3) 升级过一次之后，落盘再读回来就不会再被重置（rev 已跟着写进去）
  api.setCFG(api.validate(JSON.parse(JSON.stringify(staleRaw))));
  api.saveLocal();
  const back = api.loadLocal();
  ok(back && back.layout && back.layout.rev === EMB.layout.rev, '升级后的 layout 连 rev 一起落盘（再打开不再重置）');
  api.clearLocal();

  // 4) 默认值不能被写脏：直接往 CFG.layout 上写值（页面配置面板改设置就是这么写的），
  //    再 validate 一次，拿到的必须还是发布版那份默认值
  api.setCFG(api.validate(null));
  api.getCFG().layout.sharedNodeMode = 'collapse';
  const after = api.validate(null);
  ok(after.layout.sharedNodeMode === 'merge',
    '往 CFG.layout 上写值不会污染内嵌默认值（再校验一次仍是 merge，实际 ' + after.layout.sharedNodeMode + '）');

  // 5) 静态自检：syncLayoutRev 必须在 applySchema 之前跑，否则非法值先被兜底、容易掩盖问题
  const iSync = html.indexOf('syncLayoutRev(cfg, raw)'), iSch = html.indexOf('applySchema(cfg);');
  ok(iSync > 0 && iSch > iSync, 'validate() 里 syncLayoutRev 在 applySchema 之前（顺序钉住）');
  // 顺带钉住 validate 的深拷贝：deepMerge 顶层是浅拷贝，不拷一次的话
  // 后续写 cfg.layout 会把 EMBED 那份也改掉，下一次 validate 的「默认值」就不再干净了
  ok(/JSON\.parse\(JSON\.stringify\(deepMerge\(EMBED, raw\)\)\)/.test(html),
    'validate() 深拷贝合并结果，不共用 EMBED 的对象引用');
  ok(/setPublished\(READONLY \? null : fetchExt\(\)\)/.test(html), 'PUB_BASE 由 setPublished 一起注入（含 config.json）');
  // 6) 顶栏按钮同理：旧页面把「编辑 / 配置」存进本地后，不能把新版压回去
  const oldBtns = [
    {id:'fit', label:'适应窗口', action:'view', show:true},
    {id:'fold', label:'只留体系', action:'foldTop', show:true},
    {id:'edit', label:'编辑', action:'toggleEdit', show:true},
    {id:'cfg',  label:'配置',   action:'openConfig', show:true},
    {id:'theme',label:'暗色',   action:'toggleTheme', show:true}
  ];
  const oldUi = api.validate({ ui: { buttons: JSON.parse(JSON.stringify(oldBtns)) } });
  const uiLabels = (oldUi.ui.buttons || []).map(b => b.label).join('/');
  ok(uiLabels === '适应窗口/只看体系/暗色',
    '本地存过的旧顶栏（含 编辑 / 配置）被发布版顶掉（实际 ' + uiLabels + '）');
  ok(!(oldUi.ui.buttons || []).some(b => b.action === 'toggleEdit' || b.action === 'openConfig'),
    '刷新后不再有 toggleEdit / openConfig 这两个动作');
  ok(api.getWARN().some(w => w.indexOf('顶栏按钮已按发布版刷新') >= 0), '刷新时给出一次告警说明');
  // 本地没改过（和发布版一致）时不该弹告警
  api.setCFG(api.validate(null));
  const w0 = api.getWARN().length;
  api.validate({ ui: { buttons: JSON.parse(JSON.stringify(EMB.ui.buttons)) } });
  ok(api.getWARN().length === w0, '本地顶栏与发布版一致时不误报告警');
  ok(/syncUiButtons\(cfg, raw\)/.test(html), 'validate() 里真的调了 syncUiButtons（源码静态自检）');

  console.log('  旧偏好升级 / 同版本保留 / 落盘不再重置 / 调用顺序 / 顶栏不被旧本地配置压回 OK');

  /* ==== T. 拖节点（dx/dy 偏移量）与右键菜单 ==== */
  console.log('\n=== T. 拖节点 + 右键菜单 ===');
  const tRaw = { activeScheme: 't', schemes: [{
    id: 't', name: '拖拽测试', start: 'r', floating: [],
    nodes: {
      r:  { id:'r',  title:'根',   camp:'root',  shishen:[], yuhun:[], note:'', children:['a','b'] },
      a:  { id:'a',  title:'甲',   camp:'mine',  shishen:[], yuhun:[], note:'', children:['a1'] },
      a1: { id:'a1', title:'甲一', camp:'mine',  shishen:[], yuhun:[], note:'', children:[] },
      b:  { id:'b',  title:'乙',   camp:'enemy', shishen:[], yuhun:[], note:'', children:[] }
    } }] };
  api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
  api.rebuild();

  // 1) 偏移量字段的兜底：不是有限数字 / 大得离谱 -> 丢掉并告警，绝不能进布局变 NaN
  const badRaw = JSON.parse(JSON.stringify(tRaw));
  badRaw.schemes[0].nodes.a.dx = '40'; badRaw.schemes[0].nodes.a.dy = null;
  badRaw.schemes[0].nodes.b.dx = 999999;
  const badCfg = api.validate(badRaw);
  ok(badCfg.schemes[0].nodes.a.dx === undefined && badCfg.schemes[0].nodes.a.dy === undefined,
    'dx/dy 不是数字时丢掉（不能变成 NaN 进布局）');
  ok(badCfg.schemes[0].nodes.b.dx === undefined, '大得离谱的偏移量也丢掉');
  ok(api.getWARN().filter(w => /的 (dx|dy) /.test(w)).length === 3,
    '三种坏值各给一条告警（实际 ' + api.getWARN().filter(w => /的 (dx|dy) /.test(w)).length + ' 条）');
  const okRaw = JSON.parse(JSON.stringify(tRaw));
  okRaw.schemes[0].nodes.a.dx = 30; okRaw.schemes[0].nodes.a.dy = -12;
  const okCfg = api.validate(okRaw);
  ok(okCfg.schemes[0].nodes.a.dx === 30 && okCfg.schemes[0].nodes.a.dy === -12, '正常的偏移量原样保留');

  // 2) 布局真的把偏移量叠上去
  api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
  api.rebuild();
  let a0 = api.findInst('a');
  const tBase = { x: a0.x, y: a0.y };
  api.scheme().nodes.a.dx = 120; api.scheme().nodes.a.dy = -40;
  api.rebuild();
  a0 = api.findInst('a');
  ok(Math.abs((a0.x - tBase.x) - 120) < 1 && Math.abs((a0.y - tBase.y) + 40) < 1,
    '布局把 dx/dy 叠到自动排位上（Δ=' + Math.round(a0.x - tBase.x) + ',' + Math.round(a0.y - tBase.y) + '）');
  ok(isFinite(a0.x) && isFinite(a0.y), '叠加后坐标仍是有限数');
  delete api.scheme().nodes.a.dx; delete api.scheme().nodes.a.dy;
  api.rebuild();

  // 3) 模拟一次真实拖动：按下 -> 移动 -> 松开
  let aI = api.findInst('a');
  const sc = api.getView().sc;
  aI.el._listeners.mousedown[0]({ button: 0, clientX: 100, clientY: 100, stopPropagation() {} });
  ok(!!api.getND(), '在节点上按下 -> 进入待拖状态');
  // 分多次移动（真实鼠标就是这样一帧一帧来的）：位移必须相对起点算，绝不能每次再加一遍
  for (const [cx, cy] of [[120, 110], [140, 125], [160, 140]]) winL.mousemove.forEach(f => f({ clientX: cx, clientY: cy }));
  ok(!!api.getND() && api.getND().moved === true, '超过 ' + api.NODE_DRAG_MIN + 'px 阈值才算真在拖');
  winL.mouseup.forEach(f => f({}));
  ok(api.scheme().nodes.a.dx === Math.round(60 / sc) && api.scheme().nodes.a.dy === Math.round(40 / sc),
    '偏移量 = 屏幕位移 ÷ 缩放（' + api.scheme().nodes.a.dx + ',' + api.scheme().nodes.a.dy + '）');
  ok(api.scheme().nodes.a.dx === Math.round(60 / sc),
    '★ 分多次 mousemove 不重复累加（60px 就只走 60px，实际 ' + api.scheme().nodes.a.dx + '）');
  ok(api.getNDMoved() === true, '★ 拖完置了 moved 标记（后面那下 click 不当成单击）');
  aI = api.findInst('a');
  aI.el._listeners.click[0]({ stopPropagation() {} });
  ok(api.getNDMoved() === false, '★ 随后的 click 被吃掉且不误折叠（moved 标记已被消费）');

  // 4) 手抖不算拖：位移小于阈值不写偏移量
  api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
  api.rebuild();
  let bI = api.findInst('b');
  bI.el._listeners.mousedown[0]({ button: 0, clientX: 50, clientY: 50, stopPropagation() {} });
  winL.mousemove.forEach(f => f({ clientX: 51, clientY: 51 }));
  winL.mouseup.forEach(f => f({}));
  ok(api.scheme().nodes.b.dx === undefined && api.scheme().nodes.b.dy === undefined,
    '★ 手抖 1px 不写偏移量（单击/双击的手势不被抢）');

  // 5) 开关关掉后不能拖
  api.getCFG().ui.interaction.nodeDrag = false;
  api.rebuild();
  bI = api.findInst('b');
  bI.el._listeners.mousedown[0]({ button: 0, clientX: 50, clientY: 50, stopPropagation() {} });
  ok(api.getND() === null, 'ui.interaction.nodeDrag = false 时按下去不进拖拽');
  api.getCFG().ui.interaction.nodeDrag = true;

  // 6) 右键菜单：项目与两个必须挡住的边界
  api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
  api.rebuild();
  const rI = api.findInst('r'), items4r = api.ctxItems(rI);
  const labels = items4r.filter(i => !i.sep).map(i => i.label).join(' / ');
  ok(labels === '编辑 / 添加子节点 / 添加同级节点 / 复位位置 / 删除节点', '菜单项 = ' + labels);
  const sib4r = items4r.find(i => i.label === '添加同级节点');
  ok(!!sib4r && sib4r.disabled === true && /根节点/.test(sib4r.tip || ''),
    '★ 根节点没有父级 -> 「添加同级节点」灰掉并说明原因');
  const rst0 = items4r.find(i => i.label === '复位位置');
  ok(!!rst0 && rst0.disabled === true, '没拖过的框上「复位位置」是灰的');

  // 被多处复用的节点：父级不止一个，同级插到哪说不清 -> 也灰掉
  api.scheme().nodes.a.children.push('b');      // b 现在被 r 和 a 两处引用
  api.rebuild();
  const bShared = api.findInst('b');
  ok(api.parentOf(api.scheme(), 'b').length === 2, '构造出 2 处引用');
  const sib4b = api.ctxItems(bShared).find(i => i.label === '添加同级节点');
  ok(!!sib4b && sib4b.disabled === true && /2 处复用/.test(sib4b.tip || ''),
    '★ 被多处复用的节点：「添加同级节点」灰掉并说明（不猜插到哪一处）');
  ok(api.ctxItems(bShared).find(i => i.label === '删除整个节点'), '多处引用时删除项写成「删除整个节点」');

  // 7) 三个动作真的生效
  api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
  api.rebuild();
  api.ctxItems(api.findInst('a')).find(i => i.label === '添加子节点').run();
  ok(api.scheme().nodes.a.children.length === 2, '「添加子节点」挂到了这个节点下');
  const rBefore = api.scheme().nodes.r.children.slice();
  api.ctxItems(api.findInst('a')).find(i => i.label === '添加同级节点').run();
  const rAfter = api.scheme().nodes.r.children;
  ok(rAfter.length === rBefore.length + 1 && rAfter[rBefore.indexOf('a')] === 'a' &&
     rAfter[rBefore.indexOf('a') + 1] !== 'b', '「添加同级节点」插在它后面，顺序对');
  // 复位位置：拖过之后就不是灰的，点了就把偏移量清掉
  api.scheme().nodes.b.dx = 66; api.scheme().nodes.b.dy = 33; api.rebuild();
  const rst = api.ctxItems(api.findInst('b')).find(i => i.label === '复位位置');
  ok(!!rst && rst.disabled === false, '拖过之后「复位位置」可用');
  rst.run();
  ok(api.scheme().nodes.b.dx === undefined && api.scheme().nodes.b.dy === undefined, '复位后偏移量清掉');

  // 8) 菜单本身不能把面板误关：源码里的 isUIEl 要认得它
  ok(/t\.closest\('#ctxMenu'\)/.test(html), 'isUIEl 认得 #ctxMenu（点菜单不会被当成点画布空白）');
  ok(/world\.addEventListener\('contextmenu'/.test(html) && /ev\.preventDefault\(\)/.test(html),
    '右键菜单挂在 #world 上并拦掉浏览器菜单');
  ok(/nodeOffset\(n\.node\)/.test(html), 'layout() 里真的叠了偏移量（源码静态自检）');

  // 9) 触发链：右键这条路上有两道门（mousedown + contextmenu），且菜单不在 #stage 里
  //    放在 #stage 里会被 overflow:hidden 裁掉，缩放/平移也会把坐标系带歪 —— 必须挂 body + fixed
  {
    const skel = html.slice(html.indexOf('<body'), html.indexOf('<script id="cfg-embed"'));
    ok(/<div id="ctxMenu"><\/div>/.test(skel), '#ctxMenu 在骨架里（不是凭空 getElementById）');
    const stageBlock = skel.slice(skel.indexOf('id="stage"'), skel.indexOf('id="side"'));
    ok(stageBlock.indexOf('ctxMenu') < 0, '#ctxMenu 不在 #stage 内部（否则被 overflow:hidden 裁掉）');
    ok(/#ctxMenu\{position:fixed/.test(html), '#ctxMenu 用 position:fixed 视口定位');
    ok(/world\.addEventListener\('mousedown', ev=>\{ if\(ev\.button === 2\) ctxTrigger\(ev\); \}\)/.test(html),
      '右键按下就走一遍 ctxTrigger（contextmenu 不派发的环境也有反应）');
    ok(/if\(ev\.button !== 0\) return;\s*\/\/ 右键/.test(html),
      '#stage 的 mousedown 不处理右键（否则刚弹的菜单被自己关掉）');
  }
  // 10) 端到端走一次触发链：fake 一个右键事件，看菜单真的出现、且连发两发不会翻倍
  {
    api.setCFG(api.validate(JSON.parse(JSON.stringify(tRaw))));
    api.rebuild();
    const menu = api.ctxMenuEl();
    let prevented = 0;
    const fakeEv = {button: 2, clientX: 300, clientY: 200,
                    target: api.findInst('a').el, preventDefault: () => { prevented++; }};
    ok(api.ctxTrigger(fakeEv) === true, 'ctxTrigger 认得出右键目标节点');
    ok(menu.style.display === 'block', '右键后菜单真的显示出来（display:block）');
    const n1 = menu.children.length;
    ok(n1 >= 5, '菜单项数 ≥ 5（编辑/加子/加同级/复位/删除），实际 ' + n1);
    api.ctxTrigger(fakeEv);                            // 同一手势的第二发（浏览器补派 contextmenu）
    ok(menu.children.length === n1, '重复触发不会把菜单项叠一遍');
    ok(prevented >= 2, '两发都拦掉了浏览器原生菜单，prevented=' + prevented);
    // 画布空白处右键：不拦原生菜单，也不弹自定义菜单
    api.closeCtx();
    let p2 = 0;
    const blank = {button: 2, clientX: 10, clientY: 10, target: api.getStage(),
                   preventDefault: () => { p2++; }};
    api.ctxTrigger(blank);
    ok(p2 === 0 && menu.style.display === 'none', '画布空白处右键：留给浏览器原生菜单');
  }
  console.log('  拖节点：阈值 / 缩放换算 / 开关 / 不抢单击 与 右键菜单：三项 + 两处边界 OK');

  console.log('\n' + (FAIL === 0 ? 'ALL CHECKS PASSED' : 'FAILED: ' + FAIL + ' 项'));
})();
process.exitCode = FAIL ? 1 : 0;

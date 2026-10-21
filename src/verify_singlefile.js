/* 校验 dist/单文件-自带头像.html：双击打开的那份必须自带数据与头像，且是当前的 merge 版 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || 'dist/单文件-自带头像.html';
const h = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const m = /<script id="cfg-embed"[^>]*>([\s\S]*?)<\/script>/.exec(h);
if (!m) { console.log('FAIL 找不到内嵌配置'); process.exit(1); }
const c = JSON.parse(m[1].replace(/<\\\//g, '</'));

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('  FAIL ' + msg); } };

ok(c.layout && typeof c.layout.rev === 'number' && c.layout.rev >= 1,
  '内嵌 layout 带 rev（实际 ' + (c.layout && c.layout.rev) + '）');
ok(c.layout.sharedNodeMode === 'merge', '内嵌 layout 默认是 merge（实际 ' + c.layout.sharedNodeMode + '）');
ok(/syncLayoutRev\(cfg, raw\)/.test(h), '带 layout 版本同步（旧偏好不会反压新版）');
ok(/JSON\.parse\(JSON\.stringify\(deepMerge\(EMBED, raw\)\)\)/.test(h), 'validate 深拷贝，不污染内嵌默认值');
const av = (h.match(/"[^"]*":"data:image/g) || []).length;
ok(av === 276, '内嵌头像 276 张（实际 ' + av + '）');
// 只数闭合：HTML 解析器结束一段 script 只认 </script，字符串里出现的开标签无所谓
// （导出器那段模板里就有一个字面 <script> 开标签，属于正常）
const cl = (h.match(/<\/script/g) || []).length;
ok(cl === 3, 'script 闭合 3 个：内嵌配置 + 头像包 + 主脚本（实际 ' + cl + '）');
ok(/openExport/.test(h), '导出功能在内');
// 这是「可编辑的主页面」，不能被锁成只读产物（导出器里的模板字符串不算）
ok(!/^<script>window\.__READONLY__=1;<\/script>$/m.test(h), '没有把自己锁成只读导出产物');

console.log(bad === 0
  ? 'OK  ' + FILE + '（' + Math.round(h.length / 1024) + ' KB · 头像 ' + av + ' 张 · layout rev ' +
    c.layout.rev + ' · ' + c.layout.sharedNodeMode + ' · 闭合 ' + cl + '）'
  : 'FAILED: ' + bad + ' 项');
process.exit(bad ? 1 : 0);

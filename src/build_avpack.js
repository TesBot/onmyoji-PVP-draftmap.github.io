/* 头像包：把「头像名 -> dataURL」另存成一个可复用的 JS 文件 assets/avatars-inline.js。
   为什么需要它：导出（单 HTML / PNG）要取头像的二进制，而 file:// 下 fetch / XHR 都会被同源策略拦住，
   取不到就固化不进去。脚本标签不受这个限制，所以页面在导出时会动态加载这份包。
   来源优先用 dist/standalone-preview.html 里已经压好的那份（webp 80px，比原图小得多）；
   它不存在时再退回从 index.html 里找（单文件版也有）。
   用法：node src/build_avpack.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'avatars-inline.js');

const SOURCES = [
  path.join(ROOT, 'dist', 'standalone-preview.html'),
  path.join(ROOT, 'index.html')
];

function extractPack(html) {
  // 形如 <script>window.__AV_INLINE__={...};</script>
  const m = /window\.__AV_INLINE__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

let pack = null, from = '';
for (const f of SOURCES) {
  if (!fs.existsSync(f)) continue;
  const got = extractPack(fs.readFileSync(f, 'utf8'));
  if (got && Object.keys(got).length) { pack = got; from = path.relative(ROOT, f); break; }
}
if (!pack) {
  console.error('没找到可抽取的内嵌头像。先生成自包含预览版：node src/build_standalone.js');
  process.exit(1);
}

const names = Object.keys(pack);
const json = JSON.stringify(pack);
fs.writeFileSync(OUT,
  '/* 生成文件，请勿手改：头像名 -> dataURL 的映射（导出单 HTML / PNG 时用它固化头像）\n' +
  '   由 src/build_avpack.js 生成，来源 ' + from.replace(/\\/g, '/') + '，共 ' + names.length + ' 张。 */\n' +
  'window.__AV_INLINE__=' + json + ';\n', 'utf8');

console.log('来源 ' + from + '，抽出 ' + names.length + ' 张头像');
console.log('已生成 ' + OUT + '（' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB）');
console.log('页面只会在点「导出」时才动态加载它，平时不影响打开速度。');

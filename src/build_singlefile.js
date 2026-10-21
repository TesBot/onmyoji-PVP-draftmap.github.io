/* 单文件版（自带头像）：把当前的 index.html 和头像包 assets/avatars-inline.js 合成一个文件。
   和 build_standalone.js 的区别：那个是用无头 Chrome 把原图压成 webp 再内嵌（需要 Chrome）；
   这个直接复用已经压好的头像包，**不需要浏览器**，随时能跑。
   产物双击就能开、不依赖旁边任何目录（头像已内联），功能与 index.html 完全一致（可编辑）。
   用法：node src/build_singlefile.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', '单文件-自带头像.html');

const index = path.join(ROOT, 'index.html');
const pack = path.join(ROOT, 'assets', 'avatars-inline.js');
if (!fs.existsSync(index)) { console.error('找不到 index.html，先跑：python src/build_cfg.py'); process.exit(1); }
if (!fs.existsSync(pack)) { console.error('找不到头像包，先跑：node src/build_avpack.js'); process.exit(1); }

const html = fs.readFileSync(index, 'utf8');
const packTxt = fs.readFileSync(pack, 'utf8');

// 插到 <body> 之后：这样它先于页面主脚本执行，渲染时 avSrc() 就能取到内联头像
const bi = html.indexOf('<body>');
if (bi < 0) { console.error('index.html 里找不到 <body>'); process.exit(1); }
const out = html.slice(0, bi + 6) + '\n<script>' + packTxt + '</scr' + 'ipt>\n' + html.slice(bi + 6);

fs.writeFileSync(OUT, out, 'utf8');
const n = (packTxt.match(/"data:image\//g) || []).length;
console.log('内嵌头像 ' + n + ' 张');
console.log('已生成 ' + OUT + '（' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB）');
console.log('双击即可打开，不依赖 assets/ 与 config.json。');

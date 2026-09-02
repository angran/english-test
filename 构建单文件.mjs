/* =========================================================================
   把整站打成单个 HTML 文件（CSS 和所有 JS 内联）
   产出两份：
     dist/index.html        —— 任何静态空间都能直接放（GitHub Pages / 对象存储 / U盘）
     apps-script/page.html  —— 贴进 Google Apps Script 的 HTML 文件，由它托管并发邮件
   用法：在本文件夹执行  node 构建单文件.mjs
   ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));   // 自识别路径
const read = p => readFileSync(join(ROOT, p), 'utf8');

let html = read('index.html');

/* 1. 内联样式表 */
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g,
  (_, href) => '<style>\n' + read(href) + '\n</style>');

/* 2. 内联所有脚本（保持 index.html 里的加载顺序） */
const scripts = [];
html = html.replace(/<script src="([^"]+)"><\/script>\s*/g, (_, src) => {
  scripts.push(src);
  return '';
});
const bundle = scripts.map(s => '/* ===== ' + s + ' ===== */\n' + read(s)).join('\n\n');
/* 必须用函数形式替换：替换串里的 $$ 会被 String.replace 当成转义的 $，
   代码里的 $$(...) 选择器会被悄悄吃成 $(...)，页面直接崩 */
html = html.replace('</body>', () => '<script>\n' + bundle + '\n</script>\n</body>');

/* 内联后不该再剩下外链的标签（JS 字符串里的 src="${...}" 不算） */
const leftovers = html.match(/<(script[^>]*\ssrc|link[^>]*\shref)=/g);
if (leftovers) { console.error('✘ 仍有未内联的外部引用：', leftovers); process.exit(1); }

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/index.html'), html, 'utf8');

/* 3. Apps Script 版：页面在 iframe 里读不到 /exec 的查询串和网址，
      由服务端把它们注入成两个全局变量 */
const inject = `<script>
var EET_URL_PARAMS = <?!= params ?>;
var EET_BASE_URL   = <?!= baseUrl ?>;
</script>
`;
const gasHtml = html.replace('<script>\n/* ===== config.js', () => inject + '<script>\n/* ===== config.js');
if (gasHtml === html) { console.error('✘ 注入点没找到，检查脚本内联顺序'); process.exit(1); }

/* 内联后的自检：源文件里有几个 $$，产物里就该有几个 */
const srcDollars = scripts.reduce((n, s) => n + (read(s).match(/\$\$/g) || []).length, 0);
const outDollars = (gasHtml.match(/\$\$/g) || []).length;
if (srcDollars !== outDollars) {
  console.error('✘ 内联过程丢失了 ' + (srcDollars - outDollars) + ' 处 $$（replace 转义问题）');
  process.exit(1);
}
writeFileSync(join(ROOT, 'apps-script/page.html'), gasHtml, 'utf8');

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log('✔ dist/index.html        ' + kb(html.length) + '（任意静态空间）');
console.log('✔ apps-script/page.html  ' + kb(gasHtml.length) + '（贴进 Apps Script，文件名必须是 page）');
console.log('  已内联：' + scripts.join('、'));

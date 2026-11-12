/**
 * 3D 画板「新旧路径并存」无头回归（本轮增量）。
 *
 * 硬约束固化：自研路线 B（board3d.html）上线后，旧的大角几何路线 A
 * （editor.html + js/editor.js + appId + @dajiaoai/algeo-sdk）必须继续存在且
 * 未被删除/回退。本测试在「路由层」把关：
 *   - workbench.js 已把 3D 文件路由到 board3d.html，2D 仍走 board.html；
 *   - editor.html 旧路径仍在，js/editor.js 仍 import 大角 SDK、仍保留 appId 逻辑；
 *   - board3d.html 的 importmap 完全本地化（three → ./libs/three/），无任何 three 的 CDN 键；
 *   - 本地 vendor 三件套（three.module.min.js / OrbitControls.js / TransformControls.js）可达。
 *
 * 与既有 3D 测试同口径：纯静态 + 本地文件可达性断言，无需 WebGL / DOM。
 * 运行：node tests/board3d_coexist.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- A. workbench 路由：新旧并存 ---------------- */
section('A. workbench.js 路由（路线 B 生效，路线 A 不删）');
const wb = read('js/workbench.js');
assert(/mode\s*===\s*['"]3d['"]\s*\?\s*['"]board3d\.html['"]/.test(wb),
  '3D 文件路由到 board3d.html（路线 B 生效）');
assert(/mode\s*===\s*['"]3d['"]\s*\?\s*['"]board3d\.html['"]\s*:\s*['"]board\.html['"]/.test(wb),
  '非 3D 文件仍路由到 board.html（2D 路线不变）');
assert(!/editor\.html/.test(wb.replace(/['"]editor\.html['"]/g, '')),
  'workbench.js 未把 3D 路由改回 editor.html（旧路径不被复用为默认）');

/* ---------------- B. 旧路径（大角几何）完整性 ---------------- */
section('B. 旧路径 editor.html / js/editor.js / appId 完整');
assert(existsSync(join(ROOT, 'editor.html')), 'editor.html 旧路径仍存在');
const editor = read('js/editor.js');
assert(/cdn\.jsdelivr\.net\/npm\/@dajiaoai\/algeo-sdk/.test(editor),
  'js/editor.js 仍 import 大角几何 SDK（@dajiaoai/algeo-sdk）');
assert(/(appId|app_id|CFG\.[A-Za-z]*[Aa]ppId)/.test(editor + read('js/config.js')),
  'appId 配置仍保留（js/editor.js / js/config.js）');

/* ---------------- C. board3d.html importmap 完全本地化 ---------------- */
section('C. board3d.html importmap 本地化（零 three CDN）');
const html = read('board3d.html');
const im = html.match(/<script\s+type=["']importmap["'][\s\S]*?<\/script>/);
assert(!!im, 'board3d.html 含 importmap 脚本块');
if (im) {
  let map;
  try { map = JSON.parse(im[0].replace(/<[^>]+>/g, '')); } catch (_) { map = null; }
  assert(!!map && map.imports && map.imports.three === './libs/three/three.module.min.js',
    'importmap: three → ./libs/three/three.module.min.js（本地）');
  assert(!!map && map.imports['three/addons/'] === './libs/three/addons/',
    'importmap: three/addons/ → ./libs/three/addons/（本地）');
  const cdnKeys = Object.keys((map && map.imports) || {}).filter(k => /three/i.test(k) && /https?:|cdn|jsdelivr|unpkg/.test(map.imports[k]));
  assert(cdnKeys.length === 0, 'importmap 中无任何 three 的 CDN 键');
}

/* ---------------- D. 本地 vendor 三件套可达 ---------------- */
section('D. 本地 vendor Three.js 三件套可达');
const three = join(ROOT, 'libs/three/three.module.min.js');
const orbit = join(ROOT, 'libs/three/addons/controls/OrbitControls.js');
const tctrl = join(ROOT, 'libs/three/addons/controls/TransformControls.js');
assert(existsSync(three), 'libs/three/three.module.min.js 存在（200 可达）');
assert(existsSync(orbit), 'libs/three/addons/controls/OrbitControls.js 存在');
assert(existsSync(tctrl), 'libs/three/addons/controls/TransformControls.js 存在');

/* ---------------- 汇总 ---------------- */
console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

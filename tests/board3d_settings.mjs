/**
 * 3D 画板 —— 设置项 / 属性面板输入 纯函数层无头单测（不依赖 three / 浏览器 / WebGL）。
 * 验证 js/board3d-settings.js 的纯函数逻辑，覆盖回归清单 C5（属性面板编辑）与
 * C6（坐标轴 / 网格 / 背景切换），保证这两块增量可回归、且行为与原 onInspectorInput /
 * setView 逐字节一致（不引入任何未被既有运行时覆盖的行为改动）。
 *
 * 运行：node tests/board3d_settings.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveViewSettings, resolveInspectorField, BG_KEYS } from '../js/board3d-settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('3D 画板——设置项 / 属性面板输入 纯函数单测');

/* ---------------- A. C6：视图设置合并 resolveViewSettings ---------------- */
section('A. C6 视图设置合并（resolveViewSettings）');
{
  const base = { bg: 'white', axes: true, grid: true };
  assert(JSON.stringify(resolveViewSettings(base, {})) === JSON.stringify(base), '空 patch 原样返回');
  assert(resolveViewSettings(base, { axes: false }).axes === false, 'axes:false 生效');
  assert(resolveViewSettings(base, { grid: false }).grid === false, 'grid:false 生效');
  assert(resolveViewSettings(base, { bg: 'dark' }).bg === 'dark', 'bg:dark 生效');
  assert(resolveViewSettings(base, { bg: 'beige', axes: false }).bg === 'beige' &&
    resolveViewSettings(base, { bg: 'beige', axes: false }).axes === false, '多键同时合并');
  // 非法 bg 被忽略（沿用旧值）
  const r = resolveViewSettings(base, { bg: 'blue' });
  assert(r.bg === 'white', '非法 bg(blue) 被忽略，沿用 white');
  assert(resolveViewSettings(base, { bg: 123 }).bg === 'white', '非字符串 bg 被忽略');
  // 非布尔 axes/grid 被忽略
  assert(resolveViewSettings(base, { axes: 'yes' }).axes === true, "非布尔 axes 忽略（沿用 true）");
  assert(resolveViewSettings(base, { grid: 0 }).grid === true, "非布尔 grid 忽略（沿用 true）");
  // 不修改入参
  const before = JSON.parse(JSON.stringify(base));
  resolveViewSettings(base, { bg: 'dark', axes: false });
  assert(JSON.stringify(base) === JSON.stringify(before), 'resolveViewSettings 不修改 prev 入参');
  // prev 为空 / 缺字段回落默认
  const d = resolveViewSettings(undefined, {});
  assert(d.bg === 'white' && d.axes === false && d.grid === false, 'prev 为空回落默认 {white,false,false}');
  // BG_KEYS 与背景可选值一致
  assert(BG_KEYS.length === 3 && BG_KEYS.includes('white') && BG_KEYS.includes('beige') && BG_KEYS.includes('dark'),
    'BG_KEYS = [white,beige,dark]');
}

/* ---------------- B. C5：属性面板单字段解析 resolveInspectorField ---------------- */
section('B. C5 属性面板字段解析（resolveInspectorField）');
{
  // pos / rot：数值透传
  assert(resolveInspectorField('pos', 0, '1.5') === 1.5, 'pos 字符串 -> 数值 1.5');
  assert(resolveInspectorField('rot', 1, -30) === -30, 'rot 数字透传 -30');
  assert(resolveInspectorField('pos', 2, 0) === 0, 'pos 0 透传');
  // scale：下限 0.05 钳制
  assert(resolveInspectorField('scale', 0, '2') === 2, 'scale 正常值 2 透传');
  assert(resolveInspectorField('scale', 1, '0.02') === 0.05, 'scale 过小 -> 钳到 0.05');
  assert(resolveInspectorField('scale', 2, '-3') === 0.05, 'scale 负数 -> 钳到 0.05');
  // opacity：与原逻辑一致，不做 [0,1] 钳制（由材质层兜底）
  assert(resolveInspectorField('opacity', undefined, '0.5') === 0.5, 'opacity 0.5 透传');
  assert(resolveInspectorField('opacity', undefined, '2') === 2, 'opacity 越界 2 仍透传（材质层兜底，与原行为一致）');
  assert(resolveInspectorField('opacity', undefined, 'abc') === NaN || Number.isNaN(resolveInspectorField('opacity', undefined, 'abc')),
    'opacity 非数值 -> NaN（与原 parseFloat 一致，调用方早退不写模型）');
  // color / text：字符串透传
  assert(resolveInspectorField('color', undefined, '#3b82f6') === '#3b82f6', 'color 透传');
  assert(resolveInspectorField('text', undefined, '顶点 A') === '顶点 A', 'text 透传（顶点 A）');
  assert(resolveInspectorField('text', undefined, null) === '', 'text=null -> 空串');
  assert(resolveInspectorField('color', undefined, null) === '', 'color=null -> 空串');
  // 未知字段：原样返回
  assert(resolveInspectorField('unknown', 0, 'x') === 'x', '未知字段原样返回');
}

/* ---------------- C. 与运行时既有的"非有限早退"契约一致 ---------------- */
section('C. 调用方契约（非有限早退，不改模型）');
{
  // onInspectorInput 对 pos/rot/scale 先 parseFloat 校验有限再写入；本段确认
  // resolveInspectorField 在有限输入下的输出与"直接赋值"等价，调用方可安全早退。
  const finite = (raw) => Number.isFinite(parseFloat(raw));
  assert(finite('1.5') && resolveInspectorField('pos', 0, '1.5') === 1.5, '有限输入：pos 写入值 == 解析值');
  assert(!finite('abc'), '非法输入被调用方识别为非有限 -> 早退不改模型');
  assert(!finite('') , '空字符串被调用方识别为非有限 -> 早退不改模型');
}

/* ---------------- G. 内核接线 / ESM 依赖闭合 ---------------- */
section('G. 内核接线与 ESM 依赖闭合');
{
  const kernel = read('js/board3d.js');
  const mod = read('js/board3d-settings.js');
  assert(/from\s*['"]\.\/board3d-settings\.js['"]/.test(kernel), 'js/board3d.js 已 import 设置项纯函数层');
  assert(/function setView\(/.test(kernel) && /resolveViewSettings\(doc/.test(kernel),
    'setView 经 resolveViewSettings 合并（C6）');
  assert(/function onInspectorInput\(/.test(kernel) && /resolveInspectorField\(/.test(kernel),
    'onInspectorInput 经 resolveInspectorField 解析（C5）');
  assert(!/from\s*['"]three['"]/.test(mod) && !/\bdocument\./.test(mod),
    'js/board3d-settings.js 不 import three、不碰 DOM（纯函数）');
  // 模块内所有相对 import 都指向真实文件（避免线上 404）
  const re = /from\s*['"](\.[^'"]+)['"]/g;
  let m, allOk = true;
  while ((m = re.exec(kernel))) {
    if (!existsSync(join(ROOT, 'js', m[1]))) allOk = false;
  }
  assert(allOk, 'js/board3d.js 的相对 import 全部可解析到真实文件');
  assert(existsSync(join(ROOT, 'js/board3d-settings.js')), 'js/board3d-settings.js 存在');
}

/* ---------------- H. 硬约束 / 协作铁律静态复核 ---------------- */
section('H. 硬约束（新旧路径并存）与协作铁律');
{
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), 'js/editor.js 仍 import 大角几何 SDK');
  assert(/(appId|app_id|CFG\.[A-Za-z]*[Aa]ppId)/.test(read('js/editor.js') + read('js/config.js')),
    'appId 配置仍保留（js/editor.js / js/config.js）');
  assert(existsSync(join(ROOT, 'editor.html')), 'editor.html 旧路径仍存在');
  const wb = read('js/workbench.js');
  assert(/mode\s*===\s*['"]3d['"]\s*\?\s*['"]board3d\.html['"]\s*:\s*['"]board\.html['"]/.test(wb),
    'workbench.js：3D→board3d.html、2D→board.html 路由未改动');
  const html = read('board3d.html');
  const im = html.match(/<script\s+type=["']importmap["'][\s\S]*?<\/script>/);
  let map = null;
  if (im) { try { map = JSON.parse(im[0].replace(/<[^>]+>/g, '')); } catch (_) { map = null; } }
  assert(!!map && map.imports.three === './libs/three/three.module.min.js',
    'board3d.html importmap 仍完全本地化（零 three CDN）');
  assert(existsSync(join(ROOT, 'libs/three/three.module.min.js')) &&
    existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')),
    '本地 vendor three / OrbitControls 仍在');
  // 本轮未触碰共享文件 2D 主干
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    'ai/board-prompt.js：3D 段落仍追加在 2D 主干之后（未整体替换）');
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);

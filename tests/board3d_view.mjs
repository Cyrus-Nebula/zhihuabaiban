/**
 * 3D 画板「视角变换与重置」无头回归（回归清单 C1 / C2）。
 *
 * 覆盖：默认机位规格与 resetViewSpec 深拷贝、与真实 THREE.Spherical 的双向一致性、
 *      7 个命名视角预设、轨道旋转/缩放/平移的极角与半径钳制、脏输入规范化防护、
 *      真实 PerspectiveCamera.lookAt 后 up 不翻转、复位同时还原 position/target/up，
 *      以及内核接线 / ESM 依赖闭合 / 硬约束（新旧路径并存）的静态复核。
 *
 * 与仓库既有 3D 测试同口径：纯函数层 js/board3d-view.js 直接 import 真实实现，
 * 相机行为用本地 vendor 的 Three.js r160 真实 PerspectiveCamera / Spherical 断言
 * （纯 CPU，不需要 WebGL / DOM），不用自造的模拟相机自证；像素级目视仍按 A9 待 GPU。
 *
 * 运行：node tests/board3d_view.mjs
 */
import * as THREE from '../libs/three/three.module.min.js';
import {
  DEFAULT_VIEW, MIN_RADIUS, MAX_RADIUS, PHI_EPS, VIEW_PRESET_NAMES,
  resetViewSpec, normalizeViewSpec, sphericalFromSpec, cameraFromSpherical,
  viewPresetSpec, orbitViewSpec, zoomViewSpec, isViewSpecValid,
} from '../js/board3d-view.js';
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
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-4) => Array.isArray(a) && Array.isArray(b) &&
  a.length === 3 && b.length === 3 && a.every((v, i) => near(v, b[i], eps));
const radiusOf = (s) => Math.hypot(
  s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2],
);
/** 真实 Three.js 相机：按规格摆放 + lookAt，返回相机局部 +Y 轴在世界坐标的 Y 分量 */
function cameraUpY(spec) {
  const c = new THREE.PerspectiveCamera(spec.fov, 1, spec.near, spec.far);
  c.position.set(...spec.position);
  c.up.set(...spec.up);
  c.lookAt(...spec.target);
  c.updateMatrixWorld();
  return new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion).y;
}

/* ---------------- A. 默认规格 / 复位（C2） ---------------- */
section('A. 默认机位规格与 resetViewSpec');
{
  assert(DEFAULT_VIEW.fov === 50 && DEFAULT_VIEW.near === 0.1 && DEFAULT_VIEW.far === 1000,
    '默认投影参数 fov50 / near0.1 / far1000 与历史 init 一致');
  assert(vecNear(DEFAULT_VIEW.position, [6, 5, 8]) && vecNear(DEFAULT_VIEW.target, [0, 0, 0]),
    '默认机位 (6,5,8)、target (0,0,0)');
  assert(vecNear(DEFAULT_VIEW.up, [0, 1, 0]), '默认 up 恒为 +Y');
  const a = resetViewSpec(), b = resetViewSpec();
  assert(vecNear(a.position, DEFAULT_VIEW.position) && vecNear(a.target, DEFAULT_VIEW.target),
    'resetViewSpec 还原默认 position / target');
  a.position[0] = 999; a.target[2] = -7; a.up[1] = 0;
  assert(vecNear(b.position, [6, 5, 8]) && vecNear(DEFAULT_VIEW.position, [6, 5, 8]),
    '返回值是深拷贝：改动一份不污染另一份与 DEFAULT_VIEW');
  assert(isViewSpecValid(resetViewSpec()), '默认规格通过健康度自检');
  assert(Object.isFrozen(DEFAULT_VIEW) && Object.isFrozen(DEFAULT_VIEW.position),
    'DEFAULT_VIEW 及其向量均被冻结，防误改');
}

/* ---------------- B. 球坐标与真实 Three.js 一致性 ---------------- */
section('B. sphericalFromSpec / cameraFromSpherical 对齐真实 THREE.Spherical');
{
  const spec = resetViewSpec();
  const s = sphericalFromSpec(spec);
  const off = new THREE.Vector3(...spec.position);
  const real = new THREE.Spherical().setFromVector3(off);
  assert(near(s.radius, real.radius) && near(s.theta, real.theta) && near(s.phi, real.phi),
    '规格→球坐标与 THREE.Spherical.setFromVector3 逐项一致');
  assert(near(s.radius, Math.sqrt(125)) && near(s.theta, Math.atan2(6, 8)),
    '默认半径 √125、theta=atan2(x,z)');
  const back = cameraFromSpherical(s, spec.target);
  const realBack = new THREE.Vector3().setFromSpherical(real).toArray();
  assert(vecNear(back, realBack) && vecNear(back, [6, 5, 8]),
    '球坐标→位置与 THREE.Vector3.setFromSpherical 一致且精确还原 (6,5,8)');
  const shifted = cameraFromSpherical(s, [1, 2, 3]);
  assert(vecNear(shifted, [7, 7, 11]), 'target 平移时相机位置同步平移');
  const degenerate = sphericalFromSpec({ position: [0, 0, 0], target: [0, 0, 0] });
  assert(degenerate.radius === 0 && Number.isFinite(degenerate.phi), '退化输入不返回 NaN');
}

/* ---------------- C. 命名视角预设（C1） ---------------- */
section('C. 命名视角预设（iso / front / right / back / left / top / bottom）');
{
  assert(VIEW_PRESET_NAMES.length === 7 && Object.isFrozen(VIEW_PRESET_NAMES), '预设清单 7 项且冻结');
  for (const name of VIEW_PRESET_NAMES) {
    const s = viewPresetSpec(name);
    assert(!!s && isViewSpecValid(s), `${name}：规格合法且通过健康度自检`);
    assert(near(radiusOf(s), Math.sqrt(125)), `${name}：默认半径与等轴机位相同`);
    assert(vecNear(s.target, [0, 0, 0]) && vecNear(s.up, [0, 1, 0]),
      `${name}：target 归零、up 恒 +Y`);
    assert(cameraUpY(s) > 0, `${name}：真实相机 lookAt 后 up 未翻转（世界 Y > 0）`);
    assert(s.position.every(Number.isFinite), `${name}：位置全有限`);
  }
  assert(vecNear(viewPresetSpec('iso').position, DEFAULT_VIEW.position),
    'iso 预设精确还原默认机位 (6,5,8)');
  const front = viewPresetSpec('front').position;
  assert(near(front[0], 0) && near(front[1], 0) && front[2] > 0, 'front 从 +Z 正视');
  const right = viewPresetSpec('right').position;
  assert(right[0] > 0 && near(right[1], 0) && near(right[2], 0), 'right 从 +X 侧视');
  const back = viewPresetSpec('back').position;
  assert(near(back[0], 0) && near(back[1], 0) && back[2] < 0, 'back 从 -Z 背视');
  const top = viewPresetSpec('top').position;
  assert(top[1] > 0 && near(top[0], 0) && cameraUpY(viewPresetSpec('top')) > 0,
    'top 从 +Y 俯视且留 PHI_EPS 余量不翻转');
  assert(viewPresetSpec('nope') === null, '未知预设名返回 null（不抛异常）');
  const zoomed = viewPresetSpec('front', 20);
  assert(near(radiusOf(zoomed), 20), '自定义半径生效');
  assert(near(radiusOf(viewPresetSpec('front', 1e9)), MAX_RADIUS), '超大半径被钳制到 MAX_RADIUS');
  assert(near(radiusOf(viewPresetSpec('front', -5)), MIN_RADIUS), '非法半径被钳制到 MIN_RADIUS');
}

/* ---------------- D. 轨道变换（C1）：旋转 / 缩放 / 平移 ---------------- */
section('D. 轨道变换：极角与半径钳制、up 不翻转');
{
  const base = resetViewSpec();
  const rotated = orbitViewSpec(base, { dTheta: 0.4, dPhi: -0.3 });
  assert(isViewSpecValid(rotated), '旋转后规格合法');
  assert(near(radiusOf(rotated), radiusOf(base)), '纯旋转保持相机到 target 的距离');
  assert(vecNear(rotated.up, [0, 1, 0]) && cameraUpY(rotated) > 0, '旋转后 up 恒 +Y 且相机不翻转');
  const sp0 = sphericalFromSpec(base), sp1 = sphericalFromSpec(rotated);
  assert(near(sp1.theta - sp0.theta, 0.4) && near(sp1.phi - sp0.phi, -0.3),
    'dTheta / dPhi 按增量生效');
  const panned = orbitViewSpec(base, { pan: [2, 1, -3] });
  assert(vecNear(panned.target, [2, 1, -3]), 'pan 平移 target');
  assert(near(radiusOf(panned), radiusOf(base)), '平移时相机随 target 同步平移、距离不变');
  const zoomOut = zoomViewSpec(base, 2);
  assert(near(radiusOf(zoomOut), radiusOf(base) * 2), 'dolly=2 拉远一倍');
  const zoomIn = zoomViewSpec(base, 0.5);
  assert(near(radiusOf(zoomIn), radiusOf(base) * 0.5), 'dolly=0.5 拉近一半');
  assert(near(radiusOf(zoomViewSpec(base, 1e6)), MAX_RADIUS), '拉远越过上限被钳制');
  assert(near(radiusOf(zoomViewSpec(base, 1e-9)), MIN_RADIUS), '拉近越过下限被钳制');
  assert(near(radiusOf(zoomViewSpec(base, NaN)), radiusOf(base)), '非法 dolly 回落为 1（不破坏当前视角）');
  const flip = orbitViewSpec(base, { dPhi: 100 });
  assert(near(sphericalFromSpec(flip).phi, Math.PI - PHI_EPS), '极端上仰被钳制到 PI - PHI_EPS');
  const flip2 = orbitViewSpec(base, { dPhi: -100 });
  assert(near(sphericalFromSpec(flip2).phi, PHI_EPS), '极端下俯被钳制到 PHI_EPS');
  assert(cameraUpY(flip) > 0 && cameraUpY(flip2) > 0, '两个极端极角下真实相机 up 仍不翻转');

  // 确定性压力测试：200 步随机旋转 / 缩放 / 平移，全程规格合法、无 NaN
  let seed = 20261113, ok = true;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let cur = base;
  for (let i = 0; i < 200; i++) {
    cur = orbitViewSpec(cur, {
      dTheta: (rnd() - 0.5) * 1.2,
      dPhi: (rnd() - 0.5) * 1.2,
      dolly: 0.8 + rnd() * 0.4,
      pan: [(rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4],
    });
    const r = radiusOf(cur);
    if (!isViewSpecValid(cur) || !Number.isFinite(r) || cameraUpY(cur) <= 0) { ok = false; break; }
  }
  assert(ok, '200 步连续轨道变换全程规格合法、相机 up 不翻转、无 NaN');
}

/* ---------------- E. 脏输入规范化防护 ---------------- */
section('E. normalizeViewSpec 脏输入防护');
{
  for (const bad of [null, undefined, 42, 'x', [], {}, { position: null }, { position: [1, NaN, 3] },
    { position: [Infinity, 0, 0] }, { target: 'oops' }, { position: [1, 2] }]) {
    const s = normalizeViewSpec(bad);
    assert(isViewSpecValid(s) && vecNear(s.up, [0, 1, 0]),
      `非法输入 ${JSON.stringify(bad)} 回落为可用规格`);
  }
  assert(vecNear(normalizeViewSpec(null).position, DEFAULT_VIEW.position), '空输入回落默认机位');
  const coincide = normalizeViewSpec({ position: [0, 0, 0], target: [0, 0, 0] });
  assert(vecNear(coincide.position, DEFAULT_VIEW.position),
    '相机与 target 重合时按默认球坐标重新投影（不再退化）');
  const far = normalizeViewSpec({ position: [0, 0, 100000], target: [0, 0, 0] });
  assert(near(radiusOf(far), MAX_RADIUS), '超远机位钳制到 MAX_RADIUS，避免飞出远裁剪面');
  const close = normalizeViewSpec({ position: [0, 0, 0.001], target: [0, 0, 0] });
  assert(near(radiusOf(close), MIN_RADIUS), '过近机位钳制到 MIN_RADIUS，避免穿模');
  const brokenUp = normalizeViewSpec({ position: [6, 5, 8], up: [1, 0, 0] });
  assert(vecNear(brokenUp.up, [0, 1, 0]) && cameraUpY(brokenUp) > 0,
    '外部传入的翻转 up 被强制修正为 +Y');
  const custom = normalizeViewSpec({ fov: 999, near: -1, far: 0.01, position: [2, 3, 4] });
  assert(custom.fov === 120 && custom.near >= 0.001 && custom.far > custom.near,
    'fov/near/far 越界被钳制且 near < far');
  assert(isViewSpecValid({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] }) === true,
    'isViewSpecValid 接受合法规格');
  assert(isViewSpecValid({ position: [1, 2, 3], target: [0, 0, 0], up: [1, 0, 0] }) === false,
    'isViewSpecValid 拒绝翻转的 up');
}

/* ---------------- F. 真实相机复位（C2） ---------------- */
section('F. 真实 PerspectiveCamera：视角变换后复位三要素');
{
  const cam = new THREE.PerspectiveCamera(
    DEFAULT_VIEW.fov, 1, DEFAULT_VIEW.near, DEFAULT_VIEW.far,
  );
  const apply = (spec) => {
    cam.position.set(...spec.position);
    cam.up.set(...spec.up);
    cam.lookAt(...spec.target);
    cam.updateMatrixWorld();
  };
  apply(resetViewSpec());
  assert(vecNear(cam.position.toArray(), DEFAULT_VIEW.position) && vecNear(cam.up.toArray(), [0, 1, 0]),
    '初始相机位置与 up 与 DEFAULT_VIEW 一致');
  // 模拟一段用户操作：切侧视 → 拉近 → 旋转
  apply(orbitViewSpec(zoomViewSpec(viewPresetSpec('right'), 0.6), { dTheta: 0.8, dPhi: 0.4 }));
  assert(!vecNear(cam.position.toArray(), DEFAULT_VIEW.position), '操作后相机确实离开了默认机位');
  // 复位：位置 + target + up 同时还原（C2 易错点：只复位相机位置会留下偏移 target）
  const r = resetViewSpec();
  apply(r);
  assert(vecNear(cam.position.toArray(), DEFAULT_VIEW.position), '复位还原相机位置');
  assert(vecNear(r.target, [0, 0, 0]), '复位还原 target（不只是相机位置）');
  assert(vecNear(r.up, [0, 1, 0]) && cameraUpY(r) > 0, '复位还原 up 且相机不翻转');
  assert(near(cam.position.distanceTo(new THREE.Vector3(...r.target)), Math.sqrt(125)),
    '复位后相机到 target 距离回到 √125');
  assert(cam.fov === DEFAULT_VIEW.fov && cam.near === DEFAULT_VIEW.near && cam.far === DEFAULT_VIEW.far,
    '投影参数与规格一致');
}

/* ---------------- G. 内核接线 / ESM 依赖闭合 ---------------- */
section('G. 内核接线与 ESM 依赖闭合');
{
  const kernel = read('js/board3d.js');
  const viewMod = read('js/board3d-view.js');
  const page = read('board3d.html');
  assert(/from\s*['"]\.\/board3d-view\.js['"]/.test(kernel), 'js/board3d.js 已 import 视角纯函数层');
  assert(/function applyCameraSpec\(/.test(kernel) && /normalizeViewSpec\(spec\)/.test(kernel),
    '内核有 applyCameraSpec 且规格统一经 normalizeViewSpec 清洗');
  assert(/function resetView\(\)\s*\{\s*return applyCameraSpec\(resetViewSpec\(\)\)/.test(kernel),
    'resetView 委托纯函数层，同时复位 position/target/up（C2）');
  assert(/board3dApi[\s\S]*orbitCamera\(/.test(kernel) && /zoomCamera\(/.test(kernel),
    'board3dApi 暴露 orbitCamera / zoomCamera（C1）');
  assert(/setCameraPreset\(/.test(kernel) && /getCameraSpec\(/.test(kernel),
    'board3dApi 暴露 setCameraPreset / getCameraSpec');
  assert(!/camera\.position\.set\(6,\s*5,\s*8\)/.test(kernel),
    'init 不再硬编码 (6,5,8)，改由 resetViewSpec 单一来源');
  assert(!/from\s*['"]three['"]/.test(viewMod) && !/\bdocument\./.test(viewMod),
    'js/board3d-view.js 不 import three、不碰 DOM（纯函数）');
  assert(/getElementById\('viewPresets'\)/.test(kernel) && /\[data-preset\]/.test(kernel),
    'bindUI 已绑定视角预设按钮');
  assert(/btn-reset-view[^\n]*\n[\s\S]{0,220}markActivePreset\('iso'\)/.test(kernel),
    '复位按钮同时把高亮同步回等轴');
  assert(page.includes('id="viewPresets"') && page.includes('data-preset="iso"'),
    'board3d.html 已挂视角预设条（等轴/正视/俯视/侧视）');
  for (const name of ['iso', 'front', 'top', 'right']) {
    assert(page.includes(`data-preset="${name}"`), `预设按钮 ${name} 就位`);
  }
  // 新增模块的所有相对 import 都指向真实文件（避免线上 404）
  const re = /from\s*['"](\.[^'"]+)['"]/g;
  let m, allOk = true;
  while ((m = re.exec(kernel))) {
    if (!existsSync(join(ROOT, 'js', m[1]))) allOk = false;
  }
  assert(allOk, 'js/board3d.js 的相对 import 全部可解析到真实文件');
  assert(existsSync(join(ROOT, 'js/board3d-view.js')), 'js/board3d-view.js 存在');
}

/* ---------------- H. 硬约束 / 协作铁律静态复核 ---------------- */
section('H. 硬约束（新旧路径并存）与协作铁律');
{
  const editorJs = read('js/editor.js');
  assert(editorJs.includes('@dajiaoai/algeo-sdk'), 'js/editor.js 仍 import 大角几何 SDK');
  assert(editorJs.includes('CFG.appId') && read('js/config.js').includes("appId: 'ZYGKAQXC'"),
    'appId 旧逻辑与配置仍保留');
  assert(existsSync(join(ROOT, 'editor.html')), 'editor.html 旧路径仍在');
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
  // 共享文件：本轮未触碰 2D 主干，3D 追加段仍在
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    'ai/board-prompt.js：3D 段落仍追加在 2D 主干之后（未整体替换）');
  assert(prompt.includes('例8：细粒度样式'), '2D 主干 few-shot 未被删除');
  assert(read('ai/board-backend.js').includes('resolveBoardMode'), '后端 3D 分支仍在');
  const exec3d = read('js/board3d-executor.js');
  assert(exec3d.includes("'reset3d'") && exec3d.includes('resetView'), '3D 执行器 reset3d 命令仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

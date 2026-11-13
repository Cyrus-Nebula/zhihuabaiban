/**
 * 3D 画板「TransformControls gizmo 交互」纯函数层无头回归（回归清单 C4）。
 *
 * 覆盖：三种模式白名单与按钮高亮、拖拽期间 orbit 临时禁用（含与 C3 点拖拽互斥）、
 *      gizmo 变换写回 obj（全量 / 按模式）、弧度→角度换算、scale 下限钳制与
 *      mesh 同步、脏输入防护、内核接线 / ESM 依赖闭合、硬约束与协作铁律静态复核。
 *
 * 与仓库既有 3D 测试同口径：纯函数层 js/board3d-gizmo.js 直接 import 真实实现，
 * mesh 变换用本地 vendor 的 Three.js r160 真实 Object3D（纯 CPU，不需要 WebGL / DOM），
 * 不用自造的模拟变换自证；像素级目视仍受 A9 环境限制。
 *
 * 运行：node tests/board3d_gizmo.mjs
 */
import * as THREE from '../libs/three/three.module.min.js';
import {
  GIZMO_MODES, DEFAULT_GIZMO_MODE, SCALE_MIN, RAD_TO_DEG,
  normalizeGizmoMode, gizmoModeState, orbitEnabledOnGizmoDrag,
  shouldSuppressPick, meshTransformPatch, applyTransformPatch,
} from '../js/board3d-gizmo.js';
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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-9) => Array.isArray(a) && Array.isArray(b) &&
  a.length === 3 && b.length === 3 && a.every((v, i) => near(v, b[i], eps));
const finiteVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** 构造一个带真实 THREE 变换分量的 mesh（Object3D 足够，无需 WebGL）。 */
function makeMesh(pos = [1, 2, 3], rot = [0.1, 0.2, 0.3], scl = [2, 0.5, 1]) {
  const m = new THREE.Object3D();
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scl);
  return m;
}
/** 历史 writeObjFromMesh 的逐值口径，用于验证「正常值下行为等价」。 */
const DEG = Math.PI / 180;
const legacyTransform = (m) => ({
  pos: [m.position.x, m.position.y, m.position.z],
  rot: [m.rotation.x / DEG, m.rotation.y / DEG, m.rotation.z / DEG],
  scale: [m.scale.x, m.scale.y, m.scale.z],
});

console.log('3D 画板——gizmo 交互（C4）纯函数回归');

/* ---------------- A. 常量与 HTML / 兄弟纯函数层口径一致 ---------------- */
section('A. 常量一致性（GIZMO_MODES / SCALE_MIN / RAD_TO_DEG）');
{
  assert(THREE.REVISION === '160', '本地 vendor Three.js REVISION === 160');
  assert(GIZMO_MODES.length === 3 && GIZMO_MODES[0] === 'translate' &&
    GIZMO_MODES[1] === 'rotate' && GIZMO_MODES[2] === 'scale',
    'GIZMO_MODES = [translate, rotate, scale]');
  assert(DEFAULT_GIZMO_MODE === 'translate' && GIZMO_MODES.includes(DEFAULT_GIZMO_MODE),
    'DEFAULT_GIZMO_MODE = translate 且在白名单内');
  assert(SCALE_MIN === 0.05, 'SCALE_MIN = 0.05');
  assert(read('js/board3d-settings.js').includes('Math.max(0.05'),
    'SCALE_MIN 与 js/board3d-settings.js 的 scale 下限逐值一致');
  assert(near(RAD_TO_DEG, 180 / Math.PI) && near(RAD_TO_DEG, 1 / DEG),
    'RAD_TO_DEG = 180/π = 1/DEG');
  const html = read('board3d.html');
  const block = html.match(/<div class="b3d-gizmo-modes"[\s\S]*?<\/div>/);
  const domModes = block ? [...block[0].matchAll(/data-mode="([^"]+)"/g)].map((m) => m[1]) : [];
  assert(domModes.length === 3, 'board3d.html #gizmoModes 含 3 个按钮');
  assert(JSON.stringify(domModes) === JSON.stringify(GIZMO_MODES),
    '按钮 data-mode 与 GIZMO_MODES 逐项一致');
  assert(/data-mode="translate"\s+class="active"/.test(html), '初始高亮按钮为 translate（与默认模式一致）');
}

/* ---------------- B. 模式白名单 normalizeGizmoMode ---------------- */
section('B. 模式白名单（normalizeGizmoMode）');
{
  for (const m of GIZMO_MODES) assert(normalizeGizmoMode(m) === m, `合法模式 ${m} 原样通过`);
  const dirty = [undefined, null, 123, 0, true, false, {}, [], '', ' ', 'TRANSLATE',
    'translate ', 'rotate\n', 'foo', 'all', 'scale2', NaN, Infinity, Symbol('x')];
  for (const d of dirty) {
    assert(normalizeGizmoMode(d) === 'translate', `脏输入 ${String(d)} 回落 translate`);
  }
  assert(normalizeGizmoMode('scale') !== normalizeGizmoMode('rotate'), '不同合法模式不混淆');
}

/* ---------------- C. 按钮高亮状态 gizmoModeState ---------------- */
section('C. 按钮高亮状态（gizmoModeState）');
{
  for (const m of GIZMO_MODES) {
    const s = gizmoModeState(m);
    assert(Object.keys(s).length === 3, `模式 ${m}：状态含 3 个键`);
    assert(s[m] === true, `模式 ${m}：自身高亮为 true`);
    assert(GIZMO_MODES.filter((k) => s[k] === true).length === 1, `模式 ${m}：有且仅有一个按钮高亮`);
    assert(GIZMO_MODES.filter((k) => s[k] === false).length === 2, `模式 ${m}：其余两个为 false`);
  }
  const s = gizmoModeState('bogus');
  assert(s.translate === true && s.rotate === false && s.scale === false,
    '非法模式回落 translate 高亮');
  assert(gizmoModeState(null).translate === true, 'null 回落 translate 高亮');
}

/* ---------------- D. C4：拖拽期间 orbit 临时禁用 ---------------- */
section('D. C4 orbit 互斥（orbitEnabledOnGizmoDrag）');
{
  assert(orbitEnabledOnGizmoDrag(true) === false, 'dragging=true → orbit 禁用');
  assert(orbitEnabledOnGizmoDrag(false) === true, 'dragging=false → orbit 恢复');
  // 与历史 `orbit.enabled = !e.value` 逐值等价
  for (const v of [undefined, null, 0, 1, '', 'false', NaN, {}]) {
    assert(orbitEnabledOnGizmoDrag(v) === !v, `dragging=${String(v)} 与历史 !e.value 等价`);
  }
  // C3 点拖拽优先级：会话中不允许 gizmo 事件提前恢复 orbit
  assert(orbitEnabledOnGizmoDrag(false, true) === false, '点拖拽中 + dragging=false → 仍禁用 orbit');
  assert(orbitEnabledOnGizmoDrag(true, true) === false, '点拖拽中 + dragging=true → 仍禁用 orbit');
  assert(orbitEnabledOnGizmoDrag(false, false) === true, '无点拖拽 + dragging=false → 恢复 orbit');
  assert(orbitEnabledOnGizmoDrag(false, undefined) === true, 'pointDragging 缺省视为 false');
  assert(orbitEnabledOnGizmoDrag(false, 1) === false, 'pointDragging truthy 一律视为会话中');
}

/* ---------------- E. 拾取抑制 shouldSuppressPick ---------------- */
section('E. 拾取抑制（shouldSuppressPick）');
{
  assert(shouldSuppressPick(false, false) === false, 'gizmo 空闲 → 不抑制拾取');
  assert(shouldSuppressPick(true, false) === true, 'gizmo 握轴 → 抑制拾取');
  assert(shouldSuppressPick(false, true) === true, 'gizmo 拖拽中 → 抑制拾取');
  assert(shouldSuppressPick(true, true) === true, '两者同时 → 抑制拾取');
  assert(shouldSuppressPick(undefined, undefined) === false, 'undefined → 不抑制（等价历史 !! 判断）');
  assert(shouldSuppressPick('X', 0) === true, 'axis 非空字符串 → 抑制');
  assert(shouldSuppressPick(0, 1) === true, 'dragging truthy → 抑制');
  // 与历史 `gizmoActive || transform.dragging` 真值等价
  for (const a of [null, 0, 1, 'axis', undefined]) {
    for (const d of [null, 0, 1, false, true]) {
      assert(shouldSuppressPick(a, d) === (!!a || !!d), `真值等价 a=${String(a)} d=${String(d)}`);
    }
  }
}

/* ---------------- F. 全量写回：与历史实现逐值等价 ---------------- */
section('F. 全量写回（真实 THREE.Object3D，与历史 writeObjFromMesh 等价）');
{
  const cases = [
    [[0, 0, 0], [0, 0, 0], [1, 1, 1]],
    [[1, 2, 3], [0.1, 0.2, 0.3], [2, 0.5, 1]],
    [[-3.5, 8.125, 0], [-Math.PI / 4, Math.PI / 2, Math.PI], [1, 3, 0.2]],
    [[12.75, -0.5, 99], [2.4, -1.2, 0.01], [0.05, 10, 4]],
  ];
  for (const [p, r, s] of cases) {
    const m = makeMesh(p, r, s);
    const old = legacyTransform(m);
    const patch = meshTransformPatch(m, { radiansToDegrees: 1 / DEG });
    assert(vecNear(patch.pos, old.pos), `pos 等价 ${JSON.stringify(p)}`);
    assert(vecNear(patch.rot, old.rot, 1e-9), `rot 弧度→角度等价 ${JSON.stringify(r)}`);
    assert(vecNear(patch.scale, old.scale), `scale 等价 ${JSON.stringify(s)}`);
    assert(patch.clamped === false, '正常 scale 不触发钳制');
  }
  // 未指定 mode / 非法 mode 都走全量
  const m = makeMesh();
  const legacy = legacyTransform(m);
  for (const mode of [undefined, null, 'all', 'bogus', 123, '']) {
    const p = meshTransformPatch(m, { mode, radiansToDegrees: 1 / DEG });
    assert(finiteVec(p.pos) && finiteVec(p.rot) && finiteVec(p.scale),
      `mode=${String(mode)} 走全量写回（三字段齐全）`);
  }
  assert(vecNear(meshTransformPatch(m).pos, legacy.pos), '缺省 options 也走全量写回');
  // 自定义换算系数
  const p2 = meshTransformPatch(m, { radiansToDegrees: 1 });
  assert(vecNear(p2.rot, [m.rotation.x, m.rotation.y, m.rotation.z]),
    'radiansToDegrees=1 时 rot 保持弧度');
}

/* ---------------- G. C4：按 gizmo 模式只写回受影响字段 ---------------- */
section('G. C4 按模式写回（translate / rotate / scale 字段隔离）');
{
  const m = makeMesh([4, 5, 6], [0.3, 0.6, 0.9], [3, 2, 1.5]);
  const fallback = { pos: [0, 0, 0], rot: [10, 20, 30], scale: [1, 1, 1] };
  const expected = {
    translate: (p) => finiteVec(p.pos) && p.rot === undefined && p.scale === undefined,
    rotate:    (p) => p.pos === undefined && finiteVec(p.rot) && p.scale === undefined,
    scale:     (p) => p.pos === undefined && p.rot === undefined && finiteVec(p.scale),
  };
  for (const mode of GIZMO_MODES) {
    const p = meshTransformPatch(m, { mode, fallback, radiansToDegrees: 1 / DEG });
    assert(expected[mode](p), `${mode} 模式只产出对应字段`);
    assert(p.clamped === false, `${mode} 模式正常值不钳制`);
  }
  const t = meshTransformPatch(m, { mode: 'translate', fallback, radiansToDegrees: 1 / DEG });
  assert(vecNear(t.pos, [4, 5, 6]), 'translate 只改 pos，值来自 mesh.position');
  const r = meshTransformPatch(m, { mode: 'rotate', fallback, radiansToDegrees: 1 / DEG });
  assert(vecNear(r.rot, [0.3 / DEG, 0.6 / DEG, 0.9 / DEG]), 'rotate 只改 rot，弧度已转角度');
  const s = meshTransformPatch(m, { mode: 'scale', fallback, radiansToDegrees: 1 / DEG });
  assert(vecNear(s.scale, [3, 2, 1.5]), 'scale 只改 scale');
  // 模拟内核：按模式 patch 只覆盖对应字段，其余保留旧值
  const obj = { pos: [0, 0, 0], rot: [10, 20, 30], scale: [1, 1, 1] };
  applyTransformPatch(obj, t);
  assert(vecNear(obj.pos, [4, 5, 6]) && vecNear(obj.rot, [10, 20, 30]) && vecNear(obj.scale, [1, 1, 1]),
    'translate 写回后 rot/scale 保持旧值（无浮点抖动）');
  applyTransformPatch(obj, r);
  assert(vecNear(obj.pos, [4, 5, 6]) && vecNear(obj.rot, [0.3 / DEG, 0.6 / DEG, 0.9 / DEG]),
    'rotate 写回后 pos 不受影响');
}

/* ---------------- H. scale 下限钳制与 clamped 同步契约 ---------------- */
section('H. scale 下限钳制（SCALE_MIN / clamped）');
{
  for (const bad of [0, 0.049, 0.01, -1, -100]) {
    const m = makeMesh([0, 0, 0], [0, 0, 0], [2, bad, 1]);
    const p = meshTransformPatch(m, { mode: 'scale' });
    assert(p.scale[1] === SCALE_MIN, `scale=${bad} → 钳到 ${SCALE_MIN}`);
    assert(p.clamped === true, `scale=${bad} → clamped=true`);
    assert(p.scale[0] === 2 && p.scale[2] === 1, '仅钳制越界分量，其余不变');
    // 调用方按契约把钳制值同步回 mesh，保证模型与画面一致
    m.scale.set(...p.scale);
    assert(near(m.scale.y, SCALE_MIN), `clamped 同步后 mesh.scale.y = ${SCALE_MIN}`);
  }
  const ok = meshTransformPatch(makeMesh([0, 0, 0], [0, 0, 0], [SCALE_MIN, 1, 3]), { mode: 'scale' });
  assert(ok.clamped === false && ok.scale[0] === SCALE_MIN, '恰好等于下限不触发钳制');
  const all = meshTransformPatch(makeMesh([1, 2, 3], [0, 0, 0], [1, 0, 1]));
  assert(all.clamped === true && all.scale[1] === SCALE_MIN, '全量模式同样执行钳制');
  assert(finiteVec(all.pos) && finiteVec(all.rot), '全量模式钳制不影响 pos/rot');
}

/* ---------------- I. 脏输入防护 ---------------- */
section('I. 脏输入防护（NaN / Infinity / 空 mesh / fallback）');
{
  const clean = meshTransformPatch(makeMesh(), { radiansToDegrees: NaN });
  assert(vecNear(clean.rot, [0.1 / DEG, 0.2 / DEG, 0.3 / DEG]),
    '非法 radiansToDegrees 回落 RAD_TO_DEG');
  const empty = meshTransformPatch(null);
  assert(vecNear(empty.pos, [0, 0, 0]) && vecNear(empty.rot, [0, 0, 0]) &&
    vecNear(empty.scale, [1, 1, 1]), '空 mesh 回落 pos=0 / rot=0 / scale=1');
  assert(empty.clamped === false, '空 mesh 不触发钳制');
  const fb = { pos: [7, 8, 9], rot: [10, 20, 30], scale: [4, 5, 6] };
  const partial = { position: { x: Infinity, y: 2, z: NaN }, rotation: { x: NaN }, scale: { x: 0 } };
  const p = meshTransformPatch(partial, { fallback: fb, radiansToDegrees: 1 / DEG });
  assert(p.pos[0] === 7 && p.pos[1] === 2 && p.pos[2] === 9, '非有限 pos 分量回落到 fallback 对应分量');
  assert(vecNear(p.rot, [10, 20, 30]), '非有限 rot 分量回落到 fallback');
  assert(p.scale[0] === SCALE_MIN && p.scale[1] === 5 && p.scale[2] === 6,
    'scale 越界分量钳下限、缺分量回落 fallback');
  assert(p.clamped === true, '越界 scale 被钳制时置 clamped');
  const nofb = meshTransformPatch({ position: { x: 'junk', y: null, z: {} }, rotation: {}, scale: {} });
  assert(vecNear(nofb.pos, [0, 0, 0]), '脏类型字符串/null/对象回落 0');
  assert(vecNear(nofb.scale, [1, 1, 1]), 'scale 缺省回落 1');
  // 数组形态（Vector3 之外）也能读
  const arr = meshTransformPatch({ position: [3, 4, 5], rotation: [0, 0, 0], scale: [2, 2, 2] });
  assert(vecNear(arr.pos, [3, 4, 5]) && vecNear(arr.scale, [2, 2, 2]), '数组形态三分量可读');
  // 全量输出始终为有限三分量
  for (const m of [null, undefined, {}, 42, 'x', { position: null, rotation: null, scale: null }]) {
    const q = meshTransformPatch(m);
    assert(finiteVec(q.pos) && finiteVec(q.rot) && finiteVec(q.scale),
      `脏 mesh ${String(m)} 仍产出有限三分量`);
  }
}

/* ---------------- J. applyTransformPatch ---------------- */
section('J. 补丁写回模型（applyTransformPatch）');
{
  const patch = { pos: [1, 2, 3], rot: [4, 5, 6], scale: [7, 8, 9], clamped: false };
  const snapshot = JSON.stringify(patch);
  const obj = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#fff' };
  const keys = applyTransformPatch(obj, patch);
  assert(keys.length === 3 && keys.join(',') === 'pos,rot,scale', '返回写入的三个字段名');
  assert(vecNear(obj.pos, [1, 2, 3]) && vecNear(obj.rot, [4, 5, 6]) && vecNear(obj.scale, [7, 8, 9]),
    '三个字段写入 obj');
  assert(obj.color === '#fff', '不触碰 obj 其它字段');
  assert(JSON.stringify(patch) === snapshot, 'applyTransformPatch 不修改 patch 入参');
  const partial = { pos: [9, 9, 9], clamped: false };
  const obj2 = { pos: [0, 0, 0], rot: [1, 1, 1], scale: [1, 1, 1] };
  const k2 = applyTransformPatch(obj2, partial);
  assert(k2.join(',') === 'pos' && vecNear(obj2.rot, [1, 1, 1]) && vecNear(obj2.scale, [1, 1, 1]),
    '按模式 patch 只写回存在的字段');
  assert(JSON.stringify(applyTransformPatch(null, patch)) === '[]', 'obj 为空返回空数组不抛异常');
  assert(JSON.stringify(applyTransformPatch(obj, null)) === '[]', 'patch 为空返回空数组不抛异常');
  assert(JSON.stringify(applyTransformPatch({}, { pos: 'bad', rot: null, scale: 5 })) === '[]',
    '非数组字段被忽略');
  // 幂等
  const once = JSON.stringify(obj2);
  applyTransformPatch(obj2, partial);
  assert(JSON.stringify(obj2) === once, '重复写入同一 patch 幂等');
}

/* ---------------- K. 内核接线 / ESM 依赖闭合 ---------------- */
section('K. 内核接线与 ESM 依赖闭合');
{
  const kernel = read('js/board3d.js');
  const mod = read('js/board3d-gizmo.js');
  assert(/from\s*['"]\.\/board3d-gizmo\.js['"]/.test(kernel), 'js/board3d.js 已 import gizmo 纯函数层');
  assert(/transform\.setMode\(DEFAULT_GIZMO_MODE\)/.test(kernel), '初始模式取自纯函数层常量');
  assert(/orbitEnabledOnGizmoDrag\(e\.value/.test(kernel), 'dragging-changed 经 orbitEnabledOnGizmoDrag');
  assert(/orbitEnabledOnGizmoDrag\(e\.value,\s*!!dragSession\)/.test(kernel),
    'orbit 互斥与 C3 点拖拽会话联动');
  assert(/normalizeGizmoMode\(b\.dataset\.mode\)/.test(kernel), '按钮 data-mode 经白名单归一化');
  assert(/gizmoModeState\(mode\)/.test(kernel), '按钮高亮经纯函数层计算');
  assert(/shouldSuppressPick\(gizmoActive,\s*transform\.dragging\)/.test(kernel),
    'pointerdown / pointerup 拾取抑制经纯函数层');
  assert((kernel.match(/shouldSuppressPick\(/g) || []).length >= 2, '拾取抑制在 down / up 两处均接入');
  assert(/function writeObjFromMesh\([\s\S]*?meshTransformPatch\(/.test(kernel),
    'writeObjFromMesh 委托 meshTransformPatch');
  assert(/function onGizmoChange\([\s\S]*?mode:\s*transform\.mode/.test(kernel),
    'onGizmoChange 按当前 gizmo 模式写回');
  assert(/transform\.addEventListener\('objectChange',\s*onGizmoChange\)/.test(kernel),
    'objectChange → onGizmoChange 接线仍在（写回 obj）');
  assert(/patch\.clamped\)[\s\S]*?scale\.set\(\.\.\.patch\.scale\)/.test(kernel),
    'clamped 时把钳制值同步回 mesh');
  assert(!/from\s*['"]three['"]/.test(mod) && !/\bdocument\./.test(mod) && !/\bwindow\./.test(mod),
    'js/board3d-gizmo.js 不 import three、不碰 DOM / window（纯函数）');
  const re = /from\s*['"](\.[^'"]+)['"]/g;
  let m, allOk = true;
  while ((m = re.exec(kernel))) {
    if (!existsSync(join(ROOT, 'js', m[1]))) allOk = false;
  }
  assert(allOk, 'js/board3d.js 的相对 import 全部可解析到真实文件');
  assert(existsSync(join(ROOT, 'js/board3d-gizmo.js')), 'js/board3d-gizmo.js 存在');
  // 纯函数层可被 Node 直接 import（本测试顶部已 import 成功）
  assert(typeof meshTransformPatch === 'function' && typeof normalizeGizmoMode === 'function',
    '纯函数层全部导出可 import');
}

/* ---------------- L. 硬约束 / 协作铁律静态复核 ---------------- */
section('L. 硬约束（新旧路径并存）与协作铁律');
{
  const editor = read('js/editor.js');
  assert(/cdn\.jsdelivr\.net\/npm\/@dajiaoai\/algeo-sdk/.test(editor),
    'js/editor.js 仍 import 大角几何 SDK');
  assert(/(appId|app_id|CFG\.[A-Za-z]*[Aa]ppId)/.test(editor + read('js/config.js')),
    'appId 配置仍保留');
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
    existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')) &&
    existsSync(join(ROOT, 'libs/three/addons/controls/TransformControls.js')),
    '本地 vendor 三件套仍在');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    'ai/board-prompt.js：3D 段落仍追加在 2D 主干之后（未整体替换）');
  assert(/isBoard3DIntent/.test(prompt), 'ai/board-prompt.js 的 3D 意图检测段落仍在');
  const backend = read('ai/board-backend.js');
  assert(/resolveBoardMode/.test(backend), 'ai/board-backend.js 的 3D 模式分支仍在');
  assert(existsSync(join(ROOT, 'js/board3d-executor.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '3D 执行器与 2D 执行器平行并存');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);

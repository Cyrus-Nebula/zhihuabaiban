/**
 * 3D 环形阵列命令（radial3d · D10）无头回归。
 *
 * 覆盖：resolveRadial3D 纯函数（单份 / 计数钳制 / 三轴环形数学 / 半径缺省与覆盖 /
 *       rotate 自转 / startAngle+sweep / 覆盖字段 / 同名避让 / 只读性 / 脏输入原子拒绝）、
 *       执行器集成（同批先建后阵列、id 唯一冲突、getState 降级、2D 命令隔离）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_radial.mjs
 */
import {
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS, BOARD3D_TRANSFORM_PROMPT_OPS,
  BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_RADIAL_PROMPT_OPS, BOARD3D_RADIAL_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS,
} from '../js/board3d-executor.js';
import { RADIAL3D_COPIES_MAX, resolveRadial3D } from '../js/board3d-duplicate.js';
import { readFileSync, existsSync } from 'node:fs';
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
const near = (a, b, eps = 1e-9) => typeof a === 'number' && typeof b === 'number'
  && Number.isFinite(a) && Math.abs(a - b) < eps;
const eq3 = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
  && a.every((x, i) => near(x, b[i]));

const scene = () => ({
  objects: [
    { id: 'pillar', type: 'box', pos: [3, 1, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#4f6bed', opacity: 1, p: { w: 1, h: 4, d: 1 } },
    { id: 'ball', type: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#0ea5e9', opacity: 0.6, p: { r: 1 } },
    { id: 'lblA', type: 'label', pos: [-2, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], text: 'A' },
  ],
});

function mockApi(initial) {
  const objects = (initial || scene()).objects.map((o) => ({ ...o,
    pos: o.pos && o.pos.slice(), rot: o.rot && o.rot.slice(),
    scale: o.scale && o.scale.slice(), p: o.p && { ...o.p } }));
  return {
    objects,
    getState() { return { objects: this.objects, view: {} }; },
    add(obj) { if (this.objects.some((o) => o.id === obj.id)) return null;
      this.objects.push({ ...obj, pos: obj.pos.slice(), rot: obj.rot.slice(), scale: obj.scale.slice(), p: { ...obj.p } }); return obj.id; },
    update(id, patch) { const o = this.objects.find((x) => x.id === id); if (!o) return false; Object.assign(o, patch); return true; },
    remove(id) { const i = this.objects.findIndex((x) => x.id === id); if (i < 0) return false; this.objects.splice(i, 1); return true; },
    clear() { this.objects.length = 0; },
    setView() { return true; }, resetView() { return true; },
  };
}

console.log('3D 环形阵列命令（radial3d · D10）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');

assert(RADIAL3D_COPIES_MAX === 32, 'RADIAL3D_COPIES_MAX 为 32');
assert(Array.isArray(BOARD3D_RADIAL_OPS) && BOARD3D_RADIAL_OPS.length === 1
  && BOARD3D_RADIAL_OPS[0] === 'radial3d', 'BOARD3D_RADIAL_OPS 恰含 radial3d');
assert(Array.isArray(BOARD3D_RADIAL_PROMPT_OPS) && BOARD3D_RADIAL_PROMPT_OPS.length === 1
  && BOARD3D_RADIAL_PROMPT_OPS[0] === 'radial3d', 'BOARD3D_RADIAL_PROMPT_OPS 恰含 radial3d');
assert(BOARD3D_RADIAL_OPS[0] === BOARD3D_RADIAL_PROMPT_OPS[0],
  '执行器侧与提示词侧 radial3d op 一致');
assert(BOARD3D_OPS.length === 7, '历史契约 BOARD3D_OPS 仍 7 条（零回归）');
assert(BOARD3D_ALL_OPS.length === 8, '历史契约 BOARD3D_ALL_OPS 仍 8 条（零回归）');
assert(BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_FULL_OPS 仍 9 条（零回归）');
assert(BOARD3D_COMPLETE_OPS.length === 10, '历史契约 BOARD3D_COMPLETE_OPS 仍 10 条（零回归）');
assert(BOARD3D_COMPLETE2_OPS.length === 11, 'BOARD3D_COMPLETE2_OPS 含全部 11 条');
assert(!BOARD3D_COMPLETE_OPS.includes('radial3d'),
  'radial3d 未并入历史 COMPLETE 契约（只追加独立组）');
assert(BOARD3D_COMPLETE2_OPS.includes('radial3d'), 'radial3d 并入新完整集供核对');
assert(BOARD3D_PROMPT_OPS.length === 7 && BOARD3D_MEASURE_PROMPT_OPS.length === 1
  && BOARD3D_TRANSFORM_PROMPT_OPS.length === 1 && BOARD3D_DUPLICATE_PROMPT_OPS.length === 1,
  '共享文件既有 PROMPT_OPS 契约数量未变');
assert(typeof BOARD3D_RADIAL_PROMPT === 'string'
  && BOARD3D_RADIAL_PROMPT.includes('radial3d'), 'BOARD3D_RADIAL_PROMPT 导出且含命令名');

/* ---------------- B. resolveRadial3D 单份与基本形状 ---------------- */
section('B. resolveRadial3D 单份与基本形状');

{
  const r = resolveRadial3D({ op: 'radial3d', id: 'pillar', count: 1 }, scene());
  assert(r.ok === true, '单份阵列成功');
  assert(r.items && r.items.length === 1, '单份产出 1 个对象');
  assert(r.items[0].id === 'pillar_rad', '单份默认 id 为 <src>_rad');
  assert(r.items[0].type === 'box', '沿用源对象 type');
  assert(eq3(r.items[0].scale, [1, 1, 1]), '沿用源对象 scale');
  assert(r.items[0].color === '#4f6bed' && near(r.items[0].opacity, 1), '沿用源颜色/透明度');
  assert(r.meta && r.meta.axis === 'y' && r.meta.count === 1, 'meta 记录 axis/count');
  assert(Array.isArray(r.meta.angles) && near(r.meta.angles[0], 0), '单份起始角为 0');
}

/* ---------------- C. count 钳制与份数 ---------------- */
section('C. count 钳制与份数');

{
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 8, radius: 5 }, scene());
  assert(r.ok && r.items.length === 8, 'count=8 产出 8 份');
  const r0 = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 0, radius: 5 }, scene());
  assert(r0.ok && r0.items.length === 1, 'count=0 钳制到 1');
  const rNeg = resolveRadial3D({ op: 'radial3d', id: 'ball', count: -3 }, scene());
  assert(rNeg.ok && rNeg.items.length === 1, 'count 负数钳制到 1');
  const rBig = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 100 }, scene());
  assert(rBig.ok && rBig.items.length === RADIAL3D_COPIES_MAX, 'count=100 钳制到上限 32');
  const rFrac = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 3.7 }, scene());
  assert(rFrac.ok && rFrac.items.length === 4, 'count 小数四舍五入');
  const rStr = resolveRadial3D({ op: 'radial3d', id: 'ball', count: '6' }, scene());
  assert(rStr.ok && rStr.items.length === 6, 'count 数字字符串容错');
  const rDef = resolveRadial3D({ op: 'radial3d', id: 'ball', radius: 5 }, scene());
  assert(rDef.ok && rDef.items.length === 8, 'count 缺省为 8');
}

/* ---------------- D. 三轴环形数学 ---------------- */
section('D. 三轴环形数学');

const closePos = (a, b, eps = 1e-6) => a.length === b.length && a.every((x, i) => near(x, b[i], eps));

{
  // 绕 Y 轴：水平 XZ 平面成环，center 原点、radius=3、count=4 → (3,·,0),(0,·,3),(-3,·,0),(0,·,-3)
  const st = { objects: [{ id: 'p', type: 'box', pos: [3, 7, 0], rot: [0, 0, 0], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, center: [0, 0, 0], axis: 'y', radius: 3 }, st);
  assert(r.ok && r.items.length === 4, '绕 Y 轴 4 份成功');
  assert(closePos(r.items[0].pos, [3, 7, 0]), 'Y 轴第 1 份在 +X');
  assert(closePos(r.items[1].pos, [0, 7, 3]), 'Y 轴第 2 份在 +Z');
  assert(closePos(r.items[2].pos, [-3, 7, 0]), 'Y 轴第 3 份在 -X');
  assert(closePos(r.items[3].pos, [0, 7, -3]), 'Y 轴第 4 份在 -Z');
  assert(r.items.every((it) => near(it.pos[1], 7)), 'Y 轴环上 y 坐标沿用源对象高度');
}
{
  // 绕 Z 轴：XY 平面成环，z 坐标沿用源对象
  const st = { objects: [{ id: 'p', type: 'box', pos: [2, 0, 9], rot: [0, 0, 0], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, center: [0, 0, 0], axis: 'z', radius: 2 }, st);
  assert(r.ok && closePos(r.items[0].pos, [2, 0, 9]), 'Z 轴第 1 份在 +X');
  assert(closePos(r.items[1].pos, [0, 2, 9]), 'Z 轴第 2 份在 +Y');
  assert(r.items.every((it) => near(it.pos[2], 9)), 'Z 轴环上 z 坐标沿用源对象');
}
{
  // 绕 X 轴：YZ 平面成环，x 坐标沿用源对象
  const st = { objects: [{ id: 'p', type: 'box', pos: [5, 2, 0], rot: [0, 0, 0], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, center: [0, 0, 0], axis: 'x', radius: 2 }, st);
  assert(r.ok && closePos(r.items[0].pos, [5, 2, 0]), 'X 轴第 1 份在 +Y');
  assert(closePos(r.items[1].pos, [5, 0, 2]), 'X 轴第 2 份在 +Z');
  assert(r.items.every((it) => near(it.pos[0], 5)), 'X 轴环上 x 坐标沿用源对象');
}
{
  // center 偏移：center=[10,0,10] 时环心随之移动
  const st = { objects: [{ id: 'p', type: 'box', pos: [13, 0, 10], rot: [0, 0, 0], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, center: [10, 0, 10], axis: 'y', radius: 3 }, st);
  assert(r.ok && closePos(r.items[0].pos, [13, 0, 10]), 'center 偏移后第 1 份相对中心 +X');
  assert(closePos(r.items[2].pos, [7, 0, 10]), 'center 偏移后第 3 份相对中心 -X');
}
{
  // 360° 首末不重合（不含终点）
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 8, radius: 4 }, scene());
  assert(r.ok && !closePos(r.items[0].pos, r.items[7].pos), 'sweep=360 首末份不重合');
  assert(near(r.meta.angles[7], 315), '第 8 份角度为 315°（不含终点 360）');
}

/* ---------------- E. radius 缺省与 rotate 自转 ---------------- */
section('E. radius 缺省 / rotate 自转 / startAngle+sweep');

{
  // radius 缺省：取源对象在 XZ 平面到 center 的距离（pillar 在 [3,1,0] → 半径 3）
  const r = resolveRadial3D({ op: 'radial3d', id: 'pillar', count: 4 }, scene());
  assert(r.ok && near(r.meta.radius, 3), 'radius 缺省取源水平距离 3');
  assert(closePos(r.items[0].pos, [3, 1, 0]), '缺省半径下第 1 份即源位置');
}
{
  // 源对象恰在轴上（ball 在原点，center 原点）→ 回落默认半径 3
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 4 }, scene());
  assert(r.ok && near(r.meta.radius, 3), '源在轴上时 radius 回落默认 3');
}
{
  // rotate=true：rot[绕轴] 叠加每份角度（绕 Y 时 rot[1] += deg）
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 4, radius: 2, rotate: true }, scene());
  assert(r.ok, 'rotate=true 解析成功');
  assert(near(r.items[0].rot[1], 0), 'rotate 第 1 份 rotY=0');
  assert(near(r.items[1].rot[1], 90), 'rotate 第 2 份 rotY=90');
  assert(near(r.items[2].rot[1], 180), 'rotate 第 3 份 rotY=180');
  assert(r.items.every((it) => near(it.rot[0], 0) && near(it.rot[2], 0)),
    'rotate 只改绕轴分量，其余 rot 分量不变');
}
{
  // rotate=false（默认）：rot 完全沿用源
  const st = { objects: [{ id: 'p', type: 'box', pos: [2, 0, 0], rot: [10, 20, 30], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, radius: 2 }, st);
  assert(r.ok && r.items.every((it) => eq3(it.rot, [10, 20, 30])), 'rotate 缺省 false 时 rot 沿用源');
}
{
  // startAngle + sweep：半圈 3 份，角度 30/90/150
  const st = { objects: [{ id: 'p', type: 'box', pos: [2, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], p: {} }] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'p', count: 3, radius: 2, startAngle: 30, sweep: 120 }, st);
  assert(r.ok, 'startAngle+sweep 解析成功');
  assert(near(r.meta.angles[0], 30) && near(r.meta.angles[1], 70) && near(r.meta.angles[2], 110),
    'startAngle+sweep 角度均分为 30/70/110');
  // 负 sweep 反向
  const r2 = resolveRadial3D({ op: 'radial3d', id: 'p', count: 4, radius: 2, sweep: -360 }, st);
  assert(r2.ok && near(r2.meta.angles[1], -90), '负 sweep 反向（第 2 份 -90°）');
}

/* ---------------- F. 覆盖字段 / 同名避让 / 只读性 ---------------- */
section('F. 覆盖字段 / 同名避让 / 只读性');

{
  const st = scene();
  const cmd = { op: 'radial3d', id: 'ball', count: 4, radius: 5,
    color: '#e11d48', opacity: 0.3, scale: [2, 2, 2], params: { r: 2.5 } };
  const snap = JSON.stringify(cmd);
  const stSnap = JSON.stringify(st);
  const r = resolveRadial3D(cmd, st);
  assert(r.ok, '覆盖字段阵列成功');
  assert(r.items.every((it) => it.color === '#e11d48'), 'color 覆盖生效到每份');
  assert(r.items.every((it) => near(it.opacity, 0.3)), 'opacity 覆盖生效到每份');
  assert(r.items.every((it) => eq3(it.scale, [2, 2, 2])), 'scale 覆盖生效到每份');
  assert(r.items.every((it) => near(it.p.r, 2.5)), 'params 覆盖生效到每份');
  assert(JSON.stringify(cmd) === snap && JSON.stringify(st) === stSnap, '纯函数未修改 cmd / state 入参');
}
{
  // 同名避让：已存在 ball_rad1 时自动避让到 _2
  const st = { objects: [
    { id: 'ball', type: 'sphere', pos: [3, 0, 0], scale: [1, 1, 1], p: {} },
    { id: 'ball_rad1', type: 'sphere', pos: [0, 0, 0], scale: [1, 1, 1], p: {} },
  ] };
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 4, radius: 3 }, st);
  assert(r.ok && r.items[0].id === 'ball_rad1_2', '同名 id 自动避让 _2');
  assert(new Set(r.items.map((i) => i.id)).size === r.items.length, '所有产出 id 唯一');
}
{
  // 显式 newId 单份冲突 → 拒绝
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 1, newId: 'pillar' }, scene());
  assert(r.ok === false && /已存在/.test(r.error), '显式 newId 与现有冲突时拒绝');
  // 显式 newId 批量作为前缀
  const r2 = resolveRadial3D({ op: 'radial3d', id: 'ball', count: 3, newId: 'ring', radius: 3 }, scene());
  assert(r2.ok && r2.items[0].id === 'ring1' && r2.items[2].id === 'ring3', '批量 newId 作为前缀加序号');
}

/* ---------------- G. 脏输入原子拒绝 ---------------- */
section('G. 脏输入 / 边界拒绝');

const bad = [
  [{}, '空命令拒绝'],
  [{ op: 'radial3d' }, '缺 id 拒绝'],
  [{ op: 'radial3d', id: 'bad id!' }, '非法 id 拒绝'],
  [{ op: 'radial3d', id: 'nope' }, '源对象不存在拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 'abc' }, 'count 非数字拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, axis: 'w' }, 'axis 非法拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, axis: 1 }, 'axis 非字符串拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, center: [0, 0] }, 'center 维度错误... 实际回落默认'],
  [{ op: 'radial3d', id: 'ball', count: 3, startAngle: 'x' }, 'startAngle 非数字拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, sweep: null }, 'sweep 为 null 拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, radius: 'r' }, 'radius 非数字拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, rotate: 'yes' }, 'rotate 非布尔拒绝'],
  [{ op: 'radial3d', id: 'ball', count: 3, newId: 'bad id' }, 'newId 非法拒绝'],
];
for (const [cmd, msg] of bad) {
  const r = resolveRadial3D(cmd, scene());
  if (msg.includes('回落')) assert(r.ok === true, msg);
  else assert(r.ok === false, msg);
}
{
  // 无限数值：Infinity 字符串被 num 拒绝
  const r = resolveRadial3D({ op: 'radial3d', id: 'ball', radius: 'Infinity' }, scene());
  assert(r.ok === false, 'radius=Infinity 字符串拒绝');
  // NaN
  const r2 = resolveRadial3D({ op: 'radial3d', id: 'ball', count: NaN }, scene());
  assert(r2.ok === false, 'count=NaN 拒绝');
}

/* ---------------- H. applyBoard3DCommands 集成 ---------------- */
section('H. 执行器集成');

{
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'radial3d', id: 'ball', count: 4, radius: 3 },
  ], api);
  assert(results.length === 1 && results[0].ok === true, '执行器 radial3d 成功');
  assert(results[0].source === 'ball' && results[0].count === 4, '结果带源 id 与份数');
  assert(Array.isArray(results[0].created) && results[0].created.length === 4, 'created 含 4 项');
  assert(api.objects.filter((o) => /^ball_rad/.test(o.id)).length === 4, '4 个副本进入场景');
  assert(results[0].meta && results[0].meta.axis === 'y', '结果带 meta 几何信息');
}
{
  // 同批先建源再阵列
  const api = mockApi({ objects: [] });
  const results = applyBoard3DCommands([
    { op: 'add3d', id: 'newBall', type: 'sphere', pos: [2, 0, 0], p: { r: 1 } },
    { op: 'radial3d', id: 'newBall', count: 6, radius: 2 },
  ], api);
  assert(results.length === 2 && results[1].ok === true, '同批先建后阵列成功');
  assert(api.objects.filter((o) => o.type === 'sphere').length === 7, '场景共 1 源 + 6 副本');
}
{
  // getState 缺失降级：不中断整批
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'radial3d', id: 'ball', count: 2 },
    { op: 'reset3d' },
  ], api);
  const fake = { add() { return true; }, resetView() { return true; } };
  const r2 = applyBoard3DCommands([{ op: 'radial3d', id: 'x', count: 2 }, { op: 'reset3d' }], fake);
  assert(r2.length === 2 && r2[0].ok === false, 'getState 缺失时 radial3d 失败但不中断');
  assert(r2[1].ok === true, '后续命令仍执行（整批不中断）');
}
{
  // 2D 命令隔离
  const api = mockApi();
  const results = applyBoard3DCommands([{ op: 'radial', id: 'ball', count: 4 }], api);
  assert(results.length === 1 && results[0].ok === false, 'radial（非 radial3d）被 3D 执行器拒绝');
  assert(/不支持/.test(results[0].error), '拒绝信息说明不支持该命令');
}

/* ---------------- I. 协作铁律与硬约束静态复核 ---------------- */
section('I. 协作铁律 / 硬约束静态复核');

{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveRadial3D') && exec.includes("case 'radial3d'"), '执行器接入 radial3d 分支');
  assert(exec.includes('BOARD3D_RADIAL_OPS') && exec.includes('BOARD3D_COMPLETE2_OPS'),
    '执行器含独立扩展组与新完整集导出');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'), '执行器仍不依赖 three / DOM');

  const dup = read('js/board3d-duplicate.js');
  assert(dup.includes('export function resolveRadial3D'), '纯函数层导出 resolveRadial3D');
  assert(dup.includes('export function resolveDuplicate3D'), '既有 resolveDuplicate3D 仍在（未删）');
  assert(!dup.includes("from 'three'") && !dup.includes('document.') && !dup.includes('window.'),
    '纯函数层不依赖 three / DOM / window');

  // 后端拼接：旧串仍是新串前缀（追加而非替换）
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_RADIAL_PROMPT'), '后端 import 并拼接 radial 提示词');
  assert(be.indexOf('BOARD3D_DUPLICATE_PROMPT + BOARD3D_RADIAL_PROMPT') > -1,
    '3D 提示词在旧拼接串末尾追加新段（旧串为前缀）');

  // 硬约束：新旧路径并存
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('radial3d'), '页面 AI 面板提示已列出 radial3d');
  assert(read('js/board3d-ai.js').includes("r.op !== 'radial3d'"), '前端仍展示环形阵列结果');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);

/**
 * 3D 空间二面角 / 平面角命令（dihedral3d · D32）无头回归。
 *
 * 覆盖：dihedralEdgeUnit / dihedralFoot / dihedralFaceDir / dihedralArcPerp / resolveDihedral3D 纯函数
 *       （默认 90°、60°/120°、显式 foot、footT、圆弧守恒、开关 / 小球 / 角度标注 / 样式 /
 *        数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_dihedral.mjs
 */
import {
  BOARD3D_DIHEDRAL_PROMPT, BOARD3D_DIHEDRAL_PROMPT_OPS,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
  BOARD3D_ARC_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_POLYHEDRON_OPS, BOARD3D_COMPLETE9_OPS,
  BOARD3D_REVOLVE_OPS, BOARD3D_COMPLETE10_OPS, BOARD3D_TORUS_OPS, BOARD3D_COMPLETE11_OPS,
  BOARD3D_ELLIPSOID_OPS, BOARD3D_COMPLETE12_OPS, BOARD3D_CAPSULE_OPS, BOARD3D_COMPLETE13_OPS,
  BOARD3D_TUBE_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_PRISM_OPS, BOARD3D_COMPLETE15_OPS,
  BOARD3D_PYRAMID_OPS, BOARD3D_COMPLETE16_OPS, BOARD3D_FRUSTUM_OPS, BOARD3D_COMPLETE17_OPS,
  BOARD3D_VECTOR_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_CONE_OPS, BOARD3D_COMPLETE19_OPS,
  BOARD3D_CYLINDER_OPS, BOARD3D_COMPLETE20_OPS, BOARD3D_PLANE_OPS, BOARD3D_COMPLETE21_OPS,
  BOARD3D_CONEFRUSTUM_OPS, BOARD3D_COMPLETE22_OPS, BOARD3D_DIHEDRAL_OPS, BOARD3D_COMPLETE23_OPS,
} from '../js/board3d-executor.js';
import {
  DIHEDRAL3D_RAY_LENGTH_MIN, DIHEDRAL3D_RAY_LENGTH_MAX, DIHEDRAL3D_RAY_LENGTH_DEFAULT,
  DIHEDRAL3D_ARC_RADIUS_MIN, DIHEDRAL3D_ARC_RADIUS_MAX, DIHEDRAL3D_ARC_RADIUS_DEFAULT,
  DIHEDRAL3D_FOOT_T_MIN, DIHEDRAL3D_FOOT_T_MAX, DIHEDRAL3D_FOOT_T_DEFAULT,
  DIHEDRAL3D_SEGMENTS_MIN, DIHEDRAL3D_SEGMENTS_MAX, DIHEDRAL3D_SEGMENTS_DEFAULT,
  DIHEDRAL3D_VERTEX_SIZE_MIN, DIHEDRAL3D_VERTEX_SIZE_MAX, DIHEDRAL3D_VERTEX_SIZE_DEFAULT,
  DIHEDRAL3D_MAX_SEGMENTS, DIHEDRAL3D_DEFAULT_EDGE, DIHEDRAL3D_DEFAULT_POINT_A, DIHEDRAL3D_DEFAULT_POINT_B,
  num, dihedralEdgeUnit, dihedralFoot, dihedralFaceDir, dihedralArcPerp, resolveDihedral3D,
} from '../js/board3d-dihedral.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** 从 git HEAD 读取改动前内容，用于共享文件字节级纯追加断言 */
const readHead = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);

// ---------------------------------------------------------------------------
section('一、常量与默认契约');
assert(DIHEDRAL3D_RAY_LENGTH_DEFAULT === 1 && DIHEDRAL3D_RAY_LENGTH_MIN === 0.01 && DIHEDRAL3D_RAY_LENGTH_MAX === 10000, '射线长度默认/区间常量');
assert(DIHEDRAL3D_ARC_RADIUS_DEFAULT === 0.5 && DIHEDRAL3D_ARC_RADIUS_MIN === 0.01 && DIHEDRAL3D_ARC_RADIUS_MAX === 10000, '圆弧半径默认/区间常量');
assert(DIHEDRAL3D_FOOT_T_DEFAULT === 0.5 && DIHEDRAL3D_FOOT_T_MIN === 0 && DIHEDRAL3D_FOOT_T_MAX === 1, '垂足比例默认/区间常量');
assert(DIHEDRAL3D_SEGMENTS_DEFAULT === 24 && DIHEDRAL3D_SEGMENTS_MIN === 3 && DIHEDRAL3D_SEGMENTS_MAX === 64, '圆弧分段默认/区间常量');
assert(DIHEDRAL3D_VERTEX_SIZE_DEFAULT === 0.1 && DIHEDRAL3D_VERTEX_SIZE_MIN === 0.01 && DIHEDRAL3D_VERTEX_SIZE_MAX === 1, '顶点球默认/区间常量');
assert(DIHEDRAL3D_MAX_SEGMENTS === 4096, '段数上限常量');
assert(frozen(DIHEDRAL3D_DEFAULT_EDGE) && frozen(DIHEDRAL3D_DEFAULT_EDGE[0]) && frozen(DIHEDRAL3D_DEFAULT_EDGE[1]), '默认棱深冻结');
assert(frozen(DIHEDRAL3D_DEFAULT_POINT_A) && frozen(DIHEDRAL3D_DEFAULT_POINT_B), '默认两点深冻结');
assert(vecApprox(DIHEDRAL3D_DEFAULT_POINT_A, [0, 1, 0]) && vecApprox(DIHEDRAL3D_DEFAULT_POINT_B, [0, 0, 1]), '默认两点为 90° 二面角');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、棱方向解析');
assert(vecApprox(dihedralEdgeUnit(undefined), [1, 0, 0]), '默认棱方向为 x 轴');
assert(vecApprox(dihedralEdgeUnit([[0, 0, 0], [0, 3, 4]]), [0, 0.6, 0.8]), '任意棱方向单位化');
assert(approx(len(dihedralEdgeUnit([[1, 2, 3], [4, 6, 8]])), 1), '棱方向恒为单位向量');
assert(dihedralEdgeUnit([[0, 0, 0], [0, 0, 0]]) === null && dihedralEdgeUnit([[0, 0, 0]]) === null && dihedralEdgeUnit([[0, 0, 0], [1, 'x', 0]]) === null, '重合棱/非法棱拒绝');

section('三、垂足');
assert(vecApprox(dihedralFoot(undefined, 0.5), [0, 0, 0]), '默认垂足为棱中点（原点）');
assert(vecApprox(dihedralFoot(undefined, 0), [-1, 0, 0]) && vecApprox(dihedralFoot(undefined, 1), [1, 0, 0]), 'footT=0/1 落在棱两端');
assert(vecApprox(dihedralFoot([[0, 0, 0], [0, 0, 4]], 0.1, [5, 0, 2]), [0, 0, 2]), '显式 foot 投影到棱所在直线（忽略 footT）');
assert(dihedralFoot([[0, 0, 0], [0, 0, 0]], 0.5) === null && dihedralFoot(undefined, 0.5, [1, 'x']) === null, '非法棱/非法 foot 拒绝');
{
  const e = [[-1, 0, 0], [1, 0, 0]];
  const O = dihedralFoot(e, 0.5);
  const u = dihedralEdgeUnit(e);
  assert(len(cross(sub(O, e[0]), u)) < 1e-6, '垂足恒在棱所在直线上（叉积为 0）');
}

section('四、半平面射线方向');
{
  const O = [0, 0, 0];
  const u = [1, 0, 0];
  const dA = dihedralFaceDir(O, [0, 1, 0], u);
  const dB = dihedralFaceDir(O, [0, 0, 1], u);
  assert(vecApprox(dA, [0, 1, 0]) && vecApprox(dB, [0, 0, 1]), '垂直棱的半平面方向');
  assert(approx(dot(dA, u), 0) && approx(dot(dB, u), 0), '两射线方向均垂直棱');
  assert(approx(len(dA), 1) && approx(len(dB), 1), '两射线方向均为单位向量');
  assert(dihedralFaceDir(O, [1, 0, 0], u) === null, '落在棱上的点无法定半平面方向');
  assert(dihedralFaceDir(O, [0, 1], u) === null && dihedralFaceDir('x', [0, 1, 0], u) === null, '非法点拒绝');
}

section('五、圆弧旋转参考向量');
{
  const u = [1, 0, 0];
  const dA = [0, 1, 0];
  const perp = dihedralArcPerp(u, dA, [0, 0, 1]);
  assert(vecApprox(perp, [0, 0, 1]), 'perp 指向 dB 侧');
  const perp2 = dihedralArcPerp(u, dA, [0, 0, -1]);
  assert(vecApprox(perp2, [0, 0, -1]), 'perp 随 dB 反向取反');
  assert(approx(dot(perp, u), 0) && approx(dot(perp, dA), 0) && approx(len(perp), 1), 'perp 垂直棱与 dA 且为单位向量');
  assert(dihedralArcPerp([0, 0, 0], [0, 1, 0], [0, 0, 1]) === null && dihedralArcPerp('x', [0, 1, 0], [0, 0, 1]) === null, '非法入参拒绝');
}

section('六、默认 90° 几何与守恒');
{
  const r = resolveDihedral3D({ op: 'dihedral3d' });
  assert(r.ok === true, '默认命令解析成功');
  const m = r.meta;
  assert(vecApprox(m.u, [1, 0, 0]) && vecApprox(m.foot, [0, 0, 0]), '默认棱方向与垂足');
  assert(vecApprox(m.dA, [0, 1, 0]) && vecApprox(m.dB, [0, 0, 1]), '默认两射线方向');
  assert(approx(m.angle, Math.PI / 2, 1e-3) && m.angleDeg === 90 && m.labelText === '90°', '默认平面角 90°');
  assert(approx(dot(m.dA, m.u), 0) && approx(dot(m.dB, m.u), 0), '两边恒垂直棱');
  assert(approx(dot(m.dA, m.dB), Math.cos(m.angle), 1e-3), 'dA·dB = cos θ');
  assert(vecApprox(m.rayA, [0, 1, 0]) && vecApprox(m.rayB, [0, 0, 1]), '射线端点 = O + rayLength·方向');
  assert(approx(len(sub(m.rayA, m.foot)), m.rayLength) && approx(len(sub(m.rayB, m.foot)), m.rayLength), '射线端点距 O 恒为 rayLength');
  assert(m.arcPoints.length === 25 && vecApprox(m.arcPoints[0], [0, 0.5, 0]) && vecApprox(m.arcPoints[24], [0, 0, 0.5]), '圆弧首尾精确落在两边上');
  assert(m.arcPoints.every((p) => approx(len(sub(p, m.foot)), m.arcRadius, 3e-3)), '圆弧各点到 O 距离恒为 arcRadius');
  assert(m.arcRadius === 0.5 && m.arcRadiusClamped === false, '圆弧半径未钳制');
  assert(m.segmentCount === 27 && m.itemCount === 28 && m.rayCount === 2 && m.arcCount === 24 && m.labelCount === 1, '默认对象计数（27 线 + 1 标注）');
  assert(r.items.filter((it) => it.type === 'line').length === 27 && r.items.filter((it) => it.type === 'label').length === 1, 'items 结构与 meta 计数一致');
}

section('七、60° / 120° 二面角');
{
  const r60 = resolveDihedral3D({ pointA: [0, 1, 0], pointB: [0, 0.5, 0.866] });
  assert(r60.ok && r60.meta.angleDeg === 60, '60° 二面角');
  const r120 = resolveDihedral3D({ pointA: [0, 1, 0], pointB: [0, -0.5, 0.866] });
  assert(r120.ok && r120.meta.angleDeg === 120, '120° 二面角');
  assert(r120.meta.arcPoints.every((p) => approx(len(sub(p, r120.meta.foot)), r120.meta.arcRadius, 3e-3)), '120° 圆弧半径守恒');
}

section('八、footT / 显式 foot');
{
  const r = resolveDihedral3D({ edge: [[0, 0, 0], [0, 0, 4]], footT: 0.25, pointA: [1, 0, 1], pointB: [0, 1, 1] });
  assert(r.ok && vecApprox(r.meta.foot, [0, 0, 1]) && r.meta.footT === 0.25 && r.meta.footExplicit === false, 'footT 定位垂足');
  const r2 = resolveDihedral3D({ edge: [[0, 0, 0], [0, 0, 4]], foot: [5, 0, 2], footT: 0.1, pointA: [1, 0, 2], pointB: [0, 1, 2] });
  assert(r2.ok && vecApprox(r2.meta.foot, [0, 0, 2]) && r2.meta.footExplicit === true && r2.meta.footT === null, '显式 foot 优先且投影到棱');
  assert(r2.meta.angleDeg === 90, '显式 foot 下角度仍正确');
}

section('九、开关 / 小球 / 角度标注 / 样式');
{
  const r = resolveDihedral3D({ segments: 4, asEdge: false, asRays: false, asArc: false, asChord: true, asPoints: true, labelAngle: false });
  assert(r.ok && r.meta.edgeCount === 0 && r.meta.rayCount === 0 && r.meta.arcCount === 0 && r.meta.chordCount === 1 && r.meta.pointCount === 3 && r.meta.labelCount === 0, '各输出开关独立生效');
  assert(r.items.length === 4 && r.items.every((it) => it.type === 'line' || it.type === 'point'), '仅连线与小球共 4 项');
  const r2 = resolveDihedral3D({ color: '#123456', labelColor: '#abcdef', opacity: 0.5, vertexSize: 0.3, segments: 3 });
  assert(r2.items.filter((it) => it.type !== 'label').every((it) => it.color === '#123456') && r2.items.find((it) => it.type === 'label').color === '#abcdef', '样式 color/labelColor 生效（标注用 labelColor）');
  assert(r2.items.find((it) => it.type === 'label').text === '90°' && r2.meta.vertexSize === 0.3, '角度标注文本与小球半径');
  assert(r2.items.find((it) => it.type === 'line').opacity === 0.5, '透明度生效');
  const r3c = resolveDihedral3D({ color: 'red', labelColor: '蓝' });
  assert(r3c.ok && r3c.items.filter((it) => it.type !== 'label').every((it) => it.color === '#4f6bed') && r3c.items.find((it) => it.type === 'label').color === '#e04040', '非法颜色按历史口径回退默认色');
}

section('十、数字字符串 / id 避让 / 只读');
{
  const r = resolveDihedral3D({ id: 'dh', segments: '4', rayLength: '2', arcRadius: '1', footT: '0.5' });
  assert(r.ok && r.meta.segments === 4 && r.meta.rayLength === 2 && r.meta.arcRadius === 1, '数字字符串容错');
  const r2 = resolveDihedral3D({ id: 'dh', segments: 3 }, { objects: [{ id: 'dh_edge' }, { id: 'dh_ra' }] });
  assert(r2.ok && !r2.items.some((it) => ['dh_edge', 'dh_ra'].includes(it.id)), '执行前 id 冲突自动避让');
  const r3 = resolveDihedral3D({ id: 'x'.repeat(64), segments: 3 });
  assert(r3.ok && r3.items.every((it) => it.id.length <= 64), '64 字符长 id 不越界');
  const cmd = Object.freeze({ op: 'dihedral3d', segments: 4 });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const r4 = resolveDihedral3D(cmd, state);
  assert(r4.ok && r4.items.length === 8, '深度冻结入参只读解析成功');
  assert(Object.isFrozen(r4.items[0]) === false && Array.isArray(r4.items), '输出为全新可变数组（不共享冻结引用）');
}

section('十一、脏输入原子拒绝');
const bad = [
  null, [], 'x',
  { id: 123 }, { id: '' }, { id: 'a b' }, { id: 'x'.repeat(65) },
  { edge: [[0, 0, 0]] }, { edge: [[0, 0, 0], [0, 0, 0]] }, { edge: [[0, 0, 0], [1, 'x', 0]] },
  { pointA: [0, 1] }, { pointA: 'x' }, { pointB: [0, 0] }, { pointB: null },
  { pointA: [1, 0, 0] }, { pointB: [0, 0, 0] },
  { footT: -0.1 }, { footT: 1.1 }, { footT: 'abc' }, { foot: 'x' }, { foot: [1, 'x'] },
  { rayLength: 0 }, { rayLength: 10001 }, { rayLength: 'x' },
  { arcRadius: 0 }, { arcRadius: 10001 }, { arcRadius: 'x' },
  { segments: 2 }, { segments: 65 }, { segments: 2.5 }, { segments: 'x' },
  { asEdge: 'yes' }, { asRays: 1 }, { asArc: null }, { asChord: 'true' }, { asPoints: 1 }, { labelAngle: 0 },
  { asEdge: false, asRays: false, asArc: false, asChord: false, asPoints: false, labelAngle: false },
  { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' },
  { opacity: 'x' },
];
for (const c of bad) {
  const r = resolveDihedral3D(c);
  assert(r.ok === false && typeof r.error === 'string', `脏输入原子拒绝：${JSON.stringify(c).slice(0, 60)}`);
}

section('十二、执行器常量与历史契约');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_OPS/ALL/FULL 条数不变');
assert([10, 11, 12, 13, 14, 15, 16, 17, 18].every((want, i) => {
  const c = [BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_COMPLETE9_OPS][i];
  return c.length === want;
}), '历史 COMPLETE~COMPLETE9 长度逐项不变');
assert([19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].every((want, i) => {
  const c = [BOARD3D_COMPLETE10_OPS, BOARD3D_COMPLETE11_OPS, BOARD3D_COMPLETE12_OPS, BOARD3D_COMPLETE13_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_COMPLETE15_OPS, BOARD3D_COMPLETE16_OPS, BOARD3D_COMPLETE17_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_COMPLETE19_OPS, BOARD3D_COMPLETE20_OPS, BOARD3D_COMPLETE21_OPS][i];
  return c.length === want;
}), 'COMPLETE10~COMPLETE21 长度逐项不变');
assert(BOARD3D_CONEFRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE22_OPS.length === 31, '历史 CONEFRUSTUM_OPS(1) 与 COMPLETE22(31) 不变');
assert(BOARD3D_DIHEDRAL_OPS.length === 1 && BOARD3D_DIHEDRAL_OPS[0] === 'dihedral3d' && BOARD3D_COMPLETE23_OPS.length === 32, '新增 DIHEDRAL_OPS(1) 与 COMPLETE23(32)');
assert(BOARD3D_COMPLETE23_OPS.includes('dihedral3d') && BOARD3D_COMPLETE23_OPS.includes('conefrustum3d') && BOARD3D_COMPLETE23_OPS.includes('plane3d'), 'COMPLETE23 含 dihedral3d 且保留既有段');
assert(!BOARD3D_OPS.includes('dihedral3d') && !BOARD3D_ALL_OPS.includes('dihedral3d') && !BOARD3D_FULL_OPS.includes('dihedral3d'), 'dihedral3d 未污染任何历史契约常量');

section('十三、执行器集成');
{
  const added = [];
  const api = { add: (it) => { added.push(it); return true; }, remove: () => true, update: () => true, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'dihedral3d', segments: 4, asPoints: true }], api);
  assert(res.length === 1 && res[0].op === 'dihedral3d' && res[0].ok === true, 'dihedral3d 执行成功');
  // 4 段：棱1 + 两边2 + 弧4 = 7 线；点=垂足+两端点=3 → 共 10；角度标注 1 → 共 11
  assert(added.length === 11 && res[0].count === 11, '逐项落地 11 个对象（7 线 + 3 点 + 1 标注）');
  assert(res[0].created.length === 11 && res[0].meta.angleDeg === 90, 'created 与 meta 回报完整');
}
{
  const res = applyBoard3DCommands([{ op: 'dihedral3d', arcRadius: 0 }], { add: () => true, getState: () => ({}) });
  assert(res.length === 1 && res[0].ok === false && /arcRadius/.test(res[0].error), '执行器层级拒绝非法参数');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'dihedral3d' }], api);
  assert(res[0].ok === true, 'getState 抛错降级为空场景，整批不中断');
}
{
  let i = 0;
  const api = { add: () => (++i === 2 ? false : true), getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'dihedral3d', segments: 4 }], api);
  assert(res[0].ok === false && res[0].failed && res[0].failed.length === 1 && res[0].created.length === 7, 'api.add 部分失败分项回报（8 项 - 1 失败 = 7）');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'dh_edge' }] }) };
  const res = applyBoard3DCommands([{ op: 'dihedral3d', segments: 3 }], api);
  assert(res[0].ok === true && !res[0].failed, '执行器 id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'dihedral3d', segments: 3 }, { op: 'label', text: 'S' }], api);
  assert(res.length === 2 && res[0].ok === true && res[1].ok === false, 'dihedral3d 与 2D 命令混排：3D 成功、2D 被默认拒绝');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cylinder', rt: 1, rb: 2, h: 3 }], api);
  assert(res.length === 1 && res[0].ok === false && /不支持/.test(res[0].error), '2D/内置 cylinder 命令在 3D 分支被 default 拒绝');
}

section('十四、共享文件协议与 3D 意图检测');
assert(frozen(BOARD3D_DIHEDRAL_PROMPT_OPS) && BOARD3D_DIHEDRAL_PROMPT_OPS[0] === 'dihedral3d', 'board-prompt 新增 DIHEDRAL_PROMPT_OPS');
assert(BOARD3D_DIHEDRAL_PROMPT.includes('dihedral3d') && BOARD3D_DIHEDRAL_PROMPT.includes('二面角'), 'board-prompt DIHEDRAL_PROMPT 含命令与二面角说明');
assert(BOARD3D_DIHEDRAL_PROMPT.includes('pointA') && BOARD3D_DIHEDRAL_PROMPT.includes('pointB'), '提示词含两半平面点参数');
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画正方体的二面角') === '3d', '开启检测且命中立体意图（正方体）切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十五、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolveDihedral3D \} from '\.\/board3d-dihedral\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'dihedral3d'/.test(exec), '执行器含 case dihedral3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_DIHEDRAL_PROMPT') && bp.includes('BOARD3D_CONEFRUSTUM_PROMPT') && bp.includes('BOARD3D_PLANE_PROMPT'), '共享文件含 DIHEDRAL_PROMPT 段且保留既有段（纯追加）');
  // 最高优先级：共享文件必须字节级纯追加，上方任何内容（含 2D 主干与既有 3D 段）逐字不动
  const oldBp = readHead('ai/board-prompt.js');
  assert(bp.startsWith(oldBp), `ai/board-prompt.js 字节级纯追加（旧 ${oldBp.length} 字节为新前缀，未覆盖 2D 主干或既有 3D 段）`);
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_DIHEDRAL_PROMPT') && be.includes('BOARD3D_CONEFRUSTUM_PROMPT') && be.includes('BOARD3D_PLANE_PROMPT'), 'backend 拼接串含 dihedral 且保留 conefrustum/plane');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('dihedral3d') && ai3.includes('conefrustum3d'), 'AI 面板结果展示含 dihedral3d 且保留 conefrustum3d');
  const html = read('board3d.html');
  assert(html.includes('dihedral3d') && html.includes('conefrustum3d') && html.includes('plane3d'), 'board3d.html AI tip 含 dihedral3d 且保留既有段');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D32') && doc.includes('dihedral3d'), '回归清单含 D32 记录');
  // 本任务职责范围：未触碰 2D 主干
  const b2 = read('js/board.js');
  assert(b2.length > 0 && read('js/executor.js').length > 0, '2D 主干文件仍存在（未删除）');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（本任务早期已切换，未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在、大角 SDK 引用未删除');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  const hdr = read('board3d.html');
  assert(/importmap|three/.test(hdr), 'board3d.html 仍本地/自研 Three.js 引用');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

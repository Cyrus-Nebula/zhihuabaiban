/**
 * 3D 四面体内切球命令（insphere3d · D40）无头回归。
 *
 * 覆盖：insphere3DTriangleArea / insphere3DVolume / insphere3DFaces /
 *       insphere3DCenter / insphere3DRadius / insphere3DFoot / insphere3DFrame /
 *       insphere3DGeometry / resolveInsphere3D 纯函数
 *       （默认正四面体与直角三棱锥内心、r=3V/S、内心到四面等距、切点落在面内、
 *        三正交大圆、六棱、半径线段垂直对应面、标架正交、样式、输出开关组合、
 *        id 避让与 64 字符边界、共面/重合/退化拒绝、脏输入原子拒绝、线段上限、深度只读）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失/抛错降级、api 部分失败分项、
 *       2D 隔离、历史契约长度）、共享文件协议两侧一致性、3D 意图分支、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_insphere.mjs
 */
import {
  BOARD3D_INSPHERE_PROMPT, BOARD3D_INSPHERE_PROMPT_OPS,
  isInsphere3DIntent,
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
  BOARD3D_LINEPLANE_OPS, BOARD3D_COMPLETE24_OPS, BOARD3D_POINT_PLANE_OPS, BOARD3D_COMPLETE25_OPS,
  BOARD3D_SKEWLINE_OPS, BOARD3D_COMPLETE26_OPS, BOARD3D_LINE_ANGLE_OPS, BOARD3D_COMPLETE27_OPS,
  BOARD3D_POINT_LINE_OPS, BOARD3D_COMPLETE28_OPS, BOARD3D_RELATION_OPS, BOARD3D_COMPLETE29_OPS,
  BOARD3D_CIRCUMSPHERE_OPS, BOARD3D_COMPLETE30_OPS, BOARD3D_INSPHERE_OPS, BOARD3D_COMPLETE31_OPS,
} from '../js/board3d-executor.js';
import {
  INSPHERE3D_SEGMENTS_MIN, INSPHERE3D_SEGMENTS_MAX, INSPHERE3D_SEGMENTS_DEFAULT,
  INSPHERE3D_VERTEX_SIZE_MIN, INSPHERE3D_VERTEX_SIZE_MAX, INSPHERE3D_VERTEX_SIZE_DEFAULT,
  INSPHERE3D_MAX_SEGMENTS, INSPHERE3D_DEFAULT_POINTS, INSPHERE3D_DEFAULT_AXIS,
  INSPHERE3D_FACE_INDEX, num, insphere3DAxisUnit, insphere3DTriangleArea,
  insphere3DVolume, insphere3DFaces, insphere3DCenter, insphere3DRadius,
  insphere3DFoot, insphere3DFrame, insphere3DGeometry, resolveInsphere3D,
} from '../js/board3d-insphere.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readHead = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const approx = (a, b, eps = 3e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 3e-3) => Array.isArray(a) && Array.isArray(b) && b.length === 3 && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

const TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; // 正四面体：内心原点、r=1/√3
const RIGHT = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]];        // 直角三棱锥：内心 [r,r,r]

section('一、常量与历史契约零回归');
assert(BOARD3D_OPS.length === 7 && BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'BOARD3D_OPS 7 / MEASURE 1 / ALL 8');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9 && BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'FULL 9 / COMPLETE 10');
assert(BOARD3D_RADIAL_OPS.length === 1 && BOARD3D_COMPLETE2_OPS.length === 11 && BOARD3D_MIRROR_OPS.length === 1 && BOARD3D_COMPLETE3_OPS.length === 12, 'COMPLETE2 11 / COMPLETE3 12');
assert(BOARD3D_GRID_OPS.length === 1 && BOARD3D_COMPLETE4_OPS.length === 13 && BOARD3D_ALIGN_OPS.length === 1 && BOARD3D_COMPLETE5_OPS.length === 14, 'COMPLETE4 13 / COMPLETE5 14');
assert(BOARD3D_HELIX_OPS.length === 1 && BOARD3D_COMPLETE6_OPS.length === 15 && BOARD3D_BEZIER_OPS.length === 1 && BOARD3D_COMPLETE7_OPS.length === 16, 'COMPLETE6 15 / COMPLETE7 16');
assert(BOARD3D_ARC_OPS.length === 1 && BOARD3D_COMPLETE8_OPS.length === 17 && BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_COMPLETE9_OPS.length === 18, 'COMPLETE8 17 / COMPLETE9 18');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_COMPLETE10_OPS.length === 19 && BOARD3D_TORUS_OPS.length === 1 && BOARD3D_COMPLETE11_OPS.length === 20, 'COMPLETE10 19 / COMPLETE11 20');
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_COMPLETE12_OPS.length === 21 && BOARD3D_CAPSULE_OPS.length === 1 && BOARD3D_COMPLETE13_OPS.length === 22, 'COMPLETE12 21 / COMPLETE13 22');
assert(BOARD3D_TUBE_OPS.length === 1 && BOARD3D_COMPLETE14_OPS.length === 23 && BOARD3D_PRISM_OPS.length === 1 && BOARD3D_COMPLETE15_OPS.length === 24, 'COMPLETE14 23 / COMPLETE15 24');
assert(BOARD3D_PYRAMID_OPS.length === 1 && BOARD3D_COMPLETE16_OPS.length === 25 && BOARD3D_FRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE17_OPS.length === 26, 'COMPLETE16 25 / COMPLETE17 26');
assert(BOARD3D_VECTOR_OPS.length === 1 && BOARD3D_COMPLETE18_OPS.length === 27 && BOARD3D_CONE_OPS.length === 1 && BOARD3D_COMPLETE19_OPS.length === 28, 'COMPLETE18 27 / COMPLETE19 28');
assert(BOARD3D_CYLINDER_OPS.length === 1 && BOARD3D_COMPLETE20_OPS.length === 29 && BOARD3D_PLANE_OPS.length === 1 && BOARD3D_COMPLETE21_OPS.length === 30, 'COMPLETE20 29 / COMPLETE21 30');
assert(BOARD3D_CONEFRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE22_OPS.length === 31 && BOARD3D_DIHEDRAL_OPS.length === 1 && BOARD3D_COMPLETE23_OPS.length === 32, 'COMPLETE22 31 / COMPLETE23 32');
assert(BOARD3D_LINEPLANE_OPS.length === 1 && BOARD3D_COMPLETE24_OPS.length === 33 && BOARD3D_POINT_PLANE_OPS.length === 1 && BOARD3D_COMPLETE25_OPS.length === 34, 'COMPLETE24 33 / COMPLETE25 34');
assert(BOARD3D_SKEWLINE_OPS.length === 1 && BOARD3D_COMPLETE26_OPS.length === 35 && BOARD3D_LINE_ANGLE_OPS.length === 1 && BOARD3D_COMPLETE27_OPS.length === 36, 'COMPLETE26 35 / COMPLETE27 36');
assert(BOARD3D_POINT_LINE_OPS.length === 1 && BOARD3D_COMPLETE28_OPS.length === 37 && BOARD3D_RELATION_OPS.length === 1 && BOARD3D_COMPLETE29_OPS.length === 38, 'COMPLETE28 37 / COMPLETE29 38');
assert(BOARD3D_CIRCUMSPHERE_OPS.length === 1 && BOARD3D_COMPLETE30_OPS.length === 39, 'CIRCUMSPHERE 1 / COMPLETE30 39');
assert(BOARD3D_INSPHERE_OPS.length === 1 && BOARD3D_INSPHERE_OPS[0] === 'insphere3d' && BOARD3D_COMPLETE31_OPS.length === 40 && BOARD3D_COMPLETE31_OPS.includes('insphere3d'), 'INSPHERE 1 / COMPLETE31 40 且含 insphere3d');
assert(!BOARD3D_OPS.includes('insphere3d') && !BOARD3D_ALL_OPS.includes('insphere3d') && !BOARD3D_COMPLETE30_OPS.includes('insphere3d'), 'insphere3d 未并入历史契约常量');
assert(INSPHERE3D_SEGMENTS_MIN === 8 && INSPHERE3D_SEGMENTS_MAX === 512 && INSPHERE3D_SEGMENTS_DEFAULT === 48, 'segments 常量 8/512/48');
assert(INSPHERE3D_VERTEX_SIZE_MIN === 0.01 && INSPHERE3D_VERTEX_SIZE_MAX === 1 && INSPHERE3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量 0.01/1/0.1');
assert(INSPHERE3D_MAX_SEGMENTS === 4096 && INSPHERE3D_DEFAULT_POINTS.length === 4 && INSPHERE3D_FACE_INDEX.length === 4, '上限与默认常量');
assert(JSON.stringify(INSPHERE3D_DEFAULT_AXIS) === '[0,0,1]', '默认轴 z');

section('二、num / 轴 / 标架 / 面 / 体积');
assert(num(3) === 3 && num('3.5') === 3.5 && num(' 2 ') === 2, 'num 数字与数字字符串');
assert(num(null) === null && num('') === null && num('abc') === null && num(NaN) === null && num(Infinity) === null && num([]) === null, 'num 脏输入拒绝');
assert(vecApprox(insphere3DAxisUnit(undefined), [0, 0, 1]), '默认轴 z');
assert(vecApprox(insphere3DAxisUnit('x'), [1, 0, 0]) && vecApprox(insphere3DAxisUnit('Y'), [0, 1, 0]) && vecApprox(insphere3DAxisUnit([0, 0, 2]), [0, 0, 1]), '轴 x/y/向量');
assert(insphere3DAxisUnit('q') === null && insphere3DAxisUnit([0, 0, 0]) === null && insphere3DAxisUnit('abc') === null, '非法轴拒绝');
const frame = insphere3DFrame('z');
assert(frame && approx(dot(frame.n, frame.u), 0, 1e-9) && approx(dot(frame.n, frame.v), 0, 1e-9) && approx(dot(frame.u, frame.v), 0, 1e-9), '标架 n/u/v 两两正交');
assert(approx(norm(frame.u), 1, 1e-9) && approx(norm(frame.v), 1, 1e-9), '标架单位向量');
assert(insphere3DFrame('bad') === null, '非法轴无法构造标架');
assert(approx(insphere3DTriangleArea([0, 0, 0], [2, 0, 0], [0, 2, 0]), 2), '三角形面积 2');
assert(insphere3DTriangleArea([0, 0, 0], [1, 0, 0], [2, 0, 0]) === 0, '共线三角形面积 0');
assert(approx(insphere3DVolume(RIGHT), 8 / 6), '直角三棱锥体积 8/6');
assert(insphere3DVolume(TETRA) > 2.6 && insphere3DVolume(TETRA) < 2.7, '正四面体体积 ≈8/3');
assert(insphere3DVolume([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]]) === 0, '共面四点体积 0');
assert(insphere3DVolume(null) === null && insphere3DVolume([[0, 0, 0]]) === null, '体积入参非法拒绝');

section('三、面 / 内心 / 半径 / 垂足 / 综合几何');
const faces = insphere3DFaces(TETRA);
assert(faces && faces.length === 4 && faces.every((f) => f.area > 0), '正四面体四面合法');
assert(insphere3DFaces([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]]) === null, '共面点有面退化 → 拒绝');
assert(insphere3DFaces([[0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]]) === null, '重合点有面退化 → 拒绝');
assert(insphere3DFaces(null) === null, '面入参非法拒绝');
assert(vecApprox(insphere3DCenter(TETRA), [0, 0, 0], 1e-9), '正四面体内心原点');
const R_IN = 2 / (3 + Math.sqrt(3)); // 直角三棱锥 r = 3V/S = 4/(6+2√3) = 2/(3+√3)
assert(vecApprox(insphere3DCenter(RIGHT), [R_IN, R_IN, R_IN], 1e-9), '直角三棱锥内心 [r,r,r]');
assert(insphere3DCenter(null) === null, '内心入参非法拒绝');
assert(approx(insphere3DRadius(TETRA), 1 / Math.sqrt(3), 1e-9), '正四面体 r=1/√3');
assert(approx(insphere3DRadius(RIGHT), R_IN, 1e-9), '直角三棱锥 r=2/(3+√3)');
assert(insphere3DRadius(null) === null, '半径入参非法拒绝');
const foot = insphere3DFoot([0, 0, 3], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
assert(vecApprox(foot, [0, 0, 0], 1e-9), '点到 xy 面垂足为原点');
assert(insphere3DFoot([0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]) === null, '退化面垂足拒绝');
const geo = insphere3DGeometry(TETRA);
assert(geo && vecApprox(geo.center, [0, 0, 0], 1e-9), '综合几何内心原点');
assert(approx(geo.radius, 3 * geo.volume / geo.faceAreaSum, 1e-9), 'r = 3V/S_total');
assert(geo.radiusChecks.every((d) => approx(d, geo.radius, 1e-9)), '内心到四切点距离恒为 r');
assert(geo.tangents.every((t, i) => {
  const f = geo.faces[i];
  return approx(dot(sub(t, f.verts[0]), f.normal), 0, 1e-9); // 切点在面内
}), '四切点落在对应面内');
assert(geo.faces.every((f) => approx(norm(f.normal), 1, 1e-9)), '四面法向单位化');
assert(insphere3DGeometry([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]]) === null, '共面四点无内切球');
assert(insphere3DGeometry(null) === null, '综合几何非法入参拒绝');

section('四、resolveInsphere3D 纯函数');
const base = resolveInsphere3D({ op: 'insphere3d' }, { objects: [] });
assert(base.ok && base.items.length > 0, '默认命令成功');
assert(vecApprox(base.meta.center, [0, 0, 0]) && base.meta.radius === 0.5774, '默认内心原点、r 读数 0.5774');
assert(base.meta.radiusChecks.every((d) => approx(d, 0.5774)), '默认四条半径读数相等');
assert(base.meta.sphereCount === 3 && base.meta.edgeCount === 6 && base.meta.radiusCount === 4, '默认三大圆 + 六棱 + 四半径');
assert(base.meta.pointCount === 0 && base.meta.labelCount === 2 && base.meta.itemCount === 3 * 48 + 6 + 4 + 2, '默认 156 项（3×48 大圆 + 6 棱 + 4 半径 + 2 标注）');
assert(base.meta.items !== undefined || base.meta.itemCount === base.items.length, 'itemCount 与 items 一致');
const lines = base.items.filter((it) => it.type === 'line');
assert(lines.length === 3 * 48 + 6 + 4, '线段数 = 三大圆 144 + 六棱 + 四半径 = 154');
const labels = base.items.filter((it) => it.type === 'label');
assert(labels.some((l) => l.text === 'I') && labels.some((l) => l.text.startsWith('r=')), '内心 I 与半径 r 标注');
assert(new Set(base.items.map((it) => it.id)).size === base.items.length, 'id 全局唯一');
// 全开
const full = resolveInsphere3D({ op: 'insphere3d', points: RIGHT, labelVertices: true, labelFeet: true, asPoints: true }, { objects: [] });
assert(full.ok && full.meta.labelCount === 1 + 4 + 4 + 1 && full.meta.pointCount === 9, '全开标注 10 / 小球 9');
const fullLabels = full.items.filter((it) => it.type === 'label').map((it) => it.text);
assert(['I', 'A', 'B', 'C', 'D', 'T0', 'T1', 'T2', 'T3'].every((t) => fullLabels.includes(t)), '内心/顶点/切点标注齐全');
// 只留内心标注
const minimal = resolveInsphere3D({ op: 'insphere3d', asSphere: false, asEdges: false, asRadii: false, labelCenter: true, labelRadius: false }, { objects: [] });
assert(minimal.ok && minimal.meta.segmentCount === 0 && minimal.meta.itemCount === 1, '只留内心标注');
// 八开关全关
assert(!resolveInsphere3D({ op: 'insphere3d', asSphere: false, asEdges: false, asRadii: false, asPoints: false, labelCenter: false, labelVertices: false, labelFeet: false, labelRadius: false }, {}).ok, '八开关全关拒绝');
// 样式 / 数字字符串
const styled = resolveInsphere3D({ op: 'insphere3d', segments: '12', vertexSize: '0.2', color: '#123456', labelColor: '#abcdef', opacity: '0.6', asPoints: true }, { objects: [] });
assert(styled.ok && styled.meta.segments === 12 && styled.meta.vertexSize === 0.2 && styled.meta.color === '#123456' && styled.meta.opacity === 0.6, '数字字符串与样式');
// 非法样式色值回退默认（与 D39 口径一致：样式脏输入不整条拒绝，仅回退）
const defColor = resolveInsphere3D({ op: 'insphere3d', color: 'red', labelColor: 123 }, {});
assert(defColor.ok && defColor.meta.color === '#0e9f8a' && defColor.meta.labelColor === '#e04040', '非法样式色值回退默认');
// 轴
const axisX = resolveInsphere3D({ op: 'insphere3d', axis: 'x', segments: 8 }, { objects: [] });
assert(axisX.ok && vecApprox(axisX.meta.n, [1, 0, 0]) && axisX.meta.segmentCount === 3 * 8 + 6 + 4, '轴 x 与段数');
// id 避让
const collide = resolveInsphere3D({ op: 'insphere3d', id: 'x', segments: 8 }, { objects: [{ id: 'x_eq_0' }, { id: 'x_eq_1' }] });
assert(collide.ok && !collide.items.some((it) => it.id === 'x_eq_0' || it.id === 'x_eq_1'), 'state 已有 id 被避让');
const longId = resolveInsphere3D({ op: 'insphere3d', id: 'Q'.repeat(64), segments: 8 }, { objects: [] });
assert(longId.ok && longId.items.every((it) => it.id.length <= 64), '64 字符 id 不超界');
// 线段上限：asSphere 段数上限 512 → 3*512+6+4=1546 < 4096，无法越界；构造大量既有 id 不影响
assert(resolveInsphere3D({ op: 'insphere3d', segments: 512 }, {}).ok, '最大段数 512 仍合法');
// 脏输入原子拒绝
const dirty = [
  null, [], 'x', { id: 'bad id!' }, { id: 'bad!id' }, { points: null }, { points: [[0, 0, 0]] },
  { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]] }, // 共面
  { points: [[0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]] }, // 重合
  { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] }, // 共线
  { axis: 'bad' }, { axis: [0, 0, 0] }, { segments: 7 }, { segments: 513 }, { segments: 1.5 }, { segments: 'abc' },
  { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' }, { opacity: 'bad' },
  { asSphere: 'yes' }, { asEdges: 1 }, { asRadii: null }, { asPoints: 'false' },
  { labelCenter: 0 }, { labelVertices: 'true' }, { labelFeet: [] }, { labelRadius: {} },
];
for (const d of dirty) assert(!resolveInsphere3D(d, {}).ok, '脏输入原子拒绝：' + JSON.stringify(d).slice(0, 60));
// 深度只读
const cmd0 = { op: 'insphere3d', points: RIGHT.map((p) => p.slice()) };
const st0 = { objects: [{ id: 'x_e0' }] };
const snapshotC = JSON.stringify(cmd0);
const snapshotS = JSON.stringify(st0);
resolveInsphere3D(cmd0, st0);
assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
// getState 异常 / 缺失不传播（执行器层另测），此处 state 本身非法也应正常产出
assert(resolveInsphere3D({ op: 'insphere3d' }, null).ok, 'state 为 null 仍可产出');

section('五、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'insphere3d', points: RIGHT, labelFeet: true }], api);
  assert(res[0].ok && res[0].count === added.length && added.length > 150, '逐项落地到画板');
  assert(res[0].meta.radius === 0.4226 && res[0].meta.radiusChecks.length === 4, 'meta 半径与四切点读数回传');
  // id 冲突分项失败：known 跨命令累积，同批第二条 insphere3d 与第一条 id 全冲突
  const res2 = applyBoard3DCommands([
    { op: 'insphere3d', segments: 8 },
    { op: 'insphere3d', segments: 8 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败（第二条）');
  // getState 缺失 / 抛错降级
  const api3 = { add: () => true }; // 无 getState
  assert(applyBoard3DCommands([{ op: 'insphere3d', segments: 8 }], api3)[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'insphere3d', segments: 8 }], api4)[0].ok, 'getState 抛错降级为空场景');
  // api.add 部分失败分项回报
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'insphere3d', segments: 8 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  // 命令报错不中断整批
  assert(applyBoard3DCommands([{ op: 'insphere3d', points: null }, { op: 'insphere3d', segments: 8 }], { add: () => true, getState: () => ({}) }).length === 2, '坏命令不中断整批');
  // 2D 隔离
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'add3d', shape: 'box' }], api);
  assert(twoD[0].ok === false && twoD[1].ok === false, '2D segment 与非法 shape 被拒');
}

section('六、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_INSPHERE_PROMPT.includes('"op":"insphere3d"') && BOARD3D_INSPHERE_PROMPT.includes('r=3V/S_total'), '提示词含命令格式与几何守恒');
assert(BOARD3D_INSPHERE_PROMPT_OPS.length === 1 && BOARD3D_INSPHERE_PROMPT_OPS[0] === 'insphere3d', '提示词 ops 一致');
assert(isInsphere3DIntent('画一个三棱锥的内切球') && isInsphere3DIntent('求四面体内切球半径'), '内切球意图识别');
assert(isInsphere3DIntent('长方体空间四点的内切球') && isInsphere3DIntent('四面体内切球'), '立体专属词识别');
assert(!isInsphere3DIntent('画三角形内切圆') && !isInsphere3DIntent('圆的内切圆'), '2D 内切圆不误切 3D');
assert(!isInsphere3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '画三棱锥内切球') === '3d', 'detect3d + 内切球意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画三角形内切圆') === '2d', 'detect3d + 2D 内切圆仍 2D');
assert(resolveBoardMode({ message: '画内切球' }, '画内切球') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_INSPHERE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("is.op !== 'insphere3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('insphere3d 给四个不共面点'), '画板面板工具说明已追加');

section('七、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_INSPHERE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_CIRCUMSPHERE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('2D 主干'), '2D 主干标志仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  const h = headBackend.split('\n');
  const n = nowBackend.split('\n');
  assert(n.length === h.length, '后端行数未变（delta=' + (n.length - h.length) + '）');
  const inlineOnly = h.every((line, i) => {
    const now = n[i];
    if (line === now) return true;
    let j = 0;
    for (let k = 0; k < now.length && j < line.length; k++) if (now[k] === line[j]) j++;
    return j === line.length;
  });
  assert(inlineOnly, '后端历史行未被删除或改写（仅行内追加）');
}
{
  const headHtml = readHead('board3d.html');
  const nowHtml = read('board3d.html');
  const h = headHtml.split('\n');
  const n = nowHtml.split('\n');
  const inlineOnly = h.length === n.length && h.every((line, i) => {
    if (line === n[i]) return true;
    let j = 0;
    for (let k = 0; k < n[i].length && j < line.length; k++) if (n[i][k] === line[j]) j++;
    return j === line.length;
  });
  assert(inlineOnly, 'board3d.html 仅行内追加工具提示、未删改既有行');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'insphere3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

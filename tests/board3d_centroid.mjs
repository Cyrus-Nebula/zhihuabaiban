/**
 * 3D 四面体重心与四条中线命令（centroid3d · D42）无头回归。
 *
 * 覆盖：centroid3DVolume / centroid3DFaceCentroid / centroid3DCenter /
 *       centroid3DGeometry / resolveCentroid3D 纯函数
 *       （重心坐标、面重心、中线 3:1、四等分体积、正四面体 / 直角三棱锥 / 一般四面体、
 *        退化拒绝、八项输出开关组合、样式、id 避让与 64 字符边界、脏输入原子拒绝、深度只读）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失/抛错降级、api 部分失败、2D 隔离、
 *       历史契约长度）、协议两侧一致性、3D 意图分支（2D 三角形重心不误切）、
 *       协作铁律与硬约束静态复核（共享文件纯追加 / 旧 appId 路径未动）。
 *
 * 运行：node tests/board3d_centroid.mjs
 */
import {
  BOARD3D_CENTROID_PROMPT, BOARD3D_CENTROID_PROMPT_OPS, isCentroid3DIntent,
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
  BOARD3D_EULER_OPS, BOARD3D_COMPLETE32_OPS, BOARD3D_CENTROID_OPS, BOARD3D_COMPLETE33_OPS,
} from '../js/board3d-executor.js';
import {
  CENTROID3D_VERTEX_SIZE_MIN, CENTROID3D_VERTEX_SIZE_MAX, CENTROID3D_VERTEX_SIZE_DEFAULT,
  CENTROID3D_MAX_SEGMENTS, CENTROID3D_DEFAULT_POINTS, CENTROID3D_FACE_INDEX,
  num, centroid3DVolume, centroid3DFaceCentroid, centroid3DCenter, centroid3DGeometry,
  resolveCentroid3D,
} from '../js/board3d-centroid.js';
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
const vecApprox = (a, b, eps = 3e-3) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

const REG = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; // 正四面体：G=原点、V=8/3
const RIGHT = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]];      // 直角三棱锥：G=[0.5,0.5,0.5]、V=4/3
const SKEW = [[0, 0, 0], [3, 0, 0], [1, 4, 0], [1, 1, 5]];       // 一般四面体：G=[1.25,1.25,1.25]、V=10

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
assert(BOARD3D_INSPHERE_OPS.length === 1 && BOARD3D_COMPLETE31_OPS.length === 40, 'INSPHERE 1 / COMPLETE31 40');
assert(BOARD3D_EULER_OPS.length === 1 && BOARD3D_COMPLETE32_OPS.length === 41, 'EULER 1 / COMPLETE32 41');
assert(BOARD3D_CENTROID_OPS.length === 1 && BOARD3D_CENTROID_OPS[0] === 'centroid3d' && BOARD3D_COMPLETE33_OPS.length === 42 && BOARD3D_COMPLETE33_OPS.includes('centroid3d'), 'CENTROID 1 / COMPLETE33 42 且含 centroid3d');
assert(!BOARD3D_OPS.includes('centroid3d') && !BOARD3D_ALL_OPS.includes('centroid3d') && !BOARD3D_COMPLETE32_OPS.includes('centroid3d'), 'centroid3d 未并入历史契约常量');
assert(CENTROID3D_VERTEX_SIZE_MIN === 0.01 && CENTROID3D_VERTEX_SIZE_MAX === 1 && CENTROID3D_VERTEX_SIZE_DEFAULT === 0.1, '小球半径常量');
assert(CENTROID3D_MAX_SEGMENTS === 4096 && CENTROID3D_DEFAULT_POINTS.length === 4, '段数上限 / 默认四点');
assert(CENTROID3D_FACE_INDEX.length === 4 && CENTROID3D_FACE_INDEX.every((f) => f.length === 3 && new Set(f).size === 3), '四个面索引各含三点且不重复');
assert(num('2.5') === 2.5 && num(' 3 ') === 3 && num('') === null && num(NaN) === null && num(Infinity) === null && num(null) === null, 'num 严格取有限数');

section('二、纯几何：体积、面重心、重心与 3:1 / V/4 守恒');
assert(approx(centroid3DVolume(REG), 8 / 3, 1e-9), '正四面体体积 8/3');
assert(approx(centroid3DVolume(RIGHT), 4 / 3, 1e-9), '直角三棱锥体积 4/3');
assert(approx(centroid3DVolume(SKEW), 10, 1e-9), '一般四面体体积 10');
assert(centroid3DVolume([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]) === 0, '共线四点体积 0');
assert(centroid3DVolume([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]) === 0, '共面四点体积 0');
assert(centroid3DVolume(null) === null && centroid3DVolume([[0, 0, 0]]) === null, '非法点数拒绝');
assert(vecApprox(centroid3DCenter(REG), [0, 0, 0], 1e-9), '正四面体重心原点');
assert(vecApprox(centroid3DCenter(RIGHT), [0.5, 0.5, 0.5], 1e-9), '直角三棱锥重心 [0.5,0.5,0.5]');
assert(vecApprox(centroid3DCenter(SKEW), [1.25, 1.25, 1.25], 1e-9), '一般四面体重心 [1.25,1.25,1.25]');
assert(centroid3DCenter([[0, 0, 0], [1, 0, 0], [0, 1]]) === null, '点数不足重心拒绝');
assert(vecApprox(centroid3DFaceCentroid(REG, 0), [-1 / 3, -1 / 3, -1 / 3], 1e-9), '面 0 重心');
assert(vecApprox(centroid3DFaceCentroid(RIGHT, 0), [2 / 3, 2 / 3, 2 / 3], 1e-9), '直角三棱锥对面重心');
assert(centroid3DFaceCentroid(REG, -1) === null && centroid3DFaceCentroid(REG, 4) === null, '面索引越界拒绝');
assert(centroid3DFaceCentroid(REG, 1.5) === null && centroid3DFaceCentroid(null, 0) === null, '面索引非法拒绝');
for (const pts of [REG, RIGHT, SKEW]) {
  const g = centroid3DGeometry(pts);
  assert(g && g.holds, '综合求解成功');
  assert(g.medianRatios.length === 4 && g.medianRatios.every((v) => approx(v, 3, 1e-6)), '四条中线比例恒 3');
  assert(g.subVolumes.length === 4 && g.subVolumes.every((v) => approx(v, g.volume / 4, 1e-6)), '四个子体积恒 V/4');
  assert(g.faceCentroids.length === 4 && g.faceCentroids.every((q) => q.length === 3), '四个面重心');
  assert(g.center.every((v) => Number.isFinite(v)), '重心坐标有限');
  for (let i = 0; i < 4; i++) {
    const pi = pts[i], gi = g.faceCentroids[i];
    const d1 = norm(sub(pi, g.center)), d2 = norm(sub(g.center, gi)), dAll = norm(sub(pi, gi));
    assert(approx(d1 + d2, dAll, 1e-6), `中线 ${i} 上 G 在 Pi 与 Gi 之间`);
    assert(d1 > d2 && approx(d1 / d2, 3, 1e-6), `中线 ${i} PiG:GGi=3:1`);
  }
}
assert(centroid3DGeometry([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]) === null, '共线四点拒绝');
assert(centroid3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]) === null, '共面四点拒绝');
assert(centroid3DGeometry([[0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1]]) === null, '重合点拒绝');
assert(centroid3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1, 0], [Infinity, 0, 1]]) === null, '非法数值拒绝');
assert(centroid3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1]]) === null, '点数不足拒绝');
assert(centroid3DGeometry(null) === null, '空入参拒绝');

section('三、命令解析：图元、开关、样式与守恒');
{
  const res = resolveCentroid3D({ op: 'centroid3d' });
  assert(res.ok, '默认命令成功');
  const m = res.meta;
  assert(m.itemCount === res.items.length && m.itemCount === 12 && m.segmentCount === 10, '默认 6 棱 + 4 中线 + G/3:1 两标注 = 12 项');
  assert(m.edgeCount === 6 && m.medianCount === 4 && m.faceMedianCount === 0 && m.pointCount === 0 && m.labelCount === 2, '默认计数');
  assert(m.asEdges && m.asMedians && !m.asFaceMedians && !m.asPoints && m.labelCentroid && !m.labelVertices && !m.labelFaceCentroids && m.labelRatio, '默认八开关');
  assert(res.items.every((it) => it.id && it.type && Array.isArray(it.pos)), '每项均有 id/type/pos');
  assert(res.items.filter((it) => it.type === 'line').length === 10, '默认 10 段线');
  assert(vecApprox(m.center, [0, 0, 0], 8e-3) && approx(m.volume, 8 / 3, 8e-3), 'meta 重心与体积读数');
  assert(m.medianRatios.every((v) => approx(v, 3, 8e-3)) && m.subVolumes.every((v) => approx(v, 2 / 3, 8e-3)), 'meta 3:1 与 V/4 读数');
  assert(m.holds === true && m.ratioText.includes('3:1'), 'meta 守恒标记与比例文本');
  assert(res.items.some((it) => it.type === 'label' && it.text === 'G'), 'G 标注落地');
  assert(res.items.some((it) => it.type === 'label' && it.text.includes('3:1')), '3:1 标注落地');
  // 四条中线的端点必须恰为顶点与对面重心
  const medians = res.items.filter((it) => it.type === 'line' && it.id.includes('_m'));
  assert(medians.length === 4, '四条中线独立落地');
  for (let i = 0; i < 4; i++) {
    const p = medians[i].p;
    assert(vecApprox([p.x1, p.y1, p.z1], REG[i], 8e-3) && vecApprox([p.x2, p.y2, p.z2], m.faceCentroids[i], 8e-3), `中线 ${i} 端点为顶点与对面重心`);
  }
}
{
  const res = resolveCentroid3D({ op: 'centroid3d', points: RIGHT, asFaceMedians: true, asPoints: true, labelVertices: true, labelFaceCentroids: true });
  assert(res.ok, '全开输出成功');
  assert(res.meta.edgeCount === 6 && res.meta.medianCount === 4 && res.meta.faceMedianCount === 12, '6+4+12 线段');
  assert(res.meta.pointCount === 9 && res.meta.labelCount === 1 + 4 + 4 + 1, '9 小球 / 10 标注');
  assert(res.meta.segmentCount === 22 && res.meta.itemCount === 41, '合计 22 段 + 19 项标注小球');
  assert(res.items.filter((it) => it.type === 'point').every((it) => it.p.s === 0.1), '小球半径默认');
  const names = res.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(['A', 'B', 'C', 'D', 'G0', 'G1', 'G2', 'G3', 'G'].every((t) => names.includes(t)), 'A-D / G0-G3 / G 标注齐全');
  assert(res.meta.faceCentroids.every((q, i) => vecApprox(q, centroid3DFaceCentroid(RIGHT, i), 8e-3)), '面重心读数与纯函数一致');
}
{
  const res = resolveCentroid3D({ op: 'centroid3d', asEdges: false, asMedians: false, asFaceMedians: false, asPoints: true, labelCentroid: false, labelRatio: false });
  assert(res.ok && res.meta.segmentCount === 0 && res.meta.pointCount === 9 && res.items.length === 9, '仅小球模式合法');
}
{
  const res = resolveCentroid3D({ op: 'centroid3d', points: SKEW, vertexSize: '0.2', color: '#abc', faceColor: '#123456', labelColor: '#DEF', opacity: 0.4 });
  assert(res.ok && res.meta.vertexSize === 0.2 && res.meta.color === '#abc' && res.meta.faceColor === '#123456' && res.meta.labelColor === '#DEF' && res.meta.opacity === 0.4, '数字字符串与简写色值');
  assert(res.items.every((it) => it.opacity === 0.4 || it.type === 'label'), '透明度透传');
  assert(vecApprox(res.meta.center, [1.25, 1.25, 1.25], 8e-3) && approx(res.meta.volume, 10, 8e-3), '一般四面体读数');
}
{
  const st = { objects: [{ id: 'cent_e0' }, { id: 'cent_m0' }, { id: 'cent_lG' }] };
  const res = resolveCentroid3D({ op: 'centroid3d' }, st);
  assert(res.ok && !res.items.some((it) => ['cent_e0', 'cent_m0', 'cent_lG'].includes(it.id)), '场景已有 id 全部避让');
  assert(res.items.some((it) => it.id === 'cent_e0_2') && res.items.some((it) => it.id === 'cent_m0_2'), '冲突 id 自动加序号');
  const longId = 'x'.repeat(64);
  const r2 = resolveCentroid3D({ op: 'centroid3d', id: longId, asFaceMedians: true });
  assert(r2.ok && r2.items.every((it) => it.id.length <= 64), '64 字符 id 边界不超长');
  assert(resolveCentroid3D({ op: 'centroid3d', id: 'bad id' }).ok === false, '含空格 id 拒绝');
  assert(resolveCentroid3D({ op: 'centroid3d' }, null).ok, 'state 为 null 仍可产出');
}

section('四、脏输入原子拒绝与深度只读');
const bad = [
  { cmd: null, name: '命令为空' },
  { cmd: [], name: '命令为数组' },
  { cmd: { op: 'centroid3d', points: null }, name: 'points 为 null' },
  { cmd: { op: 'centroid3d', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] }, name: '四点共线' },
  { cmd: { op: 'centroid3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] }, name: '四点共面' },
  { cmd: { op: 'centroid3d', points: [[0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1]] }, name: '重合点' },
  { cmd: { op: 'centroid3d', vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { op: 'centroid3d', vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { op: 'centroid3d', vertexSize: 'abc' }, name: 'vertexSize 非数值' },
  { cmd: { op: 'centroid3d', asEdges: 'true' }, name: '开关非布尔' },
  { cmd: { op: 'centroid3d', asEdges: false, asMedians: false, asFaceMedians: false, asPoints: false, labelCentroid: false, labelVertices: false, labelFaceCentroids: false, labelRatio: false }, name: '八输出开关全关' },
  { cmd: { op: 'centroid3d', opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { op: 'centroid3d', color: 123 }, name: '颜色非字符串' },
  { cmd: { op: 'centroid3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 'oops']] }, name: '坐标非数值' },
  { cmd: { op: 'centroid3d', points: [[0, 0, 0], [1, 0, 0], [0, 1]] }, name: '点数不足' },
  { cmd: { op: 'centroid3d', id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveCentroid3D(b.cmd).ok === false, `拒绝：${b.name}`);
assert(CENTROID3D_MAX_SEGMENTS > 6 + 4 + 12, '段数上限高于合法最大线段总量');
{
  const cmd0 = { op: 'centroid3d', points: SKEW.map((p) => p.slice()), labelVertices: true };
  const st0 = { objects: [{ id: 'cent_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveCentroid3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('五、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'centroid3d', points: RIGHT }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 12, '逐项落地到画板（10 段 + 2 标注）');
  assert(res[0].meta.center[0] === 0.5 && approx(res[0].meta.volume, 4 / 3, 8e-3), 'meta 读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'centroid3d' },
    { op: 'centroid3d' },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'centroid3d' }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'centroid3d' }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'centroid3d' }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'centroid3d', points: null }, { op: 'centroid3d' }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'centroid3d' }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，centroid3d 正常');
}

section('六、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_CENTROID_PROMPT.includes('"op":"centroid3d"') && BOARD3D_CENTROID_PROMPT.includes('3:1') && BOARD3D_CENTROID_PROMPT.includes('V/4'), '提示词含命令格式与守恒关系');
assert(BOARD3D_CENTROID_PROMPT_OPS.length === 1 && BOARD3D_CENTROID_PROMPT_OPS[0] === 'centroid3d', '提示词 ops 一致');
assert(isCentroid3DIntent('四面体的重心在哪里') && isCentroid3DIntent('画三棱锥的四条中线'), '立体专属词识别');
assert(isCentroid3DIntent('空间四点的重心与质心') && isCentroid3DIntent('标出四面体 G 点，按 3:1 分中线'), '重心/质心/中线识别');
assert(!isCentroid3DIntent('三角形的重心') && !isCentroid3DIntent('画三角形三条中线') && !isCentroid3DIntent('线段中点'), '2D 三角形重心/中线不误切');
assert(!isCentroid3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '标出四面体重心') === '3d', 'detect3d + 四面体重心意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画三角形重心') === '2d', 'detect3d + 2D 三角形重心仍 2D');
assert(resolveBoardMode({ message: '画中线' }, '画中线') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_CENTROID_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isCentroid3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("ct.op !== 'centroid3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('centroid3d 给四个不共面点'), '画板面板工具说明已追加');

section('七、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_CENTROID_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_EULER_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('BOARD_SYSTEM_PROMPT'), '2D 主干仍在');
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
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'insphere3d'") && read('js/board3d-executor.js').includes("case 'euler3d'") && read('js/board3d-executor.js').includes("case 'centroid3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

/**
 * 3D 四面体双球与欧拉不等式命令（euler3d · D41）无头回归。
 *
 * 覆盖：euler3DGeometry / euler3DInequalityText / resolveEuler3D 纯函数
 *       （正四面体等号、直角三棱锥与一般四面体 R≥3r、Grace–Danielsson 余量、
 *        顶点到外心等距、内心到四切点等距、双球各三正交大圆、采样点恒在球面、
 *        标架正交、十项输出开关组合、样式、id 避让与 64 字符边界、
 *        共面/重合/面退化拒绝、脏输入原子拒绝、线段上限、深度只读）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失/抛错降级、api 部分失败、
 *       2D 隔离、历史契约长度）、协议两侧一致性、3D 意图分支、
 *       协作铁律与硬约束静态复核（共享文件纯追加 / 旧 appId 路径未动）。
 *
 * 运行：node tests/board3d_euler.mjs
 */
import {
  BOARD3D_EULER_PROMPT, BOARD3D_EULER_PROMPT_OPS, isEuler3DIntent,
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
  BOARD3D_EULER_OPS, BOARD3D_COMPLETE32_OPS,
} from '../js/board3d-executor.js';
import {
  EULER3D_SEGMENTS_MIN, EULER3D_SEGMENTS_MAX, EULER3D_SEGMENTS_DEFAULT,
  EULER3D_VERTEX_SIZE_MIN, EULER3D_VERTEX_SIZE_MAX, EULER3D_VERTEX_SIZE_DEFAULT,
  EULER3D_MAX_SEGMENTS, EULER3D_DEFAULT_POINTS, EULER3D_DEFAULT_AXIS,
  num, euler3DGeometry, euler3DInequalityText, resolveEuler3D,
} from '../js/board3d-euler.js';
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

const REG = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; // 正四面体：O=I=原点、R=√3、r=1/√3，等号
const RIGHT = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]];      // 直角三棱锥：I=[r,r,r]、O=[1,1,1]、d=1
const SKEW = [[0, 0, 0], [3, 0, 0], [1, 4, 0], [1, 1, 5]];       // 一般四面体：R/r≈3.66、余量 >0

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
assert(BOARD3D_EULER_OPS.length === 1 && BOARD3D_EULER_OPS[0] === 'euler3d' && BOARD3D_COMPLETE32_OPS.length === 41 && BOARD3D_COMPLETE32_OPS.includes('euler3d'), 'EULER 1 / COMPLETE32 41 且含 euler3d');
assert(!BOARD3D_OPS.includes('euler3d') && !BOARD3D_ALL_OPS.includes('euler3d') && !BOARD3D_COMPLETE31_OPS.includes('euler3d'), 'euler3d 未并入历史契约常量');
assert(EULER3D_SEGMENTS_MIN === 8 && EULER3D_SEGMENTS_MAX === 512 && EULER3D_SEGMENTS_DEFAULT === 48, '大圆段数常量与 D39/D40 同口径');
assert(EULER3D_VERTEX_SIZE_MIN === 0.01 && EULER3D_VERTEX_SIZE_MAX === 1 && EULER3D_VERTEX_SIZE_DEFAULT === 0.1, '小球半径常量');
assert(EULER3D_MAX_SEGMENTS === 4096 && EULER3D_DEFAULT_POINTS.length === 4 && vecApprox(EULER3D_DEFAULT_AXIS, [0, 0, 1]), '段数上限 / 默认四点 / 默认轴');
assert(num('2.5') === 2.5 && num(' 3 ') === 3 && num('') === null && num(NaN) === null && num(Infinity) === null && num(null) === null, 'num 严格取有限数');

section('二、综合几何：双球、球心距与欧拉不等式');
{
  const g = euler3DGeometry(REG);
  assert(g && g.holds, '正四面体综合求解成功');
  assert(vecApprox(g.O, [0, 0, 0], 1e-6) && vecApprox(g.I, [0, 0, 0], 1e-6), '正四面体外心与内心重合原点');
  assert(approx(g.R, Math.sqrt(3), 1e-6) && approx(g.r, 1 / Math.sqrt(3), 1e-6), '正四面体 R=√3、r=1/√3');
  assert(approx(g.ratio, 3, 1e-6) && approx(g.d, 0, 1e-6), '正四面体 R/r=3、d=0 取等号');
  assert(approx(g.margin, 0, 1e-6), 'Grace–Danielsson 余量为 0');
  assert(g.vertexDistances.every((v) => approx(v, g.R, 1e-6)), '四顶点到外心等距');
  assert(g.radiusChecks.every((v) => approx(v, g.r, 1e-6)), '内心到四切点等距');
  assert(g.tangents.length === 4 && g.faces.length === 4, '四切面与四切点');
  assert(approx(g.volume, 8 / 3, 1e-6), '正四面体体积 8/3');
}
{
  const g = euler3DGeometry(RIGHT);
  assert(g && g.holds, '直角三棱锥综合求解成功');
  assert(vecApprox(g.O, [1, 1, 1], 1e-6) && approx(g.R, Math.sqrt(3), 1e-6), '直角三棱锥外心与 R');
  assert(approx(g.r, 4 / (6 + 2 * Math.sqrt(3)), 1e-6), '直角三棱锥 r=4/(6+2√3)');
  assert(vecApprox(g.I, [g.r, g.r, g.r], 1e-6), '直角三棱锥内心 [r,r,r]');
  assert(approx(g.d, 1, 1e-6) && g.ratio > 3, 'd=1 且 R/r>3');
  assert(g.margin >= -1e-9 && approx(g.margin, 0, 1e-6), '直角三棱锥强化式等号');
}
{
  const g = euler3DGeometry(SKEW);
  assert(g && g.holds && g.ratio > 3 && g.margin > 0, '一般四面体不等式严格成立');
  assert(g.vertexDistances.every((v) => approx(v, g.R, 1e-6)), '一般四面体四顶点到外心等距');
  assert(g.radiusChecks.every((v) => approx(v, g.r, 1e-6)), '一般四面体内心到四切点等距');
}
assert(euler3DGeometry([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]) === null, '共线/共面四点拒绝');
assert(euler3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]) === null, '同平面四点拒绝');
assert(euler3DGeometry([[0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1]]) === null, '重合点拒绝');
assert(euler3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1, 0], [Infinity, 0, 1]]) === null, '非法数值拒绝');
assert(euler3DGeometry([[0, 0, 0], [1, 0, 0], [0, 1]]) === null, '点数不足拒绝');
assert(euler3DGeometry(null) === null, '空入参拒绝');
assert(euler3DInequalityText(3).includes('等号成立'), '等号文本');
assert(euler3DInequalityText(4.098).includes('R/r=4.098') && !euler3DInequalityText(4.098).includes('等号'), '非等号文本');
assert(euler3DInequalityText(NaN) === 'R≥3r', '非法 ratio 回退文本');

section('三、命令解析：图元、开关、样式与守恒');
{
  const res = resolveEuler3D({ op: 'euler3d' });
  assert(res.ok, '默认命令成功');
  const m = res.meta;
  assert(m.itemCount === res.items.length && m.segmentCount === 6 * 48 + 6 + 1, '默认 6 大圆×48 + 6 棱 + 1 球心连线');
  assert(m.circumCircleCount === 3 && m.inCircleCount === 3 && m.edgeCount === 6 && m.centerSegmentCount === 1, '两球各三正交大圆 / 六棱 / OI');
  assert(m.labelCount === 6 && m.pointCount === 0 && m.radiusCount === 0, '默认六标注、无小球与半径线段');
  assert(m.asTetra && m.asCircum && m.asIn && m.asCenters && !m.asRadii && !m.asPoints, '默认输出开关');
  assert(res.items.every((it) => it.id && it.type && Array.isArray(it.pos)), '每项均有 id/type/pos');
  // 大圆采样点恒落在对应球面
  const cRing = [...m.circumEquator, ...m.circumMeridian1, ...m.circumMeridian2];
  const iRing = [...m.inEquator, ...m.inMeridian1, ...m.inMeridian2];
  assert(cRing.length === 144 && iRing.length === 144, '两球各 144 个采样点');
  assert(cRing.every((p) => approx(norm(sub(p, m.center)), m.radius, 8e-3)), '外接球采样点到 O 距离恒为 R');
  assert(iRing.every((p) => approx(norm(sub(p, m.incenter)), m.inradius, 8e-3)), '内切球采样点到 I 距离恒为 r');
  assert(vecApprox(m.n, [0, 0, 1]) && approx(dot(m.u, m.v), 0, 3e-3) && approx(norm(m.u), 1, 3e-3) && approx(norm(m.v), 1, 3e-3), '外接球标架单位正交');
  assert(vecApprox(m.inN, [0, 0, 1]) && approx(dot(m.inU, m.inV), 0, 3e-3), '内切球标架单位正交');
  assert(m.points.every((p, i) => approx(norm(sub(p, m.center)), m.radius, 8e-3)), '输出顶点到外心等距');
  assert(m.tangents.every((t) => approx(norm(sub(t, m.incenter)), m.inradius, 8e-3)), '输出切点到内心等距');
  assert(m.vertexDistances.every((v) => approx(v, m.radius, 8e-3)) && m.radiusChecks.every((v) => approx(v, m.inradius, 8e-3)), 'meta 守恒读数');
  assert(m.holds === true && m.ratio === 3 && m.margin === 0 && m.inequalityText.includes('等号成立'), 'meta 不等式读数');
  assert(res.items.some((it) => it.type === 'label' && it.text.includes('R≥3r')), '不等式结论标注落地');
  assert(res.items.some((it) => it.type === 'label' && it.text === 'd=0'), '球心距读数标注落地');
}
{
  const res = resolveEuler3D({ op: 'euler3d', points: RIGHT, asRadii: true, asPoints: true, labelCenters: false, labelRadii: false, labelDistance: false, labelInequality: false, segments: 8 });
  assert(res.ok, '全开扩展开关成功');
  assert(res.meta.radiusCount === 8 && res.meta.pointCount === 10 && res.meta.labelCount === 0, '8 半径线段 / 10 小球 / 0 标注');
  assert(res.meta.segmentCount === 6 * 8 + 6 + 1 + 8, '扩展线段数');
  assert(res.meta.centerDistance === 1 && res.meta.incenter.every((v) => approx(v, res.meta.inradius, 8e-3)), '直角三棱锥读数回传');
}
{
  const res = resolveEuler3D({ op: 'euler3d', asTetra: false, asCircum: false, asIn: false, asCenters: false, asRadii: false, asPoints: true, labelCenters: false, labelRadii: false, labelDistance: false, labelInequality: false });
  assert(res.ok && res.meta.segmentCount === 0 && res.meta.pointCount === 10 && res.items.length === 10, '仅小球模式合法');
}
{
  const res = resolveEuler3D({ op: 'euler3d', axis: 'x', segments: 96, points: SKEW });
  assert(res.ok && vecApprox(res.meta.n, [1, 0, 0]) && res.meta.segments === 96 && res.meta.margin > 0, 'x 轴取向 / 加密采样 / 一般四面体');
  const res2 = resolveEuler3D({ op: 'euler3d', axis: [0, 2, 0], color: '#abc', circumColor: '#123456', inColor: '#DEF', centerColor: '#f0a', labelColor: '#0099ff', opacity: 0.4, vertexSize: 0.2 });
  assert(res2.ok && res2.meta.color === '#abc' && res2.meta.circumColor === '#123456' && res2.meta.inColor === '#DEF' && res2.meta.centerColor === '#f0a' && res2.meta.labelColor === '#0099ff' && res2.meta.opacity === 0.4 && res2.meta.vertexSize === 0.2, '样式参数与简写色值');
  assert(vecApprox(res2.meta.axis, [0, 1, 0]) && res2.items.every((it) => it.opacity === 0.4 || it.type === 'label'), '轴向归一与透明度');
}
{
  const st = { objects: [{ id: 'eul_e0' }, { id: 'eul_ceq_0' }, { id: 'eul_oi' }] };
  const res = resolveEuler3D({ op: 'euler3d', segments: 8 }, st);
  assert(res.ok && !res.items.some((it) => ['eul_e0', 'eul_ceq_0', 'eul_oi'].includes(it.id)), '场景已有 id 全部避让');
  assert(res.items.some((it) => it.id === 'eul_e0_2') && res.items.some((it) => it.id === 'eul_ceq_0_2'), '冲突 id 自动加序号');
  const longId = 'x'.repeat(64);
  const r2 = resolveEuler3D({ op: 'euler3d', id: longId, segments: 8 });
  assert(r2.ok && r2.items.every((it) => it.id.length <= 64), '64 字符 id 边界不超长');
  assert(resolveEuler3D({ op: 'euler3d', id: 'bad id' }).ok === false, '含空格 id 拒绝');
  assert(resolveEuler3D({ op: 'euler3d' }, null).ok, 'state 为 null 仍可产出');
}

section('四、脏输入原子拒绝与深度只读');
const bad = [
  { cmd: null, name: '命令为空' },
  { cmd: [], name: '命令为数组' },
  { cmd: { op: 'euler3d', points: null }, name: 'points 为 null' },
  { cmd: { op: 'euler3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] }, name: '四点共面' },
  { cmd: { op: 'euler3d', axis: 'w' }, name: 'axis 非法' },
  { cmd: { op: 'euler3d', axis: [0, 0, 0] }, name: '零向量轴' },
  { cmd: { op: 'euler3d', segments: 7 }, name: 'segments 过小' },
  { cmd: { op: 'euler3d', segments: 513 }, name: 'segments 过大' },
  { cmd: { op: 'euler3d', segments: 8.5 }, name: 'segments 非整数' },
  { cmd: { op: 'euler3d', segments: 'abc' }, name: 'segments 非数值' },
  { cmd: { op: 'euler3d', vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { op: 'euler3d', vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { op: 'euler3d', asTetra: 'true' }, name: '开关非布尔' },
  { cmd: { op: 'euler3d', asTetra: false, asCircum: false, asIn: false, asCenters: false, asRadii: false, asPoints: false }, name: '六输出开关全关' },
  { cmd: { op: 'euler3d', opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { op: 'euler3d', color: 123 }, name: '颜色非字符串' },
  { cmd: { op: 'euler3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 'oops']] }, name: '坐标非数值' },
  { cmd: { op: 'euler3d', id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveEuler3D(b.cmd).ok === false, `拒绝：${b.name}`);
assert(resolveEuler3D({ op: 'euler3d', segments: 512 }).ok === true, 'segments=512 默认输出共 3079 段，在限内');
// 真正触发上限：两球 + 全部棱/球心/半径，segments=512 → 6*512+15 = 3087（仍限内）
// 上限由常量守护，以下断言仅验证常量存在且不误伤默认命令
assert(EULER3D_MAX_SEGMENTS > 6 * EULER3D_SEGMENTS_MAX, '段数上限高于合法最大大圆总量');
{
  const cmd0 = { op: 'euler3d', points: SKEW.map((p) => p.slice()), labelCenters: true };
  const st0 = { objects: [{ id: 'eul_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveEuler3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('五、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'euler3d', points: RIGHT, segments: 8 }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 61, '逐项落地到画板（55 段 + 6 标注）');
  assert(res[0].meta.centerDistance === 1 && res[0].meta.ratio > 3 && res[0].meta.holds, 'meta 不等式读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'euler3d', segments: 8 },
    { op: 'euler3d', segments: 8 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'euler3d', segments: 8 }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'euler3d', segments: 8 }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'euler3d', segments: 8 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'euler3d', points: null }, { op: 'euler3d', segments: 8 }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'euler3d', segments: 8 }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，euler3d 正常');
}

section('六、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_EULER_PROMPT.includes('"op":"euler3d"') && BOARD3D_EULER_PROMPT.includes('R≥3r') && BOARD3D_EULER_PROMPT.includes('d²≤(R+r)(R−3r)'), '提示词含命令格式与不等式守恒');
assert(BOARD3D_EULER_PROMPT_OPS.length === 1 && BOARD3D_EULER_PROMPT_OPS[0] === 'euler3d', '提示词 ops 一致');
assert(isEuler3DIntent('四面体的欧拉不等式') && isEuler3DIntent('画三棱锥的外接球和内切球'), '立体专属词识别');
assert(isEuler3DIntent('空间四点的外接球与内切球距离') && isEuler3DIntent('R≥3r 验证'), '强度量与球心距识别');
assert(!isEuler3DIntent('三角形的欧拉线') && !isEuler3DIntent('画三角形内切圆') && !isEuler3DIntent('圆的外接圆'), '2D 欧拉线/内外心不误切');
assert(!isEuler3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '验证四面体欧拉不等式') === '3d', 'detect3d + 欧拉不等式意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画三角形欧拉线') === '2d', 'detect3d + 2D 欧拉线仍 2D');
assert(resolveBoardMode({ message: '画欧拉不等式' }, '画欧拉不等式') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_EULER_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isEuler3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("eu.op !== 'euler3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('euler3d 给四个不共面点'), '画板面板工具说明已追加');

section('七、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_EULER_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_INSPHERE_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'insphere3d'") && read('js/board3d-executor.js').includes("case 'euler3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

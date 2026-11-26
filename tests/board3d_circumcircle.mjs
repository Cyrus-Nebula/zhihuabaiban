/**
 * 3D 空间不共线三点定圆命令（circumcircle3d · D45）无头回归。
 *
 * 覆盖：circumcircleGeometry / num / parseCirclePoint / resolveCircumcircle3D 纯函数
 *       （默认正三角形圆心原点 R=1、xy 直角三角形圆心=斜边中点 R=√2、竖直/倾斜平面、
 *        平移圆、三点到圆心等距、采样点共面且恒距 O 为 R、R=abc/(4S) 二阶校验、
 *        正交标架单位两两正交、开关组合 / 法向示意 / 小球 / 标注 / 样式 / 数字字符串 /
 *        id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_circumcircle.mjs
 */
import {
  BOARD3D_CIRCUMCIRCLE_PROMPT, BOARD3D_CIRCUMCIRCLE_PROMPT_OPS,
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
  BOARD3D_LINEPLANE_OPS, BOARD3D_COMPLETE24_OPS,
  BOARD3D_POINT_PLANE_OPS, BOARD3D_COMPLETE25_OPS,
  BOARD3D_SKEWLINE_OPS, BOARD3D_COMPLETE26_OPS,
  BOARD3D_LINE_ANGLE_OPS, BOARD3D_COMPLETE27_OPS,
  BOARD3D_POINT_LINE_OPS, BOARD3D_COMPLETE28_OPS,
  BOARD3D_RELATION_OPS, BOARD3D_COMPLETE29_OPS,
  BOARD3D_CIRCUMSPHERE_OPS, BOARD3D_COMPLETE30_OPS,
  BOARD3D_INSPHERE_OPS, BOARD3D_COMPLETE31_OPS,
  BOARD3D_EULER_OPS, BOARD3D_COMPLETE32_OPS,
  BOARD3D_CENTROID_OPS, BOARD3D_COMPLETE33_OPS,
  BOARD3D_SOLIDMETRICS_OPS, BOARD3D_COMPLETE34_OPS,
  BOARD3D_SECTIONSPHERE_OPS, BOARD3D_COMPLETE35_OPS,
  BOARD3D_CIRCUMCIRCLE_OPS, BOARD3D_COMPLETE36_OPS,
} from '../js/board3d-executor.js';
import {
  CIRCUMCIRCLE3D_SEGMENTS_MIN, CIRCUMCIRCLE3D_SEGMENTS_MAX, CIRCUMCIRCLE3D_SEGMENTS_DEFAULT,
  CIRCUMCIRCLE3D_VERTEX_SIZE_MIN, CIRCUMCIRCLE3D_VERTEX_SIZE_MAX, CIRCUMCIRCLE3D_VERTEX_SIZE_DEFAULT,
  CIRCUMCIRCLE3D_NORMAL_LEN_MIN, CIRCUMCIRCLE3D_NORMAL_LEN_MAX, CIRCUMCIRCLE3D_NORMAL_LEN_DEFAULT,
  CIRCUMCIRCLE3D_MAX_SEGMENTS, CIRCUMCIRCLE3D_DEFAULT_POINTS,
  num, parseCirclePoint, circumcircleGeometry, resolveCircumcircle3D,
} from '../js/board3d-circumcircle.js';
import { isCircumcircle3DIntent } from '../ai/board-prompt.js';
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
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => mul(a, 1 / norm(a));

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
assert(BOARD3D_CIRCUMSPHERE_OPS.length === 1 && BOARD3D_COMPLETE30_OPS.length === 39 && BOARD3D_INSPHERE_OPS.length === 1 && BOARD3D_COMPLETE31_OPS.length === 40, 'COMPLETE30 39 / COMPLETE31 40');
assert(BOARD3D_EULER_OPS.length === 1 && BOARD3D_COMPLETE32_OPS.length === 41 && BOARD3D_CENTROID_OPS.length === 1 && BOARD3D_COMPLETE33_OPS.length === 42, 'COMPLETE32 41 / COMPLETE33 42');
assert(BOARD3D_SOLIDMETRICS_OPS.length === 1 && BOARD3D_COMPLETE34_OPS.length === 43 && BOARD3D_SECTIONSPHERE_OPS.length === 1 && BOARD3D_COMPLETE35_OPS.length === 44, 'COMPLETE34 43 / COMPLETE35 44');
assert(BOARD3D_CIRCUMCIRCLE_OPS.length === 1 && BOARD3D_CIRCUMCIRCLE_OPS[0] === 'circumcircle3d' && BOARD3D_COMPLETE36_OPS.length === 45, 'D45 OPS 1 / COMPLETE36 45');
assert(Object.isFrozen(BOARD3D_CIRCUMCIRCLE_OPS) && Object.isFrozen(BOARD3D_COMPLETE36_OPS), 'D45 常量冻结');
assert(BOARD3D_COMPLETE36_OPS.includes('circumcircle3d') && BOARD3D_COMPLETE36_OPS.includes('sectionsphere3d') && BOARD3D_COMPLETE36_OPS.includes('solidmetrics3d'), 'COMPLETE36 含新旧全部命令');
assert(CIRCUMCIRCLE3D_SEGMENTS_MIN === 8 && CIRCUMCIRCLE3D_SEGMENTS_MAX === 512 && CIRCUMCIRCLE3D_SEGMENTS_DEFAULT === 64, '段数常量');
assert(CIRCUMCIRCLE3D_VERTEX_SIZE_MIN === 0.01 && CIRCUMCIRCLE3D_VERTEX_SIZE_MAX === 1 && CIRCUMCIRCLE3D_VERTEX_SIZE_DEFAULT === 0.1, '小球常量');
assert(CIRCUMCIRCLE3D_NORMAL_LEN_MIN === 0.01 && CIRCUMCIRCLE3D_NORMAL_LEN_MAX === 10 && CIRCUMCIRCLE3D_NORMAL_LEN_DEFAULT === 1, '法向长度常量');
assert(CIRCUMCIRCLE3D_MAX_SEGMENTS === 2048 && CIRCUMCIRCLE3D_DEFAULT_POINTS.length === 3 && Object.isFrozen(CIRCUMCIRCLE3D_DEFAULT_POINTS), '上限与默认点冻结');

section('二、数值/点解析');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 1e2 ') === 100, 'num 数字与数字字符串');
assert(num('') === null && num('  ') === null && num('abc') === null && num(null) === null && num(NaN) === null && num(Infinity) === null, 'num 脏输入拒绝');
assert(vecApprox(parseCirclePoint([1, 2, 3]), [1, 2, 3]) && vecApprox(parseCirclePoint(['1', '2', '3']), [1, 2, 3]), '点解析含数字字符串');
assert(parseCirclePoint([1, 2]) === null && parseCirclePoint([1, 2, 3, 4]) === null && parseCirclePoint('x') === null && parseCirclePoint([1, 'x', 3]) === null, '点解析脏输入拒绝');

section('三、几何解（circumcircleGeometry）');
{
  const g = circumcircleGeometry({});
  assert(g.ok && vecApprox(g.O, [0, 0, 0]) && approx(g.R, 1), '默认正三角形：圆心原点、R=1');
  assert(approx(g.R2, 1) && approx(g.R, g.R2, 1e-9), '默认二阶交叉校验一致');
  assert(vecApprox(g.n, [0, 0, 1]) && approx(norm(g.u), 1) && approx(norm(g.v), 1), '默认法向与标架单位');
  assert(approx(dot(g.u, g.v), 0, 1e-6) && approx(dot(g.u, g.n), 0, 1e-6) && approx(dot(g.v, g.n), 0, 1e-6), '标架两两正交');
}
{
  const g = circumcircleGeometry({ points: [[0, 0, 0], [2, 0, 0], [0, 2, 0]] });
  assert(g.ok && vecApprox(g.O, [1, 1, 0]) && approx(g.R, Math.SQRT2), 'xy 直角三角形：圆心=斜边中点 (1,1,0)、R=√2');
  assert(approx(g.area, 2) && approx(g.R2, Math.SQRT2), '直角三角形面积 2 与 R2 校验');
  for (const p of g.P) assert(approx(norm(sub(p, g.O)), g.R, 1e-6), '直角三角形三点到圆心等距');
}
{
  const g = circumcircleGeometry({ points: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  assert(g.ok && vecApprox(g.O, [1 / 3, 1 / 3, 1 / 3]) && approx(g.R, Math.sqrt(6) / 3, 1e-3), '竖直/倾斜平面三点：圆心 (1/3,1/3,1/3)、R=√6/3');
  assert(vecApprox(g.n, unit([1, 1, 1]), 1e-3), '倾斜平面法向 (1,1,1)');
}
{
  const g = circumcircleGeometry({ points: [[5, 1, 0], [3, 1, 2], [3, 1, -2]] });
  assert(g.ok && vecApprox(g.O, [3, 1, 0]) && approx(g.R, 2), '平移圆：圆心 (3,1,0)、R=2');
  assert(vecApprox(g.n, [0, -1, 0], 1e-3) || vecApprox(g.n, [0, 1, 0], 1e-3), '平移圆法向沿 y 轴');
}
{
  const g = circumcircleGeometry({ points: [[1, '0', 0], ['-0.5', 0.8660254, 0], [-0.5, -0.8660254, 0]] });
  assert(g.ok && approx(g.R, 1, 1e-3), '数字字符串三点同样定圆');
}
assert(circumcircleGeometry(null) === null && circumcircleGeometry([]) === null, '几何解空入参拒绝');
const badGeo = [
  { points: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], name: '共线' },
  { points: [[0, 0, 0], [0, 0, 0], [1, 2, 3]], name: '两点重合' },
  { points: [[0, 0, 0], [1, 0, 0], [2, 1e-9, 0]], name: '病态近共线' },
  { points: [[0, 0], [1, 0, 0], [0, 1, 0]], name: '点非三元组' },
  { points: [[0, 0, 0], [1, 0, 0]], name: '仅两点' },
  { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 1]], name: '四点' },
];
for (const b of badGeo) assert(circumcircleGeometry(b).ok === false, `几何解拒绝：${b.name}`);

section('四、resolveCircumcircle3D 输出与守恒');
{
  const r = resolveCircumcircle3D({}, {});
  assert(r.ok && r.items.length === 75, '默认输出：3 边 + 64 圆段 + 3 半径 + 5 标注 = 75 项');
  assert(r.meta.segmentCount === 70 && r.meta.labelCount === 5 && r.meta.pointCount === 0, '默认 meta 计数');
  assert(approx(r.meta.radius, 1) && vecApprox(r.meta.center, [0, 0, 0]), '默认 meta 圆心/半径');
  assert(r.meta.radiusMaxDev < 0.01 && r.meta.planarMaxDev < 0.01 && r.meta.vertexMaxDev < 0.01, '默认守恒读数近零');
  const lines = r.items.filter((it) => it.type === 'line');
  const labels = r.items.filter((it) => it.type === 'label');
  assert(lines.length === 70 && labels.length === 5, 'item 类型计数');
  // 圆采样点恒共面且恒距圆心为 R
  const O = r.meta.center;
  const n = r.meta.normal;
  let maxR = 0, maxPlane = 0;
  const circleLines = lines.slice(3, 3 + 64);
  for (const ln of circleLines) {
    const q = [ln.p.x1, ln.p.y1, ln.p.z1];
    maxR = Math.max(maxR, Math.abs(norm(sub(q, O)) - 1));
    maxPlane = Math.max(maxPlane, Math.abs(dot(sub(q, O), n)));
  }
  assert(maxR < 0.01 && maxPlane < 0.01, '圆采样点恒距 O 为 R 且恒在圆平面内');
}
{
  const r = resolveCircumcircle3D({ points: [[0, 0, 0], [2, 0, 0], [0, 2, 0]], segments: 8, asNormal: true, asPoints: true, labelNormal: true }, {});
  assert(r.ok && r.meta.segmentCount === 15 && r.meta.pointCount === 12 && r.meta.labelCount === 6, '全开：15 线 + 12 小球 + 6 标注');
  assert(approx(r.meta.radius, Math.SQRT2) && approx(r.meta.normalLen, 1), '全开 meta 半径/法向长度');
  const nLine = r.items.find((it) => it.id === 'cc_n');
  assert(nLine && nLine.type === 'line', '法向示意线段落地');
  assert(vecApprox(r.meta.center, [1, 1, 0]), '直角三角形圆心回读');
}
{
  const r = resolveCircumcircle3D({ segments: 8, asTriangle: false, asCircle: false, asRadii: true }, {});
  assert(r.ok && r.meta.segmentCount === 3, '只开半径：3 段');
}
{
  const r = resolveCircumcircle3D({ segments: 8, color: '#123456', radiusColor: '#abcdef', normalColor: '#010203', labelColor: '#fedcba', opacity: 0.5, vertexSize: 0.2, normalLen: 2 }, {});
  assert(r.meta.color === '#123456' && r.meta.radiusColor === '#abcdef' && r.meta.normalColor === '#010203' && r.meta.labelColor === '#fedcba', '样式生效');
  assert(approx(r.meta.opacity, 0.5) && approx(r.meta.vertexSize, 0.2) && approx(r.meta.normalLen, 2), '数值样式生效');
}
{
  const r = resolveCircumcircle3D({ segments: '16', normalLen: '1.5', vertexSize: '0.2', points: [['1', '0', 0], ['-0.5', '0.8660254', 0], [-0.5, -0.8660254, 0]] }, {});
  assert(r.ok && r.meta.segments === 16 && approx(r.meta.radius, 1, 1e-3), '数字字符串参数同样生效');
}
{
  const r = resolveCircumcircle3D({ id: 'cc', segments: 8 }, { objects: [{ id: 'cc_tri0', type: 'line' }, { id: 'cc_tri0_2', type: 'line' }] });
  assert(r.ok && r.items[0].id === 'cc_tri0_3', 'id 冲突自动避让到第 3 后缀');
  const r2 = resolveCircumcircle3D({ id: 'X'.repeat(64), segments: 8 }, { objects: [{ id: 'X'.repeat(64) }] });
  assert(r2.ok && r2.items.every((it) => it.id.length <= 64), '64 字符长 id 不死循环、不越界');
  assert(resolveCircumcircle3D({ id: '@bad' }).ok === false, '非法 id 拒绝');
}

section('五、脏输入原子拒绝');
const bad = [
  { cmd: null, name: '命令 null' },
  { cmd: [], name: '命令数组' },
  { cmd: 'x', name: '命令字符串' },
  { cmd: { points: 5 }, name: 'points 非数组' },
  { cmd: { points: [[0, 0, 0], [1, 1, 1], [2, 2, 2]] }, name: '三点共线' },
  { cmd: { points: [[0, 0, 0], [0, 0, 0], [1, 2, 3]] }, name: '两点重合' },
  { cmd: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 'x']] }, name: '点含非数值' },
  { cmd: { points: [[0, 0, 0], [1, 0, 0], [0, 1, Infinity]] }, name: '点含 Infinity' },
  { cmd: { segments: 7 }, name: 'segments 过小' },
  { cmd: { segments: 513 }, name: 'segments 过大' },
  { cmd: { segments: 8.5 }, name: 'segments 非整数' },
  { cmd: { segments: 'abc' }, name: 'segments 非数值' },
  { cmd: { normalLen: 0 }, name: 'normalLen 过小' },
  { cmd: { normalLen: 11 }, name: 'normalLen 过大' },
  { cmd: { vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { asCircle: 'true' }, name: '开关非布尔' },
  { cmd: { asTriangle: false, asCircle: false, asRadii: false }, name: '三线框开关全关' },
  { cmd: { opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { color: 123 }, name: '颜色非字符串' },
  { cmd: { id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveCircumcircle3D(b.cmd).ok === false, `拒绝：${b.name}`);
{
  const cmd0 = { op: 'circumcircle3d', points: [[0, 0, 0], [2, 0, 0], [0, 2, 0]], asPoints: true };
  const st0 = { objects: [{ id: 'cc3d_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveCircumcircle3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('六、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'circumcircle3d', segments: 8 }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 19, '逐项落地（3 边 + 8 圆段 + 3 半径 + 5 标注 = 19）');
  assert(approx(res[0].meta.radius, 1) && vecApprox(res[0].meta.center, [0, 0, 0], 1e-3), 'meta 读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'circumcircle3d', segments: 8 },
    { op: 'circumcircle3d', segments: 8 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'circumcircle3d', segments: 8 }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'circumcircle3d', segments: 8 }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'circumcircle3d', segments: 8 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'circumcircle3d', points: [[0, 0, 0], [1, 1, 1], [2, 2, 2]] }, { op: 'circumcircle3d', segments: 8 }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'circumcircle3d', segments: 8 }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，circumcircle3d 正常');
}

section('七、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_CIRCUMCIRCLE_PROMPT.includes('"op":"circumcircle3d"') && BOARD3D_CIRCUMCIRCLE_PROMPT.includes('R=abc/(4S)') && BOARD3D_CIRCUMCIRCLE_PROMPT.includes('三点定圆'), '提示词含命令格式与守恒关系');
assert(BOARD3D_CIRCUMCIRCLE_PROMPT_OPS.length === 1 && BOARD3D_CIRCUMCIRCLE_PROMPT_OPS[0] === 'circumcircle3d', '提示词 ops 一致');
assert(isCircumcircle3DIntent('空间三点定圆，求圆心和半径') && isCircumcircle3DIntent('倾斜平面三点外接圆'), '立体专属词识别（前置）');
assert(isCircumcircle3DIntent('过不共线三点的空间圆') && isCircumcircle3DIntent('三维不共线三点定圆'), '立体专属词识别（追加）');
assert(!isCircumcircle3DIntent('画一个三角形的外接圆') && !isCircumcircle3DIntent('不共线三点确定一个平面圆'), '2D 平面外接圆不误切');
assert(!isCircumcircle3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '空间三点定圆') === '3d', 'detect3d + 定圆意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画一个三角形的外接圆') === '2d', 'detect3d + 2D 外接圆仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_CIRCUMCIRCLE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isCircumcircle3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("cc.op !== 'circumcircle3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('circumcircle3d 给三个不共线空间点'), '画板面板工具说明已追加');

section('八、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_CIRCUMCIRCLE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SECTIONSPHERE_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'sectionsphere3d'") && read('js/board3d-executor.js').includes("case 'circumcircle3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

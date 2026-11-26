/**
 * 3D 正多面体内外接球 / 棱长 / 欧拉公式命令（solidmetrics3d · D43）无头回归。
 *
 * 覆盖：solidmetricsFaces / solidmetrics3DGeometry / resolveSolidmetrics3D 纯函数
 *       （五种柏拉图立体拓扑与欧拉守恒、棱长/R/r 等距、面环序、双球大圆、
 *        八项输出开关、样式、id 避让与 64 字符边界、脏输入原子拒绝、深度只读）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失/抛错降级、api 部分失败、2D 隔离、
 *       历史契约长度）、协议两侧一致性、3D 意图分支（2D 正多边形外接圆不误切）、
 *       协作铁律与硬约束静态复核（共享文件纯追加 / 旧 appId 路径未动）。
 *
 * 运行：node tests/board3d_solidmetrics.mjs
 */
import {
  BOARD3D_SOLIDMETRICS_PROMPT, BOARD3D_SOLIDMETRICS_PROMPT_OPS, isSolidmetrics3DIntent,
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
  BOARD3D_SOLIDMETRICS_OPS, BOARD3D_COMPLETE34_OPS,
} from '../js/board3d-executor.js';
import {
  SOLIDMETRICS3D_FACE_SIDES, SOLIDMETRICS3D_KINDS, SOLIDMETRICS3D_NAMES,
  SOLIDMETRICS3D_RADIUS_MIN, SOLIDMETRICS3D_RADIUS_MAX, SOLIDMETRICS3D_RADIUS_DEFAULT,
  SOLIDMETRICS3D_VERTEX_SIZE_MIN, SOLIDMETRICS3D_VERTEX_SIZE_MAX, SOLIDMETRICS3D_VERTEX_SIZE_DEFAULT,
  SOLIDMETRICS3D_SEGMENTS_MIN, SOLIDMETRICS3D_SEGMENTS_MAX, SOLIDMETRICS3D_SEGMENTS_DEFAULT,
  SOLIDMETRICS3D_MAX_SEGMENTS, num, solidmetricsFaces, solidmetrics3DGeometry, resolveSolidmetrics3D,
} from '../js/board3d-solidmetrics.js';
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
const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join(',');

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
assert(BOARD3D_CENTROID_OPS.length === 1 && BOARD3D_COMPLETE33_OPS.length === 42, 'CENTROID 1 / COMPLETE33 42');
assert(BOARD3D_SOLIDMETRICS_OPS.length === 1 && BOARD3D_SOLIDMETRICS_OPS[0] === 'solidmetrics3d' && BOARD3D_COMPLETE34_OPS.length === 43 && BOARD3D_COMPLETE34_OPS.includes('solidmetrics3d'), 'SOLIDMETRICS 1 / COMPLETE34 43 且含 solidmetrics3d');
assert(!BOARD3D_OPS.includes('solidmetrics3d') && !BOARD3D_ALL_OPS.includes('solidmetrics3d') && !BOARD3D_COMPLETE33_OPS.includes('solidmetrics3d'), 'solidmetrics3d 未并入历史契约常量');
assert(SOLIDMETRICS3D_KINDS.length === 5 && SOLIDMETRICS3D_FACE_SIDES.tetra === 3 && SOLIDMETRICS3D_FACE_SIDES.cube === 4 && SOLIDMETRICS3D_FACE_SIDES.dodeca === 5, '五种立体与面边数表');
assert(SOLIDMETRICS3D_RADIUS_MIN === 0.01 && SOLIDMETRICS3D_RADIUS_MAX === 1000 && SOLIDMETRICS3D_RADIUS_DEFAULT === 1.5, '半径常量');
assert(SOLIDMETRICS3D_VERTEX_SIZE_MIN === 0.01 && SOLIDMETRICS3D_VERTEX_SIZE_MAX === 1 && SOLIDMETRICS3D_VERTEX_SIZE_DEFAULT === 0.1, '小球半径常量');
assert(SOLIDMETRICS3D_SEGMENTS_MIN === 8 && SOLIDMETRICS3D_SEGMENTS_MAX === 512 && SOLIDMETRICS3D_SEGMENTS_DEFAULT === 48, '采样段数常量');
assert(SOLIDMETRICS3D_MAX_SEGMENTS === 4096 && SOLIDMETRICS3D_MAX_SEGMENTS > 30 + 6 * 512, '段数上限高于合法最大线段总量');
assert(Object.keys(SOLIDMETRICS3D_NAMES).length === 5 && SOLIDMETRICS3D_NAMES.cube === '正方体', '中文名表');
assert(num('2.5') === 2.5 && num(' 3 ') === 3 && num('') === null && num(NaN) === null && num(Infinity) === null && num(null) === null, 'num 严格取有限数');

section('二、纯几何：五种正多面体拓扑、双球与欧拉守恒');
const TOPO = { tetra: [4, 6, 4], cube: [8, 12, 6], octa: [6, 12, 8], dodeca: [20, 30, 12], icosa: [12, 30, 20] };
// 对偶立体在同一外接半径下的 r/R 相同：cube/octa 同值，dodeca/icosa 同值。
const RATIOS = { tetra: 1 / 3, cube: 1 / Math.sqrt(3), octa: 1 / Math.sqrt(3), dodeca: 0.7946545, icosa: 0.7946545 };
for (const kind of SOLIDMETRICS3D_KINDS) {
  const g = solidmetrics3DGeometry(kind, [0, 0, 0], 2);
  assert(g && g.holds, `${kind} 综合求解成功`);
  assert(g.vertexCount === TOPO[kind][0] && g.edgeCount === TOPO[kind][1] && g.faceCount === TOPO[kind][2], `${kind} 顶点/棱/面数正确`);
  assert(g.euler === 2, `${kind} 欧拉示性数 χ=2`);
  assert(g.vertices.length === TOPO[kind][0] && g.edges.length === TOPO[kind][1] && g.faces.length === TOPO[kind][2], `${kind} 输出数组长度一致`);
  assert(g.circumRadii.every((v) => approx(v, 2, 1e-6)), `${kind} 所有顶点到中心等距 R=2`);
  assert(g.edgeLengths.every((v) => approx(v, g.edgeLength, 1e-6)), `${kind} 所有棱等长`);
  assert(g.inRadii.every((v) => approx(v, g.inRadius, 1e-6)), `${kind} 各面到中心等距 r`);
  assert(approx(g.inRadius / g.circumRadius, RATIOS[kind], 1e-4), `${kind} r/R 符合已知比值`);
  assert(g.circumRadius > g.inRadius && g.inRadius > 0 && g.edgeLength > 0, `${kind} 球半径大小关系`);
  assert(g.faceCenters.length === g.faceCount && g.faceCenters.every((q) => q.length === 3 && q.every(Number.isFinite)), `${kind} 面心数组`);
  // 每个面的相邻顶点对恰为一条棱
  const edgeSet = new Set(g.edges.map(([i, j]) => pairKey(i, j)));
  let ringOk = true;
  for (const f of g.faces) {
    if (f.length !== SOLIDMETRICS3D_FACE_SIDES[kind]) ringOk = false;
    for (let i = 0; i < f.length; i++) if (!edgeSet.has(pairKey(f[i], f[(i + 1) % f.length]))) ringOk = false;
  }
  assert(ringOk, `${kind} 面顶点按环序排列、相邻对均为棱`);
  // 平移到非原点中心，半径与欧拉守恒仍成立
  const shifted = solidmetrics3DGeometry(kind, [3, -2, 5], 1.5);
  assert(shifted && shifted.holds && approx(shifted.circumRadius, 1.5, 1e-6) && shifted.euler === 2, `${kind} 平移中心后守恒`);
  assert(shifted.vertices.every((v) => approx(v[0], 3 + (v[0] - 3), 1e-9)), `${kind} 顶点坐标有限`);
}
assert(solidmetrics3DGeometry('cube', [0, 0, 0], 2).inRadius > solidmetrics3DGeometry('tetra', [0, 0, 0], 2).inRadius, '同外接半径下正方体内切球大于正四面体');
assert(solidmetrics3DGeometry('icosa', [0, 0, 0], 2).inRadius > solidmetrics3DGeometry('dodeca', [0, 0, 0], 2).inRadius, '同外接半径下正二十面体内切球大于正十二面体');
{
  const faces = solidmetricsFaces([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 3);
  assert(faces.length === 4 && faces.every((f) => f.length === 3), 'solidmetricsFaces 正四面体四面');
}
assert(solidmetricsFaces(null, 3).length === 0 && solidmetricsFaces([[0, 0, 0]], 2).length === 0, 'solidmetricsFaces 脏输入返回空');
assert(solidmetrics3DGeometry('nope', [0, 0, 0], 2) === null, '未知 kind 拒绝');
assert(solidmetrics3DGeometry('cube', [0, 0, 0], 0) === null, '零半径拒绝');
assert(solidmetrics3DGeometry('cube', [0, 0, 0], Infinity) === null, '无穷半径拒绝');

section('三、命令解析：图元、开关、样式与守恒');
{
  const res = resolveSolidmetrics3D({ op: 'solidmetrics3d', segments: 12 });
  assert(res.ok, '默认命令成功');
  const m = res.meta;
  assert(m.kind === 'cube' && m.name === '正方体' && m.eulerText === 'V8−E12+F6=2', '默认正方体与欧拉读数');
  assert(m.segmentCount === 12 + 3 * 12 + 3 * 12 && m.itemCount === res.items.length, '默认 12 棱 + 72 大圆段 + 5 标注');
  assert(m.edgeCount === 12 && m.circumCircleCount === 3 && m.inCircleCount === 3 && m.labelCount === 5, '默认计数');
  assert(m.asEdges && m.asCircumcircle && m.asIncircle && !m.asVertices && !m.labelVertices && m.labelKind && m.labelRadii && m.labelEuler, '默认八开关');
  assert(res.items.every((it) => it.id && it.type && Array.isArray(it.pos)), '每项均有 id/type/pos');
  assert(res.items.filter((it) => it.type === 'line').length === m.segmentCount, '线段数与 meta 一致');
  assert(res.items.some((it) => it.type === 'label' && it.text === '正方体'), '立体名标注落地');
  assert(res.items.some((it) => it.type === 'label' && it.text.includes('V8−E12+F6=2')), '欧拉公式标注落地');
  assert(res.items.some((it) => it.type === 'label' && it.text.startsWith('R=')), 'R 读数标注落地');
  assert(approx(m.inRadius, 1.5 / Math.sqrt(3), 8e-3) && approx(m.edgeLength, Math.sqrt(3), 8e-3), 'meta R/r/a 读数');
  const lines = res.items.filter((it) => it.type === 'line');
  assert(lines.every((it) => Number.isFinite(it.p.x1) && Number.isFinite(it.p.y2) && Number.isFinite(it.p.z2)), '线段端点均为有限数');
  assert(lines.some((it) => approx(Math.hypot(it.p.x1 - it.p.x2, it.p.y1 - it.p.y2, it.p.z1 - it.p.z2), Math.sqrt(3), 8e-3)), '存在真实棱长线段');
}
{
  const res = resolveSolidmetrics3D({ op: 'solidmetrics3d', kind: '正二十面体', radius: '2', segments: 16, axis: 'x', asVertices: true, labelVertices: true, vertexSize: '0.2', color: '#abc', circumColor: '#123456', inColor: '#DEF', labelColor: '#f00', opacity: 0.4 });
  assert(res.ok, '中文别名与数字字符串成功');
  assert(res.meta.kind === 'icosa' && res.meta.name === '正二十面体' && approx(res.meta.radius, 2, 8e-3), '别名归一化与半径读数');
  assert(res.meta.pointCount === 12 && res.meta.labelCount === 1 + 12 + 3 + 1 && res.meta.segmentCount === 30 + 96, '全开计数');
  assert(res.items.filter((it) => it.type === 'point').every((it) => it.p.s === 0.2), '小球半径透传');
  assert(res.meta.color === '#abc' && res.meta.circumColor === '#123456' && res.meta.inColor === '#DEF' && res.meta.labelColor === '#f00' && res.meta.opacity === 0.4, '样式读数');
  assert(res.items.every((it) => it.opacity === 0.4 || it.type === 'label'), '透明度透传');
  const names = res.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(['A', 'B', 'K', 'L'].every((t) => names.includes(t)), 'A-L 顶点标注齐全');
  assert(vecApprox(res.meta.axis, [1, 0, 0], 1e-9), 'axis 归一化读数');
}
{
  const res = resolveSolidmetrics3D({ op: 'solidmetrics3d', asEdges: false, asCircumcircle: false, asIncircle: false, asVertices: true, labelKind: false, labelRadii: false, labelEuler: false });
  assert(res.ok && res.meta.segmentCount === 0 && res.meta.pointCount === 8 && res.items.length === 8, '仅小球模式合法');
}
{
  const res = resolveSolidmetrics3D({ op: 'solidmetrics3d', center: [3, -2, 5], radius: 1.5, segments: 8 });
  assert(res.ok && vecApprox(res.meta.center, [3, -2, 5], 8e-3), 'center 平移读数');
  assert(res.items.some((it) => it.type === 'label' && it.text.includes('V8−E12+F6=2')), '平移后欧拉标注仍在');
}
{
  const st = { objects: [{ id: 'sm3d_e0' }, { id: 'sm3d_oc0_0' }, { id: 'sm3d_lk' }] };
  const res = resolveSolidmetrics3D({ op: 'solidmetrics3d', segments: 8 }, st);
  assert(res.ok && !res.items.some((it) => ['sm3d_e0', 'sm3d_oc0_0', 'sm3d_lk'].includes(it.id)), '场景已有 id 全部避让');
  assert(res.items.some((it) => it.id === 'sm3d_e0_2') && res.items.some((it) => it.id === 'sm3d_lk_2'), '冲突 id 自动加序号');
  const longId = 'x'.repeat(64);
  const r2 = resolveSolidmetrics3D({ op: 'solidmetrics3d', id: longId, segments: 8 });
  assert(r2.ok && r2.items.every((it) => it.id.length <= 64), '64 字符 id 边界不超长');
  assert(resolveSolidmetrics3D({ op: 'solidmetrics3d', id: 'bad id' }).ok === false, '含空格 id 拒绝');
  assert(resolveSolidmetrics3D({ op: 'solidmetrics3d' }, null).ok, 'state 为 null 仍可产出');
}

section('四、脏输入原子拒绝与深度只读');
const bad = [
  { cmd: null, name: '命令为空' },
  { cmd: [], name: '命令为数组' },
  { cmd: { op: 'solidmetrics3d', kind: 'nope' }, name: 'kind 非法' },
  { cmd: { op: 'solidmetrics3d', kind: 123 }, name: 'kind 非字符串' },
  { cmd: { op: 'solidmetrics3d', center: [0, 0] }, name: 'center 长度不足' },
  { cmd: { op: 'solidmetrics3d', center: [0, 'oops', 0] }, name: 'center 非数值' },
  { cmd: { op: 'solidmetrics3d', radius: 0 }, name: 'radius 过小' },
  { cmd: { op: 'solidmetrics3d', radius: 1001 }, name: 'radius 过大' },
  { cmd: { op: 'solidmetrics3d', radius: 'abc' }, name: 'radius 非数值' },
  { cmd: { op: 'solidmetrics3d', axis: 'w' }, name: 'axis 非法字符串' },
  { cmd: { op: 'solidmetrics3d', axis: [0, 0, 0] }, name: 'axis 零向量' },
  { cmd: { op: 'solidmetrics3d', axis: [1, 2] }, name: 'axis 长度不足' },
  { cmd: { op: 'solidmetrics3d', segments: 7 }, name: 'segments 过小' },
  { cmd: { op: 'solidmetrics3d', segments: 513 }, name: 'segments 过大' },
  { cmd: { op: 'solidmetrics3d', segments: 8.5 }, name: 'segments 非整数' },
  { cmd: { op: 'solidmetrics3d', segments: 'abc' }, name: 'segments 非数值' },
  { cmd: { op: 'solidmetrics3d', vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { op: 'solidmetrics3d', vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { op: 'solidmetrics3d', vertexSize: 'abc' }, name: 'vertexSize 非数值' },
  { cmd: { op: 'solidmetrics3d', asEdges: 'true' }, name: '开关非布尔' },
  { cmd: { op: 'solidmetrics3d', asEdges: false, asCircumcircle: false, asIncircle: false, asVertices: false, labelVertices: false, labelKind: false, labelRadii: false, labelEuler: false }, name: '八输出开关全关' },
  { cmd: { op: 'solidmetrics3d', opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { op: 'solidmetrics3d', color: 123 }, name: '颜色非字符串' },
  { cmd: { op: 'solidmetrics3d', id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveSolidmetrics3D(b.cmd).ok === false, `拒绝：${b.name}`);
{
  const cmd0 = { op: 'solidmetrics3d', kind: 'icosa', center: [1, 2, 3], labelVertices: true };
  const st0 = { objects: [{ id: 'sm3d_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveSolidmetrics3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('五、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'solidmetrics3d', segments: 8 }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 12 + 3 * 8 + 3 * 8 + 5, '逐项落地到画板（12 棱 + 48 大圆段 + 5 标注）');
  assert(res[0].meta.eulerText === 'V8−E12+F6=2' && approx(res[0].meta.inRadius, 1.5 / Math.sqrt(3), 8e-3), 'meta 读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'solidmetrics3d', segments: 8 },
    { op: 'solidmetrics3d', segments: 8 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'solidmetrics3d', segments: 8 }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'solidmetrics3d', segments: 8 }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'solidmetrics3d', segments: 8 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'solidmetrics3d', kind: 'nope' }, { op: 'solidmetrics3d', segments: 8 }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'solidmetrics3d', segments: 8 }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，solidmetrics3d 正常');
}

section('六、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_SOLIDMETRICS_PROMPT.includes('"op":"solidmetrics3d"') && BOARD3D_SOLIDMETRICS_PROMPT.includes('V−E+F=2') && BOARD3D_SOLIDMETRICS_PROMPT.includes('内切球'), '提示词含命令格式与守恒关系');
assert(BOARD3D_SOLIDMETRICS_PROMPT_OPS.length === 1 && BOARD3D_SOLIDMETRICS_PROMPT_OPS[0] === 'solidmetrics3d', '提示词 ops 一致');
assert(isSolidmetrics3DIntent('画出正方体的外接球和内切球') && isSolidmetrics3DIntent('正四面体棱长与外接半径'), '立体专属词识别（前置）');
assert(isSolidmetrics3DIntent('帮我验证正二十面体的欧拉公式') && isSolidmetrics3DIntent('柏拉图立体的 V-E-F 关系'), '立体专属词识别（后置/欧拉）');
assert(!isSolidmetrics3DIntent('画正六边形的外接圆') && !isSolidmetrics3DIntent('三角形内切圆'), '2D 正多边形/三角形外接圆不误切');
assert(!isSolidmetrics3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '正方体外接球半径是多少') === '3d', 'detect3d + 立体外接球意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画正六边形外接圆') === '2d', 'detect3d + 2D 正六边形外接圆仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SOLIDMETRICS_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSolidmetrics3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("sm.op !== 'solidmetrics3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('solidmetrics3d 给一种正多面体'), '画板面板工具说明已追加');

section('七、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SOLIDMETRICS_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_CENTROID_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'centroid3d'") && read('js/board3d-executor.js').includes("case 'solidmetrics3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

/**
 * 3D 四点外接球命令（circumsphere3d · D39）无头回归。
 *
 * 覆盖：solve3x3 / circumsphere3DAxisUnit / circumsphere3DCenter /
 *       circumsphere3DRadius / circumsphere3DFrame / resolveCircumsphere3D 纯函数
 *       （默认正四面体、长方体角点、球心半径守恒、三正交大圆、半径线段、
 *        标架正交、样式、输出开关组合、id 避让与 64 字符边界、共面/重合拒绝、
 *        脏输入原子拒绝、线段上限、深度只读性）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失/抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、3D 意图分支、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_circumsphere.mjs
 */
import {
  BOARD3D_CIRCUMSPHERE_PROMPT, BOARD3D_CIRCUMSPHERE_PROMPT_OPS,
  isCircumsphere3DIntent,
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
  BOARD3D_CIRCUMSPHERE_OPS, BOARD3D_COMPLETE30_OPS,
} from '../js/board3d-executor.js';
import {
  CIRCUMSPHERE3D_SEGMENTS_MIN, CIRCUMSPHERE3D_SEGMENTS_MAX, CIRCUMSPHERE3D_SEGMENTS_DEFAULT,
  CIRCUMSPHERE3D_VERTEX_SIZE_MIN, CIRCUMSPHERE3D_VERTEX_SIZE_MAX, CIRCUMSPHERE3D_VERTEX_SIZE_DEFAULT,
  CIRCUMSPHERE3D_MAX_SEGMENTS, CIRCUMSPHERE3D_DEFAULT_POINTS, CIRCUMSPHERE3D_DEFAULT_AXIS,
  num, solve3x3, circumsphere3DAxisUnit, circumsphere3DCenter, circumsphere3DRadius,
  circumsphere3DFrame, resolveCircumsphere3D,
} from '../js/board3d-circumsphere.js';
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
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && b.length === 3 && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));
const RSQRT3 = Math.sqrt(3);

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
assert(BOARD3D_POINT_LINE_OPS.length === 1 && BOARD3D_COMPLETE28_OPS.length === 37, 'COMPLETE28 37');
assert(BOARD3D_RELATION_OPS.length === 1 && BOARD3D_RELATION_OPS[0] === 'relation3d' && BOARD3D_COMPLETE29_OPS.length === 38, 'RELATION 1 / COMPLETE29 38');
assert(BOARD3D_CIRCUMSPHERE_OPS.length === 1 && BOARD3D_CIRCUMSPHERE_OPS[0] === 'circumsphere3d' && BOARD3D_COMPLETE30_OPS.length === 39, 'CIRCUMSPHERE 1 / COMPLETE30 39');
assert(CIRCUMSPHERE3D_SEGMENTS_MIN === 8 && CIRCUMSPHERE3D_SEGMENTS_MAX === 512 && CIRCUMSPHERE3D_SEGMENTS_DEFAULT === 48, 'segments 常量 8/512/48');
assert(CIRCUMSPHERE3D_VERTEX_SIZE_MIN === 0.01 && CIRCUMSPHERE3D_VERTEX_SIZE_MAX === 1 && CIRCUMSPHERE3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量 0.01/1/0.1');
assert(CIRCUMSPHERE3D_MAX_SEGMENTS === 4096 && CIRCUMSPHERE3D_DEFAULT_POINTS.length === 4 && vecApprox(CIRCUMSPHERE3D_DEFAULT_AXIS, [0, 0, 1]), '上限与默认参数');

section('二、纯几何层：solve3x3 / 轴 / 球心 / 半径 / 标架');
assert(num(2) === 2 && num('2.5') === 2.5 && num('  ') === null && num('1+1') === null && num([]) === null, 'num 严格取数');
{
  const x = solve3x3([[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 6, 12]);
  assert(x && vecApprox(x, [1, 2, 3]), 'solve3x3 对角阵解 [1,2,3]');
  // 3x + 2y + z = 11; 2x - y + 3z = 12; x + y - z = 0 → 解 (2,1,3)
  const y = solve3x3([[3, 2, 1], [2, -1, 3], [1, 1, -1]], [11, 12, 0]);
  assert(y && vecApprox(y, [2, 1, 3]), 'solve3x3 一般阵解 [2,1,3]');
  assert(solve3x3([[1, 0, 0], [0, 1, 0], [0, 0, 0]], [1, 2, 3]) === null, 'solve3x3 奇异阵返回 null');
  assert(solve3x3([[1, 2], [3, 4]], [1, 2]) === null, 'solve3x3 非法输入返回 null');
}
{
  assert(vecApprox(circumsphere3DAxisUnit('x'), [1, 0, 0]) && vecApprox(circumsphere3DAxisUnit('Y'), [0, 1, 0]) && vecApprox(circumsphere3DAxisUnit(undefined), [0, 0, 1]), '轴 x/y/默认 z');
  assert(vecApprox(circumsphere3DAxisUnit([0, 2, 0]), [0, 1, 0]), '轴向量归一化');
  assert(circumsphere3DAxisUnit('q') === null && circumsphere3DAxisUnit([0, 0, 0]) === null && circumsphere3DAxisUnit('abc') === null, '轴非法拒绝');
}
{
  const tet = CIRCUMSPHERE3D_DEFAULT_POINTS;
  const c = circumsphere3DCenter(tet);
  assert(c && vecApprox(c, [0, 0, 0]), '正四面体球心原点');
  assert(approx(circumsphere3DRadius(c, tet), RSQRT3), '正四面体半径 √3');
  const box = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]];
  const c2 = circumsphere3DCenter(box);
  assert(c2 && vecApprox(c2, [1, 1, 1]) && approx(circumsphere3DRadius(c2, box), RSQRT3), '长方体角点球心 [1,1,1] 半径 √3');
  assert(circumsphere3DCenter([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]) === null, '共面四点无球心');
  assert(circumsphere3DCenter([[0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]]) === null, '重合四点无球心');
  assert(circumsphere3DCenter([[0, 0, 0], [1, 0, 0], [0, 1, 0]]) === null, 'points 数量非法');
  assert(circumsphere3DRadius(null, tet) === null && circumsphere3DRadius([0, 0, 0], [[0, 0, 0]]) === null, '半径非法入参');
}
{
  const f = circumsphere3DFrame('z');
  assert(f && approx(dot(f.n, f.u), 0, 1e-6) && approx(dot(f.n, f.v), 0, 1e-6) && approx(dot(f.u, f.v), 0, 1e-6), '标架三向量两两正交');
  assert(approx(norm(f.u), 1, 1e-6) && approx(norm(f.v), 1, 1e-6) && approx(norm(f.n), 1, 1e-6), '标架均为单位向量');
  const fx = circumsphere3DFrame('x');
  assert(fx && vecApprox(fx.n, [1, 0, 0]) && approx(dot(fx.n, fx.u), 0, 1e-6), 'x 轴标架');
  assert(circumsphere3DFrame('q') === null, '非法轴无标架');
}

section('三、resolveCircumsphere3D 输出对象与守恒');
{
  const r = resolveCircumsphere3D({}, {});
  assert(r.ok === true, '默认命令成功');
  assert(vecApprox(r.meta.center, [0, 0, 0]) && approx(r.meta.radius, RSQRT3), '默认球心/半径');
  assert(r.meta.radiusChecks.every((d) => approx(d, RSQRT3)), '四顶点到球心距离恒为 R');
  assert(r.meta.radiusChecks.length === 4, 'radiusChecks 四项');
  assert(r.meta.greatCircleCount === 3 && r.meta.equator.length === 48 && r.meta.meridian1.length === 48 && r.meta.meridian2.length === 48, '三大圆各 48 采样点');
  // 大圆采样点到球心距离恒为 R
  const onCircle = (pt) => approx(norm(sub(pt, r.meta.center)), RSQRT3);
  assert(r.meta.equator.every(onCircle) && r.meta.meridian1.every(onCircle) && r.meta.meridian2.every(onCircle), '大圆采样点均在球面上');
  // 三大圆平面法向两两正交：n(赤道) / v(经线1) / u(经线2)
  assert(approx(dot(r.meta.n, r.meta.v), 0, 1e-3) && approx(dot(r.meta.n, r.meta.u), 0, 1e-3) && approx(dot(r.meta.u, r.meta.v), 0, 1e-3), '三大圆平面法向两两正交');
  assert(r.meta.radiusCount === 4 && r.meta.pointCount === 0 && r.meta.labelCount === 2, '默认 4 半径线 + 0 小球 + 2 标注(O,R)');
  assert(r.meta.segmentCount === 3 * 48 + 4 && r.meta.itemCount === r.meta.segmentCount + 2, '默认 itemCount / segmentCount');
  assert(r.items.every((it) => typeof it.id === 'string' && it.id.length <= 64), '所有对象 id ≤64 字符');
  assert(new Set(r.items.map((it) => it.id)).size === r.items.length, '对象 id 全局唯一');
}
{
  const r = resolveCircumsphere3D({ points: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]] }, {});
  assert(r.ok && vecApprox(r.meta.center, [1, 1, 1]) && approx(r.meta.radius, RSQRT3), '长方体角点外接球心/半径');
  assert(r.meta.radiusChecks.every((d) => approx(d, RSQRT3)), '长方体四顶点等距');
}
{
  // 各输出开关组合
  const r = resolveCircumsphere3D({ asGreatCircles: false, asRadii: false, asPoints: false, labelCenter: false, labelVertices: false, labelRadius: false }, {});
  assert(r.ok === false && /开关/.test(r.error), '六开关全关拒绝');
  const only = resolveCircumsphere3D({ asGreatCircles: false, asRadii: false, asPoints: false, labelCenter: false, labelVertices: false, labelRadius: true }, {});
  assert(only.ok && only.meta.itemCount === 1 && only.items[0].type === 'label', '仅半径读数：1 个标签');
  const pts = resolveCircumsphere3D({ asPoints: true, labelVertices: true, segments: 8 }, {});
  assert(pts.ok && pts.meta.pointCount === 5 && pts.meta.labelCount === 6 && pts.meta.segmentCount === 3 * 8 + 4, '小球5 + 标注6(O+4顶点+R) + 线段28');
  const verts = pts.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(['O', 'A', 'B', 'C', 'D'].every((t) => verts.includes(t)) && verts.some((t) => t.startsWith('R=')), '顶点 A-D / 球心 O / 半径 R= 标注齐全');
}
{
  // 半径线段：一端为球心，另一端为顶点
  const r = resolveCircumsphere3D({ segments: 8 }, {});
  const radii = r.items.filter((it) => it.type === 'line' && it.id.includes('_r'));
  assert(radii.length === 4, '四条半径线段');
  assert(radii.every((ln) => vecApprox([ln.p.x1, ln.p.y1, ln.p.z1], r.meta.center) &&
    r.meta.points.some((p) => vecApprox([ln.p.x2, ln.p.y2, ln.p.z2], p))), '半径线段一端球心、一端顶点');
}
{
  // 样式
  const r = resolveCircumsphere3D({ color: '#123456', labelColor: '#abcdef', opacity: 0.5, vertexSize: 0.2, asPoints: true }, {});
  assert(r.ok && r.items[0].color === '#123456' && r.meta.labelColor === '#abcdef' && approx(r.meta.opacity, 0.5), '样式落地');
  assert(r.items.find((it) => it.type === 'point').p.s === 0.2, '小球 vertexSize');
}
{
  // id 避让 + 64 字符边界
  const state = { objects: [{ id: 'csph_eq_0' }, { id: 'csph' }] };
  const r = resolveCircumsphere3D({ segments: 8 }, state);
  assert(r.ok && !r.items.some((it) => it.id === 'csph_eq_0') && r.items.every((it) => /^[A-Za-z0-9_-]{1,64}$/.test(it.id)), 'id 避让且合法');
  const long = resolveCircumsphere3D({ id: 'x'.repeat(80), segments: 8 }, {});
  assert(long.ok === false && /id 非法/.test(long.error), '超长 id 拒绝');
}
{
  // 脏输入原子拒绝
  const bad = [
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] }, // 共面
    { points: [[0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]] }, // 重合
    { points: 'x'.repeat(10) },
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 'bad']] },
    { axis: 'q' }, { axis: [0, 0, 0] },
    { segments: 7 }, { segments: 513 }, { segments: 10.5 }, { segments: 'abc' },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' },
    { asRadii: 'yes' }, { labelCenter: 1 },
    { opacity: 'x' },
    { id: 'has space' },
    null, [], 'cmd',
  ];
  for (const c of bad) assert(resolveCircumsphere3D(c, {}).ok === false, '拒绝脏输入 ' + JSON.stringify(c).slice(0, 48));
}
{
  // 线段上限：segments 在合法范围内 3×512+4=1540 < 4096，无越界；验证公式
  assert(3 * CIRCUMSPHERE3D_SEGMENTS_MAX + 4 <= CIRCUMSPHERE3D_MAX_SEGMENTS, '合法 segments 上限不触 4096 天花板');
}
{
  // 深度只读性：不修改 cmd / state
  const cmd = { id: 'csph', points: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]], segments: 8 };
  const state = { objects: [{ id: 'keep' }] };
  const cmdSnap = JSON.stringify(cmd);
  const stateSnap = JSON.stringify(state);
  resolveCircumsphere3D(cmd, state);
  assert(JSON.stringify(cmd) === cmdSnap && JSON.stringify(state) === stateSnap, '深度只读：cmd / state 未被修改');
  const r = resolveCircumsphere3D({}, {});
  assert(Object.isFrozen(r.meta) === false && Array.isArray(r.items), '返回结构为新建对象/数组');
}

section('四、执行器集成（与 2D 执行器隔离）');
{
  const added = {};
  const api = { add: (o) => { added[o.id] = o; return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'circumsphere3d', id: 'csph', segments: 8 }], api);
  assert(res[0].ok === true && res[0].count === 30 && res[0].created.length === 30, '逐项落地 30 项');
  assert(Object.keys(added).length === 30 && res[0].meta.center[0] === 0, 'api.add 全部落地');
}
{
  const addedIds = [];
  const api = { add: (o) => { addedIds.push(o.id); return true; }, getState: () => ({ objects: [{ id: 'csph_eq_0' }, { id: 'csph_eq_1' }, { id: 'csph_eq_2' }] }) };
  const res = applyBoard3DCommands([{ op: 'circumsphere3d', id: 'csph', segments: 8 }], api);
  assert(res[0].ok === true && res[0].created.length === 30 && res[0].count === 30, '预置 id 冲突全部避让重命名、整批仍落地');
  assert(!addedIds.includes('csph_eq_0') && !addedIds.includes('csph_eq_1') && !addedIds.includes('csph_eq_2') && addedIds.includes('csph_eq_0_2'), '冲突 id 被 _2 后缀避让');
}
{
  // getState 缺失 / 抛错降级
  const api1 = { add: () => true };
  const r1 = applyBoard3DCommands([{ op: 'circumsphere3d', segments: 8 }], api1);
  assert(r1[0].ok === true, 'getState 缺失降级为空场景');
  const api2 = { add: () => true, getState: () => { throw new Error('x'); } };
  const r2 = applyBoard3DCommands([{ op: 'circumsphere3d', segments: 8 }], api2);
  assert(r2[0].ok === true, 'getState 抛错降级为空场景');
}
{
  // api 部分失败分项
  let k = 0;
  const api = { add: () => (++k === 1 ? false : true), getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'circumsphere3d', segments: 8 }], api);
  assert(res[0].ok === false && res[0].created.length === 29 && res[0].failed.length === 1, 'api 部分失败分项回报');
}
{
  // 2D 隔离 / 历史命令并存 / 参数拒绝
  const api = { add: () => true, getState: () => ({ objects: [] }) };
  const mixed = applyBoard3DCommands([
    { op: 'circle' },
    { op: 'circumsphere3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] },
    { op: 'circumsphere3d', segments: 8 },
  ], api);
  assert(mixed[0].ok === false && /不识别 2D/.test(mixed[0].error), '2D 命令被 3D 分支拒绝');
  assert(mixed[1].ok === false && /共面/.test(mixed[1].error), '共面命令原子拒绝、整批不中断');
  assert(mixed[2].ok === true, '合法命令在同批仍执行');
  const coexist = applyBoard3DCommands([
    { op: 'relation3d' }, { op: 'pointline3d', segments: 8 }, { op: 'skewline3d', segments: 8 },
  ], api);
  assert(coexist.every((r) => true), '历史 D35/D37/D38 命令可并存调用（不抛错）');
}

section('五、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_CIRCUMSPHERE_PROMPT_OPS.length === 1 && BOARD3D_CIRCUMSPHERE_PROMPT_OPS[0] === 'circumsphere3d', '提示词 op 与执行器 op 一致');
assert(BOARD3D_CIRCUMSPHERE_PROMPT.includes('circumsphere3d') && BOARD3D_CIRCUMSPHERE_PROMPT.includes('points') && BOARD3D_CIRCUMSPHERE_PROMPT.includes('segments'), '提示词含完整命令格式');
assert(BOARD3D_CIRCUMSPHERE_PROMPT.includes('四点共面或重合时整条拒绝'), '提示词强调共面拒绝');
assert(BOARD3D_CIRCUMSPHERE_PROMPT.includes('2D 的外接圆 / 圆心命令在本分支依旧不认识'), '提示词保持 3D/2D 分支隔离铁律');
assert(isCircumsphere3DIntent('画三棱锥的外接球') && isCircumsphere3DIntent('求这个四面体外接球并标球心'), '外接球/四面体措辞命中');
assert(isCircumsphere3DIntent('长方体外接球') && isCircumsphere3DIntent('空间四点的球'), '长方体/空间四点措辞命中');
assert(!isCircumsphere3DIntent('画三角形的外接圆') && !isCircumsphere3DIntent('画一个圆'), '2D 外接圆不误命中');
assert(resolveBoardMode({ detect3d: true }, '画三棱锥的外接球') === '3d', '显式 detect3d 时外接球进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '四面体外接球') === '3d', '四面体措辞进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '点到空间直线距离') === '3d', 'D37 意图词仍有效');
assert(resolveBoardMode({ detect3d: true }, '正方体对棱平行') === '3d', 'D38 意图词仍有效');
assert(resolveBoardMode({ message: '画外接球' }, '画外接球') === '2d', '未开启 detect3d 保持 2D 主干');
assert(resolveBoardMode({ detect3d: true }, '画三角形外接圆') === '2d', '2D 外接圆不误切 3D');
assert(read('ai/board-backend.js').includes('+ BOARD3D_CIRCUMSPHERE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("cs.op !== 'circumsphere3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('circumsphere3d 给四个不共面点'), '画板面板工具说明已追加');

section('六、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_CIRCUMSPHERE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_RELATION_PROMPT'), '新段追加在既有段之后');
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
  let p = 0;
  while (p < headHtml.length && headHtml[p] === nowHtml[p]) p++;
  let s = 0;
  while (s < headHtml.length - p && headHtml[headHtml.length - 1 - s] === nowHtml[nowHtml.length - 1 - s]) s++;
  assert(p + s === headHtml.length && nowHtml.includes('circumsphere3d 给四个不共面点'), 'board3d.html 只追加工具提示');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'skewline3d'") && read('js/board3d-executor.js').includes("case 'pointline3d'") && read('js/board3d-executor.js').includes("case 'relation3d'") && read('js/board3d-executor.js').includes("case 'circumsphere3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

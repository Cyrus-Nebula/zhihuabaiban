/**
 * 3D 两球相交公共圆命令（spheresphere3d · D49）无头回归。
 *
 * 覆盖：sphereSphereGeometry / num / parseSSPoint / intersectionFrame / planeOffset / circleRadius 纯函数 /
 *       resolveSphereSphere3D（默认等球相交 / 不等半径 / 斜轴平移 / x 为负的一般情形，
 *        交圆点恒在两球面且恒在交平面、a²=r1²−x²=r2²−(d−x)²、
 *        开关组合 / 辐条 / 小球 / 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_spheresphere.mjs
 */
import {
  BOARD3D_SPHERESPHERE_PROMPT, BOARD3D_SPHERESPHERE_PROMPT_OPS,
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
  BOARD3D_SPHERICALCAP_OPS, BOARD3D_COMPLETE37_OPS,
  BOARD3D_SPHERESECTOR_OPS, BOARD3D_COMPLETE38_OPS,
  BOARD3D_SPHERICALWEDGE_OPS, BOARD3D_COMPLETE39_OPS,
  BOARD3D_SPHERESPHERE_OPS, BOARD3D_COMPLETE40_OPS,
} from '../js/board3d-executor.js';
import {
  SPHERESPHERE3D_RADIUS_MIN, SPHERESPHERE3D_RADIUS_MAX, SPHERESPHERE3D_RADIUS_DEFAULT,
  SPHERESPHERE3D_SEGMENTS_MIN, SPHERESPHERE3D_SEGMENTS_MAX, SPHERESPHERE3D_SEGMENTS_DEFAULT,
  SPHERESPHERE3D_SPOKES_MIN, SPHERESPHERE3D_SPOKES_MAX, SPHERESPHERE3D_SPOKES_DEFAULT,
  SPHERESPHERE3D_VERTEX_SIZE_MIN, SPHERESPHERE3D_VERTEX_SIZE_MAX, SPHERESPHERE3D_VERTEX_SIZE_DEFAULT,
  SPHERESPHERE3D_RIGHT_ANGLE_MIN, SPHERESPHERE3D_RIGHT_ANGLE_MAX, SPHERESPHERE3D_RIGHT_ANGLE_DEFAULT,
  SPHERESPHERE3D_EXTEND_MIN, SPHERESPHERE3D_EXTEND_MAX, SPHERESPHERE3D_EXTEND_DEFAULT,
  SPHERESPHERE3D_MAX_SEGMENTS, SPHERESPHERE3D_DEFAULT_CENTER1, SPHERESPHERE3D_DEFAULT_CENTER2,
  num, parseSSPoint, intersectionFrame, sphereSpherePlaneOffset, sphereSphereCircleRadius,
  sphereSphereGeometry, resolveSphereSphere3D,
} from '../js/board3d-spheresphere.js';
import { isSpheresphere3DIntent } from '../ai/board-prompt.js';
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
const len = (a) => Math.sqrt(dot(a, a));

section('一、常量与历史契约（7~48 条逐字不变）');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '基础契约 7/8/9 条');
const history = [
  BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS,
  BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS,
  BOARD3D_COMPLETE9_OPS, BOARD3D_COMPLETE10_OPS, BOARD3D_COMPLETE11_OPS, BOARD3D_COMPLETE12_OPS,
  BOARD3D_COMPLETE13_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_COMPLETE15_OPS, BOARD3D_COMPLETE16_OPS,
  BOARD3D_COMPLETE17_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_COMPLETE19_OPS, BOARD3D_COMPLETE20_OPS,
  BOARD3D_COMPLETE21_OPS, BOARD3D_COMPLETE22_OPS, BOARD3D_COMPLETE23_OPS, BOARD3D_COMPLETE24_OPS,
  BOARD3D_COMPLETE25_OPS, BOARD3D_COMPLETE26_OPS, BOARD3D_COMPLETE27_OPS, BOARD3D_COMPLETE28_OPS,
  BOARD3D_COMPLETE29_OPS, BOARD3D_COMPLETE30_OPS, BOARD3D_COMPLETE31_OPS, BOARD3D_COMPLETE32_OPS,
  BOARD3D_COMPLETE33_OPS, BOARD3D_COMPLETE34_OPS, BOARD3D_COMPLETE35_OPS, BOARD3D_COMPLETE36_OPS,
  BOARD3D_COMPLETE37_OPS, BOARD3D_COMPLETE38_OPS, BOARD3D_COMPLETE39_OPS,
];
assert(history.length === 39 && history.every((ops, i) => ops.length === 10 + i), 'COMPLETE1~39 长度 10~48 逐字不变');
assert(BOARD3D_SPHERESPHERE_OPS.length === 1 && BOARD3D_SPHERESPHERE_OPS[0] === 'spheresphere3d', '新命令独立成组');
assert(BOARD3D_COMPLETE40_OPS.length === 49 && BOARD3D_COMPLETE40_OPS.includes('spheresphere3d'), 'COMPLETE40=49 条');
assert(!history.some((ops) => ops.includes('spheresphere3d')), '新命令未并入任何历史契约常量');
assert(SPHERESPHERE3D_RADIUS_DEFAULT === 2 && SPHERESPHERE3D_RADIUS_MIN === 0.01 && SPHERESPHERE3D_RADIUS_MAX === 10000, '半径默认值与边界');
assert(SPHERESPHERE3D_SEGMENTS_DEFAULT === 48 && SPHERESPHERE3D_MAX_SEGMENTS === 4096, '采样默认 48 / 线段上限 4096');
assert(vecApprox(SPHERESPHERE3D_DEFAULT_CENTER1, [0, 0, 0]) && vecApprox(SPHERESPHERE3D_DEFAULT_CENTER2, [2, 0, 0]), '默认两球心相距 2');

section('二、纯函数：num / 点解析 / 正交标架 / 有向距离 / 交圆半径');
assert(num(1.5) === 1.5 && num('2.5') === 2.5 && num('') === null && num(null) === null && num(NaN) === null && num(Infinity) === null, 'num 严格有限数');
assert(vecApprox(parseSSPoint([1, '2', 3]), [1, 2, 3]) && parseSSPoint([1, 2]) === null && parseSSPoint(['x', 2, 3]) === null, 'parseSSPoint 点解析');
{
  const fr = intersectionFrame([1, 0, 0]);
  assert(fr !== null && approx(dot(fr.u, fr.w), 0) && approx(dot(fr.u, fr.v), 0) && approx(dot(fr.w, fr.v), 0), '标架两两正交');
  assert(approx(len(fr.w), 1) && approx(len(fr.v), 1), '标架单位长度');
  assert(intersectionFrame([0, 0, 0]) === null && intersectionFrame([1, 2]) === null, '零向量/非法轴拒绝');
  assert(intersectionFrame([0, 0, 1]) !== null, '近平行轴自动换 helper');
}
assert(approx(sphereSpherePlaneOffset(2, 2, 2), 1), 'x(等球 d=2,r=2)=1');
assert(approx(sphereSpherePlaneOffset(3, 2, 3), 2 / 3), 'x(d=3,r1=2,r2=3)=2/3');
assert(sphereSpherePlaneOffset(0, 2, 2) === null, 'd=0 拒绝');
assert(approx(sphereSphereCircleRadius(2, 1), Math.sqrt(3)), 'a(2,1)=√3');
assert(sphereSphereCircleRadius(2, 2) === null, 'a 非正拒绝');

section('三、两球相交几何解：默认 / 不等半径 / 斜轴平移 / x 为负');
{
  const g = sphereSphereGeometry({});
  assert(g.ok && approx(g.radius1, 2) && approx(g.radius2, 2) && approx(g.distance, 2), '默认等球相交 r1=r2=2、d=2');
  assert(approx(g.planeOffset, 1) && approx(g.circleRadius, Math.sqrt(3)) && vecApprox(g.circleCenter, [1, 0, 0]), '默认 x=1、a=√3、O′=(1,0,0)');
  assert(approx(g.circleRadius ** 2, g.radius1 ** 2 - g.planeOffset ** 2), 'a²=r1²−x²');
  assert(approx(g.circleRadius ** 2, g.radius2 ** 2 - (g.distance - g.planeOffset) ** 2), 'a²=r2²−(d−x)²');
  assert(approx(dot(g.circleCenter, g.u), 1) && approx(len(g.u), 1), '交圆圆心沿球心连线、u 单位');
}
{
  const g = sphereSphereGeometry({ center2: [3, 0, 0], radius2: 3 });
  assert(g.ok && approx(g.distance, 3) && approx(g.planeOffset, 2 / 3), '不等半径 d=3、x=2/3');
  assert(approx(g.circleRadius, 4 * Math.sqrt(2) / 3), '不等半径 a=4√2/3');
  assert(approx(g.circleRadius ** 2, g.radius2 ** 2 - (g.distance - g.planeOffset) ** 2), '不等半径二阶校验');
}
{
  const g = sphereSphereGeometry({ center1: [1, 2, 3], center2: [3, 4, 5], radius1: 3, radius2: 3 });
  assert(g.ok && vecApprox(g.center1, [1, 2, 3]) && approx(g.planeOffset, Math.sqrt(3)), '平移 + 等半径斜轴 x=d/2=√3');
  assert(approx(g.circleRadius, Math.sqrt(6)) && vecApprox(g.circleCenter, [2, 3, 4]), '斜轴交圆圆心 (2,3,4)、a=√6');
}
{
  const g = sphereSphereGeometry({ radius1: 2, radius2: 5, center2: [4, 0, 0] });
  assert(g.ok && approx(g.planeOffset, -0.625) && approx(g.circleRadius, 1.9), 'x 为负的一般情形仍合法');
  assert(approx(g.circleRadius ** 2, g.radius2 ** 2 - (g.distance - g.planeOffset) ** 2), 'x 为负时二阶校验');
}
assert(sphereSphereGeometry(null) === null && sphereSphereGeometry([]) === null, '空几何输入拒绝');
for (const bad of [
  { center1: [0, 0] }, { center2: 'x' }, { radius1: 0 }, { radius2: 10001 },
  { center1: [0, 0, 0], center2: [0, 0, 0] },
  { radius1: 2, radius2: 1, center2: [1, 0, 0] },
  { radius1: 2, radius2: 2, center2: [4, 0, 0] },
  { radius1: 2, radius2: 2, center2: [5, 0, 0] },
  { radius1: 5, radius2: 1, center2: [2, 0, 0] },
]) {
  assert(!sphereSphereGeometry(bad).ok, `几何拒绝：${JSON.stringify(bad)}`);
}

section('四、resolveSphereSphere3D：默认 / 开关 / 标注 / 样式 / 边界');
{
  const r = resolveSphereSphere3D({});
  assert(r.ok && r.items.length > 300 && r.meta.itemCount === r.items.length, '默认命令成功并产出大量线段');
  assert(r.meta.segmentCount === 351 && r.meta.labelCount === 6 && r.meta.pointCount === 0, '默认 351 线 + 6 标注');
  assert(approx(r.meta.radius1, 2) && approx(r.meta.radius2, 2) && approx(r.meta.distance, 2), '默认 meta 读数');
  assert(approx(r.meta.planeOffset, 1) && approx(r.meta.circleRadius, Math.sqrt(3), 5e-3), '默认 meta x/a');
  assert([...new Set(r.items.map((it) => it.type))].sort().join(',') === 'label,line', '默认两类图元 line+label');
  assert(r.meta.dev1 < 0.01 && r.meta.dev2 < 0.01 && r.meta.planeDev < 0.01, '默认守恒读数近零');
}
{
  const r = resolveSphereSphere3D({ segments: 8, spokes: 0, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false, asRightAngle: false, asPoints: true });
  assert(r.ok && r.meta.segmentCount === 8 && r.meta.pointCount === 11, '仅交圆+小球：8 线 + 11 点');
  assert(r.items.every((it) => it.type !== 'line' || it.color === r.meta.circleColor), '仅交圆使用 circleColor');
}
{
  const r = resolveSphereSphere3D({ segments: 8, spokes: 4, asSphere1: false, asSphere2: false, asRightAngle: false, asPoints: true, labelRadii: false, labelDistance: false, labelCircleRadius: false, labelPlaneOffset: false, labelRelation: false });
  assert(r.ok && r.meta.segmentCount === 8 + 4 + 1 + 4 && r.meta.pointCount === 11 && r.meta.labelCount === 0, '辐条/轴/半径/小球组合计数');
}
{
  const r = resolveSphereSphere3D({ segments: 8, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false, vertexSize: '0.2', rightAngleSize: '0.3', extend: '0.5', color: '#123456', opacity: '0.5' });
  assert(r.ok && approx(r.meta.vertexSize, 0.2) && approx(r.meta.rightAngleSize, 0.3) && approx(r.meta.extend, 0.5), '数字字符串参数容错');
  assert(r.meta.color === '#123456' && approx(r.meta.opacity, 0.5), '颜色/透明度样式生效');
}
{
  const r = resolveSphereSphere3D({ id: 'x'.repeat(64), segments: 8, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符 id 边界不溢出');
}
{
  const r = resolveSphereSphere3D({ id: 'ssi', segments: 8, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false }, { objects: [{ id: 'ssi' }, { id: 'ssi_c0' }] });
  assert(r.ok && r.items.every((it) => it.id !== 'ssi' && it.id !== 'ssi_c0'), 'state 中已有 id 全部避让');
}
{
  const labels = resolveSphereSphere3D({ segments: 8, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false }).items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.some((t) => t.includes('r1=')) && labels.some((t) => t.includes('r2=')) && labels.some((t) => t.includes('d=')) && labels.some((t) => t.includes('a=')) && labels.some((t) => t.includes('x=')) && labels.some((t) => t.includes('a²=')), 'r1/r2/d/a/x/关系式六类标注齐全');
}

section('五、脏输入原子拒绝');
{
  const bad = [
    { center1: [0, 0] }, { center2: null }, { radius1: 0 }, { radius2: 10001 },
    { center1: [0, 0, 0], center2: [0, 0, 0] },
    { radius1: 2, radius2: 1, center2: [1, 0, 0] },
    { radius1: 2, radius2: 2, center2: [4, 0, 0] },
    { segments: 7 }, { segments: 513 }, { segments: 8.5 }, { segments: 'x' },
    { spokes: -1 }, { spokes: 33 }, { spokes: 1.2 },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' },
    { rightAngleSize: 0 }, { rightAngleSize: 3 }, { rightAngleSize: 'x' },
    { extend: -0.1 }, { extend: 3 }, { extend: 'x' },
    { asSphere1: 'yes' }, { labelRelation: 1 },
    { asSphere1: false, asSphere2: false, asCircle: false, asDisc: false, asAxis: false, asRadii: false },
    { color: 123 }, { circleColor: [], opacity: 'x' },
    { id: 'bad id!' }, { id: 'x'.repeat(65) },
  ];
  let allRejected = true;
  for (const cmd of bad) {
    const r = resolveSphereSphere3D(cmd);
    if (r.ok) { allRejected = false; console.log('  未拒绝:', JSON.stringify(cmd)); }
  }
  assert(allRejected, `全部 ${bad.length} 类脏输入原子拒绝`);
  assert(!resolveSphereSphere3D(null).ok && !resolveSphereSphere3D([]).ok, '空命令/数组拒绝');
}

section('六、深度只读性');
{
  const cmd = Object.freeze({ op: 'spheresphere3d', segments: 8, asSphere1: false, asSphere2: false, asDisc: false, asAxis: false, asRadii: false });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const before = JSON.stringify(cmd);
  const r = resolveSphereSphere3D(cmd, state);
  assert(r.ok && JSON.stringify(cmd) === before, '冻结命令不被修改');
  assert(JSON.stringify(state) === '{"objects":[]}', '冻结 state 不被修改');
  r.items[0].id = 'mutated';
  assert(cmd.id === undefined, '输出与入参无引用 Sharing');
}

section('七、执行器集成 / 协议两侧一致性');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'spheresphere3d', id: 'ssi', segments: 8, asSphere1: false, asSphere2: false }], api);
  assert(res.length === 1 && res[0].ok && res[0].count === added.length, '执行器逐项落地');
  assert([...new Set(added.map((o) => o.type))].sort().join(',') === 'label,line', 'line + label 两类图元');
  assert(res[0].meta && approx(res[0].meta.circleRadius, Math.sqrt(3), 5e-3), '执行器回传 meta 读数');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'ssi' }] }) };
  const res = applyBoard3DCommands([{ op: 'spheresphere3d', id: 'ssi', segments: 8, asSphere1: false, asSphere2: false }], api);
  assert(res[0].ok && res[0].created.every((c) => c.id !== 'ssi'), 'getState 已有 id 时避让');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'spheresphere3d', segments: 8, asSphere1: false, asSphere2: false }], api);
  assert(res[0].ok, 'getState 抛错降级为空场景、整批不中断');
}
{
  const api = { add: () => null, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'spheresphere3d', segments: 8, asSphere1: false, asSphere2: false }], api);
  assert(!res[0].ok && res[0].failed && res[0].failed.length > 0, 'api.add 失败分项回报');
}
{
  const res = applyBoard3DCommands([{ op: 'point', x: 1, y: 2 }], { add: () => true, getState: () => ({}) });
  assert(res[0].ok === false && /3D 分支/.test(res[0].error), '2D 命令在 3D 执行器被拒绝');
}
assert(BOARD3D_SPHERESPHERE_PROMPT_OPS.length === 1 && BOARD3D_SPHERESPHERE_PROMPT_OPS[0] === 'spheresphere3d', '提示词 OPS 常量一致');
assert(BOARD3D_SPHERESPHERE_PROMPT.includes('spheresphere3d') && BOARD3D_SPHERESPHERE_PROMPT.includes('a²=r1²−x²=r2²−(d−x)²'), '提示词含命令与恒等式');
assert(isSpheresphere3DIntent('两球相交求公共圆') && isSpheresphere3DIntent('画两个球相交的交圆'), '立体专属词识别');
assert(!isSpheresphere3DIntent('两圆相交公共弦') && !isSpheresphere3DIntent('圆与圆相交') && !isSpheresphere3DIntent('画一个球'), '2D 两圆相交/单球不误切');
assert(!isSpheresphere3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '两球相交求交圆半径') === '3d', 'detect3d + 两球相交意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '两圆相交公共弦') === '2d', 'detect3d + 2D 两圆相交仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SPHERESPHERE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSpheresphere3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("sph.op !== 'spheresphere3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('spheresphere3d 给两个球'), '画板面板工具说明已追加');

section('八、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SPHERESPHERE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SPHERICALWEDGE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('BOARD_SYSTEM_PROMPT'), '2D 主干仍在');
}
{
  const h = readHead('ai/board-backend.js').split('\n');
  const n = read('ai/board-backend.js').split('\n');
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
  const h = readHead('board3d.html').split('\n');
  const n = read('board3d.html').split('\n');
  const inlineOnly = h.length === n.length && h.every((line, i) => {
    if (line === n[i]) return true;
    let j = 0;
    for (let k = 0; k < n[i].length && j < line.length; k++) if (n[i][k] === line[j]) j++;
    return j === line.length;
  });
  assert(inlineOnly, 'board3d.html 仅行内追加工具提示、未删改既有行');
  assert(n.join('\n').includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'sphericalcap3d'") && read('js/board3d-executor.js').includes("case 'sphericalwedge3d'") && read('js/board3d-executor.js').includes("case 'spheresphere3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;

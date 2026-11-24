/**
 * 3D 点到平面的距离命令（pointplane3d · D34）无头回归。
 *
 * 覆盖：pointplanePlaneNormal / pointplaneFoot / pointplaneDistance / pointplaneBasis / resolvePointplane3D 纯函数
 *       （默认 d=1、指定点、center+axis、负侧、点在面上、斜平面、几何守恒、
 *        开关 / 法向杆 / 直角符号 / 小球 / 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_pointplane.mjs
 */
import {
  BOARD3D_POINT_PLANE_PROMPT, BOARD3D_POINT_PLANE_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  POINTPLANE3D_PLANE_SIZE_MIN, POINTPLANE3D_PLANE_SIZE_MAX,
  POINTPLANE3D_PLANE_WIDTH_DEFAULT, POINTPLANE3D_PLANE_HEIGHT_DEFAULT,
  POINTPLANE3D_VERTEX_SIZE_MIN, POINTPLANE3D_VERTEX_SIZE_MAX, POINTPLANE3D_VERTEX_SIZE_DEFAULT,
  POINTPLANE3D_RIGHT_ANGLE_MIN, POINTPLANE3D_RIGHT_ANGLE_MAX, POINTPLANE3D_RIGHT_ANGLE_DEFAULT,
  POINTPLANE3D_NORMAL_LENGTH_MIN, POINTPLANE3D_NORMAL_LENGTH_MAX, POINTPLANE3D_NORMAL_LENGTH_DEFAULT,
  POINTPLANE3D_MAX_SEGMENTS, POINTPLANE3D_DEFAULT_POINT, POINTPLANE3D_DEFAULT_POINTS,
  num, pointplanePlaneNormal, pointplaneFoot, pointplaneDistance, pointplaneBasis, resolvePointplane3D,
} from '../js/board3d-pointplane.js';
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
const norm = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);
const XY_PLANE = [[-1, -1, 0], [1, -1, 0], [0, 1, 0]];

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
assert(BOARD3D_LINEPLANE_OPS.length === 1 && BOARD3D_COMPLETE24_OPS.length === 33, 'COMPLETE24 33（D33 历史契约不变）');
assert(BOARD3D_POINT_PLANE_OPS.length === 1 && BOARD3D_POINT_PLANE_OPS[0] === 'pointplane3d', 'POINT_PLANE_OPS 1 条');
assert(BOARD3D_COMPLETE25_OPS.length === 34 && BOARD3D_COMPLETE25_OPS.includes('pointplane3d'), 'COMPLETE25 34 条含 pointplane3d');
assert(!BOARD3D_COMPLETE24_OPS.includes('pointplane3d'), 'COMPLETE24 不含 pointplane3d（未污染历史契约）');
assert(POINTPLANE3D_PLANE_SIZE_MIN === 0.01 && POINTPLANE3D_PLANE_SIZE_MAX === 10000, '面片尺寸区间常量');
assert(POINTPLANE3D_PLANE_WIDTH_DEFAULT === 2 && POINTPLANE3D_PLANE_HEIGHT_DEFAULT === 2, '面片默认 2/2');
assert(POINTPLANE3D_RIGHT_ANGLE_DEFAULT === 0.25 && POINTPLANE3D_NORMAL_LENGTH_DEFAULT === 0.5, '直角/法向默认');
assert(POINTPLANE3D_VERTEX_SIZE_DEFAULT === 0.1 && POINTPLANE3D_MAX_SEGMENTS === 4096, '小球默认与段数上限');

section('二、纯函数：num / 法向 / 基 / 垂足 / 距离');
assert(num(3) === 3 && num('3.5') === 3.5 && num(' -2 ') === -2, 'num：数字与数字字符串');
assert(num('1e309') === null && num(Infinity) === null && num(NaN) === null && num('') === null && num(null) === null && num([]) === null && num('1+1') === null, 'num：脏值一律拒绝');
assert(vecApprox(pointplanePlaneNormal(XY_PLANE), [0, 0, 1]), 'xy 面法向 +z');
assert(vecApprox(pointplanePlaneNormal([XY_PLANE[0], XY_PLANE[2], XY_PLANE[1]]), [0, 0, -1]), '反序三点法向翻转');
assert(pointplanePlaneNormal([[0, 0, 0], [1, 0, 0], [2, 0, 0]]) === null, '共线三点法向 null');
assert(pointplanePlaneNormal([[0, 0], [1, 0, 0], [0, 1, 0]]) === null && pointplanePlaneNormal(null) === null, '非法点列法向 null');
const e1 = pointplaneBasis([0, 0, 1]);
assert(e1 && approx(norm(e1), 1) && approx(dot(e1, [0, 0, 1]), 0), '面内基单位且垂直法向');
assert(pointplaneBasis([0, 0]) === null && pointplaneBasis(['x', 0, 0]) === null, '非法法向求基 null');
assert(vecApprox(pointplaneFoot([0, 0, 1], XY_PLANE), [0, 0, 0]), '默认点垂足在原点');
assert(vecApprox(pointplaneFoot([2, 3, 4], XY_PLANE), [2, 3, 0]), '斜上方点垂足保 xy');
assert(approx(pointplaneDistance([0, 0, 1], XY_PLANE), 1), '点面距 1');
assert(approx(pointplaneDistance([0, 0, -2], XY_PLANE), 2), '负侧点面距 2');
assert(approx(pointplaneDistance([0, 0, 0], XY_PLANE), 0), '面上点面距 0');
assert(pointplaneFoot([0, 0], XY_PLANE) === null && pointplaneDistance(null, XY_PLANE) === null, '非法点垂足/距离 null');

section('三、resolve 默认与几何守恒');
{
  const r = resolvePointplane3D({});
  assert(r.ok && r.meta.distance === 1 && vecApprox(r.meta.foot, [0, 0, 0]), '默认：d=1、垂足原点');
  assert(vecApprox(r.meta.nh, [0, 0, 1]) && r.meta.sign === 1 && r.meta.planeMode === 'default', '默认法向与正侧');
  assert(r.meta.itemCount === 8 && r.meta.segmentCount === 7, '默认产出 4 面片 + 1 垂线 + 2 直角 + 1 标注');
  assert(r.meta.labelText === 'd=1' && r.items.filter((it) => it.type === 'line').length === 7, '默认距离读数与线段数');
  assert(r.meta.corners.every((c) => approx(c[2], 0)), '面片四角共面（z=0）');
  assert(r.meta.corners.every((c) => approx(norm(sub(c, r.meta.foot)), Math.SQRT2)), '面片四角到垂足距离 √2');
  assert(approx(norm(sub(r.meta.point, r.meta.foot)), r.meta.distance), '|PH| = d');
  assert(vecApprox([0, 1, 2].map((k) => (sub(r.meta.point, r.meta.foot)[k])), [0, 0, 1]), 'PH 平行法向');
  const [q1, q2, q3] = r.meta.rightAngle;
  assert(approx(dot(sub(q2, q1), sub(q3, q2)), 0), '直角符号两边互相垂直');
  assert(approx(norm(sub(q2, q1)), 0.25) && approx(norm(sub(q3, q2)), 0.25), '直角符号边长 = rightAngleSize');
  assert(r.items.every((it) => ['line', 'point', 'label'].includes(it.type)), '产出图元类型合法');
}
{
  const r = resolvePointplane3D({ point: [2, 3, 4] });
  assert(r.ok && r.meta.distance === 4 && vecApprox(r.meta.foot, [2, 3, 0]), '指定点 d=4、垂足 [2,3,0]');
  assert(r.meta.labelText === 'd=4', '指定点距离读数');
}
{
  const r = resolvePointplane3D({ point: [0, 0, -2] });
  assert(r.ok && r.meta.distance === 2 && r.meta.sign === -1 && vecApprox(r.meta.normalDir, [0, 0, -1]), '负侧：距离取绝对值、法向杆朝向翻转');
  assert(vecApprox(r.meta.foot, [0, 0, 0]), '负侧垂足仍在面上');
}
{
  const r = resolvePointplane3D({ point: [1, 1, 0] });
  assert(r.ok && r.meta.distance === 0 && vecApprox(r.meta.foot, [1, 1, 0]), '点在面上：d=0、H=P 退化合法');
}
{
  const r = resolvePointplane3D({ point: [0, 0, 2], points: [[0, 0, 0], [1, 0, 0], [0, 1, 1]] });
  assert(r.ok && approx(r.meta.distance, Math.SQRT2) && vecApprox(r.meta.foot, [0, 1, 1]), '斜平面：距离 √2、垂足 [0,1,1]');
  assert(r.meta.corners.every((c) => approx(dot(sub(c, r.meta.plane[0]), r.meta.nh), 0)), '斜平面四角恒在面内');
}

section('四、center+axis 定面 / 开关 / 样式 / 数字字符串 / id 避让');
{
  const r = resolvePointplane3D({ point: [1, 2, 3], center: [0, 0, 0], axis: [0, 0, 1] });
  assert(r.ok && r.meta.planeMode === 'centerAxis' && r.meta.distance === 3 && vecApprox(r.meta.foot, [1, 2, 0]), 'center+axis 定面');
}
{
  const r = resolvePointplane3D({ asPlane: false, asRightAngle: false, asNormal: true, asPoints: true, labelPoint: true, labelFoot: true });
  assert(r.ok && r.meta.planeCount === 0 && r.meta.rightAngleCount === 0 && r.meta.normalCount === 1, '开关：关面片/直角、开法向杆');
  assert(r.meta.pointCount === 2 && r.meta.labelCount === 3, '开关：两点小球与三个标注');
  assert(approx(norm(sub(r.meta.normalEnd, r.meta.foot)), 0.5), '法向杆长度 = normalLength');
}
{
  const r = resolvePointplane3D({ color: '#fff', labelColor: '#123456', opacity: 0.4, vertexSize: 0.3, rightAngleSize: 0.4, normalLength: 1.2, asNormal: true, asPoints: true, width: 3, height: 4 });
  assert(r.meta.color === '#fff' && r.meta.labelColor === '#123456' && r.meta.opacity === 0.4, '样式：合法色值 / 透明度');
  assert(r.meta.vertexSize === 0.3 && r.meta.rightAngleSize === 0.4 && r.meta.normalLength === 1.2, '样式：尺寸参数生效');
  assert(r.meta.width === 3 && r.meta.height === 4 && r.meta.corners.every((c) => approx(dot(sub(c, r.meta.foot), r.meta.nh), 0)), '自定义面片尺寸仍共面');
}
{
  const r = resolvePointplane3D({ point: ['0', '0', '1'], width: '2', height: '2', rightAngleSize: '0.3', normalLength: '0.5', vertexSize: '0.2', opacity: '0.8' });
  assert(r.ok && r.meta.distance === 1 && r.meta.width === 2 && r.meta.rightAngleSize === 0.3 && r.meta.opacity === 0.8, '数字字符串容错全参数');
}
{
  const r = resolvePointplane3D({ id: 'ptpl' }, { objects: [{ id: 'ptpl_pl1' }, { id: 'ptpl_pl1_2' }] });
  assert(r.ok && r.items.every((it) => it.id !== 'ptpl_pl1' && it.id !== 'ptpl_pl1_2'), 'id 冲突自动避让');
  assert(new Set(r.items.map((it) => it.id)).size === r.items.length, '同批 id 唯一');
}
{
  const id64 = 'a'.repeat(64);
  const r = resolvePointplane3D({ id: id64 });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符 id 边界合法且不溢出');
}

section('五、脏输入原子拒绝（零副作用）');
const dirty = [
  ['空命令', null], ['数组命令', []], ['字符串命令', 'x'], ['数字命令', 42],
  ['id 非法路径', { id: '../bad' }], ['id 空格', { id: 'a b' }], ['id 超长', { id: 'a'.repeat(65) }], ['id 数字', { id: 123 }],
  ['point null', { point: null }], ['point 长度 2', { point: [0, 0] }], ['point 脏分量', { point: [0, 0, 'abc'] }],
  ['point 非数组', { point: '0,0,1' }],
  ['points 长度 2', { points: [[0, 0, 0], [1, 0, 0]] }], ['points 共线', { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }],
  ['points 与 center 混用', { points: XY_PLANE, center: [0, 0, 0] }], ['points 与 axis 混用', { points: XY_PLANE, axis: [0, 0, 1] }],
  ['center 非法', { center: [0, 0], axis: [0, 0, 1] }], ['axis 非法', { center: [0, 0, 0], axis: [0, 0] }],
  ['axis 零向量', { center: [0, 0, 0], axis: [0, 0, 0] }],
  ['width 越界小', { width: 0 }], ['width 越界大', { width: 10001 }], ['width 表达式', { width: '1+1' }],
  ['height 越界', { height: -1 }], ['height 非数', { height: null }],
  ['rightAngleSize 小', { rightAngleSize: 0.04 }], ['rightAngleSize 大', { rightAngleSize: 101 }], ['rightAngleSize 脏', { rightAngleSize: 'bad' }],
  ['normalLength 零', { normalLength: 0 }], ['normalLength 大', { normalLength: 10001 }], ['normalLength 脏', { normalLength: [] }],
  ['vertexSize 零', { vertexSize: 0 }], ['vertexSize 大', { vertexSize: 2 }], ['vertexSize 脏', { vertexSize: 'x' }],
  ['opacity 脏', { opacity: 'bad' }], ['opacity null', { opacity: null }],
  ['asPlane 非布尔', { asPlane: 'yes' }], ['labelDistance 非数', { labelDistance: 1 }], ['asNormal 非布尔', { asNormal: 0 }],
  ['八开关全关', { asPlane: false, asPerp: false, asRightAngle: false, labelDistance: false, asPoints: false, asNormal: false, labelPoint: false, labelFoot: false }],
];
for (const [name, cmd] of dirty) {
  assert(resolvePointplane3D(cmd).ok === false, `脏输入拒绝：${name}`);
}

section('六、深度只读性');
{
  const cmd = Object.freeze({
    op: 'pointplane3d',
    point: Object.freeze([0, 0, 1]),
    points: Object.freeze(XY_PLANE.map(Object.freeze)),
  });
  const r = resolvePointplane3D(cmd);
  assert(r.ok, '冻结入参仍成功');
  assert(frozen(cmd.point) && frozen(cmd.point[0]) && frozen(cmd.points) && frozen(cmd.points[0]), '入参未被解冻');
  const m1 = resolvePointplane3D({}).meta;
  const m2 = resolvePointplane3D({}).meta;
  m1.foot[0] = 999;
  assert(m2.foot[0] !== 999, '两次调用输出互相独立');
  assert(r.items.every((it) => it.p && it.p !== cmd), '输出为新构造对象');
}

section('七、执行器常量契约（历史 7~33 条逐字不变）');
assert(BOARD3D_COMPLETE24_OPS.length === 33 && BOARD3D_POINT_PLANE_OPS.length === 1 && BOARD3D_COMPLETE25_OPS.length === 34, 'COMPLETE24 33 / POINT_PLANE 1 / COMPLETE25 34');
assert(BOARD3D_COMPLETE25_OPS.includes('pointplane3d') && BOARD3D_COMPLETE25_OPS.includes('lineplane3d'), '新集含 pointplane3d 且保留 lineplane3d');

section('八、执行器集成');
function makeApi(existingIds = [], addOverride) {
  const known = new Set(existingIds);
  const added = [];
  return {
    added,
    getState: () => ({ objects: [...known].map((id) => ({ id })) }),
    add: addOverride ? (item) => addOverride(item, known, added) : (item) => { added.push(item); known.add(item.id); return true; },
  };
}
{
  const api = makeApi();
  const res = applyBoard3DCommands([{ op: 'pointplane3d', id: 'ptpl', asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'pointplane3d', '执行器：pointplane3d 成功');
  assert(res[0].meta.distance === 1 && res[0].created.length === api.added.length, '执行器：meta 与 created 完整');
  assert(api.added.every((it) => ['line', 'point', 'label'].includes(it.type)), '执行器：产出合法图元');
}
{
  const api = makeApi(['ptpl_pl1']);
  const res = applyBoard3DCommands([{ op: 'pointplane3d', id: 'ptpl' }], api);
  assert(res[0].ok === true && !res[0].failed && api.added.every((it) => it.id !== 'ptpl_pl1'), '执行器：id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'pointplane3d' }], api);
  assert(res[0].ok === true && res[0].created.length > 0, '执行器：getState 抛错降级为空场景，整批不中断');
}
{
  const api = { add: () => true };
  const res = applyBoard3DCommands([{ op: 'pointplane3d' }], api);
  assert(res[0].ok === true, '执行器：getState 缺失降级为空场景');
}
{
  const api = makeApi([], (item, known, added) => { if (item.type === 'point') return false; added.push(item); known.add(item.id); return true; });
  const res = applyBoard3DCommands([{ op: 'pointplane3d', asPoints: true }], api);
  assert(res[0].ok === false && res[0].failed.length === 2, '执行器：api.add 返回 false 分项回报（2 个小球）');
}
{
  const api = makeApi();
  const res = applyBoard3DCommands([{ op: 'add3d', id: 'b', type: 'box' }], api);
  assert(res.some((r) => r.op === 'add3d' && r.ok), '执行器：既有 add3d 仍工作（基础命令零回归）');
}
{
  const api = makeApi();
  const res = applyBoard3DCommands([{ op: 'circle', id: 'c' }], api);
  assert(res[0].ok === false && /3D 分支不识别 2D/.test(res[0].error), '执行器：2D 命令被 3D 分支拒绝');
}
{
  const res = applyBoard3DCommands([{ op: 'pointplane3d', rightAngleSize: 'bad' }], makeApi());
  assert(res[0].ok === false && /rightAngleSize/.test(res[0].error), '执行器：脏输入原子拒绝且不落地');
}

section('九、共享文件协议两侧一致性');
assert(BOARD3D_POINT_PLANE_PROMPT.includes('pointplane3d') && BOARD3D_POINT_PLANE_PROMPT_OPS.length === 1 && BOARD3D_POINT_PLANE_PROMPT_OPS[0] === 'pointplane3d', '提示词段含 pointplane3d 命令');
assert(BOARD3D_POINT_PLANE_PROMPT.includes('|PH|=d=') && BOARD3D_POINT_PLANE_PROMPT.includes('center+axis') && BOARD3D_POINT_PLANE_PROMPT.includes('d='), '提示词段含守恒与定面说明');
{
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_POINT_PLANE_PROMPT'), 'backend 引用 POINT_PLANE_PROMPT');
  assert(be.includes('BOARD3D_LINEPLANE_PROMPT + BOARD3D_POINT_PLANE_PROMPT'), 'backend 3D 提示词拼接末尾追加 POINT_PLANE');
}
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画正方体的点到面距离') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolvePointplane3D \} from '\.\/board3d-pointplane\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'pointplane3d'/.test(exec), '执行器含 case pointplane3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_POINT_PLANE_PROMPT') && bp.includes('BOARD3D_LINEPLANE_PROMPT') && bp.includes('BOARD3D_DIHEDRAL_PROMPT') && bp.includes('BOARD3D_PLANE_PROMPT'), '共享文件含新段且保留既有段（纯追加）');
  // 最高优先级：共享文件必须字节级纯追加，上方任何内容（含 2D 主干与既有 3D 段）逐字不动
  const oldBp = readHead('ai/board-prompt.js');
  assert(bp.startsWith(oldBp), `ai/board-prompt.js 字节级纯追加（旧 ${oldBp.length} 字节为新前缀，未覆盖 2D 主干或既有 3D 段）`);
  const oldBe = readHead('ai/board-backend.js');
  assert(read('ai/board-backend.js').length >= oldBe.length, 'backend 未被截断（3D 引用仅追加、不回退）');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('pointplane3d') && ai3.includes('lineplane3d') && ai3.includes('dihedral3d'), 'AI 面板结果展示含 pointplane3d 且保留既有展示');
  const html = read('board3d.html');
  assert(html.includes('pointplane3d') && html.includes('lineplane3d') && html.includes('dihedral3d'), 'board3d.html AI tip 含 pointplane3d 且保留既有段');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D34') && doc.includes('pointplane3d'), '回归清单含 D34 记录');
  // 本任务职责范围：未触碰 2D 主干
  assert(read('js/board.js').length > 0 && read('js/executor.js').length > 0, '2D 主干文件仍存在（未删除）');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  assert(/importmap|three/.test(html), 'board3d.html 仍本地/自研 Three.js 引用');
  const conv = read('docs/3D画板回归用例清单.md');
  assert(conv.includes('D33') && conv.includes('lineplane3d'), '既有 D33 用例记录未被删除');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

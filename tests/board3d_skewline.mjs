/**
 * 3D 两异面直线公垂线与距离命令（skewline3d · D35）无头回归。
 *
 * 覆盖：skewlineCommonPerpendicular / resolveSkewline3D 纯函数
 *       （默认异面 d=1、正交守恒、相交/平行/共线退化、斜向异面、数字字符串、延长、
 *        直角符号方向、开关组合、样式、id 避让与 64 字符边界、脏输入原子拒绝、深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_skewline.mjs
 */
import {
  BOARD3D_SKEWLINE_PROMPT, BOARD3D_SKEWLINE_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  SKEWLINE3D_EXTEND_MIN, SKEWLINE3D_EXTEND_MAX, SKEWLINE3D_EXTEND_DEFAULT,
  SKEWLINE3D_RIGHT_ANGLE_MIN, SKEWLINE3D_RIGHT_ANGLE_MAX, SKEWLINE3D_RIGHT_ANGLE_DEFAULT,
  SKEWLINE3D_VERTEX_SIZE_MIN, SKEWLINE3D_VERTEX_SIZE_MAX, SKEWLINE3D_VERTEX_SIZE_DEFAULT,
  SKEWLINE3D_MAX_SEGMENTS, SKEWLINE3D_DEFAULT_FROM1, SKEWLINE3D_DEFAULT_TO1,
  SKEWLINE3D_DEFAULT_FROM2, SKEWLINE3D_DEFAULT_TO2,
  num, skewlineCommonPerpendicular, resolveSkewline3D,
} from '../js/board3d-skewline.js';
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
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && b.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);
const DEFAULT = { from1: [0, 0, 0], to1: [2, 0, 0], from2: [1, 1, -1], to2: [1, 1, 2] };

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
assert(BOARD3D_SKEWLINE_OPS.length === 1 && BOARD3D_SKEWLINE_OPS[0] === 'skewline3d' && BOARD3D_COMPLETE26_OPS.length === 35, 'SKEWLINE 1 / COMPLETE26 35');
assert(frozen(BOARD3D_SKEWLINE_OPS) && frozen(BOARD3D_COMPLETE26_OPS) && BOARD3D_COMPLETE26_OPS.includes('pointplane3d'), '扩展集冻结且含历史命令');
assert(SKEWLINE3D_EXTEND_MIN === 0 && SKEWLINE3D_EXTEND_MAX === 1000 && SKEWLINE3D_EXTEND_DEFAULT === 0, 'extend 常量');
assert(SKEWLINE3D_RIGHT_ANGLE_MIN === 0.05 && SKEWLINE3D_RIGHT_ANGLE_MAX === 100 && SKEWLINE3D_RIGHT_ANGLE_DEFAULT === 0.25, 'rightAngleSize 常量');
assert(SKEWLINE3D_VERTEX_SIZE_MIN === 0.01 && SKEWLINE3D_VERTEX_SIZE_MAX === 1 && SKEWLINE3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量');
assert(SKEWLINE3D_MAX_SEGMENTS === 4096 && frozen(SKEWLINE3D_DEFAULT_FROM1) && frozen(SKEWLINE3D_DEFAULT_TO2), '上限与默认点冻结');
assert(num('1.5') === 1.5 && num(0) === 0 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 严格数值解析');

section('二、纯函数几何守恒');
{
  const c = skewlineCommonPerpendicular(DEFAULT.from1, DEFAULT.to1, DEFAULT.from2, DEFAULT.to2);
  assert(c.ok && c.kind === 'skew' && approx(c.distance, 1), '默认异面直线 d=1');
  assert(vecApprox(c.q1, [1, 0, 0]) && vecApprox(c.q2, [1, 1, 0]), '默认垂足 M/N 坐标');
  const mn = sub(c.q2, c.q1);
  assert(approx(dot(mn, c.u), 0) && approx(dot(mn, c.v), 0), 'MN 同时垂直两条直线');
  assert(approx(norm(c.n), 1) && approx(dot(mn, c.n), c.distance), '单位法向 M→N 且与 MN 同向');
  assert(approx(c.t, 0.5) && approx(c.s, 1 / 3, 1e-3), '参数 t/s 正确');
  assert([c.q1, c.q2, c.n, c.u, c.v].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)), '核心返回向量结构完整且有限');
}
{
  // 交换直线上的两点：方向取反不改变距离与垂足
  const a = skewlineCommonPerpendicular([0, 0, 0], [2, 0, 0], [1, 1, -1], [1, 1, 2]);
  const b = skewlineCommonPerpendicular([2, 0, 0], [0, 0, 0], [1, 1, 2], [1, 1, -1]);
  assert(a.ok && b.ok && approx(a.distance, b.distance), '反向取点距离不变');
  assert(vecApprox(a.q1, b.q1) && vecApprox(a.q2, b.q2), '反向取点垂足不变');
}
{
  // 斜向异面：L1 为 (t,2t,0)，L2 过 (0,1,1) 方向 (0,0,1)，公垂距 1/√5
  const c = skewlineCommonPerpendicular([0, 0, 0], [1, 2, 0], [0, 1, 0], [0, 1, 3]);
  const mn = sub(c.q2, c.q1);
  assert(c.ok && c.kind === 'skew' && approx(c.distance, 1 / Math.sqrt(5), 3e-3), '斜向异面距离 1/√5');
  assert(approx(dot(mn, c.u), 0) && approx(dot(mn, c.v), 0), '斜向异面 MN 正交两线');
  assert(approx(dot(c.q1, [2, -1, 0]), 0, 3e-3), 'M 落在 L1 上');
}
{
  // 相交：x 轴与过 (1,0,0) 的 y 向直线
  const c = skewlineCommonPerpendicular([0, 0, 0], [2, 0, 0], [1, 0, -1], [1, 0, 1]);
  assert(c.ok && c.kind === 'intersect' && approx(c.distance, 0), '相交直线 d=0');
  assert(vecApprox(c.q1, [1, 0, 0]) && vecApprox(c.q2, [1, 0, 0]), '相交垂足重合于交点');
}
{
  // 平行：x 轴与 y=2 的 x 向直线
  const c = skewlineCommonPerpendicular([0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0]);
  assert(c.ok && c.kind === 'parallel' && approx(c.distance, 2), '平行直线 d=2');
  assert(vecApprox(c.q1, [0, 0, 0]) && vecApprox(c.q2, [0, 2, 0]), '平行情形 M=from1、N 为垂足');
  const mn = sub(c.q2, c.q1);
  assert(approx(dot(mn, c.u), 0) && approx(dot(mn, c.v), 0), '平行情形 MN 正交两线');
}
{
  // 共线
  const c = skewlineCommonPerpendicular([0, 0, 0], [2, 0, 0], [1, 0, 0], [3, 0, 0]);
  assert(c.ok && c.kind === 'collinear' && approx(c.distance, 0), '共线 d=0 合法');
  assert(approx(norm(c.n), 1), '共线退化仍给单位法向');
}
{
  const bad = [
    [[0, 0, 0], [0, 0, 0], [1, 1, 0], [1, 1, 2]],
    [[0, 0, 0], [2, 0, 0], [1, 1, 0], [1, 1, 0]],
    [null, [2, 0, 0], [1, 1, 0], [1, 1, 2]],
    [[0, 0], [2, 0, 0], [1, 1, 0], [1, 1, 2]],
  ];
  assert(bad.every((args) => skewlineCommonPerpendicular(...args).ok === false), '几何核心拒绝退化点与非法点');
}

section('三、resolveSkewline3D 命令解析与输出对象');
{
  const r = resolveSkewline3D({}, {});
  assert(r.ok && r.meta.distance === 1 && r.meta.kind === 'skew', '最小命令默认出图');
  assert(r.items.length === 8 && r.meta.segmentCount === 7 && r.meta.itemCount === 8, '默认输出 2 直线 + 1 公垂线 + 4 直角段 + 1 距离标注 共 8 项');
  assert(r.items.filter((i) => i.type === 'line').length === 7 && r.items.filter((i) => i.type === 'label').length === 1, '默认对象类型正确');
  assert(r.items.every((i) => i.pos && i.rot && i.scale && i.color && typeof i.id === 'string'), '对象结构含完整姿态与样式字段');
  const line = r.items[2];
  assert(Array.isArray(line.p.x1) === false && ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(line.p[k])), '公垂线段 p 六坐标有限');
  assert(vecApprox([line.p.x1, line.p.y1, line.p.z1], [1, 0, 0]) && vecApprox([line.p.x2, line.p.y2, line.p.z2], [1, 1, 0]), '公垂线段端点为 M/N');
}
{
  const r = resolveSkewline3D({ ...DEFAULT, extend: 2, rightAngleSize: 0.5, asPoints: true, labelFeet: true, color: '#123456', labelColor: '#abcdef', opacity: 0.6 }, {});
  assert(r.ok && r.items.length === 12 && r.meta.segmentCount === 7, '全开输出 12 项（7 线段 + 2 小球 + 3 标注）');
  assert(r.meta.lineCount === 7 && r.meta.commonCount === 1 && r.meta.rightAngleCount === 4 && r.meta.pointCount === 2 && r.meta.labelCount === 3, 'meta 计数正确');
  assert(vecApprox(r.meta.lineEnds[0], [-2, 0, 0]) && vecApprox(r.meta.lineEnds[1], [4, 0, 0]), 'extend 向两端延长');
  assert(vecApprox(r.meta.lineEnds[2], [1, 1, -3]) && vecApprox(r.meta.lineEnds[3], [1, 1, 4]), '第二条线同样延长');
  assert(r.items.every((i) => i.color === '#123456' || i.type === 'label' && i.color === '#abcdef'), '颜色样式生效');
  assert(r.items.every((i) => i.type !== 'line' || approx(i.opacity, 0.6)), '透明度生效');
  assert(r.items.filter((i) => i.type === 'point').every((i) => approx(i.p.s, 0.1)), '小球尺寸生效');
  const texts = r.items.filter((i) => i.type === 'label').map((i) => i.text);
  assert(texts.includes('d=1') && texts.includes('M') && texts.includes('N'), '距离与垂足名称标注');
}
{
  const q = resolveSkewline3D({ rightAngleSize: 0.5, asLines: false, asCommon: false, labelDistance: false }, {});
  assert(q.ok && q.items.length === 4 && q.meta.segmentCount === 4, '只开直角符号：4 段');
  const rm = q.meta.rightAngleM;
  const rn = q.meta.rightAngleN;
  assert(approx(dot(sub(rm[1], rm[0]), q.meta.unitU), 0.5) && approx(dot(sub(rm[2], rm[1]), q.meta.normal), 0.5), 'M 处直角两边 ∥ u 与 ∥ n');
  assert(approx(dot(sub(rn[1], rn[0]), q.meta.unitV), 0.5) && approx(dot(sub(rn[2], rn[1]), q.meta.normal), -0.5), 'N 处直角两边 ∥ v 与 ∥ −n');
  assert(approx(dot(sub(rm[1], rm[0]), sub(rm[2], rm[1])), 0), 'M 处直角符号两边垂直');
  assert(approx(dot(sub(rn[1], rn[0]), sub(rn[2], rn[1])), 0), 'N 处直角符号两边垂直');
}
{
  const s = resolveSkewline3D({ from1: ['0', '0', '0'], to1: ['2', '0', '0'], from2: ['1', '1', '-1'], to2: ['1', '1', '2'], extend: '1', rightAngleSize: '0.3', vertexSize: '0.2', opacity: '0.8', asPoints: true }, {});
  assert(s.ok && approx(s.meta.extend, 1) && approx(s.meta.rightAngleSize, 0.3) && approx(s.meta.vertexSize, 0.2) && approx(s.meta.opacity, 0.8), '数字字符串容错');
}
{
  const state = { objects: [{ id: 'skl_l1' }, { id: 'skl_l1_2' }, { id: 'skl_com' }] };
  const r = resolveSkewline3D({ id: 'skl' }, state);
  const ids = r.items.map((i) => i.id);
  assert(new Set(ids).size === ids.length && !ids.some((id) => state.objects.some((o) => o.id === id)), 'id 避让冲突');
  assert(ids.includes('skl_l1_3') && ids.includes('skl_com_2'), '冲突 id 依次加后缀');
  const long = resolveSkewline3D({ id: 'x'.repeat(64) }, { objects: [] });
  assert(long.ok && long.items.every((i) => i.id.length <= 64), 'id 64 字符边界收敛');
}
{
  const cmd = Object.freeze({ ...DEFAULT, asPoints: true, labelFeet: true });
  const snap = JSON.stringify(cmd);
  const st = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'skl_l1' })]) });
  const r = resolveSkewline3D(cmd, st);
  assert(r.ok && JSON.stringify(cmd) === snap, '冻结 cmd 深度只读');
  assert(JSON.stringify(st) === '{"objects":[{"id":"skl_l1"}]}', '冻结 state 深度只读');
}
{
  const bad = [
    null, [], 'x',
    { id: 123 }, { id: 'a b' }, { id: '' },
    { from1: null }, { to1: [1, 2] }, { from2: [0, 0, 'x'] }, { to2: {} },
    { from1: [0, 0, 0], to1: [0, 0, 0] },
    { extend: 'x' }, { extend: -1 }, { extend: 1001 }, { extend: NaN },
    { rightAngleSize: 0 }, { rightAngleSize: 101 }, { rightAngleSize: 'x' },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: false },
    { opacity: 'x' }, { opacity: [] },
    { asLines: 'yes' }, { asCommon: 1 }, { asRightAngle: null }, { asPoints: 'true' }, { labelDistance: 0 }, { labelFeet: 'no' },
    { asLines: false, asCommon: false, asRightAngle: false, asPoints: false, labelDistance: false, labelFeet: false },
  ];
  assert(bad.every((c) => resolveSkewline3D(c, {}).ok === false), `脏输入原子拒绝（${bad.length} 组）`);
  assert(resolveSkewline3D({ ...DEFAULT, from1: [0, 0, 0], to1: [0, 0, 0] }, { objects: [] }).ok === false, '方向退化整条拒绝、零副作用');
}

section('四、执行器集成（与 2D 执行器隔离）');
{
  const created = [];
  const api = { add: (o) => { created.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'skewline3d', id: 'skl', labelFeet: true, asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'skewline3d' && res[0].count === 12, '执行器返回成功与项数');
  assert(created.length === 12 && created.every((o) => o.type === 'line' || o.type === 'point' || o.type === 'label'), '12 项全部落地为 3D 对象');
  assert(res[0].meta.kind === 'skew' && approx(res[0].meta.distance, 1), 'meta 透传距离与类型');
}
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [{ id: 'skl_l1' }, { id: 'skl_com' }] }) };
  // 语义层已从 getState 避让已有 id；这里用同批两条同 id 命令制造执行器级冲突。
  const res = applyBoard3DCommands([{ op: 'skewline3d', id: 'skl' }, { op: 'skewline3d', id: 'skl' }], api);
  assert(res[0].ok && res[1].ok === false && res[1].failed && res[1].failed.length === 8, '同批 id 冲突分项失败，第二条整批回报 ok=false');
  assert(added.length === 8, '冲突项不落地，仅第一条 8 项正常落地');
  assert(res[0].created.every((c) => !['skl_l1', 'skl_com'].includes(c.id)), '语义层已避让场景原有 id');
}
{
  const api = { add: () => true };
  const res = applyBoard3DCommands([{ op: 'skewline3d' }], api);
  assert(res[0].ok && res[0].count === 8, 'getState 缺失降级为空场景');
  const api2 = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res2 = applyBoard3DCommands([{ op: 'skewline3d' }], api2);
  assert(res2[0].ok && res2[0].count === 8, 'getState 抛错降级为空场景');
}
{
  let n = 0;
  const api = { add: () => (++n === 1 ? false : true), getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'skewline3d' }], api);
  assert(res[0].ok === false && res[0].failed.length === 1 && res[0].created.length === 7, 'api 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'circle' }, { op: 'intersect' }, { op: 'skewline3d', asLines: false, labelDistance: false }], api);
  assert(res[0].ok === false && res[1].ok === false && /不识别 2D 命令/.test(res[0].error + res[1].error), '2D 命令在 3D 分支被拒绝');
  assert(res[2].ok === true && res[2].count === 5, '3D 命令与 2D 命令同批互不影响');
}
{
  const r = applyBoard3DCommands([{ op: 'skewline3d', from1: [0, 0, 0], to1: [0, 0, 0] }], { add: () => true });
  assert(r[0].ok === false && /重合/.test(r[0].error), '执行器透传语义层错误');
}

section('五、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_SKEWLINE_PROMPT_OPS.length === 1 && BOARD3D_SKEWLINE_PROMPT_OPS[0] === 'skewline3d', '提示词 op 与执行器 op 一致');
assert(BOARD3D_SKEWLINE_PROMPT.includes('skewline3d') && BOARD3D_SKEWLINE_PROMPT.includes('from1') && BOARD3D_SKEWLINE_PROMPT.includes('asRightAngle'), '提示词含完整命令格式');
assert(BOARD3D_SKEWLINE_PROMPT.includes('相交时 d=0') && BOARD3D_SKEWLINE_PROMPT.includes('平行') && BOARD3D_SKEWLINE_PROMPT.includes('共线'), '提示词说明退化情形');
assert(BOARD3D_SKEWLINE_PROMPT.includes('2D 的距离 / 垂线命令在本分支依旧不认识'), '提示词保持 3D/2D 分支隔离铁律');
assert(resolveBoardMode({ detect3d: true, message: '画两条异面直线的公垂线' }, '画两条异面直线的公垂线') === '3d', '显式 detect3d 时异面直线意图进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '求两直线的公垂线与距离') === '3d', '公垂线关键词进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '画点到平面的距离') === '3d', '点面距关键词进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '画二面角') === '3d', '二面角关键词进入 3D 命令集');
assert(resolveBoardMode({ message: '画一个圆' }, '画一个圆') === '2d', '未开启 detect3d 保持 2D 主干');
assert(resolveBoardMode({ detect3d: true }, '画一个圆和一条直线') === '2d', '2D 通用词不误切 3D');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SKEWLINE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("sk.op !== 'skewline3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('skewline3d 给两条空间直线各两点'), '画板面板工具说明已追加');

section('六、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  const committed = headPrompt.includes('BOARD3D_SKEWLINE_PROMPT');
  assert(committed ? nowPrompt === headPrompt : nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SKEWLINE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_POINT_PLANE_PROMPT'), '新段追加在既有段之后');
  assert(read('ai/board-prompt.js').includes('2D 主干'), '2D 主干标志仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  assert(nowBackend.split('\n').length === headBackend.split('\n').length + 1, '后端仅新增一行注释（import / 拼接为行内追加）');
}
{
  const headHtml = readHead('board3d.html');
  const nowHtml = read('board3d.html');
  assert(!headHtml.includes('skewline3d 给两条空间直线') && nowHtml.includes('skewline3d 给两条空间直线'), 'board3d.html 只追加工具提示');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'pointplane3d'") && read('js/board3d-executor.js').includes("case 'skewline3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

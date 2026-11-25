/**
 * 3D 点到空间直线的距离命令（pointline3d · D37）无头回归。
 *
 * 覆盖：pointlineCore / pointlineFoot / pointlineDistance / resolvePointline3D 纯函数
 *       （默认 d=2、斜向与非共面点、点落直线退化、线段钳制、
 *        垂足在线/垂线⊥直线/距离=|叉积| 守恒、直角符号垂直、
 *        开关组合、样式、id 避让与 64 字符边界、脏输入原子拒绝、深度只读性）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、3D 意图分支、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_pointline.mjs
 */
import {
  BOARD3D_POINT_LINE_PROMPT, BOARD3D_POINT_LINE_PROMPT_OPS,
  isPointline3DIntent,
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
  BOARD3D_POINT_LINE_OPS, BOARD3D_COMPLETE28_OPS,
} from '../js/board3d-executor.js';
import {
  POINTLINE3D_EXTEND_MIN, POINTLINE3D_EXTEND_MAX, POINTLINE3D_EXTEND_DEFAULT,
  POINTLINE3D_RIGHT_ANGLE_MIN, POINTLINE3D_RIGHT_ANGLE_MAX, POINTLINE3D_RIGHT_ANGLE_DEFAULT,
  POINTLINE3D_VERTEX_SIZE_MIN, POINTLINE3D_VERTEX_SIZE_MAX, POINTLINE3D_VERTEX_SIZE_DEFAULT,
  POINTLINE3D_MAX_SEGMENTS, POINTLINE3D_DEFAULT_POINT, POINTLINE3D_DEFAULT_FROM,
  POINTLINE3D_DEFAULT_TO,
  num, pointlineCore, pointlineFoot, pointlineDistance, resolvePointline3D,
} from '../js/board3d-pointline.js';
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
const DEFAULT = { point: [1, 2, 0], from: [0, 0, 0], to: [2, 0, 0] };
const SKEW = { point: [0, 3, 4], from: [0, 0, 0], to: [1, 0, 0] };

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
assert(BOARD3D_SKEWLINE_OPS.length === 1 && BOARD3D_COMPLETE26_OPS.length === 35, 'COMPLETE26 35');
assert(BOARD3D_LINE_ANGLE_OPS.length === 1 && BOARD3D_COMPLETE27_OPS.length === 36, 'COMPLETE27 36');
assert(BOARD3D_POINT_LINE_OPS.length === 1 && BOARD3D_POINT_LINE_OPS[0] === 'pointline3d' && BOARD3D_COMPLETE28_OPS.length === 37, 'POINT_LINE 1 / COMPLETE28 37');
assert(frozen(BOARD3D_POINT_LINE_OPS) && frozen(BOARD3D_COMPLETE28_OPS) && BOARD3D_COMPLETE28_OPS.includes('lineangle3d') && BOARD3D_COMPLETE28_OPS.includes('skewline3d'), '扩展集冻结且含历史命令');
assert(POINTLINE3D_EXTEND_MIN === 0 && POINTLINE3D_EXTEND_MAX === 1000 && POINTLINE3D_EXTEND_DEFAULT === 0, 'extend 常量');
assert(POINTLINE3D_RIGHT_ANGLE_MIN === 0.05 && POINTLINE3D_RIGHT_ANGLE_MAX === 100 && POINTLINE3D_RIGHT_ANGLE_DEFAULT === 0.25, 'rightAngleSize 常量');
assert(POINTLINE3D_VERTEX_SIZE_MIN === 0.01 && POINTLINE3D_VERTEX_SIZE_MAX === 1 && POINTLINE3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量');
assert(POINTLINE3D_MAX_SEGMENTS === 4096 && frozen(POINTLINE3D_DEFAULT_POINT) && frozen(POINTLINE3D_DEFAULT_FROM) && frozen(POINTLINE3D_DEFAULT_TO), '上限与默认点冻结');
assert(num('1.5') === 1.5 && num(0) === 0 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 严格数值解析');

section('二、pointlineCore 几何守恒');
{
  const c = pointlineCore(DEFAULT.point, DEFAULT.from, DEFAULT.to);
  assert(c.ok && vecApprox(c.foot, [1, 0, 0]) && approx(c.distance, 2) && approx(c.projection || c.t, 1), '默认点到 x 轴：垂足 [1,0,0]、d=2');
  assert(vecApprox(c.unit, [1, 0, 0]) && approx(c.lineLength, 2) && !c.clamped && !c.onLine, '默认单位方向与未钳制标记');
  assert(approx(dot(c.unit, c.unit), 1) && approx(dot(c.perpDir, c.perpDir), 1) && approx(dot(c.binormal, c.binormal), 1), '三个方向均为单位向量');
  assert(approx(dot(c.unit, c.perpDir), 0) && approx(dot(c.unit, c.binormal), 0) && approx(dot(c.perpDir, c.binormal), 0), '三方向两两正交');
  assert(vecApprox(cross(c.unit, c.perpDir), c.binormal), '叉积与辅助基一致');
}
{
  const P = [2, 3, 6], A = [1, 0, 0], B = [1, 2, 0];
  const c = pointlineCore(P, A, B);
  const eu = c.unit;
  const dCross = norm(cross(sub(P, A), eu));
  assert(c.ok && approx(c.distance, dCross), '斜向点距离 = |(P−from)×eu|');
  const w = sub(P, c.foot);
  assert(approx(dot(w, eu), 0), '垂线 PH ⊥ 直线方向');
  assert(approx(norm(cross(sub(c.foot, A), eu)), 0), '垂足恒落在无限直线上');
  assert(approx(norm(w), c.distance), '|PH|=d');
}
{
  const c = pointlineCore(SKEW.point, SKEW.from, SKEW.to);
  assert(c.ok && approx(c.distance, 5) && vecApprox(c.foot, [0, 0, 0]), '非共面点 [0,3,4] 到 x 轴 d=5');
  assert(approx(pointlineDistance(SKEW.point, SKEW.from, SKEW.to), 5), 'pointlineDistance 与 core 一致');
  assert(vecApprox(pointlineFoot(DEFAULT.point, DEFAULT.from, DEFAULT.to), [1, 0, 0]), 'pointlineFoot 与 core 一致');
}
{
  const on = pointlineCore([1, 0, 0], [0, 0, 0], [2, 0, 0]);
  assert(on.ok && on.onLine && on.distance === 0 && approx(dot(on.unit, on.perpDir), 0), '点落直线上：d=0 且退化方向仍垂直');
}
{
  const clipped = pointlineCore([5, 2, 0], [0, 0, 0], [2, 0, 0], true);
  assert(clipped.ok && clipped.clamped && vecApprox(clipped.foot, [2, 0, 0]) && approx(clipped.distance, Math.sqrt(13)), '钳制到线段：垂足=端点、d=|P−B|');
  const inside = pointlineCore([1, 2, 0], [0, 0, 0], [2, 0, 0], true);
  assert(inside.ok && !inside.clamped && vecApprox(inside.foot, [1, 0, 0]) && approx(inside.distance, 2), '投影落在线段内时钳制不改变垂足');
  assert(approx(pointlineDistance([5, 2, 0], [0, 0, 0], [2, 0, 0], true), Math.sqrt(13)), 'pointlineDistance 支持钳制');
  assert(approx(pointlineDistance([-1, 2, 0], [0, 0, 0], [2, 0, 0], true), Math.sqrt(5)), '负向投影也钳制到起点');
}
{
  const numStr = pointlineCore(['1', '2', '0'], ['0', '0', '0'], ['2', '0', '0']);
  assert(numStr.ok && approx(numStr.distance, 2), '数字字符串坐标容错');
  const bad = [
    [null, [0, 0, 0], [1, 0, 0]], [[1, 2], [0, 0, 0], [1, 0, 0]],
    [[1, 2, 0], null, [1, 0, 0]], [[1, 2, 0], [0, 0, 0], [0, 0, 0]],
    [[1, 2, NaN], [0, 0, 0], [1, 0, 0]], [[1, 2, 0], [0, 0, 'x'], [1, 0, 0]],
    [[1, 2, 0], [0, 0, 0], [1, 0, Infinity]],
  ];
  assert(bad.every((args) => pointlineCore(...args).ok === false), `几何核心拒绝退化点与非法点（${bad.length} 组）`);
  assert(pointlineFoot([1, 2, 0], [0, 0, 0], [0, 0, 0]) === null && pointlineDistance([1, 2, 0], [0, 0, 0], [0, 0, 0]) === null, '工具函数在退化直线返回 null');
}

section('三、resolvePointline3D 命令解析与输出对象');
{
  const r = resolvePointline3D({}, {});
  assert(r.ok && approx(r.meta.distance, 2) && vecApprox(r.meta.foot, [1, 0, 0]) && approx(r.meta.projection, 1), '最小命令默认出图 d=2');
  assert(r.items.length === 5 && r.meta.segmentCount === 4 && r.meta.itemCount === 5, '默认输出 4 线段 + 1 距离标注 共 5 项');
  assert(r.items.filter((i) => i.type === 'line').length === 4 && r.items.filter((i) => i.type === 'label').length === 1, '默认对象类型正确');
  assert(r.items.every((i) => i.pos && i.rot && i.scale && i.color && typeof i.id === 'string'), '对象结构含完整姿态与样式字段');
  assert(['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(r.items[0].p[k])), '线段 p 六坐标有限');
  assert(r.items.filter((i) => i.type === 'label')[0].text === 'd=2', '距离读数文本正确');
  assert(r.meta.rightAngleDrawn && r.meta.rightAngleCount === 2 && !r.meta.onLine && !r.meta.clamped, '默认画直角符号');
}
{
  const r = resolvePointline3D(SKEW, {});
  assert(r.ok && approx(r.meta.distance, 5) && vecApprox(r.meta.foot, [0, 0, 0]), '斜向点独立命令正确');
  const [q1, q2, q3] = r.meta.rightAngle;
  assert(r.meta.rightAngleDrawn, '非退化点画直角符号');
  assert(approx(dot(sub(q1, r.meta.foot), r.meta.unit), r.meta.rightAngleSize, 3e-3), '直角符号第一边 ∥ eu');
  assert(approx(dot(sub(q2, q1), r.meta.perpDir), r.meta.rightAngleSize, 3e-3), '直角符号第二边 ∥ perpDir');
  assert(approx(dot(sub(q1, r.meta.foot), sub(q2, q1)), 0, 3e-3), '直角符号两边互相垂直');
  assert(vecApprox(q3, [0, 1, 2].map((k) => r.meta.foot[k] + r.meta.rightAngleSize * r.meta.perpDir[k])), '直角符号第三点回到垂足侧');
}
{
  const r = resolvePointline3D({ point: [1, 0, 0] }, {});
  assert(r.ok && r.meta.onLine && r.meta.distance === 0 && r.meta.perpCount === 0 && r.meta.rightAngleCount === 0, '点落直线：不画零长垂线与直角符号');
  assert(r.items.length === 2 && r.meta.segmentCount === 1, '退化时仅直线 + 距离标注');
}
{
  const r = resolvePointline3D({ point: [5, 2, 0], clampToSegment: true }, {});
  assert(r.ok && r.meta.clamped && vecApprox(r.meta.foot, [2, 0, 0]) && approx(r.meta.distance, Math.sqrt(13)), '钳制命令透传 meta');
  assert(!r.meta.rightAngleDrawn && r.meta.rightAngleCount === 0 && r.meta.perpCount === 1, '钳制出端点时省略直角符号但保留垂线段');
  assert(r.items.length === 3 && r.meta.segmentCount === 2, '钳制输出 3 项');
}
{
  const r = resolvePointline3D({
    ...DEFAULT, extend: 2, rightAngleSize: 0.5, asPoints: true, labelPoint: true,
    labelFoot: true, labelLine: true, color: '#123456', labelColor: '#abcdef', opacity: 0.6,
  }, {});
  assert(r.ok && approx(r.meta.extend, 2) && approx(r.meta.rightAngleSize, 0.5), 'extend / rightAngleSize 生效');
  assert(r.meta.pointCount === 4 && r.meta.labelCount === 5 && r.items.length === 13, '全开计数正确（1+1+2+4+5）');
  assert(r.items.filter((i) => i.type === 'label').map((i) => i.text).join(',') === 'd=2,P,H,A,B', '距离与四点名称标注齐全');
  assert(r.items.every((i) => i.color === '#123456' || (i.type === 'label' && i.color === '#abcdef')), '颜色样式生效');
  assert(r.items.every((i) => i.type !== 'line' || approx(i.opacity, 0.6)), '透明度生效');
  assert(r.items.filter((i) => i.type === 'point').every((i) => approx(i.p.s, 0.1)), '小球尺寸生效');
  assert(vecApprox(r.meta.lineEnds[0], [-2, 0, 0]) && vecApprox(r.meta.lineEnds[1], [4, 0, 0]), 'extend 向两端延长');
}
{
  const s = resolvePointline3D({
    point: ['1', '2', '0'], from: ['0', '0', '0'], to: ['2', '0', '0'],
    extend: '1', rightAngleSize: '0.3', vertexSize: '0.2', opacity: '0.8', asPoints: true,
  }, {});
  assert(s.ok && approx(s.meta.extend, 1) && approx(s.meta.rightAngleSize, 0.3) && approx(s.meta.vertexSize, 0.2) && approx(s.meta.opacity, 0.8), '数字字符串容错');
}
{
  const state = { objects: [{ id: 'ptln_line' }, { id: 'ptln_line_2' }, { id: 'ptln_dist' }] };
  const r = resolvePointline3D({ id: 'ptln' }, state);
  const ids = r.items.map((i) => i.id);
  assert(new Set(ids).size === ids.length && !ids.some((id) => state.objects.some((o) => o.id === id)), 'id 避让冲突');
  assert(ids.includes('ptln_line_3') && ids.includes('ptln_dist_2'), '冲突 id 依次加后缀');
  const long = resolvePointline3D({ id: 'x'.repeat(64) }, { objects: [] });
  assert(long.ok && long.items.every((i) => i.id.length <= 64), 'id 64 字符边界收敛');
}
{
  const cmd = Object.freeze({ ...DEFAULT, asPoints: true, labelLine: true });
  const snap = JSON.stringify(cmd);
  const st = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ptln_line' })]) });
  const r = resolvePointline3D(cmd, st);
  assert(r.ok && JSON.stringify(cmd) === snap, '冻结 cmd 深度只读');
  assert(JSON.stringify(st) === '{"objects":[{"id":"ptln_line"}]}', '冻结 state 深度只读');
  assert(r !== cmd && r.items !== cmd.items, '输出全新对象、无入参引用泄漏');
}
{
  const bad = [
    null, [], 'x',
    { id: 123 }, { id: 'a b' }, { id: '' },
    { point: null }, { point: [1, 2] }, { from: [0, 0, 'x'] }, { to: {} },
    { from: [0, 0, 0], to: [0, 0, 0] },
    { extend: 'x' }, { extend: -1 }, { extend: 1001 }, { extend: NaN },
    { rightAngleSize: 0 }, { rightAngleSize: 101 }, { rightAngleSize: 'x' },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: false },
    { opacity: 'x' }, { opacity: [] },
    { clampToSegment: 'yes' }, { asLine: 1 }, { asPerp: null }, { asRightAngle: 'true' },
    { asPoints: 'true' }, { labelDistance: 0 }, { labelPoint: 1 }, { labelFoot: 'no' }, { labelLine: [] },
    { asLine: false, asPerp: false, asRightAngle: false, asPoints: false, labelDistance: false, labelPoint: false, labelFoot: false, labelLine: false },
  ];
  assert(bad.every((c) => resolvePointline3D(c, {}).ok === false), `脏输入原子拒绝（${bad.length} 组）`);
}

section('四、执行器集成（与 2D 执行器隔离）');
{
  const created = [];
  const api = { add: (o) => { created.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'pointline3d', id: 'ptln', labelLine: true, asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'pointline3d' && res[0].count === 11, '执行器返回成功与项数（含 4 球 + 2 端点标注 + 距离读数）');
  assert(created.length === 11 && created.every((o) => o.type === 'line' || o.type === 'point' || o.type === 'label'), '11 项全部落地为 3D 对象');
  assert(approx(res[0].meta.distance, 2) && vecApprox(res[0].meta.foot, [1, 0, 0]), 'meta 透传距离与垂足');
}
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [{ id: 'ptln_line' }, { id: 'ptln_dist' }] }) };
  const res = applyBoard3DCommands([{ op: 'pointline3d', id: 'ptln' }, { op: 'pointline3d', id: 'ptln' }], api);
  assert(res[0].ok && res[1].ok === false && res[1].failed && res[1].failed.length === 5, '同批 id 冲突分项失败，第二条整批回报 ok=false');
  assert(added.length === 5, '冲突项不落地，仅第一条 5 项正常落地');
  assert(res[0].created.every((c) => !['ptln_line', 'ptln_dist'].includes(c.id)), '语义层已避让场景原有 id');
}
{
  const api = { add: () => true };
  const res = applyBoard3DCommands([{ op: 'pointline3d' }], api);
  assert(res[0].ok && res[0].count === 5, 'getState 缺失降级为空场景');
  const api2 = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res2 = applyBoard3DCommands([{ op: 'pointline3d' }], api2);
  assert(res2[0].ok && res2[0].count === 5, 'getState 抛错降级为空场景');
}
{
  let n = 0;
  const api = { add: () => (++n === 1 ? false : true), getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'pointline3d' }], api);
  assert(res[0].ok === false && res[0].failed.length === 1 && res[0].created.length === 4, 'api 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const minimal = { op: 'pointline3d', asLine: false, asPerp: false, asRightAngle: false, asPoints: false, labelDistance: false, labelPoint: false, labelFoot: false, labelLine: false };
  const res = applyBoard3DCommands([{ op: 'circle' }, { op: 'intersect' }, minimal], api);
  assert(res[0].ok === false && res[1].ok === false && /不识别 2D 命令/.test(res[0].error + res[1].error), '2D 命令在 3D 分支被拒绝');
  assert(res[2].ok === false && /至少开一个/.test(res[2].error), '八开关全关被语义层拒绝');
}
{
  const r = applyBoard3DCommands([{ op: 'pointline3d', from: [0, 0, 0], to: [0, 0, 0] }], { add: () => true });
  assert(r[0].ok === false && /重合/.test(r[0].error), '执行器透传语义层错误');
}

section('五、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_POINT_LINE_PROMPT_OPS.length === 1 && BOARD3D_POINT_LINE_PROMPT_OPS[0] === 'pointline3d', '提示词 op 与执行器 op 一致');
assert(BOARD3D_POINT_LINE_PROMPT.includes('pointline3d') && BOARD3D_POINT_LINE_PROMPT.includes('clampToSegment') && BOARD3D_POINT_LINE_PROMPT.includes('labelLine'), '提示词含完整命令格式');
assert(BOARD3D_POINT_LINE_PROMPT.includes('垂足') && BOARD3D_POINT_LINE_PROMPT.includes('直角符号省略') && BOARD3D_POINT_LINE_PROMPT.includes('d=0'), '提示词说明退化情形');
assert(BOARD3D_POINT_LINE_PROMPT.includes('2D 的「点到直线距离 / 垂线」命令在本分支依旧不认识'), '提示词保持 3D/2D 分支隔离铁律');
assert(isPointline3DIntent('求空间点到直线的距离') && isPointline3DIntent('点到空间直线距离'), 'D37 意图词命中');
assert(isPointline3DIntent('立体几何里点到直线的距离') && isPointline3DIntent('三维空间点到线的距离'), '立体/三维措辞命中');
assert(!isPointline3DIntent('点到直线的距离') && !isPointline3DIntent('画一条直线和一个点'), '2D 通用措辞不误命中');
assert(resolveBoardMode({ detect3d: true, message: '求空间点到直线的距离' }, '求空间点到直线的距离') === '3d', '显式 detect3d 时点线距进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '点到空间直线距离') === '3d', '点到空间直线距离进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '异面直线夹角') === '3d', 'D36 意图词仍有效');
assert(resolveBoardMode({ detect3d: true }, '画两条异面直线的公垂线') === '3d', 'D35 意图词仍有效');
assert(resolveBoardMode({ message: '点到直线的距离' }, '点到直线的距离') === '2d', '未开启 detect3d 保持 2D 主干');
assert(resolveBoardMode({ detect3d: true }, '点到直线的距离') === '2d', '2D 通用词不误切 3D');
assert(read('ai/board-backend.js').includes('+ BOARD3D_POINT_LINE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("pl.op !== 'pointline3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('pointline3d 给空间一点 point'), '画板面板工具说明已追加');

section('六、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  // 纯追加兼容：本段已提交时允许后续轮次在其后继续追加，只要求 HEAD 全文仍是当前文件前缀。
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_POINT_LINE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_LINE_ANGLE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('2D 主干'), '2D 主干标志仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  // 通用「逐行仅行内追加」检查：当前每一行都必须是 HEAD 对应行插入一段连续文本的结果，
  // 兼容后续轮次继续在 import / 拼接串 / 意图分支行内追加，不再写死片段。
  const h = headBackend.split('\n');
  const n = nowBackend.split('\n');
  assert(n.length === h.length, '后端行数未变（delta=' + (n.length - h.length) + '）');
  const inlineOnly = h.every((line, i) => {
    const now = n[i];
    if (line === now) return true;
    // 允许同一行多处插入：HEAD 行必须是 NOW 行的子序列（顺序、字符均保留）。
    let j = 0;
    for (let k = 0; k < now.length && j < line.length; k++) {
      if (now[k] === line[j]) j++;
    }
    return j === line.length;
  });
  assert(inlineOnly, '后端历史行未被删除或改写（仅行内追加）');
}
{
  const headHtml = readHead('board3d.html');
  const nowHtml = read('board3d.html');
  // 纯追加兼容：提示词插在同一行行尾的 </div> 之前，已提交后仍允许后续轮次继续追加；
  // 断言当前文件 = HEAD 全文插入一段连续文本（无删改任何既有字节）。
  let p = 0;
  while (p < headHtml.length && headHtml[p] === nowHtml[p]) p++;
  let s = 0;
  while (s < headHtml.length - p && headHtml[headHtml.length - 1 - s] === nowHtml[nowHtml.length - 1 - s]) s++;
  assert(p + s === headHtml.length && nowHtml.includes('pointline3d 给空间一点'), 'board3d.html 只追加工具提示');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'skewline3d'") && read('js/board3d-executor.js').includes("case 'lineangle3d'") && read('js/board3d-executor.js').includes("case 'pointline3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

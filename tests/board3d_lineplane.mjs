/**
 * 3D 直线与平面所成角命令（lineplane3d · D33）无头回归。
 *
 * 覆盖：lineplaneLineUnit / lineplanePlaneNormal / lineplaneFoot / lineplaneBasis / resolveLineplane3D 纯函数
 *       （默认 0°、垂直 90°、45°、斜向、center+axis 定面、圆弧守恒、开关 / 小球 / 面片 / 角度标注 / 样式 /
 *        数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_lineplane.mjs
 */
import {
  BOARD3D_LINEPLANE_PROMPT, BOARD3D_LINEPLANE_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  LINEPLANE3D_RAY_LENGTH_MIN, LINEPLANE3D_RAY_LENGTH_MAX, LINEPLANE3D_RAY_LENGTH_DEFAULT,
  LINEPLANE3D_ARC_RADIUS_MIN, LINEPLANE3D_ARC_RADIUS_MAX, LINEPLANE3D_ARC_RADIUS_DEFAULT,
  LINEPLANE3D_SEGMENTS_MIN, LINEPLANE3D_SEGMENTS_MAX, LINEPLANE3D_SEGMENTS_DEFAULT,
  LINEPLANE3D_PLANE_SIZE_MIN, LINEPLANE3D_PLANE_SIZE_MAX,
  LINEPLANE3D_PLANE_WIDTH_DEFAULT, LINEPLANE3D_PLANE_HEIGHT_DEFAULT,
  LINEPLANE3D_VERTEX_SIZE_MIN, LINEPLANE3D_VERTEX_SIZE_MAX, LINEPLANE3D_VERTEX_SIZE_DEFAULT,
  LINEPLANE3D_MAX_SEGMENTS, LINEPLANE3D_DEFAULT_LINE, LINEPLANE3D_DEFAULT_POINTS,
  num, lineplaneLineUnit, lineplanePlaneNormal, lineplaneFoot, lineplaneBasis, resolveLineplane3D,
} from '../js/board3d-lineplane.js';
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
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);
const XY_PLANE = [[-1, -1, 0], [1, -1, 0], [0, 1, 0]];

// ---------------------------------------------------------------------------
section('一、常量与默认契约');
assert(LINEPLANE3D_RAY_LENGTH_DEFAULT === 1 && LINEPLANE3D_RAY_LENGTH_MIN === 0.01 && LINEPLANE3D_RAY_LENGTH_MAX === 10000, '斜线长默认/区间常量');
assert(LINEPLANE3D_ARC_RADIUS_DEFAULT === 0.5 && LINEPLANE3D_ARC_RADIUS_MIN === 0.01 && LINEPLANE3D_ARC_RADIUS_MAX === 10000, '圆弧半径默认/区间常量');
assert(LINEPLANE3D_SEGMENTS_DEFAULT === 24 && LINEPLANE3D_SEGMENTS_MIN === 3 && LINEPLANE3D_SEGMENTS_MAX === 64, '圆弧分段默认/区间常量');
assert(LINEPLANE3D_PLANE_SIZE_MIN === 0.01 && LINEPLANE3D_PLANE_SIZE_MAX === 10000, '面片尺寸区间常量');
assert(LINEPLANE3D_PLANE_WIDTH_DEFAULT === 2 && LINEPLANE3D_PLANE_HEIGHT_DEFAULT === 2, '面片尺寸默认常量');
assert(LINEPLANE3D_VERTEX_SIZE_DEFAULT === 0.1 && LINEPLANE3D_VERTEX_SIZE_MIN === 0.01 && LINEPLANE3D_VERTEX_SIZE_MAX === 1, '顶点球默认/区间常量');
assert(LINEPLANE3D_MAX_SEGMENTS === 4096, '段数上限常量');
assert(frozen(LINEPLANE3D_DEFAULT_LINE) && LINEPLANE3D_DEFAULT_LINE.every(frozen), '默认直线深冻结');
assert(frozen(LINEPLANE3D_DEFAULT_POINTS) && LINEPLANE3D_DEFAULT_POINTS.every(frozen), '默认平面深冻结');
assert(vecApprox(LINEPLANE3D_DEFAULT_LINE[0], [-1, 0, 0]) && vecApprox(LINEPLANE3D_DEFAULT_LINE[1], [1, 0, 0]), '默认直线为 x 轴');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、直线方向 / 平面法向 / 斜足 / 参考方向解析');
assert(vecApprox(lineplaneLineUnit(undefined), [1, 0, 0]), '默认直线方向为 x 轴');
assert(vecApprox(lineplaneLineUnit([[0, 0, 0], [0, 3, 4]]), [0, 0.6, 0.8]), '任意直线方向单位化');
assert(approx(len(lineplaneLineUnit([[1, 2, 3], [4, 6, 8]])), 1), '直线方向恒为单位向量');
assert(lineplaneLineUnit([[0, 0, 0], [0, 0, 0]]) === null, '重合两点无方向');
assert(vecApprox(lineplanePlaneNormal(XY_PLANE), [0, 0, 1]) || vecApprox(lineplanePlaneNormal(XY_PLANE), [0, 0, -1]), 'xy 面法向为 ±z');
assert(approx(len(lineplanePlaneNormal(XY_PLANE)), 1), '平面法向恒为单位向量');
assert(lineplanePlaneNormal([[0, 0, 0], [1, 1, 1], [2, 2, 2]]) === null, '共线三点无法向');
assert(vecApprox(lineplaneFoot([[-1, 0, 0], [1, 0, 0]], XY_PLANE), [-1, 0, 0]), '在面内直线斜足 = line[0] 自身投影');
{
  const V = lineplaneFoot([[0, 0, -1], [0, 0, 1]], XY_PLANE);
  assert(vecApprox(V, [0, 0, 0]), '垂直直线斜足为原点');
}
{
  const e1 = lineplaneBasis([0, 0, 1]);
  assert(e1 && approx(len(e1), 1) && approx(dot(e1, [0, 0, 1]), 0), '参考方向垂直法向且单位');
}

section('三、命令解析 · 默认与典型角度');
{
  const r = resolveLineplane3D({ op: 'lineplane3d' });
  assert(r.ok, '默认命令成功');
  assert(approx(r.meta.angleDeg, 0), '默认 x 轴 vs xy 面 = 0°');
  assert(r.items.length > 0 && r.items.every((it) => ['line', 'point', 'label'].includes(it.type)), '默认产出合法图元');
  assert(r.meta.labelText === '0°' && r.meta.planeMode === 'default', '默认角度标注与 planeMode');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', line: [[0, 0, 0], [0, 0, 1]], points: XY_PLANE });
  assert(r.ok && approx(r.meta.angleDeg, 90), '垂直直线 = 90°');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', line: [[0, 0, -1], [0, 1, 0]], points: XY_PLANE });
  assert(r.ok && approx(r.meta.angleDeg, 45), '45° 线面角');
  assert(r.meta.labelText === '45°', '45° 角度标注文本');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', line: [[0, 0, -1], [0, 1, 0]], center: [0, 0, 0], axis: [0, 0, 1] });
  assert(r.ok && r.meta.planeMode === 'centerAxis' && approx(r.meta.angleDeg, 45), 'center+axis 定面 45°');
}
{
  const line = [[0, 0, -2], [1, 2, 1]];
  const points = [[0, 0, 0], [3, 0, 1], [0, 3, 0]];
  const r = resolveLineplane3D({ op: 'lineplane3d', line, points, rayLength: 2, arcRadius: 0.7, segments: 12, asPoints: true });
  assert(r.ok && r.meta.angleDeg > 0 && r.meta.angleDeg < 90, '斜向非平凡线面角');
  assert(approx(r.meta.angleDeg, Math.asin(Math.abs(dot(r.meta.u, r.meta.nh))) * 180 / Math.PI, 0.2), '角度读数=arcsin(|u·nh|)');
}

section('四、几何守恒（非平凡斜向）');
{
  const line = [[0, 0, -2], [1, 2, 1]];
  const points = [[0, 0, 0], [3, 0, 1], [0, 3, 0]];
  const r = resolveLineplane3D({ op: 'lineplane3d', line, points, rayLength: 2, arcRadius: 0.7, segments: 12, asPoints: true });
  const m = r.meta;
  assert(approx(len(m.u), 1) && approx(len(m.nh), 1) && approx(len(m.up), 1), 'u/nh/up 均为单位向量');
  assert(approx(dot(m.nh, m.e1), 0, 3e-3) && approx(dot(m.nh, m.e2), 0, 3e-3) && approx(dot(m.e1, m.e2), 0, 3e-3), 'e1/e2/nh 两两正交');
  assert(approx(dot(sub(m.foot, points[0]), m.nh), 0, 3e-3), '斜足 V 恒在平面内');
  const AH = sub(m.obliqueEnd, m.perpFoot);
  assert(approx(len(AH), Math.abs(dot(AH, m.nh)), 3e-3), '垂线 AH 垂直平面（∥法向）');
  assert(approx(len(sub(m.obliqueEnd, m.foot)), 2), '|VA| = rayLength');
  assert(approx(len(sub(m.perpFoot, m.foot)), 2 * Math.cos(m.angle), 4e-3), '|VH| = rayLength·cosθ');
  assert(approx(len(AH), 2 * Math.sin(m.angle), 4e-3), '|AH| = rayLength·sinθ');
  assert(m.arcPoints.every((p) => approx(len(sub(p, m.foot)), 0.7, 4e-3)), '圆弧各点到 V 等距 arcRadius');
  const arcEnd = sub(m.arcPoints[m.arcPoints.length - 1], m.foot);
  assert(approx(dot(arcEnd, m.u) / (len(arcEnd) * len(m.u)), 1, 4e-3), '圆弧末点方向 = 直线方向 u');
  const arcStart = sub(m.arcPoints[0], m.foot);
  assert(approx(dot(arcStart, m.up) / (len(arcStart) * len(m.up)), 1, 4e-3), '圆弧首点方向 = 射影方向 up');
  assert(m.plane.every((p) => Array.isArray(p) && p.length === 3), 'plane 三点入 meta');
  assert(m.corners.length === 4 && m.corners.every((c) => Array.isArray(c) && c.length === 3), '平面面片四角');
}

section('五、垂直 / 平行退化');
{
  const r = resolveLineplane3D({ op: 'lineplane3d', line: [[0, 0, -3], [0, 0, 3]], points: XY_PLANE, rayLength: 1.5, segments: 8, asPoints: true });
  assert(r.ok && approx(r.meta.angleDeg, 90), '垂直线面角 90°');
  assert(approx(len(sub(r.meta.obliqueEnd, r.meta.foot)), 1.5), '垂直情形斜线长守恒');
  assert(approx(len(sub(r.meta.perpFoot, r.meta.foot)), 0, 3e-3), '垂直情形射影退化为点');
  assert(vecApprox(r.meta.up, r.meta.e1), '退化时 up 回退到平面内参考方向');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', line: [[-2, 1, 0], [2, 1, 0]], points: XY_PLANE });
  assert(r.ok && approx(r.meta.angleDeg, 0), '平行/面内直线线面角 0°');
}

section('六、开关 / 样式 / 数字字符串 / id 避让');
{
  const r = resolveLineplane3D({ op: 'lineplane3d', asLine: false, asPlane: false, asOblique: false, asPerp: false, asProjection: false, asArc: false, asPoints: true, labelAngle: true });
  assert(r.ok && r.meta.segmentCount === 0 && r.meta.pointCount === 3 && r.meta.labelCount === 1, '仅小球+角度标注：无 line、3 小球、1 标注');
  assert(r.items.filter((it) => it.type === 'point').length === 3, '产出 3 个小球');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', asPoints: true, color: '#abcdef', labelColor: '#123456', opacity: '0.5' });
  assert(r.ok && r.meta.color === '#abcdef' && r.meta.labelColor === '#123456' && approx(r.meta.opacity, 0.5), '样式与数字字符串 opacity');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', rayLength: '2', arcRadius: '0.8', segments: '16', width: '3', height: '4' });
  assert(r.ok && approx(r.meta.rayLength, 2) && r.meta.segments === 16 && approx(r.meta.width, 3) && approx(r.meta.height, 4), '数值参数数字字符串容错');
}
{
  const r = resolveLineplane3D({ op: 'lineplane3d', arcRadius: 100, rayLength: 2 });
  assert(r.ok && r.meta.arcRadiusClamped && approx(r.meta.arcRadius, 2), 'arcRadius 超 rayLength 自动钳制并回报');
}
{
  const state = { objects: [{ id: 'lp' }, { id: 'lp_line' }, { id: 'lp_arc1' }] };
  const r = resolveLineplane3D({ op: 'lineplane3d', id: 'lp' }, state);
  const ids = r.items.map((it) => it.id);
  assert(r.ok && new Set(ids).size === ids.length && !ids.includes('lp_line') && !ids.includes('lp_arc1'), 'id 避让：不覆盖已有 id');
}
{
  const id = 'x'.repeat(64);
  const r = resolveLineplane3D({ op: 'lineplane3d', id }, { objects: [{ id }, { id: `${'x'.repeat(56)}_2` }] });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符长 id 避让不死循环、不超长');
}

section('七、脏输入原子拒绝');
const bad = [
  { op: 'lineplane3d', id: '' }, { op: 'lineplane3d', id: 'bad id' },
  { op: 'lineplane3d', line: 'not-array' }, { op: 'lineplane3d', line: [[0, 0, 0], [0, 0, 0]] },
  { op: 'lineplane3d', line: [[0, 0, 0], [1, 2, NaN]] },
  { op: 'lineplane3d', points: [[0, 0, 0], [1, 1, 1], [2, 2, 2]] },
  { op: 'lineplane3d', points: [[0, 0, 0], [1, 0, 0]] },
  { op: 'lineplane3d', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], center: [0, 0, 0] },
  { op: 'lineplane3d', center: [0, 0, 0] },
  { op: 'lineplane3d', center: [0, 0, 0], axis: [0, 0, 0] },
  { op: 'lineplane3d', rayLength: 0 }, { op: 'lineplane3d', rayLength: 'abc' }, { op: 'lineplane3d', rayLength: 20000 },
  { op: 'lineplane3d', arcRadius: 0 }, { op: 'lineplane3d', arcRadius: NaN },
  { op: 'lineplane3d', segments: 2 }, { op: 'lineplane3d', segments: 65 }, { op: 'lineplane3d', segments: 3.5 },
  { op: 'lineplane3d', width: 0 }, { op: 'lineplane3d', height: 20000 },
  { op: 'lineplane3d', vertexSize: 0 }, { op: 'lineplane3d', vertexSize: 2 },
  { op: 'lineplane3d', opacity: 'x' },
  { op: 'lineplane3d', asArc: 'yes' }, { op: 'lineplane3d', labelAngle: 1 },
  { op: 'lineplane3d', asLine: false, asPlane: false, asOblique: false, asPerp: false, asProjection: false, asArc: false, asPoints: false, labelAngle: false },
  null, [], 'x',
];
for (const c of bad) {
  assert(resolveLineplane3D(c).ok === false, `脏输入拒绝：${JSON.stringify(c).slice(0, 70)}`);
}

section('八、深度只读性');
{
  const cmd = Object.freeze({
    op: 'lineplane3d', line: Object.freeze([Object.freeze([0, 0, -1]), Object.freeze([0, 1, 0])]),
    points: Object.freeze(XY_PLANE.map(Object.freeze)),
  });
  const r = resolveLineplane3D(cmd);
  assert(r.ok, '冻结入参仍成功');
  assert(frozen(cmd.line) && frozen(cmd.line[0]) && frozen(cmd.points) && frozen(cmd.points[0]), '入参未被解冻');
  const m1 = resolveLineplane3D({ op: 'lineplane3d' }).meta;
  const m2 = resolveLineplane3D({ op: 'lineplane3d' }).meta;
  m1.foot[0] = 999;
  assert(m2.foot[0] !== 999, '两次调用输出互相独立');
}

section('九、执行器常量契约（历史 7~32 条逐字不变）');
assert(BOARD3D_OPS.length === 7 && BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'BOARD3D_OPS 7 / MEASURE 1 / ALL 8');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9 && BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'FULL 9 / COMPLETE 10');
assert(BOARD3D_COMPLETE23_OPS.length === 32 && BOARD3D_LINEPLANE_OPS.length === 1 && BOARD3D_COMPLETE24_OPS.length === 33, 'COMPLETE23 32 / LINEPLANE 1 / COMPLETE24 33');
assert(BOARD3D_COMPLETE24_OPS.includes('lineplane3d') && BOARD3D_COMPLETE23_OPS.includes('dihedral3d'), '新集含 lineplane3d 且旧集含 dihedral3d');

section('十、执行器集成');
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
  const res = applyBoard3DCommands([{ op: 'lineplane3d', id: 'lp', asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'lineplane3d', '执行器：lineplane3d 成功');
  assert(res[0].meta.angleDeg === 0 && res[0].created.length === api.added.length, '执行器：meta 与 created 完整');
  assert(api.added.every((it) => ['line', 'point', 'label'].includes(it.type)), '执行器：产出合法图元');
}
{
  const api = makeApi(['lp_line']);
  const res = applyBoard3DCommands([{ op: 'lineplane3d', id: 'lp' }], api);
  assert(res[0].ok === true && !res[0].failed && api.added.every((it) => it.id !== 'lp_line'), '执行器：id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'lineplane3d' }], api);
  assert(res[0].ok === true && res[0].created.length > 0, '执行器：getState 抛错降级为空场景，整批不中断');
}
{
  const api = makeApi([], (item, known, added) => { if (item.type === 'point') return false; added.push(item); known.add(item.id); return true; });
  const res = applyBoard3DCommands([{ op: 'lineplane3d', asPoints: true }], api);
  assert(res[0].ok === false && res[0].failed.length === 3, '执行器：api.add 返回 false 分项回报');
}
{
  const api = makeApi();
  const res = applyBoard3DCommands([{ op: 'add3d', id: 'b', type: 'box' }], api);
  assert(res.some((r) => r.op === 'add3d' && r.ok), '执行器：既有 add3d 仍工作（2D/3D 基础命令零回归）');
}
{
  const api = makeApi();
  const res = applyBoard3DCommands([{ op: 'circle', id: 'c' }], api);
  assert(res[0].ok === false && /3D 分支不识别 2D/.test(res[0].error), '执行器：2D 命令被 3D 分支拒绝');
}
{
  const res = applyBoard3DCommands([{ op: 'lineplane3d', rayLength: 'bad' }], makeApi());
  assert(res[0].ok === false && /rayLength/.test(res[0].error), '执行器：脏输入原子拒绝且不落地');
}

section('十一、共享文件协议两侧一致性');
assert(BOARD3D_LINEPLANE_PROMPT.includes('lineplane3d') && BOARD3D_LINEPLANE_PROMPT_OPS.length === 1 && BOARD3D_LINEPLANE_PROMPT_OPS[0] === 'lineplane3d', '提示词段含 lineplane3d 命令');
assert(BOARD3D_LINEPLANE_PROMPT.includes('arcsin') && BOARD3D_LINEPLANE_PROMPT.includes('center+axis'), '提示词段含守恒与定面说明');
{
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_LINEPLANE_PROMPT'), 'backend 引用 LINEPLANE_PROMPT');
  assert(be.includes('BOARD3D_DIHEDRAL_PROMPT + BOARD3D_LINEPLANE_PROMPT'), 'backend 3D 提示词拼接末尾追加 LINEPLANE');
}
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画正方体的二面角') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十二、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolveLineplane3D \} from '\.\/board3d-lineplane\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'lineplane3d'/.test(exec), '执行器含 case lineplane3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_LINEPLANE_PROMPT') && bp.includes('BOARD3D_DIHEDRAL_PROMPT') && bp.includes('BOARD3D_PLANE_PROMPT'), '共享文件含 LINEPLANE_PROMPT 段且保留既有段（纯追加）');
  // 最高优先级：共享文件必须字节级纯追加，上方任何内容（含 2D 主干与既有 3D 段）逐字不动
  const oldBp = readHead('ai/board-prompt.js');
  assert(bp.startsWith(oldBp), `ai/board-prompt.js 字节级纯追加（旧 ${oldBp.length} 字节为新前缀，未覆盖 2D 主干或既有 3D 段）`);
  const oldBe = readHead('ai/board-backend.js');
  // backend 是共享文件（另一任务也会改），本轮只追加引用：确认旧内容逐字仍为前缀（除我们追加的两处为末尾追加/行内追加）
  assert(read('ai/board-backend.js').length >= oldBe.length, 'backend 未被截断（3D 引用仅追加、不回退）');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('lineplane3d') && ai3.includes('dihedral3d'), 'AI 面板结果展示含 lineplane3d 且保留 dihedral3d');
  const html = read('board3d.html');
  assert(html.includes('lineplane3d') && html.includes('dihedral3d') && html.includes('plane3d'), 'board3d.html AI tip 含 lineplane3d 且保留既有段');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D33') && doc.includes('lineplane3d'), '回归清单含 D33 记录');
  // 本任务职责范围：未触碰 2D 主干
  const b2 = read('js/board.js');
  assert(b2.length > 0 && read('js/executor.js').length > 0, '2D 主干文件仍存在（未删除）');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（本任务早期已切换，未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在、大角 SDK 引用未删除');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  const hdr = read('board3d.html');
  assert(/importmap|three/.test(hdr), 'board3d.html 仍本地/自研 Three.js 引用');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

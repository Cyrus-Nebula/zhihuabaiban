/**
 * 3D 任意空间平面面片命令（plane3d · D30）无头回归。
 *
 * 覆盖：planeAxisUnit / planeNormalFromPoints / planeBasis / planeCorners / resolvePlane3D 纯函数
 *       （默认水平面 / 法向 x/y/z 与任意向量 / 三点定面 / 宽高 / 网格 / 法向量 /
 *        四角小球与 O·A/B/C/D·n 标注 / 共面·对边·对角中点守恒 / 样式 / 数字字符串 /
 *        id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、
 *       getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核（含 board-prompt.js 纯追加字节断言）。
 *
 * 运行：node tests/board3d_plane.mjs
 */
import {
  BOARD3D_PLANE_PROMPT, BOARD3D_PLANE_PROMPT_OPS,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import * as EX from '../js/board3d-executor.js';
import {
  PLANE3D_SPAN_MIN, PLANE3D_SPAN_MAX, PLANE3D_WIDTH_DEFAULT, PLANE3D_HEIGHT_DEFAULT,
  PLANE3D_GRID_MIN, PLANE3D_GRID_MAX, PLANE3D_GRID_DEFAULT,
  PLANE3D_NORMAL_LENGTH_MIN, PLANE3D_NORMAL_LENGTH_MAX, PLANE3D_NORMAL_LENGTH_DEFAULT,
  PLANE3D_VERTEX_SIZE_MIN, PLANE3D_VERTEX_SIZE_MAX, PLANE3D_VERTEX_SIZE_DEFAULT,
  PLANE3D_MAX_SEGMENTS, PLANE3D_DEFAULT_CENTER, PLANE3D_DEFAULT_AXIS, PLANE3D_LABELS,
  num, planeAxisUnit, planeNormalFromPoints, planeBasis, planeCorners, resolvePlane3D,
} from '../js/board3d-plane.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const gitRead = (p) => execFileSync('git', ['show', 'HEAD:' + p], { cwd: ROOT, encoding: 'utf8' });

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);
const lines = (r) => r.items.filter((it) => it.type === 'line');
const points = (r) => r.items.filter((it) => it.type === 'point');
const labels = (r) => r.items.filter((it) => it.type === 'label');

// ---------------------------------------------------------------------------
section('一、常量与默认契约');
assert(PLANE3D_SPAN_MIN === 0.01 && PLANE3D_SPAN_MAX === 10000 && PLANE3D_WIDTH_DEFAULT === 4 && PLANE3D_HEIGHT_DEFAULT === 3, '宽高默认 / 区间常量');
assert(PLANE3D_GRID_MIN === 0 && PLANE3D_GRID_MAX === 32 && PLANE3D_GRID_DEFAULT === 0, '网格细分默认 / 区间常量');
assert(PLANE3D_NORMAL_LENGTH_MIN === 0.01 && PLANE3D_NORMAL_LENGTH_MAX === 10000 && PLANE3D_NORMAL_LENGTH_DEFAULT === 1, '法向量长度默认 / 区间常量');
assert(PLANE3D_VERTEX_SIZE_MIN === 0.01 && PLANE3D_VERTEX_SIZE_MAX === 1 && PLANE3D_VERTEX_SIZE_DEFAULT === 0.1, '小球半径默认 / 区间常量');
assert(PLANE3D_MAX_SEGMENTS === 4096 && PLANE3D_DEFAULT_AXIS === 'z', '段数上限与默认法向常量');
assert(frozen(PLANE3D_DEFAULT_CENTER) && frozen(PLANE3D_DEFAULT_CENTER[0]) && vecApprox(PLANE3D_DEFAULT_CENTER, [0, 0, 0]), '默认中心深冻结且为原点');
assert(frozen(PLANE3D_LABELS) && PLANE3D_LABELS.join('') === 'ABCD', '四角标注字母深冻结 A/B/C/D');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、planeAxisUnit 平面法向解析');
assert(vecApprox(planeAxisUnit(undefined), [0, 0, 1]), '默认法向 z');
assert(vecApprox(planeAxisUnit('x'), [1, 0, 0]) && vecApprox(planeAxisUnit('Y'), [0, 1, 0]) && vecApprox(planeAxisUnit('Z'), [0, 0, 1]), 'x/y/z 大小写法向');
assert(vecApprox(planeAxisUnit([0, 3, 4]), [0, 0.6, 0.8]), '任意向量单位化');
assert(vecApprox(planeAxisUnit([1, 1, 1]), [0.5774, 0.5774, 0.5774], 1e-3), '斜向向量单位化');
assert(planeAxisUnit('q') === null && planeAxisUnit([0, 0, 0]) === null && planeAxisUnit([1, 'x', 0]) === null && planeAxisUnit(null) === null, '非法法向拒绝');

section('三、planeNormalFromPoints 三点定面');
{
  const n = planeNormalFromPoints([[0, 0, 0], [2, 0, 0], [0, 2, 0]]);
  assert(vecApprox(n, [0, 0, 1]), 'xy 平面三点得法向 +z');
  const m = planeNormalFromPoints([[0, 0, 0], [0, 2, 0], [2, 0, 0]]);
  assert(vecApprox(m, [0, 0, -1]), '点序反转得反向法向');
  assert(approx(len(n), 1) && approx(len(m), 1), '法向均为单位向量');
  const oblique = planeNormalFromPoints([[0, 0, 0], [2, 0, 0], [0, 2, 1]]);
  assert(oblique && approx(dot(oblique, sub([2, 0, 0], [0, 0, 0])), 0) && approx(dot(oblique, sub([0, 2, 1], [0, 0, 0])), 0), '倾斜三点法向垂直两条边');
}
assert(planeNormalFromPoints([[0, 0, 0], [1, 0, 0], [2, 0, 0]]) === null, '共线三点拒绝');
assert(planeNormalFromPoints([[0, 0, 0], [0, 0, 0], [1, 1, 1]]) === null, '重合点拒绝');
assert(planeNormalFromPoints([[0, 0], [1, 1, 1], [2, 2, 2]]) === null && planeNormalFromPoints(null) === null && planeNormalFromPoints([[0, 0, 0], [1, 0, 0]]) === null, '非法点数 / 非法点拒绝');

section('四、planeBasis 正交标架');
for (const u of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0.6, 0.8], [1, 1, 1]]) {
  const U = planeBasis(u).n ? u : planeAxisUnit(u);
  const B = planeBasis(U);
  assert(B && approx(dot(B.n, B.n), 1) && approx(dot(B.b, B.b), 1) && approx(dot(B.n, B.b), 0) && approx(dot(B.n, U), 0) && approx(dot(B.b, U), 0), `标架正交归一 u=[${U}]`);
}
assert(planeBasis('z') === null && planeBasis([0, 0]) === null && planeBasis([NaN, 0, 1]) === null, '非法 u 返回 null');

section('五、planeCorners 四角');
{
  const B = planeBasis([0, 0, 1]);
  const C = planeCorners([0, 0, 0], B.n, B.b, 4, 3);
  assert(C.length === 4 && frozen(C), '四角数组深冻结、长度 4');
  assert(vecApprox(C[0], [-2, -1.5, 0]) && vecApprox(C[1], [2, -1.5, 0]) && vecApprox(C[2], [2, 1.5, 0]) && vecApprox(C[3], [-2, 1.5, 0]), 'z 法向默认面片四角点位');
  const shifted = planeCorners([1, 2, 3], B.n, B.b, 4, 3);
  assert(vecApprox(shifted[0], [-1, 0.5, 3]) && vecApprox(shifted[2], [3, 3.5, 3]), '中心平移后四角同步平移');
}

section('六、resolvePlane3D 默认 / 法向 / 三点定面');
{
  const r = resolvePlane3D({});
  assert(r.ok === true && r.items.length === 4 && lines(r).length === 4 && points(r).length === 0 && labels(r).length === 0, '默认命令生成 4 条边界线');
  assert(vecApprox(r.meta.center, [0, 0, 0]) && vecApprox(r.meta.axis, [0, 0, 1]) && r.meta.width === 4 && r.meta.height === 3, '默认 meta 中心 / 法向 / 宽高');
  assert(r.meta.byPoints === false && r.meta.asBorder === true && r.meta.asGrid === false, '默认开关读数');
  assert(r.meta.segmentCount === 4 && r.meta.itemCount === 4 && r.meta.borderCount === 4, '默认计数读数');
}
{
  const r = resolvePlane3D({ id: 'wall', axis: 'x', width: '5', height: '2' });
  assert(r.ok === true && vecApprox(r.meta.axis, [1, 0, 0]) && r.meta.width === 5 && r.meta.height === 2, '数字字符串宽高 + x 法向');
  assert(r.meta.corners.every((q) => approx(q[0], 0)), 'x 法向竖直面四角 x 恒 0');
}
{
  const r = resolvePlane3D({ points: [[0, 0, 0], [2, 0, 0], [0, 2, 1]], width: 4, height: 4 });
  assert(r.ok === true && r.meta.byPoints === true && r.meta.points && r.meta.points.length === 3, '三点定面成功并回报点列');
  assert(vecApprox(r.meta.center, [0, 0, 0]) && vecApprox(r.meta.axis, [0, -0.4472, 0.8944], 1e-3), '三点定面缺省中心取 p1、法向为叉积');
}
{
  const r = resolvePlane3D({ points: [[1, 2, 3], [3, 2, 3], [1, 4, 4]] });
  assert(r.ok === true && vecApprox(r.meta.center, [1, 2, 3]), '三点定面且显式 center 缺省取 p1');
}
{
  const r = resolvePlane3D({ center: [5, 6, 7] });
  assert(r.ok === true && vecApprox(r.meta.corners[2], [7, 7.5, 7]), '显式 center 平移面片');
}

section('七、网格 / 法向量 / 小球 / 标注');
{
  const r = resolvePlane3D({ gridU: 2, gridV: 3, asGrid: true, asNormal: true, asPoints: true, labelVertices: true, id: 'full' });
  assert(r.ok === true, '全开关命令成功');
  assert(lines(r).length === 8 && r.meta.gridLineCount === 3 && r.meta.normalCount === 1, '边界 4 + 网格 3（gu1 + gv1,gv2）+ 法向 1 = 8 线');
  assert(points(r).length === 5 && r.meta.pointCount === 5, '中心 + 四角共 5 个小球');
  assert(labels(r).length === 6 && r.meta.labelCount === 6, 'O + A/B/C/D + n 共 6 个标注');
  assert(labels(r).map((x) => x.text).slice(0, 5).join('') === 'OABCD' && labels(r)[5].text === 'n', '标注文本 O/A/B/C/D/n 顺序正确');
  assert(vecApprox(r.meta.normalEnd, [0, 0, 1]), '默认法向量端点 z=1');
  const nLine = lines(r).find((x) => x.id.endsWith('_n1'));
  assert(nLine && vecApprox([nLine.p.x1, nLine.p.y1, nLine.p.z1], [0, 0, 0]) && vecApprox([nLine.p.x2, nLine.p.y2, nLine.p.z2], [0, 0, 1]), '法向量线段由中心指向法向端');
}
{
  const r = resolvePlane3D({ asBorder: false, labelVertices: true });
  assert(r.ok === true && lines(r).length === 0 && r.meta.labelCount === 5, '只标顶点：无边界线、5 个标注（不含 n）');
}
{
  const r = resolvePlane3D({ gridU: 1, gridV: 1, asGrid: true, asBorder: false });
  assert(r.ok === true && r.meta.gridLineCount === 0 && r.items.length === 0, '网格细分 1 无内部线、全关等效空产出但仍 ok');
}

section('八、几何守恒');
{
  const r = resolvePlane3D({ axis: [1, 1, 1], width: 6, height: 4, center: [1, 2, 3], gridU: 3, gridV: 3, asGrid: true, asNormal: true, normalLength: 2 });
  const m = r.meta;
  assert(m.planeMaxDeviation <= 1e-3 && m.edgeMaxDeviation <= 1e-3 && m.diagMaxDeviation <= 1e-3, '斜置面片：共面 / 对边平行等长 / 对角中点守恒读数均为 0');
  assert(m.corners.every((q) => approx(dot(sub(q, m.center), m.axis), 0, 1e-3)), '四角恒落在过中心且垂直法向的平面上');
  assert(vecApprox(sub(m.corners[1], m.corners[0]), sub(m.corners[2], m.corners[3]), 1e-3), '对边 C1−C0 = C2−C3');
  assert(vecApprox(sub(m.corners[3], m.corners[0]), sub(m.corners[2], m.corners[1]), 1e-3), '对边 C3−C0 = C2−C1');
  assert(vecApprox([(m.corners[0][0] + m.corners[2][0]) / 2, (m.corners[0][1] + m.corners[2][1]) / 2, (m.corners[0][2] + m.corners[2][2]) / 2], m.center, 1e-3), '对角线 1 中点为 center');
  assert(approx(len(sub(m.corners[1], m.corners[0])), 6, 1e-3) && approx(len(sub(m.corners[3], m.corners[0])), 4, 1e-3), '对边长分别等于 width / height');
  assert(approx(dot(sub(m.normalEnd, m.center), m.axis), 2, 1e-3), '法向量端点沿法向距中心 normalLength');
  for (const ln of lines(r).filter((x) => x.id.includes('_g'))) {
    const a = [ln.p.x1, ln.p.y1, ln.p.z1];
    assert(approx(dot(sub(a, m.center), m.axis), 0, 1e-3), `网格线起点 ${ln.id} 落在平面内`);
  }
}

section('九、脏输入原子拒绝');
const bad = [
  [null, '命令为空'], [[], '命令为数组'], ['plane3d', '命令为字符串'],
  [{ id: 123 }, 'id 非字符串'], [{ id: 'bad id' }, 'id 含空格'], [{ id: 'x'.repeat(65) }, 'id 超 64 字符'],
  [{ axis: 'q' }, 'axis 非法字符串'], [{ axis: [0, 0, 0] }, 'axis 零向量'], [{ axis: [1, 'x', 0] }, 'axis 含脏值'], [{ axis: null }, 'axis 为 null'],
  [{ points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }, '三点共线'], [{ points: [[0, 0, 0], [1, 0, 0]] }, '点数不足'], [{ points: 'no' }, 'points 非数组'],
  [{ center: 'abc' }, 'center 非数组'], [{ center: [1, 2] }, 'center 维度错'], [{ center: [NaN, 0, 0] }, 'center 含 NaN'], [{ center: null }, 'center 为 null'],
  [{ width: 0 }, 'width 下界'], [{ width: 10001 }, 'width 上界'], [{ width: 'abc' }, 'width 非数字'], [{ width: Infinity }, 'width 无穷'],
  [{ height: 0 }, 'height 下界'], [{ height: 10001 }, 'height 上界'], [{ height: 'abc' }, 'height 非数字'],
  [{ gridU: 1.5 }, 'gridU 非整数'], [{ gridU: -1 }, 'gridU 下界'], [{ gridU: 33 }, 'gridU 上界'], [{ gridV: 1.5 }, 'gridV 非整数'], [{ gridV: 33 }, 'gridV 上界'],
  [{ normalLength: 0 }, 'normalLength 下界'], [{ normalLength: 10001 }, 'normalLength 上界'], [{ normalLength: 'abc' }, 'normalLength 非数字'],
  [{ asBorder: 'yes' }, 'asBorder 非布尔'], [{ asGrid: 1 }, 'asGrid 非布尔'], [{ asNormal: 'true' }, 'asNormal 非布尔'], [{ asPoints: 0 }, 'asPoints 非布尔'], [{ labelVertices: 'no' }, 'labelVertices 非布尔'],
  [{ asBorder: false, asGrid: false, asNormal: false, asPoints: false, labelVertices: false }, '五开关全关'],
  [{ vertexSize: 0 }, 'vertexSize 下界'], [{ vertexSize: 2 }, 'vertexSize 上界'], [{ vertexSize: 'abc' }, 'vertexSize 非数字'],
  [{ opacity: 'abc' }, 'opacity 非数字'],
];
for (const [cmd, label] of bad) {
  const r = resolvePlane3D(cmd);
  assert(r.ok === false && typeof r.error === 'string' && r.items === undefined, `拒绝：${label}`);
}
{
  const r = resolvePlane3D({ color: 'not-a-color', labelColor: 'red-ish', opacity: 5 });
  assert(r.ok === true && r.items[0].color === '#4f6bed' && r.items[0].opacity === 1, '非法颜色回落默认、opacity 钳制到 1，不整条拒绝');
  const r2 = resolvePlane3D({ color: '#abc', labelColor: '#123456', opacity: 0.3 });
  assert(r2.ok === true && r2.items[0].color === '#abc' && r2.meta.labelColor === '#123456' && r2.meta.opacity === 0.3, '合法样式生效');
}

section('十、深度只读性');
{
  const cmd = Object.freeze({ id: 'ro', width: 4, points: Object.freeze([Object.freeze([0, 0, 0]), Object.freeze([2, 0, 0]), Object.freeze([0, 2, 1])]) });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_e1' })]) });
  const before = JSON.stringify({ cmd, state });
  const r = resolvePlane3D(cmd, state);
  assert(r.ok === true && JSON.stringify({ cmd, state }) === before, '冻结入参不被修改');
  assert(r.items[0].id === 'ro_e1_2', 'id 冲突自动避让到 _2');
  r.items[0].p.x1 = 999; r.meta.corners[0][0] = 999;
  assert(resolvePlane3D(cmd, state).items[0].p.x1 !== 999, '输出与 meta 为全新对象，回写不影响下次结果');
}
{
  const cmd = { id: 'x'.repeat(60) };
  const r = resolvePlane3D(cmd, { objects: [{ id: 'x'.repeat(60) }, { id: 'x'.repeat(60) + '_2' }] });
  assert(r.ok === true && r.items.length === 4 && r.items.every((it) => it.id.length <= 64), '长 id 避让不死循环、截断到 64 字符');
}

section('十一、历史契约常量零回归与新常量');
const expected = {
  BOARD3D_OPS: 7, BOARD3D_ALL_OPS: 8, BOARD3D_FULL_OPS: 9, BOARD3D_COMPLETE_OPS: 10,
  BOARD3D_COMPLETE2_OPS: 11, BOARD3D_COMPLETE3_OPS: 12, BOARD3D_COMPLETE4_OPS: 13,
  BOARD3D_COMPLETE5_OPS: 14, BOARD3D_COMPLETE6_OPS: 15, BOARD3D_COMPLETE7_OPS: 16,
  BOARD3D_COMPLETE8_OPS: 17, BOARD3D_COMPLETE9_OPS: 18, BOARD3D_COMPLETE10_OPS: 19,
  BOARD3D_COMPLETE11_OPS: 20, BOARD3D_COMPLETE12_OPS: 21, BOARD3D_COMPLETE13_OPS: 22,
  BOARD3D_COMPLETE14_OPS: 23, BOARD3D_COMPLETE15_OPS: 24, BOARD3D_COMPLETE16_OPS: 25,
  BOARD3D_COMPLETE17_OPS: 26, BOARD3D_COMPLETE18_OPS: 27, BOARD3D_COMPLETE19_OPS: 28,
  BOARD3D_COMPLETE20_OPS: 29,
};
for (const [k, n] of Object.entries(expected)) {
  assert(Array.isArray(EX[k]) && EX[k].length === n, `${k} 长度保持 ${n}（历史契约逐字不变）`);
}
assert(frozen(EX.BOARD3D_PLANE_OPS) && EX.BOARD3D_PLANE_OPS.length === 1 && EX.BOARD3D_PLANE_OPS[0] === 'plane3d', '新增 PLANE_OPS(1)');
assert(frozen(EX.BOARD3D_COMPLETE21_OPS) && EX.BOARD3D_COMPLETE21_OPS.length === 30, '新增 COMPLETE21(30)');
assert(EX.BOARD3D_COMPLETE21_OPS.includes('plane3d') && EX.BOARD3D_COMPLETE21_OPS.includes('cylinder3d') && EX.BOARD3D_COMPLETE21_OPS.includes('cone3d'), 'COMPLETE21 含 plane3d 且保留 cylinder3d/cone3d');
assert(!EX.BOARD3D_OPS.includes('plane3d') && !EX.BOARD3D_ALL_OPS.includes('plane3d') && !EX.BOARD3D_FULL_OPS.includes('plane3d') && !EX.BOARD3D_COMPLETE20_OPS.includes('plane3d'), 'plane3d 未污染任何历史契约常量');

section('十二、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, remove: () => true, update: () => true, getState: () => ({ objects: [] }) };
  const res = EX.applyBoard3DCommands([{ op: 'plane3d', id: 'p', gridU: 2, gridV: 2, asGrid: true, asNormal: true, asPoints: true, labelVertices: true }], api);
  assert(res.length === 1 && res[0].op === 'plane3d' && res[0].ok === true, 'plane3d 执行成功');
  assert(added.length === 18 && res[0].count === 18, '逐项落地 18 个对象（7 线 + 5 点 + 6 标注）');
  assert(res[0].created.length === 18 && res[0].meta.planeMaxDeviation === 0, 'created 与 meta 回报完整');
}
{
  const res = EX.applyBoard3DCommands([{ op: 'plane3d', width: 0 }], { add: () => true, getState: () => ({}) });
  assert(res.length === 1 && res[0].ok === false && /width/.test(res[0].error), '执行器层级拒绝非法参数');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = EX.applyBoard3DCommands([{ op: 'plane3d' }], api);
  assert(res[0].ok === true, 'getState 抛错降级为空场景，整批不中断');
}
{
  let i = 0;
  const api = { add: () => (++i === 2 ? false : true), getState: () => ({}) };
  const res = EX.applyBoard3DCommands([{ op: 'plane3d' }], api);
  assert(res[0].ok === false && res[0].failed && res[0].failed.length === 1 && res[0].created.length === 3, 'api.add 部分失败分项回报（4 线失败 1）');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'pln_e1' }] }) };
  const res = EX.applyBoard3DCommands([{ op: 'plane3d' }], api);
  assert(res[0].ok === true && !res[0].failed, '执行器 id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = EX.applyBoard3DCommands([{ op: 'plane' }], api);
  assert(res.length === 1 && res[0].ok === false && /不支持/.test(res[0].error), '内置 plane 等 2D 风格命令在 3D 分支被 default 拒绝');
}

section('十三、共享文件协议与 3D 意图检测');
assert(frozen(BOARD3D_PLANE_PROMPT_OPS) && BOARD3D_PLANE_PROMPT_OPS[0] === 'plane3d', 'board-prompt 新增 PLANE_PROMPT_OPS');
assert(BOARD3D_PLANE_PROMPT.includes('plane3d') && BOARD3D_PLANE_PROMPT.includes('三点定面'), 'board-prompt PLANE_PROMPT 含命令与三点定面说明');
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画一个圆柱') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十四、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolvePlane3D \} from '\.\/board3d-plane\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'plane3d'/.test(exec), '执行器含 case plane3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_PLANE_PROMPT') && bp.includes('BOARD3D_CYLINDER_PROMPT') && bp.includes('BOARD3D_CONE_PROMPT'), '共享文件含 PLANE_PROMPT 段且保留 CYLINDER/CONE 段（纯追加）');
  // 最高优先级：共享文件必须字节级纯追加，上方任何内容（含 2D 主干）逐字不动
  const oldBp = gitRead('ai/board-prompt.js');
  assert(bp.startsWith(oldBp), `ai/board-prompt.js 字节级纯追加（旧 ${oldBp.length} 字节为新前缀，未覆盖 2D 主干或既有 3D 段）`);
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_PLANE_PROMPT') && be.includes('BOARD3D_CYLINDER_PROMPT') && be.includes('BOARD3D_VECTOR_PROMPT'), 'backend 拼接串含 plane 且保留 cylinder/vector');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('plane3d') && ai3.includes('cylinder3d') && ai3.includes('cone3d'), 'AI 面板结果展示含 plane3d 且保留 cylinder/cone');
  const html = read('board3d.html');
  assert(html.includes('plane3d') && html.includes('cylinder3d') && html.includes('cone3d'), 'board3d.html AI tip 含 plane3d 且保留 cylinder/cone');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D30') && doc.includes('plane3d'), '回归清单含 D30 记录');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（本任务早期已切换，未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在、大角 SDK 引用未删除');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  assert(/importmap|three/.test(html), 'board3d.html 仍本地 / 自研 Three.js 引用');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

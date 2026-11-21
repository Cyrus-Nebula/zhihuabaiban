/**
 * 3D 通用棱柱命令（prism3d · D24）无头回归。
 *
 * 覆盖：prismTop / prismEdgeIndices / vecLen / resolvePrism3D 纯函数（几何守恒：
 *       顶面=底面+向量、侧棱平行等长、高度=向量长度 / 默认正方体 / 三棱柱 / 斜棱柱 /
 *       输出开关 / 顶点球与 A/B/C 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *       各类脏输入原子拒绝 / 深度只读性）、执行器集成（逐项落地为 line + point + label、
 *       id 冲突避让、getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、maxCommands）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_prism.mjs
 */
import {
  BOARD3D_PRISM_PROMPT, BOARD3D_PRISM_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  PRISM3D_BASE_MIN, PRISM3D_BASE_MAX, PRISM3D_DEFAULT_BASE,
  PRISM3D_HEIGHT_DEFAULT, PRISM3D_HEIGHT_MAX, PRISM3D_AXES, PRISM3D_AXIS_DEFAULT,
  PRISM3D_VERTEX_SIZE_DEFAULT, PRISM3D_VERTEX_SIZE_MIN, PRISM3D_VERTEX_SIZE_MAX,
  PRISM3D_MAX_SEGMENTS, PRISM3D_LABEL_LETTERS,
  num, vecLen, prismTop, prismEdgeIndices, resolvePrism3D,
} from '../js/board3d-prism.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
const frozen = (o) => Object.isFrozen(o);
const BASE4 = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];

section('A. 常量与历史契约（逐字不变）');
assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 恒为 7 条');
assert(BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'MEASURE 1 / ALL 8 条');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9, 'TRANSFORM 1 / FULL 9 条');
assert(BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'DUPLICATE 1 / COMPLETE 10 条');
assert(BOARD3D_RADIAL_OPS.length === 1 && BOARD3D_COMPLETE2_OPS.length === 11, 'RADIAL 1 / COMPLETE2 11 条');
assert(BOARD3D_MIRROR_OPS.length === 1 && BOARD3D_COMPLETE3_OPS.length === 12, 'MIRROR 1 / COMPLETE3 12 条');
assert(BOARD3D_GRID_OPS.length === 1 && BOARD3D_COMPLETE4_OPS.length === 13, 'GRID 1 / COMPLETE4 13 条');
assert(BOARD3D_ALIGN_OPS.length === 1 && BOARD3D_COMPLETE5_OPS.length === 14, 'ALIGN 1 / COMPLETE5 14 条');
assert(BOARD3D_HELIX_OPS.length === 1 && BOARD3D_COMPLETE6_OPS.length === 15, 'HELIX 1 / COMPLETE6 15 条');
assert(BOARD3D_BEZIER_OPS.length === 1 && BOARD3D_COMPLETE7_OPS.length === 16, 'BEZIER 1 / COMPLETE7 16 条');
assert(BOARD3D_ARC_OPS.length === 1 && BOARD3D_COMPLETE8_OPS.length === 17, 'ARC 1 / COMPLETE8 17 条');
assert(BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_COMPLETE9_OPS.length === 18, 'POLYHEDRON 1 / COMPLETE9 18 条');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_COMPLETE10_OPS.length === 19, 'REVOLVE 1 / COMPLETE10 19 条');
assert(BOARD3D_TORUS_OPS.length === 1 && BOARD3D_COMPLETE11_OPS.length === 20, 'TORUS 1 / COMPLETE11 20 条');
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_COMPLETE12_OPS.length === 21, 'ELLIPSOID 1 / COMPLETE12 21 条');
assert(BOARD3D_CAPSULE_OPS.length === 1 && BOARD3D_COMPLETE13_OPS.length === 22, 'CAPSULE 1 / COMPLETE13 22 条');
assert(BOARD3D_TUBE_OPS.length === 1 && BOARD3D_COMPLETE14_OPS.length === 23, 'TUBE 1 / COMPLETE14 23 条');
assert(BOARD3D_PRISM_OPS.length === 1 && BOARD3D_PRISM_OPS[0] === 'prism3d', 'PRISM_OPS = [prism3d]');
assert(BOARD3D_COMPLETE15_OPS.length === 24 && BOARD3D_COMPLETE15_OPS.includes('prism3d'), 'COMPLETE15 完整集 24 条含 prism3d');
assert(BOARD3D_COMPLETE15_OPS.slice(0, 23).join(',') === BOARD3D_COMPLETE14_OPS.join(','), 'COMPLETE15 前 23 条与 COMPLETE14 逐项一致（纯追加）');
assert(frozen(BOARD3D_PRISM_OPS) && frozen(BOARD3D_COMPLETE15_OPS), '新增 OP 常量被冻结');
assert(PRISM3D_BASE_MIN === 3 && PRISM3D_BASE_MAX === 32, '底面顶点数区间 [3,32]');
assert(PRISM3D_DEFAULT_BASE.length === 4 && frozen(PRISM3D_DEFAULT_BASE), '默认底面为正方形且被冻结');
assert(PRISM3D_HEIGHT_DEFAULT === 2 && PRISM3D_HEIGHT_MAX === 10000, '默认高度 2 / 上限 10000');
assert(PRISM3D_AXES.join(',') === 'x,y,z' && PRISM3D_AXIS_DEFAULT === 'z', '轴向白名单 x/y/z，默认 z');
assert(PRISM3D_VERTEX_SIZE_DEFAULT === 0.1 && PRISM3D_VERTEX_SIZE_MIN === 0.01 && PRISM3D_VERTEX_SIZE_MAX === 1, '顶点球半径 0.01~1 默认 0.1');
assert(PRISM3D_MAX_SEGMENTS === 4096 && PRISM3D_LABEL_LETTERS.length === 26, '段数上限 4096 / 26 个标注字母');

section('B. 数值工具与几何纯函数');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 7 ') === 7, 'num 取数字与数字字符串');
assert(num('') === null && num('1+1') === null && num(null) === null && num([1]) === null && num(NaN) === null, 'num 拒表达式/空/数组/NaN');
assert(approx(vecLen([3, 4, 0]), 5) && vecLen([0, 0, 0]) === 0, 'vecLen 三维长度');
{
  const top = prismTop(BASE4, [0, 0, 2]);
  assert(top.length === 4 && vecApprox(top[0], [-1, -1, 2]), 'prismTop 顶面=底面+向量');
  const BASE4_FIX = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
  assert(BASE4.every((p, i) => vecApprox(p, BASE4_FIX[i])), 'prismTop 未改动底面');
  const e = prismEdgeIndices(4);
  assert(e.baseEdges.length === 4 && e.topEdges.length === 4 && e.sides.length === 4, '边表 底 n + 顶 n + 侧 n');
  assert(JSON.stringify(e.baseEdges) === '[[0,1],[1,2],[2,3],[3,0]]', '底面闭合边索引正确');
  assert(JSON.stringify(e.sides) === '[[0,4],[1,5],[2,6],[3,7]]', '侧棱索引 [i, n+i] 正确');
  const e3 = prismEdgeIndices(3);
  assert(e3.baseEdges[2].join(',') === '2,0' && e3.topEdges[2].join(',') === '5,3', '三棱柱闭合边取模正确');
}

section('C. resolvePrism3D 命令解析');
{
  const r = resolvePrism3D({ op: 'prism3d' });
  assert(r.ok === true, '默认命令解析成功');
  assert(r.meta.vertexCount === 4 && r.meta.segmentCount === 12 && r.meta.itemCount === 12, '默认正方体 4 顶点 / 12 条线');
  assert(r.meta.stretchMode === 'axis' && r.meta.axis === 'z' && r.meta.height === 2, '默认沿 z 拉伸 2（正方体）');
  assert(r.meta.baseEdgeCount === 4 && r.meta.topEdgeCount === 4 && r.meta.sideEdgeCount === 4, '底面/顶面/侧棱各 4 条');
  assert(r.items.every((it) => it.type === 'line'), '默认只产出 line');
}
{
  const r = resolvePrism3D({ op: 'prism3d', id: 'tri', base: [[0, 0, 0], [2, 0, 0], [1, 1.732, 0]], height: 3 });
  assert(r.ok && r.meta.vertexCount === 3 && r.meta.segmentCount === 9, '三棱柱 3 顶点 / 9 条线');
  assert(r.meta.height === 3 && r.meta.vector.join(',') === '0,0,3', 'height+axis 生成 z 向拉伸向量');
}
{
  const base = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
  const vec = [0.8, 0, 3];
  const r = resolvePrism3D({ op: 'prism3d', id: 'ob', base, vector: vec, labelVertices: true, asVertices: true });
  assert(r.ok && r.meta.stretchMode === 'vector' && r.meta.vector.join(',') === '0.8,0,3', '显式 vector 解析（斜棱柱）');
  assert(approx(r.meta.height, len(vec)), 'height = 向量长度（斜棱柱高度非 z 分量）');
  assert(r.meta.pointCount === 8 && r.meta.labelCount === 8 && r.meta.itemCount === 28, '顶点球 + 顶点标注各 2n 个');
  const labels = r.items.filter((it) => it.type === 'label');
  assert(labels.map((it) => it.text).join(',') === "A,A',B,B',C,C',D,D'", '标注 A/B/C… 底面 + 顶面单引号后缀');
  const lines = r.items.filter((it) => it.type === 'line');
  assert(lines.length === 12 && lines.every((it) => it.id.startsWith('ob_')), 'line id 前缀正确');
}
{
  const r = resolvePrism3D({ op: 'prism3d', base: BASE4, vector: [0, 0, 2], asBase: false, asTop: false, asVertices: true });
  assert(r.ok && r.meta.segmentCount === 4 && r.meta.baseEdgeCount === 0 && r.meta.topEdgeCount === 0 && r.meta.sideEdgeCount === 4, '只开 asSides + asVertices：4 侧棱 + 8 点');
  assert(r.items.filter((it) => it.type === 'line').every((it) => it.id.includes('_s')), '仅侧棱产物 id 含 _s');
  assert(r.items.filter((it) => it.type === 'point').length === 8, '2n 个顶点球');
}
{
  const r = resolvePrism3D({ op: 'prism3d', base: BASE4, vector: [0, 0, 2], asBase: false, asTop: false, asSides: false, labelVertices: true });
  assert(r.ok && r.meta.segmentCount === 0 && r.meta.labelCount === 8, '仅开 labelVertices 仍成功');
}
{
  const r = resolvePrism3D({ op: 'prism3d', base: BASE4, vector: ['0', '0', '2'], height: '5', vertexSize: '0.2', opacity: '0.8' });
  assert(r.ok && r.meta.vector.join(',') === '0,0,2' && r.meta.vertexSize === 0.2, '数字字符串容错（vector/vertexSize）');
  assert(r.meta.opacity === 0.8, 'opacity 数字字符串容错');
}
{
  const r = resolvePrism3D({ op: 'prism3d', base: BASE4, vector: [1, 2, 3], color: '#123', labelColor: '#abcdef', opacity: 0.5 });
  assert(r.ok && r.meta.color === '#123' && r.meta.labelColor === '#abcdef' && r.meta.opacity === 0.5, '样式透传');
}
{
  const r = resolvePrism3D({ op: 'prism3d', axis: 'x', height: 4 });
  assert(r.ok && r.meta.axis === 'x' && r.meta.vector.join(',') === '4,0,0', 'axis=x 沿 x 拉伸');
  const ry = resolvePrism3D({ op: 'prism3d', axis: 'y', height: 1 });
  assert(ry.ok && ry.meta.vector.join(',') === '0,1,0', 'axis=y 沿 y 拉伸');
}
{
  const r = resolvePrism3D({ op: 'prism3d', height: 0 });
  assert(r.ok && r.meta.height === 0 && r.meta.top.every((p, i) => vecApprox(p, r.meta.base[i])), 'height=0 顶底面重合（退化）');
}
{
  const state = { objects: [{ id: 'p_b1' }, { id: 'p_b1_2' }] };
  const r = resolvePrism3D({ op: 'prism3d', id: 'p', state }, state);
  assert(r.ok, '带 state 命令解析成功（state 单独参数）');
  const r2 = resolvePrism3D({ op: 'prism3d', id: 'p' }, state);
  const ids = r2.items.map((it) => it.id);
  assert(ids.includes('p_b1_3') && !ids.includes('p_b1') && !ids.includes('p_b1_2'), 'id 避让：p_b1、p_b1_2 已被占 → 跳过至 _3');
  assert(new Set(ids).size === ids.length, '所有产物 id 唯一');
  const longId = 'q'.repeat(64);
  const r3 = resolvePrism3D({ op: 'prism3d', id: longId }, { objects: [{ id: longId.slice(0, 56) + '_b1' }] });
  assert(r3.ok && r3.items.every((it) => it.id.length <= 64), '64 字符长 id 避让不死循环、id 长度合法');
}
{
  const n32 = Array.from({ length: 32 }, (_, i) => [i, i % 2, 0]);
  const r = resolvePrism3D({ op: 'prism3d', base: n32 });
  assert(r.ok && r.meta.vertexCount === 32 && r.meta.segmentCount === 96, '最大 32 边形底面成功');
}

section('D. 几何守恒（顶面=底面+向量、侧棱平行等长）');
{
  const base = [[-1, -1, 0], [1, -1, 0], [0.3, 1.4, 0.2]];
  const vec = [0.7, -0.4, 2.5];
  const r = resolvePrism3D({ op: 'prism3d', base, vector: vec });
  assert(r.ok, '守恒用例解析成功');
  r.meta.top.forEach((t, i) => {
    assert(vecApprox(sub(t, r.meta.base[i]), vec, 3e-3), `顶面 T${i} - 底面 B${i} = 拉伸向量`);
  });
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  assert(sideLines.length === 3, '3 条侧棱');
  const sideVecs = sideLines.map((it) => [it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1]);
  sideVecs.forEach((sv, i) => assert(vecApprox(sv, vec, 3e-3), `侧棱 ${i} 向量 == 拉伸向量`));
  assert(sideVecs.every((sv) => approx(len(sv), len(vec), 3e-3)), '3 条侧棱等长');
  assert(approx(r.meta.height, len(vec)), 'meta.height = 向量长度');
}

section('E. 脏输入原子拒绝（零副作用）');
const badCases = [
  [null, '命令为空'],
  [[], '数组命令拒绝'],
  [{ op: 'prism3d', id: 123 }, 'id 非字符串'],
  [{ op: 'prism3d', id: 'bad id' }, 'id 含空格'],
  [{ op: 'prism3d', base: [[0, 0, 0], [1, 1, 1]] }, 'base 少于 3 点'],
  [{ op: 'prism3d', base: Array.from({ length: 33 }, (_, i) => [i, 0, 0]) }, 'base 超过 32 点'],
  [{ op: 'prism3d', base: [[0, 0], [1, 1, 1], [2, 2, 2]] }, 'base 含非三元组'],
  [{ op: 'prism3d', base: [[0, 0, 'x'], [1, 1, 1], [2, 2, 2]] }, 'base 含非数值'],
  [{ op: 'prism3d', base: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], vector: 'x' }, 'vector 非数组'],
  [{ op: 'prism3d', vector: [0, 0] }, 'vector 非三元组'],
  [{ op: 'prism3d', vector: [0, 'x', 2] }, 'vector 含非数值'],
  [{ op: 'prism3d', axis: 'w' }, 'axis 非法'],
  [{ op: 'prism3d', height: -1 }, 'height 负数'],
  [{ op: 'prism3d', height: 10001 }, 'height 越界'],
  [{ op: 'prism3d', height: 'x' }, 'height 非数值'],
  [{ op: 'prism3d', vertexSize: 0 }, 'vertexSize 越界小'],
  [{ op: 'prism3d', vertexSize: 2 }, 'vertexSize 越界大'],
  [{ op: 'prism3d', vertexSize: 'x' }, 'vertexSize 非数值'],
  [{ op: 'prism3d', asBase: 'true' }, 'asBase 非布尔'],
  [{ op: 'prism3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'prism3d', asVertices: null }, 'asVertices 非布尔'],
  [{ op: 'prism3d', opacity: 'x' }, 'opacity 非数值'],
  [{ op: 'prism3d', asBase: false, asTop: false, asSides: false, asVertices: false, labelVertices: false }, '五开关全关'],
];
for (const [cmd, label] of badCases) {
  const r = resolvePrism3D(cmd);
  assert(r.ok === false && typeof r.error === 'string' && r.error.length > 0, `原子拒绝：${label}`);
}

section('F. 深度只读性');
{
  const base = BASE4.map((p) => p.slice());
  const state = { objects: [{ id: 'existing' }] };
  const cmd = Object.freeze({ op: 'prism3d', base: Object.freeze(base.map((p) => Object.freeze(p.slice()))), vector: Object.freeze([0, 0, 2]), labelVertices: true });
  const snapshot = JSON.stringify(cmd);
  const stateSnapshot = JSON.stringify(state);
  const r = resolvePrism3D(cmd, state);
  assert(r.ok, '冻结入参仍能解析');
  assert(JSON.stringify(cmd) === snapshot, 'cmd 未被修改（深度只读）');
  assert(JSON.stringify(state) === stateSnapshot, 'state 未被修改（深度只读）');
  r.meta.base[0][0] = 999;
  r.items[0].id = 'mutated';
  assert(base[0][0] === -1, '返回值与入参无引用共享（改 meta 不影响 base）');
  const r2 = resolvePrism3D({ op: 'prism3d', base: BASE4, vector: [0, 0, 2] });
  assert(r2.items[0].id === 'prism_b1', '再次解析结果不受前次改动影响');
}

section('G. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const added = [];
  const a = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return true; } };
  const r = applyBoard3DCommands([{ op: 'prism3d', id: 'cube', labelVertices: true, asVertices: true }], a);
  assert(r.length === 1 && r[0].ok === true && r[0].op === 'prism3d', '执行器单条成功');
  assert(r[0].count === 28 && r[0].created.length === 28 && added.length === 28, '28 项逐段落地');
  assert(added.filter((o) => o.type === 'line').length === 12 && added.filter((o) => o.type === 'point').length === 8 && added.filter((o) => o.type === 'label').length === 8, 'line/point/label 三类产物数量正确');
  assert(r[0].meta.vertexCount === 4 && r[0].meta.labelCount === 8, 'meta 回读正确');
}
{
  const a = { getState: () => ({ objects: [{ id: 'cube_b1' }, { id: 'cube_b1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'prism3d', id: 'cube' }], a);
  assert(r[0].ok === true && r[0].created.some((c) => c.id === 'cube_b1_3'), '已有 id 被避让（_3）');
}
{
  for (const gs of [undefined, () => { throw new Error('boom'); }]) {
    const a = gs ? { getState: gs, add: (o) => o.id } : { add: (o) => o.id };
    const r = applyBoard3DCommands([{ op: 'prism3d', id: 'x' }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  const a = { getState: () => ({ objects: [] }), add: (o) => (o.id.endsWith('_s2') ? false : (o.id.endsWith('_s3') ? null : true)) };
  const r = applyBoard3DCommands([{ op: 'prism3d', id: 'cube' }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 2, 'api 部分失败（false/null）分项回报');
  assert(r[0].failed.every((f) => f.error === '画板新建失败'), '失败项错误文案正确');
}
{
  const r = applyBoard3DCommands([{ op: 'add', type: 'circle' }], api());
  assert(r[0].ok === false && /不支持的 3D 命令/.test(r[0].error), '2D 命令在 3D 分支被拒绝');
}
{
  const many = Array.from({ length: 5 }, (_, i) => ({ op: 'prism3d', id: 'p' + i }));
  const r = applyBoard3DCommands(many, api(), { maxCommands: 3 });
  assert(r.length === 5 && r[0].ok && r[1].ok && r[2].ok && r[3].ok === false && r[4].ok === false && /上限/.test(r[3].error), 'maxCommands 超限追加失败回执');
}
{
  const r = applyBoard3DCommands([{ op: 'prism3d', base: [[0, 0, 0], [1, 1, 1]] }], api());
  assert(r[0].ok === false && /base/.test(r[0].error), '脏参数在执行器内原子拒绝、零副作用');
}

section('H. 协议两侧一致性');
assert(BOARD3D_PRISM_PROMPT_OPS.length === 1 && BOARD3D_PRISM_PROMPT_OPS[0] === 'prism3d', '提示词 OP 常量 = [prism3d]');
assert(frozen(BOARD3D_PRISM_PROMPT_OPS), '提示词 OP 常量被冻结');
assert(BOARD3D_PRISM_PROMPT.includes('prism3d') && BOARD3D_PRISM_PROMPT.includes('base') && BOARD3D_PRISM_PROMPT.includes('vector'), '提示词含命令名与核心参数');
assert(BOARD3D_PRISM_PROMPT.includes('标注') && BOARD3D_PRISM_PROMPT.includes("labelVertices"), '提示词含顶点标注说明');
assert(BOARD3D_PRISM_PROMPT.includes('2D'), '提示词含 2D 隔离铁律');
assert(BOARD3D_PRISM_PROMPT.includes('斜棱柱'), '提示词含斜棱柱说明');
assert(resolveBoardMode({ mode: '3d' }) === '3d' && resolveBoardMode({ mode: '2d' }) === '2d', 'resolveBoardMode 3D/2D 分流未变');
assert(resolveBoardMode({ detect3d: true }, '画个正方体') === '3d', '显式 detect3d 命中 3D 意图走 3D 协议');
assert(resolveBoardMode({}, '画个正方体') === '2d', '未开 detect3d 默认 2D（不误伤 2D）');
{
  const promptSrc = read('ai/board-prompt.js');
  assert(promptSrc.indexOf('BOARD3D_TUBE_PROMPT') < promptSrc.indexOf('BOARD3D_PRISM_PROMPT'), '共享文件为末尾纯追加（TUBE 在前、PRISM 在后）');
  assert(/BOARD_SYSTEM_PROMPT/.test(promptSrc), '2D 主干 BOARD_SYSTEM_PROMPT 仍在');
  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD3D_PRISM_PROMPT') && backend.includes('BOARD3D_TUBE_PROMPT + BOARD3D_PRISM_PROMPT'), '后端 import 与 3D 拼接串末尾追加');
}

section('I. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍指向本地 vendor Three.js');
assert(page.includes('prism3d'), '页面 AI tip 已追加 prism3d 说明');
assert(read('js/board3d-ai.js').includes("pr.op !== 'prism3d'"), 'AI 面板已追加 prism3d 展示块');
const execSrc = read('js/board3d-executor.js');
assert(execSrc.includes("case 'prism3d'") && execSrc.includes("import { resolvePrism3D }"), '执行器已追加 prism3d 分支与 import');
assert(read('docs/3D画板回归用例清单.md').includes('D24'), '回归清单已追加 D24 记录');

section('结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exitCode = 1;

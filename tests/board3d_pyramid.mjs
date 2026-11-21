/**
 * 3D 通用棱锥命令（pyramid3d · D25）无头回归。
 *
 * 覆盖：pyramidCentroid / pyramidApex / pyramidEdgeIndices / resolvePyramid3D 纯函数
 *       （几何守恒：顶点=质心+轴×高、侧棱从底点连顶点、正棱锥侧棱等长 / 斜棱锥不等长 /
 *       默认正四棱锥 / 三棱锥 / 五棱锥 / 输出开关 / 顶点球与 A/B/C…+S 标注 / 样式 /
 *       数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_pyramid.mjs
 */
import {
  BOARD3D_PYRAMID_PROMPT, BOARD3D_PYRAMID_PROMPT_OPS,
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
  BOARD3D_PYRAMID_OPS, BOARD3D_COMPLETE16_OPS,
} from '../js/board3d-executor.js';
import {
  PYRAMID3D_BASE_MIN, PYRAMID3D_BASE_MAX, PYRAMID3D_DEFAULT_BASE,
  PYRAMID3D_HEIGHT_DEFAULT, PYRAMID3D_HEIGHT_MAX, PYRAMID3D_AXES, PYRAMID3D_AXIS_DEFAULT,
  PYRAMID3D_VERTEX_SIZE_DEFAULT, PYRAMID3D_VERTEX_SIZE_MIN, PYRAMID3D_VERTEX_SIZE_MAX,
  PYRAMID3D_MAX_SEGMENTS, PYRAMID3D_LABEL_LETTERS, PYRAMID3D_APEX_LABEL,
  num, pyramidCentroid, pyramidApex, pyramidEdgeIndices, resolvePyramid3D,
} from '../js/board3d-pyramid.js';
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
assert(BOARD3D_PRISM_OPS.length === 1 && BOARD3D_COMPLETE15_OPS.length === 24, 'PRISM 1 / COMPLETE15 24 条');
assert(BOARD3D_PYRAMID_OPS.length === 1 && BOARD3D_PYRAMID_OPS[0] === 'pyramid3d', 'PYRAMID_OPS = [pyramid3d]');
assert(BOARD3D_COMPLETE16_OPS.length === 25 && BOARD3D_COMPLETE16_OPS.includes('pyramid3d'), 'COMPLETE16 完整集 25 条含 pyramid3d');
assert(BOARD3D_COMPLETE16_OPS.slice(0, 24).join(',') === BOARD3D_COMPLETE15_OPS.join(','), 'COMPLETE16 前 24 条与 COMPLETE15 逐项一致（纯追加）');
assert(frozen(BOARD3D_PYRAMID_OPS) && frozen(BOARD3D_COMPLETE16_OPS), '新增 OP 常量被冻结');
assert(PYRAMID3D_BASE_MIN === 3 && PYRAMID3D_BASE_MAX === 32, '底面顶点数区间 [3,32]');
assert(PYRAMID3D_DEFAULT_BASE.length === 4 && frozen(PYRAMID3D_DEFAULT_BASE), '默认底面为正方形且被冻结');
assert(PYRAMID3D_HEIGHT_DEFAULT === 3 && PYRAMID3D_HEIGHT_MAX === 10000, '默认高度 3 / 上限 10000');
assert(PYRAMID3D_AXES.join(',') === 'x,y,z' && PYRAMID3D_AXIS_DEFAULT === 'z', '轴向白名单 x/y/z，默认 z');
assert(PYRAMID3D_VERTEX_SIZE_DEFAULT === 0.1 && PYRAMID3D_VERTEX_SIZE_MIN === 0.01 && PYRAMID3D_VERTEX_SIZE_MAX === 1, '顶点球半径 0.01~1 默认 0.1');
assert(PYRAMID3D_MAX_SEGMENTS === 4096 && PYRAMID3D_LABEL_LETTERS.length === 26 && PYRAMID3D_APEX_LABEL === 'S', '段数上限 4096 / 26 字母 / 顶点 S');

section('B. 数值工具与几何纯函数');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 7 ') === 7, 'num 取数字与数字字符串');
assert(num('') === null && num('1+1') === null && num(null) === null && num([1]) === null && num(NaN) === null, 'num 拒表达式/空/数组/NaN');
{
  const c = pyramidCentroid(BASE4);
  assert(vecApprox(c, [0, 0, 0]), '正方形底面质心 [0,0,0]');
  assert(vecApprox(pyramidCentroid([[0, 0, 0], [2, 0, 0], [1, 3, 0]]), [1, 1, 0]), '三角形底面质心 = 算术平均');
  assert(BASE4.every((p, i) => vecApprox(p, [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]][i])), 'pyramidCentroid 未改动底面');
}
{
  assert(vecApprox(pyramidApex([0, 0, 0], 'z', 3), [0, 0, 3]), 'pyramidApex 沿 z 抬升 3');
  assert(vecApprox(pyramidApex([1, 1, 1], 'x', 4), [5, 1, 1]), 'pyramidApex 沿 x 抬升 4（质心偏移）');
  assert(vecApprox(pyramidApex([1, 2, 3], 'y', 2), [1, 4, 3]), 'pyramidApex 沿 y 抬升 2');
}
{
  const e = pyramidEdgeIndices(4);
  assert(e.baseEdges.length === 4 && e.apexEdges.length === 4, '边表 底 n + 侧 n');
  assert(JSON.stringify(e.baseEdges) === '[[0,1],[1,2],[2,3],[3,0]]', '底面闭合边索引正确');
  assert(JSON.stringify(e.apexEdges) === '[[0,4],[1,4],[2,4],[3,4]]', '侧棱索引 [i,n] 全部指向 apex');
  const e3 = pyramidEdgeIndices(3);
  assert(e3.baseEdges[2].join(',') === '2,0' && e3.apexEdges[2].join(',') === '2,3', '三棱锥闭合边取模正确');
}

section('C. resolvePyramid3D 命令解析');
{
  const r = resolvePyramid3D({ op: 'pyramid3d' });
  assert(r.ok === true, '默认命令解析成功');
  assert(r.meta.vertexCount === 4 && r.meta.segmentCount === 8 && r.meta.itemCount === 8, '默认正四棱锥 4 底点 / 8 条线');
  assert(r.meta.apexMode === 'axis' && r.meta.axis === 'z' && r.meta.height === 3, '默认质心沿 z 抬升 3');
  assert(vecApprox(r.meta.apex, [0, 0, 3]) && vecApprox(r.meta.centroid, [0, 0, 0]), '默认顶点 [0,0,3]、质心原点');
  assert(r.meta.baseEdgeCount === 4 && r.meta.sideEdgeCount === 4, '底边/侧棱各 4 条');
  assert(r.items.every((it) => it.type === 'line'), '默认只产出 line');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', id: 'tri', base: [[0, 0, 0], [2, 0, 0], [1, 1.732, 0]], height: 3, labelVertices: true, asVertices: true });
  assert(r.ok && r.meta.vertexCount === 3 && r.meta.segmentCount === 6, '三棱锥 3 底点 / 6 条线');
  assert(r.meta.height === 3 && r.meta.pointCount === 4 && r.meta.labelCount === 4, '顶点球与标注各 n+1=4');
  assert(r.items.filter((it) => it.type === 'label').map((it) => it.text).join(',') === 'A,B,C,S', '标注 A/B/C 底点 + S 顶点');
}
{
  const base = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
  const apex = [3, 1, 4];
  const r = resolvePyramid3D({ op: 'pyramid3d', id: 'ob', base, apex, labelVertices: true, asVertices: true });
  assert(r.ok && r.meta.apexMode === 'explicit' && vecApprox(r.meta.apex, [3, 1, 4]), '显式 apex 解析（斜棱锥）');
  assert(r.meta.height === null && r.meta.axis === undefined, '显式 apex 模式无 height/axis 字段');
  assert(r.meta.pointCount === 5 && r.meta.labelCount === 5 && r.meta.itemCount === 18, '顶点球 + 标注各 n+1、共 18 项');
  const lines = r.items.filter((it) => it.type === 'line');
  assert(lines.length === 8 && lines.every((it) => it.id.startsWith('ob_')), 'line id 前缀正确');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', apex: [0, 0, 2], axis: 'w', height: 'x' });
  assert(r.ok, '显式 apex 时忽略非法 axis/height（与 prism3d 给 vector 忽略 axis/height 同口径）');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', base: BASE4, apex: [0, 0, 2], asBase: false, asVertices: true });
  assert(r.ok && r.meta.segmentCount === 4 && r.meta.baseEdgeCount === 0 && r.meta.sideEdgeCount === 4, '只开 asSides + asVertices：4 侧棱 + 5 点');
  assert(r.items.filter((it) => it.type === 'line').every((it) => it.id.includes('_s')), '仅侧棱产物 id 含 _s');
  assert(r.items.filter((it) => it.type === 'point').length === 5, 'n+1 个顶点球');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', base: BASE4, apex: [0, 0, 2], asBase: false, asSides: false, labelVertices: true });
  assert(r.ok && r.meta.segmentCount === 0 && r.meta.labelCount === 5, '仅开 labelVertices 仍成功');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', base: BASE4, apex: ['0', '0', '2'], height: '5', vertexSize: '0.2', opacity: '0.8' });
  assert(r.ok && vecApprox(r.meta.apex, [0, 0, 2]) && r.meta.vertexSize === 0.2, '数字字符串容错（apex/vertexSize）');
  assert(r.meta.opacity === 0.8, 'opacity 数字字符串容错');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', base: BASE4, apex: [0, 0, 2], color: '#123', labelColor: '#abcdef', opacity: 0.5 });
  assert(r.ok && r.meta.color === '#123' && r.meta.labelColor === '#abcdef' && r.meta.opacity === 0.5, '样式透传');
}
{
  const rx = resolvePyramid3D({ op: 'pyramid3d', axis: 'x', height: 4 });
  assert(rx.ok && rx.meta.axis === 'x' && vecApprox(rx.meta.apex, [4, 0, 0]), 'axis=x 顶点沿 x 抬升');
  const ry = resolvePyramid3D({ op: 'pyramid3d', axis: 'y', height: 1 });
  assert(ry.ok && ry.meta.axis === 'y' && vecApprox(ry.meta.apex, [0, 1, 0]), 'axis=y 顶点沿 y 抬升');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', height: 0 });
  assert(r.ok && r.meta.height === 0 && vecApprox(r.meta.apex, r.meta.centroid), 'height=0 顶点落在质心（退化）');
}
{
  const state = { objects: [{ id: 'p_b1' }, { id: 'p_b1_2' }] };
  const r = resolvePyramid3D({ op: 'pyramid3d', id: 'p', state }, state);
  assert(r.ok, '带 state 命令解析成功（state 单独参数）');
  const r2 = resolvePyramid3D({ op: 'pyramid3d', id: 'p' }, state);
  const ids = r2.items.map((it) => it.id);
  assert(ids.includes('p_b1_3') && !ids.includes('p_b1') && !ids.includes('p_b1_2'), 'id 避让：p_b1、p_b1_2 已被占 → 跳过至 _3');
  assert(new Set(ids).size === ids.length, '所有产物 id 唯一');
  const longId = 'q'.repeat(64);
  const r3 = resolvePyramid3D({ op: 'pyramid3d', id: longId }, { objects: [{ id: longId.slice(0, 56) + '_b1' }] });
  assert(r3.ok && r3.items.every((it) => it.id.length <= 64), '64 字符长 id 避让不死循环、id 长度合法');
}
{
  const n32 = Array.from({ length: 32 }, (_, i) => [i, i % 2, 0]);
  const r = resolvePyramid3D({ op: 'pyramid3d', base: n32 });
  assert(r.ok && r.meta.vertexCount === 32 && r.meta.segmentCount === 64, '最大 32 边形底面成功');
}
{
  const penta = [[1, 0, 0], [0.309, 0.951, 0], [-0.809, 0.588, 0], [-0.809, -0.588, 0], [0.309, -0.951, 0]];
  const r = resolvePyramid3D({ op: 'pyramid3d', base: penta });
  assert(r.ok && r.meta.segmentCount === 10 && r.meta.vertexCount === 5, '五棱锥 5 底点 / 10 条线');
}

section('D. 几何守恒（顶点=质心+轴×高、侧棱指向 apex）');
{
  const base = [[-1, -1, 0], [1, -1, 0], [0.3, 1.4, 0.2]];
  const r = resolvePyramid3D({ op: 'pyramid3d', base, axis: 'z', height: 2.5 });
  assert(r.ok, '守恒用例解析成功');
  const c = pyramidCentroid(base);
  assert(vecApprox(r.meta.apex, [c[0], c[1], c[2] + 2.5], 3e-3), '顶点 = 底面质心沿 z + height');
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  assert(sideLines.length === 3, '3 条侧棱');
  sideLines.forEach((it, i) => {
    const sv = [it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1];
    assert(vecApprox(sv, sub(r.meta.apex, base[i]), 3e-3), `侧棱 ${i} 向量 = apex - 底点 ${i}`);
    assert(vecApprox([it.p.x1, it.p.y1, it.p.z1], base[i], 3e-3), `侧棱 ${i} 起点为底点 ${i}`);
  });
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d' });
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  const lens = sideLines.map((it) => len([it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1]));
  assert(lens.every((l) => approx(l, Math.sqrt(11), 3e-3)), '正四棱锥 4 条侧棱等长 √11');
  assert(approx(lens[0], lens[3], 1e-9), '正四棱锥侧棱长度精确一致');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', apex: [3, 1, 4] });
  const lens = r.items.filter((it) => it.id.includes('_s'))
    .map((it) => len([it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1]));
  assert(Math.max(...lens) - Math.min(...lens) > 1, '斜棱锥侧棱不等长（顶点偏离质心）');
}
{
  const r = resolvePyramid3D({ op: 'pyramid3d', base: [[0, 0, 0], [2, 0, 0], [1, 1.732, 0]], height: 3 });
  const baseLines = r.items.filter((it) => it.id.includes('_b'));
  assert(baseLines.length === 3 && baseLines.every((it) => approx(it.p.z1, 0) && approx(it.p.z2, 0)), '三棱锥底面闭合线在 z=0 平面');
}

section('E. 脏输入原子拒绝（零副作用）');
const badCases = [
  [null, '命令为空'],
  [[], '数组命令拒绝'],
  [{ op: 'pyramid3d', id: 123 }, 'id 非字符串'],
  [{ op: 'pyramid3d', id: 'bad id' }, 'id 含空格'],
  [{ op: 'pyramid3d', base: [[0, 0, 0], [1, 1, 1]] }, 'base 少于 3 点'],
  [{ op: 'pyramid3d', base: Array.from({ length: 33 }, (_, i) => [i, 0, 0]) }, 'base 超过 32 点'],
  [{ op: 'pyramid3d', base: [[0, 0], [1, 1, 1], [2, 2, 2]] }, 'base 含非三元组'],
  [{ op: 'pyramid3d', base: [[0, 0, 'x'], [1, 1, 1], [2, 2, 2]] }, 'base 含非数值'],
  [{ op: 'pyramid3d', base: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], apex: 'x' }, 'apex 非数组'],
  [{ op: 'pyramid3d', apex: [0, 0] }, 'apex 非三元组'],
  [{ op: 'pyramid3d', apex: [0, 'x', 2] }, 'apex 含非数值'],
  [{ op: 'pyramid3d', axis: 'w' }, 'axis 非法'],
  [{ op: 'pyramid3d', height: -1 }, 'height 负数'],
  [{ op: 'pyramid3d', height: 10001 }, 'height 越界'],
  [{ op: 'pyramid3d', height: 'x' }, 'height 非数值'],
  [{ op: 'pyramid3d', vertexSize: 0 }, 'vertexSize 越界小'],
  [{ op: 'pyramid3d', vertexSize: 2 }, 'vertexSize 越界大'],
  [{ op: 'pyramid3d', vertexSize: 'x' }, 'vertexSize 非数值'],
  [{ op: 'pyramid3d', asBase: 'true' }, 'asBase 非布尔'],
  [{ op: 'pyramid3d', asSides: 1 }, 'asSides 非布尔'],
  [{ op: 'pyramid3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'pyramid3d', asVertices: null }, 'asVertices 非布尔'],
  [{ op: 'pyramid3d', opacity: 'x' }, 'opacity 非数值'],
  [{ op: 'pyramid3d', asBase: false, asSides: false, asVertices: false, labelVertices: false }, '四开关全关'],
];
for (const [cmd, label] of badCases) {
  const r = resolvePyramid3D(cmd);
  assert(r.ok === false && typeof r.error === 'string' && r.error.length > 0, `原子拒绝：${label}`);
}

section('F. 深度只读性');
{
  const base = BASE4.map((p) => p.slice());
  const state = { objects: [{ id: 'existing' }] };
  const cmd = Object.freeze({ op: 'pyramid3d', base: Object.freeze(base.map((p) => Object.freeze(p.slice()))), apex: Object.freeze([0, 0, 3]), labelVertices: true });
  const snapshot = JSON.stringify(cmd);
  const stateSnapshot = JSON.stringify(state);
  const r = resolvePyramid3D(cmd, state);
  assert(r.ok, '冻结入参仍能解析');
  assert(JSON.stringify(cmd) === snapshot, 'cmd 未被修改（深度只读）');
  assert(JSON.stringify(state) === stateSnapshot, 'state 未被修改（深度只读）');
  r.meta.base[0][0] = 999;
  r.meta.apex[0] = 999;
  r.items[0].id = 'mutated';
  assert(base[0][0] === -1, '返回值与入参无引用共享（改 meta.base 不影响 base）');
  const r2 = resolvePyramid3D({ op: 'pyramid3d' });
  assert(r2.items[0].id === 'pyramid_b1' && r2.meta.apex[0] === 0, '再次解析结果不受前次改动影响');
}

section('G. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const added = [];
  const a = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return true; } };
  const r = applyBoard3DCommands([{ op: 'pyramid3d', id: 'pyr', labelVertices: true, asVertices: true }], a);
  assert(r.length === 1 && r[0].ok === true && r[0].op === 'pyramid3d', '执行器单条成功');
  assert(r[0].count === 18 && r[0].created.length === 18 && added.length === 18, '18 项逐段落地');
  assert(added.filter((o) => o.type === 'line').length === 8 && added.filter((o) => o.type === 'point').length === 5 && added.filter((o) => o.type === 'label').length === 5, 'line/point/label 三类产物数量正确');
  assert(r[0].meta.vertexCount === 4 && r[0].meta.labelCount === 5, 'meta 回读正确');
}
{
  const a = { getState: () => ({ objects: [{ id: 'pyr_b1' }, { id: 'pyr_b1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'pyramid3d', id: 'pyr' }], a);
  assert(r[0].ok === true && r[0].created.some((c) => c.id === 'pyr_b1_3'), '已有 id 被避让（_3）');
}
{
  for (const gs of [undefined, () => { throw new Error('boom'); }]) {
    const a = gs ? { getState: gs, add: (o) => o.id } : { add: (o) => o.id };
    const r = applyBoard3DCommands([{ op: 'pyramid3d', id: 'x' }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  const a = { getState: () => ({ objects: [] }), add: (o) => (o.id.endsWith('_s2') ? false : (o.id.endsWith('_s3') ? null : true)) };
  const r = applyBoard3DCommands([{ op: 'pyramid3d', id: 'pyr' }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 2, 'api 部分失败（false/null）分项回报');
  assert(r[0].failed.every((f) => f.error === '画板新建失败'), '失败项错误文案正确');
}
{
  const r = applyBoard3DCommands([{ op: 'add', type: 'circle' }], api());
  assert(r[0].ok === false && /不支持的 3D 命令/.test(r[0].error), '2D 命令在 3D 分支被拒绝');
}
{
  const many = Array.from({ length: 5 }, (_, i) => ({ op: 'pyramid3d', id: 'p' + i }));
  const r = applyBoard3DCommands(many, api(), { maxCommands: 3 });
  assert(r.length === 5 && r[0].ok && r[1].ok && r[2].ok && r[3].ok === false && r[4].ok === false && /上限/.test(r[3].error), 'maxCommands 超限追加失败回执');
}
{
  const r = applyBoard3DCommands([{ op: 'pyramid3d', base: [[0, 0, 0], [1, 1, 1]] }], api());
  assert(r[0].ok === false && /base/.test(r[0].error), '脏参数在执行器内原子拒绝、零副作用');
}

section('H. 协议两侧一致性');
assert(BOARD3D_PYRAMID_PROMPT_OPS.length === 1 && BOARD3D_PYRAMID_PROMPT_OPS[0] === 'pyramid3d', '提示词 OP 常量 = [pyramid3d]');
assert(frozen(BOARD3D_PYRAMID_PROMPT_OPS), '提示词 OP 常量被冻结');
assert(BOARD3D_PYRAMID_PROMPT.includes('pyramid3d') && BOARD3D_PYRAMID_PROMPT.includes('base') && BOARD3D_PYRAMID_PROMPT.includes('apex'), '提示词含命令名与核心参数');
assert(BOARD3D_PYRAMID_PROMPT.includes('标注') && BOARD3D_PYRAMID_PROMPT.includes('labelVertices'), '提示词含顶点标注说明');
assert(BOARD3D_PYRAMID_PROMPT.includes('2D'), '提示词含 2D 隔离铁律');
assert(BOARD3D_PYRAMID_PROMPT.includes('斜棱锥') && BOARD3D_PYRAMID_PROMPT.includes('prism3d'), '提示词含斜棱锥说明与棱柱互补关系');
assert(resolveBoardMode({ mode: '3d' }) === '3d' && resolveBoardMode({ mode: '2d' }) === '2d', 'resolveBoardMode 3D/2D 分流未变');
assert(resolveBoardMode({ detect3d: true }, '画个棱锥') === '3d', '显式 detect3d 命中 3D 意图走 3D 协议');
assert(resolveBoardMode({}, '画个棱锥') === '2d', '未开 detect3d 默认 2D（不误伤 2D）');
{
  const promptSrc = read('ai/board-prompt.js');
  assert(promptSrc.indexOf('BOARD3D_PRISM_PROMPT') < promptSrc.indexOf('BOARD3D_PYRAMID_PROMPT'), '共享文件为末尾纯追加（PRISM 在前、PYRAMID 在后）');
  assert(/BOARD_SYSTEM_PROMPT/.test(promptSrc), '2D 主干 BOARD_SYSTEM_PROMPT 仍在');
  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD3D_PYRAMID_PROMPT') && backend.includes('BOARD3D_PRISM_PROMPT + BOARD3D_PYRAMID_PROMPT'), '后端 import 与 3D 拼接串末尾追加');
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
assert(page.includes('pyramid3d'), '页面 AI tip 已追加 pyramid3d 说明');
assert(read('js/board3d-ai.js').includes("py.op !== 'pyramid3d'"), 'AI 面板已追加 pyramid3d 展示块');
const execSrc = read('js/board3d-executor.js');
assert(execSrc.includes("case 'pyramid3d'") && execSrc.includes("import { resolvePyramid3D }"), '执行器已追加 pyramid3d 分支与 import');
assert(read('docs/3D画板回归用例清单.md').includes('D25'), '回归清单已追加 D25 记录');

section('结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exitCode = 1;

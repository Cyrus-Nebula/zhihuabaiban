/**
 * 3D 通用棱台命令（frustum3d · D26）无头回归。
 *
 * 覆盖：frustumCentroid / frustumTopPoint / frustumApex / frustumEdgeIndices / resolveFrustum3D
 *       纯函数（几何守恒：顶面=质心+(底点-质心)×ratio+轴向抬升、侧棱延长交锥顶、
 *       正棱台侧棱等长 / ratio=1 退化棱柱 / ratio=0 退化棱锥 / 显式 top 斜棱台 /
 *       默认正四棱台 / 三棱台 / 五棱台 / 输出开关 / 顶点球与 A/B/C…+A'/B'/C' 标注 /
 *       样式 / 数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_frustum.mjs
 */
import {
  BOARD3D_FRUSTUM_PROMPT, BOARD3D_FRUSTUM_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  FRUSTUM3D_BASE_MIN, FRUSTUM3D_BASE_MAX, FRUSTUM3D_DEFAULT_BASE,
  FRUSTUM3D_RATIO_DEFAULT, FRUSTUM3D_RATIO_MIN, FRUSTUM3D_RATIO_MAX,
  FRUSTUM3D_HEIGHT_DEFAULT, FRUSTUM3D_HEIGHT_MAX, FRUSTUM3D_AXES, FRUSTUM3D_AXIS_DEFAULT,
  FRUSTUM3D_VERTEX_SIZE_DEFAULT, FRUSTUM3D_VERTEX_SIZE_MIN, FRUSTUM3D_VERTEX_SIZE_MAX,
  FRUSTUM3D_MAX_SEGMENTS, FRUSTUM3D_LABEL_LETTERS,
  num, frustumCentroid, frustumTopPoint, frustumApex, frustumEdgeIndices, resolveFrustum3D,
} from '../js/board3d-frustum.js';
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
assert(BOARD3D_PYRAMID_OPS.length === 1 && BOARD3D_COMPLETE16_OPS.length === 25, 'PYRAMID 1 / COMPLETE16 25 条');
assert(BOARD3D_FRUSTUM_OPS.length === 1 && BOARD3D_FRUSTUM_OPS[0] === 'frustum3d', 'FRUSTUM_OPS = [frustum3d]');
assert(BOARD3D_COMPLETE17_OPS.length === 26 && BOARD3D_COMPLETE17_OPS.includes('frustum3d'), 'COMPLETE17 完整集 26 条含 frustum3d');
assert(BOARD3D_COMPLETE17_OPS.slice(0, 25).join(',') === BOARD3D_COMPLETE16_OPS.join(','), 'COMPLETE17 前 25 条与 COMPLETE16 逐项一致（纯追加）');
assert(frozen(BOARD3D_FRUSTUM_OPS) && frozen(BOARD3D_COMPLETE17_OPS), '新增 OP 常量被冻结');
assert(FRUSTUM3D_BASE_MIN === 3 && FRUSTUM3D_BASE_MAX === 32, '底面顶点数区间 [3,32]');
assert(FRUSTUM3D_DEFAULT_BASE.length === 4 && frozen(FRUSTUM3D_DEFAULT_BASE), '默认底面为正方形且被冻结');
assert(FRUSTUM3D_RATIO_DEFAULT === 0.5 && FRUSTUM3D_RATIO_MIN === 0 && FRUSTUM3D_RATIO_MAX === 1, '相似比 0~1 默认 0.5');
assert(FRUSTUM3D_HEIGHT_DEFAULT === 2 && FRUSTUM3D_HEIGHT_MAX === 10000, '默认高度 2 / 上限 10000');
assert(FRUSTUM3D_AXES.join(',') === 'x,y,z' && FRUSTUM3D_AXIS_DEFAULT === 'z', '轴向白名单 x/y/z，默认 z');
assert(FRUSTUM3D_VERTEX_SIZE_DEFAULT === 0.1 && FRUSTUM3D_VERTEX_SIZE_MIN === 0.01 && FRUSTUM3D_VERTEX_SIZE_MAX === 1, '顶点球半径 0.01~1 默认 0.1');
assert(FRUSTUM3D_MAX_SEGMENTS === 4096 && FRUSTUM3D_LABEL_LETTERS.length === 26, '段数上限 4096 / 26 字母');

section('B. 数值工具与几何纯函数');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 7 ') === 7, 'num 取数字与数字字符串');
assert(num('') === null && num('1+1') === null && num(null) === null && num([1]) === null && num(NaN) === null, 'num 拒表达式/空/数组/NaN');
{
  const c = frustumCentroid(BASE4);
  assert(vecApprox(c, [0, 0, 0]), '正方形底面质心 [0,0,0]');
  assert(vecApprox(frustumCentroid([[0, 0, 0], [2, 0, 0], [1, 3, 0]]), [1, 1, 0]), '三角形底面质心 = 算术平均');
  assert(BASE4.every((p, i) => vecApprox(p, [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]][i])), 'frustumCentroid 未改动底面');
}
{
  assert(vecApprox(frustumTopPoint([-1, -1, 0], [0, 0, 0], 0.5, 'z', 2), [-0.5, -0.5, 2]), '顶面点 = 质心+(底点-质心)*ratio+轴向抬升');
  assert(vecApprox(frustumTopPoint([2, 3, 0], [1, 1, 0], 0.5, 'x', 4), [5.5, 2, 0]), 'axis=x 顶面点沿 x 抬升');
  assert(vecApprox(frustumTopPoint([2, 3, 0], [1, 1, 0], 0.5, 'y', 4), [1.5, 6, 0]), 'axis=y 顶面点沿 y 抬升');
  assert(vecApprox(frustumTopPoint([2, 3, 0], [1, 1, 0], 1, 'z', 4), [2, 3, 4]), 'ratio=1 顶面点 = 底点+轴向抬升');
  assert(vecApprox(frustumTopPoint([2, 3, 0], [1, 1, 0], 0, 'z', 4), [1, 1, 4]), 'ratio=0 顶面点 = 质心+轴向抬升');
}
{
  assert(vecApprox(frustumApex([0, 0, 0], 'z', 2, 0.5), [0, 0, 4]), '锥顶 = 质心 + z×height/(1-ratio) = [0,0,4]');
  assert(vecApprox(frustumApex([1, 2, 3], 'x', 3, 0.25), [5, 2, 3]), '锥顶 axis=x 且质心偏移');
  assert(frustumApex([0, 0, 0], 'z', 2, 1) === null, 'ratio=1（棱柱）无有限锥顶返回 null');
  assert(vecApprox(frustumApex([0, 0, 0], 'z', 3, 0), [0, 0, 3]), 'ratio=0 锥顶 = 质心+轴向抬升（棱锥顶点）');
}
{
  const e = frustumEdgeIndices(4);
  assert(e.baseEdges.length === 4 && e.topEdges.length === 4 && e.sideEdges.length === 4, '边表 底 n + 顶 n + 侧 n');
  assert(JSON.stringify(e.baseEdges) === '[[0,1],[1,2],[2,3],[3,0]]', '底面闭合边索引正确');
  assert(JSON.stringify(e.topEdges) === '[[4,5],[5,6],[6,7],[7,4]]', '顶面闭合边索引正确（偏移 n）');
  assert(JSON.stringify(e.sideEdges) === '[[0,4],[1,5],[2,6],[3,7]]', '侧棱索引 [i,n+i] 全部指向顶面');
  const e3 = frustumEdgeIndices(3);
  assert(e3.baseEdges[2].join(',') === '2,0' && e3.topEdges[2].join(',') === '5,3', '三棱台闭合边取模正确');
}

section('C. resolveFrustum3D 命令解析');
{
  const r = resolveFrustum3D({ op: 'frustum3d' });
  assert(r.ok === true, '默认命令解析成功');
  assert(r.meta.vertexCount === 4 && r.meta.segmentCount === 12 && r.meta.itemCount === 12, '默认正四棱台 4 底点 / 12 条线');
  assert(r.meta.topMode === 'axis' && r.meta.axis === 'z' && r.meta.height === 2 && r.meta.ratio === 0.5, '默认质心相似比 0.5 沿 z 抬升 2');
  assert(vecApprox(r.meta.centroid, [0, 0, 0]), '默认质心原点');
  assert(r.meta.baseEdgeCount === 4 && r.meta.topEdgeCount === 4 && r.meta.sideEdgeCount === 4, '底边/顶边/侧棱各 4 条');
  assert(r.items.every((it) => it.type === 'line'), '默认只产出 line');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', id: 'tri', base: [[0, 0, 0], [2, 0, 0], [1, 1.732, 0]], height: 2, labelVertices: true, asVertices: true });
  assert(r.ok && r.meta.vertexCount === 3 && r.meta.segmentCount === 9, '三棱台 3 底点 / 9 条线');
  assert(r.meta.pointCount === 6 && r.meta.labelCount === 6, '顶点球与标注各 2n=6');
  const labelTexts = r.items.filter((it) => it.type === 'label').map((it) => it.text).join(',');
  assert(labelTexts === `A,B,C,A',B',C'`, `标注 A/B/C 底点 + A'/B'/C' 顶点（实际 ${labelTexts}）`);
}
{
  const top = [[0.6, 0.3, 3], [1.4, 0.3, 3], [1.4, 1.7, 3], [0.6, 1.7, 3]];
  const base = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
  const r = resolveFrustum3D({ op: 'frustum3d', id: 'ob', base, top, labelVertices: true, asVertices: true });
  assert(r.ok && r.meta.topMode === 'explicit', '显式 top 解析（斜棱台）');
  assert(r.meta.ratio === null && r.meta.height === null && r.meta.axis === undefined, '显式 top 模式无 ratio/height/axis 字段');
  assert(r.meta.apex === null, '显式 top 模式无锥顶字段');
  assert(r.meta.pointCount === 8 && r.meta.labelCount === 8 && r.meta.itemCount === 28, '顶点球 + 标注各 2n、共 28 项');
  const lines = r.items.filter((it) => it.type === 'line');
  assert(lines.length === 12 && lines.every((it) => it.id.startsWith('ob_')), 'line id 前缀正确');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', top: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], ratio: 'x', axis: 'w', height: 'x' });
  assert(r.ok, '显式 top 时忽略非法 ratio/axis/height（与 pyramid apex / prism vector 同口径）');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', ratio: 1, height: 3 });
  assert(r.ok && r.meta.ratio === 1 && r.meta.apex === null, 'ratio=1 退化为棱柱、锥顶为 null');
  const r0 = resolveFrustum3D({ op: 'frustum3d', ratio: 0, height: 3 });
  assert(r0.ok && r0.meta.ratio === 0 && vecApprox(r0.meta.apex, [0, 0, 3]), 'ratio=0 退化为棱锥、锥顶 [0,0,3]');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', asBase: false, asTop: false, asVertices: true });
  assert(r.ok && r.meta.segmentCount === 4 && r.meta.baseEdgeCount === 0 && r.meta.topEdgeCount === 0 && r.meta.sideEdgeCount === 4, '只开 asSides + asVertices：4 侧棱 + 8 点');
  assert(r.items.filter((it) => it.type === 'line').every((it) => it.id.includes('_s')), '仅侧棱产物 id 含 _s');
  assert(r.items.filter((it) => it.type === 'point').length === 8, '2n 个顶点球');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', asBase: false, asTop: false, asSides: false, labelVertices: true });
  assert(r.ok && r.meta.segmentCount === 0 && r.meta.labelCount === 8, '仅开 labelVertices 仍成功');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', ratio: '0.6', height: '5', vertexSize: '0.2', opacity: '0.8' });
  assert(r.ok && r.meta.ratio === 0.6 && r.meta.height === 5 && r.meta.vertexSize === 0.2, '数字字符串容错（ratio/height/vertexSize）');
  assert(r.meta.opacity === 0.8, 'opacity 数字字符串容错');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', color: '#123', labelColor: '#abcdef', opacity: 0.5 });
  assert(r.ok && r.meta.color === '#123' && r.meta.labelColor === '#abcdef' && r.meta.opacity === 0.5, '样式透传');
}
{
  const rx = resolveFrustum3D({ op: 'frustum3d', axis: 'x', height: 4 });
  assert(rx.ok && rx.meta.axis === 'x' && vecApprox(rx.meta.top[0], [3.5, -0.5, 0]), 'axis=x 顶面沿 x 抬升');
  const ry = resolveFrustum3D({ op: 'frustum3d', axis: 'y', height: 1 });
  assert(ry.ok && ry.meta.axis === 'y' && vecApprox(ry.meta.top[0], [-0.5, 0.5, 0]), 'axis=y 顶面沿 y 抬升');
}
{
  const state = { objects: [{ id: 'f_b1' }, { id: 'f_b1_2' }] };
  const r = resolveFrustum3D({ op: 'frustum3d', id: 'f' }, state);
  const ids = r.items.map((it) => it.id);
  assert(ids.includes('f_b1_3') && !ids.includes('f_b1') && !ids.includes('f_b1_2'), 'id 避让：f_b1、f_b1_2 已被占 → 跳过至 _3');
  assert(new Set(ids).size === ids.length, '所有产物 id 唯一');
  const longId = 'q'.repeat(64);
  const r3 = resolveFrustum3D({ op: 'frustum3d', id: longId }, { objects: [{ id: longId.slice(0, 56) + '_b1' }] });
  assert(r3.ok && r3.items.every((it) => it.id.length <= 64), '64 字符长 id 避让不死循环、id 长度合法');
}
{
  const n32 = Array.from({ length: 32 }, (_, i) => [i, i % 2, 0]);
  const r = resolveFrustum3D({ op: 'frustum3d', base: n32 });
  assert(r.ok && r.meta.vertexCount === 32 && r.meta.segmentCount === 96, '最大 32 边形底面成功');
}
{
  const penta = [[1, 0, 0], [0.309, 0.951, 0], [-0.809, 0.588, 0], [-0.809, -0.588, 0], [0.309, -0.951, 0]];
  const r = resolveFrustum3D({ op: 'frustum3d', base: penta });
  assert(r.ok && r.meta.segmentCount === 15 && r.meta.vertexCount === 5, '五棱台 5 底点 / 15 条线');
}

section('D. 几何守恒（顶面相似抬升、侧棱延长交锥顶、正棱台侧棱等长）');
{
  const base = [[-1, -1, 0], [1, -1, 0], [0.3, 1.4, 0.2]];
  const ratio = 0.5, height = 2.5;
  const r = resolveFrustum3D({ op: 'frustum3d', base, ratio, height, axis: 'z' });
  assert(r.ok, '守恒用例解析成功');
  const c = frustumCentroid(base);
  base.forEach((b, i) => {
    assert(vecApprox(r.meta.top[i], frustumTopPoint(b, c, ratio, 'z', height), 3e-3), `顶面点 ${i} = 质心+(底点-质心)*ratio+轴向抬升`);
  });
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  assert(sideLines.length === 3, '3 条侧棱');
  sideLines.forEach((it, i) => {
    const sv = [it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1];
    assert(vecApprox(sv, sub(r.meta.top[i], base[i]), 3e-3), `侧棱 ${i} 向量 = 顶面点 - 底点`);
    assert(vecApprox([it.p.x1, it.p.y1, it.p.z1], base[i], 3e-3), `侧棱 ${i} 起点为底点 ${i}`);
    assert(vecApprox([it.p.x2, it.p.y2, it.p.z2], r.meta.top[i], 3e-3), `侧棱 ${i} 终点为顶面点 ${i}`);
  });
  // 侧棱延长交点 = 锥顶：base_i + t*(top_i-base_i)，t = 1/(1-ratio) = 2
  const P = r.meta.apex;
  assert(vecApprox(P, [c[0], c[1], c[2] + height / (1 - ratio)], 3e-3), '锥顶 = 质心 + z×height/(1-ratio)');
  sideLines.forEach((it, i) => {
    const t = 1 / (1 - ratio);
    const ext = [it.p.x1 + t * (it.p.x2 - it.p.x1), it.p.y1 + t * (it.p.y2 - it.p.y1), it.p.z1 + t * (it.p.z2 - it.p.z1)];
    assert(vecApprox(ext, P, 3e-3), `侧棱 ${i} 延长交锥顶`);
  });
}
{
  const r = resolveFrustum3D({ op: 'frustum3d' });
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  const lens = sideLines.map((it) => len([it.p.x2 - it.p.x1, it.p.y2 - it.p.y1, it.p.z2 - it.p.z1]));
  // |B-C|=√2，侧棱长 = √((1-0.5)^2·2 + 2^2) = √4.5
  assert(lens.every((l) => approx(l, Math.sqrt(4.5), 3e-3)), '正四棱台 4 条侧棱等长 √4.5');
  assert(approx(lens[0], lens[3], 1e-9), '正四棱台侧棱长度精确一致');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', ratio: 1, height: 2 });
  const sideLines = r.items.filter((it) => it.id.includes('_s'));
  const allVertical = sideLines.every((it) => approx(it.p.x1, it.p.x2) && approx(it.p.y1, it.p.y2) && approx(it.p.z2 - it.p.z1, 2));
  assert(allVertical, 'ratio=1 棱柱退化：侧棱全垂直且长度 = height');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', ratio: 0, height: 3 });
  const topPts = r.items.filter((it) => it.id.includes('_t'));
  assert(topPts.every((it) => vecApprox([it.p.x1, it.p.y1, it.p.z1], [0, 0, 3])), 'ratio=0 棱锥退化：顶面线两端点均落在锥顶 [0,0,3]');
}
{
  const r = resolveFrustum3D({ op: 'frustum3d', base: [[0, 0, 0], [2, 0, 0], [1, 1.732, 0]], height: 2 });
  const baseLines = r.items.filter((it) => it.id.includes('_b'));
  assert(baseLines.length === 3 && baseLines.every((it) => approx(it.p.z1, 0) && approx(it.p.z2, 0)), '三棱台底面闭合线在 z=0 平面');
  const topLines = r.items.filter((it) => it.id.includes('_t'));
  assert(topLines.length === 3 && topLines.every((it) => approx(it.p.z1, 2) && approx(it.p.z2, 2)), '三棱台顶面闭合线在 z=2 平面');
}

section('E. 脏输入原子拒绝（零副作用）');
const badCases = [
  [null, '命令为空'],
  [[], '数组命令拒绝'],
  [{ op: 'frustum3d', id: 123 }, 'id 非字符串'],
  [{ op: 'frustum3d', id: 'bad id' }, 'id 含空格'],
  [{ op: 'frustum3d', base: [[0, 0, 0], [1, 1, 1]] }, 'base 少于 3 点'],
  [{ op: 'frustum3d', base: Array.from({ length: 33 }, (_, i) => [i, 0, 0]) }, 'base 超过 32 点'],
  [{ op: 'frustum3d', base: [[0, 0], [1, 1, 1], [2, 2, 2]] }, 'base 含非三元组'],
  [{ op: 'frustum3d', base: [[0, 0, 'x'], [1, 1, 1], [2, 2, 2]] }, 'base 含非数值'],
  [{ op: 'frustum3d', top: 'x' }, 'top 非数组'],
  [{ op: 'frustum3d', top: [[0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]] }, 'top 含非三元组'],
  [{ op: 'frustum3d', top: [[0, 0, 1], [1, 1, 1], [2, 2, 2]] }, 'top 数量少于 3'],
  [{ op: 'frustum3d', top: Array.from({ length: 33 }, (_, i) => [i, 0, 1]) }, 'top 超过 32 点'],
  [{ op: 'frustum3d', top: [[0, 0, 1], [1, 1, 1]] }, 'top 数量与 base 不等'],
  [{ op: 'frustum3d', ratio: -0.1 }, 'ratio 负数'],
  [{ op: 'frustum3d', ratio: 1.1 }, 'ratio 越界'],
  [{ op: 'frustum3d', ratio: 'x' }, 'ratio 非数值'],
  [{ op: 'frustum3d', axis: 'w' }, 'axis 非法'],
  [{ op: 'frustum3d', height: -1 }, 'height 负数'],
  [{ op: 'frustum3d', height: 10001 }, 'height 越界'],
  [{ op: 'frustum3d', height: 'x' }, 'height 非数值'],
  [{ op: 'frustum3d', vertexSize: 0 }, 'vertexSize 越界小'],
  [{ op: 'frustum3d', vertexSize: 2 }, 'vertexSize 越界大'],
  [{ op: 'frustum3d', vertexSize: 'x' }, 'vertexSize 非数值'],
  [{ op: 'frustum3d', asBase: 'true' }, 'asBase 非布尔'],
  [{ op: 'frustum3d', asTop: 1 }, 'asTop 非布尔'],
  [{ op: 'frustum3d', asSides: 1 }, 'asSides 非布尔'],
  [{ op: 'frustum3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'frustum3d', asVertices: null }, 'asVertices 非布尔'],
  [{ op: 'frustum3d', opacity: 'x' }, 'opacity 非数值'],
  [{ op: 'frustum3d', asBase: false, asTop: false, asSides: false, asVertices: false, labelVertices: false }, '五开关全关'],
];
for (const [cmd, label] of badCases) {
  const r = resolveFrustum3D(cmd);
  assert(r.ok === false && typeof r.error === 'string' && r.error.length > 0, `原子拒绝：${label}`);
}

section('F. 深度只读性');
{
  const base = BASE4.map((p) => p.slice());
  const topIn = [[0, 0, 2], [1, 0, 2], [1, 1, 2], [0, 1, 2]].map((p) => p.slice());
  const state = { objects: [{ id: 'existing' }] };
  const cmd = Object.freeze({ op: 'frustum3d', base: Object.freeze(base.map((p) => Object.freeze(p.slice()))), top: Object.freeze(topIn.map((p) => Object.freeze(p.slice()))), labelVertices: true });
  const snapshot = JSON.stringify(cmd);
  const stateSnapshot = JSON.stringify(state);
  const r = resolveFrustum3D(cmd, state);
  assert(r.ok, '冻结入参仍能解析');
  assert(JSON.stringify(cmd) === snapshot, 'cmd 未被修改（深度只读）');
  assert(JSON.stringify(state) === stateSnapshot, 'state 未被修改（深度只读）');
  r.meta.base[0][0] = 999;
  r.meta.top[0][0] = 999;
  r.items[0].id = 'mutated';
  assert(base[0][0] === -1, '返回值与入参无引用共享（改 meta.base 不影响 base）');
  assert(topIn[0][0] === 0, '改 meta.top 不影响入参 top');
  const r2 = resolveFrustum3D({ op: 'frustum3d' });
  assert(r2.items[0].id === 'frustum_b1' && r2.meta.top[0][0] === -0.5, '再次解析结果不受前次改动影响');
}

section('G. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const added = [];
  const a = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return true; } };
  const r = applyBoard3DCommands([{ op: 'frustum3d', id: 'fru', labelVertices: true, asVertices: true }], a);
  assert(r.length === 1 && r[0].ok === true && r[0].op === 'frustum3d', '执行器单条成功');
  assert(r[0].count === 28 && r[0].created.length === 28 && added.length === 28, '28 项逐段落地');
  assert(added.filter((o) => o.type === 'line').length === 12 && added.filter((o) => o.type === 'point').length === 8 && added.filter((o) => o.type === 'label').length === 8, 'line/point/label 三类产物数量正确');
  assert(r[0].meta.vertexCount === 4 && r[0].meta.labelCount === 8, 'meta 回读正确');
}
{
  const a = { getState: () => ({ objects: [{ id: 'fru_b1' }, { id: 'fru_b1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'frustum3d', id: 'fru' }], a);
  assert(r[0].ok === true && r[0].created.some((c) => c.id === 'fru_b1_3'), '已有 id 被避让（_3）');
}
{
  for (const gs of [undefined, () => { throw new Error('boom'); }]) {
    const a = gs ? { getState: gs, add: (o) => o.id } : { add: (o) => o.id };
    const r = applyBoard3DCommands([{ op: 'frustum3d', id: 'x' }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  const a = { getState: () => ({ objects: [] }), add: (o) => (o.id.endsWith('_s2') ? false : (o.id.endsWith('_s3') ? null : true)) };
  const r = applyBoard3DCommands([{ op: 'frustum3d', id: 'fru' }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 2, 'api 部分失败（false/null）分项回报');
  assert(r[0].failed.every((f) => f.error === '画板新建失败'), '失败项错误文案正确');
}
{
  const r = applyBoard3DCommands([{ op: 'add', type: 'circle' }], api());
  assert(r[0].ok === false && /不支持的 3D 命令/.test(r[0].error), '2D 命令在 3D 分支被拒绝');
}
{
  const many = Array.from({ length: 5 }, (_, i) => ({ op: 'frustum3d', id: 'f' + i }));
  const r = applyBoard3DCommands(many, api(), { maxCommands: 3 });
  assert(r.length === 5 && r[0].ok && r[1].ok && r[2].ok && r[3].ok === false && r[4].ok === false && /上限/.test(r[3].error), 'maxCommands 超限追加失败回执');
}
{
  const r = applyBoard3DCommands([{ op: 'frustum3d', base: [[0, 0, 0], [1, 1, 1]] }], api());
  assert(r[0].ok === false && /base/.test(r[0].error), '脏参数在执行器内原子拒绝、零副作用');
}

section('H. 协议两侧一致性');
assert(BOARD3D_FRUSTUM_PROMPT_OPS.length === 1 && BOARD3D_FRUSTUM_PROMPT_OPS[0] === 'frustum3d', '提示词 OP 常量 = [frustum3d]');
assert(frozen(BOARD3D_FRUSTUM_PROMPT_OPS), '提示词 OP 常量被冻结');
assert(BOARD3D_FRUSTUM_PROMPT.includes('frustum3d') && BOARD3D_FRUSTUM_PROMPT.includes('base') && BOARD3D_FRUSTUM_PROMPT.includes('ratio'), '提示词含命令名与核心参数');
assert(BOARD3D_FRUSTUM_PROMPT.includes('标注') && BOARD3D_FRUSTUM_PROMPT.includes('labelVertices'), '提示词含顶点标注说明');
assert(BOARD3D_FRUSTUM_PROMPT.includes('2D'), '提示词含 2D 隔离铁律');
assert(BOARD3D_FRUSTUM_PROMPT.includes('斜棱台') && BOARD3D_FRUSTUM_PROMPT.includes('prism3d') && BOARD3D_FRUSTUM_PROMPT.includes('pyramid3d'), '提示词含斜棱台说明与棱柱/棱锥互补关系');
assert(resolveBoardMode({ mode: '3d' }) === '3d' && resolveBoardMode({ mode: '2d' }) === '2d', 'resolveBoardMode 3D/2D 分流未变');
assert(resolveBoardMode({ detect3d: true }, '画个立体棱台') === '3d', '显式 detect3d 命中 3D 意图走 3D 协议');
assert(resolveBoardMode({}, '画个棱台') === '2d', '未开 detect3d 默认 2D（不误伤 2D）');
{
  const promptSrc = read('ai/board-prompt.js');
  assert(promptSrc.indexOf('BOARD3D_PYRAMID_PROMPT') < promptSrc.indexOf('BOARD3D_FRUSTUM_PROMPT'), '共享文件为末尾纯追加（PYRAMID 在前、FRUSTUM 在后）');
  assert(/BOARD_SYSTEM_PROMPT/.test(promptSrc), '2D 主干 BOARD_SYSTEM_PROMPT 仍在');
  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD3D_FRUSTUM_PROMPT') && backend.includes('BOARD3D_PYRAMID_PROMPT + BOARD3D_FRUSTUM_PROMPT'), '后端 import 与 3D 拼接串末尾追加');
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
assert(page.includes('frustum3d'), '页面 AI tip 已追加 frustum3d 说明');
assert(read('js/board3d-ai.js').includes("fr.op !== 'frustum3d'"), 'AI 面板已追加 frustum3d 展示块');
const execSrc = read('js/board3d-executor.js');
assert(execSrc.includes("case 'frustum3d'") && execSrc.includes("import { resolveFrustum3D }"), '执行器已追加 frustum3d 分支与 import');
assert(read('docs/3D画板回归用例清单.md').includes('D26'), '回归清单已追加 D26 记录');

section('结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exitCode = 1;

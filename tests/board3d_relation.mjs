/**
 * 3D 空间平行 / 垂直关系标注命令（relation3d · D38）无头回归。
 *
 * 覆盖：relationLineUnit / relationPlane / relationClassify / relation3DGeometry /
 *       resolveRelation3D 纯函数（默认垂直相交、对棱平行、异面垂直补辅助线、
 *       线面垂直与线面平行、points 定面、实测不符拒绝、
 *       直角符号垂直、平行记号垂直主体且同向、面片共面与对边等长、
 *       开关组合、样式、id 避让与 64 字符边界、脏输入原子拒绝、深度只读性）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、3D 意图分支、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_relation.mjs
 */
import {
  BOARD3D_RELATION_PROMPT, BOARD3D_RELATION_PROMPT_OPS,
  isRelation3DIntent,
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
} from '../js/board3d-executor.js';
import {
  RELATION3D_TOL_MIN, RELATION3D_TOL_MAX, RELATION3D_TOL_DEFAULT,
  RELATION3D_EXTEND_MIN, RELATION3D_EXTEND_MAX, RELATION3D_EXTEND_DEFAULT,
  RELATION3D_MARK_SIZE_MIN, RELATION3D_MARK_SIZE_MAX, RELATION3D_MARK_SIZE_DEFAULT,
  RELATION3D_WIDTH_MIN, RELATION3D_WIDTH_MAX, RELATION3D_WIDTH_DEFAULT,
  RELATION3D_HEIGHT_MIN, RELATION3D_HEIGHT_MAX, RELATION3D_HEIGHT_DEFAULT,
  RELATION3D_VERTEX_SIZE_MIN, RELATION3D_VERTEX_SIZE_MAX, RELATION3D_VERTEX_SIZE_DEFAULT,
  RELATION3D_MAX_SEGMENTS, RELATION3D_KINDS, RELATION3D_RELATIONS,
  RELATION3D_DEFAULT_LINE1, RELATION3D_DEFAULT_LINE1_TO,
  RELATION3D_DEFAULT_LINE2, RELATION3D_DEFAULT_LINE2_TO,
  RELATION3D_DEFAULT_CENTER, RELATION3D_DEFAULT_AXIS,
  num, relationLineUnit, relationPlane, relationClassify, relation3DGeometry, resolveRelation3D,
} from '../js/board3d-relation.js';
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
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);

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
assert(frozen(BOARD3D_RELATION_OPS) && frozen(BOARD3D_COMPLETE29_OPS) && BOARD3D_COMPLETE29_OPS.includes('pointline3d') && BOARD3D_COMPLETE29_OPS.includes('relation3d'), '扩展集冻结且含历史命令');
assert(RELATION3D_TOL_MIN === 0 && RELATION3D_TOL_MAX === 0.2 && RELATION3D_TOL_DEFAULT === 0.02, 'tol 常量');
assert(RELATION3D_EXTEND_MIN === 0 && RELATION3D_EXTEND_MAX === 1000 && RELATION3D_EXTEND_DEFAULT === 0, 'extend 常量');
assert(RELATION3D_MARK_SIZE_MIN === 0.05 && RELATION3D_MARK_SIZE_MAX === 100 && RELATION3D_MARK_SIZE_DEFAULT === 0.25, 'markSize 常量');
assert(RELATION3D_WIDTH_MIN === 0.1 && RELATION3D_WIDTH_MAX === 1000 && RELATION3D_WIDTH_DEFAULT === 4, 'width 常量');
assert(RELATION3D_HEIGHT_MIN === 0.1 && RELATION3D_HEIGHT_MAX === 1000 && RELATION3D_HEIGHT_DEFAULT === 3, 'height 常量');
assert(RELATION3D_VERTEX_SIZE_MIN === 0.01 && RELATION3D_VERTEX_SIZE_MAX === 1 && RELATION3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量');
assert(RELATION3D_MAX_SEGMENTS === 4096 && RELATION3D_KINDS.length === 2 && RELATION3D_RELATIONS.length === 3, '上限与白名单');
assert(frozen(RELATION3D_DEFAULT_LINE1) && frozen(RELATION3D_DEFAULT_LINE2) && frozen(RELATION3D_DEFAULT_CENTER) && RELATION3D_DEFAULT_AXIS === 'z', '默认几何冻结');
assert(num('1.5') === 1.5 && num(0) === 0 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 严格数值解析');

section('二、纯几何层：直线 / 平面 / 判定');
{
  const l = relationLineUnit([0, 0, 0], [2, 0, 0]);
  assert(l.ok && vecApprox(l.u, [1, 0, 0]) && l.length === 2, '直线单位化与长度');
  assert(relationLineUnit([0, 0, 0], [0, 0, 0]).ok === false, '重合两点拒绝');
  assert(relationLineUnit(null, [1, 0, 0]).ok === false, '非法点拒绝');
  assert(relationLineUnit(['0', '0', '0'], ['2', '0', '0']).ok === true, '数字字符串坐标容错');
}
{
  const p1 = relationPlane({ center: [0, 0, 0], axis: 'z' });
  assert(p1.ok && vecApprox(p1.normal, [0, 0, 1]) && vecApprox(p1.center, [0, 0, 0]) && !p1.viaPoints, 'center+axis 默认 xy 面');
  const p2 = relationPlane({ center: [1, 2, 3], axis: [1, 0, 0] });
  assert(p2.ok && vecApprox(p2.normal, [1, 0, 0]) && vecApprox(p2.center, [1, 2, 3]), '向量 axis 解析');
  const p3 = relationPlane({ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] });
  assert(p3.ok && vecApprox(p3.normal, [0, 0, 1]) && p3.viaPoints, '三点定面');
  assert(approx(dot(p1.e1, p1.normal), 0) && approx(dot(p1.e2, p1.normal), 0) && approx(dot(p1.e1, p1.e2), 0), '平面标架两两正交');
  assert(approx(norm(p1.e1), 1) && approx(norm(p1.e2), 1), '标架单位化');
  const bad = [
    { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { points: [[0, 0, 0], [1, 0, 0]] },
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 'x']] },
    { center: 'x' }, { axis: 'q' }, { axis: [0, 0, 0] }, { axis: null }, { axis: {} },
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], center: [0, 0, 0] },
  ];
  assert(bad.every((c) => relationPlane(c).ok === false), `平面脏输入拒绝（${bad.length} 组，含 null axis 不抛错）`);
}
{
  assert(relationClassify(0, 0.02) === 'perpendicular', 'dot=0 判垂直');
  assert(relationClassify(1, 0.02) === 'parallel' && relationClassify(0.99, 0.02) === 'parallel', 'dot≈1 判平行');
  assert(relationClassify(0.5, 0.02) === null, '中间值拒绝');
  assert(relationClassify(NaN, 0.02) === null, 'NaN 拒绝');
}

section('三、relation3DGeometry 关系判定');
{
  const g = relation3DGeometry({});
  assert(g.ok && g.kind === 'line-line' && g.relation === 'perpendicular' && g.absDot === 0, '默认两直线垂直');
  assert(g.intersect && vecApprox(g.origin, [0, 0, 0]) && g.helperLine === null, '默认真实交点在原点、无辅助线');
}
{
  const g = relation3DGeometry({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 2, 0], [2, 2, 0]], relation: 'parallel' });
  assert(g.ok && g.relation === 'parallel' && g.absDot === 1, '正方体对棱平行判定');
  assert(vecApprox(g.origin, [1, 1, 0]), '平行关系锚点取四端点均值');
}
{
  const g = relation3DGeometry({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 1, -1], [0, 1, 1]] });
  assert(g.ok && g.relation === 'perpendicular' && !g.intersect, '异面直线垂直判定');
  assert(vecApprox(g.origin, [0, 0, 0]) && g.helperLine && vecApprox(g.helperLine[1], [0, 0, 1]), '异面时补平行 L2 的辅助线');
}
{
  const g = relation3DGeometry({ kind: 'line-plane', line: [[0, 0, 0], [0, 0, 3]], center: [0, 0, 0], axis: 'z' });
  assert(g.ok && g.relation === 'perpendicular' && g.absDot === 1 && vecApprox(g.origin, [0, 0, 0]), '侧棱垂直 xy 面');
  const g2 = relation3DGeometry({ kind: 'line-plane', line: [[0, 0, 1], [2, 0, 1]], center: [0, 0, 0], axis: 'z' });
  assert(g2.ok && g2.relation === 'parallel' && g2.absDot === 0 && vecApprox(g2.origin, [1, 0, 1]), '水平直线平行 xy 面');
  const g3 = relation3DGeometry({ kind: 'line-plane', line: [[0, 0, 0], [0, 0, 3]], points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] });
  assert(g3.ok && g3.relation === 'perpendicular' && g3.plane.viaPoints, 'points 定面同样判定');
}
{
  const bad = [
    { kind: 'bad' }, { relation: 'bad' }, { tol: -0.1 }, { tol: 0.3 },
    { line1: [[0, 0, 0], [0, 0, 0]] }, { line2: [1, 2] }, { line2: [[0, 0, 0], [0, 0, 0]] },
    { line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 0, 0], [1, 1, 0]] },
    { relation: 'parallel' },
    { kind: 'line-plane', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { kind: 'line-plane', line: [[0, 0, 0], [0, 0, 0]] },
    { kind: 'line-plane', axis: 'q' },
  ];
  assert(bad.every((c) => relation3DGeometry(c).ok === false), `几何层脏输入 / 实测不符原子拒绝（${bad.length} 组）`);
  assert(/既不平行也不垂直/.test(relation3DGeometry({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 0, 0], [1, 1, 0]] }).error), '斜交给出明确错误');
  assert(/不符/.test(relation3DGeometry({ relation: 'parallel' }).error), '显式关系与实测不符给出明确错误');
}

section('四、resolveRelation3D 输出对象与守恒');
{
  const r = resolveRelation3D({}, {});
  assert(r.ok && r.items.length === 5 && r.meta.itemCount === 5 && r.meta.segmentCount === 4, '默认输出 4 线段 + 1 关系标注');
  assert(r.meta.relation === 'perpendicular' && r.meta.symbolText === '⊥' && r.meta.lineCount === 2 && r.meta.markCount === 2, '默认关系与计数');
  const [s1, s2, s3] = r.meta.markSegments;
  assert(approx(dot(sub(s1[1], s1[0]), sub(s2[1], s2[0])), 0, 3e-3), '直角符号第一段与第二段垂直');
  assert(approx(dot(sub(s2[1], s2[0]), sub(s3[1], s3[0])), 0, 3e-3), '直角符号第二段与第三段垂直');
  assert(r.items.filter((i) => i.type === 'label')[0].text === '⊥', '关系文字为 ⊥');
  assert(r.items.every((i) => i.pos && i.rot && i.scale && i.color && typeof i.id === 'string'), '对象结构完整');
  assert(['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(r.items[0].p[k])), '线段六坐标有限');
}
{
  const r = resolveRelation3D({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 2, 0], [2, 2, 0]], relation: 'parallel' }, {});
  assert(r.ok && r.meta.relation === 'parallel' && r.meta.symbolText === '∥' && r.meta.markCount === 2, '平行关系输出两道记号');
  const [m1, m2] = r.meta.markSegments;
  assert(approx(dot(sub(m1[1], m1[0]), r.meta.line1.u), 0, 3e-3), '平行记号垂直第一条直线');
  assert(approx(dot(sub(m2[1], m2[0]), r.meta.line2.u), 0, 3e-3), '平行记号垂直第二条直线');
  assert(vecApprox(sub(m1[1], m1[0]), sub(m2[1], m2[0])), '两记号方向一致（同向同长）');
  assert(r.items.filter((i) => i.type === 'label')[0].text === '∥', '关系文字为 ∥');
}
{
  const r = resolveRelation3D({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 1, -1], [0, 1, 1]] }, {});
  assert(r.ok && r.meta.helperDrawn && !r.meta.intersect, '异面垂直标记补辅助线');
  assert(r.meta.segmentCount === 5 && r.meta.itemCount === 6, '异面输出 5 线段 + 1 标注');
  assert(r.items.some((i) => i.id.endsWith('_helper')), '辅助线对象已落地');
}
{
  const r = resolveRelation3D({ kind: 'line-plane', line: [[0, 0, 0], [0, 0, 3]], center: [0, 0, 0], axis: 'z' }, {});
  assert(r.ok && r.meta.relation === 'perpendicular' && r.meta.lineCount === 5, '线面垂直输出直线 + 面片四边');
  assert(r.meta.corners.length === 4 && r.meta.corners.every((p) => approx(p[2], 0)), '面片四角共面于 z=0');
  const [c0, c1, c2, c3] = r.meta.corners;
  assert(vecApprox([0, 1, 2].map((k) => (c0[k] + c2[k]) / 2), [0, 0, 0]) && vecApprox([0, 1, 2].map((k) => (c1[k] + c3[k]) / 2), [0, 0, 0]), '两条对角线中点均为 center');
  assert(approx(norm(sub(c1, c0)), 4) && approx(norm(sub(c2, c1)), 3), '对边长度分别等于 width 与 height');
  assert(approx(dot(sub(r.meta.markSegments[1][1], r.meta.markSegments[1][0]), sub(r.meta.markSegments[2][1], r.meta.markSegments[2][0])), 0, 3e-3), '线面直角符号两边垂直');
}
{
  const r = resolveRelation3D({ kind: 'line-plane', line: [[0, 0, 1], [2, 0, 1]], center: [0, 0, 0], axis: 'z' }, {});
  assert(r.ok && r.meta.relation === 'parallel' && r.meta.markCount === 2 && r.meta.symbolText === '∥', '线面平行输出两道记号');
  assert(approx(dot(r.meta.markDir, r.meta.line.u), 0, 3e-3) && approx(dot(r.meta.markDir, r.meta.plane.normal), 0, 3e-3), '线面平行记号同时垂直直线与法向');
}
{
  const r = resolveRelation3D({ extend: 2, markSize: 0.5, asPoints: true, labelNames: true, color: '#123456', labelColor: '#abcdef', opacity: 0.6 }, {});
  assert(r.ok && approx(r.meta.extend, 2) && approx(r.meta.markSize, 0.5), 'extend / markSize 生效');
  assert(r.meta.pointCount === 4 && r.meta.labelCount === 5 && r.meta.itemCount === 13, '全开计数正确（2 主体+2 记号+4 球+5 标注）');
  assert(r.items.filter((i) => i.type === 'label').map((i) => i.text).join(',') === '⊥,A,B,C,D', '关系与四点名称标注齐全');
  assert(r.items.every((i) => i.color === '#123456' || (i.type === 'label' && i.color === '#abcdef')), '颜色样式生效');
  assert(r.items.every((i) => i.type !== 'line' || approx(i.opacity, 0.6)), '透明度生效');
  assert(r.items.filter((i) => i.type === 'point').every((i) => approx(i.p.s, 0.1)), '小球尺寸生效');
}
{
  const s = resolveRelation3D({
    line1: [['0', '0', '0'], ['2', '0', '0']], line2: [['0', '0', '0'], ['0', '2', '0']],
    tol: '0.03', extend: '1', markSize: '0.3', width: '4', height: '3', vertexSize: '0.2', opacity: '0.8',
  }, {});
  assert(s.ok && approx(s.meta.tol, 0.03) && approx(s.meta.extend, 1) && approx(s.meta.markSize, 0.3) && approx(s.meta.vertexSize, 0.2) && approx(s.meta.opacity, 0.8), '数字字符串容错');
}
{
  const state = { objects: [{ id: 'rel_l1' }, { id: 'rel_ra1' }, { id: 'rel_rel' }] };
  const r = resolveRelation3D({}, state);
  const ids = r.items.map((i) => i.id);
  assert(new Set(ids).size === ids.length && !ids.some((id) => state.objects.some((o) => o.id === id)), 'id 避让冲突');
  assert(ids.includes('rel_l1_2') && ids.includes('rel_ra1_2') && ids.includes('rel_rel_2'), '冲突 id 依次加后缀');
  const long = resolveRelation3D({ id: 'x'.repeat(64) }, { objects: [] });
  assert(long.ok && long.items.every((i) => i.id.length <= 64), 'id 64 字符边界收敛');
}
{
  const cmd = Object.freeze({ line1: [[0, 0, 0], [2, 0, 0]], line2: [[0, 0, 0], [0, 2, 0]], asPoints: true, labelNames: true });
  const snap = JSON.stringify(cmd);
  const st = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'rel_l1' })]) });
  const r = resolveRelation3D(cmd, st);
  assert(r.ok && JSON.stringify(cmd) === snap, '冻结 cmd 深度只读');
  assert(JSON.stringify(st) === '{"objects":[{"id":"rel_l1"}]}', '冻结 state 深度只读');
  assert(r !== cmd && r.items !== cmd.items, '输出全新对象、无入参引用泄漏');
}
{
  const bad = [
    null, [], 'x',
    { id: 123 }, { id: 'a b' }, { id: '' },
    { kind: 1 }, { relation: 'parallelX' }, { tol: 'x' }, { tol: 0.21 },
    { extend: 'x' }, { extend: -1 }, { extend: 1001 }, { extend: NaN },
    { markSize: 0 }, { markSize: 101 }, { markSize: 'x' },
    { width: 0 }, { width: 1001 }, { height: 0 }, { height: 'x' },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: false },
    { opacity: 'x' }, { opacity: [] },
    { line1: [[0, 0, 0], [0, 0, 0]] }, { line2: [1, 2] }, { line2: [[0, 0, 0], [0, 0, 0]] },
    { asLines: 1 }, { asMark: null }, { asPoints: 'true' }, { labelRelation: 0 }, { labelNames: [] },
    { asLines: false, asMark: false, asPoints: false, labelRelation: false, labelNames: false },
    { kind: 'line-plane', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { kind: 'line-plane', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], axis: 'z' },
  ];
  assert(bad.every((c) => resolveRelation3D(c, {}).ok === false), `命令层脏输入原子拒绝（${bad.length} 组）`);
}

section('五、执行器集成（与 2D 执行器隔离）');
{
  const created = [];
  const api = { add: (o) => { created.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'relation3d', id: 'rel', labelNames: true, asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'relation3d' && res[0].count === 13, '执行器返回成功与项数（含 4 球 + 5 标注）');
  assert(created.length === 13 && created.every((o) => o.type === 'line' || o.type === 'point' || o.type === 'label'), '13 项全部落地为 3D 对象');
  assert(res[0].meta.relation === 'perpendicular' && vecApprox(res[0].meta.origin, [0, 0, 0]), 'meta 透传关系与锚点');
}
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [{ id: 'rel_l1' }, { id: 'rel_rel' }] }) };
  const res = applyBoard3DCommands([{ op: 'relation3d', id: 'rel' }, { op: 'relation3d', id: 'rel' }], api);
  assert(res[0].ok && res[1].ok === false && res[1].failed && res[1].failed.length === 5, '同批 id 冲突分项失败，第二条整批回报 ok=false');
  assert(added.length === 5, '冲突项不落地，仅第一条 5 项正常落地');
  assert(res[0].created.every((c) => !['rel_l1', 'rel_rel'].includes(c.id)), '语义层已避让场景原有 id');
}
{
  const api = { add: () => true };
  const res = applyBoard3DCommands([{ op: 'relation3d' }], api);
  assert(res[0].ok && res[0].count === 5, 'getState 缺失降级为空场景');
  const api2 = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res2 = applyBoard3DCommands([{ op: 'relation3d' }], api2);
  assert(res2[0].ok && res2[0].count === 5, 'getState 抛错降级为空场景');
}
{
  let n = 0;
  const api = { add: () => (++n === 1 ? false : true), getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'relation3d' }], api);
  assert(res[0].ok === false && res[0].failed.length === 1 && res[0].created.length === 4, 'api 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const minimal = { op: 'relation3d', asLines: false, asMark: false, asPoints: false, labelRelation: false, labelNames: false };
  const res = applyBoard3DCommands([{ op: 'circle' }, { op: 'intersect' }, minimal, { op: 'relation3d', relation: 'parallel' }], api);
  assert(res[0].ok === false && res[1].ok === false && /不识别 2D 命令/.test(res[0].error + res[1].error), '2D 命令在 3D 分支被拒绝');
  assert(res[2].ok === false && /至少开一个/.test(res[2].error), '五开关全关被语义层拒绝');
  assert(res[3].ok === false && /不符/.test(res[3].error), '实测不符被语义层拒绝');
}

section('六、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_RELATION_PROMPT_OPS.length === 1 && BOARD3D_RELATION_PROMPT_OPS[0] === 'relation3d', '提示词 op 与执行器 op 一致');
assert(BOARD3D_RELATION_PROMPT.includes('relation3d') && BOARD3D_RELATION_PROMPT.includes('line-plane') && BOARD3D_RELATION_PROMPT.includes('markSize'), '提示词含完整命令格式');
assert(BOARD3D_RELATION_PROMPT.includes('∥') && BOARD3D_RELATION_PROMPT.includes('⊥') && BOARD3D_RELATION_PROMPT.includes('异面时补平行辅助线'), '提示词说明记号与退化情形');
assert(BOARD3D_RELATION_PROMPT.includes('显式指定但几何实测不符时整条拒绝'), '提示词强调不画假关系');
assert(BOARD3D_RELATION_PROMPT.includes('2D 的平行 / 垂直标注命令在本分支依旧不认识'), '提示词保持 3D/2D 分支隔离铁律');
assert(isRelation3DIntent('空间两直线平行') && isRelation3DIntent('立体几何里两棱垂直'), '空间/立体措辞命中');
assert(isRelation3DIntent('正方体对棱平行') && isRelation3DIntent('侧棱垂直底面'), '正方体/棱措辞命中');
assert(isRelation3DIntent('线面垂直') && isRelation3DIntent('异面直线垂直'), '线面/异面措辞命中');
assert(!isRelation3DIntent('两直线平行') && !isRelation3DIntent('画两条直线垂直'), '2D 通用措辞不误命中');
assert(!isRelation3DIntent('画一条直线和一个点') && !isRelation3DIntent('点到直线的距离'), '非关系需求不误命中');
assert(resolveBoardMode({ detect3d: true, message: '正方体对棱平行' }, '正方体对棱平行') === '3d', '显式 detect3d 时关系标注进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '空间两直线垂直') === '3d', '空间垂直措辞进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '点到空间直线距离') === '3d', 'D37 意图词仍有效');
assert(resolveBoardMode({ detect3d: true }, '异面直线夹角') === '3d', 'D36 意图词仍有效');
assert(resolveBoardMode({ message: '正方体对棱平行' }, '正方体对棱平行') === '2d', '未开启 detect3d 保持 2D 主干');
assert(resolveBoardMode({ detect3d: true }, '两直线平行') === '2d', '2D 通用平行措辞不误切 3D');
assert(read('ai/board-backend.js').includes('+ BOARD3D_RELATION_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("rl.op !== 'relation3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('relation3d 给两条空间直线'), '画板面板工具说明已追加');

section('七、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_RELATION_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_POINT_LINE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('2D 主干'), '2D 主干标志仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  // 通用「逐行仅行内追加」检查：当前每一行都必须是 HEAD 对应行插入一段连续文本的结果，
  // 兼容后续轮次继续在 import / 拼接串 / 意图分支行内追加。
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
  let p = 0;
  while (p < headHtml.length && headHtml[p] === nowHtml[p]) p++;
  let s = 0;
  while (s < headHtml.length - p && headHtml[headHtml.length - 1 - s] === nowHtml[nowHtml.length - 1 - s]) s++;
  assert(p + s === headHtml.length && nowHtml.includes('relation3d 给两条空间直线'), 'board3d.html 只追加工具提示');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'skewline3d'") && read('js/board3d-executor.js').includes("case 'lineangle3d'") && read('js/board3d-executor.js').includes("case 'pointline3d'") && read('js/board3d-executor.js').includes("case 'relation3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

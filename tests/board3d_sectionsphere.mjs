/**
 * 3D 平面截球截面圆命令（sectionsphere3d · D44）无头回归。
 *
 * 覆盖：sectionsphereGeometry / sectionsphereAxisUnit / sectionsphereNormalFromPoints /
 *       sectionsphereBasis / resolveSectionsphere3D 纯函数
 *       （默认过球心大圆 d=0 r=R、z=1 小圆 d=1 r=√3、三点定面、axis 向量、负侧、
 *        截面点在球面/在截面内/恒为 r、r²+d²=R²、球大圆点在球面、OO'=d 且垂直截面、
 *        开关组合 / 直角符号 / 小球 / 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_sectionsphere.mjs
 */
import {
  BOARD3D_SECTIONSPHERE_PROMPT, BOARD3D_SECTIONSPHERE_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  SECTIONSPHERE3D_RADIUS_MIN, SECTIONSPHERE3D_RADIUS_MAX, SECTIONSPHERE3D_RADIUS_DEFAULT,
  SECTIONSPHERE3D_SPAN_MIN, SECTIONSPHERE3D_SPAN_MAX,
  SECTIONSPHERE3D_WIDTH_DEFAULT, SECTIONSPHERE3D_HEIGHT_DEFAULT,
  SECTIONSPHERE3D_SEGMENTS_MIN, SECTIONSPHERE3D_SEGMENTS_MAX, SECTIONSPHERE3D_SEGMENTS_DEFAULT,
  SECTIONSPHERE3D_RIGHT_ANGLE_MIN, SECTIONSPHERE3D_RIGHT_ANGLE_MAX, SECTIONSPHERE3D_RIGHT_ANGLE_DEFAULT,
  SECTIONSPHERE3D_VERTEX_SIZE_MIN, SECTIONSPHERE3D_VERTEX_SIZE_MAX, SECTIONSPHERE3D_VERTEX_SIZE_DEFAULT,
  SECTIONSPHERE3D_MAX_SEGMENTS, SECTIONSPHERE3D_DEFAULT_CENTER, SECTIONSPHERE3D_DEFAULT_AXIS,
  num, parseSectionPoint, sectionsphereAxisUnit, sectionsphereNormalFromPoints, sectionsphereBasis,
  sectionsphereGeometry, resolveSectionsphere3D,
} from '../js/board3d-sectionsphere.js';
import { isSectionsphere3DIntent } from '../ai/board-prompt.js';
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
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => mul(a, 1 / norm(a));
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
assert(BOARD3D_POINT_LINE_OPS.length === 1 && BOARD3D_COMPLETE28_OPS.length === 37 && BOARD3D_RELATION_OPS.length === 1 && BOARD3D_COMPLETE29_OPS.length === 38, 'COMPLETE28 37 / COMPLETE29 38');
assert(BOARD3D_CIRCUMSPHERE_OPS.length === 1 && BOARD3D_COMPLETE30_OPS.length === 39 && BOARD3D_INSPHERE_OPS.length === 1 && BOARD3D_COMPLETE31_OPS.length === 40, 'COMPLETE30 39 / COMPLETE31 40');
assert(BOARD3D_EULER_OPS.length === 1 && BOARD3D_COMPLETE32_OPS.length === 41 && BOARD3D_CENTROID_OPS.length === 1 && BOARD3D_COMPLETE33_OPS.length === 42, 'COMPLETE32 41 / COMPLETE33 42');
assert(BOARD3D_SOLIDMETRICS_OPS.length === 1 && BOARD3D_COMPLETE34_OPS.length === 43 && BOARD3D_COMPLETE34_OPS.includes('solidmetrics3d'), 'COMPLETE34 43');
assert(BOARD3D_SECTIONSPHERE_OPS.length === 1 && BOARD3D_SECTIONSPHERE_OPS[0] === 'sectionsphere3d' && BOARD3D_COMPLETE35_OPS.length === 44 && BOARD3D_COMPLETE35_OPS.includes('sectionsphere3d'), 'SECTIONSPHERE 1 / COMPLETE35 44 且含 sectionsphere3d');
assert(!BOARD3D_OPS.includes('sectionsphere3d') && !BOARD3D_ALL_OPS.includes('sectionsphere3d') && !BOARD3D_COMPLETE34_OPS.includes('sectionsphere3d'), 'sectionsphere3d 未并入历史契约常量');
assert(SECTIONSPHERE3D_RADIUS_MIN === 0.01 && SECTIONSPHERE3D_RADIUS_MAX === 1000 && SECTIONSPHERE3D_RADIUS_DEFAULT === 2, '半径区间常量');
assert(SECTIONSPHERE3D_SEGMENTS_DEFAULT === 48 && SECTIONSPHERE3D_MAX_SEGMENTS === 4096 && SECTIONSPHERE3D_VERTEX_SIZE_DEFAULT === 0.1, '采样/上限常量');
assert(frozen(SECTIONSPHERE3D_DEFAULT_CENTER) && SECTIONSPHERE3D_DEFAULT_AXIS === 'z', '默认常量冻结');

section('二、纯函数：解析与默认几何');
assert(num('2.5') === 2.5 && num(2) === 2 && num('abc') === null && num('') === null && num(null) === null && num(Infinity) === null, 'num 数字字符串容错');
assert(vecApprox(parseSectionPoint(['1', 2, '3']), [1, 2, 3]), 'parseSectionPoint 数字字符串');
assert(parseSectionPoint([0, 0]) === null && parseSectionPoint([0, 'x', 0]) === null, 'parseSectionPoint 拒绝非法');
assert(vecApprox(sectionsphereAxisUnit('x'), [1, 0, 0]) && vecApprox(sectionsphereAxisUnit('Y'), [0, 1, 0]) && vecApprox(sectionsphereAxisUnit(undefined), [0, 0, 1]), 'axis 字符解析');
assert(vecApprox(sectionsphereAxisUnit([0, 2, 0]), [0, 1, 0]) && sectionsphereAxisUnit([0, 0, 0]) === null && sectionsphereAxisUnit('w') === null, 'axis 向量解析与拒绝');
{
  const n = sectionsphereNormalFromPoints([[0, 0, 0], [2, 0, 0], [0, 2, 0]]);
  assert(vecApprox(n, [0, 0, 1]), '三点定面 xy 平面法向 +z');
  assert(sectionsphereNormalFromPoints([[0, 0, 0], [1, 0, 0], [2, 0, 0]]) === null, '共线三点拒绝');
  assert(sectionsphereNormalFromPoints([[0, 0], [1, 1], [2, 2]]) === null, '点长度不足拒绝');
}
{
  const b = sectionsphereBasis([0, 0, 1]);
  assert(b && approx(dot(b.u, b.v), 0, 1e-9) && approx(dot(b.u, [0, 0, 1]), 0, 1e-9) && approx(norm(b.u), 1, 1e-9) && approx(norm(b.v), 1, 1e-9), '正交标架 u⊥v⊥n 且单位');
  assert(sectionsphereBasis([0, 1, 0]) && approx(dot(sectionsphereBasis([0, 1, 0]).u, [0, 1, 0]), 0, 1e-9), '参考轴避让近平行');
  assert(sectionsphereBasis([0, 0]) === null, '标架非法输入拒绝');
}

section('三、纯函数：截面几何守恒');
{
  const g = sectionsphereGeometry({});
  assert(g.ok && g.R === SECTIONSPHERE3D_RADIUS_DEFAULT && g.d === 0 && approx(g.r, g.R) && vecApprox(g.Op, [0, 0, 0]), '默认：过球心大圆 d=0 r=R');
}
{
  const g = sectionsphereGeometry({ radius: 2, axis: 'z', height: 1 });
  assert(g.ok && approx(g.R, 2) && approx(g.d, 1) && approx(g.r, Math.sqrt(3)) && vecApprox(g.Op, [0, 0, 1]), 'z=1 小圆 d=1 r=√3 圆心 [0,0,1]');
  assert(approx(g.r * g.r + g.d * g.d, g.R * g.R, 1e-9), 'r²+d²=R²');
  assert(approx(dot(sub(g.Op, g.O), g.n), g.h, 1e-9), 'OO 向量 = h·n 且垂直截面');
}
{
  const g = sectionsphereGeometry({ radius: 2, axis: 'z', height: -1 });
  assert(g.ok && approx(g.h, -1) && approx(g.d, 1) && vecApprox(g.Op, [0, 0, -1]) && approx(g.r, Math.sqrt(3)), '负侧 h=-1 圆心 [0,0,-1]');
}
{
  const g = sectionsphereGeometry({ radius: 3, points: [[0, 0, 1], [3, 0, 1], [0, 3, 1]] });
  assert(g.ok && g.byPoints === true && approx(g.h, 1) && approx(g.d, 1) && approx(g.r, Math.sqrt(8)) && vecApprox(g.Op, [0, 0, 1]), '三点定面 z=1 截 R=3 球');
}
{
  const g = sectionsphereGeometry({ radius: 2, axis: [1, 1, 1], height: 0.5 });
  assert(g.ok && approx(g.d, 0.5) && approx(g.r, Math.sqrt(4 - 0.25)) && approx(dot(g.Op, g.n), 0.5, 1e-9), '斜法向 + height 有向距离');
}
assert(sectionsphereGeometry({ radius: 2, height: 2 })?.ok === false, '相切 d=R 拒绝');
assert(sectionsphereGeometry({ radius: 2, height: 3 })?.ok === false, '不相交 d>R 拒绝');
assert(sectionsphereGeometry({ center: [0, 0] })?.ok === false, 'center 非法拒绝');
assert(sectionsphereGeometry({ radius: 0 })?.ok === false, 'radius=0 拒绝');
assert(sectionsphereGeometry({ points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] })?.ok === false, '三点共线拒绝');
assert(sectionsphereGeometry(null) === null, '空命令返回 null');

section('四、resolve：items 几何与读数');
{
  const r = resolveSectionsphere3D({ op: 'sectionsphere3d', radius: 2, height: 1, segments: 8 });
  assert(r.ok && r.meta.segmentCount === 3 * 8 + 8 + 4 + 1 + 2, '默认段数=24 大圆+8 截面圆+4 面片+1 垂线+2 直角');
  assert(r.meta.itemCount === r.items.length && r.meta.segmentCount === r.items.filter((i) => i.type === 'line').length, 'itemCount / segmentCount 自洽');
  assert(approx(r.meta.distance, 1) && approx(r.meta.sectionRadius, Math.sqrt(3), 5e-3) && approx(r.meta.radius, 2), 'meta 的 R/r/d 读数');
  assert(approx(r.meta.relationLhs, r.meta.relationRhs, 1e-3), 'meta r²+d²=R²');
  assert(r.meta.sphereMaxDev < 2e-3 && r.meta.planeMaxDev < 2e-3 && r.meta.radiusMaxDev < 2e-3, 'meta 三偏差近零');
  assert(r.meta.greatCircleCount === 3 && r.meta.sectionCircleCount === 1, '三大圆+一截面圆');
  assert(r.meta.labelCount >= 6 && r.meta.pointCount === 0, '默认标注数 / 无小球');
  // 截面圆上的 line 端点恒在球面、在截面内
  const O = r.meta.center, N = r.meta.axis, R = r.meta.radius;
  const secLines = r.items.filter((i) => i.type === 'line' && i.id.includes('_sc'));
  assert(secLines.length === 8, '截面圆 8 段');
  let onSphere = true, inPlane = true;
  for (const ln of secLines) {
    for (const p of [[ln.p.x1, ln.p.y1, ln.p.z1], [ln.p.x2, ln.p.y2, ln.p.z2]]) {
      if (!approx(norm(sub(p, O)), R, 5e-3)) onSphere = false;
      if (!approx(dot(sub(p, r.meta.sectionCenter), N), 0, 5e-3)) inPlane = false;
    }
  }
  assert(onSphere, '截面圆端点恒在球面');
  assert(inPlane, '截面圆端点恒在截面内');
  const greatLines = r.items.filter((i) => i.type === 'line' && /_g[unv]_/.test(i.id));
  assert(greatLines.length === 24 && greatLines.every((ln) => approx(norm(sub([ln.p.x1, ln.p.y1, ln.p.z1], O)), R, 5e-3)), '大圆端点恒在球面');
  // 垂线段端点 = O 与 O'
  const perp = r.items.find((i) => i.type === 'line' && i.id.endsWith('_opp'));
  assert(perp && vecApprox([perp.p.x1, perp.p.y1, perp.p.z1], O) && vecApprox([perp.p.x2, perp.p.y2, perp.p.z2], r.meta.sectionCenter), '垂线段 OO-prime 端点正确');
  assert(approx(norm(sub([perp.p.x2, perp.p.y2, perp.p.z2], [perp.p.x1, perp.p.y1, perp.p.z1])), 1, 1e-3), '|OO-prime|=d=1');
}
{
  const r0 = resolveSectionsphere3D({ op: 'sectionsphere3d', segments: 8 });
  assert(r0.ok && approx(r0.meta.distance, 0) && approx(r0.meta.sectionRadius, 2, 5e-3), 'd=0 大圆 r=R');
  const rg = resolveSectionsphere3D({ op: 'sectionsphere3d', radius: 2, height: 1, segments: 8, asPoints: true, labelRadii: true, labelRelation: true });
  assert(rg.meta.pointCount > 2 && rg.items.filter((i) => i.type === 'point').length === rg.meta.pointCount, 'asPoints 小球计数自洽');
  const labels = rg.items.filter((i) => i.type === 'label').map((i) => i.text);
  assert(labels.includes('O') && labels.includes("O'") && labels.some((t) => t.startsWith('R=')) && labels.some((t) => t.startsWith('r=')) && labels.some((t) => t.startsWith('d=')) && labels.includes('r²+d²=R²'), '标注 O/O-prime/R/r/d/关系式齐全');
}

section('五、开关组合 / 样式 / 数字字符串 / id 避让');
{
  const r = resolveSectionsphere3D({
    op: 'sectionsphere3d', radius: 2, height: 1, segments: 8,
    asSphere: false, asPlane: false, asCircle: true, asPerp: false,
    asRightAngle: false, labelCenter: false, labelFoot: false, labelRadii: false, labelRelation: false,
  });
  assert(r.ok && r.meta.segmentCount === 8 && r.items.every((i) => i.type === 'line' && i.id.includes('_sc')), '只画截面圆');
  assert(resolveSectionsphere3D({ asSphere: false, asPlane: false, asCircle: false, asPerp: false, asPoints: false }).ok === false, '五线框开关全关拒绝');
}
{
  const r = resolveSectionsphere3D({ op: 'sectionsphere3d', radius: 2, height: 1, segments: 8, asRightAngle: false });
  assert(r.ok && !r.items.some((i) => i.id.includes('_ra')), '关直角符号无 ra 段');
  const r2 = resolveSectionsphere3D({ op: 'sectionsphere3d', radius: 2, height: 1, segments: 8, asPerp: false });
  assert(r2.ok && !r2.items.some((i) => i.id.includes('_ra')), '关垂线时直角符号自动省略');
}
{
  const r = resolveSectionsphere3D({
    op: 'sectionsphere3d', radius: '2', height: '1', segments: '8', width: '5', heightSpan: '6',
    rightAngleSize: '0.3', vertexSize: '0.2', opacity: '0.7', asPoints: true,
    color: '#ff0000', planeColor: '#00ff00', perpColor: '#0000ff', labelColor: '#ffff00',
  });
  assert(r.ok && approx(r.meta.radius, 2) && approx(r.meta.distance, 1) && r.meta.width === 5 && r.meta.heightSpan === 6, '数字字符串容错');
  assert(r.meta.color === '#ff0000' && r.meta.planeColor === '#00ff00' && r.meta.perpColor === '#0000ff' && r.meta.labelColor === '#ffff00' && approx(r.meta.opacity, 0.7), '样式透传');
  assert(r.items.some((i) => i.color === '#00ff00') && r.items.some((i) => i.color === '#0000ff'), '面片/垂线配色落地');
}
{
  const r = resolveSectionsphere3D({ op: 'sectionsphere3d', id: 'sec', segments: 8 }, { objects: [{ id: 'sec' }, { id: 'sec_sc0' }] });
  assert(r.ok && !r.items.some((i) => i.id === 'sec' || i.id === 'sec_sc0') && r.items.every((i) => i.id.length <= 64), 'id 避让');
  const longId = 'x'.repeat(64);
  const r2 = resolveSectionsphere3D({ op: 'sectionsphere3d', id: longId, segments: 8 });
  assert(r2.ok && r2.items.every((i) => i.id.length <= 64), '64 字符 id 边界不超长');
  assert(resolveSectionsphere3D({ op: 'sectionsphere3d', id: 'bad id' }).ok === false, '含空格 id 拒绝');
  assert(resolveSectionsphere3D({ op: 'sectionsphere3d', segments: 8 }, null).ok, 'state 为 null 仍可产出');
}

section('六、脏输入原子拒绝与深度只读');
const bad = [
  { cmd: null, name: '命令为空' },
  { cmd: [], name: '命令为数组' },
  { cmd: { center: [0, 0] }, name: 'center 长度不足' },
  { cmd: { center: [0, 'oops', 0] }, name: 'center 非数值' },
  { cmd: { radius: 0 }, name: 'radius 过小' },
  { cmd: { radius: 1001 }, name: 'radius 过大' },
  { cmd: { radius: 'abc' }, name: 'radius 非数值' },
  { cmd: { points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }, name: '三点共线' },
  { cmd: { points: [[0, 0, 0], [1, 0, 0]] }, name: 'points 非三点' },
  { cmd: { axis: 'w' }, name: 'axis 非法字符串' },
  { cmd: { axis: [0, 0, 0] }, name: 'axis 零向量' },
  { cmd: { axis: [1, 2] }, name: 'axis 长度不足' },
  { cmd: { height: 3 }, name: '默认值半径2 + h=3 不相交' },
  { cmd: { radius: 2, height: 2 }, name: '相切 d=R 拒绝' },
  { cmd: { radius: 2, height: 'abc' }, name: 'height 非数值' },
  { cmd: { width: 0 }, name: 'width 过小' },
  { cmd: { heightSpan: 10001 }, name: 'heightSpan 过大' },
  { cmd: { segments: 7 }, name: 'segments 过小' },
  { cmd: { segments: 513 }, name: 'segments 过大' },
  { cmd: { segments: 8.5 }, name: 'segments 非整数' },
  { cmd: { segments: 'abc' }, name: 'segments 非数值' },
  { cmd: { rightAngleSize: 0 }, name: 'rightAngleSize 过小' },
  { cmd: { rightAngleSize: 11 }, name: 'rightAngleSize 过大' },
  { cmd: { vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { asSphere: 'true' }, name: '开关非布尔' },
  { cmd: { asSphere: false, asPlane: false, asCircle: false, asPerp: false, asPoints: false }, name: '五线框开关全关' },
  { cmd: { opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { color: 123 }, name: '颜色非字符串' },
  { cmd: { id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveSectionsphere3D(b.cmd).ok === false, `拒绝：${b.name}`);
{
  const cmd0 = { op: 'sectionsphere3d', radius: 3, points: [[0, 0, 1], [3, 0, 1], [0, 3, 1]], asPoints: true };
  const st0 = { objects: [{ id: 'sec3d_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveSectionsphere3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('七、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sectionsphere3d', radius: 2, height: 1, segments: 8 }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 45, '逐项落地（24 大圆 + 8 截面圆 + 4 面片 + 1 垂线 + 2 直角 + 6 标注）');
  assert(approx(res[0].meta.distance, 1) && approx(res[0].meta.sectionRadius, Math.sqrt(3), 5e-3), 'meta 读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'sectionsphere3d', segments: 8 },
    { op: 'sectionsphere3d', segments: 8 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'sectionsphere3d', segments: 8 }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'sectionsphere3d', segments: 8 }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'sectionsphere3d', segments: 8 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'sectionsphere3d', height: 3 }, { op: 'sectionsphere3d', segments: 8 }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'sectionsphere3d', segments: 8 }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，sectionsphere3d 正常');
}

section('八、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_SECTIONSPHERE_PROMPT.includes('"op":"sectionsphere3d"') && BOARD3D_SECTIONSPHERE_PROMPT.includes('r²+d²=R²') && BOARD3D_SECTIONSPHERE_PROMPT.includes('截面圆'), '提示词含命令格式与守恒关系');
assert(BOARD3D_SECTIONSPHERE_PROMPT_OPS.length === 1 && BOARD3D_SECTIONSPHERE_PROMPT_OPS[0] === 'sectionsphere3d', '提示词 ops 一致');
assert(isSectionsphere3DIntent('用一个平面截球，求截面圆半径') && isSectionsphere3DIntent('球被平面截得的小圆'), '立体专属词识别（前置）');
assert(isSectionsphere3DIntent('球心到平面的距离与截面圆') && isSectionsphere3DIntent('平面截球的截面'), '立体专属词识别（后置）');
assert(!isSectionsphere3DIntent('画一个圆的弦') && !isSectionsphere3DIntent('直线与圆相交'), '2D 圆/直线不误切');
assert(!isSectionsphere3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '画一个平面截球的截面圆') === '3d', 'detect3d + 截球意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画一个圆的弦') === '2d', 'detect3d + 2D 圆弦仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SECTIONSPHERE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSectionsphere3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("ss.op !== 'sectionsphere3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('sectionsphere3d 给球心'), '画板面板工具说明已追加');

section('九、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SECTIONSPHERE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SOLIDMETRICS_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('BOARD_SYSTEM_PROMPT'), '2D 主干仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  const h = headBackend.split('\n');
  const n = nowBackend.split('\n');
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
  const headHtml = readHead('board3d.html');
  const nowHtml = read('board3d.html');
  const h = headHtml.split('\n');
  const n = nowHtml.split('\n');
  const inlineOnly = h.length === n.length && h.every((line, i) => {
    if (line === n[i]) return true;
    let j = 0;
    for (let k = 0; k < n[i].length && j < line.length; k++) if (n[i][k] === line[j]) j++;
    return j === line.length;
  });
  assert(inlineOnly, 'board3d.html 仅行内追加工具提示、未删改既有行');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'circumsphere3d'") && read('js/board3d-executor.js').includes("case 'solidmetrics3d'") && read('js/board3d-executor.js').includes("case 'sectionsphere3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

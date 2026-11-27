/**
 * 3D 球扇形 / 球锥命令（spheresector3d · D47）无头回归。
 *
 * 覆盖：spheresectorGeometry / num / parseSectorPoint / sectorFrame / 底半径·面积·体积纯函数 /
 *       resolveSpheresector3D（小球扇形 / 半球扇形 / 大球扇形 / 平移 / 任意轴，
 *        底圆点在球面且在截面且恒距圆心为 a、球心直母线恒长 R、弧点恒在球面、
 *        a²=h(2R−h)、V=2πR²h/3=V_cap+V_cone=R·S_cap/3、S=2πRh+πaR、
 *        开关组合 / 圆盘辐条 / 圆锥母线 / 球冠曲母线 / 小球 / 标注 / 样式 / 数字字符串 /
 *        id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_spheresector.mjs
 */
import {
  BOARD3D_SPHERESECTOR_PROMPT, BOARD3D_SPHERESECTOR_PROMPT_OPS,
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
  BOARD3D_CIRCUMCIRCLE_OPS, BOARD3D_COMPLETE36_OPS,
  BOARD3D_SPHERICALCAP_OPS, BOARD3D_COMPLETE37_OPS,
  BOARD3D_SPHERESECTOR_OPS, BOARD3D_COMPLETE38_OPS,
} from '../js/board3d-executor.js';
import {
  SPHERESECTOR3D_RADIUS_MIN, SPHERESECTOR3D_RADIUS_MAX, SPHERESECTOR3D_RADIUS_DEFAULT,
  SPHERESECTOR3D_SEGMENTS_MIN, SPHERESECTOR3D_SEGMENTS_MAX, SPHERESECTOR3D_SEGMENTS_DEFAULT,
  SPHERESECTOR3D_MERIDIANS_MIN, SPHERESECTOR3D_MERIDIANS_MAX, SPHERESECTOR3D_MERIDIANS_DEFAULT,
  SPHERESECTOR3D_ARCSEG_MIN, SPHERESECTOR3D_ARCSEG_MAX, SPHERESECTOR3D_ARCSEG_DEFAULT,
  SPHERESECTOR3D_SPOKES_MIN, SPHERESECTOR3D_SPOKES_MAX, SPHERESECTOR3D_SPOKES_DEFAULT,
  SPHERESECTOR3D_VERTEX_SIZE_MIN, SPHERESECTOR3D_VERTEX_SIZE_MAX, SPHERESECTOR3D_VERTEX_SIZE_DEFAULT,
  SPHERESECTOR3D_MAX_SEGMENTS, SPHERESECTOR3D_DEFAULT_CENTER, SPHERESECTOR3D_DEFAULT_AXIS,
  num, parseSectorPoint, sectorFrame, spheresectorBaseRadius, spheresectorCapArea,
  spheresectorConeArea, spheresectorVolume, spheresectorCapVolume, spheresectorConeVolume,
  spheresectorGeometry, resolveSpheresector3D,
} from '../js/board3d-spheresector.js';
import { isSpheresector3DIntent } from '../ai/board-prompt.js';
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
assert(BOARD3D_SOLIDMETRICS_OPS.length === 1 && BOARD3D_COMPLETE34_OPS.length === 43 && BOARD3D_SECTIONSPHERE_OPS.length === 1 && BOARD3D_COMPLETE35_OPS.length === 44, 'COMPLETE34 43 / COMPLETE35 44');
assert(BOARD3D_CIRCUMCIRCLE_OPS.length === 1 && BOARD3D_COMPLETE36_OPS.length === 45, 'COMPLETE36 45');
assert(BOARD3D_SPHERICALCAP_OPS.length === 1 && BOARD3D_COMPLETE37_OPS.length === 46, 'COMPLETE37 46');
assert(BOARD3D_SPHERESECTOR_OPS.length === 1 && BOARD3D_SPHERESECTOR_OPS[0] === 'spheresector3d' && BOARD3D_COMPLETE38_OPS.length === 47, 'D47 OPS 1 / COMPLETE38 47');
assert(Object.isFrozen(BOARD3D_SPHERESECTOR_OPS) && Object.isFrozen(BOARD3D_COMPLETE38_OPS), 'D47 常量冻结');
assert(BOARD3D_COMPLETE38_OPS.includes('spheresector3d') && BOARD3D_COMPLETE38_OPS.includes('sphericalcap3d') && BOARD3D_COMPLETE38_OPS.includes('circumcircle3d'), 'COMPLETE38 含新旧全部命令');
assert(!BOARD3D_OPS.includes('spheresector3d') && !BOARD3D_COMPLETE37_OPS.includes('spheresector3d'), '历史契约常量未并入新命令');
assert(SPHERESECTOR3D_RADIUS_MIN === 0.01 && SPHERESECTOR3D_RADIUS_MAX === 10000 && SPHERESECTOR3D_RADIUS_DEFAULT === 2, '半径常量');
assert(SPHERESECTOR3D_SEGMENTS_MIN === 8 && SPHERESECTOR3D_SEGMENTS_MAX === 512 && SPHERESECTOR3D_SEGMENTS_DEFAULT === 48, '段数常量');
assert(SPHERESECTOR3D_MERIDIANS_MIN === 3 && SPHERESECTOR3D_MERIDIANS_MAX === 64 && SPHERESECTOR3D_MERIDIANS_DEFAULT === 8, '经线条数常量');
assert(SPHERESECTOR3D_ARCSEG_MIN === 4 && SPHERESECTOR3D_ARCSEG_MAX === 128 && SPHERESECTOR3D_ARCSEG_DEFAULT === 12, '弧段常量');
assert(SPHERESECTOR3D_SPOKES_MIN === 0 && SPHERESECTOR3D_SPOKES_MAX === 32 && SPHERESECTOR3D_SPOKES_DEFAULT === 8, '辐条常量');
assert(SPHERESECTOR3D_VERTEX_SIZE_MIN === 0.01 && SPHERESECTOR3D_VERTEX_SIZE_MAX === 1 && SPHERESECTOR3D_VERTEX_SIZE_DEFAULT === 0.1, '小球常量');
assert(SPHERESECTOR3D_MAX_SEGMENTS === 4096 && Object.isFrozen(SPHERESECTOR3D_DEFAULT_CENTER) && Object.isFrozen(SPHERESECTOR3D_DEFAULT_AXIS), '上限与默认常量冻结');

section('二、数值 / 点解析 / 标架 / 纯函数');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 1e2 ') === 100, 'num 数字与数字字符串');
assert(num('') === null && num('abc') === null && num(null) === null && num(Infinity) === null, 'num 拒绝空串/表达式/null/Infinity');
assert(vecApprox(parseSectorPoint([1, '2', 3]), [1, 2, 3]), 'parseSectorPoint 数字字符串');
assert(parseSectorPoint([1, 2]) === null && parseSectorPoint(['x', 2, 3]) === null && parseSectorPoint(null) === null, 'parseSectorPoint 拒绝非法点');
{
  const f = sectorFrame([0, 0, 1]);
  assert(f && vecApprox(f.n, [0, 0, 1]), 'sectorFrame 默认 z 轴 n');
  assert(approx(dot(f.n, f.u), 0) && approx(dot(f.n, f.v), 0) && approx(dot(f.u, f.v), 0), 'sectorFrame 标架两两正交');
  assert(approx(norm(f.n), 1) && approx(norm(f.u), 1) && approx(norm(f.v), 1), 'sectorFrame 标架单位化');
  assert(sectorFrame([0, 0, 0]) === null && sectorFrame([1, 2]) === null, 'sectorFrame 拒绝零向量/非三元组');
}
assert(approx(spheresectorBaseRadius(2, 1), Math.sqrt(3)), '底半径 a=√(h(2R−h))');
assert(spheresectorBaseRadius(2, 0) === null && spheresectorBaseRadius(2, 4) === null && spheresectorBaseRadius(2, 5) === null, '底半径越界拒绝');
assert(approx(spheresectorCapArea(2, 1), 4 * Math.PI), 'S_cap=2πRh');
assert(approx(spheresectorConeArea(2, Math.sqrt(3)), 2 * Math.PI * Math.sqrt(3)), 'S_cone=πaR');
assert(approx(spheresectorVolume(2, 1), 8 * Math.PI / 3), 'V=2πR²h/3');
assert(approx(spheresectorCapVolume(2, 1), 5 * Math.PI / 3), 'V_cap=πh²(3R−h)/3');
assert(approx(spheresectorConeVolume(Math.sqrt(3), 1), Math.PI), 'V_cone=πa²d/3');

section('三、球扇形几何解（小球扇形 / 半球 / 大球扇形 / 平移 / 任意轴）');
{
  const g = spheresectorGeometry({ radius: 2, height: 1 });
  assert(g.ok && approx(g.h, 1) && approx(g.d, 1) && approx(g.a, Math.sqrt(3)), '小球扇形 h=1 d=1 a=√3');
  assert(approx(g.volume, 8 * Math.PI / 3), '小球扇形 V=8π/3');
  assert(approx(g.vCap + g.vCone, g.volume), '小球扇形 V=V_cap+V_cone');
  assert(approx(g.volume, 2 * g.surfaceCap / 3), '小球扇形 V=R·S_cap/3');
  assert(approx(g.surface, 4 * Math.PI + 2 * Math.PI * Math.sqrt(3)), '小球扇形 S=2πRh+πaR');
  assert(vecApprox(g.baseCenter, [0, 0, 1]) && vecApprox(g.apex, [0, 0, 2]), '小球扇形底心/顶点坐标');
}
{
  const g = spheresectorGeometry({ radius: 2, height: 2 });
  assert(g.ok && approx(g.d, 0) && approx(g.a, 2), '半球扇形 d=0 a=2');
  assert(approx(g.vCone, 0) && approx(g.vCap, g.volume), '半球扇形 V_cone=0');
  assert(approx(g.volume, 16 * Math.PI / 3), '半球扇形 V=16π/3');
}
{
  const g = spheresectorGeometry({ radius: 2, height: 3 });
  assert(g.ok && approx(g.d, -1) && approx(g.a, Math.sqrt(3)), '大球扇形 d=−1 a=√3');
  assert(g.vCone < 0 && approx(g.vCap + g.vCone, g.volume), '大球扇形 V_cone<0 但 V=V_cap+V_cone 成立');
  assert(approx(g.volume, 8 * Math.PI), '大球扇形 V=8π');
}
{
  const g = spheresectorGeometry({ center: [10, -5, 3], radius: 2, height: 1, axis: [1, 0, 0] });
  assert(g.ok && vecApprox(g.center, [10, -5, 3]) && vecApprox(g.n, [1, 0, 0]), '平移球心 + x 轴取向');
  assert(approx(g.a, Math.sqrt(3)) && approx(g.volume, 8 * Math.PI / 3), '平移/转向后标度量不变');
}
{
  const g0 = spheresectorGeometry({ radius: 2, height: 1 });
  assert(approx(g0.baseCenter[0], 0), '默认球心原点');
  assert(spheresectorGeometry(null) === null, '几何解空命令返回 null');
  assert(!spheresectorGeometry({ radius: 2, height: 0 }).ok, 'height=0 拒绝');
  assert(!spheresectorGeometry({ radius: 2, height: 4 }).ok, 'height=2R 拒绝');
  assert(!spheresectorGeometry({ radius: 2, height: 5 }).ok, 'height>2R 拒绝');
  assert(!spheresectorGeometry({ radius: 0, height: 1 }).ok, 'radius=0 拒绝');
  assert(!spheresectorGeometry({ radius: 2, height: 1, axis: [0, 0, 0] }).ok, 'axis 零向量拒绝');
}

section('四、resolveSpheresector3D 图元与守恒读数');
{
  const r = resolveSpheresector3D({ op: 'spheresector3d', id: 'ss', radius: 2, height: 1 });
  assert(r.ok && Array.isArray(r.items) && r.items.length > 0, '默认 resolve 成功');
  assert(r.meta.segmentCount > 0 && r.meta.labelCount === 6, '默认段数与 6 项标注');
  assert(r.meta.sphereMaxDev <= 0.02 * 2 && r.meta.planeMaxDev <= 0.02 * 2, '底圆守恒读数在容差内');
  assert(r.meta.generatorMaxDev <= 0.02 * 2 && r.meta.arcMaxDev <= 0.02 * 2, '锥母线/弧点守恒读数在容差内');
  assert(approx(r.meta.volume, 8 * Math.PI / 3, 5e-3) && approx(r.meta.surface, 4 * Math.PI + 2 * Math.PI * Math.sqrt(3), 5e-3), 'meta 体积/表面积读数');
  assert(r.items.every((it) => it.id && it.type && it.pos && it.rot && it.scale && it.p), '每项图元结构完整');
}
{
  const r = resolveSpheresector3D({ radius: 2, height: 1, asPoints: true });
  assert(r.ok && r.meta.pointCount > 0 && r.items.some((it) => it.type === 'point'), 'asPoints 出小球');
  const r2 = resolveSpheresector3D({ radius: 2, height: 1, asPoints: false });
  assert(r2.ok && r2.meta.pointCount === 0 && !r2.items.some((it) => it.type === 'point'), 'asPoints 关不出小球');
}
{
  const r = resolveSpheresector3D({ radius: 2, height: 1, labelRadius: false, labelVolume: false });
  assert(r.ok && r.meta.labelCount === 4, '读数开关生效');
  const off = resolveSpheresector3D({ radius: 2, height: 1, asSphere: false, asDisc: false, asCircle: false, asCone: false, asCap: false, asAxis: false });
  assert(!off.ok, '六项画图开关全关原子拒绝');
}

section('五、样式 / 数字字符串 / 段数上限 / id 避让');
{
  const r = resolveSpheresector3D({ radius: '2', height: '1', segments: '48', meridians: '8', vertexSize: '0.1', opacity: '0.5' });
  assert(r.ok && approx(r.meta.radius, 2) && approx(r.meta.opacity, 0.5), '数字字符串容错');
  const styled = resolveSectorsector3DFailSafe();
  function resolveSectorsector3DFailSafe() { return resolveSpheresector3D({ radius: 2, height: 1, color: '#abcdef', discColor: 'bad', coneColor: '#0f0', capColor: '#f00', axisColor: '#123', labelColor: '#456' }); }
  assert(styled.ok && styled.meta.color === '#abcdef' && styled.meta.coneColor === '#0f0', '合法颜色生效');
  assert(styled.meta.discColor === '#e0a020', '非法颜色回退默认');
}
{
  const huge = resolveSpheresector3D({ radius: 2, height: 1, segments: 512, meridians: 64, arcSegments: 128, spokes: 32 });
  assert(!huge.ok && /上限/.test(huge.error), '段数超上限原子拒绝');
}
{
  const r = resolveSpheresector3D({ id: 'a'.repeat(64), radius: 2, height: 1 });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符长 id 不越界');
  const state = { objects: [{ id: 'ss_sph0_0' }, { id: 'ss_sph0_0_2' }] };
  const r2 = resolveSpheresector3D({ id: 'ss', radius: 2, height: 1, segments: 8, meridians: 3, arcSegments: 4, spokes: 0 }, state);
  assert(r2.ok && r2.items.some((it) => it.id === 'ss_sph0_0_3'), 'id 冲突避让到 _3');
  const ids = new Set(r2.items.map((it) => it.id));
  assert(ids.size === r2.items.length, '批内 id 不重复');
}

section('六、脏输入原子拒绝');
{
  const bad = [
    { radius: 2, height: 1, center: [1, 2] },
    { radius: 'abc', height: 1 },
    { radius: 2, height: 'abc' },
    { radius: 2, height: 1, axis: [0, 0, 0] },
    { radius: 2, height: 1, segments: 7 },
    { radius: 2, height: 1, segments: 513 },
    { radius: 2, height: 1, segments: 8.5 },
    { radius: 2, height: 1, meridians: 2 },
    { radius: 2, height: 1, arcSegments: 3 },
    { radius: 2, height: 1, spokes: 33 },
    { radius: 2, height: 1, vertexSize: 0 },
    { radius: 2, height: 1, vertexSize: 2 },
    { radius: 2, height: 1, asSphere: 'yes' },
    { radius: 2, height: 1, labelVolume: 1 },
    { radius: 2, height: 1, opacity: 'x' },
    { radius: 2, height: 1, id: 'bad id!' },
    { radius: 2, height: 1, id: 123 },
    { radius: 2, height: 1, color: 123 },
    { radius: 2, height: -1 },
    { radius: 2, height: 5 },
  ];
  let allRejected = true;
  for (const cmd of bad) { const r = resolveSpheresector3D(cmd); if (r.ok) { allRejected = false; console.log('  未拒绝:', JSON.stringify(cmd)); } }
  assert(allRejected, `全部 ${bad.length} 类脏输入原子拒绝`);
  assert(!resolveSpheresector3D(null).ok && !resolveSpheresector3D([]).ok, '空命令/数组拒绝');
}

section('七、深度只读性');
{
  const cmd = Object.freeze({ op: 'spheresector3d', radius: 2, height: 1, segments: 8, meridians: 3, arcSegments: 4, spokes: 0 });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const before = JSON.stringify(cmd);
  const r = resolveSpheresector3D(cmd, state);
  assert(r.ok && JSON.stringify(cmd) === before, '冻结命令不被修改');
  assert(JSON.stringify(state) === '{"objects":[]}', '冻结 state 不被修改');
  r.items[0].id = 'mutated';
  assert(cmd.id === undefined, '输出与入参无引用 Sharing');
}

section('八、执行器集成 / 协议两侧一致性');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'spheresector3d', id: 'ss', radius: 2, height: 1 }], api);
  assert(res.length === 1 && res[0].ok && res[0].count === added.length, '执行器逐项落地');
  assert([...new Set(added.map((o) => o.type))].sort().join(',') === 'label,line', 'line + label 两类图元');
  assert(res[0].meta && approx(res[0].meta.volume, 8 * Math.PI / 3, 5e-3), '执行器回传 meta 读数');
}
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [{ id: 'ss' }] }) };
  const res = applyBoard3DCommands([{ op: 'spheresector3d', id: 'ss', radius: 2, height: 1 }], api);
  assert(res[0].ok && res[0].created.every((c) => c.id !== 'ss'), 'getState 已有 id 时避让');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'spheresector3d', radius: 2, height: 1 }], api);
  assert(res[0].ok, 'getState 抛错降级为空场景、整批不中断');
}
{
  const api = { add: () => null, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'spheresector3d', radius: 2, height: 1 }], api);
  assert(!res[0].ok && res[0].failed && res[0].failed.length > 0, 'api.add 失败分项回报');
}
{
  const res = applyBoard3DCommands([{ op: 'point', x: 1, y: 2 }], { add: () => true, getState: () => ({}) });
  assert(res[0].ok === false && /3D 分支/.test(res[0].error), '2D 命令在 3D 执行器被拒绝');
}
assert(BOARD3D_SPHERESECTOR_PROMPT_OPS.length === 1 && BOARD3D_SPHERESECTOR_PROMPT_OPS[0] === 'spheresector3d', '提示词 OPS 常量一致');
assert(BOARD3D_SPHERESECTOR_PROMPT.includes('spheresector3d') && BOARD3D_SPHERESECTOR_PROMPT.includes('V=2πR²h/3'), '提示词含命令与恒等式');
assert(isSpheresector3DIntent('画一个球扇形') && isSpheresector3DIntent('球锥的体积和表面积'), '立体专属词识别');
assert(!isSpheresector3DIntent('画一个扇形') && !isSpheresector3DIntent('扇形面积') && !isSpheresector3DIntent('弓形'), '2D 扇形/弓形不误切');
assert(!isSpheresector3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '球扇形体积') === '3d', 'detect3d + 球扇形意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画一个扇形') === '2d', 'detect3d + 2D 扇形仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SPHERESECTOR_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSpheresector3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("ss.op !== 'spheresector3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('spheresector3d 给球心'), '画板面板工具说明已追加');

section('九、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SPHERESECTOR_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SPHERICALCAP_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'sphericalcap3d'") && read('js/board3d-executor.js').includes("case 'spheresector3d'") && read('js/board3d-executor.js').includes("case 'circumcircle3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;

/**
 * 3D 球冠 / 球缺 / 球台命令（sphericalcap3d · D46）无头回归。
 *
 * 覆盖：sphericalcapGeometry / num / parseCapPoint / capFrame / 体积表面积底半径纯函数 /
 *       resolveSphericalcap3D（半球 / 小球冠 / 大球冠 / 球台 / 平移 / 任意轴、
 *        底圆点在球面且在截面且恒距圆心为 a、a²=h(2R−h)、S=2πRh、
 *        V=πh²(3R−h)/3 与 πh(3a1²+3a2²+h²)/6 两式一致、经线弧点恒在球面、
 *        开关组合 / 圆盘辐条 / 经线 / 小球 / 标注 / 样式 / 数字字符串 /
 *        id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_sphericalcap.mjs
 */
import {
  BOARD3D_SPHERICALCAP_PROMPT, BOARD3D_SPHERICALCAP_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  SPHERICALCAP3D_RADIUS_MIN, SPHERICALCAP3D_RADIUS_MAX, SPHERICALCAP3D_RADIUS_DEFAULT,
  SPHERICALCAP3D_SEGMENTS_MIN, SPHERICALCAP3D_SEGMENTS_MAX, SPHERICALCAP3D_SEGMENTS_DEFAULT,
  SPHERICALCAP3D_MERIDIANS_MIN, SPHERICALCAP3D_MERIDIANS_MAX, SPHERICALCAP3D_MERIDIANS_DEFAULT,
  SPHERICALCAP3D_ARCSEG_MIN, SPHERICALCAP3D_ARCSEG_MAX, SPHERICALCAP3D_ARCSEG_DEFAULT,
  SPHERICALCAP3D_SPOKES_MIN, SPHERICALCAP3D_SPOKES_MAX, SPHERICALCAP3D_SPOKES_DEFAULT,
  SPHERICALCAP3D_VERTEX_SIZE_MIN, SPHERICALCAP3D_VERTEX_SIZE_MAX, SPHERICALCAP3D_VERTEX_SIZE_DEFAULT,
  SPHERICALCAP3D_MAX_SEGMENTS, SPHERICALCAP3D_DEFAULT_CENTER, SPHERICALCAP3D_DEFAULT_AXIS,
  num, parseCapPoint, capFrame, sphericalcapBaseRadius, sphericalcapArea, sphericalcapVolume,
  sphericalcapGeometry, resolveSphericalcap3D,
} from '../js/board3d-sphericalcap.js';
import { isSphericalcap3DIntent } from '../ai/board-prompt.js';
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
assert(BOARD3D_SPHERICALCAP_OPS.length === 1 && BOARD3D_SPHERICALCAP_OPS[0] === 'sphericalcap3d' && BOARD3D_COMPLETE37_OPS.length === 46, 'D46 OPS 1 / COMPLETE37 46');
assert(Object.isFrozen(BOARD3D_SPHERICALCAP_OPS) && Object.isFrozen(BOARD3D_COMPLETE37_OPS), 'D46 常量冻结');
assert(BOARD3D_COMPLETE37_OPS.includes('sphericalcap3d') && BOARD3D_COMPLETE37_OPS.includes('circumcircle3d') && BOARD3D_COMPLETE37_OPS.includes('sectionsphere3d'), 'COMPLETE37 含新旧全部命令');
assert(!BOARD3D_OPS.includes('sphericalcap3d') && !BOARD3D_COMPLETE36_OPS.includes('sphericalcap3d'), '历史契约常量未并入新命令');
assert(SPHERICALCAP3D_RADIUS_MIN === 0.01 && SPHERICALCAP3D_RADIUS_MAX === 10000 && SPHERICALCAP3D_RADIUS_DEFAULT === 2, '半径常量');
assert(SPHERICALCAP3D_SEGMENTS_MIN === 8 && SPHERICALCAP3D_SEGMENTS_MAX === 512 && SPHERICALCAP3D_SEGMENTS_DEFAULT === 48, '段数常量');
assert(SPHERICALCAP3D_MERIDIANS_MIN === 3 && SPHERICALCAP3D_MERIDIANS_MAX === 64 && SPHERICALCAP3D_MERIDIANS_DEFAULT === 8, '经线条数常量');
assert(SPHERICALCAP3D_ARCSEG_MIN === 4 && SPHERICALCAP3D_ARCSEG_MAX === 128 && SPHERICALCAP3D_ARCSEG_DEFAULT === 12, '弧段常量');
assert(SPHERICALCAP3D_SPOKES_MIN === 0 && SPHERICALCAP3D_SPOKES_MAX === 32 && SPHERICALCAP3D_SPOKES_DEFAULT === 8, '辐条常量');
assert(SPHERICALCAP3D_VERTEX_SIZE_MIN === 0.01 && SPHERICALCAP3D_VERTEX_SIZE_MAX === 1 && SPHERICALCAP3D_VERTEX_SIZE_DEFAULT === 0.1, '小球常量');
assert(SPHERICALCAP3D_MAX_SEGMENTS === 4096 && Object.isFrozen(SPHERICALCAP3D_DEFAULT_CENTER) && Object.isFrozen(SPHERICALCAP3D_DEFAULT_AXIS), '上限与默认常量冻结');

section('二、数值 / 点解析 / 标架');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 1e2 ') === 100, 'num 数字与数字字符串');
assert(num('') === null && num('  ') === null && num('abc') === null && num(null) === null && num(NaN) === null && num(Infinity) === null, 'num 脏输入拒绝');
assert(vecApprox(parseCapPoint([1, 2, 3]), [1, 2, 3]) && vecApprox(parseCapPoint(['1', '2', '3']), [1, 2, 3]), '点解析含数字字符串');
assert(parseCapPoint([1, 2]) === null && parseCapPoint([1, 2, 3, 4]) === null && parseCapPoint('x') === null && parseCapPoint([1, 'x', 3]) === null, '点解析脏输入拒绝');
{
  const f = capFrame([0, 0, 1]);
  assert(vecApprox(f.n, [0, 0, 1]) && approx(norm(f.u), 1) && approx(norm(f.v), 1), '标架默认 z 轴单位');
  assert(approx(dot(f.u, f.v), 0, 1e-6) && approx(dot(f.u, f.n), 0, 1e-6) && approx(dot(f.v, f.n), 0, 1e-6), '标架两两正交');
  assert(capFrame([1, 1, 1]) && capFrame([1, 0, 0]) && capFrame([0, 1, 0]), '标架斜轴 / 近 z 轴切换 helper');
  assert(capFrame([0, 0, 0]) === null && capFrame([1, 2]) === null && capFrame(['x', 0, 0]) === null, '标架零向量 / 脏输入拒绝');
}

section('三、纯函数 底半径 / 面积 / 体积');
assert(approx(sphericalcapBaseRadius(2, 0), 2) && approx(sphericalcapBaseRadius(2, 1), Math.sqrt(3)), '底半径 √(R²−d²)');
assert(sphericalcapBaseRadius(2, 2) === null && sphericalcapBaseRadius(2, -2) === null && sphericalcapBaseRadius(2, 3) === null, '底半径 |d|≥R 拒绝');
assert(approx(sphericalcapArea(2, 2), 8 * Math.PI) && approx(sphericalcapArea(2, 1), 4 * Math.PI), '面积 S=2πRh');
assert(approx(sphericalcapVolume(2, 2, 0), 16 * Math.PI / 3), '半球体积 V=16π/3');
assert(approx(sphericalcapVolume(1, Math.sqrt(3), 0), 5 * Math.PI / 3), '小球冠体积 V=5π/3');
assert(approx(sphericalcapVolume(1, 2, Math.sqrt(3)), 11 * Math.PI / 3), '球台体积 V=11π/3');

section('四、几何解 sphericalcapGeometry');
{
  const g = sphericalcapGeometry({});
  assert(g.ok && g.mode === 'cap' && approx(g.radius, 2) && approx(g.d1, 0) && approx(g.h, 2), '默认半球：R=2 d=0 h=2');
  assert(approx(g.a1, 2) && approx(g.a1 * g.a1, g.h * (2 * g.radius - g.h), 1e-6), '半球底半径与 a²=h(2R−h)');
  assert(approx(g.surface, 8 * Math.PI) && approx(g.volume, 16 * Math.PI / 3), '半球 S=8π V=16π/3');
  assert(vecApprox(g.center, [0, 0, 0]) && vecApprox(g.n, [0, 0, 1]) && vecApprox(g.apex, [0, 0, 2]), '球心 / 法向 / 顶点');
}
{
  const g = sphericalcapGeometry({ radius: 2, height: 1 });
  assert(g.ok && approx(g.h, 1) && approx(g.a1, Math.sqrt(3)), '小球冠 h=1 a=√3');
  assert(approx(g.surface, 4 * Math.PI) && approx(g.volume, 5 * Math.PI / 3), '小球冠 S=4π V=5π/3');
  const g2 = sphericalcapGeometry({ radius: 2, height: -1 });
  assert(g2.ok && approx(g2.h, 3) && approx(g2.a1, Math.sqrt(3)), '大球冠 h=3 a=√3');
  assert(approx(g2.volume, 9 * Math.PI), '大球冠 V=9π');
}
{
  const g = sphericalcapGeometry({ mode: 'zone', height1: 0, height2: 1 });
  assert(g.ok && g.bases.length === 2 && approx(g.h, 1) && approx(g.a1, 2) && approx(g.a2, Math.sqrt(3)), '球台双底 a1=2 a2=√3 h=1');
  assert(approx(g.surface, 4 * Math.PI) && approx(g.volume, 11 * Math.PI / 3), '球台 S=4π V=11π/3');
  const g2 = sphericalcapGeometry({ mode: 'zone', height1: -1, height2: 1 });
  assert(g2.ok && approx(g2.h, 2) && approx(g2.a1, Math.sqrt(3)) && approx(g2.a2, Math.sqrt(3)), '对称球台 h=2 双底等半径');
}
{
  const g = sphericalcapGeometry({ center: [5, -3, 2], radius: 2, height: 1, axis: [1, 1, 0] });
  assert(g.ok && vecApprox(g.center, [5, -3, 2]), '平移球心');
  assert(approx(dot(g.n, unit([1, 1, 0])), 1, 1e-6), '斜轴法向');
}
assert(sphericalcapGeometry(null) === null && sphericalcapGeometry([]) === null && sphericalcapGeometry('x') === null, '几何解非对象拒绝');
assert(sphericalcapGeometry({ radius: 0 }).ok === false, '半径 0 拒绝');
assert(sphericalcapGeometry({ radius: 2, height: 2 }).ok === false, '|height|=R 拒绝');
assert(sphericalcapGeometry({ radius: 2, height: -2 }).ok === false, '|height|=R 负向拒绝');
assert(sphericalcapGeometry({ radius: 2, height: 3 }).ok === false, '|height|>R 拒绝');
assert(sphericalcapGeometry({ mode: 'zone', height1: 1, height2: 1 }).ok === false, 'zone 等高拒绝');
assert(sphericalcapGeometry({ mode: 'zone', height1: 1, height2: 0 }).ok === false, 'zone 逆序拒绝');
assert(sphericalcapGeometry({ mode: 'zone', height1: -3, height2: 1 }).ok === false, 'zone 越界拒绝');
assert(sphericalcapGeometry({ mode: 'bad' }).ok === false, 'mode 非法拒绝');
assert(sphericalcapGeometry({ axis: [0, 0, 0] }).ok === false, '轴零向量拒绝');

section('五、resolveSphericalcap3D 输出与守恒');
{
  const r = resolveSphericalcap3D({ id: 'cap', segments: 8, meridians: 4, arcSegments: 4, spokes: 8 }, { objects: [] });
  assert(r.ok && r.meta.mode === 'cap', '默认 cap 解析成功');
  assert(r.meta.segmentCount === 3 * 8 + 8 + 8 + 4 * 4 + 1, '线段计数=球三大圆24+圆盘辐条8+底圆8+经线16+轴1=57');
  assert(r.meta.labelCount === 6 && r.meta.pointCount === 0, '六标注 / 默认无小球');
  assert(approx(r.meta.height, 2) && approx(r.meta.baseRadius, 2) && approx(r.meta.surface, 8 * Math.PI), 'meta 读数');
  assert(r.meta.sphereMaxDev < 0.01 && r.meta.planeMaxDev < 0.01 && r.meta.radiusMaxDev < 0.01, '守恒偏差近零');
  const lines = r.items.filter((it) => it.type === 'line');
  assert(lines.every((it) => it.type === 'line' && it.p && Number.isFinite(it.p.x2)), '所有 line 对象结构完整');
  const labels = r.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.some((t) => t === 'R=2') && labels.some((t) => t === 'h(冠高)=2') && labels.some((t) => t === 'a=2'), 'R/h/a 标注文本');
  assert(labels.some((t) => t.includes('V=')) && labels.some((t) => t.includes('S=')), 'V/S 标注文本');
}
{
  const r = resolveSphericalcap3D({ mode: 'zone', height1: 0, height2: 1, segments: 8, meridians: 4, arcSegments: 4, spokes: 0 }, {});
  assert(r.ok && r.meta.mode === 'zone' && r.meta.baseRadius === 2 && approx(r.meta.baseRadius2, Math.sqrt(3)), 'zone meta 双底半径');
  const labels = r.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.some((t) => t === 'd1=0') && labels.some((t) => t === 'h(台高)=1'), 'zone 标注文本');
}
{
  // 全开：小球、所有开关、样式
  const r = resolveSphericalcap3D({
    asPoints: true, segments: 8, meridians: 4, arcSegments: 4, spokes: 4,
    vertexSize: 0.2, color: '#123456', discColor: '#abcdef', meridianColor: '#654321',
    axisColor: '#111111', labelColor: '#222222', opacity: '0.6',
  }, {});
  assert(r.ok && r.meta.pointCount > 0, '全开小球');
  assert(r.meta.color === '#123456' && r.meta.discColor === '#abcdef' && r.meta.meridianColor === '#654321' && r.meta.opacity === 0.6, '样式生效含数字字符串 opacity');
  const pts = r.items.filter((it) => it.type === 'point');
  assert(pts.every((it) => Number.isFinite(it.p.s)), '小球对象结构完整');
}
{
  // 数字字符串容错
  const r = resolveSphericalcap3D({ radius: '2', height: '1', segments: '8', meridians: '4', arcSegments: '4', spokes: '4' }, {});
  assert(r.ok && r.meta.radius === 2 && approx(r.meta.height, 1), '数字字符串参数容错');
}
{
  // id 避让
  const r = resolveSphericalcap3D({ id: 'cap', segments: 8, meridians: 4, arcSegments: 4 }, { objects: [{ id: 'cap_sph0_0' }] });
  assert(r.ok && r.items.every((it) => it.id !== 'cap_sph0_0'), '已有 id 避让');
  const r2 = resolveSphericalcap3D({ id: 'x'.repeat(64), segments: 8, meridians: 4, arcSegments: 4 }, { objects: [{ id: 'x'.repeat(64) }] });
  assert(r2.ok && r2.items.every((it) => it.id.length <= 64), '64 字符长 id 不死循环、不越界');
  assert(resolveSphericalcap3D({ id: '@bad' }).ok === false, '非法 id 拒绝');
}

section('六、脏输入原子拒绝');
const bad = [
  { cmd: null, name: '命令 null' },
  { cmd: [], name: '命令数组' },
  { cmd: 'x', name: '命令字符串' },
  { cmd: { center: [0, 0] }, name: 'center 非三元组' },
  { cmd: { radius: 0 }, name: '半径 0' },
  { cmd: { radius: -1 }, name: '半径负' },
  { cmd: { radius: 10001 }, name: '半径越界' },
  { cmd: { radius: 2, height: 2 }, name: '|height|=R' },
  { cmd: { radius: 2, height: -2 }, name: '|height|=R 负' },
  { cmd: { axis: [0, 0, 0] }, name: '轴零向量' },
  { cmd: { axis: 'x' }, name: '轴非数组' },
  { cmd: { mode: 'bad' }, name: 'mode 非法' },
  { cmd: { mode: 'zone' }, name: 'zone 缺高度' },
  { cmd: { mode: 'zone', height1: 1, height2: 0 }, name: 'zone 逆序' },
  { cmd: { mode: 'zone', height1: 1, height2: 1 }, name: 'zone 等高' },
  { cmd: { segments: 7 }, name: 'segments 过小' },
  { cmd: { segments: 513 }, name: 'segments 过大' },
  { cmd: { segments: 8.5 }, name: 'segments 非整数' },
  { cmd: { segments: 'abc' }, name: 'segments 非数值' },
  { cmd: { meridians: 2 }, name: 'meridians 过小' },
  { cmd: { meridians: 65 }, name: 'meridians 过大' },
  { cmd: { arcSegments: 3 }, name: 'arcSegments 过小' },
  { cmd: { arcSegments: 129 }, name: 'arcSegments 过大' },
  { cmd: { spokes: -1 }, name: 'spokes 负' },
  { cmd: { spokes: 33 }, name: 'spokes 过大' },
  { cmd: { vertexSize: 0 }, name: 'vertexSize 过小' },
  { cmd: { vertexSize: 2 }, name: 'vertexSize 过大' },
  { cmd: { asSphere: 'true' }, name: '开关非布尔' },
  { cmd: { asSphere: false, asDisc: false, asCircle: false, asMeridians: false, asAxis: false }, name: '五输出开关全关' },
  { cmd: { opacity: 'x' }, name: 'opacity 非数值' },
  { cmd: { color: 123 }, name: '颜色非字符串' },
  { cmd: { id: '@' }, name: 'id 非法字符' },
];
for (const b of bad) assert(resolveSphericalcap3D(b.cmd).ok === false, `拒绝：${b.name}`);
{
  const cmd0 = { op: 'sphericalcap3d', radius: 2, height: 1, asPoints: true };
  const st0 = { objects: [{ id: 'cap_e0', type: 'line' }] };
  const snapshotC = JSON.stringify(cmd0);
  const snapshotS = JSON.stringify(st0);
  resolveSphericalcap3D(cmd0, st0);
  assert(JSON.stringify(cmd0) === snapshotC && JSON.stringify(st0) === snapshotS, 'cmd / state 深度只读');
}

section('七、执行器集成');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], api);
  assert(res[0].ok && res[0].count === added.length && added.length === 63, '逐项落地 63 项（57 线 + 6 标注）');
  assert(approx(res[0].meta.height, 2) && approx(res[0].meta.baseRadius, 2), 'meta 读数回传');
  const res2 = applyBoard3DCommands([
    { op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 },
    { op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 },
  ], { add: () => true, getState: () => ({ objects: [] }) });
  assert(res2[0].ok === true && res2[1].ok === false && res2[1].failed && res2[1].failed.length > 0, '同批 id 冲突分项失败');
  assert(applyBoard3DCommands([{ op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], { add: () => true })[0].ok, 'getState 缺失降级为空场景');
  const api4 = { add: () => true, getState: () => { throw new Error('x'); } };
  assert(applyBoard3DCommands([{ op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], api4)[0].ok, 'getState 抛错降级为空场景');
  let k = 0;
  const api5 = { add: () => (++k === 3 ? false : true), getState: () => ({ objects: [] }) };
  const res5 = applyBoard3DCommands([{ op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], api5);
  assert(res5[0].ok === false && res5[0].failed && res5[0].failed.length >= 1, 'api.add 部分失败分项回报');
  const mixed = applyBoard3DCommands([{ op: 'sphericalcap3d', radius: 2, height: 2 }, { op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], { add: () => true, getState: () => ({}) });
  assert(mixed.length === 2 && mixed[0].ok === false && mixed[1].ok === true, '坏命令不中断整批');
  const twoD = applyBoard3DCommands([{ op: 'segment' }, { op: 'sphericalcap3d', segments: 8, meridians: 4, arcSegments: 4 }], api);
  assert(twoD[0].ok === false && twoD[1].ok === true, '2D segment 被 3D 分支拒绝，sphericalcap3d 正常');
}

section('八、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_SPHERICALCAP_PROMPT.includes('"op":"sphericalcap3d"') && BOARD3D_SPHERICALCAP_PROMPT.includes('S=2πRh') && BOARD3D_SPHERICALCAP_PROMPT.includes('球冠'), '提示词含命令格式与守恒关系');
assert(BOARD3D_SPHERICALCAP_PROMPT.includes('mode') && BOARD3D_SPHERICALCAP_PROMPT.includes('球台'), '提示词含 zone 球台说明');
assert(BOARD3D_SPHERICALCAP_PROMPT_OPS.length === 1 && BOARD3D_SPHERICALCAP_PROMPT_OPS[0] === 'sphericalcap3d', '提示词 ops 一致');
assert(isSphericalcap3DIntent('画一个球冠') && isSphericalcap3DIntent('球被平面截下的球缺体积'), '立体专属词识别（前置）');
assert(isSphericalcap3DIntent('半球的体积和表面积') && isSphericalcap3DIntent('球台的体积'), '立体专属词识别（追加）');
assert(!isSphericalcap3DIntent('画一个圆缺') && !isSphericalcap3DIntent('梯形面积'), '2D 圆缺 / 梯形不误切');
assert(!isSphericalcap3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '球冠的体积') === '3d', 'detect3d + 球冠意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画一个圆弓形') === '2d', 'detect3d + 2D 圆弓形仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SPHERICALCAP_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSphericalcap3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("sc.op !== 'sphericalcap3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('sphericalcap3d 给球心'), '画板面板工具说明已追加');

section('九、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SPHERICALCAP_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_CIRCUMCIRCLE_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'circumcircle3d'") && read('js/board3d-executor.js').includes("case 'sectionsphere3d'") && read('js/board3d-executor.js').includes("case 'sphericalcap3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;

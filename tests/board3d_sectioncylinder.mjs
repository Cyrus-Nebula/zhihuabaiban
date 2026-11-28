/**
 * 3D 平面截圆柱截面椭圆命令（sectioncylinder3d · D50）无头回归。
 *
 * 覆盖：sectionCylinderGeometry / num / parseSCPoint / sectionFrame / semiMajor / area 纯函数 /
 *       resolveSectionCylinder3D（默认斜截 / 垂直截圆 / 斜轴平移带 offset，
 *        椭圆点恒在柱面、恒在截面且不超柱高、a=r/sinθ、S=πab=πr²/sinθ、
 *        开关组合 / 辐条 / 母线 / 小球 / 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_sectioncylinder.mjs
 */
import {
  BOARD3D_SECTIONCYLINDER_PROMPT, BOARD3D_SECTIONCYLINDER_PROMPT_OPS,
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
  BOARD3D_SPHERICALWEDGE_OPS, BOARD3D_COMPLETE39_OPS,
  BOARD3D_SPHERESPHERE_OPS, BOARD3D_COMPLETE40_OPS,
  BOARD3D_SECTIONCYLINDER_OPS, BOARD3D_COMPLETE41_OPS,
} from '../js/board3d-executor.js';
import {
  SECTIONCYLINDER3D_RADIUS_MIN, SECTIONCYLINDER3D_RADIUS_MAX, SECTIONCYLINDER3D_RADIUS_DEFAULT,
  SECTIONCYLINDER3D_HEIGHT_MIN, SECTIONCYLINDER3D_HEIGHT_MAX, SECTIONCYLINDER3D_HEIGHT_DEFAULT,
  SECTIONCYLINDER3D_ANGLE_MIN, SECTIONCYLINDER3D_ANGLE_MAX, SECTIONCYLINDER3D_ANGLE_DEFAULT,
  SECTIONCYLINDER3D_SEGMENTS_MIN, SECTIONCYLINDER3D_SEGMENTS_MAX, SECTIONCYLINDER3D_SEGMENTS_DEFAULT,
  SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MIN, SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MAX, SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_DEFAULT,
  SECTIONCYLINDER3D_SPOKES_MIN, SECTIONCYLINDER3D_SPOKES_MAX, SECTIONCYLINDER3D_SPOKES_DEFAULT,
  SECTIONCYLINDER3D_MERIDIANS_MIN, SECTIONCYLINDER3D_MERIDIANS_MAX, SECTIONCYLINDER3D_MERIDIANS_DEFAULT,
  SECTIONCYLINDER3D_VERTEX_SIZE_MIN, SECTIONCYLINDER3D_VERTEX_SIZE_MAX, SECTIONCYLINDER3D_VERTEX_SIZE_DEFAULT,
  SECTIONCYLINDER3D_RIGHT_ANGLE_MIN, SECTIONCYLINDER3D_RIGHT_ANGLE_MAX, SECTIONCYLINDER3D_RIGHT_ANGLE_DEFAULT,
  SECTIONCYLINDER3D_MAX_SEGMENTS, SECTIONCYLINDER3D_DEFAULT_CENTER, SECTIONCYLINDER3D_DEFAULT_AXIS,
  num, parseSCPoint, sectionFrame, sectionEllipseSemiMajor, sectionEllipseArea,
  sectionCylinderGeometry, sectionEllipsePoint, resolveSectionCylinder3D,
} from '../js/board3d-sectioncylinder.js';
import { isSectioncylinder3DIntent } from '../ai/board-prompt.js';
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
const len = (a) => Math.sqrt(dot(a, a));

section('一、常量与历史契约（7~49 条逐字不变）');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '基础契约 7/8/9 条');
const history = [
  BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS,
  BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS,
  BOARD3D_COMPLETE9_OPS, BOARD3D_COMPLETE10_OPS, BOARD3D_COMPLETE11_OPS, BOARD3D_COMPLETE12_OPS,
  BOARD3D_COMPLETE13_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_COMPLETE15_OPS, BOARD3D_COMPLETE16_OPS,
  BOARD3D_COMPLETE17_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_COMPLETE19_OPS, BOARD3D_COMPLETE20_OPS,
  BOARD3D_COMPLETE21_OPS, BOARD3D_COMPLETE22_OPS, BOARD3D_COMPLETE23_OPS, BOARD3D_COMPLETE24_OPS,
  BOARD3D_COMPLETE25_OPS, BOARD3D_COMPLETE26_OPS, BOARD3D_COMPLETE27_OPS, BOARD3D_COMPLETE28_OPS,
  BOARD3D_COMPLETE29_OPS, BOARD3D_COMPLETE30_OPS, BOARD3D_COMPLETE31_OPS, BOARD3D_COMPLETE32_OPS,
  BOARD3D_COMPLETE33_OPS, BOARD3D_COMPLETE34_OPS, BOARD3D_COMPLETE35_OPS, BOARD3D_COMPLETE36_OPS,
  BOARD3D_COMPLETE37_OPS, BOARD3D_COMPLETE38_OPS, BOARD3D_COMPLETE39_OPS, BOARD3D_COMPLETE40_OPS,
];
assert(history.length === 40 && history.every((ops, i) => ops.length === 10 + i), 'COMPLETE1~40 长度 10~49 逐字不变');
assert(BOARD3D_SECTIONCYLINDER_OPS.length === 1 && BOARD3D_SECTIONCYLINDER_OPS[0] === 'sectioncylinder3d', '新命令独立成组');
assert(BOARD3D_COMPLETE41_OPS.length === 50 && BOARD3D_COMPLETE41_OPS.includes('sectioncylinder3d'), 'COMPLETE41=50 条');
assert(!history.some((ops) => ops.includes('sectioncylinder3d')), '新命令未并入任何历史契约常量');
assert(SECTIONCYLINDER3D_RADIUS_DEFAULT === 1.5 && SECTIONCYLINDER3D_RADIUS_MIN === 0.01 && SECTIONCYLINDER3D_RADIUS_MAX === 10000, '半径默认值与边界');
assert(SECTIONCYLINDER3D_HEIGHT_DEFAULT === 6 && SECTIONCYLINDER3D_HEIGHT_MIN === 0.1 && SECTIONCYLINDER3D_HEIGHT_MAX === 10000, '高度默认值与边界');
assert(SECTIONCYLINDER3D_ANGLE_DEFAULT === 45 && SECTIONCYLINDER3D_ANGLE_MIN === 5 && SECTIONCYLINDER3D_ANGLE_MAX === 90, '角度默认值与边界');
assert(SECTIONCYLINDER3D_SEGMENTS_DEFAULT === 48 && SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_DEFAULT === 64 && SECTIONCYLINDER3D_MAX_SEGMENTS === 4096, '采样默认与线段上限');
assert(vecApprox(SECTIONCYLINDER3D_DEFAULT_CENTER, [0, 0, 0]) && vecApprox(SECTIONCYLINDER3D_DEFAULT_AXIS, [0, 0, 1]), '默认柱心与 z 轴');

section('二、纯函数：num / 点解析 / 正交标架 / 半轴 / 面积');
assert(num(1.5) === 1.5 && num('2.5') === 2.5 && num('') === null && num(null) === null && num(NaN) === null && num(Infinity) === null, 'num 严格有限数');
assert(vecApprox(parseSCPoint([1, '2', 3]), [1, 2, 3]) && parseSCPoint([1, 2]) === null && parseSCPoint(['x', 2, 3]) === null, 'parseSCPoint 点解析');
{
  const fr = sectionFrame([1, 0, 0], 45);
  assert(fr !== null && approx(dot(fr.n, fr.m), Math.SQRT1_2) && approx(dot(fr.n, fr.e1), Math.SQRT1_2), 'n·m=sinθ、n·e1=cosθ');
  assert(approx(dot(fr.m, fr.e1), 0) && approx(dot(fr.m, fr.e2), 0) && approx(dot(fr.e1, fr.e2), 0), '标架两两正交');
  assert(approx(len(fr.m), 1) && approx(len(fr.e1), 1) && approx(len(fr.e2), 1), '标架单位长度');
  assert(sectionFrame([0, 0, 0], 45) === null && sectionFrame([1, 2], 45) === null, '零向量/非法轴拒绝');
  assert(sectionFrame([0, 0, 1], 45) !== null && sectionFrame([1, 1, 1], 30) !== null, '近平行轴自动换 helper');
  assert(sectionFrame([1, 0, 0], 45, 'bad') !== null, '非法 helper 自动回退');
}
assert(approx(sectionEllipseSemiMajor(1.5, 45), 1.5 * Math.SQRT2) && approx(sectionEllipseSemiMajor(2, 90), 2), 'a=r/sinθ：45° 与 90°');
assert(sectionEllipseSemiMajor(2, 0) === null && sectionEllipseSemiMajor(2, 91) === null && sectionEllipseSemiMajor(0, 45) === null, '半轴越界拒绝');
assert(approx(sectionEllipseArea(2, 30), 8 * Math.PI) && approx(sectionEllipseArea(2, 90), 4 * Math.PI), 'S=πr²/sinθ：30° 与 90°');
assert(sectionEllipseArea(2, 0) === null, '面积越界拒绝');

section('三、平面截圆柱几何解：默认 / 垂直截圆 / 斜轴平移 / 椭圆点守恒');
{
  const g = sectionCylinderGeometry({});
  assert(g.ok && approx(g.radius, 1.5) && approx(g.height, 6) && approx(g.angleDeg, 45), '默认 r=1.5、h=6、θ=45°');
  assert(approx(g.semiMajor, 1.5 * Math.SQRT2) && approx(g.semiMinor, 1.5), '默认 a=1.5√2、b=1.5');
  assert(approx(g.area, (9 * Math.SQRT2 / 4) * Math.PI) && approx(g.axialHalf, 1.5), '默认 S=9√2π/4、轴向半展=1.5');
  assert(vecApprox(g.bottom, [0, 0, -3]) && vecApprox(g.top, [0, 0, 3]) && vecApprox(g.sectionCenter, [0, 0, 0]), '默认上下底心与截面中心');
}
{
  const g = sectionCylinderGeometry({ angle: 90 });
  assert(g.ok && approx(g.semiMajor, g.radius) && approx(g.semiMinor, g.radius), 'θ=90° 退化为圆 a=b=r');
  assert(approx(g.area, Math.PI * g.radius ** 2), 'θ=90° 面积 πr²');
}
{
  const g = sectionCylinderGeometry({ center: [1, 2, 0], axis: [1, 1, 1], radius: 2, height: 10, angle: 30, offset: 1 });
  assert(g.ok && vecApprox(g.center, [1, 2, 0]) && approx(g.semiMajor, 4) && approx(g.area, 8 * Math.PI), '斜轴平移 + offset：a=2r、S=2πr²');
  assert(approx(len(sub(g.sectionCenter, g.center)), 1) && approx(dot(sub(g.sectionCenter, g.center), g.n), 1), '截面中心沿柱轴偏移 offset');
  let radialDev = 0, planeDev = 0, axialDev = 0;
  for (let i = 0; i < 128; i++) {
    const p = sectionEllipsePoint(g, (2 * Math.PI * i) / 128);
    const d = sub(p, g.center);
    const along = dot(d, g.n);
    radialDev = Math.max(radialDev, Math.abs(Math.sqrt(dot(d, d) - along * along) - 2));
    planeDev = Math.max(planeDev, Math.abs(dot(sub(p, g.sectionCenter), g.m)));
    axialDev = Math.max(axialDev, Math.abs(along));
  }
  assert(radialDev < 1e-6 && planeDev < 1e-6, '椭圆采样点恒在柱面且恒在截面内');
  assert(axialDev <= 5 + 1e-6, '椭圆采样点不超有限圆柱高度');
  assert(approx(dot(g.n, g.m), 0.5) && approx(dot(g.e1, g.m), 0) && approx(dot(g.e1, g.n), Math.sqrt(3) / 2), '30° 标架关系');
}
{
  const g = sectionCylinderGeometry({ radius: 2, height: 4, angle: 30 });
  assert(!g.ok && /超出/.test(g.error), '截面超出柱高原子拒绝');
  const g2 = sectionCylinderGeometry({ radius: 1.5, height: 6, angle: 45, offset: 2 });
  assert(!g2.ok && /超出/.test(g2.error), 'offset 过大原子拒绝');
}
assert(sectionCylinderGeometry(null) === null && sectionCylinderGeometry([]) === null, '空几何输入拒绝');
for (const bad of [
  { center: [0, 0] }, { axis: 'x' }, { axis: [0, 0, 0] }, { radius: 0 }, { radius: 10001 },
  { height: 0 }, { height: 10001 }, { angle: 4 }, { angle: 91 }, { offset: 10001 },
]) {
  assert(!sectionCylinderGeometry(bad).ok, `几何拒绝：${JSON.stringify(bad)}`);
}

section('四、resolveSectionCylinder3D：默认 / 开关 / 标注 / 样式 / 边界');
{
  const r = resolveSectionCylinder3D({});
  assert(r.ok && r.meta.itemCount === r.items.length, '默认命令成功');
  assert(r.meta.segmentCount === 188 && r.meta.labelCount === 6 && r.meta.pointCount === 0, '默认 188 线 + 6 标注');
  assert(approx(r.meta.radius, 1.5) && approx(r.meta.height, 6) && approx(r.meta.angleDeg, 45), '默认 meta 读数');
  assert(approx(r.meta.semiMajor, 1.5 * Math.SQRT2, 5e-3) && approx(r.meta.semiMinor, 1.5) && approx(r.meta.area, (9 * Math.SQRT2 / 4) * Math.PI, 5e-3), '默认 meta a/b/S');
  assert([...new Set(r.items.map((it) => it.type))].sort().join(',') === 'label,line', '默认两类图元 line+label');
  assert(r.meta.radialDev < 0.01 && r.meta.planeDev < 0.01 && r.meta.axialDev <= 3.01, '默认守恒读数');
}
{
  const r = resolveSectionCylinder3D({ ellipseSegments: 8, spokes: 0, asCylinder: false, asAxes: false, asRadii: false, asPoints: true });
  assert(r.ok && r.meta.segmentCount === 8 && r.meta.pointCount === 12, '仅椭圆+小球：8 线 + 12 点');
  assert(r.items.every((it) => it.type !== 'line' || it.color === r.meta.sectionColor), '仅椭圆使用 sectionColor');
}
{
  const r = resolveSectionCylinder3D({ ellipseSegments: 8, spokes: 4, asCylinder: false, asAxes: false, asPoints: true, labelRadius: false, labelAngle: false, labelSemiMajor: false, labelSemiMinor: false, labelArea: false, labelRelation: false });
  assert(r.ok && r.meta.segmentCount === 8 + 4 + 4 + 2 && r.meta.pointCount === 12 && r.meta.labelCount === 0, '辐条/半径/直角/小球组合计数');
}
{
  const r = resolveSectionCylinder3D({ segments: 8, ellipseSegments: 8, spokes: 0, meridians: 4, asRadii: false, vertexSize: '0.2', rightAngleSize: '0.3', color: '#123456', opacity: '0.5' });
  assert(r.ok && approx(r.meta.vertexSize, 0.2) && approx(r.meta.rightAngleSize, 0.3), '数字字符串参数容错');
  assert(r.meta.color === '#123456' && approx(r.meta.opacity, 0.5), '颜色/透明度样式生效');
  assert(r.meta.segmentCount === 16 + 4 + 8 + 2, '母线与底圆计数');
}
{
  const r = resolveSectionCylinder3D({ id: 'x'.repeat(64), ellipseSegments: 8, asCylinder: false, asAxes: false, asRadii: false });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符 id 边界不溢出');
}
{
  const r = resolveSectionCylinder3D({ id: 'sci', ellipseSegments: 8, asCylinder: false, asAxes: false, asRadii: false }, { objects: [{ id: 'sci' }, { id: 'sci_e0' }] });
  assert(r.ok && r.items.every((it) => it.id !== 'sci' && it.id !== 'sci_e0'), 'state 中已有 id 全部避让');
}
{
  const labels = resolveSectionCylinder3D({ ellipseSegments: 8, asCylinder: false, asAxes: false, asRadii: false }).items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.some((t) => t.includes('r=')) && labels.some((t) => t.includes('θ=')) && labels.some((t) => t.includes('a=r/sinθ=')) && labels.some((t) => t.includes('b=r=')) && labels.some((t) => t.includes('S=πab=')) && labels.some((t) => t.includes('πr²/sinθ')), 'r/θ/a/b/S/关系式六类标注齐全');
}

section('五、脏输入原子拒绝');
{
  const bad = [
    { center: [0, 0] }, { axis: null }, { axis: [0, 0, 0] }, { radius: 0 }, { radius: 10001 },
    { height: 0 }, { height: 10001 }, { angle: 4 }, { angle: 91 }, { offset: 10001 },
    { radius: 2, height: 4, angle: 30 }, { height: 6, angle: 45, offset: 2 },
    { segments: 7 }, { segments: 513 }, { segments: 8.5 }, { segments: 'x' },
    { ellipseSegments: 7 }, { ellipseSegments: 513 }, { ellipseSegments: 1.2 },
    { spokes: -1 }, { spokes: 33 }, { spokes: 1.2 },
    { meridians: -1 }, { meridians: 65 }, { meridians: 2.5 },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' },
    { rightAngleSize: 0 }, { rightAngleSize: 3 }, { rightAngleSize: 'x' },
    { asCylinder: 'yes' }, { labelRelation: 1 },
    { asCylinder: false, asSection: false, asAxes: false, asRadii: false },
    { color: 123 }, { sectionColor: [], opacity: 'x' },
    { id: 'bad id!' }, { id: 'x'.repeat(65) },
  ];
  let allRejected = true;
  for (const cmd of bad) {
    const r = resolveSectionCylinder3D(cmd);
    if (r.ok) { allRejected = false; console.log('  未拒绝:', JSON.stringify(cmd)); }
  }
  assert(allRejected, `全部 ${bad.length} 类脏输入原子拒绝`);
  assert(!resolveSectionCylinder3D(null).ok && !resolveSectionCylinder3D([]).ok, '空命令/数组拒绝');
}

section('六、深度只读性');
{
  const cmd = Object.freeze({ op: 'sectioncylinder3d', ellipseSegments: 8, asCylinder: false, asAxes: false, asRadii: false });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const before = JSON.stringify(cmd);
  const r = resolveSectionCylinder3D(cmd, state);
  assert(r.ok && JSON.stringify(cmd) === before, '冻结命令不被修改');
  assert(JSON.stringify(state) === '{"objects":[]}', '冻结 state 不被修改');
  r.items[0].id = 'mutated';
  assert(cmd.id === undefined, '输出与入参无引用 Sharing');
}

section('七、执行器集成 / 协议两侧一致性');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sectioncylinder3d', id: 'sci', ellipseSegments: 8, asCylinder: false, asAxes: false }], api);
  assert(res.length === 1 && res[0].ok && res[0].count === added.length, '执行器逐项落地');
  assert([...new Set(added.map((o) => o.type))].sort().join(',') === 'label,line', 'line + label 两类图元');
  assert(res[0].meta && approx(res[0].meta.semiMajor, 1.5 * Math.SQRT2, 5e-3), '执行器回传 meta 读数');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'sci' }] }) };
  const res = applyBoard3DCommands([{ op: 'sectioncylinder3d', id: 'sci', ellipseSegments: 8, asCylinder: false, asAxes: false }], api);
  assert(res[0].ok && res[0].created.every((c) => c.id !== 'sci'), 'getState 已有 id 时避让');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'sectioncylinder3d', ellipseSegments: 8, asCylinder: false, asAxes: false }], api);
  assert(res[0].ok, 'getState 抛错降级为空场景、整批不中断');
}
{
  const api = { add: () => null, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sectioncylinder3d', ellipseSegments: 8, asCylinder: false, asAxes: false }], api);
  assert(!res[0].ok && res[0].failed && res[0].failed.length > 0, 'api.add 失败分项回报');
}
{
  const res = applyBoard3DCommands([{ op: 'point', x: 1, y: 2 }], { add: () => true, getState: () => ({}) });
  assert(res[0].ok === false && /3D 分支/.test(res[0].error), '2D 命令在 3D 执行器被拒绝');
}
assert(BOARD3D_SECTIONCYLINDER_PROMPT_OPS.length === 1 && BOARD3D_SECTIONCYLINDER_PROMPT_OPS[0] === 'sectioncylinder3d', '提示词 OPS 常量一致');
assert(BOARD3D_SECTIONCYLINDER_PROMPT.includes('sectioncylinder3d') && BOARD3D_SECTIONCYLINDER_PROMPT.includes('a=radius/sinθ'), '提示词含命令与恒等式');
assert(isSectioncylinder3DIntent('用平面斜截圆柱求椭圆截面面积') && isSectioncylinder3DIntent('平面截圆柱得椭圆'), '立体专属词识别');
assert(!isSectioncylinder3DIntent('椭圆面积公式') && !isSectioncylinder3DIntent('椭圆标准方程') && !isSectioncylinder3DIntent('画一个圆柱'), '2D 椭圆/单圆柱不误切');
assert(!isSectioncylinder3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '平面截圆柱得椭圆') === '3d', 'detect3d + 截圆柱意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '椭圆面积公式') === '2d', 'detect3d + 2D 椭圆仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SECTIONCYLINDER_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSectioncylinder3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("sci.op !== 'sectioncylinder3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('sectioncylinder3d 给圆柱中心'), '画板面板工具说明已追加');

section('八、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SECTIONCYLINDER_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SPHERESPHERE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('BOARD_SYSTEM_PROMPT'), '2D 主干仍在');
}
{
  const h = readHead('ai/board-backend.js').split('\n');
  const n = read('ai/board-backend.js').split('\n');
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
  const h = readHead('board3d.html').split('\n');
  const n = read('board3d.html').split('\n');
  const inlineOnly = h.length === n.length && h.every((line, i) => {
    if (line === n[i]) return true;
    let j = 0;
    for (let k = 0; k < n[i].length && j < line.length; k++) if (n[i][k] === line[j]) j++;
    return j === line.length;
  });
  assert(inlineOnly, 'board3d.html 仅行内追加工具提示、未删改既有行');
  assert(n.join('\n').includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'sphericalcap3d'") && read('js/board3d-executor.js').includes("case 'spheresphere3d'") && read('js/board3d-executor.js').includes("case 'sectioncylinder3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;

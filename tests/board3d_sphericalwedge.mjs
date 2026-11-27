/**
 * 3D 球楔 / 球瓣命令（sphericalwedge3d · D48）无头回归。
 *
 * 覆盖：sphericalwedgeGeometry / num / parseWedgePoint / wedgeFrame / 体积·面积纯函数 /
 *       resolveSphericalwedge3D（直角球楔 / 半球楔 / 一般二面角 / 平移与斜轴，
 *        侧面点恒在球面且恒在对应半平面、法向夹角=α、赤道弧与纬线弧点恒在球面、
 *        V=2αR³/3=R·S曲/3、S曲=2αR²、S侧=πR²、S=S曲+πR²、
 *        开关组合 / 辐条 / 小球 / 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_sphericalwedge.mjs
 */
import {
  BOARD3D_SPHERICALWEDGE_PROMPT, BOARD3D_SPHERICALWEDGE_PROMPT_OPS,
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
} from '../js/board3d-executor.js';
import {
  SPHERICALWEDGE3D_RADIUS_MIN, SPHERICALWEDGE3D_RADIUS_MAX, SPHERICALWEDGE3D_RADIUS_DEFAULT,
  SPHERICALWEDGE3D_ANGLE_MIN, SPHERICALWEDGE3D_ANGLE_MAX, SPHERICALWEDGE3D_ANGLE_DEFAULT,
  SPHERICALWEDGE3D_SEGMENTS_MIN, SPHERICALWEDGE3D_SEGMENTS_MAX, SPHERICALWEDGE3D_SEGMENTS_DEFAULT,
  SPHERICALWEDGE3D_MERIDIANS_MIN, SPHERICALWEDGE3D_MERIDIANS_MAX, SPHERICALWEDGE3D_MERIDIANS_DEFAULT,
  SPHERICALWEDGE3D_SPOKES_MIN, SPHERICALWEDGE3D_SPOKES_MAX, SPHERICALWEDGE3D_SPOKES_DEFAULT,
  SPHERICALWEDGE3D_VERTEX_SIZE_MIN, SPHERICALWEDGE3D_VERTEX_SIZE_MAX, SPHERICALWEDGE3D_VERTEX_SIZE_DEFAULT,
  SPHERICALWEDGE3D_MAX_SEGMENTS, SPHERICALWEDGE3D_DEFAULT_CENTER, SPHERICALWEDGE3D_DEFAULT_AXIS,
  num, parseWedgePoint, wedgeFrame, sphericalwedgeVolume, sphericalwedgeCurvedArea,
  sphericalwedgeFaceArea, sphericalwedgeGeometry, resolveSphericalwedge3D,
} from '../js/board3d-sphericalwedge.js';
import { isSphericalwedge3DIntent } from '../ai/board-prompt.js';
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

section('一、常量与历史契约（7~47 条逐字不变）');
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
  BOARD3D_COMPLETE37_OPS, BOARD3D_COMPLETE38_OPS,
];
assert(history.length === 38 && history.every((ops, i) => ops.length === 10 + i), 'COMPLETE1~38 长度 10~47 逐字不变');
assert(BOARD3D_SPHERICALWEDGE_OPS.length === 1 && BOARD3D_SPHERICALWEDGE_OPS[0] === 'sphericalwedge3d', '新命令独立成组');
assert(BOARD3D_COMPLETE39_OPS.length === 48 && BOARD3D_COMPLETE39_OPS.includes('sphericalwedge3d'), 'COMPLETE39=48 条');
assert(!history.some((ops) => ops.includes('sphericalwedge3d')), '新命令未并入任何历史契约常量');
assert(SPHERICALWEDGE3D_RADIUS_DEFAULT === 2 && SPHERICALWEDGE3D_ANGLE_DEFAULT === 90, '默认 R=2 / α=90°');
assert(SPHERICALWEDGE3D_ANGLE_MIN === 0 && SPHERICALWEDGE3D_ANGLE_MAX === 360, '二面角边界 0<angle<360');
assert(SPHERICALWEDGE3D_MAX_SEGMENTS === 4096, '线段上限 4096');

section('二、纯函数：num / 点解析 / 正交标架 / 体积面积');
assert(num(1.5) === 1.5 && num('2.5') === 2.5 && num('') === null && num(null) === null && num(NaN) === null && num(Infinity) === null, 'num 严格有限数');
assert(vecApprox(parseWedgePoint([1, '2', 3]), [1, 2, 3]) && parseWedgePoint([1, 2]) === null && parseWedgePoint(['x', 2, 3]) === null, 'parseWedgePoint 点解析');
assert(wedgeFrame() !== null && vecApprox(wedgeFrame().n, [0, 0, 1]), '默认标架 n=z');
{
  const fr = wedgeFrame([0, 0, 1]);
  assert(vecApprox(fr.n, [0, 0, 1]) && approx(dot(fr.n, fr.u), 0) && approx(dot(fr.n, fr.v), 0) && approx(dot(fr.u, fr.v), 0), '标架两两正交');
  assert(wedgeFrame([0, 0, 0]) === null, '零向量轴拒绝');
  assert(wedgeFrame([1, 2]) === null && wedgeFrame(['a', 0, 1]) === null, '非法轴拒绝');
}
assert(approx(sphericalwedgeVolume(2, Math.PI / 2), 8 * Math.PI / 3), 'V(直角,R=2)=8π/3');
assert(approx(sphericalwedgeVolume(2, Math.PI), 16 * Math.PI / 3), 'V(半球楔,R=2)=16π/3');
assert(approx(sphericalwedgeCurvedArea(2, Math.PI / 2), 4 * Math.PI), 'S曲(直角,R=2)=4π');
assert(approx(sphericalwedgeFaceArea(2), 4 * Math.PI), 'S侧(R=2)=πR²=4π');
assert(approx(sphericalwedgeVolume(3, 2 * Math.PI / 3), 2 * (2 * Math.PI / 3) * 27 / 3), '一般二面角体积公式');

section('三、球楔几何解：默认 / 半球 / 一般角 / 平移斜轴');
{
  const g = sphericalwedgeGeometry({});
  assert(g.ok && approx(g.radius, 2) && approx(g.angleDeg, 90) && approx(g.angleRad, Math.PI / 2), '默认球楔 R=2 α=90°');
  assert(approx(g.volume, 8 * Math.PI / 3) && approx(g.surfaceCurved, 4 * Math.PI), '默认 V/S曲 闭合值');
  assert(approx(g.surface, 8 * Math.PI) && approx(g.surfaceFaces, 4 * Math.PI), '默认 S=8π、S侧=4π');
  assert(vecApprox(g.w0, g.u) && approx(dot(g.f1, g.f2), 0), '直角楔两法向正交');
  assert(approx(g.volume, g.radius * g.surfaceCurved / 3), 'V=R·S曲/3');
}
{
  const g = sphericalwedgeGeometry({ angle: 180 });
  assert(g.ok && approx(g.volume, 16 * Math.PI / 3) && approx(dot(g.f1, g.f2), -1), '半球楔 V=16π/3、法向反向');
}
{
  const g = sphericalwedgeGeometry({ angle: 60, radius: 3, center: [1, 2, 3], axis: [1, 1, 0] });
  assert(g.ok && vecApprox(g.center, [1, 2, 3]) && approx(dot(g.f1, g.f2), 0.5), '一般二面角 cos60°=0.5');
  assert(approx(g.volume, 2 * (Math.PI / 3) * 27 / 3), '平移斜轴体积守恒');
}
assert(sphericalwedgeGeometry(null) === null && sphericalwedgeGeometry([]) === null, '空几何输入拒绝');
assert(!sphericalwedgeGeometry({ radius: 0 }).ok && !sphericalwedgeGeometry({ radius: 10001 }).ok, '半径越界拒绝');
assert(!sphericalwedgeGeometry({ angle: 0 }).ok && !sphericalwedgeGeometry({ angle: 360 }).ok && !sphericalwedgeGeometry({ angle: -30 }).ok, '二面角越界拒绝');

section('四、resolve：守恒 / 开关 / 标注 / 样式 / id 避让');
{
  const r = resolveSphericalwedge3D({ radius: 2, angle: 90 }, {});
  assert(r.ok && r.meta.itemCount > 0, '默认 resolve 成功');
  assert(r.meta.sphereMaxDev <= 0.02 * 2 && r.meta.face0MaxDev <= 0.04 && r.meta.face1MaxDev <= 0.04, '侧面点球面/平面守恒');
  assert(r.meta.equatorMaxDev <= 0.04 && r.meta.parallelMaxDev <= 0.04, '曲楔面点在球面');
  assert(approx(r.meta.volume, 8 * Math.PI / 3, 5e-3) && approx(r.meta.surfaceCurved, 4 * Math.PI, 5e-3), 'meta 读数闭合');
  const f0 = r.items.filter((it) => it.id.includes('_face0_') && it.type === 'line');
  const f1 = r.items.filter((it) => it.id.includes('_face1_') && it.type === 'line');
  assert(f0.length > 0 && f1.length > 0, '两侧面弧线均生成');
  const p0 = f0[0].p, p1 = f1[0].p;
  assert(approx(Math.abs(dot([p0.x1, p0.y1, p0.z1], r.meta.basis.v)), 0, 0.04), '侧面1 点在 f1 平面');
  assert(approx(Math.abs(dot([p1.x1, p1.y1, p1.z1], r.meta.faceNormals.f2)), 0, 0.04), '侧面2 点在 f2 平面');
}
{
  const r = resolveSphericalwedge3D({ asSphere: false, asFaces: false, asSurface: false, asEdge: true, labelRadius: false, labelAngle: false, labelVolume: false, labelArea: false, labelCurvedArea: false });
  assert(r.ok && r.meta.segmentCount === 1 && r.meta.itemCount === 1, '仅公共棱模式：1 条线');
}
{
  const r = resolveSphericalwedge3D({ segments: 8, meridians: 1, spokes: 2, asPoints: true, color: '#abcdef', faceColor: '#123456', surfaceColor: '#654321', edgeColor: '#111111', labelColor: '#222222', opacity: 0.6, vertexSize: 0.2 });
  assert(r.ok && r.meta.pointCount > 0 && r.meta.itemCount > 0, '全开关 + 小球生成');
  assert(r.meta.color === '#abcdef' && r.meta.faceColor === '#123456' && r.meta.surfaceColor === '#654321' && r.meta.opacity === 0.6, '样式读数');
  const pts = r.items.filter((it) => it.type === 'point');
  assert(pts.every((p) => approx(p.p.s, 0.2)), '小球尺寸随 vertexSize');
}
{
  const r = resolveSphericalwedge3D({ radius: '2', angle: '90', segments: '8', meridians: '2', spokes: '1', vertexSize: '0.1' });
  assert(r.ok && approx(r.meta.radius, 2) && approx(r.meta.angleDeg, 90), '数字字符串容错');
}
{
  const texts = resolveSphericalwedge3D({}).items.filter((it) => it.type === 'label').map((it) => it.text).join(' | ');
  assert(/R=2/.test(texts) && /α=90/.test(texts) && /V=/.test(texts) && /S=/.test(texts) && /S曲=/.test(texts), 'R/α/V/S/S曲 五项标注');
}
{
  const id = 'x'.repeat(64);
  const r = resolveSphericalwedge3D({ id, segments: 8, meridians: 1, spokes: 0 });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '64 字符长 id 不越界');
  const state = { objects: [{ id: 'sw' }, { id: 'sw_2' }] };
  const r2 = resolveSphericalwedge3D({ id: 'sw', segments: 8, meridians: 1, spokes: 0 }, state);
  assert(r2.ok && r2.items.every((it) => it.id !== 'sw' && it.id !== 'sw_2'), '已有 id 自动避让');
}

section('五、脏输入原子拒绝');
{
  const bad = [
    { id: 'bad id' }, { id: 123 }, { center: [1, 2] }, { center: ['a', 0, 0] },
    { radius: 0 }, { radius: -1 }, { radius: 10001 }, { radius: 'abc' }, { radius: null },
    { axis: [0, 0, 0] }, { axis: [1, 2] }, { axis: null },
    { angle: 0 }, { angle: 360 }, { angle: -90 }, { angle: 'abc' }, { angle: Infinity },
    { segments: 7 }, { segments: 513 }, { segments: 1.5 }, { segments: 'x' },
    { meridians: 0 }, { meridians: 33 }, { meridians: 2.5 },
    { spokes: -1 }, { spokes: 33 }, { spokes: 1.2 },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: 'x' },
    { asSphere: 'yes' }, { labelAngle: 1 },
    { asSphere: false, asFaces: false, asSurface: false, asEdge: false },
    { color: 123 }, { surfaceColor: [], opacity: 'x' },
  ];
  let allRejected = true;
  for (const cmd of bad) {
    const r = resolveSphericalwedge3D(cmd);
    if (r.ok) { allRejected = false; console.log('  未拒绝:', JSON.stringify(cmd)); }
  }
  assert(allRejected, `全部 ${bad.length} 类脏输入原子拒绝`);
  assert(!resolveSphericalwedge3D(null).ok && !resolveSphericalwedge3D([]).ok, '空命令/数组拒绝');
}

section('六、深度只读性');
{
  const cmd = Object.freeze({ op: 'sphericalwedge3d', radius: 2, angle: 90, segments: 8, meridians: 1, spokes: 0 });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const before = JSON.stringify(cmd);
  const r = resolveSphericalwedge3D(cmd, state);
  assert(r.ok && JSON.stringify(cmd) === before, '冻结命令不被修改');
  assert(JSON.stringify(state) === '{"objects":[]}', '冻结 state 不被修改');
  r.items[0].id = 'mutated';
  assert(cmd.id === undefined, '输出与入参无引用 Sharing');
}

section('七、执行器集成 / 协议两侧一致性');
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sphericalwedge3d', id: 'sw', radius: 2, angle: 90 }], api);
  assert(res.length === 1 && res[0].ok && res[0].count === added.length, '执行器逐项落地');
  assert([...new Set(added.map((o) => o.type))].sort().join(',') === 'label,line', 'line + label 两类图元');
  assert(res[0].meta && approx(res[0].meta.volume, 8 * Math.PI / 3, 5e-3), '执行器回传 meta 读数');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'sw' }] }) };
  const res = applyBoard3DCommands([{ op: 'sphericalwedge3d', id: 'sw' }], api);
  assert(res[0].ok && res[0].created.every((c) => c.id !== 'sw'), 'getState 已有 id 时避让');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'sphericalwedge3d' }], api);
  assert(res[0].ok, 'getState 抛错降级为空场景、整批不中断');
}
{
  const api = { add: () => null, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'sphericalwedge3d' }], api);
  assert(!res[0].ok && res[0].failed && res[0].failed.length > 0, 'api.add 失败分项回报');
}
{
  const res = applyBoard3DCommands([{ op: 'point', x: 1, y: 2 }], { add: () => true, getState: () => ({}) });
  assert(res[0].ok === false && /3D 分支/.test(res[0].error), '2D 命令在 3D 执行器被拒绝');
}
assert(BOARD3D_SPHERICALWEDGE_PROMPT_OPS.length === 1 && BOARD3D_SPHERICALWEDGE_PROMPT_OPS[0] === 'sphericalwedge3d', '提示词 OPS 常量一致');
assert(BOARD3D_SPHERICALWEDGE_PROMPT.includes('sphericalwedge3d') && BOARD3D_SPHERICALWEDGE_PROMPT.includes('V=2αR³/3'), '提示词含命令与恒等式');
assert(isSphericalwedge3DIntent('画一个球楔并求体积') && isSphericalwedge3DIntent('球面二面角'), '立体专属词识别');
assert(!isSphericalwedge3DIntent('画一个扇形') && !isSphericalwedge3DIntent('扇形面积') && !isSphericalwedge3DIntent('圆缺'), '2D 扇形/圆缺不误切');
assert(!isSphericalwedge3DIntent(''), '空串不误判');
assert(resolveBoardMode({ detect3d: true }, '球楔体积') === '3d', 'detect3d + 球楔意图 → 3D');
assert(resolveBoardMode({ detect3d: true }, '画一个扇形') === '2d', 'detect3d + 2D 扇形仍 2D');
assert(resolveBoardMode({ message: '画正方体' }, '画正方体') === '2d', '未显式 detect3d 保持 2D 主干');
assert(read('ai/board-backend.js').includes('+ BOARD3D_SPHERICALWEDGE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('ai/board-backend.js').includes('|| isSphericalwedge3DIntent(message)'), '后端意图分派已接入');
assert(read('js/board3d-ai.js').includes("sw.op !== 'sphericalwedge3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('sphericalwedge3d 给球心'), '画板面板工具说明已追加');

section('八、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_SPHERICALWEDGE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SPHERESECTOR_PROMPT'), '新段追加在既有段之后');
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
assert(read('js/board3d-executor.js').includes("case 'sphericalcap3d'") && read('js/board3d-executor.js').includes("case 'spheresector3d'") && read('js/board3d-executor.js').includes("case 'sphericalwedge3d'"), '新旧 3D 命令并存、历史分支未删');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exitCode = 1;

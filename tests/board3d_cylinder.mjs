/**
 * 3D 通用圆柱 / 斜圆柱命令（cylinder3d · D29）无头回归。
 *
 * 覆盖：cylinderAxisUnit / cylinderBaseBasis / cylinderRingPoint / resolveCylinder3D 纯函数
 *       （正 / 斜圆柱、底圈与顶圈半径守恒、双圈恒垂直法向、顶圈=底圈+shift 棱柱守恒、
 *        侧母线平行等长、轴向高与侧母线长读数、top 与 axis 分离表达斜圆柱、
 *        默认 / 指定 / 开关 / 小球与 O·A/B/C·A'/B'/C' 标注 / 样式 / 数字字符串 /
 *        id 避让与 64 字符边界 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、
 *       getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_cylinder.mjs
 */
import {
  BOARD3D_CYLINDER_PROMPT, BOARD3D_CYLINDER_PROMPT_OPS,
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
  BOARD3D_CYLINDER_OPS, BOARD3D_COMPLETE20_OPS,
} from '../js/board3d-executor.js';
import {
  CYLINDER3D_RADIUS_MIN, CYLINDER3D_RADIUS_MAX, CYLINDER3D_RADIUS_DEFAULT,
  CYLINDER3D_HEIGHT_MIN, CYLINDER3D_HEIGHT_MAX, CYLINDER3D_HEIGHT_DEFAULT,
  CYLINDER3D_SEGMENTS_MIN, CYLINDER3D_SEGMENTS_MAX, CYLINDER3D_SEGMENTS_DEFAULT,
  CYLINDER3D_VERTEX_SIZE_MIN, CYLINDER3D_VERTEX_SIZE_MAX, CYLINDER3D_VERTEX_SIZE_DEFAULT,
  CYLINDER3D_MAX_SEGMENTS, CYLINDER3D_DEFAULT_BASE, CYLINDER3D_DEFAULT_AXIS,
  num, cylinderAxisUnit, cylinderBaseBasis, cylinderRingPoint, resolveCylinder3D,
} from '../js/board3d-cylinder.js';
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
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);

// ---------------------------------------------------------------------------
section('一、常量与默认契约');
assert(CYLINDER3D_RADIUS_DEFAULT === 1 && CYLINDER3D_RADIUS_MIN === 0.01 && CYLINDER3D_RADIUS_MAX === 10000, '半径默认/区间常量');
assert(CYLINDER3D_HEIGHT_DEFAULT === 2 && CYLINDER3D_HEIGHT_MIN === 0.01 && CYLINDER3D_HEIGHT_MAX === 10000, '高度默认/区间常量');
assert(CYLINDER3D_SEGMENTS_DEFAULT === 24 && CYLINDER3D_SEGMENTS_MIN === 3 && CYLINDER3D_SEGMENTS_MAX === 64, '分段默认/区间常量');
assert(CYLINDER3D_VERTEX_SIZE_DEFAULT === 0.1 && CYLINDER3D_VERTEX_SIZE_MIN === 0.01 && CYLINDER3D_VERTEX_SIZE_MAX === 1, '顶点球默认/区间常量');
assert(CYLINDER3D_MAX_SEGMENTS === 4096 && CYLINDER3D_DEFAULT_AXIS === 'z', '段数上限与默认法向常量');
assert(frozen(CYLINDER3D_DEFAULT_BASE) && frozen(CYLINDER3D_DEFAULT_BASE[0]) && vecApprox(CYLINDER3D_DEFAULT_BASE, [0, 0, 0]), '默认底面圆心深冻结且为原点');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、cylinderAxisUnit 底面法向解析');
assert(vecApprox(cylinderAxisUnit(undefined), [0, 0, 1]), '默认法向 z');
assert(vecApprox(cylinderAxisUnit('x'), [1, 0, 0]) && vecApprox(cylinderAxisUnit('Y'), [0, 1, 0]) && vecApprox(cylinderAxisUnit('Z'), [0, 0, 1]), 'x/y/z 大小写法向');
assert(vecApprox(cylinderAxisUnit([0, 3, 4]), [0, 0.6, 0.8]), '任意向量单位化');
assert(cylinderAxisUnit('q') === null && cylinderAxisUnit([0, 0, 0]) === null && cylinderAxisUnit([1, 'x', 0]) === null && cylinderAxisUnit(null) === null, '非法法向拒绝');

section('三、cylinderBaseBasis 正交标架');
for (const u of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0.6, 0.8], [0.577, 0.577, 0.577]]) {
  const B = cylinderBaseBasis(u);
  assert(B && approx(dot(B.n, B.n), 1) && approx(dot(B.b, B.b), 1) && approx(dot(B.n, B.b), 0) && approx(dot(B.n, u), 0) && approx(dot(B.b, u), 0), `标架正交归一 u=[${u}]`);
}
assert(cylinderBaseBasis('z') === null && cylinderBaseBasis([0, 0]) === null && cylinderBaseBasis([NaN, 0, 1]) === null, '非法 u 返回 null');

section('四、cylinderRingPoint 圈点');
{
  const B = cylinderBaseBasis([0, 0, 1]);
  const p0 = cylinderRingPoint([0, 0, 0], B.n, B.b, 2, 0);
  const p90 = cylinderRingPoint([0, 0, 0], B.n, B.b, 2, Math.PI / 2);
  assert(vecApprox(p0, [2, 0, 0]) && vecApprox(p90, [0, 2, 0]), 'z 轴法向下圈点 0°/90° 点位');
  // 同标架不同圆心：顶圈=底圈平移
  const q0 = cylinderRingPoint([0, 0, 3], B.n, B.b, 2, 0);
  assert(vecApprox(sub(q0, p0), [0, 0, 3]), '同标架下顶圈点=底圈点+圆心平移');
}

section('五、resolveCylinder3D 正圆柱几何与守恒');
{
  const cmd = { op: 'cylinder3d', id: 'cyl', base: [0, 0, 0], axis: 'z', radius: 2, height: 3, segments: 8 };
  const r = resolveCylinder3D(cmd, {});
  assert(r.ok && r.meta.isRight === true, '正圆柱解析成功且 isRight');
  assert(r.meta.axialHeight === 3 && r.meta.sideLength === 3, '轴向高 3、侧母线长 3');
  assert(r.meta.baseRingCount === 8 && r.meta.topRingCount === 8 && r.meta.sideCount === 8 && r.meta.pointCount === 0 && r.meta.labelCount === 0, '底圈/顶圈/侧母线各 8、无点无标注');
  assert(r.items.length === 24 && r.items.every((it) => it.type === 'line'), '默认产 24 条 line');
  assert(r.meta.bottomRing.every((p) => approx(len(sub(p, [0, 0, 0])), 2)), '底圈各点到圆心距离恒为 radius');
  assert(r.meta.topRing.every((p) => approx(len(sub(p, [0, 0, 3])), 2)), '顶圈各点到顶面圆心距离恒为 radius');
  assert(r.meta.bottomRing.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '底圈各点 z=0、恒垂直法向');
  assert(r.meta.topRing.every((p) => approx(dot(sub(p, [0, 0, 3]), [0, 0, 1]), 0)), '顶圈各点 z=3、恒垂直法向');
  assert(r.meta.sideMaxDeviation === 0, '侧母线逐段=shift，棱柱守恒零偏差');
  const sl = r.meta.bottomRing.map((p, i) => len(sub(r.meta.topRing[i], p)));
  assert(sl.every((v) => approx(v, 3)), '正圆柱各侧母线等长 3');
  assert(vecApprox(r.meta.top, [0, 0, 3]) && vecApprox(r.meta.shift, [0, 0, 3]), '默认顶面圆心=base+height·axis');
}

section('六、斜圆柱：top 与 axis 分离');
{
  const r = resolveCylinder3D({ op: 'cylinder3d', base: [0, 0, 0], axis: 'z', top: [1.5, 0, 3], radius: 2, segments: 8 });
  assert(r.ok && r.meta.isRight === false, '斜圆柱解析成功且 isRight=false');
  assert(r.meta.topExplicit === true && vecApprox(r.meta.top, [1.5, 0, 3]), '显式 top 保留');
  assert(r.meta.axialHeight === 3 && approx(r.meta.sideLength, Math.sqrt(9 + 2.25)), '斜圆柱轴向高 3、侧母线长 √(3²+1.5²)');
  assert(r.meta.axialHeight < r.meta.sideLength, '斜圆柱轴向高 < 侧母线长');
  assert(r.meta.bottomRing.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '斜圆柱底面仍垂直 axis');
  assert(r.meta.topRing.every((p) => approx(dot(sub(p, [1.5, 0, 3]), [0, 0, 1]), 0)), '斜圆柱顶面仍垂直 axis（顶圈是真圆）');
  assert(r.meta.sideMaxDeviation === 0, '斜圆柱侧母线逐段=shift，仍平行等长');
  const sl = r.meta.bottomRing.map((p, i) => len(sub(r.meta.topRing[i], p)));
  assert(sl.every((v) => approx(v, r.meta.sideLength)), '斜圆柱各侧母线等长（区分是棱柱而非锥台）');
  const dirs = r.meta.bottomRing.map((p, i) => sub(r.meta.topRing[i], p));
  assert(dirs.every((d) => vecApprox(d, dirs[0])), '斜圆柱各侧母线方向一致（平行）');
  assert(!('height' in r.meta) === false && r.meta.height === 2, '显式 top 时 height 保持默认但被忽略');
}

section('七、开关、标注与样式');
{
  const r = resolveCylinder3D({ op: 'cylinder3d', segments: 5, asBase: false, asTop: false, asSides: false, asPoints: true, labelVertices: true, vertexSize: 0.2, color: '#ff0000', labelColor: '#00ff00', opacity: 0.6 });
  assert(r.ok && r.items.length === 24, '仅开点+标注：2 圆心球 + 10 圈点球 + 2 圆心标注 + 10 圈点标注 = 24');
  assert(r.items.filter((it) => it.type === 'point').length === 12 && r.items.filter((it) => it.type === 'label').length === 12, '12 点 + 12 标注');
  const labels = r.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.includes('O') && labels.includes("O'") && labels.includes('A') && labels.includes("A'") && labels.includes('E') && labels.includes("E'"), '圆心 O/O\' 与底圈 A..E、顶圈 A\'..E\' 标注');
  assert(r.items.every((it) => it.color === '#ff0000' || it.type === 'label') && r.items.find((it) => it.type === 'label').color === '#00ff00', '线/点红、标注绿');
  assert(r.items.find((it) => it.type === 'point').p.s === 0.2 && approx(r.items[0].opacity, 0.6), '顶点球半径与透明度');
}

section('八、数字字符串容错与 id 避让');
{
  const r = resolveCylinder3D({ op: 'cylinder3d', id: 'c', radius: '2', height: '3', segments: '8', vertexSize: '0.2' }, { objects: [{ id: 'c_b1' }, { id: 'c_t1' }] });
  assert(r.ok && r.meta.radius === 2 && r.meta.height === 3 && r.meta.segments === 8, '数字字符串参数被接受');
  const ids = r.items.map((it) => it.id);
  assert(new Set(ids).size === ids.length && !ids.includes('c_b1') && !ids.includes('c_t1'), 'id 与 state 冲突时避让且无重复');
}
{
  const longId = 'x'.repeat(64);
  const r = resolveCylinder3D({ op: 'cylinder3d', id: longId, segments: 3 }, { objects: [{ id: longId }] });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '超长 id 截断后 ≤64 且不死循环');
}

section('九、脏输入原子拒绝');
const bad = [
  [{ op: 'cylinder3d', id: 'bad id' }, 'id 非法'],
  [{ op: 'cylinder3d', base: [0, 0] }, 'base 非法'],
  [{ op: 'cylinder3d', base: [0, 'x', 0] }, 'base 含非法数'],
  [{ op: 'cylinder3d', axis: 'q' }, 'axis 非法'],
  [{ op: 'cylinder3d', axis: [0, 0, 0] }, 'axis 零向量'],
  [{ op: 'cylinder3d', radius: 0 }, 'radius 下界'],
  [{ op: 'cylinder3d', radius: 10001 }, 'radius 上界'],
  [{ op: 'cylinder3d', radius: 'x' }, 'radius 非数'],
  [{ op: 'cylinder3d', height: 0 }, 'height 下界'],
  [{ op: 'cylinder3d', height: 10001 }, 'height 上界'],
  [{ op: 'cylinder3d', top: [0, 0, 0] }, 'top 与 base 重合'],
  [{ op: 'cylinder3d', top: [1, 2] }, 'top 非法'],
  [{ op: 'cylinder3d', top: [10000, 10000, 10000] }, 'top 距离越界'],
  [{ op: 'cylinder3d', segments: 2 }, 'segments 下界'],
  [{ op: 'cylinder3d', segments: 65 }, 'segments 上界'],
  [{ op: 'cylinder3d', segments: 3.5 }, 'segments 非整数'],
  [{ op: 'cylinder3d', asBase: 'yes' }, 'asBase 非布尔'],
  [{ op: 'cylinder3d', asTop: 1 }, 'asTop 非布尔'],
  [{ op: 'cylinder3d', asSides: 0 }, 'asSides 非布尔'],
  [{ op: 'cylinder3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'cylinder3d', vertexSize: 0 }, 'vertexSize 下界'],
  [{ op: 'cylinder3d', vertexSize: 2 }, 'vertexSize 上界'],
  [{ op: 'cylinder3d', opacity: NaN }, 'opacity 非数'],
  [{ op: 'cylinder3d', asBase: false, asTop: false, asSides: false }, '五开关全关'],
  [null, '命令为空'],
  [[], '命令为数组'],
];
for (const [cmd, label] of bad) {
  const r = resolveCylinder3D(cmd, {});
  assert(r.ok === false && typeof r.error === 'string', `${label} 原子拒绝`);
}

section('十、深度只读性');
{
  const cmd = Object.freeze({ op: 'cylinder3d', id: 'c', base: Object.freeze([0, 0, 0]), radius: 1, top: Object.freeze([0, 0, 2]) });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'x' })]) });
  let threw = false;
  try { resolveCylinder3D(cmd, state); } catch (_) { threw = true; }
  assert(!threw, '冻结入参不抛错');
  assert(JSON.stringify(cmd.base) === '[0,0,0]' && state.objects.length === 1, '入参未被修改');
  const r = resolveCylinder3D(cmd, state);
  r.items[0].p.x1 = 999; r.meta.bottomRing[0][0] = 999;
  assert(cmd.base[0] === 0, '输出改动不回流到入参');
}

// ---------------------------------------------------------------------------
section('十一、执行器常量与历史契约');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_OPS/ALL/FULL 条数不变');
assert([10, 11, 12, 13, 14, 15, 16, 17, 18].every((want, i) => {
  const c = [BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_COMPLETE9_OPS][i];
  return c.length === want;
}), '历史 COMPLETE~COMPLETE9 长度逐项不变');
assert(BOARD3D_COMPLETE10_OPS.length === 19 && BOARD3D_COMPLETE11_OPS.length === 20 && BOARD3D_COMPLETE12_OPS.length === 21 && BOARD3D_COMPLETE13_OPS.length === 22 && BOARD3D_COMPLETE14_OPS.length === 23 && BOARD3D_COMPLETE15_OPS.length === 24 && BOARD3D_COMPLETE16_OPS.length === 25 && BOARD3D_COMPLETE17_OPS.length === 26 && BOARD3D_COMPLETE18_OPS.length === 27 && BOARD3D_COMPLETE19_OPS.length === 28, 'COMPLETE10~COMPLETE19 长度逐项不变');
assert(BOARD3D_CYLINDER_OPS.length === 1 && BOARD3D_CYLINDER_OPS[0] === 'cylinder3d' && BOARD3D_COMPLETE20_OPS.length === 29, '新增 CYLINDER_OPS(1) 与 COMPLETE20(29)');
assert(BOARD3D_COMPLETE20_OPS.includes('cylinder3d') && BOARD3D_COMPLETE20_OPS.includes('cone3d') && BOARD3D_COMPLETE20_OPS.includes('vector3d'), 'COMPLETE20 含 cylinder3d 且保留 cone3d/vector3d');
assert(!BOARD3D_OPS.includes('cylinder3d') && !BOARD3D_ALL_OPS.includes('cylinder3d') && !BOARD3D_FULL_OPS.includes('cylinder3d'), 'cylinder3d 未污染任何历史契约常量');

section('十二、执行器集成');
{
  const added = [];
  const api = {
    add: (o) => { added.push(o); return true; },
    remove: () => true, update: () => true, getState: () => ({ objects: [] }),
  };
  const res = applyBoard3DCommands([{ op: 'cylinder3d', id: 'c', segments: 4, asPoints: true }], api);
  assert(res.length === 1 && res[0].op === 'cylinder3d' && res[0].ok === true, 'cylinder3d 执行成功');
  // 4 段 ×(底圈+顶圈+侧母线)=12 线；点=2 圆心+4 底圈+4 顶圈=10 → 共 22
  assert(added.length === 22 && res[0].count === 22, '逐项落地 22 个对象（12 线 + 10 点）');
  assert(res[0].created.length === 22 && res[0].meta.isRight === true, 'created 与 meta 回报完整');
}
{
  const res = applyBoard3DCommands([{ op: 'cylinder3d', radius: 0 }], { add: () => true, getState: () => ({}) });
  assert(res.length === 1 && res[0].ok === false && /radius/.test(res[0].error), '执行器层级拒绝非法参数');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'cylinder3d' }], api);
  assert(res[0].ok === true, 'getState 抛错降级为空场景，整批不中断');
}
{
  let i = 0;
  const api = { add: () => (++i === 2 ? false : true), getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cylinder3d', segments: 4 }], api);
  assert(res[0].ok === false && res[0].failed && res[0].failed.length === 1 && res[0].created.length === 11, 'api.add 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'cyl_b1' }] }) };
  const res = applyBoard3DCommands([{ op: 'cylinder3d', segments: 3 }], api);
  assert(res[0].ok === true && !res[0].failed, '执行器 id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cylinder', r: 1, h: 2 }], api);
  assert(res.length === 1 && res[0].ok === false && /不支持/.test(res[0].error), '2D/内置 cylinder 命令在 3D 分支被 default 拒绝');
}

section('十三、共享文件协议与 3D 意图检测');
assert(frozen(BOARD3D_CYLINDER_PROMPT_OPS) && BOARD3D_CYLINDER_PROMPT_OPS[0] === 'cylinder3d', 'board-prompt 新增 CYLINDER_PROMPT_OPS');
assert(BOARD3D_CYLINDER_PROMPT.includes('cylinder3d') && BOARD3D_CYLINDER_PROMPT.includes('斜圆柱'), 'board-prompt CYLINDER_PROMPT 含命令与斜圆柱说明');
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画一个圆柱') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十四、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolveCylinder3D \} from '\.\/board3d-cylinder\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'cylinder3d'/.test(exec), '执行器含 case cylinder3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_CYLINDER_PROMPT') && bp.includes('BOARD3D_CONE_PROMPT'), '共享文件含 CYLINDER_PROMPT 段且保留 CONE_PROMPT（纯追加）');
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_CYLINDER_PROMPT') && be.includes('BOARD3D_CONE_PROMPT') && be.includes('BOARD3D_VECTOR_PROMPT'), 'backend 拼接串含 cylinder 且保留 cone/vector');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('cylinder3d') && ai3.includes('cone3d'), 'AI 面板结果展示含 cylinder3d 且保留 cone3d');
  const html = read('board3d.html');
  assert(html.includes('cylinder3d') && html.includes('cone3d'), 'board3d.html AI tip 含 cylinder3d 且保留 cone3d');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D29') && doc.includes('cylinder3d'), '回归清单含 D29 记录');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（本任务早期已切换，未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在、大角 SDK 引用未删除');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  const hdr = read('board3d.html');
  assert(/importmap|three/.test(hdr), 'board3d.html 仍本地/自研 Three.js 引用');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

/**
 * 3D 旋转体命令（revolve3d · D19）无头回归。
 *
 * 覆盖：revolvePointAt / resolveRevolve3D 纯函数（母线绕轴旋转的参数方程数学：
 *       三轴坐标 / 圆柱·圆锥·圆台·球母线 / 经线与纬线圈 / 部分回转 / asPoints /
 *       覆盖率与段数上限 / id 避让 / 各类脏输入原子拒绝 / 深度只读性）、执行器集成
 *       （逐段落地为 line、可选 point、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_revolve.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_BEZIER_PROMPT,
  BOARD3D_ARC_PROMPT, BOARD3D_POLYHEDRON_PROMPT,
  BOARD3D_REVOLVE_PROMPT_OPS, BOARD3D_REVOLVE_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
  BOARD3D_ARC_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_POLYHEDRON_OPS, BOARD3D_COMPLETE9_OPS,
  BOARD3D_REVOLVE_OPS, BOARD3D_COMPLETE10_OPS,
} from '../js/board3d-executor.js';
import {
  REVOLVE3D_PROFILE_MIN, REVOLVE3D_PROFILE_MAX, REVOLVE3D_SEGMENTS_MIN,
  REVOLVE3D_SEGMENTS_MAX, REVOLVE3D_SEGMENTS_DEFAULT, REVOLVE3D_MAX_SEGMENTS,
  REVOLVE3D_AXES, REVOLVE3D_SWEEP_DEFAULT, revolvePointAt, resolveRevolve3D,
} from '../js/board3d-revolve.js';
import { readFileSync, existsSync } from 'node:fs';
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
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 1e-3) => a.length === 3 && a.every((x, i) => approx(x, b[i], eps));

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
assert(BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_POLYHEDRON_OPS[0] === 'polyhedron3d', 'POLYHEDRON_OPS = [polyhedron3d]');
assert(BOARD3D_COMPLETE9_OPS.length === 18 && BOARD3D_COMPLETE9_OPS.includes('polyhedron3d'), 'COMPLETE9 完整集 18 条含 polyhedron3d');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_REVOLVE_OPS[0] === 'revolve3d', 'REVOLVE_OPS = [revolve3d]');
assert(BOARD3D_COMPLETE10_OPS.length === 19 && BOARD3D_COMPLETE10_OPS.includes('revolve3d'), 'COMPLETE10 完整集 19 条含 revolve3d');
assert(BOARD3D_COMPLETE10_OPS.slice(0, 18).join(',') === BOARD3D_COMPLETE9_OPS.join(','), 'COMPLETE10 前 18 条与 COMPLETE9 逐项一致（纯追加）');
assert(REVOLVE3D_PROFILE_MIN === 2 && REVOLVE3D_PROFILE_MAX === 32, '母线点数区间 [2,32]');
assert(REVOLVE3D_SEGMENTS_MIN === 3 && REVOLVE3D_SEGMENTS_MAX === 64, '周向分段区间 [3,64]');
assert(REVOLVE3D_SEGMENTS_DEFAULT === 24 && REVOLVE3D_MAX_SEGMENTS === 1024, '默认分段 24 / 段数上限 1024');
assert(REVOLVE3D_AXES.join(',') === 'x,y,z' && REVOLVE3D_SWEEP_DEFAULT === 360, '轴白名单 x/y/z / 默认整圈 360');

section('B. revolvePointAt 参数方程数学（三轴 / 起止角 / 径向 / 轴向 / center）');
{
  const c = [0, 0, 0];
  // axis='y'（绕竖轴）：(r·cosθ, h, r·sinθ)
  assert(vecApprox(revolvePointAt([1, 2], 'y', 0, c), [1, 2, 0]), 'Y 轴 0°→(r,h,0)');
  assert(vecApprox(revolvePointAt([1, 2], 'y', 90, c), [0, 2, 1]), 'Y 轴 90°→(0,h,r)');
  assert(vecApprox(revolvePointAt([1, 2], 'y', 180, c), [-1, 2, 0]), 'Y 轴 180°→(-r,h,0)');
  assert(vecApprox(revolvePointAt([2, -3], 'y', 270, c), [0, -3, -2]), 'Y 轴 270°→(0,h,-r)');
  // axis='x'（绕横轴）：(h, r·cosθ, r·sinθ) —— 轴向分量 h 落在 x
  assert(vecApprox(revolvePointAt([1, 5], 'x', 0, c), [5, 1, 0]), 'X 轴 0°→(h,r,0)');
  assert(vecApprox(revolvePointAt([1, 5], 'x', 90, c), [5, 0, 1]), 'X 轴 90°→(h,0,r)');
  // axis='z'（绕进深轴）：(r·cosθ, r·sinθ, h)
  assert(vecApprox(revolvePointAt([1, 7], 'z', 0, c), [1, 0, 7]), 'Z 轴 0°→(r,0,h)');
  assert(vecApprox(revolvePointAt([1, 7], 'z', 90, c), [0, 1, 7]), 'Z 轴 90°→(0,r,h)');
  // center 平移
  assert(vecApprox(revolvePointAt([1, 2], 'y', 0, [10, 20, 30]), [11, 22, 30]), 'center 整体平移正确');
  // r=0 轴心：任意角度都落在轴线上（仅 h 变化）
  assert(vecApprox(revolvePointAt([0, 3], 'y', 0, c), [0, 3, 0]) && vecApprox(revolvePointAt([0, 3], 'y', 137, c), [0, 3, 0]), 'r=0 点恒落在旋转轴上');
  // 径向距离守恒：整圈采样到轴线的水平距离恒为 r
  const r = 2.5;
  for (let deg = 0; deg < 360; deg += 15) {
    const p = revolvePointAt([r, 4], 'y', deg, c);
    assert(approx(Math.hypot(p[0], p[2]), r, 1e-3), `Y 轴 ${deg}° 径向距离恒为 r`);
  }
  // 坐标钳制：超大 center / h
  const cl = revolvePointAt([1, 1], 'y', 0, [20000, -20000, 0]);
  assert(cl.every((x) => Math.abs(x) <= 10000), '超大坐标被钳制到 ±10000');
}

section('C. resolveRevolve3D 命令解析（圆柱 / 圆锥 / 圆台 / 球 / 经线纬线 / 样式 / id 避让）');
{
  // 圆柱：母线竖直两点，绕 y 轴，segments=8
  const cyl = resolveRevolve3D({ profile: [[1, -1], [1, 1]], axis: 'y', segments: 8 });
  assert(cyl.ok === true, '圆柱母线解析成功');
  assert(cyl.meta.profileCount === 2 && cyl.meta.rMin === 1 && cyl.meta.rMax === 1, '圆柱 meta 母线与半径正确');
  assert(cyl.meta.meridianCount === 8 && cyl.meta.ringCount === 2, '闭合整圈：8 条经线 + 2 个纬线圈');
  assert(cyl.meta.segmentCount === 8 * 1 + 2 * 8 && cyl.items.length === 24, '圆柱线段总数 = 经线8 + 纬线16 = 24');
  assert(cyl.items.every((o) => o.type === 'line'), '圆柱产出均为 line');
  const first = cyl.items[0];
  assert(Array.isArray(first.pos) && first.pos.join(',') === '0,0,0' && first.p.x1 !== undefined && first.p.z2 !== undefined, 'line 用绝对端点写 p、pos 保持原点');
}
{
  // 圆锥：顶点在轴上 r=0（h=1），底半径 1（h=0）
  const cone = resolveRevolve3D({ profile: [[0, 1], [1, 0]], axis: 'y', segments: 12 });
  assert(cone.ok === true && cone.meta.rMin === 0 && cone.meta.rMax === 1, '圆锥母线解析成功');
  assert(cone.meta.ringCount === 1, 'r=0 顶点不画纬线圈，仅底圆 1 个');
  assert(cone.meta.segmentCount === 12 * 1 + 1 * 12, '圆锥段数 = 经线12 + 底圆12');
}
{
  // 圆台：底半径1 顶半径0.5
  const frustum = resolveRevolve3D({ profile: [[1, -1], [0.5, 1]], axis: 'y', segments: 6 });
  assert(frustum.ok === true && approx(frustum.meta.rMin, 0.5) && approx(frustum.meta.rMax, 1), '圆台上下半径正确');
  assert(frustum.meta.ringCount === 2, '圆台画两个纬线圈');
}
{
  // 球面近似：半圆母线（r=cosφ, h=sinφ，φ 从 -90° 到 90°）
  const pts = [];
  for (let deg = -90; deg <= 90; deg += 30) {
    pts.push([Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)]);
  }
  const sph = resolveRevolve3D({ profile: pts, axis: 'y', segments: 8, asRings: false });
  assert(sph.ok === true && sph.meta.profileCount === 7, '球母线（7 点半圆）解析成功');
  assert(sph.meta.rMax === 1 && sph.meta.hMin === -1 && sph.meta.hMax === 1, '球母线 r≤1、h∈[-1,1]');
  assert(sph.meta.ringCount === 0 && sph.meta.meridianCount === 8, '关闭纬线圈后仅留经线');
}
{
  // 部分回转：sweep=180 非闭合，角度数 = segments+1
  const half = resolveRevolve3D({ profile: [[1, 0], [1, 1]], axis: 'y', segments: 8, sweep: 180 });
  assert(half.ok === true && half.meta.closed === false && half.meta.angleCount === 9, '半回转非闭合、角度数=segments+1');
  assert(half.meta.meridianCount === 9 && half.meta.sweep === 180, '半回转经线数=9、meta.sweep 正确');
  // sweep 负值反向
  const neg = resolveRevolve3D({ profile: [[1, 0], [1, 1]], segments: 8, sweep: -360 });
  assert(neg.ok === true && neg.meta.closed === true && neg.meta.sweep === -360, '负 sweep 反向且闭合判定用绝对值');
}
{
  // asPoints：母线点 × 采样角放球标记
  const withPts = resolveRevolve3D({ profile: [[1, 0], [1, 1]], segments: 8, asPoints: true });
  assert(withPts.ok === true && withPts.meta.pointCount === 8 * 2, 'asPoints 标记点数 = 角度数×母线点数');
  const points = withPts.items.filter((o) => o.type === 'point');
  assert(points.length === 16 && points.every((o) => Array.isArray(o.pos) && o.p && o.p.s > 0), '点标记 sphere 半径与 pos 正确');
}
{
  // 三轴默认 / 样式透传 / center
  const byAxis = ['x', 'y', 'z'].map((axis) => resolveRevolve3D({ profile: [[1, 0], [1, 1]], axis, segments: 4 }));
  assert(byAxis.every((r) => r.ok === true), '三轴旋转均解析成功');
  const styled = resolveRevolve3D({ profile: [[1, 0], [1, 1]], segments: 4, color: '#abc123', opacity: 0.4, center: [1, 2, 3] });
  assert(styled.meta.color === '#abc123' && styled.meta.opacity === 0.4, 'color / opacity 透传');
  assert(styled.meta.center.join(',') === '1,2,3', 'center 透传');
  // 数字字符串容错
  const str = resolveRevolve3D({ profile: [['1', '0'], ['1', '1']], segments: '8', sweep: '360' });
  assert(str.ok === true && str.meta.segments === 8 && str.meta.sweep === 360, '数字字符串容错（profile/segments/sweep）');
}
{
  // id 避让：state 已有同名 id
  const state = { objects: [{ id: 'rev_m1_s1' }, { id: 'rev_m1_s1_2' }] };
  const r = resolveRevolve3D({ id: 'rev', profile: [[1, 0], [1, 1]], segments: 4 }, state);
  assert(r.ok === true, '已有同名 id 仍解析成功');
  const ids = r.items.map((o) => o.id);
  assert(new Set(ids).size === ids.length, '生成的所有 id 互不相同');
  assert(!ids.includes('rev_m1_s1') && !ids.includes('rev_m1_s1_2'), '避让 state 中已有的 id');
}
{
  // id 边界：恰好 64 字符（isId 上限）解析成功、生成对象 id 仍 ≤64；超 64 拒绝（与 polyhedron 同口径）
  const id64 = 'R'.repeat(64);
  const r = resolveRevolve3D({ id: id64, profile: [[1, 0], [1, 1]], segments: 4 });
  assert(r.ok === true && r.items.every((o) => o.id.length <= 64), '64 字符 id 解析成功且生成对象 id ≤64');
  const r70 = resolveRevolve3D({ id: 'R'.repeat(70), profile: [[1, 0], [1, 1]], segments: 4 });
  assert(r70.ok === false, '超 64 字符 id 被拒绝（与 isId 上限一致）');
}
{
  // 三种开关全关被拒绝
  const none = resolveRevolve3D({ profile: [[1, 0], [1, 1]], asMeridians: false, asRings: false, asPoints: false });
  assert(none.ok === false, '经线/纬线/点全关整条拒绝');
}

section('D. 脏输入原子拒绝（零副作用）');
{
  const bad = [
    [{}, '空命令'],
    [null, 'null 命令'],
    [{ profile: undefined }, '缺 profile'],
    [{ profile: [] }, '空母线'],
    [{ profile: [[1, 0]] }, '母线仅 1 点'],
    [{ profile: Array.from({ length: 33 }, () => [1, 0]) }, '母线 33 点越界'],
    [{ profile: ['x', [1, 0]] }, '母线元素非数组'],
    [{ profile: [[1, 0, 0], [1, 1]] }, '母线点非二元组'],
    [{ profile: [[-1, 0], [1, 1]] }, 'r<0 拒绝'],
    [{ profile: [[NaN, 0], [1, 1]] }, 'r=NaN 拒绝'],
    [{ profile: [[1, Infinity], [1, 1]] }, 'h=Infinity 拒绝'],
    [{ profile: [[1, 0], ['abc', 1]] }, 'r 非数值字符串拒绝'],
    [{ profile: [[1, 0], [1, null]] }, 'h=null 拒绝'],
    [{ profile: [[1, 0], [1, 1]], axis: 'w' }, '非法 axis'],
    [{ profile: [[1, 0], [1, 1]], id: 'bad id!' }, '非法 id'],
    [{ profile: [[1, 0], [1, 1]], segments: 2 }, 'segments 低于下限'],
    [{ profile: [[1, 0], [1, 1]], segments: 65 }, 'segments 超上限'],
    [{ profile: [[1, 0], [1, 1]], segments: 8.5 }, 'segments 非整数'],
    [{ profile: [[1, 0], [1, 1]], segments: NaN }, 'segments=NaN'],
    [{ profile: [[1, 0], [1, 1]], sweep: 0 }, 'sweep=0'],
    [{ profile: [[1, 0], [1, 1]], sweep: 'abc' }, 'sweep 非数值'],
    [{ profile: [[1, 0], [1, 1]], startAngle: 'x' }, 'startAngle 非数值'],
    [{ profile: [[1, 0], [1, 1]], center: [1, 2] }, 'center 非三元组'],
    [{ profile: [[1, 0], [1, 1]], center: [1, null, 3] }, 'center 含非数值'],
    [{ profile: [[1, 0], [1, 1]], asPoints: 'yes' }, 'asPoints 非布尔'],
    [{ profile: [[1, 0], [1, 1]], asRings: 1 }, 'asRings 非布尔'],
    [{ profile: [[1, 0], [1, 1]], opacity: 'x' }, 'opacity 非数值'],
  ];
  for (const [cmd, label] of bad) {
    const r = resolveRevolve3D(cmd, { objects: [] });
    assert(r.ok === false, `拒绝：${label}`);
  }
  // 段数超上限：母线 32 点、segments 64 → 经线 64*31 + 纬线 32*64 = 4032 > 1024
  const huge = resolveRevolve3D({ profile: Array.from({ length: 32 }, (_, i) => [1, i]), segments: 64 });
  assert(huge.ok === false && /上限/.test(huge.error), '段数超上限整条拒绝');
}

section('E. 深度只读性（入参不被修改）');
{
  const cmd = Object.freeze({
    op: 'revolve3d', id: 'ro', axis: 'z',
    profile: Object.freeze([Object.freeze([1, 0]), Object.freeze([0.5, 1])]),
    center: Object.freeze([1, 2, 3]), segments: 6, sweep: 180, asPoints: true,
  });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_m1_s1' })]) });
  const r = resolveRevolve3D(cmd, state);
  assert(r.ok === true, '冻结入参仍可解析成功');
  assert(cmd.profile[0][0] === 1 && cmd.center[2] === 3 && state.objects.length === 1, '命令与 state 未被修改');
  r.items[0].p.x1 = 999;
  assert(cmd.profile[0][0] === 1, '改动输出不回流到入参');
}

section('F. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  // 圆柱 segments=4：经线 4 + 纬线 8 = 12 段
  const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 4 }], api());
  assert(r[0].ok === true && r[0].count === 12 && r[0].created.length === 12, '执行器逐段落地 12 段');
  assert(r[0].op === 'revolve3d' && r[0].meta && r[0].meta.rMax === 1, '执行器回执 op=revolve3d 且带 meta');
}
{
  // asPoints 执行器落地：圆柱 segments=3 → 经线3 + 纬线6 = 9 段 + 角度3×2点=6
  const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 3, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 15, 'asPoints 执行器落地 9 段 line + 6 点标记共 15 个对象');
}
{
  // 已有同名对象：id 避让全部成功
  const a = { getState: () => ({ objects: [{ id: 'rev_m1_s1' }, { id: 'rev_m1_s1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'revolve3d', id: 'rev', profile: [[1, 0], [1, 1]], segments: 4 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名段自动避让、全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 3 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 失败分项回报
  const a = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 3 }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 9, 'api.add 失败如实分项回报');
}
{
  // 2D 隔离：未知 2D/3D 命令仍拒绝
  const r = applyBoard3DCommands([{ op: 'revolve', profile: [[1, 0], [1, 1]] }], api());
  assert(r[0].ok === false, '2D revolve 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义的占位 3D 命令仍被 default 拒绝');
}
{
  // maxCommands
  const cmds = Array.from({ length: 4 }, () => ({ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 3 }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  // 脏参数在执行器内原子拒绝（零副作用）
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[-1, 0], [1, 1]] }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝脏参数且未调用 add（零副作用）');
}
{
  // api.add 返回 null 也视为失败分项（与 false 同口径）
  const a = { getState: () => ({ objects: [] }), add: () => null };
  const r = applyBoard3DCommands([{ op: 'revolve3d', profile: [[1, 0], [1, 1]], segments: 3 }], a);
  assert(r[0].ok === false && r[0].failed.length === 9, 'add 返回 null 如实分项回报失败');
}

section('G. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_REVOLVE_PROMPT_OPS.length === 1 && BOARD3D_REVOLVE_PROMPT_OPS[0] === 'revolve3d', '提示词侧 REVOLVE_PROMPT_OPS = [revolve3d]');
assert(BOARD3D_REVOLVE_PROMPT.includes('revolve3d') && BOARD3D_REVOLVE_PROMPT.includes('profile') && BOARD3D_REVOLVE_PROMPT.includes('segments'), 'REVOLVE 提示词含命令说明与核心参数');
assert(BOARD3D_REVOLVE_PROMPT.includes('axis') && BOARD3D_REVOLVE_PROMPT.includes('sweep') && BOARD3D_REVOLVE_PROMPT.includes('asMeridians'), 'REVOLVE 提示词含 axis/sweep/asMeridians');
assert(BOARD3D_REVOLVE_PROMPT.includes('圆柱') && BOARD3D_REVOLVE_PROMPT.includes('圆锥') && BOARD3D_REVOLVE_PROMPT.includes('圆台'), 'REVOLVE 提示词含常用母线示例');
assert(BOARD3D_HELIX_PROMPT.includes('helix3d') && BOARD3D_BEZIER_PROMPT.includes('bezier3d') && BOARD3D_ARC_PROMPT.includes('arc3d') && BOARD3D_POLYHEDRON_PROMPT.includes('polyhedron3d'), '既有 HELIX/BEZIER/ARC/POLYHEDRON 段仍在');
const iPoly = promptSrc.indexOf('export const BOARD3D_POLYHEDRON_PROMPT =');
const iAlignMulti = promptSrc.indexOf('export const BOARD3D_ALIGN_MULTI_PROMPT =');
const iRev = promptSrc.indexOf('export const BOARD3D_REVOLVE_PROMPT =');
assert(iPoly > 0 && iAlignMulti > iPoly && iRev > iAlignMulti, 'REVOLVE 追加段位于 POLYHEDRON/ALIGN_MULTI 之后（末尾追加，未插入/未替换）');
assert(promptSrc.indexOf('export const BOARD3D_REVOLVE_PROMPT_OPS') < iRev, 'REVOLVE_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个旋转体') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个旋转体') === '2d', '2D 模式路由不变');
assert(resolveBoardMode({}, '画一个圆') === '2d', '默认仍为 2D（3D 意图需显式开启）');

section('H. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
assert(page.includes('revolve3d') && page.includes('polyhedron3d') && page.includes('arc3d'), '页面 AI tip 新增 revolve3d 且保留 polyhedron3d/arc3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("rv.op !== 'revolve3d'") && aiPanel.includes("ph.op !== 'polyhedron3d'"), '前端新增旋转体展示且保留既有正多面体展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_REVOLVE_PROMPT') && backend.includes('BOARD3D_POLYHEDRON_PROMPT'), '后端 3D 拼接含 revolve 且保留 polyhedron');
const executor = read('js/board3d-executor.js');
assert(executor.includes("case 'revolve3d'") && executor.includes("case 'polyhedron3d'"), '执行器含 revolve3d 分支且保留 polyhedron3d');
assert(existsSync(join(ROOT, 'js/board3d-revolve.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

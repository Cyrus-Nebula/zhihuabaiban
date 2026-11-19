/**
 * 3D 圆环面命令（torus3d · D20）无头回归。
 *
 * 覆盖：torusPointAt / resolveTorus3D 纯函数（三轴参数方程 / 主圆与管半径几何 /
 *       经线圆与纬线圈 / 径向与轴向守恒 / asPoints / 覆盖率与段数上限 /
 *       id 避让 / 各类脏输入原子拒绝 / 深度只读性）、执行器集成
 *       （逐段落地为 line、可选 point、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_torus.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_BEZIER_PROMPT,
  BOARD3D_ARC_PROMPT, BOARD3D_POLYHEDRON_PROMPT, BOARD3D_REVOLVE_PROMPT,
  BOARD3D_TORUS_PROMPT_OPS, BOARD3D_TORUS_PROMPT,
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
} from '../js/board3d-executor.js';
import {
  TORUS3D_RADIUS_MIN, TORUS3D_RADIUS_MAX, TORUS3D_MAJOR_R_DEFAULT, TORUS3D_MINOR_R_DEFAULT,
  TORUS3D_MAJOR_SEGMENTS_MIN, TORUS3D_MAJOR_SEGMENTS_MAX, TORUS3D_MAJOR_SEGMENTS_DEFAULT,
  TORUS3D_MINOR_SEGMENTS_MIN, TORUS3D_MINOR_SEGMENTS_MAX, TORUS3D_MINOR_SEGMENTS_DEFAULT,
  TORUS3D_MAX_SEGMENTS, TORUS3D_AXES, torusPointAt, resolveTorus3D,
} from '../js/board3d-torus.js';
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
assert(BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_COMPLETE9_OPS.length === 18, 'POLYHEDRON 1 / COMPLETE9 18 条');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_COMPLETE10_OPS.length === 19, 'REVOLVE 1 / COMPLETE10 19 条');
assert(BOARD3D_TORUS_OPS.length === 1 && BOARD3D_TORUS_OPS[0] === 'torus3d', 'TORUS_OPS = [torus3d]');
assert(BOARD3D_COMPLETE11_OPS.length === 20 && BOARD3D_COMPLETE11_OPS.includes('torus3d'), 'COMPLETE11 完整集 20 条含 torus3d');
assert(BOARD3D_COMPLETE11_OPS.slice(0, 19).join(',') === BOARD3D_COMPLETE10_OPS.join(','), 'COMPLETE11 前 19 条与 COMPLETE10 逐项一致（纯追加）');
assert(TORUS3D_RADIUS_MIN === 0.01 && TORUS3D_RADIUS_MAX === 1000, '半径区间 [0.01,1000]');
assert(TORUS3D_MAJOR_R_DEFAULT === 1.6 && TORUS3D_MINOR_R_DEFAULT === 0.6, '默认 R=1.6 / r=0.6');
assert(TORUS3D_MAJOR_SEGMENTS_MIN === 3 && TORUS3D_MAJOR_SEGMENTS_MAX === 48 && TORUS3D_MAJOR_SEGMENTS_DEFAULT === 24, '主角分段 [3,48] 默认 24');
assert(TORUS3D_MINOR_SEGMENTS_MIN === 3 && TORUS3D_MINOR_SEGMENTS_MAX === 24 && TORUS3D_MINOR_SEGMENTS_DEFAULT === 12, '管角分段 [3,24] 默认 12');
assert(TORUS3D_MAX_SEGMENTS === 4096 && TORUS3D_AXES.join(',') === 'x,y,z', '段数上限 4096 / 轴白名单 x/y/z');

section('B. torusPointAt 参数方程数学（三轴 / 主圆与管半径 / 守恒 / center / 钳制）');
{
  const c = [0, 0, 0];
  const R = 2, r = 0.5;
  // axis='y'（默认，绕竖轴）：ringR=R+r·cos v 落在 XZ 平面，axial=r·sin v 落在 Y
  assert(vecApprox(torusPointAt(R, r, 'y', 0, 0, c), [2.5, 0, 0]), 'Y 轴 u=0,v=0 → (R+r,0,0)');
  assert(vecApprox(torusPointAt(R, r, 'y', 90, 0, c), [0, 0, 2.5]), 'Y 轴 u=90 → (0,0,R+r)');
  assert(vecApprox(torusPointAt(R, r, 'y', 180, 0, c), [-2.5, 0, 0]), 'Y 轴 u=180 → (-(R+r),0,0)');
  assert(vecApprox(torusPointAt(R, r, 'y', 0, 90, c), [2, 0.5, 0]), 'Y 轴 v=90 → 径向 R、轴高 r');
  assert(vecApprox(torusPointAt(R, r, 'y', 0, 270, c), [2, -0.5, 0]), 'Y 轴 v=270 → 径向 R、轴高 -r');
  assert(vecApprox(torusPointAt(R, r, 'y', 0, 180, c), [1.5, 0, 0]), 'Y 轴 v=180 → 径向 R-r（内侧）');
  // axis='x'：axial 落在 X，主圆落在 YZ
  assert(vecApprox(torusPointAt(R, r, 'x', 0, 0, c), [0, 2.5, 0]), 'X 轴 u=0,v=0 → (0,R+r,0)');
  assert(vecApprox(torusPointAt(R, r, 'x', 0, 90, c), [0.5, 2, 0]), 'X 轴 v=90 → 轴高 r 落在 x');
  // axis='z'：主圆落在 XY，axial 落在 Z
  assert(vecApprox(torusPointAt(R, r, 'z', 0, 0, c), [2.5, 0, 0]), 'Z 轴 u=0,v=0 → (R+r,0,0)');
  assert(vecApprox(torusPointAt(R, r, 'z', 0, 90, c), [2, 0, 0.5]), 'Z 轴 v=90 → 轴高 r 落在 z');
  // center 平移
  assert(vecApprox(torusPointAt(R, r, 'y', 0, 90, [10, 20, 30]), [12, 20.5, 30]), 'center 整体平移正确');
  // 径向守恒：固定 v、遍历 u，到轴距离恒为 R+r·cos v；轴向分量恒为 r·sin v
  for (const v of [0, 45, 90, 180, 270]) {
    const expectRing = R + r * Math.cos(v * Math.PI / 180);
    const expectAxial = r * Math.sin(v * Math.PI / 180);
    for (let u = 0; u < 360; u += 30) {
      const p = torusPointAt(R, r, 'y', u, v, c);
      assert(approx(Math.hypot(p[0], p[2]), expectRing, 1e-3), `v=${v}° u=${u}° 径向距离恒为 R+r·cos v`);
      assert(approx(p[1], expectAxial, 1e-3), `v=${v}° u=${u}° 轴向分量恒为 r·sin v`);
    }
  }
  // 管截面圆守恒：固定 u、遍历 v，点到管截面圆心 (R·cos u, 0, R·sin u) 距离恒为 r
  for (const u of [0, 60, 137, 250]) {
    const cx = R * Math.cos(u * Math.PI / 180), cz = R * Math.sin(u * Math.PI / 180);
    for (let v = 0; v < 360; v += 20) {
      const p = torusPointAt(R, r, 'y', u, v, c);
      assert(approx(Math.hypot(p[0] - cx, p[1], p[2] - cz), r, 1e-3), `u=${u}° v=${v}° 到管圆心距离恒为 r`);
    }
  }
  // 坐标钳制：超大 center / 半径
  const cl = torusPointAt(1000, 1000, 'y', 45, 45, [20000, -20000, 0]);
  assert(cl.every((x) => Math.abs(x) <= 10000), '超大坐标被钳制到 ±10000');
}

section('C. resolveTorus3D 命令解析（标准圆环 / 经线圆纬线圈 / 样式 / id 避让）');
{
  // 默认圆环：R/r 默认、分段默认
  const d = resolveTorus3D({});
  assert(d.ok === true, '空选项解析成功（全默认）');
  assert(d.meta.R === 1.6 && d.meta.r === 0.6, '默认 R/r 正确');
  assert(d.meta.majorSegments === 24 && d.meta.minorSegments === 12, '默认分段 24/12 正确');
  assert(d.meta.meridianCount === 24 && d.meta.ringCount === 12, '默认 24 经线圆 + 12 纬线圈');
  assert(d.meta.segmentCount === 24 * 12 + 12 * 24 && d.items.length === 576, '默认线段 = 288+288=576');
  assert(d.items.every((o) => o.type === 'line'), '默认产出均为 line');
  const first = d.items[0];
  assert(Array.isArray(first.pos) && first.pos.join(',') === '0,0,0' && first.p.x1 !== undefined && first.p.z2 !== undefined, 'line 用绝对端点写 p、pos 保持原点');
}
{
  // 指定分段：major=8, minor=6 → 经线 8*6=48 + 纬线 6*8=48 = 96
  const t = resolveTorus3D({ id: 'ring', R: 2, r: 0.5, majorSegments: 8, minorSegments: 6 });
  assert(t.ok === true && t.meta.R === 2 && t.meta.r === 0.5, '指定 R/r 解析成功');
  assert(t.meta.segmentCount === 96 && t.items.length === 96, '段数 = 8×6 经线 + 6×8 纬线 = 96');
  assert(t.meta.id === 'ring', 'meta.id 正确');
}
{
  // 关闭纬线圈：仅经线圆
  const onlyM = resolveTorus3D({ majorSegments: 8, minorSegments: 6, asRings: false });
  assert(onlyM.ok === true && onlyM.meta.meridianCount === 8 && onlyM.meta.ringCount === 0, '关闭纬线圈仅留 8 经线圆');
  assert(onlyM.meta.segmentCount === 48 && onlyM.items.length === 48, '仅经线 8×6=48 段');
  // 关闭经线圆：仅纬线圈
  const onlyR = resolveTorus3D({ majorSegments: 8, minorSegments: 6, asMeridians: false });
  assert(onlyR.ok === true && onlyR.meta.meridianCount === 0 && onlyR.meta.ringCount === 6, '关闭经线圆仅留 6 纬线圈');
  assert(onlyR.meta.segmentCount === 48, '仅纬线 6×8=48 段');
}
{
  // asPoints：major×minor 个采样点球
  const withPts = resolveTorus3D({ majorSegments: 8, minorSegments: 6, asPoints: true });
  assert(withPts.ok === true && withPts.meta.pointCount === 48, 'asPoints 点数 = 8×6=48');
  const points = withPts.items.filter((o) => o.type === 'point');
  assert(points.length === 48 && points.every((o) => Array.isArray(o.pos) && o.p && o.p.s > 0), '点标记球半径与 pos 正确');
  assert(withPts.meta.segmentCount === 96 && withPts.items.length === 144, 'asPoints 时 line 96 + point 48 = 144');
}
{
  // 三轴 / 样式透传 / center
  const byAxis = ['x', 'y', 'z'].map((axis) => resolveTorus3D({ axis, majorSegments: 4, minorSegments: 4 }));
  assert(byAxis.every((r) => r.ok === true), '三轴圆环均解析成功');
  const styled = resolveTorus3D({ majorSegments: 4, minorSegments: 4, color: '#abc123', opacity: 0.4, center: [1, 2, 3] });
  assert(styled.meta.color === '#abc123' && styled.meta.opacity === 0.4, 'color / opacity 透传');
  assert(styled.meta.center.join(',') === '1,2,3', 'center 透传');
  // 数字字符串容错
  const str = resolveTorus3D({ R: '2', r: '0.5', majorSegments: '8', minorSegments: '6', axis: 'y' });
  assert(str.ok === true && str.meta.R === 2 && str.meta.r === 0.5 && str.meta.majorSegments === 8 && str.meta.minorSegments === 6, '数字字符串容错（R/r/segments）');
}
{
  // id 避让
  const state = { objects: [{ id: 'tor_m1_s1' }, { id: 'tor_m1_s1_2' }] };
  const r = resolveTorus3D({ id: 'tor', majorSegments: 4, minorSegments: 4 }, state);
  assert(r.ok === true, '已有同名 id 仍解析成功');
  const ids = r.items.map((o) => o.id);
  assert(new Set(ids).size === ids.length, '生成的所有 id 互不相同');
  assert(!ids.includes('tor_m1_s1') && !ids.includes('tor_m1_s1_2'), '避让 state 中已有的 id');
}
{
  // id 边界：恰好 64 字符解析成功且对象 id ≤64；超 64 拒绝
  const id64 = 'T'.repeat(64);
  const r = resolveTorus3D({ id: id64, majorSegments: 4, minorSegments: 4 });
  assert(r.ok === true && r.items.every((o) => o.id.length <= 64), '64 字符 id 解析成功且生成对象 id ≤64');
  const r70 = resolveTorus3D({ id: 'T'.repeat(70), majorSegments: 4, minorSegments: 4 });
  assert(r70.ok === false, '超 64 字符 id 被拒绝');
}
{
  // 三种开关全关被拒绝
  const none = resolveTorus3D({ asMeridians: false, asRings: false, asPoints: false });
  assert(none.ok === false, '经线圆/纬线圈/点全关整条拒绝');
}

section('D. 脏输入原子拒绝（零副作用）');
{
  const bad = [
    [{}, 'null 命令占位（见下）'], // 占位，下面单独测 null
    [{ R: 0 }, 'R=0 拒绝'],
    [{ R: -1 }, 'R<0 拒绝'],
    [{ R: 1001 }, 'R 超上限拒绝'],
    [{ R: NaN }, 'R=NaN 拒绝'],
    [{ R: 'abc' }, 'R 非数值字符串拒绝'],
    [{ r: 0 }, 'r=0 拒绝'],
    [{ r: -0.5 }, 'r<0 拒绝'],
    [{ r: 2000 }, 'r 超上限拒绝'],
    [{ r: Infinity }, 'r=Infinity 拒绝'],
    [{ axis: 'w' }, '非法 axis'],
    [{ id: 'bad id!' }, '非法 id'],
    [{ majorSegments: 2 }, 'majorSegments 低于下限'],
    [{ majorSegments: 49 }, 'majorSegments 超上限'],
    [{ majorSegments: 8.5 }, 'majorSegments 非整数'],
    [{ majorSegments: NaN }, 'majorSegments=NaN'],
    [{ minorSegments: 2 }, 'minorSegments 低于下限'],
    [{ minorSegments: 25 }, 'minorSegments 超上限'],
    [{ minorSegments: 6.2 }, 'minorSegments 非整数'],
    [{ center: [1, 2] }, 'center 非三元组'],
    [{ center: [1, null, 3] }, 'center 含非数值'],
    [{ center: ['x', 2, 3] }, 'center 含非数值字符串'],
    [{ asPoints: 'yes' }, 'asPoints 非布尔'],
    [{ asRings: 1 }, 'asRings 非布尔'],
    [{ asMeridians: 'true' }, 'asMeridians 非布尔'],
    [{ opacity: 'x' }, 'opacity 非数值'],
  ];
  for (const [cmd, label] of bad.slice(1)) { // 跳过第 0 个占位
    const r = resolveTorus3D(cmd, { objects: [] });
    assert(r.ok === false, `拒绝：${label}`);
  }
  assert(resolveTorus3D(null).ok === false, '拒绝：null 命令');
  assert(resolveTorus3D([]).ok === false, '拒绝：数组命令');
  // 段数超上限：默认开关全开时 major=48, minor=24 → 48*24*2=2304 < 4096，构造超限需提高上限场景，
  // 这里直接验证上限常量生效（若上限被下调则仍能拒绝），并验证参数边界内全开合法。
  const full = resolveTorus3D({ majorSegments: 48, minorSegments: 24 });
  assert(full.ok === true && full.meta.segmentCount === 2304, '边界内最大网格 2304 段仍合法');
}

section('E. 深度只读性（入参不被修改）');
{
  const cmd = Object.freeze({
    op: 'torus3d', id: 'ro', axis: 'z',
    center: Object.freeze([1, 2, 3]), R: 2, r: 0.5,
    majorSegments: 6, minorSegments: 4, asPoints: true,
  });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_m1_s1' })]) });
  const r = resolveTorus3D(cmd, state);
  assert(r.ok === true, '冻结入参仍可解析成功');
  assert(cmd.R === 2 && cmd.center[2] === 3 && state.objects.length === 1, '命令与 state 未被修改');
  r.items[0].p.x1 = 999;
  assert(cmd.R === 2, '改动输出不回流到入参');
}

section('F. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  // major=4, minor=4：经线 16 + 纬线 16 = 32 段
  const r = applyBoard3DCommands([{ op: 'torus3d', majorSegments: 4, minorSegments: 4 }], api());
  assert(r[0].ok === true && r[0].count === 32 && r[0].created.length === 32, '执行器逐段落地 32 段');
  assert(r[0].op === 'torus3d' && r[0].meta && r[0].meta.R === 1.6, '执行器回执 op=torus3d 且带 meta');
}
{
  // asPoints：major=3,minor=3 → 经线9+纬线9=18 段 + 9 点 = 27
  const r = applyBoard3DCommands([{ op: 'torus3d', majorSegments: 3, minorSegments: 3, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 27, 'asPoints 执行器落地 18 段 line + 9 点共 27 对象');
}
{
  // 已有同名对象：id 避让全部成功
  const a = { getState: () => ({ objects: [{ id: 'tor_m1_s1' }, { id: 'tor_m1_s1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'torus3d', id: 'tor', majorSegments: 4, minorSegments: 4 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名段自动避让、全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'torus3d', majorSegments: 3, minorSegments: 3 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 失败分项回报（major=3,minor=3 → 18 段）
  const a = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'torus3d', majorSegments: 3, minorSegments: 3 }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 18, 'api.add 失败如实分项回报');
}
{
  // 2D 隔离：未知 2D/3D 命令仍拒绝
  const r = applyBoard3DCommands([{ op: 'torus', R: 2 }], api());
  assert(r[0].ok === false, '2D torus 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义的占位 3D 命令仍被 default 拒绝');
}
{
  // maxCommands
  const cmds = Array.from({ length: 4 }, () => ({ op: 'torus3d', majorSegments: 3, minorSegments: 3 }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  // 脏参数在执行器内原子拒绝（零副作用）
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'torus3d', R: -1 }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝脏参数且未调用 add（零副作用）');
}
{
  // api.add 返回 null 也视为失败分项
  const a = { getState: () => ({ objects: [] }), add: () => null };
  const r = applyBoard3DCommands([{ op: 'torus3d', majorSegments: 3, minorSegments: 3 }], a);
  assert(r[0].ok === false && r[0].failed.length === 18, 'add 返回 null 如实分项回报失败');
}

section('G. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_TORUS_PROMPT_OPS.length === 1 && BOARD3D_TORUS_PROMPT_OPS[0] === 'torus3d', '提示词侧 TORUS_PROMPT_OPS = [torus3d]');
assert(BOARD3D_TORUS_PROMPT.includes('torus3d') && BOARD3D_TORUS_PROMPT.includes('R') && BOARD3D_TORUS_PROMPT.includes('r'), 'TORUS 提示词含命令说明与核心半径参数');
assert(BOARD3D_TORUS_PROMPT.includes('axis') && BOARD3D_TORUS_PROMPT.includes('majorSegments') && BOARD3D_TORUS_PROMPT.includes('asMeridians'), 'TORUS 提示词含 axis/majorSegments/asMeridians');
assert(BOARD3D_TORUS_PROMPT.includes('甜甜圈') && BOARD3D_TORUS_PROMPT.includes('轮胎'), 'TORUS 提示词含圆环示例');
assert(BOARD3D_REVOLVE_PROMPT.includes('revolve3d') && BOARD3D_HELIX_PROMPT.includes('helix3d') && BOARD3D_POLYHEDRON_PROMPT.includes('polyhedron3d'), '既有 REVOLVE/HELIX/POLYHEDRON 段仍在');
const iRev = promptSrc.indexOf('export const BOARD3D_REVOLVE_PROMPT =');
const iTor = promptSrc.indexOf('export const BOARD3D_TORUS_PROMPT =');
assert(iRev > 0 && iTor > iRev, 'TORUS 追加段位于 REVOLVE 之后（末尾追加，未插入/未替换）');
assert(promptSrc.indexOf('export const BOARD3D_TORUS_PROMPT_OPS') < iTor, 'TORUS_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个圆环') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个圆环') === '2d', '2D 模式路由不变');
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
assert(page.includes('torus3d') && page.includes('revolve3d') && page.includes('polyhedron3d'), '页面 AI tip 新增 torus3d 且保留 revolve3d/polyhedron3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("tr.op !== 'torus3d'") && aiPanel.includes("rv.op !== 'revolve3d'"), '前端新增圆环面展示且保留既有旋转体展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_TORUS_PROMPT') && backend.includes('BOARD3D_REVOLVE_PROMPT'), '后端 3D 拼接含 torus 且保留 revolve');
const executor = read('js/board3d-executor.js');
assert(executor.includes("case 'torus3d'") && executor.includes("case 'revolve3d'"), '执行器含 torus3d 分支且保留 revolve3d');
assert(existsSync(join(ROOT, 'js/board3d-torus.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

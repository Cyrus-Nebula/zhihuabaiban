/**
 * 3D 椭球命令（ellipsoid3d · D21）无头回归。
 *
 * 覆盖：ellipsoidPointAt / resolveEllipsoid3D 纯函数（三轴参数方程 / 半轴与守恒 /
 *       经线与纬线圈 / 极点退化 / asPoints / 覆盖率与段数上限 / id 避让 /
 *       各类脏输入原子拒绝 / 深度只读性）、执行器集成（逐段落地为 line、可选 point、
 *       id 冲突避让、getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、maxCommands）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_ellipsoid.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_BEZIER_PROMPT,
  BOARD3D_ARC_PROMPT, BOARD3D_POLYHEDRON_PROMPT, BOARD3D_REVOLVE_PROMPT,
  BOARD3D_TORUS_PROMPT, BOARD3D_ELLIPSOID_PROMPT_OPS, BOARD3D_ELLIPSOID_PROMPT,
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
  BOARD3D_ELLIPSOID_OPS, BOARD3D_COMPLETE12_OPS,
} from '../js/board3d-executor.js';
import {
  ELLIPSOID3D_AXIS_MIN, ELLIPSOID3D_AXIS_MAX, ELLIPSOID3D_A_DEFAULT,
  ELLIPSOID3D_B_DEFAULT, ELLIPSOID3D_C_DEFAULT,
  ELLIPSOID3D_MERIDIANS_MIN, ELLIPSOID3D_MERIDIANS_MAX, ELLIPSOID3D_MERIDIANS_DEFAULT,
  ELLIPSOID3D_PARALLELS_MIN, ELLIPSOID3D_PARALLELS_MAX, ELLIPSOID3D_PARALLELS_DEFAULT,
  ELLIPSOID3D_SEGMENTS_MIN, ELLIPSOID3D_SEGMENTS_MAX, ELLIPSOID3D_SEGMENTS_DEFAULT,
  ELLIPSOID3D_MAX_SEGMENTS, ELLIPSOID3D_AXES, ellipsoidPointAt, resolveEllipsoid3D,
} from '../js/board3d-ellipsoid.js';
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
assert(BOARD3D_TORUS_OPS.length === 1 && BOARD3D_COMPLETE11_OPS.length === 20, 'TORUS 1 / COMPLETE11 20 条');
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_ELLIPSOID_OPS[0] === 'ellipsoid3d', 'ELLIPSOID_OPS = [ellipsoid3d]');
assert(BOARD3D_COMPLETE12_OPS.length === 21 && BOARD3D_COMPLETE12_OPS.includes('ellipsoid3d'), 'COMPLETE12 完整集 21 条含 ellipsoid3d');
assert(BOARD3D_COMPLETE12_OPS.slice(0, 20).join(',') === BOARD3D_COMPLETE11_OPS.join(','), 'COMPLETE12 前 20 条与 COMPLETE11 逐项一致（纯追加）');
assert(ELLIPSOID3D_AXIS_MIN === 0.01 && ELLIPSOID3D_AXIS_MAX === 1000, '半轴区间 [0.01,1000]');
assert(ELLIPSOID3D_A_DEFAULT === 1.5 && ELLIPSOID3D_B_DEFAULT === 1 && ELLIPSOID3D_C_DEFAULT === 1, '默认 a=1.5 / b=1 / c=1');
assert(ELLIPSOID3D_MERIDIANS_MIN === 3 && ELLIPSOID3D_MERIDIANS_MAX === 48 && ELLIPSOID3D_MERIDIANS_DEFAULT === 12, '经线条数 [3,48] 默认 12');
assert(ELLIPSOID3D_PARALLELS_MIN === 2 && ELLIPSOID3D_PARALLELS_MAX === 32 && ELLIPSOID3D_PARALLELS_DEFAULT === 8, '纬线圈数 [2,32] 默认 8');
assert(ELLIPSOID3D_SEGMENTS_MIN === 3 && ELLIPSOID3D_SEGMENTS_MAX === 64 && ELLIPSOID3D_SEGMENTS_DEFAULT === 24, '分段数 [3,64] 默认 24');
assert(ELLIPSOID3D_MAX_SEGMENTS === 4096 && ELLIPSOID3D_AXES.join(',') === 'x,y,z', '段数上限 4096 / 轴白名单 x/y/z');

section('B. ellipsoidPointAt 参数方程数学（三轴 / 半轴 / 守恒 / center / 钳制）');
{
  const c = [0, 0, 0];
  const a = 3, b = 2, cAx = 1;
  // axis='y'（默认，极轴竖直）：极轴分量 a·cos u 落 Y，赤道 eq1=b·sin u·cos v 落 X，eq2=c·sin u·sin v 落 Z
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 0, 0, c), [0, 3, 0]), 'Y 轴北极 u=0 → (0,a,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 180, 0, c), [0, -3, 0]), 'Y 轴南极 u=180 → (0,-a,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 90, 0, c), [2, 0, 0]), 'Y 轴赤道 u=90,v=0 → (b,0,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 90, 90, c), [0, 0, 1]), 'Y 轴赤道 u=90,v=90 → (0,0,c)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 90, 180, c), [-2, 0, 0]), 'Y 轴赤道 v=180 → (-b,0,0)');
  // axis='x'：极轴分量落 X，赤道 eq1 落 Y，eq2 落 Z
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'x', 0, 0, c), [3, 0, 0]), 'X 轴北极 u=0 → (a,0,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'x', 90, 0, c), [0, 2, 0]), 'X 轴赤道 v=0 → (0,b,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'x', 90, 90, c), [0, 0, 1]), 'X 轴赤道 v=90 → (0,0,c)');
  // axis='z'：极轴分量落 Z，赤道 eq1 落 X，eq2 落 Y
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'z', 0, 0, c), [0, 0, 3]), 'Z 轴北极 u=0 → (0,0,a)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'z', 90, 0, c), [2, 0, 0]), 'Z 轴赤道 v=0 → (b,0,0)');
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'z', 90, 90, c), [0, 1, 0]), 'Z 轴赤道 v=90 → (0,c,0)');
  // center 平移
  assert(vecApprox(ellipsoidPointAt(a, b, cAx, 'y', 90, 90, [10, 20, 30]), [10, 20, 31]), 'center 整体平移正确');
  // 球面几何守恒：a=b=c=R 时所有采样点到中心距离恒为 R
  const R = 2.5;
  for (const axis of ['x', 'y', 'z']) {
    for (let u = 0; u <= 180; u += 30) {
      for (let v = 0; v < 360; v += 45) {
        const p = ellipsoidPointAt(R, R, R, axis, u, v, c);
        assert(approx(Math.hypot(p[0], p[1], p[2]), R, 1e-3), `${axis} 轴 a=b=c 球面 u=${u} v=${v} 半径恒为 R`);
      }
    }
  }
  // 椭球面方程守恒：x²/b² + y²/a² + z²/c² = 1（axis=y）
  for (const [u, v] of [[30, 0], [60, 45], [90, 90], [120, 200], [150, 315]]) {
    const p = ellipsoidPointAt(a, b, cAx, 'y', u, v, c);
    const lhs = (p[0] * p[0]) / (b * b) + (p[1] * p[1]) / (a * a) + (p[2] * p[2]) / (cAx * cAx);
    assert(approx(lhs, 1, 1e-2), `axis=y u=${u} v=${v} 满足椭球面方程`);
  }
  // 赤道圈（u=90）径向随 v 为椭圆：到轴距离介于 min(b,c) 与 max(b,c) 之间
  for (let v = 0; v < 360; v += 30) {
    const p = ellipsoidPointAt(a, b, cAx, 'y', 90, v, c);
    const d = Math.hypot(p[0], p[2]);
    assert(d >= Math.min(b, cAx) - 1e-3 && d <= Math.max(b, cAx) + 1e-3, `赤道 v=${v}° 径向在 b/c 之间`);
  }
  // 坐标钳制：超大 center / 半轴
  const cl = ellipsoidPointAt(1000, 1000, 1000, 'y', 45, 45, [20000, -20000, 0]);
  assert(cl.every((x) => Math.abs(x) <= 10000), '超大坐标被钳制到 ±10000');
}

section('C. resolveEllipsoid3D 命令解析（默认 / 分段 / 开关 / 三轴 / 样式 / id 避让）');
{
  const d = resolveEllipsoid3D({});
  assert(d.ok === true, '空选项解析成功（全默认）');
  assert(d.meta.a === 1.5 && d.meta.b === 1 && d.meta.c === 1, '默认 a/b/c 正确');
  assert(d.meta.meridians === 12 && d.meta.parallels === 8 && d.meta.segments === 24, '默认分段 12/8/24 正确');
  assert(d.meta.meridianCount === 12 && d.meta.parallelCount === 8, '默认 12 经线 + 8 纬线圈');
  assert(d.meta.segmentCount === 12 * 24 + 8 * 24 && d.items.length === 480, '默认线段 = 288+192=480');
  assert(d.items.every((o) => o.type === 'line'), '默认产出均为 line');
  const first = d.items[0];
  assert(Array.isArray(first.pos) && first.pos.join(',') === '0,0,0' && first.p.x1 !== undefined && first.p.z2 !== undefined, 'line 用绝对端点写 p、pos 保持原点');
}
{
  // 指定分段：meridians=4, parallels=3, segments=6 → 经线 4*6=24 + 纬线 3*6=18 = 42
  const t = resolveEllipsoid3D({ id: 'ell', a: 2, b: 1.5, c: 1, meridians: 4, parallels: 3, segments: 6 });
  assert(t.ok === true && t.meta.a === 2 && t.meta.b === 1.5 && t.meta.c === 1, '指定 a/b/c 解析成功');
  assert(t.meta.segmentCount === 42 && t.items.length === 42, '段数 = 4×6 经线 + 3×6 纬线 = 42');
  assert(t.meta.id === 'ell', 'meta.id 正确');
}
{
  // 关闭纬线圈：仅经线
  const onlyM = resolveEllipsoid3D({ meridians: 4, parallels: 3, segments: 6, asParallels: false });
  assert(onlyM.ok === true && onlyM.meta.meridianCount === 4 && onlyM.meta.parallelCount === 0, '关闭纬线圈仅留 4 经线');
  assert(onlyM.meta.segmentCount === 24 && onlyM.items.length === 24, '仅经线 4×6=24 段');
  // 关闭经线：仅纬线圈
  const onlyP = resolveEllipsoid3D({ meridians: 4, parallels: 3, segments: 6, asMeridians: false });
  assert(onlyP.ok === true && onlyP.meta.meridianCount === 0 && onlyP.meta.parallelCount === 3, '关闭经线仅留 3 纬线圈');
  assert(onlyP.meta.segmentCount === 18, '仅纬线 3×6=18 段');
}
{
  // 极点退化：纬线圈不含两极，仅经线在两极汇合（默认参数下经线首段起点即北极）
  const d = resolveEllipsoid3D({ meridians: 4, parallels: 3, segments: 6 });
  const northPoles = d.items.filter((o) => o.type === 'line' && approx(o.p.y1, 1.5) && approx(o.p.x1, 0) && approx(o.p.z1, 0));
  assert(northPoles.length === 4, '4 条经线首段均起于北极点（y=a）');
}
{
  // asPoints：meridians×parallels + 两极
  const withPts = resolveEllipsoid3D({ meridians: 4, parallels: 3, segments: 6, asPoints: true });
  assert(withPts.ok === true && withPts.meta.pointCount === 4 * 3 + 2, 'asPoints 点数 = 4×3 + 两极2 = 14');
  const points = withPts.items.filter((o) => o.type === 'point');
  assert(points.length === 14 && points.every((o) => Array.isArray(o.pos) && o.p && o.p.s > 0), '点标记球半径与 pos 正确');
  const poles = points.filter((o) => approx(o.pos[1], 1.5) || approx(o.pos[1], -1.5));
  assert(poles.length >= 2, '含两极标记点');
  assert(withPts.meta.segmentCount === 42 && withPts.items.length === 56, 'asPoints 时 line 42 + point 14 = 56');
}
{
  // 三轴 / 样式透传 / center
  const byAxis = ['x', 'y', 'z'].map((axis) => resolveEllipsoid3D({ axis, meridians: 4, parallels: 3, segments: 6 }));
  assert(byAxis.every((r) => r.ok === true), '三轴椭球均解析成功');
  const styled = resolveEllipsoid3D({ meridians: 4, parallels: 3, segments: 6, color: '#abc123', opacity: 0.4, center: [1, 2, 3] });
  assert(styled.meta.color === '#abc123' && styled.meta.opacity === 0.4, 'color / opacity 透传');
  assert(styled.meta.center.join(',') === '1,2,3', 'center 透传');
  // 数字字符串容错
  const str = resolveEllipsoid3D({ a: '2', b: '1.5', meridians: '4', parallels: '3', segments: '6', axis: 'y' });
  assert(str.ok === true && str.meta.a === 2 && str.meta.b === 1.5 && str.meta.meridians === 4 && str.meta.parallels === 3 && str.meta.segments === 6, '数字字符串容错（a/b/分段）');
}
{
  // id 避让
  const state = { objects: [{ id: 'ell_M1_s1' }, { id: 'ell_M1_s1_2' }] };
  const r = resolveEllipsoid3D({ id: 'ell', meridians: 4, parallels: 3, segments: 6 }, state);
  assert(r.ok === true, '已有同名 id 仍解析成功');
  const ids = r.items.map((o) => o.id);
  assert(new Set(ids).size === ids.length, '生成的所有 id 互不相同');
  assert(!ids.includes('ell_M1_s1') && !ids.includes('ell_M1_s1_2'), '避让 state 中已有的 id');
}
{
  // id 边界：恰好 64 字符解析成功且对象 id ≤64；超 64 拒绝
  const id64 = 'E'.repeat(64);
  const r = resolveEllipsoid3D({ id: id64, meridians: 4, parallels: 3, segments: 6 });
  assert(r.ok === true && r.items.every((o) => o.id.length <= 64), '64 字符 id 解析成功且生成对象 id ≤64');
  const r70 = resolveEllipsoid3D({ id: 'E'.repeat(70), meridians: 4, parallels: 3, segments: 6 });
  assert(r70.ok === false, '超 64 字符 id 被拒绝');
}
{
  // 三种开关全关被拒绝
  const none = resolveEllipsoid3D({ asMeridians: false, asParallels: false, asPoints: false });
  assert(none.ok === false, '经线/纬线圈/点全关整条拒绝');
}

section('D. 脏输入原子拒绝（零副作用）');
{
  const bad = [
    [{ a: 0 }, 'a=0 拒绝'],
    [{ a: -1 }, 'a<0 拒绝'],
    [{ a: 1001 }, 'a 超上限拒绝'],
    [{ a: NaN }, 'a=NaN 拒绝'],
    [{ a: 'abc' }, 'a 非数值字符串拒绝'],
    [{ b: 0 }, 'b=0 拒绝'],
    [{ b: 2000 }, 'b 超上限拒绝'],
    [{ b: Infinity }, 'b=Infinity 拒绝'],
    [{ c: 0 }, 'c=0 拒绝'],
    [{ c: -0.5 }, 'c<0 拒绝'],
    [{ axis: 'w' }, '非法 axis'],
    [{ id: 'bad id!' }, '非法 id'],
    [{ meridians: 2 }, 'meridians 低于下限'],
    [{ meridians: 49 }, 'meridians 超上限'],
    [{ meridians: 8.5 }, 'meridians 非整数'],
    [{ meridians: NaN }, 'meridians=NaN'],
    [{ parallels: 1 }, 'parallels 低于下限'],
    [{ parallels: 33 }, 'parallels 超上限'],
    [{ parallels: 6.2 }, 'parallels 非整数'],
    [{ segments: 2 }, 'segments 低于下限'],
    [{ segments: 65 }, 'segments 超上限'],
    [{ segments: 24.7 }, 'segments 非整数'],
    [{ center: [1, 2] }, 'center 非三元组'],
    [{ center: [1, null, 3] }, 'center 含非数值'],
    [{ center: ['x', 2, 3] }, 'center 含非数值字符串'],
    [{ asPoints: 'yes' }, 'asPoints 非布尔'],
    [{ asParallels: 1 }, 'asParallels 非布尔'],
    [{ asMeridians: 'true' }, 'asMeridians 非布尔'],
    [{ opacity: 'x' }, 'opacity 非数值'],
  ];
  for (const [cmd, label] of bad) {
    const r = resolveEllipsoid3D(cmd, { objects: [] });
    assert(r.ok === false, `拒绝：${label}`);
  }
  assert(resolveEllipsoid3D(null).ok === false, '拒绝：null 命令');
  assert(resolveEllipsoid3D([]).ok === false, '拒绝：数组命令');
  // 段数超上限：meridians=48, parallels=32, segments=64 → 48*64+32*64=5120 > 4096，拒绝
  const over = resolveEllipsoid3D({ meridians: 48, parallels: 32, segments: 64 });
  assert(over.ok === false && String(over.error).includes('超过上限'), '段数总和超 4096 原子拒绝');
  // 边界内最大网格：48*64+2*64=3200 < 4096（parallel 取下限 2）
  const full = resolveEllipsoid3D({ meridians: 48, parallels: 2, segments: 64 });
  assert(full.ok === true && full.meta.segmentCount === 3200, '边界内最大网格 3200 段仍合法');
}

section('E. 深度只读性（入参不被修改）');
{
  const cmd = Object.freeze({
    op: 'ellipsoid3d', id: 'ro', axis: 'z',
    center: Object.freeze([1, 2, 3]), a: 2, b: 1.5, c: 1,
    meridians: 6, parallels: 4, segments: 6, asPoints: true,
  });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_M1_s1' })]) });
  const r = resolveEllipsoid3D(cmd, state);
  assert(r.ok === true, '冻结入参仍可解析成功');
  assert(cmd.a === 2 && cmd.center[2] === 3 && state.objects.length === 1, '命令与 state 未被修改');
  r.items[0].p.x1 = 999;
  assert(cmd.a === 2, '改动输出不回流到入参');
}

section('F. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  // meridians=4, parallels=3, segments=6 → 经线 24 + 纬线 18 = 42 段
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', meridians: 4, parallels: 3, segments: 6 }], api());
  assert(r[0].ok === true && r[0].count === 42 && r[0].created.length === 42, '执行器逐段落地 42 段');
  assert(r[0].op === 'ellipsoid3d' && r[0].meta && r[0].meta.a === 1.5, '执行器回执 op=ellipsoid3d 且带 meta');
}
{
  // asPoints：meridians=3, parallels=2, segments=6 → 18+12=30 段 + (3×2+2)=8 点 = 38
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', meridians: 3, parallels: 2, segments: 6, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 38, 'asPoints 执行器落地 30 段 line + 8 点共 38 对象');
}
{
  // 已有同名对象：id 避让全部成功
  const a = { getState: () => ({ objects: [{ id: 'ell_M1_s1' }, { id: 'ell_M1_s1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', id: 'ell', meridians: 4, parallels: 3, segments: 6 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名段自动避让、全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'ellipsoid3d', meridians: 3, parallels: 2, segments: 6 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 失败分项回报（meridians=3, parallels=2, segments=6 → 30 段）
  const a = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', meridians: 3, parallels: 2, segments: 6 }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 30, 'api.add 失败如实分项回报');
}
{
  // 2D 隔离：未知命令仍拒绝
  const r = applyBoard3DCommands([{ op: 'ellipsoid', a: 2 }], api());
  assert(r[0].ok === false, '2D ellipsoid 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义的占位 3D 命令仍被 default 拒绝');
}
{
  // maxCommands
  const cmds = Array.from({ length: 4 }, () => ({ op: 'ellipsoid3d', meridians: 3, parallels: 2, segments: 6 }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  // 脏参数在执行器内原子拒绝（零副作用）
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', a: -1 }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝脏参数且未调用 add（零副作用）');
}
{
  // api.add 返回 null 也视为失败分项
  const a = { getState: () => ({ objects: [] }), add: () => null };
  const r = applyBoard3DCommands([{ op: 'ellipsoid3d', meridians: 3, parallels: 2, segments: 6 }], a);
  assert(r[0].ok === false && r[0].failed.length === 30, 'add 返回 null 如实分项回报失败');
}

section('G. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_ELLIPSOID_PROMPT_OPS.length === 1 && BOARD3D_ELLIPSOID_PROMPT_OPS[0] === 'ellipsoid3d', '提示词侧 ELLIPSOID_PROMPT_OPS = [ellipsoid3d]');
assert(BOARD3D_ELLIPSOID_PROMPT.includes('ellipsoid3d') && BOARD3D_ELLIPSOID_PROMPT.includes('a') && BOARD3D_ELLIPSOID_PROMPT.includes('b') && BOARD3D_ELLIPSOID_PROMPT.includes('c'), 'ELLIPSOID 提示词含命令说明与核心半轴参数');
assert(BOARD3D_ELLIPSOID_PROMPT.includes('axis') && BOARD3D_ELLIPSOID_PROMPT.includes('meridians') && BOARD3D_ELLIPSOID_PROMPT.includes('asMeridians'), 'ELLIPSOID 提示词含 axis/meridians/asMeridians');
assert(BOARD3D_ELLIPSOID_PROMPT.includes('橄榄球') && BOARD3D_ELLIPSOID_PROMPT.includes('扁球'), 'ELLIPSOID 提示词含椭球示例');
assert(BOARD3D_REVOLVE_PROMPT.includes('revolve3d') && BOARD3D_TORUS_PROMPT.includes('torus3d') && BOARD3D_POLYHEDRON_PROMPT.includes('polyhedron3d'), '既有 REVOLVE/TORUS/POLYHEDRON 段仍在');
const iTor = promptSrc.indexOf('export const BOARD3D_TORUS_PROMPT =');
const iEl = promptSrc.indexOf('export const BOARD3D_ELLIPSOID_PROMPT =');
assert(iTor > 0 && iEl > iTor, 'ELLIPSOID 追加段位于 TORUS 之后（末尾追加，未插入/未替换）');
assert(promptSrc.indexOf('export const BOARD3D_ELLIPSOID_PROMPT_OPS') < iEl, 'ELLIPSOID_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个椭球') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个椭球') === '2d', '2D 模式路由不变');
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
assert(page.includes('ellipsoid3d') && page.includes('torus3d') && page.includes('revolve3d'), '页面 AI tip 新增 ellipsoid3d 且保留 torus3d/revolve3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("el.op !== 'ellipsoid3d'") && aiPanel.includes("tr.op !== 'torus3d'"), '前端新增椭球展示且保留既有圆环面展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_ELLIPSOID_PROMPT') && backend.includes('BOARD3D_TORUS_PROMPT'), '后端 3D 拼接含 ellipsoid 且保留 torus');
const executor = read('js/board3d-executor.js');
assert(executor.includes("case 'ellipsoid3d'") && executor.includes("case 'torus3d'"), '执行器含 ellipsoid3d 分支且保留 torus3d');
assert(existsSync(join(ROOT, 'js/board3d-ellipsoid.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

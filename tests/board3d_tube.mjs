/**
 * 3D 管道命令（tube3d · D23）无头回归。
 *
 * 覆盖：samplePath / tubeFrames / tubePointAt / resolveTube3D 纯函数（路径细分 /
 *       平行移动标架正交性 / 截面圆半径守恒与垂直切向守恒 / 横截面圆环与母线 /
 *       asPoints / 采样与段数上限 / id 避让 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐段落地为 line、可选 point、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_tube.mjs
 */
import {
  BOARD3D_CAPSULE_PROMPT, BOARD3D_TUBE_PROMPT_OPS, BOARD3D_TUBE_PROMPT,
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
  BOARD3D_TUBE_OPS, BOARD3D_COMPLETE14_OPS,
} from '../js/board3d-executor.js';
import {
  TUBE3D_RADIUS_MIN, TUBE3D_RADIUS_MAX, TUBE3D_RADIUS_DEFAULT,
  TUBE3D_PATH_MIN, TUBE3D_PATH_MAX, TUBE3D_PATH_DEFAULT,
  TUBE3D_STEPS_MIN, TUBE3D_STEPS_MAX, TUBE3D_STEPS_DEFAULT,
  TUBE3D_RADIAL_SEGMENTS_MIN, TUBE3D_RADIAL_SEGMENTS_MAX, TUBE3D_RADIAL_SEGMENTS_DEFAULT,
  TUBE3D_MAX_SEGMENTS, TUBE3D_MAX_SAMPLES,
  samplePath, tubeFrames, tubePointAt, resolveTube3D,
} from '../js/board3d-tube.js';
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
const vecApprox = (a, b, eps = 2e-3) => a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const len = (a) => Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const frozen = (o) => Object.isFrozen(o);
/** 把 tubeFrames 的 {P,T,N,B} 列式结构转成逐点帧数组 */
const asFrames = (f) => f.P.map((_, i) => ({ P: f.P[i], T: f.T[i], N: f.N[i], B: f.B[i] }));

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
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_COMPLETE12_OPS.length === 21, 'ELLIPSOID 1 / COMPLETE12 21 条');
assert(BOARD3D_CAPSULE_OPS.length === 1 && BOARD3D_CAPSULE_OPS[0] === 'capsule3d', 'CAPSULE_OPS = [capsule3d]');
assert(BOARD3D_COMPLETE13_OPS.length === 22 && BOARD3D_COMPLETE13_OPS.includes('capsule3d'), 'COMPLETE13 完整集 22 条含 capsule3d');
assert(BOARD3D_TUBE_OPS.length === 1 && BOARD3D_TUBE_OPS[0] === 'tube3d', 'TUBE_OPS = [tube3d]');
assert(BOARD3D_COMPLETE14_OPS.length === 23 && BOARD3D_COMPLETE14_OPS.includes('tube3d'), 'COMPLETE14 完整集 23 条含 tube3d');
assert(BOARD3D_COMPLETE14_OPS.slice(0, 22).join(',') === BOARD3D_COMPLETE13_OPS.join(','), 'COMPLETE14 前 22 条与 COMPLETE13 逐项一致（纯追加）');
assert(frozen(BOARD3D_TUBE_OPS) && frozen(BOARD3D_COMPLETE14_OPS), '新增 OP 常量被冻结');
assert(TUBE3D_RADIUS_MIN === 0.01 && TUBE3D_RADIUS_MAX === 1000 && TUBE3D_RADIUS_DEFAULT === 0.5, '半径区间 [0.01,1000] 默认 0.5');
assert(TUBE3D_PATH_MIN === 2 && TUBE3D_PATH_MAX === 32 && TUBE3D_PATH_DEFAULT.length === 2, 'path 点数 [2,32]，默认两点直管');
assert(TUBE3D_STEPS_MIN === 1 && TUBE3D_STEPS_MAX === 16 && TUBE3D_STEPS_DEFAULT === 4, 'steps [1,16] 默认 4');
assert(TUBE3D_RADIAL_SEGMENTS_MIN === 3 && TUBE3D_RADIAL_SEGMENTS_MAX === 64 && TUBE3D_RADIAL_SEGMENTS_DEFAULT === 12, 'radialSegments [3,64] 默认 12');
assert(TUBE3D_MAX_SEGMENTS === 4096 && TUBE3D_MAX_SAMPLES === 257, '段数上限 4096 / 采样点上限 257');

section('B. samplePath 路径细分');
{
  const p = [[0, 0, 0], [0, 2, 0]];
  assert(samplePath(p, 1).length === 2, 'steps=1 时采样点=控制点数');
  assert(samplePath(p, 4).length === 5, 'steps=4 两点路径 → 5 个采样点');
  assert(vecApprox(samplePath(p, 4)[2], [0, 1, 0]), '细分中点坐标准确');
  const q = samplePath(p, 2);
  assert(vecApprox(q[0], [0, 0, 0]) && vecApprox(q[2], [0, 2, 0]), '细分辨率保留首尾控制点');
  const poly = samplePath([[0, 0, 0], [2, 0, 0], [2, 2, 0]], 2);
  assert(poly.length === 5 && vecApprox(poly[2], [2, 0, 0]), '折线路径经过每个控制点');
  const before = JSON.stringify(p);
  samplePath(p, 3);
  assert(JSON.stringify(p) === before, 'samplePath 不修改入参');
  assert(samplePath([], 3).length === 0, '空路径返回空数组');
}

section('C. tubeFrames 平行移动标架正交性');
{
  const path = samplePath([[0, 0, 0], [0, 2, 0]], 4);
  const f = tubeFrames(path);
  assert(f.P.length === 5 && f.T.length === 5 && f.N.length === 5 && f.B.length === 5, '标架四数组等长');
  let unitOK = true, orthoOK = true;
  for (let i = 0; i < 5; i++) {
    if (!approx(len(f.T[i]), 1, 1e-9) || !approx(len(f.N[i]), 1, 1e-9) || !approx(len(f.B[i]), 1, 1e-9)) unitOK = false;
    if (Math.abs(dot(f.T[i], f.N[i])) > 1e-9 || Math.abs(dot(f.T[i], f.B[i])) > 1e-9 || Math.abs(dot(f.N[i], f.B[i])) > 1e-9) orthoOK = false;
  }
  assert(unitOK, 'T/N/B 全为单位向量');
  assert(orthoOK, 'T/N/B 两两严格正交');
  assert(vecApprox(f.T[0], [0, 1, 0]), '竖直直管切向为 +Y');
}
{
  // 弯管：转折处标架仍保持正交（平行移动不翻转）
  const path = samplePath([[-2, 0, 0], [0, 2, 0], [2, 0, 0]], 3);
  const f = tubeFrames(path);
  let ok = true;
  for (let i = 0; i < f.T.length; i++) {
    if (Math.abs(dot(f.T[i], f.N[i])) > 1e-9 || !approx(len(f.N[i]), 1, 1e-9)) ok = false;
  }
  assert(ok, '折线弯管每个采样点标架仍正交归一');
  let smooth = true;
  for (let i = 1; i < f.N.length; i++) {
    if (dot(f.N[i - 1], f.N[i]) < -0.2) smooth = false; // 相邻法向不应突然翻转近 180°
  }
  assert(smooth, '平行移动避免转折处截面翻转');
}
{
  const f = tubeFrames([]);
  assert(f.P.length === 0, '空路径标架为空');
}

section('D. tubePointAt 守恒（核心几何）');
{
  const path = samplePath([[0, 0, 0], [0, 2, 0]], 4);
  const frames = asFrames(tubeFrames(path));
  const r = 0.7, off = [1, 2, 3];
  let radiusOK = true, perpOK = true;
  for (let i = 0; i < frames.length; i++) {
    for (let deg = 0; deg < 360; deg += 30) {
      const q = tubePointAt(frames[i], r, deg, off);
      const center = frames[i].P.map((x, k) => x + off[k]);
      if (!approx(len(sub(q, center)), r, 2e-3)) radiusOK = false;
      if (Math.abs(dot(sub(q, center), frames[i].T)) > 2e-3) perpOK = false;
    }
  }
  assert(radiusOK, '截面圆上任一点到中心距离恒为 radius');
  assert(perpOK, '截面圆上任一点与中心连线恒垂直于路径切向');
  // 竖直路径 T=+Y → 参考轴取 X，N0=cross(X,Y)=+Z，B0=cross(Y,Z)=+X
  assert(vecApprox(tubePointAt(frames[0], r, 0, off), [1, 2, 3.7]), 'θ=0 沿初始法向 +Z 落位');
  assert(vecApprox(tubePointAt(frames[0], r, 90, off), [1.7, 2, 3]), 'θ=90 沿 B0=+X 落位');
  assert(vecApprox(tubePointAt(frames[0], r, 180, off), [1, 2, 2.3]), 'θ=180 落在对侧');
}
{
  // 弯路径守恒
  const path = samplePath([[-2, 0, 0], [0, 2, 0], [2, 0, 0]], 3);
  const frames = asFrames(tubeFrames(path));
  let ok = true;
  for (let i = 0; i < frames.length; i++) {
    for (let deg = 0; deg < 360; deg += 45) {
      const q = tubePointAt(frames[i], 0.4, deg, [0, 0, 0]);
      if (!approx(len(sub(q, frames[i].P)), 0.4, 2e-3)) ok = false;
    }
  }
  assert(ok, '弯管路径上半径守恒仍成立');
}

section('E. resolveTube3D 命令解析');
{
  const r = resolveTube3D({ op: 'tube3d' }, {});
  assert(r.ok === true, '缺省参数生成成功');
  assert(r.meta.sampleCount === 5 && r.meta.segmentCount === 108 && r.meta.itemCount === 108, '默认：5 采样截面 / 60 圆环段 + 48 母线 = 108 段');
  assert(r.meta.radius === 0.5 && r.meta.steps === 4 && r.meta.radialSegments === 12, '默认 meta 参数正确');
  assert(r.items.every((it) => it.type === 'line'), '默认全部产出 line');
  assert(r.items.every((it) => it.p && Number.isFinite(it.p.x1) && Number.isFinite(it.p.z2)), 'line 端点字段齐全有限');
}
{
  const r = resolveTube3D({ op: 'tube3d', path: [[0, 0, 0], [2, 0, 0], [2, 2, 0]], radius: 0.3, steps: 2, radialSegments: 8 }, {});
  assert(r.ok === true && r.meta.path.length === 3 && r.meta.sampleCount === 5, '折线路径 + 细分解析成功');
  assert(r.meta.segmentCount === 72, '5×8 圆环 + 8×4 母线 = 72 段');
  assert(r.meta.radius === 0.3 && r.meta.radialSegments === 8 && r.meta.steps === 2, '指定参数进入 meta');
}
{
  const r = resolveTube3D({ op: 'tube3d', asRings: false, asMeridians: true }, {});
  assert(r.ok === true && r.meta.segmentCount === 48 && r.meta.ringCount === 0, '只画母线 48 段');
  const r2 = resolveTube3D({ op: 'tube3d', asRings: true, asMeridians: false }, {});
  assert(r2.ok === true && r2.meta.segmentCount === 60 && r2.meta.meridianCount === 0, '只画圆环 60 段');
}
{
  const r = resolveTube3D({ op: 'tube3d', asPoints: true, steps: 1, radialSegments: 6 }, {});
  assert(r.ok === true && r.meta.pointCount === 12, 'asPoints 产出 2×6=12 个采样点');
  assert(r.items.filter((it) => it.type === 'point').length === 12, 'point 对象实际落地 12 个');
  assert(r.items.filter((it) => it.type === 'point').every((it) => it.p.s === 0.1), '采样点大小正确');
}
{
  const r = resolveTube3D({ op: 'tube3d', center: [1, 2, 3], color: '#ff0000', opacity: 0.6, id: 'mytube' }, {});
  assert(r.ok === true && vecApprox(r.meta.center, [1, 2, 3]), 'center 进入 meta');
  assert(r.meta.id === 'mytube' && r.meta.color === '#ff0000' && approx(r.meta.opacity, 0.6), 'id/color/opacity 生效');
  assert(r.items.every((it) => it.color === '#ff0000' && approx(it.opacity, 0.6)), '样式传播到每个 line');
  assert(r.items[0].id.startsWith('mytube_'), 'id 前缀生效');
  const r3 = resolveTube3D({ op: 'tube3d', color: 123 }, {});
  assert(r3.ok === true && r3.meta.color === '#4f6bed', '非法 color 回落默认色（与历史命令同口径）');
}
{
  const r = resolveTube3D({ op: 'tube3d', radius: '0.4', steps: '3', radialSegments: '8' }, {});
  assert(r.ok === true && approx(r.meta.radius, 0.4) && r.meta.steps === 3 && r.meta.radialSegments === 8, '数字字符串容错');
}
{
  const state = { objects: [{ id: 'tube_R1_s1' }, { id: 'tube_R1_s1_2' }] };
  const r = resolveTube3D({ op: 'tube3d' }, state);
  const ids = r.items.map((it) => it.id);
  assert(new Set(ids).size === ids.length, 'id 避让后无重复');
  assert(!ids.includes('tube_R1_s1') && !ids.includes('tube_R1_s1_2'), '已有 id 被跳过');
}
{
  const long = 'T'.repeat(64);
  const r = resolveTube3D({ op: 'tube3d', id: long }, {});
  assert(r.ok === true && r.items.every((it) => it.id.length <= 64), '64 字符长 id 不越界');
  const state = { objects: r.items.slice(0, 3) };
  const r2 = resolveTube3D({ op: 'tube3d', id: long }, state);
  assert(r2.ok === true && r2.items.every((it) => it.id.length <= 64), '长 id 冲突避让不死循环');
}
{
  const r = resolveTube3D({ op: 'tube3d', radialSegments: 3, steps: 1, asRings: false, asMeridians: true }, {});
  assert(r.ok === true && r.meta.segmentCount === 3, '最小分段边界可生成（3 条母线）');
  const r2 = resolveTube3D({ op: 'tube3d', radialSegments: 64, steps: 1, asPoints: true, asRings: true, asMeridians: false }, {});
  assert(r2.ok === true, '边界内最大网格生成成功');
}

section('F. 脏输入原子拒绝');
{
  const bad = [
    null, [], 'abc', 42,
    { op: 'tube3d', id: '' }, { op: 'tube3d', id: 'bad id!' }, { op: 'tube3d', id: 5 },
    { op: 'tube3d', radius: 0 }, { op: 'tube3d', radius: -1 }, { op: 'tube3d', radius: 1001 }, { op: 'tube3d', radius: 'abc' }, { op: 'tube3d', radius: null }, { op: 'tube3d', radius: [] },
    { op: 'tube3d', path: [] }, { op: 'tube3d', path: [[0, 0, 0]] },
    { op: 'tube3d', path: Array.from({ length: 33 }, () => [0, 0, 0]) },
    { op: 'tube3d', path: [[0, 0]] }, { op: 'tube3d', path: [[0, 0, 'x'], [1, 1, 1]] },
    { op: 'tube3d', path: 'not-array' }, { op: 'tube3d', path: [[0, 0, 0], null] },
    { op: 'tube3d', steps: 0 }, { op: 'tube3d', steps: 17 }, { op: 'tube3d', steps: 1.5 }, { op: 'tube3d', steps: 'x' },
    { op: 'tube3d', radialSegments: 2 }, { op: 'tube3d', radialSegments: 65 }, { op: 'tube3d', radialSegments: 2.5 },
    { op: 'tube3d', center: [1, 2] }, { op: 'tube3d', center: [1, 'x', 3] }, { op: 'tube3d', center: null },
    { op: 'tube3d', asRings: 'yes' }, { op: 'tube3d', asMeridians: 1 }, { op: 'tube3d', asPoints: 'true' },
    { op: 'tube3d', asRings: false, asMeridians: false }, { op: 'tube3d', asRings: false, asMeridians: false, asPoints: false },
    { op: 'tube3d', opacity: 'oops' },
    { op: 'tube3d', path: Array.from({ length: 17 }, (_, i) => [i, 0, 0]), steps: 16, radialSegments: 64 }, // 段数超上限
  ];
  let allRejected = true;
  for (const cmd of bad) {
    const r = resolveTube3D(cmd, {});
    if (r.ok !== false || !r.error) { allRejected = false; console.error('    未拒绝:', JSON.stringify(cmd)); }
  }
  assert(allRejected, `${bad.length} 类脏输入全部原子拒绝且带 error`);
}
{
  const r = resolveTube3D({ op: 'tube3d', steps: 16, path: Array.from({ length: 32 }, (_, i) => [i, 0, 0]) }, {});
  assert(r.ok === false && /采样点|上限/.test(r.error), '采样点数超 257 原子拒绝');
}

section('G. 深度只读性');
{
  const cmd = Object.freeze({
    op: 'tube3d', id: 'ro', path: Object.freeze([Object.freeze([0, 0, 0]), Object.freeze([0, 2, 0])]),
    radius: 0.5, center: Object.freeze([1, 2, 3]), steps: 2, radialSegments: 6,
  });
  const state = Object.freeze({ objects: Object.freeze([]) });
  const before = JSON.stringify(cmd);
  const r = resolveTube3D(cmd, state);
  assert(r.ok === true && JSON.stringify(cmd) === before, '冻结入参不抛错且完全不变');
  r.items[0].id = 'CHANGED';
  const r2 = resolveTube3D(cmd, state);
  assert(r2.items[0].id !== 'CHANGED', '两次调用输出互相独立');
  assert(frozen(BOARD3D_TUBE_OPS) && frozen(TUBE3D_PATH_DEFAULT), '导出常量被冻结');
}

section('H. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const r = applyBoard3DCommands([{ op: 'tube3d', steps: 1, radialSegments: 6 }], api());
  assert(r[0].ok === true && r[0].count === 18 && r[0].created.length === 18, '执行器逐段落地 18 段（6 环 + 6 母线）');
  assert(r[0].op === 'tube3d' && r[0].meta && r[0].meta.radius === 0.5, '回执 op=tube3d 且带 meta');
}
{
  const r = applyBoard3DCommands([{ op: 'tube3d', steps: 1, radialSegments: 6, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 30, 'asPoints 执行器落地 18 段 + 12 点 = 30');
}
{
  const a = { getState: () => ({ objects: [{ id: 'tube_R1_s1' }, { id: 'tube_R1_s1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'tube3d', steps: 1, radialSegments: 6 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名对象自动避让、全部成功');
}
{
  const cmds = Array.from({ length: 2 }, () => ({ op: 'tube3d', steps: 1, radialSegments: 6 }));
  const r = applyBoard3DCommands(cmds, api());
  assert(r[0].ok === true && r[1].ok === false && r[1].failed.length === 18, '同批同 id 第二次全部冲突、分项失败 18');
}
{
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'tube3d', steps: 1, radialSegments: 6 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  for (const add of [() => false, () => null]) {
    const a = { getState: () => ({ objects: [] }), add };
    const r = applyBoard3DCommands([{ op: 'tube3d', steps: 1, radialSegments: 6 }], a);
    assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 18, 'api.add 失败/null 如实分项回报 18 项');
  }
}
{
  const r = applyBoard3DCommands([{ op: 'tube', radius: 1 }], api());
  assert(r[0].ok === false, '2D tube 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义占位 3D 命令仍被 default 拒绝');
}
{
  const many = Array.from({ length: 4 }, () => ({ op: 'tube3d', steps: 1, radialSegments: 6 }));
  const r = applyBoard3DCommands(many, api(), { maxCommands: 3 });
  assert(r.length === 4 && r[3].ok === false && /上限/.test(r[3].error), 'maxCommands 超限追加失败回执');
}
{
  const r = applyBoard3DCommands([{ op: 'tube3d', radius: -1 }], api());
  assert(r[0].ok === false && /radius/.test(r[0].error), '执行器透传纯函数拒绝原因');
}

section('I. 共享文件协议两侧一致性');
assert(BOARD3D_TUBE_PROMPT_OPS.length === 1 && BOARD3D_TUBE_PROMPT_OPS[0] === 'tube3d', '提示词 OPS 与执行器一致');
assert(BOARD3D_TUBE_PROMPT.includes('tube3d') && BOARD3D_TUBE_PROMPT.includes('radialSegments'), '提示词含命令名与新参数');
assert(BOARD3D_TUBE_PROMPT.includes('path 必须传实际数值点列'), '提示词明确禁止表达式路径');
assert(BOARD3D_TUBE_PROMPT.includes('2D'), '提示词含 2D 隔离铁律');
assert(BOARD3D_CAPSULE_PROMPT.length > 0 && BOARD3D_TUBE_PROMPT.indexOf('tube3d') > 0, 'CAPSULE 段仍在且 TUBE 为新增独立段');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_TUBE_PROMPT'), '后端 import TUBE 提示词');
assert(backend.includes('BOARD3D_CAPSULE_PROMPT + BOARD3D_TUBE_PROMPT'), '后端 3D 拼接串末尾追加且旧串为前缀');
assert(backend.includes('resolveBoardMode'), '3D 意图检测分支未改');
assert(resolveBoardMode({ mode: '3d' }, '画个盒子') === '3d', '显式 mode=3d 仍生效');
assert(resolveBoardMode({}, '画一个正方体') === '2d', '默认仍为 2D');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.indexOf('BOARD3D_CAPSULE_PROMPT') < promptSrc.indexOf('BOARD3D_TUBE_PROMPT'), '共享文件为末尾纯追加（CAPSULE 在前、TUBE 在后）');

section('J. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍指向本地 vendor Three.js');
assert(page.includes('tube3d'), '页面 AI tip 已追加 tube3d 说明');
assert(read('js/board3d-ai.js').includes("tb.op !== 'tube3d'"), 'AI 面板已追加 tube3d 展示块');
assert(read('js/board3d-executor.js').includes("case 'tube3d'"), '执行器已追加 tube3d 分支');

section('结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exitCode = 1;

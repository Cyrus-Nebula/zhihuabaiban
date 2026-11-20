/**
 * 3D 胶囊体命令（capsule3d · D22）无头回归。
 *
 * 覆盖：capsuleProfileAt / capsulePointAt / resolveCapsule3D 纯函数（三轴参数方程 /
 *       胶囊面到轴线段距离恒为 r 守恒 / length=0 退化球 / 经线与纬线圈 / 极点 /
 *       asPoints / 覆盖率与段数上限 / id 避让 / 各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐段落地为 line、可选 point、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_capsule.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_BEZIER_PROMPT,
  BOARD3D_ARC_PROMPT, BOARD3D_POLYHEDRON_PROMPT, BOARD3D_REVOLVE_PROMPT,
  BOARD3D_TORUS_PROMPT, BOARD3D_ELLIPSOID_PROMPT,
  BOARD3D_CAPSULE_PROMPT_OPS, BOARD3D_CAPSULE_PROMPT,
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
} from '../js/board3d-executor.js';
import {
  CAPSULE3D_RADIUS_MIN, CAPSULE3D_RADIUS_MAX, CAPSULE3D_RADIUS_DEFAULT,
  CAPSULE3D_LENGTH_MIN, CAPSULE3D_LENGTH_MAX, CAPSULE3D_LENGTH_DEFAULT,
  CAPSULE3D_MERIDIANS_MIN, CAPSULE3D_MERIDIANS_MAX, CAPSULE3D_MERIDIANS_DEFAULT,
  CAPSULE3D_RINGS_MIN, CAPSULE3D_RINGS_MAX, CAPSULE3D_RINGS_DEFAULT,
  CAPSULE3D_SEGMENTS_MIN, CAPSULE3D_SEGMENTS_MAX, CAPSULE3D_SEGMENTS_DEFAULT,
  CAPSULE3D_MAX_SEGMENTS, CAPSULE3D_AXES, capsuleProfileAt, capsulePointAt, resolveCapsule3D,
} from '../js/board3d-capsule.js';
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
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => a.length === 3 && a.every((x, i) => approx(x, b[i], eps));

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
assert(BOARD3D_COMPLETE13_OPS.slice(0, 21).join(',') === BOARD3D_COMPLETE12_OPS.join(','), 'COMPLETE13 前 21 条与 COMPLETE12 逐项一致（纯追加）');
assert(CAPSULE3D_RADIUS_MIN === 0.01 && CAPSULE3D_RADIUS_MAX === 1000, '半径区间 [0.01,1000]');
assert(CAPSULE3D_RADIUS_DEFAULT === 0.5, '默认 radius=0.5');
assert(CAPSULE3D_LENGTH_MIN === 0 && CAPSULE3D_LENGTH_MAX === 1000 && CAPSULE3D_LENGTH_DEFAULT === 2, 'length 区间 [0,1000] 默认 2');
assert(CAPSULE3D_MERIDIANS_MIN === 3 && CAPSULE3D_MERIDIANS_MAX === 48 && CAPSULE3D_MERIDIANS_DEFAULT === 12, '经线条数 [3,48] 默认 12');
assert(CAPSULE3D_RINGS_MIN === 2 && CAPSULE3D_RINGS_MAX === 32 && CAPSULE3D_RINGS_DEFAULT === 8, '纬线圈数 [2,32] 默认 8');
assert(CAPSULE3D_SEGMENTS_MIN === 3 && CAPSULE3D_SEGMENTS_MAX === 64 && CAPSULE3D_SEGMENTS_DEFAULT === 24, '分段数 [3,64] 默认 24');
assert(CAPSULE3D_MAX_SEGMENTS === 4096 && CAPSULE3D_AXES.join(',') === 'x,y,z', '段数上限 4096 / 轴白名单 x/y/z');

section('B. capsuleProfileAt / capsulePointAt 参数方程与守恒');
{
  // 母线三段拼接（r=1,h=2）
  let q = capsuleProfileAt(1, 2, 0);
  assert(approx(q.rho, 0) && approx(q.axial, -2), 't=0 下极点 rho=0, axial=-h/2-r');
  q = capsuleProfileAt(1, 2, 1 / 3);
  assert(approx(q.rho, 1) && approx(q.axial, -1), 't=1/3 下球赤道 rho=r, axial=-h/2');
  q = capsuleProfileAt(1, 2, 0.5);
  assert(approx(q.rho, 1) && approx(q.axial, 0), 't=0.5 柱段中点 rho=r, axial=0');
  q = capsuleProfileAt(1, 2, 2 / 3);
  assert(approx(q.rho, 1) && approx(q.axial, 1), 't=2/3 上球赤道 rho=r, axial=h/2');
  q = capsuleProfileAt(1, 2, 1);
  assert(approx(q.rho, 0) && approx(q.axial, 2), 't=1 上极点 rho=0, axial=h/2+r');
  // 连续性：三段交界左右极限一致
  for (const t of [1 / 3, 2 / 3]) {
    const l = capsuleProfileAt(1, 2, t - 1e-7), rr = capsuleProfileAt(1, 2, t + 1e-7);
    assert(approx(l.rho, rr.rho) && approx(l.axial, rr.axial), `t=${t.toFixed(3)} 母线三段连续`);
  }
  // 柱段 rho 恒为 r
  let allR = true;
  for (let t = 1 / 3 + 0.001; t < 2 / 3; t += 0.01) if (!approx(capsuleProfileAt(1.3, 2.4, t).rho, 1.3)) allR = false;
  assert(allR, '柱段全段 rho 恒等于半径 r');
}
{
  const c = [0, 0, 0];
  // axis=y（默认）
  assert(vecApprox(capsulePointAt(1, 2, 'y', 0, 0, c), [0, -2, 0]), 'Y 轴下极点 t=0 → (0,-2,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'y', 1, 0, c), [0, 2, 0]), 'Y 轴上极点 t=1 → (0,2,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'y', 1 / 3, 0, c), [1, -1, 0]), 'Y 轴 t=1/3,θ=0 → (1,-1,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'y', 1 / 3, 90, c), [0, -1, 1]), 'Y 轴 t=1/3,θ=90 → (0,-1,1)');
  assert(vecApprox(capsulePointAt(1, 2, 'y', 0.5, 180, c), [-1, 0, 0]), 'Y 轴柱段 θ=180 → (-1,0,0)');
  // axis=x / z：轴向分量落位正确
  assert(vecApprox(capsulePointAt(1, 2, 'x', 0.5, 0, c), [0, 1, 0]), 'X 轴柱段 θ=0 → (0,1,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'x', 1, 0, c), [2, 0, 0]), 'X 轴上极点 → (2,0,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'z', 0.5, 0, c), [1, 0, 0]), 'Z 轴柱段 θ=0 → (1,0,0)');
  assert(vecApprox(capsulePointAt(1, 2, 'z', 0, 0, c), [0, 0, -2]), 'Z 轴下极点 → (0,0,-2)');
  // center 平移
  assert(vecApprox(capsulePointAt(0.5, 3, 'y', 0.5, 0, [1, 2, 3]), [1.5, 2, 3]), 'center 平移整体生效');
  // length=0 退化为球：到球心距离恒为 radius
  let sphereOK = true;
  for (const t of [0, 0.15, 1 / 3, 0.5, 2 / 3, 0.85, 1]) {
    for (const th of [0, 60, 120, 180, 240, 300]) {
      const p = capsulePointAt(1.5, 0, 'y', t, th, c);
      if (!approx(Math.hypot(p[0], p[1], p[2]), 1.5, 3e-3)) sphereOK = false;
    }
  }
  assert(sphereOK, 'length=0 时胶囊退化为球：各采样点到球心距离恒为 radius');
  // 坐标钳制
  assert(capsulePointAt(1, 2, 'y', 0.5, 0, [20000, 0, 0])[0] === 10000, '超大 center 坐标被钳制到 ±10000');
}
{
  // 核心守恒：胶囊面任一点到轴线段的距离恒为 r（三轴 × 母线采样 × 方位角）
  const r = 1.3, h = 2.4, ctr = [1, 2, 3];
  const dist = (p, axis) => {
    const rel = [p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]];
    if (axis === 'y') return Math.hypot(rel[0], rel[2], Math.max(0, Math.abs(rel[1]) - h / 2));
    if (axis === 'x') return Math.hypot(rel[1], rel[2], Math.max(0, Math.abs(rel[0]) - h / 2));
    return Math.hypot(rel[0], rel[1], Math.max(0, Math.abs(rel[2]) - h / 2));
  };
  for (const axis of ['x', 'y', 'z']) {
    let ok = true, n = 0;
    for (const t of [0, 0.1, 1 / 3, 0.5, 2 / 3, 0.9, 1]) {
      for (const th of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const p = capsulePointAt(r, h, axis, t, th, ctr);
        if (!approx(dist(p, axis), r, 3e-3)) ok = false;
        n++;
      }
    }
    assert(ok, `${axis.toUpperCase()} 轴：${n} 个胶囊面采样点到轴线段的距离恒为 r`);
  }
}

section('C. resolveCapsule3D 命令解析（默认 / 指定 / 开关 / 极点 / 三轴 / 样式 / id 避让）');
{
  const r = resolveCapsule3D({ op: 'capsule3d' }, {});
  assert(r.ok === true, '默认命令解析成功');
  assert(r.meta.axis === 'y' && r.meta.radius === 0.5 && r.meta.length === 2, '默认 axis=y / radius=0.5 / length=2');
  assert(r.meta.meridians === 12 && r.meta.rings === 8 && r.meta.segments === 24, '默认 12 经 / 8 纬 / 24 段');
  assert(r.meta.segmentCount === 12 * 24 + 8 * 24 && r.items.length === 480, '默认生成 480 段 line');
  assert(r.items.every((it) => it.type === 'line'), '默认全部为 line 对象');
  assert(r.items.every((it) => Array.isArray(it.pos) && it.pos.join(',') === '0,0,0'), '线段 pos 均为原点（绝对端点写入 p）');
  assert(r.items.every((it) => it.p && Number.isFinite(it.p.x1) && Number.isFinite(it.p.z2)), '每条线段含完整 x1..z2 绝对端点');
}
{
  const r = resolveCapsule3D({ op: 'capsule3d', meridians: 4, rings: 3, segments: 6 }, {});
  assert(r.ok === true && r.meta.segmentCount === 42 && r.items.length === 42, '指定 4×6 + 3×6 = 42 段');
}
{
  const r = resolveCapsule3D({ op: 'capsule3d', meridians: 4, rings: 3, segments: 6, asMeridians: false }, {});
  assert(r.ok === true && r.meta.meridianCount === 0 && r.meta.segmentCount === 18, 'asMeridians=false 只画 18 段纬线圈');
  const r2 = resolveCapsule3D({ op: 'capsule3d', meridians: 4, rings: 3, segments: 6, asRings: false }, {});
  assert(r2.ok === true && r2.meta.ringCount === 0 && r2.meta.segmentCount === 24, 'asRings=false 只画 24 段经线');
}
{
  const r = resolveCapsule3D({ op: 'capsule3d', meridians: 3, rings: 2, segments: 6, asPoints: true }, {});
  assert(r.ok === true && r.meta.segmentCount === 30 && r.meta.pointCount === 8 && r.items.length === 38, 'asPoints：30 段 + 8 点（3×2 网格 + 两极）');
  const pts = r.items.filter((it) => it.type === 'point');
  assert(pts.length === 8 && pts.every((p) => p.p && p.p.s > 0), '采样点均为带尺寸的 point 对象');
  const ids = r.items.map((it) => it.id);
  assert(ids.includes('cap_poleTop') && ids.includes('cap_poleBot'), '含 _poleTop / _poleBot 两极标记');
  const top = r.items.find((it) => it.id === 'cap_poleTop');
  assert(vecApprox(top.pos, [0, 1 + 0.5, 0]), '_poleTop 位置为 (0, length/2+radius, 0)');
  const bot = r.items.find((it) => it.id === 'cap_poleBot');
  assert(vecApprox(bot.pos, [0, -1 - 0.5, 0]), '_poleBot 位置为 (0, -length/2-radius, 0)');
}
{
  for (const axis of ['x', 'y', 'z']) {
    const r = resolveCapsule3D({ op: 'capsule3d', axis, meridians: 3, rings: 2, segments: 6 }, {});
    assert(r.ok === true && r.meta.axis === axis, `axis=${axis} 解析成功`);
  }
}
{
  const r = resolveCapsule3D({ op: 'capsule3d', radius: 0.8, length: 3, center: [1, 2, 3], color: '#ff0000', opacity: 0.5, meridians: 3, rings: 2, segments: 6 }, {});
  assert(r.meta.radius === 0.8 && r.meta.length === 3 && r.meta.center.join(',') === '1,2,3', '自定义半径/长度/中心进入 meta');
  assert(r.meta.color === '#ff0000' && r.items.every((it) => it.color === '#ff0000' && it.opacity === 0.5), '样式透传到全部线段');
  const r2 = resolveCapsule3D({ op: 'capsule3d', opacity: -3 }, {});
  assert(r2.meta.opacity === 0.1, 'opacity 下钳制到 0.1');
  const r3 = resolveCapsule3D({ op: 'capsule3d', opacity: 9 }, {});
  assert(r3.meta.opacity === 1, 'opacity 上钳制到 1');
}
{
  const r = resolveCapsule3D({ op: 'capsule3d', radius: '0.8', length: '3', meridians: '4', rings: '3', segments: '6' }, {});
  assert(r.ok === true && r.meta.radius === 0.8 && r.meta.length === 3 && r.meta.segmentCount === 42, '数字字符串容错');
}
{
  const a = { getState: () => ({ objects: [{ id: 'cap_M1_s1' }, { id: 'cap_M1_s1_2' }, { id: 'cap_R1_s1' }] }), add: (o) => o.id };
  const r = resolveCapsule3D({ op: 'capsule3d', meridians: 4, rings: 3, segments: 6 }, { objects: a.getState().objects });
  const ids = r.items.map((it) => it.id);
  assert(r.ok === true && new Set(ids).size === ids.length, 'id 冲突自动避让、输出 id 全唯一');
  assert(ids.includes('cap_M1_s1_3') || ids.some((x) => x.startsWith('cap_M1_s1_')), '冲突 id 追加后缀避让');
}
{
  // 64 字符长 id：stem 预留 8 字符后缀位，不死循环且长度合规
  const longId = 'c'.repeat(64);
  const r = resolveCapsule3D({ op: 'capsule3d', id: longId, meridians: 3, rings: 2, segments: 6 }, {});
  assert(r.ok === true && r.items.length === 30, '64 字符 id 仍能生成全部对象（不死循环）');
  assert(r.items.every((it) => it.id.length <= 64), '长 id 截断后所有 id 长度 ≤ 64');
  assert(new Set(r.items.map((it) => it.id)).size === 30, '长 id 场景输出仍全唯一');
}
{
  // 段数上限边界：48 经 + 32 纬 = 80 条线，segments=51 → 4080 ≤ 4096；segments=52 → 4160 > 4096
  const r = resolveCapsule3D({ op: 'capsule3d', meridians: 48, rings: 32, segments: 51 }, {});
  assert(r.ok === true && r.meta.segmentCount === 4080, '边界内最大网格 4080 段生成成功');
  const r2 = resolveCapsule3D({ op: 'capsule3d', meridians: 48, rings: 32, segments: 52 }, {});
  assert(r2.ok === false && /超过上限/.test(r2.error), '超 4096 段原子拒绝');
}

section('D. 脏输入原子拒绝（零副作用）');
const reject = (cmd) => {
  const r = resolveCapsule3D(cmd, {});
  const label = String(JSON.stringify(cmd) === undefined ? String(cmd) : JSON.stringify(cmd)).slice(0, 58);
  assert(r.ok === false && r.items === undefined && typeof r.error === 'string', `原子拒绝：${label}`);
};
reject(null);
reject(undefined);
reject([]);
reject('capsule3d');
reject({ op: 'capsule3d', id: 'bad id' });
reject({ op: 'capsule3d', id: '胶囊' });
reject({ op: 'capsule3d', id: 'x'.repeat(65) });
reject({ op: 'capsule3d', axis: 'w' });
reject({ op: 'capsule3d', axis: 'Y' });
reject({ op: 'capsule3d', axis: 1 });
reject({ op: 'capsule3d', radius: 0 });
reject({ op: 'capsule3d', radius: -1 });
reject({ op: 'capsule3d', radius: 1001 });
reject({ op: 'capsule3d', radius: null });
reject({ op: 'capsule3d', radius: 'sqrt(2)' });
reject({ op: 'capsule3d', radius: [] });
reject({ op: 'capsule3d', length: -0.01 });
reject({ op: 'capsule3d', length: 1001 });
reject({ op: 'capsule3d', length: null });
reject({ op: 'capsule3d', length: 'abc' });
reject({ op: 'capsule3d', meridians: 2 });
reject({ op: 'capsule3d', meridians: 49 });
reject({ op: 'capsule3d', meridians: 3.5 });
reject({ op: 'capsule3d', rings: 1 });
reject({ op: 'capsule3d', rings: 33 });
reject({ op: 'capsule3d', rings: 8.2 });
reject({ op: 'capsule3d', segments: 2 });
reject({ op: 'capsule3d', segments: 65 });
reject({ op: 'capsule3d', segments: 6.6 });
reject({ op: 'capsule3d', asMeridians: 'true' });
reject({ op: 'capsule3d', asRings: 1 });
reject({ op: 'capsule3d', asPoints: 'yes' });
reject({ op: 'capsule3d', asMeridians: false, asRings: false, asPoints: false });
reject({ op: 'capsule3d', center: null });
reject({ op: 'capsule3d', center: [1, 2] });
reject({ op: 'capsule3d', center: [1, 2, 3, 4] });
reject({ op: 'capsule3d', center: [1, null, 3] });
reject({ op: 'capsule3d', center: ['x', 2, 3] });
reject({ op: 'capsule3d', opacity: 'none' });
reject({ op: 'capsule3d', meridians: 48, rings: 32, segments: 64 });

section('E. 深度只读性（入参不被修改 / 输出独立）');
{
  const cmd = Object.freeze({ op: 'capsule3d', radius: 0.8, center: Object.freeze([1, 2, 3]) });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'cap_M1_s1' })]) });
  const before = JSON.stringify({ cmd, state });
  const r1 = resolveCapsule3D(cmd, state);
  assert(JSON.stringify({ cmd, state }) === before, '冻结的 cmd / state 调用后逐字不变');
  assert(r1.ok === true, '冻结入参仍能正常解析');
  const r2 = resolveCapsule3D(cmd, state);
  assert(r1.items !== r2.items && r1.items[0] !== r2.items[0], '两次调用输出全新 items 数组与对象');
  assert(JSON.stringify(r1) === JSON.stringify(r2), '同入参两次调用结果完全一致（确定性）');
  r1.items[0].id = 'mutated';
  assert(r2.items[0].id !== 'mutated', '修改一次输出不影响另一次（无共享引用）');
}

section('F. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const r = applyBoard3DCommands([{ op: 'capsule3d', meridians: 4, rings: 3, segments: 6 }], api());
  assert(r[0].ok === true && r[0].count === 42 && r[0].created.length === 42, '执行器逐段落地 42 段');
  assert(r[0].op === 'capsule3d' && r[0].meta && r[0].meta.radius === 0.5, '执行器回执 op=capsule3d 且带 meta');
}
{
  const r = applyBoard3DCommands([{ op: 'capsule3d', meridians: 3, rings: 2, segments: 6, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 38, 'asPoints 执行器落地 30 段 + 8 点共 38 对象');
}
{
  const a = { getState: () => ({ objects: [{ id: 'cap_M1_s1' }, { id: 'cap_M1_s1_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'capsule3d', meridians: 4, rings: 3, segments: 6 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名对象自动避让、全部成功');
}
{
  // 同批两次同 id：known 集合触发 id 冲突分项失败
  const cmds = Array.from({ length: 2 }, () => ({ op: 'capsule3d', meridians: 3, rings: 2, segments: 6 }));
  const r = applyBoard3DCommands(cmds, api());
  assert(r[0].ok === true && r[1].ok === false && r[1].failed.length === 30, '同批同 id 第二次全部冲突、分项失败 30');
}
{
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'capsule3d', meridians: 3, rings: 2, segments: 6 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  for (const add of [() => false, () => null]) {
    const a = { getState: () => ({ objects: [] }), add };
    const r = applyBoard3DCommands([{ op: 'capsule3d', meridians: 3, rings: 2, segments: 6 }], a);
    assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 30, 'api.add 失败/null 如实分项回报 30 项');
  }
}
{
  const r = applyBoard3DCommands([{ op: 'capsule', radius: 1 }], api());
  assert(r[0].ok === false, '2D capsule 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义占位 3D 命令仍被 default 拒绝');
}
{
  const cmds = Array.from({ length: 4 }, () => ({ op: 'capsule3d', meridians: 3, rings: 2, segments: 6 }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'capsule3d', radius: -1 }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝脏参数且未调用 add（零副作用）');
}

section('G. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_CAPSULE_PROMPT_OPS.length === 1 && BOARD3D_CAPSULE_PROMPT_OPS[0] === 'capsule3d', '提示词侧 CAPSULE_PROMPT_OPS = [capsule3d]');
assert(BOARD3D_CAPSULE_PROMPT.includes('capsule3d') && BOARD3D_CAPSULE_PROMPT.includes('radius') && BOARD3D_CAPSULE_PROMPT.includes('length'), 'CAPSULE 提示词含命令说明与核心参数');
assert(BOARD3D_CAPSULE_PROMPT.includes('axis') && BOARD3D_CAPSULE_PROMPT.includes('meridians') && BOARD3D_CAPSULE_PROMPT.includes('asRings'), 'CAPSULE 提示词含 axis/meridians/asRings');
assert(BOARD3D_CAPSULE_PROMPT.includes('胶囊') && BOARD3D_CAPSULE_PROMPT.includes('药丸'), 'CAPSULE 提示词含胶囊体示例');
assert(BOARD3D_ELLIPSOID_PROMPT.includes('ellipsoid3d') && BOARD3D_TORUS_PROMPT.includes('torus3d') && BOARD3D_REVOLVE_PROMPT.includes('revolve3d') && BOARD3D_POLYHEDRON_PROMPT.includes('polyhedron3d'), '既有 ELLIPSOID/TORUS/REVOLVE/POLYHEDRON 段仍在');
assert(BOARD3D_HELIX_PROMPT.includes('helix3d') && BOARD3D_BEZIER_PROMPT.includes('bezier3d') && BOARD3D_ARC_PROMPT.includes('arc3d'), '既有 HELIX/BEZIER/ARC 段仍在');
const iEl = promptSrc.indexOf('export const BOARD3D_ELLIPSOID_PROMPT =');
const iCap = promptSrc.indexOf('export const BOARD3D_CAPSULE_PROMPT =');
assert(iEl > 0 && iCap > iEl, 'CAPSULE 追加段位于 ELLIPSOID 之后（末尾追加，未插入/未替换）');
assert(promptSrc.indexOf('export const BOARD3D_CAPSULE_PROMPT_OPS') < iCap, 'CAPSULE_PROMPT_OPS 定义在其 PROMPT 之前');
assert(BOARD3D_CAPSULE_PROMPT_OPS[0] === BOARD3D_CAPSULE_OPS[0], '提示词侧与执行器侧 op 一致');
assert(resolveBoardMode({ mode: '3d' }, '画个胶囊') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个胶囊') === '2d', '2D 模式路由不变');
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
assert(page.includes('capsule3d') && page.includes('ellipsoid3d') && page.includes('torus3d'), '页面 AI tip 新增 capsule3d 且保留 ellipsoid3d/torus3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("cp.op !== 'capsule3d'") && aiPanel.includes("el.op !== 'ellipsoid3d'"), '前端新增胶囊体展示且保留既有椭球展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_CAPSULE_PROMPT') && backend.includes('BOARD3D_ELLIPSOID_PROMPT'), '后端 3D 拼接含 capsule 且保留 ellipsoid');
const executor = read('js/board3d-executor.js');
assert(executor.includes("case 'capsule3d'") && executor.includes("case 'ellipsoid3d'"), '执行器含 capsule3d 分支且保留 ellipsoid3d');
assert(existsSync(join(ROOT, 'js/board3d-capsule.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

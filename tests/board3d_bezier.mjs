/**
 * 3D 空间贝塞尔曲线命令（bezier3d · D15）无头回归。
 *
 * 覆盖：resolveBezier3D / bezierPointAt 纯函数（de Casteljau 递推数学：端点插值 /
 *       二次·三次解析值 / 凸包性 / 线性退化 / 控制点数 2~8 / 坐标钳制 / 数字字符串容错 /
 *       采样点标记 / 段数上限 / 段首尾相接 / id 避让 / 21 类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐段落地为 line、可选 point、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、maxCommands）、共享文件协议两侧一致性、
 *       协作铁律与硬约束（新旧路径并存 / 共享文件只追加）静态复核。
 *
 * 运行：node tests/board3d_bezier.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT,
  BOARD3D_BEZIER_PROMPT_OPS, BOARD3D_BEZIER_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
} from '../js/board3d-executor.js';
import {
  BEZIER3D_POINTS_MIN, BEZIER3D_POINTS_MAX, BEZIER3D_SEGMENTS_MIN,
  BEZIER3D_SEGMENTS_MAX, BEZIER3D_MAX_SEGMENTS, BEZIER3D_SEGMENTS_DEFAULT,
  bezierPointAt, resolveBezier3D,
} from '../js/board3d-bezier.js';
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
assert(BOARD3D_BEZIER_OPS.length === 1 && BOARD3D_BEZIER_OPS[0] === 'bezier3d', 'BEZIER_OPS = [bezier3d]');
assert(BOARD3D_COMPLETE7_OPS.length === 16 && BOARD3D_COMPLETE7_OPS.includes('bezier3d'), 'COMPLETE7 完整集 16 条含 bezier3d');
assert(BOARD3D_COMPLETE7_OPS.slice(0, 15).join(',') === BOARD3D_COMPLETE6_OPS.join(','), 'COMPLETE7 前 15 条与 COMPLETE6 逐项一致（纯追加）');
assert(BEZIER3D_POINTS_MIN === 2 && BEZIER3D_POINTS_MAX === 8, '控制点数区间 [2,8]');
assert(BEZIER3D_SEGMENTS_MIN === 1 && BEZIER3D_SEGMENTS_MAX === 512, '采样段数区间 [1,512]');
assert(BEZIER3D_MAX_SEGMENTS === 512 && BEZIER3D_SEGMENTS_DEFAULT === 24, '段数上限 512 / 默认 24');

section('B. de Casteljau 数学（端点插值 / 解析值 / 凸包）');
{
  // 二次 B(0.5) = 0.25·P0 + 0.5·P1 + 0.25·P2
  const q = [[0, 0, 0], [2, 4, 0], [4, 0, 0]];
  const mid = bezierPointAt(q, 0.5);
  assert(vecApprox(mid, [2, 2, 0]), `二次 t=0.5 解析值 [2,2,0]，实得 [${mid}]`);
  assert(vecApprox(bezierPointAt(q, 0), q[0]), '端点插值 B(0)=P0');
  assert(vecApprox(bezierPointAt(q, 1), q[2]), '端点插值 B(1)=Pn');
  // 二次 Bernstein 权在 t=0.25：0.5625/0.375/0.0625
  const q25 = bezierPointAt(q, 0.25);
  assert(vecApprox(q25, [0.5625 * 0 + 0.375 * 2 + 0.0625 * 4, 0.375 * 4, 0]),
    '二次 t=0.25 与 Bernstein 权一致');
}
{
  // 三次 B(0.5) = (P0 + 3P1 + 3P2 + P3)/8
  const c = [[0, 0, 0], [0, 3, 0], [3, 3, 0], [3, 0, 0]];
  assert(vecApprox(bezierPointAt(c, 0.5), [1.5, 2.25, 0]), '三次 t=0.5 = [1.5,2.25,0]');
  assert(vecApprox(bezierPointAt(c, 0), [0, 0, 0]) && vecApprox(bezierPointAt(c, 1), [3, 0, 0]), '三次端点插值');
}
{
  // 高次（7 个控制点 = 6 次）：凸组合仍精确插值端点、且不出现数值爆炸
  const hi = [[0, 0, 0], [1, 2, 1], [2, -1, 2], [3, 3, 0], [4, 0, 1], [5, 2, 2], [6, 1, 0]];
  assert(vecApprox(bezierPointAt(hi, 0), hi[0]) && vecApprox(bezierPointAt(hi, 1), hi[6]), '6 次曲线端点插值');
  assert(bezierPointAt(hi, 0.37).every((x) => Number.isFinite(x)), '6 次曲线 t=0.37 有限');
}
{
  // 凸包性：所有采样点落在控制点 min/max 包围盒内（de Casteljau 是凸组合）
  const pts = [[0, 0, 0], [1, 4, 2], [3, -2, 5], [5, 1, 1]];
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  let inHull = true;
  for (let i = 0; i <= 40; i++) {
    const p = bezierPointAt(pts, i / 40);
    if (!p.every((x, k) => x >= lo[k] - 1e-3 && x <= hi[k] + 1e-3)) { inHull = false; break; }
  }
  assert(inHull, '40 个采样点全部落在控制点凸包内');
}
{
  // 线性退化（2 控制点）：B(t) = P0 + (P1-P0)·t，全程共线
  const seg = [[1, 1, 1], [5, 9, -3]];
  assert(vecApprox(bezierPointAt(seg, 0.5), [3, 5, -1]), '2 点线性退化的中点');
  const t = 0.3;
  assert(vecApprox(bezierPointAt(seg, t), [1 + 4 * t, 1 + 8 * t, 1 - 4 * t]), '线性曲线为直线插值');
}

section('C. 命令解析：段数 / 端点 / 首尾相接 / 样式');
{
  const r = resolveBezier3D({ op: 'bezier3d', points: [[0, 0, 0], [2, 4, 0], [4, 0, 0]], segments: 8 }, {});
  assert(r.ok === true, '正常命令 ok=true');
  assert(r.items.length === 8 && r.items.every((o) => o.type === 'line'), '产出 8 个 line 对象');
  assert(r.meta.degree === 2 && r.meta.segments === 8 && r.meta.pointCount === 9, 'meta：2 次 / 8 段 / 9 采样点');
  assert(vecApprox(r.meta.first, [0, 0, 0]) && vecApprox(r.meta.last, [4, 0, 0]), 'meta 首末点精确等于首末控制点');
  // 段首尾相接：第 i 段终点 = 第 i+1 段起点
  let joined = true;
  for (let i = 0; i < r.items.length - 1; i++) {
    const a = r.items[i].p, b = r.items[i + 1].p;
    if (a.x2 !== b.x1 || a.y2 !== b.y1 || a.z2 !== b.z1) { joined = false; break; }
  }
  assert(joined, '相邻 line 段首尾相接（共用采样点）');
  assert(r.items.every((o) => o.pos[0] === 0 && o.pos[1] === 0 && o.pos[2] === 0), 'line 段 pos 均为原点');
  assert(r.items.every((o) => ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(o.p[k]))), '每段 6 个端点坐标均为有限数');
  assert(r.items.every((o) => o.color === '#4f6bed' && o.opacity === 1), '默认颜色 / 透明度');
}
{
  const r = resolveBezier3D({ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 0], [4, 0, 0]], color: '#e05252', opacity: 5 }, {});
  assert(r.ok && r.items[0].color === '#e05252' && r.items[0].opacity === 1, 'color 覆盖 / opacity 越界钳到 1');
  const r2 = resolveBezier3D({ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 0]], opacity: -3 }, {});
  assert(r2.ok && r2.items[0].opacity === 0.1, 'opacity 下界钳到 0.1');
  const r3 = resolveBezier3D({ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 0]], color: 'not-a-color' }, {});
  assert(r3.ok && r3.items[0].color === '#4f6bed', '非法 color 回落默认值');
}
{
  // 缺省 segments = 24
  const r = resolveBezier3D({ op: 'bezier3d', points: [[0, 0, 0], [1, 1, 1], [2, 0, 2]] }, {});
  assert(r.ok && r.items.length === 24 && r.meta.segments === 24, '缺省 segments=24');
}

section('D. 控制点数量 / 钳制 / 数字字符串容错');
{
  for (let n = BEZIER3D_POINTS_MIN; n <= BEZIER3D_POINTS_MAX; n++) {
    const pts = Array.from({ length: n }, (_, i) => [i, i % 3, -i]);
    const r = resolveBezier3D({ op: 'bezier3d', points: pts, segments: 4 }, {});
    assert(r.ok && r.meta.degree === n - 1, `${n} 个控制点（${n - 1} 次）可用`);
  }
}
{
  // 坐标钳制到 ±10000
  const r = resolveBezier3D({ op: 'bezier3d', points: [[20000, -30000, 0], [1, 2, 3]], segments: 2 }, {});
  assert(r.ok && r.meta.control[0][0] === 10000 && r.meta.control[0][1] === -10000, '控制点坐标钳制 ±10000');
  assert(vecApprox(r.meta.first, [10000, -10000, 0]) && vecApprox(r.meta.last, [1, 2, 3]), '钳制后首末点插值');
}
{
  // 数字字符串容错（含 segments）
  const r = resolveBezier3D({ op: 'bezier3d', points: [['0', '0', '0'], ['2', '4', '0'], ['4', '0', '0']], segments: '8' }, {});
  assert(r.ok && r.items.length === 8, 'points/segments 合法数字字符串被接受');
  assert(vecApprox(r.meta.first, [0, 0, 0]) && vecApprox(r.meta.last, [4, 0, 0]), '数字字符串解析后端点正确');
}

section('E. 采样点标记 / id 避让');
{
  const r = resolveBezier3D({ op: 'bezier3d', id: 'cv', points: [[0, 0, 0], [2, 4, 0], [4, 0, 0]], segments: 6, asPoints: true }, { objects: [] });
  const lines = r.items.filter((o) => o.type === 'line');
  const points = r.items.filter((o) => o.type === 'point');
  assert(lines.length === 6 && points.length === 7, 'asPoints：6 段 + 7 个采样点球');
  assert(points.every((o) => o.p.s > 0 && o.pos.length === 3), '采样点球有半径 s 与 pos');
  // 采样点球位置 = 曲线段端点
  assert(vecApprox(points[0].pos, r.meta.first) && vecApprox(points[6].pos, r.meta.last), '采样点球与曲线首末点一致');
}
{
  const r = resolveBezier3D({ op: 'bezier3d', id: 'cv', points: [[0, 0, 0], [1, 2, 0], [4, 0, 0]], segments: 4 }, { objects: [{ id: 'cv_s1' }, { id: 'cv_s2' }] });
  const ids = r.items.map((o) => o.id);
  assert(new Set(ids).size === ids.length, '生成 id 全局唯一');
  assert(ids[0] !== 'cv_s1' && ids[1] !== 'cv_s2', '与已有 id 冲突时自动避让');
}

section('F. 脏输入原子拒绝');
const bads = [
  [null, '空命令'],
  [{ op: 'bezier3d', points: 'nope' }, 'points 非数组'],
  [{ op: 'bezier3d' }, 'points 缺失'],
  [{ op: 'bezier3d', points: [] }, 'points 空'],
  [{ op: 'bezier3d', points: [[0, 0, 0]] }, 'points 只有 1 个'],
  [{ op: 'bezier3d', points: Array.from({ length: 9 }, () => [0, 0, 0]) }, 'points 9 个超上限'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2]] }, '控制点非三元组'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 'x']] }, '控制点含表达式'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, null, 3]] }, '控制点含 null'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, Infinity]] }, '控制点含 Infinity'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, NaN]] }, '控制点含 NaN'],
  [{ op: 'bezier3d', points: [[0, 0, 0], '1,2,3'] }, '控制点非数组元素'],
  [{ op: 'bezier3d', id: 'bad id!', points: [[0, 0, 0], [1, 2, 3]] }, 'id 含空格标点'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], segments: 0 }, 'segments=0'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], segments: 513 }, 'segments 超上限'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], segments: 3.6 }, 'segments 非整数'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], segments: '4+4' }, 'segments 算式'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], segments: null }, 'segments=null'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], asPoints: 'yes' }, 'asPoints 非布尔'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], asPoints: 1 }, 'asPoints 数字'],
  [{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 3]], opacity: 'abc' }, 'opacity 表达式'],
];
for (const [cmd, name] of bads) {
  assert(resolveBezier3D(cmd, {}).ok === false, `拒绝：${name}`);
}

section('G. 深度只读性');
{
  const ctrl = Object.freeze([Object.freeze([0, 0, 0]), Object.freeze([2, 4, 0]), Object.freeze([4, 0, 0])]);
  const cmd = Object.freeze({ op: 'bezier3d', id: 'cv', points: ctrl, segments: 4 });
  const obj = Object.freeze({ id: 'cv' });
  const state = Object.freeze({ objects: Object.freeze([obj]) });
  const r = resolveBezier3D(cmd, state);
  assert(r.ok === true, '冻结入参仍正常解析');
  assert(cmd.points[1][1] === 4 && state.objects[0].id === 'cv', '入参未被修改');
  r.items[0].p.x1 = 999;
  r.meta.control[1][1] = 999;
  r.meta.first[0] = 999;
  assert(cmd.points[1][1] === 4, '改动产物不回写入参');
  // bezierPointAt 也不修改控制点
  const q = Object.freeze([Object.freeze([0, 0, 0]), Object.freeze([2, 4, 0]), Object.freeze([4, 0, 0])]);
  bezierPointAt(q, 0.5);
  assert(q[1][1] === 4, 'bezierPointAt 不改控制点');
}

section('H. 执行器集成');
{
  let added = [];
  const api = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return o.id; } };
  const r = applyBoard3DCommands([{ op: 'bezier3d', id: 'cv', points: [[0, 0, 0], [2, 4, 0], [4, 0, 0]], segments: 6 }], api);
  assert(r[0].ok === true && r[0].count === 6, '执行器生成 6 段并回报 ok');
  assert(added.length === 6 && added.every((o) => o.type === 'line'), '6 个 line 落地');
  assert(Array.isArray(r[0].created) && r[0].created.length === 6, 'created 列表完整');
  assert(r[0].meta && r[0].meta.degree === 2, '执行器透传 meta（次数）');
}
{
  // 2D 命令隔离 + 脏 bezier 拒绝
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'add', type: 'point' }, { op: 'bezier3d', points: 'bad' }], api);
  assert(r[0].ok === false && r[1].ok === false, '2D 命令被拒、脏 bezier 被拒');
}
{
  // 同批先 add3d 再 bezier3d：不冲突，各自落地
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const r = applyBoard3DCommands([
    { op: 'add3d', id: 'cube', type: 'box' },
    { op: 'bezier3d', id: 'cv', points: [[0, 0, 0], [1, 2, 1], [2, 0, 0]], segments: 3 },
  ], api);
  assert(r[0].ok === true && r[1].ok === true && r[1].count === 3, '同批先建对象再画曲线均成功');
}
{
  // 纯函数已按 state 避开已有 id，故执行器不产生冲突、全部成功落地
  const api = { getState: () => ({ objects: [{ id: 'cv_s1' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'bezier3d', id: 'cv', points: [[0, 0, 0], [1, 2, 1]], segments: 3 }], api);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名对象时自动避让、无冲突全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const api of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 1]], segments: 3 }], api);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 返回 false 分项失败
  const api = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 1]], segments: 3 }], api);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 3, 'api.add 失败如实分项回报');
}
{
  // maxCommands 保护（bezier 自身是一次命令生成多对象，仍受命令条数上限约束）
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const cmds = Array.from({ length: 4 }, () => ({ op: 'bezier3d', points: [[0, 0, 0], [1, 2, 1]], segments: 3 }));
  const r = applyBoard3DCommands(cmds, api, { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  // 未知 3D 命令仍由 default 拒绝，不影响既有
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'arc3d', points: [[0, 0, 0]] }], api);
  assert(r[0].ok === false, '未实现的 arc3d 仍被拒绝（未误开新 op）');
}

section('I. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_BEZIER_PROMPT_OPS.length === 1 && BOARD3D_BEZIER_PROMPT_OPS[0] === 'bezier3d', '提示词侧 BEZIER_PROMPT_OPS = [bezier3d]');
assert(BOARD3D_BEZIER_PROMPT.includes('bezier3d') && BOARD3D_BEZIER_PROMPT.includes('points') && BOARD3D_BEZIER_PROMPT.includes('de Casteljau'), 'BEZIER 提示词含命令说明与核心参数');
assert(BOARD3D_HELIX_PROMPT.includes('helix3d'), '既有 HELIX 提示词段仍在');
// 共享文件「只追加」：BEZIER 段必须在 HELIX 段之后，且 HELIX 完整文本仍是前缀子序列
const iHelix = promptSrc.indexOf('export const BOARD3D_HELIX_PROMPT =');
const iBezier = promptSrc.indexOf('export const BOARD3D_BEZIER_PROMPT =');
assert(iHelix > 0 && iBezier > iHelix, 'BEZIER 追加段位于 HELIX 段之后（末尾追加，未插入 / 未替换）');
assert(promptSrc.indexOf('export const BOARD3D_BEZIER_PROMPT_OPS') < iBezier, 'BEZIER_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个球') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个球') === '2d', '2D 模式路由不变');

section('J. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
assert(page.includes('bezier3d') && page.includes('helix3d') && page.includes('align3d'), '页面 AI 面板 tip 新增 bezier3d 且保留 helix3d/align3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("bz.op !== 'bezier3d'") && aiPanel.includes("hx.op !== 'helix3d'"), '前端新增贝塞尔展示且保留既有螺旋线展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_BEZIER_PROMPT') && backend.includes('BOARD3D_HELIX_PROMPT'), '后端 3D 拼接含 bezier 且保留 helix');
assert(existsSync(join(ROOT, 'js/board3d-bezier.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

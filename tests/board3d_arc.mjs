/**
 * 3D 空间圆弧命令（arc3d · D16）无头回归。
 *
 * 覆盖：arcPointAt / resolveArc3D 纯函数（圆的参数方程数学：三轴平面 / 起止角与扫角 /
 *       sweep 负值反向 / 采样点恒落在圆上 / 圆心偏移 / 坐标钳制 / asPoints / id 避让 /
 *       段首尾相接 / 各类脏输入原子拒绝 / 深度只读性）、执行器集成（逐段落地为 line、
 *       可选 point、id 冲突避让、getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、
 *       maxCommands）、共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_arc.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_BEZIER_PROMPT,
  BOARD3D_ARC_PROMPT_OPS, BOARD3D_ARC_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
  BOARD3D_ARC_OPS, BOARD3D_COMPLETE8_OPS,
} from '../js/board3d-executor.js';
import {
  ARC3D_SEGMENTS_MIN, ARC3D_SEGMENTS_MAX, ARC3D_MAX_SEGMENTS,
  ARC3D_SEGMENTS_DEFAULT, ARC3D_AXES, arcPointAt, resolveArc3D,
} from '../js/board3d-arc.js';
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
const dist = (p, c) => Math.sqrt((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);

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
assert(BOARD3D_ARC_OPS.length === 1 && BOARD3D_ARC_OPS[0] === 'arc3d', 'ARC_OPS = [arc3d]');
assert(BOARD3D_COMPLETE8_OPS.length === 17 && BOARD3D_COMPLETE8_OPS.includes('arc3d'), 'COMPLETE8 完整集 17 条含 arc3d');
assert(BOARD3D_COMPLETE8_OPS.slice(0, 16).join(',') === BOARD3D_COMPLETE7_OPS.join(','), 'COMPLETE8 前 16 条与 COMPLETE7 逐项一致（纯追加）');
assert(ARC3D_SEGMENTS_MIN === 1 && ARC3D_SEGMENTS_MAX === 512, '采样段数区间 [1,512]');
assert(ARC3D_MAX_SEGMENTS === 512 && ARC3D_SEGMENTS_DEFAULT === 24, '段数上限 512 / 默认 24');
assert(ARC3D_AXES.join(',') === 'x,y,z', '轴白名单 x/y/z');

section('B. arcPointAt 参数方程数学（三轴 / 起止角 / 半径 / 圆心）');
{
  // axis='z'（XY 平面）：0°→(r,0,0)，90°→(0,r,0)
  const c = [0, 0, 0], r = 2;
  assert(vecApprox(arcPointAt(c, r, 'z', 0), [2, 0, 0]) && vecApprox(arcPointAt(c, r, 'z', 90), [0, 2, 0]), 'XY 平面 0°/90° 端点正确');
  assert(vecApprox(arcPointAt(c, r, 'z', 180), [-2, 0, 0]) && vecApprox(arcPointAt(c, r, 'z', 270), [0, -2, 0]), 'XY 平面 180°/270° 端点正确');
  // axis='x'（YZ 平面）：x 恒为圆心 x，cos 落在 y、sin 落在 z
  assert(vecApprox(arcPointAt(c, r, 'x', 0), [0, 2, 0]) && vecApprox(arcPointAt(c, r, 'x', 90), [0, 0, 2]), 'YZ 平面圆弧两分量正确');
  // axis='y'（XZ 平面）：y 恒为圆心 y
  assert(vecApprox(arcPointAt(c, r, 'y', 0), [2, 0, 0]) && vecApprox(arcPointAt(c, r, 'y', 90), [0, 0, 2]), 'XZ 平面圆弧两分量正确');
}
{
  // 圆心偏移：各轴采样点相对圆心的距离恒为 r
  const c = [3, -2, 5], r = 4;
  for (const axis of ['x', 'y', 'z']) {
    let ok = true;
    for (let d = 0; d < 360; d += 15) {
      if (!approx(dist(arcPointAt(c, r, axis, d), c), r)) { ok = false; break; }
    }
    assert(ok, `${axis.toUpperCase()} 轴平面：整圈采样点到圆心距离恒为 ${r}`);
  }
  assert(vecApprox(arcPointAt(c, 2, 'z', 0), [5, -2, 5]), '圆心偏移后 0° 端点 = [cx+r, cy, cz]');
}
{
  // 负角度 / 超 360°：cos/sin 周期性仍落在圆上
  const c = [0, 0, 0], r = 1;
  assert(approx(dist(arcPointAt(c, r, 'z', -90), c), 1) && vecApprox(arcPointAt(c, r, 'z', -90), [0, -1, 0]), '负角度 -90° 端点正确');
  assert(vecApprox(arcPointAt(c, r, 'z', 450), [0, 1, 0]), '450° 与 90° 同点（周期性）');
}
{
  // 坐标钳制：半径巨大时输出不越 ±10000、有限
  const p = arcPointAt([0, 0, 0], 1e9, 'z', 45);
  assert(p.every((x) => Number.isFinite(x) && Math.abs(x) <= 10000), '超大半径输出被钳制到 ±10000 且有限');
}

section('C. resolveArc3D 命令解析（默认 / 采样 / 起止角 / 样式 / id 避让）');
{
  const r = resolveArc3D({ op: 'arc3d' }, {});
  assert(r.ok === true, '空参数给默认值仍成功');
  assert(r.items.length === ARC3D_SEGMENTS_DEFAULT, `默认段数 = ${ARC3D_SEGMENTS_DEFAULT}`);
  assert(r.meta.id === 'arc' && r.meta.axis === 'z' && r.meta.radius === 1, '默认 id=arc / axis=z / radius=1');
  assert(r.meta.startAngle === 0 && r.meta.sweep === 90 && r.meta.endAngle === 90, '默认起始角 0 / 扫角 90 / 终点角 90');
  assert(r.items.every((it) => it.type === 'line'), '全部段为 line 图元');
  assert(r.items.every((it) => Array.isArray(it.p) === false && it.p && Number.isFinite(it.p.x1)), 'line 端点写入 p，字段完整');
}
{
  // 半圆：0° → 180°，采样点落在半径 2 的圆上，首末端点正确
  const r = resolveArc3D({ op: 'arc3d', id: 'semi', radius: 2, startAngle: 0, sweep: 180, segments: 36 }, {});
  assert(r.ok === true && r.items.length === 36, '半圆生成 36 段');
  assert(vecApprox(r.meta.first, [2, 0, 0]) && vecApprox(r.meta.last, [-2, 0, 0]), '半圆首末端点 [2,0,0] → [-2,0,0]');
  let onCircle = true;
  for (const it of r.items) {
    if (!approx(Math.hypot(it.p.x1, it.p.y1), 2) || !approx(Math.hypot(it.p.x2, it.p.y2), 2)) { onCircle = false; break; }
  }
  assert(onCircle, '半圆所有段端点落在半径 2 的圆上');
}
{
  // 段首尾相接：上一段终点 = 下一段起点
  const r = resolveArc3D({ op: 'arc3d', radius: 3, sweep: 270, segments: 24 }, {});
  let joined = true;
  for (let i = 0; i < r.items.length - 1; i++) {
    const a = r.items[i].p, b = r.items[i + 1].p;
    if (!vecApprox([a.x2, a.y2, a.z2], [b.x1, b.y1, b.z1])) { joined = false; break; }
  }
  assert(joined, '相邻 line 段首尾相接无断口');
}
{
  // sweep 负值反向：0 → -90，终点 (0,-r)
  const r = resolveArc3D({ op: 'arc3d', radius: 2, sweep: -90, segments: 8 }, {});
  assert(r.ok === true && vecApprox(r.meta.first, [2, 0, 0]) && vecApprox(r.meta.last, [0, -2, 0]), '负 sweep 反向扫弧首末点正确');
}
{
  // 三轴 + 圆心 + 样式 + asPoints
  const r = resolveArc3D({
    op: 'arc3d', id: 'arch', axis: 'y', center: [0, 1, 0], radius: 3,
    startAngle: 0, sweep: 180, segments: 10, asPoints: true, color: '#e05252', opacity: 0.6,
  }, {});
  assert(r.ok === true, '三轴/圆心/asPoints 组合命令成功');
  assert(r.items.filter((it) => it.type === 'line').length === 10, '10 段 line');
  assert(r.items.filter((it) => it.type === 'point').length === 11, 'asPoints 生成 11 个采样点标记');
  assert(r.items.every((it) => it.color === '#e05252' && it.opacity === 0.6), '样式透传到所有段与点');
  assert(r.items.filter((it) => it.type === 'point').every((it) => it.pos[1] === 1), 'axis=y 平面内采样点 y 恒等于圆心 y=1');
}
{
  // 数字字符串容错
  const r = resolveArc3D({ op: 'arc3d', radius: '2', startAngle: '0', sweep: '90', segments: '12' }, {});
  assert(r.ok === true && r.items.length === 12 && r.meta.radius === 2, '数字字符串参数容错');
}
{
  // id 避让：state 已有同名对象
  const r = resolveArc3D({ op: 'arc3d', id: 'arc', radius: 1, segments: 2 }, { objects: [{ id: 'arc_s1' }] });
  assert(r.ok === true && r.items[0].id === 'arc_s1_2', '已有同名段 arc_s1 时自动避让为 arc_s1_2');
  const ids = new Set(r.items.map((it) => it.id));
  assert(ids.size === r.items.length && !ids.has('arc_s1'), '生成的所有 id 唯一且不与已有 id 冲突');
}

section('D. 脏输入原子拒绝（零副作用）');
const dirty = [
  [{ op: 'arc3d', id: 123 }, 'id 非字符串'],
  [{ op: 'arc3d', id: 'bad id!' }, 'id 含非法字符'],
  [{ op: 'arc3d', axis: 'w' }, 'axis 非法'],
  [{ op: 'arc3d', axis: 1 }, 'axis 非字符串'],
  [{ op: 'arc3d', radius: 0 }, 'radius = 0'],
  [{ op: 'arc3d', radius: -1 }, 'radius 为负'],
  [{ op: 'arc3d', radius: 'abc' }, 'radius 非数字'],
  [{ op: 'arc3d', radius: null }, 'radius null'],
  [{ op: 'arc3d', startAngle: 'expr' }, 'startAngle 非数字'],
  [{ op: 'arc3d', sweep: NaN }, 'sweep NaN'],
  [{ op: 'arc3d', sweep: Infinity }, 'sweep Infinity'],
  [{ op: 'arc3d', segments: 0 }, 'segments = 0'],
  [{ op: 'arc3d', segments: 513 }, 'segments 超上限'],
  [{ op: 'arc3d', segments: 3.6 }, 'segments 非整数'],
  [{ op: 'arc3d', segments: 'x' }, 'segments 非数字'],
  [{ op: 'arc3d', asPoints: 'yes' }, 'asPoints 非布尔'],
  [{ op: 'arc3d', opacity: 'bad' }, 'opacity 非数字'],
  [{ op: 'arc3d', center: [0, 0] }, 'center 非三元组'],
  [{ op: 'arc3d', center: [0, 'x', 0] }, 'center 含非数值'],
];
for (const [cmd, label] of dirty) {
  assert(resolveArc3D(cmd, {}).ok === false, `拒绝：${label}`);
}
assert(resolveArc3D(null, {}).ok === false && resolveArc3D(undefined, {}).ok === false, '拒绝空命令');
assert(resolveArc3D('arc3d', {}).ok === false, '拒绝非对象命令');

section('E. 深度只读性（入参不被修改）');
{
  const cmd = Object.freeze({
    op: 'arc3d', id: 'ro', axis: 'z', center: Object.freeze([1, 2, 3]),
    radius: 2, startAngle: 0, sweep: 90, segments: 4, asPoints: true,
  });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_s1' })]) });
  const r = resolveArc3D(cmd, state);
  assert(r.ok === true, '冻结入参仍可解析成功');
  assert(cmd.id === 'ro' && cmd.center[0] === 1 && state.objects.length === 1, '命令与 state 未被修改');
  r.items[0].p.x1 = 999;
  assert(cmd.radius === 2, '改动输出不回流到入参');
}

section('F. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const r = applyBoard3DCommands([{ op: 'arc3d', id: 'a', radius: 1, segments: 4 }], api());
  assert(r[0].ok === true && r[0].count === 4 && r[0].created.length === 4, '执行器逐段落地 4 段');
  assert(r[0].meta && r[0].meta.op !== 'arc3d' || r[0].op === 'arc3d', '执行器回执 op=arc3d');
}
{
  const r = applyBoard3DCommands([{ op: 'arc3d', radius: 1, segments: 3, asPoints: true }], api());
  assert(r[0].ok === true && r[0].count === 7, 'asPoints 执行器落地 3 段 line + 4 个点标记共 7 个对象');
}
{
  // 已有同名对象：id 避让全部成功
  const a = { getState: () => ({ objects: [{ id: 'a_s1' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'arc3d', id: 'a', radius: 1, segments: 2 }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名段自动避让、全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'arc3d', radius: 1, segments: 2 }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 失败分项回报
  const a = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'arc3d', radius: 1, segments: 3 }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 3, 'api.add 失败如实分项回报');
}
{
  // 2D 隔离：arc3d 不认识 2D 命令；未知 3D 命令仍拒绝
  const r = applyBoard3DCommands([{ op: 'arc', center: [0, 0], r: 2 }], api());
  assert(r[0].ok === false, '2D arc 命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder' }], api());
  assert(r2[0].ok === false, '未定义的占位 3D 命令仍被 default 拒绝');
}
{
  // maxCommands
  const cmds = Array.from({ length: 4 }, () => ({ op: 'arc3d', radius: 1, segments: 2 }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  // 脏参数在执行器内原子拒绝（零副作用）
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'arc3d', radius: -1 }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝脏参数且未调用 add（零副作用）');
}

section('G. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_ARC_PROMPT_OPS.length === 1 && BOARD3D_ARC_PROMPT_OPS[0] === 'arc3d', '提示词侧 ARC_PROMPT_OPS = [arc3d]');
assert(BOARD3D_ARC_PROMPT.includes('arc3d') && BOARD3D_ARC_PROMPT.includes('sweep') && BOARD3D_ARC_PROMPT.includes('startAngle'), 'ARC 提示词含命令说明与核心参数');
assert(BOARD3D_ARC_PROMPT.includes('axis') && BOARD3D_ARC_PROMPT.includes('segments') && BOARD3D_ARC_PROMPT.includes('asPoints'), 'ARC 提示词含 axis/segments/asPoints');
assert(BOARD3D_HELIX_PROMPT.includes('helix3d') && BOARD3D_BEZIER_PROMPT.includes('bezier3d'), '既有 HELIX/BEZIER 提示词段仍在');
const iBezier = promptSrc.indexOf('export const BOARD3D_BEZIER_PROMPT =');
const iArc = promptSrc.indexOf('export const BOARD3D_ARC_PROMPT =');
assert(iBezier > 0 && iArc > iBezier, 'ARC 追加段位于 BEZIER 段之后（末尾追加，未插入 / 未替换）');
assert(promptSrc.indexOf('export const BOARD3D_ARC_PROMPT_OPS') < iArc, 'ARC_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个半圆') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个半圆') === '2d', '2D 模式路由不变');
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
assert(page.includes('arc3d') && page.includes('bezier3d') && page.includes('helix3d'), '页面 AI tip 新增 arc3d 且保留 bezier3d/helix3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("ac.op !== 'arc3d'") && aiPanel.includes("bz.op !== 'bezier3d'"), '前端新增圆弧展示且保留既有贝塞尔展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_ARC_PROMPT') && backend.includes('BOARD3D_BEZIER_PROMPT'), '后端 3D 拼接含 arc 且保留 bezier');
assert(existsSync(join(ROOT, 'js/board3d-arc.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

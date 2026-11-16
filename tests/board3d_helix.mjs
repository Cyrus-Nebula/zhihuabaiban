/**
 * 3D 空间螺旋线 / 弹簧命令（helix3d · D14）无头回归。
 *
 * 覆盖：resolveHelix3D 纯函数（三轴参数方程数学 / 半径·螺距·圈数·每段数·相位·中心·
 *       采样点 / pitch=0 平面圆 / 负 pitch 反向 / 段数上限原子拒绝 / 类型与数值脏输入拒绝 /
 *       id 避让 / 深度只读性）、执行器集成（逐段落地为 line、可选 point、id 冲突分项失败、
 *       getState 缺失 / 抛错降级、2D 命令隔离、脏 helix 拒绝、maxCommands）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_helix.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_RADIAL_PROMPT_OPS,
  BOARD3D_MIRROR_PROMPT_OPS, BOARD3D_GRID_PROMPT_OPS, BOARD3D_ALIGN_PROMPT_OPS,
  BOARD3D_HELIX_PROMPT_OPS, BOARD3D_HELIX_PROMPT, BOARD3D_ALIGN_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS,
} from '../js/board3d-executor.js';
import {
  HELIX3D_TURNS_MAX, HELIX3D_SEG_PER_TURN_MIN, HELIX3D_SEG_PER_TURN_MAX,
  HELIX3D_MAX_SEGMENTS, HELIX3D_AXES, resolveHelix3D,
} from '../js/board3d-helix.js';
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

section('A. 常量与历史契约（逐字不变）');
assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 恒为 7 条');
assert(BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'MEASURE 1 / ALL 8 条');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9, 'TRANSFORM 1 / FULL 9 条');
assert(BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'DUPLICATE 1 / COMPLETE 10 条');
assert(BOARD3D_RADIAL_OPS.length === 1 && BOARD3D_COMPLETE2_OPS.length === 11, 'RADIAL 1 / COMPLETE2 11 条');
assert(BOARD3D_MIRROR_OPS.length === 1 && BOARD3D_COMPLETE3_OPS.length === 12, 'MIRROR 1 / COMPLETE3 12 条');
assert(BOARD3D_GRID_OPS.length === 1 && BOARD3D_COMPLETE4_OPS.length === 13, 'GRID 1 / COMPLETE4 13 条');
assert(BOARD3D_ALIGN_OPS.length === 1 && BOARD3D_COMPLETE5_OPS.length === 14, 'ALIGN 1 / COMPLETE5 14 条');
assert(BOARD3D_HELIX_OPS.length === 1 && BOARD3D_HELIX_OPS[0] === 'helix3d', 'HELIX_OPS = [helix3d]');
assert(BOARD3D_COMPLETE6_OPS.length === 15 && BOARD3D_COMPLETE6_OPS.includes('helix3d'), 'COMPLETE6 完整集 15 条含 helix3d');
assert(HELIX3D_TURNS_MAX === 12, 'HELIX3D_TURNS_MAX = 12');
assert(HELIX3D_SEG_PER_TURN_MIN === 3 && HELIX3D_SEG_PER_TURN_MAX === 48, '每段数区间 [3,48]');
assert(HELIX3D_MAX_SEGMENTS === 512, '段数上限 512');
assert(HELIX3D_AXES.join(',') === 'x,y,z', '轴白名单 x/y/z');

section('B. 纯函数数学（绕 Z 轴 · 默认参数）');
{
  const r = resolveHelix3D({ op: 'helix3d', radius: 1, pitch: 1, turns: 2, segments: 12 }, {});
  assert(r.ok === true, '正常命令 ok=true');
  assert(r.meta.segmentCount === 24, '2 圈 × 12 段 = 24 段');
  assert(r.items.length === 24 && r.items.every((o) => o.type === 'line'), '产出 24 个 line 对象');
  const p0 = r.meta.first, pEnd = r.meta.last;
  assert(approx(p0[0], 1) && approx(p0[1], 0) && approx(p0[2], 0), '首点 (1,0,0)（phase=0 从 +X 起）');
  assert(approx(pEnd[0], 1) && approx(pEnd[1], 0) && approx(pEnd[2], 2), '末点 (1,0,2)（2 圈上升 2）');
  // 1/4 圈处应到 +Y：段 index = 12/4 = 3
  const q3 = r.items[2].p; // 第 3 段终点 = 采样点 3
  assert(approx(q3.x2, 0, 1e-2) && approx(q3.y2, 1, 1e-2), '1/4 圈处到达 +Y（cos/sin 正确）');
  // 所有 line 段 pos 为原点、端点写入 p（绝对坐标）
  assert(r.items.every((o) => o.pos[0] === 0 && o.pos[1] === 0 && o.pos[2] === 0), 'line 段 pos 均为原点');
  assert(r.items.every((o) => ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(o.p[k]))), '每段 6 个端点坐标均为有限数');
}

section('C. 三轴 / 相位 / 中心 / pitch 符号');
{
  const x = resolveHelix3D({ op: 'helix3d', axis: 'x', radius: 2, pitch: 3, turns: 1, segments: 8 }, {});
  // axis=x：轴向分量在 x，另两分量在 y/z
  assert(x.ok && approx(x.meta.first[0], 0) && approx(x.meta.first[1], 2), '绕 X 轴：首点 x=中心、y=半径');
  assert(approx(x.meta.last[0], 3), '绕 X 轴：末点 x=螺距×圈数=3');
}
{
  const y = resolveHelix3D({ op: 'helix3d', axis: 'y', radius: 2, pitch: 3, turns: 1, segments: 8 }, {});
  assert(y.ok && approx(y.meta.last[1], 3), '绕 Y 轴：末点 y=螺距×圈数=3');
  assert(approx(y.meta.first[0], 2), '绕 Y 轴：首点 x=半径');
}
{
  const neg = resolveHelix3D({ op: 'helix3d', pitch: -2, turns: 2, segments: 6 }, {});
  assert(neg.ok && approx(neg.meta.last[2], -4), '负 pitch：2 圈下降 4');
}
{
  const flat = resolveHelix3D({ op: 'helix3d', pitch: 0, turns: 1, segments: 6 }, {});
  assert(flat.ok && approx(flat.meta.last[2], 0) && approx(flat.meta.first[0], flat.meta.last[0]), 'pitch=0：平面圆首尾 z 相同、回到同点');
}
{
  const c = resolveHelix3D({ op: 'helix3d', radius: 1, center: [10, -5, 2], turns: 1, segments: 4 }, {});
  assert(c.ok && c.meta.center[0] === 10 && approx(c.meta.first[0], 11) && approx(c.meta.first[2], 2), 'center 平移：首点 = 中心 + 半径偏移');
}
{
  const ph = resolveHelix3D({ op: 'helix3d', radius: 1, phase: 90, turns: 1, segments: 4 }, {});
  assert(ph.ok && approx(ph.meta.first[0], 0, 1e-2) && approx(ph.meta.first[1], 1, 1e-2), 'phase=90° 从 +Y 起');
}

section('D. 采样点标记 / id 避让');
{
  const r = resolveHelix3D({ op: 'helix3d', id: 'sp', turns: 1, segments: 6, asPoints: true }, { objects: [] });
  const lines = r.items.filter((o) => o.type === 'line');
  const points = r.items.filter((o) => o.type === 'point');
  assert(lines.length === 6 && points.length === 7, 'asPoints：6 段 + 7 个采样点球');
  assert(points.every((o) => o.p.s > 0 && o.pos.length === 3), '采样点球有半径 s 与 pos');
}
{
  const r = resolveHelix3D({ op: 'helix3d', id: 'sp', turns: 1, segments: 4 }, { objects: [{ id: 'sp_s1' }, { id: 'sp_s2' }] });
  const ids = r.items.map((o) => o.id);
  assert(new Set(ids).size === ids.length, '生成 id 全局唯一');
  assert(ids[0] !== 'sp_s1' && ids[1] !== 'sp_s2', '与已有 id 冲突时自动避让');
}

section('E. 脏输入原子拒绝');
const bads = [
  [null, '空命令'],
  [{ op: 'helix3d', id: 'bad id!' }, 'id 含空格标点'],
  [{ op: 'helix3d', axis: 'w' }, '非法 axis'],
  [{ op: 'helix3d', radius: 0 }, 'radius=0'],
  [{ op: 'helix3d', radius: -1 }, 'radius 负'],
  [{ op: 'helix3d', radius: '1abc' }, 'radius 表达式'],
  [{ op: 'helix3d', pitch: null }, 'pitch=null'],
  [{ op: 'helix3d', turns: 0 }, 'turns=0'],
  [{ op: 'helix3d', turns: -2 }, 'turns 负'],
  [{ op: 'helix3d', turns: '1+1' }, 'turns 算式'],
  [{ op: 'helix3d', segments: 2 }, 'segments 过小'],
  [{ op: 'helix3d', segments: 49 }, 'segments 过大'],
  [{ op: 'helix3d', segments: 3.6 }, 'segments 非整数'],
  [{ op: 'helix3d', phase: 'x' }, 'phase 表达式'],
  [{ op: 'helix3d', asPoints: 'yes' }, 'asPoints 非布尔'],
  [{ op: 'helix3d', turns: 12, segments: 48 }, '总段数超上限'],
];
for (const [cmd, name] of bads) {
  assert(resolveHelix3D(cmd, {}).ok === false, `拒绝：${name}`);
}
// 数字字符串容错（合法）
assert(resolveHelix3D({ op: 'helix3d', radius: '1.5', pitch: '0.8', turns: '2', segments: '6' }, {}).ok === true,
  '合法数字字符串被接受');

section('F. 深度只读性');
{
  const cmd = Object.freeze({ op: 'helix3d', id: 'sp', center: Object.freeze([1, 2, 3]), radius: 1, turns: 1, segments: 4 });
  const obj = Object.freeze({ id: 'sp' });
  const state = Object.freeze({ objects: Object.freeze([obj]) });
  const r = resolveHelix3D(cmd, state);
  assert(r.ok === true, '冻结入参仍正常解析');
  assert(cmd.center[0] === 1 && state.objects[0].id === 'sp', '入参未被修改');
  r.items[0].p.x1 = 999;
  r.meta.first[0] = 999;
  assert(cmd.center[0] === 1, '改动产物不回写入参');
}

section('G. 执行器集成');
{
  let added = [];
  const api = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return o.id; } };
  const r = applyBoard3DCommands([{ op: 'helix3d', id: 'sp', radius: 1, pitch: 0.5, turns: 2, segments: 6 }], api);
  assert(r[0].ok === true && r[0].count === 12, '执行器生成 12 段并回报 ok');
  assert(added.length === 12 && added.every((o) => o.type === 'line'), '12 个 line 落地');
  assert(Array.isArray(r[0].created) && r[0].created.length === 12, 'created 列表完整');
}
{
  // 2D 命令隔离 + 脏 helix 拒绝
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'add', type: 'point' }, { op: 'helix3d', radius: 'bad' }], api);
  assert(r[0].ok === false && r[1].ok === false, '2D 命令被拒、脏 helix 被拒');
}
{
  // 纯函数已按 state 避开已有 id，故执行器不产生冲突、全部成功落地
  const api = { getState: () => ({ objects: [{ id: 'sp_s1' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'helix3d', id: 'sp', turns: 1, segments: 3 }], api);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名对象时自动避让、无冲突全部成功');
}
{
  // getState 缺失 / 抛错降级
  for (const api of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'helix3d', turns: 1, segments: 3 }], api);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  // api.add 返回 false 分项失败
  const api = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'helix3d', turns: 1, segments: 3 }], api);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 3, 'api.add 失败如实分项回报');
}
{
  // maxCommands 保护（helix 自身是一次命令生成多对象，仍受命令条数上限约束）
  const api = { getState: () => ({ objects: [] }), add: (o) => o.id };
  const cmds = Array.from({ length: 4 }, () => ({ op: 'helix3d', turns: 1, segments: 3 }));
  const r = applyBoard3DCommands(cmds, api, { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}

section('H. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_HELIX_PROMPT_OPS.length === 1 && BOARD3D_HELIX_PROMPT_OPS[0] === 'helix3d', '提示词侧 HELIX_PROMPT_OPS = [helix3d]');
assert(BOARD3D_HELIX_PROMPT.includes('helix3d') && BOARD3D_HELIX_PROMPT.includes('pitch') && BOARD3D_HELIX_PROMPT.includes('turns'), 'HELIX 提示词含命令说明与核心参数');
assert(BOARD3D_ALIGN_PROMPT.includes('align3d'), '既有 ALIGN 提示词段仍在');
assert(resolveBoardMode({ mode: '3d' }, '画个球') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个球') === '2d', '2D 模式路由不变');

section('I. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
assert(page.includes('helix3d') && page.includes('align3d'), '页面 AI 面板提示新增 helix3d 且保留 align3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("hx.op !== 'helix3d'") && aiPanel.includes("al.op !== 'align3d'"), '前端新增螺旋线展示且保留既有对齐展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_HELIX_PROMPT') && backend.includes('BOARD3D_ALIGN_PROMPT'), '后端 3D 拼接含 helix 且保留 align');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

/**
 * 2D 画板 · parseFunctionSegments 无头单测（AI 作图对标大角几何·小步增量 2026-11-17 第十一轮）
 *
 * 本轮给 function 命令补「分段裁剪 / 多区间定义域」：segments 白名单 + exclude 黑名单。
 * parseFunctionSegments 是 js/executor.js 里的模块级纯函数（不依赖 JSXGraph / DOM），
 * Node 22 的 ESM 语法探测可直接 import，无需 package.json（避免 Pages 构建被触发）。
 *
 * 覆盖：不写分段时 active=false（旧行为零回归）、多段并集、挖洞黑名单、两者叠加、
 * 倒序交换、NaN/非法项丢弃、重叠与相邻段合并、钳制到 from~to、12 段上限、
 * 区间边界闭区间语义、summary 回读文本、inRange 判定。
 * 真实调用 parseFunctionSegments 做断言，不做静态正则替代。
 * 运行：node tests/board2d_function_segments_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId。
 */
import { parseFunctionSegments } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('A. 不写分段 → active=false（旧命令零回归）');
{
  const s = parseFunctionSegments({ op: 'function', expr: 'x^2', from: -5, to: 5 }, -5, 5);
  ok(s.active === false, '无 segments/exclude 时 active=false');
  ok(s.inRange(-5) && s.inRange(0) && s.inRange(5), '所有 x 都可见（走原整段出图路径）');
  ok(s.summary === '', 'summary 为空，describe 回读不追加分段文本');
  const yOnly = parseFunctionSegments({ op: 'function', expr: 'x^2', ymin: 0 }, -10, 10);
  ok(yOnly.active === false, '只写 ymin/ymax 值域裁剪不误触发分段');
}

section('B. segments 白名单：多段并集');
{
  const s = parseFunctionSegments({ segments: [[-5, -1], [1, 5]] }, -5, 5);
  ok(s.active === true, 'active=true');
  ok(eq(s.segments, [[-5, -1], [1, 5]]), '两段按起点排序保留');
  ok(s.inRange(-5) && s.inRange(-3) && s.inRange(-1), '第一段内可见（含端点）');
  ok(s.inRange(1) && s.inRange(3) && s.inRange(5), '第二段内可见（含端点）');
  ok(!s.inRange(0) && !s.inRange(-0.5) && !s.inRange(0.5), '中间缺口不可见（段间断开）');
  ok(!s.inRange(-6) && !s.inRange(6), '整体定义域外不可见');
  ok(s.summary.includes('[-5,-1]') && s.summary.includes('[1,5]'), 'summary 回读两段');
}

section('C. exclude 黑名单：挖洞去间断');
{
  const s = parseFunctionSegments({ op: 'function', expr: '1/x', exclude: [[-1, 1]] }, -5, 5);
  ok(s.active === true, 'active=true');
  ok(eq(s.segments, []), '无白名单');
  ok(eq(s.exclude, [[-1, 1]]), 'exclude 归一后一段');
  ok(s.inRange(-5) && s.inRange(-2) && s.inRange(2) && s.inRange(5), '洞外可见');
  ok(!s.inRange(0) && !s.inRange(-1) && !s.inRange(1), '洞内（含端点）不可见');
  ok(s.summary.includes('exclude=[-1,1]'), 'summary 回读 exclude');
}

section('D. segments + exclude 叠加（先并集后相减）');
{
  const s = parseFunctionSegments({ segments: [[-5, 0], [0, 5]], exclude: [[-0.2, 0.2]] }, -5, 5);
  ok(eq(s.segments, [[-5, 5]]), '相邻两段自动合并成整段');
  ok(s.inRange(-3) && s.inRange(3), '两侧可见');
  ok(!s.inRange(0) && !s.inRange(0.1), '中间被 exclude 挖掉');
  ok(s.summary.includes('segments=') && s.summary.includes('exclude='), 'summary 同时回读两者');
}

section('E. 归一：倒序交换 / NaN 丢弃 / 重叠与相邻合并 / 钳制');
{
  const s = parseFunctionSegments({ segments: [[5, 1], [-3, -1], [NaN, 2], [1, 3], [3, 4]] }, -5, 5);
  ok(eq(s.segments, [[-3, -1], [1, 5]]), '倒序交换 + NaN 丢弃 + 重叠/相邻合并');
  ok(s.inRange(4.5) && !s.inRange(0), '合并结果判定正确');
  const c = parseFunctionSegments({ segments: [[-20, -4], [4, 20]] }, -5, 5);
  ok(eq(c.segments, [[-5, -4], [4, 5]]), '超出 from~to 的区间被钳制');
  const out = parseFunctionSegments({ segments: [[-20, -10]] }, -5, 5);
  ok(eq(out.segments, []) && out.active === false, '完全落在定义域外的段被丢弃、退化为整段出图');
}

section('F. 非法项宽容与 12 段上限');
{
  const s = parseFunctionSegments({ segments: [null, 'x<0', [1], ['pi', 3], [2, 4]] }, -10, 10);
  ok(eq(s.segments, [[2, 4]]), '非法项静默丢弃、合法段保留（不整批失败）');
  ok(s.inRange(3) && !s.inRange(8), '保留段判定正确');
  const many = Array.from({ length: 20 }, (_, i) => [i * 0.5, i * 0.5 + 0.2]);
  const m = parseFunctionSegments({ segments: many }, 0, 20);
  ok(m.segments.length <= 12, '段数不超过 12');
  const bad = parseFunctionSegments({ segments: 'not-an-array', exclude: 42 }, -10, 10);
  ok(bad.active === false, '非数组字段不抛错、退化为整段出图');
}

section('G. 边界闭区间语义与 from>to 已归一场景');
{
  const s = parseFunctionSegments({ segments: [[1, 3]] }, 1, 3);
  ok(s.inRange(1) && s.inRange(3), '闭区间端点可见');
  ok(!s.inRange(0.999) && !s.inRange(3.001), '端点外不可见');
  const r = parseFunctionSegments({ segments: [[3, 1]] }, 1, 3);
  ok(eq(r.segments, [[1, 3]]), 'from/to 已归一时倒序段仍正确交换');
}

console.log(`\n=== parseFunctionSegments：${passed}/${passed + failed} 项断言通过 ===`);
if (failed > 0) process.exit(1);

/**
 * 2D 画板 · numericIntersections 无头单测（AI 作图对标大角几何·2026-11-23 第二十一轮增量）
 *
 * 本轮给 inspect 派生量新增 kind:"intersections"（两函数交点数值查询）。numericIntersections 是
 * js/executor.js 的模块级导出纯函数：传入两个 sample(x) 采样函数 + 区间 opts，
 * 复用 numericRoots 扫描 + 二分求 h(x)=f(x)−g(x) 的零点，再把零点回代两条采样函数拿
 * 公共 y（取 (fa+gb)/2 抹平二分残差），不依赖 JSXGraph / DOM / registry，Node 22 ESM 可直接 import。
 *
 * 覆盖：抛物线与直线两交点、两直线单交点、三角周期多交点、无交点、相切重根吸附、
 * 非法采样函数抛错、区间写反自动交换、from/to 默认、定义域空洞跳过、截断上限，
 * 以及 fa≈gb≈y 的数值守恒与「读数可抄成 point 数字坐标」的文本形态。
 * 运行：node tests/board2d_intersections_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId / js/board.js。
 */
import { numericIntersections } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
const qfmt = (v) => String(Number(v.toFixed(3)));

section('A. 抛物线 x² 与直线 2x+1 两交点 1±√2');
{
  const r = numericIntersections((x) => x * x, (x) => 2 * x + 1, { from: -4, to: 4 });
  ok(r.ok === true, 'ok 标记');
  ok(r.count === 2, '恰好 2 个交点');
  ok(near(r.points[0].x, 1 - Math.SQRT2) && near(r.points[1].x, 1 + Math.SQRT2), 'x=1±√2（升序）');
  ok(near(r.points[0].y, 3 - 2 * Math.SQRT2) && near(r.points[1].y, 3 + 2 * Math.SQRT2), 'y=3∓2√2（公共值）');
  ok(r.points.every((p) => near(p.fa, p.gb, 1e-3)), '每点 fa≈gb（两曲线同高）');
  ok(r.points.every((p) => near(p.y, (p.fa + p.gb) / 2, 1e-6)), 'y 取 fa/gb 平均值');
  ok(r.points.every((p) => near(p.x * p.x, p.y, 1e-3) && near(2 * p.x + 1, p.y, 1e-3)), '每点回代两函数均≈y');
}

section('B. 两直线 2x+1 与 −x+4 单交点 (1,3)');
{
  const r = numericIntersections((x) => 2 * x + 1, (x) => -x + 4, { from: -5, to: 5 });
  ok(r.count === 1, '仅 1 个交点');
  ok(near(r.points[0].x, 1) && near(r.points[0].y, 3), '交点 (1,3)');
  ok(near(r.points[0].fa, 3) && near(r.points[0].gb, 3), 'fa=gb=3');
}

section('C. sin(x) 与 x/2 在 [-6,6] 的三交点');
{
  const r = numericIntersections(Math.sin, (x) => x / 2, { from: -6, to: 6 });
  ok(r.count === 3, '[-6,6] 内 3 个交点');
  ok(r.points.some((p) => near(p.x, 0)), '含 x=0');
  ok(r.points.some((p) => near(p.x, 1.895, 1e-3)), '含 x≈1.895');
  ok(r.points.some((p) => near(p.x, -1.895, 1e-3)), '含 x≈-1.895');
}

section('D. 无交点 / 恒分离');
{
  const r1 = numericIntersections((x) => x * x + 1, () => -2, { from: -10, to: 10 });
  ok(r1.ok === true && r1.count === 0, 'x²+1 与 y=-2 无交点，points 为空');
  const r2 = numericIntersections(() => 5, () => 3, { from: -10, to: 10 });
  ok(r2.count === 0, '两条水平线 y=5/y=3 无交点');
}

section('E. 相切交点吸附（x² 与 2x−1 切于 (1,1)）');
{
  const r = numericIntersections((x) => x * x, (x) => 2 * x - 1, { from: -5, to: 5 });
  ok(r.count >= 1, '至少吸附到 1 个切点');
  ok(r.points.some((p) => near(p.x, 1) && near(p.y, 1)), '含切点 x≈1, y≈1');
}

section('E2. 相切交点精确捕捉（切点 x=1.0137 未落在采样网格上，2026-11-23 第二十二轮）');
{
  const c = 1.0137;
  const r = numericIntersections((x) => x * x, (x) => 2 * c * x - c * c, { from: -5, to: 5 });
  ok(r.count >= 1, 'Golden-section 捕捉到相切交点');
  ok(r.points.some((p) => near(p.x, 1.0137) && near(p.y, c * c)), '切点 (1.0137, 1.0276)');
  ok(r.points.every((p) => near(p.fa, p.gb, 1e-3)), '切点处 fa≈gb');
  const r2 = numericIntersections((x) => x * x + 1, () => -2, { from: -10, to: 10 });
  ok(r2.count === 0, '恒分离两曲线仍无交点（相切逻辑不误报）');
}

section('F. 非法采样函数抛错');
{
  let e1 = false; try { numericIntersections(null, Math.sin, {}); } catch (_) { e1 = true; }
  ok(e1, 'sampleA 非函数抛错');
  let e2 = false; try { numericIntersections(Math.sin, undefined, {}); } catch (_) { e2 = true; }
  ok(e2, 'sampleB 非函数抛错');
}

section('G. 区间写反自动交换 / from-to 默认');
{
  const r = numericIntersections((x) => x, () => 3, { from: 8, to: -8 });
  ok(r.count === 1 && near(r.points[0].x, 3) && near(r.points[0].y, 3), 'from>to 自动交换后仍得 (3,3)');
  const r2 = numericIntersections((x) => x - 3, () => 0);   // 默认 [-10,10]
  ok(r2.count === 1 && near(r2.points[0].x, 3), '默认区间 [-10,10] 内得 x=3');
  ok(r2.from === -10 && r2.to === 10, '回读默认区间 from=-10 to=10');
}

section('H. 定义域空洞跳过（1/x 与 sqrt(x)）');
{
  const r1 = numericIntersections((x) => 1 / x, () => 0, { from: -5, to: 5 });
  ok(r1.count === 0, '1/x 在 x=0 空洞处不误报交点');
  const r2 = numericIntersections((x) => (x < 0 ? NaN : Math.sqrt(x)), () => 1, { from: -5, to: 10 });
  ok(r2.count === 1 && near(r2.points[0].x, 1), 'sqrt(x) 与 y=1 仅交于 x=1（负半轴 NaN 跳过）');
  ok(near(r2.points[0].fa, 1) && near(r2.points[0].gb, 1), 'sqrt(x) 交点处 fa=gb=1');
}

section('I. maxRoots 截断上限');
{
  const r = numericIntersections(Math.sin, () => 0.1, { from: -50, to: 50, maxRoots: 5 });
  ok(r.count <= 5, '交点数不超过 maxRoots=5');
  ok(r.truncated === true, 'truncated 标记为真');
}

section('J. 综合读数形态（可抄成 point 数字坐标）');
{
  const r = numericIntersections((x) => x * x, (x) => 2 * x + 1, { from: -4, to: 4 });
  const text = 'intersections(f1:"x^2" ∩ g1:"2*x+1"): [' + qfmt(r.from) + ',' + qfmt(r.to) + '] 内 '
    + r.count + ' 个交点; ' + r.points.map((p, i) => 'P' + (i + 1) + '=(' + qfmt(p.x) + ',' + qfmt(p.y) + ')').join('; ');
  ok(/P1=\(-0\.414,0\.172\)/.test(text), '读数含 P1=(-0.414,0.172)');
  ok(/P2=\(2\.414,5\.828\)/.test(text), '读数含 P2=(2.414,5.828)');
}

console.log('\n=== numericIntersections 无头单测：' + passed + ' 通过 / ' + failed + ' 失败 ===');
if (failed > 0) process.exit(1);

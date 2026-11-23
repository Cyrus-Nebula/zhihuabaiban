/**
 * 2D 画板 · numericRoots 无头单测（AI 作图对标大角几何·2026-11-23 第二十轮增量）
 *
 * 本轮给 inspect 派生量新增 kind:"zeros"（任意函数数值求根）。numericRoots 是
 * js/executor.js 的模块级导出纯函数：传入 sample(x) 采样函数 + 区间 opts，
 * 用「等距扫描 + 变号二分 + 端点吸附 + 去重」返回区间内所有数值零点，
 * 不依赖 JSXGraph / DOM / registry，Node 22 ESM 可直接 import。
 *
 * 覆盖：三次多项式多根、二次两根、三角周期根、无零点、相切重根吸附、
 * 参数非法抛错、区间写反自动交换、from/to 默认、定义域空洞跳过、截断上限，
 * 以及「根代回采样函数≈0」的数值守恒。运行：node tests/board2d_zeros_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId / js/board.js。
 */
import { numericRoots } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

section('A. 三次多项式 x³−x 三根 -1/0/1');
{
  const r = numericRoots((x) => x * x * x - x, { from: -3, to: 3 });
  ok(r.ok === true, 'ok 标记');
  ok(r.count === 3, '恰好 3 个零点');
  ok(near(r.roots[0], -1) && near(r.roots[1], 0) && near(r.roots[2], 1), '三根 -1,0,1（升序）');
  ok(r.roots.every((x, i) => i === 0 || x > r.roots[i - 1]), '结果严格升序');
  ok(r.roots.every((x) => near(x * x * x - x, 0, 1e-3)), '每根代回 f(x)≈0');
}

section('B. 二次多项式 x²−4x+3 两根 1/3');
{
  const r = numericRoots((x) => x * x - 4 * x + 3, { from: -1, to: 5 });
  ok(r.count === 2, '两根');
  ok(near(r.roots[0], 1) && near(r.roots[1], 3), 'x1=1 x2=3');
}

section('C. 三角函数 sin(x) 在 [-7,7] 的多根');
{
  const r = numericRoots(Math.sin, { from: -7, to: 7 });
  ok(r.count === 5, '[-7,7] 内约 5 个零点（±2π, ±π, 0）');
  ok(r.roots.some((x) => near(x, 0)), '含 x=0');
  ok(r.roots.some((x) => near(x, Math.PI, 1e-3)), '含 x≈π');
  ok(r.roots.some((x) => near(x, -Math.PI, 1e-3)), '含 x≈-π');
  ok(r.roots.every((x) => near(Math.sin(x), 0, 1e-3)), '每根 sin(x)≈0');
}

section('D. 无零点 / 恒正函数');
{
  const r1 = numericRoots((x) => x * x + 1, { from: -10, to: 10 });
  ok(r1.ok === true && r1.count === 0, 'x²+1 无零点，roots 为空');
  const r2 = numericRoots(() => 5, { from: -10, to: 10 });
  ok(r2.count === 0, '常数 5 无零点');
}

section('E. 相切重根吸附（(x-2)² 在采样点上的零点）');
{
  const r = numericRoots((x) => (x - 2) * (x - 2), { from: 0, to: 4, segments: 800 });
  ok(r.count >= 1, '至少吸附到 1 个零点');
  ok(r.roots.some((x) => near(x, 2)), '含切点 x≈2');
}

section('F. 非法参数抛错');
{
  let e1 = false; try { numericRoots(null, {}); } catch (_) { e1 = true; }
  ok(e1, 'sample 非函数抛错');
  let e2 = false; try { numericRoots(Math.sin, { from: NaN, to: 10 }); } catch (_) { e2 = true; }
  ok(e2, 'from 非有限数抛错');
  let e3 = false; try { numericRoots(Math.sin, { from: 2, to: 2 }); } catch (_) { e3 = true; }
  ok(e3, '零宽区间抛错');
}

section('G. 区间写反自动交换 / from-to 默认');
{
  const r = numericRoots((x) => x * x - x - 2, { from: 5, to: -5 });
  ok(r.count === 2 && near(r.roots[0], -1) && near(r.roots[1], 2), 'from>to 自动交换后仍得 -1,2');
  const r2 = numericRoots((x) => x - 3); // 默认 [-10,10]
  ok(r2.count === 1 && near(r2.roots[0], 3), '默认区间 [-10,10] 内得 x=3');
}

section('H. 定义域空洞跳过（sqrt(x)-2 只有 x=4，负半轴 NaN）');
{
  const r = numericRoots((x) => (x < 0 ? NaN : Math.sqrt(x) - 2), { from: -5, to: 10 });
  ok(r.count === 1, '负半轴 NaN 段跳过，仅 1 个零点');
  ok(near(r.roots[0], 4), '零点 x≈4');
}

section('I. maxRoots 截断上限');
{
  const r = numericRoots(Math.sin, { from: -100, to: 100, maxRoots: 5 });
  ok(r.count <= 5, '根数不超过 maxRoots=5');
  ok(r.truncated === true, 'truncated 标记为真');
}

section('J. 综合命令形态（读数可抄成 point 数字坐标）');
{
  const r = numericRoots((x) => x * x * x - x, { from: -3, to: 3 });
  const text = 'zeros: [' + r.from + ',' + r.to + '] 内 ' + r.count + ' 个零点; '
    + r.roots.map((x, i) => 'x' + (i + 1) + '=' + x).join('; ');
  ok(/x1=-1/.test(text) && /x2=0/.test(text) && /x3=1/.test(text), '读数文本含 x1=-1;x2=0;x3=1');
}

console.log('\n=== numericRoots 无头单测：' + passed + ' 通过 / ' + failed + ' 失败 ===');
if (failed > 0) process.exit(1);

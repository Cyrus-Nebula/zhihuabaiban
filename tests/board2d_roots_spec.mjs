/**
 * 2D 画板 · quadraticRoots 无头单测（AI 作图对标大角几何·2026-11-23 增量）
 *
 * 本轮给 inspect 派生量新增 kind:"roots"（二次函数符号求根）。quadraticRoots 是
 * js/executor.js 的模块级导出纯函数：给 a,b,c 按 Δ=b²−4ac 返回两实根 / 重根 / 无实根，
 * 不依赖 JSXGraph / DOM / registry，Node 22 ESM 可直接 import。
 *
 * 覆盖：Δ>0 两实根（含 a<0、非整数系数、升序）、Δ=0 重根、Δ<0 无实根、非法参数抛错，
 * 以及「根代回原多项式≈0」的数值守恒。运行：node tests/board2d_roots_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId / js/board.js。
 */
import { quadraticRoots } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

section('A. Δ>0：x²−4x+3=0 → 两根 1,3');
{
  const r = quadraticRoots(1, -4, 3);
  ok(r.ok === true && r.real === true && r.double === false, '标记 real/double 正确');
  ok(near(r.discriminant, 4), 'Δ = (−4)²−4·1·3 = 4');
  ok(r.roots.length === 2 && near(r.roots[0], 1) && near(r.roots[1], 3), '两根 x1=1 x2=3');
  ok(r.roots[0] <= r.roots[1], '两根升序');
  ok(near(r.roots[0] * r.roots[1], 3) && near(r.roots[0] + r.roots[1], 4), '韦达定理：和=4 积=3');
}

section('B. a<0：−x²+4x−3=0 → 同两根 1,3（开口向下不影响根）');
{
  const r = quadraticRoots(-1, 4, -3);
  ok(near(r.discriminant, 4), 'Δ = 4');
  ok(near(r.roots[0], 1) && near(r.roots[1], 3), '两根仍为 1,3');
}

section('C. Δ=0：x²−4x+4=0 → 重根 x=2');
{
  const r = quadraticRoots(1, -4, 4);
  ok(r.real === true && r.double === true, '标记 double=true');
  ok(near(r.discriminant, 0), 'Δ = 0');
  ok(r.roots.length === 2 && near(r.roots[0], 2) && near(r.roots[1], 2), '两个相同的 x=2（切点只画一个点）');
}

section('D. Δ<0：x²+1=0 → 无实根');
{
  const r = quadraticRoots(1, 0, 1);
  ok(r.real === false && r.double === false, '标记 real=false');
  ok(near(r.discriminant, -4), 'Δ = −4');
  ok(r.roots.length === 0, 'roots 为空（AI 不得画交点）');
}

section('E. 非整数系数与根代回守恒');
{
  const [a, b, c] = [2, -8, 6]; // 2x²−8x+6，根 1 与 3
  const r = quadraticRoots(a, b, c);
  ok(near(r.roots[0], 1) && near(r.roots[1], 3), '2x²−8x+6 → 1,3');
  ok(r.roots.every((x) => near(a * x * x + b * x + c, 0, 1e-9)), '两根代回原式≈0（verify evaluate 的期望）');
  const r2 = quadraticRoots(1, 0, -2); // x²−2，根 ±√2
  ok(near(r2.roots[0], -Math.SQRT2) && near(r2.roots[1], Math.SQRT2), 'x²−2 → ±√2（无理根也精确）');
  ok(near(r2.roots[0] + r2.roots[1], 0, 1e-12), '无理根之和≈0（浮点对称）');
}

section('F. 非法参数抛错（不静默猜根）');
{
  let t1 = false, t2 = false, t3 = false;
  try { quadraticRoots(0, 1, 2); } catch (_) { t1 = true; }
  try { quadraticRoots('a', 1, 2); } catch (_) { t2 = true; }
  try { quadraticRoots(NaN, 1, 2); } catch (_) { t3 = true; }
  ok(t1, 'a=0 抛错（非二次）');
  ok(t2, '非数值系数抛错');
  ok(t3, 'NaN 系数抛错');
}

console.log('\n=== quadraticRoots 单测：' + passed + ' 通过 / ' + failed + ' 失败 ===');
if (failed > 0) process.exit(1);

/**
 * 2D 画板 · inequalitySpec 无头单测（AI 作图对标大角几何·小步增量 2026-11-19 第十四轮）
 *
 * 本轮新增原生 inequality 不等式区域填充命令。inequalitySpec 是 js/executor.js 里的模块级
 * 纯函数（不依赖 JSXGraph / DOM）：边界来源二选一（expr 函数 / boundary 已画元素 id）、
 * "y<…"/"y>=…" 比较符前缀剥离与侧推断、side（上/下/左/右 + 中英文别名）→ inverse 映射、
 * 显式 inverse 优先、from/to 数值化交换、fillColor/fillOpacity/strokeColor 归一与钳制、
 * 非法参数抛错、summary/meta 回读。Node 22 的 ESM 可直接 import，无需 package.json。
 *
 * 覆盖：全部走真实 inequalitySpec 断言，不做静态正则替代。真实 y=f(x) 编译与 JSXGraph
 * inequality 元素填充由 case 'inequality' 在浏览器侧完成，本纯函数只测规格归一（见 docs 已知限制）。
 * 运行：node tests/board2d_inequality_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId。
 */
import { inequalitySpec } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

section('A. 边界二选一：expr / boundary / 都缺抛错');
{
  ok((() => { try { inequalitySpec({}); return false; } catch (_) { return true; } })(), 'expr/boundary 都缺抛错');
  ok((() => { try { inequalitySpec({ expr: '   ' }); return false; } catch (_) { return true; } })(), '空白 expr 抛错');
  ok((() => { try { inequalitySpec(null); return false; } catch (_) { return true; } })(), 'null 命令抛错不静默');
  const e = inequalitySpec({ expr: 'x^2-4' });
  ok(e.mode === 'expr' && e.expr === 'x^2-4', 'expr 模式归一正确');
  ok(e.boundary === '', 'expr 模式 boundary 为空串');
  const b = inequalitySpec({ boundary: 'lx' });
  ok(b.mode === 'boundary' && b.boundary === 'lx', 'boundary 模式归一正确');
  ok(b.expr === '', 'boundary 模式 expr 为空串');
  // expr 优先于 boundary
  const both = inequalitySpec({ expr: 'x+1', boundary: 'lx' });
  ok(both.mode === 'expr' && both.expr === 'x+1', 'expr/boundary 同时给时 expr 优先');
}

section('B. 比较符前缀剥离与侧推断（y<… / y>=…）');
{
  const lt = inequalitySpec({ expr: 'y<x^2-4' });
  ok(lt.expr === 'x^2-4', '剥离 y< 前缀');
  ok(lt.side === 'below' && lt.inverse === false, 'y< 推断为下方 below/inverse:false');
  ok(lt.meta.strippedByCompare === true, '标记已剥离比较符');
  const ge = inequalitySpec({ expr: 'y>=a*x+1' });
  ok(ge.expr === 'a*x+1', '剥离 y>= 前缀');
  ok(ge.side === 'above' && ge.inverse === true, 'y>= 推断为上方 above/inverse:true');
  const gt = inequalitySpec({ expr: 'y > x+1' });
  ok(gt.expr === 'x+1' && gt.side === 'above', 'y > 带空格也剥离并推断上方');
  const le = inequalitySpec({ expr: 'y<=2*x' });
  ok(le.expr === '2*x' && le.side === 'below', 'y<= 推断下方');
  // 显式 side 覆盖比较符推断
  const override = inequalitySpec({ expr: 'y<x+1', side: 'above' });
  ok(override.side === 'above' && override.inverse === true, '显式 side 覆盖比较符推断');
  ok((() => { try { inequalitySpec({ expr: 'y<' }); return false; } catch (_) { return true; } })(), '剥离后 expr 为空抛错');
}

section('C. side → inverse 映射（中文 / 英文别名）');
{
  const below = inequalitySpec({ expr: 'x', side: 'below' });
  ok(below.side === 'below' && below.inverse === false, 'below → inverse:false');
  const above = inequalitySpec({ expr: 'x', side: 'above' });
  ok(above.side === 'above' && above.inverse === true, 'above → inverse:true');
  ok(inequalitySpec({ expr: 'x', side: '下' }).inverse === false, '中文「下」→ inverse:false');
  ok(inequalitySpec({ expr: 'x', side: '上方' }).inverse === true, '中文「上方」→ inverse:true');
  ok(inequalitySpec({ expr: 'x', side: 'lower' }).side === 'below', 'lower 归为 below');
  ok(inequalitySpec({ expr: 'x', side: 'upper' }).side === 'above', 'upper 归为 above');
  const left = inequalitySpec({ boundary: 'lx', side: '左' });
  ok(left.side === 'left' && left.inverse === true, '直线「左」→ side:left/inverse:true');
  const right = inequalitySpec({ boundary: 'lx', side: 'right' });
  ok(right.side === 'right' && right.inverse === false, 'right → side:right/inverse:false');
  // 未知 side 退回 below
  const unknown = inequalitySpec({ expr: 'x', side: 'sideways' });
  ok(unknown.side === 'below' && unknown.inverse === false, '未知 side 退回 below/false');
  // 未给 side 默认 below
  ok(inequalitySpec({ expr: 'x' }).side === 'below', '未给 side 默认 below');
}

section('D. 显式 inverse 优先于 side（布尔 / 字符串）');
{
  ok(inequalitySpec({ expr: 'x', side: 'below', inverse: true }).inverse === true, '显式 inverse:true 覆盖 side:below');
  ok(inequalitySpec({ expr: 'x', side: 'above', inverse: false }).inverse === false, '显式 inverse:false 覆盖 side:above');
  ok(inequalitySpec({ expr: 'x', side: 'above', inverse: 'false' }).inverse === false, '字符串 "false" 归为 false');
  ok(inequalitySpec({ expr: 'x', side: 'below', inverse: '1' }).inverse === true, '字符串 "1" 归为 true');
  ok(inequalitySpec({ expr: 'x', side: 'below', inverse: 'garbage' }).inverse === false, '非法 inverse 字符串保留 side 推断值');
}

section('E. from/to 数值化与交换');
{
  const d = inequalitySpec({ expr: 'x' });
  ok(d.from === -10 && d.to === 10, '默认定义域 -10~10');
  const r = inequalitySpec({ expr: 'x', from: 1, to: 5 });
  ok(r.from === 1 && r.to === 5, '显式 from/to 数值化');
  const s = inequalitySpec({ expr: 'x', from: '2', to: '4' });
  ok(s.from === 2 && s.to === 4, '数字字符串 from/to 数值化');
  const sw = inequalitySpec({ expr: 'x', from: 6, to: 1 });
  ok(sw.from === 1 && sw.to === 6, 'to<from 自动交换');
  const bad = inequalitySpec({ expr: 'x', from: 'abc', to: 3 });
  ok(bad.from === -10 && bad.to === 3, '非法 from 退回默认 -10');
  // boundary 模式忽略 from/to（仍归一，不抛错）
  const b = inequalitySpec({ boundary: 'lx', from: 0, to: 2 });
  ok(b.from === 0 && b.to === 2, 'boundary 模式 from/to 仍归一');
}

section('F. 样式归一：fillColor / fillOpacity / strokeColor');
{
  const d = inequalitySpec({ expr: 'x' });
  ok(d.fillColor === '#C62828', '默认 fillColor #C62828');
  ok(d.fillOpacity === 0.2, '默认 fillOpacity 0.2');
  ok(d.strokeColor === d.fillColor, 'strokeColor 缺省跟随 fillColor');
  const c = inequalitySpec({ expr: 'x', color: '#1D4ED8', fillOpacity: 0.6, strokeColor: '#000' });
  ok(c.fillColor === '#1D4ED8', 'color 别名写入 fillColor');
  ok(c.fillOpacity === 0.6, '显式 fillOpacity 保留');
  ok(c.strokeColor === '#000', '显式 strokeColor 保留');
  const fc = inequalitySpec({ expr: 'x', fillColor: '#059669' });
  ok(fc.fillColor === '#059669' && fc.strokeColor === '#059669', 'fillColor 与 strokeColor 同色');
  ok(inequalitySpec({ expr: 'x', fillOpacity: 0.01 }).fillOpacity === 0.05, 'fillOpacity<0.05 钳到 0.05');
  ok(inequalitySpec({ expr: 'x', fillOpacity: 5 }).fillOpacity === 0.9, 'fillOpacity>0.9 钳到 0.9');
  ok(inequalitySpec({ expr: 'x', fillOpacity: 'garbage' }).fillOpacity === 0.2, '非法 fillOpacity 退回 0.2');
}

section('G. summary / meta 回读');
{
  const e = inequalitySpec({ expr: 'x^2-4', side: 'above', from: -5, to: 5, color: '#C62828' });
  ok(e.summary.indexOf('inequality:y>x^2-4') === 0, 'summary 含 y> 表达式（above）');
  ok(e.summary.indexOf('x∈[-5,5]') !== -1, 'summary 含 x 定义域');
  ok(e.meta.mode === 'expr' && e.meta.expr === 'x^2-4', 'meta.mode/expr 正确');
  ok(e.meta.side === 'above' && e.meta.inverse === true, 'meta.side/inverse 正确');
  ok(e.meta.fillColor === '#C62828' && e.meta.fillOpacity === 0.2, 'meta 样式字段正确');
  const lt = inequalitySpec({ expr: 'y<x+1' });
  ok(lt.summary.indexOf('inequality:y<x+1') === 0, 'below（含比较符写法）summary 用 y<');
  const b = inequalitySpec({ boundary: 'lx', side: 'below', color: '#1D4ED8' });
  ok(b.summary.indexOf('inequality:lx below') === 0, 'boundary 模式 summary 含边界 id 与侧');
  ok(b.summary.indexOf('fill=#1D4ED8') !== -1, 'boundary 模式 summary 含填充色');
  ok(b.meta.boundary === 'lx' && b.meta.mode === 'boundary', 'boundary 模式 meta 正确');
  ok(b.meta.strippedByCompare === false, '未剥离比较符时标记 false');
}

section('H. 综合命令（对标 docs 例37 / 用例 87、88）');
{
  // 函数边界可行域 y≥x²-4
  const r1 = inequalitySpec({ op: 'inequality', id: 'reg1', expr: 'x^2-4', side: 'above', from: -5, to: 5, color: '#C62828', fillOpacity: 0.25 });
  ok(r1.mode === 'expr' && r1.inverse === true && r1.from === -5 && r1.to === 5, 'y≥x²-4 可行域参数归一正确');
  ok(r1.expr === 'x^2-4' && r1.fillOpacity === 0.25, 'y≥x²-4 表达式与透明度正确');
  // 直线边界线性规划 x+y≤3（先建两点定 lx，再以 lx 为边界填下方）
  const r2 = inequalitySpec({ op: 'inequality', id: 'lp', boundary: 'lx', side: 'below', color: '#1D4ED8' });
  ok(r2.mode === 'boundary' && r2.boundary === 'lx' && r2.inverse === false, '线性规划阴影参数归一正确');
  // 滑动条联动动态区域 y≤x²+a（a 为滑动条 id，表达式原样保留由引擎取值）
  const r3 = inequalitySpec({ op: 'inequality', id: 'dyn', expr: 'x^2+a', side: 'below', from: -5, to: 5 });
  ok(r3.expr === 'x^2+a' && r3.inverse === false, '滑动条动态区域表达式保留、侧正确');
}

console.log(`\ninequalitySpec 单测：${passed}/${passed + failed} 断言通过`);
if (failed > 0) process.exit(1);

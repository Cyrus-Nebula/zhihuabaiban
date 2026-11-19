/**
 * 2D 画板 · polarSpec 无头单测（AI 作图对标大角几何·小步增量 2026-11-19 第十三轮）
 *
 * 本轮新增原生 polar 极坐标曲线命令。polarSpec 是 js/executor.js 里的模块级纯函数
 * （不依赖 JSXGraph / DOM）：expr 变量归一（t/theta/θ）、from/to 极角范围（默认 0~2π、
 * turns 圈数别名）、samples 采样数钳制、非法参数抛错、summary/meta 回读。
 * Node 22 的 ESM 语法探测可直接 import，无需 package.json（避免 Pages 构建被触发）。
 *
 * 覆盖：expr 非空与归一、from/to 默认值与交换、turns 别名、samples 钳制、非法参数抛错、
 * 占位 at/rAt 形状、summary/meta 回读、综合命令。真实调用 polarSpec 做断言，不做静态正则替代。
 * real 极径由 case 'polar' 注入 JessieCode 编译闭包，本纯函数只测规格归一（见「已知限制」）。
 * 运行：node tests/board2d_polar_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId。
 */
import { polarSpec } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const TWO_PI = 2 * Math.PI;

section('A. expr 必填与变量归一（t / theta / θ → t）');
{
  ok((() => { try { polarSpec({}); return false; } catch (_) { return true; } })(), '缺 expr 抛错');
  ok((() => { try { polarSpec({ expr: '   ' }); return false; } catch (_) { return true; } })(), '空白 expr 抛错');
  ok((() => { try { polarSpec(null); return false; } catch (_) { return true; } })(), 'null 命令抛错不静默');
  ok(polarSpec({ expr: '3*cos(3*t)' }).expr === '3*cos(3*t)', '已是 t 变量的表达式原样');
  ok(polarSpec({ expr: ' 3*cos(3*t) ' }).expr === '3*cos(3*t)', 'expr 首尾空格被 trim');
  ok(polarSpec({ expr: '2+2*cos(theta)' }).expr === '2+2*cos(t)', 'theta → t');
  ok(polarSpec({ expr: '2+2*cos(THETA)' }).expr === '2+2*cos(t)', 'THETA 大小写不敏感 → t');
  ok(polarSpec({ expr: 'a*θ' }).expr === 'a*t', '希腊字母 θ → t');
  ok(polarSpec({ expr: 'sin(theta)+cos(θ)' }).expr === 'sin(t)+cos(t)', 'theta 与 θ 同命令都归一');
}

section('B. from/to 极角范围：默认值、数值化、交换');
{
  const d = polarSpec({ expr: '3*cos(3*t)' });
  ok(d.tMin === 0, '未给 from 默认 0');
  ok(near(d.tMax, TWO_PI), '未给 to 默认 2π');
  const r = polarSpec({ expr: 't', from: 1, to: 5 });
  ok(r.tMin === 1 && r.tMax === 5, '显式 from/to 数值化');
  const s = polarSpec({ expr: 't', from: '2', to: '4' });
  ok(s.tMin === 2 && s.tMax === 4, '数字字符串 from/to 数值化');
  const sw = polarSpec({ expr: 't', from: 6, to: 1 });
  ok(sw.tMin === 1 && sw.tMax === 6, 'to<from 自动交换');
}

section('C. turns 圈数别名与非法范围');
{
  const t1 = polarSpec({ expr: 't', turns: 1 });
  ok(t1.tMin === 0 && near(t1.tMax, TWO_PI), 'turns:1 → 0~2π');
  const t3 = polarSpec({ expr: 't', turns: 3 });
  ok(near(t3.tMax, 6 * Math.PI), 'turns:3 → 0~6π');
  const both = polarSpec({ expr: 't', from: 0, to: 1, turns: 9 });
  ok(both.tMax === 1, '显式 to 优先于 turns');
  ok(near(polarSpec({ expr: 't', turns: -2 }).tMax, TWO_PI), 'turns 非正数被忽略、退回默认 2π');
  ok(near(polarSpec({ expr: 't', to: 'abc' }).tMax, TWO_PI), 'to 非法字符串退回默认 2π');
  ok((() => { try { polarSpec({ expr: 't', from: 2, to: 2 }); return false; } catch (_) { return true; } })(),
    'from==to 零范围抛错');
}

section('D. samples 采样数：默认、钳制、数值化');
{
  ok(polarSpec({ expr: 't' }).samples === 360, '默认 samples=360');
  ok(polarSpec({ expr: 't', samples: 800 }).samples === 800, '显式 samples 保留');
  ok(polarSpec({ expr: 't', samples: '600' }).samples === 600, '数字字符串 samples 数值化');
  ok(polarSpec({ expr: 't', samples: 5 }).samples === 60, 'samples<60 钳到 60');
  ok(polarSpec({ expr: 't', samples: 99999 }).samples === 2000, 'samples>2000 钳到 2000');
  ok(polarSpec({ expr: 't', samples: 'bad' }).samples === 360, '非法 samples 退回默认 360');
}

section('E. 占位 at/rAt 形状（真实极径由执行分支注入，此处只测结构）');
{
  const s = polarSpec({ expr: '3*cos(3*t)' });
  ok(typeof s.rAt === 'function' && s.rAt(0) === 0, 'rAt 是函数、占位返回 0');
  ok(typeof s.at === 'function' && eq(s.at(0), [0, 0]), 'at 是函数、占位返回 [0,0]');
  ok(Array.isArray(s.__aiRangePlaceholder) === false, '不暴露多余字段');
}

section('F. summary / meta 回读');
{
  const s = polarSpec({ expr: '2+2*cos(theta)', from: 0, to: 6.283, samples: 600 });
  ok(s.expr === '2+2*cos(t)', 'summary 用归一后的表达式');
  ok(s.summary.indexOf('r=2+2*cos(t)') !== -1, 'summary 含 r= 表达式');
  ok(s.summary.indexOf('θ∈[0,6.283]') !== -1, 'summary 含极角范围');
  ok(s.summary.indexOf('采样600') !== -1, 'summary 含采样数');
  ok(s.meta.definition === 'r(t)', 'meta.definition=r(t)');
  ok(s.meta.expr === '2+2*cos(t)', 'meta.expr 归一后表达式');
  ok(s.meta.samples === 600, 'meta.samples 采样数');
}

section('G. 综合命令（玫瑰线 + 滑动条螺线）');
{
  const rose = polarSpec({ op: 'polar', id: 'rose', expr: '3*cos(3*t)', from: 0, to: 6.283, samples: 600, color: '#E11D48' });
  ok(rose.expr === '3*cos(3*t)' && rose.tMin === 0 && near(rose.tMax, 6.283), '玫瑰线综合参数归一正确');
  const spiral = polarSpec({ op: 'polar', id: 'spiral', expr: 'a*t', from: 0, to: 12.566 });
  ok(spiral.expr === 'a*t' && near(spiral.tMax, 12.566), '滑动条螺线参数归一正确（a 由引擎取值）');
}

console.log(`\npolarSpec 单测：${passed}/${passed + failed} 断言通过`);
if (failed > 0) process.exit(1);

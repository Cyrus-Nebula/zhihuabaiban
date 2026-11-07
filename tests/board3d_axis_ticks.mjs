/**
 * 3D 画板 —— 坐标轴刻度规格无头单测（不依赖 three / 浏览器 / WebGL）。
 * 验证 js/board3d-axis.js 的纯函数逻辑，保证「坐标轴刻度」增量可回归。
 *
 * 运行：node tests/board3d_axis_ticks.mjs
 */
import { axisTickSpec, majorTickCount } from '../js/board3d-axis.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}

console.log('3D 坐标轴刻度规格单测');

console.log('— 基本规格生成（axisLen=5, majorEvery=5）—');
{
  const s = axisTickSpec(5, 5);
  assert(s.length === 11, '生成 11 个刻度（-5..5，含端点）');
  assert(s.filter((t) => t.major).length === 3, '主刻度数 == 3（-5, 0, 5）');
  assert(s.filter((t) => t.minor).length === 8, '次刻度数 == 8');
  assert(s.every((t) => t.value >= -5 && t.value <= 5), '刻度值均在 [-5,5]');
  assert(s.every((t) => t.major !== t.minor), 'major 与 minor 互相排斥');
}

console.log('— 数值标注主刻度计数 —');
{
  assert(majorTickCount(5, 5) === 2, 'axisLen=5：打数值的主刻度 == 2（排除原点 0）');
  assert(majorTickCount(10, 5) === 4, 'axisLen=10：打数值的主刻度 == 4（±5, ±10）');
  assert(majorTickCount(5, 1) === 10, 'majorEvery=1：每刻度都打数值（排除 0）→ 10');
}

console.log('— 默认参数 —');
{
  const s = axisTickSpec();
  assert(s.length === 11 && s.filter((t) => t.major).length === 3, '默认 (5,5) 行为一致');
}

console.log('— 异常参数（边界防护）—');
{
  let threw = false; try { axisTickSpec(0); } catch (_) { threw = true; }
  assert(threw, 'axisLen < 1 应抛错');
  threw = false; try { axisTickSpec(5, 0); } catch (_) { threw = true; }
  assert(threw, 'majorEvery < 1 应抛错');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

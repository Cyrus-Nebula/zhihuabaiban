/**
 * 2D 画板 · stylePointSpec 无头单测（AI 作图对标大角几何·小步增量 2026-11-19 第十二轮）
 *
 * 本轮给 2D style 命令补「点型样式」：face（点型别名归一）/ size（点大小钳制）/
 * hollow（空心）/ solid（实心）/ fillColor，用于表达分段函数端点的开闭（空心圆 vs 实心圆）。
 * stylePointSpec 是 js/executor.js 里的模块级纯函数（不依赖 JSXGraph / DOM），
 * Node 22 的 ESM 语法探测可直接 import，无需 package.json（避免 Pages 构建被触发）。
 *
 * 覆盖：未写点型字段时 active=false（旧命令零回归）、face 英文/中文别名、未知 face 宽容丢弃、
 * size 数值化与 1~20 钳制、非法 size 丢弃、hollow（face 缺省 o / fillOpacity:0 / strokeWidth 保底）、
 * solid（fillOpacity:1）、hollow+solid 互斥（solid 后写覆盖）、fillColor、summary 回读文本、综合命令。
 * 真实调用 stylePointSpec 做断言，不做静态正则替代。
 * 运行：node tests/board2d_style_point_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId。
 */
import { stylePointSpec } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('A. 未写点型字段 → active=false（旧 style 命令零回归）');
{
  const s = stylePointSpec({ op: 'style', target: 'tri', color: '#3E44D9', strokeWidth: 2, dash: 1 });
  ok(s.active === false, '仅通用样式字段时 active=false');
  ok(eq(s.attrs, {}) && s.summary === '', 'attrs 为空、summary 为空');
  const empty = stylePointSpec({});
  ok(empty.active === false, '空命令 active=false 不抛错');
  const undef = stylePointSpec(null);
  ok(undef.active === false, 'null 命令 active=false 不抛错');
}

section('B. face 别名归一（英文 / 中文）');
{
  const cases = [
    ['o', 'o'], ['circle', 'o'], ['圆', 'o'], ['空心圆', 'o'],
    ['[]', '[]'], ['square', '[]'], ['方', '[]'],
    ['diamond', 'diamond'], ['菱形', 'diamond'],
    ['^', '^'], ['三角', '^'], ['v', 'v'], ['>', '>'], ['<', '<'],
    ['+', '+'], ['十字', '+'], ['-', '-'], ['|', '|'],
  ];
  for (const [input, expect] of cases) {
    const s = stylePointSpec({ face: input });
    ok(s.attrs.face === expect, `face:"${input}" → "${expect}"`);
  }
  ok(stylePointSpec({ face: ' CIRCLE ' }).attrs.face === 'o', 'face 去空格 + 大小写不敏感');
}

section('C. 未知 face 宽容丢弃（不整批失败）');
{
  const s = stylePointSpec({ face: 'star', size: 6 });
  ok(s.active === true, '仍有其它字段时 active=true');
  ok(s.attrs.face === undefined, '未知 face 不写入 attrs');
  ok(s.attrs.size === 6, '同命令里合法 size 仍生效（不整批失败）');
  const onlyBad = stylePointSpec({ face: 'star' });
  ok(onlyBad.active === true && eq(onlyBad.attrs, {}), '仅未知 face：active=true 但 attrs 空（执行分支并入空对象无副作用）');
}

section('D. size 数值化与 1~20 钳制');
{
  ok(stylePointSpec({ size: 6 }).attrs.size === 6, '整数 size 原样');
  ok(stylePointSpec({ size: 4.8 }).attrs.size === 4.8, '小数 size 保留');
  ok(stylePointSpec({ size: 0.2 }).attrs.size === 1, '小于 1 钳到 1');
  ok(stylePointSpec({ size: 99 }).attrs.size === 20, '大于 20 钳到 20');
  ok(stylePointSpec({ size: '7' }).attrs.size === 7, '数字字符串数值化');
  const bad = stylePointSpec({ size: 'abc' });
  ok(bad.attrs.size === undefined, '非数字 size 丢弃');
  const nan = stylePointSpec({ size: NaN });
  ok(nan.attrs.size === undefined, 'NaN size 丢弃');
}

section('E. hollow 空心（face 缺省 o / 透填充 / 描边保底 1.5）');
{
  const s = stylePointSpec({ hollow: true });
  ok(s.attrs.face === 'o', 'hollow 未给 face 时缺省 o');
  ok(s.attrs.fillOpacity === 0, '空心填充透明 fillOpacity=0');
  ok(s.attrs.strokeWidth === 1.5, '未给 strokeWidth 时保底 1.5（保证轮廓可见）');
  const withFace = stylePointSpec({ hollow: true, face: '[]' });
  ok(withFace.attrs.face === '[]', 'hollow 配方点：保留显式 face，不覆写为 o');
  const withSw = stylePointSpec({ hollow: true, strokeWidth: 3 });
  ok(withSw.attrs.strokeWidth === undefined || withSw.attrs.strokeWidth === 3, '给了 strokeWidth 时纯函数不强加保底（执行分支已有 strokeWidth 设置）');
  ok(stylePointSpec({ hollow: 'true' }).attrs.fillOpacity === 0, 'hollow:"true" 字符串也识别');
}

section('F. solid 实心与 hollow/solid 互斥');
{
  const s = stylePointSpec({ solid: true });
  ok(s.attrs.fillOpacity === 1, '实心 fillOpacity=1');
  ok(s.attrs.strokeWidth === undefined, 'solid 不强加 strokeWidth');
  ok(stylePointSpec({ solid: 'true' }).attrs.fillOpacity === 1, 'solid:"true" 字符串也识别');
  const both = stylePointSpec({ hollow: true, solid: true });
  ok(both.attrs.fillOpacity === 1, 'hollow+solid 同时写：solid 后写覆盖为实心（互斥兜底）');
}

section('G. fillColor 与 summary 回读');
{
  const s = stylePointSpec({ fillColor: '#ffffff' });
  ok(s.attrs.fillColor === '#ffffff', 'fillColor 原样写入');
  ok(s.summary.includes('fill:#ffffff'), 'summary 回读 fillColor');
  const hs = stylePointSpec({ face: 'o', hollow: true, size: 6 });
  ok(hs.summary.includes('face:o') && hs.summary.includes('hollow') && hs.summary.includes('size:6'), 'summary 同时回读 face/hollow/size');
}

section('H. 综合命令（例35 端点）');
{
  const open = stylePointSpec({ op: 'style', target: 'R', face: 'o', size: 6, hollow: true });
  ok(open.active === true, '空心端点 active=true');
  ok(open.attrs.face === 'o' && open.attrs.size === 6 && open.attrs.fillOpacity === 0, '空心端点属性齐全');
  const closed = stylePointSpec({ op: 'style', target: 'L', face: 'o', size: 6, solid: true });
  ok(closed.attrs.fillOpacity === 1 && closed.attrs.size === 6, '实心端点属性齐全');
}

console.log(`\n=== stylePointSpec：${passed}/${passed + failed} 项断言通过 ===`);
if (failed > 0) process.exit(1);

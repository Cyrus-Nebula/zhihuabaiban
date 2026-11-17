/**
 * 2D 画板 · planRemove 无头单测（AI 作图对标大角几何·小步增量 2026-11-17 第九轮）
 *
 * 本轮给 2D 命令协议补上原生 remove（此前 executor 内部只有供前端删除工具用的 remove(id)，
 * AI 根本发不出这条命令）。planRemove 是 js/executor.js 里的模块级纯函数（不依赖 JSXGraph / DOM），
 * Node 22 的 ESM 语法探测可直接 import，无需 package.json。
 *
 * 覆盖：id / ids 规范化与去重、缺失 id 宽容、沿 parents / childElements 的多级级联与依赖倒序、
 * regularPolygon 派生顶点联动、三种 childElements 形状、无依赖信息时降级、非法参数抛错、不误删无关元素。
 * 真实调用 planRemove 做断言，不做静态正则替代。
 * 运行：node tests/board2d_remove_spec.mjs
 * 硬约束：纯 2D，不触碰 3D 分支 / editor.html / appId。
 */
import { planRemove } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const has = (a, v) => Array.isArray(a) && a.includes(v);
const throws = (fn) => { try { fn(); return false; } catch (_) { return true; } };

/** 用节点对象建注册表；parents / childElements 里直接引用同一对象，模拟 JSXGraph 依赖图 */
function graph(nodes) { return new Map(nodes.map((n) => [n.id, n])); }
const empty = () => new Map([['A', { id: 'A' }], ['B', { id: 'B' }]]);

section('A. 单 id / 无依赖');
{
  const p = planRemove({ op: 'remove', id: 'A' }, empty());
  ok(same(p.removed, ['A']), '删 A 只返回 A');
  ok(same(p.missing, []), 'missing 为空');
  ok(same(p.seeds, ['A']), 'seeds 为显式目标');
  ok(same(p.cascade, []), '无级联项');
  ok(p.removed[p.removed.length - 1] === 'A', '显式目标排在最后');
}

section('B. ids 数组 / 去重 / trim');
{
  const reg = new Map([['A', { id: 'A' }], ['B', { id: 'B' }], ['C', { id: 'C' }]]);
  const p = planRemove({ op: 'remove', ids: ['A', 'B', 'A', ' C '] }, reg);
  ok(same(p.removed.slice().sort(), ['A', 'B', 'C']), 'ids 三个目标都删、重复 A 只出现一次');
  ok(same(p.seeds.sort(), ['A', 'B', 'C']), 'seeds 去重且 trim 后仍正确');
  ok(p.removed.length === 3, '没有重复项');
}

section('C. 缺失 id 宽容（不整批失败）');
{
  const p = planRemove({ op: 'remove', ids: ['nope', 'A', 'alsoMissing'] }, empty());
  ok(same(p.missing, ['nope', 'alsoMissing']), '不存在的 id 记入 missing');
  ok(same(p.removed, ['A']), '仍删除存在的一项');
  ok(planRemove({ op: 'remove', id: 'nope' }, empty()).removed.length === 0, '全部不存在时 removed 为空且不抛错');
}

section('D. 多级级联（parents）与依赖倒序');
{
  const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' };
  const s1 = { id: 's1', parents: [A, B] };          // 一线段依赖 A
  const tri = { id: 'tri', parents: [A, B, C] };     // 一多边形依赖 A
  const M = { id: 'M', parents: [s1] };              // 二级：依赖依赖者 s1
  const other = { id: 'other', parents: [B, C] };    // 与 A 无关，不该被删
  const p = planRemove({ op: 'remove', id: 'A' }, graph([A, B, C, s1, tri, M, other]));
  ok(same(p.removed.slice().sort(), ['A', 'M', 's1', 'tri']), '级联纳入 s1 / tri / M 且不误删 other');
  ok(p.removed[p.removed.length - 1] === 'A', '被依赖的种子 A 最后删');
  ok(p.removed.indexOf('M') < p.removed.indexOf('s1'), '二级依赖者 M 排在 s1 之前');
  ok(p.removed.indexOf('s1') < p.removed.indexOf('A'), '一级依赖者 s1 排在 A 之前');
  ok(same(p.seeds, ['A']), 'seeds 只含显式目标');
  ok(p.cascade.length === 3, 'cascade 恰好 3 项');
  ok(!has(p.removed, 'other'), '无关元素 other 未被误删');
}

section('E. 三种 childElements 形状 + 字符串 id 引用');
{
  const A = { id: 'A' }, X = { id: 'X' };
  const byObj = { id: 'c1', childElements: { k1: A } };
  const byMap = { id: 'c2', childElements: new Map([['k2', A]]) };
  const byArr = { id: 'c3', childElements: [A] };
  const byStr = { id: 'c4', parents: ['A'] };
  const p = planRemove({ op: 'remove', id: 'A' }, graph([A, X, byObj, byMap, byArr, byStr]));
  ok(same(p.removed.slice().sort(), ['A', 'c1', 'c2', 'c3', 'c4']), '对象 / Map / 数组 / 字符串 id 四种引用都级联到');
  ok(!has(p.removed, 'X'), '无关元素 X 未被误删');
}

section('F. regularPolygon 派生顶点联动');
{
  const hex = { id: 'hex', __aiRegularVertexIds: ['hex1', 'hex2', 'hex3'] };
  const reg = graph([hex, { id: 'hex1' }, { id: 'hex2' }, { id: 'hex3' }, { id: 'O' }]);
  const p = planRemove({ op: 'remove', id: 'hex' }, reg);
  ok(same(p.removed.slice().sort(), ['hex', 'hex1', 'hex2', 'hex3']), '删主图元连带清掉 3 个派生顶点');
  ok(!has(p.removed, 'O'), '圆心 O 不受影响');
}

section('G. 降级：引擎不提供 parents / childElements 时只删显式项');
{
  const reg = graph([{ id: 'A' }, { id: 'B' }, { id: 's1' }]);
  const p = planRemove({ op: 'remove', ids: ['A', 's1'] }, reg);
  ok(same(p.removed.slice().sort(), ['A', 's1']), '无依赖信息时只删点名的两项，不抛错不误删');
  ok(same(p.cascade, []), '级联为空');
  ok(planRemove({ op: 'remove', id: 'A' }, new Map()).removed.length === 0, '空注册表不抛错');
  ok(planRemove({ op: 'remove', id: 'A' }, undefined).removed.length === 0, 'registry 非 Map 也不抛错');
}

section('H. 非法参数一律抛错（清空只能 clear）');
{
  const reg = empty();
  ok(throws(() => planRemove({ op: 'remove', ids: '__all__' }, reg)), 'ids:"__all__" 抛错');
  ok(throws(() => planRemove({ op: 'remove', id: '__all__' }, reg)), 'id:"__all__" 抛错');
  ok(throws(() => planRemove({ op: 'remove' }, reg)), '缺 id / ids 抛错');
  ok(throws(() => planRemove({ op: 'remove', ids: [] }, reg)), '空数组抛错');
  ok(throws(() => planRemove({ op: 'remove', id: '' }, reg)), '空字符串抛错');
  ok(throws(() => planRemove({ op: 'remove', id: '   ' }, reg)), '纯空白 id 抛错');
  ok(throws(() => planRemove({ op: 'remove', id: 42 }, reg)), '数字 id 抛错');
  ok(throws(() => planRemove({ op: 'remove', ids: ['A', null] }, reg)), '数组含 null 抛错');
  ok(throws(() => planRemove({ op: 'remove', ids: ['A', 3] }, reg)), '数组含数字抛错');
  ok(!throws(() => planRemove({ op: 'remove', id: 'A' }, reg)), '合法 id 不抛错');
}

section('I. 链式级联不动点收敛（依赖链 > 3 层）');
{
  const n0 = { id: 'n0' };
  const n1 = { id: 'n1', parents: [n0] };
  const n2 = { id: 'n2', parents: [n1] };
  const n3 = { id: 'n3', parents: [n2] };
  const n4 = { id: 'n4', parents: [n3] };
  const p = planRemove({ op: 'remove', id: 'n0' }, graph([n0, n1, n2, n3, n4]));
  ok(p.removed.length === 5, '4 层依赖全部级联');
  ok(same(p.removed, ['n4', 'n3', 'n2', 'n1', 'n0']), '按依赖倒序 n4→n0');
}

console.log(`\n=== planRemove: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

/**
 * 2D 画板 · regularPolygonSpec 无头单测（AI 作图对标大角几何·小步增量）
 *
 * 落实连续多轮 TODO 交接项①——把此前只在沙盒里临时跑的「2D 协议无头桩回归」
 * 正式入库成 tests/ 单测。regularPolygonSpec 是 js/executor.js 里的模块级纯函数
 * （不依赖 JSXGraph / DOM），Node 22 的 ESM 语法探测可直接 import，无需 package.json。
 *
 * 覆盖：center+radius / circle / vertex / edge 四种定半径定义；inscribed / circumscribed
 * 两种模式；sides 的 sides|n|edges 三别名与 3~24 整数校验；rotate 旋转；
 * edge 的 side:left|right / flip 落在哪一侧、数值换算（边心距 / 顶点半径）；
 * vertexIds 校验；以及 expr 摘要逐字节冻结（防 AI 回放/状态回读格式回归）。
 * 另附几何性质断言：正多边形顶点到中心等距、边心距正确、首顶点落在给定点。
 * 2026-11-16 第七轮追加 section I：edge + toward 点定侧（叉积自动判 left/right、
 * 与 side/flip 互斥、共线/未知点/非 edge 定义抛错、meta.towardSide 回读、expr 格式不变）。
 *
 * 运行：node tests/board2d_regularPolygon_spec.mjs
 * 硬约束：纯 2D，不触碰 3D 分支 / editor.html / appId。
 */
import { regularPolygonSpec } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const nearPt = (p, q, tol = 1e-6) => Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => near(v, q[i], tol));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const spec = (cmd, refs = {}) => regularPolygonSpec(cmd, refs);
const throws = (fn, needle) => {
  try { fn(); return false; }
  catch (e) { return needle ? String(e.message).includes(needle) : true; }
};

/* ---------- A. center + radius（内接 / 外切） ---------- */
section('A. center + radius 定义');
{
  const r = spec({ id: 'hex', sides: 6, center: [0, 0], radius: 2 });
  ok(r.sides === 6 && r.vertices.length === 6, '正六边形 6 个顶点');
  ok(r.mode === 'inscribed' && r.meta.definition === 'center+radius', '默认内接 + 定义标记正确');
  ok(near(r.vertexRadius, 2) && near(r.radius, 2), '内接顶点半径 = 外接圆半径 = 2');
  ok(nearPt(r.vertices[0], [2, 0]), '首顶点落在 +X 轴 (2,0)');
  ok(r.vertices.every((v) => near(dist(v, r.center), 2)), '6 个顶点到圆心等距 = 2');
  ok(r.expr === 'regularPolygon: inscribed n=6 R=2 center(0,0) rotate=0', 'expr 摘要逐字节冻结（内接六边形）');
  ok(r.vertexIds.join(',') === 'hex1,hex2,hex3,hex4,hex5,hex6', '自动 vertexIds hex1..hex6');
}
{
  const r = spec({ id: 'sq', mode: 'circumscribed', sides: 4, center: [0, 0], radius: 2 });
  ok(r.mode === 'circumscribed' && near(r.radius, 2), '外切正方形：radius 是内切圆半径 = 2');
  ok(near(r.vertexRadius, 2 / Math.cos(Math.PI / 4)), '外切顶点半径 = R/cos(180°/n) = 2√2');
  ok(nearPt(r.vertices[0], [2, 2]), '外切正方形首顶点在 (2,2)');
  const side = dist(r.vertices[0], r.vertices[1]);
  ok(near(side, 4), '外切正方形边长 = 2R = 4');
  ok(r.expr === 'regularPolygon: circumscribed n=4 R=2 center(0,0) rotate=0', 'expr 摘要逐字节冻结（外切正方形）');
}

/* ---------- B. sides 三别名与中文 mode ---------- */
section('B. sides 别名（sides|n|edges）与 mode 别名');
{
  const a = spec({ id: 'a', sides: 6, radius: 2 });
  const b = spec({ id: 'a', n: 6, radius: 2 });
  const c = spec({ id: 'a', edges: '6', radius: 2 });
  ok(a.expr === b.expr && b.expr === c.expr, 'sides / n / edges:"6" 三别名产出完全一致的 expr');
  ok(spec({ id: 'x', sides: 4, radius: 1, mode: '内接' }).mode === 'inscribed', '中文 mode「内接」→ inscribed');
  ok(spec({ id: 'x', sides: 4, radius: 1, mode: '外切' }).mode === 'circumscribed', '中文 mode「外切」→ circumscribed');
  ok(spec({ id: 'x', sides: 4, radius: 1, mode: 'out' }).mode === 'circumscribed', '英文别名 mode「out」→ circumscribed');
}

/* ---------- C. rotate ---------- */
section('C. rotate 旋转');
{
  const r = spec({ id: 'p', sides: 4, center: [0, 0], radius: 1, rotate: 30 });
  ok(near(r.rotate, 30), 'rotate = 30° 记录正确');
  ok(nearPt(r.vertices[0], [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]), '旋转后首顶点在 30° 方向');
  ok(r.expr === 'regularPolygon: inscribed n=4 R=1 center(0,0) rotate=30', 'expr 摘要逐字节冻结（rotate）');
}

/* ---------- D. circle 分支：读已画圆的圆心/半径 ---------- */
section('D. circle 分支（引用已画圆）');
{
  const refs = { circle: (id) => (id === 'c1' ? { center: [1, 2], radius: 3 } : null) };
  const r = spec({ id: 'p', sides: 6, circle: 'c1' }, refs);
  ok(r.meta.definition === 'circle' && near(r.radius, 3), 'circle 定义：半径取已画圆 = 3');
  ok(nearPt(r.center, [1, 2]), 'circle 定义：圆心取已画圆 = (1,2)');
  ok(nearPt(r.vertices[0], [4, 2]), 'circle 定义：首顶点在 (圆心x+R, 圆心y) = (4,2)');
  ok(r.expr === 'regularPolygon: inscribed n=6 R=3 center(1,2) rotate=0', 'expr 摘要逐字节冻结（circle）');
}

/* ---------- E. vertex 分支：首顶点落在给定点 ---------- */
section('E. vertex 分支（首顶点落在给定点）');
{
  const r = spec({ id: 'tri', sides: 3, center: [0, 0], vertex: [3, 4] });
  ok(r.meta.definition === 'center+vertex' && near(r.radius, 5), 'vertex 定义：半径 = |center→vertex| = 5');
  ok(near(r.rotate, Math.atan2(4, 3) * 180 / Math.PI), 'vertex 定义：rotate = arctan2(4,3)');
  ok(nearPt(r.vertices[0], [3, 4]), 'vertex 定义：首顶点精确落在 (3,4)');
  ok(r.expr === 'regularPolygon: inscribed n=3 R=5 center(0,0) rotate=53.13', 'expr 摘要逐字节冻结（vertex）');
}
{
  const r = spec({ id: 'sq', sides: 4, center: [0, 0], vertex: [2, 0], mode: 'circumscribed' });
  ok(nearPt(r.vertices[0], [2, 0]), '外切 vertex 定义：首顶点仍精确落在 (2,0)');
  ok(near(r.radius, 2 * Math.cos(Math.PI / 4)), '外切 vertex 定义：R = d·cos(180°/n)');
}

/* ---------- F. edge 分支：给定一条边反推中心/半径/朝向 ---------- */
section('F. edge 分支（已知一条边 → 中心/半径/朝向，对标自研数学 DSL）');
{
  const r = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]] });
  ok(r.meta.definition === 'edge', 'edge 定义标记正确');
  ok(near(r.center[0], 1) && near(r.center[1], 1), 'edge 内接正方形中心落在 (1,1)（边 A→B 左侧）');
  ok(near(r.radius, 2 / (2 * Math.sin(Math.PI / 4))), 'edge 顶点半径 = s/(2sin(180°/n)) = √2');
  ok(nearPt(r.vertices[0], [0, 0]), 'edge：首顶点精确落在给定端点 A=(0,0)');
  const side = dist(r.vertices[0], r.vertices[1]);
  ok(near(side, 2), 'edge：正方形边长 = |AB| = 2');
  ok(r.expr === 'regularPolygon: inscribed n=4 R=1.414 center(1,1) rotate=-135 def=edge', 'expr 摘要逐字节冻结（edge，含 def=edge 标记）');
}
{
  const l = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]] });
  const rr = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], side: 'right' });
  const ff = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], flip: true });
  ok(near(rr.center[1], -1), 'side:right 让正方形落到 AB 另一侧，中心 (1,-1)');
  ok(nearPt(l.center, [rr.center[0], -rr.center[1]]), '默认 left 与 right 中心关于边 AB 对称');
  ok(ff.expr === rr.expr, 'flip:true 与 side:right 产出完全一致的 expr');
  ok(nearPt(rr.vertices[0], [0, 0]), 'side:right 首顶点仍在 A=(0,0)');
}
{
  const r = spec({ id: 'sq', sides: 4, mode: 'circumscribed', edge: [[0, 0], [2, 0]] });
  ok(near(r.radius, 1), 'edge 外切：radius = 边心距 = s/(2tan(180°/n)) = 1');
  ok(near(r.vertexRadius, Math.SQRT2), 'edge 外切：顶点半径仍 = √2');
  ok(nearPt(r.vertices[0], [0, 0]), 'edge 外切：首顶点仍在 A=(0,0)');
}
{
  const refs = { point: (id) => (id === 'A' ? [0, 0] : id === 'B' ? [2, 0] : null) };
  const r = spec({ id: 'sq', sides: 4, edge: ['A', 'B'] }, refs);
  const r2 = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]] });
  ok(r.expr === r2.expr, 'edge 用点 id（refs.point）与直接给坐标产出一致');
}

/* ---------- G. 错误分支（整条命令失败，杜绝静默猜测） ---------- */
section('G. 错误分支（AI 规划有误时整条失败，不静默吞掉）');
{
  ok(throws(() => spec({ sides: 2, radius: 1 }), '3~24'), 'sides=2 抛错（下界）');
  ok(throws(() => spec({ sides: 25, radius: 1 }), '3~24'), 'sides=25 抛错（上界）');
  ok(throws(() => spec({ sides: 3.5, radius: 1 }), '3~24'), 'sides=3.5 抛错（非整数不四舍五入）');
  ok(throws(() => spec({ sides: 4, radius: 1, mode: 'bad' }), 'mode'), '非法 mode 抛错');
  ok(throws(() => spec({ sides: 4, radius: -2 }), '正数'), '负半径抛错');
  ok(throws(() => spec({ sides: 4, edge: [[0, 0], [2, 0]], radius: 1 }), '混用'), 'edge 与 radius 混用抛错');
  ok(throws(() => spec({ sides: 4, edge: [[0, 0], [0, 0]] }), '重合'), 'edge 两端点重合抛错');
  ok(throws(() => spec({ sides: 4, edge: [[0, 0], [2, 0]], side: 'bad' }), 'side'), '非法 side 抛错');
  ok(throws(() => spec({ sides: 6, radius: 2, vertexIds: ['a', 'a', 'b', 'c', 'd', 'e'] }), '重复'), 'vertexIds 重复抛错');
  ok(throws(() => spec({ id: 'h', sides: 6, radius: 2, vertexIds: ['h', 'b', 'c', 'd', 'e', 'f'] }), '同名'), 'vertexIds 与主 id 同名抛错');
  ok(throws(() => spec({ sides: 6, radius: 2, vertexIds: ['a', 'b'] }), 'vertexIds'), 'vertexIds 数量不符抛错');
  ok(throws(() => spec({ sides: 6, circle: 'missing' }, { circle: () => null }), 'circle'), 'circle 引用不到圆抛错');
}

/* ---------- H. 几何性质：顶点等距 / 边心距 / 显式 vertexIds ---------- */
section('H. 几何性质与显式 vertexIds');
{
  const sides = 8, R = 3;
  const r = spec({ id: 'oct', sides, center: [1, -1], radius: R });
  ok(r.vertices.every((v) => near(dist(v, r.center), R)), '正八边形 8 顶点到圆心 (1,-1) 等距 = 3');
  const lens = r.vertices.map((v, i) => dist(v, r.vertices[(i + 1) % sides]));
  ok(lens.every((L) => near(L, lens[0])), '正八边形各边长相等');
  ok(near(lens[0], 2 * R * Math.sin(Math.PI / sides)), '边长 = 2R·sin(180°/n)');
}
{
  const ids = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'];
  const r = spec({ id: 'hex', sides: 6, radius: 2, vertexIds: ids });
  ok(r.vertexIds.join(',') === ids.join(','), '显式 vertexIds 原样采用');
}

/* ---------- I. edge + toward 点定侧（2026-11-16 第七轮新增，落实连续多轮 TODO ⑥） ---------- */
section('I. edge + toward 点定侧（MCP 式「读取画板状态 → 继续构造」）');
{
  const A = [0, 0], B = [2, 0];
  const base = { id: 'sq', sides: 4, edge: [A, B] };
  const up = spec({ ...base, toward: [1, 2] });
  const down = spec({ ...base, toward: [1, -2] });
  ok(nearPt(up.center, [1, 1]) && up.meta.towardSide === 'left', 'toward 在 AB 上方 → 中心 (1,1)、towardSide=left');
  ok(nearPt(down.center, [1, -1]) && down.meta.towardSide === 'right', 'toward 在 AB 下方 → 中心 (1,-1)、towardSide=right');
  ok(up.expr === spec({ ...base, side: 'left' }).expr, 'toward(上) 与 side:left 产出完全一致的 expr（expr 格式不变）');
  ok(down.expr === spec({ ...base, side: 'right' }).expr, 'toward(下) 与 side:right 产出完全一致的 expr');
  ok(nearPt(up.vertices[0], A) && near(dist(up.vertices[0], up.vertices[1]), 2), 'toward 定侧后首顶点仍落在 A、边长仍 = |AB|');
}
{
  // 斜边验证：A→B 不再水平，AI 手写 left/right 极易判反；toward 用叉积自动定侧
  const A = [0, 0], B = [2, 2];
  const r = spec({ id: 'sq', sides: 4, edge: [A, B], toward: [0, 3] });
  const l = spec({ id: 'sq', sides: 4, edge: [A, B], side: 'left' });
  ok(r.expr === l.expr && r.meta.towardSide === 'left', '斜边：toward(0,3) 自动判为 left，与显式 side:left 一致');
  const r2 = spec({ id: 'sq', sides: 4, edge: [A, B], toward: [3, 0] });
  ok(r2.expr === spec({ id: 'sq', sides: 4, edge: [A, B], side: 'right' }).expr, '斜边：toward(3,0) 自动判为 right');
}
{
  const refs = { point: (id) => (id === 'C' ? [1, 2] : id === 'D' ? [1, -2] : null) };
  const a = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], toward: 'C' }, refs);
  const b = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], toward: [1, 2] });
  ok(a.expr === b.expr, 'toward 用点 id（refs.point）与直接给坐标产出一致');
  const c = spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], toward: 'D' }, refs);
  ok(c.meta.towardSide === 'right', 'toward 点 id 在另一侧 → right');
  ok(throws(() => spec({ id: 'sq', sides: 4, edge: [[0, 0], [2, 0]], toward: 'missing' }, refs), 'toward'), 'toward 引用不到点抛错（不静默忽略）');
}
{
  const base = { id: 'sq', sides: 4, edge: [[0, 0], [2, 0]] };
  ok(throws(() => spec({ ...base, toward: [1, 2], side: 'right' }), '混用'), 'toward 与 side 混用抛错');
  ok(throws(() => spec({ ...base, toward: [1, 2], flip: true }), '混用'), 'toward 与 flip 混用抛错');
  ok(throws(() => spec({ ...base, toward: [1, 0] }), '直线上'), 'toward 落在 AB 所在直线上抛错（不静默猜）');
  ok(throws(() => spec({ ...base, toward: [3, 0] }), '直线上'), 'toward 在 AB 延长线上同样抛错');
  ok(throws(() => spec({ id: 'x', sides: 4, radius: 1, toward: [1, 2] }), 'edge'), 'toward 用在非 edge 定义下抛错');
  ok(spec(base).expr === 'regularPolygon: inscribed n=4 R=1.414 center(1,1) rotate=-135 def=edge', '不带 toward 的 edge 行为逐字节不变（回归护栏）');
}
{
  // 外切 + toward：radius 仍是边心距，中心方位由 toward 决定
  const r = spec({ id: 'sq', sides: 4, mode: 'circumscribed', edge: [[0, 0], [2, 0]], toward: [1, -2] });
  ok(near(r.center[1], -1) && near(r.radius, 1), '外切 + toward(下)：中心 (1,-1)、radius=边心距=1');
  ok(near(r.vertexRadius, Math.SQRT2), '外切 + toward：顶点半径仍 √2');
  ok(r.meta.towardSide === 'right', '外切 + toward：towardSide 照常回读');
}

console.log(`\n=== regularPolygonSpec: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

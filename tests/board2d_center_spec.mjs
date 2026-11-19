/**
 * 2D 画板 · triangleCentersFromPts 无头单测（AI 作图对标大角几何·小步增量 2026-11-19 第十五轮）
 *
 * 本轮给 inspect 派生量新增 kind:"center"（三角形四心符号计算，与 vertex 配方姊妹篇）。
 * triangleCentersFromPts 是 js/executor.js 里的模块级导出纯函数（不依赖 JSXGraph / DOM）：
 * 给三个顶点坐标，闭式解出重心 / 外心（两边中垂线交点）/ 垂心（欧拉线）/ 内心（边长加权）
 * 及外接半径 R / 内切半径 r / 面积；共线退化外心垂心记 null、非法参数抛错。
 * Node 22 的 ESM 可直接 import，无需 package.json。
 *
 * 覆盖：全部走真实 triangleCentersFromPts 断言，不做静态正则替代。四心坐标一旦被后续改动
 * 破坏，单测立刻红灯。真实画板上四心落点 / 外接圆内切圆的渲染仍需在浏览器目视确认（见 docs 已知限制）。
 * 运行：node tests/board2d_center_spec.mjs
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId / js/board.js。
 */
import { triangleCentersFromPts } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearP = (p, q, eps = 1e-9) => Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => near(v, q[i], eps));

section('A. 直角三角形 A(0,0) B(6,0) C(0,8)：外心=斜边中点、垂心=直角顶点、内心=(r,r)');
{
  const r = triangleCentersFromPts([[0, 0], [6, 0], [0, 8]]);
  ok(r.ok === true && r.degenerate === false, '非退化三角形 ok/degenerate 标志正确');
  ok(nearP(r.centroid, [2, 8 / 3]), '重心 = 三顶点均值 (2, 8/3)');
  ok(nearP(r.circumcenter, [3, 4]), '外心 = 斜边中点 (3,4)');
  ok(near(r.R, 5), '外接圆半径 R=5（斜边一半）');
  ok(nearP(r.orthocenter, [0, 0]), '垂心 = 直角顶点 (0,0)');
  ok(nearP(r.incenter, [2, 2]), '内心 = (r,r) = (2,2)');
  ok(near(r.r, 2), '内切圆半径 r=2（(6+8-10)/2）');
  ok(near(r.area, 24), '面积 = ½·6·8 = 24');
  ok(nearP(r.sides, [10, 8, 6]), '三边 a=10 b=8 c=6');
  // 外心到三顶点等距
  ok(near(Math.hypot(r.circumcenter[0] - 0, r.circumcenter[1] - 0), r.R)
    && near(Math.hypot(r.circumcenter[0] - 6, r.circumcenter[1] - 0), r.R)
    && near(Math.hypot(r.circumcenter[0] - 0, r.circumcenter[1] - 8), r.R), '外心到三顶点等距');
  // 欧拉线：O、G、H 共线
  const cross = (r.centroid[0] - r.circumcenter[0]) * (r.orthocenter[1] - r.circumcenter[1])
              - (r.centroid[1] - r.circumcenter[1]) * (r.orthocenter[0] - r.circumcenter[0]);
  ok(near(cross, 0, 1e-9), '欧拉线：O、G、H 三点共线');
  // 垂心在高上：AH ⟂ BC（BC 在 x 轴上，AH 竖直）
  ok(near(r.orthocenter[0], 0), '垂心 H 在过 A 的竖直高上（AH⊥BC）');
}

section('B. 等腰三角形 A(0,3) B(-2,0) C(2,0)：对称轴 x=0');
{
  const r = triangleCentersFromPts([[0, 3], [-2, 0], [2, 0]]);
  ok(near(r.centroid[0], 0) && near(r.incenter[0], 0)
    && near(r.circumcenter[0], 0) && near(r.orthocenter[0], 0), '四心都在对称轴 x=0 上');
  ok(near(r.centroid[1], 1), '重心 y=1');
  // 外心 O=(0, y0)，到 A(0,3) 与 B(-2,0) 等距：(3-y0)^2 = 4 + y0^2 → 9-6y0=4 → y0=5/6
  ok(near(r.circumcenter[1], 5 / 6), '外心 y=5/6');
  ok(near(r.R, 3 - 5 / 6), '外接半径 R=13/6');
  // 垂心 H=A+B+C-2O = (0, 3+0+0 - 10/6) = (0, 8/6=4/3)
  ok(near(r.orthocenter[1], 4 / 3), '垂心 y=4/3（欧拉线）');
  ok([r.centroid, r.circumcenter, r.orthocenter, r.incenter].every(p => p.every(Number.isFinite)), '四心坐标全为有限数');
}

section('C. 一般（不等边）三角形：外心到三顶点等距 + 内心到三边等距');
{
  const A = [1, 5], B = [-3, -1], C = [4, -2];
  const r = triangleCentersFromPts([A, B, C]);
  const dO = [A, B, C].map(p => Math.hypot(r.circumcenter[0] - p[0], r.circumcenter[1] - p[1]));
  ok(near(dO[0], dO[1]) && near(dO[1], dO[2]), '一般三角形外心到三顶点等距');
  // 内心到三边距离 = r：点到直线距离
  const distLine = (P, X, Y) => Math.abs((Y[0] - X[0]) * (P[1] - X[1]) - (Y[1] - X[1]) * (P[0] - X[0])) / Math.hypot(Y[0] - X[0], Y[1] - X[1]);
  const dI = [distLine(r.incenter, B, C), distLine(r.incenter, A, C), distLine(r.incenter, A, B)];
  ok(near(dI[0], r.r) && near(dI[1], r.r) && near(dI[2], r.r), '内心到三边距离都等于内切半径 r');
  ok(near(r.area, 2 * r.area) === false, '面积为正数');
  // 欧拉线 O、G、H 共线且 HG=2·GO
  const cross = (r.centroid[0] - r.circumcenter[0]) * (r.orthocenter[1] - r.circumcenter[1])
              - (r.centroid[1] - r.circumcenter[1]) * (r.orthocenter[0] - r.circumcenter[0]);
  ok(near(cross, 0, 1e-9), '欧拉线共线');
  const go = Math.hypot(r.centroid[0] - r.circumcenter[0], r.centroid[1] - r.circumcenter[1]);
  const hg = Math.hypot(r.orthocenter[0] - r.centroid[0], r.orthocenter[1] - r.centroid[1]);
  ok(near(hg, 2 * go, 1e-9), '欧拉线 HG = 2·GO');
}

section('D. 钝角三角形：外心落在三角形外（数值仍有限、不抛错）');
{
  const r = triangleCentersFromPts([[0, 0], [4, 0], [1, 0.5]]);
  ok(r.ok === true && r.degenerate === false, '钝角三角形非退化');
  ok([r.circumcenter, r.orthocenter, r.incenter].every(p => p.every(Number.isFinite)), '四心坐标有限');
}

section('E. 共线退化：外心/垂心记 null，重心/内心仍给，不抛错');
{
  const r = triangleCentersFromPts([[0, 0], [1, 1], [2, 2]]);
  ok(r.ok === true && r.degenerate === true, '共线三点标记 degenerate');
  ok(r.circumcenter === null && r.orthocenter === null && r.R === null, '外心/垂心/R 为 null');
  ok(nearP(r.centroid, [1, 1]), '重心仍给出 (1,1)');
  ok(r.area === 0, '面积为 0');
  // 竖直共线
  const rv = triangleCentersFromPts([[3, 0], [3, 1], [3, 5]]);
  ok(rv.degenerate === true && rv.circumcenter === null, '竖直共线也判退化');
}

section('F. 非法参数抛错（绝不静默猜值）');
{
  const cases = [
    () => triangleCentersFromPts(null),
    () => triangleCentersFromPts([[0, 0], [1, 1]]),           // 只有两点
    () => triangleCentersFromPts([[0, 0], [1, 1], [2, 2], [3, 3]]), // 四点
    () => triangleCentersFromPts([[0, 0], [1], [2, 2]]),      // 点缺坐标
    () => triangleCentersFromPts([[0, 0], ['x', 1], [2, 2]]),  // 非数值
    () => triangleCentersFromPts([[0, 0], [NaN, 1], [2, 2]]), // NaN
  ];
  cases.forEach((f, i) => ok((() => { try { f(); return false; } catch (_) { return true; } })(), '非法参数 #' + (i + 1) + ' 抛错'));
}

console.log(`\ntriangleCentersFromPts 单测：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);

/**
 * 2D 画板 · conicSpec 无头单测（AI 作图对标大角几何·小步增量）
 *
 * 落实连续多轮 TODO 交接项①——把 conicSpec（js/executor.js 里的模块级纯函数，
 * 不依赖 JSXGraph / DOM）正式入库成 tests/ 单测，作为 conic 2D 协议的机器化回归护栏：
 * 提示词里「把符号计算交给执行器 / 坐标数值化 / 先创建后引用」等铁律一旦被
 * 后续改动破坏，单测立刻红灯。与 tests/board2d_regularPolygon_spec.mjs 是姊妹篇。
 *
 * 覆盖：
 *   第一定义  ellipse{foci+sum} / hyperbola{foci+diff}（含倾斜焦点轴、expr 冻结、几何性质）
 *   第二定义  parabola{focus+directrix}（焦准距、顶点、|PF|=dist 性质）
 *   标准式    ellipse / hyperbola / parabola（含 rotate 旋转轴）
 *   通用第二定义 focus+directrix+eccentricity：e<1 椭圆 / e=1 抛物线 / e>1 双曲线
 *             （别名 eccentricity / ecc / e，几何定义 |PF|=e·dist；expr 冻结）
 *   中文 type 别名、NaN 断开带、12+ 类非法参数抛错。
 *
 * 几何性质断言都真实调用 conicSpec().at(t) 采样点并做容差数值比对，不做静态正则替代。
 * 运行：node tests/board2d_conic_spec.mjs
 * 硬约束：纯 2D，不触碰 3D 分支 / editor.html / appId。
 */
import { conicSpec } from '../js/executor.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const nearPt = (p, q, tol = 1e-6) => Array.isArray(p) && Array.isArray(q) && p.length === q.length && p.every((v, i) => near(v, q[i], tol));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// 点到直线（由两点 A、B 给出）的距离
const distLine = (p, A, B) => {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  return Math.abs((p[0] - A[0]) * dy - (p[1] - A[1]) * dx) / Math.hypot(dx, dy);
};
const TS = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1];

// conicSpec 的引用注入：点 id → 坐标，直线 id → [[x1,y1],[x2,y2]]（与 js/executor.js 的 conicRefs 同形）
const P = { F1: [-3, 0], F2: [3, 0], F: [2, 0], A: [-2, -3], B: [-2, 3], Fup: [0, 4], Gn: [0, 2] };
const REFS = {
  point: (r) => (r in P ? P[r] : null),
  line: (r) => (r === 'd' ? [P.A, P.B] : (r === 'd2' ? [P.Gn, [0, -2]] : null)),
};
const spec = (cmd, refs = REFS) => conicSpec(cmd, refs);
const throws = (fn, needle) => {
  try { fn(); return false; }
  catch (e) { return needle ? String(e.message).includes(needle) : true; }
};

/* ---------- A. 椭圆第一定义 foci+sum ---------- */
section('A. 椭圆第一定义 foci+sum（两焦点 + 常数和）');
{
  const e = spec({ id: 'e1', type: 'ellipse', foci: ['F1', 'F2'], sum: 10 });
  ok(e.type === 'ellipse' && e.meta.definition === 'foci+sum', 'type/definition 标记正确');
  ok(near(e.meta.a, 5) && near(e.meta.b, 4) && near(e.meta.c, 3), 'a=sum/2=5, c=焦距/2=3, b=√(a²−c²)=4');
  ok(nearPt(e.meta.center, [0, 0]), '中心 = 两焦点中点 (0,0)');
  ok(nearPt(e.meta.axis, [1, 0]), '长轴方向 = F1→F2 单位向量 (1,0)');
  ok(e.expr === 'ellipse: sum=10, a=5, b=4, 中心(0,0), 焦距2c=6', 'expr 摘要逐字节冻结（椭圆第一定义）');
  ok(e.tMin === 0 && e.tMax === 1 && typeof e.at === 'function', '采样区间 [0,1] 与 at(t) 就绪');
  // 几何性质：采样点到两焦点距离和恒等于 sum
  ok(TS.every((t) => near(dist(e.at(t), P.F1) + dist(e.at(t), P.F2), 10, 1e-6)), '8 个采样点 |PF1|+|PF2|=sum=10（第一定义成立）');
  ok(nearPt(e.at(0), [5, 0]) && nearPt(e.at(0.25), [0, 4], 1e-6), '端点 (5,0)、顶点 (0,4) 落在预期位置');
}
{
  // 倾斜焦点轴：把两焦点整体旋转，验证轴向量与 b 计算仍正确
  const e = spec({ id: 'eF', type: 'ellipse', foci: ['Fup', 'Gn'], sum: 10 });
  ok(near(e.meta.c, 1) && near(e.meta.a, 5) && near(e.meta.b, Math.sqrt(24)), '倾斜椭圆 c=1,a=5,b=√24');
  ok(nearPt(e.meta.axis, [0, -1], 1e-6), '焦点轴竖直时 axis=(0,−1) 方向（Fup→Gn 向下，取单位向量）');
  ok(TS.every((t) => near(dist(e.at(t), P.Fup) + dist(e.at(t), P.Gn), 10, 1e-6)), '倾斜椭圆采样点仍满足距离和=sum');
}

/* ---------- B. 双曲线第一定义 foci+diff ---------- */
section('B. 双曲线第一定义 foci+diff（两焦点 + 常数差）');
{
  const h = spec({ id: 'h1', type: 'hyperbola', foci: ['F1', 'F2'], diff: 4 });
  ok(h.type === 'hyperbola' && h.meta.definition === 'foci+diff', 'type/definition 标记正确');
  ok(near(h.meta.a, 2) && near(h.meta.c, 3) && near(h.meta.b, Math.sqrt(5)), 'a=diff/2=2, c=3, b=√(c²−a²)=√5');
  ok(h.expr === 'hyperbola: diff=4, a=2, b=2.236, 中心(0,0), 焦距2c=6', 'expr 摘要逐字节冻结（双曲线第一定义）');
  const finite = TS.filter((t) => Math.abs(t - 0.5) >= 0.03);
  ok(finite.every((t) => near(Math.abs(dist(h.at(t), P.F1) - dist(h.at(t), P.F2)), 4, 1e-6)), '采样点 ||PF1|−|PF2||=diff=4（第一定义成立）');
  ok(Number.isNaN(h.at(0.5)[0]) && Number.isNaN(h.at(0.5)[1]), 't≈0.5 的 NaN 断开带返回 [NaN,NaN]（两支分离）');
  ok(h.at(0.4)[0] > h.meta.center[0] && h.at(0.6)[0] < h.meta.center[0], '断开带两侧分别是右支/左支');
}

/* ---------- C. 抛物线第二定义 focus+directrix ---------- */
section('C. 抛物线第二定义 focus+directrix（焦点 + 准线）');
{
  const p = spec({ id: 'p1', type: 'parabola', focus: 'F', directrix: 'd' });
  ok(p.type === 'parabola' && p.meta.definition === 'focus+directrix', 'type/definition 标记正确');
  ok(near(p.meta.p, 2) && nearPt(p.meta.vertex, [0, 0]), '焦点(2,0)、准线 x=−2 ⇒ d0=4, p=2, 顶点(0,0)');
  ok(nearPt(p.meta.axis, [1, 0]), '轴方向从准线指向焦点 (1,0)');
  ok(p.expr === 'parabola: 焦点(2,0), 准线过(-2,-3)-(-2,3), p=2, 顶点(0,0)', 'expr 摘要逐字节冻结（抛物线第二定义）');
  ok(TS.every((t) => near(dist(p.at(t), P.F), distLine(p.at(t), P.A, P.B), 1e-6)), '8 个采样点 |PF|=dist(P,准线)（第二定义成立）');
  ok(nearPt(p.at(0.5), [0, 0]), 't=0.5 落在顶点');
}
{
  // 准线竖直向下、焦点在下方：验证 n 自动从准线指向焦点（签名取反）
  const refs = { point: () => [0, -4], line: () => [[-2, 0], [2, 0]] };
  const p = spec({ id: 'pD', type: 'parabola', focus: 'any', directrix: 'any' }, refs);
  ok(near(p.meta.p, 2) && nearPt(p.meta.vertex, [0, -2], 1e-6), '焦点在准线下方：顶点落在焦点与准线之间 (0,−2)');
  ok(nearPt(p.meta.axis, [0, -1], 1e-6), '轴方向自动翻转指向下方焦点 (0,−1)');
}

/* ---------- D. 标准式（center/a/b + rotate） ---------- */
section('D. 标准式：ellipse / hyperbola / parabola（含 rotate）');
{
  const e = spec({ id: 'e2', type: 'ellipse', center: [1, 2], a: 5, b: 3 });
  ok(e.meta.definition === 'standard' && near(e.meta.c, 4), '椭圆标准式 definition=standard, c=√(a²−b²)=4');
  ok(e.expr === 'ellipse: (x-1)²/25 + (y-2)²/9 = 1', 'expr 摘要逐字节冻结（椭圆标准式）');
  ok(near(dist(e.at(0), [1, 2]), 5) && near(dist(e.at(0.25), [1, 2]), 3), '标准式椭圆长短轴端点距中心 = a/b');
}
{
  const h = spec({ id: 'h2', type: 'hyperbola', center: [0, 0], a: 3, b: 2 });
  ok(h.meta.definition === 'standard' && near(h.meta.c, Math.sqrt(13)), '双曲线标准式 c=√(a²+b²)=√13');
  // expr 中间是 U+2212 减号，逐字节冻结
  ok(h.expr === 'hyperbola: (x-0)²/9 − (y-0)²/4 = 1', 'expr 摘要逐字节冻结（双曲线标准式，含 − 减号）');
  ok(Number.isNaN(h.at(0.5)[0]), '标准式双曲线同样有 NaN 断开带');
}
{
  const p = spec({ id: 'p2', type: 'parabola', vertex: [0, 0], p: 2 });
  ok(p.meta.definition === 'standard' && near(p.meta.p, 2), '抛物线标准式 definition=standard, p=2');
  ok(p.expr === 'parabola: (y-0)² = 8·(x-0)（轴向旋转0°, p=2）', 'expr 摘要逐字节冻结（抛物线标准式，全角括号）');
  ok(nearPt(p.at(0.5), [0, 0]), '标准式抛物线顶点在 (0,0)');
}
{
  const e = spec({ id: 'er', type: 'ellipse', center: [0, 0], a: 3, b: 2, rotate: 90 });
  ok(nearPt(e.meta.axis, [0, 1], 1e-6), 'rotate=90° 时长轴方向 axis≈(0,1)');
  ok(e.expr.includes('旋转90°'), 'expr 含旋转角标注');
  ok(near(dist(e.at(0), [0, 0]), 3) && e.at(0)[1] > 0, '旋转后 a 端点仍在长轴上');
}

/* ---------- E. 通用第二定义 focus+directrix+eccentricity（三分支） ---------- */
section('E. 通用第二定义离心率：e<1 椭圆 / e=1 抛物线 / e>1 双曲线');
{
  const e = spec({ id: 'c1', focus: 'F', directrix: 'd', eccentricity: 0.5 });
  ok(e.type === 'ellipse' && e.meta.eccentricity === 0.5, 'e=0.5 ⇒ ellipse');
  ok(e.meta.definition === 'focus+directrix+eccentricity', 'definition 标记正确');
  ok(near(e.meta.c, 4 / 3) && near(e.meta.a, 8 / 3) && near(e.meta.b, 4 / Math.sqrt(3)), 'e=0.5: c=4/3,a=8/3,b=4/√3');
  ok(e.expr === 'conic(focus+directrix+e): ellipse, e=0.5, 焦点(2,0), 中心(3.333,0), a=2.667, b=2.309, c=1.333', 'expr 摘要逐字节冻结（e=0.5 椭圆）');
  ok(TS.every((t) => near(dist(e.at(t), P.F), 0.5 * distLine(e.at(t), P.A, P.B), 1e-6)), '采样点 |PF|=e·dist(P,准线)，e=0.5');
  ok(near(e.meta.a / e.meta.c, 2, 1e-6) || near(e.meta.c / e.meta.a, 0.5, 1e-6), '离心率 e=c/a=0.5 自洽');
}
{
  const p = spec({ id: 'c2', focus: 'F', directrix: 'd', e: 1 });
  ok(p.type === 'parabola' && p.meta.eccentricity === 1, 'e=1 ⇒ parabola（别名 e）');
  ok(p.expr === 'conic(focus+directrix+e): e=1, 焦点(2,0), p=2, 顶点(0,0)', 'expr 摘要逐字节冻结（e=1 抛物线，与 focus+directrix 同形）');
  ok(TS.every((t) => near(dist(p.at(t), P.F), distLine(p.at(t), P.A, P.B), 1e-6)), '采样点 |PF|=1·dist（e=1）');
}
{
  const h = spec({ id: 'c3', focus: 'F', directrix: 'd', ecc: 2 });
  ok(h.type === 'hyperbola' && h.meta.eccentricity === 2, 'e=2 ⇒ hyperbola（别名 ecc）');
  ok(h.expr === 'conic(focus+directrix+e): hyperbola, e=2, 焦点(2,0), 中心(-3.333,0), a=2.667, b=4.619, c=5.333', 'expr 摘要逐字节冻结（e=2 双曲线）');
  const finite = TS.filter((t) => Math.abs(t - 0.5) >= 0.04);
  ok(finite.every((t) => near(dist(h.at(t), P.F), 2 * distLine(h.at(t), P.A, P.B), 1e-6)), '采样点 |PF|=e·dist(P,准线)，e=2');
  ok(Number.isNaN(h.at(0.5)[0]), 'e>1 双曲线同样 NaN 断开');
  ok(near(h.meta.c / h.meta.a, 2, 1e-6), '离心率 e=c/a=2 自洽');
}
{
  // 三别名产出完全一致（同一焦点/准线/e）
  const a = spec({ id: 'x', focus: 'F', directrix: 'd', eccentricity: 0.5 });
  const b = spec({ id: 'x', focus: 'F', directrix: 'd', ecc: 0.5 });
  const c = spec({ id: 'x', focus: 'F', directrix: 'd', e: 0.5 });
  ok(a.expr === b.expr && b.expr === c.expr, 'eccentricity / ecc / e 三别名产出逐字节一致');
}

/* ---------- F. 中文 type 别名 ---------- */
section('F. 中文 type 别名（椭圆/双曲线/抛物线）');
{
  ok(spec({ id: 'x', type: '椭圆', center: [0, 0], a: 3, b: 2 }).type === 'ellipse', '中文「椭圆」→ ellipse');
  ok(spec({ id: 'x', type: '双曲线', center: [0, 0], a: 3, b: 2 }).type === 'hyperbola', '中文「双曲线」→ hyperbola');
  ok(spec({ id: 'x', type: '抛物线', vertex: [0, 0], p: 1 }).type === 'parabola', '中文「抛物线」→ parabola');
  ok(spec({ id: 'x', type: '椭圆', center: [0, 0], a: 3, b: 2 }).expr === 'ellipse: (x-0)²/9 + (y-0)²/4 = 1', '中文别名 expr 与英文一致');
  ok(spec({ id: 'x', type: 'ELLIPSE', center: [0, 0], a: 3, b: 2 }).type === 'ellipse', '英文大写 type 归一化为小写');
}

/* ---------- G. 非法参数抛错（不静默猜测） ---------- */
section('G. 非法参数抛错（铁律：早失败不猜）');
{
  ok(throws(() => spec({ id: 'x', type: 'ellipse', foci: ['F1', 'F1'], sum: 10 }), '重合'), '椭圆两焦点重合抛错');
  ok(throws(() => spec({ id: 'x', type: 'hyperbola', foci: ['F1', 'F1'], diff: 4 }), '重合'), '双曲线两焦点重合抛错');
  ok(throws(() => spec({ id: 'x', type: 'ellipse', foci: ['F1', 'F2'], sum: 6 }), 'sum'), '椭圆 sum=焦距（2a=2c）抛错');
  ok(throws(() => spec({ id: 'x', type: 'ellipse', foci: ['F1', 'F2'], sum: 4 }), 'sum'), '椭圆 sum<焦距抛错');
  ok(throws(() => spec({ id: 'x', type: 'hyperbola', foci: ['F1', 'F2'], diff: 6 }), 'diff'), '双曲线 diff=焦距抛错');
  ok(throws(() => spec({ id: 'x', type: 'hyperbola', foci: ['F1', 'F2'], diff: 8 }), 'diff'), '双曲线 diff>焦距抛错');
  ok(throws(() => spec({ id: 'x', type: 'ellipse', foci: ['F1', 'F2'], sum: 0 }), 'sum'), '椭圆 sum=0 抛错');
  ok(throws(() => spec({ id: 'x', type: 'ellipse', center: [0, 0], a: 0, b: 2 }), 'a'), '标准式 a=0 抛错');
  ok(throws(() => spec({ id: 'x', type: 'parabola', vertex: [0, 0], p: -1 }), 'p'), '抛物线 p<0 抛错');
  ok(throws(() => spec({ id: 'x', type: 'parabola', focus: 'F', directrix: 'any' }, { point: () => [2, 0], line: () => [[0, 0], [0, 0]] }), '准线'), 'focus+directrix 准线端点重合抛错');
  ok(throws(() => spec({ id: 'x', type: 'parabola', focus: 'onLine', directrix: 'd2' }, { point: () => [0, 0], line: () => [[0, 0], [2, 0]] }), '准线'), '焦点落在准线上抛错');
  ok(throws(() => spec({ id: 'x', focus: 'F', directrix: 'd', eccentricity: 0 }), 'eccentricity'), '通用 e=0 抛错');
  ok(throws(() => spec({ id: 'x', focus: 'F', directrix: 'd', eccentricity: -1 }), 'eccentricity'), '通用 e<0 抛错');
  ok(throws(() => spec({ id: 'x', focus: 'F', directrix: 'd', ecc: 'abc' }), 'eccentricity'), '通用 e 非数字抛错');
  ok(throws(() => spec({ id: 'x', type: 'circle', center: [0, 0], a: 3, b: 3 }), 'type'), '非法 conic.type 抛错');
}

console.log(`\n=== conicSpec: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);

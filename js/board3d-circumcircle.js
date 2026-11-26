/**
 * 立体画板「空间不共线三点定圆（circumcircle3d）」纯函数语义层（2026-11-27 D45 增量）
 *
 * 与 js/board3d-sectionsphere.js / -circumsphere.js / -insphere.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给三个不共线的空间点 P0/P1/P2（三点共圆），自动反求它们所在圆的圆心 O 与半径 R，
 * 一次画出三角形线框 + 圆（正交标架参数采样闭合环）+ 圆心到三点的半径线段 + 圆心处法向示意，
 * 并标出圆心 O、顶点 A/B/C、半径 R（可选法向 n）。三点到圆心恒等距、采样点恒在圆平面且恒距 O 为 R。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - arc3d：只按「圆心 + 半径 + 起止角」生成圆弧，要求先知道圆心与半径，求不出「给定三点反求圆」；
 *   - circle 内置图元：只能画水平（法向固定）圆，且需先给圆心与半径，表达不了任意朝向、由三点确定的圆；
 *   - circumcircle（2D 外接圆）：2D 分支没有原生 op，更不处理空间三点与圆所在平面的法向；
 *   - solidmetrics3d 的 asCircumcircle：只针对正多面体外接球大圆，不是「任意三点定圆」。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   令 e1=P1−P0，e2=P2−P0，平面单位法向 n=normalize(e1×e2)（e1×e2≈0 即共线/重合，拒绝）。
 *   圆心在三点平面内，设 O=P0+a·e1+b·e2。由 |O−P0|²=|O−P1|² 与 |O−P0|²=|O−P2|² 得 2×2 线性方程组：
 *     2A·a + 2B·b = A      其中 A=|e1|², B=e1·e2, C=|e2|²
 *     2B·a + 2C·b = C
 *   行列式 det=4(AC−B²)；AC−B²=|e1×e2|²>0（不共线保证），近零（病态/几乎共线）拒绝。
 *     a = C(A−B)/(2(AC−B²)),  b = A(C−B)/(2(AC−B²))
 *   R=|O−P0|；二阶交叉校验 R=abc/(4S)（a/b/c 为三边长、S=|e1×e2|/2 为三角形面积），
 *   两式不符（>1% 容差）整条拒绝，杜绝抄错圆心/半径。
 *   正交标架：u=normalize(P0−O)（圆心指向 P0），v=normalize(n×u)，u⊥v⊥n 且均为单位向量。
 *   圆采样点 Q(θ)=O+R·(cosθ·u+sinθ·v)，满足 |Q−O|=R、(Q−O)·n=0、三点到 O 均=R。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_RADIUS_COLOR = '#e0a020';
const DEFAULT_NORMAL_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 采样段数 / 小球 / 法向示意区间与缺省 */
export const CIRCUMCIRCLE3D_SEGMENTS_MIN = 8;
export const CIRCUMCIRCLE3D_SEGMENTS_MAX = 512;
export const CIRCUMCIRCLE3D_SEGMENTS_DEFAULT = 64;
export const CIRCUMCIRCLE3D_VERTEX_SIZE_MIN = 0.01;
export const CIRCUMCIRCLE3D_VERTEX_SIZE_MAX = 1;
export const CIRCUMCIRCLE3D_VERTEX_SIZE_DEFAULT = 0.1;
export const CIRCUMCIRCLE3D_NORMAL_LEN_MIN = 0.01;
export const CIRCUMCIRCLE3D_NORMAL_LEN_MAX = 10;
export const CIRCUMCIRCLE3D_NORMAL_LEN_DEFAULT = 1;

/** 一条命令生成的 line 段总数上限（三角形 3 + 圆 segments + 半径 3 + 法向 1） */
export const CIRCUMCIRCLE3D_MAX_SEGMENTS = 2048;

/** 默认三点：xy 平面单位圆内接正三角形（圆心原点、半径 1） */
export const CIRCUMCIRCLE3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([-0.5, 0.8660254, 0]),
  Object.freeze([-0.5, -0.8660254, 0]),
]);

/** 相对容差（守恒守护） */
const REL_TOL = 0.02;

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组/Infinity/NaN）一律拒绝 */
export function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

function clamp(x) {
  return Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, x));
}

/** 四位小数取整并归一 -0，便于稳定序列化 / 断言 */
function r4(x) {
  const n = Math.round(x * 1e4) / 1e4;
  return n === 0 ? 0 : n;
}

function r4Vec(p) {
  return p.map((x) => r4(clamp(x)));
}

/** 解析三维点：长度 3 的有限数值数组（数字字符串容错），否则 null */
export function parseCirclePoint(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = [];
  for (const x of v) {
    const n = num(x);
    if (n === null) return null;
    out.push(clamp(n));
  }
  return out;
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a) => Math.sqrt(dot3(a, a));
const unit = (a) => {
  const m = len3(a);
  return m > 1e-9 ? [a[0] / m, a[1] / m, a[2] / m] : null;
};

/**
 * 三点定圆的纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {points:[[x,y,z],[x,y,z],[x,y,z]]}（points 缺省用单位圆内接正三角形）
 * @returns {{ok:boolean, error?:string, O?:Array, R?:number, n?:Array, u?:Array, v?:Array,
 *            P?:Array, A?:number, B?:number, C?:number, area?:number, sides?:Array,
 *            R2?:number}|null}
 */
export function circumcircleGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const raw = cmd.points === undefined ? CIRCUMCIRCLE3D_DEFAULT_POINTS : cmd.points;
  if (!Array.isArray(raw) || raw.length !== 3) return { ok: false, error: 'points 需为三点 [p0,p1,p2]' };
  const P = raw.map(parseCirclePoint);
  if (P.some((q) => q === null)) return { ok: false, error: 'points 每个点需为合法 [x,y,z]' };

  const e1 = sub3(P[1], P[0]);
  const e2 = sub3(P[2], P[0]);
  const cr = cross3(e1, e2);
  const m = len3(cr);
  if (!Number.isFinite(m) || m < 1e-6) return { ok: false, error: '三点共线或重合，无法确定唯一圆' };
  const n = unit(cr);
  if (!n) return { ok: false, error: '法向构造失败' };

  const A = dot3(e1, e1);
  const B = dot3(e1, e2);
  const C = dot3(e2, e2);
  const det = A * C - B * B; // = |e1×e2|² > 0
  if (!Number.isFinite(det) || det < 1e-10 * Math.max(1, A * C)) {
    return { ok: false, error: '三点近乎共线（病态），拒绝定圆' };
  }
  const aCoef = C * (A - B) / (2 * det);
  const bCoef = A * (C - B) / (2 * det);
  const O = add3(P[0], add3(mul3(e1, aCoef), mul3(e2, bCoef)));
  const R = len3(sub3(O, P[0]));
  if (!Number.isFinite(R) || R < 1e-6 || R > COORD_LIMIT) {
    return { ok: false, error: '圆半径越界或退化' };
  }

  // 二阶交叉校验：R2 = abc/(4S) = abc/(2m)
  const sides = [len3(sub3(P[1], P[0])), len3(sub3(P[2], P[1])), len3(sub3(P[0], P[2]))];
  const area = m / 2;
  const R2 = (sides[0] * sides[1] * sides[2]) / (4 * area);
  if (Math.abs(R - R2) > 0.01 * Math.max(1, R)) {
    return { ok: false, error: '圆心/半径二阶交叉校验失败（两解式不符）' };
  }

  const u = unit(sub3(P[0], O));
  if (!u) return { ok: false, error: '圆心指向首点的方向退化' };
  const v = unit(cross3(n, u));
  if (!v) return { ok: false, error: '正交标架构造失败' };

  return { ok: true, O, R, n, u, v, P, A, B, C, area, sides, R2 };
}

/**
 * 解析一条 circumcircle3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"circumcircle3d","id":"cc","points":[[1,0,0],[-0.5,0.866,0],[-0.5,-0.866,0]],
 *    "segments":64,"normalLen":1,"asTriangle":true,"asCircle":true,"asRadii":true,
 *    "asNormal":false,"asPoints":false,"labelCenter":true,"labelVertices":true,
 *    "labelRadius":true,"labelNormal":false,"vertexSize":0.1,"color":"#2b7fd4"}
 *   - points            可选，三个不共线点 [p0,p1,p2]（缺省用 xy 平面单位圆内接正三角形）；
 *   - segments          可选，圆采样段数（默认 64，8~512 整数）；
 *   - normalLen         可选，圆心处法向示意线段长度（默认 1，0.01~10）；
 *   - asTriangle        可选，是否画三边三角形线框（默认 true）；
 *   - asCircle          可选，是否画圆（默认 true）；
 *   - asRadii           可选，是否画圆心到三点的半径线段（默认 true）；
 *   - asNormal          可选，是否画圆心处法向示意线段（默认 false）；
 *   - asPoints          可选，是否在圆心/三顶点/圆采样点放小球（默认 false）；
 *   - labelCenter / labelVertices / labelRadius / labelNormal：标注开关（默认依次 true/true/true/false）；
 *   - vertexSize / color / radiusColor / normalColor / labelColor / opacity：样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveCircumcircle3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'cc' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 几何解 ----
  const g = circumcircleGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- segments / normalLen / vertexSize ----
  const segRaw = num(cmd.segments === undefined ? CIRCUMCIRCLE3D_SEGMENTS_DEFAULT : cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < CIRCUMCIRCLE3D_SEGMENTS_MIN || segRaw > CIRCUMCIRCLE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${CIRCUMCIRCLE3D_SEGMENTS_MIN}~${CIRCUMCIRCLE3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  const nlRaw = num(cmd.normalLen === undefined ? CIRCUMCIRCLE3D_NORMAL_LEN_DEFAULT : cmd.normalLen);
  if (nlRaw === null) return { ok: false, error: 'normalLen 必须是数字' };
  if (nlRaw < CIRCUMCIRCLE3D_NORMAL_LEN_MIN || nlRaw > CIRCUMCIRCLE3D_NORMAL_LEN_MAX) {
    return { ok: false, error: `normalLen 需为 ${CIRCUMCIRCLE3D_NORMAL_LEN_MIN}~${CIRCUMCIRCLE3D_NORMAL_LEN_MAX}` };
  }
  const normalLen = r4(nlRaw);

  const vsRaw = num(cmd.vertexSize === undefined ? CIRCUMCIRCLE3D_VERTEX_SIZE_DEFAULT : cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < CIRCUMCIRCLE3D_VERTEX_SIZE_MIN || vsRaw > CIRCUMCIRCLE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${CIRCUMCIRCLE3D_VERTEX_SIZE_MIN}~${CIRCUMCIRCLE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 布尔开关：出现即须布尔 ----
  const boolFields = [
    'asTriangle', 'asCircle', 'asRadii', 'asNormal', 'asPoints',
    'labelCenter', 'labelVertices', 'labelRadius', 'labelNormal',
  ];
  const boolDefaults = {
    asTriangle: true, asCircle: true, asRadii: true, asNormal: false, asPoints: false,
    labelCenter: true, labelVertices: true, labelRadius: true, labelNormal: false,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asTriangle', 'asCircle', 'asRadii'].some((f) => flags[f])) {
    return { ok: false, error: 'asTriangle / asCircle / asRadii 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'radiusColor', 'normalColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const radiusColor = color(cmd.radiusColor, DEFAULT_RADIUS_COLOR);
  const normalColor = color(cmd.normalColor, DEFAULT_NORMAL_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整后的输出几何 ----
  const O = r4Vec(g.O);
  const P = g.P.map(r4Vec);
  const N = r4Vec(g.n);
  const U = r4Vec(g.u);
  const V = r4Vec(g.v);
  const R = r4(g.R);

  // 圆采样点 Q(θ)=O+R·(cosθ·u+sinθ·v)（全精度算、取整输出）
  const circlePts = [];
  for (let i = 0; i < segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    const c = Math.cos(th) * R;
    const s = Math.sin(th) * R;
    circlePts.push(r4Vec([
      O[0] + c * U[0] + s * V[0],
      O[1] + c * U[1] + s * V[1],
      O[2] + c * U[2] + s * V[2],
    ]));
  }

  // 法向示意线段末端
  const tip = r4Vec(add3(O, mul3(N, normalLen)));

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let radiusMaxDev = 0;
  for (const q of circlePts) radiusMaxDev = Math.max(radiusMaxDev, Math.abs(len3(sub3(q, O)) - R));
  let planarMaxDev = 0;
  for (const q of circlePts) planarMaxDev = Math.max(planarMaxDev, Math.abs(dot3(sub3(q, O), N)));
  let vertexMaxDev = 0;
  for (const p of P) vertexMaxDev = Math.max(vertexMaxDev, Math.abs(len3(sub3(p, O)) - R));
  if (radiusMaxDev > REL_TOL * Math.max(1, R) || planarMaxDev > REL_TOL * Math.max(1, R)
      || vertexMaxDev > REL_TOL * Math.max(1, R)) {
    return { ok: false, error: '定圆守恒失败（采样点不共面 / 距圆心不恒为 R / 三顶点不等距）' };
  }

  // ---- 线段总数上限守护 ----
  const lineCount = (flags.asTriangle ? 3 : 0) + (flags.asCircle ? segments : 0)
    + (flags.asRadii ? 3 : 0) + (flags.asNormal ? 1 : 0);
  if (lineCount > CIRCUMCIRCLE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${CIRCUMCIRCLE3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让 ----
  const stem = prefix.slice(0, 56);
  const used = new Set(
    (state && Array.isArray(state.objects) ? state.objects : [])
      .map((o) => o && o.id).filter(Boolean)
  );
  const nextId = (want) => {
    if (!used.has(want)) { used.add(want); return want; }
    let k = 2;
    let cand = `${want.slice(0, 56)}_${k}`.slice(0, 64);
    while (used.has(cand)) { cand = `${want.slice(0, 56)}_${++k}`.slice(0, 64); }
    used.add(cand);
    return cand;
  };

  const mkLine = (id, p1, p2, col = lineColor) => ({
    id,
    type: 'line',
    text: '',
    color: col,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2] },
  });
  const mkPoint = (id, q, col = lineColor) => ({
    id,
    type: 'point',
    text: '',
    color: col,
    opacity: lineOpacity,
    pos: q.slice(),
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { s: vertexSize },
  });
  const mkLabel = (id, text, q) => ({
    id,
    type: 'label',
    text,
    color: labelColor,
    opacity: 1,
    pos: q.slice(),
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: {},
  });

  const items = [];

  // ---- 三边三角形线框 ----
  if (flags.asTriangle) {
    for (let i = 0; i < 3; i++) {
      items.push(mkLine(nextId(`${stem}_tri${i}`.slice(0, 64)), P[i], P[(i + 1) % 3]));
    }
  }

  // ---- 圆（闭合环） ----
  if (flags.asCircle) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_cir${i}`.slice(0, 64)), circlePts[i], circlePts[(i + 1) % segments]));
    }
  }

  // ---- 圆心到三顶点的半径线段 ----
  if (flags.asRadii) {
    for (let i = 0; i < 3; i++) {
      items.push(mkLine(nextId(`${stem}_r${i}`.slice(0, 64)), O, P[i], radiusColor));
    }
  }

  // ---- 圆心处法向示意线段 ----
  if (flags.asNormal) {
    items.push(mkLine(nextId(`${stem}_n`.slice(0, 64)), O, tip, normalColor));
  }

  // ---- 小球：圆心 O、三顶点、圆采样点（每 segments/8 取一） ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O, radiusColor));
    const names = ['pA', 'pB', 'pC'];
    for (let i = 0; i < 3; i++) items.push(mkPoint(nextId(`${stem}_${names[i]}`.slice(0, 64)), P[i]));
    const step = Math.max(1, Math.floor(segments / 8));
    for (let i = 0; i < segments; i += step) {
      items.push(mkPoint(nextId(`${stem}_ps${i}`.slice(0, 64)), circlePts[i]));
    }
  }

  // ---- 标注：圆心 O、顶点 A/B/C、半径 R、法向 n ----
  if (flags.labelCenter) {
    items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', O));
  }
  if (flags.labelVertices) {
    const names = ['A', 'B', 'C'];
    for (let i = 0; i < 3; i++) items.push(mkLabel(nextId(`${stem}_l${names[i]}`.slice(0, 64)), names[i], P[i]));
  }
  if (flags.labelRadius) {
    const rMid = r4Vec([0, 1, 2].map((k) => (O[k] + P[0][k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rMid));
  }
  if (flags.labelNormal && flags.asNormal) {
    items.push(mkLabel(nextId(`${stem}_ln`.slice(0, 64)), 'n', tip));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      points: P.map((p) => p.slice()),
      center: O.slice(),
      radius: R,
      normal: N.slice(),
      basis: { u: U.slice(), v: V.slice(), n: N.slice() },
      sides: g.sides.map(r4),
      triangleArea: r4(g.area),
      radiusCrossCheck: r4(g.R2),
      radiusMaxDev: r4(radiusMaxDev),
      planarMaxDev: r4(planarMaxDev),
      vertexMaxDev: r4(vertexMaxDev),
      segments,
      normalLen,
      vertexSize,
      asTriangle: flags.asTriangle,
      asCircle: flags.asCircle,
      asRadii: flags.asRadii,
      asNormal: flags.asNormal,
      asPoints: flags.asPoints,
      pointCount: flags.asPoints ? 4 + Math.ceil(segments / Math.max(1, Math.floor(segments / 8))) : 0,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      radiusColor,
      normalColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

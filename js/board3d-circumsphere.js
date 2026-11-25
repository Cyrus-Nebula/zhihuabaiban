/**
 * 立体画板「四面体 / 任意四点的外接球（circumsphere3d）」参数化生成命令的纯函数语义层（2026-11-26 D39 增量）
 *
 * 与 js/board3d-pointplane.js / -lineplane.js / -dihedral.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求四点外接球 / 给三棱锥作外接球 / 标出球心与半径」这类意图，用一条命令生成标准作图：
 *   三个正交大圆线框 + 球心到四顶点的半径线段 + 球心/顶点小球 + 球心 O / 顶点 A-D / 半径 R 标注。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - ellipsoid3d 需先给半轴 a/b/c（a=b=c 才是球），capsule3d 需先给球心与两球心距，都要「已知球心半径」；
 *   - polyhedron3d 画正多面体线框，但不求外接球、不标球心；
 *   - measure3d 量两点距离 / 三点夹角 / 中点，给不出外接球；
 *   - circumsphere3d 给「四个不共面点 points」，自动反求唯一外接球心 O 与半径 R，
 *     直接服务「三棱锥外接球 / 四面体外接球 / 长方体外接球 / 标出球心半径」核心用例。
 *
 * 几何定义（外接球心 O 满足 |O−Pi| 对 i=0..3 全相等）：
 *   ai = Pi − P0 (i=1,2,3);  bi = (|Pi|² − |P0|²)/2;
 *   由 |O−Pi|² = |O−P0|² 得线性方程 O·ai = bi (i=1,2,3)，写成 3×3 方程组 A·O = b，
 *   用带主元选取的高斯消元求解；det(A)=0（四点共面 / 重合）时无解 → 整条拒绝。
 *   O    = solve(A, b)                              （外接球心）;
 *   R    = |O − P0|                                 （外接球半径）;
 *   n    = axis 单位向量（默认 z，可用 'x'/'y'/'z' 或非零向量）;
 *   u    = normalize(n × helper),  v = n × u         （垂直 n 的正交单位标架，helper 取与 n 最不平行的坐标轴）;
 *   赤道大圆点 = O + R·(cosθ·u + sinθ·v);
 *   经线大圆1 = O + R·(cosθ·n + sinθ·u);
 *   经线大圆2 = O + R·(cosθ·n + sinθ·v);            （三个大圆所在平面两两正交）
 *
 * 守恒：
 *   |O−Pi| = R 对四个顶点恒成立；每个大圆采样点到球心距离恒为 R；u/v/n 两两垂直且为单位向量；
 *   三个大圆平面法向分别为 n / v / u，两两正交；半径线段一端为球心、另一端恰为顶点。
 *   本命令只校验数值与点位合法，不强制与场景其它对象无交。
 */

/** 每个大圆采样段数合法区间与默认 */
export const CIRCUMSPHERE3D_SEGMENTS_MIN = 8;
export const CIRCUMSPHERE3D_SEGMENTS_MAX = 512;
export const CIRCUMSPHERE3D_SEGMENTS_DEFAULT = 48;

/** 小球半径（与其余 3D 命令同口径） */
export const CIRCUMSPHERE3D_VERTEX_SIZE_MIN = 0.01;
export const CIRCUMSPHERE3D_VERTEX_SIZE_MAX = 1;
export const CIRCUMSPHERE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const CIRCUMSPHERE3D_MAX_SEGMENTS = 4096;

/** 默认四点：单位立方体交错顶点构成的正四面体（球心原点、半径 √3、棱长 2√2） */
export const CIRCUMSPHERE3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([1, 1, 1]),
  Object.freeze([1, -1, -1]),
  Object.freeze([-1, 1, -1]),
  Object.freeze([-1, -1, 1]),
]);
export const CIRCUMSPHERE3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

/** 坐标钳制上限（与 geometry / dihedral / lineplane 一致） */
const COORD_LIMIT = 10000;

/** 线框 / 顶点 / 标注默认颜色 */
const DEFAULT_COLOR = '#4f6bed';
const DEFAULT_LABEL_COLOR = '#e04040';

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

/** 严格解析单个 3D 点 [x,y,z]（非法返回 null） */
function parsePoint3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? r4Vec(out) : null;
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a) => Math.sqrt(dot3(a, a));
/** 不取整的单位向量（用于内部几何计算，避免归一化误差累积） */
const rawUnit = (a) => {
  const m = len3(a);
  return m > 1e-9 ? [a[0] / m, a[1] / m, a[2] / m] : null;
};
const unit = (a) => {
  const u = rawUnit(a);
  return u ? r4Vec(u) : null;
};

/** 解析轴：'x'/'y'/'z' 或非零向量 [x,y,z]（默认 z）。返回不取整单位向量。 */
export function circumsphere3DAxisUnit(v) {
  if (v === undefined) return [0, 0, 1];
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'x') return [1, 0, 0];
    if (s === 'y') return [0, 1, 0];
    if (s === 'z') return [0, 0, 1];
    return null;
  }
  if (Array.isArray(v) && v.length === 3) {
    const a = v.map(num);
    if (a.some((x) => x === null)) return null;
    return rawUnit(a);
  }
  return null;
}

/**
 * 带部分主元选取的高斯消元解 3×3 线性方程组 A·x = b。
 * A 为三行向量 [[a11,a12,a13],...]，奇异（det≈0）返回 null。
 * 纯函数，不修改入参。
 */
export function solve3x3(A, b) {
  if (!Array.isArray(A) || A.length !== 3 || !A.every((r) => Array.isArray(r) && r.length === 3)) return null;
  if (!Array.isArray(b) || b.length !== 3) return null;
  const m = [
    [num(A[0][0]), num(A[0][1]), num(A[0][2]), num(b[0])],
    [num(A[1][0]), num(A[1][1]), num(A[1][2]), num(b[1])],
    [num(A[2][0]), num(A[2][1]), num(A[2][2]), num(b[2])],
  ];
  if (m.some((row) => row.some((x) => x === null))) return null;
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-9) return null; // 奇异：四点共面 / 重合
    if (piv !== col) { const t = m[col]; m[col] = m[piv]; m[piv] = t; }
    const d = m[col][col];
    for (let c = col; c < 4; c++) m[col][c] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

/**
 * 由四点求外接球心（不取整）。共面 / 重合 / 非法返回 null。
 * points 需为 4 个合法 [x,y,z]。
 */
export function circumsphere3DCenter(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const A = [];
  const b = [];
  for (let i = 1; i < 4; i++) {
    A.push(sub3(p[i], p[0]));
    b.push((dot3(p[i], p[i]) - dot3(p[0], p[0])) / 2);
  }
  return solve3x3(A, b);
}

/** 外接球半径 R = |O − P0|（不取整）。入参非法返回 null。 */
export function circumsphere3DRadius(center, points) {
  if (!Array.isArray(center) || center.length !== 3 || center.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p0 = parsePoint3(points[0]);
  if (!p0) return null;
  return len3(sub3(center, p0));
}

/** 正交单位标架 {n, u, v}：n 为轴，u/v 与 n 两两垂直。非法轴返回 null。 */
export function circumsphere3DFrame(axis) {
  const n = circumsphere3DAxisUnit(axis);
  if (!n) return null;
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = rawUnit(cross3(n, helper));
  if (!u) return null;
  const v = rawUnit(cross3(n, u));
  if (!v) return null;
  return { n, u, v };
}

/**
 * 解析一条 circumsphere3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"circumsphere3d","id":"csph","points":[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
 *    "axis":"z","segments":48,"asGreatCircles":true,"asRadii":true,"asPoints":false,
 *    "labelCenter":true,"labelVertices":false,"labelRadius":true,"vertexSize":0.1,"color":"#4f6bed"}
 *   - points        可选，四个不共面点 [[x,y,z]×4]（默认正四面体）；共面 / 重合拒绝；
 *   - axis          可选，大圆基准轴 'x'/'y'/'z' 或非零向量（默认 z）；
 *   - segments      可选，每个大圆采样段数（默认 48，8~512）；
 *   - asGreatCircles 可选，是否画三个正交大圆（默认 true）；
 *   - asRadii       可选，是否画球心到四顶点半径线段（默认 true）；
 *   - asPoints      可选，是否在球心 / 四顶点放小球（默认 false）；
 *   - labelCenter / labelVertices / labelRadius 可选，是否标注球心 O / 顶点 A-D / 半径读数（默认 true / false / true）；
 *   - vertexSize    可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。五个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveCircumsphere3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'csph' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- points：四个不共面点 ----
  const pts = cmd.points === undefined
    ? CIRCUMSPHERE3D_DEFAULT_POINTS.map((p) => p.slice())
    : (Array.isArray(cmd.points) ? cmd.points.map(parsePoint3) : null);
  if (!pts || pts.length !== 4 || pts.some((p) => p === null)) {
    return { ok: false, error: 'points 需为四个合法 [x,y,z]' };
  }

  // ---- axis：大圆基准轴 ----
  const n = circumsphere3DAxisUnit(cmd.axis);
  if (!n) return { ok: false, error: 'axis 需为 x/y/z 或非零向量 [x,y,z]' };
  const frame = circumsphere3DFrame(cmd.axis === undefined ? CIRCUMSPHERE3D_DEFAULT_AXIS : cmd.axis);
  if (!frame) return { ok: false, error: '无法构造正交标架' };
  const { u, v } = frame;

  // ---- segments ----
  const segRaw = cmd.segments === undefined ? CIRCUMSPHERE3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < CIRCUMSPHERE3D_SEGMENTS_MIN || segRaw > CIRCUMSPHERE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${CIRCUMSPHERE3D_SEGMENTS_MIN}~${CIRCUMSPHERE3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- vertexSize ----
  const vsRaw = cmd.vertexSize === undefined ? CIRCUMSPHERE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < CIRCUMSPHERE3D_VERTEX_SIZE_MIN || vsRaw > CIRCUMSPHERE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${CIRCUMSPHERE3D_VERTEX_SIZE_MIN}~${CIRCUMSPHERE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = vsRaw;

  // ---- 布尔开关 ----
  const boolFields = ['asGreatCircles', 'asRadii', 'asPoints', 'labelCenter', 'labelVertices', 'labelRadius'];
  const boolDefaults = { asGreatCircles: true, asRadii: true, asPoints: false, labelCenter: true, labelVertices: false, labelRadius: true };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!boolFields.some((f) => flags[f])) return { ok: false, error: '六个输出开关至少开一个' };

  // ---- 样式 ----
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 求外接球心与半径 ----
  const centerRaw = circumsphere3DCenter(pts);
  if (!centerRaw) return { ok: false, error: '四点共面或重合，无法确定唯一外接球' };
  const radiusRaw = circumsphere3DRadius(centerRaw, pts);
  if (radiusRaw === null || !(radiusRaw > 1e-9)) return { ok: false, error: '外接球半径非法' };

  // 线段总数上限守护（3 个大圆 × segments + 4 条半径）
  const lineCount = (flags.asGreatCircles ? 3 * segments : 0) + (flags.asRadii ? 4 : 0);
  if (lineCount > CIRCUMSPHERE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${CIRCUMSPHERE3D_MAX_SEGMENTS}` };
  }

  // ---- 取整后的输出坐标 / 半径 ----
  const O = r4Vec(centerRaw.map(clamp));
  const R = r4(clamp(radiusRaw));
  const U = r4Vec(u);
  const V = r4Vec(v);
  const N = r4Vec(n);

  // 大圆采样点（全精度算、取整输出）：circle(planeA, planeB) = O + R·(cosθ·A + sinθ·B)
  const circlePts = (pa, pb) => {
    const out = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const c = Math.cos(th) * R;
      const s = Math.sin(th) * R;
      out.push(r4Vec([
        O[0] + c * pa[0] + s * pb[0],
        O[1] + c * pa[1] + s * pb[1],
        O[2] + c * pa[2] + s * pb[2],
      ]));
    }
    return out;
  };
  const equator = circlePts(u, v);           // 法向 n
  const meridian1 = circlePts(n, u);         // 法向 v
  const meridian2 = circlePts(n, v);         // 法向 u

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
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

  const mkLine = (id, p1, p2) => ({
    id,
    type: 'line',
    text: '',
    color: lineColor,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2] },
  });
  const mkPoint = (id, q) => ({
    id,
    type: 'point',
    text: '',
    color: lineColor,
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

  // ---- 三个正交大圆线框（闭合环：每段连接 i → i+1，末段连回起点）----
  if (flags.asGreatCircles) {
    const rings = [equator, meridian1, meridian2];
    const suffixes = ['eq', 'm1', 'm2'];
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_${suffixes[ri]}_${i}`.slice(0, 64)), ring[i], ring[(i + 1) % segments]));
      }
    }
  }

  // ---- 球心到四顶点半径线段 ----
  if (flags.asRadii) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_r${i}`.slice(0, 64)), O, pts[i]));
    }
  }

  // ---- 可选：球心 / 四顶点小球 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_p${i}`.slice(0, 64)), pts[i]));
  }

  // ---- 可选：球心 O / 顶点 A-D / 半径读数标注 ----
  if (flags.labelCenter) items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', O));
  if (flags.labelVertices) {
    const names = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) items.push(mkLabel(nextId(`${stem}_lv${i}`.slice(0, 64)), names[i], pts[i]));
  }
  const radiusText = `R=${R}`;
  // 半径读数放在球心到 P0 线段中点，稍微沿轴偏移避免与球心标注重叠
  const radiusPos = r4Vec([
    (O[0] + pts[0][0]) / 2 + N[0] * 0.15,
    (O[1] + pts[0][1]) / 2 + N[1] * 0.15,
    (O[2] + pts[0][2]) / 2 + N[2] * 0.15,
  ]);
  if (flags.labelRadius) items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), radiusText, radiusPos));

  // 顶点到球心距离（取整输出后的实际值，便于回归核对守恒）
  const radiusChecks = pts.map((p) => r4(len3(sub3(p, O))));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      points: pts.map((p) => p.slice()),
      center: O.slice(),
      radius: R,
      axis: cmd.axis === undefined ? 'z' : (typeof cmd.axis === 'string' ? cmd.axis : r4Vec(n)),
      n: N.slice(),
      u: U.slice(),
      v: V.slice(),
      segments,
      equator: equator.slice(),
      meridian1: meridian1.slice(),
      meridian2: meridian2.slice(),
      radiusEnds: pts.map((p) => p.slice()),
      radiusChecks,
      radiusText,
      radiusPos,
      asGreatCircles: flags.asGreatCircles,
      asRadii: flags.asRadii,
      asPoints: flags.asPoints,
      labelCenter: flags.labelCenter,
      labelVertices: flags.labelVertices,
      labelRadius: flags.labelRadius,
      vertexSize,
      greatCircleCount: flags.asGreatCircles ? 3 : 0,
      radiusCount: flags.asRadii ? 4 : 0,
      pointCount: flags.asPoints ? 5 : 0,
      labelCount: (flags.labelCenter ? 1 : 0) + (flags.labelVertices ? 4 : 0) + (flags.labelRadius ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

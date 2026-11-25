/**
 * 立体画板「四面体 / 任意四点的内切球（insphere3d）」参数化生成命令的纯函数语义层（2026-11-26 D40 增量）
 *
 * 与 js/board3d-circumsphere.js / -pointplane.js / -dihedral.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求四面体内切球 / 给三棱锥作内切球 / 标出内心与四个切点」这类意图，用一条命令生成标准作图：
 *   四面体六条棱线框 + 三个正交大圆线框（内切球）+ 内心到四个切点的半径线段（垂直对应面）
 *   + 内心/顶点/切点小球 + 内心 I / 顶点 A-D / 切点 T0-T3 / 半径 r 标注。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - circumsphere3d 给四点反求「外接」球（球心到四顶点等距），本命令求「内切」球（球心到四面等距）；
 *   - ellipsoid3d 需先给半轴 a/b/c、capsule3d 需先给球心与两球心距，都要「已知球心半径」；
 *   - pointplane3d 量点到面的距离、measure3d 量两点距离 / 三点夹角，都画不出「给定四点反求内切球」；
 *   - insphere3d 给「四个不共面点 points」，自动反求唯一内切球心 I 与半径 r，
 *     直接服务「三棱锥内切球 / 四面体内切球 / 标出内心与切点」核心用例。
 *
 * 几何定义（四点 P0..P3 构成四面体，面 Fi 为顶点 Pi 的对面）：
 *   面 Fi 面积   Si = |(Pj−Pa) × (Pk−Pa)| / 2      (j,k,a 为除 i 外的三点);
 *   有向体积     V  = |det(P1−P0, P2−P0, P3−P0)| / 6;
 *   内心         I  = (S0·P0 + S1·P1 + S2·P2 + S3·P3) / (S0+S1+S2+S3)   （面积加权质心）;
 *   内切球半径   r  = 3·V / (S0+S1+S2+S3)           （V = r·S_total/3）;
 *   面 Fi 单位法向 nhi = 面内两边叉积单位化（取背离 Pi 的方向）;
 *   切点         Ti = Pi − r·nhi                    （内心到面 Fi 的垂足，恰落在面内）;
 *   正交标架     n = axis 单位向量, u = normalize(n × helper), v = n × u;
 *   内切球大圆   赤道 = I + r·(cosθ·u + sinθ·v); 经线1 = I + r·(cosθ·n + sinθ·u); 经线2 = I + r·(cosθ·n + sinθ·v).
 *
 * 守恒：
 *   |I−Ti| = r 对四个面恒成立且 Ti 落在对应面内；r = 3V/S_total；四个 nhi 为对应面单位法向；
 *   内心到四个面的距离恒为 r；每个大圆采样点到内心距离恒为 r；u/v/n 两两垂直且为单位向量；
 *   半径线段一端为内心、另一端恰为切点。四点共面 / 重合（V≈0 或某面退化）时无解 → 整条拒绝。
 *   本命令只校验数值与点位合法，不强制与场景其它对象无交。
 */

/** 每个大圆采样段数合法区间与默认 */
export const INSPHERE3D_SEGMENTS_MIN = 8;
export const INSPHERE3D_SEGMENTS_MAX = 512;
export const INSPHERE3D_SEGMENTS_DEFAULT = 48;

/** 小球半径（与其余 3D 命令同口径） */
export const INSPHERE3D_VERTEX_SIZE_MIN = 0.01;
export const INSPHERE3D_VERTEX_SIZE_MAX = 1;
export const INSPHERE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const INSPHERE3D_MAX_SEGMENTS = 4096;

/** 默认四点：单位立方体交错顶点构成的正四面体（内心原点、内切球半径 1/√3） */
export const INSPHERE3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([1, 1, 1]),
  Object.freeze([1, -1, -1]),
  Object.freeze([-1, 1, -1]),
  Object.freeze([-1, -1, 1]),
]);
export const INSPHERE3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

/** 坐标钳制上限（与 geometry / circumsphere 一致） */
const COORD_LIMIT = 10000;

/** 线框 / 顶点 / 标注默认颜色 */
const DEFAULT_COLOR = '#0e9f8a';
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
export function insphere3DAxisUnit(v) {
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

/** 面顶点索引：face i 为顶点 i 的对面（不含 Pi 的另外三点） */
export const INSPHERE3D_FACE_INDEX = Object.freeze([
  Object.freeze([1, 2, 3]),
  Object.freeze([0, 2, 3]),
  Object.freeze([0, 1, 3]),
  Object.freeze([0, 1, 2]),
]);

/** 三点构成的三角形面积（不取整）；退化返回 0 */
export function insphere3DTriangleArea(a, b, c) {
  return len3(cross3(sub3(b, a), sub3(c, a))) / 2;
}

/** 四点的有向体积绝对值（不取整）：|det(P1−P0,P2−P0,P3−P0)| / 6；入参非法返回 null */
export function insphere3DVolume(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const a = sub3(p[1], p[0]);
  const b = sub3(p[2], p[0]);
  const c = sub3(p[3], p[0]);
  const det = dot3(a, cross3(b, c));
  return Math.abs(det) / 6;
}

/**
 * 由四点求四个面 { index, verts, area, normal }（normal 为背离顶点 Pi 的单位法向，不取整）。
 * 任一面积退化（<1e-9）返回 null。points 需为 4 个合法 [x,y,z]。不修改入参。
 */
export function insphere3DFaces(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = INSPHERE3D_FACE_INDEX[i].map((k) => p[k]);
    const area = insphere3DTriangleArea(a, b, c);
    if (!(area > 1e-9)) return null; // 面退化：三点共线 / 重合
    let normal = rawUnit(cross3(sub3(b, a), sub3(c, a)));
    if (!normal) return null;
    // 法向取背离顶点 Pi 的方向：若 (Pi − a)·normal > 0，翻转
    if (dot3(sub3(p[i], a), normal) > 0) normal = [-normal[0], -normal[1], -normal[2]];
    out.push({ index: i, verts: [a.slice(), b.slice(), c.slice()], area, normal });
  }
  return out;
}

/**
 * 由四点求内切球心（面积加权质心，不取整）。共面 / 重合 / 面退化返回 null。
 * 可传已算好的 faces 以避免重复计算。
 */
export function insphere3DCenter(points, faces) {
  const fs = faces || insphere3DFaces(points);
  if (!fs || fs.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  let sx = 0, sy = 0, sz = 0, st = 0;
  for (let i = 0; i < 4; i++) {
    const w = fs[i].area;
    sx += w * p[i][0]; sy += w * p[i][1]; sz += w * p[i][2]; st += w;
  }
  if (!(st > 1e-9)) return null;
  return [sx / st, sy / st, sz / st];
}

/** 内切球半径 r = 3·V / S_total（不取整）。入参非法返回 null。 */
export function insphere3DRadius(points, faces) {
  const V = insphere3DVolume(points);
  if (V === null) return null;
  const fs = faces || insphere3DFaces(points);
  if (!fs || fs.length !== 4) return null;
  const st = fs.reduce((s, f) => s + f.area, 0);
  if (!(st > 1e-9)) return null;
  return (3 * V) / st;
}

/** 点到平面（面三点 a,b,c）的垂足（不取整）；面退化返回 null */
export function insphere3DFoot(point, a, b, c) {
  if (!Array.isArray(point) || point.length !== 3) return null;
  const n = rawUnit(cross3(sub3(b, a), sub3(c, a)));
  if (!n) return null;
  const d = dot3(sub3(point, a), n);
  return [point[0] - d * n[0], point[1] - d * n[1], point[2] - d * n[2]];
}

/** 正交单位标架 {n, u, v}：n 为轴，u/v 与 n 两两垂直。非法轴返回 null。 */
export function insphere3DFrame(axis) {
  const n = insphere3DAxisUnit(axis);
  if (!n) return null;
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = rawUnit(cross3(n, helper));
  if (!u) return null;
  const v = rawUnit(cross3(n, u));
  if (!v) return null;
  return { n, u, v };
}

/**
 * 综合求解：给四点返回完整内切球几何（全精度，不取整）。
 * { center, radius, volume, faces, tangents, faceAreaSum, radiusChecks }
 * tangents[i] 为内心到面 i 的垂足；radiusChecks[i] = |I − Ti|（应恒等于 radius）。
 * 四点共面 / 重合 / 面退化 / 非法返回 null。
 */
export function insphere3DGeometry(points) {
  const faces = insphere3DFaces(points);
  if (!faces) return null;
  const V = insphere3DVolume(points);
  const center = insphere3DCenter(points, faces);
  const radius = insphere3DRadius(points, faces);
  if (V === null || !center || radius === null || !(radius > 1e-9)) return null;
  const tangents = faces.map((f) => insphere3DFoot(center, f.verts[0], f.verts[1], f.verts[2]));
  if (tangents.some((t) => t === null)) return null;
  const radiusChecks = tangents.map((t) => len3(sub3(center, t)));
  // 数值守护：任一 |I−Ti| 与 r 偏差过大（>1%）视为病态四面体，拒绝而非画假球
  if (radiusChecks.some((d) => Math.abs(d - radius) > radius * 0.01 + 1e-9)) return null;
  const faceAreaSum = faces.reduce((s, f) => s + f.area, 0);
  return { center, radius, volume: V, faces, tangents, faceAreaSum, radiusChecks };
}

/**
 * 解析一条 insphere3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"insphere3d","id":"insph","points":[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
 *    "axis":"z","segments":48,"asSphere":true,"asEdges":true,"asRadii":true,"asPoints":false,
 *    "labelCenter":true,"labelVertices":false,"labelFeet":false,"labelRadius":true,"vertexSize":0.1,"color":"#0e9f8a"}
 *   - points        可选，四个不共面点 [[x,y,z]×4]（默认正四面体）；共面 / 重合 / 面退化拒绝；
 *   - axis          可选，内切球大圆基准轴 'x'/'y'/'z' 或非零向量（默认 z）；
 *   - segments      可选，每个大圆采样段数（默认 48，8~512）；
 *   - asSphere      可选，是否画三个正交大圆表示内切球（默认 true）；
 *   - asEdges       可选，是否画四面体六条棱线框（默认 true）；
 *   - asRadii       可选，是否画内心到四个切点的半径线段（默认 true）；
 *   - asPoints      可选，是否在内心 / 四顶点 / 四切点放小球（默认 false）；
 *   - labelCenter / labelVertices / labelFeet / labelRadius 可选，是否标注内心 I / 顶点 A-D / 切点 T0-T3 / 半径读数（默认 true / false / false / true）；
 *   - vertexSize    可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。八个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveInsphere3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'insph' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- points：四个不共面点 ----
  const pts = cmd.points === undefined
    ? INSPHERE3D_DEFAULT_POINTS.map((p) => p.slice())
    : (Array.isArray(cmd.points) ? cmd.points.map(parsePoint3) : null);
  if (!pts || pts.length !== 4 || pts.some((p) => p === null)) {
    return { ok: false, error: 'points 需为四个合法 [x,y,z]' };
  }

  // ---- axis：大圆基准轴 ----
  const n = insphere3DAxisUnit(cmd.axis);
  if (!n) return { ok: false, error: 'axis 需为 x/y/z 或非零向量 [x,y,z]' };
  const frame = insphere3DFrame(cmd.axis === undefined ? INSPHERE3D_DEFAULT_AXIS : cmd.axis);
  if (!frame) return { ok: false, error: '无法构造正交标架' };
  const { u, v } = frame;

  // ---- segments ----
  const segRaw = cmd.segments === undefined ? INSPHERE3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < INSPHERE3D_SEGMENTS_MIN || segRaw > INSPHERE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${INSPHERE3D_SEGMENTS_MIN}~${INSPHERE3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- vertexSize ----
  const vsRaw = cmd.vertexSize === undefined ? INSPHERE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < INSPHERE3D_VERTEX_SIZE_MIN || vsRaw > INSPHERE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${INSPHERE3D_VERTEX_SIZE_MIN}~${INSPHERE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = vsRaw;

  // ---- 布尔开关 ----
  const boolFields = ['asSphere', 'asEdges', 'asRadii', 'asPoints', 'labelCenter', 'labelVertices', 'labelFeet', 'labelRadius'];
  const boolDefaults = { asSphere: true, asEdges: true, asRadii: true, asPoints: false, labelCenter: true, labelVertices: false, labelFeet: false, labelRadius: true };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!boolFields.some((f) => flags[f])) return { ok: false, error: '八个输出开关至少开一个' };

  // ---- 样式 ----
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 求内切球几何 ----
  const geo = insphere3DGeometry(pts);
  if (!geo) return { ok: false, error: '四点共面 / 重合 / 面退化，无法确定唯一内切球' };
  const { center: centerRaw, radius: radiusRaw, faces, tangents: tangentsRaw } = geo;

  // 线段总数上限守护（3 大圆 × segments + 6 棱 + 4 半径）
  const lineCount = (flags.asSphere ? 3 * segments : 0) + (flags.asEdges ? 6 : 0) + (flags.asRadii ? 4 : 0);
  if (lineCount > INSPHERE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${INSPHERE3D_MAX_SEGMENTS}` };
  }

  // ---- 取整后的输出坐标 / 半径 ----
  const I = r4Vec(centerRaw.map(clamp));
  const R = r4(clamp(radiusRaw));
  const U = r4Vec(u);
  const V = r4Vec(v);
  const N = r4Vec(n);
  const T = tangentsRaw.map((t) => r4Vec(t.map(clamp)));

  // 大圆采样点（全精度算、取整输出）：circle(planeA, planeB) = I + r·(cosθ·A + sinθ·B)
  const circlePts = (pa, pb) => {
    const out = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const c = Math.cos(th) * radiusRaw;
      const s = Math.sin(th) * radiusRaw;
      out.push(r4Vec([
        centerRaw[0] + c * pa[0] + s * pb[0],
        centerRaw[1] + c * pa[1] + s * pb[1],
        centerRaw[2] + c * pa[2] + s * pb[2],
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

  // ---- 内切球三个正交大圆线框（闭合环：每段连接 i → i+1，末段连回起点）----
  if (flags.asSphere) {
    const rings = [equator, meridian1, meridian2];
    const suffixes = ['eq', 'm1', 'm2'];
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_${suffixes[ri]}_${i}`.slice(0, 64)), ring[i], ring[(i + 1) % segments]));
      }
    }
  }

  // ---- 四面体六条棱线框 ----
  if (flags.asEdges) {
    const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let i = 0; i < edges.length; i++) {
      items.push(mkLine(nextId(`${stem}_e${i}`.slice(0, 64)), pts[edges[i][0]], pts[edges[i][1]]));
    }
  }

  // ---- 内心到四个切点的半径线段（垂直对应面）----
  if (flags.asRadii) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_r${i}`.slice(0, 64)), I, T[i]));
    }
  }

  // ---- 可选：内心 / 四顶点 / 四切点小球 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pI`.slice(0, 64)), I));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pV${i}`.slice(0, 64)), pts[i]));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pT${i}`.slice(0, 64)), T[i]));
  }

  // ---- 可选：内心 I / 顶点 A-D / 切点 T0-T3 / 半径读数标注 ----
  if (flags.labelCenter) items.push(mkLabel(nextId(`${stem}_lI`.slice(0, 64)), 'I', I));
  if (flags.labelVertices) {
    const names = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) items.push(mkLabel(nextId(`${stem}_lv${i}`.slice(0, 64)), names[i], pts[i]));
  }
  if (flags.labelFeet) {
    for (let i = 0; i < 4; i++) items.push(mkLabel(nextId(`${stem}_lt${i}`.slice(0, 64)), `T${i}`, T[i]));
  }
  const radiusText = `r=${R}`;
  // 半径读数放在内心到 T0 线段中点，稍微沿轴偏移避免与内心标注重叠
  const radiusPos = r4Vec([
    (I[0] + T[0][0]) / 2 + N[0] * 0.15,
    (I[1] + T[0][1]) / 2 + N[1] * 0.15,
    (I[2] + T[0][2]) / 2 + N[2] * 0.15,
  ]);
  if (flags.labelRadius) items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), radiusText, radiusPos));

  // 内心到切点距离（取整输出后的实际值，便于回归核对守恒）
  const radiusChecks = T.map((t) => r4(len3(sub3(t, I))));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      points: pts.map((p) => p.slice()),
      center: I.slice(),
      radius: R,
      volume: r4(geo.volume),
      faceAreaSum: r4(geo.faceAreaSum),
      axis: cmd.axis === undefined ? 'z' : (typeof cmd.axis === 'string' ? cmd.axis : r4Vec(n)),
      n: N.slice(),
      u: U.slice(),
      v: V.slice(),
      segments,
      equator: equator.slice(),
      meridian1: meridian1.slice(),
      meridian2: meridian2.slice(),
      faces: faces.map((f) => ({ index: f.index, verts: f.verts.map((q) => r4Vec(q)), area: r4(f.area), normal: unit(f.normal) })),
      tangents: T.map((t) => t.slice()),
      radiusEnds: T.map((t) => t.slice()),
      radiusChecks,
      radiusText,
      radiusPos,
      asSphere: flags.asSphere,
      asEdges: flags.asEdges,
      asRadii: flags.asRadii,
      asPoints: flags.asPoints,
      labelCenter: flags.labelCenter,
      labelVertices: flags.labelVertices,
      labelFeet: flags.labelFeet,
      labelRadius: flags.labelRadius,
      vertexSize,
      sphereCount: flags.asSphere ? 3 : 0,
      edgeCount: flags.asEdges ? 6 : 0,
      radiusCount: flags.asRadii ? 4 : 0,
      pointCount: flags.asPoints ? 9 : 0,
      labelCount: (flags.labelCenter ? 1 : 0) + (flags.labelVertices ? 4 : 0) + (flags.labelFeet ? 4 : 0) + (flags.labelRadius ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「通用棱柱（prism / 斜棱柱）」参数化生成命令的纯函数语义层（2026-11-22 D24 增量）
 *
 * 与 js/board3d-polyhedron.js / -tube.js / -capsule.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个三棱柱 / 画斜四棱柱 / 画正方体并标出顶点」这类意图，用一条命令生成
 *   任意底面多边形沿任意方向拉伸所得的棱柱线框：底面闭合线 + 顶面闭合线 + 侧棱
 *   （可选顶点小球 + A/B/C… 顶点标注）。产出由 line（及可选 point / label）构成的
 *   规格数组，可直接交给 board3dApi.add() 逐段落地；执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 prism 只画**正多边形直棱柱**（r + h，底面顶点自动均布、只能沿 y 轴），
 *     无法画任意底面（如给定 4 个空间点）、也无法画**斜棱柱**（拉伸方向任意）；
 *   - polyhedron3d（D17）：只画五种柏拉图立体（正多面体），不含一般棱柱 / 斜棱柱；
 *   - box 内置图元：只是正方形直棱柱的特例，且不能自定义底面、不能斜拉；
 *   - prism3d：**专用于一般棱柱**，给底面顶点数组 base + 拉伸向量 vector（或 axis+height）
 *     即可生成底面 / 顶面 / 侧棱线框，顶面 = 底面 + 向量，所有侧棱平行且等长（核心守恒）。
 *
 * 几何定义：
 *   底面顶点 B0..B(n-1)（按给定顺序首尾相连成闭合多边形），拉伸向量 V：
 *     顶面顶点 T_i = B_i + V；
 *     底面棱 = (B_i, B_{i+1})，顶面棱 = (T_i, T_{i+1})，侧棱 = (B_i, T_i)，下标模 n；
 *     |V| 即棱柱高度（沿 V 方向），V 与底面不垂直时为斜棱柱。
 *   本命令只校验坐标合法与点数，不强制底面共面 / 凸性 / 自交检测（调用方负责给出简单多边形）。
 */

/** 底面顶点数合法区间（3~32，至少三角形） */
export const PRISM3D_BASE_MIN = 3;
export const PRISM3D_BASE_MAX = 32;

/** 默认底面：z=0 平面上边长 2 的正方形（配合默认 height=2 即标准正方体） */
export const PRISM3D_DEFAULT_BASE = Object.freeze(Object.freeze([
  Object.freeze([-1, -1, 0]), Object.freeze([1, -1, 0]),
  Object.freeze([1, 1, 0]), Object.freeze([-1, 1, 0]),
]));

/** 默认拉伸高度（沿默认轴 z） */
export const PRISM3D_HEIGHT_DEFAULT = 2;
export const PRISM3D_HEIGHT_MAX = 10000;

/** 可选拉伸轴白名单（与世界坐标 X/Y/Z 一一对应，仅 axis+height 写法使用） */
export const PRISM3D_AXES = Object.freeze(['x', 'y', 'z']);
export const PRISM3D_AXIS_DEFAULT = 'z';

/** 顶点球默认半径（与 capsule3d 采样点球同口径） */
export const PRISM3D_VERTEX_SIZE_DEFAULT = 0.1;
export const PRISM3D_VERTEX_SIZE_MIN = 0.01;
export const PRISM3D_VERTEX_SIZE_MAX = 1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const PRISM3D_MAX_SEGMENTS = 4096;

/** 顶点标注字母表（超过 26 个顶点时回退 V<n>） */
export const PRISM3D_LABEL_LETTERS = Object.freeze(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
);

/** 坐标钳制上限（与 geometry / tube3d / capsule3d 一致） */
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

/** 严格解析单个 3D 点 [x,y,z]（非法返回 null） */
function parsePoint3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out.map(clamp).map(r4) : null;
}

/** 严格解析底面顶点数组（3~32 个合法 3D 点） */
function parseBase(v) {
  if (!Array.isArray(v) || v.length < PRISM3D_BASE_MIN || v.length > PRISM3D_BASE_MAX) return null;
  const out = v.map(parsePoint3);
  return out.every((p) => p !== null) ? out : null;
}

/** 严格解析拉伸向量 [dx,dy,dz]（分量可为任意有限数，含 0） */
function parseVector(v) {
  return parsePoint3(v);
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

/** 向量长度（棱柱高度） */
export function vecLen(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * 顶面顶点：底面每点 + 拉伸向量。纯函数、只读入参。
 * @param {Array} base   底面顶点数组 [[x,y,z],...]
 * @param {Array} vector 拉伸向量 [dx,dy,dz]
 * @returns {Array} 顶面顶点数组（新数组）
 */
export function prismTop(base, vector) {
  return base.map((p) => r4Vec([
    p[0] + vector[0], p[1] + vector[1], p[2] + vector[2],
  ]));
}

function r4Vec(p) {
  return p.map((x) => r4(clamp(x)));
}

/**
 * 棱柱的边索引表。返回 { baseEdges, topEdges, sides }：
 *   baseEdges[i]=[i,(i+1)%n]，topEdges[i]=[n+i,n+(i+1)%n]，sides[i]=[i,n+i]。
 * 纯函数、只读入参，可直接用于断言「底面 n + 顶面 n + 侧棱 n」结构。
 */
export function prismEdgeIndices(n) {
  const baseEdges = [];
  const topEdges = [];
  const sides = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    baseEdges.push([i, j]);
    topEdges.push([n + i, n + j]);
    sides.push([i, n + i]);
  }
  return { baseEdges, topEdges, sides };
}

/**
 * 解析拉伸规格：优先显式 vector；否则用 axis + height（axis 默认 z，height 默认 2）。
 * 任一出现的参数非法即返回 { error }（原子拒绝，不静默回落）。
 */
function resolveStretch(cmd) {
  if (cmd.vector !== undefined) {
    const v = parseVector(cmd.vector);
    if (v === null) return { error: 'vector 必须是含 3 个有限数值的 [dx,dy,dz]' };
    return { vector: v, mode: 'vector' };
  }
  const axis = cmd.axis === undefined ? PRISM3D_AXIS_DEFAULT : cmd.axis;
  if (!PRISM3D_AXES.includes(axis)) {
    return { error: `axis 只支持 ${PRISM3D_AXES.join('/')}` };
  }
  const hRaw = cmd.height === undefined ? PRISM3D_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { error: 'height 必须是数字' };
  if (hRaw < 0 || hRaw > PRISM3D_HEIGHT_MAX) {
    return { error: `height 需为 0~${PRISM3D_HEIGHT_MAX} 的数` };
  }
  const h = r4(hRaw);
  const vector = axis === 'x' ? [h, 0, 0] : axis === 'y' ? [0, h, 0] : [0, 0, h];
  return { vector, mode: 'axis', axis, height: h };
}

/**
 * 解析一条 prism3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"prism3d","id":"prism","base":[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],
 *    "vector":[0,0,2],"asBase":true,"asTop":true,"asSides":true,
 *    "asVertices":false,"labelVertices":true,"color":"#4f6bed"}
 *   - base           可选，底面顶点 [[x,y,z],...]，3~32 个（默认 z=0 平面边长 2 的正方形）；
 *   - vector         可选，拉伸向量 [dx,dy,dz]（斜棱柱必须用它）；给了 vector 则忽略 axis/height；
 *   - axis / height  可选，沿坐标轴拉伸（axis 默认 'z'，height 默认 2；给出 vector 时不再校验）；
 *   - asBase / asTop / asSides 可选，是否画底面 / 顶面 / 侧棱（均默认 true）；
 *   - asVertices     可选，是否在 2n 个顶点放小球标记（默认 false）；
 *   - labelVertices  可选，是否在 2n 个顶点放 A/B/C… 标注（默认 false，顶面加 ' 后缀）；
 *   - vertexSize     可选，顶点球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolvePrism3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'prism' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- base：底面顶点（核心几何，出现即须合法；默认正方形） ----
  const base = cmd.base === undefined
    ? PRISM3D_DEFAULT_BASE.map((p) => p.slice())
    : parseBase(cmd.base);
  if (base === null) {
    return { ok: false, error: `base 需为 ${PRISM3D_BASE_MIN}~${PRISM3D_BASE_MAX} 个 [x,y,z] 顶点` };
  }

  // ---- 拉伸向量：显式 vector 或 axis+height ----
  const stretch = resolveStretch(cmd);
  if (stretch.error) return { ok: false, error: stretch.error };
  const vector = stretch.vector;

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asBase', 'asTop', 'asSides', 'asVertices', 'labelVertices']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：顶点球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? PRISM3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < PRISM3D_VERTEX_SIZE_MIN || vsRaw > PRISM3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${PRISM3D_VERTEX_SIZE_MIN}~${PRISM3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asBase = cmd.asBase === undefined ? true : cmd.asBase;
  const asTop = cmd.asTop === undefined ? true : cmd.asTop;
  const asSides = cmd.asSides === undefined ? true : cmd.asSides;
  const asVertices = cmd.asVertices === true;
  const labelVertices = cmd.labelVertices === true;
  if (!asBase && !asTop && !asSides && !asVertices && !labelVertices) {
    return { ok: false, error: 'asBase / asTop / asSides / asVertices / labelVertices 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：顶面 = 底面 + 向量；边表固定为底面 n + 顶面 n + 侧棱 n ----
  const n = base.length;
  const top = prismTop(base, vector);
  const { baseEdges, topEdges, sides } = prismEdgeIndices(n);
  const vertices = base.map((p, i) => [p, top[i]]); // 每列 [底, 顶]

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asBase ? n : 0) + (asTop ? n : 0) + (asSides ? n : 0);
  if (lineCount > PRISM3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${PRISM3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 polyhedron3d / tube3d 同口径）：prefix 达 64 字符时
  // 从 stem 生成，保证截断后仍保留区分度、不死循环。
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

  // ---- 底面闭合线 ----
  if (asBase) {
    for (let i = 0; i < n; i++) {
      const [a, b] = baseEdges[i];
      items.push(mkLine(nextId(`${stem}_b${i + 1}`.slice(0, 64)), base[a], base[b]));
    }
  }

  // ---- 顶面闭合线 ----
  if (asTop) {
    for (let i = 0; i < n; i++) {
      const [a, b] = topEdges[i];
      items.push(mkLine(nextId(`${stem}_t${i + 1}`.slice(0, 64)), top[a - n], top[b - n]));
    }
  }

  // ---- 侧棱 ----
  if (asSides) {
    for (let i = 0; i < n; i++) {
      const [a, b] = sides[i];
      // sides[i] = [i, n+i]（底面索引 / 顶面索引），顶面索引需减 n 落到 top 数组
    items.push(mkLine(nextId(`${stem}_s${i + 1}`.slice(0, 64)), base[a], top[b - n]));
    }
  }

  // ---- 可选：2n 个顶点小球 ----
  if (asVertices) {
    for (let i = 0; i < n; i++) {
      items.push(mkPoint(nextId(`${stem}_vB${i + 1}`.slice(0, 64)), vertices[i][0]));
      items.push(mkPoint(nextId(`${stem}_vT${i + 1}`.slice(0, 64)), vertices[i][1]));
    }
  }

  // ---- 可选：2n 个顶点标注（底面 A/B/C…，顶面 A'/B'/C'…） ----
  if (labelVertices) {
    for (let i = 0; i < n; i++) {
      const letter = PRISM3D_LABEL_LETTERS[i] || `V${i + 1}`;
      items.push(mkLabel(nextId(`${stem}_lB${i + 1}`.slice(0, 64)), letter, vertices[i][0]));
      items.push(mkLabel(nextId(`${stem}_lT${i + 1}`.slice(0, 64)), `${letter}'`, vertices[i][1]));
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      vertexCount: n,
      base: base.map((p) => p.slice()),
      top: top.map((p) => p.slice()),
      vector: vector.map(r4),
      height: r4(vecLen(vector)),
      stretchMode: stretch.mode,
      ...(stretch.mode === 'axis' ? { axis: stretch.axis } : {}),
      asBase,
      asTop,
      asSides,
      asVertices,
      labelVertices,
      vertexSize,
      baseEdgeCount: asBase ? n : 0,
      topEdgeCount: asTop ? n : 0,
      sideEdgeCount: asSides ? n : 0,
      pointCount: asVertices ? 2 * n : 0,
      labelCount: labelVertices ? 2 * n : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

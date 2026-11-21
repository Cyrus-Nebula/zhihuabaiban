/**
 * 立体画板「通用棱锥（pyramid / 斜棱锥）」参数化生成命令的纯函数语义层（2026-11-22 D25 增量）
 *
 * 与 js/board3d-prism.js / -polyhedron.js / -capsule.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个三棱锥 / 画斜四棱锥 / 画正方体上方加棱锥并标注顶点」这类意图，用一条命令生成
 *   任意底面多边形收缩到单个顶点所得的棱锥线框：底面闭合线 + 侧棱
 *   （可选顶点小球 + A/B/C… 底面标注与 S 顶点标注）。产出由 line（及可选 point / label）构成的
 *   规格数组，可直接交给 board3dApi.add() 逐段落地；执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 pyramid 只画**正四棱锥**（s + h，底面顶点自动均布、只能沿 y 轴、顶点恒在底面中心正上方），
 *     无法画任意底面（如给定 3~32 个空间点）、无法画三棱锥 / 五棱锥，也无法画**斜棱锥**（顶点不在底面中心正上方）；
 *   - polyhedron3d（D17）：只画五种柏拉图立体（正多面体），不含一般棱锥；
 *   - prism3d（D24）：底面 + 拉伸向量生成棱柱（顶面与底面全等），不是收缩到一点的棱锥；
 *   - pyramid3d：**专用于一般棱锥**，给底面顶点数组 base + 顶点 apex（或 axis+height）
 *     即可生成底面 + 侧棱线框，顶点可由底面质心沿轴抬升得到（正棱锥）或显式指定（斜棱锥）。
 *
 * 几何定义：
 *   底面顶点 B0..B(n-1)（按给定顺序首尾相连成闭合多边形），顶点 A：
 *     底面棱 = (B_i, B_{i+1})，侧棱 = (B_i, A)，下标模 n；
 *   轴模式：质心 C = 底面各顶点坐标算术平均，A = C + axis 方向 × height；
 *   显式模式：直接给 apex=[x,y,z]（顶点不在质心正上方即斜棱锥）。
 *   本命令只校验坐标合法与点数，不强制底面共面 / 凸性 / 自交检测（调用方负责给出简单多边形）。
 */

/** 底面顶点数合法区间（3~32，至少三角形） */
export const PYRAMID3D_BASE_MIN = 3;
export const PYRAMID3D_BASE_MAX = 32;

/** 默认底面：z=0 平面上边长 2 的正方形（配合默认 height=3 → 正四棱锥，顶点 [0,0,3]） */
export const PYRAMID3D_DEFAULT_BASE = Object.freeze(Object.freeze([
  Object.freeze([-1, -1, 0]), Object.freeze([1, -1, 0]),
  Object.freeze([1, 1, 0]), Object.freeze([-1, 1, 0]),
]));

/** 默认轴模式抬升高度（沿默认轴 z） */
export const PYRAMID3D_HEIGHT_DEFAULT = 3;
export const PYRAMID3D_HEIGHT_MAX = 10000;

/** 可选抬升轴白名单（与世界坐标 X/Y/Z 一一对应，仅 axis+height 写法使用） */
export const PYRAMID3D_AXES = Object.freeze(['x', 'y', 'z']);
export const PYRAMID3D_AXIS_DEFAULT = 'z';

/** 顶点球默认半径（与 prism3d / capsule3d 采样点球同口径） */
export const PYRAMID3D_VERTEX_SIZE_DEFAULT = 0.1;
export const PYRAMID3D_VERTEX_SIZE_MIN = 0.01;
export const PYRAMID3D_VERTEX_SIZE_MAX = 1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const PYRAMID3D_MAX_SEGMENTS = 4096;

/** 底面顶点标注字母表（超过 26 个顶点时回退 V<n>） */
export const PYRAMID3D_LABEL_LETTERS = Object.freeze(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
);

/** 顶点（apex）标注文本（棱锥 S-ABCD 的数学惯例） */
export const PYRAMID3D_APEX_LABEL = 'S';

/** 坐标钳制上限（与 geometry / prism3d / tube3d / capsule3d 一致） */
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

/** 严格解析底面顶点数组（3~32 个合法 3D 点） */
function parseBase(v) {
  if (!Array.isArray(v) || v.length < PYRAMID3D_BASE_MIN || v.length > PYRAMID3D_BASE_MAX) return null;
  const out = v.map(parsePoint3);
  return out.every((p) => p !== null) ? out : null;
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

/**
 * 底面质心：n 个顶点各坐标分量的算术平均。纯函数、只读入参。
 * @param {Array} base 底面顶点数组 [[x,y,z],...]
 * @returns {Array} 质心 [cx,cy,cz]（新数组）
 */
export function pyramidCentroid(base) {
  const n = base.length;
  return r4Vec([0, 1, 2].map((k) => base.reduce((s, p) => s + p[k], 0) / n));
}

/**
 * 轴模式顶点：底面质心沿 axis 方向抬升 height。纯函数、只读入参。
 * @param {Array} centroid 质心 [cx,cy,cz]
 * @param {string} axis    'x' | 'y' | 'z'
 * @param {number} height  抬升高度
 * @returns {Array} 顶点 [x,y,z]（新数组）
 */
export function pyramidApex(centroid, axis, height) {
  const h = r4(clamp(height));
  return r4Vec([
    centroid[0] + (axis === 'x' ? h : 0),
    centroid[1] + (axis === 'y' ? h : 0),
    centroid[2] + (axis === 'z' ? h : 0),
  ]);
}

/**
 * 棱锥的边索引表。返回 { baseEdges, apexEdges }：
 *   baseEdges[i]=[i,(i+1)%n]（底面闭合棱），apexEdges[i]=[i,n]（第 n 个顶点即 apex，侧棱）。
 * 纯函数、只读入参，可直接用于断言「底面 n + 侧棱 n」结构。
 */
export function pyramidEdgeIndices(n) {
  const baseEdges = [];
  const apexEdges = [];
  for (let i = 0; i < n; i++) {
    baseEdges.push([i, (i + 1) % n]);
    apexEdges.push([i, n]);
  }
  return { baseEdges, apexEdges };
}

/**
 * 解析顶点规格：优先显式 apex；否则用底面质心 + axis + height（axis 默认 z，height 默认 3）。
 * 任一出现的参数非法即返回 { error }（原子拒绝，不静默回落）；给了 apex 则忽略 axis/height。
 */
function resolveApexSpec(cmd, base) {
  if (cmd.apex !== undefined) {
    const a = parsePoint3(cmd.apex);
    if (a === null) return { error: 'apex 必须是含 3 个有限数值的 [x,y,z]' };
    return { apex: a, mode: 'explicit' };
  }
  const axis = cmd.axis === undefined ? PYRAMID3D_AXIS_DEFAULT : cmd.axis;
  if (!PYRAMID3D_AXES.includes(axis)) {
    return { error: `axis 只支持 ${PYRAMID3D_AXES.join('/')}` };
  }
  const hRaw = cmd.height === undefined ? PYRAMID3D_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { error: 'height 必须是数字' };
  if (hRaw < 0 || hRaw > PYRAMID3D_HEIGHT_MAX) {
    return { error: `height 需为 0~${PYRAMID3D_HEIGHT_MAX} 的数` };
  }
  const centroid = pyramidCentroid(base);
  return { apex: pyramidApex(centroid, axis, hRaw), mode: 'axis', axis, height: r4(hRaw), centroid };
}

/**
 * 解析一条 pyramid3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"pyramid3d","id":"pyr","base":[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],
 *    "apex":[0,0,3],"asBase":true,"asSides":true,"asVertices":false,
 *    "labelVertices":true,"vertexSize":0.1,"color":"#4f6bed"}
 *   - base           可选，底面顶点 [[x,y,z],...]，3~32 个（默认 z=0 平面边长 2 的正方形）；
 *   - apex           可选，顶点 [x,y,z]（斜棱锥必须用它）；给了 apex 则忽略 axis/height；
 *   - axis / height  可选，不给 apex 时由底面质心沿轴抬升（axis 默认 'z'，height 默认 3）；
 *   - asBase / asSides 可选，是否画底面 / 侧棱（均默认 true）；
 *   - asVertices     可选，是否在 n+1 个顶点（含 apex）放小球标记（默认 false）；
 *   - labelVertices  可选，是否在 n+1 个顶点放标注（默认 false，底面 A/B/C…、顶点 S）；
 *   - vertexSize     可选，顶点球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolvePyramid3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'pyramid' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- base：底面顶点（核心几何，出现即须合法；默认正方形） ----
  const base = cmd.base === undefined
    ? PYRAMID3D_DEFAULT_BASE.map((p) => p.slice())
    : parseBase(cmd.base);
  if (base === null) {
    return { ok: false, error: `base 需为 ${PYRAMID3D_BASE_MIN}~${PYRAMID3D_BASE_MAX} 个 [x,y,z] 顶点` };
  }

  // ---- 顶点：显式 apex 或质心 + axis+height ----
  const apexSpec = resolveApexSpec(cmd, base);
  if (apexSpec.error) return { ok: false, error: apexSpec.error };
  const apex = apexSpec.apex;
  const centroid = apexSpec.centroid || pyramidCentroid(base);

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asBase', 'asSides', 'asVertices', 'labelVertices']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：顶点球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? PYRAMID3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < PYRAMID3D_VERTEX_SIZE_MIN || vsRaw > PYRAMID3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${PYRAMID3D_VERTEX_SIZE_MIN}~${PYRAMID3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asBase = cmd.asBase === undefined ? true : cmd.asBase;
  const asSides = cmd.asSides === undefined ? true : cmd.asSides;
  const asVertices = cmd.asVertices === true;
  const labelVertices = cmd.labelVertices === true;
  if (!asBase && !asSides && !asVertices && !labelVertices) {
    return { ok: false, error: 'asBase / asSides / asVertices / labelVertices 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：底面闭合棱 n + 侧棱 n（每底点连 apex） ----
  const n = base.length;
  const { baseEdges, apexEdges } = pyramidEdgeIndices(n);

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asBase ? n : 0) + (asSides ? n : 0);
  if (lineCount > PYRAMID3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${PYRAMID3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 prism3d / polyhedron3d / tube3d 同口径）：prefix 达 64 字符时
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

  // ---- 侧棱：每个底点连顶点 apex ----
  if (asSides) {
    for (let i = 0; i < n; i++) {
      const [a] = apexEdges[i];
      items.push(mkLine(nextId(`${stem}_s${i + 1}`.slice(0, 64)), base[a], apex));
    }
  }

  // ---- 可选：n 个底面顶点 + 1 个 apex 的小球 ----
  if (asVertices) {
    for (let i = 0; i < n; i++) {
      items.push(mkPoint(nextId(`${stem}_vB${i + 1}`.slice(0, 64)), base[i]));
    }
    items.push(mkPoint(nextId(`${stem}_vA`.slice(0, 64)), apex));
  }

  // ---- 可选：n 个底面顶点标注（A/B/C…）+ 顶点标注 S ----
  if (labelVertices) {
    for (let i = 0; i < n; i++) {
      const letter = PYRAMID3D_LABEL_LETTERS[i] || `V${i + 1}`;
      items.push(mkLabel(nextId(`${stem}_lB${i + 1}`.slice(0, 64)), letter, base[i]));
    }
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), PYRAMID3D_APEX_LABEL, apex));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      vertexCount: n,
      base: base.map((p) => p.slice()),
      apex: apex.slice(),
      centroid: centroid.slice(),
      apexMode: apexSpec.mode,
      height: apexSpec.mode === 'axis' ? apexSpec.height : null,
      ...(apexSpec.mode === 'axis' ? { axis: apexSpec.axis } : {}),
      asBase,
      asSides,
      asVertices,
      labelVertices,
      vertexSize,
      baseEdgeCount: asBase ? n : 0,
      sideEdgeCount: asSides ? n : 0,
      pointCount: asVertices ? n + 1 : 0,
      labelCount: labelVertices ? n + 1 : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

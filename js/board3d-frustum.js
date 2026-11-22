/**
 * 立体画板「通用棱台（frustum / 斜棱台）」参数化生成命令的纯函数语义层（2026-11-22 D26 增量）
 *
 * 与 js/board3d-prism.js / -pyramid.js / -polyhedron.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个正四棱台 / 画斜三棱台 / 画圆台近似并标注顶点」这类意图，用一条命令生成
 *   任意底面多边形按比例收缩（或抬升）到顶面所得的棱台线框：底面闭合线 + 顶面闭合线 +
 *   侧棱（可选 2n 个顶点小球 + A/B/C… 底面标注与 A'/B'/C' 顶面标注）。产出由 line
 *   （及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 cylinder 可给 rt≠rb 画**圆台**（回转体），但无法画任意多边形底面的棱台；
 *   - prism3d（D24）：顶面 = 底面 + 拉伸向量，上下底面**全等**（相似比 1）；
 *   - pyramid3d（D25）：底面收缩到**单个顶点**（相似比 0）；
 *   - frustum3d：**填补相似比 0 < r < 1 的缺口**——顶面是底面绕质心按比例 r 缩放后沿轴抬升
 *     height 所得，上下底面相似且平行，侧棱延长交于同一锥顶；r=1 退化为棱柱、r=0 退化为棱锥。
 *     也支持显式给 top 顶点列（斜棱台 / 一般台体，此时不强制相似）。
 *
 * 几何定义（axis 模式）：
 *   底面顶点 B0..B(n-1)（按给定顺序首尾相连成闭合多边形），质心 C = 各顶点算术平均；
 *   顶面顶点 T_i = C + (B_i - C) * ratio + axisUnit * height；
 *     底面棱 = (B_i, B_{i+1})，顶面棱 = (T_i, T_{i+1})，侧棱 = (B_i, T_i)（下标模 n）；
 *   侧棱延长交点（锥顶）P = C + axisUnit * height / (1 - ratio)（0 ≤ ratio < 1 时）；
 *   正多边形底面时所有 |B_i - C| 相等，故各侧棱长 sqrt((1-r)^2·|B_i-C|^2 + h^2) 相等。
 *   显式 top 模式：直接给 T_i 数组（数量须与 base 相同），忽略 ratio / axis / height。
 *   本命令只校验坐标合法与点数，不强制底面共面 / 凸性 / 自交检测（调用方负责给出简单多边形）。
 */

/** 底面顶点数合法区间（3~32，至少三角形） */
export const FRUSTUM3D_BASE_MIN = 3;
export const FRUSTUM3D_BASE_MAX = 32;

/** 默认底面：z=0 平面上边长 2 的正方形（配合默认 ratio=0.5、height=2 → 正四棱台） */
export const FRUSTUM3D_DEFAULT_BASE = Object.freeze(Object.freeze([
  Object.freeze([-1, -1, 0]), Object.freeze([1, -1, 0]),
  Object.freeze([1, 1, 0]), Object.freeze([-1, 1, 0]),
]));

/** 顶面相对底面质心的相似比（0=棱锥退化、1=棱柱退化，默认 0.5） */
export const FRUSTUM3D_RATIO_DEFAULT = 0.5;
export const FRUSTUM3D_RATIO_MIN = 0;
export const FRUSTUM3D_RATIO_MAX = 1;

/** 默认轴向抬升高度（沿默认轴 z） */
export const FRUSTUM3D_HEIGHT_DEFAULT = 2;
export const FRUSTUM3D_HEIGHT_MAX = 10000;

/** 可选抬升轴白名单（与世界坐标 X/Y/Z 一一对应，仅 axis 写法使用） */
export const FRUSTUM3D_AXES = Object.freeze(['x', 'y', 'z']);
export const FRUSTUM3D_AXIS_DEFAULT = 'z';

/** 顶点球默认半径（与 prism3d / pyramid3d / capsule3d 采样点球同口径） */
export const FRUSTUM3D_VERTEX_SIZE_DEFAULT = 0.1;
export const FRUSTUM3D_VERTEX_SIZE_MIN = 0.01;
export const FRUSTUM3D_VERTEX_SIZE_MAX = 1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const FRUSTUM3D_MAX_SEGMENTS = 4096;

/** 顶点标注字母表（超过 26 个顶点时回退 V<n>） */
export const FRUSTUM3D_LABEL_LETTERS = Object.freeze(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
);

/** 坐标钳制上限（与 geometry / prism3d / pyramid3d / tube3d / capsule3d 一致） */
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

/** 严格解析底面 / 顶面顶点数组（3~32 个合法 3D 点） */
function parseVertArray(v) {
  if (!Array.isArray(v) || v.length < FRUSTUM3D_BASE_MIN || v.length > FRUSTUM3D_BASE_MAX) return null;
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
export function frustumCentroid(base) {
  const n = base.length;
  return r4Vec([0, 1, 2].map((k) => base.reduce((s, p) => s + p[k], 0) / n));
}

/**
 * axis 模式顶面点：C + (B - C) * ratio + axis 方向 * height。纯函数、只读入参。
 * @param {Array} b       底面顶点 [x,y,z]
 * @param {Array} centroid 底面质心 [cx,cy,cz]
 * @param {number} ratio  相似比 0~1
 * @param {string} axis   'x' | 'y' | 'z'
 * @param {number} height 抬升高度
 * @returns {Array} 顶面顶点 [x,y,z]（新数组）
 */
export function frustumTopPoint(b, centroid, ratio, axis, height) {
  const h = r4(clamp(height));
  return r4Vec([0, 1, 2].map((k) =>
    centroid[k] + (b[k] - centroid[k]) * ratio + (k === 0 && axis === 'x' ? h : k === 1 && axis === 'y' ? h : k === 2 && axis === 'z' ? h : 0)
  ));
}

/**
 * 侧棱延长交点（锥顶）：C + axis 方向 * height / (1 - ratio)。
 * 当 ratio ≥ 1（棱柱 / 反向放大）时无有限交点，返回 null。
 * @returns {Array|null} 锥顶 [x,y,z]（新数组）或 null
 */
export function frustumApex(centroid, axis, height, ratio) {
  if (!(ratio >= FRUSTUM3D_RATIO_MIN && ratio < FRUSTUM3D_RATIO_MAX)) return null;
  const t = r4(clamp(height / (1 - ratio)));
  return r4Vec([
    centroid[0] + (axis === 'x' ? t : 0),
    centroid[1] + (axis === 'y' ? t : 0),
    centroid[2] + (axis === 'z' ? t : 0),
  ]);
}

/**
 * 棱台的边索引表。返回 { baseEdges, topEdges, sideEdges }：
 *   baseEdges[i]=[i,(i+1)%n]（底面闭合棱），topEdges[i]=[n+i,n+(i+1)%n]（顶面闭合棱），
 *   sideEdges[i]=[i,n+i]（第 i 条侧棱）。
 * 纯函数、只读入参，可直接用于断言「底 n + 顶 n + 侧 n」结构。
 */
export function frustumEdgeIndices(n) {
  const baseEdges = [];
  const topEdges = [];
  const sideEdges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    baseEdges.push([i, j]);
    topEdges.push([n + i, n + j]);
    sideEdges.push([i, n + i]);
  }
  return { baseEdges, topEdges, sideEdges };
}

/**
 * 解析顶面规格：优先显式 top；否则由质心 + ratio + axis + height 生成。
 * 任一出现的参数非法即返回 { error }（原子拒绝，不静默回落）；给了 top 则忽略 ratio/axis/height
 * （与 pyramid3d 给 apex 忽略 axis/height、prism3d 给 vector 忽略 axis/height 同口径）。
 */
function resolveTopSpec(cmd, base, centroid) {
  if (cmd.top !== undefined) {
    const top = parseVertArray(cmd.top);
    if (top === null) return { error: 'top 需为与 base 同数量的合法 [x,y,z] 顶点数组' };
    if (top.length !== base.length) return { error: 'top 顶点数必须与 base 相同' };
    return { top, mode: 'explicit' };
  }
  const ratioRaw = cmd.ratio === undefined ? FRUSTUM3D_RATIO_DEFAULT : num(cmd.ratio);
  if (ratioRaw === null) return { error: 'ratio 必须是数字' };
  if (ratioRaw < FRUSTUM3D_RATIO_MIN || ratioRaw > FRUSTUM3D_RATIO_MAX) {
    return { error: `ratio 需为 ${FRUSTUM3D_RATIO_MIN}~${FRUSTUM3D_RATIO_MAX} 的数` };
  }
  const axis = cmd.axis === undefined ? FRUSTUM3D_AXIS_DEFAULT : cmd.axis;
  if (!FRUSTUM3D_AXES.includes(axis)) {
    return { error: `axis 只支持 ${FRUSTUM3D_AXES.join('/')}` };
  }
  const hRaw = cmd.height === undefined ? FRUSTUM3D_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { error: 'height 必须是数字' };
  if (hRaw < 0 || hRaw > FRUSTUM3D_HEIGHT_MAX) {
    return { error: `height 需为 0~${FRUSTUM3D_HEIGHT_MAX} 的数` };
  }
  const ratio = r4(ratioRaw);
  const height = r4(hRaw);
  const top = base.map((b) => frustumTopPoint(b, centroid, ratio, axis, height));
  return { top, mode: 'axis', ratio, axis, height, centroid: centroid.slice(), apex: frustumApex(centroid, axis, height, ratio) };
}

/**
 * 解析一条 frustum3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"frustum3d","id":"fru","base":[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],
 *    "ratio":0.5,"height":2,"asBase":true,"asTop":true,"asSides":true,
 *    "asVertices":false,"labelVertices":true,"vertexSize":0.1,"color":"#4f6bed"}
 *   - base           可选，底面顶点 [[x,y,z],...]，3~32 个（默认 z=0 平面边长 2 的正方形）；
 *   - top            可选，显式顶面顶点（数量须与 base 相同）；给了 top 则忽略 ratio/axis/height；
 *   - ratio          可选，顶面相对质心相似比 0~1（默认 0.5；1=棱柱、0=棱锥退化）；
 *   - axis / height  可选，不给 top 时沿坐标轴抬升（axis 默认 'z'，height 默认 2）；
 *   - asBase / asTop / asSides 可选，是否画底面 / 顶面 / 侧棱（均默认 true）；
 *   - asVertices     可选，是否在 2n 个顶点放小球标记（默认 false）；
 *   - labelVertices  可选，是否在 2n 个顶点放标注（默认 false，底面 A/B/C…、顶面 A'/B'/C'）；
 *   - vertexSize     可选，顶点球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolveFrustum3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'frustum' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- base：底面顶点（核心几何，出现即须合法；默认正方形） ----
  const base = cmd.base === undefined
    ? FRUSTUM3D_DEFAULT_BASE.map((p) => p.slice())
    : parseVertArray(cmd.base);
  if (base === null) {
    return { ok: false, error: `base 需为 ${FRUSTUM3D_BASE_MIN}~${FRUSTUM3D_BASE_MAX} 个 [x,y,z] 顶点` };
  }
  const centroid = frustumCentroid(base);

  // ---- 顶面：显式 top 或质心 + ratio + axis + height ----
  const topSpec = resolveTopSpec(cmd, base, centroid);
  if (topSpec.error) return { ok: false, error: topSpec.error };
  const top = topSpec.top;

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
  const vsRaw = cmd.vertexSize === undefined ? FRUSTUM3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < FRUSTUM3D_VERTEX_SIZE_MIN || vsRaw > FRUSTUM3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${FRUSTUM3D_VERTEX_SIZE_MIN}~${FRUSTUM3D_VERTEX_SIZE_MAX}` };
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

  // ---- 几何：底面闭合 n + 顶面闭合 n + 侧棱 n ----
  const n = base.length;
  const { baseEdges, topEdges, sideEdges } = frustumEdgeIndices(n);

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asBase ? n : 0) + (asTop ? n : 0) + (asSides ? n : 0);
  if (lineCount > FRUSTUM3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${FRUSTUM3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 prism3d / pyramid3d / polyhedron3d / tube3d 同口径）：
  // prefix 达 64 字符时从 stem 生成，保证截断后仍保留区分度、不死循环。
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

  // ---- 侧棱：每个底点连对应顶点 ----
  if (asSides) {
    for (let i = 0; i < n; i++) {
      const [a] = sideEdges[i];
      items.push(mkLine(nextId(`${stem}_s${i + 1}`.slice(0, 64)), base[a], top[a]));
    }
  }

  // ---- 可选：n 个底面顶点 + n 个顶面顶点的小球（先底后顶，与 prism3d/pyramid3d 同口径） ----
  if (asVertices) {
    for (let i = 0; i < n; i++) {
      items.push(mkPoint(nextId(`${stem}_vB${i + 1}`.slice(0, 64)), base[i]));
    }
    for (let i = 0; i < n; i++) {
      items.push(mkPoint(nextId(`${stem}_vT${i + 1}`.slice(0, 64)), top[i]));
    }
  }

  // ---- 可选：底面 A/B/C… + 顶面 A'/B'/C' 标注（先底后顶） ----
  if (labelVertices) {
    for (let i = 0; i < n; i++) {
      const letter = FRUSTUM3D_LABEL_LETTERS[i] || `V${i + 1}`;
      items.push(mkLabel(nextId(`${stem}_lB${i + 1}`.slice(0, 64)), letter, base[i]));
    }
    for (let i = 0; i < n; i++) {
      const letter = FRUSTUM3D_LABEL_LETTERS[i] || `V${i + 1}`;
      items.push(mkLabel(nextId(`${stem}_lT${i + 1}`.slice(0, 64)), `${letter}'`, top[i]));
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
      centroid: centroid.slice(),
      topMode: topSpec.mode,
      ratio: topSpec.mode === 'axis' ? topSpec.ratio : null,
      height: topSpec.mode === 'axis' ? topSpec.height : null,
      axis: topSpec.mode === 'axis' ? topSpec.axis : undefined,
      apex: topSpec.mode === 'axis' ? (topSpec.apex ? topSpec.apex.slice() : null) : null,
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

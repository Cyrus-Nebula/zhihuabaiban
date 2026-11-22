/**
 * 立体画板「空间向量 / 有向线段箭头（vector3d）」参数化生成命令的纯函数语义层（2026-11-23 D27 增量）
 *
 * 与 js/board3d-frustum.js / -prism.js / -tube.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个从 A 指向 B 的空间向量 / 法向量 / 力箭头」这类意图，用一条命令生成
 *   带圆锥箭头的线段线框：杆（from→to）+ 箭头底圈 + 箭头母线（可选起终点小球与 A/B 标注）。
 *   产出由 line（及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 line / 2D 线段只画**无向**线段，没有箭头；
 *   - measure3d 只**量测**向量（距离 / 夹角 / 中点）并把读数写成 label，不画有向线框；
 *   - transform3d / align3d 操作已有对象，不生成新几何；
 *   - cone3d（内置）只能沿 y 轴画正圆锥，无法把圆锥底垂直贴到任意空间方向上；
 *   - vector3d 用平行标架把圆锥箭头底圆严格放置在「垂直 AB、圆心落在 AB 上、距端点 headLength」处，
 *     直接服务「空间向量 / 法向量 / 力 / 有向边」用例。
 *
 * 几何定义：
 *   d = to − from，L = |d|（须在 0.01~10000，零向量无方向、原子拒绝），u = d / L（单位方向）；
 *   箭头底心 Q = to − headLength·u（headLength 钳制到 ≤ 0.9·L，保证底心落在杆上且不倒退）；
 *   正交标架：参考轴 ref = |u.y| < 0.9 ? Y : X，n = normalize(ref × u)，b = u × n，
 *            则 u / n / b 两两正交且均为单位向量；
 *   底圈点 P_i = Q + headRadius·(cos θ_i · n + sin θ_i · b)，θ_i = 2πi / headSegments；
 *   底圈相邻点连成 headSegments 条 line，每个 P_i 连到顶点 to 得 headSegments 条母线。
 *   守恒：|Q − to| = headLength、|P_i − Q| = headRadius，(P_i − Q)·u = 0（底圈恒垂直杆），
 *         |P_i − to| = √(headLength² + headRadius²)，且顶点恰为 to。
 *   本命令只校验数值与点位合法，不强制箭头与场景其它对象无交。
 */

/** 向量长度合法区间（防零向量无方向 / 超长刷屏） */
export const VECTOR3D_LENGTH_MIN = 0.01;
export const VECTOR3D_LENGTH_MAX = 10000;

/** 箭头锥长度（沿杆方向，从终点往回量） */
export const VECTOR3D_HEAD_LENGTH_MIN = 0.01;
export const VECTOR3D_HEAD_LENGTH_MAX = 1000;
export const VECTOR3D_HEAD_LENGTH_DEFAULT = 0.4;

/** 箭头锥底半径 */
export const VECTOR3D_HEAD_RADIUS_MIN = 0.01;
export const VECTOR3D_HEAD_RADIUS_MAX = 1000;
export const VECTOR3D_HEAD_RADIUS_DEFAULT = 0.2;

/** 箭头底圈分段数（锥面母线条数同此值） */
export const VECTOR3D_HEAD_SEGMENTS_MIN = 3;
export const VECTOR3D_HEAD_SEGMENTS_MAX = 48;
export const VECTOR3D_HEAD_SEGMENTS_DEFAULT = 12;

/** 箭头长度相对杆长的最大占比（保证底心不越过起点） */
export const VECTOR3D_HEAD_MAX_RATIO = 0.9;

/** 端点小球半径（与 prism3d / frustum3d 顶点球同口径） */
export const VECTOR3D_VERTEX_SIZE_MIN = 0.01;
export const VECTOR3D_VERTEX_SIZE_MAX = 1;
export const VECTOR3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const VECTOR3D_MAX_SEGMENTS = 4096;

/** 默认向量：原点沿 z 轴正向、长 2（与 frustum3d 默认 z 抬升方向一致） */
export const VECTOR3D_DEFAULT_FROM = Object.freeze(Object.freeze([0, 0, 0]));
export const VECTOR3D_DEFAULT_TO = Object.freeze(Object.freeze([0, 0, 2]));

/** 坐标钳制上限（与 geometry / prism3d / frustum3d / tube3d 一致） */
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
const unit = (a) => {
  const m = len3(a);
  return m > 1e-9 ? r4Vec([a[0] / m, a[1] / m, a[2] / m]) : null;
};

/**
 * 向量单位方向 u = (to − from) / |to − from|。零向量（含近零）返回 null。纯函数、只读入参。
 * @returns {Array|null} 单位方向 [ux,uy,uz]（新数组）或 null
 */
export function vectorDirection(from, to) {
  return unit(sub3(to, from));
}

/**
 * 箭头底圈的正交标架。参考轴避开与 u 近乎平行的方向，保证叉积不退化。
 * @returns {{n:Array,b:Array}|null} n/b 两两垂直于 u 且为单位向量，或 null（u 非法时）
 */
export function vectorHeadBasis(u) {
  if (!Array.isArray(u) || u.length !== 3 || !u.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n = unit(cross3(ref, u));
  if (!n) return null;
  const b = unit(cross3(u, n));
  return b ? { n, b } : null;
}

/**
 * 箭头锥底心 Q = to − headLength·u。纯函数、只读入参。
 */
export function vectorHeadBase(to, u, headLength) {
  return r4Vec([0, 1, 2].map((k) => to[k] - headLength * u[k]));
}

/**
 * 底圈上第 i 个点：Q + headRadius·(cos θ·n + sin θ·b)。纯函数、只读入参。
 */
export function vectorHeadPoint(base, n, b, headRadius, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return r4Vec([0, 1, 2].map((k) => base[k] + headRadius * (c * n[k] + s * b[k])));
}

/**
 * 解析一条 vector3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"vector3d","id":"vec","from":[0,0,0],"to":[3,0,4],
 *    "headLength":0.5,"headRadius":0.25,"headSegments":12,
 *    "asShaft":true,"asHead":true,"asPoints":false,"labelEndpoints":true,
 *    "vertexSize":0.1,"color":"#4f6bed"}
 *   - from / to       可选，向量起点 / 终点 [x,y,z]（默认 [0,0,0] → [0,0,2]）；二者不得重合，
 *                     长度须在 VECTOR3D_LENGTH_MIN~MAX；
 *   - headLength      可选，箭头锥沿杆回退长度（默认 0.4，0.01~1000，自动钳制到 ≤ 0.9·|AB|）；
 *   - headRadius      可选，箭头锥底半径（默认 0.2，0.01~1000）；
 *   - headSegments    可选，底圈 / 母线条数（默认 12，整数 3~48）；
 *   - asShaft         可选，是否画杆 from→to（默认 true）；
 *   - asHead          可选，是否画圆锥箭头（默认 true）；
 *   - asPoints        可选，是否在起点 / 终点放小球（默认 false）；
 *   - labelEndpoints  可选，是否在起点 / 终点放 A / B 标注（默认 false）；
 *   - vertexSize      可选，端点球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。四个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolveVector3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'vector' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- from / to：核心几何，出现即须合法 ----
  const from = cmd.from === undefined ? VECTOR3D_DEFAULT_FROM.slice() : parsePoint3(cmd.from);
  if (from === null) return { ok: false, error: 'from 需为合法 [x,y,z] 点' };
  const to = cmd.to === undefined ? VECTOR3D_DEFAULT_TO.slice() : parsePoint3(cmd.to);
  if (to === null) return { ok: false, error: 'to 需为合法 [x,y,z] 点' };

  const dRaw = sub3(to, from);
  const lengthRaw = len3(dRaw);
  if (!Number.isFinite(lengthRaw) || lengthRaw < VECTOR3D_LENGTH_MIN) {
    return { ok: false, error: `from 与 to 重合或过近，向量长度需 ≥ ${VECTOR3D_LENGTH_MIN}` };
  }
  if (lengthRaw > VECTOR3D_LENGTH_MAX) {
    return { ok: false, error: `向量长度 ${lengthRaw} 超过上限 ${VECTOR3D_LENGTH_MAX}` };
  }
  const u = vectorDirection(from, to);
  if (!u) return { ok: false, error: '无法计算向量方向' };
  const length = r4(lengthRaw);

  // ---- 箭头长度：合法数值 + 钳制到杆长占比 ----
  const hlRaw = cmd.headLength === undefined ? VECTOR3D_HEAD_LENGTH_DEFAULT : num(cmd.headLength);
  if (hlRaw === null) return { ok: false, error: 'headLength 必须是数字' };
  if (hlRaw < VECTOR3D_HEAD_LENGTH_MIN || hlRaw > VECTOR3D_HEAD_LENGTH_MAX) {
    return { ok: false, error: `headLength 需为 ${VECTOR3D_HEAD_LENGTH_MIN}~${VECTOR3D_HEAD_LENGTH_MAX} 的数` };
  }
  const headRequested = r4(hlRaw);
  const hlEffective = Math.min(headRequested, lengthRaw * VECTOR3D_HEAD_MAX_RATIO);
  const headLength = r4(hlEffective);

  // ---- 箭头底半径：合法数值 + 区间 ----
  const hrRaw = cmd.headRadius === undefined ? VECTOR3D_HEAD_RADIUS_DEFAULT : num(cmd.headRadius);
  if (hrRaw === null) return { ok: false, error: 'headRadius 必须是数字' };
  if (hrRaw < VECTOR3D_HEAD_RADIUS_MIN || hrRaw > VECTOR3D_HEAD_RADIUS_MAX) {
    return { ok: false, error: `headRadius 需为 ${VECTOR3D_HEAD_RADIUS_MIN}~${VECTOR3D_HEAD_RADIUS_MAX} 的数` };
  }
  const headRadius = r4(hrRaw);

  // ---- 底圈分段数：必须是区间内整数 ----
  const hsRaw = cmd.headSegments === undefined ? VECTOR3D_HEAD_SEGMENTS_DEFAULT : num(cmd.headSegments);
  if (hsRaw === null) return { ok: false, error: 'headSegments 必须是数字' };
  if (!Number.isInteger(hsRaw) || hsRaw < VECTOR3D_HEAD_SEGMENTS_MIN || hsRaw > VECTOR3D_HEAD_SEGMENTS_MAX) {
    return { ok: false, error: `headSegments 需为 ${VECTOR3D_HEAD_SEGMENTS_MIN}~${VECTOR3D_HEAD_SEGMENTS_MAX} 的整数` };
  }
  const headSegments = hsRaw;

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asShaft', 'asHead', 'asPoints', 'labelEndpoints']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：端点球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? VECTOR3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < VECTOR3D_VERTEX_SIZE_MIN || vsRaw > VECTOR3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${VECTOR3D_VERTEX_SIZE_MIN}~${VECTOR3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asShaft = cmd.asShaft === undefined ? true : cmd.asShaft;
  const asHead = cmd.asHead === undefined ? true : cmd.asHead;
  const asPoints = cmd.asPoints === true;
  const labelEndpoints = cmd.labelEndpoints === true;
  if (!asShaft && !asHead && !asPoints && !labelEndpoints) {
    return { ok: false, error: 'asShaft / asHead / asPoints / labelEndpoints 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：正交标架 + 底心 + 底圈点 ----
  const basis = vectorHeadBasis(u);
  if (!basis) return { ok: false, error: '无法构造垂直于向量的正交标架' };
  const headBase = vectorHeadBase(to, u, headLength);
  const ring = [];
  for (let i = 0; i < headSegments; i++) {
    ring.push(vectorHeadPoint(headBase, basis.n, basis.b, headRadius, 2 * Math.PI * i / headSegments));
  }

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asShaft ? 1 : 0) + (asHead ? 2 * headSegments : 0);
  if (lineCount > VECTOR3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${VECTOR3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 prism3d / frustum3d / tube3d 同口径）：
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

  // ---- 杆：from → to ----
  if (asShaft) {
    items.push(mkLine(nextId(`${stem}_shaft`.slice(0, 64)), from, to));
  }

  // ---- 箭头圆锥：底圈 n 段 + 母线 n 段 ----
  if (asHead) {
    for (let i = 0; i < headSegments; i++) {
      const j = (i + 1) % headSegments;
      items.push(mkLine(nextId(`${stem}_hr${i + 1}`.slice(0, 64)), ring[i], ring[j]));
    }
    for (let i = 0; i < headSegments; i++) {
      items.push(mkLine(nextId(`${stem}_hb${i + 1}`.slice(0, 64)), ring[i], to));
    }
  }

  // ---- 可选：起点 / 终点小球（先 from 后 to） ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pA`.slice(0, 64)), from));
    items.push(mkPoint(nextId(`${stem}_pB`.slice(0, 64)), to));
  }

  // ---- 可选：起点 A / 终点 B 标注（先 from 后 to） ----
  if (labelEndpoints) {
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), 'A', from));
    items.push(mkLabel(nextId(`${stem}_lB`.slice(0, 64)), 'B', to));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      from: from.slice(),
      to: to.slice(),
      direction: u.slice(),
      length,
      headLength,
      headLengthRequested: headRequested,
      headLengthClamped: headRequested > headLength,
      headRadius,
      headSegments,
      headBase: headBase.slice(),
      basis: { n: basis.n.slice(), b: basis.b.slice() },
      ring: ring.map((p) => p.slice()),
      asShaft,
      asHead,
      asPoints,
      labelEndpoints,
      vertexSize,
      shaftCount: asShaft ? 1 : 0,
      headRingCount: asHead ? headSegments : 0,
      headRibCount: asHead ? headSegments : 0,
      pointCount: asPoints ? 2 : 0,
      labelCount: labelEndpoints ? 2 : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

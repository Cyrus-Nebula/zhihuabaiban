/**
 * 立体画板「通用圆台 / 斜圆台（conefrustum3d）」参数化生成命令的纯函数语义层（2026-11-24 D31 增量）
 *
 * 与 js/board3d-cone.js / -cylinder.js / -frustum.js / -prism.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个圆台 / 斜圆台 / 上下底半径不同的台体」这类意图，用一条命令生成圆台线框：
 *   下底圆（segments 段）+ 上底圆（segments 段）+ 上下底对应点的侧母线（segments 段），
 *   可选上下底圆心 / 底圈 / 顶圈小球与 O/O'（圆心）、A/B/C…（下底圈）、A'/B'/C'（上底圈）标注。
 *   产出由 line（及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 cylinder(rt,rb,h) 虽能画圆台，但只能沿 y 轴画正圆台，无法指定底面圆心 / 法向 / 顶面偏移；
 *   - cone3d 只有一个圆底面 + 顶点、上圈收缩为一点；cylinder3d 上下底等半径，画不出半径不同的台体；
 *   - frustum3d / prism3d 的底面是**多边形**（棱台 / 棱柱），画不出真正的圆底 / 圆顶；
 *   - revolve3d 画圆台需手写一圈 [r,h] 母线采样点；tube3d 画的是扫掠管中心线外壳；
 *   - conefrustum3d 给「下底圆心 base + 法向 axis + 下底半径 radiusBottom + 上底半径 radiusTop +
 *     高 height（或显式上底圆心 top）」，直接生成双圆底 + 侧母线；top 与 axis 分离即可表达斜圆台，
 *     服务「空间几何体 / 圆台 / 圆台轴截面 / 标注顶点」核心用例。
 *
 * 几何定义：
 *   axisUnit = 下底平面法向（'x'/'y'/'z' 或任意 3D 向量单位化，默认 'z'）；
 *   正交标架 ref = |u.y| < 0.9 ? Y : X，n = normalize(ref × u)，b = u × n，
 *   则 axisUnit / n / b 两两正交且均为单位向量；
 *   下底圈点 P_i = base + radiusBottom·(cos θ_i·n + sin θ_i·b)，θ_i = 2πi / segments；
 *   上底圆心 top = 显式给定时直接用（可偏离轴线 → 斜圆台），否则 base + height·axisUnit（正圆台）；
 *   上底圈点 Q_i = top + radiusTop·(cos θ_i·n + sin θ_i·b)（与下底**同标架、半径可不同**）。
 *   守恒：
 *     |P_i − base| = radiusBottom、(P_i − base)·axisUnit = 0（下底圈恒垂直法向、共面）；
 *     |Q_i − top| = radiusTop、(Q_i − top)·axisUnit = 0（上底圈恒垂直法向、共面）；
 *     正圆台（shift ∥ axisUnit）：上下底圈平行共轴，各侧母线等长 = √(hA² + (rb−rt)²)，hA=轴向高；
 *     斜圆台（shift 含垂直 axis 分量）：上下底圈仍是真圆且平行，但侧母线长随 i 变化；
 *     顶点（锥顶）S = base + shift·rb/(rb−rt)（rb≠rt），上下底圈各点 P_i、Q_i 与 S 恒共线——
 *     正圆台 S 落在 axis 轴上，斜圆台 S 偏离轴线，两者都是真圆台的锥顶；
 *     radiusTop=0 退化为圆锥、radiusTop=radiusBottom 退化为圆柱（无有限锥顶）。
 *   本命令只校验数值与点位合法，不强制台体与场景其它对象无交。
 */

/** 下底半径合法区间（下底须为正半径） */
export const CONEFRUSTUM3D_RADIUS_BOTTOM_MIN = 0.01;
export const CONEFRUSTUM3D_RADIUS_BOTTOM_MAX = 10000;
export const CONEFRUSTUM3D_RADIUS_BOTTOM_DEFAULT = 2;

/** 上底半径合法区间（允许 0 退化为圆锥） */
export const CONEFRUSTUM3D_RADIUS_TOP_MIN = 0;
export const CONEFRUSTUM3D_RADIUS_TOP_MAX = 10000;
export const CONEFRUSTUM3D_RADIUS_TOP_DEFAULT = 1;

/** 台高（沿 axis 方向、仅未给 top 时生效）合法区间 */
export const CONEFRUSTUM3D_HEIGHT_MIN = 0.01;
export const CONEFRUSTUM3D_HEIGHT_MAX = 10000;
export const CONEFRUSTUM3D_HEIGHT_DEFAULT = 2;

/** 底圈 / 顶圈分段数（侧母线数同此值） */
export const CONEFRUSTUM3D_SEGMENTS_MIN = 3;
export const CONEFRUSTUM3D_SEGMENTS_MAX = 64;
export const CONEFRUSTUM3D_SEGMENTS_DEFAULT = 24;

/** 圆心 / 底圈 / 顶圈小球半径（与 cone3d / cylinder3d / vector3d 同口径） */
export const CONEFRUSTUM3D_VERTEX_SIZE_MIN = 0.01;
export const CONEFRUSTUM3D_VERTEX_SIZE_MAX = 1;
export const CONEFRUSTUM3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const CONEFRUSTUM3D_MAX_SEGMENTS = 4096;

/** 默认下底圆心 / 默认下底法向（z 轴，下底落在 xy 平面） */
export const CONEFRUSTUM3D_DEFAULT_BASE = Object.freeze(Object.freeze([0, 0, 0]));
export const CONEFRUSTUM3D_DEFAULT_AXIS = 'z';

/** 坐标钳制上限（与 geometry / cone3d / cylinder3d / frustum3d / vector3d 一致） */
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
 * 解析下底法向 axis：'x'/'y'/'z'（大小写不敏感）或任意非零 3D 向量（单位化）。
 * 纯函数、只读入参。
 * @returns {Array|null} 单位法向 [ux,uy,uz]（新数组）或 null
 */
export function conefrustumAxisUnit(axis) {
  if (axis === undefined) return [0, 0, 1];
  if (typeof axis === 'string') {
    const s = axis.trim().toLowerCase();
    if (s === 'x') return [1, 0, 0];
    if (s === 'y') return [0, 1, 0];
    if (s === 'z') return [0, 0, 1];
    return null;
  }
  if (Array.isArray(axis)) {
    const p = parsePoint3(axis);
    if (!p) return null;
    return unit(p);
  }
  return null;
}

/**
 * 下底圆的正交标架。参考轴避开与法向近乎平行的方向，保证叉积不退化。
 * @returns {{n:Array,b:Array}|null} n/b 两两垂直于 axisUnit 且为单位向量，或 null
 */
export function conefrustumBaseBasis(u) {
  if (!Array.isArray(u) || u.length !== 3 || !u.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n = unit(cross3(ref, u));
  if (!n) return null;
  const b = unit(cross3(u, n));
  return b ? { n, b } : null;
}

/**
 * 圆上第 i 个点：center + radius·(cos θ·n + sin θ·b)。纯函数、只读入参。
 * center 可为下底圆心 base 或上底圆心 top，二者共用同一标架 n/b → 上下底圈平行。
 */
export function conefrustumRingPoint(center, n, b, radius, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return r4Vec([0, 1, 2].map((k) => center[k] + radius * (c * n[k] + s * b[k])));
}

/** 第 i 个圈点的标注文本：A..Z，超过 26 用 A2/B2…；prime=true 追加撇号（上底圈） */
function labelFor(i, prime) {
  const letter = String.fromCharCode(65 + (i % 26));
  const round = Math.floor(i / 26);
  const base = round === 0 ? letter : `${letter}${round + 1}`;
  return prime ? `${base}'` : base;
}

/**
 * 解析一条 conefrustum3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"conefrustum3d","id":"cfm","base":[0,0,0],"axis":"z","radiusBottom":2,"radiusTop":1,
 *    "height":3,"segments":24,"asBase":true,"asTop":true,"asSides":true,"asPoints":false,
 *    "labelVertices":false,"vertexSize":0.1,"color":"#4f6bed"}
 *   - base          可选，下底面圆心 [x,y,z]（默认 [0,0,0]）；
 *   - axis          可选，下底法向 'x'/'y'/'z' 或 3D 向量（默认 'z'）；
 *   - radiusBottom  可选，下底半径（默认 2，0.01~10000）；
 *   - radiusTop     可选，上底半径（默认 1，0~10000；0 退化为圆锥，=radiusBottom 退化为圆柱）；
 *   - height        可选，上底沿 axis 距下底的高（默认 2，0.01~10000），仅未给 top 时生效；
 *   - top           可选，显式上底面圆心 [x,y,z]；给了就忽略 height，可与 axis 分离形成斜圆台；
 *   - segments      可选，下底 / 上底 / 母线条数（默认 24，整数 3~64）；
 *   - asBase        可选，是否画下底面圆（默认 true）；
 *   - asTop         可选，是否画上底面圆（默认 true）；
 *   - asSides       可选，是否画上下底对应点的侧母线（默认 true）；
 *   - asPoints      可选，是否在两圆心与底圈/顶圈各点放小球（默认 false）；
 *   - labelVertices 可选，是否标注圆心 O/O' 与下底圈 A/B/C…、上底圈 A'/B'/C'（默认 false）；
 *   - vertexSize    可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。五个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolveConefrustum3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'cfm' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- base：下底圆心 ----
  const base = cmd.base === undefined ? CONEFRUSTUM3D_DEFAULT_BASE.slice() : parsePoint3(cmd.base);
  if (base === null) return { ok: false, error: 'base 需为合法 [x,y,z] 点' };

  // ---- axis：下底法向 ----
  const axisUnit = conefrustumAxisUnit(cmd.axis);
  if (!axisUnit) return { ok: false, error: 'axis 需为 x/y/z 或合法非零 3D 向量' };

  // ---- radiusBottom：下底半径 + 区间 ----
  const rbRaw = cmd.radiusBottom === undefined ? CONEFRUSTUM3D_RADIUS_BOTTOM_DEFAULT : num(cmd.radiusBottom);
  if (rbRaw === null) return { ok: false, error: 'radiusBottom 必须是数字' };
  if (rbRaw < CONEFRUSTUM3D_RADIUS_BOTTOM_MIN || rbRaw > CONEFRUSTUM3D_RADIUS_BOTTOM_MAX) {
    return { ok: false, error: `radiusBottom 需为 ${CONEFRUSTUM3D_RADIUS_BOTTOM_MIN}~${CONEFRUSTUM3D_RADIUS_BOTTOM_MAX} 的数` };
  }
  const radiusBottom = r4(rbRaw);

  // ---- radiusTop：上底半径 + 区间（允许 0 退化圆锥） ----
  const rtRaw = cmd.radiusTop === undefined ? CONEFRUSTUM3D_RADIUS_TOP_DEFAULT : num(cmd.radiusTop);
  if (rtRaw === null) return { ok: false, error: 'radiusTop 必须是数字' };
  if (rtRaw < CONEFRUSTUM3D_RADIUS_TOP_MIN || rtRaw > CONEFRUSTUM3D_RADIUS_TOP_MAX) {
    return { ok: false, error: `radiusTop 需为 ${CONEFRUSTUM3D_RADIUS_TOP_MIN}~${CONEFRUSTUM3D_RADIUS_TOP_MAX} 的数` };
  }
  const radiusTop = r4(rtRaw);

  // ---- height：合法数值 + 区间（出现即校验，top 优先） ----
  const hRaw = cmd.height === undefined ? CONEFRUSTUM3D_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { ok: false, error: 'height 必须是数字' };
  if (hRaw < CONEFRUSTUM3D_HEIGHT_MIN || hRaw > CONEFRUSTUM3D_HEIGHT_MAX) {
    return { ok: false, error: `height 需为 ${CONEFRUSTUM3D_HEIGHT_MIN}~${CONEFRUSTUM3D_HEIGHT_MAX} 的数` };
  }
  const height = r4(hRaw);

  // ---- top：显式上底圆心优先，否则 base + height·axisUnit ----
  let top;
  let topExplicit = false;
  if (cmd.top !== undefined) {
    top = parsePoint3(cmd.top);
    if (top === null) return { ok: false, error: 'top 需为合法 [x,y,z] 点' };
    topExplicit = true;
  } else {
    top = r4Vec([0, 1, 2].map((k) => base[k] + height * axisUnit[k]));
  }
  const shift = sub3(top, base);
  const shiftLen = len3(shift);
  if (!Number.isFinite(shiftLen) || shiftLen < CONEFRUSTUM3D_HEIGHT_MIN) {
    return { ok: false, error: `上底圆心与下底圆心重合或过近，距离需 ≥ ${CONEFRUSTUM3D_HEIGHT_MIN}` };
  }
  if (shiftLen > CONEFRUSTUM3D_HEIGHT_MAX) {
    return { ok: false, error: `上底圆心与下底圆心距离 ${shiftLen} 超过上限 ${CONEFRUSTUM3D_HEIGHT_MAX}` };
  }

  // ---- segments：必须是区间内整数 ----
  const segRaw = cmd.segments === undefined ? CONEFRUSTUM3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < CONEFRUSTUM3D_SEGMENTS_MIN || segRaw > CONEFRUSTUM3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${CONEFRUSTUM3D_SEGMENTS_MIN}~${CONEFRUSTUM3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asBase', 'asTop', 'asSides', 'asPoints', 'labelVertices']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：小球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? CONEFRUSTUM3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < CONEFRUSTUM3D_VERTEX_SIZE_MIN || vsRaw > CONEFRUSTUM3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${CONEFRUSTUM3D_VERTEX_SIZE_MIN}~${CONEFRUSTUM3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asBase = cmd.asBase === undefined ? true : cmd.asBase;
  const asTop = cmd.asTop === undefined ? true : cmd.asTop;
  const asSides = cmd.asSides === undefined ? true : cmd.asSides;
  const asPoints = cmd.asPoints === true;
  const labelVertices = cmd.labelVertices === true;
  if (!asBase && !asTop && !asSides && !asPoints && !labelVertices) {
    return { ok: false, error: 'asBase / asTop / asSides / asPoints / labelVertices 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：正交标架 + 下底 / 上底圈点（同标架保证上下底圈平行） ----
  const basis = conefrustumBaseBasis(axisUnit);
  if (!basis) return { ok: false, error: '无法构造垂直下底法向的正交标架' };
  const bottom = [];
  const upper = [];
  for (let i = 0; i < segments; i++) {
    const theta = 2 * Math.PI * i / segments;
    bottom.push(conefrustumRingPoint(base, basis.n, basis.b, radiusBottom, theta));
    upper.push(conefrustumRingPoint(top, basis.n, basis.b, radiusTop, theta));
  }

  // ---- 正 / 斜圆台判定与守恒读数 ----
  const crossShiftAxis = cross3(shift, axisUnit);
  const isRight = len3(crossShiftAxis) < 1e-6;
  const axialHeight = Math.abs(dot3(shift, axisUnit));
  // 各侧母线长度：正圆台恒为 √(hA² + (rb−rt)²)，斜圆台随 i 变化
  const slantLengths = bottom.map((p, i) => len3(sub3(upper[i], p)));
  const slantHeight = r4(slantLengths.reduce((s, v) => s + v, 0) / slantLengths.length);
  // 锥顶 S = base + shift·rb/(rb−rt)（rb≠rt）；正圆台落在 axis 上，斜圆台偏离轴线
  let apex = null;
  let apexRatio = null;
  let apexCollinearMaxDev = null;
  if (Math.abs(radiusBottom - radiusTop) > 1e-9) {
    apexRatio = radiusBottom / (radiusBottom - radiusTop);
    apex = r4Vec([0, 1, 2].map((k) => base[k] + shift[k] * apexRatio));
    // 逐段验证 P_i / Q_i / S 共线：|(Q_i−P_i) × (S−P_i)| 对 |Q_i−P_i| 归一后取最大偏差
    let maxDev = 0;
    for (let i = 0; i < segments; i++) {
      const side = sub3(upper[i], bottom[i]);
      const toApex = sub3(apex, bottom[i]);
      const sideLen = len3(side);
      if (sideLen < 1e-9) continue;
      maxDev = Math.max(maxDev, len3(cross3(side, toApex)) / sideLen);
    }
    apexCollinearMaxDev = r4(maxDev);
  }

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asBase ? segments : 0) + (asTop ? segments : 0) + (asSides ? segments : 0);
  if (lineCount > CONEFRUSTUM3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${CONEFRUSTUM3D_MAX_SEGMENTS}` };
  }

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

  // ---- 下底圆：相邻点连成 segments 段闭合圆 ----
  if (asBase) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      items.push(mkLine(nextId(`${stem}_b${i + 1}`.slice(0, 64)), bottom[i], bottom[j]));
    }
  }

  // ---- 上底圆：相邻点连成 segments 段闭合圆 ----
  if (asTop) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      items.push(mkLine(nextId(`${stem}_t${i + 1}`.slice(0, 64)), upper[i], upper[j]));
    }
  }

  // ---- 侧母线：下底第 i 点连到上底第 i 点（正圆台等长、锥顶共线） ----
  if (asSides) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_s${i + 1}`.slice(0, 64)), bottom[i], upper[i]));
    }
  }

  // ---- 可选：两圆心与下底 / 上底圈小球（先圆心 O/O'，再下底、上底） ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), base));
    items.push(mkPoint(nextId(`${stem}_pOp`.slice(0, 64)), top));
    for (let i = 0; i < segments; i++) {
      items.push(mkPoint(nextId(`${stem}_pb${i + 1}`.slice(0, 64)), bottom[i]));
      items.push(mkPoint(nextId(`${stem}_pt${i + 1}`.slice(0, 64)), upper[i]));
    }
  }

  // ---- 可选：圆心 O/O' 与下底圈 A/B/C…、上底圈 A'/B'/C' 标注 ----
  if (labelVertices) {
    items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', base));
    items.push(mkLabel(nextId(`${stem}_lOp`.slice(0, 64)), "O'", top));
    for (let i = 0; i < segments; i++) {
      items.push(mkLabel(nextId(`${stem}_lb${i + 1}`.slice(0, 64)), labelFor(i, false), bottom[i]));
      items.push(mkLabel(nextId(`${stem}_lt${i + 1}`.slice(0, 64)), labelFor(i, true), upper[i]));
    }
  }

  const degenerate = radiusTop === 0 ? 'cone' : (radiusTop === radiusBottom ? 'cylinder' : 'frustum');

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      base: base.slice(),
      axis: axisUnit.slice(),
      radiusBottom,
      radiusTop,
      height,
      top: top.slice(),
      topExplicit,
      shift: shift.slice(),
      axialHeight: r4(axialHeight),
      slantHeight,
      slantLengths: slantLengths.map((v) => r4(v)),
      slantMaxDeviation: r4(Math.max(...slantLengths) - Math.min(...slantLengths)),
      apex,
      apexRatio: apexRatio === null ? null : r4(apexRatio),
      apexCollinearMaxDev,
      isRight,
      degenerate,
      segments,
      basis: { n: basis.n.slice(), b: basis.b.slice() },
      bottomRing: bottom.map((p) => p.slice()),
      topRing: upper.map((p) => p.slice()),
      asBase,
      asTop,
      asSides,
      asPoints,
      labelVertices,
      vertexSize,
      baseRingCount: asBase ? segments : 0,
      topRingCount: asTop ? segments : 0,
      sideCount: asSides ? segments : 0,
      pointCount: asPoints ? segments * 2 + 2 : 0,
      labelCount: labelVertices ? segments * 2 + 2 : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

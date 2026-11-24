/**
 * 立体画板「点到空间直线的距离（pointline3d）」参数化生成命令的纯函数语义层（2026-11-25 D37 增量）
 *
 * 与 js/board3d-pointplane.js / -skewline.js / -lineangle.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求空间一点到一条直线的距离 / 从点向空间直线作垂线」这类意图，用一条命令生成标准作图：
 *   空间直线（可两端延长）+ 垂线段 PH + H 处直角符号 + 可选 P/H 与直线端点小球 + 距离读数。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 量「两点距离 / 三点夹角 / 中点」，给不出「点与直线的距离」与垂足作图；
 *   - pointplane3d 量点到平面的距离；skewline3d 量两条异面直线的公垂线与距离；
 *     lineangle3d 量两直线夹角；lineplane3d 量线面角；dihedral3d 量二面角；
 *   - pointline3d 给「点 P + 直线两点 from/to」，自动求垂足 H 与距离 d=|PH|，
 *     直接服务「空间点到直线距离 / 作垂线 / 正方体顶点到棱的距离 / 标注垂足」核心用例。
 *
 * 几何定义（u=to−from，eu=u/|u|，diff=P−from）：
 *   t     = diff·eu                                   （沿无限直线的带符号投影长度）；
 *   t'    = clampToSegment ? clamp(t,0,|u|) : t        （是否把垂足钳制到线段上）；
 *   H     = from + t'·eu                              （垂足 / 最近点）；
 *   d     = |P−H| = |diff×eu|（未钳制时）             （点到直线距离）；
 *   perp  = (P−H)/d（d≈0 时取 eu 的任一垂向）         （从 H 指向 P 的单位向量，未钳制时 ⊥ eu）；
 *   cross = unit(eu×perp)                             （辅助正交基）。
 *   直角符号三段：H+a·eu → H+a·eu+a·perp → H+a·perp（a=rightAngleSize，两边分别 ∥ eu 与 ∥ perp）。
 *   钳制到线段且 t 落在端点外时，PH 不再垂直直线，此时自动省略直角符号（不画假直角）。
 *
 * 守恒：|eu|=|perp|=|cross|=1；未钳制时 eu·perp=0、垂足 H 恒在直线上、
 *   d=|diff×eu|=|(P−from)×eu|、|PH|=d；直角符号两边互相垂直；直线两端延长不改变方向 eu。
 */
const COORD_LIMIT = 10000;
const DIR_EPS = 1e-9;

/** 直线两端延长长度合法区间与默认 */
export const POINTLINE3D_EXTEND_MIN = 0;
export const POINTLINE3D_EXTEND_MAX = 1000;
export const POINTLINE3D_EXTEND_DEFAULT = 0;

/** 直角符号边长合法区间与默认 */
export const POINTLINE3D_RIGHT_ANGLE_MIN = 0.05;
export const POINTLINE3D_RIGHT_ANGLE_MAX = 100;
export const POINTLINE3D_RIGHT_ANGLE_DEFAULT = 0.25;

/** 小球半径合法区间与默认 */
export const POINTLINE3D_VERTEX_SIZE_MIN = 0.01;
export const POINTLINE3D_VERTEX_SIZE_MAX = 1;
export const POINTLINE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const POINTLINE3D_MAX_SEGMENTS = 4096;

/** 默认：点 [1,2,0] 到 x 轴，垂足 [1,0,0]、距离 2 */
export const POINTLINE3D_DEFAULT_POINT = Object.freeze([1, 2, 0]);
export const POINTLINE3D_DEFAULT_FROM = Object.freeze([0, 0, 0]);
export const POINTLINE3D_DEFAULT_TO = Object.freeze([2, 0, 0]);

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
  return m > DIR_EPS ? [a[0] / m, a[1] / m, a[2] / m] : null;
};

/** 垂直 u 的任一单位向量（点落直线时退化用） */
function perpendicular(u) {
  const helper = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(u, helper)) || unit(cross3(u, [1, 0, 0]));
}

/**
 * 纯几何核心：求点到空间直线的垂足、距离与正交标架（只读入参）。
 *
 * @param {Array} point 点 P [x,y,z]
 * @param {Array} from  直线起点 [x,y,z]
 * @param {Array} to    直线方向点 [x,y,z]（不得与 from 重合）
 * @param {boolean} clampToSegment 是否把垂足钳制在线段 from→to 上（默认 false，即无限直线）
 * @returns {{ok:true, point, from, to, unit:Array, lineLength:number, t:number,
 *            clamped:boolean, foot:Array, distance:number, perpDir:Array,
 *            binormal:Array, onLine:boolean} | {ok:false, error:string}}
 */
export function pointlineCore(point, from, to, clampToSegment = false) {
  const P = parsePoint3(point);
  const A = parsePoint3(from);
  const B = parsePoint3(to);
  if (!P || !A || !B) return { ok: false, error: 'point/from/to 需为合法 [x,y,z]' };

  const u = sub3(B, A);
  const lineLength = len3(u);
  if (lineLength < DIR_EPS) return { ok: false, error: 'from 与 to 不能重合（直线方向退化）' };
  const eu = unit(u);

  const diff = sub3(P, A);
  const tRaw = dot3(diff, eu);
  const t = clampToSegment ? Math.min(lineLength, Math.max(0, tRaw)) : tRaw;
  const clamped = clampToSegment && Math.abs(t - tRaw) > 1e-7;
  const foot = r4Vec([0, 1, 2].map((k) => A[k] + t * eu[k]));

  const w = sub3(P, foot);
  const distance = Math.abs(r4(len3(w)));
  const onLine = len3(w) < 1e-7;
  const perpRaw = onLine ? perpendicular(eu) : unit(w);
  if (!perpRaw) return { ok: false, error: '无法构造点到直线的垂向' };
  const perpDir = r4Vec(perpRaw);
  const binormalRaw = unit(cross3(eu, perpDir));
  if (!binormalRaw) return { ok: false, error: '无法构造正交辅助基' };

  return {
    ok: true,
    point: P.slice(),
    from: A.slice(),
    to: B.slice(),
    unit: r4Vec(eu),
    lineLength: r4(lineLength),
    t: r4(t),
    clamped,
    foot,
    distance,
    perpDir,
    binormal: r4Vec(binormalRaw),
    onLine,
  };
}

/** 垂足 H = from + clamp((P−from)·eu)·eu。纯函数、只读入参。 */
export function pointlineFoot(point, from, to, clampToSegment = false) {
  const c = pointlineCore(point, from, to, clampToSegment);
  return c.ok ? c.foot : null;
}

/** 距离 d = |P−H|（未钳制时亦等于 |(P−from)×eu|）。纯函数、只读入参。 */
export function pointlineDistance(point, from, to, clampToSegment = false) {
  const c = pointlineCore(point, from, to, clampToSegment);
  return c.ok ? c.distance : null;
}

/**
 * 解析一条 pointline3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"pointline3d","id":"ptln","point":[1,2,0],"from":[0,0,0],"to":[2,0,0],
 *    "extend":0,"clampToSegment":false,"rightAngleSize":0.25,
 *    "asLine":true,"asPerp":true,"asRightAngle":true,"asPoints":false,
 *    "labelDistance":true,"labelPoint":false,"labelFoot":false,"labelLine":false,
 *    "vertexSize":0.1,"color":"#4f6bed"}
 *   - point 可选，给定点 P（默认 [1,2,0]）；
 *   - from/to 可选，直线两点（默认 x 轴 [0,0,0]→[2,0,0]，不得重合）；
 *   - extend 可选，直线两端延长长度（默认 0，0~1000）；
 *   - clampToSegment 可选，是否把垂足钳制在线段上（默认 false，无限直线）；
 *     钳制且投影落在端点外时垂线不再垂直直线，自动省略直角符号；
 *   - rightAngleSize 可选，直角符号边长（默认 0.25，0.05~100）；
 *   - asLine/asPerp/asRightAngle/asPoints/labelDistance/labelPoint/labelFoot/labelLine 输出开关，至少开一个；
 *   - vertexSize / color / labelColor / opacity 样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolvePointline3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'ptln' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 点与直线两点 ----
  const P = parsePoint3(cmd.point === undefined ? POINTLINE3D_DEFAULT_POINT : cmd.point);
  if (!P) return { ok: false, error: 'point 需为合法 [x,y,z]' };
  const A = parsePoint3(cmd.from === undefined ? POINTLINE3D_DEFAULT_FROM : cmd.from);
  if (!A) return { ok: false, error: 'from 需为合法 [x,y,z]' };
  const B = parsePoint3(cmd.to === undefined ? POINTLINE3D_DEFAULT_TO : cmd.to);
  if (!B) return { ok: false, error: 'to 需为合法 [x,y,z]' };

  // ---- 数值参数：出现即校验 ----
  const numeric = (key, def, min, max) => {
    const raw = cmd[key] === undefined ? def : num(cmd[key]);
    if (raw === null) return { error: `${key} 必须是数字` };
    if (raw < min || raw > max) return { error: `${key} 需为 ${min}~${max}` };
    return { value: r4(raw) };
  };
  const exR = numeric('extend', POINTLINE3D_EXTEND_DEFAULT, POINTLINE3D_EXTEND_MIN, POINTLINE3D_EXTEND_MAX);
  if (exR.error) return { ok: false, error: exR.error };
  const raR = numeric('rightAngleSize', POINTLINE3D_RIGHT_ANGLE_DEFAULT, POINTLINE3D_RIGHT_ANGLE_MIN, POINTLINE3D_RIGHT_ANGLE_MAX);
  if (raR.error) return { ok: false, error: raR.error };
  const vsR = numeric('vertexSize', POINTLINE3D_VERTEX_SIZE_DEFAULT, POINTLINE3D_VERTEX_SIZE_MIN, POINTLINE3D_VERTEX_SIZE_MAX);
  if (vsR.error) return { ok: false, error: vsR.error };

  const extend = exR.value;
  const rightAngleSize = raR.value;
  const vertexSize = vsR.value;

  // ---- 布尔开关：出现即须布尔 ----
  const FLAGS = ['clampToSegment', 'asLine', 'asPerp', 'asRightAngle', 'asPoints', 'labelDistance', 'labelPoint', 'labelFoot', 'labelLine'];
  for (const flag of FLAGS) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }
  const clampToSegment = cmd.clampToSegment === true;
  const asLine = cmd.asLine === undefined ? true : cmd.asLine;
  const asPerp = cmd.asPerp === undefined ? true : cmd.asPerp;
  const asRightAngle = cmd.asRightAngle === undefined ? true : cmd.asRightAngle;
  const asPoints = cmd.asPoints === true;
  const labelDistance = cmd.labelDistance === undefined ? true : cmd.labelDistance;
  const labelPoint = cmd.labelPoint === true;
  const labelFoot = cmd.labelFoot === true;
  const labelLine = cmd.labelLine === true;
  if (!asLine && !asPerp && !asRightAngle && !asPoints && !labelDistance && !labelPoint && !labelFoot && !labelLine) {
    return { ok: false, error: '八个输出开关至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何核心 ----
  const core = pointlineCore(P, A, B, clampToSegment);
  if (!core.ok) return { ok: false, error: core.error };
  const { unit: eu, foot: H, distance, perpDir, binormal, clamped, onLine, lineLength, t } = core;

  // 直线两端延长（不改变方向）；点落线上或钳制到端点时省略直角符号。
  const lineStart = r4Vec([0, 1, 2].map((k) => A[k] - extend * eu[k]));
  const lineEnd = r4Vec([0, 1, 2].map((k) => B[k] + extend * eu[k]));
  const drawRightAngle = asRightAngle && !onLine && !clamped;
  const q1 = r4Vec([0, 1, 2].map((k) => H[k] + rightAngleSize * eu[k]));
  const q2 = r4Vec([0, 1, 2].map((k) => q1[k] + rightAngleSize * perpDir[k]));
  const q3 = r4Vec([0, 1, 2].map((k) => H[k] + rightAngleSize * perpDir[k]));

  // 距离读数放在垂线段中点旁（沿直线方向轻偏移避免压线）。
  const mid = r4Vec([0, 1, 2].map((k) => (P[k] + H[k]) / 2));
  const labelPos = r4Vec([0, 1, 2].map((k) => mid[k] + 0.15 * eu[k] + 0.05 * perpDir[k]));
  const labelText = `d=${distance}`;

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asLine ? 1 : 0) + (asPerp && !onLine ? 1 : 0) + (drawRightAngle ? 2 : 0);
  if (lineCount > POINTLINE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${POINTLINE3D_MAX_SEGMENTS}` };
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

  const mkLine = (id, p, q) => ({
    id,
    type: 'line',
    text: '',
    color: lineColor,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: p[0], y1: p[1], z1: p[2], x2: q[0], y2: q[1], z2: q[2] },
  });
  const mkPoint = (id, p) => ({
    id,
    type: 'point',
    text: '',
    color: lineColor,
    opacity: lineOpacity,
    pos: p.slice(),
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { s: vertexSize },
  });
  const mkLabel = (id, text, p) => ({
    id,
    type: 'label',
    text,
    color: labelColor,
    opacity: 1,
    pos: p.slice(),
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: {},
  });

  const items = [];

  // ---- 空间直线（可两端延长）----
  if (asLine) items.push(mkLine(nextId(`${stem}_line`.slice(0, 64)), lineStart, lineEnd));

  // ---- 垂线段 P→H（点落线上时退化为点，不画零长线段）----
  if (asPerp && !onLine) items.push(mkLine(nextId(`${stem}_perp`.slice(0, 64)), P, H));

  // ---- 直角符号（H 处，两边分别 ∥ eu 与 ∥ perp；仅未钳制且点不落线上）----
  if (drawRightAngle) {
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), q1, q2));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), q2, q3));
  }

  // ---- 可选：P / H / 直线端点小球 ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pP`.slice(0, 64)), P));
    items.push(mkPoint(nextId(`${stem}_pH`.slice(0, 64)), H));
    items.push(mkPoint(nextId(`${stem}_pA`.slice(0, 64)), A));
    items.push(mkPoint(nextId(`${stem}_pB`.slice(0, 64)), B));
  }

  // ---- 可选：距离读数 + P/H/A/B 名称标注 ----
  if (labelDistance) items.push(mkLabel(nextId(`${stem}_dist`.slice(0, 64)), labelText, labelPos));
  if (labelPoint) items.push(mkLabel(nextId(`${stem}_lp`.slice(0, 64)), 'P', P));
  if (labelFoot) items.push(mkLabel(nextId(`${stem}_lh`.slice(0, 64)), 'H', H));
  if (labelLine) {
    items.push(mkLabel(nextId(`${stem}_la`.slice(0, 64)), 'A', A));
    items.push(mkLabel(nextId(`${stem}_lb`.slice(0, 64)), 'B', B));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      point: P.slice(),
      from: A.slice(),
      to: B.slice(),
      unit: eu.slice(),
      lineLength,
      projection: t,
      clamped,
      onLine,
      foot: H.slice(),
      distance,
      perpDir: perpDir.slice(),
      binormal: binormal.slice(),
      clampToSegment,
      extend,
      lineEnds: [lineStart, lineEnd].map((p) => p.slice()),
      rightAngle: [q1, q2, q3].map((p) => p.slice()),
      rightAngleDrawn: drawRightAngle,
      rightAngleSize,
      labelText,
      labelPos,
      asLine,
      asPerp,
      asRightAngle,
      asPoints,
      labelDistance,
      labelPoint,
      labelFoot,
      labelLine,
      vertexSize,
      lineCount,
      perpCount: asPerp && !onLine ? 1 : 0,
      rightAngleCount: drawRightAngle ? 2 : 0,
      pointCount: asPoints ? 4 : 0,
      labelCount: (labelDistance ? 1 : 0) + (labelPoint ? 1 : 0) + (labelFoot ? 1 : 0) + (labelLine ? 2 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

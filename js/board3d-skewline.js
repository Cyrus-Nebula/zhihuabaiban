/**
 * 立体画板「两异面直线的公垂线与距离（skewline3d）」参数化生成命令的纯函数语义层（2026-11-25 D35 增量）
 *
 * 与 js/board3d-pointplane.js / -lineplane.js / -dihedral.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求两条异面直线的距离 / 作公垂线 / 标出两个垂足」这类意图，用一条命令生成标准作图：
 *   两条直线（可两端延长）+ 公垂线段 MN + M / N 处直角符号
 *   + 可选垂足小球 + 距离读数与 M/N 名称标注。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 量「两点距离 / 三点夹角 / 中点」，给不出两条空间直线的公垂线与距离；
 *   - pointplane3d 量点与平面距离；lineplane3d 量线面角；dihedral3d 量二面角；
 *   - vector3d 画一条有向线段；line 只画无向线段；都不处理两条直线的相对位置。
 *   - skewline3d 给「两条直线各两点」，自动求公垂线端点 M/N 与距离 d=|MN|，
 *     直接服务「异面直线距离 / 公垂线作图 / 标出垂足」核心用例。
 *
 * 几何定义（P1=from1、P2=from2，u=to1−from1、v=to2−from2，diff=P2−P1）：
 *   一般情形 w=u×v≠0（异面或相交）：
 *     a=|u|², b=u·v, c=|v|², d0=diff·u, e0=diff·v, Δ=a·c−b²=|w|²；
 *     t=(d0·c−e0·b)/Δ,  s=(t·b−e0)/c；
 *     M=P1+t·u（必在 L1 上）, N=P2+s·v（必在 L2 上）；
 *     N−M=(diff·w)/Δ·w ⟂ u 且 ⟂ v；d=|diff·w|/|w|=|N−M|；法向 n 取 M→N 方向（w 或 −w 的单位向量）。
 *   平行 / 共线情形 w≈0：
 *     s=(P1−P2)·v/|v|², N=P2+s·v（L2 上的垂足）, M=P1；d=|N−M|；
 *     d>0 时 n=(N−M)/d；共线 d=0 时退化，n 取任一垂直 u 的单位向量。
 *   相交情形 w≠0 且 d≈0：M=N=交点，公垂线段退化为点（合法，d=0）。
 *
 * 守恒：
 *   M 在 L1 上、N 在 L2 上；(N−M)·u=(N−M)·v=0；|n|=1；d=|N−M|；
 *   直角符号在 M 处的两边分别 ∥ u 与 ∥ n，在 N 处分别 ∥ v 与 ∥ −n，互相垂直。
 *   本命令只校验数值与点位合法，不强制直线与场景其它对象无交。
 */

/** 直线两端延长长度合法区间与默认 */
export const SKEWLINE3D_EXTEND_MIN = 0;
export const SKEWLINE3D_EXTEND_MAX = 1000;
export const SKEWLINE3D_EXTEND_DEFAULT = 0;

/** 直角符号边长合法区间与默认 */
export const SKEWLINE3D_RIGHT_ANGLE_MIN = 0.05;
export const SKEWLINE3D_RIGHT_ANGLE_MAX = 100;
export const SKEWLINE3D_RIGHT_ANGLE_DEFAULT = 0.25;

/** 小球半径合法区间与默认 */
export const SKEWLINE3D_VERTEX_SIZE_MIN = 0.01;
export const SKEWLINE3D_VERTEX_SIZE_MAX = 1;
export const SKEWLINE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const SKEWLINE3D_MAX_SEGMENTS = 4096;

/** 默认：L1 为 x 轴正向线段，L2 为过 (1,1,*) 的 z 向直线，公垂距 1（最小命令即出图） */
export const SKEWLINE3D_DEFAULT_FROM1 = Object.freeze([0, 0, 0]);
export const SKEWLINE3D_DEFAULT_TO1 = Object.freeze([2, 0, 0]);
export const SKEWLINE3D_DEFAULT_FROM2 = Object.freeze([1, 1, -1]);
export const SKEWLINE3D_DEFAULT_TO2 = Object.freeze([1, 1, 2]);

/** 坐标钳制上限（与 geometry / pointplane 一致） */
const COORD_LIMIT = 10000;
/** 方向向量退化阈值 */
const DIR_EPS = 1e-9;

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

/** 垂直 u 的任一单位向量（共线退化时用） */
function perpendicular(u) {
  const helper = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(u, helper)) || unit(cross3(u, [1, 0, 0]));
}

/**
 * 纯几何核心：求两直线的公垂线端点、单位方向与距离（只读入参）。
 *
 * @param {Array} from1 L1 上一点 [x,y,z]
 * @param {Array} to1   L1 上另一点 [x,y,z]（与 from1 不同）
 * @param {Array} from2 L2 上一点 [x,y,z]
 * @param {Array} to2   L2 上另一点 [x,y,z]（与 from2 不同）
 * @returns {{ok:true, q1:Array, q2:Array, n:Array, distance:number, kind:string, t:number, s:number,
 *            u:Array, v:Array} | {ok:false, error:string}}
 */
export function skewlineCommonPerpendicular(from1, to1, from2, to2) {
  const p1 = parsePoint3(from1);
  const p1b = parsePoint3(to1);
  const p2 = parsePoint3(from2);
  const p2b = parsePoint3(to2);
  if (!p1 || !p1b || !p2 || !p2b) return { ok: false, error: 'from1/to1/from2/to2 需为合法 [x,y,z]' };
  const u = sub3(p1b, p1);
  const v = sub3(p2b, p2);
  if (len3(u) < DIR_EPS || len3(v) < DIR_EPS) return { ok: false, error: '两条直线的方向点不能与起点重合' };

  const diff = sub3(p2, p1);
  const w = cross3(u, v);
  const wLen = len3(w);

  let t;
  let s;
  let n;
  let kind;

  if (wLen > DIR_EPS) {
    const a = dot3(u, u);
    const b = dot3(u, v);
    const c = dot3(v, v);
    const delta = a * c - b * b; // = |w|²
    const d0 = dot3(diff, u);
    const e0 = dot3(diff, v);
    t = (d0 * c - e0 * b) / delta;
    s = (t * b - e0) / c;
    const distRaw = dot3(diff, w) / wLen;
    // n 统一取 M→N 方向（distRaw<0 时翻转 w），直角符号才落在两线与公垂线之间。
    const sign = distRaw >= 0 ? 1 : -1;
    n = [sign * w[0] / wLen, sign * w[1] / wLen, sign * w[2] / wLen];
    kind = Math.abs(distRaw) < 1e-6 ? 'intersect' : 'skew';
  } else {
    // 平行 / 共线：从 P1 向 L2 作垂线，垂足 N；M=P1。
    const c = dot3(v, v);
    s = -dot3(diff, v) / c;
    t = 0;
    const q1raw = p1;
    const q2raw = [p2[0] + s * v[0], p2[1] + s * v[1], p2[2] + s * v[2]];
    const deltaVec = sub3(q2raw, q1raw);
    const distRaw = len3(deltaVec);
    n = distRaw > DIR_EPS ? [deltaVec[0] / distRaw, deltaVec[1] / distRaw, deltaVec[2] / distRaw] : perpendicular(u);
    kind = distRaw < 1e-6 ? 'collinear' : 'parallel';
  }

  const q1 = r4Vec([p1[0] + t * u[0], p1[1] + t * u[1], p1[2] + t * u[2]]);
  const q2 = r4Vec([p2[0] + s * v[0], p2[1] + s * v[1], p2[2] + s * v[2]]);
  const distance = r4(clamp(len3(sub3(q2, q1))));
  return {
    ok: true,
    q1,
    q2,
    n: r4Vec(n),
    distance,
    kind,
    t,
    s,
    u: r4Vec(u),
    v: r4Vec(v),
  };
}

/**
 * 解析一条 skewline3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"skewline3d","id":"skl","from1":[0,0,0],"to1":[2,0,0],"from2":[1,1,-1],"to2":[1,1,2],
 *    "extend":0,"rightAngleSize":0.25,"asLines":true,"asCommon":true,"asPoints":false,
 *    "asRightAngle":true,"labelDistance":true,"labelFeet":false,"vertexSize":0.1,"color":"#4f6bed"}
 *   - from1/to1/from2/to2：两条直线各两点（默认一组公垂距为 1 的异面直线）；
 *   - extend：两端延长长度（默认 0，0~1000）；
 *   - rightAngleSize：直角符号边长（默认 0.25，0.05~100）；
 *   - asLines：是否画两条直线段（默认 true）；
 *   - asCommon：是否画公垂线段 MN（默认 true）；
 *   - asRightAngle：是否在 M / N 画直角符号（默认 true）；
 *   - asPoints：是否在 M / N 放小球（默认 false）；
 *   - labelDistance：是否标注距离读数（默认 true）；labelFeet：是否标注 M / N（默认 false）；
 *   - vertexSize / color / labelColor / opacity：样式。六个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSkewline3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'skl' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 两条直线的四个点 ----
  const from1 = parsePoint3(cmd.from1 === undefined ? SKEWLINE3D_DEFAULT_FROM1 : cmd.from1);
  const to1 = parsePoint3(cmd.to1 === undefined ? SKEWLINE3D_DEFAULT_TO1 : cmd.to1);
  const from2 = parsePoint3(cmd.from2 === undefined ? SKEWLINE3D_DEFAULT_FROM2 : cmd.from2);
  const to2 = parsePoint3(cmd.to2 === undefined ? SKEWLINE3D_DEFAULT_TO2 : cmd.to2);
  if (!from1 || !to1 || !from2 || !to2) {
    return { ok: false, error: 'from1/to1/from2/to2 需为合法 [x,y,z]' };
  }

  // ---- extend / rightAngleSize / vertexSize：出现即校验 ----
  const exRaw = cmd.extend === undefined ? SKEWLINE3D_EXTEND_DEFAULT : num(cmd.extend);
  if (exRaw === null) return { ok: false, error: 'extend 必须是数字' };
  if (exRaw < SKEWLINE3D_EXTEND_MIN || exRaw > SKEWLINE3D_EXTEND_MAX) {
    return { ok: false, error: `extend 需为 ${SKEWLINE3D_EXTEND_MIN}~${SKEWLINE3D_EXTEND_MAX}` };
  }
  const extend = r4(exRaw);

  const raRaw = cmd.rightAngleSize === undefined ? SKEWLINE3D_RIGHT_ANGLE_DEFAULT : num(cmd.rightAngleSize);
  if (raRaw === null) return { ok: false, error: 'rightAngleSize 必须是数字' };
  if (raRaw < SKEWLINE3D_RIGHT_ANGLE_MIN || raRaw > SKEWLINE3D_RIGHT_ANGLE_MAX) {
    return { ok: false, error: `rightAngleSize 需为 ${SKEWLINE3D_RIGHT_ANGLE_MIN}~${SKEWLINE3D_RIGHT_ANGLE_MAX}` };
  }
  const rightAngleSize = r4(raRaw);

  const vsRaw = cmd.vertexSize === undefined ? SKEWLINE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SKEWLINE3D_VERTEX_SIZE_MIN || vsRaw > SKEWLINE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SKEWLINE3D_VERTEX_SIZE_MIN}~${SKEWLINE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 输出开关：出现即须布尔 ----
  const FLAGS = ['asLines', 'asCommon', 'asPoints', 'asRightAngle', 'labelDistance', 'labelFeet'];
  for (const flag of FLAGS) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  const asLines = cmd.asLines === undefined ? true : cmd.asLines;
  const asCommon = cmd.asCommon === undefined ? true : cmd.asCommon;
  const asRightAngle = cmd.asRightAngle === undefined ? true : cmd.asRightAngle;
  const asPoints = cmd.asPoints === true;
  const labelDistance = cmd.labelDistance === undefined ? true : cmd.labelDistance;
  const labelFeet = cmd.labelFeet === true;
  if (!asLines && !asCommon && !asRightAngle && !asPoints && !labelDistance && !labelFeet) {
    return { ok: false, error: '六个输出开关至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何核心 ----
  const core = skewlineCommonPerpendicular(from1, to1, from2, to2);
  if (!core.ok) return { ok: false, error: core.error };
  const { q1, q2, n, distance, kind } = core;
  const u = unit(core.u);
  const v = unit(core.v);
  if (!u || !v) return { ok: false, error: '无法求两直线单位方向' };

  const add = (p, q, k) => [p[0] + k * q[0], p[1] + k * q[1], p[2] + k * q[2]];
  const line1Start = r4Vec(add(from1, u, -extend));
  const line1End = r4Vec(add(to1, u, extend));
  const line2Start = r4Vec(add(from2, v, -extend));
  const line2End = r4Vec(add(to2, v, extend));

  // 直角符号：M 处两边 ∥ u 与 ∥ n；N 处两边 ∥ v 与 ∥ −n。
  const m1 = r4Vec(add(q1, u, rightAngleSize));
  const m2 = r4Vec(add(m1, n, rightAngleSize));
  const m3 = r4Vec(add(q1, n, rightAngleSize));
  const negN = [-n[0], -n[1], -n[2]];
  const n1 = r4Vec(add(q2, v, rightAngleSize));
  const n2 = r4Vec(add(n1, negN, rightAngleSize));
  const n3 = r4Vec(add(q2, negN, rightAngleSize));

  // 距离读数放在公垂线段中点旁，沿 u 轻偏移避免压线
  const mid = r4Vec([0, 1, 2].map((k) => (q1[k] + q2[k]) / 2));
  const labelPos = r4Vec(add(mid, u, 0.15));
  const labelText = `d=${distance}`;

  // ---- 预估段数，超上限原子拒绝 ----
  const lineCount = (asLines ? 2 : 0) + (asCommon ? 1 : 0) + (asRightAngle ? 4 : 0);
  if (lineCount > SKEWLINE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SKEWLINE3D_MAX_SEGMENTS}` };
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

  // ---- 两条直线（可两端延长）----
  if (asLines) {
    items.push(mkLine(nextId(`${stem}_l1`.slice(0, 64)), line1Start, line1End));
    items.push(mkLine(nextId(`${stem}_l2`.slice(0, 64)), line2Start, line2End));
  }

  // ---- 公垂线段 M→N ----
  if (asCommon) items.push(mkLine(nextId(`${stem}_com`.slice(0, 64)), q1, q2));

  // ---- M / N 处直角符号（各两段）----
  if (asRightAngle) {
    items.push(mkLine(nextId(`${stem}_rm1`.slice(0, 64)), q1, m1));
    items.push(mkLine(nextId(`${stem}_rm2`.slice(0, 64)), m1, m2));
    items.push(mkLine(nextId(`${stem}_rn1`.slice(0, 64)), q2, n1));
    items.push(mkLine(nextId(`${stem}_rn2`.slice(0, 64)), n1, n2));
  }

  // ---- 可选：M / N 小球 ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pM`.slice(0, 64)), q1));
    items.push(mkPoint(nextId(`${stem}_pN`.slice(0, 64)), q2));
  }

  // ---- 可选：距离读数 + M/N 名称标注 ----
  if (labelDistance) items.push(mkLabel(nextId(`${stem}_dist`.slice(0, 64)), labelText, labelPos));
  if (labelFeet) {
    items.push(mkLabel(nextId(`${stem}_lM`.slice(0, 64)), 'M', q1));
    items.push(mkLabel(nextId(`${stem}_lN`.slice(0, 64)), 'N', q2));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      from1: from1.slice(), to1: to1.slice(), from2: from2.slice(), to2: to2.slice(),
      u: u.slice(), v: v.slice(),
      unitU: u.slice(), unitV: v.slice(), normal: n.slice(),
      q1: q1.slice(), q2: q2.slice(),
      footM: q1.slice(), footN: q2.slice(),
      distance,
      kind,
      paramT: r4(core.t),
      paramS: r4(core.s),
      extend,
      rightAngleSize,
      rightAngleM: [q1, m1, m2].map((p) => p.slice()),
      rightAngleN: [q2, n1, n2].map((p) => p.slice()),
      lineEnds: [line1Start, line1End, line2Start, line2End].map((p) => p.slice()),
      labelText,
      labelPos,
      asLines,
      asCommon,
      asPoints,
      asRightAngle,
      labelDistance,
      labelFeet,
      vertexSize,
      lineCount: lineCount,
      commonCount: asCommon ? 1 : 0,
      rightAngleCount: asRightAngle ? 4 : 0,
      pointCount: asPoints ? 2 : 0,
      labelCount: (labelDistance ? 1 : 0) + (labelFeet ? 2 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

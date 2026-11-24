/**
 * 立体画板「两空间直线夹角（lineangle3d）」参数化生成命令的纯函数语义层（2026-11-25 D36 增量）
 *
 * 与 js/board3d-skewline.js / -pointplane.js / -lineplane.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求两条空间直线的夹角 / 异面直线所成角 / 作线线角平面角」这类意图，用一条命令生成标准作图：
 *   两条直线 + 过顶点 O 且平行于 L2 的辅助线 + 两条夹角射线 + 圆弧 + 角度读数
 *   + 可选 O 处直角符号（仅 θ=90°）+ 顶点小球 / 顶点标注。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 量「三点夹角」，需要两条线段共顶点，量不了两条异面直线的方向夹角；
 *   - skewline3d 量两线距离与公垂线；lineplane3d 量线面角；dihedral3d 量二面角；pointplane3d 量点面距；
 *   - lineangle3d 只给两条直线各两点，自动取锐角/直角约定 θ∈[0°,90°]，相交线取真实交点 O、
 *     异面线把 L2 方向平移到 L1 上的点 O，直接服务「异面直线夹角 / 线线角 / 正方体棱与面对角线夹角」核心用例。
 *
 * 几何定义（P1=from1、P2=from2，u=to1−from1、v=to2−from2，diff=P2−P1）：
 *   eu=u/|u|，ev=v/|v|；取 copyDir = ev 或 −ev 使 eu·copyDir ≥ 0（锐角约定）；
 *   θ=arccos(eu·copyDir) ∈ [0, π/2]；planeNormal=unit(eu×copyDir)（平行时取 eu 的任一垂向），
 *   arcBasis=unit(planeNormal×eu) 是弧平面内从 eu 转向 copyDir 的正交基；
 *   相交时（Δ=|u|²|v|²−(u·v)² 足够大且两线距离≈0）O=P1+t·u，t=((diff·u)|v|²−(diff·v)(u·v))/Δ；
 *   异面 / 平行时 O=P1（在 L1 上，辅助线过 O 且平行 L2）；
 *   弧点 P_i=O+arcRadius·(cos φ_i·eu + sin φ_i·arcNormal)，φ_i=θ·i/segments。
 *
 * 守恒：|eu|=|ev|=|copyDir|=|arcNormal|=1；eu·copyDir=cosθ≥0；O 恒在 L1 上，相交时 O 也在 L2 上；
 *   辅助线方向 copyDir 与 L2 平行（同向或反向）；|P_i−O|=arcRadius；弧首沿 eu、弧末沿 copyDir；
 *   两射线端点距 O 均为 rayLength；θ=90° 时直角符号两边互相垂直。
 */

/** 直线两端延长长度合法区间与默认 */
export const LINEANGLE3D_EXTEND_MIN = 0;
export const LINEANGLE3D_EXTEND_MAX = 1000;
export const LINEANGLE3D_EXTEND_DEFAULT = 0;

/** 夹角射线长度合法区间与默认 */
export const LINEANGLE3D_RAY_LENGTH_MIN = 0.05;
export const LINEANGLE3D_RAY_LENGTH_MAX = 100;
export const LINEANGLE3D_RAY_LENGTH_DEFAULT = 1;

/** 圆弧半径合法区间与默认（超过 rayLength 自动钳制） */
export const LINEANGLE3D_ARC_RADIUS_MIN = 0.05;
export const LINEANGLE3D_ARC_RADIUS_MAX = 100;
export const LINEANGLE3D_ARC_RADIUS_DEFAULT = 0.5;

/** 圆弧分段数合法区间与默认 */
export const LINEANGLE3D_SEGMENTS_MIN = 3;
export const LINEANGLE3D_SEGMENTS_MAX = 64;
export const LINEANGLE3D_SEGMENTS_DEFAULT = 24;

/** 直角符号边长合法区间与默认 */
export const LINEANGLE3D_RIGHT_ANGLE_MIN = 0.05;
export const LINEANGLE3D_RIGHT_ANGLE_MAX = 100;
export const LINEANGLE3D_RIGHT_ANGLE_DEFAULT = 0.25;

/** 顶点小球半径合法区间与默认 */
export const LINEANGLE3D_VERTEX_SIZE_MIN = 0.01;
export const LINEANGLE3D_VERTEX_SIZE_MAX = 1;
export const LINEANGLE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const LINEANGLE3D_MAX_SEGMENTS = 4096;

/** 默认：x 轴与过原点的 45° 斜线相交，默认夹角 45° */
export const LINEANGLE3D_DEFAULT_FROM1 = Object.freeze([0, 0, 0]);
export const LINEANGLE3D_DEFAULT_TO1 = Object.freeze([2, 0, 0]);
export const LINEANGLE3D_DEFAULT_FROM2 = Object.freeze([0, 0, 0]);
export const LINEANGLE3D_DEFAULT_TO2 = Object.freeze([1, 1, 0]);

/** 坐标钳制上限（与 geometry / skewline 一致） */
const COORD_LIMIT = 10000;
/** 方向向量退化阈值 */
const DIR_EPS = 1e-9;
/** 判定相交 / 直角的数值阈值 */
const ZERO_EPS = 1e-6;

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
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
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

/** 垂直 u 的任一单位向量（平行线退化时用） */
function perpendicular(u) {
  const helper = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(u, helper)) || unit(cross3(u, [1, 0, 0]));
}

/**
 * 纯几何核心：求两直线的锐角/直角夹角、顶点 O、夹角平面法向与两线位置关系（只读入参）。
 *
 * @returns {{ok:true, origin:Array, unitU:Array, unitV:Array, copyDir:Array,
 *            arcNormal:Array, angle:number, angleDeg:number, kind:string,
 *            intersects:boolean, flipped:boolean, rawU:Array, rawV:Array}
 *           | {ok:false, error:string}}
 */
export function lineangleCore(from1, to1, from2, to2) {
  const p1 = parsePoint3(from1);
  const p1b = parsePoint3(to1);
  const p2 = parsePoint3(from2);
  const p2b = parsePoint3(to2);
  if (!p1 || !p1b || !p2 || !p2b) return { ok: false, error: 'from1/to1/from2/to2 需为合法 [x,y,z]' };

  const u = sub3(p1b, p1);
  const v = sub3(p2b, p2);
  if (len3(u) < DIR_EPS || len3(v) < DIR_EPS) return { ok: false, error: '两条直线的方向点不能与起点重合' };

  const eu = unit(u);
  const ev = unit(v);
  const cosRaw = Math.min(1, Math.max(-1, dot3(eu, ev)));
  const flipped = cosRaw < 0;
  const copyDir = flipped ? scale3(ev, -1) : ev.slice();
  const cos = flipped ? -cosRaw : cosRaw;
  const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
  const angleDeg = r4(angle * 180 / Math.PI);

  const crossRaw = cross3(eu, ev);
  // planeNormal 是夹角所在平面的法向；arcBasis 是该平面内、从 eu 转向 copyDir 的正交基。
  const planeNormal = len3(crossRaw) > DIR_EPS
    ? unit(cross3(eu, copyDir))
    : perpendicular(eu);
  if (!planeNormal) return { ok: false, error: '无法构造夹角平面法向' };
  const arcBasis = unit(cross3(planeNormal, eu));
  if (!arcBasis) return { ok: false, error: '无法构造弧采样正交基' };

  const diff = sub3(p2, p1);
  const a = dot3(u, u);
  const b = dot3(u, v);
  const c = dot3(v, v);
  const delta = a * c - b * b;
  const parallel = delta <= DIR_EPS * DIR_EPS;

  let t = 0;
  if (!parallel) {
    const d0 = dot3(diff, u);
    const e0 = dot3(diff, v);
    t = (d0 * c - e0 * b) / delta;
  }
  const origin = r4Vec([p1[0] + t * u[0], p1[1] + t * u[1], p1[2] + t * u[2]]);
  // 相交判定要在 O（两线最近点）处量距离，不能从 from1 量，否则相交线在 from1 不落 L2 上会误判异面。
  const separation = len3(cross3(sub3(p2, parallel ? p1 : origin), ev));
  const intersects = !parallel && separation < ZERO_EPS;
  const kind = parallel ? (separation < ZERO_EPS ? 'collinear' : 'parallel') : (intersects ? 'intersect' : 'skew');

  return {
    ok: true,
    origin,
    unitU: eu.slice(),
    unitV: ev.slice(),
    copyDir: r4Vec(copyDir),
    planeNormal: r4Vec(planeNormal),
    arcBasis: r4Vec(arcBasis),
    arcNormal: r4Vec(planeNormal),
    angle: r4(angle),
    angleDeg,
    kind,
    intersects,
    flipped,
    rawU: u.slice(),
    rawV: v.slice(),
  };
}

/**
 * 解析一条 lineangle3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"lineangle3d","id":"lang","from1":[0,0,0],"to1":[2,0,0],"from2":[0,0,0],"to2":[1,1,0],
 *    "extend":0,"rayLength":1,"arcRadius":0.5,"segments":24,"rightAngleSize":0.25,
 *    "asLines":true,"asCopy":true,"asRays":true,"asArc":true,"asRightAngle":true,"asPoints":false,
 *    "labelAngle":true,"labelVertex":false,"vertexSize":0.1}
 *   - from1/to1/from2/to2：两条直线各两点（默认一组相交 45° 直线）；
 *   - extend：两条直线两端延长长度（默认 0，0~1000）；
 *   - rayLength：夹角射线长度（默认 1，0.05~100）；arcRadius：弧半径（默认 0.5，超过 rayLength 自动钳制）；
 *   - segments：圆弧分段数（默认 24，3~64）；rightAngleSize：直角符号边长（仅 θ=90° 画出，默认 0.25）；
 *   - asLines / asCopy / asRays / asArc / asRightAngle / asPoints / labelAngle / labelVertex：输出开关，至少开一个。
 *   - vertexSize / color / labelColor / opacity：样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveLineangle3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'lang' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 两条直线的四个点 ----
  const from1 = parsePoint3(cmd.from1 === undefined ? LINEANGLE3D_DEFAULT_FROM1 : cmd.from1);
  const to1 = parsePoint3(cmd.to1 === undefined ? LINEANGLE3D_DEFAULT_TO1 : cmd.to1);
  const from2 = parsePoint3(cmd.from2 === undefined ? LINEANGLE3D_DEFAULT_FROM2 : cmd.from2);
  const to2 = parsePoint3(cmd.to2 === undefined ? LINEANGLE3D_DEFAULT_TO2 : cmd.to2);
  if (!from1 || !to1 || !from2 || !to2) {
    return { ok: false, error: 'from1/to1/from2/to2 需为合法 [x,y,z]' };
  }

  // ---- 数值参数：出现即校验 ----
  const numeric = (key, def, min, max, integer) => {
    const raw = cmd[key] === undefined ? def : num(cmd[key]);
    if (raw === null) return { error: `${key} 必须是数字` };
    if (raw < min || raw > max || (integer && !Number.isInteger(raw))) {
      return { error: integer ? `${key} 需为 ${min}~${max} 的整数` : `${key} 需为 ${min}~${max}` };
    }
    return { value: r4(raw) };
  };
  const extendR = numeric('extend', LINEANGLE3D_EXTEND_DEFAULT, LINEANGLE3D_EXTEND_MIN, LINEANGLE3D_EXTEND_MAX, false);
  if (extendR.error) return { ok: false, error: extendR.error };
  const rayR = numeric('rayLength', LINEANGLE3D_RAY_LENGTH_DEFAULT, LINEANGLE3D_RAY_LENGTH_MIN, LINEANGLE3D_RAY_LENGTH_MAX, false);
  if (rayR.error) return { ok: false, error: rayR.error };
  const arcR = numeric('arcRadius', LINEANGLE3D_ARC_RADIUS_DEFAULT, LINEANGLE3D_ARC_RADIUS_MIN, LINEANGLE3D_ARC_RADIUS_MAX, false);
  if (arcR.error) return { ok: false, error: arcR.error };
  const segR = numeric('segments', LINEANGLE3D_SEGMENTS_DEFAULT, LINEANGLE3D_SEGMENTS_MIN, LINEANGLE3D_SEGMENTS_MAX, true);
  if (segR.error) return { ok: false, error: segR.error };
  const raR = numeric('rightAngleSize', LINEANGLE3D_RIGHT_ANGLE_DEFAULT, LINEANGLE3D_RIGHT_ANGLE_MIN, LINEANGLE3D_RIGHT_ANGLE_MAX, false);
  if (raR.error) return { ok: false, error: raR.error };
  const vsR = numeric('vertexSize', LINEANGLE3D_VERTEX_SIZE_DEFAULT, LINEANGLE3D_VERTEX_SIZE_MIN, LINEANGLE3D_VERTEX_SIZE_MAX, false);
  if (vsR.error) return { ok: false, error: vsR.error };

  const extend = extendR.value;
  const rayLength = rayR.value;
  const arcRadius = Math.min(arcR.value, rayLength);
  const segments = segR.value;
  const rightAngleSize = raR.value;
  const vertexSize = vsR.value;

  // ---- 输出开关：出现即须布尔 ----
  const FLAGS = ['asLines', 'asCopy', 'asRays', 'asArc', 'asRightAngle', 'asPoints', 'labelAngle', 'labelVertex'];
  for (const flag of FLAGS) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }
  const asLines = cmd.asLines === undefined ? true : cmd.asLines;
  const asCopy = cmd.asCopy === undefined ? true : cmd.asCopy;
  const asRays = cmd.asRays === undefined ? true : cmd.asRays;
  const asArc = cmd.asArc === undefined ? true : cmd.asArc;
  const asRightAngle = cmd.asRightAngle === undefined ? true : cmd.asRightAngle;
  const asPoints = cmd.asPoints === true;
  const labelAngle = cmd.labelAngle === undefined ? true : cmd.labelAngle;
  const labelVertex = cmd.labelVertex === true;
  if (!asLines && !asCopy && !asRays && !asArc && !asRightAngle && !asPoints && !labelAngle && !labelVertex) {
    return { ok: false, error: '八个输出开关至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何核心 ----
  const core = lineangleCore(from1, to1, from2, to2);
  if (!core.ok) return { ok: false, error: core.error };
  const { origin, unitU, unitV, copyDir, planeNormal, arcBasis, angle, angleDeg, kind, intersects, flipped } = core;

  const add = (p, q, k) => [p[0] + k * q[0], p[1] + k * q[1], p[2] + k * q[2]];
  const line1Start = r4Vec(add(from1, unitU, -extend));
  const line1End = r4Vec(add(to1, unitU, extend));
  const line2Start = r4Vec(add(from2, unitV, -extend));
  const line2End = r4Vec(add(to2, unitV, extend));
  const copyStart = r4Vec(add(origin, copyDir, -rayLength));
  const copyEnd = r4Vec(add(origin, copyDir, rayLength));
  const rayUEnd = r4Vec(add(origin, unitU, rayLength));
  const rayVEnd = r4Vec(add(origin, copyDir, rayLength));

  // 弧点：φ=θ·i/segments，首点沿 eu，末点沿 copyDir，恒距 O 为 arcRadius。
  const arcPoints = [];
  for (let i = 0; i <= segments; i++) {
    const phi = angle * i / segments;
    const radial = [
      Math.cos(phi) * unitU[0] + Math.sin(phi) * arcBasis[0],
      Math.cos(phi) * unitU[1] + Math.sin(phi) * arcBasis[1],
      Math.cos(phi) * unitU[2] + Math.sin(phi) * arcBasis[2],
    ];
    arcPoints.push(r4Vec(add(origin, radial, arcRadius)));
  }
  const isRightAngle = Math.abs(angleDeg - 90) < 1e-3;
  const drawArc = asArc && angleDeg > 1e-6;
  const drawRightAngle = asRightAngle && isRightAngle;

  // 直角符号（仅 90°）：两边分别 ∥ eu 与 ∥ copyDir。
  const ra1 = r4Vec(add(origin, unitU, rightAngleSize));
  const ra2 = r4Vec(add(ra1, copyDir, rightAngleSize));
  const ra3 = r4Vec(add(origin, copyDir, rightAngleSize));

  // 角度读数放在两条射线之间、弧外侧，避免压线。
  const bisector = unit(add3(unitU, copyDir)) || unitU;
  const labelPos = r4Vec(add(origin, bisector, arcRadius + 0.15));
  const labelText = `θ=${angleDeg}°`;

  // ---- 预估段数，超上限原子拒绝 ----
  const lineCount = (asLines ? 2 : 0) + (asCopy ? 1 : 0) + (asRays ? 2 : 0)
    + (drawArc ? segments : 0) + (drawRightAngle ? 2 : 0);
  if (lineCount > LINEANGLE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${LINEANGLE3D_MAX_SEGMENTS}` };
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

  // ---- 两条原直线（可两端延长）----
  if (asLines) {
    items.push(mkLine(nextId(`${stem}_l1`.slice(0, 64)), line1Start, line1End));
    items.push(mkLine(nextId(`${stem}_l2`.slice(0, 64)), line2Start, line2End));
  }

  // ---- 过 O 且平行于 L2 的辅助线 ----
  if (asCopy) items.push(mkLine(nextId(`${stem}_copy`.slice(0, 64)), copyStart, copyEnd));

  // ---- 夹角两条射线 O→U / O→V ----
  if (asRays) {
    items.push(mkLine(nextId(`${stem}_ray1`.slice(0, 64)), origin, rayUEnd));
    items.push(mkLine(nextId(`${stem}_ray2`.slice(0, 64)), origin, rayVEnd));
  }

  // ---- 圆弧（θ=0 时退化为点，不画弧）----
  if (drawArc) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_arc${i}`.slice(0, 64)), arcPoints[i], arcPoints[i + 1]));
    }
  }

  // ---- 直角符号（仅 θ=90°）----
  if (drawRightAngle) {
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), origin, ra1));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), ra1, ra2));
  }

  // ---- 可选：顶点小球 ----
  if (asPoints) items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), origin));

  // ---- 可选：角度读数与顶点名称 ----
  if (labelAngle) items.push(mkLabel(nextId(`${stem}_angle`.slice(0, 64)), labelText, labelPos));
  if (labelVertex) items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', origin));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      from1: from1.slice(), to1: to1.slice(), from2: from2.slice(), to2: to2.slice(),
      origin: origin.slice(),
      unitU: unitU.slice(), unitV: unitV.slice(),
      copyDir: copyDir.slice(), flipped,
      arcNormal: planeNormal.slice(), arcBasis: arcBasis.slice(),
      angle, angleDeg, isRightAngle, kind, intersects,
      extend, rayLength, arcRadius, arcRadiusInput: arcR.value,
      rightAngleSize, segments, vertexSize,
      arcPoints: arcPoints.map((p) => p.slice()),
      arcCount: drawArc ? segments : 0,
      rayEnds: [rayUEnd, rayVEnd].map((p) => p.slice()),
      copyEnds: [copyStart, copyEnd].map((p) => p.slice()),
      lineEnds: [line1Start, line1End, line2Start, line2End].map((p) => p.slice()),
      rightAngle: [origin, ra1, ra2, ra3].map((p) => p.slice()),
      rightAngleDrawn: drawRightAngle,
      labelText, labelPos,
      asLines, asCopy, asRays, asArc, asRightAngle, asPoints, labelAngle, labelVertex,
      lineCount,
      copyCount: asCopy ? 1 : 0,
      rayCount: asRays ? 2 : 0,
      rightAngleCount: drawRightAngle ? 2 : 0,
      pointCount: asPoints ? 1 : 0,
      labelCount: (labelAngle ? 1 : 0) + (labelVertex ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「点到平面的距离（pointplane3d）」参数化生成命令的纯函数语义层（2026-11-24 D34 增量）
 *
 * 与 js/board3d-lineplane.js / -dihedral.js / -plane.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「求点到平面的距离 / 从点向平面作垂线」这类意图，用一条命令生成标准作图：
 *   平面面片（可选）+ 垂线段 PH（P 为给定点、H 为 P 在平面内的正投影）+ 直角符号
 *   + 可选法向量杆 + P/H 小球 + 距离读数。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 量「两点距离 / 三点夹角 / 中点」，但给不出「点与平面的距离」与垂足作图；
 *   - plane3d 只画单个平面面片；lineplane3d 画的是直线与平面的夹角；dihedral3d 画两半平面的二面角；
 *   - pointplane3d 给「点 P + 平面（三点 points 或 center+axis）」，自动求垂足 H 与距离 d=|PH|，
 *     直接服务「点到平面距离 / 作垂线 / 正方体中顶点到底面距离 / 标注垂足」核心用例。
 *
 * 几何定义：
 *   nh   = normalize((points[1]−points[0]) × (points[2]−points[0]))       （平面单位法向，或由 center+axis 给定）；
 *   s    = (P − planePts[0])·nh                                          （带符号距离）；
 *   H    = P − s·nh                                                      （垂足：P 在平面内的正投影）；
 *   d    = |s|                                                           （点到平面距离）；
 *   sign = s>=0 ? 1 : -1                                                 （P 所在侧，决定法向杆 / 直角符号朝向）；
 *   e1   = planeBasis(nh)，e2 = nh × e1                                  （平面内正交单位标架）。
 *   平面面片四角 = H ± (width/2)·e1 ± (height/2)·e2（以垂足为中心，保证 H 落在面片中央）。
 *   直角符号三段：H + a·e1 → H + a·e1 + a·sign·nh → H + a·sign·nh（a=rightAngleSize，两边分别 ∥ e1 与 ∥ nh）。
 * 守恒：
 *   |nh|=|e1|=|e2|=1；nh·e1=nh·e2=0；H 恒在平面内（(H−planePts[0])·nh=0）；
 *   PH ∥ nh 且 PH ⊥ 平面；|PH|=d；四角恒共面且垂直法向；直角符号两边互相垂直。
 *   本命令只校验数值与点位合法，不强制面片与场景其它对象无交。
 */

/** 平面面片宽 / 高合法区间与默认 */
export const POINTPLANE3D_PLANE_SIZE_MIN = 0.01;
export const POINTPLANE3D_PLANE_SIZE_MAX = 10000;
export const POINTPLANE3D_PLANE_WIDTH_DEFAULT = 2;
export const POINTPLANE3D_PLANE_HEIGHT_DEFAULT = 2;

/** 小球半径（与其余 3D 命令同口径） */
export const POINTPLANE3D_VERTEX_SIZE_MIN = 0.01;
export const POINTPLANE3D_VERTEX_SIZE_MAX = 1;
export const POINTPLANE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 直角符号边长合法区间与默认 */
export const POINTPLANE3D_RIGHT_ANGLE_MIN = 0.05;
export const POINTPLANE3D_RIGHT_ANGLE_MAX = 100;
export const POINTPLANE3D_RIGHT_ANGLE_DEFAULT = 0.25;

/** 法向量杆长度合法区间与默认 */
export const POINTPLANE3D_NORMAL_LENGTH_MIN = 0.01;
export const POINTPLANE3D_NORMAL_LENGTH_MAX = 10000;
export const POINTPLANE3D_NORMAL_LENGTH_DEFAULT = 0.5;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const POINTPLANE3D_MAX_SEGMENTS = 4096;

/** 默认点 P [0,0,1] / 默认平面三点（xy 面）：距离 1，便于最小命令出图 */
export const POINTPLANE3D_DEFAULT_POINT = Object.freeze([0, 0, 1]);
export const POINTPLANE3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([-1, -1, 0]), Object.freeze([1, -1, 0]), Object.freeze([0, 1, 0]),
]);

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
const unit = (a) => {
  const m = len3(a);
  return m > 1e-9 ? r4Vec([a[0] / m, a[1] / m, a[2] / m]) : null;
};

/** 解析平面：points 三点定面；或 center + axis（axis 为法向轴）构造面内两点 */
function parsePlane(cmd) {
  let pts;
  if (cmd.points !== undefined) {
    if (!Array.isArray(cmd.points) || cmd.points.length !== 3) return null;
    pts = cmd.points.map(parsePoint3);
  } else {
    const c = parsePoint3(cmd.center);
    if (!c) return null;
    const axis = parsePoint3(cmd.axis);
    if (!axis || len3(axis) < 1e-9) return null;
    const helper = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const e1 = unit(cross3(axis, helper));
    if (!e1) return null;
    const e2 = unit(cross3(axis, e1));
    if (!e2) return null;
    pts = [c, r4Vec([c[0] + e1[0], c[1] + e1[1], c[2] + e1[2]]), r4Vec([c[0] + e2[0], c[1] + e2[1], c[2] + e2[2]])];
  }
  if (pts.some((p) => p === null)) return null;
  return pts;
}

/** 平面单位法向 nh = normalize((p1−p0)×(p2−p0))。纯函数、只读入参。 */
export function pointplanePlaneNormal(points) {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  return unit(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
}

/** 垂足 H = P − ((P−planePts[0])·nh)·nh。纯函数、只读入参。 */
export function pointplaneFoot(point, points) {
  const q = parsePoint3(point);
  const p = Array.isArray(points) && points.length === 3 ? points.map(parsePoint3) : null;
  if (!q || !p || p.some((v) => v === null)) return null;
  const nh = unit(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
  if (!nh) return null;
  const h = dot3(sub3(q, p[0]), nh);
  return r4Vec([0, 1, 2].map((k) => q[k] - h * nh[k]));
}

/** 距离 d = |(P−planePts[0])·nh|。纯函数、只读入参。 */
export function pointplaneDistance(point, points) {
  const q = parsePoint3(point);
  const p = Array.isArray(points) && points.length === 3 ? points.map(parsePoint3) : null;
  if (!q || !p || p.some((v) => v === null)) return null;
  const nh = unit(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
  if (!nh) return null;
  return Math.abs(r4(dot3(sub3(q, p[0]), nh)));
}

/** 平面内参考正交单位向量 e1（与法向垂直）。纯函数、只读入参。 */
export function pointplaneBasis(nh) {
  if (!Array.isArray(nh) || nh.length !== 3 || !nh.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const helper = Math.abs(nh[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(nh, helper));
}

/**
 * 解析一条 pointplane3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"pointplane3d","id":"ptpl","point":[0,0,1],"points":[[-1,-1,0],[1,-1,0],[0,1,0]],
 *    "width":2,"height":2,"rightAngleSize":0.25,"normalLength":0.5,
 *    "asPlane":true,"asPerp":true,"asPoints":false,"asRightAngle":true,"asNormal":false,
 *    "labelDistance":true,"labelPoint":false,"labelFoot":false,"vertexSize":0.1,"color":"#4f6bed"}
 *   - point       可选，给定点 P [x,y,z]（默认 [0,0,1]）；
 *   - points      可选，平面三点 [[x,y,z]×3]（默认 xy 面）；与 center+axis 互斥；
 *   - center/axis 可选，平面中心 + 法向轴（另一种定面方式）；
 *   - width/height 可选，平面面片宽/高（默认 2/2，0.01~10000）；
 *   - rightAngleSize 可选，直角符号边长（默认 0.25，0.05~100）；
 *   - normalLength 可选，法向量杆长度（默认 0.5，0.01~10000）；
 *   - asPlane     可选，是否画平面面片边框（默认 true）；
 *   - asPerp      可选，是否画垂线段 PH（默认 true）；
 *   - asPoints    可选，是否在 P / H 放小球（默认 false）；
 *   - asRightAngle 可选，是否在 H 画直角符号（默认 true）；
 *   - asNormal    可选，是否从 H 沿指向 P 的法向画 rod（默认 false）；
 *   - labelDistance 可选，是否标注距离读数（默认 true）；
 *   - labelPoint/labelFoot 可选，是否标注 P / H 名称（均默认 false）；
 *   - vertexSize  可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。八个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolvePointplane3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'ptpl' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- point：给定点 P ----
  const P = parsePoint3(cmd.point === undefined ? POINTPLANE3D_DEFAULT_POINT : cmd.point);
  if (!P) return { ok: false, error: 'point 需为合法 [x,y,z]' };

  // ---- 平面：points 与 center+axis 互斥 ----
  if (cmd.points !== undefined && (cmd.center !== undefined || cmd.axis !== undefined)) {
    return { ok: false, error: 'points 与 center/axis 互斥，只能选一种定面方式' };
  }
  const usePoints = cmd.points !== undefined || (cmd.center === undefined && cmd.axis === undefined);
  const planePts = usePoints
    ? parsePlane(cmd.points === undefined ? { points: POINTPLANE3D_DEFAULT_POINTS } : cmd)
    : parsePlane(cmd);
  if (!planePts) return { ok: false, error: '平面需为三个不共线合法 [x,y,z] 点，或合法 center+axis' };

  // ---- width / height：平面面片尺寸 + 区间（出现即校验） ----
  const wRaw = cmd.width === undefined ? POINTPLANE3D_PLANE_WIDTH_DEFAULT : num(cmd.width);
  if (wRaw === null) return { ok: false, error: 'width 必须是数字' };
  if (wRaw < POINTPLANE3D_PLANE_SIZE_MIN || wRaw > POINTPLANE3D_PLANE_SIZE_MAX) {
    return { ok: false, error: `width 需为 ${POINTPLANE3D_PLANE_SIZE_MIN}~${POINTPLANE3D_PLANE_SIZE_MAX}` };
  }
  const hRaw = cmd.height === undefined ? POINTPLANE3D_PLANE_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { ok: false, error: 'height 必须是数字' };
  if (hRaw < POINTPLANE3D_PLANE_SIZE_MIN || hRaw > POINTPLANE3D_PLANE_SIZE_MAX) {
    return { ok: false, error: `height 需为 ${POINTPLANE3D_PLANE_SIZE_MIN}~${POINTPLANE3D_PLANE_SIZE_MAX}` };
  }
  const width = r4(wRaw);
  const height = r4(hRaw);

  // ---- rightAngleSize：直角符号边长（出现即校验） ----
  const raRaw = cmd.rightAngleSize === undefined ? POINTPLANE3D_RIGHT_ANGLE_DEFAULT : num(cmd.rightAngleSize);
  if (raRaw === null) return { ok: false, error: 'rightAngleSize 必须是数字' };
  if (raRaw < POINTPLANE3D_RIGHT_ANGLE_MIN || raRaw > POINTPLANE3D_RIGHT_ANGLE_MAX) {
    return { ok: false, error: `rightAngleSize 需为 ${POINTPLANE3D_RIGHT_ANGLE_MIN}~${POINTPLANE3D_RIGHT_ANGLE_MAX}` };
  }
  const rightAngleSize = r4(raRaw);

  // ---- normalLength：法向量杆长度（出现即校验） ----
  const nlRaw = cmd.normalLength === undefined ? POINTPLANE3D_NORMAL_LENGTH_DEFAULT : num(cmd.normalLength);
  if (nlRaw === null) return { ok: false, error: 'normalLength 必须是数字' };
  if (nlRaw < POINTPLANE3D_NORMAL_LENGTH_MIN || nlRaw > POINTPLANE3D_NORMAL_LENGTH_MAX) {
    return { ok: false, error: `normalLength 需为 ${POINTPLANE3D_NORMAL_LENGTH_MIN}~${POINTPLANE3D_NORMAL_LENGTH_MAX}` };
  }
  const normalLength = r4(nlRaw);

  // ---- 输出开关：出现即须布尔 ----
  const FLAGS = ['asPlane', 'asPerp', 'asPoints', 'asRightAngle', 'asNormal', 'labelDistance', 'labelPoint', 'labelFoot'];
  for (const flag of FLAGS) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：小球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? POINTPLANE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < POINTPLANE3D_VERTEX_SIZE_MIN || vsRaw > POINTPLANE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${POINTPLANE3D_VERTEX_SIZE_MIN}~${POINTPLANE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asPlane = cmd.asPlane === undefined ? true : cmd.asPlane;
  const asPerp = cmd.asPerp === undefined ? true : cmd.asPerp;
  const asPoints = cmd.asPoints === true;
  const asRightAngle = cmd.asRightAngle === undefined ? true : cmd.asRightAngle;
  const asNormal = cmd.asNormal === true;
  const labelDistance = cmd.labelDistance === undefined ? true : cmd.labelDistance;
  const labelPoint = cmd.labelPoint === true;
  const labelFoot = cmd.labelFoot === true;
  if (!asPlane && !asPerp && !asPoints && !asRightAngle && !asNormal && !labelDistance && !labelPoint && !labelFoot) {
    return { ok: false, error: '八个输出开关至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：法向 / 带符号距离 / 垂足 / 面内标架 ----
  const nh = pointplanePlaneNormal(planePts);
  if (!nh) return { ok: false, error: '无法求平面单位法向（三点共线？）' };
  const signedRaw = dot3(sub3(P, planePts[0]), nh);
  const signedDistance = r4(clamp(signedRaw));
  const distance = Math.abs(signedDistance);
  const sign = signedRaw >= 0 ? 1 : -1;
  const H = r4Vec([0, 1, 2].map((k) => P[k] - signedRaw * nh[k]));
  const e1 = pointplaneBasis(nh);
  if (!e1) return { ok: false, error: '无法构造平面内参考方向' };
  const e2 = r4Vec(cross3(nh, e1));
  const normalDir = r4Vec([sign * nh[0], sign * nh[1], sign * nh[2]]);

  // 平面面片四角（以垂足 H 为中心，e1/e2 张成）
  const hw = width / 2;
  const hh = height / 2;
  const corner = (s1, s2) => r4Vec([0, 1, 2].map((k) => H[k] + s1 * hw * e1[k] + s2 * hh * e2[k]));
  const c00 = corner(-1, -1);
  const c10 = corner(1, -1);
  const c11 = corner(1, 1);
  const c01 = corner(-1, 1);

  // 直角符号三段：H+a·e1 → H+a·e1+a·sign·nh → H+a·sign·nh
  const q1 = r4Vec([0, 1, 2].map((k) => H[k] + rightAngleSize * e1[k]));
  const q2 = r4Vec([0, 1, 2].map((k) => q1[k] + rightAngleSize * normalDir[k]));
  const q3 = r4Vec([0, 1, 2].map((k) => H[k] + rightAngleSize * normalDir[k]));

  // 法向量杆终点 H + normalLength·normalDir
  const nEnd = r4Vec([0, 1, 2].map((k) => H[k] + normalLength * normalDir[k]));

  // 距离读数放在垂线段中点旁（沿 e1 轻偏移避免压线）
  const mid = r4Vec([0, 1, 2].map((k) => (P[k] + H[k]) / 2));
  const labelPos = r4Vec([0, 1, 2].map((k) => mid[k] + 0.15 * e1[k] + 0.05 * normalDir[k]));
  const labelText = `d=${distance}`;

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asPlane ? 4 : 0) + (asPerp ? 1 : 0) + (asRightAngle ? 2 : 0) + (asNormal ? 1 : 0);
  if (lineCount > POINTPLANE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${POINTPLANE3D_MAX_SEGMENTS}` };
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

  const mkLine = (id, p1, p2, extra) => ({
    id,
    type: 'line',
    text: '',
    color: lineColor,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2], ...(extra || {}) },
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

  // ---- 平面面片边框（以垂足 H 为中心的四角矩形）----
  if (asPlane) {
    items.push(mkLine(nextId(`${stem}_pl1`.slice(0, 64)), c00, c10));
    items.push(mkLine(nextId(`${stem}_pl2`.slice(0, 64)), c10, c11));
    items.push(mkLine(nextId(`${stem}_pl3`.slice(0, 64)), c11, c01));
    items.push(mkLine(nextId(`${stem}_pl4`.slice(0, 64)), c01, c00));
  }

  // ---- 垂线段 P→H ----
  if (asPerp) items.push(mkLine(nextId(`${stem}_perp`.slice(0, 64)), P, H));

  // ---- 直角符号（H 处，两边分别 ∥ e1 与 ∥ nh）----
  if (asRightAngle) {
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), q1, q2));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), q2, q3));
  }

  // ---- 法向量杆 H→nEnd ----
  if (asNormal) items.push(mkLine(nextId(`${stem}_nor`.slice(0, 64)), H, nEnd));

  // ---- 可选：P / H 小球 ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pP`.slice(0, 64)), P));
    items.push(mkPoint(nextId(`${stem}_pH`.slice(0, 64)), H));
  }

  // ---- 可选：距离读数 + P/H 名称标注 ----
  if (labelDistance) items.push(mkLabel(nextId(`${stem}_dist`.slice(0, 64)), labelText, labelPos));
  if (labelPoint) items.push(mkLabel(nextId(`${stem}_lp`.slice(0, 64)), 'P', P));
  if (labelFoot) items.push(mkLabel(nextId(`${stem}_lh`.slice(0, 64)), 'H', H));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      point: P.slice(),
      plane: planePts.map((p) => p.slice()),
      planeMode: cmd.points !== undefined ? 'points' : (cmd.center !== undefined || cmd.axis !== undefined ? 'centerAxis' : 'default'),
      nh: nh.slice(),
      e1: e1.slice(),
      e2: e2.slice(),
      foot: H.slice(),
      signedDistance,
      distance,
      sign,
      normalDir: normalDir.slice(),
      rightAngleSize,
      normalLength,
      normalEnd: nEnd.slice(),
      width,
      height,
      corners: [c00, c10, c11, c01].map((p) => p.slice()),
      rightAngle: [q1, q2, q3].map((p) => p.slice()),
      labelText,
      labelPos,
      asPlane,
      asPerp,
      asPoints,
      asRightAngle,
      asNormal,
      labelDistance,
      labelPoint,
      labelFoot,
      vertexSize,
      planeCount: asPlane ? 4 : 0,
      perpCount: asPerp ? 1 : 0,
      rightAngleCount: asRightAngle ? 2 : 0,
      normalCount: asNormal ? 1 : 0,
      pointCount: asPoints ? 2 : 0,
      labelCount: (labelDistance ? 1 : 0) + (labelPoint ? 1 : 0) + (labelFoot ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

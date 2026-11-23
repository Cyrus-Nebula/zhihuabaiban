/**
 * 立体画板「直线与平面所成角（lineplane3d）」参数化生成命令的纯函数语义层（2026-11-24 D33 增量）
 *
 * 与 js/board3d-dihedral.js / -cone.js / -cylinder.js / -plane.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一条直线与一个平面所成的角」这类意图，用一条命令生成标准作图：
 *   直线（给定 line 两点）+ 平面面片（可选）+ 斜足 V（直线与平面的交点）+ 从斜线上一点 A
 *   向平面作垂线的垂足 H + 斜线 VA + 垂线 AH + 射影 VH + 圆弧 + 角度读数。
 *   产出由 line（及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 能量「三点夹角」（两条线段夹角），但量不了「直线与平面的夹角」；
 *   - dihedral3d 量的是「两个半平面的夹角（二面角）」，plane3d 只画单个面片、arc3d 需给定圆心，
 *     都不构造「斜线 + 垂线 + 射影 + 圆弧」这一整套线面角作图；
 *   - lineplane3d 给「直线两点 line + 平面三点 points（或 center+axis）」，自动求斜足 / 垂足 /
 *     射影方向与角度，直接服务「线面角 / 直线与平面所成角 / 空间角标注 / 正方体中棱与底面夹角」核心用例。
 *
 * 几何定义：
 *   u    = normalize(line[1] − line[0])                        （直线单位方向）；
 *   N    = (points[1]−points[0]) × (points[2]−points[0])       （平面法向，三点定面）；
 *   nh   = normalize(N)                                        （平面单位法向）；
 *   d    = u·nh；sinθ = |d|；θ = arcsin(clamp(|d|,0,1)) ∈ [0, π/2]（线面角，取锐角/直角）。
 *   斜足 V：|d|>eps 时直线与平面交于 V = line[0] + t·u，t = ((P0−line[0])·nh)/d；
 *           |d|<=eps（直线平行/落在面内）时取 line[0] 在平面上的投影，保证 V 恒在平面内。
 *   斜线端点 A = V + rayLength·u；垂足 H = A − ((A−P0)·nh)·nh（A 在平面上的正投影）；
 *   射影方向 up = normalize(H − V)（A 的射影落在平面内）；当直线⊥平面（H≈V）退化时取平面内任一单位方向 e1；
 *   平面内参考正交标架 e1 / e2 = cross(nh, e1)；
 *   圆弧第 i 点 P_i = V + arcRadius·(cos φ_i·up + sin φ_i·sign·nh)，φ_i = θ·i/segments，sign = d≥0?1:-1
 *   （弧首点 = V + arcRadius·up、末点方向 = up·cosθ + sign·nh·sinθ = u，精确夹在射影与斜线之间）。
 * 守恒：
 *   |u| = |nh| = |up| = 1；nh·e1 = nh·e2 = 0；V 恒在平面内（(V−P0)·nh = 0）；
 *   AH ⊥ 平面（AH ∥ nh）、H 为 A 的垂足；|VA| = rayLength、|VH| = rayLength·cosθ、
 *   |AH| = rayLength·sinθ；圆弧各点到 V 距离恒为 arcRadius；角度读数 angleDeg = θ·180/π。
 *   本命令只校验数值与点位合法，不强制面片与场景其它对象无交。
 */

/** 斜线长度合法区间 */
export const LINEPLANE3D_RAY_LENGTH_MIN = 0.01;
export const LINEPLANE3D_RAY_LENGTH_MAX = 10000;
export const LINEPLANE3D_RAY_LENGTH_DEFAULT = 1;

/** 圆弧半径合法区间（超过 rayLength 时自动钳制到 rayLength） */
export const LINEPLANE3D_ARC_RADIUS_MIN = 0.01;
export const LINEPLANE3D_ARC_RADIUS_MAX = 10000;
export const LINEPLANE3D_ARC_RADIUS_DEFAULT = 0.5;

/** 圆弧分段数 */
export const LINEPLANE3D_SEGMENTS_MIN = 3;
export const LINEPLANE3D_SEGMENTS_MAX = 64;
export const LINEPLANE3D_SEGMENTS_DEFAULT = 24;

/** 平面面片宽 / 高合法区间与默认 */
export const LINEPLANE3D_PLANE_SIZE_MIN = 0.01;
export const LINEPLANE3D_PLANE_SIZE_MAX = 10000;
export const LINEPLANE3D_PLANE_WIDTH_DEFAULT = 2;
export const LINEPLANE3D_PLANE_HEIGHT_DEFAULT = 2;

/** 小球半径（与其余 3D 命令同口径） */
export const LINEPLANE3D_VERTEX_SIZE_MIN = 0.01;
export const LINEPLANE3D_VERTEX_SIZE_MAX = 1;
export const LINEPLANE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const LINEPLANE3D_MAX_SEGMENTS = 4096;

/** 默认直线（x 轴 [-1,0,0]→[1,0,0]）/ 默认平面三点（xy 面）：与 xy 面夹角 0°，便于最小命令出图 */
export const LINEPLANE3D_DEFAULT_LINE = Object.freeze([Object.freeze([-1, 0, 0]), Object.freeze([1, 0, 0])]);
export const LINEPLANE3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([-1, -1, 0]), Object.freeze([1, -1, 0]), Object.freeze([0, 1, 0]),
]);

/** 坐标钳制上限（与 geometry / dihedral / cone3d 一致） */
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

/** 解析直线两点：均须为合法 3D 点且不重合 */
function parseLine(v) {
  const src = v === undefined ? LINEPLANE3D_DEFAULT_LINE : v;
  if (!Array.isArray(src) || src.length !== 2) return null;
  const p1 = parsePoint3(src[0]);
  const p2 = parsePoint3(src[1]);
  if (!p1 || !p2 || len3(sub3(p2, p1)) < 1e-6) return null;
  return [p1, p2];
}

/** 解析平面：points 三点定面；或 center + axis 三点定面（center、center+e1、center+e2） */
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
    // 构造与 axis 正交的两个单位方向 e1/e2 作为面内参考点
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

/** 直线单位方向 u = normalize(line[1] − line[0])。纯函数、只读入参。 */
export function lineplaneLineUnit(line) {
  const l = parseLine(line);
  if (!l) return null;
  return unit(sub3(l[1], l[0]));
}

/** 平面单位法向 nh = normalize((p1−p0)×(p2−p0))。纯函数、只读入参。 */
export function lineplanePlaneNormal(points) {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  return unit(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
}

/**
 * 斜足 V：直线与平面的交点；直线平行/落在面内时取 line[0] 在平面上的正投影。
 * 纯函数、只读入参。@returns {Array|null} V [x,y,z]（新数组）或 null
 */
export function lineplaneFoot(line, points) {
  const l = parseLine(line);
  if (!l || !Array.isArray(points) || points.length !== 3) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const u = unit(sub3(l[1], l[0]));
  const nh = unit(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
  if (!u || !nh) return null;
  const d = dot3(u, nh);
  if (Math.abs(d) > 1e-9) {
    const t = dot3(sub3(p[0], l[0]), nh) / d;
    return r4Vec([0, 1, 2].map((k) => l[0][k] + t * u[k]));
  }
  const h = dot3(sub3(l[0], p[0]), nh);
  return r4Vec([0, 1, 2].map((k) => l[0][k] - h * nh[k]));
}

/** 平面内参考正交单位向量 e1（与法向垂直）。纯函数、只读入参。 */
export function lineplaneBasis(nh) {
  if (!Array.isArray(nh) || nh.length !== 3 || !nh.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const helper = Math.abs(nh[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(nh, helper));
}

/**
 * 解析一条 lineplane3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"lineplane3d","id":"lp","line":[[-1,0,0],[1,0,0]],
 *    "points":[[-1,-1,0],[1,-1,0],[0,1,0]],"rayLength":1,"arcRadius":0.5,"segments":24,
 *    "width":2,"height":2,"asLine":true,"asPlane":true,"asOblique":true,"asPerp":true,
 *    "asProjection":true,"asArc":true,"asPoints":false,"labelAngle":true,"vertexSize":0.1,"color":"#4f6bed"}
 *   - line       可选，直线两点 [[x1,y1,z1],[x2,y2,z2]]（默认 x 轴上 [-1,0,0]→[1,0,0]）；
 *   - points     可选，平面三点 [[x,y,z]×3]（默认 xy 面）；与 center+axis 互斥，
 *                给了 points 就用 points，否则用 center+axis（都缺省时用默认 xy 面）；
 *   - center/axis 可选，平面中心 + 法向轴（另一种定面方式）；
 *   - rayLength  可选，斜线 VA 长度（默认 1，0.01~10000）；
 *   - arcRadius  可选，圆弧半径（默认 0.5，0.01~10000；超过 rayLength 自动钳制）；
 *   - segments   可选，圆弧分段数（默认 24，整数 3~64）；
 *   - width/height 可选，平面面片宽/高（默认 2/2，0.01~10000）；
 *   - asLine     可选，是否画给定直线（默认 true）；
 *   - asPlane    可选，是否画平面面片边框（默认 true，见 width/height）；
 *   - asOblique/asPerp/asProjection 可选，是否画斜线 VA / 垂线 AH / 射影 VH（均默认 true）；
 *   - asArc      可选，是否画圆弧（默认 true）；
 *   - asPoints   可选，是否在 V / A / H 放小球（默认 false）；
 *   - labelAngle 可选，是否标注角度读数（默认 true）；
 *   - vertexSize 可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveLineplane3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'lp' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- line：直线两点 ----
  const line = parseLine(cmd.line);
  if (!line) return { ok: false, error: 'line 需为两个不同合法 [x,y,z] 点' };

  // ---- 平面：points 与 center+axis 互斥 ----
  if (cmd.points !== undefined && (cmd.center !== undefined || cmd.axis !== undefined)) {
    return { ok: false, error: 'points 与 center/axis 互斥，只能选一种定面方式' };
  }
  const usePoints = cmd.points !== undefined || (cmd.center === undefined && cmd.axis === undefined);
  const planePts = usePoints
    ? parsePlane(cmd.points === undefined ? { points: LINEPLANE3D_DEFAULT_POINTS } : cmd)
    : parsePlane(cmd);
  if (!planePts) return { ok: false, error: '平面需为三个不共线合法 [x,y,z] 点，或合法 center+axis' };

  // ---- rayLength：斜线长度 + 区间 ----
  const rlRaw = cmd.rayLength === undefined ? LINEPLANE3D_RAY_LENGTH_DEFAULT : num(cmd.rayLength);
  if (rlRaw === null) return { ok: false, error: 'rayLength 必须是数字' };
  if (rlRaw < LINEPLANE3D_RAY_LENGTH_MIN || rlRaw > LINEPLANE3D_RAY_LENGTH_MAX) {
    return { ok: false, error: `rayLength 需为 ${LINEPLANE3D_RAY_LENGTH_MIN}~${LINEPLANE3D_RAY_LENGTH_MAX}` };
  }
  const rayLength = r4(rlRaw);

  // ---- arcRadius：圆弧半径 + 区间（出现即校验，超 rayLength 自动钳制） ----
  const arRaw = cmd.arcRadius === undefined ? LINEPLANE3D_ARC_RADIUS_DEFAULT : num(cmd.arcRadius);
  if (arRaw === null) return { ok: false, error: 'arcRadius 必须是数字' };
  if (arRaw < LINEPLANE3D_ARC_RADIUS_MIN || arRaw > LINEPLANE3D_ARC_RADIUS_MAX) {
    return { ok: false, error: `arcRadius 需为 ${LINEPLANE3D_ARC_RADIUS_MIN}~${LINEPLANE3D_ARC_RADIUS_MAX}` };
  }
  const arcRadiusRequested = r4(arRaw);
  const arcRadius = Math.min(arcRadiusRequested, rayLength);
  const arcRadiusClamped = arcRadius < arcRadiusRequested;

  // ---- segments：必须是区间内整数 ----
  const segRaw = cmd.segments === undefined ? LINEPLANE3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < LINEPLANE3D_SEGMENTS_MIN || segRaw > LINEPLANE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${LINEPLANE3D_SEGMENTS_MIN}~${LINEPLANE3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- width / height：平面面片尺寸 + 区间（出现即校验） ----
  const wRaw = cmd.width === undefined ? LINEPLANE3D_PLANE_WIDTH_DEFAULT : num(cmd.width);
  if (wRaw === null) return { ok: false, error: 'width 必须是数字' };
  if (wRaw < LINEPLANE3D_PLANE_SIZE_MIN || wRaw > LINEPLANE3D_PLANE_SIZE_MAX) {
    return { ok: false, error: `width 需为 ${LINEPLANE3D_PLANE_SIZE_MIN}~${LINEPLANE3D_PLANE_SIZE_MAX}` };
  }
  const hRaw = cmd.height === undefined ? LINEPLANE3D_PLANE_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { ok: false, error: 'height 必须是数字' };
  if (hRaw < LINEPLANE3D_PLANE_SIZE_MIN || hRaw > LINEPLANE3D_PLANE_SIZE_MAX) {
    return { ok: false, error: `height 需为 ${LINEPLANE3D_PLANE_SIZE_MIN}~${LINEPLANE3D_PLANE_SIZE_MAX}` };
  }
  const width = r4(wRaw);
  const height = r4(hRaw);

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asLine', 'asPlane', 'asOblique', 'asPerp', 'asProjection', 'asArc', 'asPoints', 'labelAngle']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：小球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? LINEPLANE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < LINEPLANE3D_VERTEX_SIZE_MIN || vsRaw > LINEPLANE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${LINEPLANE3D_VERTEX_SIZE_MIN}~${LINEPLANE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asLine = cmd.asLine === undefined ? true : cmd.asLine;
  const asPlane = cmd.asPlane === undefined ? true : cmd.asPlane;
  const asOblique = cmd.asOblique === undefined ? true : cmd.asOblique;
  const asPerp = cmd.asPerp === undefined ? true : cmd.asPerp;
  const asProjection = cmd.asProjection === undefined ? true : cmd.asProjection;
  const asArc = cmd.asArc === undefined ? true : cmd.asArc;
  const asPoints = cmd.asPoints === true;
  const labelAngle = cmd.labelAngle === undefined ? true : cmd.labelAngle;
  if (!asLine && !asPlane && !asOblique && !asPerp && !asProjection && !asArc && !asPoints && !labelAngle) {
    return { ok: false, error: '八个输出开关至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：直线方向 / 平面法向 / 斜足 / 垂足 / 射影方向 / 角度 ----
  const u = lineplaneLineUnit(line);
  if (!u) return { ok: false, error: '无法求直线单位方向' };
  const nh = lineplanePlaneNormal(planePts);
  if (!nh) return { ok: false, error: '无法求平面单位法向（三点共线？）' };
  const V = lineplaneFoot(line, planePts);
  if (!V) return { ok: false, error: '无法求斜足' };
  const d = Math.min(1, Math.max(-1, dot3(u, nh)));
  const theta = Math.asin(Math.min(1, Math.abs(d)));
  const sign = d >= 0 ? 1 : -1;

  const A = r4Vec([0, 1, 2].map((k) => V[k] + rayLength * u[k]));
  const hDist = dot3(sub3(A, planePts[0]), nh);
  const H = r4Vec([0, 1, 2].map((k) => A[k] - hDist * nh[k]));

  // 射影方向：正常取 H−V；直线⊥平面（H≈V）退化时取平面内 e1
  const e1 = lineplaneBasis(nh);
  if (!e1) return { ok: false, error: '无法构造平面内参考方向' };
  const e2 = r4Vec(cross3(nh, e1));
  const projRaw = sub3(H, V);
  const up = len3(projRaw) > 1e-6 ? unit(projRaw) : e1;
  if (!up) return { ok: false, error: '无法求射影方向' };

  // 圆弧：up 绕 sign·nh 从 0 转到 θ；首点 = V+arcRadius·up、末点方向 = u
  const arcPoints = [];
  for (let i = 0; i <= segments; i++) {
    const phi = theta * i / segments;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    arcPoints.push(r4Vec([0, 1, 2].map((k) => V[k] + arcRadius * (c * up[k] + s * sign * nh[k]))));
  }
  const arcMid = arcPoints[Math.floor(segments / 2)];
  const angleDeg = Math.round(theta * 180 / Math.PI * 10) / 10;
  const labelText = `${angleDeg}°`;

  // 平面面片四角（以斜足 V 为中心，e1/e2 张成）
  const hw = width / 2;
  const hh = height / 2;
  const corner = (s1, s2) => r4Vec([0, 1, 2].map((k) => V[k] + s1 * hw * e1[k] + s2 * hh * e2[k]));
  const c00 = corner(-1, -1);
  const c10 = corner(1, -1);
  const c11 = corner(1, 1);
  const c01 = corner(-1, 1);

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asLine ? 1 : 0) + (asPlane ? 4 : 0)
    + (asOblique ? 1 : 0) + (asPerp ? 1 : 0) + (asProjection ? 1 : 0) + (asArc ? segments : 0);
  if (lineCount > LINEPLANE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${LINEPLANE3D_MAX_SEGMENTS}` };
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

  // ---- 直线（给定 line 两点）----
  if (asLine) items.push(mkLine(nextId(`${stem}_line`.slice(0, 64)), line[0], line[1]));

  // ---- 平面面片边框（以斜足 V 为中心的四角矩形）----
  if (asPlane) {
    items.push(mkLine(nextId(`${stem}_pl1`.slice(0, 64)), c00, c10));
    items.push(mkLine(nextId(`${stem}_pl2`.slice(0, 64)), c10, c11));
    items.push(mkLine(nextId(`${stem}_pl3`.slice(0, 64)), c11, c01));
    items.push(mkLine(nextId(`${stem}_pl4`.slice(0, 64)), c01, c00));
  }

  // ---- 斜线 VA / 垂线 AH / 射影 VH ----
  if (asOblique) items.push(mkLine(nextId(`${stem}_obl`.slice(0, 64)), V, A));
  if (asPerp) items.push(mkLine(nextId(`${stem}_perp`.slice(0, 64)), A, H));
  if (asProjection) items.push(mkLine(nextId(`${stem}_proj`.slice(0, 64)), V, H));

  // ---- 圆弧：相邻采样点连成 segments 段，精确夹在射影与斜线之间 ----
  if (asArc) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_arc${i + 1}`.slice(0, 64)), arcPoints[i], arcPoints[i + 1]));
    }
  }

  // ---- 可选：斜足 V / 斜线端点 A / 垂足 H 小球 ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pV`.slice(0, 64)), V));
    items.push(mkPoint(nextId(`${stem}_pA`.slice(0, 64)), A));
    items.push(mkPoint(nextId(`${stem}_pH`.slice(0, 64)), H));
  }

  // ---- 可选：角度读数标注（放在圆弧中点处）----
  if (labelAngle) items.push(mkLabel(nextId(`${stem}_angle`.slice(0, 64)), labelText, arcMid));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      line: line.map((p) => p.slice()),
      plane: planePts.map((p) => p.slice()),
      planeMode: cmd.points !== undefined ? 'points' : (cmd.center !== undefined || cmd.axis !== undefined ? 'centerAxis' : 'default'),
      u: u.slice(),
      nh: nh.slice(),
      e1: e1.slice(),
      e2: e2.slice(),
      foot: V.slice(),
      obliqueEnd: A.slice(),
      perpFoot: H.slice(),
      up: up.slice(),
      d: Math.round(d * 1e4) / 1e4,
      sign,
      angle: Math.round(theta * 1e4) / 1e4,
      angleDeg,
      rayLength,
      arcRadius,
      arcRadiusRequested,
      arcRadiusClamped,
      segments,
      width,
      height,
      corners: [c00, c10, c11, c01].map((p) => p.slice()),
      arcPoints: arcPoints.map((p) => p.slice()),
      arcMid,
      labelText,
      asLine,
      asPlane,
      asOblique,
      asPerp,
      asProjection,
      asArc,
      asPoints,
      labelAngle,
      vertexSize,
      lineCount: asLine ? 1 : 0,
      planeCount: asPlane ? 4 : 0,
      arcCount: asArc ? segments : 0,
      pointCount: asPoints ? 3 : 0,
      labelCount: labelAngle ? 1 : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

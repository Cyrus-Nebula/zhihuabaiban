/**
 * 立体画板「平面截球截面圆（sectionsphere3d）」纯函数语义层（2026-11-27 D44 增量）
 *
 * 与 js/board3d-plane.js / -circumsphere.js / -insphere.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一个球（球心 center + 半径 radius）与一个平面（三点 points 定面，或 center0+axis+height），
 * 一次画出球（三正交大圆线框）+ 截面平面面片 + 截面圆（小圆）+ 球心到截面的垂线段 OO' +
 * 垂足 O' 处直角符号，并标出球半径 R、截面半径 r、球心到截面距离 d 与关系式 r²+d²=R²。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - circumsphere3d / insphere3d / euler3d：只处理「四个不共面点反求球」，画不出「一个给定球被平面截得的截面圆」；
 *   - plane3d：只画平面面片，不会求它与球的交线；
 *   - sphere / circle 内置图元：内置球只能沿轴等半径、circle 只能画水平圆，表达不了「任意朝向平面截任意球的截面圆」。
 *
 * 几何口径：
 *   平面单位法向 n（三点定面 normalize((p2−p1)×(p3−p1))，或 axis='x'/'y'/'z'/向量）；
 *   球心 O=center，半径 R=radius；
 *   有向距离 h = (平面内一点 Q0 − O)·n（三点定面时 Q0=p1；axis 写法时 Q0=O+h·n），d=|h|；
 *   要求 d ≤ R（平面与球相交或相切），否则整条拒绝（无截面圆可画）；
 *   截面圆心 O'=O+h·n（球心在平面上的正投影），截面半径 r=√(R²−d²)（d=R 时 r=0 相切退化，约束拒绝）；
 *   截面圆采样点 Q(θ)=O'+r·(cosθ·u+sinθ·v)，u/v 为垂直 n 的正交单位标架：
 *     |Q−O|=R（点在球面上）、(Q−O')·n=0（点在截面内）、|Q−O'|=r（恒为截面半径）。
 *   守恒 r²+d²=R²；球大圆采样点恒在球面；垂线段 OO' 长 |h|=d 且垂直截面平面。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_PLANE_COLOR = '#7a8aa0';
const DEFAULT_PERP_COLOR = '#e0a020';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 球半径区间 / 缺省 */
export const SECTIONSPHERE3D_RADIUS_MIN = 0.01;
export const SECTIONSPHERE3D_RADIUS_MAX = 1000;
export const SECTIONSPHERE3D_RADIUS_DEFAULT = 2;

/** 平面面片宽高区间 / 缺省 */
export const SECTIONSPHERE3D_SPAN_MIN = 0.01;
export const SECTIONSPHERE3D_SPAN_MAX = 10000;
export const SECTIONSPHERE3D_WIDTH_DEFAULT = 4;
export const SECTIONSPHERE3D_HEIGHT_DEFAULT = 4;

/** 采样段数 / 直角符号 / 小球区间与缺省 */
export const SECTIONSPHERE3D_SEGMENTS_MIN = 8;
export const SECTIONSPHERE3D_SEGMENTS_MAX = 512;
export const SECTIONSPHERE3D_SEGMENTS_DEFAULT = 48;
export const SECTIONSPHERE3D_RIGHT_ANGLE_MIN = 0.01;
export const SECTIONSPHERE3D_RIGHT_ANGLE_MAX = 10;
export const SECTIONSPHERE3D_RIGHT_ANGLE_DEFAULT = 0.25;
export const SECTIONSPHERE3D_VERTEX_SIZE_MIN = 0.01;
export const SECTIONSPHERE3D_VERTEX_SIZE_MAX = 1;
export const SECTIONSPHERE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（3 大圆 + 1 截面圆 + 4 面片边 + 1 垂线 + 2 直角） */
export const SECTIONSPHERE3D_MAX_SEGMENTS = 4096;

/** 默认值常量（冻结） */
export const SECTIONSPHERE3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const SECTIONSPHERE3D_DEFAULT_AXIS = 'z';

/** 相对容差（守恒守护） */
const REL_TOL = 0.02;

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

/** 解析三维点：长度 3 的有限数值数组（数字字符串容错），否则 null */
export function parseSectionPoint(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = [];
  for (const x of v) {
    const n = num(x);
    if (n === null) return null;
    out.push(clamp(n));
  }
  return out;
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a) => Math.sqrt(dot3(a, a));
const unit = (a) => {
  const m = len3(a);
  return m > 1e-9 ? [a[0] / m, a[1] / m, a[2] / m] : null;
};

/**
 * 解析平面法向：'x'/'y'/'z'（大小写不敏感）或任意非零 3D 向量（单位化）。只读。
 * @returns {Array|null} 单位法向 [ux,uy,uz] 或 null
 */
export function sectionsphereAxisUnit(axis) {
  if (axis === undefined) return [0, 0, 1];
  if (typeof axis === 'string') {
    const s = axis.trim().toLowerCase();
    if (s === 'x') return [1, 0, 0];
    if (s === 'y') return [0, 1, 0];
    if (s === 'z') return [0, 0, 1];
    return null;
  }
  if (Array.isArray(axis)) {
    const p = parseSectionPoint(axis);
    return p ? unit(p) : null;
  }
  return null;
}

/**
 * 三点定面的单位法向 normalize((p2−p1)×(p3−p1))。三点非法 / 共线返回 null。
 */
export function sectionsphereNormalFromPoints(points) {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const p = points.map(parseSectionPoint);
  if (p.some((q) => q === null)) return null;
  const n = cross3(sub3(p[1], p[0]), sub3(p[2], p[0]));
  if (!Number.isFinite(len3(n)) || len3(n) < 1e-6) return null;
  return unit(n);
}

/**
 * 垂直法向 n 的正交单位标架 {u,v}（参考轴避开近平行方向）。
 */
export function sectionsphereBasis(n) {
  if (!Array.isArray(n) || n.length !== 3 || !n.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross3(ref, n));
  if (!u) return null;
  const v = unit(cross3(n, u));
  return v ? { u, v } : null;
}

/**
 * 平面截球的纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center:[0,0,0], radius:2, axis:'z', height:1} 或
 *                     {center:[0,0,0], radius:2, points:[[...],[...],[...]]}
 * @returns {{ok:boolean, error?:string, O?:Array, R?:number, n?:Array, h?:number, d?:number,
 *            Op?:Array, r?:number, u?:Array, v?:Array, basis?:Object, byPoints?:boolean, q0?:Array}|null}
 */
export function sectionsphereGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const O = parseSectionPoint(cmd.center === undefined ? SECTIONSPHERE3D_DEFAULT_CENTER : cmd.center);
  if (!O) return { ok: false, error: 'center 需为合法 [x,y,z] 点' };

  const R = num(cmd.radius === undefined ? SECTIONSPHERE3D_RADIUS_DEFAULT : cmd.radius);
  if (R === null) return { ok: false, error: 'radius 必须是数字' };
  if (R < SECTIONSPHERE3D_RADIUS_MIN || R > SECTIONSPHERE3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SECTIONSPHERE3D_RADIUS_MIN}~${SECTIONSPHERE3D_RADIUS_MAX}` };
  }

  let n;
  let q0;
  let byPoints = false;
  let h;
  if (cmd.points !== undefined) {
    n = sectionsphereNormalFromPoints(cmd.points);
    if (!n) return { ok: false, error: 'points 需为三点 [p1,p2,p3] 且不共线' };
    q0 = parseSectionPoint(cmd.points[0]);
    byPoints = true;
    h = dot3(sub3(q0, O), n);
    // 若显式给了 height，三点定面时忽略（_points 优先），避免双义；此处仅校验其为合法数字
    if (cmd.height !== undefined && num(cmd.height) === null) return { ok: false, error: 'height 必须是数字' };
  } else {
    n = sectionsphereAxisUnit(cmd.axis);
    if (!n) return { ok: false, error: 'axis 需为 x/y/z 或合法非零 3D 向量' };
    const hv = num(cmd.height === undefined ? 0 : cmd.height);
    if (hv === null) return { ok: false, error: 'height 必须是数字' };
    if (Math.abs(hv) > COORD_LIMIT) return { ok: false, error: 'height 越界' };
    h = hv;
    q0 = add3(O, mul3(n, h));
  }

  const d = Math.abs(h);
  if (d > R + 1e-9) return { ok: false, error: `平面到球心距离 ${d.toFixed(3)} 大于半径 ${R}，平面与球不相交` };
  if (R - d < 1e-6) return { ok: false, error: '平面与球相切，截面半径为 0，无法画出截面圆' };

  const basis = sectionsphereBasis(n);
  if (!basis) return { ok: false, error: '无法构造垂直法向的正交标架' };

  const Op = add3(O, mul3(n, h));
  const rRaw = Math.sqrt(Math.max(0, R * R - d * d));

  return {
    ok: true,
    O, R, n, u: basis.u, v: basis.v, basis,
    h, d, Op, r: rRaw, byPoints, q0,
  };
}

/**
 * 解析一条 sectionsphere3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"sectionsphere3d","id":"sec","center":[0,0,0],"radius":2,"axis":"z","height":1,
 *    "segments":48,"width":4,"height":4,"rightAngleSize":0.25,
 *    "asSphere":true,"asPlane":true,"asCircle":true,"asPerp":true,"asPoints":false,
 *    "asRightAngle":true,"labelCenter":true,"labelFoot":true,"labelRadii":true,"labelRelation":true,
 *    "vertexSize":0.1,"color":"#2b7fd4"}
 *   - center            可选，球心 [x,y,z]（默认原点）；
 *   - radius            可选，球半径（默认 2，0.01~1000）；
 *   - points            可选，平面三点 [p1,p2,p3] 定面（与 axis/height 二选一，给了就优先用三点法向）；
 *   - axis              可选，平面法向 'x'/'y'/'z' 或 3D 向量（默认 'z'）；
 *   - height            可选，球心到平面的有向距离 h（默认 0；|h|<radius 才相交）；
 *   - width / heightSpan 可选，截面平面面片沿 u/v 方向的宽高（默认 4/4，0.01~10000）；
 *       注：height 已被「球心到平面距离」占用，面片高度用 heightSpan 指定；
 *   - segments          可选，每个圆采样段数（默认 48，8~512 整数）；
 *   - rightAngleSize    可选，垂足处直角符号边长（默认 0.25，0.01~10）；
 *   - asSphere          可选，是否画球三个正交大圆（默认 true）；
 *   - asPlane           可选，是否画截面平面面片边界（默认 true）；
 *   - asCircle          可选，是否画截面圆（默认 true）；
 *   - asPerp            可选，是否画球心 O 到截面圆心 O' 的垂线段（默认 true）；
 *   - asPoints          可选，是否在 O/O'/截面圆采样点放小球（默认 false）；
 *   - asRightAngle     可选，是否在 O' 处画直角符号（默认 true）；
 *   - labelCenter / labelFoot / labelRadii / labelRelation：标注开关（默认全开）；
 *   - vertexSize / color / planeColor / perpColor / labelColor / opacity：样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSectionsphere3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'sec' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 几何解 ----
  const g = sectionsphereGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 面片宽高：height 已被「球心到平面距离」占用，用 heightSpan 指定面片高度 ----
  const wRaw = num(cmd.width === undefined ? SECTIONSPHERE3D_WIDTH_DEFAULT : cmd.width);
  if (wRaw === null) return { ok: false, error: 'width 必须是数字' };
  if (wRaw < SECTIONSPHERE3D_SPAN_MIN || wRaw > SECTIONSPHERE3D_SPAN_MAX) {
    return { ok: false, error: `width 需为 ${SECTIONSPHERE3D_SPAN_MIN}~${SECTIONSPHERE3D_SPAN_MAX}` };
  }
  const hsRaw = num(cmd.heightSpan === undefined ? SECTIONSPHERE3D_HEIGHT_DEFAULT : cmd.heightSpan);
  if (hsRaw === null) return { ok: false, error: 'heightSpan 必须是数字' };
  if (hsRaw < SECTIONSPHERE3D_SPAN_MIN || hsRaw > SECTIONSPHERE3D_SPAN_MAX) {
    return { ok: false, error: `heightSpan 需为 ${SECTIONSPHERE3D_SPAN_MIN}~${SECTIONSPHERE3D_SPAN_MAX}` };
  }
  const width = r4(wRaw);
  const heightSpan = r4(hsRaw);

  // ---- segments / rightAngleSize / vertexSize ----
  const segRaw = num(cmd.segments === undefined ? SECTIONSPHERE3D_SEGMENTS_DEFAULT : cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < SECTIONSPHERE3D_SEGMENTS_MIN || segRaw > SECTIONSPHERE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${SECTIONSPHERE3D_SEGMENTS_MIN}~${SECTIONSPHERE3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  const raRaw = num(cmd.rightAngleSize === undefined ? SECTIONSPHERE3D_RIGHT_ANGLE_DEFAULT : cmd.rightAngleSize);
  if (raRaw === null) return { ok: false, error: 'rightAngleSize 必须是数字' };
  if (raRaw < SECTIONSPHERE3D_RIGHT_ANGLE_MIN || raRaw > SECTIONSPHERE3D_RIGHT_ANGLE_MAX) {
    return { ok: false, error: `rightAngleSize 需为 ${SECTIONSPHERE3D_RIGHT_ANGLE_MIN}~${SECTIONSPHERE3D_RIGHT_ANGLE_MAX}` };
  }
  const rightAngleSize = r4(raRaw);

  const vsRaw = num(cmd.vertexSize === undefined ? SECTIONSPHERE3D_VERTEX_SIZE_DEFAULT : cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SECTIONSPHERE3D_VERTEX_SIZE_MIN || vsRaw > SECTIONSPHERE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SECTIONSPHERE3D_VERTEX_SIZE_MIN}~${SECTIONSPHERE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 布尔开关：出现即须布尔 ----
  const boolFields = [
    'asSphere', 'asPlane', 'asCircle', 'asPerp', 'asPoints',
    'asRightAngle', 'labelCenter', 'labelFoot', 'labelRadii', 'labelRelation',
  ];
  const boolDefaults = {
    asSphere: true, asPlane: true, asCircle: true, asPerp: true, asPoints: false,
    asRightAngle: true, labelCenter: true, labelFoot: true, labelRadii: true, labelRelation: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asSphere', 'asPlane', 'asCircle', 'asPerp', 'asPoints'].some((f) => flags[f])) {
    return { ok: false, error: 'asSphere / asPlane / asCircle / asPerp / asPoints 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'planeColor', 'perpColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const planeColor = color(cmd.planeColor, DEFAULT_PLANE_COLOR);
  const perpColor = color(cmd.perpColor, DEFAULT_PERP_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整后的输出几何 ----
  const O = r4Vec(g.O);
  const N = r4Vec(g.n);
  const U = r4Vec(g.u);
  const V = r4Vec(g.v);
  const Op = r4Vec(g.Op);
  const R = r4(g.R);
  const r = r4(g.r);
  const d = r4(g.d);

  // 大圆采样点（全精度算、取整输出）：circle(planeA, planeB) = O + R·(cosθ·A + sinθ·B)
  const circlePts = (pa, pb) => {
    const out = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const c = Math.cos(th) * R;
      const s = Math.sin(th) * R;
      out.push(r4Vec([
        O[0] + c * pa[0] + s * pb[0],
        O[1] + c * pa[1] + s * pb[1],
        O[2] + c * pa[2] + s * pb[2],
      ]));
    }
    return out;
  };
  const greatU = circlePts(U, V);   // 法向 n（与截面平行的大圆）
  const greatN = circlePts(N, U);   // 法向 v
  const greatV = circlePts(N, V);   // 法向 u
  // 截面圆采样点：Q(θ)=Op + r·(cosθ·u + sinθ·v)
  const sectionCircle = [];
  for (let i = 0; i < segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    const c = Math.cos(th) * r;
    const s = Math.sin(th) * r;
    sectionCircle.push(r4Vec([
      Op[0] + c * U[0] + s * V[0],
      Op[1] + c * U[1] + s * V[1],
      Op[2] + c * U[2] + s * V[2],
    ]));
  }

  // 截面面片四角：Op ± (width/2)·u ± (heightSpan/2)·v
  const at = (su, sv) => r4Vec([0, 1, 2].map((k) => Op[k] + su * (width / 2) * U[k] + sv * (heightSpan / 2) * V[k]));
  const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];

  // 直角符号：垂足 Op 处，沿 u（截面内）与 n（垂线方向）两条小边构成的「∟」。
  // 取一条指向截面圆方向（+u），一条指向球心方向与/或远离球心方向（视 h 符号）。
  const perpSign = g.h >= 0 ? -1 : 1; // 从 Op 指向球心 O 的方向
  const raU = r4Vec(add3(Op, mul3(U, rightAngleSize)));
  const raN = r4Vec(add3(Op, mul3(N, rightAngleSize * perpSign)));
  const raCorner = r4Vec(add3(add3(Op, mul3(U, rightAngleSize)), mul3(N, rightAngleSize * perpSign)));

  // ---- 守恒读数（纯几何，不取整误差放大） ----
  let sphereMaxDev = 0;
  for (const q of sectionCircle) {
    sphereMaxDev = Math.max(sphereMaxDev, Math.abs(len3(sub3(q, O)) - R));
  }
  let planeMaxDev = 0;
  for (const q of sectionCircle) {
    planeMaxDev = Math.max(planeMaxDev, Math.abs(dot3(sub3(q, Op), N)));
  }
  let radiusMaxDev = 0;
  for (const q of sectionCircle) {
    radiusMaxDev = Math.max(radiusMaxDev, Math.abs(len3(sub3(q, Op)) - r));
  }
  const relationLhs = r * r + d * d;
  const relationRhs = R * R;
  if (sphereMaxDev > REL_TOL * Math.max(1, R) || planeMaxDev > REL_TOL * Math.max(1, R)
      || radiusMaxDev > REL_TOL * Math.max(1, R)
      || Math.abs(relationLhs - relationRhs) > REL_TOL * Math.max(1, relationRhs)) {
    return { ok: false, error: '截面圆守恒失败（点未在球面 / 未落在截面内 / r²+d²≠R²）' };
  }

  // ---- 线段总数上限守护 ----
  const lineCount = (flags.asSphere ? 3 * segments : 0) + (flags.asCircle ? segments : 0)
    + (flags.asPlane ? 4 : 0) + (flags.asPerp ? 1 : 0) + (flags.asRightAngle ? 2 : 0);
  if (lineCount > SECTIONSPHERE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SECTIONSPHERE3D_MAX_SEGMENTS}` };
  }

  // ---- id 避让 ----
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

  const mkLine = (id, p1, p2, col = lineColor) => ({
    id,
    type: 'line',
    text: '',
    color: col,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2] },
  });
  const mkPoint = (id, q, col = lineColor) => ({
    id,
    type: 'point',
    text: '',
    color: col,
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

  // ---- 球三个正交大圆（闭合环） ----
  if (flags.asSphere) {
    const rings = [
      ['gu', greatU], ['gn', greatN], ['gv', greatV],
    ];
    for (const [suffix, ring] of rings) {
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_${suffix}_${i}`.slice(0, 64)), ring[i], ring[(i + 1) % segments]));
      }
    }
  }

  // ---- 截面平面面片边界 4 段 ----
  if (flags.asPlane) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_pl${i + 1}`.slice(0, 64)), corners[i], corners[(i + 1) % 4], planeColor));
    }
  }

  // ---- 截面圆（闭合环） ----
  if (flags.asCircle) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_sc${i}`.slice(0, 64)), sectionCircle[i], sectionCircle[(i + 1) % segments]));
    }
  }

  // ---- 球心 O 到截面圆心 O' 的垂线段 ----
  if (flags.asPerp) {
    items.push(mkLine(nextId(`${stem}_opp`.slice(0, 64)), O, Op, perpColor));
  }

  // ---- 垂足 O' 处直角符号（两条小边） ----
  if (flags.asRightAngle && flags.asPerp) {
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), Op, raU, perpColor));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), raU, raCorner, perpColor));
  }

  // ---- 小球：球心 O、截面圆心 O'、截面圆若干采样点（每 segments/8 取一） ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O));
    items.push(mkPoint(nextId(`${stem}_pOp`.slice(0, 64)), Op, perpColor));
    const step = Math.max(1, Math.floor(segments / 8));
    for (let i = 0; i < segments; i += step) {
      items.push(mkPoint(nextId(`${stem}_ps${i}`.slice(0, 64)), sectionCircle[i]));
    }
  }

  // ---- 标注：球心 O、截面圆心 O'、半径 R/r、距离 d、关系式 ----
  if (flags.labelCenter) {
    items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', O));
  }
  if (flags.labelFoot) {
    items.push(mkLabel(nextId(`${stem}_lOp`.slice(0, 64)), "O'", Op));
  }
  if (flags.labelRadii) {
    // R 标在球心到某一大圆采样点中点，r 标在截面圆心到某截面圆采样点中点
    const rMid = r4Vec([0, 1, 2].map((k) => (O[k] + greatU[0][k]) / 2));
    const sMid = r4Vec([0, 1, 2].map((k) => (Op[k] + sectionCircle[0][k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rMid));
    items.push(mkLabel(nextId(`${stem}_lr`.slice(0, 64)), `r=${r}`, sMid));
  }
  if (flags.labelRelation) {
    const dMid = r4Vec([0, 1, 2].map((k) => (O[k] + Op[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_ld`.slice(0, 64)), `d=${d}`, dMid));
    items.push(mkLabel(nextId(`${stem}_lrel`.slice(0, 64)), `r²+d²=R²`, Op));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: O.slice(),
      radius: R,
      axis: N.slice(),
      height: r4(g.h),
      byPoints: g.byPoints,
      points: g.byPoints && cmd.points ? cmd.points.map((p) => parseSectionPoint(p).map(clamp)) : null,
      distance: d,
      sectionCenter: Op.slice(),
      sectionRadius: r,
      basis: { u: U.slice(), v: V.slice(), n: N.slice() },
      corners: corners.map((p) => p.slice()),
      width,
      heightSpan,
      segments,
      rightAngleSize,
      sphereMaxDev: r4(sphereMaxDev),
      planeMaxDev: r4(planeMaxDev),
      radiusMaxDev: r4(radiusMaxDev),
      relationLhs: r4(relationLhs),
      relationRhs: r4(relationRhs),
      asSphere: flags.asSphere,
      asPlane: flags.asPlane,
      asCircle: flags.asCircle,
      asPerp: flags.asPerp,
      asPoints: flags.asPoints,
      asRightAngle: flags.asRightAngle,
      vertexSize,
      greatCircleCount: flags.asSphere ? 3 : 0,
      sectionCircleCount: flags.asCircle ? 1 : 0,
      pointCount: flags.asPoints ? 2 + Math.ceil(segments / Math.max(1, Math.floor(segments / 8))) : 0,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      planeColor,
      perpColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「两球相交公共圆（spheresphere3d）」纯函数语义层（2026-11-28 D49 增量）
 *
 * 与 js/board3d-sectionsphere.js / -sphericalcap.js / -sphere*.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给两个球（球心 center1/center2 + 半径 radius1/radius2），在两球相交时一次画出
 * 两球三大圆骨架 + 交圆 + 交平面圆盘辐条 + 球心连线 + 两球心到交圆上同一点的半径 +
 * 交平面处直角符号，并标出 r1/r2/d/x/a 与 a²=r1²−x²=r2²−(d−x)²。
 * 直接服务「两球相交求公共圆半径 / 交圆所在平面 / 球心到交平面距离」高考核心用例。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - sectionsphere3d：一个球 + 一个平面截出截面圆，不是两个球相交；
 *   - sphericalcap3d / spheresector3d / sphericalwedge3d：单球被截取的那一块，不涉及第二球；
 *   - circumsphere3d / insphere3d / euler3d：由点反求球，不画两球交线。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   d=|O2−O1|，须 |r1−r2|<d<r1+r2（严格相交，相切/相离/内含/同心一律拒绝）；
 *   u=unit(O2−O1)；交平面有向距离 x=(d²+r1²−r2²)/(2d)（可为负，表示交平面在 O1 背侧）；
 *   交圆半径 a=√(r1²−x²)，且恒有 a²=r2²−(d−x)²（二阶交叉校验）；
 *   交圆圆心 O′=O1+x·u，交圆平面 ⊥ O1O2；
 *   正交标架 w=unit(u×helper)、v=u×w（helper 取 z 轴、近平行时取 x 轴）；
 *   交圆采样点 P(θ)=O′+a(cosθ·w+sinθ·v)，恒满足 |P−O1|=r1 且 |P−O2|=r2、(P−O′)·u=0。
 *   任一守恒失败（交圆点到两球心距离不符 / 不在交平面 / 两式 a² 不符）整条拒绝，绝不画假交圆。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_SPHERE1_COLOR = '#9fb2ce';
const DEFAULT_SPHERE2_COLOR = '#8fbf9f';
const DEFAULT_CIRCLE_COLOR = '#e0a020';
const DEFAULT_DISC_COLOR = '#d8c27a';
const DEFAULT_AXIS_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 半径 / 采样 / 辐条 / 小球区间与缺省 */
export const SPHERESPHERE3D_RADIUS_MIN = 0.01;
export const SPHERESPHERE3D_RADIUS_MAX = 10000;
export const SPHERESPHERE3D_RADIUS_DEFAULT = 2;
export const SPHERESPHERE3D_SEGMENTS_MIN = 8;
export const SPHERESPHERE3D_SEGMENTS_MAX = 512;
export const SPHERESPHERE3D_SEGMENTS_DEFAULT = 48;
export const SPHERESPHERE3D_SPOKES_MIN = 0;
export const SPHERESPHERE3D_SPOKES_MAX = 32;
export const SPHERESPHERE3D_SPOKES_DEFAULT = 8;
export const SPHERESPHERE3D_VERTEX_SIZE_MIN = 0.01;
export const SPHERESPHERE3D_VERTEX_SIZE_MAX = 1;
export const SPHERESPHERE3D_VERTEX_SIZE_DEFAULT = 0.1;
export const SPHERESPHERE3D_RIGHT_ANGLE_MIN = 0.01;
export const SPHERESPHERE3D_RIGHT_ANGLE_MAX = 2;
export const SPHERESPHERE3D_RIGHT_ANGLE_DEFAULT = 0.2;
export const SPHERESPHERE3D_EXTEND_MIN = 0;
export const SPHERESPHERE3D_EXTEND_MAX = 2;
export const SPHERESPHERE3D_EXTEND_DEFAULT = 0.2;

/** 一条命令生成的 line 段总数上限 */
export const SPHERESPHERE3D_MAX_SEGMENTS = 4096;

/** 默认球心（两球心相距 2、半径均 2，交圆半径 √3） */
export const SPHERESPHERE3D_DEFAULT_CENTER1 = Object.freeze([0, 0, 0]);
export const SPHERESPHERE3D_DEFAULT_CENTER2 = Object.freeze([2, 0, 0]);

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

function r4(x) {
  const n = Math.round(x * 1e4) / 1e4;
  return n === 0 ? 0 : n;
}

function r4Vec(p) {
  return p.map((x) => r4(clamp(x)));
}

/** 解析三维点：长度 3 的有限数值数组（数字字符串容错），否则 null */
export function parseSSPoint(v) {
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
 * 交圆正交标架：u=unit(O2−O1)，w=unit(u×helper)，v=u×w。
 * 交圆位于过 O′ 且法向为 u 的平面内，由 w/v 张成。
 */
export function intersectionFrame(u) {
  const n = unit(u);
  if (!n) return null;
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const w = unit(cross3(n, helper));
  if (!w) return null;
  const v = unit(cross3(n, w));
  if (!v) return null;
  return { u: n, w, v };
}

/** 交平面到 O1 的有向距离 x=(d²+r1²−r2²)/(2d) */
export function sphereSpherePlaneOffset(d, r1, r2) {
  if (!(d > 0)) return null;
  return (d * d + r1 * r1 - r2 * r2) / (2 * d);
}

/** 交圆半径 a=√(r1²−x²) */
export function sphereSphereCircleRadius(r1, x) {
  const a2 = r1 * r1 - x * x;
  return a2 > 0 ? Math.sqrt(a2) : null;
}

/**
 * 两球相交纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center1, radius1, center2, radius2}
 * @returns {{ok:boolean,error?:string,...}|null} ok 时返回 O1/O2/r1/r2/d/x/a/O′/u/w/v 等
 */
export function sphereSphereGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const O1 = cmd.center1 === undefined ? SPHERESPHERE3D_DEFAULT_CENTER1 : parseSSPoint(cmd.center1);
  const O2 = cmd.center2 === undefined ? SPHERESPHERE3D_DEFAULT_CENTER2 : parseSSPoint(cmd.center2);
  if (!O1) return { ok: false, error: 'center1 需为合法 [x,y,z]' };
  if (!O2) return { ok: false, error: 'center2 需为合法 [x,y,z]' };

  const r1 = num(cmd.radius1 === undefined ? SPHERESPHERE3D_RADIUS_DEFAULT : cmd.radius1);
  const r2 = num(cmd.radius2 === undefined ? SPHERESPHERE3D_RADIUS_DEFAULT : cmd.radius2);
  if (r1 === null || r2 === null) return { ok: false, error: 'radius1 / radius2 必须是数字' };
  if (r1 < SPHERESPHERE3D_RADIUS_MIN || r1 > SPHERESPHERE3D_RADIUS_MAX
      || r2 < SPHERESPHERE3D_RADIUS_MIN || r2 > SPHERESPHERE3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SPHERESPHERE3D_RADIUS_MIN}~${SPHERESPHERE3D_RADIUS_MAX}` };
  }

  const diff = sub3(O2, O1);
  const d = len3(diff);
  if (d <= 1e-6) return { ok: false, error: '两球心重合，交圆不唯一' };
  if (d <= Math.abs(r1 - r2) + 1e-9) return { ok: false, error: '两球内含或内切，无交圆' };
  if (d >= r1 + r2 - 1e-9) return { ok: false, error: '两球外切或相离，无交圆' };

  const u = unit(diff);
  const fr = intersectionFrame(u);
  if (!fr) return { ok: false, error: '球心连线方向非法' };
  const { w, v } = fr;

  const x = sphereSpherePlaneOffset(d, r1, r2);
  if (x === null) return { ok: false, error: '交平面距离求解失败' };
  const a = sphereSphereCircleRadius(r1, x);
  if (a === null) return { ok: false, error: '交圆半径非正' };

  // 二阶交叉校验：a²=r2²−(d−x)²
  const a2 = r1 * r1 - x * x;
  const a2b = r2 * r2 - (d - x) * (d - x);
  if (Math.abs(a2b - a2) > 0.01 * Math.max(1, Math.abs(a2))) {
    return { ok: false, error: '交圆半径两式交叉校验失败' };
  }
  const center = add3(O1, mul3(u, x));

  return {
    ok: true, center1: O1, center2: O2, radius1: r1, radius2: r2,
    distance: d, planeOffset: x, circleRadius: a, circleCenter: center,
    u: fr.u, w, v,
  };
}

/**
 * 解析一条 spheresphere3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"spheresphere3d","id":"ssi","center1":[0,0,0],"radius1":2,
 *    "center2":[2,0,0],"radius2":2,"segments":48,"spokes":8,
 *    "rightAngleSize":0.2,"extend":0.2,
 *    "asSphere1":true,"asSphere2":true,"asCircle":true,"asDisc":true,"asAxis":true,
 *    "asRadii":true,"asRightAngle":true,"asPoints":false,
 *    "labelRadii":true,"labelDistance":true,"labelCircleRadius":true,
 *    "labelPlaneOffset":true,"labelRelation":true,"vertexSize":0.1,"color":"#2b7fd4"}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSphereSphere3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'ssi' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const g = sphereSphereGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 整数 / 浮点参数 ----
  const intParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${name} 需为 ${min}~${max} 的整数` };
    return { value: v };
  };
  const sg = intParam('segments', SPHERESPHERE3D_SEGMENTS_DEFAULT, SPHERESPHERE3D_SEGMENTS_MIN, SPHERESPHERE3D_SEGMENTS_MAX);
  if (sg.error) return { ok: false, error: sg.error };
  const sk = intParam('spokes', SPHERESPHERE3D_SPOKES_DEFAULT, SPHERESPHERE3D_SPOKES_MIN, SPHERESPHERE3D_SPOKES_MAX);
  if (sk.error) return { ok: false, error: sk.error };
  const segments = sg.value, spokes = sk.value;

  const rangeParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (v < min || v > max) return { error: `${name} 需为 ${min}~${max}` };
    return { value: v };
  };
  const vs = rangeParam('vertexSize', SPHERESPHERE3D_VERTEX_SIZE_DEFAULT, SPHERESPHERE3D_VERTEX_SIZE_MIN, SPHERESPHERE3D_VERTEX_SIZE_MAX);
  if (vs.error) return { ok: false, error: vs.error };
  const ra = rangeParam('rightAngleSize', SPHERESPHERE3D_RIGHT_ANGLE_DEFAULT, SPHERESPHERE3D_RIGHT_ANGLE_MIN, SPHERESPHERE3D_RIGHT_ANGLE_MAX);
  if (ra.error) return { ok: false, error: ra.error };
  const ex = rangeParam('extend', SPHERESPHERE3D_EXTEND_DEFAULT, SPHERESPHERE3D_EXTEND_MIN, SPHERESPHERE3D_EXTEND_MAX);
  if (ex.error) return { ok: false, error: ex.error };
  const vertexSize = r4(vs.value), rightAngleSize = r4(ra.value), extend = r4(ex.value);

  // ---- 布尔开关 ----
  const boolFields = [
    'asSphere1', 'asSphere2', 'asCircle', 'asDisc', 'asAxis', 'asRadii', 'asRightAngle', 'asPoints',
    'labelRadii', 'labelDistance', 'labelCircleRadius', 'labelPlaneOffset', 'labelRelation',
  ];
  const boolDefaults = {
    asSphere1: true, asSphere2: true, asCircle: true, asDisc: true, asAxis: true,
    asRadii: true, asRightAngle: true, asPoints: false,
    labelRadii: true, labelDistance: true, labelCircleRadius: true,
    labelPlaneOffset: true, labelRelation: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asSphere1', 'asSphere2', 'asCircle', 'asDisc', 'asAxis', 'asRadii'].some((f) => flags[f])) {
    return { ok: false, error: 'asSphere1 / asSphere2 / asCircle / asDisc / asAxis / asRadii 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'sphere1Color', 'sphere2Color', 'circleColor', 'discColor', 'axisColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const sphere1Color = color(cmd.sphere1Color, DEFAULT_SPHERE1_COLOR);
  const sphere2Color = color(cmd.sphere2Color, DEFAULT_SPHERE2_COLOR);
  const circleColor = color(cmd.circleColor, DEFAULT_CIRCLE_COLOR);
  const discColor = color(cmd.discColor, DEFAULT_DISC_COLOR);
  const axisColor = color(cmd.axisColor, DEFAULT_AXIS_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整输出几何 ----
  const O1 = r4Vec(g.center1), O2 = r4Vec(g.center2), OP = r4Vec(g.circleCenter);
  const R1 = r4(g.radius1), R2 = r4(g.radius2), D = r4(g.distance);
  const X = r4(g.planeOffset), A = r4(g.circleRadius);
  const U = r4Vec(g.u), W = r4Vec(g.w), V = r4Vec(g.v);
  const r1 = g.radius1, r2 = g.radius2, a = g.circleRadius;
  const center1 = g.center1, center2 = g.center2, center = g.circleCenter;
  const u = g.u, w = g.w, v = g.v;

  // 交圆采样 P(θ)=O′+a(cosθ·w+sinθ·v)
  const circle = [];
  for (let i = 0; i < segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    const c = Math.cos(th) * a, s = Math.sin(th) * a;
    circle.push(r4Vec([
      center[0] + c * w[0] + s * v[0],
      center[1] + c * w[1] + s * v[1],
      center[2] + c * w[2] + s * v[2],
    ]));
  }

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let dev1 = 0, dev2 = 0, planeDev = 0;
  for (const q of circle) {
    dev1 = Math.max(dev1, Math.abs(len3(sub3(q, O1)) - R1));
    dev2 = Math.max(dev2, Math.abs(len3(sub3(q, O2)) - R2));
    planeDev = Math.max(planeDev, Math.abs(dot3(sub3(q, OP), U)));
  }
  const scale = Math.max(1, R1, R2);
  if (dev1 > REL_TOL * scale || dev2 > REL_TOL * scale || planeDev > REL_TOL * scale) {
    return { ok: false, error: '两球交圆守恒失败（交圆点不在两球面 / 不在交平面）' };
  }

  // ---- 线段总数上限守护 ----
  const sphereLines = (flags.asSphere1 ? 3 * segments : 0) + (flags.asSphere2 ? 3 * segments : 0);
  const circleLines = flags.asCircle ? segments : 0;
  const discLines = flags.asDisc ? spokes : 0;
  const axisLines = flags.asAxis ? 1 : 0;
  const radiiLines = flags.asRadii ? 4 : 0;
  const rightAngleLines = flags.asRightAngle ? 2 : 0;
  const lineCount = sphereLines + circleLines + discLines + axisLines + radiiLines + rightAngleLines;
  if (lineCount > SPHERESPHERE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SPHERESPHERE3D_MAX_SEGMENTS}` };
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
    id, type: 'line', text: '', color: col, opacity: lineOpacity,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2] },
  });
  const mkPoint = (id, q, col = lineColor) => ({
    id, type: 'point', text: '', color: col, opacity: lineOpacity,
    pos: q.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: { s: vertexSize },
  });
  const mkLabel = (id, text, q) => ({
    id, type: 'label', text, color: labelColor, opacity: 1,
    pos: q.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: {},
  });

  const items = [];

  // ---- 两球三大圆骨架 ----
  const greatSphere = (O, r, col, tag) => {
    const planes = [[u, w], [u, v], [w, v]];
    planes.forEach(([e1, e2], pi) => {
      const pts = [];
      for (let i = 0; i < segments; i++) {
        const th = (2 * Math.PI * i) / segments;
        const c = Math.cos(th) * r, s = Math.sin(th) * r;
        pts.push(r4Vec([
          O[0] + c * e1[0] + s * e2[0],
          O[1] + c * e1[1] + s * e2[1],
          O[2] + c * e1[2] + s * e2[2],
        ]));
      }
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_${tag}${pi}_${i}`.slice(0, 64)), pts[i], pts[(i + 1) % segments], col));
      }
    });
  };
  if (flags.asSphere1) greatSphere(center1, r1, sphere1Color, 's1');
  if (flags.asSphere2) greatSphere(center2, r2, sphere2Color, 's2');

  // ---- 交圆 ----
  if (flags.asCircle) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_c${i}`.slice(0, 64)), circle[i], circle[(i + 1) % segments], circleColor));
    }
  }

  // ---- 交平面圆盘辐条 ----
  if (flags.asDisc && spokes > 0) {
    const step = Math.max(1, Math.floor(segments / spokes));
    for (let i = 0; i < segments; i += step) {
      items.push(mkLine(nextId(`${stem}_d${i}`.slice(0, 64)), OP, circle[i], discColor));
    }
  }

  // ---- 球心连线（两端各延长 extend·d） ----
  if (flags.asAxis) {
    const a0 = r4Vec([center1[0] - extend * g.distance * u[0], center1[1] - extend * g.distance * u[1], center1[2] - extend * g.distance * u[2]]);
    const a1 = r4Vec([center2[0] + extend * g.distance * u[0], center2[1] + extend * g.distance * u[1], center2[2] + extend * g.distance * u[2]]);
    items.push(mkLine(nextId(`${stem}_axis`.slice(0, 64)), a0, a1, axisColor));
  }

  // ---- 两球心到交圆上同一点 P0 的半径 + 到交圆圆心 O′ 的有向线段 ----
  const p0 = circle[0];
  if (flags.asRadii) {
    items.push(mkLine(nextId(`${stem}_r1`.slice(0, 64)), O1, p0, sphere1Color));
    items.push(mkLine(nextId(`${stem}_r2`.slice(0, 64)), O2, p0, sphere2Color));
    items.push(mkLine(nextId(`${stem}_o1p`.slice(0, 64)), O1, OP, axisColor));
    items.push(mkLine(nextId(`${stem}_o2p`.slice(0, 64)), O2, OP, axisColor));
  }

  // ---- 交平面处直角符号（u 与 w 张成的小折角） ----
  if (flags.asRightAngle) {
    const s = Math.min(rightAngleSize, 0.4 * a);
    const A = r4Vec([OP[0] + s * u[0], OP[1] + s * u[1], OP[2] + s * u[2]]);
    const B = r4Vec([A[0] + s * w[0], A[1] + s * w[1], A[2] + s * w[2]]);
    const C = r4Vec([OP[0] + s * w[0], OP[1] + s * w[1], OP[2] + s * w[2]]);
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), A, B, axisColor));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), B, C, axisColor));
  }

  // ---- 小球：两球心、交圆圆心、交圆采样点 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO1`.slice(0, 64)), O1, sphere1Color));
    items.push(mkPoint(nextId(`${stem}_pO2`.slice(0, 64)), O2, sphere2Color));
    items.push(mkPoint(nextId(`${stem}_pOP`.slice(0, 64)), OP, circleColor));
    const step = Math.max(1, Math.floor(segments / 8));
    for (let i = 0; i < segments; i += step) {
      items.push(mkPoint(nextId(`${stem}_pC${i}`.slice(0, 64)), circle[i], circleColor));
    }
  }

  // ---- 标注 ----
  if (flags.labelRadii) {
    items.push(mkLabel(nextId(`${stem}_lR1`.slice(0, 64)), `r1=${R1}`, r4Vec([0, 1, 2].map((k) => (O1[k] + p0[k]) / 2))));
    items.push(mkLabel(nextId(`${stem}_lR2`.slice(0, 64)), `r2=${R2}`, r4Vec([0, 1, 2].map((k) => (O2[k] + p0[k]) / 2))));
  }
  if (flags.labelDistance) {
    items.push(mkLabel(nextId(`${stem}_lD`.slice(0, 64)), `d=${D}`, r4Vec([0, 1, 2].map((k) => (O1[k] + O2[k]) / 2))));
  }
  if (flags.labelCircleRadius) {
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), `a=${A}`, r4Vec([0, 1, 2].map((k) => (OP[k] + p0[k]) / 2))));
  }
  if (flags.labelPlaneOffset) {
    items.push(mkLabel(nextId(`${stem}_lX`.slice(0, 64)), `x=${X}`, r4Vec([0, 1, 2].map((k) => (O1[k] + OP[k]) / 2))));
  }
  if (flags.labelRelation) {
    items.push(mkLabel(nextId(`${stem}_lRel`.slice(0, 64)), `a²=r1²−x²=r2²−(d−x)²`, r4Vec([0, 1, 2].map((k) => OP[k] + 0.6 * A * w[k]))));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center1: O1, radius1: R1, center2: O2, radius2: R2,
      distance: D, planeOffset: X, circleRadius: A, circleCenter: OP,
      axis: U, basis: { w: W, v: V, u: U },
      dev1: r4(dev1), dev2: r4(dev2), planeDev: r4(planeDev),
      segments, spokes, vertexSize, rightAngleSize, extend,
      asSphere1: flags.asSphere1, asSphere2: flags.asSphere2, asCircle: flags.asCircle,
      asDisc: flags.asDisc, asAxis: flags.asAxis, asRadii: flags.asRadii,
      asRightAngle: flags.asRightAngle, asPoints: flags.asPoints,
      pointCount: items.filter((it) => it.type === 'point').length,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor, sphere1Color, sphere2Color, circleColor, discColor,
      axisColor, labelColor, opacity: lineOpacity,
    },
  };
}

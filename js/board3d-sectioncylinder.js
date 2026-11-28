/**
 * 立体画板「平面截圆柱截面椭圆（sectioncylinder3d）」纯函数语义层（2026-11-28 D50 增量）
 *
 * 与 js/board3d-sectionsphere.js / -sphericalcap.js / -sphere*.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一个圆柱（中心 center + 轴 axis + 半径 radius + 高 height）与截面相对柱轴的夹角
 * angle（度，0<angle≤90），一次画出圆柱上下底圆 + 侧母线 + 斜截面椭圆环 + 椭圆辐条 +
 * 柱轴与截面法向 + 椭圆长/短轴半径 + 直角符号，并标出 r/θ/a/b/S 与 a=r/sinθ、S=πr²/sinθ。
 * 直接服务「平面截圆柱得椭圆 / 斜截圆柱截面面积 / 截面长轴短轴」高考核心用例。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - sectionsphere3d：截的是球、截面永远是圆，不是圆柱斜截椭圆；
 *   - sphericalcap3d / spheresector3d / sphericalwedge3d / spheresphere3d：球族，不涉及圆柱；
 *   - cylinder3d / conefrustum3d：只画圆柱/圆台本身，画不出「被平面截出的椭圆截面」；
 *   - plane3d：只画任意朝向的矩形面片，不能保证截线落在圆柱侧面且算出面积。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   n=unit(axis)，h0=unit(helper−(helper·n)n)（helper 近平行时自动换轴）；
 *   θ=angle·π/180 为截面与柱轴夹角；截面法向 m=sinθ·n+cosθ·h0，
 *   截面内长轴方向 e1=cosθ·n−sinθ·h0、短轴方向 e2=unit(m×e1)，三者两两正交且单位。
 *   截面中心 O′=center+offset·n，椭圆点 P(t)=O′+a·cos t·e1+b·sin t·e2；
 *   长半轴 a=radius/sinθ、短半轴 b=radius，轴向半展 a·cosθ=radius·cotθ。
 *   由 n=sinθ·m+cosθ·e1 得 (P−O′)·n=radius·cotθ·cos t，
 *   P 到柱轴距离恒为 radius、(P−O′)·m=0，S=πab=πr²/sinθ；θ=90° 退化为圆 a=b=r。
 *   要求 |offset|+a·cosθ ≤ height/2（截面完整落在有限圆柱侧面上），否则原子拒绝。
 *   任一守恒失败（椭圆点不在柱面 / 不在截面 / 超出柱高）整条拒绝，绝不画假截面。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_CYLINDER_COLOR = '#9fb2ce';
const DEFAULT_SECTION_COLOR = '#e0a020';
const DEFAULT_AXIS_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 半径 / 高 / 角度 / 采样 / 辐条 / 母线 / 小球区间与缺省 */
export const SECTIONCYLINDER3D_RADIUS_MIN = 0.01;
export const SECTIONCYLINDER3D_RADIUS_MAX = 10000;
export const SECTIONCYLINDER3D_RADIUS_DEFAULT = 1.5;
export const SECTIONCYLINDER3D_HEIGHT_MIN = 0.1;
export const SECTIONCYLINDER3D_HEIGHT_MAX = 10000;
export const SECTIONCYLINDER3D_HEIGHT_DEFAULT = 6;
export const SECTIONCYLINDER3D_ANGLE_MIN = 5;
export const SECTIONCYLINDER3D_ANGLE_MAX = 90;
export const SECTIONCYLINDER3D_ANGLE_DEFAULT = 45;
export const SECTIONCYLINDER3D_OFFSET_MIN = -10000;
export const SECTIONCYLINDER3D_OFFSET_MAX = 10000;
export const SECTIONCYLINDER3D_OFFSET_DEFAULT = 0;
export const SECTIONCYLINDER3D_SEGMENTS_MIN = 8;
export const SECTIONCYLINDER3D_SEGMENTS_MAX = 512;
export const SECTIONCYLINDER3D_SEGMENTS_DEFAULT = 48;
export const SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MIN = 8;
export const SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MAX = 512;
export const SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_DEFAULT = 64;
export const SECTIONCYLINDER3D_SPOKES_MIN = 0;
export const SECTIONCYLINDER3D_SPOKES_MAX = 32;
export const SECTIONCYLINDER3D_SPOKES_DEFAULT = 8;
export const SECTIONCYLINDER3D_MERIDIANS_MIN = 0;
export const SECTIONCYLINDER3D_MERIDIANS_MAX = 64;
export const SECTIONCYLINDER3D_MERIDIANS_DEFAULT = 12;
export const SECTIONCYLINDER3D_VERTEX_SIZE_MIN = 0.01;
export const SECTIONCYLINDER3D_VERTEX_SIZE_MAX = 1;
export const SECTIONCYLINDER3D_VERTEX_SIZE_DEFAULT = 0.1;
export const SECTIONCYLINDER3D_RIGHT_ANGLE_MIN = 0.01;
export const SECTIONCYLINDER3D_RIGHT_ANGLE_MAX = 2;
export const SECTIONCYLINDER3D_RIGHT_ANGLE_DEFAULT = 0.2;

/** 一条命令生成的 line 段总数上限 */
export const SECTIONCYLINDER3D_MAX_SEGMENTS = 4096;

/** 默认圆柱：中心原点、z 轴、r=1.5、h=6、θ=45° → a=1.5√2、b=1.5、S=9√2π/4≈3.182π */
export const SECTIONCYLINDER3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const SECTIONCYLINDER3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

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
export function parseSCPoint(v) {
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
 * 截面正交标架：
 * n=unit(axis)、e1=cosθ·n−sinθ·h0（长轴）、m=sinθ·n+cosθ·h0（截面法向）、e2=unit(m×e1)。
 */
export function sectionFrame(axis, angleDeg, helperVec) {
  const n = unit(axis);
  if (!n || !Number.isFinite(angleDeg)) return null;
  const candidates = [
    helperVec || (Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]),
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
  ];
  let h0 = null;
  for (const c of candidates) {
    const raw = parseSCPoint(c);
    if (!raw) continue;
    const perp = sub3(raw, mul3(n, dot3(raw, n)));
    const u = unit(perp);
    if (u) { h0 = u; break; }
  }
  if (!h0) return null;
  const th = (angleDeg * Math.PI) / 180;
  const s = Math.sin(th), c = Math.cos(th);
  const m = add3(mul3(n, s), mul3(h0, c));
  const e1 = sub3(mul3(n, c), mul3(h0, s));
  const e2 = unit(cross3(m, e1));
  if (!e2) return null;
  return { n, h0, m, e1, e2, sin: s, cos: c };
}

/** 椭圆长半轴 a=radius/sinθ（θ=90° 时 a=radius） */
export function sectionEllipseSemiMajor(radius, angleDeg) {
  if (!(radius > 0) || !(angleDeg > 0) || angleDeg > 90) return null;
  const s = Math.sin((angleDeg * Math.PI) / 180);
  return s > 1e-9 ? radius / s : null;
}

/** 截面面积 S=πab=π·radius²/sinθ */
export function sectionEllipseArea(radius, angleDeg) {
  const a = sectionEllipseSemiMajor(radius, angleDeg);
  return a === null ? null : Math.PI * radius * a;
}

/**
 * 平面截圆柱纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center, axis, radius, height, angle, offset, helper}
 * @returns {{ok:boolean,error?:string,...}|null} ok 时返回柱心/轴/标架/半轴/面积等
 */
export function sectionCylinderGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const center = cmd.center === undefined ? SECTIONCYLINDER3D_DEFAULT_CENTER : parseSCPoint(cmd.center);
  if (!center) return { ok: false, error: 'center 需为合法 [x,y,z]' };
  const axis = cmd.axis === undefined ? SECTIONCYLINDER3D_DEFAULT_AXIS : parseSCPoint(cmd.axis);
  if (!axis) return { ok: false, error: 'axis 需为合法 [x,y,z]' };

  const radius = num(cmd.radius === undefined ? SECTIONCYLINDER3D_RADIUS_DEFAULT : cmd.radius);
  const height = num(cmd.height === undefined ? SECTIONCYLINDER3D_HEIGHT_DEFAULT : cmd.height);
  const angleDeg = num(cmd.angle === undefined ? SECTIONCYLINDER3D_ANGLE_DEFAULT : cmd.angle);
  const offset = num(cmd.offset === undefined ? SECTIONCYLINDER3D_OFFSET_DEFAULT : cmd.offset);
  if ([radius, height, angleDeg, offset].some((x) => x === null)) {
    return { ok: false, error: 'radius / height / angle / offset 必须是数字' };
  }
  if (radius < SECTIONCYLINDER3D_RADIUS_MIN || radius > SECTIONCYLINDER3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SECTIONCYLINDER3D_RADIUS_MIN}~${SECTIONCYLINDER3D_RADIUS_MAX}` };
  }
  if (height < SECTIONCYLINDER3D_HEIGHT_MIN || height > SECTIONCYLINDER3D_HEIGHT_MAX) {
    return { ok: false, error: `height 需为 ${SECTIONCYLINDER3D_HEIGHT_MIN}~${SECTIONCYLINDER3D_HEIGHT_MAX}` };
  }
  if (angleDeg < SECTIONCYLINDER3D_ANGLE_MIN || angleDeg > SECTIONCYLINDER3D_ANGLE_MAX) {
    return { ok: false, error: `angle 需为 ${SECTIONCYLINDER3D_ANGLE_MIN}~${SECTIONCYLINDER3D_ANGLE_MAX} 度` };
  }

  const fr = sectionFrame(axis, angleDeg, cmd.helper);
  if (!fr) return { ok: false, error: '柱轴或 helper 非法' };

  const a = sectionEllipseSemiMajor(radius, angleDeg);
  if (a === null) return { ok: false, error: '截面长半轴求解失败' };
  const b = radius;
  const axialHalf = a * fr.cos;
  if (Math.abs(offset) + axialHalf > height / 2 + 1e-9) {
    return { ok: false, error: '截面超出有限圆柱高度，无法得到完整椭圆' };
  }

  const sectionCenter = add3(center, mul3(fr.n, offset));
  const bottom = sub3(center, mul3(fr.n, height / 2));
  const top = add3(center, mul3(fr.n, height / 2));
  const area = sectionEllipseArea(radius, angleDeg);
  if (area === null || !Number.isFinite(area)) return { ok: false, error: '截面面积求解失败' };

  return {
    ok: true, center, bottom, top, sectionCenter, radius, height, angleDeg, offset,
    n: fr.n, h0: fr.h0, m: fr.m, e1: fr.e1, e2: fr.e2,
    sinTheta: fr.sin, cosTheta: fr.cos,
    semiMajor: a, semiMinor: b, axialHalf, area,
  };
}

/** 椭圆采样点 P(t)=O′+a·cos t·e1+b·sin t·e2 */
export function sectionEllipsePoint(g, t) {
  const c = Math.cos(t) * g.semiMajor;
  const s = Math.sin(t) * g.semiMinor;
  return add3(g.sectionCenter, add3(mul3(g.e1, c), mul3(g.e2, s)));
}

/**
 * 解析一条 sectioncylinder3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"sectioncylinder3d","id":"sci","center":[0,0,0],"axis":[0,0,1],"radius":1.5,
 *    "height":6,"angle":45,"offset":0,"segments":48,"ellipseSegments":64,"spokes":8,
 *    "meridians":12,"rightAngleSize":0.2,"vertexSize":0.1,
 *    "asCylinder":true,"asSection":true,"asAxes":true,"asRadii":true,"asPoints":false,
 *    "labelRadius":true,"labelAngle":true,"labelSemiMajor":true,"labelSemiMinor":true,
 *    "labelArea":true,"labelRelation":true,"color":"#2b7fd4"}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSectionCylinder3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'sci' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const g = sectionCylinderGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 整数 / 浮点参数 ----
  const intParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${name} 需为 ${min}~${max} 的整数` };
    return { value: v };
  };
  const sg = intParam('segments', SECTIONCYLINDER3D_SEGMENTS_DEFAULT, SECTIONCYLINDER3D_SEGMENTS_MIN, SECTIONCYLINDER3D_SEGMENTS_MAX);
  if (sg.error) return { ok: false, error: sg.error };
  const el = intParam('ellipseSegments', SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_DEFAULT, SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MIN, SECTIONCYLINDER3D_ELLIPSE_SEGMENTS_MAX);
  if (el.error) return { ok: false, error: el.error };
  const sp = intParam('spokes', SECTIONCYLINDER3D_SPOKES_DEFAULT, SECTIONCYLINDER3D_SPOKES_MIN, SECTIONCYLINDER3D_SPOKES_MAX);
  if (sp.error) return { ok: false, error: sp.error };
  const me = intParam('meridians', SECTIONCYLINDER3D_MERIDIANS_DEFAULT, SECTIONCYLINDER3D_MERIDIANS_MIN, SECTIONCYLINDER3D_MERIDIANS_MAX);
  if (me.error) return { ok: false, error: me.error };
  const segments = sg.value, ellipseSegments = el.value, spokes = sp.value, meridians = me.value;

  const rangeParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (v < min || v > max) return { error: `${name} 需为 ${min}~${max}` };
    return { value: v };
  };
  const vs = rangeParam('vertexSize', SECTIONCYLINDER3D_VERTEX_SIZE_DEFAULT, SECTIONCYLINDER3D_VERTEX_SIZE_MIN, SECTIONCYLINDER3D_VERTEX_SIZE_MAX);
  if (vs.error) return { ok: false, error: vs.error };
  const ra = rangeParam('rightAngleSize', SECTIONCYLINDER3D_RIGHT_ANGLE_DEFAULT, SECTIONCYLINDER3D_RIGHT_ANGLE_MIN, SECTIONCYLINDER3D_RIGHT_ANGLE_MAX);
  if (ra.error) return { ok: false, error: ra.error };
  const vertexSize = r4(vs.value), rightAngleSize = r4(ra.value);

  // ---- 布尔开关 ----
  const boolFields = [
    'asCylinder', 'asSection', 'asAxes', 'asRadii', 'asPoints',
    'labelRadius', 'labelAngle', 'labelSemiMajor', 'labelSemiMinor', 'labelArea', 'labelRelation',
  ];
  const boolDefaults = {
    asCylinder: true, asSection: true, asAxes: true, asRadii: true, asPoints: false,
    labelRadius: true, labelAngle: true, labelSemiMajor: true,
    labelSemiMinor: true, labelArea: true, labelRelation: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asCylinder', 'asSection', 'asAxes', 'asRadii'].some((f) => flags[f])) {
    return { ok: false, error: 'asCylinder / asSection / asAxes / asRadii 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'cylinderColor', 'sectionColor', 'axisColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const cylinderColor = color(cmd.cylinderColor, DEFAULT_CYLINDER_COLOR);
  const sectionColor = color(cmd.sectionColor, DEFAULT_SECTION_COLOR);
  const axisColor = color(cmd.axisColor, DEFAULT_AXIS_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整输出几何 ----
  const C = r4Vec(g.center), OB = r4Vec(g.bottom), OT = r4Vec(g.top), OP = r4Vec(g.sectionCenter);
  const R = r4(g.radius), H = r4(g.height), TH = r4(g.angleDeg), OF = r4(g.offset);
  const A = r4(g.semiMajor), B = r4(g.semiMinor), S = r4(g.area), AH = r4(g.axialHalf);
  const N = r4Vec(g.n), M = r4Vec(g.m), E1 = r4Vec(g.e1), E2 = r4Vec(g.e2);
  const center = g.center, n = g.n, m = g.m, e1 = g.e1, e2 = g.e2;
  const radius = g.radius, height = g.height, a = g.semiMajor, b = g.semiMinor;

  // 椭圆采样 P(t)=O′+a·cos t·e1+b·sin t·e2
  const ellipse = [];
  for (let i = 0; i < ellipseSegments; i++) {
    ellipse.push(r4Vec(sectionEllipsePoint(g, (2 * Math.PI * i) / ellipseSegments)));
  }

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let radialDev = 0, planeDev = 0, axialDev = 0;
  for (const q of ellipse) {
    const d = sub3(q, center);
    const along = dot3(d, n);
    radialDev = Math.max(radialDev, Math.abs(Math.sqrt(Math.max(0, dot3(d, d) - along * along)) - radius));
    planeDev = Math.max(planeDev, Math.abs(dot3(sub3(q, OP), M)));
    axialDev = Math.max(axialDev, Math.abs(along));
  }
  const scale = Math.max(1, radius, height, a);
  if (radialDev > REL_TOL * scale || planeDev > REL_TOL * scale
      || axialDev > height / 2 + REL_TOL * scale
      || Math.abs(dot3(N, M) - g.sinTheta) > 1e-3
      || Math.abs(dot3(E1, M)) > 1e-3 || Math.abs(dot3(E1, N) - g.cosTheta) > 1e-3) {
    return { ok: false, error: '截面椭圆守恒失败（椭圆点不在柱面 / 不在截面 / 超出柱高）' };
  }

  // ---- 线段总数上限守护 ----
  const cylinderLines = flags.asCylinder ? 2 * segments + meridians : 0;
  const sectionLines = flags.asSection ? ellipseSegments + spokes : 0;
  const axisLines = flags.asAxes ? 2 : 0;
  const radiiLines = flags.asRadii ? 4 : 0;
  const rightAngleLines = flags.asRadii ? 2 : 0;
  const lineCount = cylinderLines + sectionLines + axisLines + radiiLines + rightAngleLines;
  if (lineCount > SECTIONCYLINDER3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SECTIONCYLINDER3D_MAX_SEGMENTS}` };
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

  // ---- 圆柱上下底圆 + 侧母线 ----
  if (flags.asCylinder) {
    const ring0 = [], ring1 = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const off = add3(mul3(g.h0, Math.cos(th) * radius), mul3(unit(cross3(n, g.h0)), Math.sin(th) * radius));
      ring0.push(r4Vec(add3(OB, off)));
      ring1.push(r4Vec(add3(OT, off)));
    }
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_b${i}`.slice(0, 64)), ring0[i], ring0[(i + 1) % segments], cylinderColor));
      items.push(mkLine(nextId(`${stem}_t${i}`.slice(0, 64)), ring1[i], ring1[(i + 1) % segments], cylinderColor));
    }
    const step = Math.max(1, Math.floor(segments / Math.max(1, meridians)));
    for (let i = 0; i < segments && items.length - 2 * segments < meridians; i += step) {
      items.push(mkLine(nextId(`${stem}_m${i}`.slice(0, 64)), ring0[i], ring1[i], cylinderColor));
    }
  }

  // ---- 截面椭圆环 + 辐条 ----
  if (flags.asSection) {
    for (let i = 0; i < ellipseSegments; i++) {
      items.push(mkLine(nextId(`${stem}_e${i}`.slice(0, 64)), ellipse[i], ellipse[(i + 1) % ellipseSegments], sectionColor));
    }
    const step = Math.max(1, Math.floor(ellipseSegments / Math.max(1, spokes)));
    for (let i = 0; i < ellipseSegments && spokes > 0; i += step) {
      items.push(mkLine(nextId(`${stem}_d${i}`.slice(0, 64)), OP, ellipse[i], sectionColor));
    }
  }

  // ---- 柱轴 + 截面法向示意 ----
  if (flags.asAxes) {
    items.push(mkLine(nextId(`${stem}_axis`.slice(0, 64)), OB, OT, axisColor));
    const tip = r4Vec(add3(OP, mul3(M, Math.min(1, b * 0.8))));
    items.push(mkLine(nextId(`${stem}_normal`.slice(0, 64)), OP, tip, axisColor));
  }

  // ---- 长/短轴半径 + 中心直角符号 ----
  if (flags.asRadii) {
    const A1 = r4Vec(add3(OP, mul3(E1, a)));
    const A2 = r4Vec(add3(OP, mul3(E1, -a)));
    const B1 = r4Vec(add3(OP, mul3(E2, b)));
    const B2 = r4Vec(add3(OP, mul3(E2, -b)));
    items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), OP, A1, sectionColor));
    items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), OP, A2, sectionColor));
    items.push(mkLine(nextId(`${stem}_rb1`.slice(0, 64)), OP, B1, sectionColor));
    items.push(mkLine(nextId(`${stem}_rb2`.slice(0, 64)), OP, B2, sectionColor));
    const s = Math.min(rightAngleSize, 0.4 * b);
    const Q1 = r4Vec(add3(OP, mul3(E1, s)));
    const Q2 = r4Vec(add3(Q1, mul3(E2, s)));
    const Q3 = r4Vec(add3(OP, mul3(E2, s)));
    items.push(mkLine(nextId(`${stem}_sq1`.slice(0, 64)), Q1, Q2, axisColor));
    items.push(mkLine(nextId(`${stem}_sq2`.slice(0, 64)), Q2, Q3, axisColor));
  }

  // ---- 小球：柱心、截面中心、上下底心、椭圆采样点 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pC`.slice(0, 64)), C, cylinderColor));
    items.push(mkPoint(nextId(`${stem}_pB`.slice(0, 64)), OB, cylinderColor));
    items.push(mkPoint(nextId(`${stem}_pT`.slice(0, 64)), OT, cylinderColor));
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), OP, sectionColor));
    const step = Math.max(1, Math.floor(ellipseSegments / 8));
    for (let i = 0; i < ellipseSegments; i += step) {
      items.push(mkPoint(nextId(`${stem}_pE${i}`.slice(0, 64)), ellipse[i], sectionColor));
    }
  }

  // ---- 标注 ----
  if (flags.labelRadius) {
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `r=${R}`, r4Vec(add3(OB, mul3(g.h0, radius)))));
  }
  if (flags.labelAngle) {
    items.push(mkLabel(nextId(`${stem}_lTh`.slice(0, 64)), `θ=${TH}°`, r4Vec(add3(OP, mul3(M, Math.min(1, b * 1.1))))));
  }
  if (flags.labelSemiMajor) {
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), `a=r/sinθ=${A}`, r4Vec(add3(OP, mul3(E1, a * 0.6)))));
  }
  if (flags.labelSemiMinor) {
    items.push(mkLabel(nextId(`${stem}_lB`.slice(0, 64)), `b=r=${B}`, r4Vec(add3(OP, mul3(E2, b * 0.6)))));
  }
  if (flags.labelArea) {
    items.push(mkLabel(nextId(`${stem}_lS`.slice(0, 64)), `S=πab=${S}`, r4Vec(add3(OP, mul3(N, Math.min(1, b * 0.5))))));
  }
  if (flags.labelRelation) {
    items.push(mkLabel(nextId(`${stem}_lRel`.slice(0, 64)), `a=r/sinθ，S=πr²/sinθ`, r4Vec(add3(OP, mul3(E1, -a * 0.6)))));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: C, axis: N, bottom: OB, top: OT, sectionCenter: OP,
      radius: R, height: H, angleDeg: TH, offset: OF,
      semiMajor: A, semiMinor: B, area: S, axialHalf: AH,
      basis: { n: N, m: M, e1: E1, e2: E2 },
      radialDev: r4(radialDev), planeDev: r4(planeDev), axialDev: r4(axialDev),
      segments, ellipseSegments, spokes, meridians, vertexSize, rightAngleSize,
      asCylinder: flags.asCylinder, asSection: flags.asSection, asAxes: flags.asAxes,
      asRadii: flags.asRadii, asPoints: flags.asPoints,
      pointCount: items.filter((it) => it.type === 'point').length,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor, cylinderColor, sectionColor, axisColor, labelColor, opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「球扇形 / 球锥（spheresector3d）」纯函数语义层（2026-11-27 D47 增量）
 *
 * 与 js/board3d-sphericalcap.js / -sectionsphere.js / -circumcircle.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一个球（球心 center + 半径 R）与沿轴 axis 的一段球冠高 h（0<h<2R），
 * 取出以球心 O 为锥顶、以球冠底圆为底、以球冠曲面为顶的「球扇形 / 球锥」，一次画出
 * 球三大圆 + 底圆面片 + 球心到锥底的直母线（圆锥母线）+ 球冠曲母线（经线弧）+ 轴线，
 * 并标出 R/d/h/a/S=2πRh+πaR/V。直接服务「球扇形的体积与表面积、球冠高与球心到截面距离关系」
 * 高考核心用例。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - sphericalcap3d：只画球冠那一块的体积/表面积（V_cap=πh²(3R−h)/3），不画球心锥面；
 *   - sectionsphere3d：只画截面圆与 r²+d²=R²，不出实体；
 *   - cone3d / conefrustum3d：直母线圆锥/圆台，锥顶任意，非球心为锥顶的球扇形；
 *   - revolve3d：整条母线回转面，取不出「球心锥面 + 球冠曲面」围成的那一块。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   正交标架：n=unit(axis)，u=unit(n×helper)，v=n×u（helper 取 z 轴、近平行时取 x 轴）。
 *   球冠高 h∈(0,2R)；截平面距球心 d=R−h（有向，沿 +n）；底圆圆心 O'=O+d·n；
 *   底半径 a=√(h(2R−h))=√(R²−d²)；底圆点 Q(θ)=O'+a(cosθ·u+sinθ·v) 满足 |Q−O|=R。
 *   锥顶为球心 O，直母线 O→Q 恒长 R；球冠曲母线（经线弧）沿 (n,w) 大圆从底圆点 Q 走到
 *   顶点 T=O+R·n，弧上点恒在球面。
 *   体积（两式交叉校验，对 h>R 亦成立）：
 *     V=2πR²h/3；V=V_cap+V_cone=πh²(3R−h)/3 + πa²(R−h)/3；且 V=R·S_cap/3。
 *   表面积：S_cap=2πRh（球冠曲面）+ S_cone=πaR（圆锥侧面，母线长 R）=2πRh+πaR。
 *   任一守恒失败（底圆点不在球面 / 不在截面 / 半径不恒为 a / 母线≠R / 体积两式不符 /
 *   V≠R·S_cap/3）整条拒绝，绝不画假球扇形。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_DISC_COLOR = '#e0a020';
const DEFAULT_CONE_COLOR = '#3aa675';
const DEFAULT_CAP_COLOR = '#d04040';
const DEFAULT_AXIS_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 半径 / 采样 / 小球区间与缺省 */
export const SPHERESECTOR3D_RADIUS_MIN = 0.01;
export const SPHERESECTOR3D_RADIUS_MAX = 10000;
export const SPHERESECTOR3D_RADIUS_DEFAULT = 2;
export const SPHERESECTOR3D_SEGMENTS_MIN = 8;
export const SPHERESECTOR3D_SEGMENTS_MAX = 512;
export const SPHERESECTOR3D_SEGMENTS_DEFAULT = 48;
export const SPHERESECTOR3D_MERIDIANS_MIN = 3;
export const SPHERESECTOR3D_MERIDIANS_MAX = 64;
export const SPHERESECTOR3D_MERIDIANS_DEFAULT = 8;
export const SPHERESECTOR3D_ARCSEG_MIN = 4;
export const SPHERESECTOR3D_ARCSEG_MAX = 128;
export const SPHERESECTOR3D_ARCSEG_DEFAULT = 12;
export const SPHERESECTOR3D_SPOKES_MIN = 0;
export const SPHERESECTOR3D_SPOKES_MAX = 32;
export const SPHERESECTOR3D_SPOKES_DEFAULT = 8;
export const SPHERESECTOR3D_VERTEX_SIZE_MIN = 0.01;
export const SPHERESECTOR3D_VERTEX_SIZE_MAX = 1;
export const SPHERESECTOR3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限 */
export const SPHERESECTOR3D_MAX_SEGMENTS = 4096;

/** 默认球心 / 法向轴 */
export const SPHERESECTOR3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const SPHERESECTOR3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

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
export function parseSectorPoint(v) {
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

/** 正交标架：n=unit(axis)，u=unit(n×helper)，v=n×u（helper 取 z 轴、近平行时取 x 轴） */
export function sectorFrame(axis) {
  const raw = axis === undefined ? SPHERESECTOR3D_DEFAULT_AXIS : axis;
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const vals = raw.map(num);
  if (vals.some((x) => x === null)) return null;
  const n = unit(vals);
  if (!n) return null;
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross3(n, helper));
  if (!u) return null;
  const v = unit(cross3(n, u));
  if (!v) return null;
  return { n, u, v };
}

/** 底圆半径 a=√(h(2R−h))，h 越界返回 null */
export function spheresectorBaseRadius(R, h) {
  if (!Number.isFinite(R) || !Number.isFinite(h) || h <= 0 || h >= 2 * R) return null;
  const a = Math.sqrt(h * (2 * R - h));
  return Number.isFinite(a) && a >= 0 ? a : null;
}

/** 球冠曲面面积 S_cap=2πRh */
export function spheresectorCapArea(R, h) {
  return 2 * Math.PI * R * h;
}

/** 球心圆锥侧面积 S_cone=πaR（母线长 R） */
export function spheresectorConeArea(R, a) {
  return Math.PI * a * R;
}

/** 球扇形体积 V=2πR²h/3 */
export function spheresectorVolume(R, h) {
  return 2 * Math.PI * R * R * h / 3;
}

/** 球冠体积 V_cap=πh²(3R−h)/3 */
export function spheresectorCapVolume(R, h) {
  return Math.PI * h * h * (3 * R - h) / 3;
}

/** 圆锥体积 V_cone=πa²d/3（d=R−h 有向，h>R 时为负）、V_cap+V_cone=V */
export function spheresectorConeVolume(a, d) {
  return Math.PI * a * a * d / 3;
}

/**
 * 球扇形纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center, radius, axis, height}
 * @returns {{ok:boolean,error?:string,...}|null} ok 时返回 center/radius/n/u/v/h/d/O'/a/
 *          apex/surface/surfaceCap/surfaceCone/volume/vCap/vCone 等
 */
export function spheresectorGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const O = cmd.center === undefined ? SPHERESECTOR3D_DEFAULT_CENTER : parseSectorPoint(cmd.center);
  if (!O) return { ok: false, error: 'center 需为合法 [x,y,z]' };

  const R = num(cmd.radius === undefined ? SPHERESECTOR3D_RADIUS_DEFAULT : cmd.radius);
  if (R === null) return { ok: false, error: 'radius 必须是数字' };
  if (R < SPHERESECTOR3D_RADIUS_MIN || R > SPHERESECTOR3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SPHERESECTOR3D_RADIUS_MIN}~${SPHERESECTOR3D_RADIUS_MAX}` };
  }

  const fr = sectorFrame(cmd.axis);
  if (!fr) return { ok: false, error: 'axis 需为非零三维向量' };
  const { n, u, v } = fr;

  const h = num(cmd.height === undefined ? R : cmd.height);
  if (h === null) return { ok: false, error: 'height 必须是数字' };
  if (h <= 1e-6 || h >= 2 * R - 1e-6) return { ok: false, error: 'height 需满足 0 < height < 2·radius' };

  const a = spheresectorBaseRadius(R, h);
  if (a === null) return { ok: false, error: '底圆半径退化' };
  const d = R - h;
  const baseCenter = add3(O, mul3(n, d));
  const apex = add3(O, mul3(n, R));

  const surfaceCap = spheresectorCapArea(R, h);
  const surfaceCone = spheresectorConeArea(R, a);
  const surface = surfaceCap + surfaceCone;
  const volume = spheresectorVolume(R, h);
  const vCap = spheresectorCapVolume(R, h);
  const vCone = spheresectorConeVolume(a, d);

  // 二阶交叉校验：a²=h(2R−h)、V=V_cap+V_cone、V=R·S_cap/3
  const expectAsq = h * (2 * R - h);
  if (Math.abs(a * a - expectAsq) > 0.01 * Math.max(1, Math.abs(expectAsq))) {
    return { ok: false, error: '底半径 a²=h(2R−h) 交叉校验失败' };
  }
  if (Math.abs(volume - (vCap + vCone)) > 0.01 * Math.max(1, Math.abs(volume))) {
    return { ok: false, error: '体积 V=V_cap+V_cone 交叉校验失败' };
  }
  if (Math.abs(volume - R * surfaceCap / 3) > 0.01 * Math.max(1, Math.abs(volume))) {
    return { ok: false, error: '体积 V=R·S_cap/3 交叉校验失败' };
  }

  return {
    ok: true, center: O, radius: R, n, u, v, h, d, a, baseCenter, apex,
    surfaceCap, surfaceCone, surface, volume, vCap, vCone,
  };
}

/**
 * 解析一条 spheresector3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"spheresector3d","id":"sec","center":[0,0,0],"radius":2,"axis":[0,0,1],"height":1,
 *    "segments":48,"meridians":8,"arcSegments":12,"spokes":8,
 *    "asSphere":true,"asDisc":true,"asCircle":true,"asCone":true,"asCap":true,"asAxis":true,"asPoints":false,
 *    "labelRadius":true,"labelDistance":true,"labelHeight":true,"labelBaseRadius":true,
 *    "labelVolume":true,"labelArea":true,"vertexSize":0.1,"color":"#2b7fd4"}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSpheresector3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'ss' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const g = spheresectorGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 采样 / 母线 / 弧段 / 辐条 / 小球整数参数 ----
  const intParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${name} 需为 ${min}~${max} 的整数` };
    return { value: v };
  };
  const sp = intParam('segments', SPHERESECTOR3D_SEGMENTS_DEFAULT, SPHERESECTOR3D_SEGMENTS_MIN, SPHERESECTOR3D_SEGMENTS_MAX);
  if (sp.error) return { ok: false, error: sp.error };
  const me = intParam('meridians', SPHERESECTOR3D_MERIDIANS_DEFAULT, SPHERESECTOR3D_MERIDIANS_MIN, SPHERESECTOR3D_MERIDIANS_MAX);
  if (me.error) return { ok: false, error: me.error };
  const as = intParam('arcSegments', SPHERESECTOR3D_ARCSEG_DEFAULT, SPHERESECTOR3D_ARCSEG_MIN, SPHERESECTOR3D_ARCSEG_MAX);
  if (as.error) return { ok: false, error: as.error };
  const sk = intParam('spokes', SPHERESECTOR3D_SPOKES_DEFAULT, SPHERESECTOR3D_SPOKES_MIN, SPHERESECTOR3D_SPOKES_MAX);
  if (sk.error) return { ok: false, error: sk.error };
  const segments = sp.value, meridians = me.value, arcSegments = as.value, spokes = sk.value;

  const vsRaw = num(cmd.vertexSize === undefined ? SPHERESECTOR3D_VERTEX_SIZE_DEFAULT : cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SPHERESECTOR3D_VERTEX_SIZE_MIN || vsRaw > SPHERESECTOR3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SPHERESECTOR3D_VERTEX_SIZE_MIN}~${SPHERESECTOR3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 布尔开关 ----
  const boolFields = [
    'asSphere', 'asDisc', 'asCircle', 'asCone', 'asCap', 'asAxis', 'asPoints',
    'labelRadius', 'labelDistance', 'labelHeight', 'labelBaseRadius', 'labelVolume', 'labelArea',
  ];
  const boolDefaults = {
    asSphere: true, asDisc: true, asCircle: true, asCone: true, asCap: true, asAxis: true, asPoints: false,
    labelRadius: true, labelDistance: true, labelHeight: true, labelBaseRadius: true,
    labelVolume: true, labelArea: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asSphere', 'asDisc', 'asCircle', 'asCone', 'asCap', 'asAxis'].some((f) => flags[f])) {
    return { ok: false, error: 'asSphere / asDisc / asCircle / asCone / asCap / asAxis 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'discColor', 'coneColor', 'capColor', 'axisColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const discColor = color(cmd.discColor, DEFAULT_DISC_COLOR);
  const coneColor = color(cmd.coneColor, DEFAULT_CONE_COLOR);
  const capColor = color(cmd.capColor, DEFAULT_CAP_COLOR);
  const axisColor = color(cmd.axisColor, DEFAULT_AXIS_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整后的输出几何 ----
  const O = r4Vec(g.center);
  const N = r4Vec(g.n), U = r4Vec(g.u), V = r4Vec(g.v);
  const R = r4(g.radius), H = r4(g.h), A = r4(g.a), D = r4(g.d);
  const SCAP = r4(g.surfaceCap), SCONE = r4(g.surfaceCone), SURF = r4(g.surface), VOL = r4(g.volume);
  const VC = r4(g.vCap), VN = r4(g.vCone);

  // 底圆采样（全精度算、取整输出）
  const circlePts = [];
  for (let i = 0; i < segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    const c = Math.cos(th) * g.a, s = Math.sin(th) * g.a;
    circlePts.push(r4Vec([
      g.baseCenter[0] + c * g.u[0] + s * g.v[0],
      g.baseCenter[1] + c * g.u[1] + s * g.v[1],
      g.baseCenter[2] + c * g.u[2] + s * g.v[2],
    ]));
  }
  const baseO = r4Vec(g.baseCenter);
  const apex = r4Vec(g.apex);

  // 球冠曲母线（经线弧）：过底圆点沿 (n,w) 大圆从轴角 φ0 走到顶点 φ=0，弧上点恒在球面
  const capArcs = [];
  for (let m = 0; m < meridians; m++) {
    const th = (2 * Math.PI * m) / meridians;
    const c = Math.cos(th), s = Math.sin(th);
    const radial = [c * g.u[0] + s * g.v[0], c * g.u[1] + s * g.v[1], c * g.u[2] + s * g.v[2]];
    const w = unit(radial);
    if (!w) continue;
    const phi0 = Math.acos(Math.max(-1, Math.min(1, g.d / g.radius)));
    const arc = [];
    for (let k = 0; k <= arcSegments; k++) {
      const phi = phi0 * (1 - k / arcSegments);
      const sp2 = Math.sin(phi) * g.radius, cp = Math.cos(phi) * g.radius;
      arc.push(r4Vec([
        g.center[0] + sp2 * w[0] + cp * g.n[0],
        g.center[1] + sp2 * w[1] + cp * g.n[1],
        g.center[2] + sp2 * w[2] + cp * g.n[2],
      ]));
    }
    capArcs.push(arc);
  }

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let sphereDev = 0, planeDev = 0, radiusDev = 0, generatorDev = 0, arcDev = 0;
  for (const q of circlePts) {
    sphereDev = Math.max(sphereDev, Math.abs(len3(sub3(q, O)) - R));
    planeDev = Math.max(planeDev, Math.abs(dot3(sub3(q, baseO), N)));
    radiusDev = Math.max(radiusDev, Math.abs(len3(sub3(q, baseO)) - A));
    generatorDev = Math.max(generatorDev, Math.abs(len3(sub3(q, O)) - R)); // 锥母线 O→Q 恒长 R
  }
  for (const arc of capArcs) for (const q of arc) arcDev = Math.max(arcDev, Math.abs(len3(sub3(q, O)) - R));
  const scale = Math.max(1, R);
  if (sphereDev > REL_TOL * scale || planeDev > REL_TOL * scale || radiusDev > REL_TOL * scale
      || generatorDev > REL_TOL * scale || arcDev > REL_TOL * scale) {
    return { ok: false, error: '球扇形守恒失败（底圆点不在球面 / 不在截面 / 半径不恒为 a / 锥母线≠R / 弧点不在球面）' };
  }

  // ---- 线段总数上限守护 ----
  const greatCircleLines = flags.asSphere ? 3 * segments : 0;
  const discLines = flags.asDisc ? spokes : 0;
  const circleLines = flags.asCircle ? segments : 0;
  const coneLines = flags.asCone ? meridians : 0;
  const capLines = flags.asCap ? capArcs.length * arcSegments : 0;
  const axisLines = flags.asAxis ? 1 : 0;
  const lineCount = greatCircleLines + discLines + circleLines + coneLines + capLines + axisLines;
  if (lineCount > SPHERESECTOR3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SPHERESECTOR3D_MAX_SEGMENTS}` };
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

  // ---- 球三大圆（浅色骨架） ----
  if (flags.asSphere) {
    const greatPlanes = [[g.n, g.u], [g.n, g.v], [g.u, g.v]];
    greatPlanes.forEach(([e1, e2], pi) => {
      const pts = [];
      for (let i = 0; i < segments; i++) {
        const th = (2 * Math.PI * i) / segments;
        const c = Math.cos(th) * g.radius, s = Math.sin(th) * g.radius;
        pts.push(r4Vec([
          g.center[0] + c * e1[0] + s * e2[0],
          g.center[1] + c * e1[1] + s * e2[1],
          g.center[2] + c * e1[2] + s * e2[2],
        ]));
      }
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_sph${pi}_${i}`.slice(0, 64)), pts[i], pts[(i + 1) % segments]));
      }
    });
  }

  // ---- 底圆面片（圆 + 辐条，线框表示面片） ----
  if (flags.asCircle) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_cir_${i}`.slice(0, 64)), circlePts[i], circlePts[(i + 1) % segments], discColor));
    }
  }
  if (flags.asDisc && spokes > 0) {
    const step = Math.max(1, Math.floor(segments / spokes));
    for (let i = 0; i < segments; i += step) {
      items.push(mkLine(nextId(`${stem}_spk_${i}`.slice(0, 64)), baseO, circlePts[i], discColor));
    }
  }

  // ---- 球心直母线（圆锥母线）：球心 O → 底圆采样点，恒长 R ----
  if (flags.asCone) {
    for (let m = 0; m < meridians; m++) {
      const th = (2 * Math.PI * m) / meridians;
      const idx = Math.round((th / (2 * Math.PI)) * segments) % segments;
      items.push(mkLine(nextId(`${stem}_cone${m}`.slice(0, 64)), O, circlePts[idx], coneColor));
    }
  }

  // ---- 球冠曲母线（经线弧） ----
  if (flags.asCap) {
    capArcs.forEach((arc, mi) => {
      for (let k = 0; k < arcSegments; k++) {
        items.push(mkLine(nextId(`${stem}_cap${mi}_${k}`.slice(0, 64)), arc[k], arc[k + 1], capColor));
      }
    });
  }

  // ---- 轴线：球心 → 顶点（沿 +n） ----
  if (flags.asAxis) {
    items.push(mkLine(nextId(`${stem}_ax`.slice(0, 64)), O, apex, axisColor));
  }

  // ---- 小球：球心、顶点、底圆心、底圆采样点（每 segments/8 取一） ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O, axisColor));
    items.push(mkPoint(nextId(`${stem}_pT`.slice(0, 64)), apex, capColor));
    items.push(mkPoint(nextId(`${stem}_pC`.slice(0, 64)), baseO, discColor));
    const step = Math.max(1, Math.floor(segments / 8));
    for (let i = 0; i < segments; i += step) {
      items.push(mkPoint(nextId(`${stem}_pQ_${i}`.slice(0, 64)), circlePts[i]));
    }
  }

  // ---- 标注 ----
  if (flags.labelRadius) {
    const rMid = r4Vec([0, 1, 2].map((k) => (O[k] + apex[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rMid));
  }
  if (flags.labelDistance) {
    const mid = r4Vec([0, 1, 2].map((k) => (O[k] + baseO[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lD`.slice(0, 64)), `d=${D}`, mid));
  }
  if (flags.labelHeight) {
    const mid = r4Vec([0, 1, 2].map((k) => (baseO[k] + apex[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lH`.slice(0, 64)), `h=${H}`, mid));
  }
  if (flags.labelBaseRadius) {
    const q = circlePts[Math.floor(segments / 4)];
    const mid = r4Vec([0, 1, 2].map((k) => (baseO[k] + q[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), `a=${A}`, mid));
  }
  if (flags.labelVolume) {
    items.push(mkLabel(nextId(`${stem}_lV`.slice(0, 64)), `V=${VOL}`, apex));
  }
  if (flags.labelArea) {
    const q = circlePts[Math.floor(segments / 2)];
    const mid = r4Vec([0, 1, 2].map((k) => (baseO[k] + q[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lS`.slice(0, 64)), `S=${SURF}`, mid));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: O.slice(), radius: R,
      normal: N.slice(), basis: { u: U.slice(), v: V.slice(), n: N.slice() },
      height: H, distance: D, baseRadius: A,
      surfaceCap: SCAP, surfaceCone: SCONE, surface: SURF,
      volume: VOL, capVolume: VC, coneVolume: VN,
      sphereMaxDev: r4(sphereDev), planeMaxDev: r4(planeDev),
      radiusMaxDev: r4(radiusDev), generatorMaxDev: r4(generatorDev), arcMaxDev: r4(arcDev),
      segments, meridians, arcSegments, spokes, vertexSize,
      asSphere: flags.asSphere, asDisc: flags.asDisc, asCircle: flags.asCircle,
      asCone: flags.asCone, asCap: flags.asCap, asAxis: flags.asAxis, asPoints: flags.asPoints,
      pointCount: items.filter((it) => it.type === 'point').length,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor, discColor, coneColor, capColor, axisColor, labelColor, opacity: lineOpacity,
    },
  };
}

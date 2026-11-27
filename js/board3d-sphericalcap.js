/**
 * 立体画板「球冠 / 球缺 / 球台（sphericalcap3d）」纯函数语义层（2026-11-27 D46 增量）
 *
 * 与 js/board3d-sectionsphere.js / -circumcircle.js / -circumsphere.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一个球（球心 center + 半径 R）与一个（或两个平行）截平面，沿法向 axis 取出
 * 「球冠 / 球缺（单底，mode='cap'）」或「球台（双底，mode='zone'）」，一次画出球三大圆
 * + 截面圆盘（圆 + 辐条）+ 冠体母线（经线弧）+ 轴线 + 顶点/底面圆心，并标出 R/d/h/a/V/S，
 * 直接服务「球冠 / 球缺 / 球台的体积与表面积、球心到截面距离与冠高的关系」高考核心用例。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - sectionsphere3d：画的是「平面截球所得截面圆 + r²+d²=R²」，不出冠体轮廓、也不算体积/表面积；
 *   - sphere 内置图元 / revolve3d：画整个球或整条母线回转面，取不出「被平面截下的那一块」；
 *   - circumsphere3d/insphere3d/euler3d：只反求球，不做截切；
 *   - conefrustum3d：是圆锥的圆台（直母线），非球面的球台（曲母线）。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   正交标架：n=unit(axis)，u=unit(n×helper)，v=n×u（helper 取 z 轴，n≈±z 时取 x 轴）。
 *   截平面 P(d)：过 O'=O+d·n、法向 n、|d|<R；底圆半径 a=√(R²−d²)；
 *             圆上点 Q(θ)=O'+a(cosθ·u+sinθ·v)，满足 |Q−O|=R、(Q−O')·n=0、|Q−O'|=a。
 *   cap 模式（单截平面 d=height，冠体在 +n 侧、顶点 O+R·n）：
 *     冠高 h=R−d；底半径 a=√(R²−d²)=√(h(2R−h))；
 *     曲面面积 S=2πRh；体积 V=πh²(3R−h)/3=πh(3a²+h²)/6。
 *   zone 模式（两平行截平面 height1<height2，球台夹在中间）：
 *     台高 h=d2−d1；两底半径 a1=√(R²−d1²)、a2=√(R²−d2²)；
 *     曲面面积 S=2πRh；体积 V=πh(3a1²+3a2²+h²)/6。
 *     令 a2=0、d2=R 即退化为 cap 公式，两套体积式统一。
 *   经线弧（冠体曲母线）：过底圆点 Q、沿 (n,w) 平面（w=unit(Q−O')）在大圆上从轴角 φ0
 *     走到顶点 φ=0：P(φ)=O+R(sinφ·w+cosφ·n)，cosφ0=d/R、sinφ0=a/R；弧上点恒在球面。
 *   任一守恒失败（底圆点不在球面 / 不在截面 / 半径不符 / a²≠h(2R−h) / V·S 两式不符）
 *   整条拒绝，绝不画假冠体。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_DISC_COLOR = '#e0a020';
const DEFAULT_MERIDIAN_COLOR = '#3aa675';
const DEFAULT_AXIS_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 半径 / 截距 / 采样区间与缺省 */
export const SPHERICALCAP3D_RADIUS_MIN = 0.01;
export const SPHERICALCAP3D_RADIUS_MAX = 10000;
export const SPHERICALCAP3D_RADIUS_DEFAULT = 2;
export const SPHERICALCAP3D_SEGMENTS_MIN = 8;
export const SPHERICALCAP3D_SEGMENTS_MAX = 512;
export const SPHERICALCAP3D_SEGMENTS_DEFAULT = 48;
export const SPHERICALCAP3D_MERIDIANS_MIN = 3;
export const SPHERICALCAP3D_MERIDIANS_MAX = 64;
export const SPHERICALCAP3D_MERIDIANS_DEFAULT = 8;
export const SPHERICALCAP3D_ARCSEG_MIN = 4;
export const SPHERICALCAP3D_ARCSEG_MAX = 128;
export const SPHERICALCAP3D_ARCSEG_DEFAULT = 12;
export const SPHERICALCAP3D_SPOKES_MIN = 0;
export const SPHERICALCAP3D_SPOKES_MAX = 32;
export const SPHERICALCAP3D_SPOKES_DEFAULT = 8;
export const SPHERICALCAP3D_VERTEX_SIZE_MIN = 0.01;
export const SPHERICALCAP3D_VERTEX_SIZE_MAX = 1;
export const SPHERICALCAP3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限 */
export const SPHERICALCAP3D_MAX_SEGMENTS = 4096;

/** 默认球心 / 法向轴 */
export const SPHERICALCAP3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const SPHERICALCAP3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

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
export function parseCapPoint(v) {
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
export function capFrame(axis) {
  const raw = axis === undefined ? SPHERICALCAP3D_DEFAULT_AXIS : axis;
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

/** 底圆半径 a=√(R²−d²)，d 过敏 / 越界返回 null */
export function sphericalcapBaseRadius(R, d) {
  if (!Number.isFinite(R) || !Number.isFinite(d) || Math.abs(d) >= R) return null;
  const a = Math.sqrt(R * R - d * d);
  return Number.isFinite(a) && a >= 0 ? a : null;
}

/** 球冠曲面面积 S=2πRh */
export function sphericalcapArea(R, h) {
  return 2 * Math.PI * R * h;
}

/** 球缺/球台体积 V=πh(3a1²+3a2²+h²)/6（cap 令 a2=0 亦成立） */
export function sphericalcapVolume(h, a1, a2 = 0) {
  return Math.PI * h * (3 * a1 * a1 + 3 * a2 * a2 + h * h) / 6;
}

/**
 * 球冠/球台纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center, radius, axis, mode:'cap'|'zone', height | height1+height2}
 * @returns {{ok:boolean,error?:string,...}|null} ok 时返回 center/radius/n/u/v/mode/d1/d2/h/
 *          bases:[{d,O,a}]/a1/a2/a/surface/volume/apex/bottom 等
 */
export function sphericalcapGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const O = cmd.center === undefined ? SPHERICALCAP3D_DEFAULT_CENTER : parseCapPoint(cmd.center);
  if (!O) return { ok: false, error: 'center 需为合法 [x,y,z]' };

  const R = num(cmd.radius === undefined ? SPHERICALCAP3D_RADIUS_DEFAULT : cmd.radius);
  if (R === null) return { ok: false, error: 'radius 必须是数字' };
  if (R < SPHERICALCAP3D_RADIUS_MIN || R > SPHERICALCAP3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SPHERICALCAP3D_RADIUS_MIN}~${SPHERICALCAP3D_RADIUS_MAX}` };
  }

  const fr = capFrame(cmd.axis);
  if (!fr) return { ok: false, error: 'axis 需为非零三维向量' };
  const { n, u, v } = fr;

  const mode = cmd.mode === undefined ? 'cap' : cmd.mode;
  if (mode !== 'cap' && mode !== 'zone') return { ok: false, error: "mode 只能是 'cap' 或 'zone'" };

  let d1, d2;
  if (mode === 'cap') {
    d1 = num(cmd.height === undefined ? 0 : cmd.height);
    if (d1 === null) return { ok: false, error: 'height 必须是数字' };
    if (Math.abs(d1) >= R) return { ok: false, error: '|height| 必须小于 radius（截平面须与球相交）' };
    d2 = R; // 顶点平面
  } else {
    d1 = num(cmd.height1);
    d2 = num(cmd.height2);
    if (d1 === null || d2 === null) return { ok: false, error: 'zone 模式需给 height1 与 height2' };
    if (Math.abs(d1) >= R || Math.abs(d2) >= R) return { ok: false, error: 'zone 两截平面 |height| 必须小于 radius' };
    if (!(d1 < d2)) return { ok: false, error: 'zone 需满足 height1 < height2' };
  }

  const a1 = sphericalcapBaseRadius(R, d1);
  if (a1 === null) return { ok: false, error: '下底圆半径退化' };
  // cap 顶点底半径为 0；zone 上底用 a2
  const a2 = mode === 'cap' ? 0 : sphericalcapBaseRadius(R, d2);
  if (a2 === null) return { ok: false, error: '上底圆半径退化' };

  const h = mode === 'cap' ? R - d1 : d2 - d1;
  if (!(h > 1e-6) || !Number.isFinite(h)) return { ok: false, error: '冠高/台高退化' };

  // 二阶交叉校验：a² = h(2R−h)（cap，等价于 R²−d²）；V 两式一致
  const expectA1sq = h * (2 * R - h); // cap 直接校验；zone 见下方逐底校验
  let crossOk = true;
  if (mode === 'cap') {
    crossOk = Math.abs(a1 * a1 - expectA1sq) <= 0.01 * Math.max(1, Math.abs(expectA1sq));
  } else {
    // zone：两底半径分别满足 a_i²=R²−d_i²，且台高=d2−d1
    crossOk = Math.abs(a1 * a1 - (R * R - d1 * d1)) <= 0.01 * Math.max(1, R * R)
      && Math.abs(a2 * a2 - (R * R - d2 * d2)) <= 0.01 * Math.max(1, R * R)
      && Math.abs(h - (d2 - d1)) < 1e-9;
  }
  if (!crossOk) return { ok: false, error: '底半径 / 冠高二阶交叉校验失败' };

  const surface = sphericalcapArea(R, h); // 2πRh
  const volume = sphericalcapVolume(h, a1, a2); // πh(3a1²+3a2²+h²)/6
  // cap 专属交叉校验：V 还应等于 πh²(3R−h)/3
  if (mode === 'cap') {
    const v2 = Math.PI * h * h * (3 * R - h) / 3;
    if (Math.abs(volume - v2) > 0.01 * Math.max(1, Math.abs(v2))) {
      return { ok: false, error: '球冠体积两式不符（V=πh²(3R−h)/3）' };
    }
  }

  const bases = [{ d: d1, O: add3(O, mul3(n, d1)), a: a1 }];
  if (mode === 'zone') bases.push({ d: d2, O: add3(O, mul3(n, d2)), a: a2 });

  return {
    ok: true, center: O, radius: R, n, u, v, mode, d1, d2, h,
    bases, a1, a2, a: a1, surface, volume,
    apex: add3(O, mul3(n, R)), bottom: sub3(O, mul3(n, R)),
  };
}

/**
 * 解析一条 sphericalcap3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"sphericalcap3d","id":"cap","center":[0,0,0],"radius":2,"axis":[0,0,1],"height":1,
 *    "mode":"cap","segments":48,"meridians":8,"arcSegments":12,"spokes":8,
 *    "asSphere":true,"asDisc":true,"asCircle":true,"asMeridians":true,"asAxis":true,"asPoints":false,
 *    "labelRadius":true,"labelDistance":true,"labelHeight":true,"labelBaseRadius":true,
 *    "labelVolume":true,"labelArea":true,"vertexSize":0.1,"color":"#2b7fd4"}
 *   - mode='zone' 时改用 height1 / height2 两个截平面高度。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSphericalcap3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'cap' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const g = sphericalcapGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 采样 / 母线 / 弧段 / 辐条 / 小球整数参数 ----
  const intParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${name} 需为 ${min}~${max} 的整数` };
    return { value: v };
  };
  const sp = intParam('segments', SPHERICALCAP3D_SEGMENTS_DEFAULT, SPHERICALCAP3D_SEGMENTS_MIN, SPHERICALCAP3D_SEGMENTS_MAX);
  if (sp.error) return { ok: false, error: sp.error };
  const me = intParam('meridians', SPHERICALCAP3D_MERIDIANS_DEFAULT, SPHERICALCAP3D_MERIDIANS_MIN, SPHERICALCAP3D_MERIDIANS_MAX);
  if (me.error) return { ok: false, error: me.error };
  const as = intParam('arcSegments', SPHERICALCAP3D_ARCSEG_DEFAULT, SPHERICALCAP3D_ARCSEG_MIN, SPHERICALCAP3D_ARCSEG_MAX);
  if (as.error) return { ok: false, error: as.error };
  const sk = intParam('spokes', SPHERICALCAP3D_SPOKES_DEFAULT, SPHERICALCAP3D_SPOKES_MIN, SPHERICALCAP3D_SPOKES_MAX);
  if (sk.error) return { ok: false, error: sk.error };
  const segments = sp.value, meridians = me.value, arcSegments = as.value, spokes = sk.value;

  const vsRaw = num(cmd.vertexSize === undefined ? SPHERICALCAP3D_VERTEX_SIZE_DEFAULT : cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SPHERICALCAP3D_VERTEX_SIZE_MIN || vsRaw > SPHERICALCAP3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SPHERICALCAP3D_VERTEX_SIZE_MIN}~${SPHERICALCAP3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 布尔开关 ----
  const boolFields = [
    'asSphere', 'asDisc', 'asCircle', 'asMeridians', 'asAxis', 'asPoints',
    'labelRadius', 'labelDistance', 'labelHeight', 'labelBaseRadius', 'labelVolume', 'labelArea',
  ];
  const boolDefaults = {
    asSphere: true, asDisc: true, asCircle: true, asMeridians: true, asAxis: true, asPoints: false,
    labelRadius: true, labelDistance: true, labelHeight: true, labelBaseRadius: true,
    labelVolume: true, labelArea: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asSphere', 'asDisc', 'asCircle', 'asMeridians', 'asAxis'].some((f) => flags[f])) {
    return { ok: false, error: 'asSphere / asDisc / asCircle / asMeridians / asAxis 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'discColor', 'meridianColor', 'axisColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const discColor = color(cmd.discColor, DEFAULT_DISC_COLOR);
  const meridianColor = color(cmd.meridianColor, DEFAULT_MERIDIAN_COLOR);
  const axisColor = color(cmd.axisColor, DEFAULT_AXIS_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整后的输出几何 ----
  const O = r4Vec(g.center);
  const N = r4Vec(g.n), U = r4Vec(g.u), V = r4Vec(g.v);
  const R = r4(g.radius), H = r4(g.h), A1 = r4(g.a1), A2 = r4(g.a2);
  const SURF = r4(g.surface), VOL = r4(g.volume);
  const d1 = r4(g.d1);

  // 底圆采样（全精度算、取整输出）
  const circlePts = g.bases.map((b) => {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const c = Math.cos(th) * b.a, s = Math.sin(th) * b.a;
      pts.push(r4Vec([
        b.O[0] + c * g.u[0] + s * g.v[0],
        b.O[1] + c * g.u[1] + s * g.v[1],
        b.O[2] + c * g.u[2] + s * g.v[2],
      ]));
    }
    return pts;
  });

  // 经线弧：过每个底圆点，沿 (n,w) 大圆从轴角 φ0 走到顶点 φ=0（cap）/另一底 φ2（zone）
  const meridianArcs = [];
  for (let m = 0; m < meridians; m++) {
    const th = (2 * Math.PI * m) / meridians;
    const c = Math.cos(th), s = Math.sin(th);
    const radial = [c * g.u[0] + s * g.v[0], c * g.u[1] + s * g.v[1], c * g.u[2] + s * g.v[2]];
    const w = unit(radial);
    if (!w) continue;
    const cosPhi1 = g.d1 / g.radius;
    const phi1 = Math.acos(Math.max(-1, Math.min(1, cosPhi1)));
    const phi2 = g.mode === 'cap' ? 0 : Math.acos(Math.max(-1, Math.min(1, g.d2 / g.radius)));
    const arc = [];
    for (let k = 0; k <= arcSegments; k++) {
      const phi = phi1 + (phi2 - phi1) * (k / arcSegments);
      const sp2 = Math.sin(phi) * g.radius, cp = Math.cos(phi) * g.radius;
      arc.push(r4Vec([
        g.center[0] + sp2 * w[0] + cp * g.n[0],
        g.center[1] + sp2 * w[1] + cp * g.n[1],
        g.center[2] + sp2 * w[2] + cp * g.n[2],
      ]));
    }
    meridianArcs.push(arc);
  }

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let sphereDev = 0, planeDev = 0, radiusDev = 0, meridianDev = 0;
  g.bases.forEach((b, bi) => {
    for (const q of circlePts[bi]) {
      sphereDev = Math.max(sphereDev, Math.abs(len3(sub3(q, O)) - R));
      planeDev = Math.max(planeDev, Math.abs(dot3(sub3(q, r4Vec(b.O)), N)));
      radiusDev = Math.max(radiusDev, Math.abs(len3(sub3(q, r4Vec(b.O))) - (bi === 0 ? A1 : A2)));
    }
  });
  for (const arc of meridianArcs) for (const q of arc) sphereDev = Math.max(sphereDev, Math.abs(len3(sub3(q, O)) - R));
  meridianDev = sphereDev;
  const scale = Math.max(1, R);
  if (sphereDev > REL_TOL * scale || planeDev > REL_TOL * scale || radiusDev > REL_TOL * scale) {
    return { ok: false, error: '球冠守恒失败（底圆点不在球面 / 不在截面 / 半径不恒为 a）' };
  }

  // ---- 线段总数上限守护 ----
  const greatCircleLines = flags.asSphere ? 3 * segments : 0;
  const discLines = flags.asDisc ? spokes : 0;
  const circleLines = flags.asCircle ? g.bases.length * segments : 0;
  const meridianLines = flags.asMeridians ? meridianArcs.length * arcSegments : 0;
  const axisLines = flags.asAxis ? 1 : 0;
  const lineCount = greatCircleLines + discLines + circleLines + meridianLines + axisLines;
  if (lineCount > SPHERICALCAP3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SPHERICALCAP3D_MAX_SEGMENTS}` };
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

  // ---- 截面圆盘（圆 + 辐条，线框表示面片） ----
  g.bases.forEach((b, bi) => {
    const pts = circlePts[bi];
    if (flags.asCircle) {
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_cir${bi}_${i}`.slice(0, 64)), pts[i], pts[(i + 1) % segments], discColor));
      }
    }
    if (flags.asDisc && spokes > 0) {
      const bO = r4Vec(b.O);
      const step = Math.max(1, Math.floor(segments / spokes));
      for (let i = 0; i < segments; i += step) {
        items.push(mkLine(nextId(`${stem}_spk${bi}_${i}`.slice(0, 64)), bO, pts[i], discColor));
      }
    }
  });

  // ---- 经线弧（冠体曲母线） ----
  if (flags.asMeridians) {
    meridianArcs.forEach((arc, mi) => {
      for (let k = 0; k < arcSegments; k++) {
        items.push(mkLine(nextId(`${stem}_mer${mi}_${k}`.slice(0, 64)), arc[k], arc[k + 1], meridianColor));
      }
    });
  }

  // ---- 轴线：球心 → 顶点（沿 +n） ----
  if (flags.asAxis) {
    items.push(mkLine(nextId(`${stem}_ax`.slice(0, 64)), O, r4Vec(g.apex), axisColor));
  }

  // ---- 小球：球心、顶点、各底圆心、底圆采样点（每 segments/8 取一） ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O, axisColor));
    items.push(mkPoint(nextId(`${stem}_pT`.slice(0, 64)), r4Vec(g.apex), meridianColor));
    g.bases.forEach((b, bi) => {
      items.push(mkPoint(nextId(`${stem}_pC${bi}`.slice(0, 64)), r4Vec(b.O), discColor));
      const step = Math.max(1, Math.floor(segments / 8));
      for (let i = 0; i < segments; i += step) {
        items.push(mkPoint(nextId(`${stem}_pQ${bi}_${i}`.slice(0, 64)), circlePts[bi][i]));
      }
    });
  }

  // ---- 标注 ----
  if (flags.labelRadius) {
    const rMid = r4Vec([0, 1, 2].map((k) => (O[k] + (g.mode === 'cap' ? g.apex[k] : r4Vec(g.bases[1].O)[k])) / 2));
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rMid));
  }
  if (flags.labelDistance) {
    const bO = r4Vec(g.bases[0].O);
    const mid = r4Vec([0, 1, 2].map((k) => (O[k] + bO[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lD`.slice(0, 64)), `${g.mode === 'zone' ? 'd1' : 'd'}=${d1}`, mid));
  }
  if (flags.labelHeight) {
    const mid = r4Vec([0, 1, 2].map((k) => (r4Vec(g.bases[0].O)[k] + r4Vec(g.apex)[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lH`.slice(0, 64)), `${g.mode === 'zone' ? 'h(台高)' : 'h(冠高)'}=${H}`, mid));
  }
  if (flags.labelBaseRadius) {
    const bO = r4Vec(g.bases[0].O);
    const q = circlePts[0][Math.floor(segments / 4)];
    const mid = r4Vec([0, 1, 2].map((k) => (bO[k] + q[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), `${g.mode === 'zone' ? 'a1' : 'a'}=${A1}`, mid));
  }
  if (flags.labelVolume) {
    items.push(mkLabel(nextId(`${stem}_lV`.slice(0, 64)), `V=${VOL}`, r4Vec(g.apex)));
  }
  if (flags.labelArea) {
    const bO = r4Vec(g.bases[0].O);
    const q = circlePts[0][Math.floor(segments / 2)];
    const mid = r4Vec([0, 1, 2].map((k) => (bO[k] + q[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lS`.slice(0, 64)), `S=${SURF}`, mid));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: O.slice(), radius: R,
      normal: N.slice(), basis: { u: U.slice(), v: V.slice(), n: N.slice() },
      mode: g.mode, distance: d1, distance2: r4(g.d2), height: H,
      baseRadius: A1, baseRadius2: A2,
      surface: SURF, volume: VOL,
      sphereMaxDev: r4(sphereDev), planeMaxDev: r4(planeDev),
      radiusMaxDev: r4(radiusDev), meridianMaxDev: r4(meridianDev),
      segments, meridians, arcSegments, spokes, vertexSize,
      asSphere: flags.asSphere, asDisc: flags.asDisc, asCircle: flags.asCircle,
      asMeridians: flags.asMeridians, asAxis: flags.asAxis, asPoints: flags.asPoints,
      pointCount: flags.asPoints ? 2 + g.bases.length * (1 + Math.ceil(segments / Math.max(1, Math.floor(segments / 8)))) : 0,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor, discColor, meridianColor, axisColor, labelColor, opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「球楔 / 球瓣（sphericalwedge3d）」纯函数语义层（2026-11-28 D48 增量）
 *
 * 与 js/board3d-spheresector.js / -sphericalcap.js / -sectionsphere.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一个球（球心 center + 半径 R）与一条公共棱 axis、一个二面角 angle（度），
 * 取出由两个都过球心且都含 axis 的半大圆平面夹出的「球楔 / 球瓣」，一次画出
 * 球三大圆 + 公共棱（直径）+ 两个半大圆侧面（弧 + 辐条）+ 球面曲楔面（纬线弧 + 赤道弧），
 * 并标出 R / α / V / S。直接服务「球楔体积与表面积、球面二面角」高考核心用例。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - spheresector3d：一个截平面 + 球心锥顶，取球冠那一瓣，非双平面夹角；
 *   - sphericalcap3d：一个（或两个平行）截平面取冠/台，不经过球心；
 *   - dihedral3d：只标两平面二面角，不出球楔实体与体积表面积；
 *   - revolve3d：整条母线回转面，取不出「两个过球心平面夹出的那一瓣」。
 *
 * 几何口径（纯解析解，不用迭代）：
 *   正交标架：n=unit(axis)（公共棱方向），u=unit(n×helper)，v=n×u（helper 取 z 轴、近平行时取 x 轴）。
 *   二面角 α=angle·π/180（0<angle<360）；侧面1 径向 w0=u、法向 f1=v；
 *   侧面2 径向 w1=cosα·u+sinα·v、法向 f2=−sinα·u+cosα·v（n×w1=f2，故 f1·f2=cosα）。
 *   球楔点 P(ρ,β,φ)=O+ρ·(cosβ·n+sinβ·(cosφ·u+sinφ·v))，0≤ρ≤R、0≤β≤π、0≤φ≤α。
 *   侧面1 弧点 H0(β)=O+R(cosβ·n+sinβ·u) 恒在球面且 (H0−O)·f1=0；
 *   侧面2 弧点 H1(β)=O+R(cosβ·n+sinβ·w1) 恒在球面且 (H1−O)·f2=0；
 *   赤道弧点 E(φ)=O+R(cosφ·u+sinφ·v) 恒在球面、恒在 β=π/2 平面。
 *   体积：V=2αR³/3（占整球 4πR³/3 的 α/2π）；曲面面积 S_curved=2αR²；
 *   两个半大圆侧面面积 S_faces=πR²；总表面积 S=S_curved+πR²；且 V=R·S_curved/3。
 *   任一守恒失败（球面上点不在球面 / 侧面点不在对应平面 / 法向夹角≠α /
 *   V 两式不符 / S 不符）整条拒绝，绝不画假球楔。
 */

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_SPHERE_COLOR = '#9fb2ce';
const DEFAULT_FACE_COLOR = '#e0a020';
const DEFAULT_SURFACE_COLOR = '#3aa675';
const DEFAULT_EDGE_COLOR = '#7a8aa0';
const DEFAULT_LABEL_COLOR = '#d04040';

/** 半径 / 采样 / 辐条 / 小球区间与缺省 */
export const SPHERICALWEDGE3D_RADIUS_MIN = 0.01;
export const SPHERICALWEDGE3D_RADIUS_MAX = 10000;
export const SPHERICALWEDGE3D_RADIUS_DEFAULT = 2;
export const SPHERICALWEDGE3D_ANGLE_MIN = 0;
export const SPHERICALWEDGE3D_ANGLE_MAX = 360;
export const SPHERICALWEDGE3D_ANGLE_DEFAULT = 90;
export const SPHERICALWEDGE3D_SEGMENTS_MIN = 8;
export const SPHERICALWEDGE3D_SEGMENTS_MAX = 512;
export const SPHERICALWEDGE3D_SEGMENTS_DEFAULT = 48;
export const SPHERICALWEDGE3D_MERIDIANS_MIN = 1;
export const SPHERICALWEDGE3D_MERIDIANS_MAX = 32;
export const SPHERICALWEDGE3D_MERIDIANS_DEFAULT = 6;
export const SPHERICALWEDGE3D_SPOKES_MIN = 0;
export const SPHERICALWEDGE3D_SPOKES_MAX = 32;
export const SPHERICALWEDGE3D_SPOKES_DEFAULT = 6;
export const SPHERICALWEDGE3D_VERTEX_SIZE_MIN = 0.01;
export const SPHERICALWEDGE3D_VERTEX_SIZE_MAX = 1;
export const SPHERICALWEDGE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限 */
export const SPHERICALWEDGE3D_MAX_SEGMENTS = 4096;

/** 默认球心 / 公共棱方向 */
export const SPHERICALWEDGE3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const SPHERICALWEDGE3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

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
export function parseWedgePoint(v) {
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

/** 正交标架：n=unit(axis)，u=unit(n×helper)，v=n×u */
export function wedgeFrame(axis) {
  const raw = axis === undefined ? SPHERICALWEDGE3D_DEFAULT_AXIS : axis;
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

/** 球楔体积 V=2αR³/3（α 弧度） */
export function sphericalwedgeVolume(R, alpha) {
  return 2 * alpha * R * R * R / 3;
}

/** 球面曲楔面面积 S_curved=2αR² */
export function sphericalwedgeCurvedArea(R, alpha) {
  return 2 * alpha * R * R;
}

/** 两个半大圆侧面面积 S_faces=πR²（与 α 无关） */
export function sphericalwedgeFaceArea(R) {
  return Math.PI * R * R;
}

/**
 * 球楔纯几何解（不含画板对象），供回归直接断言。
 *
 * @param {Object} cmd 形如 {center, radius, axis, angle}
 * @returns {{ok:boolean,error?:string,...}|null} ok 时返回 center/radius/n/u/v/w0/w1/f1/f2/
 *          angleDeg/angleRad/volume/surfaceCurved/surfaceFaces/surface 等
 */
export function sphericalwedgeGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  const O = cmd.center === undefined ? SPHERICALWEDGE3D_DEFAULT_CENTER : parseWedgePoint(cmd.center);
  if (!O) return { ok: false, error: 'center 需为合法 [x,y,z]' };

  const R = num(cmd.radius === undefined ? SPHERICALWEDGE3D_RADIUS_DEFAULT : cmd.radius);
  if (R === null) return { ok: false, error: 'radius 必须是数字' };
  if (R < SPHERICALWEDGE3D_RADIUS_MIN || R > SPHERICALWEDGE3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SPHERICALWEDGE3D_RADIUS_MIN}~${SPHERICALWEDGE3D_RADIUS_MAX}` };
  }

  const fr = wedgeFrame(cmd.axis);
  if (!fr) return { ok: false, error: 'axis 需为非零三维向量' };
  const { n, u, v } = fr;

  const angleDeg = num(cmd.angle === undefined ? SPHERICALWEDGE3D_ANGLE_DEFAULT : cmd.angle);
  if (angleDeg === null) return { ok: false, error: 'angle 必须是数字' };
  if (angleDeg <= SPHERICALWEDGE3D_ANGLE_MIN || angleDeg >= SPHERICALWEDGE3D_ANGLE_MAX) {
    return { ok: false, error: `angle 需满足 0 < angle < ${SPHERICALWEDGE3D_ANGLE_MAX}` };
  }
  const alpha = angleDeg * Math.PI / 180;
  const c = Math.cos(alpha), s = Math.sin(alpha);
  const w0 = u.slice();
  const w1 = add3(mul3(u, c), mul3(v, s));
  const f1 = v.slice();
  const f2 = add3(mul3(u, -s), mul3(v, c));

  const volume = sphericalwedgeVolume(R, alpha);
  const surfaceCurved = sphericalwedgeCurvedArea(R, alpha);
  const surfaceFaces = sphericalwedgeFaceArea(R);
  const surface = surfaceCurved + surfaceFaces;

  // 二阶交叉校验：f1·f2=cosα、V=R·S_curved/3、S_curved=2αR²
  if (Math.abs(dot3(f1, f2) - c) > 0.01) return { ok: false, error: '两侧面法向夹角与 angle 不符' };
  if (Math.abs(volume - R * surfaceCurved / 3) > 0.01 * Math.max(1, Math.abs(volume))) {
    return { ok: false, error: '体积 V=R·S_curved/3 交叉校验失败' };
  }
  if (Math.abs(surfaceCurved - 2 * alpha * R * R) > 1e-9) {
    return { ok: false, error: '曲面面积 S_curved=2αR² 交叉校验失败' };
  }

  return {
    ok: true, center: O, radius: R, n, u, v, w0, w1, f1, f2,
    angleDeg, angleRad: alpha, volume, surfaceCurved, surfaceFaces, surface,
  };
}

/**
 * 解析一条 sphericalwedge3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"sphericalwedge3d","id":"sw","center":[0,0,0],"radius":2,"axis":[0,0,1],"angle":90,
 *    "segments":48,"meridians":6,"spokes":6,
 *    "asSphere":true,"asFaces":true,"asSurface":true,"asEdge":true,"asPoints":false,
 *    "labelRadius":true,"labelAngle":true,"labelVolume":true,"labelArea":true,"labelCurvedArea":true,
 *    "vertexSize":0.1,"color":"#2b7fd4"}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSphericalwedge3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'sw' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const g = sphericalwedgeGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };

  // ---- 采样 / 纬线 / 辐条 / 小球整数参数 ----
  const intParam = (name, def, min, max) => {
    const v = num(cmd[name] === undefined ? def : cmd[name]);
    if (v === null) return { error: `${name} 必须是数字` };
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${name} 需为 ${min}~${max} 的整数` };
    return { value: v };
  };
  const sg = intParam('segments', SPHERICALWEDGE3D_SEGMENTS_DEFAULT, SPHERICALWEDGE3D_SEGMENTS_MIN, SPHERICALWEDGE3D_SEGMENTS_MAX);
  if (sg.error) return { ok: false, error: sg.error };
  const me = intParam('meridians', SPHERICALWEDGE3D_MERIDIANS_DEFAULT, SPHERICALWEDGE3D_MERIDIANS_MIN, SPHERICALWEDGE3D_MERIDIANS_MAX);
  if (me.error) return { ok: false, error: me.error };
  const sk = intParam('spokes', SPHERICALWEDGE3D_SPOKES_DEFAULT, SPHERICALWEDGE3D_SPOKES_MIN, SPHERICALWEDGE3D_SPOKES_MAX);
  if (sk.error) return { ok: false, error: sk.error };
  const segments = sg.value, meridians = me.value, spokes = sk.value;

  const vsRaw = num(cmd.vertexSize === undefined ? SPHERICALWEDGE3D_VERTEX_SIZE_DEFAULT : cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SPHERICALWEDGE3D_VERTEX_SIZE_MIN || vsRaw > SPHERICALWEDGE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SPHERICALWEDGE3D_VERTEX_SIZE_MIN}~${SPHERICALWEDGE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  // ---- 布尔开关 ----
  const boolFields = [
    'asSphere', 'asFaces', 'asSurface', 'asEdge', 'asPoints',
    'labelRadius', 'labelAngle', 'labelVolume', 'labelArea', 'labelCurvedArea',
  ];
  const boolDefaults = {
    asSphere: true, asFaces: true, asSurface: true, asEdge: true, asPoints: false,
    labelRadius: true, labelAngle: true, labelVolume: true, labelArea: true, labelCurvedArea: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asSphere', 'asFaces', 'asSurface', 'asEdge'].some((f) => flags[f])) {
    return { ok: false, error: 'asSphere / asFaces / asSurface / asEdge 至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'sphereColor', 'faceColor', 'surfaceColor', 'edgeColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const sphereColor = color(cmd.sphereColor, DEFAULT_SPHERE_COLOR);
  const faceColor = color(cmd.faceColor, DEFAULT_FACE_COLOR);
  const surfaceColor = color(cmd.surfaceColor, DEFAULT_SURFACE_COLOR);
  const edgeColor = color(cmd.edgeColor, DEFAULT_EDGE_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 取整后的输出几何 ----
  const O = r4Vec(g.center);
  const N = r4Vec(g.n), U = r4Vec(g.u), V = r4Vec(g.v);
  const R = r4(g.radius), AD = r4(g.angleDeg), AR = r4(g.angleRad);
  const VOL = r4(g.volume), SCUR = r4(g.surfaceCurved), SFAC = r4(g.surfaceFaces), SUR = r4(g.surface);

  // 球面点通用采样：P(β,φ)=O+R(cosβ·n+sinβ·(cosφ·u+sinφ·v))
  const spherePoint = (beta, phi) => {
    const cb = Math.cos(beta), sb = Math.sin(beta);
    const cp = Math.cos(phi), sp = Math.sin(phi);
    return [
      g.center[0] + R0 * (cb * g.n[0] + sb * (cp * g.u[0] + sp * g.v[0])),
      g.center[1] + R0 * (cb * g.n[1] + sb * (cp * g.u[1] + sp * g.v[1])),
      g.center[2] + R0 * (cb * g.n[2] + sb * (cp * g.u[2] + sp * g.v[2])),
    ];
  };
  const R0 = g.radius; // 全精度半径，采样后再 r4 取整

  // 两个半大圆侧面弧（β 从 0 到 π），法向分别 f1 / f2
  const faceArc = (w) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const beta = Math.PI * i / segments;
      const cb = Math.cos(beta), sb = Math.sin(beta);
      pts.push(r4Vec([
        g.center[0] + R0 * (cb * g.n[0] + sb * w[0]),
        g.center[1] + R0 * (cb * g.n[1] + sb * w[1]),
        g.center[2] + R0 * (cb * g.n[2] + sb * w[2]),
      ]));
    }
    return pts;
  };
  const face0 = faceArc(g.w0);
  const face1 = faceArc(g.w1);

  // 赤道弧（β=π/2、φ 从 0 到 α）
  const equator = [];
  for (let i = 0; i <= segments; i++) {
    const phi = g.angleRad * i / segments;
    equator.push(r4Vec(spherePoint(Math.PI / 2, phi)));
  }

  // 纬线弧（β_i=π·i/(meridians+1)、φ 从 0 到 α），描绘球面曲楔面
  const parallels = [];
  for (let k = 1; k <= meridians; k++) {
    const beta = Math.PI * k / (meridians + 1);
    const arc = [];
    for (let i = 0; i <= segments; i++) {
      arc.push(r4Vec(spherePoint(beta, g.angleRad * i / segments)));
    }
    parallels.push(arc);
  }

  // ---- 守恒读数（取整后几何，纯断言用） ----
  let sphereDev = 0, face0Dev = 0, face1Dev = 0, equatorDev = 0, parallelDev = 0;
  const checkSphere = (q) => { sphereDev = Math.max(sphereDev, Math.abs(len3(sub3(q, O)) - R)); };
  for (const q of face0) { checkSphere(q); face0Dev = Math.max(face0Dev, Math.abs(dot3(sub3(q, O), g.f1))); }
  for (const q of face1) { checkSphere(q); face1Dev = Math.max(face1Dev, Math.abs(dot3(sub3(q, O), g.f2))); }
  for (const q of equator) { checkSphere(q); equatorDev = Math.max(equatorDev, Math.abs(len3(sub3(q, O)) - R)); }
  for (const arc of parallels) for (const q of arc) {
    parallelDev = Math.max(parallelDev, Math.abs(len3(sub3(q, O)) - R));
  }
  const scale = Math.max(1, R);
  if (sphereDev > REL_TOL * scale || face0Dev > REL_TOL * scale || face1Dev > REL_TOL * scale
      || equatorDev > REL_TOL * scale || parallelDev > REL_TOL * scale) {
    return { ok: false, error: '球楔守恒失败（侧面点不在球面 / 不在对应半平面 / 曲楔面点不在球面）' };
  }

  // ---- 线段总数上限守护 ----
  const sphereLines = flags.asSphere ? 3 * segments : 0;
  const faceLines = flags.asFaces ? 2 * segments + 2 * spokes : 0;
  const surfaceLines = flags.asSurface ? (meridians + 1) * segments : 0;
  const edgeLines = flags.asEdge ? 1 : 0;
  const lineCount = sphereLines + faceLines + surfaceLines + edgeLines;
  if (lineCount > SPHERICALWEDGE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SPHERICALWEDGE3D_MAX_SEGMENTS}` };
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
        const c = Math.cos(th) * R0, s = Math.sin(th) * R0;
        pts.push(r4Vec([
          g.center[0] + c * e1[0] + s * e2[0],
          g.center[1] + c * e1[1] + s * e2[1],
          g.center[2] + c * e1[2] + s * e2[2],
        ]));
      }
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_sph${pi}_${i}`.slice(0, 64)), pts[i], pts[(i + 1) % segments], sphereColor));
      }
    });
  }

  // ---- 公共棱（直径）：球心 ±R·n ----
  const top = r4Vec([g.center[0] + R0 * g.n[0], g.center[1] + R0 * g.n[1], g.center[2] + R0 * g.n[2]]);
  const bottom = r4Vec([g.center[0] - R0 * g.n[0], g.center[1] - R0 * g.n[1], g.center[2] - R0 * g.n[2]]);
  if (flags.asEdge) {
    items.push(mkLine(nextId(`${stem}_edge`.slice(0, 64)), bottom, top, edgeColor));
  }

  // ---- 两个半大圆侧面（弧 + 辐条） ----
  if (flags.asFaces) {
    [face0, face1].forEach((arc, fi) => {
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_face${fi}_${i}`.slice(0, 64)), arc[i], arc[i + 1], faceColor));
      }
      if (spokes > 0) {
        const step = Math.max(1, Math.floor(segments / spokes));
        for (let i = step; i < segments; i += step) {
          items.push(mkLine(nextId(`${stem}_face${fi}_s${i}`.slice(0, 64)), O, arc[i], faceColor));
        }
      }
    });
  }

  // ---- 球面曲楔面（赤道弧 + 纬线弧） ----
  if (flags.asSurface) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_eq_${i}`.slice(0, 64)), equator[i], equator[i + 1], surfaceColor));
    }
    parallels.forEach((arc, pi) => {
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_par${pi}_${i}`.slice(0, 64)), arc[i], arc[i + 1], surfaceColor));
      }
    });
  }

  // ---- 小球：球心、两棱端、两侧面弧采样点、赤道弧采样点 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O, edgeColor));
    items.push(mkPoint(nextId(`${stem}_pT`.slice(0, 64)), top, edgeColor));
    items.push(mkPoint(nextId(`${stem}_pB`.slice(0, 64)), bottom, edgeColor));
    const step = Math.max(1, Math.floor(segments / 8));
    for (let i = step; i < segments; i += step) {
      items.push(mkPoint(nextId(`${stem}_pF0_${i}`.slice(0, 64)), face0[i], faceColor));
      items.push(mkPoint(nextId(`${stem}_pF1_${i}`.slice(0, 64)), face1[i], faceColor));
      items.push(mkPoint(nextId(`${stem}_pE_${i}`.slice(0, 64)), equator[i], surfaceColor));
    }
  }

  // ---- 标注 ----
  const midAngle = g.angleRad / 2;
  const inner = r4Vec([
    g.center[0] + 0.6 * R0 * (Math.cos(midAngle) * g.u[0] + Math.sin(midAngle) * g.v[0]),
    g.center[1] + 0.6 * R0 * (Math.cos(midAngle) * g.u[1] + Math.sin(midAngle) * g.v[1]),
    g.center[2] + 0.6 * R0 * (Math.cos(midAngle) * g.u[2] + Math.sin(midAngle) * g.v[2]),
  ]);
  if (flags.labelRadius) {
    const rMid = r4Vec([0, 1, 2].map((k) => (O[k] + top[k]) / 2));
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rMid));
  }
  if (flags.labelAngle) {
    items.push(mkLabel(nextId(`${stem}_lA`.slice(0, 64)), `α=${AD}°(${AR}rad)`, inner));
  }
  if (flags.labelVolume) {
    items.push(mkLabel(nextId(`${stem}_lV`.slice(0, 64)), `V=2αR³/3=${VOL}`, r4Vec([0, 1, 2].map((k) => (top[k] + inner[k]) / 2))));
  }
  if (flags.labelCurvedArea) {
    items.push(mkLabel(nextId(`${stem}_lSc`.slice(0, 64)), `S曲=2αR²=${SCUR}`, equator[Math.floor(segments / 4)]));
  }
  if (flags.labelArea) {
    items.push(mkLabel(nextId(`${stem}_lS`.slice(0, 64)), `S=${SUR}`, equator[Math.floor(segments / 2)]));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: O.slice(), radius: R,
      normal: N.slice(), basis: { u: U.slice(), v: V.slice(), n: N.slice() },
      faceNormals: { f1: r4Vec(g.f1), f2: r4Vec(g.f2) },
      radial: { w0: r4Vec(g.w0), w1: r4Vec(g.w1) },
      angleDeg: AD, angleRad: AR,
      volume: VOL, surfaceCurved: SCUR, surfaceFaces: SFAC, surface: SUR,
      sphereMaxDev: r4(sphereDev), face0MaxDev: r4(face0Dev), face1MaxDev: r4(face1Dev),
      equatorMaxDev: r4(equatorDev), parallelMaxDev: r4(parallelDev),
      segments, meridians, spokes, vertexSize,
      asSphere: flags.asSphere, asFaces: flags.asFaces, asSurface: flags.asSurface,
      asEdge: flags.asEdge, asPoints: flags.asPoints,
      pointCount: items.filter((it) => it.type === 'point').length,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor, sphereColor, faceColor, surfaceColor, edgeColor, labelColor, opacity: lineOpacity,
    },
  };
}

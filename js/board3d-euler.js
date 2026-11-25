/**
 * 立体画板「四面体外接球 / 内切球与欧拉不等式（euler3d）」纯函数语义层（2026-11-26 D41 增量）
 *
 * 与 js/board3d-circumsphere.js / -insphere.js / -dihedral.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state；
 *   - 组合复用 D39/D40 的纯几何求解函数，不复制一份球心公式（避免两处漂移）。
 *
 * 作用：把「四面体的外接球和内切球画在一起 / 验证 R≥3r / 标出球心距 OI」
 * 这类意图，用一条命令生成标准作图：
 *   四面体六棱 + 外接球三正交大圆 + 内切球三正交大圆 + 球心连线 OI
 *   +（可选）O 到四顶点半径、I 到四切点半径 + 球心/切点小球
 *   + 球心 O/内心 I、R/r/d 读数、不等式结论标注。
 *
 * 几何定义（四点 P0..P3 构成四面体）：
 *   外接球 O：O·(Pi−P0)=(|Pi|²−|P0|²)/2 (i=1,2,3)，R=|O−P0|；
 *   内切球 I：面积加权质心 I=ΣSi·Pi/ΣSi，r=3V/ΣSi，切点 Ti 为 I 到面 Fi 的垂足；
 *   球心距   d=|O−I|；
 *   欧拉不等式（四面体）：R ≥ 3r，正四面体取等号（此时 O=I、d=0）；
 *   Grace–Danielsson 强化式：d² ≤ (R+r)(R−3r)，其右端非负即蕴含 R≥3r。
 *
 * 守恒与守护：
 *   四顶点到 O 距离恒为 R；I 到四切点距离恒为 r 且切点在对应面内；
 *   每个大圆采样点到对应球心距离恒为对应半径；三个大圆平面法向两两正交；
 *   margin=(R+r)(R−3r)−d² ≥ −tol（数值容差）。四点共面 / 重合 / 面退化 / 病态外接球
 *   一律整条拒绝，绝不画出违反不等式的假图。
 */

import {
  circumsphere3DCenter, circumsphere3DRadius, circumsphere3DFrame,
} from './board3d-circumsphere.js';
import {
  insphere3DGeometry, insphere3DFrame,
} from './board3d-insphere.js';

/** 每个大圆采样段数合法区间与默认（与 D39/D40 同口径） */
export const EULER3D_SEGMENTS_MIN = 8;
export const EULER3D_SEGMENTS_MAX = 512;
export const EULER3D_SEGMENTS_DEFAULT = 48;

/** 小球半径合法区间与默认 */
export const EULER3D_VERTEX_SIZE_MIN = 0.01;
export const EULER3D_VERTEX_SIZE_MAX = 1;
export const EULER3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const EULER3D_MAX_SEGMENTS = 4096;

/** 默认四点：单位立方体交错顶点构成的正四面体（O=I=原点，R=√3，r=1/√3，等号成立） */
export const EULER3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([1, 1, 1]),
  Object.freeze([1, -1, -1]),
  Object.freeze([-1, 1, -1]),
  Object.freeze([-1, -1, 1]),
]);
export const EULER3D_DEFAULT_AXIS = Object.freeze([0, 0, 1]);

/** 坐标钳制上限（与 geometry / circumsphere / insphere 一致） */
const COORD_LIMIT = 10000;

/** 默认配色：四面体棱 / 外接球 / 内切球 / 球心连线 / 标注 */
const DEFAULT_COLOR = '#5b6472';
const DEFAULT_CIRCUM_COLOR = '#4f6bed';
const DEFAULT_IN_COLOR = '#0e9f8a';
const DEFAULT_CENTER_COLOR = '#d07a00';
const DEFAULT_LABEL_COLOR = '#e04040';

/** 严格取有限数值；数字字符串容错，其余一律拒绝 */
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
const len3 = (a) => Math.sqrt(dot3(a, a));
const unitR4 = (a) => {
  const m = len3(a);
  if (!(m > 1e-9)) return [0, 0, 0];
  return r4Vec([a[0] / m, a[1] / m, a[2] / m]);
};

/**
 * 综合求解四点四面体的外接球、内切球、球心距与不等式余量（全精度，不取整）。
 * 返回 { points, O, R, vertexDistances, I, r, d, ratio, margin, holds,
 *        volume, faceAreaSum, faces, tangents, circumFrame, inFrame }；
 * 任一步退化 / 病态返回 null。不修改入参。
 */
export function euler3DGeometry(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;

  const O = circumsphere3DCenter(p);
  if (!O || O.some((x) => !Number.isFinite(x))) return null;
  const R = circumsphere3DRadius(O, p);
  if (R === null || !(R > 1e-9) || !Number.isFinite(R)) return null;
  const vertexDistances = p.map((q) => len3(sub3(q, O)));
  // 病态守护：四个顶点到球心距离必须几乎相等，否则拒绝而非画假外接球
  if (vertexDistances.some((v) => Math.abs(v - R) > R * 0.01 + 1e-9)) return null;

  const inner = insphere3DGeometry(p);
  if (!inner) return null;
  const I = inner.center;
  const r = inner.radius;
  const d = len3(sub3(O, I));

  const ratio = R / r;
  // 四面体欧拉不等式 R≥3r；Grace–Danielsson 强化式 d²≤(R+r)(R−3r)。
  // 数值容差按 R² 量级给 1e-6 相对余量，避免正四面体等号情形被浮点误差误判为失败。
  const tol = 1e-6 * R * R + 1e-9;
  const margin = (R + r) * (R - 3 * r) - d * d;
  const holds = ratio >= 3 - 1e-6 && margin >= -tol;
  if (!holds) return null;

  const circumFrame = circumsphere3DFrame(EULER3D_DEFAULT_AXIS);
  const inFrame = insphere3DFrame(EULER3D_DEFAULT_AXIS);
  if (!circumFrame || !inFrame) return null;

  return {
    points: p,
    O, R, vertexDistances,
    I, r, d, ratio, margin, holds,
    volume: inner.volume,
    faceAreaSum: inner.faceAreaSum,
    faces: inner.faces,
    tangents: inner.tangents,
    radiusChecks: inner.radiusChecks,
    circumFrame, inFrame,
  };
}

/**
 * 生成不等式读数文本（与画板 meta 完全同口径）。
 * 等号情形（R/r 与 3 差 <1e-4）直接给出「正四面体取等号」。
 */
export function euler3DInequalityText(ratio) {
  if (!Number.isFinite(ratio)) return 'R≥3r';
  return Math.abs(ratio - 3) < 1e-4
    ? `R≥3r（R/r=${r4(ratio)}，等号成立）`
    : `R≥3r（R/r=${r4(ratio)}）`;
}

/**
 * 解析一条 euler3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"euler3d","id":"eul","points":[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
 *    "axis":"z","segments":48,"asTetra":true,"asCircum":true,"asIn":true,
 *    "asCenters":true,"asRadii":false,"asPoints":false,
 *    "labelCenters":true,"labelRadii":true,"labelDistance":true,"labelInequality":true,
 *    "vertexSize":0.1,"color":"#5b6472","circumColor":"#4f6bed","inColor":"#0e9f8a"}
 *   - points        可选，四个不共面点（默认正四面体）；共面 / 重合 / 面退化 / 不等式不成立拒绝；
 *   - axis          可选，两个球的大圆基准轴（默认 z）；
 *   - segments      可选，每个大圆采样段数（默认 48，8~512）；
 *   - asTetra       可选，是否画四面体六棱（默认 true）；
 *   - asCircum      可选，是否画外接球三个正交大圆（默认 true）；
 *   - asIn          可选，是否画内切球三个正交大圆（默认 true）；
 *   - asCenters     可选，是否画球心连线 OI（默认 true）；
 *   - asRadii       可选，是否画 O→四顶点与 I→四切点半径线段（默认 false）；
 *   - asPoints      可选，是否放 O/I/四顶点/四切点小球（默认 false）；
 *   - labelCenters / labelRadii / labelDistance / labelInequality 可选标注开关；
 *   - vertexSize / color / circumColor / inColor / centerColor / labelColor / opacity：样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveEuler3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'eul' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- points ----
  const pts = cmd.points === undefined
    ? EULER3D_DEFAULT_POINTS.map((p) => p.slice())
    : (Array.isArray(cmd.points) ? cmd.points.map(parsePoint3) : null);
  if (!pts || pts.length !== 4 || pts.some((p) => p === null)) {
    return { ok: false, error: 'points 需为四个合法 [x,y,z]' };
  }

  // ---- axis：两球共用的大圆基准轴 ----
  const circumFrame = circumsphere3DFrame(cmd.axis === undefined ? EULER3D_DEFAULT_AXIS : cmd.axis);
  const inFrame = insphere3DFrame(cmd.axis === undefined ? EULER3D_DEFAULT_AXIS : cmd.axis);
  if (!circumFrame || !inFrame) return { ok: false, error: 'axis 需为 x/y/z 或非零向量 [x,y,z]' };

  // ---- segments ----
  const segRaw = cmd.segments === undefined ? EULER3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < EULER3D_SEGMENTS_MIN || segRaw > EULER3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${EULER3D_SEGMENTS_MIN}~${EULER3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- vertexSize ----
  const vsRaw = cmd.vertexSize === undefined ? EULER3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < EULER3D_VERTEX_SIZE_MIN || vsRaw > EULER3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${EULER3D_VERTEX_SIZE_MIN}~${EULER3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = vsRaw;

  // ---- 布尔开关 ----
  const boolFields = [
    'asTetra', 'asCircum', 'asIn', 'asCenters', 'asRadii', 'asPoints',
    'labelCenters', 'labelRadii', 'labelDistance', 'labelInequality',
  ];
  const boolDefaults = {
    asTetra: true, asCircum: true, asIn: true, asCenters: true, asRadii: false, asPoints: false,
    labelCenters: true, labelRadii: true, labelDistance: true, labelInequality: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!['asTetra', 'asCircum', 'asIn', 'asCenters', 'asRadii', 'asPoints'].some((f) => flags[f])) {
    return { ok: false, error: '六个输出开关至少开一个' };
  }

  // ---- 样式 ----
  for (const f of ['color', 'circumColor', 'inColor', 'centerColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const tetraColor = color(cmd.color, DEFAULT_COLOR);
  const circumColor = color(cmd.circumColor, DEFAULT_CIRCUM_COLOR);
  const inColor = color(cmd.inColor, DEFAULT_IN_COLOR);
  const centerColor = color(cmd.centerColor, DEFAULT_CENTER_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 综合几何求解 ----
  const geo = euler3DGeometry(pts);
  if (!geo) return { ok: false, error: '四点共面 / 重合 / 面退化 / 不等式不成立，拒绝作图' };

  // 线段上限守护：2×3 大圆 × segments + 6 棱 + 1 球心连线 + 8 半径
  const lineCount = ((flags.asCircum ? 3 : 0) + (flags.asIn ? 3 : 0)) * segments
    + (flags.asTetra ? 6 : 0) + (flags.asCenters ? 1 : 0)
    + (flags.asRadii ? 8 : 0);
  if (lineCount > EULER3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${EULER3D_MAX_SEGMENTS}` };
  }

  // ---- 取整后的输出坐标 ----
  const O = r4Vec(geo.O.map(clamp));
  const I = r4Vec(geo.I.map(clamp));
  const R = r4(clamp(geo.R));
  const r = r4(clamp(geo.r));
  const d = r4(clamp(geo.d));
  const P = geo.points.map((p) => r4Vec(p.map(clamp)));
  const T = geo.tangents.map((t) => r4Vec(t.map(clamp)));
  const CU = r4Vec(circumFrame.u);
  const CV = r4Vec(circumFrame.v);
  const CN = r4Vec(circumFrame.n);
  const IU = r4Vec(inFrame.u);
  const IV = r4Vec(inFrame.v);
  const IN = r4Vec(inFrame.n);

  // 大圆采样：center + radius·(cosθ·A + sinθ·B)，全精度算、取整输出
  const circlePts = (centerRaw, radiusRaw, pa, pb) => {
    const out = [];
    for (let i = 0; i < segments; i++) {
      const th = (2 * Math.PI * i) / segments;
      const c = Math.cos(th) * radiusRaw;
      const s = Math.sin(th) * radiusRaw;
      out.push(r4Vec([
        centerRaw[0] + c * pa[0] + s * pb[0],
        centerRaw[1] + c * pa[1] + s * pb[1],
        centerRaw[2] + c * pa[2] + s * pb[2],
      ]));
    }
    return out;
  };
  const cEquator = circlePts(geo.O, geo.R, circumFrame.u, circumFrame.v);
  const cMeridian1 = circlePts(geo.O, geo.R, circumFrame.n, circumFrame.u);
  const cMeridian2 = circlePts(geo.O, geo.R, circumFrame.n, circumFrame.v);
  const iEquator = circlePts(geo.I, geo.r, inFrame.u, inFrame.v);
  const iMeridian1 = circlePts(geo.I, geo.r, inFrame.n, inFrame.u);
  const iMeridian2 = circlePts(geo.I, geo.r, inFrame.n, inFrame.v);

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

  const mkLine = (id, p1, p2, col) => ({
    id, type: 'line', text: '', color: col, opacity: lineOpacity,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    p: { x1: p1[0], y1: p1[1], z1: p1[2], x2: p2[0], y2: p2[1], z2: p2[2] },
  });
  const mkPoint = (id, q, col) => ({
    id, type: 'point', text: '', color: col, opacity: lineOpacity,
    pos: q.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: { s: vertexSize },
  });
  const mkLabel = (id, text, q) => ({
    id, type: 'label', text, color: labelColor, opacity: 1,
    pos: q.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: {},
  });

  const items = [];
  const pushRing = (rings, suffixes, col) => {
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < segments; i++) {
        items.push(mkLine(nextId(`${stem}_${suffixes[ri]}_${i}`.slice(0, 64)), ring[i], ring[(i + 1) % segments], col));
      }
    }
  };

  // ---- 四面体六棱 ----
  if (flags.asTetra) {
    const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let i = 0; i < edges.length; i++) {
      items.push(mkLine(nextId(`${stem}_e${i}`.slice(0, 64)), P[edges[i][0]], P[edges[i][1]], tetraColor));
    }
  }

  // ---- 外接球三正交大圆 ----
  if (flags.asCircum) pushRing([cEquator, cMeridian1, cMeridian2], ['ceq', 'cm1', 'cm2'], circumColor);

  // ---- 内切球三正交大圆 ----
  if (flags.asIn) pushRing([iEquator, iMeridian1, iMeridian2], ['ieq', 'im1', 'im2'], inColor);

  // ---- 球心连线 OI ----
  if (flags.asCenters) {
    items.push(mkLine(nextId(`${stem}_oi`.slice(0, 64)), O, I, centerColor));
  }

  // ---- 可选：O→四顶点半径、I→四切点半径 ----
  if (flags.asRadii) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_cr${i}`.slice(0, 64)), O, P[i], circumColor));
      items.push(mkLine(nextId(`${stem}_ir${i}`.slice(0, 64)), I, T[i], inColor));
    }
  }

  // ---- 可选：O/I/四顶点/四切点小球 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), O, circumColor));
    items.push(mkPoint(nextId(`${stem}_pI`.slice(0, 64)), I, inColor));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pV${i}`.slice(0, 64)), P[i], tetraColor));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pT${i}`.slice(0, 64)), T[i], inColor));
  }

  // ---- 标注 ----
  if (flags.labelCenters) {
    items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', O));
    items.push(mkLabel(nextId(`${stem}_lI`.slice(0, 64)), 'I', I));
  }
  if (flags.labelRadii) {
    const rPos = r4Vec([(O[0] + P[0][0]) / 2 + CN[0] * 0.15, (O[1] + P[0][1]) / 2 + CN[1] * 0.15, (O[2] + P[0][2]) / 2 + CN[2] * 0.15]);
    const iPos = r4Vec([(I[0] + T[0][0]) / 2 + IN[0] * 0.15, (I[1] + T[0][1]) / 2 + IN[1] * 0.15, (I[2] + T[0][2]) / 2 + IN[2] * 0.15]);
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), `R=${R}`, rPos));
    items.push(mkLabel(nextId(`${stem}_lr`.slice(0, 64)), `r=${r}`, iPos));
  }
  let dPos = [0, 0, 0];
  if (flags.labelDistance) {
    dPos = r4Vec([(O[0] + I[0]) / 2 + CN[0] * 0.15, (O[1] + I[1]) / 2 + CN[1] * 0.15, (O[2] + I[2]) / 2 + CN[2] * 0.15]);
    items.push(mkLabel(nextId(`${stem}_ld`.slice(0, 64)), `d=${d}`, dPos));
  }
  const inequalityText = euler3DInequalityText(geo.ratio);
  if (flags.labelInequality) {
    const mPos = r4Vec([O[0] + CN[0] * (R + 0.35), O[1] + CN[1] * (R + 0.35), O[2] + CN[2] * (R + 0.35)]);
    items.push(mkLabel(nextId(`${stem}_linq`.slice(0, 64)), inequalityText, mPos));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      points: P.map((p) => p.slice()),
      center: O.slice(), incenter: I.slice(),
      radius: R, inradius: r, centerDistance: d,
      ratio: r4(geo.ratio),
      margin: r4(geo.margin),
      holds: geo.holds,
      volume: r4(geo.volume),
      faceAreaSum: r4(geo.faceAreaSum),
      axis: cmd.axis === undefined ? 'z' : (typeof cmd.axis === 'string' ? cmd.axis : r4Vec(circumFrame.n)),
      n: CN.slice(), u: CU.slice(), v: CV.slice(),
      inN: IN.slice(), inU: IU.slice(), inV: IV.slice(),
      segments,
      circumEquator: cEquator.slice(), circumMeridian1: cMeridian1.slice(), circumMeridian2: cMeridian2.slice(),
      inEquator: iEquator.slice(), inMeridian1: iMeridian1.slice(), inMeridian2: iMeridian2.slice(),
      tangents: T.map((t) => t.slice()),
      vertexDistances: geo.vertexDistances.map((v) => r4(v)),
      radiusChecks: geo.radiusChecks.map((v) => r4(v)),
      inequalityText,
      radiusPos: flags.labelRadii ? r4Vec([(O[0] + P[0][0]) / 2 + CN[0] * 0.15, (O[1] + P[0][1]) / 2 + CN[1] * 0.15, (O[2] + P[0][2]) / 2 + CN[2] * 0.15]) : null,
      inradiusPos: flags.labelRadii ? r4Vec([(I[0] + T[0][0]) / 2 + IN[0] * 0.15, (I[1] + T[0][1]) / 2 + IN[1] * 0.15, (I[2] + T[0][2]) / 2 + IN[2] * 0.15]) : null,
      distancePos: flags.labelDistance ? dPos : null,
      asTetra: flags.asTetra, asCircum: flags.asCircum, asIn: flags.asIn,
      asCenters: flags.asCenters, asRadii: flags.asRadii, asPoints: flags.asPoints,
      labelCenters: flags.labelCenters, labelRadii: flags.labelRadii,
      labelDistance: flags.labelDistance, labelInequality: flags.labelInequality,
      vertexSize,
      edgeCount: flags.asTetra ? 6 : 0,
      circumCircleCount: flags.asCircum ? 3 : 0,
      inCircleCount: flags.asIn ? 3 : 0,
      centerSegmentCount: flags.asCenters ? 1 : 0,
      radiusCount: flags.asRadii ? 8 : 0,
      pointCount: flags.asPoints ? 10 : 0,
      labelCount: items.filter((it) => it.type === 'label').length,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: tetraColor, circumColor, inColor, centerColor, labelColor,
      opacity: lineOpacity,
    },
  };
}

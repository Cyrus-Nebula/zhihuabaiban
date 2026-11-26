/**
 * 立体画板「四面体 / 任意四点的重心与四条中线（centroid3d）」参数化生成命令的纯函数语义层（2026-11-26 D42 增量）
 *
 * 与 js/board3d-insphere.js / -circumsphere.js / -euler.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「标出四面体重心 / 画三棱锥的四条中线 / 重心把中线分成 3:1」这类意图，
 * 用一条命令生成标准作图：四面体六棱 + 四条中线（顶点→对面重心）+（可选）四个面内的中线
 * + 重心/顶点/面重心小球 + G / 顶点 A-D / 面重心 G0-G3 / 3:1 读数标注。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 只量两点距离 / 三点夹角 / 中点，不会自动求四点重心；
 *   - polyhedron3d 只画正多面体线框，pointplane3d/lineplane3d 只做度量；
 *   - circumsphere3d / insphere3d / euler3d 求的是外心 / 内心 / 双球，都不画重心与中线；
 *   - centroid3d 给四个不共面点，直接反求重心并验证「重心分中线 3:1、四等分体积」。
 *
 * 几何定义（四点 P0..P3 构成四面体，面 Fi 为顶点 Pi 的对面）：
 *   重心         G  = (P0+P1+P2+P3)/4;
 *   面重心       Gi = (除 Pi 外三点之和)/3;
 *   体积         V  = |det(P1−P0, P2−P0, P3−P0)|/6;
 *   中线         Pi → Gi，G 落在中线上且 PiG : GGi = 3 : 1;
 *   四等分体积   Vi = 把 Pi 换成 G 后的子四面体体积，Vi = V/4。
 *
 * 守恒：medianRatios[i] = |Pi−Gi|/|G−Gi| 对四条中线恒为 3；subVolumes[i] 恒为 V/4；
 * 四点共面 / 重合 / 面退化（V≈0）时无解 → 整条拒绝，绝不画假重心。
 * 本命令只校验数值与点位合法，不强制与场景其它对象无交。
 */

/** 小球半径（与其余 3D 命令同口径） */
export const CENTROID3D_VERTEX_SIZE_MIN = 0.01;
export const CENTROID3D_VERTEX_SIZE_MAX = 1;
export const CENTROID3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const CENTROID3D_MAX_SEGMENTS = 4096;

/** 默认四点：单位立方体交错顶点构成的正四面体（重心原点） */
export const CENTROID3D_DEFAULT_POINTS = Object.freeze([
  Object.freeze([1, 1, 1]),
  Object.freeze([1, -1, -1]),
  Object.freeze([-1, 1, -1]),
  Object.freeze([-1, -1, 1]),
]);

/** 面顶点索引：face i 为顶点 i 的对面（不含 Pi 的另外三点） */
export const CENTROID3D_FACE_INDEX = Object.freeze([
  Object.freeze([1, 2, 3]),
  Object.freeze([0, 2, 3]),
  Object.freeze([0, 1, 3]),
  Object.freeze([0, 1, 2]),
]);

/** 坐标钳制上限（与 geometry / circumsphere 一致） */
const COORD_LIMIT = 10000;

/** 线框 / 面内中线 / 顶点 / 标注默认颜色 */
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_FACE_COLOR = '#9aa7b8';
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

/** 由四个已经解析好的点求有向体积绝对值；入参非法返回 null */
function volumeOf(p) {
  if (!Array.isArray(p) || p.length !== 4 || p.some((q) => !Array.isArray(q) || q.length !== 3)) return null;
  const det = dot3(sub3(p[1], p[0]), cross3(sub3(p[2], p[0]), sub3(p[3], p[0])));
  return Math.abs(det) / 6;
}

/** 四点的四面体体积（不取整）；非法返回 null */
export function centroid3DVolume(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  return volumeOf(p);
}

/** 面 i（顶点 Pi 的对面）的重心；非法索引 / 入参返回 null */
export function centroid3DFaceCentroid(points, i) {
  if (!Number.isInteger(i) || i < 0 || i > 3) return null;
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const idx = CENTROID3D_FACE_INDEX[i];
  return [0, 1, 2].reduce((acc, k) => [acc[0] + p[idx[k]][0] / 3, acc[1] + p[idx[k]][1] / 3, acc[2] + p[idx[k]][2] / 3], [0, 0, 0]);
}

/** 四点重心 G=(P0+P1+P2+P3)/4（不取整）；非法返回 null */
export function centroid3DCenter(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  return [0, 1, 2, 3].reduce((acc, i) => [acc[0] + p[i][0] / 4, acc[1] + p[i][1] / 4, acc[2] + p[i][2] / 4], [0, 0, 0]);
}

/**
 * 综合求解：给四点返回完整重心几何（全精度，不取整）。
 * { volume, center, faceCentroids, medianRatios, subVolumes, holds }
 * holds=false 表示病态（共面 / 重合 / 中线比例或体积四等分偏差 > 1%），调用方须整条拒绝。
 */
export function centroid3DGeometry(points) {
  const volume = centroid3DVolume(points);
  const center = centroid3DCenter(points);
  if (volume === null || !center || !(volume > 1e-9)) return null;
  const faceCentroids = [0, 1, 2, 3].map((i) => centroid3DFaceCentroid(points, i));
  if (faceCentroids.some((q) => !q)) return null;
  const p = points.map(parsePoint3);
  const medianRatios = [0, 1, 2, 3].map((i) => {
    const d = len3(sub3(p[i], faceCentroids[i]));
    return d > 1e-9 ? len3(sub3(p[i], center)) / len3(sub3(center, faceCentroids[i])) : NaN;
  });
  const subVolumes = [0, 1, 2, 3].map((i) => {
    const q = p.map((v) => v.slice());
    q[i] = center.slice();
    return volumeOf(q);
  });
  const holds = medianRatios.every((v) => Number.isFinite(v) && Math.abs(v - 3) <= 3 * 0.01 + 1e-9)
    && subVolumes.every((v) => v !== null && Math.abs(v - volume / 4) <= (volume / 4) * 0.01 + 1e-9);
  return { volume, center, faceCentroids, medianRatios, subVolumes, holds };
}

/**
 * 解析一条 centroid3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"centroid3d","id":"cent","points":[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],
 *    "asEdges":true,"asMedians":true,"asFaceMedians":false,"asPoints":false,
 *    "labelCentroid":true,"labelVertices":false,"labelFaceCentroids":false,"labelRatio":true,"vertexSize":0.1,"color":"#2b7fd4"}
 *   - points        可选，四个不共面点 [[x,y,z]×4]（默认正四面体）；共面 / 重合 / 退化拒绝；
 *   - asEdges       可选，是否画四面体六条棱（默认 true）；
 *   - asMedians     可选，是否画顶点到对面重心的四条中线（默认 true）；
 *   - asFaceMedians 可选，是否画每个面内「面顶点→面重心」的 12 条半中线（默认 false）；
 *   - asPoints      可选，是否在重心 / 四顶点 / 四面重心放小球（默认 false）；
 *   - labelCentroid / labelVertices / labelFaceCentroids / labelRatio 可选，是否标注 G / 顶点 A-D / 面重心 G0-G3 / 3:1 读数（默认 true / false / false / true）；
 *   - vertexSize / color / faceColor / labelColor / opacity 可选，样式。八输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveCentroid3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'cent' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- points：四个不共面点 ----
  const pts = cmd.points === undefined
    ? CENTROID3D_DEFAULT_POINTS.map((p) => p.slice())
    : (Array.isArray(cmd.points) ? cmd.points.map(parsePoint3) : null);
  if (!pts || pts.length !== 4 || pts.some((p) => p === null)) {
    return { ok: false, error: 'points 需为四个合法 [x,y,z]' };
  }

  // ---- vertexSize ----
  const vsRaw = cmd.vertexSize === undefined ? CENTROID3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < CENTROID3D_VERTEX_SIZE_MIN || vsRaw > CENTROID3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${CENTROID3D_VERTEX_SIZE_MIN}~${CENTROID3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = vsRaw;

  // ---- 布尔开关 ----
  const boolFields = ['asEdges', 'asMedians', 'asFaceMedians', 'asPoints', 'labelCentroid', 'labelVertices', 'labelFaceCentroids', 'labelRatio'];
  const boolDefaults = { asEdges: true, asMedians: true, asFaceMedians: false, asPoints: false, labelCentroid: true, labelVertices: false, labelFaceCentroids: false, labelRatio: true };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!boolFields.some((f) => flags[f])) return { ok: false, error: '八输出开关至少开一个' };

  // ---- 样式 ----
  for (const f of ['color', 'faceColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const faceColor = color(cmd.faceColor, DEFAULT_FACE_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 求重心几何 ----
  const geo = centroid3DGeometry(pts);
  if (!geo || !geo.holds) return { ok: false, error: '四点共面 / 重合 / 退化，无法确定唯一重心' };
  const { volume, center, faceCentroids, medianRatios, subVolumes } = geo;

  // 线段总数上限守护（6 棱 + 4 中线 + 12 面内半中线）
  const lineCount = (flags.asEdges ? 6 : 0) + (flags.asMedians ? 4 : 0) + (flags.asFaceMedians ? 12 : 0);
  if (lineCount > CENTROID3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${CENTROID3D_MAX_SEGMENTS}` };
  }

  // ---- 取整后的输出坐标 ----
  const G = r4Vec(center.map(clamp));
  const F = faceCentroids.map((q) => r4Vec(q.map(clamp)));
  const P = pts.map((p) => p.slice());

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

  // ---- 四面体六条棱 ----
  if (flags.asEdges) {
    const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    for (let i = 0; i < edges.length; i++) {
      items.push(mkLine(nextId(`${stem}_e${i}`.slice(0, 64)), P[edges[i][0]], P[edges[i][1]], lineColor));
    }
  }

  // ---- 四条中线：顶点 Pi → 对面重心 Gi（G 在其上，PiG:GGi=3:1） ----
  if (flags.asMedians) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_m${i}`.slice(0, 64)), P[i], F[i], lineColor));
    }
  }

  // ---- 可选：四个面内「面顶点 → 面重心」的半中线（每面 3 条，共 12 条） ----
  if (flags.asFaceMedians) {
    for (let i = 0; i < 4; i++) {
      const verts = CENTROID3D_FACE_INDEX[i];
      for (let k = 0; k < 3; k++) {
        items.push(mkLine(nextId(`${stem}_f${i}_${k}`.slice(0, 64)), P[verts[k]], F[i], faceColor));
      }
    }
  }

  // ---- 可选：重心 / 四顶点 / 四面重心小球 ----
  if (flags.asPoints) {
    items.push(mkPoint(nextId(`${stem}_pG`.slice(0, 64)), G));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pV${i}`.slice(0, 64)), P[i]));
    for (let i = 0; i < 4; i++) items.push(mkPoint(nextId(`${stem}_pF${i}`.slice(0, 64)), F[i]));
  }

  // ---- 可选：重心 G / 顶点 A-D / 面重心 G0-G3 / 3:1 读数标注 ----
  if (flags.labelCentroid) items.push(mkLabel(nextId(`${stem}_lG`.slice(0, 64)), 'G', G));
  if (flags.labelVertices) {
    const names = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) items.push(mkLabel(nextId(`${stem}_lv${i}`.slice(0, 64)), names[i], P[i]));
  }
  if (flags.labelFaceCentroids) {
    for (let i = 0; i < 4; i++) items.push(mkLabel(nextId(`${stem}_lf${i}`.slice(0, 64)), `G${i}`, F[i]));
  }
  const ratioText = 'P₀G:GG₀=3:1';
  // 比例读数放在第一条中线靠近重心的 1/4 处（即 G 与 G0 之间），避开 G 标注
  const ratioPos = r4Vec([
    G[0] * 0.75 + F[0][0] * 0.25,
    G[1] * 0.75 + F[0][1] * 0.25,
    G[2] * 0.75 + F[0][2] * 0.25,
  ]);
  if (flags.labelRatio) items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), ratioText, ratioPos));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      points: P.map((p) => p.slice()),
      center: G.slice(),
      faceCentroids: F.map((q) => q.slice()),
      volume: r4(volume),
      subVolumes: subVolumes.map((v) => r4(v)),
      medianRatios: medianRatios.map((v) => r4(v)),
      holds: geo.holds,
      ratioText,
      ratioPos,
      asEdges: flags.asEdges,
      asMedians: flags.asMedians,
      asFaceMedians: flags.asFaceMedians,
      asPoints: flags.asPoints,
      labelCentroid: flags.labelCentroid,
      labelVertices: flags.labelVertices,
      labelFaceCentroids: flags.labelFaceCentroids,
      labelRatio: flags.labelRatio,
      vertexSize,
      edgeCount: flags.asEdges ? 6 : 0,
      medianCount: flags.asMedians ? 4 : 0,
      faceMedianCount: flags.asFaceMedians ? 12 : 0,
      pointCount: flags.asPoints ? 9 : 0,
      labelCount: (flags.labelCentroid ? 1 : 0) + (flags.labelVertices ? 4 : 0)
        + (flags.labelFaceCentroids ? 4 : 0) + (flags.labelRatio ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      faceColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

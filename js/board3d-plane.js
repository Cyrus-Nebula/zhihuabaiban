/**
 * 立体画板「任意空间平面面片（plane3d）」参数化生成命令的纯函数语义层（2026-11-23 D30 增量）
 *
 * 与 js/board3d-cylinder.js / -cone.js / -frustum.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个任意朝向的平面 / 截面 / 工作面」这类意图，用一条命令生成空间平面面片线框：
 *   矩形边界 4 段 + 可选内部网格线 + 可选法向量 + 可选四个角点与中心小球 / A·B·C·D·O 标注。
 *   产出由 line（及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置 plane 只能画水平 xy 面（createShapeGeometry 里固定 rotateX(-90°)），无法指定朝向 / 法向；
 *   - prism3d / pyramid3d / frustum3d 的底面是**依附于柱锥台**的多边形，不能单独画一片任意平面；
 *   - grid3d 是「把已有对象排成阵列」，不是画一个平面面片；
 *   - plane3d 给「锚点 center + 法向 axis（x/y/z 或任意向量，或三点 p1/p2/p3 定面）+ 宽 width + 高 height」，
 *     直接生成任意朝向的矩形面片与网格，服务「截面 / 工作面 / 倾斜平面 / 标注顶点」用例。
 *
 * 几何定义：
 *   axisUnit = 平面法向。axis 为 'x'/'y'/'z' 或任意非零 3D 向量（单位化）；
 *   若给 points=[p1,p2,p3]，则 axisUnit = normalize((p2−p1) × (p3−p1))（三点必须不共线），
 *   此时 center 缺省取 p1（锚点），仍可用 center 显式覆盖。
 *   正交标架 ref = |u.y| < 0.9 ? Y : X，n = normalize(ref × u)，b = u × n，
 *   则 axisUnit / n / b 两两正交且均为单位向量，n、b 张成该平面。
 *   四角（按 n→b 逆时针）：
 *     C0 = center − (width/2)·n − (height/2)·b
 *     C1 = center + (width/2)·n − (height/2)·b
 *     C2 = center + (width/2)·n + (height/2)·b
 *     C3 = center − (width/2)·n + (height/2)·b
 *   守恒：|角点−center|·axisUnit = 0（四角恒共面、面片恒垂直法向）；
 *         对边 C1−C0 = C2−C3 = width·n、C3−C0 = C2−C1 = height·b（平行四边形守恒）；
 *         两条对角线中点均等于 center（中心守恒）；法向量端 center+normalLength·axisUnit 与面片垂直。
 *   本命令只校验数值与点位合法，不强制平面与场景其它对象无交。
 */

/** 面片宽 / 高合法区间 */
export const PLANE3D_SPAN_MIN = 0.01;
export const PLANE3D_SPAN_MAX = 10000;
export const PLANE3D_WIDTH_DEFAULT = 4;
export const PLANE3D_HEIGHT_DEFAULT = 3;

/** 内部网格细分段数（每方向）；0 = 不画内部网格线 */
export const PLANE3D_GRID_MIN = 0;
export const PLANE3D_GRID_MAX = 32;
export const PLANE3D_GRID_DEFAULT = 0;

/** 法向量线段长度 */
export const PLANE3D_NORMAL_LENGTH_MIN = 0.01;
export const PLANE3D_NORMAL_LENGTH_MAX = 10000;
export const PLANE3D_NORMAL_LENGTH_DEFAULT = 1;

/** 角点 / 中心小球半径 */
export const PLANE3D_VERTEX_SIZE_MIN = 0.01;
export const PLANE3D_VERTEX_SIZE_MAX = 1;
export const PLANE3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const PLANE3D_MAX_SEGMENTS = 4096;

/** 默认锚点 / 默认法向 */
export const PLANE3D_DEFAULT_CENTER = Object.freeze(Object.freeze([0, 0, 0]));
export const PLANE3D_DEFAULT_AXIS = 'z';

/** 四角标注字母（逆时针 A/B/C/D） */
export const PLANE3D_LABELS = Object.freeze(['A', 'B', 'C', 'D']);

/** 坐标钳制上限（与 geometry / cone3d / cylinder3d 一致） */
const COORD_LIMIT = 10000;

/** 线框 / 顶点 / 标注默认颜色 */
const DEFAULT_COLOR = '#4f6bed';
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

/**
 * 解析平面法向 axis：'x'/'y'/'z'（大小写不敏感）或任意非零 3D 向量（单位化）。
 * 纯函数、只读入参。
 * @returns {Array|null} 单位法向 [ux,uy,uz]（新数组）或 null
 */
export function planeAxisUnit(axis) {
  if (axis === undefined) return [0, 0, 1];
  if (typeof axis === 'string') {
    const s = axis.trim().toLowerCase();
    if (s === 'x') return [1, 0, 0];
    if (s === 'y') return [0, 1, 0];
    if (s === 'z') return [0, 0, 1];
    return null;
  }
  if (Array.isArray(axis)) {
    const p = parsePoint3(axis);
    if (!p) return null;
    return unit(p);
  }
  return null;
}

/**
 * 三点定面的单位法向：normalize((p2−p1) × (p3−p1))。三点非法 / 共线返回 null。
 * 纯函数、只读入参。
 */
export function planeNormalFromPoints(points) {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const p = points.map(parsePoint3);
  if (p.some((q) => q === null)) return null;
  const n = cross3(sub3(p[1], p[0]), sub3(p[2], p[0]));
  if (!Number.isFinite(len3(n)) || len3(n) < 1e-6) return null;
  return unit(n);
}

/**
 * 平面的正交标架。参考轴避开与法向近乎平行的方向，保证叉积不退化。
 * @returns {{n:Array,b:Array}|null} n/b 两两垂直于 axisUnit 且为单位向量，或 null
 */
export function planeBasis(u) {
  if (!Array.isArray(u) || u.length !== 3 || !u.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n = unit(cross3(ref, u));
  if (!n) return null;
  const b = unit(cross3(u, n));
  return b ? { n, b } : null;
}

/**
 * 面片四角：center ± (width/2)·n ± (height/2)·b，按 n→b 逆时针 C0/C1/C2/C3。
 * 纯函数、只读入参。
 */
export function planeCorners(center, n, b, width, height) {
  const w2 = width / 2;
  const h2 = height / 2;
  const at = (sw, sh) => r4Vec([0, 1, 2].map((k) => center[k] + sw * w2 * n[k] + sh * h2 * b[k]));
  return Object.freeze([
    at(-1, -1), at(1, -1), at(1, 1), at(-1, 1),
  ]);
}

/**
 * 解析一条 plane3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"plane3d","id":"pln","center":[0,0,0],"axis":"z","width":4,"height":3,
 *    "gridU":0,"gridV":0,"normalLength":1,"asBorder":true,"asGrid":false,"asNormal":false,
 *    "asPoints":false,"labelVertices":false,"vertexSize":0.1,"color":"#4f6bed"}
 *   - center        可选，面片中心 / 锚点 [x,y,z]（默认 [0,0,0]；给 points 时缺省取 p1）；
 *   - axis          可选，平面法向 'x'/'y'/'z' 或 3D 向量（默认 'z'）；
 *   - points        可选，三点 [p1,p2,p3] 定面（与 axis 二选一，给了就优先用三点法向）；
 *   - width / height 可选，面片沿 n / b 方向的宽高（默认 4 / 3，0.01~10000）；
 *   - gridU / gridV  可选，沿 n / b 方向的内部网格细分数（默认 0，整数 0~32）；0 表示不画该方向内部线；
 *   - normalLength  可选，法向量线段长度（默认 1，0.01~10000）；
 *   - asBorder      可选，是否画四条边界线（默认 true）；
 *   - asGrid        可选，是否画内部网格线（默认 false，需 gridU/gridV ≥ 1 才有线）；
 *   - asNormal      可选，是否画中心出发的法向量线段（默认 false）；
 *   - asPoints      可选，是否在四角与中心放小球（默认 false）；
 *   - labelVertices 可选，是否标注四角 A/B/C/D 与中心 O（法向量端点另标 n，需 asNormal）（默认 false）；
 *   - vertexSize    可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。五个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolvePlane3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'pln' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- 法向：三点定面优先，否则 axis ----
  let axisUnit;
  let byPoints = false;
  let pointsParsed = null;
  if (cmd.points !== undefined) {
    axisUnit = planeNormalFromPoints(cmd.points);
    if (!axisUnit) return { ok: false, error: 'points 需为三点 [p1,p2,p3] 且不共线' };
    pointsParsed = cmd.points.map(parsePoint3);
    byPoints = true;
  } else {
    axisUnit = planeAxisUnit(cmd.axis);
    if (!axisUnit) return { ok: false, error: 'axis 需为 x/y/z 或合法非零 3D 向量' };
  }

  // ---- center：面片中心 / 锚点 ----
  let center;
  if (cmd.center !== undefined) {
    center = parsePoint3(cmd.center);
    if (center === null) return { ok: false, error: 'center 需为合法 [x,y,z] 点' };
  } else if (byPoints) {
    center = pointsParsed[0].slice();
  } else {
    center = PLANE3D_DEFAULT_CENTER.slice();
  }

  // ---- width / height：合法数值 + 区间 ----
  const wRaw = cmd.width === undefined ? PLANE3D_WIDTH_DEFAULT : num(cmd.width);
  if (wRaw === null) return { ok: false, error: 'width 必须是数字' };
  if (wRaw < PLANE3D_SPAN_MIN || wRaw > PLANE3D_SPAN_MAX) {
    return { ok: false, error: `width 需为 ${PLANE3D_SPAN_MIN}~${PLANE3D_SPAN_MAX} 的数` };
  }
  const hRaw = cmd.height === undefined ? PLANE3D_HEIGHT_DEFAULT : num(cmd.height);
  if (hRaw === null) return { ok: false, error: 'height 必须是数字' };
  if (hRaw < PLANE3D_SPAN_MIN || hRaw > PLANE3D_SPAN_MAX) {
    return { ok: false, error: `height 需为 ${PLANE3D_SPAN_MIN}~${PLANE3D_SPAN_MAX} 的数` };
  }
  const width = r4(wRaw);
  const height = r4(hRaw);

  // ---- gridU / gridV：区间内整数 ----
  const guRaw = cmd.gridU === undefined ? PLANE3D_GRID_DEFAULT : num(cmd.gridU);
  if (guRaw === null) return { ok: false, error: 'gridU 必须是数字' };
  if (!Number.isInteger(guRaw) || guRaw < PLANE3D_GRID_MIN || guRaw > PLANE3D_GRID_MAX) {
    return { ok: false, error: `gridU 需为 ${PLANE3D_GRID_MIN}~${PLANE3D_GRID_MAX} 的整数` };
  }
  const gvRaw = cmd.gridV === undefined ? PLANE3D_GRID_DEFAULT : num(cmd.gridV);
  if (gvRaw === null) return { ok: false, error: 'gridV 必须是数字' };
  if (!Number.isInteger(gvRaw) || gvRaw < PLANE3D_GRID_MIN || gvRaw > PLANE3D_GRID_MAX) {
    return { ok: false, error: `gridV 需为 ${PLANE3D_GRID_MIN}~${PLANE3D_GRID_MAX} 的整数` };
  }
  const gridU = guRaw;
  const gridV = gvRaw;

  // ---- normalLength：合法数值 + 区间 ----
  const nlRaw = cmd.normalLength === undefined ? PLANE3D_NORMAL_LENGTH_DEFAULT : num(cmd.normalLength);
  if (nlRaw === null) return { ok: false, error: 'normalLength 必须是数字' };
  if (nlRaw < PLANE3D_NORMAL_LENGTH_MIN || nlRaw > PLANE3D_NORMAL_LENGTH_MAX) {
    return { ok: false, error: `normalLength 需为 ${PLANE3D_NORMAL_LENGTH_MIN}~${PLANE3D_NORMAL_LENGTH_MAX} 的数` };
  }
  const normalLength = r4(nlRaw);

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asBorder', 'asGrid', 'asNormal', 'asPoints', 'labelVertices']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：小球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? PLANE3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < PLANE3D_VERTEX_SIZE_MIN || vsRaw > PLANE3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${PLANE3D_VERTEX_SIZE_MIN}~${PLANE3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asBorder = cmd.asBorder === undefined ? true : cmd.asBorder;
  const asGrid = cmd.asGrid === true;
  const asNormal = cmd.asNormal === true;
  const asPoints = cmd.asPoints === true;
  const labelVertices = cmd.labelVertices === true;
  if (!asBorder && !asGrid && !asNormal && !asPoints && !labelVertices) {
    return { ok: false, error: 'asBorder / asGrid / asNormal / asPoints / labelVertices 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：正交标架 + 四角 ----
  const basis = planeBasis(axisUnit);
  if (!basis) return { ok: false, error: '无法构造垂直法向的正交标架' };
  const corners = planeCorners(center, basis.n, basis.b, width, height);

  // ---- 守恒读数：共面、对边、对角中点 ----
  let planeMaxDeviation = 0;
  for (const q of corners) {
    planeMaxDeviation = Math.max(planeMaxDeviation, Math.abs(dot3(sub3(q, center), axisUnit)));
  }
  const edge1 = sub3(corners[1], corners[0]);
  const edge3 = sub3(corners[2], corners[3]);
  const edge2 = sub3(corners[3], corners[0]);
  const edge4 = sub3(corners[2], corners[1]);
  let edgeMaxDeviation = 0;
  for (const [a, b] of [[edge1, edge3], [edge2, edge4]]) {
    edgeMaxDeviation = Math.max(edgeMaxDeviation, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }
  const mid13 = r4Vec([0, 1, 2].map((k) => (corners[0][k] + corners[2][k]) / 2));
  const mid24 = r4Vec([0, 1, 2].map((k) => (corners[1][k] + corners[3][k]) / 2));
  const diagMaxDeviation = Math.max(
    Math.abs(mid13[0] - center[0]), Math.abs(mid13[1] - center[1]), Math.abs(mid13[2] - center[2]),
    Math.abs(mid24[0] - center[0]), Math.abs(mid24[1] - center[1]), Math.abs(mid24[2] - center[2]),
  );
  const normalEnd = r4Vec([0, 1, 2].map((k) => center[k] + normalLength * axisUnit[k]));

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const gridLines = asGrid ? Math.max(0, gridU - 1) + Math.max(0, gridV - 1) : 0;
  const lineCount = (asBorder ? 4 : 0) + gridLines + (asNormal ? 1 : 0);
  if (lineCount > PLANE3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${PLANE3D_MAX_SEGMENTS}` };
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

  const mkLine = (id, p1, p2) => ({
    id,
    type: 'line',
    text: '',
    color: lineColor,
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

  // ---- 边界：四角首尾相连 4 段 ----
  if (asBorder) {
    for (let i = 0; i < 4; i++) {
      items.push(mkLine(nextId(`${stem}_e${i + 1}`.slice(0, 64)), corners[i], corners[(i + 1) % 4]));
    }
  }

  // ---- 内部网格：沿 n / b 方向分别画平行线（恒落在面片平面内） ----
  if (asGrid) {
    const at = (su, sv) => r4Vec([0, 1, 2].map((k) => center[k] + su * (width / 2) * basis.n[k] + sv * (height / 2) * basis.b[k]));
    for (let i = 1; i < gridU; i++) {
      const su = -1 + 2 * i / gridU;
      items.push(mkLine(nextId(`${stem}_gu${i}`.slice(0, 64)), at(su, -1), at(su, 1)));
    }
    for (let j = 1; j < gridV; j++) {
      const sv = -1 + 2 * j / gridV;
      items.push(mkLine(nextId(`${stem}_gv${j}`.slice(0, 64)), at(-1, sv), at(1, sv)));
    }
  }

  // ---- 法向量：中心出发沿 axisUnit 的线段 ----
  if (asNormal) {
    items.push(mkLine(nextId(`${stem}_n1`.slice(0, 64)), center, normalEnd));
  }

  // ---- 可选：四角与中心小球（先中心 O，再 A/B/C/D） ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), center));
    for (let i = 0; i < 4; i++) {
      items.push(mkPoint(nextId(`${stem}_p${i + 1}`.slice(0, 64)), corners[i]));
    }
  }

  // ---- 可选：中心 O 与四角 A/B/C/D 标注（法向量端点 n 需 asNormal） ----
  if (labelVertices) {
    items.push(mkLabel(nextId(`${stem}_lO`.slice(0, 64)), 'O', center));
    for (let i = 0; i < 4; i++) {
      items.push(mkLabel(nextId(`${stem}_l${i + 1}`.slice(0, 64)), PLANE3D_LABELS[i], corners[i]));
    }
    if (asNormal) {
      items.push(mkLabel(nextId(`${stem}_ln`.slice(0, 64)), 'n', normalEnd));
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      center: center.slice(),
      axis: axisUnit.slice(),
      byPoints,
      points: pointsParsed ? pointsParsed.map((p) => p.slice()) : null,
      width,
      height,
      gridU,
      gridV,
      normalLength,
      basis: { n: basis.n.slice(), b: basis.b.slice() },
      corners: corners.map((p) => p.slice()),
      normalEnd,
      planeMaxDeviation: r4(planeMaxDeviation),
      edgeMaxDeviation: r4(edgeMaxDeviation),
      diagMaxDeviation: r4(diagMaxDeviation),
      asBorder,
      asGrid,
      asNormal,
      asPoints,
      labelVertices,
      vertexSize,
      borderCount: asBorder ? 4 : 0,
      gridLineCount: gridLines,
      normalCount: asNormal ? 1 : 0,
      pointCount: asPoints ? 5 : 0,
      labelCount: labelVertices ? (asNormal ? 6 : 5) : 0,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「空间二面角 / 平面角标注（dihedral3d）」参数化生成命令的纯函数语义层（2026-11-24 D32 增量）
 *
 * 与 js/board3d-cone.js / -cylinder.js / -conefrustum.js / -plane.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个二面角的平面角」这类意图，用一条命令生成标准作图：
 *   棱线（可选）+ 从棱上垂足 O 出发、分别落在两个半平面内且垂直棱的两条射线（平面角的两边）
 *   + 两射线端点连线（可选）+ 平面角圆弧 + 角度读数标注。
 *   产出由 line（及可选 point / label）构成的规格数组，可直接交给 board3dApi.add() 逐段落地。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 能量「三点夹角」（两条线段的夹角），但量不了「两个半平面的夹角」；
 *   - plane3d 只画单个平面面片、arc3d 只画给定圆心的圆弧、vector3d 只画单条有向线段，
 *     都不构造「同一垂足 + 两条垂直棱的射线 + 圆弧」这一整套二面角平面角作图；
 *   - dihedral3d 给「棱 edge 上两点 + 半平面内一点 pointA + 另半平面内一点 pointB」，
 *     自动求垂足与两个半平面内垂直棱的射线方向，直接服务「二面角 / 平面角 / 空间角标注」核心用例。
 *
 * 几何定义：
 *   u = normalize(edge[1] − edge[0])                         （棱的单位方向）；
 *   O = edge[0] + footT·(edge[1] − edge[0])（未给 foot 时；给了 foot 则投影到棱所在直线）；
 *   dA = normalize( (pointA − O) − ((pointA − O)·u)·u )      （pointA−O 在垂直 u 平面上的投影，
 *        因 pointA 在半平面 α 内且 α 含棱，故 dA 落在 α 内且 dA⊥u —— 平面角的一边）；
 *   dB 同理落在半平面 β 内且 dB⊥u —— 平面角的另一边；
 *   θ = arccos(clamp(dA·dB, −1, 1)) ∈ [0, π]                  （二面角的平面角）；
 *   perp = normalize(u × dA)，若 perp·dB < 0 取反             （垂直 dA、指向 dB 侧的单位向量）；
 *   圆弧第 i 点 P_i = O + arcRadius·(cos φ_i·dA + sin φ_i·perp)，φ_i = θ·i / segments。
 * 守恒：
 *   |u| = |dA| = |dB| = 1；dA·u = dB·u = 0（两边恒垂直棱）；
 *   O 恒在棱所在直线上（(O−edge[0]) × u = 0）；
 *   |射线端点 − O| = rayLength；圆弧各点到 O 距离恒为 arcRadius；
 *   圆弧首点 = O + arcRadius·dA、末点 = O + arcRadius·dB（弧精确夹在两边之间）；
 *   dA·dB = cos θ，角度读数 angleDeg = θ·180/π。
 *   本命令只校验数值与点位合法，不强制半平面与场景其它对象无交。
 */

/** 平面角两边射线长度合法区间 */
export const DIHEDRAL3D_RAY_LENGTH_MIN = 0.01;
export const DIHEDRAL3D_RAY_LENGTH_MAX = 10000;
export const DIHEDRAL3D_RAY_LENGTH_DEFAULT = 1;

/** 圆弧半径合法区间（超过 rayLength 时自动钳制到 rayLength） */
export const DIHEDRAL3D_ARC_RADIUS_MIN = 0.01;
export const DIHEDRAL3D_ARC_RADIUS_MAX = 10000;
export const DIHEDRAL3D_ARC_RADIUS_DEFAULT = 0.5;

/** 垂足在棱段上的位置比例（0~1） */
export const DIHEDRAL3D_FOOT_T_MIN = 0;
export const DIHEDRAL3D_FOOT_T_MAX = 1;
export const DIHEDRAL3D_FOOT_T_DEFAULT = 0.5;

/** 圆弧分段数（分段越多越平滑） */
export const DIHEDRAL3D_SEGMENTS_MIN = 3;
export const DIHEDRAL3D_SEGMENTS_MAX = 64;
export const DIHEDRAL3D_SEGMENTS_DEFAULT = 24;

/** 小球半径（与其余 3D 命令同口径） */
export const DIHEDRAL3D_VERTEX_SIZE_MIN = 0.01;
export const DIHEDRAL3D_VERTEX_SIZE_MAX = 1;
export const DIHEDRAL3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const DIHEDRAL3D_MAX_SEGMENTS = 4096;

/** 默认棱（x 轴上从 -1 到 1）/ 默认两点：构成标准 90° 二面角（xy 面与 xz 面） */
export const DIHEDRAL3D_DEFAULT_EDGE = Object.freeze([Object.freeze([-1, 0, 0]), Object.freeze([1, 0, 0])]);
export const DIHEDRAL3D_DEFAULT_POINT_A = Object.freeze([0, 1, 0]);
export const DIHEDRAL3D_DEFAULT_POINT_B = Object.freeze([0, 0, 1]);

/** 坐标钳制上限（与 geometry / cone3d / conefrustum 一致） */
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

/** 解析棱上两点：均须为合法 3D 点且不重合，返回 [p1, p2]（新数组） */
function parseEdge(v) {
  const src = v === undefined ? DIHEDRAL3D_DEFAULT_EDGE : v;
  if (!Array.isArray(src) || src.length !== 2) return null;
  const p1 = parsePoint3(src[0]);
  const p2 = parsePoint3(src[1]);
  if (!p1 || !p2 || len3(sub3(p2, p1)) < 1e-6) return null;
  return [p1, p2];
}

/**
 * 棱的单位方向 u = normalize(edge[1] − edge[0])。纯函数、只读入参。
 * @returns {Array|null} 单位向量 [ux,uy,uz]（新数组）或 null
 */
export function dihedralEdgeUnit(edge) {
  const e = parseEdge(edge);
  if (!e) return null;
  return unit(sub3(e[1], e[0]));
}

/**
 * 垂足 O：未给 foot 时按 footT 在棱段上取点；给了 foot 则投影到棱所在直线（可取到延长线上）。
 * 纯函数、只读入参。
 * @returns {Array|null} 垂足点 [x,y,z]（新数组）或 null
 */
export function dihedralFoot(edge, footT, foot) {
  const e = parseEdge(edge);
  if (!e) return null;
  const u = unit(sub3(e[1], e[0]));
  if (!u) return null;
  const anchor = foot === undefined ? r4Vec([0, 1, 2].map((k) => e[0][k] + footT * (e[1][k] - e[0][k]))) : parsePoint3(foot);
  if (!anchor) return null;
  const proj = dot3(sub3(anchor, e[0]), u);
  return r4Vec([0, 1, 2].map((k) => e[0][k] + proj * u[k]));
}

/**
 * 半平面内、过垂足 O 且垂直棱 u 的射线方向：
 * d = normalize( (point − O) − ((point − O)·u)·u )，即 point−O 在垂直 u 平面上的投影。
 * point 落在棱上（投影退化）时返回 null。纯函数、只读入参。
 * @returns {Array|null} 单位方向 [dx,dy,dz]（新数组）或 null
 */
export function dihedralFaceDir(O, point, u) {
  const o = parsePoint3(O);
  const p = parsePoint3(point);
  if (!o || !p || !Array.isArray(u) || u.length !== 3 || !u.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const w = sub3(p, o);
  const proj = dot3(w, u);
  return unit(sub3(w, [proj * u[0], proj * u[1], proj * u[2]]));
}

/**
 * 圆弧旋转参考向量：perp = normalize(u × dA)，若 perp·dB < 0 取反，
 * 使圆弧从 dA 沿 perp 转到 dB。θ 接近 0 或 π 时点积近 0，取任一垂直方向均可（弧退化为点/半圆）。
 * 纯函数、只读入参。
 * @returns {Array|null} 单位向量 [px,py,pz]（新数组）或 null
 */
export function dihedralArcPerp(u, dA, dB) {
  if (!Array.isArray(u) || u.length !== 3 || !Array.isArray(dA) || dA.length !== 3 || !Array.isArray(dB) || dB.length !== 3) return null;
  let perp = unit(cross3(u, dA));
  if (!perp) return null;
  if (dot3(perp, dB) < 0) perp = r4Vec(perp.map((x) => -x));
  return perp;
}

/**
 * 解析一条 dihedral3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"dihedral3d","id":"dh","edge":[[-1,0,0],[1,0,0]],"pointA":[0,1,0],"pointB":[0,0,1],
 *    "footT":0.5,"rayLength":1,"arcRadius":0.5,"segments":24,"asEdge":true,"asRays":true,
 *    "asArc":true,"asChord":false,"asPoints":false,"labelAngle":true,"vertexSize":0.1,"color":"#4f6bed"}
 *   - edge      可选，棱上两点 [[x1,y1,z1],[x2,y2,z2]]（默认 x 轴 [-1,0,0]→[1,0,0]）；
 *   - pointA    可选，半平面 α 内一点 [x,y,z]（默认 [0,1,0]）；
 *   - pointB    可选，半平面 β 内一点 [x,y,z]（默认 [0,0,1]）；
 *   - footT     可选，垂足在棱段上的位置比例 0~1（默认 0.5，即棱中点）；
 *   - foot      可选，显式垂足点 [x,y,z]（给了就投影到棱所在直线，忽略 footT）；
 *   - rayLength 可选，平面角两边射线长度（默认 1，0.01~10000）；
 *   - arcRadius 可选，圆弧半径（默认 0.5，0.01~10000；超过 rayLength 自动钳制到 rayLength）；
 *   - segments  可选，圆弧分段数（默认 24，整数 3~64）；
 *   - asEdge    可选，是否画棱线（默认 true）；
 *   - asRays    可选，是否画平面角两边（默认 true）；
 *   - asArc     可选，是否画平面角圆弧（默认 true）；
 *   - asChord   可选，是否画两射线端点连线（默认 false）；
 *   - asPoints  可选，是否在垂足与两射线端点放小球（默认 false）；
 *   - labelAngle 可选，是否标注角度读数（默认 true）；
 *   - vertexSize 可选，小球半径（默认 0.1，区间 0.01~1）；
 *   - color / labelColor / opacity 可选，样式。六个输出开关至少开一个。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line / point / label 规格；全程不修改入参。
 */
export function resolveDihedral3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'dh' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- edge：棱上两点 ----
  const edge = cmd.edge === undefined
    ? parseEdge(DIHEDRAL3D_DEFAULT_EDGE)
    : parseEdge(cmd.edge);
  if (!edge) return { ok: false, error: 'edge 需为两个不同合法 [x,y,z] 点' };

  // ---- pointA / pointB：两个半平面内点 ----
  const pointA = cmd.pointA === undefined ? DIHEDRAL3D_DEFAULT_POINT_A.slice() : parsePoint3(cmd.pointA);
  if (!pointA) return { ok: false, error: 'pointA 需为合法 [x,y,z] 点' };
  const pointB = cmd.pointB === undefined ? DIHEDRAL3D_DEFAULT_POINT_B.slice() : parsePoint3(cmd.pointB);
  if (!pointB) return { ok: false, error: 'pointB 需为合法 [x,y,z] 点' };

  // ---- footT：垂足比例 + 区间（出现即校验） ----
  const tRaw = cmd.footT === undefined ? DIHEDRAL3D_FOOT_T_DEFAULT : num(cmd.footT);
  if (tRaw === null) return { ok: false, error: 'footT 必须是数字' };
  if (tRaw < DIHEDRAL3D_FOOT_T_MIN || tRaw > DIHEDRAL3D_FOOT_T_MAX) {
    return { ok: false, error: `footT 需为 ${DIHEDRAL3D_FOOT_T_MIN}~${DIHEDRAL3D_FOOT_T_MAX}` };
  }
  const footT = tRaw;

  // ---- foot / 垂足：显式 foot 优先，否则按 footT ----
  if (cmd.foot !== undefined && parsePoint3(cmd.foot) === null) {
    return { ok: false, error: 'foot 需为合法 [x,y,z] 点' };
  }
  const footPoint = dihedralFoot(edge, footT, cmd.foot);
  if (!footPoint) return { ok: false, error: '无法求棱上垂足' };

  // ---- rayLength：射线长度 + 区间 ----
  const rlRaw = cmd.rayLength === undefined ? DIHEDRAL3D_RAY_LENGTH_DEFAULT : num(cmd.rayLength);
  if (rlRaw === null) return { ok: false, error: 'rayLength 必须是数字' };
  if (rlRaw < DIHEDRAL3D_RAY_LENGTH_MIN || rlRaw > DIHEDRAL3D_RAY_LENGTH_MAX) {
    return { ok: false, error: `rayLength 需为 ${DIHEDRAL3D_RAY_LENGTH_MIN}~${DIHEDRAL3D_RAY_LENGTH_MAX}` };
  }
  const rayLength = r4(rlRaw);

  // ---- arcRadius：圆弧半径 + 区间（出现即校验，超 rayLength 自动钳制） ----
  const arRaw = cmd.arcRadius === undefined ? DIHEDRAL3D_ARC_RADIUS_DEFAULT : num(cmd.arcRadius);
  if (arRaw === null) return { ok: false, error: 'arcRadius 必须是数字' };
  if (arRaw < DIHEDRAL3D_ARC_RADIUS_MIN || arRaw > DIHEDRAL3D_ARC_RADIUS_MAX) {
    return { ok: false, error: `arcRadius 需为 ${DIHEDRAL3D_ARC_RADIUS_MIN}~${DIHEDRAL3D_ARC_RADIUS_MAX}` };
  }
  const arcRadiusRequested = r4(arRaw);
  const arcRadius = Math.min(arcRadiusRequested, rayLength);
  const arcRadiusClamped = arcRadius < arcRadiusRequested;

  // ---- segments：必须是区间内整数 ----
  const segRaw = cmd.segments === undefined ? DIHEDRAL3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw) || segRaw < DIHEDRAL3D_SEGMENTS_MIN || segRaw > DIHEDRAL3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${DIHEDRAL3D_SEGMENTS_MIN}~${DIHEDRAL3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  // ---- 输出开关：出现即须布尔 ----
  for (const flag of ['asEdge', 'asRays', 'asArc', 'asChord', 'asPoints', 'labelAngle']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  // ---- vertexSize：小球半径（出现即须合法） ----
  const vsRaw = cmd.vertexSize === undefined ? DIHEDRAL3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < DIHEDRAL3D_VERTEX_SIZE_MIN || vsRaw > DIHEDRAL3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${DIHEDRAL3D_VERTEX_SIZE_MIN}~${DIHEDRAL3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = r4(vsRaw);

  const asEdge = cmd.asEdge === undefined ? true : cmd.asEdge;
  const asRays = cmd.asRays === undefined ? true : cmd.asRays;
  const asArc = cmd.asArc === undefined ? true : cmd.asArc;
  const asChord = cmd.asChord === true;
  const asPoints = cmd.asPoints === true;
  const labelAngle = cmd.labelAngle === undefined ? true : cmd.labelAngle;
  if (!asEdge && !asRays && !asArc && !asChord && !asPoints && !labelAngle) {
    return { ok: false, error: 'asEdge / asRays / asArc / asChord / asPoints / labelAngle 至少开一个' };
  }

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 几何：棱方向 + 垂足 + 两半平面内垂直棱的射线方向 ----
  const u = dihedralEdgeUnit(edge);
  if (!u) return { ok: false, error: '无法求棱的单位方向' };
  const dA = dihedralFaceDir(footPoint, pointA, u);
  if (!dA) return { ok: false, error: 'pointA 落在棱上，无法确定半平面 α 的方向' };
  const dB = dihedralFaceDir(footPoint, pointB, u);
  if (!dB) return { ok: false, error: 'pointB 落在棱上，无法确定半平面 β 的方向' };
  const cosTheta = Math.min(1, Math.max(-1, dot3(dA, dB)));
  const theta = Math.acos(cosTheta);
  const perp = dihedralArcPerp(u, dA, dB);
  if (!perp) return { ok: false, error: '无法构造圆弧旋转参考向量' };

  const rayA = r4Vec([0, 1, 2].map((k) => footPoint[k] + rayLength * dA[k]));
  const rayB = r4Vec([0, 1, 2].map((k) => footPoint[k] + rayLength * dB[k]));
  const arcPoints = [];
  for (let i = 0; i <= segments; i++) {
    const phi = theta * i / segments;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    arcPoints.push(r4Vec([0, 1, 2].map((k) => footPoint[k] + arcRadius * (c * dA[k] + s * perp[k]))));
  }
  const arcMid = arcPoints[Math.floor(segments / 2)];
  const angleDeg = Math.round(theta * 180 / Math.PI * 10) / 10;
  const labelText = `${angleDeg}°`;

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const lineCount = (asEdge ? 1 : 0) + (asRays ? 2 : 0) + (asChord ? 1 : 0) + (asArc ? segments : 0);
  if (lineCount > DIHEDRAL3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${DIHEDRAL3D_MAX_SEGMENTS}` };
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

  // ---- 棱线 ----
  if (asEdge) items.push(mkLine(nextId(`${stem}_edge`.slice(0, 64)), edge[0], edge[1]));

  // ---- 平面角两边：从垂足 O 出发、分别垂直棱的两条射线 ----
  if (asRays) {
    items.push(mkLine(nextId(`${stem}_ra`.slice(0, 64)), footPoint, rayA));
    items.push(mkLine(nextId(`${stem}_rb`.slice(0, 64)), footPoint, rayB));
  }

  // ---- 圆弧：相邻采样点连成 segments 段，精确夹在两边之间 ----
  if (asArc) {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(`${stem}_arc${i + 1}`.slice(0, 64)), arcPoints[i], arcPoints[i + 1]));
    }
  }

  // ---- 两射线端点连线（构成平面角三角形第三边） ----
  if (asChord) items.push(mkLine(nextId(`${stem}_chord`.slice(0, 64)), rayA, rayB));

  // ---- 可选：垂足与两射线端点小球 ----
  if (asPoints) {
    items.push(mkPoint(nextId(`${stem}_pO`.slice(0, 64)), footPoint));
    items.push(mkPoint(nextId(`${stem}_pA`.slice(0, 64)), rayA));
    items.push(mkPoint(nextId(`${stem}_pB`.slice(0, 64)), rayB));
  }

  // ---- 可选：角度读数标注（放在圆弧中点处） ----
  if (labelAngle) items.push(mkLabel(nextId(`${stem}_angle`.slice(0, 64)), labelText, arcMid));

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      edge: edge.map((p) => p.slice()),
      u: u.slice(),
      foot: footPoint.slice(),
      footT: cmd.foot === undefined ? footT : null,
      footExplicit: cmd.foot !== undefined,
      pointA: pointA.slice(),
      pointB: pointB.slice(),
      dA: dA.slice(),
      dB: dB.slice(),
      perp: perp.slice(),
      angle: Math.round(theta * 1e4) / 1e4,
      angleDeg,
      rayLength,
      arcRadius,
      arcRadiusRequested,
      arcRadiusClamped,
      segments,
      arcPoints: arcPoints.map((p) => p.slice()),
      rayA,
      rayB,
      asEdge,
      asRays,
      asArc,
      asChord,
      asPoints,
      labelAngle,
      labelText,
      vertexSize,
      edgeCount: asEdge ? 1 : 0,
      rayCount: asRays ? 2 : 0,
      arcCount: asArc ? segments : 0,
      chordCount: asChord ? 1 : 0,
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

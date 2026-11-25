/**
 * 立体画板「空间平行 / 垂直关系标注（relation3d）」参数化生成命令的纯函数语义层（2026-11-25 D38 增量）
 *
 * 与 js/board3d-pointline.js / -lineangle.js / -skewline.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「标注两条棱平行 / 相邻棱垂直 / 棱与底面垂直」这类意图，用一条命令生成标准关系作图：
 *   line-line：两条直线 + 平行记号（各一条短杠）或垂直记号（交点处直角符号，异面时补平行辅助线）+ 关系文字；
 *   line-plane：直线 + 平面面片 + 平行记号（线上一杠 + 面内一杠）或垂直记号（交点处直角符号）+ 关系文字。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - measure3d 量两点距离 / 三点夹角 / 中点，不判定也不标注平行 / 垂直关系；
 *   - lineangle3d 画两线方向夹角（含 90° 直角符号），但不画平行记号、不处理线面关系；
 *   - dihedral3d 画二面角、lineplane3d 画线面角、pointplane3d 量点面距、skewline3d 量两线距离、
 *     pointline3d 量点线距 —— 都不能给「∥ / ⊥」关系标注；
 *   - relation3d 直接服务「正方体对棱平行 / 相邻棱垂直 / 侧棱⊥底面 / 空间关系标注」核心用例。
 *
 * 几何定义：
 *   line-line：eu=(q1−p1)/|·|，ev=(q2−p2)/|·|，c=|eu·ev|；
 *     c ≥ 1−tol → parallel；c ≤ tol → perpendicular；其余拒绝（不画假关系）。
 *     垂直相交时 O 为两线真实交点（t=(d·c−e·b)/(a·c−b²)，s=(t·b−e)/c）；
 *     垂直异面时 O 取 p1，并补一条过 O 且平行 L2 的辅助线后再画直角符号。
 *   line-plane：eu=(q−p)/|·|，nh=normalize((v1−v0)×(v2−v0)) 或 axis 单位向量，c=|eu·nh|；
 *     c ≤ tol → parallel（直线∥平面）；c ≥ 1−tol → perpendicular（直线⊥平面）；其余拒绝。
 *     垂直时 O = p + (((center−p)·nh)/(eu·nh))·eu，为直线与平面的真实交点。
 *
 * 守恒：|eu|=|ev|=|nh|=|e1|=|e2|=1；平行记号恒垂直对应直线、两记号方向一致；
 *   直角符号两边分别 ∥ 两垂直方向且互相垂直；平面面片四角恒共面、对边平行等长、对角中点为 center。
 */
const COORD_LIMIT = 10000;
const DIR_EPS = 1e-9;
const INTERSECT_EPS = 1e-6;

/** 关系判定容差：|dot| ≤ tol 视为垂直，|dot| ≥ 1−tol 视为平行 */
export const RELATION3D_TOL_MIN = 0;
export const RELATION3D_TOL_MAX = 0.2;
export const RELATION3D_TOL_DEFAULT = 0.02;

/** 直线两端延长长度合法区间与默认 */
export const RELATION3D_EXTEND_MIN = 0;
export const RELATION3D_EXTEND_MAX = 1000;
export const RELATION3D_EXTEND_DEFAULT = 0;

/** 关系记号 / 直角符号边长合法区间与默认 */
export const RELATION3D_MARK_SIZE_MIN = 0.05;
export const RELATION3D_MARK_SIZE_MAX = 100;
export const RELATION3D_MARK_SIZE_DEFAULT = 0.25;

/** 平面面片宽高合法区间与默认 */
export const RELATION3D_WIDTH_MIN = 0.1;
export const RELATION3D_WIDTH_MAX = 1000;
export const RELATION3D_WIDTH_DEFAULT = 4;
export const RELATION3D_HEIGHT_MIN = 0.1;
export const RELATION3D_HEIGHT_MAX = 1000;
export const RELATION3D_HEIGHT_DEFAULT = 3;

/** 小球半径合法区间与默认 */
export const RELATION3D_VERTEX_SIZE_MIN = 0.01;
export const RELATION3D_VERTEX_SIZE_MAX = 1;
export const RELATION3D_VERTEX_SIZE_DEFAULT = 0.1;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const RELATION3D_MAX_SEGMENTS = 4096;

/** 默认两直线：x 轴与 y 轴，相互垂直并在原点相交 */
export const RELATION3D_DEFAULT_LINE1 = Object.freeze([0, 0, 0]);
export const RELATION3D_DEFAULT_LINE1_TO = Object.freeze([2, 0, 0]);
export const RELATION3D_DEFAULT_LINE2 = Object.freeze([0, 0, 0]);
export const RELATION3D_DEFAULT_LINE2_TO = Object.freeze([0, 2, 0]);
/** 默认平面：xy 面，中心原点、法向 z */
export const RELATION3D_DEFAULT_CENTER = Object.freeze([0, 0, 0]);
export const RELATION3D_DEFAULT_AXIS = 'z';

/** 支持的 kind / relation 白名单 */
export const RELATION3D_KINDS = Object.freeze(['line-line', 'line-plane']);
export const RELATION3D_RELATIONS = Object.freeze(['auto', 'parallel', 'perpendicular']);

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
  return m > DIR_EPS ? [a[0] / m, a[1] / m, a[2] / m] : null;
};

/** 垂直于 u 的任一单位向量（退化兜底） */
function perpendicular(u) {
  const helper = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  return unit(cross3(u, helper)) || unit(cross3(u, [1, 0, 0]));
}

/**
 * 解析「直线两点」并单位化方向（只读）。
 * @returns {{ok:true, a:Array, b:Array, u:Array, length:number} | {ok:false, error:string}}
 */
export function relationLineUnit(a, b) {
  const A = parsePoint3(a);
  const B = parsePoint3(b);
  if (!A || !B) return { ok: false, error: '直线两点需为合法 [x,y,z]' };
  const d = sub3(B, A);
  const length = len3(d);
  if (length < DIR_EPS) return { ok: false, error: '直线两点不能重合（方向退化）' };
  const u = unit(d);
  if (!u) return { ok: false, error: '无法单位化直线方向' };
  return { ok: true, a: A, b: B, u: r4Vec(u), length: r4(length) };
}

/**
 * 解析空间平面：points 三点 或 center+axis（二者互斥，只读）。
 * @returns {{ok:true, center:Array, normal:Array, e1:Array, e2:Array, viaPoints:boolean} | {ok:false, error:string}}
 */
export function relationPlane(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '平面参数为空' };
  const hasPoints = cmd.points !== undefined;
  const hasCenterAxis = cmd.center !== undefined || cmd.axis !== undefined;
  if (hasPoints && hasCenterAxis) return { ok: false, error: 'points 与 center/axis 不能同时使用' };

  let center;
  let normal;
  if (hasPoints) {
    if (!Array.isArray(cmd.points) || cmd.points.length !== 3) return { ok: false, error: 'points 需为三点' };
    const pts = cmd.points.map(parsePoint3);
    if (pts.some((p) => p === null)) return { ok: false, error: 'points 点非法' };
    const n = unit(cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0])));
    if (!n) return { ok: false, error: 'points 三点共线，不能确定平面' };
    center = pts[0];
    normal = n;
  } else {
    center = parsePoint3(cmd.center === undefined ? RELATION3D_DEFAULT_CENTER : cmd.center);
    if (!center) return { ok: false, error: 'center 需为合法 [x,y,z]' };
    const ax = cmd.axis === undefined ? RELATION3D_DEFAULT_AXIS : cmd.axis;
    if (typeof ax === 'string') {
      const map = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
      if (!map[ax]) return { ok: false, error: 'axis 字符串只能是 x/y/z' };
      normal = map[ax];
    } else {
      const axPoint = parsePoint3(ax);
      normal = axPoint ? unit(axPoint) : null;
      if (!normal) return { ok: false, error: 'axis 需为 x/y/z 或合法非零向量' };
    }
  }
  const e1 = unit(cross3(normal, Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
  if (!e1) return { ok: false, error: '无法构造平面内标架' };
  const e2 = unit(cross3(normal, e1));
  if (!e2) return { ok: false, error: '无法构造平面内标架' };
  return {
    ok: true, center, normal: r4Vec(normal), e1: r4Vec(e1), e2: r4Vec(e2), viaPoints: hasPoints,
  };
}

/**
 * 由 |dot| 与容差判定关系；既不平行也不垂直返回 null（调用方原子拒绝）。
 */
export function relationClassify(absDot, tol) {
  if (!Number.isFinite(absDot) || !Number.isFinite(tol)) return null;
  if (absDot >= 1 - tol) return 'parallel';
  if (absDot <= tol) return 'perpendicular';
  return null;
}

/**
 * 纯几何核心：判定 kind 对应的平行 / 垂直关系并给出作图锚点（只读）。
 *
 * @returns {{ok:true, kind, relation, dot, absDot, tol, ...} | {ok:false, error:string}}
 */
export function relation3DGeometry(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };
  const kind = cmd.kind === undefined ? 'line-line' : cmd.kind;
  if (!RELATION3D_KINDS.includes(kind)) return { ok: false, error: `kind 非法：${String(kind)}` };
  const tolRaw = cmd.tol === undefined ? RELATION3D_TOL_DEFAULT : num(cmd.tol);
  if (tolRaw === null || tolRaw < RELATION3D_TOL_MIN || tolRaw > RELATION3D_TOL_MAX) {
    return { ok: false, error: `tol 需为 ${RELATION3D_TOL_MIN}~${RELATION3D_TOL_MAX}` };
  }
  const tol = r4(tolRaw);
  const want = cmd.relation === undefined ? 'auto' : cmd.relation;
  if (!RELATION3D_RELATIONS.includes(want)) return { ok: false, error: `relation 非法：${String(want)}` };

  if (kind === 'line-line') {
    const l1 = relationLineUnit(
      cmd.line1 === undefined ? RELATION3D_DEFAULT_LINE1 : cmd.line1[0],
      cmd.line1 === undefined ? RELATION3D_DEFAULT_LINE1_TO : cmd.line1[1]
    );
    if (!l1.ok) return { ok: false, error: 'line1 ' + l1.error };
    let l2;
    if (cmd.line2 === undefined) {
      l2 = relationLineUnit(RELATION3D_DEFAULT_LINE2, RELATION3D_DEFAULT_LINE2_TO);
    } else {
      if (!Array.isArray(cmd.line2) || cmd.line2.length !== 2) return { ok: false, error: 'line2 需为两点' };
      l2 = relationLineUnit(cmd.line2[0], cmd.line2[1]);
    }
    if (!l2.ok) return { ok: false, error: 'line2 ' + l2.error };

    const d = dot3(l1.u, l2.u);
    const absDot = Math.abs(r4(d));
    const detected = relationClassify(absDot, tol);
    if (!detected) return { ok: false, error: `两直线既不平行也不垂直（|eu·ev|=${absDot}）` };
    if (want !== 'auto' && want !== detected) {
      return { ok: false, error: `指定关系 ${want} 与几何实测 ${detected} 不符` };
    }

    let origin = null;
    let intersect = false;
    let helperLine = null;
    if (detected === 'perpendicular') {
      // 垂直时 a·c−b² = |u|²|v|²，远大于 0，可安全求真实交点。
      const u = sub3(l1.b, l1.a);
      const v = sub3(l2.b, l2.a);
      const w = sub3(l2.a, l1.a);
      const aa = dot3(u, u), bb = dot3(u, v), cc = dot3(v, v);
      const dd = dot3(w, u), ee = dot3(w, v);
      const det = aa * cc - bb * bb;
      if (det > DIR_EPS) {
        const t = (dd * cc - ee * bb) / det;
        const s = (t * bb - ee) / cc;
        const O = r4Vec([0, 1, 2].map((k) => l1.a[k] + t * u[k]));
        const Q = r4Vec([0, 1, 2].map((k) => l2.a[k] + s * v[k]));
        intersect = len3(sub3(O, Q)) < INTERSECT_EPS;
        origin = r4Vec(intersect ? O : l1.a);
      } else {
        origin = l1.a.slice();
      }
      if (!intersect) helperLine = [origin.slice(), r4Vec([0, 1, 2].map((k) => origin[k] + l2.u[k]))];
    } else {
      origin = r4Vec([0, 1, 2].map((k) => (l1.a[k] + l1.b[k] + l2.a[k] + l2.b[k]) / 4));
    }

    return {
      ok: true, kind, relation: detected, requested: want, tol, dot: r4(d), absDot,
      line1: { a: l1.a, b: l1.b, u: l1.u }, line2: { a: l2.a, b: l2.b, u: l2.u },
      origin, intersect, helperLine,
      markDir: detected === 'parallel' ? perpendicular(l1.u) : l2.u,
    };
  }

  // kind === 'line-plane'
  const ln = relationLineUnit(
    cmd.line === undefined ? RELATION3D_DEFAULT_LINE1 : cmd.line[0],
    cmd.line === undefined ? RELATION3D_DEFAULT_LINE1_TO : cmd.line[1]
  );
  if (!ln.ok) return { ok: false, error: 'line ' + ln.error };
  const pl = relationPlane(cmd);
  if (!pl.ok) return pl;

  const d = dot3(ln.u, pl.normal);
  const absDot = Math.abs(r4(d));
  // 注意 line-plane 的 c=|eu·nh| 与 line-line 的 c=|eu·ev| 语义相反：
  // 直线∥平面 ⇔ eu⊥nh ⇒ c≈0；直线⊥平面 ⇔ eu∥nh ⇒ c≈1。
  const detected = absDot <= tol ? 'parallel' : (absDot >= 1 - tol ? 'perpendicular' : null);
  if (!detected) return { ok: false, error: `直线与平面既不平行也不垂直（|eu·nh|=${absDot}）` };
  if (want !== 'auto' && want !== detected) {
    return { ok: false, error: `指定关系 ${want} 与几何实测 ${detected} 不符` };
  }

  let origin = null;
  if (detected === 'perpendicular') {
    const denom = d;
    const t = dot3(sub3(pl.center, ln.a), pl.normal) / denom;
    origin = r4Vec([0, 1, 2].map((k) => ln.a[k] + t * ln.u[k]));
  } else {
    origin = r4Vec([0, 1, 2].map((k) => (ln.a[k] + ln.b[k]) / 2));
  }
  // 平面内、垂直直线方向的记号方向：u×nh（平行时 u⊥nh；垂直时改用 e1）。
  const markDir = detected === 'parallel' ? unit(cross3(ln.u, pl.normal)) : pl.e1;
  if (!markDir) return { ok: false, error: '无法构造关系记号方向' };

  return {
    ok: true, kind, relation: detected, requested: want, tol, dot: r4(d), absDot,
    line: { a: ln.a, b: ln.b, u: ln.u },
    plane: { center: pl.center, normal: pl.normal, e1: pl.e1, e2: pl.e2, viaPoints: pl.viaPoints },
    origin, intersect: detected === 'perpendicular', helperLine: null,
    markDir: r4Vec(markDir),
  };
}

/**
 * 解析一条 relation3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"relation3d","id":"rel","kind":"line-line","relation":"auto","tol":0.02,
 *    "line1":[[0,0,0],[2,0,0]],"line2":[[0,0,0],[0,2,0]],
 *    "line":[[0,0,0],[2,0,0]],"center":[0,0,0],"axis":"z","points":null,
 *    "extend":0,"markSize":0.25,"width":4,"height":3,
 *    "asLines":true,"asMark":true,"asPoints":false,"labelRelation":true,"labelNames":false,
 *    "vertexSize":0.1,"color":"#4f6bed"}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveRelation3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'rel' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const numeric = (key, def, min, max) => {
    const raw = cmd[key] === undefined ? def : num(cmd[key]);
    if (raw === null) return { error: `${key} 必须是数字` };
    if (raw < min || raw > max) return { error: `${key} 需为 ${min}~${max}` };
    return { value: r4(raw) };
  };
  const tolR = numeric('tol', RELATION3D_TOL_DEFAULT, RELATION3D_TOL_MIN, RELATION3D_TOL_MAX);
  if (tolR.error) return { ok: false, error: tolR.error };
  const exR = numeric('extend', RELATION3D_EXTEND_DEFAULT, RELATION3D_EXTEND_MIN, RELATION3D_EXTEND_MAX);
  if (exR.error) return { ok: false, error: exR.error };
  const mkR = numeric('markSize', RELATION3D_MARK_SIZE_DEFAULT, RELATION3D_MARK_SIZE_MIN, RELATION3D_MARK_SIZE_MAX);
  if (mkR.error) return { ok: false, error: mkR.error };
  const wR = numeric('width', RELATION3D_WIDTH_DEFAULT, RELATION3D_WIDTH_MIN, RELATION3D_WIDTH_MAX);
  if (wR.error) return { ok: false, error: wR.error };
  const hR = numeric('height', RELATION3D_HEIGHT_DEFAULT, RELATION3D_HEIGHT_MIN, RELATION3D_HEIGHT_MAX);
  if (hR.error) return { ok: false, error: hR.error };
  const vsR = numeric('vertexSize', RELATION3D_VERTEX_SIZE_DEFAULT, RELATION3D_VERTEX_SIZE_MIN, RELATION3D_VERTEX_SIZE_MAX);
  if (vsR.error) return { ok: false, error: vsR.error };

  const FLAGS = ['asLines', 'asMark', 'asPoints', 'labelRelation', 'labelNames'];
  for (const flag of FLAGS) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }
  const asLines = cmd.asLines === undefined ? true : cmd.asLines;
  const asMark = cmd.asMark === undefined ? true : cmd.asMark;
  const asPoints = cmd.asPoints === true;
  const labelRelation = cmd.labelRelation === undefined ? true : cmd.labelRelation;
  const labelNames = cmd.labelNames === true;
  if (!asLines && !asMark && !asPoints && !labelRelation && !labelNames) {
    return { ok: false, error: '五个输出开关至少开一个' };
  }

  const extend = exR.value;
  const markSize = mkR.value;
  const width = wR.value;
  const height = hR.value;
  const vertexSize = vsR.value;
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  const g = relation3DGeometry(cmd);
  if (!g.ok) return { ok: false, error: g.error };
  const { kind, relation, origin, markDir, dot, absDot } = g;
  const symbolText = relation === 'parallel' ? '∥' : '⊥';

  // 预估段数，超上限原子拒绝（避免生成到一半才中断）
  const baseLines = kind === 'line-line' ? 2 : 5; // 两直线 / 直线+面片四边
  const helperCount = kind === 'line-line' && relation === 'perpendicular' && !g.intersect ? 1 : 0;
  const markCount = asMark ? 2 : 0;
  const totalLines = (asLines ? baseLines : 0) + helperCount + markCount;
  if (totalLines > RELATION3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${totalLines} 超过上限 ${RELATION3D_MAX_SEGMENTS}` };
  }

  // id 避让：收集 state 现有 id，生成时逐一避让
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

  const mkLine = (id, p, q) => ({
    id, type: 'line', text: '', color: lineColor, opacity: lineOpacity,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    p: { x1: p[0], y1: p[1], z1: p[2], x2: q[0], y2: q[1], z2: q[2] },
  });
  const mkPoint = (id, p) => ({
    id, type: 'point', text: '', color: lineColor, opacity: lineOpacity,
    pos: p.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: { s: vertexSize },
  });
  const mkLabel = (id, text, p) => ({
    id, type: 'label', text, color: labelColor, opacity: 1,
    pos: p.slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: {},
  });
  const shifted = (a, b, t) => r4Vec([0, 1, 2].map((k) => b[k] + t * a[k]));

  const items = [];
  let lineCount = 0;
  let markCountActual = 0;
  let pointCount = 0;
  let labelCount = 0;
  const corners = [];

  // ---- 主体直线 / 平面面片 ----
  if (asLines) {
    if (kind === 'line-line') {
      const l1 = g.line1, l2 = g.line2;
      const s1 = r4Vec([0, 1, 2].map((k) => l1.a[k] - extend * l1.u[k]));
      const e1p = r4Vec([0, 1, 2].map((k) => l1.b[k] + extend * l1.u[k]));
      const s2 = r4Vec([0, 1, 2].map((k) => l2.a[k] - extend * l2.u[k]));
      const e2p = r4Vec([0, 1, 2].map((k) => l2.b[k] + extend * l2.u[k]));
      items.push(mkLine(nextId(`${stem}_l1`.slice(0, 64)), s1, e1p));
      items.push(mkLine(nextId(`${stem}_l2`.slice(0, 64)), s2, e2p));
      lineCount += 2;
    } else {
      const ln = g.line;
      const s = r4Vec([0, 1, 2].map((k) => ln.a[k] - extend * ln.u[k]));
      const e = r4Vec([0, 1, 2].map((k) => ln.b[k] + extend * ln.u[k]));
      items.push(mkLine(nextId(`${stem}_line`.slice(0, 64)), s, e));
      lineCount += 1;
      const c = g.plane.center, pE1 = g.plane.e1, pE2 = g.plane.e2;
      const C = [
        r4Vec([0, 1, 2].map((k) => c[k] - width / 2 * pE1[k] - height / 2 * pE2[k])),
        r4Vec([0, 1, 2].map((k) => c[k] + width / 2 * pE1[k] - height / 2 * pE2[k])),
        r4Vec([0, 1, 2].map((k) => c[k] + width / 2 * pE1[k] + height / 2 * pE2[k])),
        r4Vec([0, 1, 2].map((k) => c[k] - width / 2 * pE1[k] + height / 2 * pE2[k])),
      ];
      corners.push(...C);
      for (let i = 0; i < 4; i++) {
        items.push(mkLine(nextId(`${stem}_plane${i}`.slice(0, 64)), C[i], C[(i + 1) % 4]));
        lineCount += 1;
      }
    }
  }

  // ---- 异面垂直：过 O 且平行 L2 的辅助线（不计入 asLines 主体）----
  if (helperCount) {
    items.push(mkLine(nextId(`${stem}_helper`.slice(0, 64)), g.helperLine[0], g.helperLine[1]));
    lineCount += 1;
  }

  // ---- 关系记号 ----
  const markSegments = [];
  if (asMark) {
    if (relation === 'parallel') {
      // 两条（直线 / 平面）各一短杠，方向一致且垂直对应主体。
      const mids = kind === 'line-line'
        ? [
            r4Vec([0, 1, 2].map((k) => (g.line1.a[k] + g.line1.b[k]) / 2)),
            r4Vec([0, 1, 2].map((k) => (g.line2.a[k] + g.line2.b[k]) / 2)),
          ]
        : [
            r4Vec([0, 1, 2].map((k) => (g.line.a[k] + g.line.b[k]) / 2)),
            g.plane.center.slice(),
          ];
      mids.forEach((m, i) => {
        const p = shifted(markDir, m, -markSize / 2);
        const q = shifted(markDir, m, markSize / 2);
        markSegments.push([p, q]);
        items.push(mkLine(nextId(`${stem}_mk${i}`.slice(0, 64)), p, q));
        markCountActual += 1;
      });
    } else {
      // 直角符号：两边分别沿两条垂直方向，互相垂直。
      const dirA = kind === 'line-line' ? g.line1.u : g.line.u;
      const dirB = kind === 'line-line' ? (g.intersect ? g.line2.u : g.line2.u) : g.markDir;
      const q1 = shifted(dirA, origin, markSize);
      const q2 = r4Vec([0, 1, 2].map((k) => q1[k] + markSize * dirB[k]));
      const q3 = shifted(dirB, origin, markSize);
      markSegments.push([origin, q1], [q1, q2], [q2, q3]);
      // 只把两段「符号边」落地：origin→q1 与 q1→q2（q2→q3 为闭合辅助，不重复画）。
      items.push(mkLine(nextId(`${stem}_ra1`.slice(0, 64)), q1, q2));
      items.push(mkLine(nextId(`${stem}_ra2`.slice(0, 64)), q2, q3));
      markCountActual += 2;
    }
  }

  // ---- 可选小球 ----
  if (asPoints) {
    const pts = kind === 'line-line'
      ? [g.line1.a, g.line1.b, g.line2.a, g.line2.b]
      : [g.line.a, g.line.b, g.plane.center];
    pts.forEach((p, i) => {
      items.push(mkPoint(nextId(`${stem}_p${i}`.slice(0, 64)), p));
      pointCount += 1;
    });
  }

  // ---- 关系文字 ∥ / ⊥ 与名称标注 ----
  if (labelRelation) {
    let lp;
    if (relation === 'parallel' && markSegments.length >= 2) {
      lp = r4Vec([0, 1, 2].map((k) => (markSegments[0][0][k] + markSegments[1][0][k]) / 2));
    } else {
      lp = r4Vec([0, 1, 2].map((k) => origin[k] + 0.45 * markSize * (g.line ? g.line.u[k] : g.line1.u[k])));
    }
    items.push(mkLabel(nextId(`${stem}_rel`.slice(0, 64)), symbolText, lp));
    labelCount += 1;
  }
  if (labelNames) {
    const names = kind === 'line-line'
      ? [['A', g.line1.a], ['B', g.line1.b], ['C', g.line2.a], ['D', g.line2.b]]
      : [['A', g.line.a], ['B', g.line.b], ['O', g.plane.center]];
    names.forEach(([text, p]) => {
      items.push(mkLabel(nextId(`${stem}_n${text}`.slice(0, 64)), text, p));
      labelCount += 1;
    });
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      kind,
      relation,
      requested: g.requested,
      tol: g.tol,
      dot,
      absDot,
      symbolText,
      origin: origin.slice(),
      intersect: g.intersect,
      helperDrawn: helperCount > 0,
      markDir: markDir.slice(),
      markSegments: markSegments.map(([p, q]) => [p.slice(), q.slice()]),
      extend,
      markSize,
      width,
      height,
      vertexSize,
      corners: corners.map((p) => p.slice()),
      asLines,
      asMark,
      asPoints,
      labelRelation,
      labelNames,
      lineCount,
      markCount: markCountActual,
      pointCount,
      labelCount,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
      ...(kind === 'line-line'
        ? { line1: { a: g.line1.a.slice(), b: g.line1.b.slice(), u: g.line1.u.slice() },
            line2: { a: g.line2.a.slice(), b: g.line2.b.slice(), u: g.line2.u.slice() } }
        : { line: { a: g.line.a.slice(), b: g.line.b.slice(), u: g.line.u.slice() },
            plane: { center: g.plane.center.slice(), normal: g.plane.normal.slice(), e1: g.plane.e1.slice(), e2: g.plane.e2.slice(), viaPoints: g.plane.viaPoints } }),
    },
  };
}

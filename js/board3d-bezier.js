/**
 * 立体画板「3D 贝塞尔曲线」参数化生成命令的纯函数语义层（2026-11-17 D15 增量）
 *
 * 与 js/board3d-helix.js / -measure.js / -transform.js / -duplicate.js / -align.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「过这几个控制点画一条光滑空间曲线」「画一条三次贝塞尔曲线」「用控制点画一条
 * S 形 / 拱形空间曲线」这类意图，用 de Casteljau 算法（对控制点数通用的凸组合递推）
 * 连续采样，产出一条由 line 段首尾相接构成的空间贝塞尔曲线，可直接交给
 * board3dApi.add() 逐段落地。执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d line：手工给两个端点，只画一条直线段；
 *   - helix3d（D14）：按**固定参数方程**（圆 + 轴向线性上升）生成规则螺旋曲线，
 *     形状由 radius/pitch/turns 等标量决定，无法表达自由形状；
 *   - bezier3d：形状由**用户给定的控制点列**决定，控制点数 2~8（1~7 次均可），
 *     线性 / 二次 / 三次 / 高次统一由 de Casteljau 递推覆盖，无需源对象，
 *     与 helix3d 形成「规则参数曲线」与「自由控制点曲线」的互补。
 *
 * de Casteljau 递推（t ∈ [0,1]）：
 *   P_i^0(t) = 控制点 P_i
 *   P_i^r(t) = (1-t)·P_i^(r-1) + t·P_{i+1}^(r-1)
 *   B(t) = P_0^n(t)（n = 控制点数 - 1）
 * 端点插值 B(0)=P_0、B(1)=P_n；整条曲线落在控制点凸包内（数值稳定、不产生龙格现象）。
 */

/** 控制点数合法区间 [min, max]（次数 = 点数 - 1，即 1~7 次） */
export const BEZIER3D_POINTS_MIN = 2;
export const BEZIER3D_POINTS_MAX = 8;

/** 采样段数（= 生成 line 段数）合法区间，与 helix3d / grid3d 的 512 上限同口径 */
export const BEZIER3D_SEGMENTS_MIN = 1;
export const BEZIER3D_SEGMENTS_MAX = 512;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const BEZIER3D_MAX_SEGMENTS = 512;

/** 缺省采样段数（不指定 segments 时使用） */
export const BEZIER3D_SEGMENTS_DEFAULT = 24;

/** 坐标钳制上限（与 geometry COORD_LIMIT / helix3d 一致） */
const COORD_LIMIT = 10000;

/** 曲线默认颜色 / 采样点球半径（与 helix3d 一致） */
const DEFAULT_COLOR = '#4f6bed';
const POINT_MARKER_SIZE = 0.12;

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

/** 严格解析一个控制点 [x,y,z]；非法返回 null（控制点是曲线定义本身，绝不静默回落） */
function parsePoint(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  if (out.some((x) => x === null)) return null;
  return out.map(clamp);
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

/**
 * de Casteljau 求值：给定控制点列（每个为 [x,y,z]）与参数 t∈[0,1]，
 * 返回曲线上一点的绝对坐标三元组（已 r4 取整 + 坐标钳制）。
 * 纯函数、只读入参；控制点数 2~8 通用，线性 / 二次 / 三次 / 高次同一套递推。
 */
export function bezierPointAt(points, t) {
  let layer = points.map((p) => p.slice());
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length - 1; i++) {
      const a = layer[i], b = layer[i + 1];
      next.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
    layer = next;
  }
  return layer[0].map((x) => r4(clamp(x)));
}

/**
 * 解析一条 bezier3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"bezier3d","id":"curve","points":[[0,0,0],[1,2,0],[3,2,1],[4,0,1]],"segments":24}
 *   - id        可选，生成对象的 id 前缀（默认 'bezier'；段以 `_s<n>`、采样点以 `_p<n>` 结尾）；
 *   - points    **必填**，控制点列 2~8 个，每个为 [x,y,z]（数字字符串容错、坐标钳制 ±10000）；
 *               任一元素非三元组 / 含非有限数 / 表达式一律整条原子拒绝；
 *   - segments  可选，采样段数（= line 段数），整数 [1,512]（默认 24）；
 *   - asPoints  可选，是否在采样点放小球标记（默认 false）；
 *   - color / opacity 可选，整条曲线的样式。
 *   任一参数只要在命令里出现就必须是合法值，否则整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveBezier3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'bezier' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- points：控制点列（必填，严格解析，绝不静默回落） ----
  if (!Array.isArray(cmd.points)) return { ok: false, error: 'points 必须是控制点数组' };
  if (cmd.points.length < BEZIER3D_POINTS_MIN || cmd.points.length > BEZIER3D_POINTS_MAX) {
    return { ok: false, error: `points 需为 ${BEZIER3D_POINTS_MIN}~${BEZIER3D_POINTS_MAX} 个控制点` };
  }
  const points = [];
  for (const raw of cmd.points) {
    const p = parsePoint(raw);
    if (p === null) return { ok: false, error: '每个控制点必须是含 3 个有限数值的 [x,y,z]' };
    points.push(p);
  }

  // ---- segments：整数区间校验（脏值一律原子拒绝） ----
  const segRaw = cmd.segments === undefined ? BEZIER3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw)) return { ok: false, error: 'segments 必须是整数' };
  const segments = segRaw;
  if (segments < BEZIER3D_SEGMENTS_MIN || segments > BEZIER3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${BEZIER3D_SEGMENTS_MIN}~${BEZIER3D_SEGMENTS_MAX} 的整数` };
  }
  if (segments > BEZIER3D_MAX_SEGMENTS) {
    return { ok: false, error: `曲线段数 ${segments} 超过上限 ${BEZIER3D_MAX_SEGMENTS}` };
  }

  // ---- asPoints / 样式 ----
  if (cmd.asPoints !== undefined && typeof cmd.asPoints !== 'boolean') {
    return { ok: false, error: 'asPoints 必须是布尔值' };
  }
  const asPoints = cmd.asPoints === true;
  // 显式出现的数值型参数必须合法（脏值原子拒绝，不静默回落），与 segments 同口径；
  // 合法但越界的 opacity（如 5 / -3）仍按 [0.1, 1] 钳制，color 非法值按既有命令口径回落默认色。
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 采样点（segments+1 个）：一次性算出，段与点标记共用，保证几何一致 ----
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(bezierPointAt(points, i / segments));

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  const used = new Set(
    (state && Array.isArray(state.objects) ? state.objects : [])
      .map((o) => o && o.id).filter(Boolean)
  );
  const nextId = (want) => {
    if (!used.has(want)) { used.add(want); return want; }
    let k = 2;
    let cand = `${want}_${k}`.slice(0, 64);
    while (used.has(cand)) { cand = `${want}_${++k}`.slice(0, 64); }
    used.add(cand);
    return cand;
  };

  // ---- 生成 line 段：每段以绝对端点坐标写入 p，pos 保持原点 ----
  const items = [];
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    items.push({
      id: nextId(`${prefix}_s${i + 1}`.slice(0, 64)),
      type: 'line',
      text: '',
      color: lineColor,
      opacity: lineOpacity,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      p: { x1: a[0], y1: a[1], z1: a[2], x2: b[0], y2: b[1], z2: b[2] },
    });
  }

  // ---- 可选：在每个采样点放一个小球标记 ----
  if (asPoints) {
    for (let i = 0; i <= segments; i++) {
      const q = pts[i];
      items.push({
        id: nextId(`${prefix}_p${i + 1}`.slice(0, 64)),
        type: 'point',
        text: '',
        color: lineColor,
        opacity: lineOpacity,
        pos: q.slice(),
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        p: { s: POINT_MARKER_SIZE },
      });
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      degree: points.length - 1,
      control: points.map((p) => p.map(r4)),
      segments,
      segmentCount: segments,
      pointCount: pts.length,
      asPoints,
      color: lineColor,
      opacity: lineOpacity,
      first: pts[0].slice(),
      last: pts[pts.length - 1].slice(),
    },
  };
}

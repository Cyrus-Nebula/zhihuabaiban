/**
 * 立体画板「空间圆弧」参数化生成命令的纯函数语义层（2026-11-18 D16 增量）
 *
 * 与 js/board3d-helix.js / -bezier.js / -measure.js / -transform.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一段圆弧」「画拱门 / 扇形边界 / 圆角」「在 XY/XZ/YZ 平面画指定起止角的弧线」
 * 这类意图，用圆的参数方程连续采样，产出一条由 line 段首尾相接构成的空间圆弧，
 * 可直接交给 board3dApi.add() 逐段落地。执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d line：手工给两个端点，只画一条直线段；
 *   - radial3d（D10）：把**已有对象**绕轴均分复制成一圈（离散、对象不变形）；
 *   - helix3d（D14）：按「圆 + 轴向线性上升」生成规则螺旋线（pitch≠0 时不在同一平面）；
 *   - bezier3d（D15）：由控制点列决定形状的自由曲线，不保证落在圆上；
 *   - arc3d：半径恒定、圆心与法向轴给定的**真圆弧**（pitch 恒为 0），采样点严格落在
 *     圆心 radius 的圆上；起止角 / 扫角可控，补上「拱形 / 扇形边界 / 圆角」这一高频缺口。
 *
 * 参数方程（θ 从 startAngle 连续扫到 startAngle+sweep，角度制转弧度）：
 *   axis='z'（XY 平面）：x = cx + r·cosθ, y = cy + r·sinθ, z = cz
 *   axis='x'（YZ 平面）：x = cx,               y = cy + r·cosθ, z = cz + r·sinθ
 *   axis='y'（XZ 平面）：x = cx + r·cosθ, y = cy,               z = cz + r·sinθ
 * 采样点恒满足到 center 的距离 = radius（钳制前），sweep 可负 = 反向扫弧。
 */

/** 采样段数（= 生成 line 段数）合法区间，与 helix3d / bezier3d 的 512 上限同口径 */
export const ARC3D_SEGMENTS_MIN = 1;
export const ARC3D_SEGMENTS_MAX = 512;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const ARC3D_MAX_SEGMENTS = 512;

/** 缺省采样段数（不指定 segments 时使用） */
export const ARC3D_SEGMENTS_DEFAULT = 24;

/** 可选轴白名单（圆弧所在平面的法向轴，与世界坐标 X/Y/Z 一一对应） */
export const ARC3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 坐标钳制上限（与 geometry COORD_LIMIT / helix3d / bezier3d 一致） */
const COORD_LIMIT = 10000;

/** 曲线默认颜色 / 采样点球半径（与 helix3d / bezier3d 一致） */
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

/**
 * 严格解析圆心 [x,y,z]：非三元组 / 含非有限数一律返回 null（整条原子拒绝）。
 * 圆心是圆弧几何定义的核心，静默回落原点会画出位置完全错误的圆弧，故不采用 helix3d 的回落口径。
 */
function parseCenter(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out.map(clamp) : null;
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
 * 圆弧采样点：给定圆心 / 半径 / 法向轴 / 角度（角度制），返回圆上一点的绝对坐标三元组。
 * 纯函数、只读入参；输出已 r4 取整 + 坐标钳制。
 *
 * @param {Array}  center 圆心 [x,y,z]
 * @param {number} radius 半径（> 0）
 * @param {string} axis   法向轴 'x'/'y'/'z'
 * @param {number} angleDeg 角度制参数 θ
 */
export function arcPointAt(center, radius, axis, angleDeg) {
  const theta = angleDeg * Math.PI / 180;
  const cos = radius * Math.cos(theta);
  const sin = radius * Math.sin(theta);
  const c = center;
  let p;
  if (axis === 'x') p = [c[0], c[1] + cos, c[2] + sin];
  else if (axis === 'y') p = [c[0] + cos, c[1], c[2] + sin];
  else p = [c[0] + cos, c[1] + sin, c[2]];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 arc3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"arc3d","id":"arch","axis":"z","center":[0,0,0],"radius":2,"startAngle":0,"sweep":180,"segments":24}
 *   - id          可选，生成对象的 id 前缀（默认 'arc'；段以 `_s<n>`、采样点以 `_p<n>` 结尾）；
 *   - axis        可选，'x'/'y'/'z'（默认 'z'），圆弧所在平面的法向轴；
 *   - center      可选，圆心 [x,y,z]（默认 [0,0,0]，数字字符串容错、坐标钳制 ±10000）；
 *   - radius      可选，半径 > 0（默认 1）；
 *   - startAngle  可选，起始角（角度制，默认 0）；
 *   - sweep       可选，扫过的角度（角度制，默认 90），可负 = 反向扫弧；
 *   - segments    可选，采样段数（= line 段数），整数 [1,512]（默认 24）；
 *   - asPoints    可选，是否在采样点放小球标记（默认 false）；
 *   - color / opacity 可选，整条圆弧的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，否则整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveArc3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'arc' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'z' : cmd.axis;
  if (!ARC3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${ARC3D_AXES.join('/')}` };
  }

  // ---- 数值参数：只要在命令里出现就必须是合法有限数（脏值一律原子拒绝） ----
  const radius = cmd.radius === undefined ? 1 : num(cmd.radius);
  if (radius === null) return { ok: false, error: 'radius 必须是数字' };
  if (!(radius > 0)) return { ok: false, error: 'radius 必须大于 0' };

  const startAngle = cmd.startAngle === undefined ? 0 : num(cmd.startAngle);
  if (startAngle === null) return { ok: false, error: 'startAngle 必须是数字' };

  const sweep = cmd.sweep === undefined ? 90 : num(cmd.sweep);
  if (sweep === null) return { ok: false, error: 'sweep 必须是数字' };

  const segRaw = cmd.segments === undefined ? ARC3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw)) return { ok: false, error: 'segments 必须是整数' };
  const segments = segRaw;
  if (segments < ARC3D_SEGMENTS_MIN || segments > ARC3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${ARC3D_SEGMENTS_MIN}~${ARC3D_SEGMENTS_MAX} 的整数` };
  }
  if (segments > ARC3D_MAX_SEGMENTS) {
    return { ok: false, error: `圆弧段数 ${segments} 超过上限 ${ARC3D_MAX_SEGMENTS}` };
  }

  if (cmd.asPoints !== undefined && typeof cmd.asPoints !== 'boolean') {
    return { ok: false, error: 'asPoints 必须是布尔值' };
  }
  const asPoints = cmd.asPoints === true;
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  const center = cmd.center === undefined ? [0, 0, 0] : parseCenter(cmd.center);
  if (center === null) return { ok: false, error: 'center 必须是含 3 个有限数值的 [x,y,z]' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 采样点（segments+1 个）：一次性算出，段与点标记共用，保证几何一致 ----
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + sweep * (i / segments);
    pts.push(arcPointAt(center, radius, axis, angle));
  }

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
      axis,
      center: center.map(r4),
      radius: r4(radius),
      startAngle: r4(startAngle),
      sweep: r4(sweep),
      endAngle: r4(startAngle + sweep),
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

/**
 * 立体画板「椭球（ellipsoid）」参数化生成命令的纯函数语义层（2026-11-20 D21 增量）
 *
 * 与 js/board3d-torus.js / -revolve.js / -arc.js / -polyhedron.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画椭球 / 画橄榄球 / 画扁球 / 画椭球面」这类意图，用一条命令生成
 * 椭球面线框：极轴半轴 a + 赤道面两半轴 b、c，绕指定极轴 axis 生成经线（子午圈椭圆）
 * + 纬线圈（平行圈圆）。产出由 line 段（及可选 point 采样点）构成的线框，可直接交给
 * board3dApi.add() 逐段落地；执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d sphere 只支持**等半径球**（p.r 单一半径），无法表达 a≠b≠c 的椭球；
 *   - revolve3d（D19）：可把椭圆母线绕轴旋转成**旋转椭球**，但需用户手写一圈母线采样点，
 *     且只能表达「旋转椭球」（两轴相等），不能表达三轴不等的一般椭球；
 *   - torus3d（D20）：圆环面，拓扑不同（有洞），不是椭球；
 *   - ellipsoid3d：**专用于三轴椭球**，只需给 a/b/c 三个半轴，自动按参数方程生成经线 +
 *     纬线圈线框，是「标准二次曲面」的高层封装，与 sphere（等半径）/ revolve3d（任意母线）互补。
 *
 * 坐标约定（半轴 a/b/c>0，center 为整体平移，axis 为极轴）：
 *   令 u 为极角（从 +极轴量起，0~180°），v 为绕极轴的方位角（0~360°）：
 *     极轴分量 = a·cos u；赤道面径向 = sqrt(b²cos²v + c²sin²v)·sin u（一般椭球横截面为椭圆）。
 *   为得到「纬线圈是真圆」的常见教学椭球（旋转椭球 b=c），线框用参数化：
 *     axis='y'（默认，极轴竖直）: p = (cx + b·sin u·cos v, cy + a·cos u, cz + c·sin u·sin v)
 *     axis='x'                      : p = (cx + a·cos u, cy + b·sin u·cos v, cz + c·sin u·sin v)
 *     axis='z'                      : p = (cx + b·sin u·cos v, cy + c·sin u·sin v, cz + a·cos u)
 *   经线 = 固定 v、u 从 0~180°（子午圈半椭圆，两极汇合）；
 *   纬线圈 = 固定 u、v 从 0~360°（平行圈，u=0/180 退化为极点跳过）。
 */

/** 半轴合法区间（>0，上限防刷屏），缺省值 */
export const ELLIPSOID3D_AXIS_MIN = 0.01;
export const ELLIPSOID3D_AXIS_MAX = 1000;
export const ELLIPSOID3D_A_DEFAULT = 1.5;
export const ELLIPSOID3D_B_DEFAULT = 1;
export const ELLIPSOID3D_C_DEFAULT = 1;

/** 经线（子午圈）条数区间 / 缺省值 */
export const ELLIPSOID3D_MERIDIANS_MIN = 3;
export const ELLIPSOID3D_MERIDIANS_MAX = 48;
export const ELLIPSOID3D_MERIDIANS_DEFAULT = 12;

/** 纬线圈（平行圈）条数区间 / 缺省值（不含两极） */
export const ELLIPSOID3D_PARALLELS_MIN = 2;
export const ELLIPSOID3D_PARALLELS_MAX = 32;
export const ELLIPSOID3D_PARALLELS_DEFAULT = 8;

/** 每条线的分段数区间 / 缺省值 */
export const ELLIPSOID3D_SEGMENTS_MIN = 3;
export const ELLIPSOID3D_SEGMENTS_MAX = 64;
export const ELLIPSOID3D_SEGMENTS_DEFAULT = 24;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const ELLIPSOID3D_MAX_SEGMENTS = 4096;

/** 可选极轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const ELLIPSOID3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 坐标钳制上限（与 geometry / revolve3d / torus3d / arc3d 一致） */
const COORD_LIMIT = 10000;

/** 线框默认颜色 / 采样点球半径（与 torus3d / revolve3d 一致） */
const DEFAULT_COLOR = '#4f6bed';
const POINT_MARKER_SIZE = 0.1;

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

/** 严格解析中心 [x,y,z]（几何平移核心，非法原子拒绝，口径同 torus3d / revolve3d） */
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
 * 椭球面采样点：极角 u（从 +极轴量起，角度制 0~180）+ 方位角 v（绕极轴，角度制 0~360），
 * 绕 axis 定向并平移 center。纯函数、只读入参；输出已 r4 取整 + 坐标钳制。
 *
 * @param {number} a      极轴半轴
 * @param {number} b      赤道面第一半轴
 * @param {number} c      赤道面第二半轴
 * @param {string} axis   极轴 'x'/'y'/'z'
 * @param {number} uDeg   极角（角度制，0=+极轴极点，180=-极轴极点）
 * @param {number} vDeg   方位角（角度制）
 * @param {Array}  center 整体平移 [x,y,z]
 */
export function ellipsoidPointAt(a, b, c, axis, uDeg, vDeg, center) {
  const u = uDeg * Math.PI / 180;
  const v = vDeg * Math.PI / 180;
  const axial = a * Math.cos(u);
  const eq1 = b * Math.sin(u) * Math.cos(v);
  const eq2 = c * Math.sin(u) * Math.sin(v);
  const ctr = center;
  let p;
  if (axis === 'x') p = [ctr[0] + axial, ctr[1] + eq1, ctr[2] + eq2];
  else if (axis === 'z') p = [ctr[0] + eq1, ctr[1] + eq2, ctr[2] + axial];
  else p = [ctr[0] + eq1, ctr[1] + axial, ctr[2] + eq2];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 ellipsoid3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"ellipsoid3d","id":"ell","axis":"y","center":[0,0,0],"a":2,"b":1.5,"c":1,
 *    "meridians":12,"parallels":8,"segments":24,
 *    "asMeridians":true,"asParallels":true,"asPoints":false,"color":"#4f6bed","opacity":1}
 *   - id             可选，生成对象 id 前缀（默认 'ell'；各线/点以 _M<经>_s<段> / _P<纬>_s<段> / _p.. 结尾）；
 *   - axis           可选，'x'/'y'/'z'（默认 'y'），椭球极轴；
 *   - center         可选，整体平移 [x,y,z]（默认 [0,0,0]，严格解析）；
 *   - a              可选，极轴半轴（默认 1.5，>0）；
 *   - b              可选，赤道面第一半轴（默认 1，>0）；
 *   - c              可选，赤道面第二半轴（默认 1，>0）；
 *   - meridians      可选，经线（子午圈）条数，整数 [3,48]（默认 12）；
 *   - parallels      可选，纬线圈（平行圈）条数，整数 [2,32]（默认 8，不含两极）；
 *   - segments       可选，每条线的分段数，整数 [3,64]（默认 24）；
 *   - asMeridians    可选，是否画经线（默认 true）；
 *   - asParallels    可选，是否画纬线圈（默认 true）；
 *   - asPoints       可选，是否在采样网格点放小球标记（默认 false）；
 *   - color / opacity 可选，整条椭球的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveEllipsoid3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'ell' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'y' : cmd.axis;
  if (!ELLIPSOID3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${ELLIPSOID3D_AXES.join('/')}` };
  }

  // ---- a / b / c：三个半轴（核心几何，出现即须合法有限正数） ----
  const axes = {};
  for (const [key, def] of [['a', ELLIPSOID3D_A_DEFAULT], ['b', ELLIPSOID3D_B_DEFAULT], ['c', ELLIPSOID3D_C_DEFAULT]]) {
    const value = cmd[key] === undefined ? def : num(cmd[key]);
    if (value === null) return { ok: false, error: `${key} 必须是数字` };
    if (value < ELLIPSOID3D_AXIS_MIN || value > ELLIPSOID3D_AXIS_MAX) {
      return { ok: false, error: `${key} 需为 ${ELLIPSOID3D_AXIS_MIN}~${ELLIPSOID3D_AXIS_MAX} 的正数` };
    }
    axes[key] = value;
  }
  const { a, b, c } = axes;

  // ---- 分段数：出现即须合法整数且在区间内（脏值原子拒绝） ----
  const intInRange = (raw, def, min, max, label) => {
    const n = raw === undefined ? def : num(raw);
    if (n === null || !Number.isInteger(n)) return { error: `${label} 必须是整数` };
    if (n < min || n > max) return { error: `${label} 需为 ${min}~${max} 的整数` };
    return { value: n };
  };
  const mer = intInRange(cmd.meridians, ELLIPSOID3D_MERIDIANS_DEFAULT, ELLIPSOID3D_MERIDIANS_MIN, ELLIPSOID3D_MERIDIANS_MAX, 'meridians');
  if (mer.error) return { ok: false, error: mer.error };
  const par = intInRange(cmd.parallels, ELLIPSOID3D_PARALLELS_DEFAULT, ELLIPSOID3D_PARALLELS_MIN, ELLIPSOID3D_PARALLELS_MAX, 'parallels');
  if (par.error) return { ok: false, error: par.error };
  const seg = intInRange(cmd.segments, ELLIPSOID3D_SEGMENTS_DEFAULT, ELLIPSOID3D_SEGMENTS_MIN, ELLIPSOID3D_SEGMENTS_MAX, 'segments');
  if (seg.error) return { ok: false, error: seg.error };
  const meridians = mer.value;
  const parallels = par.value;
  const segments = seg.value;

  for (const flag of ['asMeridians', 'asParallels', 'asPoints']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  const center = cmd.center === undefined ? [0, 0, 0] : parseCenter(cmd.center);
  if (center === null) return { ok: false, error: 'center 必须是含 3 个有限数值的 [x,y,z]' };

  const asMeridians = cmd.asMeridians === undefined ? true : cmd.asMeridians;
  const asParallels = cmd.asParallels === undefined ? true : cmd.asParallels;
  const asPoints = cmd.asPoints === true;
  if (!asMeridians && !asParallels && !asPoints) {
    return { ok: false, error: 'asMeridians / asParallels / asPoints 至少开一个' };
  }
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 角度采样 ----
  // 经线：固定方位角 v，极角 u 从 0~180°（含两极，相邻采样点连成一条子午圈半椭圆）。
  const vAngles = [];
  for (let i = 0; i < meridians; i++) vAngles.push(360 * i / meridians);
  // 纬线圈：极角 u 在 (0,180) 内均匀取 parallels 条（不含两极，避免退化为点）。
  const uAngles = [];
  for (let j = 1; j <= parallels; j++) uAngles.push(180 * j / (parallels + 1));

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  // 每条经线 segments 段（u 从 0 到 180，segments 段）；每个纬线圈 segments 段（v 闭合一圈）。
  const meridianSegs = asMeridians ? meridians * segments : 0;
  const parallelSegs = asParallels ? parallels * segments : 0;
  const pointCount = asPoints ? meridians * parallels + 2 : 0; // 经纬采样网格 + 两极各一个
  if (meridianSegs + parallelSegs > ELLIPSOID3D_MAX_SEGMENTS) {
    return {
      ok: false,
      error: `线段总数 ${meridianSegs + parallelSegs} 超过上限 ${ELLIPSOID3D_MAX_SEGMENTS}`,
    };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 polyhedron3d / torus3d 同口径）：prefix 达 64 字符时
  // 从 stem 生成，保证截断后仍保留区分度、不死循环。
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
    p: { s: POINT_MARKER_SIZE },
  });

  const items = [];

  // ---- 经线（子午圈）：固定 v，极角 u 从 0~180° 分段连成半椭圆，两极汇合 ----
  if (asMeridians) {
    for (let i = 0; i < meridians; i++) {
      const v = vAngles[i];
      const row = [];
      for (let s = 0; s <= segments; s++) {
        row.push(ellipsoidPointAt(a, b, c, axis, 180 * s / segments, v, center));
      }
      for (let s = 0; s < segments; s++) {
        items.push(mkLine(
          nextId(`${stem}_M${i + 1}_s${s + 1}`.slice(0, 64)),
          row[s], row[s + 1]
        ));
      }
    }
  }

  // ---- 纬线圈（平行圈）：固定 u，方位角 v 闭合一圈 ----
  if (asParallels) {
    for (let j = 0; j < parallels; j++) {
      const u = uAngles[j];
      const row = [];
      for (let s = 0; s < segments; s++) {
        row.push(ellipsoidPointAt(a, b, c, axis, u, 360 * s / segments, center));
      }
      for (let s = 0; s < segments; s++) {
        items.push(mkLine(
          nextId(`${stem}_P${j + 1}_s${s + 1}`.slice(0, 64)),
          row[s], row[(s + 1) % row.length]
        ));
      }
    }
  }

  // ---- 可选：在采样网格点 + 两极放小球标记 ----
  if (asPoints) {
    for (let i = 0; i < meridians; i++) {
      const v = vAngles[i];
      for (let j = 0; j < parallels; j++) {
        const q = ellipsoidPointAt(a, b, c, axis, uAngles[j], v, center);
        items.push(mkPoint(nextId(`${stem}_p${i + 1}_${j + 1}`.slice(0, 64)), q));
      }
    }
    // 两极点（每轴一个，避免沿各经线重复）
    items.push(mkPoint(nextId(`${stem}_poleTop`.slice(0, 64)), ellipsoidPointAt(a, b, c, axis, 0, 0, center)));
    items.push(mkPoint(nextId(`${stem}_poleBot`.slice(0, 64)), ellipsoidPointAt(a, b, c, axis, 180, 0, center)));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      axis,
      a: r4(a),
      b: r4(b),
      c: r4(c),
      center: center.map(r4),
      meridians,
      parallels,
      segments,
      asMeridians,
      asParallels,
      asPoints,
      meridianCount: asMeridians ? meridians : 0,
      parallelCount: asParallels ? parallels : 0,
      pointCount,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      opacity: lineOpacity,
    },
  };
}

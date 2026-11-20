/**
 * 立体画板「胶囊体（capsule / spherocylinder）」参数化生成命令的纯函数语义层（2026-11-21 D22 增量）
 *
 * 与 js/board3d-ellipsoid.js / -torus.js / -revolve.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画胶囊 / 画药丸 / 画两端带半球的圆柱」这类意图，用一条命令生成胶囊面线框：
 *   半径 r + 两球心距 h，绕指定轴 axis 生成经线（纵向轮廓）+ 纬线圈（横截面圆）+ 可选采样点。
 *   产出由 line 段（及可选 point 采样点）构成的线框，可直接交给 board3dApi.add() 逐段落地；
 *   执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置图元（box/sphere/cylinder/cone/pyramid/prism/tetra/circle/polygon）无胶囊体；
 *   - revolve3d（D19）：可画胶囊，但需用户手写「矩形 + 两端 1/4 圆弧」的一整圈母线采样点；
 *   - ellipsoid3d（D21）：三轴椭球，没有直筒段（a=b≠c 是旋转椭球而非胶囊）；
 *   - torus3d（D20）：有洞圆环面，拓扑不同；
 *   - capsule3d：**专用于胶囊体**，只给 radius / length 两个参数，自动生成经线 + 纬线圈线框，
 *     是「线段 ⊕ 球（spherocylinder）」这一标准几何体的高层封装。
 *
 * 几何定义：胶囊面 = 以 center 为中心、沿 axis 长 length(h) 的线段 ⊕ 半径 radius(r) 的球的边界。
 *   等价母线（在 (rho=到轴距离, axial=沿轴坐标) 平面，参数 t∈[0,1]）：
 *     t∈[0,1/3]   下半球：phi=-90°→0°，   rho=r·cos phi， axial=-h/2 + r·sin phi
 *     t∈[1/3,2/3] 柱段：  axial=-h/2→h/2，rho=r
 *     t∈[2/3,1]   上半球：phi=0°→90°，    rho=r·cos phi， axial= h/2 + r·sin phi
 *   绕轴旋转方位角 theta 即得空间点；**胶囊面上任一点到轴线段的距离恒为 r**（核心几何守恒）。
 */

/** 半径合法区间（>0，上限防刷屏），缺省值 */
export const CAPSULE3D_RADIUS_MIN = 0.01;
export const CAPSULE3D_RADIUS_MAX = 1000;
export const CAPSULE3D_RADIUS_DEFAULT = 0.5;

/** 两球心距 length(h) 合法区间（允许 0 = 退化为球），缺省值 */
export const CAPSULE3D_LENGTH_MIN = 0;
export const CAPSULE3D_LENGTH_MAX = 1000;
export const CAPSULE3D_LENGTH_DEFAULT = 2;

/** 经线（纵向轮廓）条数区间 / 缺省值 */
export const CAPSULE3D_MERIDIANS_MIN = 3;
export const CAPSULE3D_MERIDIANS_MAX = 48;
export const CAPSULE3D_MERIDIANS_DEFAULT = 12;

/** 纬线圈（横截面圆）条数区间 / 缺省值 */
export const CAPSULE3D_RINGS_MIN = 2;
export const CAPSULE3D_RINGS_MAX = 32;
export const CAPSULE3D_RINGS_DEFAULT = 8;

/** 每条线的分段数区间 / 缺省值 */
export const CAPSULE3D_SEGMENTS_MIN = 3;
export const CAPSULE3D_SEGMENTS_MAX = 64;
export const CAPSULE3D_SEGMENTS_DEFAULT = 24;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const CAPSULE3D_MAX_SEGMENTS = 4096;

/** 可选对称轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const CAPSULE3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 坐标钳制上限（与 geometry / revolve3d / torus3d / ellipsoid3d 一致） */
const COORD_LIMIT = 10000;

/** 线框默认颜色 / 采样点球半径（与 torus3d / ellipsoid3d 一致） */
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

/** 严格解析中心 [x,y,z]（几何平移核心，非法原子拒绝，口径同 ellipsoid3d / torus3d） */
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

/** 参数 t 归一到 [0,1]，消除浮点边界误差 */
const unit = (x) => Math.min(1, Math.max(0, x));

/**
 * 胶囊母线采样：给定 t∈[0,1] 返回 {rho, axial}（到轴径向距离 / 沿轴坐标）。
 * 三段拼接：下半球 → 柱段 → 上半球，在 t=1/3、2/3 处连续。纯函数、只读入参。
 */
export function capsuleProfileAt(r, h, t) {
  if (t <= 1 / 3 + 1e-9) {
    const phi = -Math.PI / 2 + (Math.PI / 2) * unit(t * 3);
    return { rho: r * Math.cos(phi), axial: -h / 2 + r * Math.sin(phi) };
  }
  if (t <= 2 / 3 + 1e-9) {
    const f = unit((t - 1 / 3) * 3);
    return { rho: r, axial: -h / 2 + h * f };
  }
  const phi = (Math.PI / 2) * unit((t - 2 / 3) * 3);
  return { rho: r * Math.cos(phi), axial: h / 2 + r * Math.sin(phi) };
}

/**
 * 胶囊面采样点：母线参数 t∈[0,1]（0=下极点，1=上极点）+ 方位角 theta（角度制 0~360），
 * 绕 axis 定向并平移 center。纯函数、只读入参；输出已 r4 取整 + 坐标钳制。
 *
 * @param {number} r        胶囊半径
 * @param {number} h        两球心距（0 退化为球）
 * @param {string} axis     对称轴 'x'/'y'/'z'
 * @param {number} t        母线参数 [0,1]
 * @param {number} thetaDeg 方位角（角度制）
 * @param {Array}  center   整体平移 [x,y,z]
 */
export function capsulePointAt(r, h, axis, t, thetaDeg, center) {
  const { rho, axial } = capsuleProfileAt(r, h, t);
  const th = thetaDeg * Math.PI / 180;
  const e1 = rho * Math.cos(th);
  const e2 = rho * Math.sin(th);
  const c = center;
  let p;
  if (axis === 'x') p = [c[0] + axial, c[1] + e1, c[2] + e2];
  else if (axis === 'z') p = [c[0] + e1, c[1] + e2, c[2] + axial];
  else p = [c[0] + e1, c[1] + axial, c[2] + e2];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 capsule3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"capsule3d","id":"cap","axis":"y","center":[0,0,0],"radius":0.5,"length":2,
 *    "meridians":12,"rings":8,"segments":24,
 *    "asMeridians":true,"asRings":true,"asPoints":false,"color":"#4f6bed","opacity":1}
 *   - id              可选，生成对象 id 前缀（默认 'cap'；各线/点以 _M<经>_s<段> / _R<纬>_s<段> / _p.. 结尾）；
 *   - axis            可选，'x'/'y'/'z'（默认 'y'），胶囊对称轴；
 *   - center          可选，整体平移 [x,y,z]（默认 [0,0,0]，严格解析）；
 *   - radius          可选，胶囊半径（默认 0.5，>0）；
 *   - length          可选，两球心距（默认 2，≥0；0 时退化为半径 radius 的球）；
 *   - meridians       可选，经线（纵向轮廓）条数，整数 [3,48]（默认 12）；
 *   - rings           可选，纬线圈（横截面圆）条数，整数 [2,32]（默认 8，不含两极）；
 *   - segments        可选，每条线的分段数，整数 [3,64]（默认 24）；
 *   - asMeridians     可选，是否画经线（默认 true）；
 *   - asRings         可选，是否画纬线圈（默认 true）；
 *   - asPoints        可选，是否在采样点（含两极）放小球标记（默认 false）；
 *   - color / opacity 可选，整条胶囊的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveCapsule3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'cap' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'y' : cmd.axis;
  if (!CAPSULE3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${CAPSULE3D_AXES.join('/')}` };
  }

  // ---- radius：胶囊半径（核心几何，出现即须合法有限正数） ----
  const radiusRaw = cmd.radius === undefined ? CAPSULE3D_RADIUS_DEFAULT : num(cmd.radius);
  if (radiusRaw === null) return { ok: false, error: 'radius 必须是数字' };
  if (radiusRaw < CAPSULE3D_RADIUS_MIN || radiusRaw > CAPSULE3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${CAPSULE3D_RADIUS_MIN}~${CAPSULE3D_RADIUS_MAX} 的正数` };
  }

  // ---- length：两球心距（核心几何，出现即须合法有限数，允许 0） ----
  const lengthRaw = cmd.length === undefined ? CAPSULE3D_LENGTH_DEFAULT : num(cmd.length);
  if (lengthRaw === null) return { ok: false, error: 'length 必须是数字' };
  if (lengthRaw < CAPSULE3D_LENGTH_MIN || lengthRaw > CAPSULE3D_LENGTH_MAX) {
    return { ok: false, error: `length 需为 ${CAPSULE3D_LENGTH_MIN}~${CAPSULE3D_LENGTH_MAX} 的数` };
  }

  // ---- 分段数：出现即须合法整数且在区间内（脏值原子拒绝） ----
  const intInRange = (raw, def, min, max, label) => {
    const n = raw === undefined ? def : num(raw);
    if (n === null || !Number.isInteger(n)) return { error: `${label} 必须是整数` };
    if (n < min || n > max) return { error: `${label} 需为 ${min}~${max} 的整数` };
    return { value: n };
  };
  const mer = intInRange(cmd.meridians, CAPSULE3D_MERIDIANS_DEFAULT, CAPSULE3D_MERIDIANS_MIN, CAPSULE3D_MERIDIANS_MAX, 'meridians');
  if (mer.error) return { ok: false, error: mer.error };
  const rng = intInRange(cmd.rings, CAPSULE3D_RINGS_DEFAULT, CAPSULE3D_RINGS_MIN, CAPSULE3D_RINGS_MAX, 'rings');
  if (rng.error) return { ok: false, error: rng.error };
  const seg = intInRange(cmd.segments, CAPSULE3D_SEGMENTS_DEFAULT, CAPSULE3D_SEGMENTS_MIN, CAPSULE3D_SEGMENTS_MAX, 'segments');
  if (seg.error) return { ok: false, error: seg.error };
  const meridians = mer.value;
  const rings = rng.value;
  const segments = seg.value;

  for (const flag of ['asMeridians', 'asRings', 'asPoints']) {
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
  const asRings = cmd.asRings === undefined ? true : cmd.asRings;
  const asPoints = cmd.asPoints === true;
  if (!asMeridians && !asRings && !asPoints) {
    return { ok: false, error: 'asMeridians / asRings / asPoints 至少开一个' };
  }
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 角度 / 母线采样参数 ----
  // 经线：固定方位角 theta，母线 t 从 0~1（含两极，相邻采样点连成一条纵向轮廓）。
  const vAngles = [];
  for (let i = 0; i < meridians; i++) vAngles.push(360 * i / meridians);
  // 纬线圈：母线参数 t 在 (0,1) 内均匀取 rings 条（不含两极，避免退化为点）。
  const tRings = [];
  for (let j = 1; j <= rings; j++) tRings.push(j / (rings + 1));

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const meridianSegs = asMeridians ? meridians * segments : 0;
  const ringSegs = asRings ? rings * segments : 0;
  const pointCount = asPoints ? meridians * rings + 2 : 0; // 经纬采样网格 + 两极各一个
  if (meridianSegs + ringSegs > CAPSULE3D_MAX_SEGMENTS) {
    return {
      ok: false,
      error: `线段总数 ${meridianSegs + ringSegs} 超过上限 ${CAPSULE3D_MAX_SEGMENTS}`,
    };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 polyhedron3d / torus3d / ellipsoid3d 同口径）：prefix 达 64 字符时
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

  // ---- 经线（纵向轮廓）：固定 theta，母线 t 从 0~1 分段连成线，两极汇合 ----
  if (asMeridians) {
    for (let i = 0; i < meridians; i++) {
      const theta = vAngles[i];
      const row = [];
      for (let s = 0; s <= segments; s++) {
        row.push(capsulePointAt(radiusRaw, lengthRaw, axis, s / segments, theta, center));
      }
      for (let s = 0; s < segments; s++) {
        items.push(mkLine(
          nextId(`${stem}_M${i + 1}_s${s + 1}`.slice(0, 64)),
          row[s], row[s + 1]
        ));
      }
    }
  }

  // ---- 纬线圈（横截面圆）：固定母线 t，方位角 theta 闭合一圈 ----
  if (asRings) {
    for (let j = 0; j < rings; j++) {
      const t = tRings[j];
      const row = [];
      for (let s = 0; s < segments; s++) {
        row.push(capsulePointAt(radiusRaw, lengthRaw, axis, t, 360 * s / segments, center));
      }
      for (let s = 0; s < segments; s++) {
        items.push(mkLine(
          nextId(`${stem}_R${j + 1}_s${s + 1}`.slice(0, 64)),
          row[s], row[(s + 1) % row.length]
        ));
      }
    }
  }

  // ---- 可选：在采样网格点 + 两极放小球标记 ----
  if (asPoints) {
    for (let i = 0; i < meridians; i++) {
      const theta = vAngles[i];
      for (let j = 0; j < rings; j++) {
        const q = capsulePointAt(radiusRaw, lengthRaw, axis, tRings[j], theta, center);
        items.push(mkPoint(nextId(`${stem}_p${i + 1}_${j + 1}`.slice(0, 64)), q));
      }
    }
    // 两极点（每轴一个，避免沿各经线重复）
    items.push(mkPoint(nextId(`${stem}_poleTop`.slice(0, 64)), capsulePointAt(radiusRaw, lengthRaw, axis, 1, 0, center)));
    items.push(mkPoint(nextId(`${stem}_poleBot`.slice(0, 64)), capsulePointAt(radiusRaw, lengthRaw, axis, 0, 0, center)));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      axis,
      radius: r4(radiusRaw),
      length: r4(lengthRaw),
      center: center.map(r4),
      meridians,
      rings,
      segments,
      asMeridians,
      asRings,
      asPoints,
      meridianCount: asMeridians ? meridians : 0,
      ringCount: asRings ? rings : 0,
      pointCount,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      opacity: lineOpacity,
    },
  };
}

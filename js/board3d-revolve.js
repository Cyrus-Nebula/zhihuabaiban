/**
 * 立体画板「旋转体 / 回转面」参数化生成命令的纯函数语义层（2026-11-19 D19 增量）
 *
 * 与 js/board3d-arc.js / -helix.js / -bezier.js / -polyhedron.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画旋转体」「把一条母线绕轴旋成回转面」「画圆柱 / 圆台 / 圆锥 / 球 / 花瓶 / 抛物面」
 * 这类意图，用一条**母线 profile**（点列 [r,h]，r=到旋转轴的径向距离、h=沿轴高度）
 * 绕指定轴均匀旋转采样，产出由 line 段（经线 + 纬线圈）构成的旋转体线框，
 * 可直接交给 board3dApi.add() 逐段落地。执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d cylinder/cone/sphere：Three.js 内置封闭实体图元，参数固定（rt/rb/h/r）；
 *   - radial3d（D10）：把**已有对象**绕轴均分复制（离散副本、对象不变形）；
 *   - helix3d（D14）：圆 + 轴向线性上升的规则螺旋线（单条曲线）；
 *   - arc3d（D16）：半径恒定的单条平面圆弧；
 *   - polyhedron3d（D17）：五种正多面体（直线棱 + 离散顶点，非回转面）；
 *   - revolve3d：**任意母线**绕轴旋转生成的**回转曲面线框**，经线数 / 纬线圈数 /
 *     旋转角可控，能表达圆台 / 圆锥 / 球 / 花瓶 / 双曲面等内置图元无法覆盖的形状。
 *
 * 坐标约定（母线点 [r,h]，r≥0 为径向距离、h 为沿旋转轴的坐标；center 为整体平移）：
 *   axis='y'（默认，绕竖轴）：p = (cx + r·cosθ, cy + h,       cz + r·sinθ)
 *   axis='x'（绕横轴）      ：p = (cx + h,       cy + r·cosθ, cz + r·sinθ)
 *   axis='z'（绕进深轴）    ：p = (cx + r·cosθ, cy + r·sinθ, cz + h)
 * 采样角度 θ 从 startAngle 扫到 startAngle+sweep（角度制转弧度）；
 * |sweep|=360 时闭合（周向取 segments 个采样角、首尾自然相接），否则取 segments+1 个角含终点。
 */

/** 母线点数合法区间（至少 2 点才有线段；上限防刷屏） */
export const REVOLVE3D_PROFILE_MIN = 2;
export const REVOLVE3D_PROFILE_MAX = 32;

/** 周向分段数合法区间 / 缺省值 */
export const REVOLVE3D_SEGMENTS_MIN = 3;
export const REVOLVE3D_SEGMENTS_MAX = 64;
export const REVOLVE3D_SEGMENTS_DEFAULT = 24;

/** 一条命令生成的 line 段总数上限（经线 + 纬线，防刷屏 / 死循环） */
export const REVOLVE3D_MAX_SEGMENTS = 1024;

/** 可选旋转轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const REVOLVE3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 默认旋转角（整圈闭合） */
export const REVOLVE3D_SWEEP_DEFAULT = 360;

/** 坐标钳制上限（与 geometry / arc3d / helix3d 一致） */
const COORD_LIMIT = 10000;

/** 曲线默认颜色 / 采样点球半径（与 arc3d / helix3d 一致） */
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
 * 严格解析母线点 [r,h]：r≥0（径向距离，钳制到 [0,COORD_LIMIT]）、h 任意有限数（±COORD_LIMIT）。
 * 母线是旋转体几何定义的核心，任一点非法一律返回 null（整条原子拒绝），不静默跳过。
 */
function parseProfile(v) {
  if (!Array.isArray(v)) return null;
  if (v.length < REVOLVE3D_PROFILE_MIN || v.length > REVOLVE3D_PROFILE_MAX) return null;
  const out = [];
  for (const pt of v) {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    const r = num(pt[0]);
    const h = num(pt[1]);
    if (r === null || h === null) return null;
    if (r < 0) return null;
    out.push([r4(Math.min(COORD_LIMIT, r)), r4(clamp(h))]);
  }
  return out;
}

/**
 * 严格解析中心 [x,y,z]（几何平移核心，非法原子拒绝，口径同 arc3d）。
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
 * 旋转体采样点：母线点 [r,h] 绕 axis 旋转到角度 angleDeg（角度制），再平移 center。
 * 纯函数、只读入参；输出已 r4 取整 + 坐标钳制。
 *
 * @param {Array}  mpt      母线点 [r,h]（r≥0）
 * @param {string} axis     旋转轴 'x'/'y'/'z'
 * @param {number} angleDeg 角度制参数 θ
 * @param {Array}  center   整体平移 [x,y,z]
 */
export function revolvePointAt(mpt, axis, angleDeg, center) {
  const r = mpt[0];
  const h = mpt[1];
  const theta = angleDeg * Math.PI / 180;
  const c = r * Math.cos(theta);
  const s = r * Math.sin(theta);
  const ctr = center;
  let p;
  if (axis === 'x') p = [ctr[0] + h, ctr[1] + c, ctr[2] + s];
  else if (axis === 'z') p = [ctr[0] + c, ctr[1] + s, ctr[2] + h];
  else p = [ctr[0] + c, ctr[1] + h, ctr[2] + s];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 revolve3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"revolve3d","id":"vase","axis":"y","profile":[[0.5,-1],[1,-0.5],[0.6,0.4],[1,1]],
 *    "segments":24,"sweep":360,"startAngle":0,"center":[0,0,0],
 *    "asMeridians":true,"asRings":true,"asPoints":false,"color":"#4f6bed","opacity":1}
 *   - id          可选，生成对象的 id 前缀（默认 'rev'；各线/点以 `_m<角度>_s<段>` / `_r<点>_s<段>` / `_p..` 结尾）；
 *   - axis        可选，'x'/'y'/'z'（默认 'y'），旋转轴；
 *   - profile     必填，2~32 个母线点 [[r,h],...]，r≥0 为径向距离、h 为沿轴高度；
 *   - segments    可选，周向分段数，整数 [3,64]（默认 24）；
 *   - sweep       可选，旋转角度（默认 360 闭合），可负 = 反向旋转；|sweep|≠360 为部分回转；
 *   - startAngle  可选，起始角（角度制，默认 0）；
 *   - center      可选，整体平移 [x,y,z]（默认 [0,0,0]，严格解析）；
 *   - asMeridians 可选，是否画经线（母线在各角度的旋转轨迹，默认 true）；
 *   - asRings     可选，是否画纬线圈（每个 r>0 的母线点绕轴一圈，默认 true）；
 *   - asPoints    可选，是否在母线点 × 采样角放小球标记（默认 false）；
 *   - color / opacity 可选，整条旋转体的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveRevolve3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'rev' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'y' : cmd.axis;
  if (!REVOLVE3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${REVOLVE3D_AXES.join('/')}` };
  }

  // ---- 母线：必填、严格解析（核心几何，非法原子拒绝） ----
  if (cmd.profile === undefined) return { ok: false, error: 'profile 必填' };
  const profile = parseProfile(cmd.profile);
  if (profile === null) {
    return {
      ok: false,
      error: `profile 需为 ${REVOLVE3D_PROFILE_MIN}~${REVOLVE3D_PROFILE_MAX} 个 [r,h] 点（r≥0、h 有限数）`,
    };
  }

  // ---- 数值参数：只要在命令里出现就必须是合法有限数（脏值一律原子拒绝） ----
  const segRaw = cmd.segments === undefined ? REVOLVE3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw)) return { ok: false, error: 'segments 必须是整数' };
  const segments = segRaw;
  if (segments < REVOLVE3D_SEGMENTS_MIN || segments > REVOLVE3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${REVOLVE3D_SEGMENTS_MIN}~${REVOLVE3D_SEGMENTS_MAX} 的整数` };
  }

  const sweep = cmd.sweep === undefined ? REVOLVE3D_SWEEP_DEFAULT : num(cmd.sweep);
  if (sweep === null) return { ok: false, error: 'sweep 必须是数字' };
  if (sweep === 0) return { ok: false, error: 'sweep 不能为 0' };

  const startAngle = cmd.startAngle === undefined ? 0 : num(cmd.startAngle);
  if (startAngle === null) return { ok: false, error: 'startAngle 必须是数字' };

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

  // ---- 角度采样：闭合取 segments 个角（首尾自然相接）；部分回转取 segments+1 个角含终点 ----
  const closed = Math.abs(Math.abs(sweep) - 360) < 1e-9;
  const ringCountAngles = closed ? segments : segments + 1;
  const angles = [];
  for (let j = 0; j < ringCountAngles; j++) {
    angles.push(startAngle + sweep * (j / segments));
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 polyhedron3d 同口径）：若 prefix 本身达 64 字符，
  // 直接 `${prefix}_m..`.slice(0,64) 会退化为同一个字符串而冲突死循环，故统一从 stem 生成。
  const stem = prefix.slice(0, 56);
  const used = new Set(
    (state && Array.isArray(state.objects) ? state.objects : [])
      .map((o) => o && o.id).filter(Boolean)
  );
  const nextId = (want) => {
    if (!used.has(want)) { used.add(want); return want; }
    // 冲突时从 want 的前 56 字符重新追加序号，保证截断后仍保留区分度、不死循环
    let k = 2;
    let cand = `${want.slice(0, 56)}_${k}`.slice(0, 64);
    while (used.has(cand)) { cand = `${want.slice(0, 56)}_${++k}`.slice(0, 64); }
    used.add(cand);
    return cand;
  };

  const mkLine = (id, a, b) => ({
    id,
    type: 'line',
    text: '',
    color: lineColor,
    opacity: lineOpacity,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    p: { x1: a[0], y1: a[1], z1: a[2], x2: b[0], y2: b[1], z2: b[2] },
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

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const meridianSegs = asMeridians ? angles.length * (profile.length - 1) : 0;
  const ringSegs = asRings
    ? profile.reduce((n, m) => n + (m[0] > 0 ? segments : 0), 0)
    : 0;
  const pointCount = asPoints ? angles.length * profile.length : 0;
  if (meridianSegs + ringSegs > REVOLVE3D_MAX_SEGMENTS) {
    return {
      ok: false,
      error: `线段总数 ${meridianSegs + ringSegs} 超过上限 ${REVOLVE3D_MAX_SEGMENTS}`,
    };
  }

  const items = [];

  // ---- 经线：对每个采样角把母线相邻点连成 line 段（母线绕轴旋转的轨迹骨架） ----
  if (asMeridians) {
    for (let j = 0; j < angles.length; j++) {
      const theta = angles[j];
      const row = profile.map((mpt) => revolvePointAt(mpt, axis, theta, center));
      for (let i = 0; i < row.length - 1; i++) {
        items.push(mkLine(
          nextId(`${stem}_m${j + 1}_s${i + 1}`.slice(0, 64)),
          row[i], row[i + 1]
        ));
      }
    }
  }

  // ---- 纬线圈：每个 r>0 的母线点绕轴画一圈（r=0 退化为轴点，跳过） ----
  if (asRings) {
    for (let i = 0; i < profile.length; i++) {
      if (!(profile[i][0] > 0)) continue;
      const row = angles.map((theta) => revolvePointAt(profile[i], axis, theta, center));
      for (let j = 0; j < segments; j++) {
        items.push(mkLine(
          nextId(`${stem}_r${i + 1}_s${j + 1}`.slice(0, 64)),
          row[j], row[(j + 1) % row.length]
        ));
      }
    }
  }

  // ---- 可选：在母线点 × 采样角放小球标记 ----
  if (asPoints) {
    for (let j = 0; j < angles.length; j++) {
      const theta = angles[j];
      for (let i = 0; i < profile.length; i++) {
        const q = revolvePointAt(profile[i], axis, theta, center);
        items.push(mkPoint(nextId(`${stem}_p${i + 1}_${j + 1}`.slice(0, 64)), q));
      }
    }
  }

  const rs = profile.map((m) => m[0]);
  const hs = profile.map((m) => m[1]);
  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      axis,
      profile: profile.map((m) => m.slice()),
      profileCount: profile.length,
      rMin: Math.min(...rs),
      rMax: Math.max(...rs),
      hMin: Math.min(...hs),
      hMax: Math.max(...hs),
      segments,
      sweep: r4(sweep),
      startAngle: r4(startAngle),
      center: center.map(r4),
      closed,
      asMeridians,
      asRings,
      asPoints,
      angleCount: angles.length,
      meridianCount: asMeridians ? angles.length : 0,
      ringCount: asRings ? profile.filter((m) => m[0] > 0).length : 0,
      pointCount,
      segmentCount: meridianSegs + ringSegs,
      itemCount: items.length,
      color: lineColor,
      opacity: lineOpacity,
    },
  };
}

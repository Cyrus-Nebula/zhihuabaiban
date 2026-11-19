/**
 * 立体画板「圆环面 / 轮胎面（torus）」参数化生成命令的纯函数语义层（2026-11-19 D20 增量）
 *
 * 与 js/board3d-revolve.js / -arc.js / -helix.js / -polyhedron.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画圆环 / 画轮胎 / 画甜甜圈 / 画环形曲面」这类意图，用一条命令生成
 * 圆环面线框：主圆半径 R（轴心到管截面圆心的距离）+ 管半径 r（管截面圆半径），
 * 绕指定轴旋转而成。产出由 line 段（经线圆 + 纬线圈）构成的线框，可直接交给
 * board3dApi.add() 逐段落地；执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d torus 并不存在（内置图元只有 box/sphere/cylinder/cone/pyramid/prism/tetra/circle/polygon）；
 *   - revolve3d（D19）：把**任意母线**绕轴旋转成回转面，画圆环需用户手写一圈 [r,h] 采样点，繁琐易错；
 *   - radial3d（D10）：把已有对象绕轴复制成离散几份，不生成连续曲面；
 *   - helix3d（D14）：圆 + 轴向线性上升的螺旋线，不是闭合环面；
 *   - torus3d：**专用于标准圆环面**，只需给 R / r 两个半径，自动按参数方程生成经线圆 + 纬线圈，
 *     是「标准回转面」的高层封装，与任意母线 revolve3d 互补。
 *
 * 坐标约定（主圆半径 R>0、管半径 r>0，center 为环心平移，axis 为环面对称轴）：
 *   令 ringR = R + r·cos(v)（该纬线圈到轴的径向距离），axial = r·sin(v)（沿轴偏移）；
 *   u 为绕轴的主角（经线圆位置），v 为管截面圆上的角（纬线圈位置）：
 *   axis='y'（默认，环面水平放置）: p = (cx + ringR·cos u, cy + axial,       cz + ringR·sin u)
 *   axis='x'                      : p = (cx + axial,       cy + ringR·cos u, cz + ringR·sin u)
 *   axis='z'                      : p = (cx + ringR·cos u, cy + ringR·sin u, cz + axial)
 */

/** 主圆 / 管半径合法区间（>0，上限防刷屏），缺省值 */
export const TORUS3D_RADIUS_MIN = 0.01;
export const TORUS3D_RADIUS_MAX = 1000;
export const TORUS3D_MAJOR_R_DEFAULT = 1.6;
export const TORUS3D_MINOR_R_DEFAULT = 0.6;

/** 主角（经线圆个数）分段数区间 / 缺省值 */
export const TORUS3D_MAJOR_SEGMENTS_MIN = 3;
export const TORUS3D_MAJOR_SEGMENTS_MAX = 48;
export const TORUS3D_MAJOR_SEGMENTS_DEFAULT = 24;

/** 管截面圆（纬线圈）分段数区间 / 缺省值 */
export const TORUS3D_MINOR_SEGMENTS_MIN = 3;
export const TORUS3D_MINOR_SEGMENTS_MAX = 24;
export const TORUS3D_MINOR_SEGMENTS_DEFAULT = 12;

/** 一条命令生成的 line 段总数上限（经线 + 纬线，防刷屏 / 死循环） */
export const TORUS3D_MAX_SEGMENTS = 4096;

/** 可选对称轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const TORUS3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 坐标钳制上限（与 geometry / revolve3d / arc3d 一致） */
const COORD_LIMIT = 10000;

/** 线框默认颜色 / 采样点球半径（与 revolve3d 一致） */
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

/** 严格解析环心 [x,y,z]（几何平移核心，非法原子拒绝，口径同 revolve3d / arc3d） */
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
 * 圆环面采样点：主角 u（经线圆位置，角度制）+ 管角 v（纬线圈位置，角度制），
 * 绕 axis 旋转并平移 center。纯函数、只读入参；输出已 r4 取整 + 坐标钳制。
 *
 * @param {number} R        主圆半径（轴心到管截面圆心）
 * @param {number} r        管半径
 * @param {string} axis     对称轴 'x'/'y'/'z'
 * @param {number} uDeg     主角（角度制）
 * @param {number} vDeg     管角（角度制）
 * @param {Array}  center   环心平移 [x,y,z]
 */
export function torusPointAt(R, r, axis, uDeg, vDeg, center) {
  const u = uDeg * Math.PI / 180;
  const v = vDeg * Math.PI / 180;
  const ringR = R + r * Math.cos(v);
  const axial = r * Math.sin(v);
  const c = r4(clamp(ringR * Math.cos(u)));
  const s = r4(clamp(ringR * Math.sin(u)));
  const ax = r4(clamp(axial));
  const ctr = center;
  let p;
  if (axis === 'x') p = [ctr[0] + ax, ctr[1] + c, ctr[2] + s];
  else if (axis === 'z') p = [ctr[0] + c, ctr[1] + s, ctr[2] + ax];
  else p = [ctr[0] + c, ctr[1] + ax, ctr[2] + s];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 torus3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"torus3d","id":"ring","axis":"y","center":[0,0,0],"R":1.6,"r":0.6,
 *    "majorSegments":24,"minorSegments":12,
 *    "asMeridians":true,"asRings":true,"asPoints":false,"color":"#4f6bed","opacity":1}
 *   - id             可选，生成对象 id 前缀（默认 'tor'；各线/点以 _m<经>_s<段> / _r<纬>_s<段> / _p.. 结尾）；
 *   - axis           可选，'x'/'y'/'z'（默认 'y'），圆环面对称轴；
 *   - center         可选，环心整体平移 [x,y,z]（默认 [0,0,0]，严格解析）；
 *   - R              可选，主圆半径（轴心到管截面圆心，默认 1.6，>0）；
 *   - r              可选，管截面圆半径（默认 0.6，>0）；
 *   - majorSegments  可选，主角分段数 = 经线圆个数，整数 [3,48]（默认 24）；
 *   - minorSegments  可选，管截面圆分段数 = 纬线圈个数，整数 [3,24]（默认 12）；
 *   - asMeridians    可选，是否画经线圆（每个主角处的管截面圆，默认 true）；
 *   - asRings        可选，是否画纬线圈（每个管角处绕轴的圆，默认 true）；
 *   - asPoints       可选，是否在采样网格点放小球标记（默认 false）；
 *   - color / opacity 可选，整条圆环面的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveTorus3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'tor' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'y' : cmd.axis;
  if (!TORUS3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${TORUS3D_AXES.join('/')}` };
  }

  // ---- R / r：主圆与管半径（核心几何，出现即须合法有限正数） ----
  const R = cmd.R === undefined ? TORUS3D_MAJOR_R_DEFAULT : num(cmd.R);
  if (R === null) return { ok: false, error: 'R 必须是数字' };
  if (R < TORUS3D_RADIUS_MIN || R > TORUS3D_RADIUS_MAX) {
    return { ok: false, error: `R 需为 ${TORUS3D_RADIUS_MIN}~${TORUS3D_RADIUS_MAX} 的正数` };
  }
  const r = cmd.r === undefined ? TORUS3D_MINOR_R_DEFAULT : num(cmd.r);
  if (r === null) return { ok: false, error: 'r 必须是数字' };
  if (r < TORUS3D_RADIUS_MIN || r > TORUS3D_RADIUS_MAX) {
    return { ok: false, error: `r 需为 ${TORUS3D_RADIUS_MIN}~${TORUS3D_RADIUS_MAX} 的正数` };
  }

  // ---- 分段数：出现即须合法整数且在区间内（脏值原子拒绝） ----
  const majorRaw = cmd.majorSegments === undefined ? TORUS3D_MAJOR_SEGMENTS_DEFAULT : num(cmd.majorSegments);
  if (majorRaw === null || !Number.isInteger(majorRaw)) return { ok: false, error: 'majorSegments 必须是整数' };
  if (majorRaw < TORUS3D_MAJOR_SEGMENTS_MIN || majorRaw > TORUS3D_MAJOR_SEGMENTS_MAX) {
    return { ok: false, error: `majorSegments 需为 ${TORUS3D_MAJOR_SEGMENTS_MIN}~${TORUS3D_MAJOR_SEGMENTS_MAX} 的整数` };
  }
  const minorRaw = cmd.minorSegments === undefined ? TORUS3D_MINOR_SEGMENTS_DEFAULT : num(cmd.minorSegments);
  if (minorRaw === null || !Number.isInteger(minorRaw)) return { ok: false, error: 'minorSegments 必须是整数' };
  if (minorRaw < TORUS3D_MINOR_SEGMENTS_MIN || minorRaw > TORUS3D_MINOR_SEGMENTS_MAX) {
    return { ok: false, error: `minorSegments 需为 ${TORUS3D_MINOR_SEGMENTS_MIN}~${TORUS3D_MINOR_SEGMENTS_MAX} 的整数` };
  }
  const majorSegments = majorRaw;
  const minorSegments = minorRaw;

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

  // ---- 角度采样：闭合圆，取 N 个角首尾自然相接 ----
  const uAngles = [];
  for (let i = 0; i < majorSegments; i++) uAngles.push(360 * i / majorSegments);
  const vAngles = [];
  for (let j = 0; j < minorSegments; j++) vAngles.push(360 * j / minorSegments);

  // ---- id 避让：收集 state 现有 id，生成时逐一避让 ----
  // stem 预留 8 字符给后缀（与 polyhedron3d / revolve3d 同口径）：prefix 达 64 字符时
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
  // 经线圆：每个主角 u 处，管角 v 相邻采样点连成 minorSegments 条 = majorSegments × minorSegments。
  // 纬线圈：每个管角 v 处绕轴的圆，ringR>0 时 majorSegments 条；ringR≈0（如 R+r·cos v=0 的
  // 自交退化环）跳过该圈。为给出确定上界，按最坏情况（全部 ringR>0）预估。
  const meridianSegs = asMeridians ? majorSegments * minorSegments : 0;
  const ringSegs = asRings ? majorSegments * minorSegments : 0;
  const pointCount = asPoints ? majorSegments * minorSegments : 0;
  if (meridianSegs + ringSegs > TORUS3D_MAX_SEGMENTS) {
    return {
      ok: false,
      error: `线段总数 ${meridianSegs + ringSegs} 超过上限 ${TORUS3D_MAX_SEGMENTS}`,
    };
  }

  const items = [];

  // ---- 经线圆：每个主角 u，把管截面圆上的相邻采样点连成闭合线框 ----
  if (asMeridians) {
    for (let i = 0; i < majorSegments; i++) {
      const u = uAngles[i];
      const row = vAngles.map((v) => torusPointAt(R, r, axis, u, v, center));
      for (let j = 0; j < minorSegments; j++) {
        items.push(mkLine(
          nextId(`${stem}_m${i + 1}_s${j + 1}`.slice(0, 64)),
          row[j], row[(j + 1) % row.length]
        ));
      }
    }
  }

  // ---- 纬线圈：每个管角 v，绕轴一圈（ringR≈0 退化为轴点，跳过） ----
  if (asRings) {
    for (let j = 0; j < minorSegments; j++) {
      const v = vAngles[j];
      const ringR = R + r * Math.cos(v * Math.PI / 180);
      if (Math.abs(ringR) < 1e-9) continue;
      const row = uAngles.map((u) => torusPointAt(R, r, axis, u, v, center));
      for (let i = 0; i < majorSegments; i++) {
        items.push(mkLine(
          nextId(`${stem}_r${j + 1}_s${i + 1}`.slice(0, 64)),
          row[i], row[(i + 1) % row.length]
        ));
      }
    }
  }

  // ---- 可选：在采样网格点放小球标记 ----
  if (asPoints) {
    for (let i = 0; i < majorSegments; i++) {
      for (let j = 0; j < minorSegments; j++) {
        const q = torusPointAt(R, r, axis, uAngles[i], vAngles[j], center);
        items.push(mkPoint(nextId(`${stem}_p${i + 1}_${j + 1}`.slice(0, 64)), q));
      }
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      axis,
      R: r4(R),
      r: r4(r),
      center: center.map(r4),
      majorSegments,
      minorSegments,
      asMeridians,
      asRings,
      asPoints,
      meridianCount: asMeridians ? majorSegments : 0,
      ringCount: asRings ? minorSegments : 0,
      pointCount,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      opacity: lineOpacity,
    },
  };
}

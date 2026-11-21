/**
 * 立体画板「管道（tube / swept circle）」参数化生成命令的纯函数语义层（2026-11-22 D23 增量）
 *
 * 与 js/board3d-capsule.js / -ellipsoid.js / -torus.js / -revolve.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「沿一条空间路径画弯管 / 画管道 / 画扫掠曲面」这类意图，用一条命令生成管道线框：
 *   给中心路径点列 path + 管半径 radius，沿路径在每个采样点生成一个垂直切向的横截面圆，
 *   再把相邻截面的对应点连成母线；可选采样点。产出由 line 段（及可选 point）构成的线框，
 *   可直接交给 board3dApi.add() 逐段落地；执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d 内置图元（cylinder/cone 等）只能画直管，无法表达弯曲路径；
 *   - helix3d（D14）：螺旋线（中心线），无管半径、不生成横截面；
 *   - bezier3d（D15）：自由曲线（中心线），同样无截面；
 *   - arc3d（D16）：圆弧（中心线），无截面；
 *   - revolve3d（D19）：母线绕固定轴回转，只能画回转对称形状；
 *   - tube3d：**沿任意 3D 路径扫掠一个圆截面**，能画弯管 / S 形管 / 弹簧外壳 / 空间折管，
 *     是「中心线 + 恒定管半径」的高层封装。
 *
 * 几何定义：给定采样路径 P0..Pn-1，在每个 Pi 处取单位切向 Ti 及与之垂直的法向 Ni、副法向 Bi
 *   （用平行移动标架 parallel transport frame，避免转折处截面翻转），截面圆上点为
 *     Q(i,θ) = Pi + r·(cosθ·Ni + sinθ·Bi)
 *   **核心守恒：截面圆上任一点到其中心 Pi 的距离恒为 r，且 (Q-Pi)·Ti = 0**（截面垂直于路径）。
 */

/** 管半径合法区间（>0，上限防刷屏），缺省值 */
export const TUBE3D_RADIUS_MIN = 0.01;
export const TUBE3D_RADIUS_MAX = 1000;
export const TUBE3D_RADIUS_DEFAULT = 0.5;

/** 中心路径控制点数量区间（2 = 直管，上限防刷屏），缺省为一条竖直直管 */
export const TUBE3D_PATH_MIN = 2;
export const TUBE3D_PATH_MAX = 32;
export const TUBE3D_PATH_DEFAULT = Object.freeze([[0, 0, 0], [0, 2, 0]]);

/** 每段路径细分数区间 / 缺省值（采样点数 = (控制点数-1)*steps + 1） */
export const TUBE3D_STEPS_MIN = 1;
export const TUBE3D_STEPS_MAX = 16;
export const TUBE3D_STEPS_DEFAULT = 4;

/** 横截面圆环分段数区间 / 缺省值 */
export const TUBE3D_RADIAL_SEGMENTS_MIN = 3;
export const TUBE3D_RADIAL_SEGMENTS_MAX = 64;
export const TUBE3D_RADIAL_SEGMENTS_DEFAULT = 12;

/** 一条命令生成的 line 段总数上限（防刷屏 / 死循环） */
export const TUBE3D_MAX_SEGMENTS = 4096;

/** 采样路径点数上限（控制点 × 细分），防刷屏 */
export const TUBE3D_MAX_SAMPLES = 257;

/** 坐标钳制上限（与 geometry / revolve3d / capsule3d 一致） */
const COORD_LIMIT = 10000;

/** 线框默认颜色 / 采样点球半径（与 capsule3d 一致） */
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

/** 严格解析一个 3D 点 [x,y,z]（非法返回 null） */
function parsePoint(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out.map(clamp) : null;
}

/** 严格解析中心 [x,y,z]（几何平移核心，非法原子拒绝） */
function parseCenter(v) {
  return parsePoint(v);
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

/* ---------------- 向量工具（纯函数，只读入参） ---------------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.sqrt(dot(a, a));
function unitV(a, fallback) {
  const n = norm(a);
  return n < 1e-9 ? fallback.slice() : mul(a, 1 / n);
}

/** Rodrigues：把向量 v 绕单位轴 axis 旋转 angle 弧度 */
function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
}

/**
 * 把控制点列按 steps 线性细分成采样路径（相邻控制点之间均匀插入 steps 段）。
 * 例：[[0,0,0],[0,2,0]] + steps=2 → [[0,0,0],[0,1,0],[0,2,0]]。纯函数、只读入参。
 */
export function samplePath(points, steps) {
  const out = [];
  const n = points.length;
  if (n === 0) return out;
  out.push(points[0].slice());
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  return out;
}

/**
 * 为采样路径计算平行移动标架：返回 { P:[...], T:[...], N:[...], B:[...] } 四个等长数组。
 * T 为单位切向（端点用单侧差分，内部用中心差分），N/B 由平行移动 + 正交化得到，
 * 保证每个截面的 Ni、Bi 都严格垂直于 Ti，转折处不翻转。纯函数、只读入参。
 */
export function tubeFrames(path) {
  const n = path.length;
  if (n === 0) return { P: [], T: [], N: [], B: [] };
  const T = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (n === 1) t = [0, 1, 0];
    else if (i === 0) t = sub(path[1], path[0]);
    else if (i === n - 1) t = sub(path[n - 1], path[n - 2]);
    else t = sub(path[i + 1], path[i - 1]);
    T.push(unitV(t, [0, 1, 0]));
  }
  // 初始法向：取一个与 T0 不平行的参考轴，叉乘后正交化
  const ref = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const N = [unitV(cross(ref, T[0]), [1, 0, 0])];
  const B = [unitV(cross(T[0], N[0]), [0, 0, 1])];
  for (let i = 1; i < n; i++) {
    const prevT = T[i - 1];
    const curT = T[i];
    const axis = cross(prevT, curT);
    const s = norm(axis);
    const d = Math.min(1, Math.max(-1, dot(prevT, curT)));
    let ni;
    if (d < -0.999999) {
      // 反平行：平行移动轴退化，重新选一个垂直于 curT 的参考
      const r = Math.abs(curT[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      ni = cross(r, curT);
    } else if (s < 1e-9) {
      ni = N[i - 1].slice();
    } else {
      ni = rotateAround(N[i - 1], mul(axis, 1 / s), Math.acos(d));
    }
    // 正交化到当前切向（消除浮点累积误差）
    ni = unitV(sub(ni, mul(curT, dot(ni, curT))), N[i - 1]);
    N.push(ni);
    B.push(unitV(cross(curT, ni), [0, 0, 1]));
  }
  return { P: path.map((p) => p.slice()), T, N, B };
}

/**
 * 截面圆上一点：frame 为 tubeFrames 中某一点的 {P,T,N,B}，thetaDeg 为方位角（角度制），
 * radius 为管半径，offset 为整体平移。返回已 r4 取整 + 钳制的 [x,y,z]。
 * 守恒：|Q - (P+offset)| = radius 且 (Q-(P+offset))·T = 0。纯函数、只读入参。
 */
export function tubePointAt(frame, radius, thetaDeg, offset) {
  const th = thetaDeg * Math.PI / 180;
  const e = add(mul(frame.N, Math.cos(th)), mul(frame.B, Math.sin(th)));
  const p = add(add(frame.P, mul(e, radius)), offset);
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 tube3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"tube3d","id":"tube","path":[[0,0,0],[1,1,0],[2,0,0]],"radius":0.4,
 *    "steps":4,"radialSegments":12,"center":[0,0,0],
 *    "asRings":true,"asMeridians":true,"asPoints":false,"color":"#4f6bed","opacity":1}
 *   - id             可选，生成对象 id 前缀（默认 'tube'；各段以 _R<i>_s<j> / _M<j>_s<i> / _p.. 结尾）；
 *   - path           可选，中心路径控制点列（2~32 个 [x,y,z]，默认竖直直管 [[0,0,0],[0,2,0]]）；
 *   - radius         可选，管半径（默认 0.5，>0）；
 *   - steps          可选，每段路径细分数，整数 [1,16]（默认 4）；
 *   - radialSegments 可选，横截面圆环分段数，整数 [3,64]（默认 12）；
 *   - center         可选，整体平移 [x,y,z]（默认 [0,0,0]，严格解析）；
 *   - asRings        可选，是否画横截面圆环（默认 true）；
 *   - asMeridians    可选，是否画沿路径母线（默认 true）；
 *   - asPoints       可选，是否在采样点放小球标记（默认 false）；
 *   - color / opacity 可选，整条管道的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，脏输入一律整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveTube3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'tube' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- path：中心路径控制点列（出现即须合法，数量 2~32，每点严格解析） ----
  const rawPath = cmd.path === undefined ? TUBE3D_PATH_DEFAULT : cmd.path;
  if (!Array.isArray(rawPath) || rawPath.length < TUBE3D_PATH_MIN || rawPath.length > TUBE3D_PATH_MAX) {
    return { ok: false, error: `path 需为 ${TUBE3D_PATH_MIN}~${TUBE3D_PATH_MAX} 个 [x,y,z] 控制点` };
  }
  const path = [];
  for (const pt of rawPath) {
    const q = parsePoint(pt);
    if (q === null) return { ok: false, error: 'path 每点必须是含 3 个有限数值的 [x,y,z]' };
    path.push(q);
  }

  // ---- radius：管半径（核心几何，出现即须合法有限正数） ----
  const radiusRaw = cmd.radius === undefined ? TUBE3D_RADIUS_DEFAULT : num(cmd.radius);
  if (radiusRaw === null) return { ok: false, error: 'radius 必须是数字' };
  if (radiusRaw < TUBE3D_RADIUS_MIN || radiusRaw > TUBE3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${TUBE3D_RADIUS_MIN}~${TUBE3D_RADIUS_MAX} 的正数` };
  }

  // ---- 分段数：出现即须合法整数且在区间内（脏值原子拒绝） ----
  const intInRange = (raw, def, min, max, label) => {
    const n = raw === undefined ? def : num(raw);
    if (n === null || !Number.isInteger(n)) return { error: `${label} 必须是整数` };
    if (n < min || n > max) return { error: `${label} 需为 ${min}~${max} 的整数` };
    return { value: n };
  };
  const st = intInRange(cmd.steps, TUBE3D_STEPS_DEFAULT, TUBE3D_STEPS_MIN, TUBE3D_STEPS_MAX, 'steps');
  if (st.error) return { ok: false, error: st.error };
  const rs = intInRange(cmd.radialSegments, TUBE3D_RADIAL_SEGMENTS_DEFAULT, TUBE3D_RADIAL_SEGMENTS_MIN, TUBE3D_RADIAL_SEGMENTS_MAX, 'radialSegments');
  if (rs.error) return { ok: false, error: rs.error };
  const steps = st.value;
  const radialSegments = rs.value;

  for (const flag of ['asRings', 'asMeridians', 'asPoints']) {
    if (cmd[flag] !== undefined && typeof cmd[flag] !== 'boolean') {
      return { ok: false, error: `${flag} 必须是布尔值` };
    }
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) {
    return { ok: false, error: 'opacity 必须是数字' };
  }

  const center = cmd.center === undefined ? [0, 0, 0] : parseCenter(cmd.center);
  if (center === null) return { ok: false, error: 'center 必须是含 3 个有限数值的 [x,y,z]' };

  const asRings = cmd.asRings === undefined ? true : cmd.asRings;
  const asMeridians = cmd.asMeridians === undefined ? true : cmd.asMeridians;
  const asPoints = cmd.asPoints === true;
  if (!asRings && !asMeridians && !asPoints) {
    return { ok: false, error: 'asRings / asMeridians / asPoints 至少开一个' };
  }
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // ---- 采样路径 + 平行移动标架 ----
  const sampled = samplePath(path, steps);
  if (sampled.length > TUBE3D_MAX_SAMPLES) {
    return { ok: false, error: `采样点数 ${sampled.length} 超过上限 ${TUBE3D_MAX_SAMPLES}` };
  }
  const frames = tubeFrames(sampled);
  // tubeFrames 返回列式结构 {P:[...],T:[...],N:[...],B:[...]}，转成逐点帧供 tubePointAt 使用
  const frameList = frames.P.map((_, i) => ({ P: frames.P[i], T: frames.T[i], N: frames.N[i], B: frames.B[i] }));
  const sampleCount = sampled.length;

  // ---- 预估段数，超上限原子拒绝（避免生成到一半才中断） ----
  const ringSegs = asRings ? sampleCount * radialSegments : 0;
  const meridianSegs = asMeridians ? radialSegments * (sampleCount - 1) : 0;
  const pointCount = asPoints ? sampleCount * radialSegments : 0;
  if (ringSegs + meridianSegs > TUBE3D_MAX_SEGMENTS) {
    return {
      ok: false,
      error: `线段总数 ${ringSegs + meridianSegs} 超过上限 ${TUBE3D_MAX_SEGMENTS}`,
    };
  }

  // ---- id 避让：收集 state 现有 id，生成时逐一避让（stem 预留 8 字符后缀位） ----
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

  // 预计算所有截面圆上的点（sampleCount × radialSegments）
  const ring = [];
  for (let i = 0; i < sampleCount; i++) {
    const row = [];
    for (let j = 0; j < radialSegments; j++) {
      row.push(tubePointAt(frameList[i], radiusRaw, 360 * j / radialSegments, center));
    }
    ring.push(row);
  }

  const items = [];

  // ---- 横截面圆环：固定采样点 i，方位角闭合一圈 ----
  if (asRings) {
    for (let i = 0; i < sampleCount; i++) {
      for (let j = 0; j < radialSegments; j++) {
        items.push(mkLine(
          nextId(`${stem}_R${i + 1}_s${j + 1}`.slice(0, 64)),
          ring[i][j], ring[i][(j + 1) % radialSegments]
        ));
      }
    }
  }

  // ---- 母线：固定方位角 j，沿路径连接相邻采样点 ----
  if (asMeridians) {
    for (let j = 0; j < radialSegments; j++) {
      for (let i = 0; i < sampleCount - 1; i++) {
        items.push(mkLine(
          nextId(`${stem}_M${j + 1}_s${i + 1}`.slice(0, 64)),
          ring[i][j], ring[i + 1][j]
        ));
      }
    }
  }

  // ---- 可选：在每个截面采样点放小球标记 ----
  if (asPoints) {
    for (let i = 0; i < sampleCount; i++) {
      for (let j = 0; j < radialSegments; j++) {
        items.push(mkPoint(nextId(`${stem}_p${i + 1}_${j + 1}`.slice(0, 64)), ring[i][j]));
      }
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      path: path.map((p) => p.map(r4)),
      radius: r4(radiusRaw),
      steps,
      radialSegments,
      center: center.map(r4),
      asRings,
      asMeridians,
      asPoints,
      sampleCount,
      ringCount: asRings ? sampleCount : 0,
      meridianCount: asMeridians ? radialSegments : 0,
      pointCount,
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      opacity: lineOpacity,
    },
  };
}

/**
 * 立体画板「空间螺旋线 / 弹簧」参数化生成命令的纯函数语义层（2026-11-17 D14 增量）
 *
 * 与 js/board3d-measure.js / -transform.js / -duplicate.js / -align.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一条弹簧」「螺纹线」「DNA 双螺旋的一条链」「绕 Z 轴盘旋向上的螺旋」
 * 这类意图，用参数方程算出采样点，产出一条由 line 段首尾相接构成的空间螺旋线，
 * 可直接交给 board3dApi.add() 逐段落地。执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d line：手工给两个端点，只画一条直线段；
 *   - radial3d：把**已有对象**绕轴均分复制成一圈（离散圆环），不生成连续曲线；
 *   - helix3d：按参数方程**连续采样生成**一条螺旋曲线（多条 line 段），对象数由
 *     turns × segments 决定，不需要场景里预先有源对象，是真正的「曲线发生器」。
 *
 * 参数方程（t 从 0 到 turns·2π，θ = t + phase）：
 *   axis='z'（默认）：x = cx + r·cosθ, y = cy + r·sinθ, z = cz + pitch·t/(2π)
 *   axis='x'：        x = cx + pitch·t/(2π), y = cy + r·cosθ, z = cz + r·sinθ
 *   axis='y'：        x = cx + r·cosθ, y = cy + pitch·t/(2π), z = cz + r·sinθ
 */

/** 一条 helix3d 命令最多允许的圈数（防刷屏 / 死循环） */
export const HELIX3D_TURNS_MAX = 12;

/** 每圈采样段数的合法区间 [min, max] */
export const HELIX3D_SEG_PER_TURN_MIN = 3;
export const HELIX3D_SEG_PER_TURN_MAX = 48;

/** 一条命令生成的 line 段总数上限（与 grid3d 的 512 上限同口径） */
export const HELIX3D_MAX_SEGMENTS = 512;

/** 可选轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const HELIX3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 坐标钳制上限（与 geometry COORD_LIMIT 一致） */
const COORD_LIMIT = 10000;

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

/** 三元组数值向量；非法回落 def，元素钳制到 ±COORD_LIMIT */
function vec3Clamped(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def.slice();
  const out = v.map(num);
  if (out.some((x) => x === null)) return def.slice();
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
 * 按参数方程计算第 i 个采样点（i = 0..totalSegments），返回绝对坐标三元组。
 * axis 决定「绕哪根轴盘旋」；垂直于该轴的两分量走 cos/sin，轴向分量线性上升。
 */
function pointAt(i, total, cfg) {
  const t = cfg.turns * 2 * Math.PI * (i / total);
  const theta = t + cfg.phaseRad;
  const axial = cfg.pitch * (t / (2 * Math.PI)); // 每圈上升 pitch
  const cos = cfg.radius * Math.cos(theta);
  const sin = cfg.radius * Math.sin(theta);
  const c = cfg.center;
  let p;
  if (cfg.axis === 'x') p = [c[0] + axial, c[1] + cos, c[2] + sin];
  else if (cfg.axis === 'y') p = [c[0] + cos, c[1] + axial, c[2] + sin];
  else p = [c[0] + cos, c[1] + sin, c[2] + axial];
  return p.map((x) => r4(clamp(x)));
}

/**
 * 解析一条 helix3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"helix3d","id":"spring","axis":"z","radius":1.2,"pitch":0.8,"turns":5,"segments":12}
 *   - id        可选，生成对象的 id 前缀（默认 'helix'；段以 `_s<n>`、采样点以 `_p<n>` 结尾）；
 *   - axis      可选，'x'/'y'/'z'（默认 'z'），绕该轴盘旋；
 *   - radius    可选，半径 > 0（默认 1）；
 *   - pitch     可选，每圈沿轴向上升距离（默认 1），可为 0（平面圆）/ 负数（反向）；
 *   - turns     可选，圈数 (0, HELIX3D_TURNS_MAX]（默认 3）；
 *   - segments  可选，每圈采样段数，整数 [3,48]（默认 12）；总段数 = turns×segments，
 *               超过 HELIX3D_MAX_SEGMENTS 时整条原子拒绝（防刷屏）；
 *   - center    可选，螺旋起始中心 [x,y,z]（默认 [0,0,0]）；
 *   - phase     可选，起始角（角度制，默认 0）；
 *   - asPoints  可选，是否在采样点放小球标记（默认 false）；
 *   - color / opacity 可选，整条螺旋线的样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，否则整条原子拒绝。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 每项为可直接交给 api.add() 的 line（及可选 point）对象规格；全程不修改入参。
 */
export function resolveHelix3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // ---- id 前缀：合法即用它，非法拒绝（不静默改写） ----
  const prefix = cmd.id === undefined ? 'helix' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // ---- axis：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'z' : cmd.axis;
  if (!HELIX3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${HELIX3D_AXES.join('/')}` };
  }

  // ---- 数值参数：只要在命令里出现就必须是合法有限数（脏值一律原子拒绝） ----
  const radius = cmd.radius === undefined ? 1 : num(cmd.radius);
  if (radius === null) return { ok: false, error: 'radius 必须是数字' };
  if (!(radius > 0)) return { ok: false, error: 'radius 必须大于 0' };

  const pitch = cmd.pitch === undefined ? 1 : num(cmd.pitch);
  if (pitch === null) return { ok: false, error: 'pitch 必须是数字' };

  const turnsRaw = cmd.turns === undefined ? 3 : num(cmd.turns);
  if (turnsRaw === null) return { ok: false, error: 'turns 必须是数字' };
  if (!(turnsRaw > 0)) return { ok: false, error: 'turns 必须大于 0' };
  const turns = Math.min(HELIX3D_TURNS_MAX, Math.round(turnsRaw * 1e4) / 1e4);

  const segRaw = cmd.segments === undefined ? 12 : num(cmd.segments);
  if (segRaw === null) return { ok: false, error: 'segments 必须是数字' };
  if (!Number.isInteger(segRaw)) return { ok: false, error: 'segments 必须是整数' };
  const segments = segRaw;
  if (segments < HELIX3D_SEG_PER_TURN_MIN || segments > HELIX3D_SEG_PER_TURN_MAX) {
    return { ok: false, error: `segments 需为 ${HELIX3D_SEG_PER_TURN_MIN}~${HELIX3D_SEG_PER_TURN_MAX} 的整数` };
  }

  const phase = cmd.phase === undefined ? 0 : num(cmd.phase);
  if (phase === null) return { ok: false, error: 'phase 必须是数字' };

  if (cmd.asPoints !== undefined && typeof cmd.asPoints !== 'boolean') {
    return { ok: false, error: 'asPoints 必须是布尔值' };
  }
  const asPoints = cmd.asPoints === true;

  const center = vec3Clamped(cmd.center, [0, 0, 0]);
  const lineColor = color(cmd.color, '#4f6bed');
  const lineOpacity = opacity(cmd.opacity);

  // ---- 总段数：四舍五入后钳制到上限，超过上限原子拒绝 ----
  let total = Math.round(turns * segments);
  if (total < 1) total = 1;
  if (total > HELIX3D_MAX_SEGMENTS) {
    return { ok: false, error: `螺旋段数 ${total} 超过上限 ${HELIX3D_MAX_SEGMENTS}` };
  }

  // ---- 采样点（total+1 个）：一次性算出，段与点标记共用，保证几何一致 ----
  const cfg = {
    turns, radius, pitch, center,
    phaseRad: phase * Math.PI / 180,
    axis,
  };
  const pts = [];
  for (let i = 0; i <= total; i++) pts.push(pointAt(i, total, cfg));

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
  for (let i = 0; i < total; i++) {
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
    for (let i = 0; i <= total; i++) {
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
        p: { s: 0.12 },
      });
    }
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix, axis, radius,
      pitch: r4(pitch), turns, segments, phase: r4(phase),
      center: center.map(r4), asPoints,
      segmentCount: total, pointCount: pts.length,
      first: pts[0].slice(), last: pts[pts.length - 1].slice(),
    },
  };
}

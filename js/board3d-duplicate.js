/**
 * 立体画板「复制对象」命令的纯函数语义层（2026-11-16 D9 增量）
 *
 * 与 js/board3d-measure.js / -transform.js / -geometry.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象，绝不修改 cmd / state。
 *
 * 作用：把用户「把这个球复制一份 / 再摆一个一样的 / 沿 X 排 3 个」的意图，
 * 从「当前画板状态」里按源 id 读出一个完整对象，克隆并施加位置偏移，产出
 * 可直接交给 board3dApi.add() 的新对象规格。执行器负责调用 add 并登记 id。
 *
 * 与 update3d / transform3d 的区别：这两个是「改现有对象」；duplicate3d 是
 * 「基于现有对象新建一个」，因此需要新 id，且只从同一份 state 快照读取源对象，
 * 与同批命令的先后顺序无关（先建的源对象需由调用方保证已进入 getState）。
 */

/** 一条 duplicate3d 命令最多允许克隆的数量（防止一次命令刷屏） */
export const DUP3D_COPIES_MAX = 32;

/** 位置偏差/坐标的钳制上限（与 geometry COORD_LIMIT 一致） */
const COORD_LIMIT = 10000;

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组）一律拒绝 */
function num(v) {
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

/** 三元组数值向量；非法回落 def，元素钳制到 ±COORD_LIMIT */
function vec3Clamped(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def.slice();
  const out = v.map(num);
  if (out.some((x) => x === null)) return def.slice();
  return out.map((x) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, x)));
}

/** 缩放向量：正数钳制到 [0.05, 100]，非法回落 [1,1,1] */
function scale3(v) {
  if (!Array.isArray(v) || v.length !== 3) return [1, 1, 1];
  const out = v.map(num);
  if (out.some((x) => x === null)) return [1, 1, 1];
  return out.map((x) => Math.min(100, Math.max(0.05, x)));
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
 * 解析一条 duplicate3d 命令（只读）。
 *
 * @param {Object} cmd  形如：
 *   {"op":"duplicate3d","id":"ball","newId":"ball2","offset":[2,0,0],"count":3}
 *   - id    必填，源对象 id（场景里已存在）
 *   - newId 可选，新对象 id；省略时自动生成 `<id>_copy`（批量时加序号）
 *   - offset 可选，位置偏移 [dx,dy,dz]（默认 [0,0,0]）
 *   - count  可选，克隆份数 1~32（默认 1）；>1 时 offset 逐份累加，形成等距阵列
 *   - 可选覆盖：color / opacity / pos（绝对，覆盖后再加 offset）/ rot / scale / params
 * @param {Object} state 形如 { objects: [...] }，只读
 * @returns {{ok:boolean, items?:Array, error?:string}}
 *   items 每项为可直接交给 api.add() 的新对象规格；全程不修改入参。
 */
export function resolveDuplicate3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };
  const srcId = cmd.id;
  if (!isId(srcId)) return { ok: false, error: '源对象 id 非法' };

  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  const src = objs.find((o) => o && o.id === srcId);
  if (!src) return { ok: false, error: `要复制的源对象 id 不存在：${String(srcId)}` };
  if (!src.type) return { ok: false, error: '源对象缺少 type，无法复制' };

  // 现有 id 集合：用于自动命名去重
  const used = new Set(objs.map((o) => o && o.id).filter(Boolean));

  // count：默认 1，整数，钳制 [1, DUP3D_COPIES_MAX]
  let count = 1;
  if (cmd.count !== undefined) {
    const n = num(cmd.count);
    if (n === null) return { ok: false, error: 'count 必须是数字' };
    count = Math.min(DUP3D_COPIES_MAX, Math.max(1, Math.round(n)));
  }

  // newId：显式给定时必须合法（与 add3d 的 id 规则一致），非法即拒绝、不静默改写
  const hasExplicitNewId = cmd.newId !== undefined;
  if (hasExplicitNewId && !isId(cmd.newId)) {
    return { ok: false, error: `newId 非法：${String(cmd.newId)}` };
  }
  // 显式单份 newId 与现有 id 冲突 → 报错（与 add3d 同口径），不自动改名；
  // 自动生成的 id 冲突时才在下方避让。批量时 newId 作为名称前缀，不适用此检查。
  if (hasExplicitNewId && count === 1 && used.has(cmd.newId)) {
    return { ok: false, error: `目标 id 已存在：${cmd.newId}` };
  }

  const offset = vec3Clamped(cmd.offset, [0, 0, 0]);
  const basePos = Array.isArray(src.pos) ? vec3Clamped(src.pos, [0, 0, 0]) : [0, 0, 0];
  const baseRot = Array.isArray(src.rot) ? vec3Clamped(src.rot, [0, 0, 0]) : [0, 0, 0];
  const baseScale = Array.isArray(src.scale) ? scale3(src.scale) : [1, 1, 1];
  const srcParams = src.p && typeof src.p === 'object' && !Array.isArray(src.p) ? src.p : {};

  // 绝对 pos 覆盖（可选）：写入后再叠加 offset
  const overridePos = cmd.pos !== undefined ? vec3Clamped(cmd.pos, basePos) : basePos;
  const overrideRot = cmd.rot !== undefined ? vec3Clamped(cmd.rot, baseRot) : baseRot;
  const overrideScale = cmd.scale !== undefined ? scale3(cmd.scale) : baseScale;
  const overrideColor = cmd.color !== undefined ? color(cmd.color, src.color || '#4f6bed') : (src.color || '#4f6bed');
  const overrideOpacity = cmd.opacity !== undefined ? opacity(cmd.opacity) : (num(src.opacity) === null ? 1 : opacity(src.opacity));

  // params 覆盖：只在源类型允许的键上，按覆盖值逐键覆盖，保持其余键不变；值须有限数值
  const p = { ...srcParams };
  if (cmd.params && typeof cmd.params === 'object' && !Array.isArray(cmd.params)) {
    for (const k of Object.keys(cmd.params)) {
      const n = num(cmd.params[k]);
      if (n !== null) p[k] = n;
    }
  }

  // 目标 id：单份用 newId（或 <id>_copy）；批量用 `<base>1..n`（有显式 newId 时以其为前缀），
  // 自动生成的 id 与现有冲突时追加 _2、_3 … 避让。
  const baseName = hasExplicitNewId ? cmd.newId : `${srcId}_copy`;
  const items = [];
  for (let i = 0; i < count; i++) {
    let id;
    if (count === 1) {
      id = baseName;
    } else {
      id = `${baseName}${i + 1}`.slice(0, 64);
    }
    // 同名避让：仅对自动 id（显式单份已在上方拒绝过冲突）
    if (used.has(id)) {
      let k = 2;
      let cand = `${id}_${k}`.slice(0, 64);
      while (used.has(cand)) { cand = `${id}_${++k}`.slice(0, 64); }
      id = cand;
    }
    used.add(id);

    // 每份都相对源位置偏移 offset 的 (i+1) 倍，第一份即生效、逐份累加成等距阵列。
    const step = i + 1;
    const pos = overridePos.map((v, j) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, v + offset[j] * step)));
    items.push({
      id,
      type: src.type,
      text: typeof src.text === 'string' ? src.text : '',
      color: overrideColor,
      opacity: overrideOpacity,
      pos,
      rot: overrideRot.slice(),
      scale: overrideScale.slice(),
      p: { ...p },
    });
  }

  return { ok: true, items };
}

/* ============================================================ *
 * 2026-11-16 D10 追加段：radial3d 环形阵列（独立自主 3D 画板任务）
 * 协作铁律：本段只追加，上方 resolveDuplicate3D 及全部工具函数逐字未动。
 * 作用：把「把柱子绕圆心摆一圈 / 环形阵列 8 个球 / 绕 Z 轴转着排」这类意图，
 * 从当前 state 按源 id 读出一个对象，绕指定轴、中心、半径、角度均匀克隆成环，
 * 产出可直接交给 board3dApi.add() 的新对象规格。纯函数、只读、脏输入原子拒绝。
 * ============================================================ */

/** 一条 radial3d 命令最多生成的份数（与 duplicate3d 同口径，防刷屏） */
export const RADIAL3D_COPIES_MAX = 32;

/** 阵列角度默认扫过整圈（度）与缺省半径 */
const RADIAL_DEFAULT_SWEEP = 360;
const RADIAL_DEFAULT_RADIUS = 3;

/** 角度钳制上限（度，允许负角与多圈但拒绝离谱值） */
const ANGLE_LIMIT = 1e6;

/** 轴向白名单：绕哪个轴排环 */
const RADIAL_AXES = Object.freeze(['x', 'y', 'z']);

/**
 * 解析一条 radial3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"radial3d","id":"pillar","count":8,"center":[0,0,0],"axis":"y","radius":3,"startAngle":0,"sweep":360,"rotate":true}
 *   - id         必填，源对象 id（场景中已存在）
 *   - count      份数 1~32（默认 8）；整份均分，不含终点，360° 时首末不重合
 *   - center     阵列中心 [x,y,z]（默认 [0,0,0]，元素钳制 ±COORD_LIMIT）
 *   - axis       环绕轴 'x'|'y'|'z'（默认 'y'）；垂直平面上的坐标按角度旋转，轴上坐标沿源对象
 *   - radius     环半径（默认：源对象在垂直平面到 center 的距离，为 0 时回落 3），钳制 [0,COORD_LIMIT]
 *   - startAngle 起始角（度，默认 0，钳制 ±ANGLE_LIMIT）
 *   - sweep      扫过总角度（度，默认 360，钳制 ±ANGLE_LIMIT）；可为负表示反向
 *   - rotate     对象自身是否随阵列绕轴自转朝向（布尔，默认 false）
 *   - newId      可选，单份显式 id；批量时作为名称前缀（合法性同 duplicate3d）
 *   - 可选覆盖：color / opacity / scale / params（pos / rot 由阵列几何决定，不接受覆盖）
 * @param {Object} state 形如 { objects: [...] }，只读
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveRadial3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };
  const srcId = cmd.id;
  if (!isId(srcId)) return { ok: false, error: '源对象 id 非法' };

  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  const src = objs.find((o) => o && o.id === srcId);
  if (!src) return { ok: false, error: `要阵列的源对象 id 不存在：${String(srcId)}` };
  if (!src.type) return { ok: false, error: '源对象缺少 type，无法阵列' };

  const used = new Set(objs.map((o) => o && o.id).filter(Boolean));

  // count：默认 8，整数，钳制 [1, RADIAL3D_COPIES_MAX]
  let count = 8;
  if (cmd.count !== undefined) {
    const n = num(cmd.count);
    if (n === null) return { ok: false, error: 'count 必须是数字' };
    count = Math.min(RADIAL3D_COPIES_MAX, Math.max(1, Math.round(n)));
  }

  // center：三元组钳制
  const center = vec3Clamped(cmd.center, [0, 0, 0]);

  // axis：白名单，非法即拒绝（不静默改写）
  const axis = cmd.axis === undefined ? 'y' : cmd.axis;
  if (!RADIAL_AXES.includes(axis)) return { ok: false, error: `axis 非法，只能是 x/y/z：${String(axis)}` };

  // startAngle / sweep：度，严格数值化并钳制
  let startAngle = 0;
  if (cmd.startAngle !== undefined) {
    const a = num(cmd.startAngle);
    if (a === null) return { ok: false, error: 'startAngle 必须是数字' };
    startAngle = Math.min(ANGLE_LIMIT, Math.max(-ANGLE_LIMIT, a));
  }
  let sweep = RADIAL_DEFAULT_SWEEP;
  if (cmd.sweep !== undefined) {
    const s = num(cmd.sweep);
    if (s === null) return { ok: false, error: 'sweep 必须是数字' };
    sweep = Math.min(ANGLE_LIMIT, Math.max(-ANGLE_LIMIT, s));
  }

  // rotate：布尔白名单（非法拒绝，不静默当 false）
  let rotate = false;
  if (cmd.rotate !== undefined) {
    if (typeof cmd.rotate !== 'boolean') return { ok: false, error: 'rotate 必须是布尔值' };
    rotate = cmd.rotate;
  }

  // newId 校验（与 duplicate3d 同口径）
  const hasExplicitNewId = cmd.newId !== undefined;
  if (hasExplicitNewId && !isId(cmd.newId)) {
    return { ok: false, error: `newId 非法：${String(cmd.newId)}` };
  }
  if (hasExplicitNewId && count === 1 && used.has(cmd.newId)) {
    return { ok: false, error: `目标 id 已存在：${cmd.newId}` };
  }

  const basePos = Array.isArray(src.pos) ? vec3Clamped(src.pos, [0, 0, 0]) : [0, 0, 0];
  const baseRot = Array.isArray(src.rot) ? vec3Clamped(src.rot, [0, 0, 0]) : [0, 0, 0];
  const baseScale = Array.isArray(src.scale) ? scale3(src.scale) : [1, 1, 1];
  const srcParams = src.p && typeof src.p === 'object' && !Array.isArray(src.p) ? src.p : {};

  // radius：显式则严格数值化并钳制 [0,COORD_LIMIT]；缺省取源对象在垂直平面到 center 的距离，
  // 距离为 0（源在轴上）时回落默认半径，避免整圈对象重叠在轴心。
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const planeIdx = [0, 1, 2].filter((k) => k !== ai);
  let radius;
  if (cmd.radius !== undefined) {
    const r = num(cmd.radius);
    if (r === null) return { ok: false, error: 'radius 必须是数字' };
    radius = Math.min(COORD_LIMIT, Math.max(0, r));
  } else {
    const dr = Math.hypot(basePos[planeIdx[0]] - center[planeIdx[0]], basePos[planeIdx[1]] - center[planeIdx[1]]);
    radius = Math.min(COORD_LIMIT, dr === 0 ? RADIAL_DEFAULT_RADIUS : dr);
  }

  // 可选覆盖字段（复用与 duplicate3d 完全一致的解析口径）
  const overrideScale = cmd.scale !== undefined ? scale3(cmd.scale) : baseScale;
  const overrideColor = cmd.color !== undefined ? color(cmd.color, src.color || '#4f6bed') : (src.color || '#4f6bed');
  const overrideOpacity = cmd.opacity !== undefined ? opacity(cmd.opacity) : (num(src.opacity) === null ? 1 : opacity(src.opacity));
  const p = { ...srcParams };
  if (cmd.params && typeof cmd.params === 'object' && !Array.isArray(cmd.params)) {
    for (const k of Object.keys(cmd.params)) {
      const n = num(cmd.params[k]);
      if (n !== null) p[k] = n;
    }
  }

  const baseName = hasExplicitNewId ? cmd.newId : `${srcId}_rad`;
  const items = [];
  const angles = [];
  for (let i = 0; i < count; i++) {
    let id;
    if (count === 1) {
      id = baseName;
    } else {
      id = `${baseName}${i + 1}`.slice(0, 64);
    }
    if (used.has(id)) {
      let k = 2;
      let cand = `${id}_${k}`.slice(0, 64);
      while (used.has(cand)) { cand = `${id}_${++k}`.slice(0, 64); }
      id = cand;
    }
    used.add(id);

    // 整份均分：第 i 份角度 = startAngle + sweep * i / count（不含终点，360° 首末不重合）
    const deg = startAngle + (sweep * i) / count;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const pos = basePos.slice();
    pos[planeIdx[0]] = Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, center[planeIdx[0]] + radius * cos));
    pos[planeIdx[1]] = Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, center[planeIdx[1]] + radius * sin));

    // rot：默认沿用源朝向；rotate=true 时把该份角度叠加到环绕轴分量，使对象朝向随阵列转动
    const rot = baseRot.slice();
    if (rotate) rot[ai] = Math.min(ANGLE_LIMIT, Math.max(-ANGLE_LIMIT, rot[ai] + deg));

    items.push({
      id,
      type: src.type,
      text: typeof src.text === 'string' ? src.text : '',
      color: overrideColor,
      opacity: overrideOpacity,
      pos,
      rot,
      scale: overrideScale.slice(),
      p: { ...p },
    });
    angles.push(deg);
  }

  return {
    ok: true,
    items,
    meta: { source: srcId, count, center, axis, radius, startAngle, sweep, rotate, angles },
  };
}

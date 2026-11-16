/**
 * 立体画板「多对象对齐 / 沿轴等距分布」命令的纯函数语义层（2026-11-17 D13 增量）
 *
 * 与 js/board3d-measure.js / -transform.js / -duplicate.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「把这几个球的底部对齐」「把这排柱子居中」「把 5 个点沿 X 均匀排开」
 * 这类意图，从「当前画板状态」里读出多个对象在指定轴上的**当前真实坐标**，
 * 按 min / max / center 求绝对目标（或按当前坐标顺序等距重排），产出可直接交给
 * board3dApi.update(id, patch) 的 patch 列表。执行器负责逐项调用 update。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - transform3d：按**相对增量**平移 / 旋转 / 缩放，AI 需自己知道每个对象要挪多少；
 *   - duplicate3d / radial3d / mirror3d / grid3d：**新建**副本（对象数会变多）；
 *   - align3d：**只改已存在对象**某一轴的绝对坐标，对象数不变，目标值由画板按全体
 *     当前坐标算（min/max/中值 / 区间等距），AI 不必自己读出并计算坐标。
 */

/** 一条 align3d 命令最多允许对齐的对象数（防止一次命令刷屏 / 死循环） */
export const ALIGN3D_MAX_IDS = 32;

/** 可选轴白名单（与世界坐标 X/Y/Z 一一对应） */
export const ALIGN3D_AXES = Object.freeze(['x', 'y', 'z']);

/** 对齐 / 分布模式白名单 */
export const ALIGN3D_MODES = Object.freeze(['min', 'max', 'center', 'distribute']);

/** 坐标钳制上限（与 js/board3d-duplicate.js / -geometry.js 的 COORD_LIMIT 一致） */
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

/** 对象当前 pos 的完整三元组（只读；缺项 / 脏值回落 0，全部钳制到 ±COORD_LIMIT） */
function basePos3(o) {
  const p = Array.isArray(o && o.pos) && o.pos.length === 3 ? o.pos : [0, 0, 0];
  return [0, 1, 2].map((k) => {
    const n = num(p[k]);
    return n === null ? 0 : clamp(n);
  });
}

/**
 * 解析一条 align3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"align3d","ids":["a","b","c"],"axis":"x","mode":"min"}
 *   {"op":"align3d","ids":["a","b","c"],"axis":"y","mode":"center","to":0}
 *   {"op":"align3d","ids":["a","b","c","d"],"axis":"z","mode":"distribute","start":-3,"end":3}
 *   - ids   必填，2~32 个互不重复、且已存在于当前场景的对象 id（对齐至少需要 2 个）；
 *   - axis  可选，'x' / 'y' / 'z'（默认 'x'）；
 *   - mode  可选，'min'（对齐到组内最小坐标）/ 'max'（最大）/ 'center'（(min+max)/2）/ 'distribute'（等距分布），默认 'center'；
 *   - to    可选数值，仅 align 三模式生效：显式指定目标坐标（覆盖 min/max/center 的自动目标）；
 *   - start / end 可选数值，仅 distribute 生效：显式指定分布区间端点（缺省用组内 min/max）。
 *     任一数值参数只要在命令里出现就必须是合法有限数，否则整条原子拒绝。
 *   - distribute 时 to 被忽略；align 时 start/end 被忽略（互不干扰，不误伤 AI 输出）。
 * @param {Object} state 形如 { objects: [...] }，只读
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 *   items 按 ids 原顺序，每项 { id, patch:{ pos:[x,y,z] } }，只改目标轴分量、其余两轴沿用；
 *   全程不修改入参。
 */
export function resolveAlign3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // ---- ids：数组 / 数量 / 合法性 / 去重（任一不满足 → 整条原子拒绝） ----
  if (!Array.isArray(cmd.ids)) return { ok: false, error: 'ids 必须是对象 id 数组' };
  const ids = cmd.ids;
  if (ids.length < 2 || ids.length > ALIGN3D_MAX_IDS) {
    return { ok: false, error: `ids 需要 2~${ALIGN3D_MAX_IDS} 个对象（对齐至少需要 2 个）` };
  }
  for (const id of ids) {
    if (!isId(id)) return { ok: false, error: `非法对象 id：${String(id)}` };
  }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'ids 不能重复' };

  // ---- axis / mode：白名单（非法拒绝，不静默回落） ----
  const axis = cmd.axis === undefined ? 'x' : cmd.axis;
  if (!ALIGN3D_AXES.includes(axis)) {
    return { ok: false, error: `axis 只支持 ${ALIGN3D_AXES.join('/')}` };
  }
  const ai = ALIGN3D_AXES.indexOf(axis);
  const mode = cmd.mode === undefined ? 'center' : cmd.mode;
  if (!ALIGN3D_MODES.includes(mode)) {
    return { ok: false, error: `mode 只支持 ${ALIGN3D_MODES.join('/')}` };
  }

  // ---- 数值参数：只要在命令里出现就必须是合法有限数（脏值一律原子拒绝） ----
  const to = cmd.to === undefined ? null : num(cmd.to);
  if (cmd.to !== undefined && to === null) return { ok: false, error: 'to 必须是数字' };
  const start = cmd.start === undefined ? null : num(cmd.start);
  if (cmd.start !== undefined && start === null) return { ok: false, error: 'start 必须是数字' };
  const end = cmd.end === undefined ? null : num(cmd.end);
  if (cmd.end !== undefined && end === null) return { ok: false, error: 'end 必须是数字' };

  // ---- 从「当前」状态快照按 id 找对象（只读，找不到即整条拒绝） ----
  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  const found = ids.map((id) => objs.find((o) => o && o.id === id));
  const missingIdx = found.findIndex((o) => !o);
  if (missingIdx !== -1) {
    return { ok: false, error: `要对齐的对象 id 不存在：${String(ids[missingIdx])}` };
  }

  const basePos = found.map(basePos3);
  const coords = basePos.map((p) => p[ai]);
  const lo = Math.min(...coords);
  const hi = Math.max(...coords);

  let targets;
  let meta;
  if (mode === 'distribute') {
    // 端点：显式 start/end 优先，否则保持组内当前 min/max（首尾对象不挪）。
    const a = clamp(start !== null ? start : lo);
    const b = clamp(end !== null ? end : hi);
    // 按「当前坐标升序」稳定排序后等距重排：避免按 ids 给定顺序分配造成交叉 / 重叠。
    // 同坐标时按 ids 原顺序，保证输出确定、与调用顺序无关。
    const order = ids.map((_, i) => i).sort((i, j) => coords[i] - coords[j] || i - j);
    targets = new Array(ids.length);
    order.forEach((origIdx, rank) => {
      targets[origIdx] = clamp(a + (b - a) * rank / (ids.length - 1));
    });
    meta = { axis, mode, start: a, end: b, lo, hi, sortedIds: order.map((i) => ids[i]) };
  } else {
    const natural = mode === 'min' ? lo : mode === 'max' ? hi : (lo + hi) / 2;
    const t = clamp(to !== null ? to : natural);
    targets = ids.map(() => t);
    meta = { axis, mode, target: t, naturalTarget: natural, lo, hi };
  }

  // ---- 生成 patch：只替换目标轴分量，其余两轴沿用对象当前值，输出全新数组 ----
  const items = ids.map((id, i) => {
    const pos = basePos[i].slice();
    pos[ai] = targets[i];
    return { id, patch: { pos } };
  });

  return {
    ok: true,
    items,
    meta: { ...meta, ids: ids.slice(), targets: targets.slice(), positions: items.map((it) => it.patch.pos.slice()) },
  };
}

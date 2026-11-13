/**
 * 立体画板 3D 空间量测纯函数层（路线B · 2026-11-14 增量）
 *
 * 与 js/board3d-geometry.js / -drag.js / -view.js 同口径：
 *   - 不 import three、不碰 DOM，纯函数，可在 Node 无头环境直接回归；
 *   - measure3d 命令的全部量测语义收敛在这里，执行器只负责读状态与调度；
 *   - 只读：任何情况下都不修改入参（cmd / state / objects）；
 *   - 脏输入一律返回 { ok:false, error }，绝不把 NaN / Infinity 传给画板或 LLM。
 *
 * 量测种类（MEASURE3D_KINDS）：
 *   distance  两点（对象中心 / 标注锚点 / 显式坐标）之间的欧氏距离
 *   angle     三点夹角 ∠from-vertex-to，单位「度」，范围 [0,180]
 *   midpoint  两点中点坐标 [x,y,z]
 *
 * 点的写法（两种等价）：
 *   {"kind":"distance","from":"A","to":"B"}           引用场景里已存在的对象 id（含 label3d 锚点）
 *   {"kind":"distance","points":[[0,0,0],[1,1,1]]}   直接给坐标
 */

/** 量测种类白名单（与 ai/board-prompt.js 追加段、js/board3d-executor.js 保持一致） */
export const MEASURE3D_KINDS = Object.freeze(['distance', 'angle', 'midpoint']);

/** id 格式与 js/board3d-executor.js 的 isId 保持一致 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 退化阈值：夹角任一边短于此值视为零向量，拒绝计算（避免 0/0 产生 NaN） */
const ZERO_EPS = 1e-9;

/* ---------------- 基础向量工具（全部纯函数） ---------------- */

/** 严格数值化：有限数字或可解析的数字字符串，其余（表达式/null/''/数组/对象）一律拒绝 */
function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 解析三维点：长度 3 且三个分量都有限才返回新数组，否则 null */
export function toVec3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out : null;
}

/** 点积 */
export function dot3D(a, b) {
  const p = toVec3(a), q = toVec3(b);
  if (!p || !q) return null;
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
}

/** 向量长度 */
export function norm3D(a) {
  const p = toVec3(a);
  if (!p) return null;
  return Math.hypot(p[0], p[1], p[2]);
}

/** 欧氏距离；退化（两点重合）返回 0 而非错误 */
export function distance3D(a, b) {
  const p = toVec3(a), q = toVec3(b);
  if (!p || !q) return null;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** 中点坐标 */
export function midpoint3D(a, b) {
  const p = toVec3(a), q = toVec3(b);
  if (!p || !q) return null;
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
}

/**
 * 三点夹角 ∠(from, vertex, to)，单位「度」，范围 [0,180]。
 * 顶点与任一端点重合（零向量）时返回 null，避免 0/0 产生 NaN。
 */
export function angle3D(vertex, from, to) {
  const v = toVec3(vertex), a = toVec3(from), b = toVec3(to);
  if (!v || !a || !b) return null;
  const u = [a[0] - v[0], a[1] - v[1], a[2] - v[2]];
  const w = [b[0] - v[0], b[1] - v[1], b[2] - v[2]];
  const lu = norm3D(u), lw = norm3D(w);
  if (lu === null || lw === null || lu < ZERO_EPS || lw < ZERO_EPS) return null;
  const d = dot3D(u, w);
  if (d === null) return null;
  // 浮点误差可能让 cos 略越界，钳制后再 acos
  const cos = Math.min(1, Math.max(-1, d / (lu * lw)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 三位小数展示（数值本身不钳制，只规整展示） */
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/* ---------------- 命令 / 状态解析 ---------------- */

/**
 * 取一个点：字符串按 id 查场景对象中心，数组按显式坐标；其余拒绝。
 * @returns {{ok:true,point:number[],label:string}|{ok:false,error:string}}
 */
function resolvePoint(ref, objects, field) {
  if (typeof ref === 'string') {
    if (!ID_RE.test(ref)) return { ok: false, error: `${field} 不是合法对象 id（${ref.slice(0, 30)}）` };
    const o = objects.find((x) => x && x.id === ref);
    if (!o) return { ok: false, error: `${field} 引用的对象 ${ref} 不存在（先用 add3d / label3d 建好，或确认「当前画板对象」）` };
    const p = toVec3(o.pos);
    if (!p) return { ok: false, error: `对象 ${ref} 的 pos 不是合法的三维坐标 [x,y,z]` };
    return { ok: true, point: p, label: ref };
  }
  const p = toVec3(ref);
  if (!p) return { ok: false, error: `${field} 需要是 3 个数字组成的数组 [x,y,z]，或已存在对象的 id` };
  return { ok: true, point: p, label: '' };
}

/** 从命令里取出 2 或 3 个点引用：优先具名字段，其次 points 数组 */
function pointRefs(cmd, kind) {
  const fields = kind === 'angle' ? ['vertex', 'from', 'to'] : ['from', 'to'];
  if (Array.isArray(cmd.points) && cmd.points.length === fields.length) {
    return fields.map((f, i) => ({ field: f, ref: cmd.points[i] }));
  }
  return fields.map((f) => ({ field: f, ref: cmd[f] }));
}

/**
 * 执行一条 measure3d 量测（纯函数、只读、无副作用）。
 * @param {Object} cmd   命令对象 { op:'measure3d', kind, from, to, vertex?, points?, digits? }
 * @param {Object} state 画板状态 { objects:[{id,pos:[x,y,z],...}] }，由执行器用 getState() 注入
 * @returns {{ok:true,kind,value,unit,ids,points,text}|{ok:false,error}}
 */
export function resolveMeasure3D(cmd, state) {
  const c = cmd && typeof cmd === 'object' && !Array.isArray(cmd) ? cmd : {};
  const kind = typeof c.kind === 'string' ? c.kind : '';
  if (!MEASURE3D_KINDS.includes(kind)) {
    return { ok: false, error: `未知量测类型 ${String(kind) || '(空)'}；支持 ${MEASURE3D_KINDS.join(' / ')}` };
  }

  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  const refs = pointRefs(c, kind);
  const got = [];
  for (const { field, ref } of refs) {
    const r = resolvePoint(ref, objs, field);
    if (!r.ok) return { ok: false, error: r.error };
    got.push(r);
  }
  // digits 仅影响展示精度，钳制到 0~6 位，非法值回落 3 位
  const rawDigits = num(c.digits);
  const digits = rawDigits === null ? 3 : Math.min(6, Math.max(0, Math.trunc(rawDigits)));
  const k = Math.pow(10, digits);
  const fmt = (n) => Math.round(n * k) / k;

  const [p0, p1, p2] = got.map((g) => g.point);
  const labels = got.map((g) => g.label);
  const ids = labels.filter(Boolean);
  const points = got.map((g) => g.point.slice());
  const name = (i) => labels[i] || `点${i + 1}`;

  if (kind === 'distance') {
    const d = distance3D(p0, p1);
    if (d === null || !Number.isFinite(d)) return { ok: false, error: '距离计算失败（坐标非法）' };
    const value = fmt(d);
    return {
      ok: true, kind, value, unit: '', ids, points,
      text: `${name(0)} → ${name(1)} 距离 = ${value}`,
    };
  }

  if (kind === 'midpoint') {
    const m = midpoint3D(p0, p1);
    if (!m || m.some((x) => !Number.isFinite(x))) return { ok: false, error: '中点计算失败（坐标非法）' };
    const value = m.map(fmt);
    return {
      ok: true, kind, value, unit: '', ids, points,
      text: `${name(0)} 与 ${name(1)} 的中点 = [${value.join(', ')}]`,
    };
  }

  // angle：p0 = vertex，p1 = from，p2 = to
  const ang = angle3D(p0, p1, p2);
  if (ang === null || !Number.isFinite(ang)) {
    return { ok: false, error: '角度计算失败：顶点与端点重合（零向量）或坐标非法' };
  }
  const value = fmt(ang);
  return {
    ok: true, kind, value, unit: '°', ids, points,
    text: `∠${name(1)}${name(0)}${name(2)} = ${value}°`,
  };
}

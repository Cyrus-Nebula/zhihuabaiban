/**
 * 立体画板 3D 相对变换纯函数层（路线B · 2026-11-15 增量）
 *
 * 与 js/board3d-measure.js / -geometry.js / -drag.js / -view.js 同口径：
 *   - 不 import three、不碰 DOM，纯函数，可在 Node 无头环境直接回归；
 *   - transform3d 的全部语义收敛在这里，执行器只负责读状态与调度；
 *   - 只读：任何情况下都不修改入参（cmd / state / objects），输出全新数组；
 *   - 脏输入一律返回 { ok:false, error }，绝不把 NaN / Infinity / 非法 scale 传给画板或 LLM。
 *
 * 与 update3d 的区别（本命令存在的理由）：
 *   update3d 写「绝对值」，AI 要改一个对象得先读当前 pos/rot/scale 再算目标值，
 *   多轮对话里容易把数值漂移，或覆盖掉用户手动拖拽 / gizmo 调过的结果；
 *   transform3d 写「相对增量」——「向右移 2」「再绕 Y 转 30°」「放大 1.5 倍」
 *   直接给增量，由画板按当前真实状态算出目标值。
 *
 * 三种增量字段（至少一个）：
 *   translate:[dx,dy,dz]  位置增量 → pos = pos + d，钳制 ±COORD_LIMIT
 *   rotate:[dx,dy,dz]     旋转增量（度）→ rot = rot + d，钳制 ±ROT_LIMIT
 *   scale:[sx,sy,sz]      缩放倍率（必须 > 0）→ scale = scale * s，钳制 [SCALE_MIN, SCALE_MAX]
 *
 * 逐帧动画插值需真实 WebGL 渲染层参与，本轮只落地可无头验证的「相对变换」核心
 * （按 docs/3D画板回归用例清单.md 的 A9 口径，像素 / 动画目视留待有 GPU 环境）。
 */

/** 增量字段白名单（顺序即结果 fields 的顺序） */
export const TRANSFORM3D_FIELDS = Object.freeze(['translate', 'rotate', 'scale']);

/** 与 js/board3d-gizmo.js / -settings.js 的 SCALE_MIN 保持一致 */
export const TRANSFORM3D_SCALE_MIN = 0.05;
export const TRANSFORM3D_SCALE_MAX = 100;
/** 与 js/board3d-geometry.js 的 COORD_LIMIT 保持一致 */
export const TRANSFORM3D_COORD_LIMIT = 10000;
/** 旋转角度允许累加，但防止无限累加溢出 */
export const TRANSFORM3D_ROT_LIMIT = 1e6;

/** id 格式与 js/board3d-executor.js 的 isId 保持一致 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* ---------------- 基础工具（全部纯函数） ---------------- */

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组/对象）一律拒绝 */
function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 解析三元组：长度必须为 3 且三个分量都是有限数值，否则 null（返回全新数组） */
function vec3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out : null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 从场景对象读当前三元组；缺失 / 脏值一律回落默认，绝不把 NaN 带入运算 */
function currentTriple(obj, key, def) {
  return vec3(obj && obj[key]) || def.slice();
}

/** 解析并校验命令里的增量字段 */
function parseDeltas(cmd) {
  const vals = {};
  const fields = [];
  for (const f of TRANSFORM3D_FIELDS) {
    if (cmd[f] === undefined) continue;
    const v = vec3(cmd[f]);
    if (!v) return { error: `${f} 必须是三个有限数值组成的数组 [x,y,z]` };
    // 负 / 零缩放倍率没有几何意义，且会让 mesh 翻面或退化，明确拒绝而非静默钳制
    if (f === 'scale' && v.some((x) => x <= 0)) {
      return { error: 'scale 倍率必须为正数（每个分量都要 > 0）' };
    }
    vals[f] = v;
    fields.push(f);
  }
  if (!fields.length) {
    return { error: '没有可变换的字段（translate / rotate / scale 至少给一个）' };
  }
  return { fields, vals };
}

/**
 * 把 transform3d 命令解析成 executor 可直接交给 api.update() 的 patch。
 *
 * @param {Object} cmd    { op:'transform3d', id, translate?, rotate?, scale? }
 * @param {Object} state  { objects:[{ id, pos, rot, scale, ... }] }（board3dApi.getState() 形状）
 * @returns {{ok:true, id, patch:{pos?,rot?,scale?}, fields:string[]} | {ok:false, error:string}}
 */
export function resolveTransform3D(cmd, state) {
  const c = cmd && typeof cmd === 'object' && !Array.isArray(cmd) ? cmd : {};
  if (typeof c.id !== 'string' || !ID_RE.test(c.id)) {
    return { ok: false, error: '要变换的对象 id 非法' };
  }
  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  const obj = objs.find((o) => o && o.id === c.id);
  if (!obj) return { ok: false, error: '要变换的对象 id 不存在' };

  const parsed = parseDeltas(c);
  if (parsed.error) return { ok: false, error: parsed.error };

  const patch = {};
  if (parsed.vals.translate) {
    const cur = currentTriple(obj, 'pos', [0, 0, 0]);
    patch.pos = cur.map((x, i) => clamp(x + parsed.vals.translate[i],
      -TRANSFORM3D_COORD_LIMIT, TRANSFORM3D_COORD_LIMIT));
  }
  if (parsed.vals.rotate) {
    const cur = currentTriple(obj, 'rot', [0, 0, 0]);
    patch.rot = cur.map((x, i) => clamp(x + parsed.vals.rotate[i],
      -TRANSFORM3D_ROT_LIMIT, TRANSFORM3D_ROT_LIMIT));
  }
  if (parsed.vals.scale) {
    const cur = currentTriple(obj, 'scale', [1, 1, 1]);
    patch.scale = cur.map((x, i) => clamp(x * parsed.vals.scale[i],
      TRANSFORM3D_SCALE_MIN, TRANSFORM3D_SCALE_MAX));
  }
  return { ok: true, id: c.id, patch, fields: parsed.fields.slice() };
}

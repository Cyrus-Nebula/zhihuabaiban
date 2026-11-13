/**
 * 立体画板「TransformControls gizmo 交互」纯函数层（回归清单 C4）。
 *
 * 与 js/board3d-view.js / -drag.js / -geometry.js / -settings.js / -axis.js 同口径：
 * 不 import three、不碰 DOM，只把「gizmo 事件 / mesh 变换」转换为「模型状态与 UI 决策」，
 * 由 js/board3d.js 把结果套到真实 TransformControls / OrbitControls / THREE.Mesh 上。
 *
 * 抽成纯函数的目的：让「移动 / 旋转 / 缩放三种模式切换」「拖拽期间 orbit 临时禁用」
 * 「gizmo 变换写回 obj（供保存 / 导出 / 属性面板）」这三件事能被
 * tests/board3d_gizmo.mjs 无头断言锁定，避免内核重构把 C4 打回原形。
 * 像素级目视仍按 A9 口径待 GPU 环境。
 *
 * 本层同时补齐几处运行时健壮性（正常操作下与既有行为逐值等价）：
 *   - Three.js r160 的 setMode() 不校验入参，非法模式会让 gizmo picker 取到 undefined；
 *   - gizmo scale 可把物体缩到 0 / 负值，写回模型时需与属性面板的 0.05 下限对齐；
 *   - 点拖拽（C3）会话期间若收到 gizmo 的 dragging-changed，不能提前恢复 orbit。
 */

/** 三种 gizmo 模式，与 board3d.html #gizmoModes button[data-mode] 逐项一致。 */
export const GIZMO_MODES = ['translate', 'rotate', 'scale'];

/** 初始 / 非法输入回落模式。 */
export const DEFAULT_GIZMO_MODE = 'translate';

/** scale 下限，与 js/board3d-settings.js 的 resolveInspectorField('scale') 一致。 */
export const SCALE_MIN = 0.05;

/** 弧度 → 角度；js/board3d.js 的 DEG 为 Math.PI/180，写回时传 1 / DEG。 */
export const RAD_TO_DEG = 180 / Math.PI;

const AXES = ['x', 'y', 'z'];
const SCALE_DEFAULT = 1;

/**
 * 模式白名单。非法 / 脏输入（undefined / null / 数字 / 未知字符串）一律回落 translate，
 * 防止把坏值直接喂给 TransformControls.setMode()。
 * @param {*} raw 按钮 data-mode 或任意外部输入
 * @returns {'translate'|'rotate'|'scale'}
 */
export function normalizeGizmoMode(raw) {
  return typeof raw === 'string' && GIZMO_MODES.includes(raw) ? raw : DEFAULT_GIZMO_MODE;
}

/**
 * gizmo 按钮高亮状态（纯数据，UI 层只负责 classList.toggle）。
 * @param {*} active 当前模式
 * @returns {{translate:boolean, rotate:boolean, scale:boolean}}
 */
export function gizmoModeState(active) {
  const cur = normalizeGizmoMode(active);
  const out = {};
  for (const m of GIZMO_MODES) out[m] = m === cur;
  return out;
}

/**
 * C4：拖拽期间 orbit 互斥决策（TransformControls 'dragging-changed' 的 e.value）。
 * @param {*} dragging true=开始拖拽 / false=结束拖拽
 * @param {boolean} [pointDragging] 是否正处于「点拖拽」（C3）会话中
 * @returns {boolean} orbit.enabled 应设为的值
 *
 * 点拖拽优先级更高：其会话自身会把 orbit 禁用并在结束时恢复，若 gizmo 在此期间
 * 发来 dragging=false，不能把 orbit 提前打开，否则「拖点」与「转视角」会同时生效。
 */
export function orbitEnabledOnGizmoDrag(dragging, pointDragging = false) {
  if (pointDragging) return false;
  return !dragging;
}

/**
 * 是否抑制画布拾取 / 点拖拽：gizmo 正握着某个轴或正在拖拽时，
 * pointerdown / pointerup 不应触发选中或点拖拽，避免「拖 gizmo 顺手移动了物体」。
 * @param {*} gizmoActive transform.axis 是否非空
 * @param {*} dragging transform.dragging
 */
export function shouldSuppressPick(gizmoActive, dragging) {
  return !!gizmoActive || !!dragging;
}

/**
 * 读一组三分量：支持 THREE.Vector3 / Euler（{x,y,z}）与数组两种形态。
 * 非有限分量先回落到 fallback 对应分量，再回落到 defaultValue。
 * @returns {number[]} 长度 3 的有限数值数组
 */
function readVec3(src, fallback, defaultValue, map) {
  const out = [];
  const fallbackAt = (i) => {
    const v = Array.isArray(fallback) ? fallback[i] : (fallback && fallback[AXES[i]]);
    return Number.isFinite(v) ? v : defaultValue;
  };
  for (let i = 0; i < 3; i++) {
    const raw = Array.isArray(src) ? src[i] : (src && typeof src === 'object' ? src[AXES[i]] : undefined);
    // 只有 number / 非空字符串才视为有效输入；null / undefined / 空串 / 对象一律回落
    const n = typeof raw === 'number' ? raw
      : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (!Number.isFinite(n)) {
      // fallback 已是「模型单位」（角度 / 世界坐标 / 缩放倍数），不能再套弧度换算
      out.push(fallbackAt(i));
    } else {
      out.push(map ? map(n) : n);
    }
  }
  return out;
}

/**
 * C4：从 gizmo 变换后的 mesh 读出「模型状态补丁」。
 *
 * @param {*} mesh THREE.Mesh（只需 position / rotation / scale 三个 {x,y,z} 分量）
 * @param {object} [options]
 * @param {string} [options.mode] 'translate'|'rotate'|'scale'；其它值（含缺省）= 全量写回
 * @param {object} [options.fallback] 旧模型 {pos, rot, scale}，非有限分量的回落来源
 * @param {number} [options.radiansToDegrees] 弧度→角度系数，默认 180/Math.PI
 * @returns {{pos?:number[], rot?:number[], scale?:number[], clamped:boolean}}
 *
 * 按模式限定字段是 TransformControls 的语义：translate 只动 position、rotate 只动
 * rotation、scale 只动 scale；全量模式用于保存 / 导出前的 syncAllFromMeshes()。
 * 数值上与既有 writeObjFromMesh 逐值等价，额外获得脏输入防护与 scale 下限钳制。
 */
export function meshTransformPatch(mesh, options = {}) {
  const opt = options || {};
  const m = GIZMO_MODES.includes(opt.mode) ? opt.mode : 'all';
  const k = Number.isFinite(opt.radiansToDegrees) ? opt.radiansToDegrees : RAD_TO_DEG;
  const fb = opt.fallback || null;
  const patch = { clamped: false };

  if (m === 'all' || m === 'translate') {
    patch.pos = readVec3(mesh && mesh.position, fb && fb.pos, 0);
  }
  if (m === 'all' || m === 'rotate') {
    patch.rot = readVec3(mesh && mesh.rotation, fb && fb.rot, 0, (n) => n * k);
  }
  if (m === 'all' || m === 'scale') {
    const raw = readVec3(mesh && mesh.scale, fb && fb.scale, SCALE_DEFAULT);
    patch.scale = raw.map((v) => {
      const c = Math.max(SCALE_MIN, v);
      if (c !== v) patch.clamped = true;
      return c;
    });
  }
  return patch;
}

/**
 * 把补丁写回模型对象（原地修改 obj，与既有 writeObjFromMesh 的语义一致）。
 * clamped 为 true 时调用方需把钳制后的 scale 同步回 mesh，避免模型与画面不一致。
 * @returns {string[]} 实际写入的字段名
 */
export function applyTransformPatch(obj, patch) {
  if (!obj || !patch) return [];
  const keys = [];
  for (const key of ['pos', 'rot', 'scale']) {
    if (Array.isArray(patch[key])) { obj[key] = patch[key]; keys.push(key); }
  }
  return keys;
}

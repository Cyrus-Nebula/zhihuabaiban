/**
 * 立体画板「用户设置 / 属性面板输入」纯函数层（回归清单 C5 / C6）。
 *
 * 与 js/board3d-view.js / -drag.js / -geometry.js / -axis.js 同口径：
 * 不 import three、不碰 DOM，只把"用户 UI 输入"转换为"模型状态"，
 * 由 js/board3d.js 把结果套到真实 THREE 对象 / DOM 上。
 *
 * 抽成纯函数的目的：让"属性面板编辑（C5）"与"坐标轴 / 网格 / 背景切换（C6）"的
 * 校验 / 钳制口径能被 tests/board3d_settings.mjs 无头断言锁定，
 * 避免内核重构把已修好的输入行为打回原形。像素级目视仍按 A9 口径待 GPU 环境。
 */

/** 背景可选值（与 BG_COLORS / BG_CSS / board3d.html 的 bg-swatch 数据集一致）。 */
export const BG_KEYS = ['white', 'beige', 'dark'];

/**
 * C6：视图设置合并。
 * patch 中非法 bg 被忽略（沿用旧值），axes / grid 仅需为布尔。
 * 返回新对象，绝不修改入参 `prev`。与 setView() → applyView() 行为对齐。
 * @param {{bg?:string, axes?:boolean, grid?:boolean}} prev 当前设置
 * @param {{bg?:string, axes?:boolean, grid?:boolean}} [patch] 本次增量
 * @returns {{bg:string, axes:boolean, grid:boolean}} 合并后的新设置
 */
export function resolveViewSettings(prev, patch) {
  const next = {
    bg: prev && BG_KEYS.includes(prev.bg) ? prev.bg : 'white',
    axes: !!(prev && prev.axes),
    grid: !!(prev && prev.grid),
  };
  if (patch && typeof patch === 'object') {
    if (typeof patch.bg === 'string' && BG_KEYS.includes(patch.bg)) next.bg = patch.bg;
    if (typeof patch.axes === 'boolean') next.axes = patch.axes;
    if (typeof patch.grid === 'boolean') next.grid = patch.grid;
  }
  return next;
}

/**
 * C5：属性面板单字段编辑结果。返回该字段经校验 / 钳制后的新值（不改入参）。
 * @param {'pos'|'rot'|'scale'|'color'|'opacity'|'text'} field 字段名
 * @param {number|undefined} index pos/rot/scale 数组下标，其余传 undefined
 * @param {string|number} raw 输入框原始值（字符串或数字）
 *
 * 口径与 onInspectorInput() 严格对齐：
 *   - 数值型（pos/rot/opacity）统一经 parseFloat；
 *   - scale 下限 0.05（与 onInspectorInput 的 Math.max(0.05, v) 一致）；
 *   - opacity 与原逻辑一致——不做 [0,1] 钳制（由材质层兜底）；
 *   - color / text 为字符串透传。
 *
 * 注意：pos/rot/scale 的"非有限值早期返回（不改模型）"由调用方（onInspectorInput）
 * 保留；本函数只在输入已是有限数值时参与钳制，保证与既有运行时行为逐字节一致。
 */
export function resolveInspectorField(field, index, raw) {
  switch (field) {
    case 'pos':
    case 'rot':
    case 'opacity':
      return parseFloat(raw);
    case 'scale':
      return Math.max(0.05, parseFloat(raw));
    case 'color':
    case 'text':
      return raw == null ? '' : String(raw);
    default:
      return raw;
  }
}

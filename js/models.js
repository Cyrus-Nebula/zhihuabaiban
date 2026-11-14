/**
 * 前端免费模型清单（经典脚本，挂 window.DAJIAO_MODELS）
 * 与 ai/models.js（后端白名单）保持一致，改一边记得同步另一边。
 *
 * vision: true 的模型才显示「📷 图片」上传按钮（看图复原几何图形）。
 * 生成模型单独挂 window.DAJIAO_GENERATION_MODELS，不进作图下拉框——
 * 它们走的是文生图 / 文生视频端点，不是对话端点。
 */
window.DAJIAO_MODELS = [
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash（推荐）', vision: false },
  { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash', vision: false },
  { id: 'glm-4-flash-250414', name: 'GLM-4-Flash-250414', vision: false },
  { id: 'glm-4-flash', name: 'GLM-4-Flash（旧版兼容）', vision: false },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash（视觉·看图复原）', vision: true },
  { id: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V-Thinking-Flash（视觉）', vision: true },
  // 16K 短上下文；后端 ai/board-backend.js 会按 maxInputTokens 裁剪输入
  { id: 'glm-4v-flash', name: 'GLM-4V-Flash（视觉）', vision: true, maxInputTokens: 16384 },
];
window.DAJIAO_DEFAULT_MODEL = 'glm-4.7-flash';

window.DAJIAO_GENERATION_MODELS = [
  { id: 'cogview-3-flash', name: 'CogView-3-Flash（文生图）', kind: 'image', async: false },
  { id: 'cogvideox-flash', name: 'CogVideoX-Flash（文生视频）', kind: 'video', async: true },
];
window.DAJIAO_DEFAULT_GENERATION_MODEL = 'cogview-3-flash';

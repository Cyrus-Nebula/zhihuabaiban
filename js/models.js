/**
 * 前端免费模型清单（经典脚本，挂 window.DAJIAO_MODELS）
 * 与 ai/models.js（后端白名单）保持一致，改一边记得同步另一边。
 *
 * vision: true 的模型才显示「📷 图片」上传按钮（GLM-4.6V-Flash 看图复原）。
 */
window.DAJIAO_MODELS = [
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash（推荐）', vision: false },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash（视觉·看图复原）', vision: true },
  { id: 'glm-4-flash-250414', name: 'GLM-4-Flash-250414', vision: false },
  { id: 'glm-4-flash', name: 'GLM-4-Flash', vision: false },
];
window.DAJIAO_DEFAULT_MODEL = 'glm-4.7-flash';

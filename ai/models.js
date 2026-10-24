/**
 * 免费模型清单（智谱 · 普惠免费档）——后端唯一来源
 * 与 js/models.js（前端下拉框）保持一致，改一边记得同步另一边。
 *
 * 免费档限制：并发 1 个请求；一个 API Key 通用所有模型。
 * 说明：
 *   - glm-4.7-flash    文本，200K 上下文，最新最强，默认用它
 *   - glm-4.6v-flash   视觉多模态，128K，支持看图输入（前端可上传图片）
 *   - glm-4-flash-250414 / glm-4-flash  旧版文本模型，留着兼容
 *   - cogview-3-flash 是文生图模型（另一个端点 /v1/images/generations），
 *     不走对话命令链路，故不在本清单中。
 */
export const FREE_MODELS = [
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash（推荐）', vision: false },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash（视觉·看图复原）', vision: true },
  { id: 'glm-4-flash-250414', name: 'GLM-4-Flash-250414', vision: false },
  { id: 'glm-4-flash', name: 'GLM-4-Flash', vision: false },
];

export const DEFAULT_MODEL = 'glm-4.7-flash';

export function findModel(id) {
  return FREE_MODELS.find((m) => m.id === id) || null;
}

export function supportsVision(id) {
  const m = findModel(id);
  return !!(m && m.vision);
}

// 前端传来的 model 只接受白名单内的 id；非法值返回 null，由调用方回退默认模型
export function resolveModel(requested) {
  if (typeof requested !== 'string') return null;
  const id = requested.trim();
  return findModel(id) ? id : null;
}

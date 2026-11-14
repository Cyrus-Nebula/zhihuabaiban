/**
 * 免费模型清单（智谱 · 普惠免费档）——后端唯一来源
 * 与 js/models.js（前端下拉框）保持一致，改一边记得同步另一边。
 *
 * 免费档限制：并发 1 个请求；一个 API Key 通用所有模型。
 *
 * 分两类，端点与协议不同，不能混用：
 *   A. 对话模型 FREE_MODELS —— 走 {baseUrl}/chat/completions，
 *      供首页 / 2D 画板 / SDK 编辑器 / 3D 画板的作图与查询链路使用。
 *   B. 生成模型 GENERATION_MODELS —— 走独立的文生图 / 文生视频端点，
 *      由 ai/generate-backend.js 单独封装，绝不塞进对话下拉框
 *      （塞进去会 404 / 400，且返回结构完全不同）。
 *
 * vision: true 表示可接收图片输入（前端据此显示上传按钮）。
 */
export const FREE_MODELS = [
  { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash（推荐）', vision: false },
  { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash', vision: false },
  { id: 'glm-4-flash-250414', name: 'GLM-4-Flash-250414', vision: false },
  { id: 'glm-4-flash', name: 'GLM-4-Flash（旧版兼容）', vision: false },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V-Flash（视觉·看图复原）', vision: true },
  { id: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V-Thinking-Flash（视觉）', vision: true },
  // GLM-4V-Flash 上下文只有 16K，2D 系统提示词会撑爆；后端按此预算裁剪输入
  { id: 'glm-4v-flash', name: 'GLM-4V-Flash（视觉）', vision: true, maxInputTokens: 16384 },
];

export const DEFAULT_MODEL = 'glm-4.7-flash';

/** 生成模型：kind 决定前端渲染方式；async 决定是否需要轮询 async-result */
export const GENERATION_MODELS = [
  {
    id: 'cogview-3-flash',
    name: 'CogView-3-Flash（文生图）',
    kind: 'image',
    path: '/images/generations',
    async: false,
  },
  {
    id: 'cogvideox-flash',
    name: 'CogVideoX-Flash（文生视频）',
    kind: 'video',
    path: '/videos/generations',
    resultPath: '/async-result/',
    async: true,
  },
];

export const DEFAULT_GENERATION_MODEL = 'cogview-3-flash';

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

export function findGenerationModel(id) {
  return GENERATION_MODELS.find((m) => m.id === id) || null;
}

// 生成模型同样只接受白名单内的 id；非法值返回 null
export function resolveGenerationModel(requested) {
  if (typeof requested !== 'string') return null;
  const id = requested.trim();
  return findGenerationModel(id) ? id : null;
}

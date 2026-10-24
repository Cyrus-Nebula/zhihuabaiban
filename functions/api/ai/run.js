/**
 * Cloudflare Pages Function：免费 AI 入口
 * POST /api/ai/run  ->  ai/ai-backend.js
 *
 * 环境变量（Pages Dashboard -> Settings -> Environment variables）：
 *   LLM_API_KEY   （必填）免费 LLM 的 Key，如智谱 GLM-4-Flash
 *   LLM_BASE_URL  （可选）默认 https://open.bigmodel.cn/api/paas/v4
 *   LLM_MODEL     （可选）默认 glm-4-flash
 */
import { handleAiRun } from '../../../ai/ai-backend.js';

export async function onRequestPost(context) {
  return handleAiRun(context.request, context.env);
}

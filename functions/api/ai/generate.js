/**
 * Cloudflare Pages Function：免费「生成模型」入口
 * POST /api/ai/generate  ->  ai/generate-backend.js
 *
 * 环境变量：
 *   LLM_API_KEY          （必填）与作图链路共用的智谱免费 Key
 *   GENERATION_BASE_URL  （可选）只覆盖生成端点前缀
 *   LLM_BASE_URL         （可选）默认 https://open.bigmodel.cn/api/paas/v4
 *
 * 与 /api/ai/run、/api/ai/board 相互独立，任一改动不影响另外两条链路。
 */
import { handleGenerate } from '../../../ai/generate-backend.js';

export async function onRequestPost(context) {
  return handleGenerate(context.request, context.env);
}

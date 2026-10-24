/**
 * Cloudflare Pages Function：路线B（自建画板）AI 入口
 * POST /api/ai/board  ->  ai/board-backend.js
 *
 * 环境变量同 /api/ai/run（LLM_API_KEY 必填，LLM_BASE_URL / LLM_MODEL 可选）。
 */
import { handleBoardAi } from '../../../ai/board-backend.js';

export async function onRequestPost(context) {
  return handleBoardAi(context.request, context.env);
}

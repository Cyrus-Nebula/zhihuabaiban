/**
 * 全局配置 —— 唯一需要你手动修改的文件
 *
 * 1. appId：打开 https://open.dajiaoai.com/console/dashboard
 *    注册登录 -> 创建应用 -> 复制生成的 appId，填到下面。
 *    本地测试把 localhost 加进控制台白名单；部署后把正式域名加进去。
 *
 * 2. aiEndpoint：我们自己的免费 AI 后端地址（默认同域 /api/ai/run，
 *    由 Cloudflare Pages Functions 提供，LLM Key 只存在服务端环境变量里）。
 *    - 纯本地自用：运行 server/local-proxy.mjs，改成
 *      'http://localhost:8787/api/ai/run'
 *
 * 3. AI 用的是免费 LLM（默认智谱 GLM-4-Flash，可用 Gemini 等替换），
 *    在部署环境变量里配 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL，
 *    详见 README「AI 免费配置」。不需要大角几何的 API Key，不产生任何费用。
 */
window.DAJIAO_CONFIG = {
  // appId：仅路线A的SDK编辑器（3D）需要；路线B自建画板不用它
  appId: 'ZYGKAQXC',

  // 路线A（SDK 编辑器）AI 后端地址（二选一，见 README）
  aiEndpoint: '/api/ai/run',
  // aiEndpoint: 'http://localhost:8787/api/ai/run', // 本地自用模式

  // 路线B（自建画板）AI 后端地址
  boardAiEndpoint: '/api/ai/board',
  // boardAiEndpoint: 'http://localhost:8787/api/ai/board', // 本地自用模式
};

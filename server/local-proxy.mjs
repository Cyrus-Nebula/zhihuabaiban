/**
 * 本地 AI 代理（零依赖，Node.js 18+）——免费 LLM 版
 *
 * 运行：
 *   LLM_API_KEY=你的key node server/local-proxy.mjs
 * 可选：LLM_BASE_URL / LLM_MODEL / PORT（默认 8787）
 *
 * 免费 LLM 示例：
 *   智谱 GLM-4-Flash（默认，免费）:
 *     LLM_API_KEY=xxx node server/local-proxy.mjs
 *   Google Gemini（免费档）:
 *     LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
 *     LLM_MODEL=gemini-2.5-flash LLM_API_KEY=xxx node server/local-proxy.mjs
 *
 * 静态页另起一个端口：
 *   python3 -m http.server 8000
 * 浏览器打开 http://localhost:8000
 * js/config.js 的 aiEndpoint 指向 http://localhost:8787/api/ai/run
 */
import http from 'node:http';
import { handleAiRun } from '../ai/ai-backend.js';
import { handleBoardAi } from '../ai/board-backend.js';

const PORT = Number(process.env.PORT || 8787);

if (!process.env.LLM_API_KEY) {
  console.warn('[local-proxy] 未设置 LLM_API_KEY，AI 功能不可用。');
  console.warn('[local-proxy] 用法：LLM_API_KEY=你的key node server/local-proxy.mjs');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 路由表：/api/ai/run = 路线A（SDK编辑器，SSE流）；/api/ai/board = 路线B（自建画板，JSON）
const ROUTES = {
  '/api/ai/run': handleAiRun,
  '/api/ai/board': handleBoardAi,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const handler = ROUTES[url.pathname];
  if (!handler || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: 'not found, use POST /api/ai/run 或 /api/ai/board' }));
    return;
  }

  try {
    // 收集 body 成 Web Request，复用同一核心
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${url.pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks),
    });
    const response = await handler(request, process.env);
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...CORS,
    });
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (e) {
    console.error('[local-proxy] 处理失败:', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[local-proxy] 免费 AI 代理已启动: http://localhost:${PORT}`);
  console.log(`[local-proxy] 路线A(SDK编辑器): POST /api/ai/run`);
  console.log(`[local-proxy] 路线B(自建画板):  POST /api/ai/board`);
});

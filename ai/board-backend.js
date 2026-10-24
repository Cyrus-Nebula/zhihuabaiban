/**
 * 路线B · 免费 AI 后端核心（Pages Function / 本地 Node 代理共用）
 *
 * 与 ai/ai-backend.js（路线A的 SSE 翻译层）相互独立，互不影响。
 *
 * 流程：
 *   1. 接收画板页发来的 {message, context, history}
 *   2. 调用任意免费 LLM（默认智谱 GLM-4-Flash，OpenAI 兼容协议）
 *   3. 从回复中提取 {"message": "...", "commands": [...]}（围栏/裸JSON万能提取）
 *   4. 返回 {ok, message, commands}
 *
 * 环境变量：
 *   LLM_BASE_URL  默认 https://open.bigmodel.cn/api/paas/v4
 *   LLM_API_KEY   免费 LLM 的 Key（只放服务端）
 *   LLM_MODEL     默认 glm-4-flash
 */

import { BOARD_SYSTEM_PROMPT } from './board-prompt.js';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

/* ---------- 万能 JSON 提取 ---------- */

// 从任意文本中提取第一个完整 JSON 对象（平衡花括号扫描，字符串感知）
function extractJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const cand = s.slice(start, i + 1);
        try { return JSON.parse(cand); } catch (_) { /* 继续找下一个 */ }
      }
    }
  }
  return null;
}

// 提取 message + commands，容错各种模型输出习惯
function extractResult(text) {
  let obj = null;
  try { obj = JSON.parse(String(text).trim()); } catch (_) { /* 非纯 JSON */ }
  if (!obj) obj = extractJsonObject(text);
  if (!obj || typeof obj !== 'object') return null;

  let commands = obj.commands;
  if (!Array.isArray(commands)) {
    // 容忍 {"cmds": [...]} / {"ops": [...]} 等变体
    for (const k of ['cmds', 'ops', 'actions', 'steps']) {
      if (Array.isArray(obj[k])) { commands = obj[k]; break; }
    }
  }
  if (!Array.isArray(commands)) commands = [];
  // 只保留含 op 字段的对象
  commands = commands.filter((c) => c && typeof c === 'object' && typeof c.op === 'string');

  return {
    message: typeof obj.message === 'string' ? obj.message : '',
    commands,
  };
}

/* ---------- 主入口 ---------- */
export async function handleBoardAi(request, env) {
  const cfg = {
    baseUrl: (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || DEFAULT_MODEL,
  };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  if (!cfg.apiKey) {
    return json({ ok: false, error: 'LLM_API_KEY 未配置：请在部署环境变量中填入免费 LLM 的 Key（智谱/GLM、Gemini 等）' }, 500);
  }

  const message = String(payload.message || '').trim();
  if (!message) return json({ ok: false, error: 'message 不能为空' }, 400);

  const messages = [{ role: 'system', content: BOARD_SYSTEM_PROMPT }];
  if (Array.isArray(payload.history)) {
    for (const h of payload.history.slice(-10)) {
      if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
        messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
      }
    }
  }
  const context = payload.context ? `\n\n【当前画板元素】${String(payload.context).slice(0, 1000)}` : '';
  messages.push({ role: 'user', content: message + context });

  // 智谱支持 response_format json_object，能显著提升 JSON 合规率；其他提供商不带该参数
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: false,
  };
  if (/bigmodel\.cn/i.test(cfg.baseUrl)) body.response_format = { type: 'json_object' };

  let upstream;
  try {
    upstream = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json({ ok: false, error: 'LLM 连接失败: ' + e.message }, 502);
  }

  const raw = await upstream.text().catch(() => '');
  if (!upstream.ok) {
    return json({ ok: false, error: `LLM ${upstream.status}: ${raw.slice(0, 300)}` }, 200);
  }

  let content = '';
  try {
    const data = JSON.parse(raw);
    content = data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '')
      : '';
  } catch (_) {
    content = raw; // 某些代理返回纯文本
  }

  const result = extractResult(content);
  if (!result) {
    return json({ ok: false, error: '无法从模型回复中解析出 JSON：' + content.slice(0, 200) }, 200);
  }
  return json({ ok: true, message: result.message, commands: result.commands }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/**
 * 路线B · 免费 AI 后端核心（Pages Function / 本地 Node 代理共用）
 *
 * 与 ai/ai-backend.js（路线A的 SSE 翻译层）相互独立，互不影响。
 *
 * 流程：
 *   1. 接收画板页发来的 {message, context, history, model?, image?}
 *   2. 调用任意免费 LLM（默认智谱 GLM-4.7-Flash，OpenAI 兼容协议）
 *   3. 从回复中提取 {"message": "...", "commands": [...]}（围栏/裸JSON万能提取）
 *   4. 返回 {ok, message, commands}
 *
 * model：前端下拉框可切换（白名单见 ai/models.js），非法值回退默认。
 * image：视觉模型（GLM-4.6V-Flash）可传 dataURL，按 OpenAI 多模态格式发送，
 *        实现"上传图片 -> 按图复原几何图形"；非视觉模型自动忽略图片。
 *
 * 环境变量：
 *   LLM_BASE_URL  默认 https://open.bigmodel.cn/api/paas/v4
 *   LLM_API_KEY   免费 LLM 的 Key（只放服务端）
 *   LLM_MODEL     默认 glm-4.7-flash
 */

import { BOARD_SYSTEM_PROMPT } from './board-prompt.js';
import { DEFAULT_MODEL, resolveModel, supportsVision } from './models.js';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

// 图片 dataURL 长度上限（约 5MB 文件 base64 后的量级），超出直接拒绝
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;

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
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  // 模型优先级：前端下拉框（白名单校验）> 环境变量 LLM_MODEL > 内置默认
  const cfg = {
    baseUrl: (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: resolveModel(payload.model) || env.LLM_MODEL || DEFAULT_MODEL,
  };

  if (!cfg.apiKey) {
    return json({ ok: false, error: 'LLM_API_KEY 未配置：请在部署环境变量中填入免费 LLM 的 Key（智谱/GLM、Gemini 等）' }, 500);
  }

  const message = String(payload.message || '').trim();
  if (!message && !payload.image) return json({ ok: false, error: 'message 不能为空' }, 400);

  // ---- 图片（视觉模型专用）----
  let image = null;
  if (typeof payload.image === 'string' && /^data:image\//i.test(payload.image)) {
    if (payload.image.length > MAX_IMAGE_CHARS) {
      return json({ ok: false, error: '图片太大（上限约 5MB），请压缩后再试' }, 400);
    }
    if (supportsVision(cfg.model)) image = payload.image;
    // 非视觉模型：忽略图片（前端也会隐藏上传按钮，这里兜底）
  }

  const messages = [{ role: 'system', content: BOARD_SYSTEM_PROMPT }];
  if (Array.isArray(payload.history)) {
    for (const h of payload.history.slice(-10)) {
      if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
        // 历史可能是多模态数组，只取文本部分，避免 dataURL 把上下文撑爆
        let c = h.content;
        if (Array.isArray(c)) {
          c = c.map((p) => (p && typeof p === 'object' && p.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
        }
        if (c) messages.push({ role: h.role, content: String(c).slice(0, 2000) });
      }
    }
  }
  const context = payload.context ? `\n\n【当前画板元素】${String(payload.context).slice(0, 1000)}` : '';
  let userText = (message || '请按这张图片复原几何图形') + context;
  if (image) {
    userText += '\n\n【用户上传了图片】请仔细观察图片中的几何图形，按原样用命令复原：先识别元素类型（点/线段/直线/圆/多边形/函数曲线/标注）与相互关系，再输出命令；坐标取近似值即可。';
  } else if (payload.image) {
    userText += '\n\n（注：当前模型不支持图片输入，图片已忽略；请切换到「GLM-4.6V-Flash（视觉·看图复原）」模型后再试）';
  }
  messages.push({
    role: 'user',
    content: image
      ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image } }]
      : userText,
  });

  // 智谱支持 response_format json_object，能显著提升 JSON 合规率；
  // 视觉模型暂不带该参数（保守起见，提取器本身兼容围栏/裸 JSON）
  const body = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: false,
  };
  if (/bigmodel\.cn/i.test(cfg.baseUrl) && !supportsVision(cfg.model)) {
    body.response_format = { type: 'json_object' };
  }

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

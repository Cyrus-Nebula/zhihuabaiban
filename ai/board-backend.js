/**
 * 路线B · 免费 AI 后端核心（Pages Function / 本地 Node 代理共用）
 *
 * 与 ai/ai-backend.js（路线A的 SSE 翻译层）相互独立，互不影响。
 *
 * 流程：
 *   1. 接收画板页发来的 {message, context, history, model?, image?}
 *   2. 调用任意免费 LLM（默认智谱 GLM-4.7-Flash，OpenAI 兼容协议）
 *   3. 从回复中提取 {"message": "...", "commands": [...]}（多层容错：围栏/裸JSON/
 *      多候选/截断修复/命令级打捞，模型输出不完整也尽量救回已完成部分）
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

/* ---------- 万能 JSON 提取（多层容错） ---------- */

// 去掉 markdown 代码围栏（```json ... ``` / ``` ... ```）
function stripFences(text) {
  return String(text || '').replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '');
}

// 清洗字符串字面量里的裸控制字符（JSON.parse 不接受字符串内出现字面 \n \r \t）
function sanitizeControlChars(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (s.charCodeAt(i) < 0x20) continue; // 其他控制字符直接剔除
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

// 修掉 } ] 前面的尾随逗号
function fixTrailingCommas(s) {
  return s.replace(/,\s*([}\]])/g, '$1');
}

// 宽松 parse：先原样，再清洗控制字符 + 修尾随逗号
function tryParseLoose(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { /* 继续 */ }
  try { return JSON.parse(fixTrailingCommas(sanitizeControlChars(s))); } catch (_) { /* 继续 */ }
  return null;
}

// 收集文本中完整配对的 {...} 候选（字符串感知）。
// isGood(cand) 为真的候选整段跳过；不好的候选从起点后一位继续往里扫，
// 这样外层坏了（未转义引号等）也能把内部完整的子对象捞出来。
function collectJsonCandidates(s, isGood) {
  const cands = [];
  const n = s.length;
  const good = typeof isGood === 'function' ? isGood : () => true;
  for (let i = 0; i < n; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < n; j++) {
      const ch = s[j];
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
        if (depth === 0) { end = j; break; }
      }
    }
    if (end > 0) {
      const cand = s.slice(i, end + 1);
      cands.push(cand);
      if (good(cand)) i = end; // 整段跳过，继续找下一个
      // 候选不好：不从 end 跳，从 i+1 继续往里找完整子对象
    }
    // 找不到配对（截断）：同样从 i+1 继续
  }
  return cands;
}

// 截断修复：按扫描结果补齐未闭合的字符串/数组/对象
function repairTruncated(s) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  while (stack.length) {
    const c = stack.pop();
    out += c === '{' ? '}' : ']';
  }
  return out;
}

// 从任意文本里提取 message 字段（字符串感知的懒匹配）
function salvageMessage(s) {
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"'); } catch (_) { return m[1]; }
}

// 点类命令坐标不全的一律丢弃（AI 截断最常见的残缺就是最后一个点缺 x/y）
function commandUsable(c) {
  if (!c || typeof c !== 'object' || typeof c.op !== 'string') return false;
  if ((c.op === 'point' || c.op === 'glider') && !(typeof c.x === 'number' && typeof c.y === 'number')) return false;
  return true;
}

// 提取 message + commands，按容错等级逐层降级：
//   1. 全文直接 parse → 2. 去围栏 → 3. 平衡候选逐个 parse →
//   4. 截断修复 → 5. 命令级打捞（救回多少算多少）
export function extractResult(text) {
  const raw = String(text || '');
  let obj = null;

  obj = tryParseLoose(raw);
  if (!obj) obj = tryParseLoose(stripFences(raw));
  if (!obj) {
    const parses = (c) => tryParseLoose(c) !== null;
    const cand = collectJsonCandidates(raw, parses).find(parses);
    if (cand) obj = tryParseLoose(cand);
  }
  if (!obj) {
    for (const cand of collectJsonCandidates(raw)) {
      obj = tryParseLoose(repairTruncated(cand));
      if (obj) break;
    }
  }
  if (!obj) obj = tryParseLoose(repairTruncated(stripFences(raw)));

  let message = '';
  let commands = null; // null = 没找到 commands 字段
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    message = typeof obj.message === 'string' ? obj.message : '';
    if (Array.isArray(obj.commands)) commands = obj.commands;
    else {
      // 容忍 {"cmds": [...]} / {"ops": [...]} 等变体键
      for (const k of ['cmds', 'ops', 'actions', 'steps']) {
        if (Array.isArray(obj[k])) { commands = obj[k]; break; }
      }
    }
  }

  // 没救到对象，或对象里既无 message 也无 commands → 命令级打捞
  if (!obj || (!message && (!commands || !commands.length))) {
    const salvaged = collectJsonCandidates(stripFences(raw), (c) => {
      const o = tryParseLoose(c);
      return !!o && typeof o.op === 'string';
    })
      .map((cand) => tryParseLoose(cand))
      .filter((o) => o && typeof o.op === 'string');
    if (salvaged.length) {
      commands = salvaged;
      if (!message) message = salvageMessage(raw);
      obj = { message, commands };
    }
  }

  if (!obj || typeof obj !== 'object') return null;
  if (!Array.isArray(commands)) commands = [];
  commands = commands.filter(commandUsable);

  if (!message && !commands.length) return null;
  return { message, commands };
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
  // 个别模型/代理不支持时返回 400，自动去掉该参数重试一次
  const buildBody = (withJsonFormat) => {
    const b = { model: cfg.model, messages, temperature: 0.2, stream: false };
    if (withJsonFormat && /bigmodel\.cn/i.test(cfg.baseUrl)) {
      b.response_format = { type: 'json_object' };
    }
    return b;
  };

  let upstream;
  try {
    upstream = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(buildBody(true)),
    });
    if (upstream.status === 400) {
      const errText = await upstream.clone().text().catch(() => '');
      if (/response_format/i.test(errText)) {
        upstream = await fetch(cfg.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(buildBody(false)),
        });
      }
    }
  } catch (e) {
    return json({ ok: false, error: 'AI 服务连接失败，请稍后重试' }, 502);
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
    // 面向用户的友好提示（原始回复只进服务端日志，不暴露给前端）
    console.error('AI 回复解析失败，原文前 300 字：', content.slice(0, 300));
    return json({ ok: false, error: 'AI 这次没有按格式作答，请重试或换一种描述' }, 200);
  }
  return json({ ok: true, message: result.message, commands: result.commands }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

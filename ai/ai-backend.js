/**
 * 免费 AI 后端核心（三个入口共用：Pages Function / Cloudflare Worker / 本地 Node 代理）
 *
 * 流程：
 *   1. 接收编辑器 AI 面板发来的 payload（OpenAI Responses 风格）
 *   2. 转成 OpenAI Chat Completions 请求，调用任意"免费 LLM"（默认 GLM-4-Flash）
 *   3. 把 LLM 流式输出翻译成编辑器认识的"原始事件流"（raw SSE events）
 *
 * 关键设计——"文本暂存 + 万能命令提取"：
 *   部分免费模型（如 GLM-4-Flash）不触发原生函数调用，会把作图命令写成正文文本：
 *   ```python def algeo_repl(commands=[...]) ``` 伪代码、{"commands": [...]} JSON、
 *   甚至裸命令清单。翻译层对流式文本做暂存判定：一旦出现"命令特征"就停止把文本
 *   显示为聊天内容，收尾时用万能提取器从中抽出命令、转成标准 function_call 事件；
 *   提取不到命令，才把暂存的文本补发为普通聊天。
 *
 * 环境变量：
 *   LLM_BASE_URL  默认 https://open.bigmodel.cn/api/paas/v4 （智谱，OpenAI 兼容）
 *                 备选 Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
 *   LLM_API_KEY   你的 LLM API Key（只放在服务端，不要进前端）
 *   LLM_MODEL     默认 glm-4.7-flash （免费）；Gemini 用 gemini-2.5-flash
 *
 * 前端可在 payload 里带 model 覆盖（白名单见 ai/models.js）：
 *   editor 顶栏下拉框选择，非法值回退环境变量/默认模型。
 */

import { SYSTEM_PROMPT, TOOLS, TOOL_NAME } from './system-prompt.js';
import { DEFAULT_MODEL, resolveModel, supportsVision } from './models.js';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

/* ---------- SSE 帧 ---------- */
function sseFrame(obj) {
  return 'data: ' + JSON.stringify(obj) + '\n\n';
}

function rawEvent(runId, event, data) {
  return sseFrame({ type: 'raw', runId, event, data });
}

function randId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ---------- REPL 命令识别 ---------- */
// 官方 REPL 动词表（来自 dino-algeo Skill 的 repl-commands.md）
const REPL_VERBS =
  'list_slides|new_slide|switch_slide|dup_slide|move_slide|del_slide|snap_point|intersect|undef|rename|label|eval|def|list|clear';
const VERB_RE = new RegExp('^(' + REPL_VERBS + ')\\b');

// 文本"命令特征"——命中即暂停把文本显示为聊天内容（收尾时再判定）
const HINT_RE = new RegExp(
  '```' + // 代码围栏
    '|def\\s+[A-Za-z_]' + // def algeo_repl( / def foo(
    '|"commands"\\s*:' + // JSON 里的 commands 键
    '|^\\s*\\[?\\s*"(?:' + REPL_VERBS + ')\\b' + // JSON 数组以命令动词开头
    '|^\\s*(?:' + REPL_VERBS + ')\\b' + // 行首就是 REPL 动词
    '|\\b(?:Point3D|Segment3D|Line3D|Circle3D|Polygon3D|Point|Segment|Circle|Line|Polygon|Arc|Ray|Angle|Sphere|Cube|Plane3D)\\s*\\(', // 裸构造器调用
  'im'
);

// 提取字符串字面量（双引号或单引号）
function quotedStrings(s) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(
      (m[1] !== undefined ? m[1] : m[2])
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
    );
  }
  return out;
}

// 判断一个字符串是否是合法 REPL 命令（动词开头，或 def/label 赋值形式）
function looksLikeCommand(s) {
  const t = String(s).trim();
  if (!t || t.length > 500) return false;
  if (VERB_RE.test(t)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_.]*\s*:?=/.test(t)) return true; // def A := ... / label A := ...
  return false;
}

function cleanLine(line) {
  return line
    .trim()
    .replace(/\s+--.*$/, '') // 去行尾注释
    .trim();
}

/**
 * 万能命令提取：从模型正文里抽出 REPL 命令数组。
 * 覆盖：任意语言围栏代码块、伪代码 def algeo_repl(commands=[...])、
 *       裸 JSON {"commands": [...]}、裸 ["cmd", ...] 数组、整段即命令清单。
 */
function extractCommands(text) {
  const cmds = [];
  const seen = new Set();
  const add = (c) => {
    const t = cleanLine(c);
    if (t && !seen.has(t)) {
      seen.add(t);
      cmds.push(t);
    }
  };

  // 1) 围栏代码块（任意语言标注，允许未闭合）
  const fenceRe = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let m;
  const blocks = [];
  while ((m = fenceRe.exec(text)) !== null) blocks.push(m[1]);

  for (const b of blocks) {
    if (/algeo_repl|def\s+[A-Za-z_]\w*\s*\(|"commands"\s*:/.test(b)) {
      // 伪代码 / JSON 块：抽出所有"像命令"的字符串
      for (const s of quotedStrings(b)) if (looksLikeCommand(s)) add(s);
    } else {
      // 普通代码块：逐行当命令
      for (const line of b.split('\n')) {
        const t = cleanLine(line);
        if (t && looksLikeCommand(t)) add(t);
      }
    }
  }

  // 2) 围栏之外的伪代码 / JSON
  const noFence = text.replace(/```[^\n]*\n?[\s\S]*?(?:```|$)/g, '\n');
  if (/algeo_repl|def\s+[A-Za-z_]\w*\s*\(/.test(noFence)) {
    for (const s of quotedStrings(noFence)) if (looksLikeCommand(s)) add(s);
  }
  const jsonRe = /"commands"\s*:\s*\[([\s\S]*?)\]/g;
  while ((m = jsonRe.exec(noFence)) !== null) {
    for (const s of quotedStrings(m[1])) if (looksLikeCommand(s)) add(s);
  }
  const arrRe = /\[\s*["']((?:[^"'\\]|\\.)*)["'](?:\s*,\s*["']((?:[^"'\\]|\\.)*)["'])*\s*,?\s*\]/g;
  while ((m = arrRe.exec(noFence)) !== null) {
    for (const s of quotedStrings(m[0])) if (looksLikeCommand(s)) add(s);
  }

  // 3) 去掉围栏后，每一行都是 REPL 命令（模型直接裸写命令清单）
  const lines = noFence
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--') && !l.startsWith('#'));
  if (lines.length && lines.every((l) => VERB_RE.test(l))) {
    for (const l of lines) add(l);
  }

  return cmds;
}

/* ---------- payload -> Chat Completions messages ---------- */
function toChatMessages(payload, vision) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (vision) {
    // 视觉模型：补充图片输入规则（仅在选用视觉模型时附加，对文本模型无影响）
    messages[0].content +=
      '\n\n# 图片输入\n如果用户消息里包含图片，请仔细观察图中的几何图形，用 REPL 命令按原样复原：先识别元素类型与相互关系，再调用 ' +
      TOOL_NAME +
      ' 工具输出命令；坐标取近似值即可。';
  }
  if (payload && typeof payload.instructions === 'string' && payload.instructions.trim()) {
    // 编辑器自带的指令（若有）附在系统提示词后面，不覆盖我们的作图规则
    messages.push({ role: 'system', content: payload.instructions });
  }

  let input = payload && payload.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return messages;
  }
  if (!Array.isArray(input)) return messages;

  let pendingToolCalls = null; // 连续 function_call 合并为一条 assistant 消息

  const flushPending = () => {
    if (pendingToolCalls && pendingToolCalls.length) {
      messages.push({ role: 'assistant', content: '', tool_calls: pendingToolCalls });
    }
    pendingToolCalls = null;
  };

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'function_call') {
      if (!pendingToolCalls) pendingToolCalls = [];
      pendingToolCalls.push({
        id: item.call_id || item.id || randId('call'),
        type: 'function',
        function: { name: item.name || TOOL_NAME, arguments: item.arguments || '' },
      });
      continue;
    }
    if (item.type === 'function_call_output') {
      flushPending();
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: String(item.output ?? '') });
      continue;
    }
    if (item.type === 'reasoning' || item.type === 'image_generation_call') continue;

    // 普通消息（role/content）；content 可能是数组（多模态）
    const role = item.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    flushPending();
    let content = item.content;
    if (Array.isArray(content)) {
      // 视觉模型：保留 text/image_url 两类 parts 原样透传（OpenAI 多模态格式）
      if (vision && content.some((p) => p && typeof p === 'object' && (p.type === 'image_url' || p.type === 'input_image'))) {
        const parts = content
          .filter((p) => p && typeof p === 'object' && (p.type === 'text' || p.type === 'image_url' || p.type === 'input_image'))
          .map((p) => (p.type === 'input_image' ? { type: 'image_url', image_url: { url: p.image_url || p.url || '' } } : p))
          .filter((p) => p.type !== 'image_url' || p.image_url.url);
        if (parts.length) {
          messages.push({ role, content: parts });
          continue;
        }
      }
      content = content
        .map((part) => (part && typeof part === 'object' ? part.text || '' : String(part ?? '')))
        .filter(Boolean)
        .join('\n');
    }
    if (content) messages.push({ role, content: String(content) });
  }
  flushPending();
  return messages;
}

/* ---------- OpenAI Chat Completions SSE -> 编辑器原始事件流 ---------- */
function createTranslatorStream(upstreamBody, runId, respId) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // 文本消息状态
  let textStarted = false;
  let textBuf = ''; // 全部文本（用于命令提取）
  let visibleText = ''; // 已流式显示给用户的文本
  let holding = false; // 是否处于"命令暂存"状态
  const msgId = randId('msg');
  // 工具调用状态（按 index 聚合）
  const toolStates = new Map();
  let outputIndex = 0;
  let usage = null;

  const emitTextStart = () => {
    if (textStarted) return '';
    textStarted = true;
    return (
      rawEvent(runId, 'response.output_item.added', {
        output_index: outputIndex,
        item: { id: msgId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
      }) +
      rawEvent(runId, 'response.content_part.added', {
        item_id: msgId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      })
    );
  };

  const emitTextDelta = (delta) =>
    rawEvent(runId, 'response.output_text.delta', {
      item_id: msgId, output_index: outputIndex, content_index: 0, delta,
    });

  const emitTextEnd = () => {
    if (!textStarted) return '';
    textStarted = false;
    outputIndex += 1;
    return (
      rawEvent(runId, 'response.output_text.done', {
        item_id: msgId, output_index: outputIndex - 1, content_index: 0, text: visibleText,
      }) +
      rawEvent(runId, 'response.content_part.done', {
        item_id: msgId, output_index: outputIndex - 1, content_index: 0,
        part: { type: 'output_text', text: visibleText, annotations: [] },
      }) +
      rawEvent(runId, 'response.output_item.done', {
        output_index: outputIndex - 1,
        item: {
          id: msgId, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: visibleText, annotations: [] }],
        },
      })
    );
  };

  // 把一段文本作为普通聊天消息补发（暂存后未发现命令时使用）
  const flushHeldText = (text) => {
    if (!text) return '';
    visibleText += text;
    return emitTextStart() + emitTextDelta(text) + emitTextEnd();
  };

  // 以 function_call 事件形式发出提取到的命令
  const emitFallbackToolCall = (commands) => {
    if (!commands || !commands.length) return '';
    const itemId = randId('fc');
    const callId = randId('call');
    const args = JSON.stringify({ commands });
    const idx = outputIndex;
    outputIndex += 1;
    return (
      rawEvent(runId, 'response.output_item.added', {
        output_index: idx,
        item: { id: itemId, type: 'function_call', status: 'in_progress', name: TOOL_NAME, call_id: callId, arguments: '' },
      }) +
      rawEvent(runId, 'response.function_call_arguments.delta', { item_id: itemId, output_index: idx, delta: args }) +
      rawEvent(runId, 'response.function_call_arguments.done', { item_id: itemId, output_index: idx, arguments: args }) +
      rawEvent(runId, 'response.output_item.done', {
        output_index: idx,
        item: { id: itemId, type: 'function_call', status: 'completed', name: TOOL_NAME, call_id: callId, arguments: args },
      })
    );
  };

  return new ReadableStream({
    async start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text));
      try {
        send(rawEvent(runId, 'run.created', { run_id: runId, id: runId }));
        send(rawEvent(runId, 'response.created', { response: { id: respId, status: 'in_progress' } }));

        const reader = upstreamBody.getReader();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              let chunk;
              try { chunk = JSON.parse(jsonStr); } catch { continue; }

              if (chunk.usage) usage = chunk.usage;
              const choice = chunk.choices && chunk.choices[0];
              if (!choice) continue;
              const delta = choice.delta || {};

              // ---- 文本（带命令暂存判定）----
              if (typeof delta.content === 'string' && delta.content) {
                textBuf += delta.content;
                if (!holding && HINT_RE.test(textBuf)) {
                  // 从此刻起暂停显示，收尾时判定是命令还是普通文本
                  holding = true;
                }
                if (holding) continue; // 暂存：不发送任何文本事件
                visibleText += delta.content;
                send(emitTextStart());
                send(emitTextDelta(delta.content));
              }

              // ---- 工具调用 ----
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const key = tc.index ?? 0;
                  let st = toolStates.get(key);
                  if (!st) {
                    st = { itemId: tc.id || randId('fc'), callId: tc.id || randId('call'), name: '', args: '', outputIndex: -1 };
                    toolStates.set(key, st);
                  }
                  if (tc.id) st.callId = tc.id;
                  if (tc.function && tc.function.name) st.name = tc.function.name;
                  const frag = tc.function && tc.function.arguments ? tc.function.arguments : '';
                  if (st.outputIndex < 0) {
                    // 首次见到该工具调用：先收尾文本，再开 function_call item
                    send(emitTextEnd());
                    st.outputIndex = outputIndex;
                    outputIndex += 1;
                    send(rawEvent(runId, 'response.output_item.added', {
                      output_index: st.outputIndex,
                      item: { id: st.itemId, type: 'function_call', status: 'in_progress', name: st.name || TOOL_NAME, call_id: st.callId, arguments: '' },
                    }));
                  }
                  if (frag) {
                    st.args += frag;
                    send(rawEvent(runId, 'response.function_call_arguments.delta', {
                      item_id: st.itemId, output_index: st.outputIndex, delta: frag,
                    }));
                  }
                }
              }
            }
          }
        }

        // ---- 收尾 ----
        send(emitTextEnd());

        // 原生工具调用收尾
        let hadTool = false;
        for (const st of toolStates.values()) {
          if (st.outputIndex < 0) continue;
          hadTool = true;
          const args = st.args || '{}';
          send(rawEvent(runId, 'response.function_call_arguments.done', {
            item_id: st.itemId, output_index: st.outputIndex, arguments: args,
          }));
          send(rawEvent(runId, 'response.output_item.done', {
            output_index: st.outputIndex,
            item: { id: st.itemId, type: 'function_call', status: 'completed', name: st.name || TOOL_NAME, call_id: st.callId, arguments: args },
          }));
        }

        // 没有原生工具调用：从正文里万能提取命令（伪代码/JSON/裸命令兜底）
        if (!hadTool) {
          const cmds = extractCommands(textBuf);
          if (cmds.length) {
            send(emitFallbackToolCall(cmds));
          } else if (holding) {
            // 暂存了但没提取到命令：把暂存文本补发为普通聊天
            send(flushHeldText(textBuf.slice(visibleText.length)));
          }
        }

        send(rawEvent(runId, 'response.completed', {
          response: {
            id: respId, status: 'completed',
            output: [], usage: usage || undefined,
          },
        }));
        controller.close();
      } catch (e) {
        try {
          send(rawEvent(runId, 'response.failed', {
            response: { id: respId, status: 'failed', error: { message: String(e && e.message ? e.message : e), code: 'proxy_error' } },
          }));
          controller.close();
        } catch { /* 已关闭 */ }
      }
    },
  });
}

/* ---------- 主入口 ---------- */
export async function handleAiRun(request, env) {
  const cfg = {
    baseUrl: (env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY || '',
  };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json body' }), { status: 400 });
  }

  if (!cfg.apiKey) {
    return new Response(
      JSON.stringify({ error: 'LLM_API_KEY 未配置：请在部署环境变量中填入免费 LLM 的 Key（智谱/GLM、Gemini 等）' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const runId = randId('run');
  const respId = randId('resp');

  // 模型优先级：前端下拉框（白名单校验）> 环境变量 LLM_MODEL > 内置默认
  const model = resolveModel(payload.model) || env.LLM_MODEL || DEFAULT_MODEL;

  let upstream;
  try {
    upstream = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model,
        messages: toChatMessages(payload, supportsVision(model)),
        tools: TOOLS,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.3,
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'LLM 连接失败: ' + e.message }), { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    // 以 SSE 错误事件返回，编辑器面板能直接展示
    const body =
      rawEvent(runId, 'response.failed', {
        response: { id: respId, status: 'failed', error: { message: `LLM ${upstream.status}: ${text.slice(0, 300)}`, code: 'llm_error' } },
      });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  return new Response(createTranslatorStream(upstream.body, runId, respId), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

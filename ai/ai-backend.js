/**
 * 免费 AI 后端核心（三个入口共用：Pages Function / Cloudflare Worker / 本地 Node 代理）
 *
 * 流程：
 *   1. 接收编辑器 AI 面板发来的 payload（OpenAI Responses 风格）
 *   2. 转成 OpenAI Chat Completions 请求，调用任意"免费 LLM"（默认 GLM-4-Flash）
 *   3. 把 LLM 流式输出翻译成编辑器认识的"原始事件流"（raw SSE events）
 *
 * 环境变量：
 *   LLM_BASE_URL  默认 https://open.bigmodel.cn/api/paas/v4 （智谱，OpenAI 兼容）
 *                 备选 Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
 *   LLM_API_KEY   你的 LLM API Key（只放在服务端，不要进前端）
 *   LLM_MODEL     默认 glm-4-flash （免费）；Gemini 用 gemini-2.5-flash
 */

import { SYSTEM_PROMPT, TOOLS, TOOL_NAME } from './system-prompt.js';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

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

/* ---------- payload -> Chat Completions messages ---------- */
function toChatMessages(payload) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
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

    // 普通消息（role/content）；content 可能是数组（多模态），取文本部分
    const role = item.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    flushPending();
    let content = item.content;
    if (Array.isArray(content)) {
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
  let textBuf = '';
  const msgId = randId('msg');
  // 工具调用状态（按 index 聚合）
  const toolStates = new Map();
  let outputIndex = 0;
  let usage = null;

  const emitTextStart = () => {
    if (textStarted) return;
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

  const emitTextEnd = () => {
    if (!textStarted) return '';
    textStarted = false;
    outputIndex += 1;
    return (
      rawEvent(runId, 'response.output_text.done', {
        item_id: msgId, output_index: outputIndex - 1, content_index: 0, text: textBuf,
      }) +
      rawEvent(runId, 'response.content_part.done', {
        item_id: msgId, output_index: outputIndex - 1, content_index: 0,
        part: { type: 'output_text', text: textBuf, annotations: [] },
      }) +
      rawEvent(runId, 'response.output_item.done', {
        output_index: outputIndex - 1,
        item: {
          id: msgId, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: textBuf, annotations: [] }],
        },
      })
    );
  };

  // 从文本里提取 ```repl 代码块作为兜底（模型不支持 function calling 时）
  const emitFallbackToolCall = () => {
    const re = /```(?:repl|algeo|geometry)?\s*\n([\s\S]*?)```/g;
    const commands = [];
    let m;
    while ((m = re.exec(textBuf)) !== null) {
      for (const line of m[1].split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('--')) commands.push(t);
      }
    }
    if (!commands.length) return '';
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

              // ---- 文本 ----
              if (typeof delta.content === 'string' && delta.content) {
                textBuf += delta.content;
                send(emitTextStart());
                send(rawEvent(runId, 'response.output_text.delta', {
                  item_id: msgId, output_index: outputIndex, content_index: 0, delta: delta.content,
                }));
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
        if (!hadTool) send(emitFallbackToolCall());

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
    model: env.LLM_MODEL || DEFAULT_MODEL,
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

  let upstream;
  try {
    upstream = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: toChatMessages(payload),
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

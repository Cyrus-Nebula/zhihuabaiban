/**
 * 免费「生成模型」后端核心（Pages Function / 本地 Node 代理共用）
 *
 * 与 ai/ai-backend.js（路线A SSE）、ai/board-backend.js（路线B JSON）并列，
 * 互不依赖，不改动作图链路的任何一行。
 *
 * 为什么单独一条链路：CogView-3-Flash / CogVideoX-Flash 不是对话模型，
 * 不能发给 /chat/completions；它们各有自己的端点和返回结构：
 *   - 文生图：POST {base}/images/generations   -> 同步返回图片 URL
 *   - 文生视频：POST {base}/videos/generations -> 返回 request_id（异步）
 *               GET  {base}/async-result/{id}  -> 轮询取视频 URL
 *
 * 统一入口 POST /api/ai/generate，用 action 区分：
 *   { action:'create', model, prompt, size? }  -> 发起生成
 *   { action:'query',  model, taskId }         -> 查询异步结果
 *
 * 环境变量：
 *   LLM_API_KEY          必填，与对话链路共用的智谱免费 Key
 *   GENERATION_BASE_URL  可选，覆盖生成端点前缀
 *
 * 注意：生成链路**不复用 LLM_BASE_URL**。对话链路可能被配成 Gemini 兼容端点或
 * 自建中转，把生成请求拼到那个前缀上会落到未知路径（实测返回 405）。
 * 生成端点固定指向智谱 v4，需要改才用 GENERATION_BASE_URL。
 */
import {
  DEFAULT_GENERATION_MODEL,
  GENERATION_MODELS,
  findGenerationModel,
  resolveGenerationModel,
} from './models.js';

const DEFAULT_GENERATION_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const MAX_PROMPT = 2000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** 上游错误转成人话，不把原始 JSON 丢给前端 */
function friendlyError(status, raw) {
  if (status === 429) return 'AI 当前访问量过大（免费档限流），请稍等十几秒再试';
  if (status === 401 || status === 403) return 'API Key 无效或没有该模型权限，请检查部署环境变量';
  let msg = '';
  try {
    const d = JSON.parse(raw);
    msg = (d && (d.error?.message || d.msg || d.message)) || '';
  } catch { /* 纯文本错误，用原文前 200 字 */ }
  return `服务返回 ${status}：${String(msg || raw).slice(0, 200)}`;
}

/** 统一错误出口；upstreamPath 只含路径、不含密钥，便于线上排障 */
function fail(status, raw, url, httpStatus = 200) {
  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { /* 非法 URL 时留空 */ }
  return json({ ok: false, error: friendlyError(status, raw), upstreamPath: pathname }, httpStatus);
}

/** 从多种返回结构里取异步任务号 */
function pickTaskId(data) {
  const keys = ['request_id', 'id', 'task_id', 'taskId'];
  const scan = (o) => {
    if (!o || typeof o !== 'object') return '';
    for (const k of keys) {
      if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
    }
    return '';
  };
  const direct = scan(data);
  if (direct) return direct;
  if (data && data.data && typeof data.data === 'object') return scan(data.data);
  return '';
}

/** 文生图：兼容 {data:[{url}]} / {data:[{b64_json}]} / {url} */
function pickImage(data) {
  const list = [];
  if (data && Array.isArray(data.data)) list.push(...data.data);
  else if (data && data.data && typeof data.data === 'object') list.push(data.data);
  if (data && typeof data.url === 'string') list.push(data);
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    if (typeof it.url === 'string' && it.url) return { url: it.url };
    if (typeof it.b64_json === 'string' && it.b64_json) {
      return { url: 'data:image/png;base64,' + it.b64_json };
    }
  }
  return null;
}

/** 异步视频结果：兼容 video_result / data / videos / 顶层 url 等多种结构 */
function pickVideo(data) {
  const cands = [];
  if (!data || typeof data !== 'object') return null;
  for (const k of ['video_result', 'data', 'videos', 'result', 'output']) {
    const v = data[k];
    if (Array.isArray(v)) cands.push(...v);
    else if (v && typeof v === 'object') cands.push(v);
  }
  cands.push(data);
  let poster = '';
  for (const it of cands) {
    if (!it || typeof it !== 'object') continue;
    if (!poster && typeof it.cover_image_url === 'string') poster = it.cover_image_url;
    for (const k of ['url', 'video_url', 'video']) {
      if (typeof it[k] === 'string' && /^https?:\/\//i.test(it[k])) {
        return { url: it[k], poster };
      }
    }
  }
  return null;
}

/** 把上游各种状态词归一为 pending / done / failed */
function normalizeStatus(data) {
  const raw = String(
    (data && (data.task_status ?? data.status ?? data.state ?? data.taskStatus)) || ''
  ).toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'DONE', 'FINISHED', 'OK'].includes(raw)) return 'done';
  if (['FAIL', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(raw)) return 'failed';
  return 'pending';
}

/* ---------- 主入口 ---------- */
export async function handleGenerate(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  const baseUrl = (env.GENERATION_BASE_URL || DEFAULT_GENERATION_BASE_URL).replace(/\/+$/, '');
  const apiKey = env.LLM_API_KEY || '';
  if (!apiKey) {
    return json({
      ok: false,
      error: 'LLM_API_KEY 未配置：请在部署环境变量中填入智谱免费 Key（生成模型与作图模型共用同一个 Key）',
    }, 500);
  }

  // 模型白名单：显式传了非法值就明确报错，不静默回退（避免用户以为选的模型生效了）
  if (payload.model !== undefined && payload.model !== null && payload.model !== ''
      && !resolveGenerationModel(payload.model)) {
    return json({
      ok: false,
      error: '不支持的生成模型：' + String(payload.model).slice(0, 60)
        + '。可用：' + GENERATION_MODELS.map((m) => m.id).join(' / '),
    }, 400);
  }
  const modelId = resolveGenerationModel(payload.model) || DEFAULT_GENERATION_MODEL;
  const model = findGenerationModel(modelId);
  const action = payload.action === 'query' ? 'query' : 'create';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  };

  /* ---- 查询异步视频结果 ---- */
  if (action === 'query') {
    if (!model.async) return json({ ok: false, error: '该模型同步返回结果，无需查询任务' }, 400);
    const taskId = String(payload.taskId || '').trim().slice(0, 200);
    if (!taskId) return json({ ok: false, error: 'taskId 不能为空' }, 400);

    const url = baseUrl + model.resultPath + encodeURIComponent(taskId);
    let r;
    try {
      r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + apiKey },
      });
    } catch {
      return json({ ok: false, error: 'AI 服务连接失败，请稍后重试' }, 502);
    }
    const raw = await r.text().catch(() => '');
    if (!r.ok) return fail(r.status, raw, url);

    let data = {};
    try { data = JSON.parse(raw); } catch { return json({ ok: true, kind: 'video', status: 'pending', message: '结果读取中…' }, 200); }
    const status = normalizeStatus(data);
    const video = pickVideo(data);
    if (status === 'done' && video) {
      return json({ ok: true, kind: 'video', status: 'done', url: video.url, poster: video.poster || '' }, 200);
    }
    if (status === 'done') {
      return json({ ok: true, kind: 'video', status: 'pending', message: '任务已完成，正在取回视频地址…' }, 200);
    }
    if (status === 'failed') return json({ ok: false, error: '生成失败，请调整描述后重试' }, 200);
    return json({ ok: true, kind: 'video', status: 'pending', message: '生成中…' }, 200);
  }

  /* ---- 发起生成 ---- */
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) return json({ ok: false, error: 'prompt 不能为空' }, 400);
  if (prompt.length > MAX_PROMPT) return json({ ok: false, error: `描述太长（上限 ${MAX_PROMPT} 字）` }, 400);

  const body = { model: model.id, prompt };
  if (!model.async) {
    const size = String(payload.size || '').trim();
    if (/^\d{2,4}x\d{2,4}$/.test(size)) body.size = size;
  }

  const url = baseUrl + model.path;
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return json({ ok: false, error: 'AI 服务连接失败，请稍后重试' }, 502);
  }
  const raw = await r.text().catch(() => '');
  if (!r.ok) return fail(r.status, raw, url);

  let data = {};
  try { data = JSON.parse(raw); } catch { return json({ ok: false, error: '上游返回格式异常，请重试' }, 200); }

  if (!model.async) {
    const img = pickImage(data);
    if (!img) return json({ ok: false, error: '生成完成但未取到图片地址，请重试' }, 200);
    return json({ ok: true, kind: 'image', status: 'done', model: model.id, url: img.url }, 200);
  }

  const taskId = pickTaskId(data);
  if (!taskId) return json({ ok: false, error: '已提交但未拿到任务号，请重试' }, 200);
  return json({
    ok: true,
    kind: 'video',
    status: 'pending',
    model: model.id,
    taskId,
    message: '已提交，正在生成视频…',
  }, 200);
}

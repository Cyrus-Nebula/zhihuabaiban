/**
 * 立体画板 AI 面板（路线B · 3D 分支，本轮增量 优先级 3）
 *
 * 与 2D 侧完全平行、互不引用：
 *   - 不 import js/executor.js、不 import js/board.js；
 *   - 命令只经 js/board3d-executor.js 的 applyBoard3DCommands() 执行；
 *   - 固定以 mode:'3d' 调 /api/ai/board，让后端切到 BOARD3D_SYSTEM_PROMPT。
 *
 * 画板副作用全部走 board3dApi（窄接口），本文件只负责面板交互与请求编排。
 */
import { board3dApi } from './board3d.js';
import { applyBoard3DCommands, describeBoard3DState } from './board3d-executor.js';

const CFG = window.DAJIAO_CONFIG || {};
const ENDPOINT = CFG.boardAiEndpoint || '/api/ai/board';

let panel, logEl, inputEl, sendBtn;
const history = [];

const $ = (id) => document.getElementById(id);

function appendLog(role, text) {
  if (!logEl) return;
  const div = document.createElement('div');
  div.className = 'b3d-ai-msg ' + role;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

/** 当前场景摘要，作为「当前画板对象」发给 LLM */
function sceneContext() {
  try { return describeBoard3DState(board3dApi.getState()); }
  catch (_) { return '（场景读取失败）'; }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  if (!board3dApi.isReady()) {
    appendLog('err', '3D 内核未就绪（当前浏览器可能不支持 WebGL），无法执行命令。');
    return;
  }
  appendLog('user', text);
  history.push({ role: 'user', content: text });
  inputEl.value = '';
  sendBtn.disabled = true;
  sendBtn.textContent = '生成中…';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        mode: '3d',
        detect3d: true,
        context: sceneContext(),
        history: history.slice(-10),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);

    // 旧版后端没有 3D 分支时不会返回 mode；有新分支但没切到 3D 属异常，先提示再执行
    if (data.mode && data.mode !== '3d') {
      appendLog('err', `后端按 ${data.mode} 协议应答了，请确认线上 /api/ai/board 已部署 3D 分支。`);
    }

    const cmds = Array.isArray(data.commands) ? data.commands : [];
    if (cmds.length) {
      const results = applyBoard3DCommands(cmds, board3dApi);
      const ok = results.filter((r) => r.ok).length;
      const bad = results.filter((r) => !r.ok);
      let line = `已执行 ${ok}/${results.length} 条 3D 命令`;
      if (bad.length) line += '；失败：' + bad.map((b) => `${b.op || '?'}(${b.error})`).join('、');
      appendLog('ai', line);
      // measure3d 是只读量测命令：把画板按当前场景真实坐标算出的结果逐条展示，
      // 数值以画板返回为准，避免 LLM 在 message 里凭空估算。
      for (const m of results) {
        if (m.ok && m.op === 'measure3d' && m.text) appendLog('ai', '量测：' + m.text);
      }
    }
    if (data.message) {
      appendLog('ai', data.message);
      history.push({ role: 'assistant', content: data.message });
    }
  } catch (e) {
    appendLog('err', '⚠️ ' + (e && e.message ? e.message : String(e)));
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = '生成';
  }
}

function init() {
  panel = $('b3dAiPanel');
  logEl = $('b3dAiLog');
  inputEl = $('b3dAiInput');
  sendBtn = $('b3dAiSend');
  if (!panel || !logEl || !inputEl || !sendBtn) return;

  const openBtn = $('btn-ai3d');
  if (openBtn) openBtn.addEventListener('click', () => { panel.classList.remove('hidden'); inputEl.focus(); });
  const closeBtn = $('b3dAiClose');
  if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  appendLog('ai', '立体画板 AI 助手已就绪。试试说：「画一个棱长 2 的正方体，标出顶点 A」。');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

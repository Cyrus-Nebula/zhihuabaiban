/**
 * 编辑器页逻辑：
 * - 用 algeo-sdk（ESM CDN）把大角几何编辑器以 iframe 嵌入本页
 * - 打开 / 新建画板；contentChange 自动保存；save 按钮保存
 * - AI 对话：aiRequest -> 本地代理(/api/algeo-ai/chat) -> 大角几何 AI 生图 API
 *   -> SSE 流原样交给 editor.ai.consumeStream()
 */
import { createEditor } from 'https://cdn.jsdelivr.net/npm/@dajiaoai/algeo-sdk@2/dist/algeo-sdk.esm.js';

const CFG = window.DAJIAO_CONFIG || {};
const params = new URLSearchParams(location.search);
const fileId = params.get('id');
const forceMode = params.get('mode'); // 新建时由工作台跳转带入（兜底）
const file = fileId ? Store.get(fileId) : null;

const $ = (id) => document.getElementById(id);
const loadingMask = $('loadingMask');
const errorMask = $('errorMask');
const saveStatus = $('saveStatus');
const aiStatus = $('aiStatus');

// ---------- 模型选择（白名单来自 js/models.js，持久化 localStorage）----------
const MODELS = Array.isArray(window.DAJIAO_MODELS) ? window.DAJIAO_MODELS : [];
const modelSel = $('aiModel');
MODELS.forEach((m) => {
  const opt = document.createElement('option');
  opt.value = m.id;
  opt.textContent = m.name;
  modelSel.appendChild(opt);
});
const savedModel = localStorage.getItem('dajiao-editor-model');
if (savedModel && MODELS.some((m) => m.id === savedModel)) modelSel.value = savedModel;
modelSel.addEventListener('change', () => {
  localStorage.setItem('dajiao-editor-model', modelSel.value);
});

function setSaveStatus(text, cls) {
  saveStatus.innerHTML = `<span class="dot ${cls || ''}"></span> ${text}`;
}

function showError(msg) {
  loadingMask.style.display = 'none';
  $('errorText').textContent = msg;
  errorMask.classList.add('show');
}

// ---------- 标题栏 ----------
const nameInput = $('docName');
nameInput.value = file ? file.name : (forceMode === '3d' ? '立体画板' : '平面画板');
nameInput.addEventListener('change', () => {
  if (file) Store.rename(file.id, nameInput.value);
});
$('btnBack').addEventListener('click', () => { location.href = 'index.html'; });

// ---------- 配置检查 ----------
if (!CFG.appId || CFG.appId === 'YOUR_APP_ID') {
  showError('js/config.js 中还没有配置有效的 appId。');
}

// ---------- 创建编辑器 ----------
async function boot() {
  if (!CFG.appId || CFG.appId === 'YOUR_APP_ID') return; // 已在上面提示

  const options = {
    auth: { appId: CFG.appId },
    ui: {
      navbar: true,        // 顶部导航
      slidePanel: true,    // 画板列表
      toolboxPanel: true,  // 工具栏
      algebraPanel: true,  // 代数面板
      docPanel: true,      // 文档面板
      helpEntry: true,     // 帮助入口
      aiChatPanel: true,   // AI 对话面板（必须保留的功能）
    },
  };

  // 打开已有文件：注入工程数据；否则按 2D/3D 建空白画板
  if (file && file.content) {
    options.initialContent = file.content;
  } else {
    options.initialMode = (file ? file.mode : forceMode) === '3d' ? '3d' : '2d';
  }

  let editor;
  try {
    editor = await createEditor($('editorHost'), options);
  } catch (e) {
    showError('SDK 初始化失败：' + (e && e.message ? e.message : e));
    return;
  }

  loadingMask.style.display = 'none';

  // ---------- 保存：编辑器点保存按钮 ----------
  editor.on('save', async (event) => {
    if (event.stage === 'request' && file) {
      try {
        Store.saveContent(file.id, event.content);
        setSaveStatus('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        return { status: 'success' };
      } catch (e) {
        return { status: 'error', message: '本地存储失败：' + e.message };
      }
    }
  });

  // ---------- 自动保存：内容变化（防抖 1 秒） ----------
  let saveTimer = null;
  editor.on('contentChange', (event) => {
    if (!file || !event.content) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Store.saveContent(file.id, event.content);
      setSaveStatus('已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    }, 1000);
  });

  // ---------- AI 对话：转发到我们自己的免费 AI 后端 ----------
  // 后端用免费 LLM（默认 GLM-4.7-Flash，顶栏可切换）驱动画板，LLM Key 只在服务端，
  // 返回的 SSE 流已被翻译成编辑器认识的标准事件，直接交给 SDK 渲染。
  editor.on('aiRequest', async ({ payload, signal }) => {
    aiStatus.hidden = false;
    setSaveStatus('AI 生成中…', 'busy');
    try {
      const res = await fetch(CFG.aiEndpoint || '/api/ai/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, model: modelSel.value }),
        signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        throw new Error(`AI 服务返回 ${res.status} ${txt.slice(0, 200)}`);
      }
      await editor.ai.consumeStream({ stream: res.body, signal });
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('AI 请求失败', e);
        alert('AI 请求失败：' + e.message + '\n\n请确认：本地模式 node server/local-proxy.mjs 在跑且配了 LLM_API_KEY；线上模式 Pages 环境变量配了 LLM_API_KEY。');
      }
    } finally {
      aiStatus.hidden = true;
      setSaveStatus('就绪');
    }
  });

  editor.on('aiCancel', ({ runId, reason }) => {
    console.log('AI 已取消', runId, reason);
    aiStatus.hidden = true;
    setSaveStatus('AI 已取消');
  });

  setSaveStatus('已就绪');
}

boot();

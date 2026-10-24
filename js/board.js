/**
 * 路线B · 画板页逻辑（JSXGraph 自建引擎）
 *
 * 页面：board.html
 *  - 工具条：选择/点/线段/直线/圆/多边形 + 函数曲线输入
 *  - AI 面板：自然语言 -> ai/board-backend.js 生成命令 -> executor 执行
 *  - 保存：{name, commands, moves} 存 localStorage；打开时重放命令 + 覆盖坐标
 *  - 导出：PNG（SVG 序列化）/ JSON
 *
 * 注意：config.js / store.js 是经典脚本（挂全局），本模块直接用全局绑定，
 * 不做 import；executor.js 是 ES module，正常 import。
 */

import { createExecutor } from './executor.js';

const CFG = window.DAJIAO_CONFIG || {};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const nameInput = $('doc-name');
const saveStatus = $('save-status');
const aiLog = $('ai-log');
const aiInput = $('ai-input');
const toastEl = $('toast');

/* ---------- 画板初始化 ---------- */
const board = JXG.JSXGraph.initBoard('box', {
  boundingbox: [-10, 10, 10, -10],
  axis: true,
  grid: true,
  showCopyright: false,
  showNavigation: false,
  zoom: { wheel: true, needshift: false },
  pan: { needshift: false },
  keepaspectratio: true,
});

const executor = createExecutor(board);

/* ---------- 文档状态 ---------- */
const urlParams = new URLSearchParams(location.search);
let fileId = urlParams.get('id');
let doc = { name: '未命名画板', commands: [], moves: [] };

if (!fileId) {
  const f = Store.create(doc.name, '2d');
  fileId = f.id;
  history.replaceState(null, '', 'board.html?id=' + fileId);
} else {
  const f = Store.get(fileId);
  if (!f) {
    toast('文件不存在或已删除，即将返回工作台');
    setTimeout(() => (location.href = 'index.html'), 1200);
    throw new Error('file not found');
  }
  // 兼容：路线A的工程文件（slides 结构）在自建画板里打开会空白，跳回 SDK 编辑器
  if (f.content && !Array.isArray(f.content.commands) && (f.content.slides || f.content.objects)) {
    toast('这是路线A的工程文件，正在跳转到 SDK 编辑器打开…');
    setTimeout(() => (location.href = 'editor.html?id=' + encodeURIComponent(fileId)), 1200);
    throw new Error('legacy route-a file');
  }
  doc = { name: f.name, commands: f.content?.commands || [], moves: f.content?.moves || [] };
}
nameInput.value = doc.name;

/* ---------- 工具条 ---------- */
let tool = 'select';
const pending = []; // 多步工具的临时点击
const toolBtns = Array.from(document.querySelectorAll('.tool[data-tool]'));

function setTool(t) {
  tool = t;
  pending.length = 0;
  toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $('btn-poly-done').classList.toggle('hidden', t !== 'polygon');
}
toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('btn-poly-done').addEventListener('click', finishPolygon);

let idSeq = 1;
function nextId(prefix) {
  let id;
  do { id = prefix + idSeq++; } while (executor.has(id) || doc.commands.some((c) => c.id === id));
  return id;
}

/* 屏幕坐标 -> 画板用户坐标 */
function usrCoords(evt) {
  const p = board.getMousePosition(evt);
  const o = board.origin.scrCoords;
  return [Math.round(((p[0] - o[1]) / board.unitX) * 1000) / 1000,
          Math.round(((o[2] - p[1]) / board.unitY) * 1000) / 1000];
}

function pushCmd(cmd) {
  doc.commands.push(cmd);
  const r = executor.execute([cmd]);
  const bad = r.find((x) => !x.ok);
  if (bad) { doc.commands.pop(); toast('命令执行失败：' + bad.error); return null; }
  scheduleSave();
  return cmd;
}

board.on('down', (evt) => {
  if (tool === 'select') return;
  const [x, y] = usrCoords(evt);
  if (tool === 'point') {
    pushCmd({ op: 'point', id: nextId('P'), x, y });
  } else if (tool === 'segment' || tool === 'line') {
    pending.push({ x, y });
    if (pending.length === 2) {
      const a = pending[0], b = pending[1];
      const p1 = nextId('P'), p2 = nextId('P');
      pushCmd({ op: 'point', id: p1, x: a.x, y: a.y });
      pushCmd({ op: 'point', id: p2, x: b.x, y: b.y });
      pushCmd(tool === 'segment'
        ? { op: 'segment', id: nextId('s'), from: p1, to: p2 }
        : { op: 'line', id: nextId('l'), through: [p1, p2] });
      pending.length = 0;
      setTool('select');
    }
  } else if (tool === 'circle') {
    pending.push({ x, y });
    if (pending.length === 2) {
      const c = pending[0], p = pending[1];
      const pc = nextId('P'), pp = nextId('P');
      pushCmd({ op: 'point', id: pc, x: c.x, y: c.y });
      pushCmd({ op: 'point', id: pp, x: p.x, y: p.y });
      pushCmd({ op: 'circle', id: nextId('c'), center: pc, through: pp });
      pending.length = 0;
      setTool('select');
    }
  } else if (tool === 'polygon') {
    pending.push({ x, y });
    pushCmd({ op: 'point', id: nextId('P'), x, y, fixed: true });
    if (pending.length >= 3) toast('继续点击顶点，或点“完成多边形”');
  }
});

function finishPolygon() {
  if (pending.length < 3) { toast('至少需要 3 个顶点'); return; }
  const ids = [];
  for (const p of pending) ids.push(nextId('P'));
  pending.forEach((p, i) => pushCmd({ op: 'point', id: ids[i], x: p.x, y: p.y, fixed: true }));
  pushCmd({ op: 'polygon', id: nextId('poly'), points: ids });
  pending.length = 0;
  setTool('select');
}

/* ---------- 函数曲线 ---------- */
function normalizeExpr(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^[yY]\s*=\s*/, '');
  s = s.replace(/(\d)\s*([xX])/g, '$1*$2').replace(/([xX])\s*(\d)/g, '$1*$2'); // 2x -> 2*x
  return s;
}
$('btn-fn-add').addEventListener('click', () => {
  const expr = normalizeExpr($('fn-input').value);
  if (!expr) { toast('先输入函数表达式'); return; }
  pushCmd({ op: 'function', id: nextId('f'), expr, from: -10, to: 10 });
  $('fn-input').value = '';
});

/* ---------- 保存 / 导出 / 导入 ---------- */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
function saveNow() {
  doc.moves = executor.moves();
  Store.saveContent(fileId, { name: nameInput.value.trim() || '未命名画板', commands: doc.commands, moves: doc.moves });
  setSaveStatus('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
}
function setSaveStatus(t) { saveStatus.textContent = t; }
$('btn-save').addEventListener('click', saveNow);
nameInput.addEventListener('change', saveNow);
window.addEventListener('mouseup', () => { if (tool === 'select') scheduleSave(); });

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('btn-export-json').addEventListener('click', () => {
  saveNow();
  download((nameInput.value.trim() || '画板') + '.json', JSON.stringify({ app: 'dajiao-b', version: 1, ...doc }, null, 2), 'application/json');
});

$('btn-export-png').addEventListener('click', () => {
  try {
    const svg = board.renderer.svgRoot;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 800));
    const h = Math.max(1, Math.round(rect.height || 600));
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const str = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => {
        if (b) download((nameInput.value.trim() || '画板') + '.png', b);
        else toast('PNG 导出失败');
      }, 'image/png');
    };
    img.onerror = () => toast('PNG 导出失败：SVG 序列化错误');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  } catch (e) {
    toast('PNG 导出失败：' + e.message);
  }
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const commands = Array.isArray(data) ? data : data.commands;
      if (!Array.isArray(commands)) throw new Error('文件里没有 commands 数组');
      if (doc.commands.length && !confirm('当前画板已有内容，导入将替换它。继续？')) return;
      executor.clearAll();
      doc.commands = [];
      const r = executor.execute(commands);
      const bad = r.filter((x) => !x.ok);
      doc.commands = commands;
      if (data.name) { doc.name = data.name; nameInput.value = data.name; }
      executor.applyMoves(data.moves);
      saveNow();
      toast(bad.length ? `导入完成，${bad.length} 条命令执行失败` : '导入成功');
    } catch (err) {
      toast('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- AI 面板 ---------- */
const history = [];
function appendLog(role, text) {
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  div.textContent = text;
  aiLog.appendChild(div);
  aiLog.scrollTop = aiLog.scrollHeight;
}

async function aiSend() {
  const text = aiInput.value.trim();
  if (!text) return;
  appendLog('user', text);
  history.push({ role: 'user', content: text });
  aiInput.value = '';
  $('ai-send').disabled = true;
  $('ai-send').textContent = '生成中…';
  try {
    const res = await fetch(CFG.boardAiEndpoint || '/api/ai/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, context: executor.describe(), history: history.slice(-10) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    if (Array.isArray(data.commands) && data.commands.length) {
      const r = executor.execute(data.commands);
      const bad = r.filter((x) => !x.ok);
      doc.commands.push(...data.commands);
      if (bad.length) appendLog('ai', `已执行 ${r.length - bad.length} 条命令，${bad.length} 条失败：` + bad.map((b) => `${b.op}(${b.error})`).join('；'));
      saveNow();
    }
    if (data.message) {
      appendLog('ai', data.message);
      history.push({ role: 'assistant', content: data.message });
    }
  } catch (e) {
    appendLog('ai', '⚠️ ' + e.message);
  } finally {
    $('ai-send').disabled = false;
    $('ai-send').textContent = '生成';
  }
}
$('ai-send').addEventListener('click', aiSend);
aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
});

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

/* ---------- 加载已有内容 ---------- */
if (doc.commands.length) {
  const r = executor.execute(doc.commands);
  const bad = r.filter((x) => !x.ok);
  executor.applyMoves(doc.moves);
  if (bad.length) console.warn('加载时有命令执行失败', bad);
}

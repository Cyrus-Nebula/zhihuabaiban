/**
 * 路线B · 画板页逻辑（JSXGraph 自建引擎）
 *
 * 页面：board.html
 *  - 工具条：14 种作图工具（多步工具引擎 js/tools.js）+ 撤销/重做 + 函数曲线
 *  - 交互：点已有对象自动吸附、交点就近选取、选中高亮、Delete 级联删除、
 *          Ctrl+Z/Y 撤销重做、Ctrl+S 保存、Esc 取消、回车结束多边形
 *  - AI 面板：自然语言 -> ai/board-backend.js 生成命令 -> executor 逐条执行（带动画）
 *  - 保存：{name, commands, moves} 存 localStorage；打开时重放命令 + 覆盖坐标
 *  - 导出：PNG（SVG 序列化）/ JSON
 *
 * 注意：config.js / store.js / models.js 是经典脚本（挂全局），本模块直接用
 * 全局绑定，不做 import；executor.js / tools.js 是 ES module，正常 import。
 */

import { createExecutor } from './executor.js';
import { createTools } from './tools.js';

const CFG = window.DAJIAO_CONFIG || {};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const nameInput = $('doc-name');
const saveStatus = $('save-status');
const aiLog = $('ai-log');
const aiInput = $('ai-input');
const toastEl = $('toast');
const toolHint = $('tool-hint');

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
  // JSXGraph 1.14 文本默认 display:'html'（DIV 覆盖层，尺寸=整板），
  // 会让 getAllObjectsUnderMouse 在任何位置都命中文本/标签，破坏点选与删除——改用 SVG 渲染
  text: { display: 'internal' },
});

const executor = createExecutor(board);

/* ---------- 文档状态 ---------- */
const urlParams = new URLSearchParams(location.search);
let fileId = urlParams.get('id');
let doc = { name: '未命名画板', commands: [], moves: [] };

if (!fileId) {
  const f = Store.create(doc.name, '2d');
  fileId = f.id;
  window.history.replaceState(null, '', 'board.html?id=' + fileId);
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

/* ---------- 命令执行 / 撤销重做 ---------- */
// 引用字段表：删除某对象时，这些字段引用它的对象也要级联删除
const REF_FIELDS = {
  segment: ['from', 'to'], ray: ['from', 'to'], line: ['through'],
  circle: ['center', 'through'], polygon: ['points'], midpoint: ['of'],
  intersect: ['of'], glider: ['on'], perpendicular: ['of', 'through'],
  parallel: ['of', 'through'], angle: ['points'],
};

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 200;

function snap() { return JSON.stringify({ c: doc.commands, m: executor.moves() }); }
function pushUndo() {
  undoStack.push(snap());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function restore(s) {
  const data = JSON.parse(s);
  executor.clearAll();
  const cmds = Array.isArray(data.c) ? data.c : [];
  const r = executor.execute(cmds);
  doc.commands = cmds.filter((c, i) => r[i] && r[i].ok);
  doc.moves = Array.isArray(data.m) ? data.m : [];
  executor.applyMoves(doc.moves);
  scheduleSave();
}
function undo() {
  if (!undoStack.length) { toast('没有可撤销的操作'); return; }
  redoStack.push(snap());
  restore(undoStack.pop());
  clearSelection();
  updateUndoButtons();
  refreshObjects();
  toast('已撤销');
}
function redo() {
  if (!redoStack.length) { toast('没有可重做的操作'); return; }
  undoStack.push(snap());
  restore(redoStack.pop());
  clearSelection();
  updateUndoButtons();
  refreshObjects();
  toast('已重做');
}
function updateUndoButtons() {
  $('btn-undo').disabled = !undoStack.length;
  $('btn-redo').disabled = !redoStack.length;
}

/** 执行命令（单个或数组），成功的写回文档；返回执行结果 */
function runCommands(cmds) {
  const list = Array.isArray(cmds) ? cmds : [cmds];
  const r = executor.execute(list);
  list.forEach((cmd, i) => {
    if (!(r[i] && r[i].ok)) return;
    if (cmd.op === 'clear') doc.commands = [];
    doc.commands.push(cmd);
  });
  const bad = r.filter((x) => !x.ok);
  if (bad.length) toast('命令执行失败：' + bad.map((b) => b.error).join('；'));
  scheduleSave();
  refreshObjects();
  return r;
}

/** 删除对象 + 级联删除依赖它的对象 */
function deleteObject(id) {
  if (!executor.registry.has(id)) { toast('对象不存在'); return 0; }
  pushUndo();
  const doomed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of doc.commands) {
      if (!c.id || doomed.has(c.id)) continue;
      const fields = REF_FIELDS[c.op];
      if (!fields) continue;
      for (const f of fields) {
        const v = c[f];
        const refs = Array.isArray(v) ? v : [v];
        if (refs.some((r) => (r != null && doomed.has(String(r))))) { doomed.add(c.id); changed = true; break; }
      }
    }
  }
  // label/style 命令没有 id，按 target 清理
  doc.commands = doc.commands.filter((c) => {
    if (c.id) return !doomed.has(c.id);
    if (c.op === 'label' || c.op === 'style') return !doomed.has(String(c.target));
    return true;
  });
  for (const did of doomed) executor.remove(did);
  scheduleSave();
  refreshObjects();
  const extra = doomed.size - 1;
  toast(extra > 0 ? `已删除 ${id} 及依赖它的 ${extra} 个对象` : '已删除 ' + id);
  return doomed.size;
}

/* ---------- 选中高亮 ---------- */
const SEL_STYLE = { highlightStrokeColor: '#F57C00', highlightStrokeWidth: 3, highlightFillColor: '#F57C00', highlightSize: 4.5 };
const TYPE_NAME = { point: '点', segment: '线段', line: '直线', ray: '射线', circle: '圆', polygon: '多边形', glider: '动点', text: '文本', functiongraph: '曲线', curve: '曲线', angle: '角', midpoint: '中点', intersect: '交点', perpendicular: '垂线', parallel: '平行线' };
let selectedId = null;

function selectObject(id) {
  clearSelection();
  const el = executor.registry.get(id);
  if (!el) return;
  selectedId = id;
  try { el.setAttribute(SEL_STYLE); el.highlight(); } catch (_) { /* 忽略 */ }
  showSelection();
  refreshObjects();
}
function clearSelection() {
  if (selectedId) {
    const el = executor.registry.get(selectedId);
    if (el) { try { el.noHighlight(); } catch (_) { /* 忽略 */ } }
  }
  selectedId = null;
  showSelection();
  refreshObjects();
}
function showSelection() {
  if (selectedId) {
    const el = executor.registry.get(selectedId);
    const tn = (el && (TYPE_NAME[el.elType] || el.elType)) || '对象';
    toolHint.textContent = `已选中：${selectedId}（${tn}）· Delete 删除`;
  } else {
    const def = tools.TOOLS[tools.current()];
    toolHint.textContent = def ? def.hint : '';
  }
}

/* ---------- 对象面板 / 右键菜单 / 动态测量 ---------- */
const OBJ_COLORS = ['#1565C0', '#C62828', '#2E7D32', '#F57C00', '#6A1B9A', '#37474F'];
const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6A16.7 16.7 0 0 0 2 12s3.5 6.5 10 6.5c1.4 0 2.6-.3 3.8-.7"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>';
let pendingMeasure = null; // 测距状态：已选第一个点，等待第二个点

function isHidden(el) { try { return el.evalVisProp('visible') === false; } catch (_) { return false; } }
function elColor(el) {
  try { const c = el.evalVisProp('strokeColor'); return typeof c === 'string' ? c : '#1565C0'; }
  catch (_) { return '#1565C0'; }
}
function elWidth(el) { try { const w = Number(el.evalVisProp('strokeWidth')); return Number.isFinite(w) ? w : 2; } catch (_) { return 2; } }
function elDash(el) { try { const d = Number(el.evalVisProp('dash')); return Number.isFinite(d) ? d : 0; } catch (_) { return 0; } }
function findCmd(id) { return doc.commands.find((c) => c.id === id) || null; }
function ptOf(pid) {
  const p = executor.registry.get(pid);
  return p && typeof p.X === 'function' ? [p.X(), p.Y()] : [0, 0];
}
/** 对象的锚点坐标（浮动框/测量文本定位用） */
function objAnchor(id) {
  const el = executor.registry.get(id);
  // 点类元素直接用实时坐标（可能被拖拽过）
  if (el && (el.elType === 'point' || el.elType === 'glider' || el.elType === 'midpoint' || el.elType === 'intersection')) {
    try { return [el.X(), el.Y()]; } catch (_) { /* 忽略，走命令回退 */ }
  }
  const cmd = findCmd(id);
  if (cmd) {
    if ((cmd.op === 'segment' || cmd.op === 'ray') && cmd.from && cmd.to) {
      const a = ptOf(cmd.from), b = ptOf(cmd.to);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    if (cmd.op === 'line' && Array.isArray(cmd.through) && cmd.through.length >= 2) {
      const a = ptOf(cmd.through[0]), b = ptOf(cmd.through[1]);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    if (cmd.op === 'circle' && cmd.center) { const c = ptOf(cmd.center); return [c[0] + 0.5, c[1] + 0.5]; }
    if (cmd.op === 'angle' && Array.isArray(cmd.points) && cmd.points[1]) { const v = ptOf(cmd.points[1]); return [v[0] + 0.6, v[1] + 0.6]; }
    if (cmd.op === 'midpoint' && Array.isArray(cmd.of)) { const a = ptOf(cmd.of[0]), b = ptOf(cmd.of[1]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  }
  try { return [el.X(), el.Y()]; } catch (_) { return [0, 0]; }
}

/* ---- tab 切换 ---- */
const tabBtns = Array.from(document.querySelectorAll('.ai-tab'));
function switchView(name) {
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('view-chat').classList.toggle('hidden', name !== 'chat');
  $('view-objects').classList.toggle('hidden', name !== 'objects');
  if (name === 'objects') refreshObjects();
}
tabBtns.forEach((b) => b.addEventListener('click', (ev) => { ev.currentTarget.blur(); switchView(b.dataset.view); }));
$('obj-refresh').addEventListener('click', () => refreshObjects());

/* ---- 对象列表 ---- */
function refreshObjects() {
  const entries = [...executor.registry.entries()];
  $('obj-count').textContent = String(entries.length);
  if ($('view-objects').classList.contains('hidden')) return; // 面板不可见时不重建 DOM
  const list = $('obj-list');
  list.innerHTML = '';
  if (!entries.length) {
    list.innerHTML = '<div class="obj-empty">画板还是空的，用左侧工具或 AI 作图吧</div>';
    refreshProps();
    return;
  }
  for (const [id, el] of entries) {
    const row = document.createElement('div');
    row.className = 'obj-row' + (id === selectedId ? ' selected' : '') + (isHidden(el) ? ' hidden-obj' : '');
    const dot = document.createElement('span');
    dot.className = 'obj-dot';
    dot.style.background = elColor(el);
    const name = document.createElement('span');
    name.className = 'obj-name';
    name.textContent = id;
    const type = document.createElement('span');
    type.className = 'obj-type';
    type.textContent = TYPE_NAME[el.elType] || el.elType;
    const eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'obj-act'; eye.title = isHidden(el) ? '显示' : '隐藏';
    eye.innerHTML = isHidden(el) ? EYE_OFF : EYE_ON;
    eye.addEventListener('click', (e) => { e.stopPropagation(); toggleVisible(id); });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'obj-act'; del.title = '删除';
    del.innerHTML = TRASH;
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteObject(id); clearSelection(); });
    row.append(dot, name, type, eye, del);
    row.addEventListener('click', () => selectObject(id));
    list.appendChild(row);
  }
  refreshProps();
}

/* ---- 对象属性区 ---- */
function refreshProps() {
  const props = $('obj-props');
  const id = selectedId;
  if (!id || !executor.registry.has(id)) { props.classList.add('hidden'); return; }
  const el = executor.registry.get(id);
  props.classList.remove('hidden');
  $('obj-props-name').textContent = `${id}（${TYPE_NAME[el.elType] || el.elType}）`;
  // 颜色
  const colors = $('obj-colors');
  colors.innerHTML = '';
  const curColor = elColor(el);
  for (const c of OBJ_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'obj-color' + (c === curColor ? ' active' : '');
    b.style.background = c; b.title = c;
    b.addEventListener('click', () => applyStyle(id, { color: c }));
    colors.appendChild(b);
  }
  segButtons($('obj-widths'), [[1, '细'], [2, '中'], [4, '粗']], elWidth(el), (w) => applyStyle(id, { strokeWidth: w }));
  segButtons($('obj-dashes'), [[0, '实线'], [4, '虚线'], [2, '点线']], elDash(el), (d) => applyStyle(id, { dash: d }));
  $('obj-rename').value = '';
  $('obj-toggle').textContent = isHidden(el) ? '显示' : '隐藏';
}
function segButtons(container, options, current, onPick) {
  container.innerHTML = '';
  for (const [v, label] of options) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.classList.toggle('active', v === current);
    b.addEventListener('click', () => onPick(v));
    container.appendChild(b);
  }
}
function applyStyle(id, patch) {
  if (!executor.registry.has(id)) return;
  pushUndo();
  runCommands([{ op: 'style', target: id, ...patch }]);
  refreshObjects();
}
function toggleVisible(id) {
  const el = executor.registry.get(id);
  if (!el) return;
  applyStyle(id, { hidden: !isHidden(el) });
}
function renameObject(id) {
  const [x, y] = objAnchor(id);
  tools.askInput(x, y, { placeholder: '输入新名称', value: id, maxLength: 20, okLabel: '改名' }, (v) => {
    if (v && v !== id) {
      pushUndo();
      runCommands([{ op: 'label', target: id, text: v }]);
      refreshObjects();
      toast('已改名');
    }
  });
}

/* ---- 动态测量 ---- */
function measureLabelFor(el) {
  const t = el && el.elType;
  if (t === 'segment') return '测量长度';
  if (t === 'circle') return '测量半径';
  if (t === 'angle') return '测量角度';
  if (t === 'point') return '测量距离（点两个点）';
  return null;
}
function measureObject(id) {
  const el = executor.registry.get(id);
  if (!el) return;
  const t = el.elType;
  if (t === 'point') {
    pendingMeasure = id;
    toast('再点击另一个点，测量两点距离');
    return;
  }
  let cmd = null;
  if (t === 'segment') {
    const [x, y] = objAnchor(id);
    cmd = { op: 'text', id: nextId('t'), x, y, bind: { kind: 'length', of: id } };
  } else if (t === 'circle') {
    const [x, y] = objAnchor(id);
    cmd = { op: 'text', id: nextId('t'), x, y, bind: { kind: 'radius', of: id } };
  } else if (t === 'angle') {
    const [x, y] = objAnchor(id);
    cmd = { op: 'text', id: nextId('t'), x, y, bind: { kind: 'angle', of: id } };
  } else {
    toast('该对象暂不支持测量');
    return;
  }
  pushUndo();
  runCommands([cmd]);
  refreshObjects();
}
function finishMeasure(firstId, secondId) {
  const a = executor.registry.get(firstId);
  const b = executor.registry.get(secondId);
  if (!a || !b) { toast('测量失败：对象不存在'); return; }
  const x = (a.X() + b.X()) / 2;
  const y = (a.Y() + b.Y()) / 2;
  pushUndo();
  runCommands([{ op: 'text', id: nextId('t'), x, y, bind: { kind: 'distance', of: [firstId, secondId] } }]);
  refreshObjects();
  toast('已测量距离');
}

/* ---- 右键上下文菜单 ---- */
const ctxMenu = $('ctx-menu');
$('box').addEventListener('contextmenu', (evt) => {
  evt.preventDefault();
  const id = tools.pickPoint(evt) || tools.pick(evt, false);
  if (!id) { closeCtxMenu(); return; }
  selectObject(id);
  openCtxMenu(evt.clientX, evt.clientY, id);
});
function openCtxMenu(cx, cy, id) {
  const el = executor.registry.get(id);
  ctxMenu.innerHTML = '';
  const item = (label, fn, danger) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-item' + (danger ? ' danger' : '');
    b.textContent = label;
    b.addEventListener('click', () => { closeCtxMenu(); fn(); });
    ctxMenu.appendChild(b);
  };
  item('重命名…', () => renameObject(id));
  const colors = document.createElement('div');
  colors.className = 'ctx-colors';
  for (const c of OBJ_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ctx-color'; b.style.background = c; b.title = c;
    b.addEventListener('click', () => { closeCtxMenu(); applyStyle(id, { color: c }); });
    colors.appendChild(b);
  }
  ctxMenu.appendChild(colors);
  item('线宽：细', () => applyStyle(id, { strokeWidth: 1 }));
  item('线宽：中', () => applyStyle(id, { strokeWidth: 2 }));
  item('线宽：粗', () => applyStyle(id, { strokeWidth: 4 }));
  item('虚线', () => applyStyle(id, { dash: 4 }));
  item('点线', () => applyStyle(id, { dash: 2 }));
  item(isHidden(el) ? '显示' : '隐藏', () => toggleVisible(id));
  const ml = measureLabelFor(el);
  if (ml) item(ml, () => measureObject(id));
  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  ctxMenu.appendChild(sep);
  item('删除对象', () => { deleteObject(id); clearSelection(); }, true);
  ctxMenu.classList.remove('hidden');
  const w = 180;
  const h = ctxMenu.offsetHeight || 320;
  ctxMenu.style.left = Math.max(8, Math.min(cx, window.innerWidth - w - 8)) + 'px';
  ctxMenu.style.top = Math.max(8, Math.min(cy, window.innerHeight - h - 8)) + 'px';
}
function closeCtxMenu() { ctxMenu.classList.add('hidden'); }
document.addEventListener('mousedown', (e) => { if (!ctxMenu.contains(e.target)) closeCtxMenu(); }, true);

/* ---- 属性区按钮 ---- */
$('obj-rename-ok').addEventListener('click', () => {
  if (!selectedId) return;
  const v = $('obj-rename').value.trim();
  if (!v) { toast('请输入新名称'); return; }
  pushUndo();
  runCommands([{ op: 'label', target: selectedId, text: v }]);
  refreshObjects();
  toast('已改名');
});
$('obj-toggle').addEventListener('click', () => { if (selectedId) toggleVisible(selectedId); });
$('obj-measure').addEventListener('click', () => { if (selectedId) measureObject(selectedId); });
$('obj-delete').addEventListener('click', () => {
  if (!selectedId) return;
  deleteObject(selectedId);
  clearSelection();
});

/* ---------- id 分配 / 坐标换算 ---------- */
let idSeq = 1;
function nextId(prefix) {
  let id;
  do { id = prefix + idSeq++; } while (executor.has(id) || doc.commands.some((c) => c.id === id));
  return id;
}
function usrCoords(evt) {
  const p = board.getMousePosition(evt);
  const o = board.origin.scrCoords;
  return [Math.round(((p[0] - o[1]) / board.unitX) * 1000) / 1000,
          Math.round(((o[2] - p[1]) / board.unitY) * 1000) / 1000];
}
function usrToScreen(x, y) {
  const o = board.origin.scrCoords;
  const r = board.renderer.svgRoot.getBoundingClientRect();
  return [r.left + o[1] + x * board.unitX, r.top + o[2] - y * board.unitY];
}

/* ---------- 工具引擎 ---------- */
// 一次完整作图 = 一个撤销单元
let actionOpen = false;
function beginAction() { if (!actionOpen) { pushUndo(); actionOpen = true; } }
function endAction() { actionOpen = false; }

const toolBtns = Array.from(document.querySelectorAll('.tool[data-tool]'));
function applyToolUi(t, def) {
  toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $('btn-poly-done').classList.toggle('hidden', t !== 'polygon');
  toolHint.textContent = def ? def.hint : '';
}

const tools = createTools({
  board, executor, nextId, runCommands,
  beginAction, endAction,
  deleteObject,
  removeCmds: (ids) => { const s = new Set(ids); doc.commands = doc.commands.filter((c) => !s.has(c.id)); },
  toast, usrCoords, usrToScreen,
  onToolChange: applyToolUi,
  onProgress: (text) => { toolHint.textContent = text; },
});

toolBtns.forEach((b) => b.addEventListener('click', (ev) => { ev.currentTarget.blur(); tools.setTool(b.dataset.tool); }));
$('btn-poly-done').addEventListener('click', (ev) => { ev.currentTarget.blur(); tools.finishPolygon(); });
$('btn-undo').addEventListener('click', (ev) => { ev.currentTarget.blur(); undo(); });
$('btn-redo').addEventListener('click', (ev) => { ev.currentTarget.blur(); redo(); });
applyToolUi('select', tools.TOOLS.select); // 初始提示

board.on('down', (evt) => {
  if (tools.current() === 'select') {
    // 精确点优先选点，其次选顶层对象；不拦截事件，保留原生拖拽/平移
    const id = tools.pickPoint(evt) || tools.pick(evt, false);
    if (pendingMeasure) {
      if (id) { const first = pendingMeasure; pendingMeasure = null; finishMeasure(first, id); }
      else { pendingMeasure = null; toast('已取消测量'); }
      clearSelection();
      return;
    }
    if (id) selectObject(id); else clearSelection();
    return;
  }
  if (pendingMeasure) { pendingMeasure = null; toast('已取消测量'); }
  tools.onDown(evt);
});

/* ---------- 快捷键 ---------- */
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = String(e.key || '').toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 's') { e.preventDefault(); saveNow(); toast('已保存'); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId) { e.preventDefault(); deleteObject(selectedId); clearSelection(); }
  }
  else if (e.key === 'Escape') { closeCtxMenu(); tools.cancel(); clearSelection(); }
  else if (e.key === 'Enter') {
    if (tools.current() === 'polygon' && tools.getPending().length >= 3) tools.finishPolygon();
  }
});

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
  pushUndo();
  runCommands([{ op: 'function', id: nextId('f'), expr, from: -10, to: 10 }]);
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
window.addEventListener('mouseup', () => { if (tools.current() === 'select') scheduleSave(); });

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
      doc.commands = commands.filter((c, i) => r[i] && r[i].ok);
      if (data.name) { doc.name = data.name; nameInput.value = data.name; }
      doc.moves = Array.isArray(data.moves) ? data.moves : [];
      executor.applyMoves(doc.moves);
      clearSelection();
      undoStack.length = 0;
      redoStack.length = 0;
      updateUndoButtons();
      saveNow();
      refreshObjects();
      toast(bad.length ? `导入完成，${bad.length} 条命令执行失败` : '导入成功');
    } catch (err) {
      toast('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- AI 面板 ---------- */
// 注意：别叫 history——会遮蔽全局 window.history（TDZ 会让上面的 replaceState 崩溃）
const chatHistory = [];

/* ---- 模型选择（白名单来自 js/models.js，持久化 localStorage）---- */
const MODELS = Array.isArray(window.DAJIAO_MODELS) ? window.DAJIAO_MODELS : [];
const modelSel = $('ai-model');
MODELS.forEach((m) => {
  const opt = document.createElement('option');
  opt.value = m.id;
  opt.textContent = m.name;
  modelSel.appendChild(opt);
});
const savedModel = localStorage.getItem('dajiao-board-model');
if (savedModel && MODELS.some((m) => m.id === savedModel)) modelSel.value = savedModel;
modelSel.addEventListener('change', () => {
  localStorage.setItem('dajiao-board-model', modelSel.value);
  updateImgBtn();
});

function isVisionModel() {
  const m = MODELS.find((x) => x.id === modelSel.value);
  return !!(m && m.vision);
}

/* ---- 图片上传（仅视觉模型显示按钮）---- */
let pendingImage = null; // {dataUrl, name}
const MAX_IMG_BYTES = 5 * 1024 * 1024;

function updateImgBtn() {
  $('ai-img-btn').classList.toggle('hidden', !isVisionModel());
  if (!isVisionModel()) clearImage();
}
function clearImage() {
  pendingImage = null;
  $('ai-img-preview').classList.add('hidden');
  $('ai-img-thumb').removeAttribute('src');
  $('ai-img-name').textContent = '';
}
$('ai-img-btn').addEventListener('click', () => $('ai-img-input').click());
$('ai-img-clear').addEventListener('click', clearImage);
$('ai-img-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
  if (file.size > MAX_IMG_BYTES) { toast('图片不能超过 5MB'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = { dataUrl: String(reader.result), name: file.name };
    $('ai-img-thumb').src = pendingImage.dataUrl;
    $('ai-img-name').textContent = pendingImage.name;
    $('ai-img-preview').classList.remove('hidden');
  };
  reader.onerror = () => toast('图片读取失败');
  reader.readAsDataURL(file);
});
updateImgBtn();

function appendLog(role, text) {
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  div.textContent = text;
  aiLog.appendChild(div);
  aiLog.scrollTop = aiLog.scrollHeight;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function aiSend() {
  const text = aiInput.value.trim();
  if (!text && !pendingImage) return;
  const shown = (pendingImage ? '［图片］' : '') + (text || '请按这张图片复原几何图形');
  appendLog('user', shown);
  chatHistory.push({ role: 'user', content: shown });
  aiInput.value = '';
  const image = pendingImage ? pendingImage.dataUrl : undefined;
  const model = modelSel.value;
  clearImage();
  $('ai-send').disabled = true;
  $('ai-send').textContent = '生成中…';
  try {
    const res = await fetch(CFG.boardAiEndpoint || '/api/ai/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text || '请按这张图片复原几何图形',
        model,
        image,
        context: executor.describe(),
        history: chatHistory.slice(-10),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    if (Array.isArray(data.commands) && data.commands.length) {
      // 整批 AI 作图 = 一个撤销单元；逐条执行，肉眼可见作图过程
      pushUndo();
      let okCount = 0;
      const errs = [];
      for (const cmd of data.commands) {
        const r = executor.execute([cmd]);
        if (r[0] && r[0].ok) {
          if (cmd.op === 'clear') doc.commands = [];
          doc.commands.push(cmd);
          okCount++;
        } else if (r[0]) {
          errs.push(`${cmd.op || '?'}(${r[0].error})`);
        }
        await sleep(90);
      }
      if (errs.length) appendLog('ai', `已执行 ${okCount} 条命令，${errs.length} 条失败：` + errs.join('；'));
      saveNow();
      refreshObjects();
    }
    if (data.message) {
      appendLog('ai', data.message);
      chatHistory.push({ role: 'assistant', content: data.message });
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

/* ---- 移动端 AI 抽屉（FAB 唤出 / 关闭钮收起）---- */
$('ai-fab').addEventListener('click', () => {
  $('aiPanel').classList.add('open');
  aiInput.focus();
});
$('ai-close').addEventListener('click', () => $('aiPanel').classList.remove('open'));

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
  doc.commands = doc.commands.filter((c, i) => r[i] && r[i].ok);
  executor.applyMoves(doc.moves);
  if (bad.length) console.warn('加载时有命令执行失败', bad);
  pushUndo(); // 以加载后的状态作为撤销基线
}
updateUndoButtons();
refreshObjects();

/* ---------- 调试/测试钩子（控制台与自动化测试用） ---------- */
window.__dajiao = { board, executor, tools, getDoc: () => doc };

/**
 * 路线B · 画板页逻辑（JSXGraph 自建引擎）
 *
 * 页面：board.html
 *  - 工具条：14 种作图工具（多步工具引擎 js/tools.js）+ 撤销/重做 + 函数曲线
 *  - 交互：点已有对象自动吸附、交点就近选取、选中高亮、Delete 级联删除、
 *          Ctrl+Z/Y 撤销重做、Ctrl+S 保存、Esc 取消、回车结束多边形
 *  - 动画：顶部「▶ 动画」让滑动条自动播放（慢/中/快 + 往复 + 多选同步），课堂动态演示；
 *          只改画面当前值，不写入存档；手动拖滑块或进入回放会自动停止
 *  - AI 面板：自然语言 -> ai/board-backend.js 生成命令 -> executor 逐条执行（带动画）
 *  - 保存：{name, commands, moves} 存 localStorage；打开时重放命令 + 覆盖坐标
 *  - 导出：PNG（SVG 序列化）/ SVG 矢量图（SVG 根克隆，可无限缩放）/ 离线 HTML（单文件自包含，双击即开）/ JSON
 *
 * 注意：config.js / store.js / models.js 是经典脚本（挂全局），本模块直接用
 * 全局绑定，不做 import；executor.js / tools.js 是 ES module，正常 import。
 */

import { createExecutor, intersectCandidates, intersectCandidateLabels, intersectActiveLabel, SELECT_CN } from './executor.js';
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

/* ---------- 画板设置（坐标轴/网格/背景/吸附，对标大角几何） ---------- */
const SETTINGS_KEY = 'dajiao-board-settings';
const boardSettings = Object.assign(
  { axis: true, grid: true, bg: 'white', snap: false },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; } })()
);

function settingsChrome() {
  return {
    axes: board.objectsList.filter((o) => o.elType === 'axis'),
    grids: board.objectsList.filter((o) => o.elType === 'grid'),
  };
}
function applyAxisGrid() {
  const { axes, grids } = settingsChrome();
  for (const a of axes) { try { a.setAttribute({ visible: boardSettings.axis }); } catch (_) { /* 忽略 */ } }
  for (const g of grids) { try { g.setAttribute({ visible: boardSettings.grid }); } catch (_) { /* 忽略 */ } }
  board.update();
}
function applyBg() {
  const box = $('box');
  const svg = box.querySelector('svg');
  box.style.background = boardSettings.bg === 'dark' ? '#0f172a' : boardSettings.bg === 'beige' ? '#FAF5EC' : '';
  // 深色背景：SVG 整体反色，网格/坐标/刻度数字/图形一并变亮，几何关系不受影响
  if (svg) svg.style.filter = boardSettings.bg === 'dark' ? 'invert(1) hue-rotate(180deg)' : '';
}
function applySnap() {
  // 影响之后新建的点（画板级选项），已有点不受影响
  board.options.point.snapToGrid = boardSettings.snap;
  board.options.point.snapSizeX = 0.5;
  board.options.point.snapSizeY = 0.5;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(boardSettings)); } catch (_) { /* 忽略 */ }
}
function applySettings() { applyAxisGrid(); applyBg(); applySnap(); }
applySettings(); // 初始化即应用（此时轴/网格元素已随 initBoard 建好）

/* ---------- 设置弹层 ---------- */
const setPop = $('settings-pop');
const setAxis = $('set-axis');
const setGrid = $('set-grid');
const setSnap = $('set-snap');
const setBgBox = $('set-bg');

function syncSettingsUi() {
  setAxis.checked = boardSettings.axis;
  setGrid.checked = boardSettings.grid;
  setSnap.checked = boardSettings.snap;
  setBgBox.querySelectorAll('.bg-swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.bg === boardSettings.bg);
  });
}
function toggleSettingsPop(force) {
  const show = typeof force === 'boolean' ? force : setPop.classList.contains('hidden');
  if (show) { syncSettingsUi(); setPop.classList.remove('hidden'); }
  else setPop.classList.add('hidden');
}
$('btn-settings').addEventListener('click', (e) => { e.stopPropagation(); toggleSettingsPop(); });
document.addEventListener('click', (e) => {
  if (!setPop.classList.contains('hidden') && !setPop.contains(e.target) && e.target.id !== 'btn-settings') {
    toggleSettingsPop(false);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSettingsPop(false); });

/* ---------- 滑动条动画（自动播放）：课堂动态演示 ----------
 * 对标大角几何「滑动条 + 自动播放」：选中滑动条后按给定速度连续改变它的值，
 * 依赖它的点 / 圆 / 曲线随之实时重算，形成可讲解的动态演示。
 * 纯前端（requestAnimationFrame + JXGraph slider.setValue），不联网、不改存档：
 * 动画只作用于画面上的当前值，不动 doc.commands / doc.moves，刷新后回到保存值。
 */
const animPop = $('anim-pop');
const animBtn = $('btn-anim');
const animTarget = $('anim-target');
const animSpeedBox = $('anim-speed');
const animPingpong = $('anim-pingpong');
const animPlayBtn = $('anim-play');
const ANIM_PERIOD = { slow: 10, normal: 6, fast: 3 }; // 单趟（min→max）用时，秒
let animPeriod = ANIM_PERIOD.normal;
let anim = null; // { ids, ranges:{id:{min,max,cur}}, vals:{}, dir, pingpong, raf, last }

/** 当前画板里可用的滑动条 id（按作图命令顺序） */
function sliderIds() {
  return doc.commands
    .filter((c) => c && c.op === 'slider' && executor.registry.has(c.id))
    .map((c) => c.id);
}
/** 滑动条取值区间：取自作图命令（比读引擎内部状态稳），当前值读引擎 */
function sliderRange(id) {
  const cmd = doc.commands.find((c) => c && c.op === 'slider' && c.id === id);
  const el = executor.registry.get(id);
  if (!cmd || !el) return null;
  let min = Number(cmd.min), max = Number(cmd.max);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 10;
  if (max < min) { const t = min; min = max; max = t; }
  const cur = Number(typeof el.Value === 'function' ? el.Value() : NaN);
  return { min, max, cur: Number.isFinite(cur) ? Math.min(max, Math.max(min, cur)) : min };
}
function syncAnimTargets() {
  const ids = sliderIds();
  const prev = animTarget.value;
  animTarget.innerHTML = '';
  if (!ids.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '（无滑动条）';
    animTarget.appendChild(o);
    return;
  }
  const all = document.createElement('option');
  all.value = '__all__';
  all.textContent = `全部（${ids.length} 个）`;
  animTarget.appendChild(all);
  for (const id of ids) {
    const r = sliderRange(id) || { min: 0, max: 10 };
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${id}：${fmtNum(r.min)} ~ ${fmtNum(r.max)}`;
    animTarget.appendChild(o);
  }
  animTarget.value = Array.from(animTarget.options).some((o) => o.value === prev) ? prev : '__all__';
}
function animTargets() {
  const ids = sliderIds();
  if (!ids.length) return [];
  return animTarget.value === '__all__' ? ids : ids.filter((id) => id === animTarget.value);
}
function animTick(ts) {
  if (!anim) return;
  const dt = anim.last ? Math.min(0.1, (ts - anim.last) / 1000) : 0; // 切后台回来不跳变
  anim.last = ts;
  let alive = false;
  for (const id of anim.ids) {
    const r = anim.ranges[id];
    const el = executor.registry.get(id);
    if (!r || !el || typeof el.setValue !== 'function') continue;
    alive = true;
    const span = r.max - r.min;
    let v = anim.vals[id];
    if (span > 0) {
      v += anim.dir * (span / animPeriod) * dt;
      if (v > r.max) {
        if (anim.pingpong) { v = r.max - (v - r.max); anim.dir = -1; }
        else v = r.min;
      } else if (v < r.min) {
        if (anim.pingpong) { v = r.min + (r.min - v); anim.dir = 1; }
        else v = r.max;
      }
    }
    v = Math.min(r.max, Math.max(r.min, v));
    anim.vals[id] = v;
    el.setValue(v); // 命令给了 step 时，引擎的 snapWidth 会把值吸附到步长
  }
  if (!alive) { animStop(); return; } // 滑动条被删掉 / 换了文档：自动收摊
  try { board.update(); } catch (_) { /* 忽略单次更新异常，下一帧继续 */ }
  anim.raf = requestAnimationFrame(animTick);
}
function animStart() {
  if (blockIfReplaying()) return;
  const ids = animTargets();
  if (!ids.length) { toast('没有可播放的滑动条'); return; }
  const ranges = {}, vals = {};
  for (const id of ids) {
    const r = sliderRange(id);
    if (r) { ranges[id] = r; vals[id] = r.cur; }
  }
  if (!Object.keys(ranges).length) { toast('没有可播放的滑动条'); return; }
  anim = { ids: Object.keys(ranges), ranges, vals, dir: 1, pingpong: animPingpong.checked, raf: 0, last: 0 };
  animPlayBtn.textContent = '⏸ 暂停';
  animBtn.textContent = '⏸ 动画中';
  anim.raf = requestAnimationFrame(animTick);
}
function animStop() {
  if (!anim) return;
  cancelAnimationFrame(anim.raf);
  anim = null;
  animPlayBtn.textContent = '▶ 播放';
  animBtn.textContent = '▶ 动画';
}
function isSliderId(id) {
  const el = id ? executor.registry.get(id) : null;
  return !!(el && el.elType === 'slider');
}
/** 鼠标是否落在某个滑动条手柄/轨道上：JXG 的 slider 手柄不在拾取表中，按几何位置判断 */
function hitSliderHandle(evt) {
  let p;
  try { p = usrCoords(evt); } catch (_) { return false; }
  for (const id of sliderIds()) {
    const el = executor.registry.get(id);
    if (!el || typeof el.X !== 'function' || typeof el.Y !== 'function') continue;
    let x, y;
    try { x = el.X(); y = el.Y(); } catch (_) { continue; }
    if (Math.abs(p[0] - x) < 0.4 && Math.abs(p[1] - y) < 0.5) return true;
  }
  return false;
}
function toggleAnimPop(force) {
  const show = typeof force === 'boolean' ? force : animPop.classList.contains('hidden');
  if (show) { syncAnimTargets(); animPop.classList.remove('hidden'); }
  else animPop.classList.add('hidden');
  animBtn.setAttribute('aria-expanded', String(show));
}
animBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!sliderIds().length) { toast('先用「滑动条」工具添加参数控件，再播放动画'); return; }
  toggleAnimPop();
});
animPlayBtn.addEventListener('click', () => { if (anim) animStop(); else animStart(); });
animPingpong.addEventListener('change', () => { if (anim) anim.pingpong = animPingpong.checked; });
animTarget.addEventListener('change', () => { if (anim) { animStop(); animStart(); } }); // 换目标立即重播
animSpeedBox.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    animPeriod = ANIM_PERIOD[b.dataset.speed] || ANIM_PERIOD.normal;
    animSpeedBox.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  });
});
// 注意：JSXGraph 会吃掉画板上的 click 冒泡，所以这里必须走捕获阶段，
// 否则点了画板（最常见的"点空白处收起"）面板不会关。
document.addEventListener('click', (e) => {
  if (animBtn.contains(e.target)) return; // 按钮自己负责开合
  if (!animPop.classList.contains('hidden') && !animPop.contains(e.target)) toggleAnimPop(false);
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleAnimPop(false); });
animSpeedBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.speed === 'normal'));

setAxis.addEventListener('change', () => { boardSettings.axis = setAxis.checked; saveSettings(); applyAxisGrid(); });
setGrid.addEventListener('change', () => { boardSettings.grid = setGrid.checked; saveSettings(); applyAxisGrid(); });
setSnap.addEventListener('change', () => { boardSettings.snap = setSnap.checked; saveSettings(); applySnap(); });
setBgBox.querySelectorAll('.bg-swatch').forEach((b) => {
  b.addEventListener('click', () => {
    boardSettings.bg = b.dataset.bg;
    saveSettings();
    syncSettingsUi();
    applyBg();
  });
});

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
  circle: ['center', 'through', 'radius'], polygon: ['points'], midpoint: ['of'],
  intersect: ['of'], glider: ['on'], perpendicular: ['of', 'through'],
  parallel: ['of', 'through'], angle: ['points'], arc: ['center', 'from', 'to'],
  // 点坐标可以是滑动条 id（动态联动），删滑动条时要连带删掉依赖它的点
  point: ['x', 'y'],
};

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 200;

/** 表达式里是否把某个 id 当作标识符整词引用（避免 'a' 命中 'tan' 这类子串误判） */
function exprMentions(expr, idSet) {
  if (typeof expr !== 'string' || !expr) return false;
  for (const id of idSet) {
    const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^A-Za-z0-9_])' + esc + '([^A-Za-z0-9_]|$)').test(expr)) return true;
  }
  return false;
}

function snap() { return JSON.stringify({ c: doc.commands, m: executor.moves() }); }
function pushUndo() {
  undoStack.push(snap());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
/** 按当前 doc.commands 整体重放重建（改命令参数后用它落到画板上）；
 *  自由点坐标等运行时状态来自 doc.moves，会原样套回去。 */
function rebuildFromCommands(moves) {
  tools.clearPreview(); // 防止多边形预览元素在重建后残留
  // 自由点坐标/滑动条值属于运行时状态：不传就用重建前的最新值，避免被上一次保存的旧值冲掉
  const mv = moves || executor.moves();
  executor.clearAll();
  const cmds = doc.commands;
  const r = executor.execute(cmds);
  doc.commands = cmds.filter((c, i) => r[i] && r[i].ok);
  doc.moves = mv;
  executor.applyMoves(mv);
  scheduleSave();
}
function restore(s) {
  const data = JSON.parse(s);
  doc.commands = Array.isArray(data.c) ? data.c : [];
  doc.moves = Array.isArray(data.m) ? data.m : [];
  rebuildFromCommands(doc.moves);
}
function undo() {
  if (blockIfReplaying()) return;
  if (!undoStack.length) { toast('没有可撤销的操作'); return; }
  redoStack.push(snap());
  restore(undoStack.pop());
  clearSelection();
  updateUndoButtons();
  refreshObjects();
  refreshRecord();
  toast('已撤销');
}
function redo() {
  if (blockIfReplaying()) return;
  if (!redoStack.length) { toast('没有可重做的操作'); return; }
  undoStack.push(snap());
  restore(redoStack.pop());
  clearSelection();
  updateUndoButtons();
  refreshObjects();
  refreshRecord();
  toast('已重做');
}
function updateUndoButtons() {
  $('btn-undo').disabled = !undoStack.length;
  $('btn-redo').disabled = !redoStack.length;
}

/** 执行命令（单个或数组），成功的写回文档；返回执行结果 */
function runCommands(cmds) {
  if (blockIfReplaying()) return []; // 回放中禁止任何写操作（样式/改名/测量等都走这里）
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
  refreshRecord();
  return r;
}

/** 删除对象 + 级联删除依赖它的对象 */
function deleteObject(id) {
  if (blockIfReplaying()) return 0;
  if (!executor.registry.has(id)) { toast('对象不存在'); return 0; }
  pushUndo();
  const doomed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of doc.commands) {
      if (!c.id || doomed.has(c.id)) continue;
      let hit = false;
      const fields = REF_FIELDS[c.op];
      if (fields) {
        for (const f of fields) {
          const v = c[f];
          const refs = Array.isArray(v) ? v : [v];
          if (refs.some((r) => (r != null && doomed.has(String(r))))) { hit = true; break; }
        }
      }
      // 函数曲线的表达式里按名字引用了滑动条（如 expr:"a*x^2"），删掉滑动条会让它
      // 求值失败、整个画板更新报错，所以连曲线一起删（按标识符整词匹配，避免 'a' 命中 'tan'）
      if (!hit && c.op === 'function' && exprMentions(c.expr, doomed)) hit = true;
      if (hit) { doomed.add(c.id); changed = true; }
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
  refreshRecord();
  const extra = doomed.size - 1;
  toast(extra > 0 ? `已删除 ${id} 及依赖它的 ${extra} 个对象` : '已删除 ' + id);
  return doomed.size;
}

/* ---------- 选中高亮（自绘方案） ----------
 * JSXGraph 1.14 的 highlight() 实测颜色设置完全无效（stroke 恒为原色），
 * 故改为：点类 → 绑定的空心圆环（屏幕像素固定、自动跟随、点删除时自动消失）；
 * 线/面类 → 直接把 strokeColor 改为选中色（polygon 连 borders 一起改，恢复时同理）。
 */
const SEL_COLOR = '#3E44D9'; // 品牌靛蓝（logo 渐变起点）
const SEL_RING_R = 5; // 圆环半径（屏幕像素）
const POINT_LIKE = new Set(['point', 'glider', 'midpoint', 'intersection', 'slider']);
const TYPE_NAME = { point: '点', segment: '线段', line: '直线', ray: '射线', circle: '圆', polygon: '多边形', glider: '动点', text: '文本', functiongraph: '曲线', curve: '曲线', angle: '角', midpoint: '中点', intersect: '交点', perpendicular: '垂线', parallel: '平行线', slider: '滑动条', arc: '圆弧' };
let selectedId = null;
let selRing = null;
let selOrigColor = null;
/** 需要一起改色的子结构：polygon 的边框、角的弧 */
function strokeParts(el) {
  if (!el) return [];
  const parts = [el];
  if (el.elType === 'polygon' && Array.isArray(el.borders) && el.borders.length) parts.push(...el.borders);
  if (el.elType === 'angle' && el.arc) parts.push(el.arc);
  return parts;
}
function selectObject(id) {
  clearSelection();
  const el = executor.registry.get(id);
  if (!el) return;
  selectedId = id;
  try {
    if (POINT_LIKE.has(el.elType)) {
      selRing = board.create('circle', [el, () => SEL_RING_R / board.unitX], {
        strokeColor: SEL_COLOR, strokeWidth: 1.5, fillColor: 'none',
        withLabel: false, highlight: false, layer: 11, name: '__selring__',
      });
    } else {
      selOrigColor = elColor(el);
      for (const part of strokeParts(el)) {
        try { part.setAttribute({ strokeColor: SEL_COLOR, highlightStrokeColor: SEL_COLOR }); } catch (_) { /* 忽略 */ }
      }
    }
  } catch (_) { /* 忽略 */ }
  showSelection();
  refreshObjects();
}
function clearSelection() {
  if (selRing) { try { board.removeObject(selRing); } catch (_) { /* 忽略 */ } selRing = null; }
  if (selectedId) {
    const el = executor.registry.get(selectedId);
    // 仅当当前仍是选中色才恢复，避免覆盖用户中途改的色
    if (el && !POINT_LIKE.has(el.elType) && elColor(el) === SEL_COLOR && selOrigColor) {
      for (const part of strokeParts(el)) {
        try { part.setAttribute({ strokeColor: selOrigColor, highlightStrokeColor: selOrigColor }); } catch (_) { /* 忽略 */ }
      }
    }
  }
  selOrigColor = null;
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
const OBJ_COLORS = ['#3E44D9', '#C62828', '#0F766E', '#B45309', '#7C3AED', '#37474F']; // 分类色板：首位为品牌靛蓝
const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6A16.7 16.7 0 0 0 2 12s3.5 6.5 10 6.5c1.4 0 2.6-.3 3.8-.7"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>';
let pendingMeasure = null; // 测距状态：已选第一个点，等待第二个点

function isHidden(el) { try { return el.evalVisProp('visible') === false; } catch (_) { return false; } }
function elColor(el) {
  try { const c = el.evalVisProp('strokeColor'); return typeof c === 'string' ? c : '#3E44D9'; }
  catch (_) { return '#3E44D9'; }
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
  $('view-record').classList.toggle('hidden', name !== 'record');
  if (name === 'objects') refreshObjects();
  if (name === 'record') refreshRecord();
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
  // 构造信息：该对象由哪条命令产生（与记录页共用 describeCmd）
  $('obj-props-cmd').textContent = describeCmd(findCmd(id));
  // 颜色
  const colors = $('obj-colors');
  colors.innerHTML = '';
  // 选中时线状对象的颜色被临时改为选中色，色板激活态应显示原色
  const curColor = (selOrigColor && !POINT_LIKE.has(el.elType)) ? selOrigColor : elColor(el);
  for (const c of OBJ_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'obj-color' + (c === curColor ? ' active' : '');
    b.style.background = c; b.title = c;
    b.addEventListener('click', () => applyStyle(id, { color: c }));
    colors.appendChild(b);
  }
  segButtons($('obj-widths'), [[1, '细'], [2, '中'], [4, '粗']], elWidth(el), (w) => applyStyle(id, { strokeWidth: w }));
  segButtons($('obj-dashes'), [[0, '实线'], [4, '虚线'], [2, '点线']], elDash(el), (d) => applyStyle(id, { dash: d }));
  // 函数曲线专属：取值范围（定义域 from~to + 值域裁剪 ymin~ymax）
  const rangeRow = $('obj-range-row');
  const fc = findCmd(id);
  // 注意：JSXGraph 里 functiongraph 的 elType 是 'curve'，按作图命令判断最准
  if (fc && fc.op === 'function') {
    rangeRow.classList.remove('hidden');
    $('obj-x-from').value = fc && Number.isFinite(Number(fc.from)) ? Number(fc.from) : -10;
    $('obj-x-to').value = fc && Number.isFinite(Number(fc.to)) ? Number(fc.to) : 10;
    $('obj-y-min').value = fc && fc.ymin != null ? fc.ymin : '';
    $('obj-y-max').value = fc && fc.ymax != null ? fc.ymax : '';
  } else {
    rangeRow.classList.add('hidden');
  }
  // 交点筛选（对标大角几何 2D 工具）：多交点的对象可以在候选之间来回切换，
  // 切换只改命令里的 select / index，不重画整个图形之外的东西（重放保持一致）。
  const pickRow = $('obj-pick-row');
  const choices = intersectChoices(id);
  if (choices.labels.length > 1) {
    pickRow.classList.remove('hidden');
    const active = intersectActiveLabel(choices.cands, fc);
    segButtons($('obj-picks'), choices.labels.map((L) => [L.key, L.text]),
      active ? active.key : null,
      (key) => {
        const L = choices.labels.find((x) => x.key === key);
        if (L) switchIntersect(id, L);
      });
  } else {
    pickRow.classList.add('hidden');
  }
  $('obj-rename').value = '';
  $('obj-toggle').textContent = isHidden(el) ? '显示' : '隐藏';
}

/** 某个交点对象当前有哪些候选（>=2 个才谈得上筛选） */
function intersectChoices(id) {
  const c = findCmd(id);
  if (!c || c.op !== 'intersect') return { cands: [], labels: [] };
  const refs = Array.isArray(c.of) ? c.of : [];
  const o1 = executor.registry.get(refs[0]);
  const o2 = executor.registry.get(refs[1]);
  if (!o1 || !o2) return { cands: [], labels: [] };
  let cands = [];
  try { cands = intersectCandidates(board, o1, o2); } catch (_) { cands = []; }
  return { cands, labels: intersectCandidateLabels(cands) };
}

/** 切换交点：改写命令的筛选条件后整体重放，选中的屏幕高亮要重新挂到新元素上 */
function switchIntersect(id, label) {
  const c = findCmd(id);
  if (!c || !label) return;
  pushUndo();
  delete c.index;
  delete c.select;
  delete c.near;
  if (label.select) c.select = label.select;
  else c.index = label.index;
  rebuildFromCommands();
  clearSelection();
  refreshObjects();
  refreshRecord();
  if (executor.registry.has(id)) selectObject(id);
  toast('交点已切换到「' + label.text + '」');
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
  if (t === 'slider') return '显示参数值';
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
  } else if (t === 'slider') {
    const [x, y] = objAnchor(id);
    cmd = { op: 'text', id: nextId('t'), x: x + 3.2, y: y + 0.9, bind: { kind: 'value', of: id, prefix: id + ' = ' } };
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
  // 多交点对象：右键直接切换取哪一支（与属性面板「交点」行等价）
  const ch = intersectChoices(id);
  if (ch.labels.length > 1) {
    for (const L of ch.labels) item('交点：' + L.text, () => switchIntersect(id, L));
  }
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

/* ---------- 作图记录 / 回放（Construction Protocol，对标 GeoGebra/大角几何） ---------- *
 * 把 doc.commands 变成可读的步骤列表；进入回放后逐步重演作图过程：
 *   - 上一步/下一步/点击任一步骤跳转/自动播放（可调速度）
 *   - 回放中禁止编辑（撤销/删除/AI/保存等），退出（Esc 或■退出）后恢复完整图形
 *   - 对象面板「构造」行显示每个对象是由哪条命令造出来的
 */
function fmtNum(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : '?'; }
/** 坐标值：数字正常显示，引用（滑动条 id）直接显示 id，避免看到一堆问号 */
function fmtVal(v) { const n = Number(v); return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : (v == null ? '?' : String(v)); }
function fmtPt(v) { return Array.isArray(v) ? `(${fmtVal(v[0])}, ${fmtVal(v[1])})` : '?'; }
function fmtList(v) { return Array.isArray(v) ? v.join('、') : (v == null ? '?' : String(v)); }

/** 单条命令的中文步骤描述（记录列表 + 对象构造信息共用） */
function describeCmd(cmd) {
  if (!cmd) return '（无构造记录）';
  switch (cmd.op) {
    case 'clear': return '清空画板';
    case 'point': return `绘制点 ${cmd.id} ${fmtPt([cmd.x, cmd.y])}${cmd.fixed ? '（固定）' : ''}`;
    case 'segment': return `连接线段 ${cmd.id}：${fmtList(cmd.from)} — ${fmtList(cmd.to)}`;
    case 'ray': return `绘制射线 ${cmd.id}：${fmtList(cmd.from)} 经过 ${fmtList(cmd.to)}`;
    case 'line': return `绘制直线 ${cmd.id}：经过 ${fmtList(cmd.through)}`;
    case 'circle':
      return (cmd.through != null && String(cmd.through) !== String(cmd.center))
        ? `绘制圆 ${cmd.id}：圆心 ${cmd.center}，经过 ${cmd.through}`
        : `绘制圆 ${cmd.id}：圆心 ${cmd.center}，半径 ${fmtNum(cmd.radius)}`;
    case 'polygon': return `绘制多边形 ${cmd.id}：顶点 ${fmtList(cmd.points)}`;
    case 'midpoint': return `取中点 ${cmd.id}：${fmtList(cmd.of)} 的中点`;
    case 'intersect': {
      const tag = cmd.select ? SELECT_CN[cmd.select] : null;
      const ord = Number.isFinite(Number(cmd.index)) ? Number(cmd.index) + 1 : 0;
      let how = '';
      if (tag) how = `，${tag}那个`;
      else if (ord > 1) how = `，第 ${ord} 个`;
      else if (cmd.near) how = `，离 (${fmtList(cmd.near)}) 最近`;
      return `取交点 ${cmd.id}：${fmtList(cmd.of)}${how}`;
    }
    case 'glider': return `创建动点 ${cmd.id}：在 ${cmd.on} 上 ${fmtPt([cmd.x, cmd.y])}`;
    case 'arc': return `绘制圆弧 ${cmd.id}：以 ${cmd.center} 为圆心，从 ${cmd.from} 扫到 ${cmd.to}${cmd.clockwise ? '（顺时针）' : ''}`;
    case 'perpendicular': return `作垂线 ${cmd.id}：过 ${fmtList(cmd.through)} 垂直于 ${fmtList(cmd.of)}`;
    case 'parallel': return `作平行线 ${cmd.id}：过 ${fmtList(cmd.through)} 平行于 ${fmtList(cmd.of)}`;
    case 'slider':
      return `添加滑动条 ${cmd.id}：${fmtNum(cmd.min)} ~ ${fmtNum(cmd.max)}${Number(cmd.step) > 0 ? `，步长 ${fmtNum(cmd.step)}` : '，连续'}，当前 ${fmtVal(cmd.value != null ? cmd.value : cmd.start)}`;
    case 'function': {
      const dx = `x ∈ [${cmd.from == null ? -10 : cmd.from}, ${cmd.to == null ? 10 : cmd.to}]`;
      const dy = (cmd.ymin != null || cmd.ymax != null)
        ? `，值域 ${cmd.ymin == null ? '-∞' : cmd.ymin} ~ ${cmd.ymax == null ? '+∞' : cmd.ymax}`
        : '';
      return `绘制函数曲线 ${cmd.id}：y = ${cmd.expr}（${dx}${dy}）`;
    }
    case 'text':
      if (cmd.bind) {
        const kind = { distance: '两点距离', length: '长度', radius: '半径', angle: '角度', value: '参数值' }[cmd.bind.kind] || cmd.bind.kind;
        return `插入测量文本 ${cmd.id}（${kind}）`;
      }
      return `插入文本 ${cmd.id}：「${cmd.text == null ? '' : cmd.text}」`;
    case 'angle': return `作角 ${cmd.id}：${fmtList(cmd.points)}`;
    case 'label': return `修改标签：${cmd.target} →「${cmd.text == null ? '' : cmd.text}」`;
    case 'style': {
      const parts = [];
      if (cmd.color) parts.push('颜色 ' + cmd.color);
      if (cmd.strokeWidth != null) parts.push('线宽 ' + cmd.strokeWidth);
      if (cmd.dash != null) parts.push(cmd.dash ? '虚线' : '实线');
      if (cmd.fill) parts.push('填充');
      if (cmd.hidden != null) parts.push(cmd.hidden ? '隐藏' : '显示');
      return `设置样式：${cmd.target}${parts.length ? '（' + parts.join('，') + '）' : ''}`;
    }
    default: return `${cmd.op} ${cmd.id || cmd.target || ''}`;
  }
}

/* ---- 回放状态机 ---- */
let stepMode = false;       // 是否处于回放模式
let stepIdx = 0;            // 已回放的步数（0..stepCommands.length）
let stepCommands = [];      // 进入回放时的命令快照
let fullSnapshot = '';      // 进入回放前的完整快照（commands + moves），退出时恢复
let playTimer = null;       // 自动播放定时器

/** 回放中禁止一切编辑操作（避免破坏重演、避免保存半成品） */
function blockIfReplaying() {
  if (stepMode) { toast('回放中，请先退出记录模式（Esc 或点「退出」）'); return true; }
  return false;
}

function enterStep() {
  if (stepMode) return;
  animStop(); // 进入回放前停掉动画，避免两者同时改画板
  if (!doc.commands.length) { toast('还没有作图记录，先画点什么吧'); return; }
  fullSnapshot = snap();
  stepCommands = doc.commands.slice();
  stepIdx = 0;
  executor.clearAll();
  doc.commands = [];
  stepMode = true;
  tools.setTool('select');
  clearSelection();
  switchView('record');
  applyStepUi();
  renderRecord();
  refreshObjects();
  toast(`已进入回放：共 ${stepCommands.length} 步，←/→ 单步，空格播放`);
}

/** 跳转到第 n 步（清空后重演前 n 条命令） */
function jumpTo(n) {
  if (!stepMode) return;
  const target = Math.max(0, Math.min(stepCommands.length, n));
  executor.clearAll();
  doc.commands = [];
  const r = executor.execute(stepCommands.slice(0, target));
  doc.commands = stepCommands.slice(0, target).filter((c, i) => r[i] && r[i].ok);
  const data = JSON.parse(fullSnapshot);
  executor.applyMoves(Array.isArray(data.m) ? data.m : []); // 保留拖拽后的最终坐标
  stepIdx = target;
  applyStepUi();
  refreshObjects();
  renderRecord();
}
function stepNext() {
  if (!stepMode) { enterStep(); if (!stepMode) return; }
  if (stepIdx >= stepCommands.length) { toast('已经是最后一步'); return; }
  jumpTo(stepIdx + 1);
}
function stepPrev() {
  if (!stepMode) { enterStep(); if (!stepMode) return; }
  if (stepIdx <= 0) { toast('已经是第一步'); return; }
  jumpTo(stepIdx - 1);
}

function playPause() {
  clearInterval(playTimer);
  playTimer = null;
  $('rec-play').innerHTML = '▶ 播放';
}
function playToggle() {
  if (!stepMode) { enterStep(); if (!stepMode) return; }
  if (playTimer) { playPause(); return; }
  if (stepIdx >= stepCommands.length) jumpTo(0); // 播完再播 = 从头开始
  const gap = Number($('rec-speed').value) || 450;
  playTimer = setInterval(() => {
    if (stepIdx >= stepCommands.length) { playPause(); return; }
    jumpTo(stepIdx + 1);
  }, gap);
  $('rec-play').innerHTML = '⏸ 暂停';
}

function exitStep() {
  playPause();
  if (!stepMode) return;
  stepMode = false;
  restore(fullSnapshot); // 恢复完整图形（commands + moves）并保存
  clearSelection();
  updateUndoButtons();
  refreshObjects();
  renderRecord();
  applyStepUi();
  toast('已退出回放，图形已恢复');
}

/** 回放相关 UI 状态（按钮禁用、步骤计数、提示条） */
function applyStepUi() {
  $('btn-undo').disabled = stepMode || !undoStack.length;
  $('btn-redo').disabled = stepMode || !redoStack.length;
  $('rec-enter').disabled = stepMode;
  $('rec-prev').disabled = !stepMode || stepIdx <= 0;
  $('rec-next').disabled = !stepMode || stepIdx >= stepCommands.length;
  $('rec-stop').disabled = !stepMode;
  $('rec-step').textContent = stepMode ? `${stepIdx} / ${stepCommands.length}` : '0 / 0';
  if (stepMode) {
    toolHint.textContent = `回放中：第 ${stepIdx} / ${stepCommands.length} 步 · ←/→ 单步 · 空格播放 · Esc 退出`;
  } else {
    showSelection();
  }
}

/** 重建步骤列表（面板不可见时跳过；非回放状态也展示全部步骤，点击行自动进入回放并跳转） */
function renderRecord() {
  const list = $('rec-list');
  if ($('view-record').classList.contains('hidden')) return;
  const cmds = stepMode ? stepCommands : doc.commands;
  // 回放中：高亮“最后执行的那一步”；非回放：全部已执行，高亮最后一步
  const cur = stepMode ? stepIdx - 1 : cmds.length - 1;
  list.innerHTML = '';
  if (!cmds.length) {
    list.innerHTML = '<div class="rec-empty">还没有作图记录，先用左侧工具或 AI 作图吧</div>';
    return;
  }
  let activeRow = null;
  cmds.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'rec-row ' + (i === cur ? 'active' : 'done');
    row.title = '点击从这一步开始回放';
    const no = document.createElement('span');
    no.className = 'rec-no';
    no.textContent = String(i + 1);
    const desc = document.createElement('span');
    desc.className = 'rec-desc';
    desc.textContent = describeCmd(cmd);
    row.append(no, desc);
    row.addEventListener('click', () => {
      playPause();
      if (!stepMode) enterStep();
      jumpTo(i + 1);
    });
    list.appendChild(row);
    if (i === cur) activeRow = row;
  });
  if (activeRow && activeRow.scrollIntoView) activeRow.scrollIntoView({ block: 'nearest' });
}

/** 文档变更后刷新记录（面板不可见时只更新徽标计数） */
function refreshRecord() {
  $('rec-count').textContent = String(doc.commands.length);
  if (!stepMode) renderRecord();
}

$('rec-play').addEventListener('click', (ev) => { ev.currentTarget.blur(); playToggle(); });
$('rec-enter').addEventListener('click', (ev) => { ev.currentTarget.blur(); enterStep(); });
$('rec-prev').addEventListener('click', (ev) => { ev.currentTarget.blur(); playPause(); stepPrev(); });
$('rec-next').addEventListener('click', (ev) => { ev.currentTarget.blur(); playPause(); stepNext(); });
$('rec-stop').addEventListener('click', (ev) => { ev.currentTarget.blur(); exitStep(); });
$('rec-speed').addEventListener('change', () => { if (playTimer) { playPause(); playToggle(); } });

/* ---------- id 分配 / 坐标换算 ---------- */
let idSeq = 1;
function nextId(prefix) {
  // 滑动条优先用单个小写字母（a/b/c…）——函数表达式里是直接按名字引用它的
  if (prefix === 'slider') return nextSliderId();
  let id;
  do { id = prefix + idSeq++; } while (executor.has(id) || doc.commands.some((c) => c.id === id));
  return id;
}
function nextSliderId() {
  const taken = (id) => executor.has(id) || doc.commands.some((c) => c.id === id);
  for (const L of 'abcdefghijklmnopqrstuvwxyz') if (!taken(L)) return L;
  let i = 1, id;
  do { id = 'sl' + i++; } while (taken(id));
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
  findCmd,
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
applyStepUi(); // 回放相关按钮初始状态（此时 tools 已就绪）

board.on('down', (evt) => {
  if (stepMode) { toast('回放中，按 Esc 退出后可继续作图'); return; }
  if (tools.current() === 'select') {
    // 精确点优先选点，其次选顶层对象；不拦截事件，保留原生拖拽/平移
    const id = tools.pickPoint(evt) || tools.pick(evt, false);
    if (pendingMeasure) {
      if (id) { const first = pendingMeasure; pendingMeasure = null; finishMeasure(first, id); }
      else { pendingMeasure = null; toast('已取消测量'); }
      clearSelection();
      return;
    }
    if (anim && (isSliderId(id) || hitSliderHandle(evt))) animStop(); // 手动拖滑块时让动画让位
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
  // 回放模式：方向键单步、空格播放/暂停、Esc 退出（屏蔽其他快捷键）
  if (stepMode) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); playPause(); stepPrev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); playPause(); stepNext(); }
    else if (e.key === ' ') { e.preventDefault(); playToggle(); }
    else if (e.key === 'Escape') { e.preventDefault(); exitStep(); }
    return;
  }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 's') { e.preventDefault(); saveNow(); toast('已保存'); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId) { e.preventDefault(); deleteObject(selectedId); clearSelection(); }
  }
  else if (e.key === 'Escape') { closeCtxMenu(); tools.cancel(); clearSelection(); }
  else if (e.key === 'Enter') {
    if (tools.current() === 'polygon' && tools.getPending().length > 0) tools.finishPolygon();
  }
});

/* ---------- 函数曲线 ---------- */
function normalizeExpr(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^[yY]\s*=\s*/, '');
  s = s.replace(/(\d)\s*([xX])/g, '$1*$2').replace(/([xX])\s*(\d)/g, '$1*$2'); // 2x -> 2*x
  return s;
}
/** 读取工具栏的定义域输入，非法或空则回退 -10~10；左右颠倒时自动交换 */
function readFnDomain() {
  const a = Number($('fn-from').value);
  const b = Number($('fn-to').value);
  let from = Number.isFinite(a) ? a : -10;
  let to = Number.isFinite(b) ? b : 10;
  if (to < from) { const t = from; from = to; to = t; }
  if (from === to) { to = from + 1; } // 退化区间会让曲线画不出来，撑开一格
  return { from, to };
}
$('btn-fn-add').addEventListener('click', () => {
  if (blockIfReplaying()) return;
  const expr = normalizeExpr($('fn-input').value);
  if (!expr) { toast('先输入函数表达式'); return; }
  const { from, to } = readFnDomain();
  pushUndo();
  runCommands([{ op: 'function', id: nextId('f'), expr, from, to }]);
  $('fn-input').value = '';
});

/* ---------- 函数取值范围（定义域 / 值域裁剪） ----------
 * 曲线画出来之后仍可改范围：改的是它那条 function 命令，然后整体重放重建，
 * 这样依赖该曲线的交点/动点等都跟着重建，不会出现悬空引用。
 */
function applyFunctionRange(id, from, to, ymin, ymax) {
  if (blockIfReplaying()) return;
  const cmd = doc.commands.find((c) => c.id === id && c.op === 'function');
  if (!cmd) { toast('这条曲线没有可改范围的作图记录'); return; }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) { toast('定义域不合法：左端需小于右端'); return; }
  if ((ymin != null && !Number.isFinite(ymin)) || (ymax != null && !Number.isFinite(ymax))) { toast('值域不合法：请填数字或留空'); return; }
  if (ymin != null && ymax != null && ymax < ymin) { const t = ymin; ymin = ymax; ymax = t; }
  pushUndo();
  cmd.from = from; cmd.to = to;
  if (ymin == null) delete cmd.ymin; else cmd.ymin = ymin;
  if (ymax == null) delete cmd.ymax; else cmd.ymax = ymax;
  rebuildFromCommands();
  if (executor.registry.has(id)) { clearSelection(); selectObject(id); }
  refreshObjects();
  refreshRecord();
  const ytxt = (ymin != null || ymax != null)
    ? `，值域 ${ymin == null ? '-∞' : ymin} ~ ${ymax == null ? '+∞' : ymax}`
    : '，值域不限';
  toast(`已更新 ${id} 的取值范围：x ∈ [${from}, ${to}]${ytxt}`);
}
$('obj-range-apply').addEventListener('click', () => {
  if (!selectedId) return;
  const n = (el) => { const v = el.value.trim(); return v === '' ? null : Number(v); };
  const from = n($('obj-x-from')), to = n($('obj-x-to'));
  if (from == null || to == null) { toast('请先填定义域左右端'); return; }
  applyFunctionRange(selectedId, from, to, n($('obj-y-min')), n($('obj-y-max')));
});
$('obj-range-clear').addEventListener('click', () => {
  if (!selectedId) return;
  const n = (el) => { const v = el.value.trim(); return v === '' ? null : Number(v); };
  const from = n($('obj-x-from')), to = n($('obj-x-to'));
  if (from == null || to == null) { toast('请先填定义域左右端'); return; }
  applyFunctionRange(selectedId, from, to, null, null);
});

/* ---------- 保存 / 导出 / 导入 ---------- */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
function saveNow() {
  if (stepMode) return; // 回放中 doc.commands 是临时的半成品，禁止保存
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
  if (blockIfReplaying()) return;
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

/* 导出 SVG 矢量图：直接序列化画板当前的 SVG 根（含内部渲染的文本标签），
 * 加好 xmlns / 尺寸并垫一张背景矩形，得到单文件、可无限缩放的矢量图。
 * 全程离线、不依赖服务器与账号，对标大角几何「导出 SVG 矢量图」。 */
/** 构造可独立打开的 SVG 字符串；出错返回 null。抽出便于自测（window.__exportBoardSvg）。 */
function exportBoardSvg() {
  try {
    const svg = board.renderer.svgRoot;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 800));
    const h = Math.max(1, Math.round(rect.height || 600));
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    // 垫背景矩形：单独打开 SVG 时有底色，与画板页一致。
    // 深色模式下整张 svg 被 CSS 反色，白底会被反成深底，故统一填白即可。
    const bg = (boardSettings.bg === 'beige') ? '#FAF5EC' : '#ffffff';
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', String(w));
    bgRect.setAttribute('height', String(h));
    bgRect.setAttribute('fill', bg);
    clone.insertBefore(bgRect, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  } catch (e) {
    return null;
  }
}
window.__exportBoardSvg = exportBoardSvg;
$('btn-export-svg').addEventListener('click', () => {
  if (blockIfReplaying()) return;
  try {
    const str = exportBoardSvg();
    if (!str) { toast('SVG 导出失败'); return; }
    const rect = board.renderer.svgRoot.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 800));
    const h = Math.max(1, Math.round(rect.height || 600));
    download((nameInput.value.trim() || '画板') + '.svg', str, 'image/svg+xml');
    toast('已导出 SVG 矢量图（' + w + '×' + h + '）：可无限缩放，适合课件与印刷');
  } catch (e) {
    toast('SVG 导出失败：' + e.message);
  }
});

/* ---------- 导出：离线 HTML（单文件，双击即开） ----------
 * 把画板引擎（vendor/jsxgraphcore.js + jsxgraph.css）、命令执行器
 * （js/executor.js，内联时去掉 export 关键字，仍是同一份源码）和当前画板的
 * commands/moves/设置打成一个自包含 HTML：
 *   - 不联网、不依赖服务器、不需要账号，浏览器直接打开即可看到可拖拽的图形
 *   - 适合课件分发、存档、内网/离线环境使用
 * 导出的页面暴露 window.__offlineBoard = {board, executor, data}，便于调试。
 */
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 内联进 <script> 前转义 "</script"，避免源码/数据里的字符串提前闭合脚本标签 */
const safeScript = (s) => String(s).replace(/<\/script/gi, '<\\/script');

$('btn-export-html').addEventListener('click', () => exportOfflineHtml());

async function exportOfflineHtml() {
  if (blockIfReplaying()) return;
  saveNow();
  const name = nameInput.value.trim() || '画板';
  let jxg = '', jxgCss = '', execSrc = '';
  try {
    const [a, b, c] = await Promise.all([
      fetch('vendor/jsxgraphcore.js'),
      fetch('vendor/jsxgraph.css'),
      fetch('js/executor.js'),
    ]);
    if (!a.ok) throw new Error('读取 JSXGraph 引擎失败（HTTP ' + a.status + '）');
    if (!b.ok) throw new Error('读取 JSXGraph 样式失败（HTTP ' + b.status + '）');
    if (!c.ok) throw new Error('读取命令执行器失败（HTTP ' + c.status + '）');
    [jxg, jxgCss, execSrc] = await Promise.all([a.text(), b.text(), c.text()]);
  } catch (e) {
    toast('导出失败：' + e.message);
    return;
  }
  // executor 是 ES module；内联进经典 <script> 时去掉 export 关键字即可（函数体不动）。
  // 注意要剥掉所有顶层 export（不止 createExecutor 一个），否则内联后整段脚本语法报错。
  const execInline = execSrc.replace(/(^|\n)\s*export\s+(?=(function|const|let|var|class|default)\b)/g, '$1');
  if (!/function createExecutor/.test(execInline)) {
    toast('导出失败：执行器源码格式异常');
    return;
  }
  // 画板数据：命令 + 拖拽后的坐标/滑动条值 + 当时的画板设置（轴/网格/背景）
  const payload = JSON.stringify({ name, settings: boardSettings, commands: doc.commands, moves: doc.moves });
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(name)} · 智绘几何</title>
<style>
${safeScript(jxgCss)}
  body { margin: 0; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f1f5f9; color: #0f172a; }
  .off-hdr { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 14px 20px; }
  .off-hdr b { font-size: 18px; }
  .off-tag { font-size: 12px; color: #64748b; }
  .off-tag a { color: #6549D5; text-decoration: none; }
  #box { width: min(96vw, 1080px); height: min(74vh, 700px); margin: 4px auto 24px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(15, 23, 42, .08); }
</style>
<script>${safeScript(jxg)}</script>
</head>
<body>
  <div class="off-hdr"><b>${escHtml(name)}</b><span class="off-tag">智绘几何 · 离线单文件（无需联网/账号，图形可直接拖拽） · <a href="https://github.com/Cyrus-Nebula/zhihuabaiban">开源仓库</a></span></div>
  <div id="box"></div>
<script>${safeScript(execInline)}</script>
<script>
(function () {
  var data = ${safeScript(payload).replace(/</g, '\\u003c')};
  var s = data.settings || {};
  var board = JXG.JSXGraph.initBoard('box', {
    boundingbox: [-10, 10, 10, -10],
    axis: s.axis !== false, grid: s.grid !== false,
    showCopyright: false, showNavigation: false,
    zoom: { wheel: true, needshift: false }, pan: { needshift: false },
    keepaspectratio: true, text: { display: 'internal' },
  });
  var executor = createExecutor(board);
  var r = executor.execute(data.commands || []);
  executor.applyMoves(data.moves || []);
  var bad = r.filter(function (x) { return !x.ok; });
  if (bad.length) console.warn('部分命令执行失败', bad);
  // 背景色（含深色模式的 SVG 反色，与画板页一致）
  var box = document.getElementById('box');
  if (s.bg === 'dark') { box.style.background = '#0f172a'; var svg = box.querySelector('svg'); if (svg) svg.style.filter = 'invert(1) hue-rotate(180deg)'; }
  else if (s.bg === 'beige') { box.style.background = '#FAF5EC'; }
  window.__offlineBoard = { board: board, executor: executor, data: data }; // 调试/自测钩子
})();
</script>
</body>
</html>`;
  download(name + '.html', html, 'text/html');
  toast('已导出离线 HTML（约 ' + Math.round(html.length / 1024) + ' KB）：双击即可打开，无需联网');
}

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (blockIfReplaying()) return;
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
      refreshRecord();
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
  if (blockIfReplaying()) return;
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
refreshRecord();

/* ---------- 调试/测试钩子（控制台与自动化测试用） ---------- */
window.__dajiao = { board, executor, tools, getDoc: () => doc, restore, selectObject, clearSelection, deleteObject, refreshObjects };

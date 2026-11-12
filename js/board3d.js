/**
 * 立体画板（路线B · 自研，不依赖大角几何 SDK）
 * 基于 Three.js（r160 ESM，已本地 vendor 至 libs/three/，运行时无需 CDN），
 * 提供几何体建模、拾取选择、点拖拽（屏幕坐标反投影到工作面）、属性编辑、
 * 坐标轴/网格/背景切换、坐标轴刻度与 Label3D 标注、本地 + 云端（Supabase）持久化。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { axisTickSpec } from './board3d-axis.js';
import { screenToNdc, createDragSession, dragTo, isDraggableType } from './board3d-drag.js';
import {
  normalizeShapeParams, createShapeGeometry, shapeMaterialConfig,
  transparentRenderOrder as depthRenderOrder,
} from './board3d-geometry.js';

const CFG = window.DAJIAO_CONFIG || {};
const DEG = Math.PI / 180;
const SETTINGS_KEY = 'zhihui_3d_settings';

// ---------- 几何体定义 ----------
// name / params 供几何体面板与属性面板使用；几何构造统一委托到 js/board3d-geometry.js
// 的纯函数（参数规范化 + 真实 BufferGeometry 构造），默认值与之逐项对齐，
// 一致性由 tests/board3d_geometry.mjs 静态断言锁定，避免两处漂移。
const SHAPE_DEFS = {
  box:      { name: '立方体',   params: { w: { d: 2,   l: '宽' }, h: { d: 2,   l: '高' }, d: { d: 2,   l: '深' } } },
  sphere:   { name: '球体',     params: { r: { d: 1.2, l: '半径' } } },
  cylinder: { name: '圆柱',     params: { rt: { d: 1, l: '上半径' }, rb: { d: 1, l: '下半径' }, h: { d: 2.4, l: '高' } } },
  cone:     { name: '圆锥',     params: { r: { d: 1, l: '半径' }, h: { d: 2.4, l: '高' } } },
  pyramid:  { name: '四棱锥',   params: { s: { d: 2, l: '底边长' }, h: { d: 2.4, l: '高' } } },
  prism:    { name: '三棱柱',   params: { r: { d: 1, l: '半径' }, h: { d: 2.4, l: '高' } } },
  tetra:    { name: '正四面体', params: { s: { d: 2, l: '棱长' } } },
  plane:    { name: '平面',     params: { w: { d: 3, l: '宽' }, h: { d: 3, l: '高' } } },
  line:     { name: '线段',     params: { x1: { d: -1.5 }, y1: { d: 0 }, z1: { d: 0 }, x2: { d: 1.5 }, y2: { d: 0 }, z2: { d: 0 } } },
  point:    { name: '点',       params: { s: { d: 0.18, l: '大小' } } },
};

const BG_COLORS = { white: 0xf5f7fb, beige: 0xf3ecdd, dark: 0x1a1d24 };
const BG_CSS    = { white: '#f5f7fb', beige: '#f3ecdd', dark: '#1a1d24' };

let fileId = null;
let fileName = '未命名立体画板';
// 文件内容（持久化结构）：{ v, bg, axes, grid, objects:[...] }
let doc = { v: 1, bg: 'white', axes: true, grid: true, objects: [] };

// 运行时：mesh <-> obj 双向引用
const meshes = new Map(); // id -> mesh
let selected = null;      // 当前选中的 obj（与 mesh.userData.obj 同一引用）
let selectedMesh = null;

// Three 运行时
let scene, camera, renderer, orbit, transform, raycaster, group, gridHelper, axesHelper;
let stage, canvas;
const pointer = new THREE.Vector2();

// 点拖拽会话（C3）：工作面在 pointerdown 时固定，拖拽期间反投影到该平面
let dragSession = null;
const _viewDir = new THREE.Vector3();

// 叠加层（HTML，跟随 3D 锚点）：坐标轴刻度数值 + Label3D 文字标注
let overlayLayer = null;
let tickGroup = null;
const axisTickLabels = [];                 // [{ el, pos: THREE.Vector3 }]
const labelOverlays = new Map();           // id -> { el, obj }
const _proj = new THREE.Vector3();

// ============================================================
// 初始化
// ============================================================
function init() {
  stage = document.getElementById('stage');
  canvas = document.getElementById('b3d-canvas');
  if (!stage || !canvas) return;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    showHint('当前浏览器不支持 WebGL，无法加载立体画板。');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLORS.white);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(6, 5, 8);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(6, 12, 8);
  scene.add(dir);

  gridHelper = new THREE.GridHelper(20, 20, 0xb8c0d0, 0xd9dfe8);
  scene.add(gridHelper);
  axesHelper = new THREE.AxesHelper(5);
  scene.add(axesHelper);

  group = new THREE.Group();
  scene.add(group);

  ensureOverlayLayer();
  buildAxisTicks();

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;

  transform = new TransformControls(camera, renderer.domElement);
  transform.setMode('translate');
  transform.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
  transform.addEventListener('objectChange', onGizmoChange);
  scene.add(transform);

  raycaster = new THREE.Raycaster();

  resize();
  window.addEventListener('resize', resize);
  bindUI();

  // 载入文件并构建场景
  loadFile();

  animate();
}

// ============================================================
// 文件载入 / 保存
// ============================================================
function loadFile() {
  const params = new URLSearchParams(location.search);
  fileId = params.get('id');
  if (!fileId) {
    const f = Store.create('立体画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '3d');
    fileId = f.id;
    window.history.replaceState(null, '', 'board3d.html?id=' + fileId);
  }
  const f = Store.get(fileId);
  if (!f) { showHint('文件不存在或已删除。'); return; }
  fileName = f.name || '未命名立体画板';
  document.getElementById('doc-name').value = fileName;

  let content = f.content;
  if (content && content.v === 1 && Array.isArray(content.objects)) {
    doc = {
      v: 1,
      bg: content.bg || 'white',
      axes: content.axes !== false,
      grid: content.grid !== false,
      objects: content.objects.map(cloneObj),
    };
  } else {
    // 全新文件：应用上次使用的视图设置（来自 localStorage）
    const saved = loadSettings();
    doc = { v: 1, bg: saved.bg, axes: saved.axes, grid: saved.grid, objects: [] };
  }
  applyView();
  doc.objects.forEach((o) => {
    if (o.type === 'label') addLabelOverlay(o);
    else addMeshForObj(o);
  });
  setSaveStatus('就绪');
}

function cloneObj(o) {
  return {
    id: o.id || genId(),
    type: o.type,
    text: o.text || (o.type === 'label' ? '标注' : ''),
    color: o.color || '#4f6bed',
    opacity: o.opacity == null ? 1 : o.opacity,
    pos: (o.pos || [0, 0, 0]).slice(),
    rot: (o.rot || [0, 0, 0]).slice(),
    scale: (o.scale || [1, 1, 1]).slice(),
    p: Object.assign({}, o.p || {}),
  };
}

function genId() { return 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

let saveTimer = null;
function scheduleSave() {
  setSaveStatus('保存中…', 'busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 400);
}
function doSave() {
  syncAllFromMeshes();
  // 视图设置同时存到 localStorage 作为新文件默认
  const view = { bg: doc.bg, axes: doc.axes, grid: doc.grid };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(view)); } catch (_) {}
  Store.saveContent(fileId, JSON.parse(JSON.stringify(doc)));
  if (window.Auth && Auth.user) {
    Auth.syncBoard({ id: fileId, name: fileName, mode: '3d', content: doc })
      .then(() => setSaveStatus('已保存到云端 ' + time()))
      .catch(() => setSaveStatus('已本地保存 ' + time()));
  } else {
    setSaveStatus('已本地保存 ' + time());
  }
}
function syncAllFromMeshes() {
  meshes.forEach((mesh, id) => { const o = mesh.userData.obj; if (o) writeObjFromMesh(o, mesh); });
}
function time() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

// ============================================================
// 几何体创建 / 重建
// ============================================================
function addShape(type) {
  const def = SHAPE_DEFS[type];
  if (!def) return;
  const p = {};
  for (const k in def.params) p[k] = def.params[k].d;
  const obj = {
    id: genId(), type, color: '#4f6bed', opacity: 1,
    pos: [0, 0, 0],
    rot: [0, 0, 0], scale: [1, 1, 1], p,
  };
  doc.objects.push(obj);
  const mesh = addMeshForObj(obj);
  hideHint();
  selectObject(mesh);
  scheduleSave();
}

function addMeshForObj(obj) {
  // 载入 / AI / 导入工程的参数统一清洗：键白名单 + 数值化 + 钳制 + 缺省回落，
  // 保证属性面板显示值与真实几何完全一致（脏数据不会打出 NaN 顶点）。
  obj.p = normalizeShapeParams(obj.type, obj.p) || {};
  const mesh = new THREE.Mesh(buildGeometry(obj), makeMaterial(obj));
  mesh.userData.obj = obj;
  applyTransform(mesh, obj);
  mesh.castShadow = true;
  group.add(mesh);
  meshes.set(obj.id, mesh);
  return mesh;
}

function buildGeometry(obj) {
  // 几何构造统一走纯函数层（含平面水平旋转、线段端点定向、参数防护）。
  // 未知类型 / label 返回 null：给个最小占位几何，避免脏数据让 new THREE.Mesh(null) 抛异常。
  return createShapeGeometry(THREE, obj.type, obj.p) || new THREE.BoxGeometry(1, 1, 1);
}

function makeMaterial(obj) {
  // 材质规格也来自纯函数层：平面双面、半透明体 depthWrite:false、opacity 钳制。
  const cfg = shapeMaterialConfig(obj.type, obj.opacity);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(obj.color),
    roughness: 0.55, metalness: 0.05,
    transparent: cfg.transparent,
    opacity: cfg.opacity,
    depthWrite: cfg.depthWrite,
    side: cfg.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function applyTransform(mesh, obj) {
  mesh.position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
  mesh.rotation.set(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG);
  mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
}

function writeObjFromMesh(obj, mesh) {
  obj.pos = [mesh.position.x, mesh.position.y, mesh.position.z];
  obj.rot = [mesh.rotation.x / DEG, mesh.rotation.y / DEG, mesh.rotation.z / DEG];
  obj.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
}

// 几何参数变化：重建 geometry（保留当前变换）
function rebuildGeometry(obj) {
  const mesh = meshes.get(obj.id);
  if (!mesh) return;
  const old = mesh.geometry;
  mesh.geometry = buildGeometry(obj);
  old.dispose();
}

// ============================================================
// 选择 / 属性面板
// ============================================================
function selectObject(mesh) {
  if (!mesh) return deselect();
  if (selectedMesh) setHighlight(selectedMesh, false);
  selected = mesh.userData.obj;
  selectedMesh = mesh;
  setHighlight(mesh, true);
  transform.attach(mesh);
  renderInspector();
}
function deselect() {
  selected = null; selectedMesh = null;
  transform.detach();
  labelOverlays.forEach(({ el }) => el.classList.remove('sel'));
  document.getElementById('inspectorEmpty').classList.remove('hidden');
  document.getElementById('inspectorBody').classList.add('hidden');
}
function setHighlight(mesh, on) {
  const mat = mesh.material;
  if (!mat || !mat.emissive) return;
  mat.emissive.setHex(on ? 0x2a2fff2a : 0x000000);
}

function renderInspector() {
  if (!selected) return;
  document.getElementById('inspectorEmpty').classList.add('hidden');
  document.getElementById('inspectorBody').classList.remove('hidden');
  const isLabel = selected.type === 'label';
  document.getElementById('insp-type').textContent = isLabel ? '标注文字' : SHAPE_DEFS[selected.type].name;
  // 标注没有旋转/缩放/透明度概念：折叠这些行，改显文字行
  const showGrp = (grp, on) => document.querySelectorAll(`#inspectorBody [data-grp="${grp}"]`).forEach((el) => el.classList.toggle('hidden', !on));
  showGrp('rot', !isLabel);
  showGrp('scale', !isLabel);
  showGrp('opacity', !isLabel);
  showGrp('text', isLabel);
  const set = (k, i, v) => { const el = document.querySelector(`#inspectorBody [data-k="${k}"][data-i="${i}"]`); if (el) el.value = v; };
  set('pos', 0, round(selected.pos[0])); set('pos', 1, round(selected.pos[1])); set('pos', 2, round(selected.pos[2]));
  const colEl = document.querySelector('#inspectorBody [data-k="color"]'); if (colEl) colEl.value = selected.color;
  if (isLabel) {
    const tEl = document.querySelector('#inspectorBody [data-k="text"]'); if (tEl) tEl.value = selected.text || '';
    return;
  }
  set('rot', 0, round(selected.rot[0])); set('rot', 1, round(selected.rot[1])); set('rot', 2, round(selected.rot[2]));
  set('scale', 0, round(selected.scale[0])); set('scale', 1, round(selected.scale[1])); set('scale', 2, round(selected.scale[2]));
  const opEl = document.querySelector('#inspectorBody [data-k="opacity"]'); if (opEl) opEl.value = selected.opacity;
  // 类型专属参数
  const extra = document.getElementById('inspExtra');
  extra.innerHTML = '';
  const params = SHAPE_DEFS[selected.type].params;
  for (const key in params) {
    const meta = params[key];
    const row = document.createElement('div');
    row.className = 'b3d-field';
    const lab = document.createElement('label'); lab.textContent = meta.l || key;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.1'; inp.value = round(selected.p[key]);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value); if (!Number.isFinite(v)) return;
      selected.p[key] = v; rebuildGeometry(selected); scheduleSave();
    });
    row.append(lab, inp); extra.appendChild(row);
  }
}
function round(n) { return Math.round((n || 0) * 1000) / 1000; }

function onGizmoChange() {
  if (!selectedMesh) return;
  writeObjFromMesh(selected, selectedMesh);
  renderInspector();
  scheduleSave();
}

// ============================================================
// 视图设置
// ============================================================
function applyView() {
  const c = BG_COLORS[doc.bg] || BG_COLORS.white;
  scene.background = new THREE.Color(c);
  document.body.style.background = BG_CSS[doc.bg] || BG_CSS.white;
  if (gridHelper) gridHelper.visible = doc.grid;
  if (axesHelper) axesHelper.visible = doc.axes;
  if (tickGroup) tickGroup.visible = doc.axes;
  // 同步 UI
  const ax = document.getElementById('set-axis'); if (ax) ax.checked = doc.axes;
  const gr = document.getElementById('set-grid'); if (gr) gr.checked = doc.grid;
  document.querySelectorAll('#set-bg .bg-swatch').forEach((b) => b.classList.toggle('active', b.dataset.bg === doc.bg));
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (_) { return {}; }
}
function setView(key, val) {
  doc[key] = val; applyView(); scheduleSave();
}

// ============================================================
// UI 绑定
// ============================================================
function bindUI() {
  // 名称
  const nameInput = document.getElementById('doc-name');
  nameInput.addEventListener('change', () => {
    fileName = nameInput.value.trim() || '未命名立体画板';
    if (fileId) Store.rename(fileId, fileName);
    scheduleSave();
  });

  // 几何体面板
  document.getElementById('palette').querySelectorAll('.b3d-shape').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.shape;
      if (s === 'label') addLabel();
      else addShape(s);
    });
  });

  // 设置气泡
  const setBtn = document.getElementById('btn-settings');
  const setPop = document.getElementById('settings-pop');
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); setPop.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!setPop.contains(e.target) && e.target !== setBtn) setPop.classList.add('hidden'); });
  document.getElementById('set-axis').addEventListener('change', (e) => setView('axes', e.target.checked));
  document.getElementById('set-grid').addEventListener('change', (e) => setView('grid', e.target.checked));
  document.querySelectorAll('#set-bg .bg-swatch').forEach((b) => b.addEventListener('click', () => setView('bg', b.dataset.bg)));

  // 视角 / 导出 / 导入
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-export').addEventListener('click', () => { syncAllFromMeshes(); Store.saveContent(fileId, JSON.parse(JSON.stringify(doc))); Store.exportFile(fileId); });
  const importInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => { if (importInput) importInput.click(); });
  if (importInput) importInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = board3dApi.importProject(String(reader.result || ''));
      showToast(ok ? `工程已载入：${doc.objects.length} 个对象` : '导入失败：文件不是有效的工程 .json');
    };
    reader.onerror = () => showToast('导入失败：文件读取错误');
    reader.readAsText(file);
    e.target.value = ''; // 允许重复选择同一文件
  });

  // 属性面板输入
  document.getElementById('inspectorBody').addEventListener('input', onInspectorInput);
  document.getElementById('insp-delete').addEventListener('click', deleteSelected);

  // 变换模式
  document.querySelectorAll('#gizmoModes button').forEach((b) => b.addEventListener('click', () => {
    transform.setMode(b.dataset.mode);
    document.querySelectorAll('#gizmoModes button').forEach((x) => x.classList.toggle('active', x === b));
  }));

  // 拾取 + 点拖拽（C3：屏幕坐标反投影到工作面）
  let down = null, gizmoActive = false;
  // 捕获阶段先于 OrbitControls 的 pointerdown：命中点图元时立刻禁用视角旋转
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    gizmoActive = !!transform.axis;
    if (gizmoActive || transform.dragging) return;
    tryStartPointDrag(e);
  }, { capture: true });
  window.addEventListener('pointermove', onDragPointerMove);
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    endPointDrag();
    if (gizmoActive || dist > 5 || transform.dragging) return;
    pick(e);
  });
  // 指针在画布外抬起 / 取消 / 窗口失焦时兜底结束拖拽，避免 orbit 一直被禁用
  window.addEventListener('pointerup', endPointDrag);
  canvas.addEventListener('pointercancel', endPointDrag);
  window.addEventListener('blur', endPointDrag);

  // 键盘
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); }
    if (e.key === 'Escape') deselect();
  });
}

function onInspectorInput(e) {
  const el = e.target;
  const k = el.dataset.k; if (!k || !selected) return;
  if (k === 'text') { selected.text = el.value; const lo = labelOverlays.get(selected.id); if (lo) lo.el.textContent = selected.text; scheduleSave(); return; }
  if (k === 'color') { selected.color = el.value; const m = meshes.get(selected.id); if (m) m.material.color.set(el.value); const lo = labelOverlays.get(selected.id); if (lo) lo.el.style.color = selected.color; scheduleSave(); return; }
  if (k === 'opacity') { selected.opacity = parseFloat(el.value); const m = meshes.get(selected.id); if (m) { m.material.opacity = selected.opacity; m.material.transparent = selected.opacity < 1; } scheduleSave(); return; }
  const i = parseInt(el.dataset.i, 10);
  const v = parseFloat(el.value); if (!Number.isFinite(v)) return;
  if (k === 'pos') selected.pos[i] = v;
  else if (k === 'rot') selected.rot[i] = v;
  else if (k === 'scale') selected.scale[i] = Math.max(0.05, v);
  const m = meshes.get(selected.id); if (m) applyTransform(m, selected);
  scheduleSave();
}

function deleteSelected() {
  if (!selected) return;
  if (selected.type === 'label') {
    const lo = labelOverlays.get(selected.id);
    if (lo) { lo.el.remove(); labelOverlays.delete(selected.id); }
    doc.objects = doc.objects.filter((o) => o.id !== selected.id);
    deselect();
    scheduleSave();
    return;
  }
  if (!selectedMesh) return;
  const id = selected.id;
  transform.detach();
  group.remove(selectedMesh);
  selectedMesh.geometry.dispose();
  selectedMesh.material.dispose();
  meshes.delete(id);
  doc.objects = doc.objects.filter((o) => o.id !== id);
  deselect();
  scheduleSave();
}

/** 屏幕坐标 → 射线 → 首个命中（不改选中态，供点击拾取与拖拽命中共用）。 */
function pickHit(e) {
  const ndc = screenToNdc(e.clientX, e.clientY, canvas.getBoundingClientRect());
  if (!ndc || !raycaster || !camera || !group) return null;
  pointer.set(ndc.x, ndc.y);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(group.children, false);
  return hits.length ? hits[0] : null;
}

function pick(e) {
  const hit = pickHit(e);
  if (hit) selectObject(hit.object);
  else deselect();
}

// ---------- C3：点拖拽（屏幕坐标反投影到工作面） ----------
function tryStartPointDrag(e) {
  const hit = pickHit(e);
  const obj = hit && hit.object.userData.obj;
  if (!obj || !isDraggableType(obj.type)) return;
  camera.getWorldDirection(_viewDir);
  const session = createDragSession(_viewDir, { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] });
  if (!session) return;
  session.id = obj.id;
  dragSession = session;
  orbit.enabled = false;      // 拖拽点与旋转视角互斥
  selectObject(hit.object);   // 选中该点，属性面板随之同步
}

function onDragPointerMove(e) {
  if (!dragSession || !raycaster || !camera) return;
  const ndc = screenToNdc(e.clientX, e.clientY, canvas.getBoundingClientRect());
  if (!ndc) return;
  pointer.set(ndc.x, ndc.y);
  raycaster.setFromCamera(pointer, camera);
  const next = dragTo(dragSession, raycaster.ray.origin, raycaster.ray.direction);
  if (!next) return;          // 退化帧保持原位，实现「不跳变」
  const obj = doc.objects.find((o) => o.id === dragSession.id);
  if (!obj) return;
  obj.pos = next;
  const mesh = meshes.get(obj.id);
  if (mesh) applyTransform(mesh, obj);
  syncPosInputs();
  scheduleSave();
}

/** 拖拽时只刷新位置输入框，避免每帧重建整个属性面板（含几何参数输入框）。 */
function syncPosInputs() {
  if (!selected) return;
  for (let i = 0; i < 3; i++) {
    const el = document.querySelector(`#inspectorBody [data-k="pos"][data-i="${i}"]`);
    if (el) el.value = round(selected.pos[i]);
  }
}

function endPointDrag() {
  if (!dragSession) return;
  dragSession = null;
  if (orbit) orbit.enabled = true;
}

function resetView() {
  camera.position.set(6, 5, 8);
  orbit.target.set(0, 0, 0);
  orbit.update();
}

// ============================================================
// 叠加层：坐标轴刻度 + Label3D 文字标注（HTML 跟随 3D 锚点）
// ============================================================
function ensureOverlayLayer() {
  if (overlayLayer) return;
  overlayLayer = document.createElement('div');
  overlayLayer.id = 'b3d-overlay';
  overlayLayer.className = 'b3d-overlay';
  if (stage) stage.appendChild(overlayLayer);
}

/** 构建坐标轴刻度：每 1 单位次刻度短线 + 每 5 单位主刻度（更长 + 数值标注）。 */
function buildAxisTicks() {
  if (tickGroup) {
    scene.remove(tickGroup);
    tickGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  axisTickLabels.forEach((t) => t.el.remove());
  axisTickLabels.length = 0;
  tickGroup = new THREE.Group();
  const AXIS_LEN = 5; // 与 AxesHelper(5) 一致
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xe5484d },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x30a46c },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x3b82f6 },
  ];
  const TICK_MINOR = 0.12, TICK_MAJOR = 0.30;
  for (const a of axes) {
    // 轴线垂直方向（用于画刻度短线，避免与轴平行）
    const up = Math.abs(a.dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(a.dir, up).normalize();
    for (const tk of axisTickSpec(AXIS_LEN)) {
      const len = tk.major ? TICK_MAJOR : TICK_MINOR;
      const c = a.dir.clone().multiplyScalar(tk.value);
      const geo = new THREE.BufferGeometry().setFromPoints([
        c.clone().addScaledVector(perp, -len / 2),
        c.clone().addScaledVector(perp, len / 2),
      ]);
      tickGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: a.color })));
      if (tk.major && tk.value !== 0) {
        const el = document.createElement('div');
        el.className = 'b3d-tick-label';
        el.textContent = String(tk.value);
        el.style.color = '#' + a.color.toString(16).padStart(6, '0');
        overlayLayer.appendChild(el);
        axisTickLabels.push({ el, pos: c.clone() });
      }
    }
  }
  scene.add(tickGroup);
}

/** 新增一个 Label3D 文字标注（锚定在 3D 空间一点，跟随视角）。 */
function addLabel(text = '标注', pos) {
  const obj = {
    id: genId(), type: 'label', text: text || '标注', color: '#1f2937', opacity: 1,
    pos: (pos || [0, 0, 0]).slice(), rot: [0, 0, 0], scale: [1, 1, 1], p: {},
  };
  doc.objects.push(obj);
  addLabelOverlay(obj);
  hideHint();
  selectLabel(obj);
  scheduleSave();
  return obj;
}

function addLabelOverlay(obj) {
  if (!overlayLayer) ensureOverlayLayer();
  const el = document.createElement('div');
  el.className = 'b3d-label3d';
  el.textContent = obj.text || '标注';
  el.style.color = obj.color || '#1f2937';
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    selectLabel(obj);
    // 标注锚点拖拽：复用点拖拽的「工作面反投影」纯函数流程（C3），
    // 与 tryStartPointDrag 走同一套 session + window pointermove/up 监听。
    if (!isDraggableType(obj.type) || !camera || !orbit) return;
    camera.getWorldDirection(_viewDir);
    const session = createDragSession(_viewDir, { x: obj.pos[0], y: obj.pos[1], z: obj.pos[2] });
    if (!session) return;
    session.id = obj.id;
    dragSession = session;
    orbit.enabled = false;   // 拖拽标注与旋转视角互斥
  });
  overlayLayer.appendChild(el);
  labelOverlays.set(obj.id, { el, obj });
}

function selectLabel(obj) {
  if (selectedMesh) setHighlight(selectedMesh, false);
  selected = obj; selectedMesh = null;
  transform.detach();
  labelOverlays.forEach(({ el }, id) => el.classList.toggle('sel', id === obj.id));
  renderInspector();
}

/** 把世界坐标投影到画布像素（用于叠加层定位）。 */
function projectToScreen(worldPos) {
  _proj.copy(worldPos).project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    x: (_proj.x * 0.5 + 0.5) * rect.width,
    y: (-_proj.y * 0.5 + 0.5) * rect.height,
    visible: _proj.z < 1 && _proj.z > -1,
  };
}

/** 每帧刷新叠加层：坐标轴刻度数值 + Label3D 标注。 */
function updateOverlays() {
  if (!overlayLayer) return;
  const ticksOn = doc.axes && tickGroup && tickGroup.visible;
  for (const t of axisTickLabels) {
    if (!ticksOn) { t.el.style.display = 'none'; continue; }
    const s = projectToScreen(t.pos);
    if (s.visible) { t.el.style.display = 'block'; t.el.style.left = s.x + 'px'; t.el.style.top = s.y + 'px'; }
    else t.el.style.display = 'none';
  }
  labelOverlays.forEach(({ el, obj }) => {
    const s = projectToScreen(new THREE.Vector3(obj.pos[0], obj.pos[1], obj.pos[2]));
    if (s.visible) { el.style.display = 'block'; el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; }
    else el.style.display = 'none';
  });
}

// ============================================================
// 渲染循环 / 尺寸
// ============================================================
function resize() {
  if (!stage || !renderer) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// 透明体每帧渲染顺序：按「几何中心到相机距离」赋 renderOrder（远者更小→先画），
// 使重叠的半透明几何体（球/柱/锥/面）按稳定一致的「由远及近」顺序混合，
// 消除绘制顺序随相机抖动导致的 z-fighting / 穿透闪烁。
export function transparentRenderOrder(camPos, worldPos) {
  // 规格已抽到纯函数层（含非法输入防护），此处保留导出名供既有回归与调用方使用。
  return depthRenderOrder(camPos, worldPos);
}
const _camPos = new THREE.Vector3();
const _objPos = new THREE.Vector3();
function sortTransparentByDepth() {
  if (!camera || !group) return;
  camera.getWorldPosition(_camPos);
  for (const mesh of group.children) {
    const mat = mesh.material;
    if (!mat || !mat.transparent || mat.opacity >= 1) { if (mat) mesh.renderOrder = 0; continue; }
    mesh.getWorldPosition(_objPos);
    mesh.renderOrder = transparentRenderOrder(_camPos, _objPos);
  }
}
function animate() {
  requestAnimationFrame(animate);
  if (orbit) orbit.update();
  sortTransparentByDepth();
  updateOverlays();
  if (renderer) renderer.render(scene, camera);
}

// ============================================================
// 工具
// ============================================================
// 线段几何已迁移至 js/board3d-geometry.js 的 lineGeometry()（纯函数，可无头回归）；
// 由 createShapeGeometry('line', ...) 统一调用，此处不再保留重复实现。
function setSaveStatus(text, cls) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}
let hintHidden = false;
function hideHint() { if (hintHidden) return; const h = document.getElementById('b3dHint'); if (h) { h.style.display = 'none'; hintHidden = true; } }
function showHint(msg) { const h = document.getElementById('b3dHint'); if (h) { h.textContent = msg; h.style.display = 'block'; } }

// 启动
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// ============================================================
// AI 3D 命令执行器对接 API（本轮增量 · 优先级 3）
//
// 只在此处把画板副作用暴露成窄接口；js/board3d-executor.js 是纯函数，
// 通过注入本对象执行命令，二者互不引用 2D 的 js/executor.js。
// 上方所有既有逻辑（几何体 / 拾取 / 属性面板 / 刻度 / 标注 / 持久化）原样保留。
// ============================================================
export const board3dApi = {
  /** 3D 内核是否已就绪（WebGL 不可用时 init 会提前返回） */
  isReady() { return !!group && !!scene; },

  /** 当前场景快照，交给执行器做 id 存在性判定与 AI context */
  getState() {
    syncAllFromMeshes();
    return {
      objects: doc.objects.map(cloneObj),
      view: { bg: doc.bg, axes: doc.axes, grid: doc.grid },
    };
  },

  /** 新增对象：id 冲突时自动改号；几何参数缺省值由 SHAPE_DEFS 补齐 */
  add(raw) {
    // label 是锚点型图元（HTML 叠加层，无 SHAPE_DEFS 条目），与 10 种网格图元一同放行；
    // 否则 AI 的 label3d 命令会被这里误判为「未知图元」而拒绝（标注顶点命令不可用）。
    if (!group || !raw || (!SHAPE_DEFS[raw.type] && raw.type !== 'label')) return null;
    const obj = cloneObj(raw);
    if (!raw.id || doc.objects.some((o) => o.id === obj.id)) obj.id = genId();
    const def = SHAPE_DEFS[obj.type];
    if (def) {
      const p = {};
      for (const k in def.params) p[k] = def.params[k].d;
      obj.p = Object.assign(p, obj.p || {});
    } else obj.p = {}; // label 无几何参数
    doc.objects.push(obj);
    if (obj.type === 'label') addLabelOverlay(obj);
    else addMeshForObj(obj);
    hideHint();
    scheduleSave();
    return obj.id;
  },

  /** 局部更新：变换 / 材质 / 几何参数 / 标注文字 */
  update(id, patch) {
    const obj = doc.objects.find((o) => o.id === id);
    if (!obj) return false;
    for (const k of ['text', 'color', 'opacity']) if (patch[k] !== undefined) obj[k] = patch[k];
    for (const k of ['pos', 'rot', 'scale']) if (Array.isArray(patch[k])) obj[k] = patch[k].slice();
    if (patch.params && typeof patch.params === 'object') obj.p = Object.assign({}, obj.p, patch.params);
    const mesh = meshes.get(id);
    if (mesh) {
      applyTransform(mesh, obj);
      rebuildGeometry(obj);
      const mat = mesh.material;
      if (mat) {
        if (mat.color && mat.color.set) mat.color.set(obj.color);
        mat.opacity = obj.opacity;
        mat.transparent = obj.opacity < 1;
        mat.depthWrite = obj.opacity >= 1;
      }
    }
    const lo = labelOverlays.get(id);
    if (lo) { lo.el.textContent = obj.text || ''; lo.el.style.color = obj.color; }
    scheduleSave();
    return true;
  },

  /** 删除单个对象（mesh / 标注叠加层 / 选中态一并清理） */
  remove(id) {
    const obj = doc.objects.find((o) => o.id === id);
    if (!obj) return false;
    const lo = labelOverlays.get(id);
    if (lo) { lo.el.remove(); labelOverlays.delete(id); }
    const mesh = meshes.get(id);
    if (mesh) {
      transform.detach();
      group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      meshes.delete(id);
    }
    if (selected && selected.id === id) deselect();
    doc.objects = doc.objects.filter((o) => o.id !== id);
    scheduleSave();
    return true;
  },

  /** 清空全部对象（视图设置保留） */
  clear() { [...doc.objects].forEach((o) => board3dApi.remove(o.id)); },

  /** 视图设置：背景 / 坐标轴 / 网格 */
  setView(patch) {
    if (typeof patch.bg === 'string' && BG_COLORS[patch.bg]) doc.bg = patch.bg;
    if (typeof patch.axes === 'boolean') doc.axes = patch.axes;
    if (typeof patch.grid === 'boolean') doc.grid = patch.grid;
    applyView();
    scheduleSave();
  },

  /** 视角复位 */
  resetView() { resetView(); },

  /**
   * 导出工程：序列化完整持久化结构 `{ v, bg, axes, grid, objects }` 为 JSON 字符串。
   * 与「导出」按钮共用同一结构（见 D4 回归用例：导出 .json 后再载入完整还原）。
   * @returns {string} 可经 importProject() 原样还原的工程 JSON
   */
  exportProject() {
    syncAllFromMeshes();
    return JSON.stringify({
      v: 1,
      bg: doc.bg,
      axes: doc.axes,
      grid: doc.grid,
      objects: doc.objects.map(cloneObj),
    });
  },

  /**
   * 载入工程：校验 → 清空当前场景 → 按持久化结构重建对象与视图设置。
   * 用于「导入工程」按钮，导出后再载入可实现对象与设置完整还原。
   * 容错：非法 JSON / 非对象 / 缺 objects 数组一律拒绝（返回 false，不破坏当前场景）；
   *       未知图元类型被跳过，坐标/参数缺失回落默认（与 loadFile() 行为一致）。
   * @param {string|object} raw  JSON 字符串或已解析对象
   * @returns {boolean} 是否成功载入
   */
  importProject(raw) {
    let data;
    try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (_) { return false; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.objects)) return false;

    // 清空当前场景（mesh / 标注叠加层 / 选中态一并清理）
    [...doc.objects].forEach((o) => board3dApi.remove(o.id));
    deselect();

    doc = {
      v: 1,
      bg: BG_COLORS[data.bg] ? data.bg : 'white',
      axes: data.axes !== false,
      grid: data.grid !== false,
      objects: [],
    };
    for (const o of data.objects) {
      if (!o || (!SHAPE_DEFS[o.type] && o.type !== 'label')) continue; // 跳过未知图元类型（label 锚点型需保留）
      const obj = cloneObj(o);
      obj.p = o.p && typeof o.p === 'object' ? Object.assign({}, o.p) : {};
      doc.objects.push(obj);
      if (obj.type === 'label') addLabelOverlay(obj);
      else addMeshForObj(obj);
    }
    applyView();
    scheduleSave();
    return true;
  },
};

if (typeof window !== 'undefined') window.Board3D = board3dApi;

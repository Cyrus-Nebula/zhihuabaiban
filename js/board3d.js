/**
 * 立体画板（路线B · 自研，不依赖大角几何 SDK）
 * 基于 Three.js（r160 ESM，已本地 vendor 至 libs/three/，运行时无需 CDN），
 * 提供几何体建模、拾取选择、属性编辑、坐标轴/网格/背景切换、
 * 本地 + 云端（Supabase）持久化。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { axisTickSpec } from './board3d-axis.js';

const CFG = window.DAJIAO_CONFIG || {};
const DEG = Math.PI / 180;
const SETTINGS_KEY = 'zhihui_3d_settings';

// ---------- 几何体定义 ----------
const SHAPE_DEFS = {
  box:      { name: '立方体',   params: { w: { d: 2,   l: '宽' }, h: { d: 2,   l: '高' }, d: { d: 2,   l: '深' } }, geo: (p) => new THREE.BoxGeometry(p.w, p.h, p.d) },
  sphere:   { name: '球体',     params: { r: { d: 1.2, l: '半径' } }, geo: (p) => new THREE.SphereGeometry(p.r, 40, 28) },
  cylinder: { name: '圆柱',     params: { rt: { d: 1, l: '上半径' }, rb: { d: 1, l: '下半径' }, h: { d: 2.4, l: '高' } }, geo: (p) => new THREE.CylinderGeometry(p.rt, p.rb, p.h, 48) },
  cone:     { name: '圆锥',     params: { r: { d: 1, l: '半径' }, h: { d: 2.4, l: '高' } }, geo: (p) => new THREE.ConeGeometry(p.r, p.h, 48) },
  pyramid:  { name: '四棱锥',   params: { s: { d: 2, l: '底边长' }, h: { d: 2.4, l: '高' } }, geo: (p) => new THREE.ConeGeometry(p.s * 0.7, p.h, 4) },
  prism:    { name: '三棱柱',   params: { r: { d: 1, l: '半径' }, h: { d: 2.4, l: '高' } }, geo: (p) => new THREE.CylinderGeometry(p.r, p.r, p.h, 3) },
  tetra:    { name: '正四面体', params: { s: { d: 2, l: '棱长' } }, geo: (p) => new THREE.TetrahedronGeometry(p.s) },
  plane:    { name: '平面',     params: { w: { d: 3, l: '宽' }, h: { d: 3, l: '高' } }, geo: (p) => new THREE.PlaneGeometry(p.w, p.h) },
  line:     { name: '线段',     params: { x1: { d: -1.5 }, y1: { d: 0 }, z1: { d: 0 }, x2: { d: 1.5 }, y2: { d: 0 }, z2: { d: 0 } }, geo: lineGeo },
  point:    { name: '点',       params: { s: { d: 0.18, l: '大小' } }, geo: (p) => new THREE.SphereGeometry(p.s, 16, 12) },
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
    pos: [0, def.geo === SHAPE_DEFS.point.geo ? 0 : 0, 0],
    rot: [0, 0, 0], scale: [1, 1, 1], p,
  };
  doc.objects.push(obj);
  const mesh = addMeshForObj(obj);
  hideHint();
  selectObject(mesh);
  scheduleSave();
}

function addMeshForObj(obj) {
  const mesh = new THREE.Mesh(buildGeometry(obj), makeMaterial(obj));
  mesh.userData.obj = obj;
  applyTransform(mesh, obj);
  mesh.castShadow = true;
  group.add(mesh);
  meshes.set(obj.id, mesh);
  return mesh;
}

function buildGeometry(obj) {
  const def = SHAPE_DEFS[obj.type];
  const geo = def.geo(obj.p);
  if (obj.type === 'plane') geo.rotateX(-Math.PI / 2); // 让平面默认水平
  return geo;
}

function makeMaterial(obj) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(obj.color),
    roughness: 0.55, metalness: 0.05,
    transparent: obj.opacity < 1,
    opacity: obj.opacity,
    // 半透明体不写深度：避免两个重叠的透明几何体互相写深度，
    // 导致局部被错误剔除/闪烁（z-fighting）。仅不透明体写深度以保持清晰遮挡。
    depthWrite: obj.opacity >= 1,
    side: obj.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
  });
  return m;
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

  // 视角 / 导出
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-export').addEventListener('click', () => { syncAllFromMeshes(); Store.saveContent(fileId, JSON.parse(JSON.stringify(doc))); Store.exportFile(fileId); });

  // 属性面板输入
  document.getElementById('inspectorBody').addEventListener('input', onInspectorInput);
  document.getElementById('insp-delete').addEventListener('click', deleteSelected);

  // 变换模式
  document.querySelectorAll('#gizmoModes button').forEach((b) => b.addEventListener('click', () => {
    transform.setMode(b.dataset.mode);
    document.querySelectorAll('#gizmoModes button').forEach((x) => x.classList.toggle('active', x === b));
  }));

  // 拾取
  let down = null, gizmoActive = false;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; gizmoActive = !!transform.axis; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (gizmoActive || dist > 5 || transform.dragging) return;
    pick(e);
  });

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

function pick(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(group.children, false);
  if (hits.length) selectObject(hits[0].object);
  else deselect();
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
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectLabel(obj); });
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
  const dx = worldPos.x - camPos.x;
  const dy = worldPos.y - camPos.y;
  const dz = worldPos.z - camPos.z;
  return -Math.sqrt(dx * dx + dy * dy + dz * dz);
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
function lineGeo(p) {
  const a = new THREE.Vector3(p.x1, p.y1, p.z1);
  const b = new THREE.Vector3(p.x2, p.y2, p.z2);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.001;
  const geo = new THREE.CylinderGeometry(0.05, 0.05, len, 12);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}
function setSaveStatus(text, cls) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status' + (cls ? ' ' + cls : '');
}
let hintHidden = false;
function hideHint() { if (hintHidden) return; const h = document.getElementById('b3dHint'); if (h) { h.style.display = 'none'; hintHidden = true; } }
function showHint(msg) { const h = document.getElementById('b3dHint'); if (h) { h.textContent = msg; h.style.display = 'block'; } }

// 启动
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

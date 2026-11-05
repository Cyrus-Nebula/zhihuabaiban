/**
 * 独立自主 3D 画板内核（路线A 的替代品，不依赖大角几何 SDK / appId）
 *
 * - 渲染：Three.js（本地 vendor，经 board3d.html 的 importmap 引用 libs/three/）
 * - 相机：PerspectiveCamera + OrbitControls 式轨道/缩放/平移
 * - 参考系：X/Y/Z 坐标轴（带刻度与字母标签）+ XZ 平面网格
 * - 图元：point3d / segment3d / line3d / polygon3d / sphere3d / circle3d /
 *         cylinder3d / cone3d / text3d / label3d
 * - 测量：measure3d（distance 两点距离 / angle 三点夹角，纯计算、不污染画板）
 * - 交互：点可拖拽——屏幕射线反投影到「工作面」（过点当前高度的水平面），
 *         依赖该点的线段/面/体随之实时联动（动态几何）
 * - 视角：重置 / 正视 / 俯视 / 侧视 / 等轴
 *
 * 命令执行器 createBoard3DExecutor 与 js/executor.js（2D/JSXGraph）平行，
 * 互不混用——3D 命令以数字坐标为真值，不引入滑动条/交点筛选等 2D 概念。
 *
 * 设计约定（与 2D 对齐）：
 *   - 点默认可拖拽；fixed:true 则锁定
 *   - id 简短大写字母（A/B/C…）；其余字母+数字（s1/c1…）
 *   - 被引用的元素必须先定义（按依赖顺序执行）
 */

import * as THREE from 'three';
import { OrbitControls } from '../libs/three/OrbitControls.js';

const COLORS = {
  axisX: '#e5484d', axisY: '#30a46c', axisZ: '#3b82f6',
  grid: '#d8dee9', point: '#3E44D9', line: '#1f2937',
  face: '#a5b4fc', sphere: '#0ea5e9', circle: '#7c3aed',
  cylinder: '#f59e0b', cone: '#ef4444', text: '#111827',
};

const AXIS_LEN = 7;     // 主轴长度（单位：坐标格）
const TICK = 1;         // 刻度间隔

/** 用 canvas 纹理做始终朝向相机的文字标签（Sprite），避免再 vendored 一个 CSS2DRenderer */
function makeLabelSprite(text, opts = {}) {
  const color = opts.color || COLORS.text;
  const fontPx = opts.font || 44;
  const pad = 10;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `bold ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  canvas.width = w; canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  const scale = opts.scale || 0.012; // 世界单位 / 像素
  sp.scale.set(w * scale, h * scale, 1);
  sp.renderOrder = 999;
  return sp;
}

/** 把一根单位圆柱（沿 +Y，高 1，半径 1）摆到 a→b 之间并拉伸长度 */
function orientCylinder(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  if (len > 1e-6) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.scale.set(1, len, 1);
  } else {
    mesh.scale.set(1, 1e-4, 1);
  }
}

export class Board3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.entries = new Map();   // id -> {obj, type, deps, update, data}
    this.points = new Map();    // id -> THREE.Vector3（点网格的实时 position 引用）
    this.dragging = null;
    this.workPlaneY = 0;
    this.workPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._tmp = new THREE.Vector3();
    this._init();
  }

  _init() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f7f9fc');

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
    this._defaultCam = new THREE.Vector3(9, 7, 11);
    this.camera.position.copy(this._defaultCam);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    this._initLights();
    this._initGrid();
    this._initAxes();

    this._bindEvents();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-8, 4, -6);
    this.scene.add(dir2);
  }

  _initGrid() {
    const grid = new THREE.GridHelper(AXIS_LEN * 2, AXIS_LEN * 2, COLORS.grid, COLORS.grid);
    grid.material.opacity = 0.6;
    grid.material.transparent = true;
    this.scene.add(grid);
  }

  _initAxes() {
    const axesGroup = new THREE.Group();
    const dirs = [
      { dir: new THREE.Vector3(1, 0, 0), color: COLORS.axisX, name: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: COLORS.axisY, name: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: COLORS.axisZ, name: 'Z' },
    ];
    for (const a of dirs) {
      const arrow = new THREE.ArrowHelper(a.dir, new THREE.Vector3(0, 0, 0), AXIS_LEN, a.color, 0.35, 0.2);
      axesGroup.add(arrow);
      // 字母标签（轴末端外侧）
      const label = makeLabelSprite(a.name, { color: a.color, font: 52, scale: 0.016 });
      label.position.copy(a.dir).multiplyScalar(AXIS_LEN + 0.5);
      axesGroup.add(label);
      // 刻度 + 数字标签（含负方向）
      for (let i = -AXIS_LEN; i <= AXIS_LEN; i += TICK) {
        if (i === 0) continue;
        const p = a.dir.clone().multiplyScalar(i);
        const tick = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 0.04),
          new THREE.MeshBasicMaterial({ color: a.color })
        );
        tick.position.copy(p);
        axesGroup.add(tick);
        const num = makeLabelSprite(String(i), { color: a.color, font: 30, scale: 0.009 });
        num.position.copy(p).add(a.dir.clone().multiplyScalar(0.35));
        axesGroup.add(num);
      }
    }
    this.scene.add(axesGroup);
  }

  // ---------------- 图元工厂 ----------------
  register(id, entry) {
    this.entries.set(id, entry);
    return entry;
  }

  createPoint3D(id, x, y, z, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.point;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 20, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 })
    );
    mesh.position.set(x, y, z);
    mesh.userData = { id, isPoint: true, fixed: !!opts.fixed };
    const label = opts.label != null ? String(opts.label) : id;
    if (label) {
      const sp = makeLabelSprite(label, { scale: 0.011 });
      sp.position.set(0.2, 0.2, 0);
      mesh.add(sp);
    }
    this.scene.add(mesh);
    this.points.set(id, mesh.position);
    return this.register(id, { obj: mesh, type: 'point3d', deps: [], update: null, data: { x, y, z, fixed: !!opts.fixed } });
  }

  createSegment3D(id, fromId, toId, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.line;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    const entry = {
      obj: mesh, type: 'segment3d', deps: [fromId, toId],
      update: (posOf) => orientCylinder(mesh, posOf(fromId), posOf(toId)),
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  // 直线：以两个已知点确定方向，向两端各延长 4 个单位（无限直线的可视近似）
  createLine3D(id, aId, bId, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.line;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    const entry = {
      obj: mesh, type: 'line3d', deps: [aId, bId],
      update: (posOf) => {
        const a = posOf(aId), b = posOf(bId);
        const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length() || 1;
        const far = dir.clone().normalize().multiplyScalar(4);
        orientCylinder(mesh, mid.clone().sub(far), mid.clone().add(far));
      },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createPolygon3D(id, pointsIds, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.face;
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, roughness: 0.85 })
    );
    const entry = {
      obj: mesh, type: 'polygon3d', deps: [...pointsIds],
      update: (posOf) => {
        const pts = pointsIds.map(posOf).filter(Boolean);
        if (pts.length < 3) return;
        const verts = [];
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[0], p1 = pts[i], p2 = pts[i + 1];
          verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.computeVertexNormals();
        geo.attributes.position.needsUpdate = true;
      },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createSphere3D(id, centerId, radius, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.sphere;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.35 })
    );
    const entry = {
      obj: mesh, type: 'sphere3d', deps: [centerId],
      update: (posOf) => { mesh.position.copy(posOf(centerId)); mesh.scale.setScalar(radius); },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createCircle3D(id, centerId, radius, normal, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.circle;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, Math.max(0.02, radius * 0.04), 12, 64),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    const n = normal ? new THREE.Vector3(normal[0], normal[1], normal[2]).normalize() : new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); // torus 轴沿 Z，转到法线方向
    const entry = {
      obj: mesh, type: 'circle3d', deps: [centerId],
      update: (posOf) => { mesh.position.copy(posOf(centerId)); },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createCylinder3D(id, baseId, topId, radius, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.cylinder;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 32),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6, roughness: 0.4 })
    );
    const entry = {
      obj: mesh, type: 'cylinder3d', deps: [baseId, topId],
      update: (posOf) => {
        const a = posOf(baseId), b = posOf(topId);
        orientCylinder(mesh, a, b);
        mesh.scale.x = mesh.scale.z = radius;
      },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createCone3D(id, apexId, baseId, radius, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const color = opts.color || COLORS.cone;
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 32),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6, roughness: 0.4 })
    );
    const entry = {
      obj: mesh, type: 'cone3d', deps: [apexId, baseId],
      update: (posOf) => {
        const apex = posOf(apexId), base = posOf(baseId);
        const dir = new THREE.Vector3().subVectors(apex, base);
        const len = dir.length() || 1e-4;
        mesh.position.copy(base).add(apex).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        mesh.scale.set(radius, len, radius);
      },
    };
    this.scene.add(mesh);
    this.entries.set(id, entry);
    entry.update((i) => this.points.get(i));
    return entry;
  }

  createText3D(id, x, y, z, text, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    const sp = makeLabelSprite(String(text), { color: opts.color || COLORS.text, scale: opts.scale || 0.014 });
    sp.position.set(x, y, z);
    this.scene.add(sp);
    return this.register(id, { obj: sp, type: 'text3d', deps: [], update: null, data: { x, y, z, text } });
  }

  createLabel3D(targetId, text) {
    const e = this.entries.get(targetId);
    if (!e) throw new Error(`标注目标「${targetId}」不存在`);
    const sp = makeLabelSprite(String(text), { scale: 0.011 });
    sp.position.set(0.2, 0.2, 0);
    e.obj.add(sp);
    return e;
  }

  setStyle(targetId, opts = {}) {
    const e = this.entries.get(targetId);
    if (!e) throw new Error(`目标「${targetId}」不存在`);
    if (opts.color) {
      e.obj.traverse((o) => {
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => (m.color && m.color.set(opts.color)));
          else if (o.material.color) o.material.color.set(opts.color);
        }
      });
    }
    if (opts.opacity != null) {
      e.obj.traverse((o) => {
        if (o.material) {
          const set = (m) => { m.transparent = true; m.opacity = opts.opacity; };
          if (Array.isArray(o.material)) o.material.forEach(set); else set(o.material);
        }
      });
    }
    if (opts.hidden != null) e.obj.visible = !opts.hidden;
    return e;
  }

  // ---------------- 拖拽 / 拾取 ----------------
  _bindEvents() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      const hit = this._pickPoint(e);
      if (hit && !hit.userData.fixed) {
        this.dragging = hit;
        this.controls.enabled = false;
        this.workPlaneY = hit.position.y;
        this.workPlane.set(new THREE.Vector3(0, 1, 0), -this.workPlaneY);
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const p = this._rayToPlane(e);
        if (p) {
          this.dragging.position.copy(p);
          this.notifyPointMoved(this.dragging.userData.id);
        }
      } else {
        el.style.cursor = this._pickPoint(e) ? 'grab' : 'default';
      }
    });
    const end = () => {
      if (this.dragging) {
        this.dragging = null;
        this.controls.enabled = true;
        if (this.onChange) this.onChange();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _updatePointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pickPoint(e) {
    this._updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const en of this.entries.values()) {
      if (en.type === 'point3d' && en.obj.visible) meshes.push(en.obj);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object : null;
  }

  _rayToPlane(e) {
    this._updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.workPlane, this._tmp);
    return hit ? this._tmp.clone() : null;
  }

  /** 某点移动后，刷新所有依赖它的图元 */
  notifyPointMoved(id) {
    for (const en of this.entries.values()) {
      if (en.deps && en.deps.includes(id) && en.update) en.update((i) => this.points.get(i));
    }
  }

  // ---------------- 视角 ----------------
  viewReset() {
    this.camera.position.copy(this._defaultCam);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  viewPreset(name) {
    const t = new THREE.Vector3(0, 0, 0);
    let p;
    switch (name) {
      case 'front': p = new THREE.Vector3(0, 0, 14); break;   // 正对 XY 面（+Z 看向原点）
      case 'top': p = new THREE.Vector3(0, 14, 0); break;     // 俯视 XZ 面
      case 'side': p = new THREE.Vector3(14, 0, 0); break;    // 侧视 YZ 面
      case 'iso':
      default: p = this._defaultCam.clone(); break;
    }
    this.camera.position.copy(p);
    this.controls.target.copy(t);
    this.controls.update();
  }

  // ---------------- 维护 ----------------
  remove(id) {
    const e = this.entries.get(id);
    if (!e) return false;
    this.scene.remove(e.obj);
    e.obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.entries.delete(id);
    this.points.delete(id);
    return true;
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro && this._ro.disconnect();
    this.clear();
    this.renderer.dispose();
  }
}

/**
 * 3D 命令执行器（与 2D createExecutor 平行，互不复用代码）。
 * 协议命令：point3d / segment3d / line3d / polygon3d / sphere3d / circle3d /
 *           cylinder3d / cone3d / text3d / label3d / style3d / measure3d / clear
 * measure3d：{op:'measure3d',kind:'distance',of:['A','B']} 或
 *           {op:'measure3d',kind:'angle',of:['A','B','C']}（B 为顶点），
 *           返回 {ok,op:'measure3d',kind,value:number}（不创建画板元素）
 */
/**
 * measure3d：纯计算的测量命令（不创建画板元素），与 2D measure 平行、互不复用。
 * - kind:'distance' of:[A,B]    → 两点欧氏距离
 * - kind:'angle'    of:[A,B,C]  → 以 B 为顶点的夹角（单位：度）
 * 返回 {ok,op:'measure3d',kind,value}；测量目标须为已定义的点（引用未定义 id 被捕获为 ok:false）。
 */
function runMeasure3D(board, cmd, requireId, round) {
  const kind = cmd.kind || 'distance';
  const ids = Array.isArray(cmd.of) ? cmd.of : [];
  try {
    if (kind === 'distance') {
      if (ids.length < 2) throw new Error('measure3d distance 需要 of:[A,B]');
      const a = requirePoint(board, ids[0], requireId);
      const b = requirePoint(board, ids[1], requireId);
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      return { ok: true, op: 'measure3d', kind, value: round(d) };
    }
    if (kind === 'angle') {
      if (ids.length < 3) throw new Error('measure3d angle 需要 of:[A,B,C]（B 为顶点）');
      const a = requirePoint(board, ids[0], requireId);
      const bv = requirePoint(board, ids[1], requireId);
      const c = requirePoint(board, ids[2], requireId);
      const v1 = [a.x - bv.x, a.y - bv.y, a.z - bv.z];
      const v2 = [c.x - bv.x, c.y - bv.y, c.z - bv.z];
      const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
      const m1 = Math.hypot(v1[0], v1[1], v1[2]);
      const m2 = Math.hypot(v2[0], v2[1], v2[2]);
      if (!m1 || !m2) throw new Error('测量向量长度为零，无法求夹角');
      const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
      const ang = Math.acos(cos) * 180 / Math.PI;
      return { ok: true, op: 'measure3d', kind, value: round(ang) };
    }
    throw new Error('未知 measure3d.kind: ' + kind);
  } catch (e) {
    return { ok: false, op: 'measure3d', kind, error: String((e && e.message) || e) };
  }
}

// 取点实时坐标：requireId 校验元素已定义，再从 board.points 取坐标（THREE.Vector3 或 {x,y,z} 皆可）
function requirePoint(board, id, requireId) {
  requireId(id);
  const p = board.points.get(id);
  if (!p) throw new Error(`测量目标「${id}」无坐标（仅点可被测量）`);
  return p;
}

export function createBoard3DExecutor(board) {
  const plainPoints = new Set(); // 可拖拽自由点（坐标随 moves 持久化）
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const round = (v) => Math.round(v * 1000) / 1000;

  function requireId(id) {
    if (!board.entries.has(id)) throw new Error(`引用了不存在的元素「${id}」`);
    return id;
  }

  function build(cmd) {
    switch (cmd.op) {
      case 'point3d':
        board.createPoint3D(cmd.id, num(cmd.x, 0), num(cmd.y, 0), num(cmd.z, 0), { fixed: cmd.fixed, label: cmd.label, color: cmd.color });
        if (!cmd.fixed) plainPoints.add(cmd.id);
        return;
      case 'segment3d':
        requireId(cmd.from); requireId(cmd.to);
        board.createSegment3D(cmd.id, cmd.from, cmd.to, { color: cmd.color });
        return;
      case 'line3d': {
        const th = Array.isArray(cmd.through) ? cmd.through : [];
        requireId(th[0]); requireId(th[1]);
        board.createLine3D(cmd.id, th[0], th[1], { color: cmd.color });
        return;
      }
      case 'polygon3d': {
        const ps = Array.isArray(cmd.points) ? cmd.points : [];
        ps.forEach(requireId);
        board.createPolygon3D(cmd.id, ps, { color: cmd.color });
        return;
      }
      case 'sphere3d':
        requireId(cmd.center);
        board.createSphere3D(cmd.id, cmd.center, num(cmd.radius, 1), { color: cmd.color });
        return;
      case 'circle3d':
        requireId(cmd.center);
        board.createCircle3D(cmd.id, cmd.center, num(cmd.radius, 1), cmd.normal, { color: cmd.color });
        return;
      case 'cylinder3d':
        requireId(cmd.base); requireId(cmd.top);
        board.createCylinder3D(cmd.id, cmd.base, cmd.top, num(cmd.radius, 1), { color: cmd.color });
        return;
      case 'cone3d':
        requireId(cmd.apex); requireId(cmd.base);
        board.createCone3D(cmd.id, cmd.apex, cmd.base, num(cmd.radius, 1), { color: cmd.color });
        return;
      case 'text3d':
        board.createText3D(cmd.id, num(cmd.x, 0), num(cmd.y, 0), num(cmd.z, 0), String(cmd.text || ''), { color: cmd.color });
        return;
      case 'label3d':
        board.createLabel3D(cmd.target, String(cmd.text || ''));
        return;
      case 'style3d':
        board.setStyle(cmd.target, cmd);
        return;
      default:
        throw new Error('未知命令 op: ' + cmd.op);
    }
  }

  function execute(commands) {
    const out = [];
    for (const cmd of (Array.isArray(commands) ? commands : [])) {
      if (!cmd || typeof cmd !== 'object') continue;
      try {
        if (cmd.op === 'clear') { board.clear(); plainPoints.clear(); out.push({ ok: true, op: 'clear' }); continue; }
        if (cmd.op === 'measure3d') {
          out.push(runMeasure3D(board, cmd, requireId, round));
          continue;
        }
        if (!cmd.id && cmd.op !== 'label3d' && cmd.op !== 'style3d') throw new Error('缺少 id');
        build(cmd);
        out.push({ ok: true, op: cmd.op, id: cmd.id || null });
      } catch (e) {
        out.push({ ok: false, op: cmd.op, id: cmd.id || null, error: String((e && e.message) || e) });
      }
    }
    return out;
  }

  function describe() {
    const items = [];
    for (const [id, e] of board.entries) items.push(id + '(' + e.type + ')');
    return items.length ? items.join(', ') : '（空画板）';
  }

  function moves() {
    const out = [];
    for (const id of plainPoints) {
      const v = board.points.get(id);
      if (v) out.push({ id, x: round(v.x), y: round(v.y), z: round(v.z) });
    }
    return out;
  }

  function applyMoves(list) {
    for (const m of (Array.isArray(list) ? list : [])) {
      if (!plainPoints.has(m.id)) continue;
      const v = board.points.get(m.id);
      if (!v) continue;
      v.set(num(m.x, 0), num(m.y, 0), num(m.z, 0));
    }
    // 点坐标改完，统一刷新依赖它的全部图元
    for (const id of plainPoints) board.notifyPointMoved(id);
  }

  return {
    execute, describe, moves, applyMoves,
    clearAll: () => { board.clear(); plainPoints.clear(); },
    remove: (id) => board.remove(id),
    registry: board.entries,
    has: (id) => board.entries.has(id),
  };
}

/**
 * 3D 画板「点拖拽：屏幕坐标反投影到工作面」无头回归（C3）。
 *
 * 覆盖：屏幕→NDC、工作面自适应（水平 / 面向相机）、射线求交与退化拒绝、
 *      拖拽会话高度守恒与数值防护、四视角真实相机射线拖拽（不跳变 / 不瞬移），
 *      isDraggableType 白名单，以及对真实 js/board3d.js 的接入静态断言与硬约束复核。
 *
 * 与仓库既有 3D 测试同口径：纯函数模块 js/board3d-drag.js 直接 import 真实实现；
 * 四视角射线用本地 vendor 的 Three.js r160 真实 PerspectiveCamera + Raycaster 构造
 * （不依赖 WebGL / DOM，Node 可直接加载），避免用「自造的模拟射线」自证。
 *
 * 运行：node tests/board3d_drag.mjs
 */
import {
  DRAG_THRESHOLD, DRAG_COORD_LIMIT,
  screenToNdc, workPlaneForDrag, rayPlaneIntersect,
  createDragSession, dragTo, isDraggableType,
} from '../js/board3d-drag.js';
import * as THREE from '../libs/three/three.module.min.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const src = existsSync(join(ROOT, 'js/board3d.js')) ? read('js/board3d.js') : '';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---------------- A. 屏幕像素 → NDC ---------------- */
section('A. screenToNdc 像素→NDC 与非法输入防护');
{
  const rect = { left: 100, top: 50, width: 800, height: 600 };
  const c = screenToNdc(500, 350, rect);
  assert(near(c.x, 0) && near(c.y, 0), '画布中心 → (0,0)');
  const tl = screenToNdc(100, 50, rect);
  assert(near(tl.x, -1) && near(tl.y, 1), '左上角 → (-1,1)');
  const br = screenToNdc(900, 650, rect);
  assert(near(br.x, 1) && near(br.y, -1), '右下角 → (1,-1)');
  const right = screenToNdc(690, 350, rect);
  assert(near(right.x, 0.475) && near(right.y, 0), '右侧 190px → x=0.475（含 left/top 偏移）');
  assert(screenToNdc(NaN, 350, rect) === null, 'NaN 坐标 → null');
  assert(screenToNdc(500, 350, null) === null, 'null rect → null');
  assert(screenToNdc(500, 350, { left: 0, top: 0, width: 0, height: 600 }) === null, '零宽 rect → null');
  assert(screenToNdc(500, 350, { left: 0, top: 0, width: -1, height: 600 }) === null, '负宽 rect → null');
}

/* ---------------- B. 工作面自适应 ---------------- */
section('B. workPlaneForDrag 工作面选择（水平 / 面向相机）');
{
  const iso = workPlaneForDrag({ x: -0.5, y: -0.45, z: -0.7 }, { x: 1, y: 2, z: 3 });
  assert(iso.horizontal === true, '等轴视线 → 水平工作面');
  assert(JSON.stringify(iso.normal) === '[0,1,0]', '水平面法线 = [0,1,0]');
  assert(near(iso.constant, -2), '平面过被拖拽点：constant = -point.y');

  const top = workPlaneForDrag({ x: 0, y: -1, z: 0 }, { x: 0, y: 4, z: 0 });
  assert(top.horizontal === true && near(top.constant, -4), '俯视 → 水平面且高度守恒');

  const front = workPlaneForDrag({ x: 0, y: 0, z: -1 }, { x: 2, y: 1, z: 0 });
  assert(front.horizontal === false, '正视（|dir.y|=0）→ 切换面向相机平面');
  assert(JSON.stringify(front.normal) === '[0,0,-1]', '面向相机平面法线 = 单位视线');
  assert(near(front.normal[0] * 2 + front.normal[1] * 1 + front.normal[2] * 0 + front.constant, 0),
    '平面方程 n·point + c = 0 成立');

  const side = workPlaneForDrag({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  assert(side.horizontal === false && JSON.stringify(side.normal) === '[-1,0,0]', '侧视 → 面向相机平面');

  const diag = workPlaneForDrag({ x: 0, y: 0.24, z: 1 }, { x: 0, y: 0, z: 0 });
  assert(diag.horizontal === false, '|dir.y|<0.25 的斜视 → 面向相机平面');
  assert(workPlaneForDrag({ x: 0, y: 0.24, z: 1 }, { x: 0, y: 0, z: 0 }, 0.1).horizontal === true,
    '自定义 threshold=0.1 时同一视线仍保持水平面');
  assert(near(DRAG_THRESHOLD, 0.25), '默认阈值为 0.25（与历史实现口径一致）');
  assert(workPlaneForDrag({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 0).horizontal === false,
    '非法 threshold=0 → 回落默认阈值');
  assert(workPlaneForDrag(null, { x: 0, y: 0, z: 0 }) === null, '非法视线 → null');
  assert(workPlaneForDrag({ x: NaN, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }) === null, 'NaN 视线 → null');
}

/* ---------------- C. 射线与平面求交 ---------------- */
section('C. rayPlaneIntersect 求交与退化拒绝');
{
  const plane = { normal: [0, 1, 0], constant: -2, horizontal: true };
  const hit = rayPlaneIntersect({ x: 0, y: 6, z: 0 }, { x: 0.3, y: -1, z: -0.2 }, plane);
  assert(!!hit && near(hit[1], 2), '斜射线命中 y=2 平面');
  assert(!!hit && near(hit[0], 1.2) && near(hit[2], -0.8), '交点 x/z 按 t 比例正确');
  assert(rayPlaneIntersect({ x: 0, y: 6, z: 0 }, { x: 1, y: 0, z: 0 }, plane) === null,
    '射线与平面平行（denom=0）→ null，不产生瞬移');
  assert(rayPlaneIntersect({ x: 0, y: 6, z: 0 }, { x: 0, y: 1, z: 0 }, plane) === null,
    '交点在射线背后（t<0）→ null');
  assert(rayPlaneIntersect({ x: 0, y: 6, z: 0 }, { x: 0, y: -1, z: 0 }, { normal: [0, 1, 0], constant: NaN }) === null,
    '非法平面 constant → null');
  assert(rayPlaneIntersect({ x: Infinity, y: 6, z: 0 }, { x: 0, y: -1, z: 0 }, plane) === null,
    '非法射线原点 → null');
  assert(rayPlaneIntersect(null, { x: 0, y: -1, z: 0 }, plane) === null, 'null 输入 → null');
}

/* ---------------- D. 拖拽会话：高度守恒 / 数值防护 ---------------- */
section('D. createDragSession + dragTo 会话语义');
{
  const s = createDragSession({ x: -0.5, y: -0.45, z: -0.7 }, { x: 1, y: 2, z: 3 });
  assert(!!s && s.horizontal === true, '水平会话建立成功');
  assert(JSON.stringify(s.start) === '[1,2,3]', '会话记录起点坐标');
  const p = dragTo(s, { x: 4, y: 7, z: 9 }, { x: -0.3, y: -0.5, z: -0.6 });
  assert(!!p && near(p[1], 2, 1e-9), '水平拖拽强制高度守恒（Y 恒等于起点）');
  assert(!!p && p.every(Number.isFinite), '交点三分量均为有限数');

  const s2 = createDragSession({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 });
  assert(s2.horizontal === false, '面向相机会话 plane.horizontal=false');
  const p2 = dragTo(s2, { x: 0, y: 0, z: 14 }, { x: 0.2, y: 0, z: -1 });
  assert(!!p2 && near(p2[2], 0) && p2[0] > 0, '面向相机平面内随鼠标横向移动');

  // 求交退化：交点被推到 5 万单位外 → 拒绝，交互层保持原位
  const degenerate = dragTo(s, { x: 0, y: 5, z: 0 }, { x: 1, y: -0.0001, z: 0 });
  assert(degenerate === null, '近平行射线把交点推到 ±5 万 → 拒绝（不跳变）');
  assert(near(DRAG_COORD_LIMIT, 100), '坐标上限 100（场景网格 20，留足余量）');
  assert(dragTo(null, { x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }) === null, 'null 会话 → null');
  assert(dragTo(s, { x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }) === null, '零方向射线 → null');
  assert(createDragSession(null, { x: 0, y: 0, z: 0 }) === null, '非法输入不建立会话');
}

/* ---------------- E. 四视角真实相机射线拖拽（核心回归） ---------------- */
section('E. 四视角真实 Three.js 相机射线：90px 拖拽不跳变 / 不瞬移');
{
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  const VIEWS = [
    { name: '等轴', pos: [6, 5, 8], horizontal: true },
    { name: '俯视', pos: [0, 12, 0.001], horizontal: true },
    { name: '正视', pos: [0, 0, 14], horizontal: false },
    { name: '侧视', pos: [14, 0, 0], horizontal: false },
  ];
  const start = { x: 0, y: 0, z: 0 };
  for (const v of VIEWS) {
    const cam = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.1, 1000);
    cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    const viewDir = cam.getWorldDirection(new THREE.Vector3());
    const session = createDragSession(viewDir, start);
    assert(!!session && session.horizontal === v.horizontal, `${v.name}：工作面自适应判定正确`);

    const rc = new THREE.Raycaster();
    const shoot = (px, py) => {
      const ndc = screenToNdc(px, py, rect);
      rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
      return dragTo(session, rc.ray.origin, rc.ray.direction);
    };
    const h0 = shoot(400, 300);   // 画布中心
    const h1 = shoot(490, 300);   // 向右拖 90px
    assert(!!h0 && dist(h0, [0, 0, 0]) < 0.05, `${v.name}：中心射线回投到起点（误差 <0.05）`);
    assert(!!h1 && h1.every(Number.isFinite), `${v.name}：拖拽后交点有限`);
    const d = h1 ? dist(h0, h1) : Infinity;
    assert(d > 0.3 && d < 8, `${v.name}：90px 位移 ${d.toFixed(2)} 在合理区间 (0.3, 8)`);
    // 历史 bug：正视/侧视固定水平面时，90px 会把顶点瞬移到相机位置 ±14
    assert(h1 && dist(h1, v.pos) > 3, `${v.name}：未瞬移到相机位置（距相机 >3）`);
    if (v.horizontal) assert(h1 && near(h1[1], start.y, 1e-9), `${v.name}：高度守恒 Y=0`);
    assert(h1 && h1.every((n) => Math.abs(n) < DRAG_COORD_LIMIT), `${v.name}：交点在坐标上限内`);
  }

  // 连续多帧：单调推进、无单帧跳变
  const cam = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.1, 1000);
  cam.position.set(0, 0, 14); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const session = createDragSession(cam.getWorldDirection(new THREE.Vector3()), start);
  const rc = new THREE.Raycaster();
  let prev = null, maxStep = 0;
  for (let px = 400; px <= 580; px += 20) {
    const ndc = screenToNdc(px, 300, rect);
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
    const p = dragTo(session, rc.ray.origin, rc.ray.direction);
    if (!p) { maxStep = Infinity; break; }
    if (prev) maxStep = Math.max(maxStep, dist(prev, p));
    prev = p;
  }
  assert(maxStep < 1, `正视连续 10 帧拖拽单帧位移 ${maxStep.toFixed(3)} < 1（无跳变）`);
}

/* ---------------- F. 可拖拽类型白名单 ---------------- */
section('F. isDraggableType 白名单');
{
  assert(isDraggableType('point') === true, 'point 图元可拖拽');
  for (const t of ['box', 'sphere', 'label', 'line', 'plane', '', null, undefined]) {
    assert(isDraggableType(t) === false, `非点图元 ${String(t)} 走既有 gizmo，不启用拖拽`);
  }
}

/* ---------------- G. 接入静态断言 + 硬约束复核 ---------------- */
section('G. 真实 board3d.js 接入与硬约束静态复核');
{
  assert(src.length > 0, 'js/board3d.js 可读');
  assert(src.includes("from './board3d-drag.js'"), 'board3d.js 引入纯函数模块（相对路径可解析）');
  assert(existsSync(join(ROOT, 'js/board3d-drag.js')), 'js/board3d-drag.js 文件存在（ESM 依赖闭合）');
  for (const k of ['createDragSession', 'dragTo', 'tryStartPointDrag', 'onDragPointerMove',
    'endPointDrag', 'orbit.enabled = false', 'isDraggableType', 'screenToNdc']) {
    assert(src.includes(k), `board3d.js 已接入 ${k}（防实现被回退）`);
  }
  assert(!/from\s*['"](?:\.{1,2}\/)*(?:executor|board)\.js['"]/.test(src),
    '3D 内核未混入 2D 的 js/executor.js / js/board.js');
  const editorJs = read('js/editor.js');
  assert(editorJs.includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍保留大角 SDK import');
  assert(editorJs.includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  assert(read('board3d.html').includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

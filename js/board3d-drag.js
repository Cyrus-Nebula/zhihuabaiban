/**
 * 立体画板 —— 点拖拽「屏幕坐标反投影到工作面」（纯函数，不依赖 three / DOM）。
 *
 * 背景（回归用例 C3）：3D 画板原先只有点击拾取与 TransformControls gizmo，
 * 点图元无法直接用鼠标拖动。本模块把「屏幕像素 → 工作面交点」的数学抽成纯函数，
 * 供 js/board3d.js 的 pointer 交互层与无头回归共用同一事实源，
 * 因此刻意不引入 three，保证 `node tests/board3d_drag.mjs` 可独立运行。
 *
 * 工作面自适应规则沿用本仓库历史实现（f275a5b）验证过的口径：
 *  - 视线不接近水平（|dir.y| >= 0.25）：用「过点当前高度的水平面」，拖拽保持高度守恒；
 *  - 视线接近水平（正视 / 侧视）：水平面与射线近乎平行，求交会退化把点瞬移到相机
 *    附近（历史实测 90px 拖拽 → 顶点跳到 ±14）。此时切换为「面向相机的平面」，
 *    法线取单位视线，n·dir≈1，求交最稳定。
 *
 * 平面方程统一为 normal·x + constant = 0（可直接喂给 THREE.Plane.set）。
 */
export const DRAG_THRESHOLD = 0.25;   // |视线 y 分量| 低于此值 → 切面向相机平面
export const DRAG_COORD_LIMIT = 100;  // 交点坐标绝对值上限，超出即判定退化并拒绝
const EPS = 1e-6;

function isVec3(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * 屏幕像素坐标 → 归一化设备坐标（NDC，x/y ∈ [-1,1]）。
 * @param {number} clientX 相对视口的像素 X
 * @param {number} clientY 相对视口的像素 Y
 * @param {{left:number,top:number,width:number,height:number}} rect 画布 getBoundingClientRect()
 * @returns {{x:number,y:number}|null} 非法输入返回 null
 */
export function screenToNdc(clientX, clientY, rect) {
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
      rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

/**
 * 依据相机视线方向选择拖拽工作面（过被拖拽点当前位置）。
 * @param {{x:number,y:number,z:number}} viewDir 相机视线方向（不必单位化）
 * @param {{x:number,y:number,z:number}} point   被拖拽点当前坐标
 * @param {number} threshold |dir.y| 低于此值即判定「视线接近水平」
 * @returns {{normal:number[],constant:number,horizontal:boolean}|null}
 */
export function workPlaneForDrag(viewDir, point, threshold = DRAG_THRESHOLD) {
  if (!isVec3(viewDir) || !isVec3(point)) return null;
  const len = Math.hypot(viewDir.x, viewDir.y, viewDir.z) || 1;
  const t = Number.isFinite(threshold) && threshold > 0 ? threshold : DRAG_THRESHOLD;
  if (Math.abs(viewDir.y / len) >= t) {
    return { normal: [0, 1, 0], constant: -point.y, horizontal: true };
  }
  const n = [viewDir.x / len, viewDir.y / len, viewDir.z / len];
  return {
    normal: n,
    constant: -(n[0] * point.x + n[1] * point.y + n[2] * point.z),
    horizontal: false,
  };
}

/**
 * 射线与平面求交：x = origin + t*dir，代入 normal·x + constant = 0。
 * 平行（|n·dir| < eps）或交点落在射线背后（t < 0）一律返回 null，
 * 避免把点瞬移到极远处 / 相机背后。
 * @returns {[number,number,number]|null} 世界坐标交点
 */
export function rayPlaneIntersect(origin, dir, plane, eps = EPS) {
  if (!isVec3(origin) || !isVec3(dir) || !plane ||
      !Array.isArray(plane.normal) || plane.normal.length !== 3 ||
      !Number.isFinite(plane.constant)) return null;
  const n = plane.normal;
  const denom = n[0] * dir.x + n[1] * dir.y + n[2] * dir.z;
  if (!Number.isFinite(denom) || Math.abs(denom) < eps) return null;
  const numer = -(n[0] * origin.x + n[1] * origin.y + n[2] * origin.z + plane.constant);
  const t = numer / denom;
  if (!Number.isFinite(t) || t < 0) return null;
  const hit = [origin.x + t * dir.x, origin.y + t * dir.y, origin.z + t * dir.z];
  return hit.every(Number.isFinite) ? hit : null;
}

/** 仅点图元支持直接拖拽；其余图元仍走既有的 TransformControls gizmo。 */
export function isDraggableType(type) {
  return type === 'point';
}

/**
 * 建立一次拖拽会话：工作面在 pointerdown 时固定，整段拖拽不重算，
 * 避免每帧按新位置重定平面造成漂移 / 跳变。
 */
export function createDragSession(viewDir, startPoint, threshold) {
  const plane = workPlaneForDrag(viewDir, startPoint, threshold);
  if (!plane || !isVec3(startPoint)) return null;
  return {
    plane,
    start: [startPoint.x, startPoint.y, startPoint.z],
    horizontal: plane.horizontal,
  };
}

/**
 * 拖拽中每一帧：把当前射线投到会话工作面上，得到点的新位置。
 * 防护：非有限值 / 超出坐标上限（求交退化）返回 null，交互层保持原位不动，实现「不跳变」。
 * 水平工作面强制高度守恒（Y 恒等于起点高度），消除累计浮点漂移。
 * @returns {[number,number,number]|null}
 */
export function dragTo(session, rayOrigin, rayDir) {
  if (!session || !session.plane) return null;
  const hit = rayPlaneIntersect(rayOrigin, rayDir, session.plane);
  if (!hit) return null;
  if (hit.some((v) => Math.abs(v) > DRAG_COORD_LIMIT)) return null;
  if (session.horizontal) hit[1] = session.start[1];
  return hit;
}

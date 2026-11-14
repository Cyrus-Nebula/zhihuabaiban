/**
 * 3D 画板「基础图元规格 / 构造 / 材质」纯函数层（回归清单 B 组）。
 *
 * 与 js/board3d-drag.js / js/board3d-axis.js 同口径：本模块 **不 import three、不碰 DOM**，
 * THREE 由调用方注入，因此可在 Node 无头环境直接 import 本地 vendor 的 Three.js r160
 * 构造真实 BufferGeometry 做断言（不需要 WebGL 上下文）。
 *
 * 职责（本轮增量）：
 *   - 固化 11 种图元（含 label 锚点型）的参数键与默认值，和 AI 执行器
 *     js/board3d-executor.js 的 BOARD3D_PARAM_KEYS 一一对应（防止协议/内核漂移）；
 *   - 对来自 AI 命令、导入工程文件、属性面板的几何参数做数值化 + 白名单 + 钳制，
 *     避免 NaN / 负半径 / 超大尺寸把 Three.js 几何打成 NaN 顶点或空几何；
 *   - 集中几何构造（含平面默认水平、线段端点定向圆柱）与材质配置
 *     （平面双面、半透明体 depthWrite:false）与透明体由远及近的 renderOrder 规格。
 *
 * js/board3d.js 的 SHAPE_DEFS 保留 name/params（属性面板依赖），几何构造统一委托到此模块。
 * 本文件不引用、不修改任何 2D 代码，也不触碰共享文件 ai/board-prompt.js。
 */

/** 每种图元允许的几何参数键（与 js/board3d-executor.js 的 BOARD3D_PARAM_KEYS 严格对齐） */
export const BOARD3D_SHAPE_KEYS = Object.freeze({
  box: ['w', 'h', 'd'],
  sphere: ['r'],
  cylinder: ['rt', 'rb', 'h'],
  cone: ['r', 'h'],
  pyramid: ['s', 'h'],
  prism: ['r', 'h'],
  tetra: ['s'],
  plane: ['w', 'h'],
  line: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'],
  point: ['s'],
  circle: ['r'],
  polygon: ['n', 'r'],
  label: [], // 锚点型，无 3D 几何（HTML 叠加层）
});

/** 几何参数默认值（与 js/board3d.js 的 SHAPE_DEFS.params.d 逐项一致） */
export const BOARD3D_SHAPE_DEFAULTS = Object.freeze({
  box: Object.freeze({ w: 2, h: 2, d: 2 }),
  sphere: Object.freeze({ r: 1.2 }),
  cylinder: Object.freeze({ rt: 1, rb: 1, h: 2.4 }),
  cone: Object.freeze({ r: 1, h: 2.4 }),
  pyramid: Object.freeze({ s: 2, h: 2.4 }),
  prism: Object.freeze({ r: 1, h: 2.4 }),
  tetra: Object.freeze({ s: 2 }),
  plane: Object.freeze({ w: 3, h: 3 }),
  line: Object.freeze({ x1: -1.5, y1: 0, z1: 0, x2: 1.5, y2: 0, z2: 0 }),
  point: Object.freeze({ s: 0.18 }),
  circle: Object.freeze({ r: 1.2 }),
  polygon: Object.freeze({ n: 6, r: 1.2 }),
  label: Object.freeze({}),
});

export const BOARD3D_SHAPE_TYPES = Object.freeze(Object.keys(BOARD3D_SHAPE_KEYS));

/** 参数防护边界：尺寸下限/上限、线段端点坐标绝对值上限 */
export const DIM_MIN = 0.01;
export const DIM_MAX = 1000;
export const COORD_LIMIT = 10000;
export const OPACITY_MIN = 0.1;

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组/Infinity）一律拒绝 */
export function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 该类型几何参数的默认浅拷贝；未知类型返回 null */
export function defaultShapeParams(type) {
  const d = BOARD3D_SHAPE_DEFAULTS[type];
  return d ? Object.assign({}, d) : null;
}

/**
 * 几何参数规范化：键白名单 → 严格数值化 → 分类钳制 → 缺省回落默认值。
 * 尺寸类（w/h/d/r/rt/rb/s 与 h）钳制到 [DIM_MIN, DIM_MAX]；
 * 端点坐标类（x1..z2）允许负值，钳制到 [-COORD_LIMIT, COORD_LIMIT]。
 * 未知类型返回 null，label 返回 {}（无几何参数）。
 */
export function normalizeShapeParams(type, raw) {
  const keys = BOARD3D_SHAPE_KEYS[type];
  if (!keys) return null;
  const def = BOARD3D_SHAPE_DEFAULTS[type];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of keys) {
    const n = num(src[k]);
    if (n === null) { out[k] = def[k]; continue; }
    // polygon 边数：整数，钳制到 [3,12]（CircleGeometry 至少 3 段，过多无意义）
    if (k === 'n') { out[k] = Math.min(12, Math.max(3, Math.round(n))); continue; }
    const isCoord = k[0] === 'x' || k[0] === 'y' || k[0] === 'z';
    if (isCoord) out[k] = Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, n));
    else out[k] = Math.min(DIM_MAX, Math.max(DIM_MIN, n));
  }
  return out;
}

/** 线段：以两端点为端点、半径 0.05 的圆柱（与历史 lineGeo 行为一致，额外防护退化端点） */
export function lineGeometry(THREE, p) {
  const a = new THREE.Vector3(p.x1, p.y1, p.z1);
  const b = new THREE.Vector3(p.x2, p.y2, p.z2);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.05, 0.05, len || 0.001, 12);
  if (len > 1e-9) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    geo.applyQuaternion(q);
  }
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

/**
 * 构造真实 BufferGeometry。THREE 由调用方注入（浏览器传 import 的 three，
 * 无头回归传本地 vendor 的 three.module.min.js），因此本模块保持纯函数可测。
 * 平面默认绕 X 轴转 -90° 变成水平面；label / 未知类型返回 null。
 */
export function createShapeGeometry(THREE, type, params) {
  if (!THREE) return null;
  const p = normalizeShapeParams(type, params);
  if (!p) return null;
  switch (type) {
    case 'box':      return new THREE.BoxGeometry(p.w, p.h, p.d);
    case 'sphere':   return new THREE.SphereGeometry(p.r, 40, 28);
    case 'cylinder': return new THREE.CylinderGeometry(p.rt, p.rb, p.h, 48);
    case 'cone':     return new THREE.ConeGeometry(p.r, p.h, 48);
    case 'pyramid':  return new THREE.ConeGeometry(p.s * 0.7, p.h, 4);
    case 'prism':    return new THREE.CylinderGeometry(p.r, p.r, p.h, 3);
    case 'tetra':    return new THREE.TetrahedronGeometry(p.s);
    case 'plane': {
      const g = new THREE.PlaneGeometry(p.w, p.h);
      g.rotateX(-Math.PI / 2); // 让平面默认水平（背面因材质 DoubleSide 仍可见）
      return g;
    }
    case 'line':  return lineGeometry(THREE, p);
    case 'point': return new THREE.SphereGeometry(p.s, 16, 12);
    case 'circle': {
      const g = new THREE.CircleGeometry(p.r, 64); // 圆面：64 段近似为光滑圆盘
      g.rotateX(-Math.PI / 2);                     // 默认水平放置（与 plane 同口径）
      return g;
    }
    case 'polygon': {
      const seg = Math.max(3, Math.min(64, Math.round(p.n) || 6)); // n 边正多边形面（CircleGeometry 段数=N）
      const g = new THREE.CircleGeometry(p.r, seg);
      g.rotateX(-Math.PI / 2);                     // 默认水平放置
      return g;
    }
    default:      return null; // label（HTML 叠加层）/ 未知类型：无 3D 几何
  }
}

/**
 * 材质配置：半透明体不写深度（避免重叠透明体互相错误剔除 / z-fighting），
 * 平面双侧可见；opacity 非法值回落 1，并钳制到 [0.1, 1]。
 * 返回 side 为语义字符串，由调用方映射成 THREE.DoubleSide / THREE.FrontSide。
 */
export function shapeMaterialConfig(type, opacity) {
  const n = num(opacity);
  const op = n === null ? 1 : Math.min(1, Math.max(OPACITY_MIN, n));
  return {
    opacity: op,
    transparent: op < 1,
    depthWrite: op >= 1,
    side: (type === 'plane' || type === 'circle' || type === 'polygon') ? 'double' : 'front',
  };
}

/**
 * 透明体每帧 renderOrder：按「几何中心到相机距离」取负值（远者更小 → 先画），
 * 实现由远及近稳定混合。非法输入返回 0，避免 NaN 污染渲染顺序。
 */
export function transparentRenderOrder(camPos, worldPos) {
  if (!camPos || !worldPos) return 0;
  const dx = worldPos.x - camPos.x;
  const dy = worldPos.y - camPos.y;
  const dz = worldPos.z - camPos.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  return Number.isFinite(d2) ? -Math.sqrt(d2) : 0;
}

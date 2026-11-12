/**
 * 立体画板「视角变换与重置」纯函数层（回归清单 C1 / C2）。
 *
 * 与 js/board3d-geometry.js / js/board3d-drag.js 同口径：不 import three、不碰 DOM，
 * 只产出「相机规格」{ fov, near, far, position:[x,y,z], target:[x,y,z], up:[0,1,0] }，
 * 由 js/board3d.js 把规格套到真实的 THREE.PerspectiveCamera + OrbitControls 上。
 *
 * 抽成纯函数的目的：让「左键旋转 / 滚轮缩放 / 视角预设 / 重置视角」的数学口径能被
 * tests/board3d_view.mjs 用本地 vendor 的 Three.js r160 真实相机 / Spherical 断言锁定，
 * 避免内核重构或 vendor 升级把已修好的视角行为打回原形。
 * 像素级目视仍按回归清单 A9 口径，待带 GPU 的环境补跑。
 *
 * 约定（与 OrbitControls 一致）：
 *   - 相机 up 恒为 +Y，极角 phi 从 +Y 轴起算，方位角 theta = atan2(x, z)；
 *   - phi 钳制在 [PHI_EPS, PI - PHI_EPS]，避免视线与 up 共线导致 lookAt 翻转；
 *   - 相机到 target 的距离（球半径）钳制在 [MIN_RADIUS, MAX_RADIUS]，防穿模 / 飞出远裁剪面。
 */

/** 默认机位：与历史 init() 的 (6,5,8) / target(0,0,0) / fov 50 逐项一致 */
export const DEFAULT_VIEW = Object.freeze({
  fov: 50,
  near: 0.1,
  far: 1000,
  position: Object.freeze([6, 5, 8]),
  target: Object.freeze([0, 0, 0]),
  up: Object.freeze([0, 1, 0]),
});

export const MIN_RADIUS = 1.5;
export const MAX_RADIUS = 60;
/** 极角最小余量（弧度）：约 2.9°，保证俯视/仰视时相机 up 仍可判定 */
export const PHI_EPS = 0.05;

export const VIEW_PRESET_NAMES = Object.freeze([
  'iso', 'front', 'right', 'back', 'left', 'top', 'bottom',
]);

const PI = Math.PI;
const HALF_PI = PI / 2;
const DEFAULT_RADIUS = Math.hypot(...DEFAULT_VIEW.position);

/* ---------------- 数值工具 ---------------- */

function num(v, def) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

function vec3(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def.slice();
  const out = v.map((x) => num(x, null));
  return out.every((x) => x !== null) ? out : def.slice();
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/* ---------------- 规格构造 / 规范化 ---------------- */

/** 重置规格：返回可变的深拷贝（改返回值不会污染 DEFAULT_VIEW） */
export function resetViewSpec() {
  return {
    fov: DEFAULT_VIEW.fov,
    near: DEFAULT_VIEW.near,
    far: DEFAULT_VIEW.far,
    position: DEFAULT_VIEW.position.slice(),
    target: DEFAULT_VIEW.target.slice(),
    up: DEFAULT_VIEW.up.slice(),
  };
}

/**
 * 相机规格 → 球坐标（与 THREE.Spherical.setFromVector3 同口径）。
 * @returns {{ radius:number, theta:number, phi:number }}
 */
export function sphericalFromSpec(spec) {
  const s = spec && typeof spec === 'object' ? spec : resetViewSpec();
  const pos = vec3(s.position, DEFAULT_VIEW.position);
  const tgt = vec3(s.target, DEFAULT_VIEW.target);
  const dx = pos[0] - tgt[0], dy = pos[1] - tgt[1], dz = pos[2] - tgt[2];
  const radius = Math.hypot(dx, dy, dz);
  if (radius < 1e-9) return { radius: 0, theta: 0, phi: HALF_PI };
  return {
    radius,
    theta: Math.atan2(dx, dz),
    phi: Math.acos(clamp(dy / radius, -1, 1)),
  };
}

/**
 * 球坐标 → 相机位置（与 THREE.Vector3.setFromSpherical 同口径）。
 * @returns {number[]} [x,y,z]
 */
export function cameraFromSpherical(spherical, target) {
  const t = vec3(target, DEFAULT_VIEW.target);
  const r = clamp(num(spherical && spherical.radius, DEFAULT_RADIUS), MIN_RADIUS, MAX_RADIUS);
  const theta = num(spherical && spherical.theta, 0);
  const phi = clamp(num(spherical && spherical.phi, HALF_PI), PHI_EPS, PI - PHI_EPS);
  const sinPhiR = Math.sin(phi) * r;
  return [
    t[0] + sinPhiR * Math.sin(theta),
    t[1] + Math.cos(phi) * r,
    t[2] + sinPhiR * Math.cos(theta),
  ];
}

/**
 * 校验并规范化任意外部输入（AI 命令 / 导入工程 / UI 传参）：
 *   - 非法坐标、NaN、Infinity、数组长度错误一律回落默认值；
 *   - up 恒为 +Y（OrbitControls 口径，杜绝相机翻转）；
 *   - 半径越界或相机与 target 重合时按球坐标重新投影，保证规格永远可用。
 * @returns {Object} 新的可变规格
 */
export function normalizeViewSpec(raw) {
  const base = resetViewSpec();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const fov = clamp(num(raw.fov, base.fov), 10, 120);
  const near = clamp(num(raw.near, base.near), 0.001, 100);
  const farRaw = num(raw.far, base.far);
  const far = Math.max(near + 1, clamp(farRaw, 1, 100000));
  const position = vec3(raw.position, base.position);
  const target = vec3(raw.target, base.target);
  const s = sphericalFromSpec({ position, target });
  const radius = s.radius < 1e-9
    ? DEFAULT_RADIUS
    : clamp(s.radius, MIN_RADIUS, MAX_RADIUS);
  const theta = s.radius < 1e-9 ? sphericalFromSpec(base).theta : s.theta;
  const phi = s.radius < 1e-9
    ? sphericalFromSpec(base).phi
    : clamp(s.phi, PHI_EPS, PI - PHI_EPS);
  return {
    fov, near, far,
    position: cameraFromSpherical({ radius, theta, phi }, target),
    target,
    up: [0, 1, 0],
  };
}

/** 预设方位（theta=0 为 +Z 正视，theta=PI/2 为 +X 右视；phi 从 +Y 起算） */
const PRESET_ANGLES = Object.freeze({
  front:  [0, HALF_PI],
  right:  [HALF_PI, HALF_PI],
  back:   [PI, HALF_PI],
  left:   [-HALF_PI, HALF_PI],
  top:    [0, PHI_EPS],
  bottom: [0, PI - PHI_EPS],
});

/**
 * 命名视角预设。iso 直接由 DEFAULT_VIEW 的球坐标还原（位置逐项一致）。
 * @param {string} name  VIEW_PRESET_NAMES 之一
 * @param {number} [radius] 相机到 target 的距离，默认与 DEFAULT_VIEW 相同
 * @returns {Object|null} 规格；未知名称返回 null
 */
export function viewPresetSpec(name, radius) {
  if (name === 'iso') {
    const d = sphericalFromSpec(DEFAULT_VIEW);
    const r = clamp(num(radius, d.radius), MIN_RADIUS, MAX_RADIUS);
    const spec = resetViewSpec();
    spec.position = cameraFromSpherical({ radius: r, theta: d.theta, phi: d.phi }, spec.target);
    return spec;
  }
  const angles = PRESET_ANGLES[name];
  if (!angles) return null;
  const r = clamp(num(radius, DEFAULT_RADIUS), MIN_RADIUS, MAX_RADIUS);
  const spec = resetViewSpec();
  spec.position = cameraFromSpherical(
    { radius: r, theta: angles[0], phi: angles[1] }, spec.target,
  );
  return spec;
}

/**
 * 轨道变换（C1）：左键拖拽 → dTheta/dPhi，滚轮 → dolly，右键 → pan。
 * 全部为纯增量，返回新规格；极角与半径自动钳制，up 恒为 +Y。
 * @param {Object} spec 当前规格
 * @param {Object} delta { dTheta=0, dPhi=0, dolly=1, pan=[0,0,0] }
 */
export function orbitViewSpec(spec, delta) {
  const s = normalizeViewSpec(spec);
  const d = delta && typeof delta === 'object' ? delta : {};
  const sp = sphericalFromSpec(s);
  const dolly = num(d.dolly, 1);
  const radius = clamp(sp.radius * (dolly > 0 ? dolly : 1), MIN_RADIUS, MAX_RADIUS);
  const theta = sp.theta + num(d.dTheta, 0);
  const phi = clamp(sp.phi + num(d.dPhi, 0), PHI_EPS, PI - PHI_EPS);
  const pan = vec3(d.pan, [0, 0, 0]);
  const target = s.target.map((v, i) => v + pan[i]);
  return {
    fov: s.fov, near: s.near, far: s.far,
    position: cameraFromSpherical({ radius, theta, phi }, target),
    target,
    up: [0, 1, 0],
  };
}

/** 滚轮缩放（C1）：factor>1 拉远、<1 拉近，半径钳制在 [MIN_RADIUS, MAX_RADIUS] */
export function zoomViewSpec(spec, factor) {
  return orbitViewSpec(spec, { dolly: num(factor, 1) });
}

/** 规格健康度自检：全有限 / up 为 +Y / 半径在合法区间 / 相机不与 target 重合 */
export function isViewSpecValid(spec) {
  if (!spec || typeof spec !== 'object') return false;
  const pos = spec.position, tgt = spec.target, up = spec.up;
  if (!Array.isArray(pos) || !Array.isArray(tgt) || !Array.isArray(up)) return false;
  if (![...pos, ...tgt, ...up].every((x) => typeof x === 'number' && Number.isFinite(x))) return false;
  if (up[0] !== 0 || up[1] !== 1 || up[2] !== 0) return false;
  const r = Math.hypot(pos[0] - tgt[0], pos[1] - tgt[1], pos[2] - tgt[2]);
  return r >= MIN_RADIUS - 1e-6 && r <= MAX_RADIUS + 1e-6;
}

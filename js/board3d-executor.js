/**
 * 立体画板 AI 命令执行器（路线B）
 *
 * 与 js/executor.js（2D / JSXGraph 命令协议）完全平行、互不引用：
 *   - 本文件只认 3D 命令（add3d / label3d / update3d / remove3d / clear3d / view3d / reset3d / measure3d / transform3d）；
 *   - 不 import three、不碰 DOM，是**纯函数**，因此可在 Node 无头环境直接回归；
 *   - 所有画板副作用通过注入的 api 完成（由 js/board3d.js 的 board3dApi 提供）。
 *
 * 命令 -> 对象模型映射：add3d 产出的 obj 结构就是 board3d.js 的持久化对象
 *   { id, type, text, color, opacity, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z], p:{几何参数} }
 *   type 白名单与 board3d.js 的 SHAPE_DEFS 一一对应；几何参数缺省值由 board3d.js 补齐
 *   （本文件只校验键名合法性，不复制一份默认值，避免两处漂移）。
 *
 * 2026-11-14 增量：新增只读量测命令 measure3d（距离 / 夹角 / 中点），
 * 语义在 js/board3d-measure.js；既有 7 条命令的白名单 BOARD3D_OPS 保持不变，
 * 扩展命令单独成组，以免与共享文件 ai/board-prompt.js 的既有协议一致性断言冲突。
 */

import { resolveMeasure3D, measureToLabelSpec } from './board3d-measure.js';
import { resolveTransform3D, resolveTransform3DBatch } from './board3d-transform.js';
import { resolveDuplicate3D, resolveRadial3D, resolveMirror3D, resolveGrid3D } from './board3d-duplicate.js';
import { resolveAlign3D, resolveAlign3DMultiAxis } from './board3d-align.js';
import { resolveHelix3D } from './board3d-helix.js';
import { resolveBezier3D } from './board3d-bezier.js';
import { resolveArc3D } from './board3d-arc.js';
import { resolvePolyhedron3D } from './board3d-polyhedron.js';
import { resolveRevolve3D } from './board3d-revolve.js';
import { resolveTorus3D } from './board3d-torus.js';
import { resolveEllipsoid3D } from './board3d-ellipsoid.js';
import { resolveCapsule3D } from './board3d-capsule.js';
import { resolveTube3D } from './board3d-tube.js';
import { resolvePrism3D } from './board3d-prism.js';
import { resolvePyramid3D } from './board3d-pyramid.js';
import { resolveFrustum3D } from './board3d-frustum.js';
import { resolveVector3D } from './board3d-vector.js';
import { resolveCone3D } from './board3d-cone.js';
import { resolveCylinder3D } from './board3d-cylinder.js';
import { resolvePlane3D } from './board3d-plane.js';
import { resolveConefrustum3D } from './board3d-conefrustum.js';
import { resolveDihedral3D } from './board3d-dihedral.js';
import { resolveLineplane3D } from './board3d-lineplane.js';
import { resolvePointplane3D } from './board3d-pointplane.js';
import { resolveSkewline3D } from './board3d-skewline.js';
import { resolveLineangle3D } from './board3d-lineangle.js';
import { resolvePointline3D } from './board3d-pointline.js';
import { resolveRelation3D } from './board3d-relation.js';
import { resolveCircumsphere3D } from './board3d-circumsphere.js';
import { resolveInsphere3D } from './board3d-insphere.js';
import { resolveEuler3D } from './board3d-euler.js';
import { resolveCentroid3D } from './board3d-centroid.js';
import { resolveSolidmetrics3D } from './board3d-solidmetrics.js';
import { resolveSectionsphere3D } from './board3d-sectionsphere.js';
import { resolveCircumcircle3D } from './board3d-circumcircle.js';

// 2026-11-15 D8 增量：transform3d 增加「ids 批量写法」（不是新 op）。
// 下方全部 BOARD3D_*_OPS 历史契约常量与既有 8 条命令分支逐字未动。

/** 每种图元允许的几何参数键（与 js/board3d.js 的 SHAPE_DEFS.params 对齐） */
export const BOARD3D_PARAM_KEYS = Object.freeze({
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
  label: [],
});

export const BOARD3D_TYPES = Object.freeze(Object.keys(BOARD3D_PARAM_KEYS));

export const BOARD3D_OPS = Object.freeze([
  'add3d', 'label3d', 'update3d', 'remove3d', 'clear3d', 'view3d', 'reset3d',
]);

/**
 * 扩展命令（2026-11-14）：空间量测 measure3d，只读、不改动画板对象。
 * 单独成组，既有 BOARD3D_OPS 仍恒为 7 条 —— ai/board-prompt.js 是共享文件，
 * 按协作铁律只追加段落，因此两侧既有白名单必须保持逐项一致。
 */
export const BOARD3D_MEASURE_OPS = Object.freeze(['measure3d']);

/** 3D 分支完整命令集（既有 7 条 + 本轮扩展），供文档 / 回归核对 */
export const BOARD3D_ALL_OPS = Object.freeze([...BOARD3D_OPS, ...BOARD3D_MEASURE_OPS]);

/**
 * 2026-11-15 增量：相对变换命令 transform3d（语义在 js/board3d-transform.js）。
 * 单独成组、不并入 BOARD3D_ALL_OPS —— 后者是共享文件既有协议一致性断言的
 * 历史契约（既有 7 条 + measure3d = 8 条），按协作铁律保持逐字不变，避免既有回归被破坏。
 * BOARD3D_FULL_OPS 才是含全部扩展命令的完整集（9 条），供文档 / 本轮回归核对。
 */
export const BOARD3D_TRANSFORM_OPS = Object.freeze(['transform3d']);
export const BOARD3D_FULL_OPS = Object.freeze([
  ...BOARD3D_ALL_OPS, ...BOARD3D_TRANSFORM_OPS,
]);

/**
 * 2026-11-16 D9 增量：复制对象命令 duplicate3d（语义在 js/board3d-duplicate.js）。
 * 单独成组、不并入 BOARD3D_OPS / BOARD3D_ALL_OPS / BOARD3D_FULL_OPS —— 后三者是
 * 共享文件协议一致性断言的历史契约（7 / 8 / 9 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_DUPLICATE_OPS = Object.freeze(['duplicate3d']);
/** 含全部扩展命令的完整集（10 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE_OPS = Object.freeze([
  ...BOARD3D_FULL_OPS, ...BOARD3D_DUPLICATE_OPS,
]);

/**
 * 2026-11-16 D10 增量：环形阵列命令 radial3d（语义在 js/board3d-duplicate.js）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_RADIAL_OPS = Object.freeze(['radial3d']);
/** 含全部扩展命令的完整集（11 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE2_OPS = Object.freeze([
  ...BOARD3D_COMPLETE_OPS, ...BOARD3D_RADIAL_OPS,
]);

/**
 * 2026-11-16 D11 增量：镜像复制命令 mirror3d（语义在 js/board3d-duplicate.js）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 / COMPLETE2 11 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_MIRROR_OPS = Object.freeze(['mirror3d']);
/** 含全部扩展命令的完整集（12 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE3_OPS = Object.freeze([
  ...BOARD3D_COMPLETE2_OPS, ...BOARD3D_MIRROR_OPS,
]);

/**
 * 2026-11-17 D12 增量：矩形 / 立体网格阵列命令 grid3d（语义在 js/board3d-duplicate.js）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_GRID_OPS = Object.freeze(['grid3d']);
/** 含全部扩展命令的完整集（13 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE4_OPS = Object.freeze([
  ...BOARD3D_COMPLETE3_OPS, ...BOARD3D_GRID_OPS,
]);

/**
 * 2026-11-17 D13 增量：多对象对齐 / 等距分布命令 align3d（语义在 js/board3d-align.js）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_ALIGN_OPS = Object.freeze(['align3d']);
/** 含全部扩展命令的完整集（14 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE5_OPS = Object.freeze([
  ...BOARD3D_COMPLETE4_OPS, ...BOARD3D_ALIGN_OPS,
]);

/**
 * 2026-11-17 D14 增量：空间螺旋线 / 弹簧命令 helix3d（语义在 js/board3d-helix.js）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 条），
 * 按协作铁律保持逐字不变。
 */
export const BOARD3D_HELIX_OPS = Object.freeze(['helix3d']);
/** 含全部扩展命令的完整集（15 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE6_OPS = Object.freeze([
  ...BOARD3D_COMPLETE5_OPS, ...BOARD3D_HELIX_OPS,
]);

/**
 * 2026-11-17 D15 增量：3D 贝塞尔曲线命令 bezier3d（语义在 js/board3d-bezier.js）。
 * 与 helix3d（固定参数方程）互补：形状由用户给定的控制点列决定，de Casteljau 递推采样。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 条），
 * 按协作铁律保持逐字不变。
 */
export const BOARD3D_BEZIER_OPS = Object.freeze(['bezier3d']);
/** 含全部扩展命令的完整集（16 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE7_OPS = Object.freeze([
  ...BOARD3D_COMPLETE6_OPS, ...BOARD3D_BEZIER_OPS,
]);

/**
 * 2026-11-18 D16 增量：3D 空间圆弧命令 arc3d（语义在 js/board3d-arc.js）。
 * 与 helix3d（螺旋）/ bezier3d（控制点自由曲线）互补：圆心 + 半径 + 法向轴 + 起止角
 * 生成真圆弧。单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 /
 * COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 /
 * COMPLETE6 15 / COMPLETE7 16 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_ARC_OPS = Object.freeze(['arc3d']);
/** 含全部扩展命令的完整集（17 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE8_OPS = Object.freeze([
  ...BOARD3D_COMPLETE7_OPS, ...BOARD3D_ARC_OPS,
]);

/**
 * 2026-11-19 D17 增量：3D 正多面体（柏拉图立体）线框命令 polyhedron3d（语义在 js/board3d-polyhedron.js）。
 * 补齐 tetra 之外缺失的正八面体 / 正十二面体 / 正二十面体，以「棱 + 顶点小球 + 顶点标注」呈现。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_POLYHEDRON_OPS = Object.freeze(['polyhedron3d']);
/** 含全部扩展命令的完整集（18 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE9_OPS = Object.freeze([
  ...BOARD3D_COMPLETE8_OPS, ...BOARD3D_POLYHEDRON_OPS,
]);

/**
 * 2026-11-19 D19 增量：3D 旋转体 / 回转面命令 revolve3d（语义在 js/board3d-revolve.js）。
 * 一条母线 profile 绕轴均匀旋转生成线框（经线 + 纬线圈 + 可选采样点），能表达圆台 / 圆锥 /
 * 球 / 花瓶 / 双曲面等内置图元无法覆盖的回转面，与 radial3d（离散复制）/ polyhedron3d（多面体）互补。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_REVOLVE_OPS = Object.freeze(['revolve3d']);
/** 含全部扩展命令的完整集（19 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE10_OPS = Object.freeze([
  ...BOARD3D_COMPLETE9_OPS, ...BOARD3D_REVOLVE_OPS,
]);

/**
 * 2026-11-19 D20 增量：3D 圆环面 / 轮胎面命令 torus3d（语义在 js/board3d-torus.js）。
 * 标准圆环面只需 R（主圆半径）/ r（管半径）两参数，自动按参数方程生成经线圆 + 纬线圈，
 * 是标准回转面的高层封装，与任意母线 revolve3d 互补（revolve3d 需手写一圈母线采样点）。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 / COMPLETE10 19 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_TORUS_OPS = Object.freeze(['torus3d']);
/** 含全部扩展命令的完整集（20 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE11_OPS = Object.freeze([
  ...BOARD3D_COMPLETE10_OPS, ...BOARD3D_TORUS_OPS,
]);

/**
 * 2026-11-20 D21 增量：3D 椭球命令 ellipsoid3d（语义在 js/board3d-ellipsoid.js）。
 * 三半轴 a/b/c 生成椭球面线框（经线 + 纬线圈 + 可选采样点），补齐内置 sphere
 * 只能等半径的缺口，与 revolve3d（任意母线，只能两轴相等的旋转椭球）/ torus3d（圆环面）互补。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 条），
 * 按协作铁律保持逐字不变。
 */
export const BOARD3D_ELLIPSOID_OPS = Object.freeze(['ellipsoid3d']);
/** 含全部扩展命令的完整集（21 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE12_OPS = Object.freeze([
  ...BOARD3D_COMPLETE11_OPS, ...BOARD3D_ELLIPSOID_OPS,
]);

/**
 * 2026-11-21 D22 增量：3D 胶囊体命令 capsule3d（语义在 js/board3d-capsule.js）。
 * 半径 radius + 两球心距 length 生成胶囊面线框（经线 + 纬线圈 + 可选采样点），
 * 补齐内置图元无胶囊体的缺口，与 ellipsoid3d（三轴椭球无直筒段）/ revolve3d
 * （任意母线需手写）/ torus3d（有洞圆环面）互补。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 /
 * COMPLETE12 21 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_CAPSULE_OPS = Object.freeze(['capsule3d']);
/** 含全部扩展命令的完整集（22 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE13_OPS = Object.freeze([
  ...BOARD3D_COMPLETE12_OPS, ...BOARD3D_CAPSULE_OPS,
]);

/**
 * 2026-11-22 D23 增量：3D 管道命令 tube3d（语义在 js/board3d-tube.js）。
 * 沿任意 3D 中心路径 path 扫掠一个半径 radius 的圆截面，生成横截面圆环 +
 * 沿路径母线（+ 可选采样点）线框，用平行移动标架保证截面始终垂直于路径切向；
 * 补齐内置图元只能画直管、helix/arc/bezier 只能画中心线（无截面）的缺口。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 /
 * COMPLETE12 21 / COMPLETE13 22 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_TUBE_OPS = Object.freeze(['tube3d']);
/** 含全部扩展命令的完整集（23 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE14_OPS = Object.freeze([
  ...BOARD3D_COMPLETE13_OPS, ...BOARD3D_TUBE_OPS,
]);

/**
 * 2026-11-22 D24 增量：3D 通用棱柱 prism3d（任意底面多边形 + 任意拉伸向量 / 轴向高度，
 * 生成底面 + 顶面 + 侧棱线框，可选顶点球与 A/B/C 顶点标注），补齐内置 prism 只能画
 * 正多边形直棱柱、无法画任意底面 / 斜棱柱的缺口。
 * 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
 * COMPLETE2 11 / COMPLETE3 12 / COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 /
 * COMPLETE7 16 / COMPLETE8 17 / COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 /
 * COMPLETE12 21 / COMPLETE13 22 / COMPLETE14 23 条），按协作铁律保持逐字不变。
 */
export const BOARD3D_PRISM_OPS = Object.freeze(['prism3d']);
/** 含全部扩展命令的完整集（24 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE15_OPS = Object.freeze([
  ...BOARD3D_COMPLETE14_OPS, ...BOARD3D_PRISM_OPS,
]);

// 2026-11-22 D25：pyramid3d 通用棱锥 / 斜棱锥，给底面顶点 base + 顶点 apex（或 axis+height）
// 生成底面 + 侧棱线框（可选顶点球与顶点标注）。单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 /
// COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 / COMPLETE7 16 / COMPLETE8 17 /
// COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 / COMPLETE12 21 / COMPLETE13 22 /
// COMPLETE14 23 / COMPLETE15 24 条），按协作铁律逐字不变。
export const BOARD3D_PYRAMID_OPS = Object.freeze(['pyramid3d']);
/** 含全部扩展命令的完整集（25 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE16_OPS = Object.freeze([
  ...BOARD3D_COMPLETE15_OPS, ...BOARD3D_PYRAMID_OPS,
]);

// 2026-11-22 D26：frustum3d 通用棱台 / 斜棱台，给底面顶点 base + 相似比 ratio（或显式 top）
// 生成底面 + 顶面 + 侧棱线框（可选顶点球与 A/B/C… + A'/B'/C' 标注）。单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 /
// COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 / COMPLETE7 16 / COMPLETE8 17 /
// COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 / COMPLETE12 21 / COMPLETE13 22 /
// COMPLETE14 23 / COMPLETE15 24 / COMPLETE16 25 条），按协作铁律逐字不变。
export const BOARD3D_FRUSTUM_OPS = Object.freeze(['frustum3d']);
/** 含全部扩展命令的完整集（26 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE17_OPS = Object.freeze([
  ...BOARD3D_COMPLETE16_OPS, ...BOARD3D_FRUSTUM_OPS,
]);

// 2026-11-23 D27：vector3d 空间向量 / 有向线段箭头，给起点 from + 终点 to 生成带圆锥箭头的
// 有向线段线框（可选端点小球与 A/B 标注）。单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 /
// COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 / COMPLETE7 16 / COMPLETE8 17 /
// COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 / COMPLETE12 21 / COMPLETE13 22 /
// COMPLETE14 23 / COMPLETE15 24 / COMPLETE16 25 / COMPLETE17 26 条），按协作铁律逐字不变。
export const BOARD3D_VECTOR_OPS = Object.freeze(['vector3d']);
/** 含全部扩展命令的完整集（27 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE18_OPS = Object.freeze([
  ...BOARD3D_COMPLETE17_OPS, ...BOARD3D_VECTOR_OPS,
]);

// 2026-11-23 D28：cone3d 通用圆锥 / 斜圆锥，给底面圆心 base + 底面法向 axis + 半径 radius +
// 高 height（或显式 apex）生成圆底面 + 母线线框（可选顶点/底圈小球与 S/A/B/C 标注）。
// 单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 /
// COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 / COMPLETE7 16 / COMPLETE8 17 /
// COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 / COMPLETE12 21 / COMPLETE13 22 /
// COMPLETE14 23 / COMPLETE15 24 / COMPLETE16 25 / COMPLETE17 26 / COMPLETE18 27 条），
// 按协作铁律逐字不变。
export const BOARD3D_CONE_OPS = Object.freeze(['cone3d']);
/** 含全部扩展命令的完整集（28 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE19_OPS = Object.freeze([
  ...BOARD3D_COMPLETE18_OPS, ...BOARD3D_CONE_OPS,
]);

// 2026-11-23 D29：cylinder3d 通用圆柱 / 斜圆柱，给底面圆心 base + 底面法向 axis + 半径 radius +
// 高 height（或显式顶面圆心 top）生成底圈 + 顶圈 + 侧母线线框（可选圆心/圈点小球与 O/A…/A'… 标注）。
// 单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / COMPLETE3 12 /
// COMPLETE4 13 / COMPLETE5 14 / COMPLETE6 15 / COMPLETE7 16 / COMPLETE8 17 /
// COMPLETE9 18 / COMPLETE10 19 / COMPLETE11 20 / COMPLETE12 21 / COMPLETE13 22 /
// COMPLETE14 23 / COMPLETE15 24 / COMPLETE16 25 / COMPLETE17 26 / COMPLETE18 27 /
// COMPLETE19 28 条），按协作铁律逐字不变。
export const BOARD3D_CYLINDER_OPS = Object.freeze(['cylinder3d']);
/** 含全部扩展命令的完整集（29 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE20_OPS = Object.freeze([
  ...BOARD3D_COMPLETE19_OPS, ...BOARD3D_CYLINDER_OPS,
]);

// 2026-11-23 D30：plane3d 任意空间平面面片，给中心 center + 法向 axis（或三点 points 定面）+
// 宽 width + 高 height 生成边界 + 可选网格 + 法向量 + 角点小球与 A/B/C/D·O 标注。
// 单独成组、不并入任何历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / COMPLETE2 11 / … / COMPLETE20 29 条），
// 按协作铁律逐字不变。
export const BOARD3D_PLANE_OPS = Object.freeze(['plane3d']);
/** 含全部扩展命令的完整集（30 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE21_OPS = Object.freeze([
  ...BOARD3D_COMPLETE20_OPS, ...BOARD3D_PLANE_OPS,
]);

// 2026-11-24 D31：conefrustum3d 通用圆台 / 斜圆台，给下底圆心 base + 法向 axis + 下底半径
// radiusBottom + 上底半径 radiusTop + 高 height（或显式 top）生成下底圈 + 上底圈 + 侧母线线框
// （可选圆心/圈点小球与 O/A…/A'… 标注）。正圆台各侧母线等长、锥顶落在 axis 轴上；斜圆台
// 侧母线变长、锥顶偏离轴线；radiusTop=0 退化圆锥、=radiusBottom 退化圆柱。
// 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE21 30 条），按协作铁律逐字不变。
export const BOARD3D_CONEFRUSTUM_OPS = Object.freeze(['conefrustum3d']);
/** 含全部扩展命令的完整集（31 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE22_OPS = Object.freeze([
  ...BOARD3D_COMPLETE21_OPS, ...BOARD3D_CONEFRUSTUM_OPS,
]);

// 2026-11-24 D32：dihedral3d 空间二面角 / 平面角标注，给棱上两点 edge + 两个半平面内点
// pointA / pointB 生成棱线 + 垂足 + 两条垂直棱的射线 + 圆弧 + 角度读数（可选小球与连线）。
// 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE22 31 条），按协作铁律逐字不变。
export const BOARD3D_DIHEDRAL_OPS = Object.freeze(['dihedral3d']);
/** 含全部扩展命令的完整集（32 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE23_OPS = Object.freeze([
  ...BOARD3D_COMPLETE22_OPS, ...BOARD3D_DIHEDRAL_OPS,
]);

// 2026-11-24 D33：lineplane3d 直线与平面所成角，给直线两点 line + 平面三点 points
// （或 center+axis）生成直线 + 平面面片 + 斜足 V + 垂足 H + 斜线/垂线/射影 + 圆弧 + 角度读数。
// 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE23 32 条），按协作铁律逐字不变。
export const BOARD3D_LINEPLANE_OPS = Object.freeze(['lineplane3d']);
/** 含全部扩展命令的完整集（33 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE24_OPS = Object.freeze([
  ...BOARD3D_COMPLETE23_OPS, ...BOARD3D_LINEPLANE_OPS,
]);

// 2026-11-24 D34：pointplane3d 点到平面的距离，给 point + 平面三点 points
// （或 center+axis）生成平面面片 + 垂线段 PH + 直角符号 + 可选法向量杆 + 小球 + 距离读数。
// 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE23 32 / COMPLETE24 33 条），按协作铁律逐字不变。
export const BOARD3D_POINT_PLANE_OPS = Object.freeze(['pointplane3d']);
/** 含全部扩展命令的完整集（34 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE25_OPS = Object.freeze([
  ...BOARD3D_COMPLETE24_OPS, ...BOARD3D_POINT_PLANE_OPS,
]);

// 2026-11-25 D35：skewline3d 两条空间直线的公垂线与距离，给 from1/to1/from2/to2
// 生成两条直线 + 公垂线段 MN + M/N 处直角符号 + 可选小球 + 距离读数。
// 单独成组、不并入任何历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE24 33 / COMPLETE25 34 条），按协作铁律逐字不变。
export const BOARD3D_SKEWLINE_OPS = Object.freeze(['skewline3d']);
/** 含全部扩展命令的完整集（35 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE26_OPS = Object.freeze([
  ...BOARD3D_COMPLETE25_OPS, ...BOARD3D_SKEWLINE_OPS,
]);

// 2026-11-25 D36：lineangle3d 两空间直线夹角，给 from1/to1/from2/to2 生成
// 两条直线 + 过 O 平行于 L2 的辅助线 + 两条射线 + 圆弧 + 角度读数。
// 同样单独成组、不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE25 34 / COMPLETE26 35 条），历史常量逐字不变。
export const BOARD3D_LINE_ANGLE_OPS = Object.freeze(['lineangle3d']);
/** 含全部扩展命令的完整集（36 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE27_OPS = Object.freeze([
  ...BOARD3D_COMPLETE26_OPS, ...BOARD3D_LINE_ANGLE_OPS,
]);

// 2026-11-25 D37：pointline3d 点到空间直线的距离，给 point + from/to 生成
// 空间直线 + 垂线段 PH + H 处直角符号 + 可选小球 + 距离读数。
// 同样单独成组、不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 /
// COMPLETE2 11 / … / COMPLETE26 35 / COMPLETE27 36 条），历史常量逐字不变。
export const BOARD3D_POINT_LINE_OPS = Object.freeze(['pointline3d']);
/** 含全部扩展命令的完整集（37 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE28_OPS = Object.freeze([
  ...BOARD3D_COMPLETE27_OPS, ...BOARD3D_POINT_LINE_OPS,
]);

// 2026-11-25 D38：relation3d 空间平行 / 垂直关系标注，给 line1/line2 或 line+平面
// 生成 ∥ 记号 / ⊥ 直角符号 + 关系文字。同样单独成组、不并入历史契约常量
// （BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / … / COMPLETE27 36 / COMPLETE28 37 条），
// 历史常量逐字不变。
export const BOARD3D_RELATION_OPS = Object.freeze(['relation3d']);
/** 含全部扩展命令的完整集（38 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE29_OPS = Object.freeze([
  ...BOARD3D_COMPLETE28_OPS, ...BOARD3D_RELATION_OPS,
]);

// 2026-11-26 D39：circumsphere3d 四点外接球，给四个不共面点反求球心与半径，
// 生成三个正交大圆 + 球心到四顶点半径线段 + 球心/顶点/半径标注。同样单独成组、
// 不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / … /
// COMPLETE28 37 / COMPLETE29 38 条），历史常量逐字不变。
export const BOARD3D_CIRCUMSPHERE_OPS = Object.freeze(['circumsphere3d']);
/** 含全部扩展命令的完整集（39 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE30_OPS = Object.freeze([
  ...BOARD3D_COMPLETE29_OPS, ...BOARD3D_CIRCUMSPHERE_OPS,
]);

// 2026-11-26 D40：insphere3d 四面体内切球，给四个不共面点反求内心与内切球半径，
// 生成三个正交大圆 + 四面体六棱 + 内心到四个切点半径线段 + 内心/顶点/切点/半径标注。
// 同样单独成组、不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / COMPLETE 10 / … /
// COMPLETE29 38 / COMPLETE30 39 条），历史常量逐字不变。
export const BOARD3D_INSPHERE_OPS = Object.freeze(['insphere3d']);
/** 含全部扩展命令的完整集（40 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE31_OPS = Object.freeze([
  ...BOARD3D_COMPLETE30_OPS, ...BOARD3D_INSPHERE_OPS,
]);

// 2026-11-26 D41：euler3d 四面体外接球 / 内切球与欧拉不等式（R≥3r、Grace–Danielsson）。
// 组合复用 D39/D40 的纯几何求解，生成六棱 + 两球各三大圆 + 球心连线 + 不等式标注。
// 同样单独成组、不并入历史契约常量，历史常量逐字不变。
export const BOARD3D_EULER_OPS = Object.freeze(['euler3d']);
/** 含全部扩展命令的完整集（41 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE32_OPS = Object.freeze([
  ...BOARD3D_COMPLETE31_OPS, ...BOARD3D_EULER_OPS,
]);

// 2026-11-26 D42：centroid3d 四面体重心与四条中线（重心分中线 3:1、四等分体积）。
// 同样单独成组、不并入历史契约常量，历史常量逐字不变。
export const BOARD3D_CENTROID_OPS = Object.freeze(['centroid3d']);
/** 含全部扩展命令的完整集（42 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE33_OPS = Object.freeze([
  ...BOARD3D_COMPLETE32_OPS, ...BOARD3D_CENTROID_OPS,
]);

// 2026-11-27 D43：solidmetrics3d 正多面体内外接球 / 棱长 / 欧拉公式验证。
// 复用 D17 polyhedron3d 的顶点与棱定义，单独成组、不并入历史契约常量。
export const BOARD3D_SOLIDMETRICS_OPS = Object.freeze(['solidmetrics3d']);
/** 含全部扩展命令的完整集（43 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE34_OPS = Object.freeze([
  ...BOARD3D_COMPLETE33_OPS, ...BOARD3D_SOLIDMETRICS_OPS,
]);

// 2026-11-27 D44：sectionsphere3d 平面截球截面圆（球 + 截面圆 + OO' 垂线 + r²+d²=R² 验证）。
// 同样单独成组、不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / … / COMPLETE34 43 条），
// 历史常量逐字不变。
export const BOARD3D_SECTIONSPHERE_OPS = Object.freeze(['sectionsphere3d']);
/** 含全部扩展命令的完整集（44 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE35_OPS = Object.freeze([
  ...BOARD3D_COMPLETE34_OPS, ...BOARD3D_SECTIONSPHERE_OPS,
]);

// 2026-11-27 D45：circumcircle3d 空间不共线三点定圆（圆心/半径线性解 + 三边 + 圆 + 半径 + 法向）。
// 同样单独成组、不并入历史契约常量（BOARD3D_OPS 7 / ALL 8 / FULL 9 / … / COMPLETE35 44 条），
// 历史常量逐字不变。
export const BOARD3D_CIRCUMCIRCLE_OPS = Object.freeze(['circumcircle3d']);
/** 含全部扩展命令的完整集（45 条），仅供文档 / 本轮回归核对，不参与历史契约断言 */
export const BOARD3D_COMPLETE36_OPS = Object.freeze([
  ...BOARD3D_COMPLETE35_OPS, ...BOARD3D_CIRCUMCIRCLE_OPS,
]);

export const BOARD3D_BGS = Object.freeze(['white', 'beige', 'dark']);

const DEFAULT_COLOR = '#4f6bed';
const DEFAULT_LABEL_COLOR = '#1f2937';

/* ---------------- 纯函数校验工具 ---------------- */

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组）一律拒绝 */
function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function vec3(v, def) {
  if (!Array.isArray(v) || v.length !== 3) return def.slice();
  const out = v.map(num);
  return out.every((x) => x !== null) ? out : def.slice();
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

function scale3(v) {
  return vec3(v, [1, 1, 1]).map((x) => Math.max(0.05, x));
}

/** 只保留该 type 允许的几何参数键，且值必须是有限数值 */
function paramsFor(type, raw) {
  const out = {};
  const keys = BOARD3D_PARAM_KEYS[type] || [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of keys) {
      const n = num(raw[k]);
      if (n !== null) out[k] = n;
    }
  }
  return out;
}

function isId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** 把 AI 命令规范化成画板对象（不做副作用） */
export function normalizeBoard3DObject(cmd, forcedType) {
  const type = forcedType || cmd.type;
  if (!BOARD3D_PARAM_KEYS[type]) return null;
  const isLabel = type === 'label';
  const obj = {
    id: isId(cmd.id) ? cmd.id : '',
    type,
    text: isLabel ? String(cmd.text == null ? '标注' : cmd.text).slice(0, 40) : '',
    color: color(cmd.color, isLabel ? DEFAULT_LABEL_COLOR : DEFAULT_COLOR),
    opacity: isLabel ? 1 : opacity(cmd.opacity),
    pos: vec3(cmd.pos, [0, 0, 0]),
    rot: isLabel ? [0, 0, 0] : vec3(cmd.rot, [0, 0, 0]),
    scale: isLabel ? [1, 1, 1] : scale3(cmd.scale),
    p: paramsFor(type, cmd.params),
  };
  return obj;
}

/** 从画板状态生成给 LLM 的「当前对象」摘要（纯函数，可无头测） */
export function describeBoard3DState(state) {
  const objs = state && Array.isArray(state.objects) ? state.objects : [];
  if (!objs.length) return '（空场景，还没有任何立体对象）';
  return objs
    .map((o) => {
      const pos = Array.isArray(o.pos) ? o.pos.map((n) => Math.round(Number(n) * 100) / 100).join(',') : '';
      const text = o.text ? ` "${String(o.text).slice(0, 20)}"` : '';
      return `${o.id}(${o.type}@[${pos}]${text})`;
    })
    .join('，')
    .slice(0, 1000);
}

/* ---------------- 执行器 ---------------- */

/**
 * 执行一批 3D 命令。
 * @param {Array}  commands  AI 返回的 commands 数组
 * @param {Object} api       注入的画板接口：
 *   getState() -> { objects, view }；add(obj) -> id|null；update(id, patch) -> bool；
 *   remove(id) -> bool；clear()；setView(patch)；resetView()
 * @param {Object} options   { maxCommands = 120 }
 * @returns {Array} 与 commands 一一对应的结果 `{ op, ok, id?, error? }`
 */
export function applyBoard3DCommands(commands, api, options = {}) {
  const results = [];
  const list = Array.isArray(commands) ? commands : [];
  const maxCommands = Number.isFinite(options.maxCommands) ? options.maxCommands : 120;
  const a = api || {};
  const call = (name, ...args) => {
    if (typeof a[name] !== 'function') throw new Error(`画板接口缺少 ${name}()`);
    return a[name](...args);
  };

  let initial = [];
  try { initial = (a.getState ? a.getState() : {}).objects || []; } catch (_) { initial = []; }
  const known = new Set(initial.map((o) => o && o.id).filter(Boolean));
  // 记录每个 id 的图元类型：既含场景里已有的对象，也含本轮刚 add3d 的对象，
  // 这样「同一轮先 add3d 再 update3d 改 params」也能正确校验参数键。
  const types = new Map();
  initial.forEach((o) => { if (o && o.id) types.set(o.id, o.type); });
  let autoSeq = 0;

  for (let i = 0; i < list.length; i++) {
    if (i >= maxCommands) {
      results.push({ op: '?', ok: false, error: `命令数超过上限 ${maxCommands}` });
      continue;
    }
    const cmd = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const op = typeof cmd.op === 'string' ? cmd.op : '';
    try {
      switch (op) {
        case 'add3d':
        case 'label3d': {
          const type = op === 'label3d' ? 'label' : cmd.type;
          if (!BOARD3D_PARAM_KEYS[type]) {
            results.push({ op, ok: false, error: `未知图元类型 ${String(type)}` });
            break;
          }
          const obj = normalizeBoard3DObject(cmd, type);
          if (!obj) { results.push({ op, ok: false, error: '对象规范化失败' }); break; }
          if (!obj.id) obj.id = `b3d_auto_${++autoSeq}`;
          if (known.has(obj.id)) {
            results.push({ op, ok: false, id: obj.id, error: 'id 已存在，请换一个唯一 id（不要用 update3d 之外的方式覆盖）' });
            break;
          }
          call('add', obj);
          known.add(obj.id);
          types.set(obj.id, type);
          results.push({ op, ok: true, id: obj.id, type });
          break;
        }
        case 'update3d': {
          const id = cmd.id;
          if (!isId(id) || !known.has(id)) {
            results.push({ op, ok: false, id, error: '要修改的对象 id 不存在' });
            break;
          }
          const patch = {};
          for (const k of ['text', 'color', 'opacity', 'pos', 'rot', 'scale']) {
            if (cmd[k] === undefined) continue;
            if (k === 'pos' || k === 'rot') patch[k] = vec3(cmd[k], [0, 0, 0]);
            else if (k === 'scale') patch[k] = scale3(cmd[k]);
            else if (k === 'color') patch[k] = color(cmd[k], DEFAULT_COLOR);
            else if (k === 'opacity') patch[k] = opacity(cmd[k]);
            else if (k === 'text') patch[k] = String(cmd[k]).slice(0, 40);
          }
          if (cmd.params && typeof cmd.params === 'object') {
            const keys = BOARD3D_PARAM_KEYS[types.get(id) || ''] || [];
            const p = {};
            for (const k of keys) { const n = num(cmd.params[k]); if (n !== null) p[k] = n; }
            if (Object.keys(p).length) patch.params = p;
          }
          if (!Object.keys(patch).length) {
            results.push({ op, ok: false, id, error: '没有可修改的字段' });
            break;
          }
          const okPatch = call('update', id, patch);
          results.push(okPatch === false
            ? { op, ok: false, id, error: '画板未找到该对象' }
            : { op, ok: true, id });
          break;
        }
        case 'remove3d': {
          const id = cmd.id;
          if (!isId(id) || !known.has(id)) {
            results.push({ op, ok: false, id, error: '要删除的对象 id 不存在' });
            break;
          }
          const okDel = call('remove', id);
          if (okDel !== false) { known.delete(id); types.delete(id); }
          results.push(okDel === false
            ? { op, ok: false, id, error: '画板删除失败' }
            : { op, ok: true, id });
          break;
        }
        case 'clear3d': {
          call('clear');
          known.clear();
          types.clear();
          results.push({ op, ok: true });
          break;
        }
        case 'view3d': {
          const patch = {};
          if (cmd.bg !== undefined) {
            if (!BOARD3D_BGS.includes(cmd.bg)) {
              results.push({ op, ok: false, error: `背景只支持 ${BOARD3D_BGS.join('/')}` });
              break;
            }
            patch.bg = cmd.bg;
          }
          for (const k of ['axes', 'grid']) {
            if (typeof cmd[k] === 'boolean') patch[k] = cmd[k];
          }
          if (!Object.keys(patch).length) {
            results.push({ op, ok: false, error: '没有可设置的视图项（bg/axes/grid）' });
            break;
          }
          call('setView', patch);
          results.push({ op, ok: true });
          break;
        }
        case 'reset3d': {
          call('resetView');
          results.push({ op, ok: true });
          break;
        }
        case 'measure3d': {
          // 只读量测：读「当前」状态而非循环开始时的快照，
          // 这样同一批命令里先 add3d / label3d 再量测刚建好的对象也能按 id 解析到。
          // 不要求 WebGL 就绪（getState 失败时降级为空场景，整批命令不中断）。
          let state = {};
          try { state = (a.getState ? a.getState() : {}) || {}; } catch (_) { state = {}; }
          const r = resolveMeasure3D(cmd, state);
          let label = null;
          // annotate:true 时额外落一个 label3d（量测默认只读；仅 annotate 显式开启写标注）。
          // 结果锚点由 measureToLabelSpec 给出：距离→两端中点、夹角→顶点、中点→中点自身。
          if (r.ok && cmd.annotate === true) {
            const spec = measureToLabelSpec(r);
            if (spec) {
              const labelId = `b3d_m_${++autoSeq}`;
              const labelObj = normalizeBoard3DObject(
                { id: labelId, type: 'label', text: spec.text, pos: spec.pos }, 'label');
              call('add', labelObj);
              known.add(labelId);
              types.set(labelId, 'label');
              label = { id: labelId, pos: spec.pos.slice(), text: spec.text };
            }
          }
          results.push(r.ok
            ? { op, ok: true, kind: r.kind, value: r.value, unit: r.unit, ids: r.ids, text: r.text, label }
            : { op, ok: false, error: r.error });
          break;
        }
        case 'transform3d': {
          // 2026-11-15 D8：ids 批量写法。不新增 op，单 id 路径完整保留在下方。
          // 校验阶段原子性：任一 id 不存在 / 非法 / 重复 / 增量脏 → 整条拒绝，零副作用。
          if (Array.isArray(cmd.ids)) {
            const ids = cmd.ids;
            const badId = ids.find((id) => typeof id !== 'string' || !isId(id) || !known.has(id));
            if (!ids.length || badId !== undefined) {
              results.push({ op, ok: false, ids, error: !ids.length
                ? 'ids 不能为空数组'
                : `要变换的对象 id 不存在：${String(badId)}` });
              break;
            }
            let batchState = {};
            try { batchState = (a.getState ? a.getState() : {}) || {}; } catch (_) { batchState = {}; }
            const r = resolveTransform3DBatch(cmd, batchState);
            if (!r.ok) {
              results.push({ op, ok: false, ids, error: r.error });
              break;
            }
            // 解析成功后逐 id 写入；api 侧失败如实分项汇报，不伪装成整批成功。
            const applied = [];
            const failed = [];
            for (const item of r.items) {
              const okPatch = call('update', item.id, item.patch);
              if (okPatch === false) failed.push({ id: item.id, error: '画板未找到该对象' });
              else applied.push({ id: item.id, fields: item.fields, patch: item.patch });
            }
            results.push({
              op, ok: failed.length === 0, ids: r.ids, batch: true, applied,
              ...(failed.length ? { failed } : {}),
            });
            break;
          }
          // 相对变换：读「当前」状态里该对象的 pos/rot/scale 再叠加增量，
          // 这样同一批命令里先 add3d 再 transform3d 也能作用于刚建好的对象。
          // 与 measure3d 同口径：getState 缺失 / 抛错时降级为空场景，整批命令不中断。
          if (!isId(cmd.id) || !known.has(cmd.id)) {
            results.push({ op, ok: false, id: cmd.id, error: '要变换的对象 id 不存在' });
            break;
          }
          let state = {};
          try { state = (a.getState ? a.getState() : {}) || {}; } catch (_) { state = {}; }
          const r = resolveTransform3D(cmd, state);
          if (!r.ok) {
            results.push({ op, ok: false, id: cmd.id, error: r.error });
            break;
          }
          const okPatch = call('update', r.id, r.patch);
          results.push(okPatch === false
            ? { op, ok: false, id: r.id, error: '画板未找到该对象' }
            : { op, ok: true, id: r.id, fields: r.fields, patch: r.patch });
          break;
        }
        case 'duplicate3d': {
          // 2026-11-16 D9：从「当前」状态按源 id 读对象再克隆，
          // 与 measure3d / transform3d 同口径：getState 缺失 / 抛错降级为空场景，整批不中断。
          let dupState = {};
          try { dupState = (a.getState ? a.getState() : {}) || {}; } catch (_) { dupState = {}; }
          const r = resolveDuplicate3D(cmd, dupState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            // 目标 id 若已被本轮命令占用，跳过（不改已有对象）
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type, pos: item.pos });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            source: cmd.id, count: r.items.length, created,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'radial3d': {
          // 2026-11-16 D10：环形阵列，与 duplicate3d 同口径——从「当前」状态按源 id 读对象，
          // getState 缺失 / 抛错降级为空场景，整批不中断。
          let radState = {};
          try { radState = (a.getState ? a.getState() : {}) || {}; } catch (_) { radState = {}; }
          const r = resolveRadial3D(cmd, radState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type, pos: item.pos, rot: item.rot });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            source: cmd.id, count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'mirror3d': {
          // 2026-11-16 D11：镜像复制，与 duplicate3d / radial3d 同口径——
          // 从「当前」状态按源 id 读对象，getState 缺失 / 抛错降级为空场景，整批不中断。
          let mirState = {};
          try { mirState = (a.getState ? a.getState() : {}) || {}; } catch (_) { mirState = {}; }
          const r = resolveMirror3D(cmd, mirState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const item = r.items[0];
          if (known.has(item.id)) {
            results.push({ op, ok: false, id: item.id, error: 'id 已存在' });
            break;
          }
          const addOk = call('add', item);
          if (addOk === null || addOk === false) {
            results.push({ op, ok: false, id: item.id, error: '画板新建失败' });
            break;
          }
          known.add(item.id);
          types.set(item.id, item.type);
          results.push({
            op, ok: true, source: cmd.id,
            created: [{ id: item.id, type: item.type, pos: item.pos, rot: item.rot }],
            meta: r.meta,
          });
          break;
        }
        case 'grid3d': {
          // 2026-11-17 D12：矩形 / 立体网格阵列，与 radial3d / mirror3d 同口径——
          // 从「当前」状态按源 id 读对象，getState 缺失 / 抛错降级为空场景，整批不中断。
          let gridState = {};
          try { gridState = (a.getState ? a.getState() : {}) || {}; } catch (_) { gridState = {}; }
          const r = resolveGrid3D(cmd, gridState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type, pos: item.pos, rot: item.rot });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            source: cmd.id, count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'align3d': {
          // 2026-11-19 D18：多轴同时对齐（axes:[{axis,mode,to?,start?,end?},...]）——不是新 op。
          // 与下方 D13 单轴写法共用同一 known 校验 / getState 降级 / 逐项 update 口径；
          // 仅当命令显式带 axes 时走此分支，历史单轴路径逐字未动、零回归。
          if (Object.prototype.hasOwnProperty.call(cmd, 'axes')) {
            const ids = cmd.ids;
            if (!Array.isArray(ids) || !ids.length) {
              results.push({ op, ok: false, error: 'ids 必须是非空对象 id 数组' });
              break;
            }
            const badId = ids.find((id) => typeof id !== 'string' || !isId(id) || !known.has(id));
            if (badId !== undefined) {
              results.push({ op, ok: false, ids, error: `要对齐的对象 id 不存在：${String(badId)}` });
              break;
            }
            let multiState = {};
            try { multiState = (a.getState ? a.getState() : {}) || {}; } catch (_) { multiState = {}; }
            const mr = resolveAlign3DMultiAxis(cmd, multiState);
            if (!mr.ok) {
              results.push({ op, ok: false, ids, error: mr.error });
              break;
            }
            const applied = [];
            const failed = [];
            for (const item of mr.items) {
              const okPatch = call('update', item.id, item.patch);
              if (okPatch === false) failed.push({ id: item.id, error: '画板未找到该对象' });
              else applied.push({ id: item.id, patch: item.patch });
            }
            results.push({
              op, ok: failed.length === 0 && applied.length > 0,
              ids: mr.meta.ids, axes: mr.meta.axes.map((x) => x.axis), applied, meta: mr.meta,
              ...(failed.length ? { failed } : {}),
            });
            break;
          }
          // 2026-11-17 D13：多对象对齐 / 等距分布，与 transform3d(ids) 同口径——
          // 先按 known 集合原子校验 ids，再从「当前」getState 读对象真实坐标交给纯函数算绝对目标，
          // 逐项 update（只改目标轴，其余字段沿用）；getState 缺失 / 抛错降级为空场景，整批不中断。
          const ids = cmd.ids;
          if (!Array.isArray(ids) || !ids.length) {
            results.push({ op, ok: false, error: 'ids 必须是非空对象 id 数组' });
            break;
          }
          const badId = ids.find((id) => typeof id !== 'string' || !isId(id) || !known.has(id));
          if (badId !== undefined) {
            results.push({ op, ok: false, ids, error: `要对齐的对象 id 不存在：${String(badId)}` });
            break;
          }
          let alignState = {};
          try { alignState = (a.getState ? a.getState() : {}) || {}; } catch (_) { alignState = {}; }
          const r = resolveAlign3D(cmd, alignState);
          if (!r.ok) {
            results.push({ op, ok: false, ids, error: r.error });
            break;
          }
          const applied = [];
          const failed = [];
          for (const item of r.items) {
            const okPatch = call('update', item.id, item.patch);
            if (okPatch === false) failed.push({ id: item.id, error: '画板未找到该对象' });
            else applied.push({ id: item.id, patch: item.patch });
          }
          results.push({
            op, ok: failed.length === 0 && applied.length > 0,
            ids: r.meta.ids, axis: r.meta.axis, mode: r.meta.mode, applied, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'helix3d': {
          // 2026-11-17 D14：空间螺旋线 / 弹簧，参数方程生成一串 line 段（可选采样点）。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，
          // getState 缺失 / 抛错降级为空场景，整批不中断；id 冲突分项失败、如实回报。
          let helixState = {};
          try { helixState = (a.getState ? a.getState() : {}) || {}; } catch (_) { helixState = {}; }
          const r = resolveHelix3D(cmd, helixState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'bezier3d': {
          // 2026-11-17 D15：3D 贝塞尔曲线，de Casteljau 采样生成一串 line 段（可选采样点）。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，
          // getState 缺失 / 抛错降级为空场景，整批不中断；id 冲突分项失败、如实回报。
          let bezState = {};
          try { bezState = (a.getState ? a.getState() : {}) || {}; } catch (_) { bezState = {}; }
          const r = resolveBezier3D(cmd, bezState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'arc3d': {
          // 2026-11-18 D16：3D 空间圆弧，参数方程采样生成一串 line 段（可选采样点）。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，
          // getState 缺失 / 抛错降级为空场景，整批不中断；id 冲突分项失败、如实回报。
          let arcState = {};
          try { arcState = (a.getState ? a.getState() : {}) || {}; } catch (_) { arcState = {}; }
          const r = resolveArc3D(cmd, arcState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'polyhedron3d': {
          // 2026-11-19 D17：3D 正多面体（柏拉图立体），生成「棱 line + 顶点 point + 可选标注 label」。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，
          // getState 缺失 / 抛错降级为空场景，整批不中断；id 冲突分项失败、如实回报。
          let polyState = {};
          try { polyState = (a.getState ? a.getState() : {}) || {}; } catch (_) { polyState = {}; }
          const r = resolvePolyhedron3D(cmd, polyState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'revolve3d': {
          // 2026-11-19 D19：3D 旋转体 / 回转面，一条母线 profile 绕轴旋转采样生成一串
          // line 段（经线 + 纬线圈，可选采样点）。不需要源对象；从「当前」getState 读状态
          // 仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不中断；
          // id 冲突分项失败、如实回报。
          let revState = {};
          try { revState = (a.getState ? a.getState() : {}) || {}; } catch (_) { revState = {}; }
          const r = resolveRevolve3D(cmd, revState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'torus3d': {
          // 2026-11-19 D20：3D 圆环面 / 轮胎面，按 R（主圆半径）/ r（管半径）参数方程
          // 采样生成经线圆 + 纬线圈线框（可选采样点）。不需要源对象；从「当前」getState
          // 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不中断；
          // id 冲突分项失败、如实回报。
          let torState = {};
          try { torState = (a.getState ? a.getState() : {}) || {}; } catch (_) { torState = {}; }
          const r = resolveTorus3D(cmd, torState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'ellipsoid3d': {
          // 2026-11-20 D21：3D 椭球，按 a/b/c（极轴与赤道面半轴）参数方程采样生成
          // 经线（子午圈）+ 纬线圈线框（可选采样点）。不需要源对象；从「当前」getState
          // 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不中断；
          // id 冲突分项失败、如实回报。
          let elState = {};
          try { elState = (a.getState ? a.getState() : {}) || {}; } catch (_) { elState = {}; }
          const r = resolveEllipsoid3D(cmd, elState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'capsule3d': {
          // 2026-11-21 D22：3D 胶囊体，按 radius（半径）+ length（两球心距）参数方程采样生成
          // 经线（纵向轮廓）+ 纬线圈（横截面圆）线框（可选采样点）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不中断；
          // id 冲突分项失败、如实回报。
          let cpState = {};
          try { cpState = (a.getState ? a.getState() : {}) || {}; } catch (_) { cpState = {}; }
          const r = resolveCapsule3D(cmd, cpState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'tube3d': {
          // 2026-11-22 D23：3D 管道，沿中心路径 path 扫掠半径 radius 的圆截面，
          // 生成横截面圆环 + 沿路径母线线框（可选采样点）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、如实回报。
          let tbState = {};
          try { tbState = (a.getState ? a.getState() : {}) || {}; } catch (_) { tbState = {}; }
          const r = resolveTube3D(cmd, tbState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'prism3d': {
          // 2026-11-22 D24：3D 通用棱柱，给底面顶点 base + 拉伸向量 vector（或 axis+height），
          // 生成底面 + 顶面 + 侧棱线框（可选顶点球与顶点标注）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、如实回报。
          let prState = {};
          try { prState = (a.getState ? a.getState() : {}) || {}; } catch (_) { prState = {}; }
          const r = resolvePrism3D(cmd, prState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'pyramid3d': {
          // 2026-11-22 D25：3D 通用棱锥，给底面顶点 base + 顶点 apex（或 axis+height），
          // 生成底面 + 侧棱线框（可选顶点球与顶点标注）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、如实回报。
          let pyState = {};
          try { pyState = (a.getState ? a.getState() : {}) || {}; } catch (_) { pyState = {}; }
          const r = resolvePyramid3D(cmd, pyState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'frustum3d': {
          // 2026-11-22 D26：3D 通用棱台，给底面顶点 base + 相似比 ratio（或显式 top），
          // 生成底面 + 顶面 + 侧棱线框（可选顶点球与顶点标注）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、如实回报。
          let frState = {};
          try { frState = (a.getState ? a.getState() : {}) || {}; } catch (_) { frState = {}; }
          const r = resolveFrustum3D(cmd, frState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'vector3d': {
          // 2026-11-23 D27：3D 空间向量 / 有向线段箭头，给 from + to 生成杆 + 圆锥箭头线框
          // （可选端点小球与 A/B 标注）。不需要源对象；从「当前」getState 读状态仅用于生成 id
          // 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let vecState = {};
          try { vecState = (a.getState ? a.getState() : {}) || {}; } catch (_) { vecState = {}; }
          const r = resolveVector3D(cmd, vecState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'cone3d': {
          // 2026-11-23 D28：3D 通用圆锥 / 斜圆锥，给 base + axis + radius + height（或显式 apex）
          // 生成圆底面 + 母线线框（可选顶点/底圈小球与 S/A/B/C 标注）。不需要源对象；从「当前」
          // getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，整批不
          // 中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let coneState = {};
          try { coneState = (a.getState ? a.getState() : {}) || {}; } catch (_) { coneState = {}; }
          const r = resolveCone3D(cmd, coneState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'cylinder3d': {
          // 2026-11-23 D29：3D 通用圆柱 / 斜圆柱，给 base + axis + radius + height（或显式 top）
          // 生成底圈 + 顶圈 + 侧母线线框（可选圆心/圈点小球与 O/A…/A'… 标注）。不需要源对象；从
          // 「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let cylState = {};
          try { cylState = (a.getState ? a.getState() : {}) || {}; } catch (_) { cylState = {}; }
          const r = resolveCylinder3D(cmd, cylState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'plane3d': {
          // 2026-11-23 D30：3D 任意空间平面面片，给 center + axis（或三点 points 定面）+ width + height
          // 生成边界 + 可选网格 + 法向量线框（可选角点小球与 O/A/B/C/D/n 标注）。不需要源对象；从
          // 「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错降级为空场景，
          // 整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let planeState = {};
          try { planeState = (a.getState ? a.getState() : {}) || {}; } catch (_) { planeState = {}; }
          const r = resolvePlane3D(cmd, planeState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'conefrustum3d': {
          // 2026-11-24 D31：3D 通用圆台 / 斜圆台，给 base + axis + radiusBottom + radiusTop +
          // height（或显式 top）生成下底圈 + 上底圈 + 侧母线线框（可选圆心/圈点小球与 O/A…/A'… 标注）。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let cfmState = {};
          try { cfmState = (a.getState ? a.getState() : {}) || {}; } catch (_) { cfmState = {}; }
          const r = resolveConefrustum3D(cmd, cfmState);
          if (!r.ok) {
            results.push({ op, ok: false, error: r.error });
            break;
          }
          const created = [];
          const failed = [];
          for (const item of r.items) {
            if (known.has(item.id)) { failed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { failed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            created.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: failed.length === 0 && created.length > 0,
            count: r.items.length, created, meta: r.meta,
            ...(failed.length ? { failed } : {}),
          });
          break;
        }
        case 'dihedral3d': {
          // 2026-11-24 D32：3D 空间二面角 / 平面角标注，给 edge + pointA + pointB（或显式 foot）
          // 生成棱线 + 垂足出发的两条垂直棱射线 + 圆弧 + 角度读数（可选端点小球与连线）。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let dhState = {};
          try { dhState = (a.getState ? a.getState() : {}) || {}; } catch (_) { dhState = {}; }
          const dr = resolveDihedral3D(cmd, dhState);
          if (!dr.ok) {
            results.push({ op, ok: false, error: dr.error });
            break;
          }
          const dhCreated = [];
          const dhFailed = [];
          for (const item of dr.items) {
            if (known.has(item.id)) { dhFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { dhFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            dhCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: dhFailed.length === 0 && dhCreated.length > 0,
            count: dr.items.length, created: dhCreated, meta: dr.meta,
            ...(dhFailed.length ? { failed: dhFailed } : {}),
          });
          break;
        }
        case 'lineplane3d': {
          // 2026-11-24 D33：3D 直线与平面所成角，给 line + points（或 center+axis）生成
          // 直线 + 平面面片 + 斜足 + 垂足 + 斜线/垂线/射影 + 圆弧 + 角度读数。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let lpState = {};
          try { lpState = (a.getState ? a.getState() : {}) || {}; } catch (_) { lpState = {}; }
          const lr = resolveLineplane3D(cmd, lpState);
          if (!lr.ok) {
            results.push({ op, ok: false, error: lr.error });
            break;
          }
          const lpCreated = [];
          const lpFailed = [];
          for (const item of lr.items) {
            if (known.has(item.id)) { lpFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { lpFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            lpCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: lpFailed.length === 0 && lpCreated.length > 0,
            count: lr.items.length, created: lpCreated, meta: lr.meta,
            ...(lpFailed.length ? { failed: lpFailed } : {}),
          });
          break;
        }
        case 'pointplane3d': {
          // 2026-11-24 D34：3D 点到平面的距离，给 point + points（或 center+axis）生成
          // 平面面片 + 垂线段 PH + 直角符号 + 可选法向量杆 / 小球 / 距离读数。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let ppState = {};
          try { ppState = (a.getState ? a.getState() : {}) || {}; } catch (_) { ppState = {}; }
          const pr = resolvePointplane3D(cmd, ppState);
          if (!pr.ok) {
            results.push({ op, ok: false, error: pr.error });
            break;
          }
          const ppCreated = [];
          const ppFailed = [];
          for (const item of pr.items) {
            if (known.has(item.id)) { ppFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { ppFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            ppCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: ppFailed.length === 0 && ppCreated.length > 0,
            count: pr.items.length, created: ppCreated, meta: pr.meta,
            ...(ppFailed.length ? { failed: ppFailed } : {}),
          });
          break;
        }
        case 'skewline3d': {
          // 2026-11-25 D35：3D 两条直线的公垂线与距离，给 from1/to1/from2/to2 生成
          // 两条直线 + 公垂线段 MN + M/N 处直角符号 + 可选小球 / 距离读数。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let slState = {};
          try { slState = (a.getState ? a.getState() : {}) || {}; } catch (_) { slState = {}; }
          const sr = resolveSkewline3D(cmd, slState);
          if (!sr.ok) {
            results.push({ op, ok: false, error: sr.error });
            break;
          }
          const slCreated = [];
          const slFailed = [];
          for (const item of sr.items) {
            if (known.has(item.id)) { slFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { slFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            slCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: slFailed.length === 0 && slCreated.length > 0,
            count: sr.items.length, created: slCreated, meta: sr.meta,
            ...(slFailed.length ? { failed: slFailed } : {}),
          });
          break;
        }
        case 'lineangle3d': {
          // 2026-11-25 D36：3D 两空间直线夹角，给 from1/to1/from2/to2 生成
          // 两条直线 + 过 O 平行于 L2 的辅助线 + 两条射线 + 圆弧 + 角度读数。
          // 不需要源对象；从「当前」getState 读状态仅用于生成 id 时避让已有对象，getState 缺失 / 抛错
          // 降级为空场景，整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由
          // default 拒绝。
          let laState = {};
          try { laState = (a.getState ? a.getState() : {}) || {}; } catch (_) { laState = {}; }
          const lar = resolveLineangle3D(cmd, laState);
          if (!lar.ok) {
            results.push({ op, ok: false, error: lar.error });
            break;
          }
          const laCreated = [];
          const laFailed = [];
          for (const item of lar.items) {
            if (known.has(item.id)) { laFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { laFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            laCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: laFailed.length === 0 && laCreated.length > 0,
            count: lar.items.length, created: laCreated, meta: lar.meta,
            ...(laFailed.length ? { failed: laFailed } : {}),
          });
          break;
        }
        case 'pointline3d': {
          // 2026-11-25 D37：3D 点到直线的距离，给 point + from/to 生成空间直线 +
          // 垂线段 PH + 直角符号 + 距离读数。getState 仅供 id 避让、缺失/抛错降级为空场景
          // 整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let plState = {};
          try { plState = (a.getState ? a.getState() : {}) || {}; } catch (_) { plState = {}; }
          const plr = resolvePointline3D(cmd, plState);
          if (!plr.ok) {
            results.push({ op, ok: false, error: plr.error });
            break;
          }
          const plCreated = [];
          const plFailed = [];
          for (const item of plr.items) {
            if (known.has(item.id)) { plFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { plFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            plCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: plFailed.length === 0 && plCreated.length > 0,
            count: plr.items.length, created: plCreated, meta: plr.meta,
            ...(plFailed.length ? { failed: plFailed } : {}),
          });
          break;
        }
        case 'relation3d': {
          // 2026-11-25 D38：3D 平行 / 垂直关系标注，给 line1/line2 或 line+平面
          // 生成 ∥ 记号或 ⊥ 直角符号 + 关系文字。getState 仅供 id 避让、缺失/抛错降级为
          // 空场景整批不中断；id 冲突分项失败、api.add 返回 null/false 分项回报；
          // 2D 命令仍由 default 拒绝。
          let relState = {};
          try { relState = (a.getState ? a.getState() : {}) || {}; } catch (_) { relState = {}; }
          const relr = resolveRelation3D(cmd, relState);
          if (!relr.ok) {
            results.push({ op, ok: false, error: relr.error });
            break;
          }
          const relCreated = [];
          const relFailed = [];
          for (const item of relr.items) {
            if (known.has(item.id)) { relFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { relFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            relCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: relFailed.length === 0 && relCreated.length > 0,
            count: relr.items.length, created: relCreated, meta: relr.meta,
            ...(relFailed.length ? { failed: relFailed } : {}),
          });
          break;
        }
        case 'circumsphere3d': {
          // 2026-11-26 D39：3D 四点外接球，给四个不共面点反求球心与半径，
          // 生成三个正交大圆 + 球心到四顶点半径线段 + 球心/顶点/半径标注。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let csState = {};
          try { csState = (a.getState ? a.getState() : {}) || {}; } catch (_) { csState = {}; }
          const csr = resolveCircumsphere3D(cmd, csState);
          if (!csr.ok) {
            results.push({ op, ok: false, error: csr.error });
            break;
          }
          const csCreated = [];
          const csFailed = [];
          for (const item of csr.items) {
            if (known.has(item.id)) { csFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { csFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            csCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: csFailed.length === 0 && csCreated.length > 0,
            count: csr.items.length, created: csCreated, meta: csr.meta,
            ...(csFailed.length ? { failed: csFailed } : {}),
          });
          break;
        }
        case 'insphere3d': {
          // 2026-11-26 D40：3D 四点内切球，给四个不共面点反求内心与内切球半径，
          // 生成三个正交大圆 + 四面体六棱 + 内心到四个切点半径线段 + 内心/顶点/切点/半径标注。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let isState = {};
          try { isState = (a.getState ? a.getState() : {}) || {}; } catch (_) { isState = {}; }
          const isr = resolveInsphere3D(cmd, isState);
          if (!isr.ok) {
            results.push({ op, ok: false, error: isr.error });
            break;
          }
          const isCreated = [];
          const isFailed = [];
          for (const item of isr.items) {
            if (known.has(item.id)) { isFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { isFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            isCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: isFailed.length === 0 && isCreated.length > 0,
            count: isr.items.length, created: isCreated, meta: isr.meta,
            ...(isFailed.length ? { failed: isFailed } : {}),
          });
          break;
        }
        case 'euler3d': {
          // 2026-11-26 D41：四面体外接球 / 内切球与欧拉不等式标注。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let euState = {};
          try { euState = (a.getState ? a.getState() : {}) || {}; } catch (_) { euState = {}; }
          const eur = resolveEuler3D(cmd, euState);
          if (!eur.ok) {
            results.push({ op, ok: false, error: eur.error });
            break;
          }
          const euCreated = [];
          const euFailed = [];
          for (const item of eur.items) {
            if (known.has(item.id)) { euFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { euFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            euCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: euFailed.length === 0 && euCreated.length > 0,
            count: eur.items.length, created: euCreated, meta: eur.meta,
            ...(euFailed.length ? { failed: euFailed } : {}),
          });
          break;
        }
        case 'centroid3d': {
          // 2026-11-26 D42：四面体重心与四条中线（G 分中线 3:1、四等分体积）。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let ctState = {};
          try { ctState = (a.getState ? a.getState() : {}) || {}; } catch (_) { ctState = {}; }
          const ctr = resolveCentroid3D(cmd, ctState);
          if (!ctr.ok) {
            results.push({ op, ok: false, error: ctr.error });
            break;
          }
          const ctCreated = [];
          const ctFailed = [];
          for (const item of ctr.items) {
            if (known.has(item.id)) { ctFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { ctFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            ctCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: ctFailed.length === 0 && ctCreated.length > 0,
            count: ctr.items.length, created: ctCreated, meta: ctr.meta,
            ...(ctFailed.length ? { failed: ctFailed } : {}),
          });
          break;
        }
        case 'solidmetrics3d': {
          // 2026-11-27 D43：正多面体内外接球 / 棱长 / 欧拉公式验证。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let smState = {};
          try { smState = (a.getState ? a.getState() : {}) || {}; } catch (_) { smState = {}; }
          const smr = resolveSolidmetrics3D(cmd, smState);
          if (!smr.ok) {
            results.push({ op, ok: false, error: smr.error });
            break;
          }
          const smCreated = [];
          const smFailed = [];
          for (const item of smr.items) {
            if (known.has(item.id)) { smFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { smFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            smCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: smFailed.length === 0 && smCreated.length > 0,
            count: smr.items.length, created: smCreated, meta: smr.meta,
            ...(smFailed.length ? { failed: smFailed } : {}),
          });
          break;
        }
        case 'sectionsphere3d': {
          // 2026-11-27 D44：平面截球截面圆（球三正交大圆 + 截面平面面片 + 截面圆 +
          // 球心到截面圆心垂线 + 直角符号 + O/O'/R/r/d/关系式标注，r²+d²=R²）。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let ssState = {};
          try { ssState = (a.getState ? a.getState() : {}) || {}; } catch (_) { ssState = {}; }
          const ssr = resolveSectionsphere3D(cmd, ssState);
          if (!ssr.ok) {
            results.push({ op, ok: false, error: ssr.error });
            break;
          }
          const ssCreated = [];
          const ssFailed = [];
          for (const item of ssr.items) {
            if (known.has(item.id)) { ssFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { ssFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            ssCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: ssFailed.length === 0 && ssCreated.length > 0,
            count: ssr.items.length, created: ssCreated, meta: ssr.meta,
            ...(ssFailed.length ? { failed: ssFailed } : {}),
          });
          break;
        }
        case 'circumcircle3d': {
          // 2026-11-27 D45：空间不共线三点定圆（三边线框 + 圆闭合环 + 圆心到三顶点半径 +
          // 可选法向示意 + O/A/B/C/R/n 标注，三点到圆心恒等距、采样点共面且距 O 为 R）。
          // getState 仅供 id 避让、缺失/抛错降级为空场景整批不中断；id 冲突分项失败、
          // api.add 返回 null/false 分项回报；2D 命令仍由 default 拒绝。
          let ccState = {};
          try { ccState = (a.getState ? a.getState() : {}) || {}; } catch (_) { ccState = {}; }
          const ccr = resolveCircumcircle3D(cmd, ccState);
          if (!ccr.ok) {
            results.push({ op, ok: false, error: ccr.error });
            break;
          }
          const ccCreated = [];
          const ccFailed = [];
          for (const item of ccr.items) {
            if (known.has(item.id)) { ccFailed.push({ id: item.id, error: 'id 已存在' }); continue; }
            const addOk = call('add', item);
            if (addOk === null || addOk === false) { ccFailed.push({ id: item.id, error: '画板新建失败' }); continue; }
            known.add(item.id);
            types.set(item.id, item.type);
            ccCreated.push({ id: item.id, type: item.type });
          }
          results.push({
            op, ok: ccFailed.length === 0 && ccCreated.length > 0,
            count: ccr.items.length, created: ccCreated, meta: ccr.meta,
            ...(ccFailed.length ? { failed: ccFailed } : {}),
          });
          break;
        }
        default:
          results.push({ op, ok: false, error: `不支持的 3D 命令 ${op || '(空)'}；3D 分支不识别 2D 命令` });
      }
    } catch (e) {
      results.push({ op, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
  return results;
}


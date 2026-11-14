/**
 * 3D 画板「基础图元几何规格」无头回归（回归清单 B1–B6）。
 *
 * 覆盖：图元参数键 / 默认值与 AI 协议、SHAPE_DEFS 的一致性；参数规范化防护；
 *      正方体 / 四棱锥 / 三棱柱 / 正四面体 / 球 / 圆柱（圆台）/ 圆锥 / 平面 / 线段 / 点
 *      的真实 BufferGeometry 断言（三角面数、包围盒、顶点朝向、端点定向、参数独立性、
 *      NaN 防护）；组合透明体材质与由远及近 renderOrder；内核接入与硬约束静态复核。
 *
 * 与仓库既有 3D 测试同口径：纯函数层 js/board3d-geometry.js 直接 import 真实实现，
 * 几何构造用本地 vendor 的 Three.js r160 真实 BufferGeometry（纯 CPU，不需要 WebGL / DOM），
 * 不用自造的模拟几何自证；像素级目视仍受 A9 环境限制。
 *
 * 运行：node tests/board3d_geometry.mjs
 */
import * as THREE from '../libs/three/three.module.min.js';
import {
  BOARD3D_SHAPE_KEYS, BOARD3D_SHAPE_DEFAULTS, BOARD3D_SHAPE_TYPES,
  DIM_MIN, DIM_MAX, COORD_LIMIT,
  num, defaultShapeParams, normalizeShapeParams, createShapeGeometry,
  lineGeometry, shapeMaterialConfig, transparentRenderOrder,
} from '../js/board3d-geometry.js';
import { BOARD3D_PARAM_KEYS, BOARD3D_TYPES } from '../js/board3d-executor.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const src = existsSync(join(ROOT, 'js/board3d.js')) ? read('js/board3d.js') : '';
const geomSrc = existsSync(join(ROOT, 'js/board3d-geometry.js')) ? read('js/board3d-geometry.js') : '';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-4) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));

/* ---------------- 真实几何工具 ---------------- */
function triangles(g) {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}
function bounds(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}
function verts(g) {
  const a = g.getAttribute('position').array;
  const out = [];
  for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}
function finiteGeom(g) {
  const p = g.getAttribute('position');
  if (!p || !Array.from(p.array).every(Number.isFinite)) return false;
  const n = g.getAttribute('normal');
  if (n && !Array.from(n.array).every(Number.isFinite)) return false;
  if (g.index && !Array.from(g.index.array).every((i) => i >= 0 && i < p.count)) return false;
  return g.boundingBox === null || [g.boundingBox.min, g.boundingBox.max].every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
}
function uniqueVerts(g, eps = 1e-5) {
  const seen = new Set(), out = [];
  for (const v of verts(g)) {
    const k = v.map((x) => Math.round(x / eps)).join(',');
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}
const geo = (type, params) => createShapeGeometry(THREE, type, params === undefined ? defaultShapeParams(type) : params);

/* ---------------- A. 规格与协议一致性 ---------------- */
section('A. 图元规格：键 / 默认值 / 协议一致性');
{
  assert(BOARD3D_SHAPE_TYPES.length === 13, '图元共 13 种（11 网格 + label 锚点 + circle/polygon）');
  assert(JSON.stringify([...BOARD3D_SHAPE_TYPES]) === JSON.stringify([...BOARD3D_TYPES]),
    '内核图元白名单与 AI 执行器 BOARD3D_TYPES 顺序一致');
  let keysAligned = true;
  for (const t of BOARD3D_SHAPE_TYPES) {
    if (JSON.stringify(BOARD3D_SHAPE_KEYS[t]) !== JSON.stringify(BOARD3D_PARAM_KEYS[t])) keysAligned = false;
  }
  assert(keysAligned, '各图元参数键与执行器 BOARD3D_PARAM_KEYS 逐项一致（协议/内核不漂移）');
  assert(BOARD3D_SHAPE_KEYS.label.length === 0, 'label 无几何参数');
  assert(BOARD3D_SHAPE_KEYS.line.length === 6, 'line 端点参数 6 个');

  // SHAPE_DEFS.params.d 与纯函数默认值逐项比对（解析真实内核源码，防两处漂移）
  const block = src.match(/const SHAPE_DEFS = \{([\s\S]*?)\n\};/);
  assert(!!block, 'board3d.js 的 SHAPE_DEFS 可解析');
  let defaultsAligned = true, checked = 0;
  if (block) {
    for (const line of block[1].split('\n')) {
      const m = line.match(/^\s*(\w+):\s*\{ name:.*?params:\s*\{(.*)\}\s*\},?\s*$/);
      if (!m) continue;
      const type = m[1], expected = {};
      for (const pm of m[2].matchAll(/(\w+):\s*\{\s*d:\s*(-?\d+(?:\.\d+)?)/g)) expected[pm[1]] = Number(pm[2]);
      const got = BOARD3D_SHAPE_DEFAULTS[type] || {};
      checked++;
      if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(got).sort())) defaultsAligned = false;
      for (const k of Object.keys(expected)) if (!near(expected[k], got[k], 1e-9)) defaultsAligned = false;
    }
  }
  assert(checked === 12 && defaultsAligned, 'SHAPE_DEFS 的 12 组默认参数与 BOARD3D_SHAPE_DEFAULTS 逐项一致');

  const d = defaultShapeParams('box');
  d.w = 999;
  assert(BOARD3D_SHAPE_DEFAULTS.box.w === 2 && defaultShapeParams('box').w === 2, 'defaultShapeParams 返回浅拷贝（常量不可被污染）');
  assert(defaultShapeParams('nope') === null, '未知类型默认值 → null');
  assert(JSON.stringify(defaultShapeParams('label')) === '{}', 'label 默认参数为空对象');
}

/* ---------------- B. 参数规范化防护 ---------------- */
section('B. normalizeShapeParams：白名单 / 数值化 / 钳制 / 缺省回落');
{
  assert(num(2) === 2 && num('2.5') === 2.5 && num(' 3 ') === 3, 'num 接受数值与数字字符串');
  assert(num('') === null && num('2x') === null && num(null) === null, 'num 拒绝空串 / 表达式 / null');
  assert(num(NaN) === null && num(Infinity) === null && num([1]) === null, 'num 拒绝 NaN / Infinity / 数组');

  const b = normalizeShapeParams('box', { w: 3, h: '1.5', d: 0 });
  assert(b.w === 3 && b.h === 1.5 && b.d === DIM_MIN, '尺寸：合法值 / 数字字符串 / 0 → 钳制到下限');
  const dirty = normalizeShapeParams('box', { w: NaN, h: -8, d: Infinity, bogus: 7 });
  assert(dirty.w === 2 && dirty.h === DIM_MIN && dirty.d === 2 && !('bogus' in dirty),
    'NaN/负值/Infinity/未知键 → 回落默认值或钳制，未知键丢弃');
  assert(normalizeShapeParams('sphere', { r: 1e9 }).r === DIM_MAX, '超大尺寸 → 上限钳制（防几何爆炸）');
  assert(normalizeShapeParams('cylinder', { rt: '0.5', rb: 2, h: 3 }).rb === 2, '圆柱上下半径可分别设置');
  const ln = normalizeShapeParams('line', { x1: -20, y1: 0, z1: 0, x2: 1.5, y2: 2, z2: -3 });
  assert(ln.x1 === -20 && ln.z2 === -3, '端点坐标允许负值');
  assert(normalizeShapeParams('line', { x1: 1e9 }).x1 === COORD_LIMIT, '端点坐标超限 → 钳制');
  assert(JSON.stringify(Object.keys(ln).sort()) === JSON.stringify([...BOARD3D_SHAPE_KEYS.line].sort()),
    'line 输出键集合严格等于白名单');
  assert(JSON.stringify(normalizeShapeParams('label', { bogus: 1 })) === '{}', 'label 参数恒为空对象');
  assert(normalizeShapeParams('nope', {}) === null, '未知类型 → null');
  assert(normalizeShapeParams('box', null).w === 2 && normalizeShapeParams('box', [1]).h === 2,
    'null / 数组入参安全回落默认值');
}

/* ---------------- C. B1 正方体 ---------------- */
section('C. B1 正方体：6 面等边、三参数独立、坐标轴对齐');
{
  const g = geo('box');
  const bb = bounds(g);
  assert(triangles(g) === 12, 'box 6 面 × 2 = 12 个三角面');
  assert(vecNear(bb.min, [-1, -1, -1]) && vecNear(bb.max, [1, 1, 1]), '默认 box 包围盒 ±1（等边立方体）');
  assert(bb.max.every((v, i) => near(v, -bb.min[i])), '包围盒关于原点对称（与坐标轴 / 网格对齐）');
  assert(finiteGeom(g) && uniqueVerts(g).length === 8, '8 个角点、顶点 / 法线 / 索引全有限（无退化平面）');
  const g2 = geo('box', { w: 3, h: 1, d: 2 });
  const bb2 = bounds(g2);
  assert(vecNear(bb2.min, [-1.5, -0.5, -1]) && vecNear(bb2.max, [1.5, 0.5, 1]),
    '宽 / 高 / 深三参数独立生效（未退化成平面）');
  assert(uniqueVerts(g2).length === 8, '非等边 box 仍是完整六面体');
}

/* ---------------- D. B2 四棱锥 ---------------- */
section('D. B2 四棱锥：4 侧面 + 正方形底面、顶点朝 +Y');
{
  const g = geo('pyramid');
  const bb = bounds(g);
  assert(triangles(g) === 12, 'pyramid（4 段 Cone）12 个三角面');
  assert(near(bb.max[1], 1.2) && near(bb.min[1], -1.2), '默认高 h=2.4 → 顶点 y=+1.2 / 底面 y=-1.2');
  assert(near(bb.max[0], 1.4) && near(bb.min[2], -1.4), '底面外接半径 = s×0.7 = 1.4');
  const uv = uniqueVerts(g);
  const apex = uv.filter((v) => near(v[1], 1.2));
  const base = uv.filter((v) => near(v[1], -1.2));
  assert(apex.length === 1 && near(apex[0][0], 0) && near(apex[0][2], 0), '唯一顶点位于 (0,+h/2,0)，朝 +Y');
  assert(base.length >= 4, `底面角点 ≥4 个（实得 ${base.length}）`);
  assert(base.some((v) => near(Math.abs(v[0]), 1.4)) && base.some((v) => near(Math.abs(v[2]), 1.4)),
    '正方形底面角点落在 ±r 轴上（底面朝向 -Y）');
  assert(finiteGeom(g), '棱锥顶点 / 法线 / 索引全有限（无破面）');
  const sOnly = bounds(geo('pyramid', { s: 4, h: 2.4 }));
  const hOnly = bounds(geo('pyramid', { s: 2, h: 4 }));
  assert(near(sOnly.max[0], 2.8) && near(sOnly.max[1], 1.2), '只改底边长 s：仅 X/Z 变化，高度不变');
  assert(near(hOnly.max[0], 1.4) && near(hOnly.max[1], 2), '只改高 h：仅 Y 变化，底面不变');
}

/* ---------------- E. B3 三棱柱 / 正四面体 ---------------- */
section('E. B3 三棱柱 / 正四面体：面数与棱数正确');
{
  const pr = geo('prism');
  const pb = bounds(pr);
  assert(triangles(pr) === 12, 'prism（3 段 Cylinder）12 个三角面（3 侧面 + 上下三角盖）');
  assert(near(pb.max[1], 1.2) && near(pb.min[1], -1.2), '三棱柱高 = h');
  assert(near(pb.min[0], -0.866, 1e-3) && near(pb.max[2], 1, 1e-3), '底面为外接半径 r 的正三角形（3 段）');
  assert(finiteGeom(pr), '三棱柱无 NaN 顶点');
  const te = geo('tetra');
  assert(triangles(te) === 4, 'tetra 恰好 4 个三角面（正四面体）');
  assert(uniqueVerts(te).length === 4, '4 个顶点');
  assert(bounds(te).max.every((v) => near(v, 1.1547, 1e-3)), '默认棱长 s=2 → 外接半径 ≈1.1547');
  assert(bounds(geo('tetra', { s: 4 })).max[0] > bounds(te).max[0] * 1.9, '棱长参数线性缩放');
  assert(finiteGeom(te), '正四面体无破面');
}

/* ---------------- F. B4 球 / 圆柱（圆台）/ 圆锥 ---------------- */
section('F. B4 球 / 圆柱 / 圆锥：半径与高独立、圆台、无破面');
{
  const sp = geo('sphere');
  const sb = bounds(sp);
  assert(triangles(sp) === 2160 && sb.max.every((v) => near(v, 1.2)), '球默认半径 1.2，2160 个三角面');
  assert(bounds(geo('sphere', { r: 3 })).max[0] === 3, '球半径可单独调整');
  assert(finiteGeom(sp), '球体顶点 / 法线有限');

  const cy = geo('cylinder', { rt: 0.5, rb: 1.5, h: 4 });
  const cb = bounds(cy);
  assert(near(cb.max[0], 1.5) && near(cb.max[1], 2) && near(cb.min[1], -2), '圆台包围盒 = max(rt,rb) × h');
  const cs = uniqueVerts(cy);
  const rTop = Math.max(...cs.filter((v) => near(v[1], 2)).map((v) => Math.hypot(v[0], v[2])));
  const rBot = Math.max(...cs.filter((v) => near(v[1], -2)).map((v) => Math.hypot(v[0], v[2])));
  assert(near(rTop, 0.5, 1e-3) && near(rBot, 1.5, 1e-3), 'rt≠rb 时为圆台：顶面半径 rt，底面半径 rb');
  assert(near(bounds(geo('cylinder', { rt: 1, rb: 1, h: 9 })).max[1], 4.5), '圆柱高可单独调整');
  assert(finiteGeom(cy), '圆台无破面');

  const co = geo('cone', { r: 2, h: 3 });
  const cob = bounds(co);
  assert(near(cob.max[0], 2) && near(cob.max[1], 1.5) && near(cob.min[1], -1.5), '圆锥半径 / 高独立');
  const cos = uniqueVerts(co);
  const rApex = Math.max(...cos.filter((v) => near(v[1], 1.5)).map((v) => Math.hypot(v[0], v[2])));
  assert(rApex < 1e-6, '圆锥顶点半径 ≈0（不是圆柱）');
  assert(finiteGeom(co), '圆锥无破面');
}

/* ---------------- G. B5 平面 / 线段 / 点 ---------------- */
section('G. B5 平面 / 线段 / 点：双面可见、端点可编辑、大小可调');
{
  const pl = geo('plane');
  const pb = bounds(pl);
  assert(triangles(pl) === 2, '平面 2 个三角面');
  assert(verts(pl).every((v) => near(v[1], 0)), 'rotateX(-90°) 后平面水平（y 恒为 0）');
  assert(vecNear(pb.min, [-1.5, 0, -1.5]) && vecNear(pb.max, [1.5, 0, 1.5]), '宽 / 高映射到 X / Z 轴');
  assert(shapeMaterialConfig('plane', 1).side === 'double', '平面材质 DoubleSide（背面不会看不见）');
  assert(bounds(geo('plane', { w: 6, h: 2 })).max[0] === 3, '平面宽 / 高可分别调整');
  assert(finiteGeom(pl), '平面无 NaN 顶点');

  const ln = geo('line');
  const lb = bounds(ln);
  assert(vecNear(lb.min, [-1.5, -0.05, -0.05], 1e-3) && vecNear(lb.max, [1.5, 0.05, 0.05], 1e-3),
    '默认线段端点 (-1.5,0,0)→(1.5,0,0)，半径 0.05');
  assert(triangles(ln) === 48, '线段用 12 段圆柱近似（48 三角面）');
  assert(finiteGeom(ln), '线段顶点有限');

  // 斜线段：端点编辑后仍沿两端点连线定向
  const a = [0, 0, 0], b = [3, 4, 0], mid = [1.5, 2, 0];
  const diag = geo('line', { x1: a[0], y1: a[1], z1: a[2], x2: b[0], y2: b[1], z2: b[2] });
  const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...dir), u = dir.map((x) => x / len);
  let tMin = Infinity, tMax = -Infinity, rMax = 0;
  for (const v of verts(diag)) {
    const d = [v[0] - mid[0], v[1] - mid[1], v[2] - mid[2]];
    const t = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    const radial = Math.hypot(d[0] - t * u[0], d[1] - t * u[1], d[2] - t * u[2]);
    rMax = Math.max(rMax, radial);
  }
  assert(near(tMin, -len / 2, 1e-3) && near(tMax, len / 2, 1e-3), '斜线段沿两端点方向延展，长度 = 5');
  assert(near(rMax, 0.05, 1e-3), '线段粗细 0.05 且垂直于端点连线（端点可编辑）');
  assert(finiteGeom(diag), '斜线段无 NaN 顶点');
  const degenerate = geo('line', { x1: 1, y1: 1, z1: 1, x2: 1, y2: 1, z2: 1 });
  assert(finiteGeom(degenerate), '两端点重合时不产生 NaN（退化防护）');

  const pt = geo('point');
  assert(near(bounds(pt).max[0], 0.18), '点默认大小 0.18');
  assert(near(bounds(geo('point', { s: 0.5 })).max[1], 0.5), '点大小可调');
  assert(finiteGeom(pt), '点几何有限');
}

/* ---------------- G2. Circle3D 圆面 / Polygon3D 多边形面 ---------------- */
section('G2. Circle3D 圆面 / Polygon3D 多边形面：水平放置、双面临界、边数钳制');
{
  const ci = geo('circle');
  const cb = bounds(ci);
  assert(triangles(ci) === 64, '圆面 64 段近似 → 64 个三角面');
  assert(verts(ci).every((v) => near(v[1], 0)), 'rotateX(-90°) 后圆面水平（y 恒为 0）');
  assert(near(cb.max[0], 1.2) && near(cb.max[2], 1.2) && near(cb.min[0], -1.2), '半径 r=1.2 映射到 XZ 平面');
  assert(shapeMaterialConfig('circle', 1).side === 'double', '圆面材质 DoubleSide（背面可见）');
  assert(finiteGeom(ci), '圆面无 NaN 顶点');

  const hex = geo('polygon', { n: 6, r: 2 });
  const hb = bounds(hex);
  assert(triangles(hex) === 6, '正六边形面（n=6）6 个三角面');
  assert(verts(hex).every((v) => near(v[1], 0)), '多边形面水平（y 恒为 0）');
  // 正六边形外接半径 r=2：顶点到中心距离 = 2（包围盒在 Z 方向因朝向只到 ±√3，故用外接半径校验而非 bbox Z）
  const hexR = Math.max(...verts(hex).map((v) => Math.hypot(v[0], v[2])));
  assert(near(hexR, 2) && near(hb.max[0], 2), '正六边形外接半径 r=2 映射到 XZ 平面');
  assert(shapeMaterialConfig('polygon', 1).side === 'double', '多边形面材质 DoubleSide');
  assert(finiteGeom(hex), '多边形面无 NaN 顶点');
  // 边数 n 钳制到 [3,12]：2→3、20→12，且非整数四舍五入
  const tri = geo('polygon', { n: 2, r: 1 });
  assert(triangles(tri) === 3, 'n=2 钳制到 3（三角面）');
  const dode = geo('polygon', { n: 20, r: 1 });
  assert(triangles(dode) === 12, 'n=20 钳制到 12');
  const roundN = geo('polygon', { n: 3.6, r: 1 });
  assert(triangles(roundN) === 4, 'n=3.6 四舍五入为 4');
  // 脏参数：缺 n / 负数 / 字符串 → 回落默认 n=6
  const dirty = normalizeShapeParams('polygon', { n: null, r: -3 });
  assert(dirty.n === 6 && dirty.r === DIM_MIN, 'polygon 脏参数：n 回落默认 6、r 钳制到下限');
  assert(normalizeShapeParams('polygon', { bogus: 1 }).n === 6, 'polygon 未知键 n 回落默认 6');
  // 协议一致性：executor 参数键对齐
  assert(JSON.stringify(BOARD3D_PARAM_KEYS.circle) === JSON.stringify(['r']), 'circle 参数键与执行器一致');
  assert(JSON.stringify(BOARD3D_PARAM_KEYS.polygon) === JSON.stringify(['n', 'r']), 'polygon 参数键与执行器一致');
}

/* ---------------- H. B6 组合体与材质 / 透明排序 ---------------- */
section('H. B6 组合空间几何体：材质规格 + 由远及近 renderOrder');
{
  const cfgOpaque = shapeMaterialConfig('box', 1);
  assert(cfgOpaque.transparent === false && cfgOpaque.depthWrite === true, '不透明体写深度、不启用透明混合');
  const cfgTrans = shapeMaterialConfig('sphere', 0.35);
  assert(cfgTrans.transparent === true && cfgTrans.depthWrite === false && cfgTrans.opacity === 0.35,
    '半透明体 depthWrite:false（避免重叠透明体互相错误剔除 / z-fighting）');
  assert(shapeMaterialConfig('box', NaN).opacity === 1, '非法 opacity → 回落 1');
  assert(shapeMaterialConfig('box', 0).opacity === 0.1 && shapeMaterialConfig('box', 5).opacity === 1,
    'opacity 钳制到 [0.1, 1]');
  assert(shapeMaterialConfig('plane', 0.5).side === 'double' && shapeMaterialConfig('box', 0.5).side === 'front',
    '仅平面双面，其余单面');

  const cam = { x: 0, y: 0, z: 0 };
  const far = transparentRenderOrder(cam, { x: 0, y: 0, z: -10 });
  const nearV = transparentRenderOrder(cam, { x: 0, y: 0, z: -2 });
  assert(far < nearV && nearV < 0, '距离越远 renderOrder 越小（先画）→ 由远及近');
  assert(near(far, -10) && near(nearV, -2), 'renderOrder = -距离');
  assert(transparentRenderOrder(cam, cam) === 0, '零距离 → 0');
  assert(transparentRenderOrder(null, cam) === 0 && transparentRenderOrder(cam, { x: NaN, y: 0, z: 0 }) === 0,
    '非法输入 → 0（不污染渲染顺序）');
  const order = [3, 1, 8, 2].map((z) => transparentRenderOrder(cam, { x: 0, y: 0, z })).sort((x, y) => x - y);
  assert(order.every((v, i, arr) => i === 0 || arr[i - 1] <= v), '多透明体排序稳定单调');

  // 正方体 + 棱锥叠加：两个几何都成立，label 锚点型无 3D 几何（HTML 叠加层）
  const combo = [geo('box'), geo('pyramid'), geo('sphere', { r: 1 })];
  assert(combo.every((g) => g && triangles(g) > 0 && finiteGeom(g)), '正方体 + 棱锥 + 球组合：几何均有效');
  assert(createShapeGeometry(THREE, 'label', {}) === null, 'label 不产生 3D 几何（走投影叠加层）');
  assert(createShapeGeometry(THREE, 'unknown', {}) === null, '未知图元类型 → null（不进场景）');
  assert(createShapeGeometry(null, 'box', {}) === null, 'THREE 未注入 → null（纯函数可测性）');
  assert(finiteGeom(lineGeometry(THREE, normalizeShapeParams('line', { x1: 0, y1: 0, z1: 0, x2: 0, y2: 2, z2: 0 }))),
    'lineGeometry 竖直线段有限');
}

/* ---------------- I. 脏参数端到端防护 ---------------- */
section('I. 脏参数端到端：真实几何永不出现 NaN / 空几何');
{
  const dirty = [
    ['box', { w: NaN, h: -1, d: 'x' }],
    ['sphere', { r: -3 }],
    ['cylinder', { rt: Infinity, rb: 0, h: 1e12 }],
    ['cone', { r: 'abc', h: null }],
    ['pyramid', { s: 0, h: -2 }],
    ['prism', { r: NaN, h: 2 }],
    ['tetra', { s: '∞' }],
    ['plane', { w: 0, h: Infinity }],
    ['line', { x1: NaN, y1: 1e9, z1: 0, x2: Infinity, y2: 0, z2: 0 }],
    ['point', { s: -1 }],
  ];
  let allOk = true;
  for (const [t, p] of dirty) {
    const g = geo(t, p);
    if (!g || triangles(g) <= 0 || !finiteGeom(g)) allOk = false;
  }
  assert(allOk, `${dirty.length} 组脏参数生成的几何全部有效（顶点有限 / 有面 / bbox 有限）`);
  assert(src.includes('normalizeShapeParams(obj.type, obj.p)'), '内核在 addMeshForObj 落盘前清洗参数（属性面板与几何一致）');
}

/* ---------------- J. 接入静态断言 + 硬约束复核 ---------------- */
section('J. 真实内核接入 / 协作铁律 / 硬约束静态复核');
{
  assert(geomSrc.length > 0 && src.length > 0, '新纯函数模块与内核源码可读');
  assert(src.includes("from './board3d-geometry.js'"), 'board3d.js 引入纯函数模块（相对路径可解析）');
  assert(existsSync(join(ROOT, 'js/board3d-geometry.js')), 'js/board3d-geometry.js 文件存在（ESM 依赖闭合）');
  for (const k of ['createShapeGeometry(THREE', 'shapeMaterialConfig(obj.type', 'depthRenderOrder(',
    'normalizeShapeParams(obj.type', 'SHAPE_DEFS[raw.type] && raw.type !== \'label\'',
    'SHAPE_DEFS[o.type] && o.type !== \'label\'']) {
    assert(src.includes(k), `board3d.js 已接入 ${k}（防实现被回退）`);
  }
  assert(!/new THREE\.(Sphere|Cone|Cylinder|Tetrahedron|Plane)Geometry\(/.test(src),
    '几何构造已统一委托纯函数层（内核不再内联重复构造）');
  assert(src.includes('export function transparentRenderOrder') && src.includes('depthRenderOrder(camPos, worldPos)'),
    'transparentRenderOrder 导出名保留且委托纯函数层（B6 排序不回退）');
  assert(src.includes('SHAPE_DEFS[type]') || src.includes('SHAPE_DEFS[o.type]'),
    'importProject 仍按 SHAPE_DEFS 校验图元（既有 D4 回归断言不破）');
  assert(!geomSrc.includes("from 'three'") && !geomSrc.includes('document.') && !geomSrc.includes('window.'),
    '纯函数层不 import three / 不碰 DOM（可无头回归）');
  assert(!/from\s*['"](?:\.{1,2}\/)*(?:executor|board)\.js['"]/.test(src + geomSrc),
    '3D 内核与纯函数层均未混入 2D 的 js/executor.js / js/board.js');
  const editorJs = read('js/editor.js');
  assert(editorJs.includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍保留大角 SDK import');
  assert(editorJs.includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes("appId: 'ZYGKAQXC'"), '硬约束：js/config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在（新旧并存）');
  assert(read('board3d.html').includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(!/jsdelivr[^>]*three|unpkg[^>]*three/.test(read('board3d.html')), 'board3d.html 无 three 的 CDN 引用');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.includes('例8：细粒度样式') && prompt.includes('BOARD3D_SYSTEM_PROMPT'),
    '协作铁律：共享文件 ai/board-prompt.js 的 2D 主干与 3D 追加段并存（本轮未改）');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

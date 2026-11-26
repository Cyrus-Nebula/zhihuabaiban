/**
 * 立体画板「正多面体内外接球与棱长 / 欧拉公式验证（solidmetrics3d）」纯函数语义层（2026-11-27 D43 增量）
 *
 * 与 js/board3d-centroid.js / -euler.js / -circumsphere.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参，输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：给一种正多面体（tetra/cube/octa/dodeca/icosa），一次画出外接球与内切球
 * （各三个正交大圆），并标出棱长 a、外接半径 R、内切半径 r 与欧拉公式 V−E+F=2。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - polyhedron3d：只画正多面体**线框 + 顶点**，不求内切/外接球、不验证欧拉公式；
 *   - circumsphere3d / insphere3d / euler3d：只处理**四面体（四个不共面点）**，
 *     不覆盖正方体 / 正八面体 / 正十二面体 / 正二十面体；
 *   - solidmetrics3d 复用 polyhedron3d 的顶点与棱定义，补上「五种柏拉图立体的双球 +
 *     棱长 + 欧拉守恒」这一整套度量标注，直接服务「正方体外接球 / 正多面体内切球 /
 *     棱长与半径关系 / 验证欧拉公式」核心用例。
 *
 * 几何口径：顶点取 unitVertices(kind) 的标准直角坐标，按 radius/单位外接半径缩放并平移到 center；
 *   棱取 polyhedronEdges 的最小顶点间距判定（五种立体每条棱等长且为最短顶点连线）；
 *   面用「支撑平面」判据自动识别（其余顶点全在同一侧），面顶点按绕面心角度排序成环；
 *   外接半径 R=radius（所有顶点到 center 等距）；
 *   内切半径 r=各面到 center 的距离（五种正多面体各面距离相等）；
 *   欧拉示性数 χ=V−E+F，五种立体恒为 2。
 *   顶点数 / 棱数 / 面数不符拓扑表、棱长不等、R 或 r 不等、χ≠2 时整条拒绝。
 */

import {
  normalizeKind, unitVertices, polyhedronEdges, POLYHEDRON3D_TOPOLOGY,
} from './board3d-polyhedron.js';

/** 每种立体的每个面的边数（支撑平面识别用） */
export const SOLIDMETRICS3D_FACE_SIDES = Object.freeze({
  tetra: 3, cube: 4, octa: 3, dodeca: 5, icosa: 3,
});

/** 支持的正多面体规范名 */
export const SOLIDMETRICS3D_KINDS = Object.freeze(Object.keys(SOLIDMETRICS3D_FACE_SIDES));

/** 外接球半径 / 小球半径 / 采样段数合法区间与缺省值 */
export const SOLIDMETRICS3D_RADIUS_MIN = 0.01;
export const SOLIDMETRICS3D_RADIUS_MAX = 1000;
export const SOLIDMETRICS3D_RADIUS_DEFAULT = 1.5;
export const SOLIDMETRICS3D_VERTEX_SIZE_MIN = 0.01;
export const SOLIDMETRICS3D_VERTEX_SIZE_MAX = 1;
export const SOLIDMETRICS3D_VERTEX_SIZE_DEFAULT = 0.1;
export const SOLIDMETRICS3D_SEGMENTS_MIN = 8;
export const SOLIDMETRICS3D_SEGMENTS_MAX = 512;
export const SOLIDMETRICS3D_SEGMENTS_DEFAULT = 48;

/** 一条命令生成的 line 段总数上限（30 棱 + 6 大圆×segments） */
export const SOLIDMETRICS3D_MAX_SEGMENTS = 4096;

/** 各立体的中文名（标注用） */
export const SOLIDMETRICS3D_NAMES = Object.freeze({
  tetra: '正四面体', cube: '正方体', octa: '正八面体', dodeca: '正十二面体', icosa: '正二十面体',
});

/** 坐标钳制上限 / 默认颜色 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#2b7fd4';
const DEFAULT_CIRCUM_COLOR = '#e0a020';
const DEFAULT_IN_COLOR = '#28a879';
const DEFAULT_LABEL_COLOR = '#d04040';
const REL_TOL = 0.01;
const LABEL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 严格取有限数值；数字字符串容错，其余（表达式/null/''/数组/Infinity/NaN）一律拒绝 */
export function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

function clamp(x) {
  return Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, x));
}

/** 四位小数取整并归一 -0，便于稳定序列化 / 断言 */
function r4(x) {
  const n = Math.round(x * 1e4) / 1e4;
  return n === 0 ? 0 : n;
}

function r4Vec(p) {
  return p.map((x) => r4(clamp(x)));
}

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a) => Math.sqrt(dot3(a, a));
const unit3 = (a) => {
  const L = len3(a);
  return L > 1e-12 ? mul3(a, 1 / L) : null;
};

function parseCenter(v) {
  if (v === undefined) return [0, 0, 0];
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  if (out.some((x) => x === null)) return null;
  return r4Vec(out);
}

/** 基准轴：'x'/'y'/'z' 或非零向量，返回单位向量 */
function parseAxis(v) {
  const s = v === undefined ? 'z' : v;
  if (typeof s === 'string') {
    const k = s.trim().toLowerCase();
    if (k === 'x') return [1, 0, 0];
    if (k === 'y') return [0, 1, 0];
    if (k === 'z') return [0, 0, 1];
    return null;
  }
  if (!Array.isArray(s) || s.length !== 3) return null;
  const out = s.map(num);
  if (out.some((x) => x === null)) return null;
  return unit3(out);
}

/** 由单位法向 n 取一组正交标架 (n,u,v) */
function frame(n) {
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit3(cross3(n, helper));
  return { n, u, v: cross3(n, u) };
}

/**
 * 从顶点集合识别所有面（支撑平面判据）：
 * 三点定平面，若恰有 faceSides 个顶点落在该平面、其余顶点全在同一侧，则这是一个面。
 * 面顶点按绕面心的极角排序成环，便于后续画棱 / 核对多边形。
 */
export function solidmetricsFaces(vertices, faceSides) {
  if (!Array.isArray(vertices) || !Number.isInteger(faceSides) || faceSides < 3) return [];
  const tol = 1e-6;
  const found = new Map();
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      for (let k = j + 1; k < vertices.length; k++) {
        const normal = unit3(cross3(sub3(vertices[j], vertices[i]), sub3(vertices[k], vertices[i])));
        if (!normal) continue;
        const d = dot3(normal, vertices[i]);
        const on = [];
        const pos = [];
        const neg = [];
        for (let t = 0; t < vertices.length; t++) {
          const s = dot3(normal, vertices[t]) - d;
          if (Math.abs(s) < tol) on.push(t);
          else if (s > 0) pos.push(t);
          else neg.push(t);
        }
        if (on.length !== faceSides || (pos.length && neg.length)) continue;
        const key = on.slice().sort((a, b) => a - b).join(',');
        if (found.has(key)) continue;
        const center = [0, 1, 2].reduce((acc, axis) => {
          acc[axis] = on.reduce((s, t) => s + vertices[t][axis] / on.length, 0);
          return acc;
        }, [0, 0, 0]);
        const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const e1 = unit3(cross3(normal, helper));
        const e2 = cross3(normal, e1);
        const ordered = on.slice().sort((a, b) => {
          const va = sub3(vertices[a], center);
          const vb = sub3(vertices[b], center);
          return Math.atan2(dot3(va, e2), dot3(va, e1)) - Math.atan2(dot3(vb, e2), dot3(vb, e1));
        });
        found.set(key, ordered);
      }
    }
  }
  return [...found.values()];
}

/**
 * 正多面体双球几何（全精度，不取整）。
 * 返回 { vertices, edges, faces, faceCenters, edgeLength, circumRadius, inRadius, inRadii, euler, holds }。
 */
export function solidmetrics3DGeometry(kind, center, radius) {
  if (!(radius > 0) || !Number.isFinite(radius)) return null;
  const topo = POLYHEDRON3D_TOPOLOGY[kind];
  if (!topo || !SOLIDMETRICS3D_FACE_SIDES[kind]) return null;
  const unit = unitVertices(kind);
  if (!Array.isArray(unit) || unit.length !== topo.vertices) return null;
  const faces = solidmetricsFaces(unit, SOLIDMETRICS3D_FACE_SIDES[kind]);
  if (faces.length !== topo.faces) return null;
  const edges = polyhedronEdges(unit);
  if (edges.length !== topo.edges) return null;

  const maxUnit = Math.max(...unit.map(len3));
  if (!(maxUnit > 0)) return null;
  const k = radius / maxUnit;
  const vertices = unit.map((v) => add3(center, mul3(v, k)));
  const circumRadii = vertices.map((v) => len3(sub3(v, center)));
  const edgeLengths = edges.map(([i, j]) => len3(sub3(vertices[i], vertices[j])));
  const inRadii = faces.map((f) => {
    const n = unit3(cross3(sub3(vertices[f[1]], vertices[f[0]]), sub3(vertices[f[2]], vertices[f[0]])));
    return n ? Math.abs(dot3(n, sub3(vertices[f[0]], center))) : NaN;
  });
  const faceCenters = faces.map((f) => [0, 1, 2].reduce((acc, axis) => {
    acc[axis] = f.reduce((s, t) => s + vertices[t][axis] / f.length, 0);
    return acc;
  }, [0, 0, 0]));

  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const eq = (xs, target) => xs.every((x) => Number.isFinite(x) && Math.abs(x - target) <= Math.max(target * REL_TOL, 1e-6));
  const circumRadius = avg(circumRadii);
  const edgeLength = avg(edgeLengths);
  const inRadius = avg(inRadii);
  const euler = vertices.length - edges.length + faces.length;
  const holds = eq(circumRadii, radius) && eq(edgeLengths, edgeLength)
    && eq(inRadii, inRadius) && euler === 2 && inRadius > 0 && edgeLength > 0;
  return {
    vertices, edges, faces, faceCenters,
    circumRadius, inRadius, edgeLength,
    circumRadii, edgeLengths, inRadii,
    vertexCount: vertices.length, edgeCount: edges.length, faceCount: faces.length,
    euler, holds,
  };
}

/** 三个正交大圆的闭合采样点（segments+1 个点，末点=首点） */
function greatCircles(center, radius, axis, segments) {
  const { n, u, v } = frame(axis);
  const ring = (a, b) => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      pts.push(add3(center, add3(mul3(a, radius * Math.cos(t)), mul3(b, radius * Math.sin(t)))));
    }
    return pts;
  };
  return [ring(u, v), ring(n, u), ring(n, v)];
}

/**
 * 解析一条 solidmetrics3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"solidmetrics3d","id":"sm","kind":"cube","center":[0,0,0],"radius":2,
 *    "axis":"z","segments":48,"asEdges":true,"asCircumcircle":true,"asIncircle":true,
 *    "asVertices":false,"labelVertices":false,"labelKind":true,"labelRadii":true,"labelEuler":true}
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolveSolidmetrics3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: '命令为空' };

  const prefix = cmd.id === undefined ? 'sm3d' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  const rawKind = cmd.kind === undefined ? (cmd.solid === undefined ? 'cube' : cmd.solid) : cmd.kind;
  const kind = typeof rawKind === 'string' ? normalizeKind(rawKind) : null;
  if (!kind || !SOLIDMETRICS3D_FACE_SIDES[kind]) return { ok: false, error: `kind 非法：${String(rawKind)}` };

  const center = parseCenter(cmd.center);
  if (!center) return { ok: false, error: 'center 需为三个有限数 [x,y,z]' };

  const radiusRaw = cmd.radius === undefined ? SOLIDMETRICS3D_RADIUS_DEFAULT : num(cmd.radius);
  if (radiusRaw === null) return { ok: false, error: 'radius 必须是数字' };
  if (radiusRaw < SOLIDMETRICS3D_RADIUS_MIN || radiusRaw > SOLIDMETRICS3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${SOLIDMETRICS3D_RADIUS_MIN}~${SOLIDMETRICS3D_RADIUS_MAX}` };
  }
  const radius = radiusRaw;

  const axis = parseAxis(cmd.axis);
  if (!axis) return { ok: false, error: 'axis 需为 x/y/z 或非零三维向量' };

  const segRaw = cmd.segments === undefined ? SOLIDMETRICS3D_SEGMENTS_DEFAULT : num(cmd.segments);
  if (segRaw === null || !Number.isInteger(segRaw)
    || segRaw < SOLIDMETRICS3D_SEGMENTS_MIN || segRaw > SOLIDMETRICS3D_SEGMENTS_MAX) {
    return { ok: false, error: `segments 需为 ${SOLIDMETRICS3D_SEGMENTS_MIN}~${SOLIDMETRICS3D_SEGMENTS_MAX} 的整数` };
  }
  const segments = segRaw;

  const vsRaw = cmd.vertexSize === undefined ? SOLIDMETRICS3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vsRaw === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vsRaw < SOLIDMETRICS3D_VERTEX_SIZE_MIN || vsRaw > SOLIDMETRICS3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${SOLIDMETRICS3D_VERTEX_SIZE_MIN}~${SOLIDMETRICS3D_VERTEX_SIZE_MAX}` };
  }
  const vertexSize = vsRaw;

  const boolFields = ['asEdges', 'asCircumcircle', 'asIncircle', 'asVertices', 'labelVertices', 'labelKind', 'labelRadii', 'labelEuler'];
  const boolDefaults = {
    asEdges: true, asCircumcircle: true, asIncircle: true, asVertices: false,
    labelVertices: false, labelKind: true, labelRadii: true, labelEuler: true,
  };
  const flags = {};
  for (const f of boolFields) {
    const val = cmd[f] === undefined ? boolDefaults[f] : cmd[f];
    if (typeof val !== 'boolean') return { ok: false, error: `${f} 必须是布尔值` };
    flags[f] = val;
  }
  if (!boolFields.some((f) => flags[f])) return { ok: false, error: '八输出开关至少开一个' };

  for (const f of ['color', 'circumColor', 'inColor', 'labelColor']) {
    if (cmd[f] !== undefined && typeof cmd[f] !== 'string') return { ok: false, error: `${f} 必须是颜色字符串` };
  }
  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };
  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const circumColor = color(cmd.circumColor, DEFAULT_CIRCUM_COLOR);
  const inColor = color(cmd.inColor, DEFAULT_IN_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  const geo = solidmetrics3DGeometry(kind, center, radius);
  if (!geo || !geo.holds) return { ok: false, error: '正多面体拓扑 / 棱长 / 内外切半径 / 欧拉公式守恒失败' };
  const lineCount = geo.edges.length + (flags.asCircumcircle ? 3 * segments : 0) + (flags.asIncircle ? 3 * segments : 0);
  if (lineCount > SOLIDMETRICS3D_MAX_SEGMENTS) {
    return { ok: false, error: `线段总数 ${lineCount} 超过上限 ${SOLIDMETRICS3D_MAX_SEGMENTS}` };
  }

  // id 避让：收集 state 现有 id，生成时逐一避让
  const stem = prefix.slice(0, 56);
  const used = new Set(
    (state && Array.isArray(state.objects) ? state.objects : [])
      .map((o) => o && o.id).filter(Boolean)
  );
  const nextId = (want) => {
    if (!used.has(want)) { used.add(want); return want; }
    let k = 2;
    let cand = `${want.slice(0, 56)}_${k}`.slice(0, 64);
    while (used.has(cand)) { cand = `${want.slice(0, 56)}_${++k}`.slice(0, 64); }
    used.add(cand);
    return cand;
  };

  const mkLine = (id, p1, p2, col) => ({
    id, type: 'line', text: '', color: col, opacity: lineOpacity,
    pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    p: {
      x1: r4(p1[0]), y1: r4(p1[1]), z1: r4(p1[2]),
      x2: r4(p2[0]), y2: r4(p2[1]), z2: r4(p2[2]),
    },
  });
  // 大圆与 circumsphere3d / euler3d 同口径：每个采样段单独作为一条 line 落地。
  const pushCircle = (ring, makeId, col) => {
    for (let i = 0; i < segments; i++) {
      items.push(mkLine(nextId(makeId(i).slice(0, 64)), ring[i], ring[i + 1], col));
    }
  };
  const mkPoint = (id, q) => ({
    id, type: 'point', text: '', color: lineColor, opacity: lineOpacity,
    pos: r4Vec(q), rot: [0, 0, 0], scale: [1, 1, 1], p: { s: vertexSize },
  });
  const mkLabel = (id, text, q) => ({
    id, type: 'label', text, color: labelColor, opacity: 1,
    pos: r4Vec(q), rot: [0, 0, 0], scale: [1, 1, 1], p: {},
  });

  const items = [];
  const V = geo.vertices.map(r4Vec);

  // ---- 棱线框 ----
  if (flags.asEdges) {
    geo.edges.forEach(([i, j], n) => {
      items.push(mkLine(nextId(`${stem}_e${n}`.slice(0, 64)), V[i], V[j], lineColor));
    });
  }

  // ---- 外接球三个正交大圆 ----
  if (flags.asCircumcircle) {
    greatCircles(center, radius, axis, segments).forEach((ring, n) => {
      pushCircle(ring, (i) => `${stem}_oc${n}_${i}`, circumColor);
    });
  }

  // ---- 内切球三个正交大圆 ----
  if (flags.asIncircle) {
    greatCircles(center, geo.inRadius, axis, segments).forEach((ring, n) => {
      pushCircle(ring, (i) => `${stem}_ic${n}_${i}`, inColor);
    });
  }

  // ---- 顶点小球 ----
  if (flags.asVertices) {
    V.forEach((q, i) => items.push(mkPoint(nextId(`${stem}_pv${i}`.slice(0, 64)), q)));
  }

  // ---- 标注 ----
  if (flags.labelKind) {
    items.push(mkLabel(nextId(`${stem}_lk`.slice(0, 64)), SOLIDMETRICS3D_NAMES[kind],
      [center[0], center[1] + radius + 0.4, center[2]]));
  }
  if (flags.labelVertices) {
    V.forEach((q, i) => items.push(mkLabel(nextId(`${stem}_lv${i}`.slice(0, 64)), LABEL_LETTERS[i] || `V${i}`, q)));
  }
  const radiusTexts = [`R=${r4(geo.circumRadius)}`, `r=${r4(geo.inRadius)}`, `a=${r4(geo.edgeLength)}`];
  if (flags.labelRadii) {
    const a = V[geo.edges[0][0]];
    const b = V[geo.edges[0][1]];
    const mid = r4Vec([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    items.push(mkLabel(nextId(`${stem}_lR`.slice(0, 64)), radiusTexts[0], [center[0], center[1] + radius * 0.75, center[2]]));
    items.push(mkLabel(nextId(`${stem}_lr`.slice(0, 64)), radiusTexts[1], [center[0], center[1] + geo.inRadius * 0.75, center[2]]));
    items.push(mkLabel(nextId(`${stem}_la`.slice(0, 64)), radiusTexts[2], mid));
  }
  const eulerText = `V${geo.vertexCount}−E${geo.edgeCount}+F${geo.faceCount}=2`;
  if (flags.labelEuler) {
    items.push(mkLabel(nextId(`${stem}_lE`.slice(0, 64)), eulerText,
      [center[0], center[1] - radius - 0.4, center[2]]));
  }

  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      kind,
      name: SOLIDMETRICS3D_NAMES[kind],
      center: center.slice(),
      radius: r4(geo.circumRadius),
      inRadius: r4(geo.inRadius),
      edgeLength: r4(geo.edgeLength),
      vertexCount: geo.vertexCount,
      edgeCount: geo.edgeCount,
      faceCount: geo.faceCount,
      euler: geo.euler,
      eulerText,
      radiusTexts,
      axis: axis.slice(),
      segments,
      holds: geo.holds,
      asEdges: flags.asEdges,
      asCircumcircle: flags.asCircumcircle,
      asIncircle: flags.asIncircle,
      asVertices: flags.asVertices,
      labelVertices: flags.labelVertices,
      labelKind: flags.labelKind,
      labelRadii: flags.labelRadii,
      labelEuler: flags.labelEuler,
      vertexSize,
      edgeLineCount: flags.asEdges ? geo.edges.length : 0,
      circumCircleCount: flags.asCircumcircle ? 3 : 0,
      inCircleCount: flags.asIncircle ? 3 : 0,
      pointCount: flags.asVertices ? geo.vertexCount : 0,
      labelCount: (flags.labelKind ? 1 : 0) + (flags.labelVertices ? geo.vertexCount : 0)
        + (flags.labelRadii ? 3 : 0) + (flags.labelEuler ? 1 : 0),
      segmentCount: items.filter((it) => it.type === 'line').length,
      itemCount: items.length,
      color: lineColor,
      circumColor,
      inColor,
      labelColor,
      opacity: lineOpacity,
    },
  };
}

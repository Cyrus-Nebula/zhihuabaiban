/**
 * 立体画板「正多面体（柏拉图立体）」线框生成命令的纯函数语义层（2026-11-19 D17 增量）
 *
 * 与 js/board3d-arc.js / -bezier.js / -helix.js / -measure.js 同口径：
 *   - 不 import three、不碰 DOM、不调用任何画板 api，是**纯函数**，可在 Node 无头环境直接回归；
 *   - 全程只读入参、输出全新对象 / 数组，绝不修改 cmd / state。
 *
 * 作用：把「画一个正四面体 / 正方体 / 正八面体 / 正十二面体 / 正二十面体」「画空间几何体并标出顶点」
 * 这类意图，用柏拉图立体的标准顶点坐标，生成「棱（line）+ 顶点小球（point）+ 顶点标注（label）」
 * 一组对象，可直接交给 board3dApi.add() 逐项落地。执行器负责调用 add 并登记 id。
 *
 * 与既有命令的区别（不重复造轮子）：
 *   - add3d tetra：Three.js 内置正四面体**实体面**图元（单一对象、不可逐顶点标注）；
 *     add3d box / pyramid / prism：长方体 / 四棱锥 / 三棱柱实体图元；
 *   - polyhedron3d：补上正八面体 / 正十二面体 / 正二十面体这些 Three.js 基础体没有的柏拉图立体，
 *     以**线框 + 顶点**方式呈现，且每个顶点可自动生成可拾取的 point 小球与 label 标注，
 *     直接服务回归清单「画正方体 / 棱锥 / 空间几何体 / 标注顶点」用例。
 *
 * 数学口径：
 *   - 顶点用各自立体的标准直角坐标（含黄金比 φ 的十二/二十面体），先归一化到外接球半径 radius，
 *     再整体平移到 center；因此所有顶点到 center 的距离恒等于 radius；
 *   - 棱 = 顶点对中距离等于「最小顶点间距」的那些对（柏拉图立体每条棱等长且为最短顶点连线）：
 *     tetra 6 条 / cube 12 条 / octa 12 条 / dodeca 30 条 / icosa 30 条；
 *   - 面数仅写入 meta 供核对，不生成实体面（沿用线框口径，避免与 add3d 实体图元重复）。
 */

/** 支持的柏拉图立体（规范名） */
export const POLYHEDRON3D_KINDS = Object.freeze(['tetra', 'cube', 'octa', 'dodeca', 'icosa']);

/** 中文 / 英文别名 → 规范名（大小写不敏感；中文经 trim 后原样匹配） */
export const POLYHEDRON3D_ALIASES = Object.freeze({
  tetra: 'tetra', tetrahedron: 'tetra', 正四面体: 'tetra', 四面体: 'tetra',
  cube: 'cube', hexahedron: 'cube', 正方体: 'cube', 立方体: 'cube', 正六面体: 'cube', 六面体: 'cube',
  octa: 'octa', octahedron: 'octa', 正八面体: 'octa', 八面体: 'octa',
  dodeca: 'dodeca', dodecahedron: 'dodeca', 正十二面体: 'dodeca', 十二面体: 'dodeca',
  icosa: 'icosa', icosahedron: 'icosa', 正二十面体: 'icosa', 二十面体: 'icosa',
});

/** 各立体的顶点数 / 棱数 / 面数（meta 核对用） */
export const POLYHEDRON3D_TOPOLOGY = Object.freeze({
  tetra: Object.freeze({ vertices: 4, edges: 6, faces: 4 }),
  cube: Object.freeze({ vertices: 8, edges: 12, faces: 6 }),
  octa: Object.freeze({ vertices: 6, edges: 12, faces: 8 }),
  dodeca: Object.freeze({ vertices: 20, edges: 30, faces: 12 }),
  icosa: Object.freeze({ vertices: 12, edges: 30, faces: 20 }),
});

/** 外接球半径合法区间 / 缺省值 */
export const POLYHEDRON3D_RADIUS_MIN = 0.01;
export const POLYHEDRON3D_RADIUS_MAX = 1000;
export const POLYHEDRON3D_RADIUS_DEFAULT = 1.5;

/** 顶点小球半径合法区间 / 缺省值 */
export const POLYHEDRON3D_VERTEX_SIZE_MIN = 0.01;
export const POLYHEDRON3D_VERTEX_SIZE_MAX = 1;
export const POLYHEDRON3D_VERTEX_SIZE_DEFAULT = 0.14;

/** 坐标钳制上限 / 默认颜色 / 棱等长判定的相对容差 */
const COORD_LIMIT = 10000;
const DEFAULT_COLOR = '#4f6bed';
const DEFAULT_LABEL_COLOR = '#f2c14e';
const EDGE_REL_TOL = 1e-2;
const LABEL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const PHI = (1 + Math.sqrt(5)) / 2;

/** 严格取有限数值；数字字符串容错，其余一律拒绝 */
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

function color(v, def) {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : def;
}

function opacity(v) {
  const n = num(v);
  if (n === null) return 1;
  return Math.min(1, Math.max(0.1, n));
}

/** kind 归一化：别名 → 规范名，非法返回 null */
export function normalizeKind(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return POLYHEDRON3D_ALIASES[s] || POLYHEDRON3D_ALIASES[s.toLowerCase()] || null;
}

/**
 * 各立体的「单位」顶点直角坐标（未归一化到外接球、未平移）。
 * 纯函数，返回全新数组，调用方修改不影响后续调用。
 */
export function unitVertices(kind) {
  const signPairs = (cols) => {
    let out = [[]];
    for (const col of cols) {
      const next = [];
      for (const base of out) for (const s of [1, -1]) next.push([...base, s * col]);
      out = next;
    }
    return out;
  };
  if (kind === 'tetra') return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  if (kind === 'cube') return signPairs([1, 1, 1]);
  if (kind === 'octa') return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  if (kind === 'dodeca') {
    // 20 顶点：(±1,±1,±1) 8 个 + (0,±1/φ,±φ) + (±1/φ,±φ,0) + (±φ,0,±1/φ) 各 4 个。
    // 含 0 的坐标列经 signPairs 会生成重复点（+0 与 -0 同值），随后去重。
    const inv = 1 / PHI;
    const raw = [
      ...signPairs([1, 1, 1]),
      ...signPairs([0, inv, PHI]),
      ...signPairs([inv, PHI, 0]),
      ...signPairs([PHI, 0, inv]),
    ];
    const seen = new Set();
    return raw.filter((p) => {
      const key = p.map(r4).join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (kind === 'icosa') {
    return [
      [[0, 1, PHI], [0, 1, -PHI], [0, -1, PHI], [0, -1, -PHI]],
      [[1, PHI, 0], [1, -PHI, 0], [-1, PHI, 0], [-1, -PHI, 0]],
      [[PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1]],
    ].flat();
  }
  return [];
}

/**
 * 归一化到外接球半径 radius 并平移到 center 的顶点坐标数组。
 * 每个顶点到 center 的距离恒等于 radius（钳制前）。
 */
export function polyhedronVertices(kind, center, radius) {
  const unit = unitVertices(kind);
  return unit.map((v) => {
    const len = Math.hypot(v[0], v[1], v[2]);
    const k = radius / len;
    return [center[0] + v[0] * k, center[1] + v[1] * k, center[2] + v[2] * k].map((x) => r4(clamp(x)));
  });
}

/**
 * 从顶点坐标求棱：顶点对中距离等于最小顶点间距（相对容差）者即为一条棱。
 * 柏拉图立体每条棱等长且为最短顶点连线，故此判据对 5 种立体均成立。
 * 返回 [[i,j], ...] 顶点索引对。
 */
export function polyhedronEdges(vertices) {
  const n = vertices.length;
  const pairs = [];
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = vertices[i][0] - vertices[j][0];
      const dy = vertices[i][1] - vertices[j][1];
      const dz = vertices[i][2] - vertices[j][2];
      const q = dx * dx + dy * dy + dz * dz;
      pairs.push([i, j, q]);
      if (q < min) min = q;
    }
  }
  return pairs.filter((p) => Math.abs(p[2] - min) <= min * EDGE_REL_TOL).map((p) => [p[0], p[1]]);
}

/** 严格解析 center [x,y,z]：非三元组 / 含非有限数一律拒绝 */
function parseCenter(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x !== null) ? out.map(clamp) : null;
}

/**
 * 解析一条 polyhedron3d 命令（只读）。
 *
 * @param {Object} cmd 形如：
 *   {"op":"polyhedron3d","id":"sol","kind":"正八面体","center":[0,1,0],"radius":2,"asVertices":true,"labelVertices":true}
 *   - id            可选，生成对象的 id 前缀（默认 'poly'）；棱 _e<n> / 顶点 _v<n> / 标注 _l<n>；
 *   - kind          可选，tetra/cube/octa/dodeca/icosa 或其中文别名（默认 'cube'）；非法拒绝；
 *   - center        可选，外接球心 [x,y,z]（默认 [0,0,0]，数字字符串容错、±10000 钳制）；
 *   - radius        可选，外接球半径（默认 1.5，钳制 [0.01,1000]）；
 *   - asVertices    可选，是否在顶点放 point 小球（默认 true）；
 *   - labelVertices 可选，是否在每个顶点放 label 标注 A/B/C…（默认 false）；
 *   - vertexSize    可选，顶点小球半径（默认 0.14，钳制 [0.01,1]）；
 *   - color / labelColor / opacity 可选，棱线 / 标注 / 全体样式。
 *   任一数值参数只要在命令里出现就必须是合法有限数，否则整条原子拒绝、零副作用。
 * @param {Object} state 形如 { objects: [...] }，只读（仅用于生成 id 时避让已有 id）
 * @returns {{ok:boolean, items?:Array, meta?:Object, error?:string}}
 */
export function resolvePolyhedron3D(cmd, state) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: '命令为空' };

  // id 前缀：合法即用它，非法拒绝（不静默改写）
  const prefix = cmd.id === undefined ? 'poly' : cmd.id;
  if (!isId(prefix)) return { ok: false, error: `id 非法：${String(prefix)}` };

  // kind：别名白名单，非法拒绝
  const kind = cmd.kind === undefined ? 'cube' : normalizeKind(cmd.kind);
  if (!kind) return { ok: false, error: `kind 只支持 ${POLYHEDRON3D_KINDS.join('/')} 或其中文别名` };

  // 数值参数：只要在命令里出现就必须是合法有限数（脏值原子拒绝）
  const radius = cmd.radius === undefined ? POLYHEDRON3D_RADIUS_DEFAULT : num(cmd.radius);
  if (radius === null) return { ok: false, error: 'radius 必须是数字' };
  if (radius < POLYHEDRON3D_RADIUS_MIN || radius > POLYHEDRON3D_RADIUS_MAX) {
    return { ok: false, error: `radius 需为 ${POLYHEDRON3D_RADIUS_MIN}~${POLYHEDRON3D_RADIUS_MAX}` };
  }

  const vertexSize = cmd.vertexSize === undefined ? POLYHEDRON3D_VERTEX_SIZE_DEFAULT : num(cmd.vertexSize);
  if (vertexSize === null) return { ok: false, error: 'vertexSize 必须是数字' };
  if (vertexSize < POLYHEDRON3D_VERTEX_SIZE_MIN || vertexSize > POLYHEDRON3D_VERTEX_SIZE_MAX) {
    return { ok: false, error: `vertexSize 需为 ${POLYHEDRON3D_VERTEX_SIZE_MIN}~${POLYHEDRON3D_VERTEX_SIZE_MAX}` };
  }

  if (cmd.opacity !== undefined && num(cmd.opacity) === null) return { ok: false, error: 'opacity 必须是数字' };

  const center = cmd.center === undefined ? [0, 0, 0] : parseCenter(cmd.center);
  if (center === null) return { ok: false, error: 'center 必须是含 3 个有限数值的 [x,y,z]' };

  if (cmd.asVertices !== undefined && typeof cmd.asVertices !== 'boolean') {
    return { ok: false, error: 'asVertices 必须是布尔值' };
  }
  const asVertices = cmd.asVertices === undefined ? true : cmd.asVertices;
  if (cmd.labelVertices !== undefined && typeof cmd.labelVertices !== 'boolean') {
    return { ok: false, error: 'labelVertices 必须是布尔值' };
  }
  const labelVertices = cmd.labelVertices === true;

  const lineColor = color(cmd.color, DEFAULT_COLOR);
  const labelColor = color(cmd.labelColor, DEFAULT_LABEL_COLOR);
  const lineOpacity = opacity(cmd.opacity);

  // 顶点 / 棱：纯几何计算，只读入参
  const verts = polyhedronVertices(kind, center, radius);
  const edges = polyhedronEdges(verts);

  // id 避让：收集 state 现有 id，生成时逐一避让；后缀保留，前缀过长时先截短避免后缀被吃掉
  const used = new Set(
    (state && Array.isArray(state.objects) ? state.objects : [])
      .map((o) => o && o.id).filter(Boolean)
  );
  const stem = prefix.slice(0, 56);
  const nextId = (want) => {
    if (!used.has(want)) { used.add(want); return want; }
    let k = 2;
    let cand = `${want}_${k}`.slice(0, 64);
    while (used.has(cand)) { cand = `${want}_${++k}`.slice(0, 64); }
    used.add(cand);
    return cand;
  };

  const base = () => ({ rot: [0, 0, 0], scale: [1, 1, 1], opacity: lineOpacity });
  const items = [];

  // 棱：每条 line，端点写绝对坐标 p.x1..z2，pos 保持原点
  for (let i = 0; i < edges.length; i++) {
    const [vi, vj] = edges[i];
    const a = verts[vi];
    const b = verts[vj];
    items.push({
      ...base(),
      id: nextId(`${stem}_e${i + 1}`.slice(0, 64)),
      type: 'line',
      text: '',
      color: lineColor,
      pos: [0, 0, 0],
      p: { x1: a[0], y1: a[1], z1: a[2], x2: b[0], y2: b[1], z2: b[2] },
    });
  }

  // 顶点小球：可拾取、可标注锚点
  if (asVertices) {
    for (let i = 0; i < verts.length; i++) {
      items.push({
        ...base(),
        id: nextId(`${stem}_v${i + 1}`.slice(0, 64)),
        type: 'point',
        text: '',
        color: lineColor,
        pos: verts[i].slice(),
        p: { s: r4(vertexSize) },
      });
    }
  }

  // 顶点标注：A/B/C…，落在顶点坐标（HTML 叠加层，锚点型）
  const labels = [];
  if (labelVertices) {
    for (let i = 0; i < verts.length; i++) {
      const text = LABEL_LETTERS[i] || `V${i + 1}`;
      labels.push(text);
      items.push({
        id: nextId(`${stem}_l${i + 1}`.slice(0, 64)),
        type: 'label',
        text,
        color: labelColor,
        opacity: 1,
        pos: verts[i].slice(),
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        p: {},
      });
    }
  }

  const topo = POLYHEDRON3D_TOPOLOGY[kind];
  return {
    ok: true,
    items,
    meta: {
      id: prefix,
      kind,
      center: center.map(r4),
      radius: r4(radius),
      vertexCount: verts.length,
      edgeCount: edges.length,
      faceCount: topo.faces,
      asVertices,
      labelVertices,
      labels,
      color: lineColor,
      labelColor,
      opacity: lineOpacity,
      vertices: verts.map((v) => v.slice()),
      edges: edges.map((e) => e.slice()),
    },
  };
}

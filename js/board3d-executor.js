/**
 * 立体画板 AI 命令执行器（路线B）
 *
 * 与 js/executor.js（2D / JSXGraph 命令协议）完全平行、互不引用：
 *   - 本文件只认 3D 命令（add3d / label3d / update3d / remove3d / clear3d / view3d / reset3d）；
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
        default:
          results.push({ op, ok: false, error: `不支持的 3D 命令 ${op || '(空)'}；3D 分支不识别 2D 命令` });
      }
    } catch (e) {
      results.push({ op, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
  return results;
}


/**
 * 3D 镜像复制命令（mirror3d · D11）无头回归。
 *
 * 覆盖：resolveMirror3D 纯函数（默认镜像 / 三轴反射数学与 through 偏移 / 朝向反射共轭 /
 *       keepOrientation / line 端点反射 / 覆盖字段 / id 避让 / 深度只读性 / 脏输入原子拒绝）、
 *       执行器集成（同批先建后镜像、id 冲突、api 降级、2D 命令隔离、known 登记）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_mirror.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_RADIAL_PROMPT_OPS,
  BOARD3D_MIRROR_PROMPT_OPS, BOARD3D_MIRROR_PROMPT, BOARD3D_RADIAL_PROMPT,
  BOARD3D_DUPLICATE_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
} from '../js/board3d-executor.js';
import {
  MIRROR3D_COPIES, resolveMirror3D, resolveRadial3D, resolveDuplicate3D,
} from '../js/board3d-duplicate.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const near = (a, b, eps = 1e-9) => typeof a === 'number' && typeof b === 'number'
  && Number.isFinite(a) && Math.abs(a - b) < eps;
const eq3 = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
  && a.every((x, i) => near(x, b[i]));

const scene = () => ({
  objects: [
    { id: 'pyr', type: 'pyramid', pos: [3, 1, 0], rot: [10, 20, 30], scale: [1, 2, 1],
      color: '#4f6bed', opacity: 0.8, p: { s: 2, h: 3 } },
    { id: 'ball', type: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#0ea5e9', opacity: 1, p: { r: 1 } },
    { id: 'seg', type: 'line', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#111827', opacity: 1, p: { x1: 1, y1: 2, z1: 3, x2: 4, y2: 5, z2: 6 } },
    { id: 'lblA', type: 'label', pos: [-2, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], text: 'A' },
    { id: 'plain', pos: [9, 9, 9] }, // 故意缺 type，用于脏输入断言
  ],
});

function mockApi(initial) {
  const objects = (initial || scene()).objects.map((o) => ({ ...o,
    pos: o.pos && o.pos.slice(), rot: o.rot && o.rot.slice(),
    scale: o.scale && o.scale.slice(), p: o.p && { ...o.p } }));
  return {
    objects,
    getState() { return { objects: this.objects, view: {} }; },
    add(obj) { if (this.objects.some((o) => o.id === obj.id)) return null;
      this.objects.push({ ...obj, pos: obj.pos.slice(), rot: obj.rot.slice(), scale: obj.scale.slice(), p: { ...obj.p } }); return obj.id; },
    update(id, patch) { const o = this.objects.find((x) => x.id === id); if (!o) return false; Object.assign(o, patch); return true; },
    remove(id) { const i = this.objects.findIndex((x) => x.id === id); if (i < 0) return false; this.objects.splice(i, 1); return true; },
    clear() { this.objects.length = 0; },
    setView() { return true; }, resetView() { return true; },
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const bad = (cmd, st, msg) => {
  const r = resolveMirror3D(cmd, st === undefined ? scene() : st);
  if (r.ok === false && !r.items) assert(true, msg);
  else assert(false, msg);
};

console.log('3D 镜像复制命令（mirror3d · D11）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');

assert(MIRROR3D_COPIES === 1, 'MIRROR3D_COPIES 为 1（镜像只复制一份）');
assert(Array.isArray(BOARD3D_MIRROR_OPS) && BOARD3D_MIRROR_OPS.length === 1
  && BOARD3D_MIRROR_OPS[0] === 'mirror3d', 'BOARD3D_MIRROR_OPS 恰含 mirror3d');
assert(Array.isArray(BOARD3D_MIRROR_PROMPT_OPS) && BOARD3D_MIRROR_PROMPT_OPS.length === 1
  && BOARD3D_MIRROR_PROMPT_OPS[0] === 'mirror3d', 'BOARD3D_MIRROR_PROMPT_OPS 恰含 mirror3d');
assert(BOARD3D_MIRROR_OPS[0] === BOARD3D_MIRROR_PROMPT_OPS[0], '执行器侧与提示词侧 mirror3d op 一致');
assert(BOARD3D_OPS.length === 7, '历史契约 BOARD3D_OPS 仍 7 条（零回归）');
assert(BOARD3D_ALL_OPS.length === 8, '历史契约 BOARD3D_ALL_OPS 仍 8 条（零回归）');
assert(BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_FULL_OPS 仍 9 条（零回归）');
assert(BOARD3D_COMPLETE_OPS.length === 10, '历史契约 BOARD3D_COMPLETE_OPS 仍 10 条（零回归）');
assert(BOARD3D_COMPLETE2_OPS.length === 11, '历史契约 BOARD3D_COMPLETE2_OPS 仍 11 条（零回归）');
assert(BOARD3D_COMPLETE3_OPS.length === 12, 'BOARD3D_COMPLETE3_OPS 含全部 12 条');
assert(!BOARD3D_COMPLETE2_OPS.includes('mirror3d'), 'mirror3d 未并入历史 COMPLETE2 契约（只追加独立组）');
assert(BOARD3D_COMPLETE3_OPS.includes('mirror3d'), 'mirror3d 并入新完整集供核对');
assert(BOARD3D_PROMPT_OPS.length === 7 && BOARD3D_MEASURE_PROMPT_OPS.length === 1
  && BOARD3D_TRANSFORM_PROMPT_OPS.length === 1 && BOARD3D_DUPLICATE_PROMPT_OPS.length === 1
  && BOARD3D_RADIAL_PROMPT_OPS.length === 1, '共享文件既有 PROMPT_OPS 契约数量未变');
assert(typeof BOARD3D_MIRROR_PROMPT === 'string' && BOARD3D_MIRROR_PROMPT.includes('mirror3d'),
  'BOARD3D_MIRROR_PROMPT 导出且含命令名');
assert(typeof resolveMirror3D === 'function' && typeof resolveRadial3D === 'function'
  && typeof resolveDuplicate3D === 'function', '纯函数层三个 resolve 导出并存（旧函数未删）');
assert(typeof BOARD_SYSTEM_PROMPT === 'string' && BOARD_SYSTEM_PROMPT.includes('JSXGraph'),
  '2D 主干系统提示词仍在（共享文件未被整体替换）');

/* ---------------- B. 默认镜像与基本形状 ---------------- */
section('B. resolveMirror3D 默认镜像与基本形状');

{
  const st = scene();
  const before = JSON.stringify(st);
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr' }, st);
  assert(r.ok === true, '默认命令成功');
  assert(r.items && r.items.length === 1, '只产出 1 份镜像副本');
  const it = r.items[0];
  assert(it.id === 'pyr_mir', '默认 id 为 <src>_mir');
  assert(it.type === 'pyramid', '沿用源对象 type');
  assert(it.color === '#4f6bed' && near(it.opacity, 0.8), '沿用源颜色 / 透明度');
  assert(eq3(it.scale, [1, 2, 1]), '沿用源 scale（不用负缩放，避免破面）');
  assert(eq3(it.pos, [-3, 1, 0]), '默认 axis=x、through=0：x 反射为 -3，y/z 不变');
  assert(eq3(it.rot, [10, -20, -30]), '默认朝向按反射共轭：除镜像轴外两个分量取反');
  assert(it.p && near(it.p.s, 2) && near(it.p.h, 3), '几何参数沿用源（长度类参数与镜像无关）');
  assert(r.meta && r.meta.axis === 'x' && near(r.meta.through, 0) && r.meta.plane === 'yz',
    'meta 记录 axis / through / plane');
  assert(eq3(r.meta.pos, it.pos), 'meta.pos 与副本 pos 一致');
  assert(JSON.stringify(st) === before, 'state 未被修改（源场景零副作用）');
}

/* ---------------- C. 三轴反射数学与 through 偏移 ---------------- */
section('C. 三轴反射数学 / through 偏移 / 钳制');

{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'y', through: 2 }, scene());
  assert(r.ok === true && eq3(r.items[0].pos, [3, 3, 0]),
    'axis=y、through=2：2*2-1=3，x/z 不变');
  assert(r.meta.plane === 'xz' && eq3(r.items[0].rot, [-10, 20, -30]),
    'axis=y 平面为 xz，rot 的 x/z 分量取反');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'z', through: -1 }, scene());
  assert(r.ok === true && eq3(r.items[0].pos, [3, 1, -2]),
    'axis=z、through=-1：2*(-1)-0=-2');
  assert(r.meta.plane === 'xy' && eq3(r.items[0].rot, [-10, -20, 30]),
    'axis=z 平面为 xy，rot 的 x/y 分量取反');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'x', through: 2.5 }, scene());
  assert(r.ok === true && eq3(r.items[0].pos, [2, 1, 0]),
    'axis=x、through=2.5：2*2.5-3=2');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', through: '4' }, scene());
  assert(r.ok === true && eq3(r.items[0].pos, [5, 1, 0]),
    'through 数字字符串容错：2*4-3=5');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', through: 1e9 }, scene());
  assert(r.ok === true && Number.isFinite(r.items[0].pos[0])
    && Math.abs(r.items[0].pos[0]) <= 10000, 'through 与结果位置钳制到 ±10000，无 Infinity');
}
{
  // 关于同一平面镜像两次应回到原位（反射是对合变换）
  const first = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'x', through: 2 }, scene());
  const st2 = { objects: [{ ...first.items[0], id: 'mirrored' }] };
  const second = resolveMirror3D({ op: 'mirror3d', id: 'mirrored', axis: 'x', through: 2 }, st2);
  assert(second.ok === true && eq3(second.items[0].pos, [3, 1, 0]),
    '同一平面反射两次回到源位置（反射对合）');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'ball' }, scene());
  assert(r.ok === true && eq3(r.items[0].pos, [0, 0, 0]),
    '源恰在镜像平面上时位置不变（不产生 NaN / 不瞬移）');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'lblA', axis: 'z' }, scene());
  assert(r.ok === true && r.items[0].type === 'label' && r.items[0].text === 'A'
    && eq3(r.items[0].pos, [-2, 0.5, 0]), 'Label3D 锚点同样可镜像且沿用文字');
}

/* ---------------- D. 朝向反射共轭与 keepOrientation ---------------- */
section('D. 朝向反射共轭 / keepOrientation');

{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'x', keepOrientation: true }, scene());
  assert(r.ok === true && eq3(r.items[0].rot, [10, 20, 30]),
    'keepOrientation=true 完全沿用源朝向');
  assert(r.meta.keepOrientation === true, 'meta 记录 keepOrientation');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'y' }, scene());
  assert(r.ok === true && eq3(r.items[0].rot, [-10, 20, -30]),
    'axis=y 时 rot.y 保持不变、其余取反');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'z' }, scene());
  assert(r.ok === true && eq3(r.items[0].rot, [-10, -20, 30]),
    'axis=z 时 rot.z 保持不变、其余取反');
}
assert(resolveMirror3D({ op: 'mirror3d', id: 'pyr' }, scene()).meta.keepOrientation === false,
  'keepOrientation 默认 false');

/* ---------------- E. line 端点反射与覆盖字段 ---------------- */
section('E. line 端点反射 / 可选覆盖字段');

{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'seg', axis: 'x' }, scene());
  assert(r.ok === true && near(r.items[0].p.x1, -1) && near(r.items[0].p.x2, -4),
    'line 的 x1/x2 沿镜像轴同步反射');
  assert(near(r.items[0].p.y1, 2) && near(r.items[0].p.z2, 6),
    'line 的非镜像轴端点分量保持不变');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'seg', axis: 'y', through: 1 }, scene());
  assert(r.ok === true && near(r.items[0].p.y1, 0) && near(r.items[0].p.y2, -3),
    'line 的 y1/y2 按 through=1 反射（2*1-2=0、2*1-5=-3）');
  assert(near(r.items[0].p.x1, 1) && near(r.items[0].p.z1, 3), '其余端点键不受影响');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', params: { s: 5 } }, scene());
  assert(r.ok === true && near(r.items[0].p.s, 5) && near(r.items[0].p.h, 3),
    'params 覆盖只改指定键，其余沿用源');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', scale: [2, 0.001, 3] }, scene());
  assert(r.ok === true && eq3(r.items[0].scale, [2, 0.05, 3]), 'scale 覆盖并钳制下限 0.05');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', color: '#e11d48', opacity: 5 }, scene());
  assert(r.ok === true && r.items[0].color === '#e11d48' && near(r.items[0].opacity, 1),
    'color 覆盖生效、opacity 按原口径钳制到 1');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', color: 'not-a-color' }, scene());
  assert(r.ok === true && r.items[0].color === '#4f6bed', '非法 color 回落源颜色');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', params: [1, 2, 3] }, scene());
  assert(r.ok === true && near(r.items[0].p.s, 2), 'params 为数组时忽略，不抛错也不污染 p');
}
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', params: 'x' }, scene());
  assert(r.ok === true && near(r.items[0].p.h, 3), 'params 为字符串时忽略');
}
{
  const st = scene();
  resolveMirror3D({ op: 'mirror3d', id: 'seg', axis: 'x', params: { x1: 99 } }, st);
  assert(near(st.objects[2].p.x1, 1) && near(st.objects[2].p.x2, 4),
    '覆盖与端点反射都不修改源对象的 p（只读）');
}

/* ---------------- F. id 规则与深度只读性 ---------------- */
section('F. id 规则 / 同名避让 / 深度只读性');

{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr', newId: 'pyr_left' }, scene());
  assert(r.ok === true && r.items[0].id === 'pyr_left', '显式 newId 生效');
}
bad({ op: 'mirror3d', id: 'pyr', newId: 'ball' }, undefined, '显式 newId 与现有 id 冲突即拒绝');
bad({ op: 'mirror3d', id: 'pyr', newId: 'bad id!' }, undefined, '非法 newId 拒绝');
{
  const st = scene();
  st.objects.push({ id: 'pyr_mir', type: 'box', pos: [0, 0, 0] });
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr' }, st);
  assert(r.ok === true && r.items[0].id === 'pyr_mir_2', '自动 id 冲突时追加 _2 避让');
}
{
  const st = scene();
  st.objects.push({ id: 'pyr_mir', type: 'box', pos: [0, 0, 0] },
    { id: 'pyr_mir_2', type: 'box', pos: [0, 0, 0] });
  const r = resolveMirror3D({ op: 'mirror3d', id: 'pyr' }, st);
  assert(r.ok === true && r.items[0].id === 'pyr_mir_3', '连续冲突继续避让到 _3');
}
{
  const st = deepFreeze(scene());
  const cmd = deepFreeze({ op: 'mirror3d', id: 'pyr', axis: 'x', through: 1,
    color: '#e11d48', scale: [2, 2, 2], params: { s: 4 }, newId: 'pyr_m' });
  let r;
  try { r = resolveMirror3D(cmd, st); } catch (e) { r = { ok: false, error: String(e) }; }
  assert(r.ok === true && eq3(r.items[0].pos, [-1, 1, 0]),
    '深度冻结的 cmd / state 下仍正常返回（入参只读，不尝试写入）');
  assert(r.items[0].id === 'pyr_m' && near(r.items[0].p.s, 4),
    '冻结入参时覆盖字段与 id 仍正确解析');
}
{
  const st = scene();
  const snapshot = JSON.stringify(st.objects[0]);
  resolveMirror3D({ op: 'mirror3d', id: 'pyr', axis: 'z', through: 3 }, st);
  assert(JSON.stringify(st.objects[0]) === snapshot, '源对象所有字段逐字节未变（零副作用）');
}

/* ---------------- G. 脏输入原子拒绝 ---------------- */
section('G. 脏输入原子拒绝（零副作用）');

bad(null, undefined, 'null 命令拒绝');
bad(undefined, undefined, 'undefined 命令拒绝');
bad('mirror3d', undefined, '字符串命令拒绝');
bad({ op: 'mirror3d' }, undefined, '缺 id 拒绝');
bad({ op: 'mirror3d', id: 'bad id' }, undefined, 'id 含空格拒绝');
bad({ op: 'mirror3d', id: 'nope' }, undefined, '源对象不存在拒绝');
bad({ op: 'mirror3d', id: 'plain' }, undefined, '源对象缺 type 拒绝');
bad({ op: 'mirror3d', id: 'pyr', axis: 'w' }, undefined, 'axis 非法字符串拒绝');
bad({ op: 'mirror3d', id: 'pyr', axis: 'X' }, undefined, 'axis 大写不静默转小写，拒绝');
bad({ op: 'mirror3d', id: 'pyr', axis: 1 }, undefined, 'axis 数字拒绝');
bad({ op: 'mirror3d', id: 'pyr', axis: null }, undefined, 'axis null 拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: 'abc' }, undefined, 'through 非数字字符串拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: '1+1' }, undefined, 'through 表达式字符串拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: 'Infinity' }, undefined, 'through Infinity 字符串拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: '' }, undefined, 'through 空串拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: [] }, undefined, 'through 数组拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: Infinity }, undefined, 'through Infinity 拒绝');
bad({ op: 'mirror3d', id: 'pyr', through: NaN }, undefined, 'through NaN 拒绝');
bad({ op: 'mirror3d', id: 'pyr', keepOrientation: 'true' }, undefined, 'keepOrientation 字符串拒绝');
bad({ op: 'mirror3d', id: 'pyr', keepOrientation: 1 }, undefined, 'keepOrientation 数字拒绝');
bad({ op: 'mirror3d', id: 'pyr' }, { objects: 'oops' }, 'state.objects 非数组时拒绝');
bad({ op: 'mirror3d', id: 'pyr' }, null, 'state 为 null 时拒绝（不抛错）');
{
  const r = resolveMirror3D({ op: 'mirror3d', id: 'nope' }, scene());
  assert(r.ok === false && !('items' in r), '拒绝结果不含 items（原子拒绝、零副作用）');
}

/* ---------------- H. 执行器集成 ---------------- */
section('H. 执行器集成');

{
  const api = mockApi();
  const results = applyBoard3DCommands([{ op: 'mirror3d', id: 'pyr', axis: 'x', through: 1 }], api);
  assert(results.length === 1 && results[0].ok === true, '执行器 mirror3d 成功');
  assert(results[0].source === 'pyr' && Array.isArray(results[0].created)
    && results[0].created.length === 1, '结果带源 id 与 1 项 created');
  assert(api.objects.filter((o) => o.id === 'pyr_mir').length === 1, '镜像副本进入场景');
  assert(eq3(api.objects.find((o) => o.id === 'pyr_mir').pos, [-1, 1, 0]),
    '副本位置 = 2*1-3 = -1（执行器按真实几何写入）');
  assert(results[0].meta && results[0].meta.axis === 'x' && results[0].meta.plane === 'yz',
    '结果带 meta 几何信息');
  assert(eq3(api.objects.find((o) => o.id === 'pyr').pos, [3, 1, 0]), '源对象仍保持在原位（不动源）');
}
{
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'add3d', id: 'src', type: 'box', pos: [4, 0, 0] },
    { op: 'mirror3d', id: 'src', axis: 'x' },
  ], api);
  assert(results.length === 2 && results[1].ok === true, '同批先 add3d 建源再 mirror3d 成功');
  assert(api.objects.filter((o) => o.type === 'box').length === 2, '场景共 1 源 + 1 镜像');
  assert(eq3(api.objects.find((o) => o.id === 'src_mir').pos, [-4, 0, 0]), '新源对象的镜像位置正确');
}
{
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'mirror3d', id: 'pyr', newId: 'mir1' },
    { op: 'update3d', id: 'mir1', color: '#ffffff' },
  ], api);
  assert(results.length === 2 && results[1].ok === true,
    '镜像副本登记进 known/types，后续 update3d 可修改它');
  assert(api.objects.find((o) => o.id === 'mir1').color === '#ffffff', 'update3d 实际生效');
}
{
  const api = mockApi();
  const results = applyBoard3DCommands([{ op: 'mirror3d', id: 'pyr', newId: 'ball' }], api);
  assert(results.length === 1 && results[0].ok === false, '显式目标 id 与现有对象冲突时执行器拒绝');
}
{
  // 自定义 api：getState 不反映本轮 add，触发执行器 known.has(item.id) 分支
  const base = mockApi();
  const fixed = base.objects.slice();
  const api = {
    objects: fixed,
    getState() { return { objects: fixed, view: {} }; },
    add(obj) { return obj.id; }, // 不写入 getState 的数组
    update() { return true; }, remove() { return true; }, clear() {},
    setView() { return true; }, resetView() { return true; },
  };
  const results = applyBoard3DCommands([
    { op: 'add3d', id: 'pyr_mir', type: 'sphere', pos: [0, 0, 0] },
    { op: 'mirror3d', id: 'pyr' },
  ], api);
  assert(results.length === 2 && results[1].ok === false
    && results[1].error === 'id 已存在', '自动 id 与本轮 known 冲突时执行器拒绝，不覆盖已有对象');
}
{
  const api = { add() { return null; }, getState() { return { objects: scene().objects }; },
    update() { return true; }, remove() { return true; }, clear() {}, setView() {}, resetView() {} };
  const results = applyBoard3DCommands([{ op: 'mirror3d', id: 'pyr' }], api);
  assert(results.length === 1 && results[0].ok === false, 'api.add 失败时如实报错，不伪装成功');
}
{
  const api = { add() { return 'x'; }, getState() { throw new Error('no state'); },
    update() { return true; }, remove() { return true; }, clear() {}, setView() {}, resetView() {} };
  const results = applyBoard3DCommands([
    { op: 'mirror3d', id: 'pyr' },
    { op: 'reset3d' },
  ], api);
  assert(results.length === 2 && results[0].ok === false, 'getState 抛错时 mirror3d 失败');
  assert(results[1].ok === true, '后续命令仍执行（整批不中断）');
}
{
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'mirror', id: 'pyr' },
    { op: 'reflect', id: 'pyr' },
    { op: 'point', x: 1, y: 2 },
  ], api);
  assert(results.length === 3 && results.every((r) => r.ok === false),
    '2D 命令（mirror / reflect / point）在 3D 执行器一律拒绝');
  assert(/不支持/.test(results[0].error), '拒绝信息说明不支持该命令');
}
{
  const api = mockApi();
  const results = applyBoard3DCommands([
    { op: 'mirror3d', id: 'pyr' },
    { op: 'mirror3d', id: 'pyr' },
  ], api, { maxCommands: 1 });
  assert(results.length === 2 && results[1].ok === false && /上限/.test(results[1].error),
    'maxCommands 上限仍生效');
}

/* ---------------- I. 协作铁律与硬约束静态复核 ---------------- */
section('I. 协作铁律 / 硬约束静态复核');

{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');
  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveMirror3D') && exec.includes("case 'mirror3d'"),
    '执行器接入 mirror3d 分支');
  assert(exec.includes('BOARD3D_MIRROR_OPS') && exec.includes('BOARD3D_COMPLETE3_OPS'),
    '执行器导出独立 MIRROR OPS 与新完整集');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '执行器仍不依赖 three / DOM');
  const dup = read('js/board3d-duplicate.js');
  assert(dup.includes('export function resolveMirror3D')
    && dup.includes('export function resolveRadial3D')
    && dup.includes('export function resolveDuplicate3D'),
    '纯函数层三个 resolve 并存（旧函数逐字保留）');
  assert(!dup.includes("from 'three'") && !dup.includes('document.') && !dup.includes('window.'),
    '纯函数层仍不依赖 three / DOM / window');
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_MIRROR_PROMPT'), '后端 import 并拼接 MIRROR 提示词');
  assert(be.indexOf('BOARD3D_DUPLICATE_PROMPT + BOARD3D_RADIAL_PROMPT') > -1,
    '历史拼接串仍为新串前缀（既有断言零回归）');
  assert(be.indexOf('BOARD3D_RADIAL_PROMPT + BOARD3D_MIRROR_PROMPT') > -1,
    'MIRROR 段拼在提示词最末尾（fitPrompt 裁剪保留尾部）');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD3D_RADIAL_PROMPT_OPS')
    < prompt.indexOf('export const BOARD3D_MIRROR_PROMPT_OPS'),
    '共享文件 MIRROR 段追加在 radial 段之后（仅末尾追加）');
  assert(prompt.includes('2D 的 polarArray / circularArray / array 等命令在本分支依旧不认识'),
    '共享文件既有 radial 段尾行仍在（未删除对方内容）');
  assert(prompt.includes('BOARD_SYSTEM_PROMPT') && prompt.includes('例 1'),
    '共享文件 2D 主干与示例仍在（未整体替换）');
  assert(typeof BOARD3D_RADIAL_PROMPT === 'string' && typeof BOARD3D_DUPLICATE_PROMPT === 'string',
    '既有 3D 提示词段仍可导入');
  // 硬约束：新旧路径并存
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'),
    '路由 3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('mirror3d') && page.includes('radial3d'),
    '页面 AI 面板提示新增 mirror3d 且保留 radial3d');
  const aiPanel = read('js/board3d-ai.js');
  assert(aiPanel.includes("r.op !== 'mirror3d'") && aiPanel.includes("r.op !== 'radial3d'"),
    '前端新增镜像结果展示且保留既有环形阵列展示');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干 js/board.js / js/executor.js 仍在（未触碰）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')),
    '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')),
    '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

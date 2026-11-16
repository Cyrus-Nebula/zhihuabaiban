/**
 * 3D 多对象对齐 / 等距分布命令（align3d · D13）无头回归。
 *
 * 覆盖：resolveAlign3D 纯函数（min/max/center 三种对齐 + to 显式目标 + distribute 等距
 *       分布与 start/end 端点 + 按坐标稳定排序 + 只改目标轴 + 坐标钳制 + 深度只读性 /
 *       11 类脏输入原子拒绝）、执行器集成（同批先建后对齐、known 校验、id 不存在、
 *       getState 降级、api 侧部分失败分项、2D 命令隔离、maxCommands）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_align.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_RADIAL_PROMPT_OPS,
  BOARD3D_MIRROR_PROMPT_OPS, BOARD3D_GRID_PROMPT_OPS, BOARD3D_ALIGN_PROMPT_OPS,
  BOARD3D_ALIGN_PROMPT, BOARD3D_GRID_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
} from '../js/board3d-executor.js';
import {
  ALIGN3D_MAX_IDS, ALIGN3D_AXES, ALIGN3D_MODES, resolveAlign3D,
} from '../js/board3d-align.js';
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

// 五个对象，X 坐标特意乱序 / 有并列，Y/Z 各不相同，用来验「只改目标轴」与稳定排序。
const scene = () => ({
  objects: [
    { id: 'a', type: 'box', pos: [4, 1, -1], rot: [0, 0, 0], scale: [1, 1, 1], color: '#4f6bed', opacity: 1, p: { w: 2, h: 2, d: 2 } },
    { id: 'b', type: 'sphere', pos: [-2, 5, 8], rot: [0, 0, 0], scale: [1, 1, 1], color: '#0ea5e9', opacity: 0.8, p: { r: 1 } },
    { id: 'c', type: 'label', pos: [1, -3, 3], rot: [0, 0, 0], scale: [1, 1, 1], text: 'C' },
    { id: 'd', type: 'pyramid', pos: [1, 2, 6], rot: [0, 0, 0], scale: [1, 1, 1], color: '#111827', opacity: 1, p: { s: 2, h: 2 } },
    { id: 'e', type: 'point', pos: [9, 0, -4], rot: [0, 0, 0], scale: [1, 1, 1], color: '#333', opacity: 1, p: { s: 0.2 } },
  ],
});
const ids5 = ['a', 'b', 'c', 'd', 'e'];

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

/* ---------------- A. 常量与协议两侧一致性 / 历史契约零回归 ---------------- */
section('A. 常量与历史契约零回归');
{
  assert(ALIGN3D_MAX_IDS === 32, 'ALIGN3D_MAX_IDS = 32');
  assert(JSON.stringify([...ALIGN3D_AXES]) === JSON.stringify(['x', 'y', 'z']), 'ALIGN3D_AXES = [x,y,z]');
  assert(JSON.stringify([...ALIGN3D_MODES]) === JSON.stringify(['min', 'max', 'center', 'distribute']),
    'ALIGN3D_MODES = [min,max,center,distribute]');
  assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 历史契约 7 条不变');
  assert(BOARD3D_ALL_OPS.length === 8, 'BOARD3D_ALL_OPS 历史契约 8 条不变');
  assert(BOARD3D_FULL_OPS.length === 9, 'BOARD3D_FULL_OPS 历史契约 9 条不变');
  assert(BOARD3D_COMPLETE_OPS.length === 10, 'BOARD3D_COMPLETE_OPS 历史契约 10 条不变');
  assert(BOARD3D_COMPLETE2_OPS.length === 11, 'BOARD3D_COMPLETE2_OPS 历史契约 11 条不变');
  assert(BOARD3D_COMPLETE3_OPS.length === 12, 'BOARD3D_COMPLETE3_OPS 历史契约 12 条不变');
  assert(BOARD3D_COMPLETE4_OPS.length === 13, 'BOARD3D_COMPLETE4_OPS 历史契约 13 条不变');
  assert(JSON.stringify(BOARD3D_ALIGN_OPS) === JSON.stringify(['align3d']), 'BOARD3D_ALIGN_OPS = [align3d]');
  assert(BOARD3D_COMPLETE5_OPS.length === 14, 'BOARD3D_COMPLETE5_OPS 完整集 14 条');
  assert(BOARD3D_COMPLETE5_OPS.includes('align3d') && BOARD3D_COMPLETE5_OPS.includes('grid3d'),
    '完整集含 align3d 且保留 grid3d');
  assert(BOARD3D_COMPLETE5_OPS.slice(0, 13).every((op, i) => op === BOARD3D_COMPLETE4_OPS[i]),
    '新完整集前 13 条与历史完整集逐项一致（旧集仍为前缀）');
  assert(JSON.stringify(BOARD3D_ALIGN_PROMPT_OPS) === JSON.stringify(['align3d']),
    '提示词侧 BOARD3D_ALIGN_PROMPT_OPS 与执行器一致');
  assert(BOARD3D_PROMPT_OPS.length === 7 && BOARD3D_MEASURE_PROMPT_OPS.length === 1
    && BOARD3D_TRANSFORM_PROMPT_OPS.length === 1 && BOARD3D_DUPLICATE_PROMPT_OPS.length === 1
    && BOARD3D_RADIAL_PROMPT_OPS.length === 1 && BOARD3D_MIRROR_PROMPT_OPS.length === 1
    && BOARD3D_GRID_PROMPT_OPS.length === 1,
    '共享文件全部既有 *_PROMPT_OPS 契约不变');
}

/* ---------------- B. min / max / center 对齐 ---------------- */
section('B. resolveAlign3D 对齐：min / max / center');
{
  const s = scene();
  const mn = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'min' }, s);
  assert(mn.ok && mn.items.length === 5, 'min 模式返回 5 个 patch');
  assert(mn.meta.lo === -2 && mn.meta.hi === 9 && mn.meta.target === -2, 'min: lo=-2 hi=9 target=-2');
  assert(mn.items.every((it) => it.patch.pos[0] === -2), 'min: 五个对象 X 全部对齐到 -2');
  assert(eq3(mn.items[0].patch.pos, [-2, 1, -1]) && eq3(mn.items[1].patch.pos, [-2, 5, 8]),
    'min: 只改 X，a 的 Y/Z=1/-1、b 的 Y/Z=5/8 保持');
  assert(mn.meta.ids.join(',') === ids5.join(','), 'items/meta.ids 按 ids 原顺序');

  const mx = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'max' }, s);
  assert(mx.ok && mx.meta.target === 9 && mx.items.every((it) => it.patch.pos[0] === 9), 'max: 全部对齐到 9');

  const ct = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'center' }, s);
  assert(ct.ok && near(ct.meta.target, 3.5) && ct.items.every((it) => near(it.patch.pos[0], 3.5)),
    'center: 全部对齐到 (min+max)/2 = 3.5');

  const def = resolveAlign3D({ op: 'align3d', ids: ids5 }, s);
  assert(def.ok && def.meta.axis === 'x' && def.meta.mode === 'center' && near(def.meta.target, 3.5),
    '缺省 axis=x / mode=center');
}

/* ---------------- C. to 显式目标 / 三轴 ---------------- */
section('C. to 显式目标 / 三轴独立');
{
  const s = scene();
  const t0 = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'y', mode: 'max', to: 0 }, s);
  assert(t0.ok && t0.meta.target === 0 && near(t0.meta.naturalTarget, 5), 'to=0 覆盖 max 的自动目标 5');
  assert(t0.items.every((it) => it.patch.pos[1] === 0), 'to: 五个对象 Y 全部对齐到 0');
  assert(t0.items.every((it, i) => near(it.patch.pos[0], s.objects[i].pos[0])
    && near(it.patch.pos[2], s.objects[i].pos[2])), 'to: X/Z 两轴完全不动');

  const tz = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'z', mode: 'min', to: '2.5' }, s);
  assert(tz.ok && tz.meta.target === 2.5 && tz.items.every((it) => it.patch.pos[2] === 2.5),
    '数字字符串 to="2.5" 容错生效');

  const tx = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'center' }, s);
  const ty = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'y', mode: 'center' }, s);
  assert(tx.ok && ty.ok && near(tx.meta.target, 3.5) && near(ty.meta.target, 1),
    'x 与 y 轴各自按本轴 min/max 计算（y: -3~5 → 1）');

  const clamp = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'min', to: 1e9 }, s);
  assert(clamp.ok && clamp.meta.target === 10000 && clamp.items.every((it) => it.patch.pos[0] === 10000),
    'to 超上限钳制到 COORD_LIMIT=10000');
  const clamp2 = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'min', to: -1e9 }, s);
  assert(clamp2.ok && clamp2.meta.target === -10000, 'to 超下限钳制到 -10000');
}

/* ---------------- D. distribute 等距分布 ---------------- */
section('D. resolveAlign3D 等距分布：stable 排序 / start / end');
{
  const s = scene();
  // X 坐标：a=4 b=-2 c=1 d=1 e=9 → 升序 b(-2), c(1), d(1), a(4), e(9)（c/d 并列按原顺序）
  const d = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'distribute' }, s);
  assert(d.ok && d.meta.start === -2 && d.meta.end === 9, 'distribute: 默认端点 = 组内 min/max');
  assert(JSON.stringify(d.meta.sortedIds) === JSON.stringify(['b', 'c', 'd', 'a', 'e']),
    'distribute: 按当前 X 坐标升序稳定排序（c/d 并列按 ids 原顺序）');
  assert(near(d.meta.targets[1], -2) && near(d.meta.targets[2], 0.75)
    && near(d.meta.targets[3], 3.5) && near(d.meta.targets[0], 6.25) && near(d.meta.targets[4], 9),
    'distribute: 5 点在 [-2,9] 上等距 2.75（-2/0.75/3.5/6.25/9）');
  // 单调性：按 sortedIds 顺序的目标严格递增且等距
  const sortedTargets = d.meta.sortedIds.map((id) => d.items[ids5.indexOf(id)].patch.pos[0]);
  assert(sortedTargets.every((v, i) => i === 0 || near(v - sortedTargets[i - 1], 2.75)),
    'distribute: 排序后相邻间距恒为 2.75（等差）');
  assert(d.items.every((it, i) => near(it.patch.pos[1], s.objects[i].pos[1])
    && near(it.patch.pos[2], s.objects[i].pos[2])), 'distribute: 只改 X，Y/Z 不动');

  const se = resolveAlign3D({ op: 'align3d', ids: ['a', 'b', 'c'], axis: 'z', mode: 'distribute', start: -3, end: 3 }, s);
  assert(se.ok && se.meta.start === -3 && se.meta.end === 3, 'start/end 显式端点生效');
  // z 坐标：a=-1 b=8 c=3 → 升序 a(-1), c(3), b(8) → 目标 -3, 0, 3
  assert(JSON.stringify(se.meta.sortedIds) === JSON.stringify(['a', 'c', 'b']), 'z 轴分布按 z 坐标排序');
  assert(near(se.items[0].patch.pos[2], -3) && near(se.items[2].patch.pos[2], 0)
    && near(se.items[1].patch.pos[2], 3), 'start/end: 三点在 [-3,3] 上等距 -3/0/3');

  // 反向区间（end < start）也能给出递减等差，不产生 NaN
  const rev = resolveAlign3D({ op: 'align3d', ids: ['a', 'b', 'c'], axis: 'x', mode: 'distribute', start: 6, end: 0 }, s);
  assert(rev.ok && rev.meta.start === 6 && rev.meta.end === 0
    && rev.meta.targets.every((v) => Number.isFinite(v)), '反向区间 end<start 结果仍有限，无 NaN');

  // 2 个对象：步长 = 全长，首尾不动
  const two = resolveAlign3D({ op: 'align3d', ids: ['a', 'b'], axis: 'x', mode: 'distribute' }, s);
  assert(two.ok && two.meta.sortedIds.join(',') === 'b,a'
    && near(two.items[1].patch.pos[0], -2) && near(two.items[0].patch.pos[0], 4),
    '2 个对象分布：b→-2、a→4（首尾保持）');
}

/* ---------------- E. 深度只读性 ---------------- */
section('E. 深度只读性 / 输出全新对象');
{
  const s = scene();
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.values(o).forEach(deepFreeze);
      Object.freeze(o);
    }
    return o;
  };
  const cmd = deepFreeze({ op: 'align3d', ids: ids5.slice(), axis: 'x', mode: 'distribute', start: 0, end: 10 });
  const st = deepFreeze(scene());
  const snapshot = JSON.stringify({ cmd, st });
  let r;
  let threw = false;
  try { r = resolveAlign3D(cmd, st); } catch (_) { threw = true; }
  assert(!threw, '深度冻结的 cmd / state 不抛异常');
  assert(r && r.ok, '冻结入参下仍正常解析');
  assert(JSON.stringify({ cmd, st }) === snapshot, 'cmd / state 逐字未被修改（只读性）');
  assert(r.items.every((it) => !Object.isFrozen(it.patch.pos)), '输出 patch.pos 是全新可变数组（非入参引用）');
  // 修改输出不影响源 state
  const s2 = scene();
  const r2 = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'min' }, s2);
  r2.items[0].patch.pos[0] = 999;
  assert(s2.objects[0].pos[0] === 4, '改输出 patch 不回写源 state.objects');
}

/* ---------------- F. 脏输入原子拒绝 ---------------- */
section('F. 脏输入原子拒绝（零副作用）');
{
  const s = scene();
  const bad = [
    [null, 'cmd=null'],
    [{}, '缺 ids'],
    [{ op: 'align3d', ids: 'abc' }, 'ids 非数组'],
    [{ op: 'align3d', ids: ['a'] }, 'ids 只有 1 个'],
    [{ op: 'align3d', ids: new Array(33).fill(0).map((_, i) => `x${i}`) }, 'ids 超过 32'],
    [{ op: 'align3d', ids: ['a', 'a'] }, 'ids 重复'],
    [{ op: 'align3d', ids: ['a', 'bad id'] }, 'ids 含非法字符'],
    [{ op: 'align3d', ids: ['a', 'ghost'] }, 'ids 含不存在对象'],
    [{ op: 'align3d', ids: ['a', 'b'], axis: 'w' }, 'axis 非法'],
    [{ op: 'align3d', ids: ['a', 'b'], axis: 'X' }, 'axis 大小写不认'],
    [{ op: 'align3d', ids: ['a', 'b'], mode: 'left' }, 'mode 非法'],
    [{ op: 'align3d', ids: ['a', 'b'], to: 'abc' }, 'to 非数值'],
    [{ op: 'align3d', ids: ['a', 'b'], to: Infinity }, 'to=Infinity'],
    [{ op: 'align3d', ids: ['a', 'b'], to: null }, 'to=null'],
    [{ op: 'align3d', ids: ['a', 'b'], start: {} }, 'start 非数值'],
    [{ op: 'align3d', ids: ['a', 'b'], end: '1+2' }, 'end 表达式'],
    [{ op: 'align3d', ids: ['a', 'b'], axis: ['x'] }, 'axis 数组'],
    [{ op: 'align3d', ids: ['a', 'b'] }, 'ok 对照（合法）'],
  ];
  let rejected = 0;
  for (const [c, label] of bad) {
    const r = resolveAlign3D(c, s);
    const isLast = label.startsWith('ok 对照');
    if (isLast ? r.ok : !r.ok) rejected++;
    else console.error('    ↳ 未通过：' + label + ' → ' + JSON.stringify(r));
  }
  assert(rejected === bad.length, `${bad.length} 组脏输入/对照全部按预期拒绝或放行`);
  assert(resolveAlign3D({ op: 'align3d', ids: ['a', 'b'] }, {}).ok === false,
    'state 为空 → 找不到对象，拒绝而非抛异常');
  assert(JSON.stringify(scene()) === JSON.stringify(s), '脏输入测试后 scene 工厂无副作用');
  // pos 脏值回落 0 而非 NaN
  const dirty = { objects: [
    { id: 'a', type: 'box', pos: [NaN, 1, 1] },
    { id: 'b', type: 'box', pos: [2, 2, 2] },
  ] };
  const rd = resolveAlign3D({ op: 'align3d', ids: ['a', 'b'], axis: 'x', mode: 'max' }, dirty);
  assert(rd.ok && rd.meta.lo === 0 && rd.meta.hi === 2 && rd.meta.target === 2
    && rd.items.every((it) => it.patch.pos.every(Number.isFinite)), 'pos 含 NaN 回落 0，输出无 NaN');
}

/* ---------------- G. applyBoard3DCommands 执行器集成 ---------------- */
section('G. applyBoard3DCommands 集成');
{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'align3d', ids: ids5, axis: 'x', mode: 'center' },
  ], api);
  assert(res[0].ok && res[0].applied.length === 5, 'align3d 执行成功，applied 5 项');
  assert(res[0].axis === 'x' && res[0].mode === 'center', '结果回读 axis/mode');
  assert(api.objects.every((o) => near(o.pos[0], 3.5)), 'api 里五个对象 X 真的被 update 到 3.5');
  assert(api.objects[0].pos[1] === 1 && api.objects[1].pos[2] === 8, 'api 里 Y/Z 未被改动');
  assert(api.objects.length === 5, 'align3d 不新增对象（对象数不变）');

  // 同批先 add3d 再 align3d（known 登记 + getState 可读）
  const api2 = mockApi({ objects: [] });
  const res2 = applyBoard3DCommands([
    { op: 'add3d', id: 'n1', type: 'box', pos: [0, 0, 0] },
    { op: 'add3d', id: 'n2', type: 'box', pos: [6, 0, 0] },
    { op: 'align3d', ids: ['n1', 'n2'], axis: 'x', mode: 'min' },
  ], api2);
  assert(res2[0].ok && res2[1].ok && res2[2].ok, '同批先建两个对象再对齐，三条都成功');
  assert(api2.objects.every((o) => o.pos[0] === 0), '新建对象也被对齐到 min=0');

  // id 不存在 → 失败但不中断后续命令
  const api3 = mockApi();
  const res3 = applyBoard3DCommands([
    { op: 'align3d', ids: ['a', 'ghost'], axis: 'x' },
    { op: 'add3d', id: 'after', type: 'box' },
  ], api3);
  assert(res3[0].ok === false && /不存在/.test(res3[0].error) && res3[1].ok === true,
    '对齐失败不影响后续命令');
  assert(api3.objects[0].pos[0] === 4, '校验失败零副作用（源对象未被改动）');

  // 纯函数层拒绝（mode 非法）也走 results 失败、整批不中断
  const api4 = mockApi();
  const res4 = applyBoard3DCommands([
    { op: 'align3d', ids: ['a', 'b'], mode: 'nope' },
    { op: 'clear3d' },
  ], api4);
  assert(res4[0].ok === false && res4[1].ok === true, '非法 mode 拒绝后 clear3d 仍执行');

  // getState 缺失 / 抛错降级，整批不抛异常
  const minimal = { add(obj) { return obj.id; } };
  const rm = applyBoard3DCommands([{ op: 'align3d', ids: ['a', 'b'] }], minimal);
  assert(rm[0].ok === false, 'known 为空 → 拒绝，不抛异常');
  const throwing = {
    getState() { throw new Error('boom'); }, add(obj) { return obj.id; }, update() { return true; },
  };
  const rt = applyBoard3DCommands([{ op: 'align3d', ids: ['a', 'b'] }], throwing);
  assert(rt[0].ok === false, 'getState 抛错 → 整批不中断，返回失败结果');

  // api.update 侧部分失败如实分项
  const partial = mockApi();
  const origUpdate = partial.update;
  partial.update = (id, patch) => (id === 'c' ? false : origUpdate.call(partial, id, patch));
  const rp = applyBoard3DCommands([{ op: 'align3d', ids: ['a', 'b', 'c'], axis: 'x', mode: 'min' }], partial);
  assert(rp[0].ok === false && rp[0].applied.length === 2 && rp[0].failed.length === 1
    && rp[0].failed[0].id === 'c', 'api.update 单项失败 → applied/failed 分项如实回报');

  // ids 为空 → 拒绝
  const api6 = mockApi();
  const r6 = applyBoard3DCommands([{ op: 'align3d', ids: [], axis: 'x' }], api6);
  assert(r6[0].ok === false, 'ids 空数组被拒绝');

  // 2D 命令隔离
  const api7 = mockApi();
  const r7 = applyBoard3DCommands([{ op: 'point', x: 0, y: 0 }], api7);
  assert(r7[0].ok === false && /2D|不支持/.test(r7[0].error), '3D 执行器拒绝 2D point 命令');

  // maxCommands 上限
  const api8 = mockApi();
  const r8 = applyBoard3DCommands(
    new Array(3).fill(0).map(() => ({ op: 'align3d', ids: ['a', 'b'], axis: 'x' })), api8, { maxCommands: 2 });
  assert(r8.length === 3 && r8[2].ok === false && /上限/.test(r8[2].error), 'maxCommands 上限生效');
}

/* ---------------- H. 协议一致性 / 协作铁律 / 硬约束 ---------------- */
section('H. 共享文件协议两侧一致性 / 协作铁律 / 硬约束静态复核');
{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');
  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveAlign3D') && exec.includes("case 'align3d'"), '执行器接入 align3d 分支');
  assert(exec.includes('BOARD3D_ALIGN_OPS') && exec.includes('BOARD3D_COMPLETE5_OPS'),
    '执行器导出独立 ALIGN OPS 与新完整集');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '执行器仍不依赖 three / DOM');
  const align = read('js/board3d-align.js');
  assert(align.includes('export function resolveAlign3D')
    && !align.includes("from 'three'") && !align.includes('document.') && !align.includes('window.'),
    '纯函数层独立成模块且不依赖 three / DOM / window');
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_ALIGN_PROMPT'), '后端 import 并拼接 ALIGN 提示词');
  assert(be.indexOf('BOARD3D_MIRROR_PROMPT + BOARD3D_GRID_PROMPT') > -1,
    '历史拼接串仍为新串前缀（既有断言零回归）');
  assert(be.indexOf('BOARD3D_GRID_PROMPT + BOARD3D_ALIGN_PROMPT') > -1,
    'ALIGN 段拼在提示词最末尾（fitPrompt 裁剪保留尾部）');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD3D_GRID_PROMPT_OPS')
    < prompt.indexOf('export const BOARD3D_ALIGN_PROMPT_OPS'),
    '共享文件 ALIGN 段追加在 grid 段之后（仅末尾追加）');
  assert(prompt.includes('2D 的 array / 阵列 / 复制等命令在本分支依旧不认识'),
    '共享文件既有 grid 段尾行仍在（未删除对方内容）');
  assert(prompt.includes('BOARD_SYSTEM_PROMPT') && prompt.includes('例 1'),
    '共享文件 2D 主干与示例仍在（未整体替换）');
  assert(typeof BOARD3D_GRID_PROMPT === 'string' && typeof BOARD3D_ALIGN_PROMPT === 'string'
    && BOARD3D_ALIGN_PROMPT.includes('align3d') && BOARD3D_ALIGN_PROMPT.includes('distribute'),
    '既有 3D 提示词段仍可导入，ALIGN 段含 align3d / distribute 说明');
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
  assert(page.includes('grid3d') && page.includes('align3d'),
    '页面 AI 面板提示新增 align3d 且保留 grid3d');
  const aiPanel = read('js/board3d-ai.js');
  assert(aiPanel.includes("al.op !== 'align3d'") && aiPanel.includes("g.op !== 'grid3d'"),
    '前端新增对齐结果展示且保留既有网格展示');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干 js/board.js / js/executor.js 仍在（未触碰）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')),
    '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')),
    '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

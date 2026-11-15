/**
 * 3D 多 id 批量变换（transform3d 的 ids 写法 / 用例 D8）无头回归。
 *
 * 覆盖：resolveTransform3DBatch 纯函数（多 id 独立增量 / 钳制 / 脏输入原子拒绝 / 只读性）、
 *       执行器集成（单 id 路径零回归、同批先建后批量、api 降级、2D 隔离）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_transform_batch.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS,
  BOARD3D_MEASURE_LABEL_PROMPT, BOARD3D_TRANSFORM_PROMPT,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_BATCH_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS,
} from '../js/board3d-executor.js';
import {
  TRANSFORM3D_FIELDS, TRANSFORM3D_SCALE_MIN, TRANSFORM3D_SCALE_MAX,
  TRANSFORM3D_COORD_LIMIT, TRANSFORM3D_ROT_LIMIT,
  TRANSFORM3D_BATCH_MAX_IDS, resolveTransform3D, resolveTransform3DBatch,
} from '../js/board3d-transform.js';
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
const finite3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

const scene = () => ({
  objects: [
    { id: 'cube', type: 'box', pos: [1, 2, 3], rot: [10, 20, 30], scale: [1, 1, 1] },
    { id: 'ball', type: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [2, 2, 2] },
    { id: 'lblA', type: 'label', pos: [-1, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], text: 'A' },
    { id: 'cone', type: 'cone', pos: [4, -2, 1], rot: [5, 5, 5], scale: [0.5, 0.5, 0.5] },
  ],
});

/** 与 js/board3d.js 的 board3dApi 同形状的测试替身 */
function mockApi(seed = scene) {
  const objects = seed().objects;
  return {
    objects,
    getState() { return { objects }; },
    add(o) {
      objects.push({ ...o, pos: o.pos.slice(), rot: o.rot.slice(), scale: o.scale.slice() });
      return o.id;
    },
    update(id, patch) {
      const o = objects.find((x) => x.id === id);
      if (!o) return false;
      for (const k of ['pos', 'rot', 'scale', 'text', 'color', 'opacity']) {
        if (patch[k] !== undefined) o[k] = patch[k];
      }
      if (patch.params && typeof patch.params === 'object') o.p = { ...o.p, ...patch.params };
      return true;
    },
    remove(id) { const i = objects.findIndex((x) => x.id === id); if (i < 0) return false; objects.splice(i, 1); return true; },
    clear() { objects.length = 0; },
    setView() {}, resetView() {},
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

console.log('3D 多 id 批量变换（transform3d / ids）无头回归');

/* ---------------- A. 常量与历史契约零回归 ---------------- */
section('A. 常量 / 历史协议契约零回归');
{
  assert(TRANSFORM3D_BATCH_MAX_IDS === 32
    && Number.isInteger(TRANSFORM3D_BATCH_MAX_IDS), '批量 id 上限导出为整数 32');
  assert(Object.isFrozen(TRANSFORM3D_FIELDS)
    && JSON.stringify([...TRANSFORM3D_FIELDS]) === '["translate","rotate","scale"]',
    '单 id 增量字段白名单逐字未变');
  assert(TRANSFORM3D_SCALE_MIN === 0.05 && TRANSFORM3D_SCALE_MAX === 100,
    'scale 上下限沿用 gizmo / settings 口径');
  assert(TRANSFORM3D_COORD_LIMIT === 10000 && TRANSFORM3D_ROT_LIMIT === 1e6,
    '坐标 / 旋转钳制常量未变');
  assert(Object.isFrozen(BOARD3D_OPS) && BOARD3D_OPS.length === 7,
    '既有 3D 命令白名单仍为 7 条（未因批量新增 op）');
  assert(JSON.stringify([...BOARD3D_MEASURE_OPS]) === '["measure3d"]', '量测扩展组未变');
  assert(JSON.stringify([...BOARD3D_ALL_OPS]) === JSON.stringify([...BOARD3D_OPS, 'measure3d'])
    && BOARD3D_ALL_OPS.length === 8, 'BOARD3D_ALL_OPS 历史契约仍恒为 8 条');
  assert(JSON.stringify([...BOARD3D_TRANSFORM_OPS]) === '["transform3d"]', '变换扩展组未变');
  assert(Object.isFrozen(BOARD3D_FULL_OPS) && BOARD3D_FULL_OPS.length === 9
    && BOARD3D_FULL_OPS[8] === 'transform3d', 'BOARD3D_FULL_OPS 仍为 9 条、末位 transform3d');
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    '共享文件 3D 主干 OPS 与执行器一致');
  assert(JSON.stringify([...BOARD3D_MEASURE_PROMPT_OPS]) === JSON.stringify([...BOARD3D_MEASURE_OPS]),
    '共享文件量测 OPS 与执行器一致');
  assert(JSON.stringify([...BOARD3D_TRANSFORM_PROMPT_OPS]) === JSON.stringify([...BOARD3D_TRANSFORM_OPS]),
    '共享文件变换 OPS 与执行器一致');
  assert(!BOARD3D_SYSTEM_PROMPT.includes('transform3d'), '既有 3D 主干逐字未动（新写法只在追加段）');
  assert(typeof BOARD3D_MEASURE_LABEL_PROMPT === 'string'
    && BOARD3D_MEASURE_LABEL_PROMPT.includes('annotate'), '既有回注标注追加段仍在');
  assert(BOARD3D_TRANSFORM_PROMPT.includes('一次只变换一个 id'), '既有 transform 追加段逐字保留');

  // 单 id 纯函数逐值零回归（抽样）
  const r = resolveTransform3D({ id: 'cube', translate: [2, 0, -1] }, scene());
  assert(r.ok && eq3(r.patch.pos, [3, 2, 2]) && JSON.stringify(r.fields) === '["translate"]',
    'resolveTransform3D 单 id 结果逐值未变');
  const r2 = resolveTransform3D({ id: 'ball', scale: [2, 2, 2] }, scene());
  assert(r2.ok && eq3(r2.patch.scale, [4, 4, 4]), '单 id scale 乘法未变');
}

/* ---------------- B. 批量纯函数：多 id 独立增量 ---------------- */
section('B. 批量纯函数 / 多 id 独立增量数学');
{
  const s = scene();
  const r = resolveTransform3DBatch({ ids: ['cube', 'ball', 'lblA', 'cone'], translate: [2, -1, 0.5] }, s);
  assert(r.ok, '四个 id 的批量平移解析成功');
  assert(JSON.stringify(r.ids) === '["cube","ball","lblA","cone"]', '结果 ids 与输入顺序一致');
  assert(JSON.stringify(r.fields) === '["translate"]', '结果 fields 为 translate');
  assert(r.items.length === 4, 'items 与 ids 一一对应（4 条）');
  assert(eq3(r.items[0].patch.pos, [3, 1, 3.5]), 'cube 按自身当前 pos 叠加');
  assert(eq3(r.items[1].patch.pos, [2, -1, 0.5]), 'ball 按自身当前 pos 叠加');
  assert(eq3(r.items[2].patch.pos, [1, -0.5, 0.5]), 'label3d 标注锚点同样可平移');
  assert(eq3(r.items[3].patch.pos, [6, -3, 1.5]), 'cone 按自身当前 pos 叠加');
  assert(r.items.every((it) => !it.patch.rot && !it.patch.scale), '未写的字段不出现在 patch 里');
  assert(r.items.every((it) => finite3(it.patch.pos)), '所有 patch 三元组有限（无 NaN / Infinity）');

  // 顺序无关：换顺序后每个 id 的目标值不变
  const rr = resolveTransform3DBatch({ ids: ['cone', 'lblA', 'ball', 'cube'], translate: [2, -1, 0.5] }, s);
  assert(rr.ok && rr.items.every((it) => {
    const ref = r.items.find((x) => x.id === it.id);
    return ref && eq3(it.patch.pos, ref.patch.pos);
  }), 'ids 顺序不影响各自目标值（同一份状态快照）');

  // 三字段组合：每个对象按自己的当前值算
  const r3 = resolveTransform3DBatch({
    ids: ['cube', 'ball'], translate: [1, 1, 1], rotate: [5, 5, 5], scale: [2, 2, 2],
  }, s);
  assert(r3.ok && JSON.stringify(r3.fields) === '["translate","rotate","scale"]',
    '三字段同时给出时 fields 顺序固定');
  assert(eq3(r3.items[0].patch.pos, [2, 3, 4]) && eq3(r3.items[0].patch.rot, [15, 25, 35])
    && eq3(r3.items[0].patch.scale, [2, 2, 2]), 'cube 三字段按自身当前值计算');
  assert(eq3(r3.items[1].patch.pos, [1, 1, 1]) && eq3(r3.items[1].patch.rot, [5, 5, 5])
    && eq3(r3.items[1].patch.scale, [4, 4, 4]), 'ball 三字段按自身当前值计算');

  // 单个 id 的 ids 写法 = 单 id 写法的目标值
  const rOne = resolveTransform3DBatch({ ids: ['cube'], translate: [2, 0, -1] }, s);
  const rSingle = resolveTransform3D({ id: 'cube', translate: [2, 0, -1] }, s);
  assert(rOne.ok && rSingle.ok && eq3(rOne.items[0].patch.pos, rSingle.patch.pos),
    'ids:[单个] 与单 id 写法结果一致');

  // 数字字符串容错沿用单 id 口径
  const rNum = resolveTransform3DBatch({ ids: ['cube', 'ball'], translate: ['2', '0', '-1'] }, s);
  assert(rNum.ok && eq3(rNum.items[0].patch.pos, [3, 2, 2]), '数字字符串增量容错');

  // 场景对象缺字段时回落默认（脏值不污染结果）
  const dirty = { objects: [
    { id: 'x', pos: [NaN, 1, 2], rot: null, scale: ['a', 2, 3] },
    { id: 'y' },
  ] };
  const rDirty = resolveTransform3DBatch({ ids: ['x', 'y'], translate: [1, 1, 1], scale: [2, 2, 2] }, dirty);
  assert(rDirty.ok && rDirty.items.every((it) => finite3(it.patch.pos) && finite3(it.patch.scale)),
    '场景对象脏值回落默认，输出仍全有限');
  assert(eq3(rDirty.items[1].patch.pos, [1, 1, 1]) && eq3(rDirty.items[1].patch.scale, [2, 2, 2]),
    '完全缺字段的对象按 [0,0,0]/[1,1,1] 计算');
}

/* ---------------- C. 钳制边界 ---------------- */
section('C. 钳制边界（沿用单 id 口径）');
{
  const big = { objects: [
    { id: 'a', pos: [9999, -9999, 9999], rot: [999999, 0, -999999], scale: [99, 0.05, 100] },
    { id: 'b', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
  ] };
  const r = resolveTransform3DBatch({
    ids: ['a', 'b'], translate: [100, -100, 100], rotate: [100, 0, -100], scale: [10, 0.001, 10],
  }, big);
  assert(r.ok, '极端批量输入仍解析成功（不抛错）');
  const a = r.items[0].patch, b = r.items[1].patch;
  assert(eq3(a.pos, [10000, -10000, 10000]), 'pos 三个分量分别钳制到 ±10000');
  assert(eq3(a.rot, [1000000, 0, -1000000]), 'rot 三个分量分别钳制到 ±1e6');
  assert(eq3(a.scale, [100, 0.05, 100]), 'scale 钳制到 [0.05,100]（下限不被 0.001 击穿）');
  assert(eq3(b.pos, [100, -100, 100]) && eq3(b.scale, [10, 0.05, 10]),
    '同一条命令里另一对象独立钳制（不被 a 的极值影响）');
  assert(r.items.every((it) => finite3(it.patch.pos) && finite3(it.patch.rot) && finite3(it.patch.scale)),
    '钳制后全部数值有限');
}

/* ---------------- D. 脏输入：整批原子拒绝 ---------------- */
section('D. 脏输入 / 校验阶段原子拒绝');
{
  const s = scene();
  const cases = [
    [{}, '缺 ids'],
    [{ ids: 'cube' }, 'ids 不是数组'],
    [{ ids: null }, 'ids 为 null'],
    [{ ids: [] }, 'ids 空数组'],
    [{ ids: ['cube', 'cube'] }, 'ids 含重复'],
    [{ ids: ['cube', 'ghost'] }, 'ids 含不存在对象'],
    [{ ids: ['cube', 'bad id'] }, 'ids 含非法字符'],
    [{ ids: [123, 'cube'] }, 'ids 含非字符串'],
    [{ ids: ['cube'], translate: [1, 2] }, '增量数组长度不为 3'],
    [{ ids: ['cube'], translate: [1, NaN, 0] }, '增量含 NaN'],
    [{ ids: ['cube'], translate: [1, Infinity, 0] }, '增量含 Infinity'],
    [{ ids: ['cube'], translate: '1,2,3' }, '增量是字符串'],
    [{ ids: ['cube'] }, '无任何增量字段'],
    [{ ids: ['cube'], scale: [0, 1, 1] }, 'scale 含 0'],
    [{ ids: ['cube'], scale: [-1, 1, 1] }, 'scale 含负数'],
    [{ ids: ['cube'], rotate: ['1+1', 0, 0] }, '增量是表达式字符串'],
    [{ ids: ['cube', 'ball'], scale: [1, 0, 1] }, '任一对象适用的增量非法也整批拒绝'],
  ];
  for (const [cmd, name] of cases) {
    const r = resolveTransform3DBatch(cmd, s);
    assert(!r.ok && typeof r.error === 'string' && r.error.length > 0, `拒绝：${name}（返回 error）`);
    assert(!('items' in r) && !('ids' in r), `拒绝：${name}（不返回 items / ids，零副作用）`);
  }
  const tooMany = Array.from({ length: TRANSFORM3D_BATCH_MAX_IDS + 1 }, (_, i) => `id${i}`);
  const rMany = resolveTransform3DBatch({ ids: tooMany, translate: [1, 0, 0] }, s);
  assert(!rMany.ok && rMany.error.includes('32'), `ids 超过 ${TRANSFORM3D_BATCH_MAX_IDS} 被拒绝`);
  const atLimit = { objects: Array.from({ length: TRANSFORM3D_BATCH_MAX_IDS }, (_, i) => ({
    id: `id${i}`, pos: [i, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
  })) };
  const rLimit = resolveTransform3DBatch({ ids: tooMany.slice(0, 32), translate: [1, 0, 0] }, atLimit);
  assert(rLimit.ok && rLimit.items.length === 32, '恰好 32 个 id 允许通过');
  assert(rLimit.items[31].id === 'id31' && eq3(rLimit.items[31].patch.pos, [32, 0, 0]),
    '上限处每个对象仍按自身当前值计算');

  // 原子性：含一个坏 id 时，好 id 也不产生 patch
  const rMix = resolveTransform3DBatch({ ids: ['cube', 'ghost', 'ball'], translate: [9, 9, 9] }, s);
  assert(!rMix.ok && rMix.error.includes('ghost'), '混合 ids 里坏 id 被点名');
  assert(!('items' in rMix), '混合 ids 不返回任何 items（校验阶段零副作用）');

  // state 为空 / 脏：整批拒绝而不是抛错
  assert(!resolveTransform3DBatch({ ids: ['cube'], translate: [1, 0, 0] }, {}).ok, '空 state 被拒绝');
  assert(!resolveTransform3DBatch({ ids: ['cube'], translate: [1, 0, 0] }, null).ok, 'null state 被拒绝');
  assert(!resolveTransform3DBatch(null, s).ok, 'null 命令被拒绝');
  assert(!resolveTransform3DBatch([], s).ok, '数组命令被拒绝');
}

/* ---------------- E. 只读性 ---------------- */
section('E. 入参只读性（深度冻结）');
{
  const s = deepFreeze(scene());
  const cmd = deepFreeze({ ids: ['cube', 'ball', 'lblA'], translate: [1, 2, 3], scale: [2, 2, 2] });
  const before = JSON.stringify(s);
  let r;
  let threw = false;
  try { r = resolveTransform3DBatch(cmd, s); } catch (_) { threw = true; }
  assert(!threw, '深度冻结的 cmd / state 不抛错');
  assert(r && r.ok && r.items.length === 3, '冻结入参下仍正常返回 3 条结果');
  assert(JSON.stringify(s) === before, 'state 逐字未变');
  assert(JSON.stringify(cmd) === '{"ids":["cube","ball","lblA"],"translate":[1,2,3],"scale":[2,2,2]}',
    'cmd 逐字未变');
  assert(r.items.every((it) => !Object.isFrozen(it.patch)), '输出 patch 是全新可变对象');
  const c2 = deepFreeze({ ids: ['ghost'], translate: [1, 0, 0] });
  const r2 = resolveTransform3DBatch(c2, s);
  assert(!r2.ok, '冻结入参下的拒绝路径同样不抛错');
}

/* ---------------- F. 执行器集成 ---------------- */
section('F. 执行器集成 / 单 id 路径零回归');
{
  const api1 = mockApi();
  const r1 = applyBoard3DCommands([
    { op: 'transform3d', ids: ['cube', 'ball', 'lblA'], translate: [2, -1, 0.5] },
  ], api1);
  assert(r1.length === 1 && r1[0].ok === true, '批量命令执行成功');
  assert(r1[0].op === 'transform3d' && r1[0].batch === true, '结果带 batch 标记');
  assert(JSON.stringify(r1[0].ids) === '["cube","ball","lblA"]', '结果回带 ids');
  assert(Array.isArray(r1[0].applied) && r1[0].applied.length === 3, 'applied 列出 3 个成功项');
  assert(!('failed' in r1[0]), '全成功时不带 failed 字段');
  assert(eq3(api1.objects.find((o) => o.id === 'cube').pos, [3, 1, 3.5])
    && eq3(api1.objects.find((o) => o.id === 'ball').pos, [2, -1, 0.5])
    && eq3(api1.objects.find((o) => o.id === 'lblA').pos, [1, -0.5, 0.5]),
  '三个对象的画板值分别按自身当前值写入');
  assert(api1.objects.length === 4, '批量变换不新增 / 不删除对象');
  assert(r1[0].applied.every((a) => a.patch && finite3(a.patch.pos)), 'applied 每项带真实 patch');

  // 单 id 旧路径结果结构逐字兼容（既有 128 项回归口径）
  const api2 = mockApi();
  const r2 = applyBoard3DCommands([{ op: 'transform3d', id: 'cube', translate: [2, 0, -1] }], api2);
  assert(r2[0].ok && r2[0].id === 'cube' && r2[0].batch === undefined
    && eq3(r2[0].patch.pos, [3, 2, 2]) && JSON.stringify(r2[0].fields) === '["translate"]',
  '单 id 路径仍返回 id / patch / fields 且无 batch 标记');

  // 同批先 add3d 再批量变换（读当前 getState）
  const api3 = mockApi(() => ({ objects: [] }));
  const r3 = applyBoard3DCommands([
    { op: 'add3d', id: 'n1', type: 'box', pos: [0, 0, 0] },
    { op: 'add3d', id: 'n2', type: 'box', pos: [5, 0, 0] },
    { op: 'transform3d', ids: ['n1', 'n2'], translate: [1, 2, 3] },
  ], api3);
  assert(r3.length === 3 && r3[0].ok && r3[1].ok && r3[2].ok, '同批先建后批量三条都成功');
  assert(eq3(api3.objects.find((o) => o.id === 'n1').pos, [1, 2, 3])
    && eq3(api3.objects.find((o) => o.id === 'n2').pos, [6, 2, 3]),
  '刚建好的对象也能被批量相对变换');

  // 原子拒绝：坏 id / 重复 / 空 / 脏增量，画板零副作用
  const rejects = [
    [{ op: 'transform3d', ids: ['cube', 'ghost'], translate: [9, 9, 9] }, '含不存在 id'],
    [{ op: 'transform3d', ids: ['cube', 'cube'], translate: [9, 9, 9] }, '含重复 id'],
    [{ op: 'transform3d', ids: [], translate: [9, 9, 9] }, '空 ids'],
    [{ op: 'transform3d', ids: ['cube'], translate: [1, 2] }, '增量数组长度错'],
    [{ op: 'transform3d', ids: ['cube'], scale: [0, 1, 1] }, 'scale 含 0'],
    [{ op: 'transform3d', ids: ['cube', 'bad id'], translate: [1, 0, 0] }, '含非法 id'],
  ];
  for (const [cmd, name] of rejects) {
    const api = mockApi();
    const snap = JSON.stringify(api.objects);
    const r = applyBoard3DCommands([cmd], api);
    assert(!r[0].ok && typeof r[0].error === 'string', `执行器拒绝：${name}`);
    assert(JSON.stringify(api.objects) === snap, `执行器拒绝：${name}（画板零副作用）`);
    assert(!('applied' in r[0]), `执行器拒绝：${name}（不返回 applied）`);
  }

  // api.update 对某个 id 返回 false：如实分项汇报
  const api6 = mockApi();
  const origUpdate = api6.update;
  api6.update = (id, patch) => (id === 'ball' ? false : origUpdate(id, patch));
  const r6 = applyBoard3DCommands([
    { op: 'transform3d', ids: ['cube', 'ball', 'lblA'], translate: [1, 0, 0] },
  ], api6);
  assert(!r6[0].ok && Array.isArray(r6[0].failed) && r6[0].failed.length === 1
    && r6[0].failed[0].id === 'ball', 'api 侧失败 id 被列入 failed');
  assert(r6[0].applied.length === 2 && r6[0].applied.some((a) => a.id === 'cube'),
    '其余成功项仍在 applied，不伪装成整批成功');
  assert(eq3(api6.objects.find((o) => o.id === 'cube').pos, [2, 2, 3])
    && eq3(api6.objects.find((o) => o.id === 'ball').pos, [0, 0, 0]),
  '失败对象未被改动、成功对象已写入');

  // getState 缺失 / 抛错：整批命令不中断
  const api7 = { clear() {}, setView() {}, resetView() {}, add() {}, update() {}, remove() {} };
  const r7 = applyBoard3DCommands([
    { op: 'transform3d', ids: ['cube'], translate: [1, 0, 0] },
    { op: 'clear3d' },
  ], api7);
  assert(r7.length === 2 && !r7[0].ok && r7[1].ok, 'getState 缺失时降级，后续命令继续执行');
  const api7b = mockApi();
  api7b.getState = () => { throw new Error('boom'); };
  const r7b = applyBoard3DCommands([
    { op: 'transform3d', ids: ['cube'], translate: [1, 0, 0] },
    { op: 'reset3d' },
  ], api7b);
  assert(r7b.length === 2 && !r7b[0].ok && r7b[1].ok, 'getState 抛错时整批不中断');

  // 2D 命令仍由 default 拒绝；maxCommands 仍生效
  const api8 = mockApi();
  const r8 = applyBoard3DCommands([
    { op: 'transform' }, { op: 'update' }, { op: 'measure' }, { op: 'point' },
  ], api8);
  assert(r8.length === 4 && r8.every((x) => !x.ok && x.error.includes('不支持的 3D 命令')),
    '2D 命令（transform/update/measure/point）仍被 3D 执行器拒绝');
  const api9 = mockApi();
  const r9 = applyBoard3DCommands([
    { op: 'reset3d' }, { op: 'reset3d' }, { op: 'reset3d' },
  ], api9, { maxCommands: 2 });
  assert(r9.length === 3 && r9[2].ok === false && r9[2].error.includes('上限'),
    'maxCommands 上限仍作用于新命令集');
}

/* ---------------- G. 协作铁律与硬约束静态复核 ---------------- */
section('G. 协作铁律 / 硬约束静态复核');
{
  const prompt = read('ai/board-prompt.js');
  const i2d = prompt.indexOf('export const BOARD_SYSTEM_PROMPT');
  const i3d = prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT = ');
  const iMeasure = prompt.indexOf('export const BOARD3D_MEASURE_PROMPT = ');
  const iLabel = prompt.indexOf('export const BOARD3D_MEASURE_LABEL_PROMPT = ');
  const iTransform = prompt.indexOf('export const BOARD3D_TRANSFORM_PROMPT = ');
  const iBatch = prompt.indexOf('export const BOARD3D_BATCH_PROMPT = ');
  assert(i2d >= 0 && i2d < i3d, '2D 主干仍位于 3D 追加段之前');
  assert(i3d < iMeasure && iMeasure < iLabel && iLabel < iTransform && iTransform < iBatch,
    '共享文件各追加段顺序：3D 主干 → 量测 → 回注 → transform → 批量（纯追加）');
  assert(typeof BOARD3D_BATCH_PROMPT === 'string'
    && BOARD3D_BATCH_PROMPT.includes('ids')
    && BOARD3D_BATCH_PROMPT.includes('transform3d')
    && BOARD3D_BATCH_PROMPT.includes('1~32')
    && BOARD3D_BATCH_PROMPT.includes('示例'), '批量追加段导出且说明 ids / 上限 / 示例');
  assert(BOARD3D_BATCH_PROMPT.includes('不是新命令'), '追加段声明不是新命令（不改 OPS 契约）');
  assert(prompt.includes('/* ↑↑↑ 3D 追加段落结束（2D 主干保持原样）↑↑↑ */'),
    '2D 主干结束标记仍在（未被整体替换）');

  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD3D_BATCH_PROMPT'), '后端 import 了批量追加段');
  assert(backend.includes('BOARD3D_SYSTEM_PROMPT + BOARD3D_MEASURE_PROMPT + BOARD3D_MEASURE_LABEL_PROMPT'),
    '既有 3D 拼接子串仍为新串前缀（历史断言零回归）');
  assert(backend.includes('+ BOARD3D_TRANSFORM_PROMPT'), '既有 transform 拼接子串仍在');
  assert(backend.includes('+ BOARD3D_TRANSFORM_PROMPT + BOARD3D_BATCH_PROMPT'),
    '3D 系统提示词末尾追加批量段');
  assert(backend.includes(': BOARD_SYSTEM_PROMPT,'), '2D 分支提示词逐字未动');
  assert(resolveBoardMode({}, '画一个圆') === '2d', '2D 意图仍判 2d（零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '画一个正方体') === '3d', '显式 mode:3d 仍判 3d');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveTransform3DBatch') && exec.includes("case 'transform3d'"),
    '执行器接入批量纯函数且保留 transform3d 分支');
  assert(exec.includes("case 'measure3d'") && exec.includes("case 'update3d'"),
    '执行器含量测与既有命令分支');
  assert(exec.includes('BOARD3D_FULL_OPS') && exec.includes('BOARD3D_ALL_OPS'),
    '执行器同时保留历史契约常量与完整集');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '3D 执行器仍不依赖 three / DOM');

  const tf = read('js/board3d-transform.js');
  assert(tf.includes('export function resolveTransform3D'), '单 id 纯函数仍在');
  assert(tf.includes('export function resolveTransform3DBatch')
    && tf.includes('export const TRANSFORM3D_BATCH_MAX_IDS'), '批量纯函数与上限常量导出');
  assert(!tf.includes("from 'three'") && !tf.includes('document.') && !tf.includes('window.'),
    '纯函数层仍不依赖 three / DOM / window');

  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('transform3d') && page.includes('ids 一次批量变换'),
    '页面 AI 面板提示追加了批量写法');
  const ai = read('js/board3d-ai.js');
  assert(ai.includes("m.op === 'measure3d'"), '前端仍展示量测结果（未被本轮覆盖）');
  assert(ai.includes('t.batch !== true') && ai.includes('批量变换'),
    '前端追加批量结果展示循环');

  // 硬约束：新旧路径并存，绝不删除大角 SDK / appId / 旧编辑器
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：js/config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由：3D→board3d.html、2D→board.html 仍在');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

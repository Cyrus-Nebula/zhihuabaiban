/**
 * 3D 相对变换命令（transform3d）无头回归。
 *
 * 覆盖：resolveTransform3D 纯函数（三类增量数学 / 钳制 / 脏输入 / 只读性）、
 *       执行器集成（同批先建后变换、2D 命令隔离、api 降级）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_transform.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS, BOARD3D_MEASURE_LABEL_PROMPT,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_TRANSFORM_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS,
} from '../js/board3d-executor.js';
import {
  TRANSFORM3D_FIELDS, TRANSFORM3D_SCALE_MIN, TRANSFORM3D_SCALE_MAX,
  TRANSFORM3D_COORD_LIMIT, TRANSFORM3D_ROT_LIMIT, resolveTransform3D,
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
  ],
});

console.log('3D 相对变换命令（transform3d）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');
{
  assert(Object.isFrozen(TRANSFORM3D_FIELDS)
    && JSON.stringify([...TRANSFORM3D_FIELDS]) === '["translate","rotate","scale"]',
    '增量字段白名单冻结且顺序为 translate / rotate / scale');
  assert(TRANSFORM3D_SCALE_MIN === 0.05, 'scale 下限与 gizmo / settings 的 0.05 一致');
  assert(TRANSFORM3D_SCALE_MAX === 100, 'scale 上限 100');
  assert(TRANSFORM3D_COORD_LIMIT === 10000, '坐标上限与 geometry 的 COORD_LIMIT 一致');
  assert(TRANSFORM3D_ROT_LIMIT === 1e6, '旋转累加上限 1e6');

  assert(Object.isFrozen(BOARD3D_OPS) && BOARD3D_OPS.length === 7,
    '既有 3D 命令白名单仍恒为 7 条（未被本轮扩展污染）');
  assert(JSON.stringify([...BOARD3D_MEASURE_OPS]) === '["measure3d"]',
    '量测扩展命令仍仅 measure3d');
  assert(JSON.stringify([...BOARD3D_ALL_OPS])
    === '["add3d","label3d","update3d","remove3d","clear3d","view3d","reset3d","measure3d"]',
    '历史契约常量 BOARD3D_ALL_OPS 仍恰为 8 条（既有断言零回归）');
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    '共享文件既有 7 条 op 与执行器仍逐项一致（2D 主干零回归）');
  assert(JSON.stringify([...BOARD3D_MEASURE_PROMPT_OPS]) === JSON.stringify([...BOARD3D_MEASURE_OPS]),
    '共享文件量测段 op 与执行器仍逐项一致');

  assert(Object.isFrozen(BOARD3D_TRANSFORM_OPS)
    && JSON.stringify([...BOARD3D_TRANSFORM_OPS]) === '["transform3d"]',
    '新扩展组 BOARD3D_TRANSFORM_OPS 冻结且仅 transform3d');
  assert(Object.isFrozen(BOARD3D_FULL_OPS) && BOARD3D_FULL_OPS.length === 9
    && BOARD3D_FULL_OPS[8] === 'transform3d',
    '完整命令集 BOARD3D_FULL_OPS 为 9 条且末位 transform3d');
  assert(JSON.stringify([...BOARD3D_FULL_OPS].slice(0, 8)) === JSON.stringify([...BOARD3D_ALL_OPS]),
    '完整集前 8 条逐项等于历史契约（纯追加，未重排 / 未删除）');
  assert(JSON.stringify([...BOARD3D_TRANSFORM_PROMPT_OPS]) === JSON.stringify([...BOARD3D_TRANSFORM_OPS]),
    '共享文件新增段 op 与执行器新扩展组逐项一致');

  assert(typeof BOARD3D_TRANSFORM_PROMPT === 'string'
    && BOARD3D_TRANSFORM_PROMPT.includes('translate')
    && BOARD3D_TRANSFORM_PROMPT.includes('rotate')
    && BOARD3D_TRANSFORM_PROMPT.includes('scale'), '新追加段导出且说明三种增量字段');
  assert(BOARD3D_TRANSFORM_PROMPT.includes('transform3d')
    && BOARD3D_TRANSFORM_PROMPT.includes('"id"'), '新追加段含命令名与 id 写法');
  assert(!BOARD_SYSTEM_PROMPT.includes('transform3d'), '2D 主干提示词未被注入 3D 变换命令');
  assert(!BOARD3D_SYSTEM_PROMPT.includes('transform3d'), '既有 3D 主干逐字未动（新命令只在追加段）');
  assert(BOARD3D_MEASURE_LABEL_PROMPT.includes('annotate'), '既有回注标注追加段仍在');
}

/* ---------------- B. resolveTransform3D 数学正确性 ---------------- */
section('B. 相对变换数学正确性');
{
  const s = scene();
  const t = resolveTransform3D({ id: 'cube', translate: [2, 0, -1] }, s);
  assert(t.ok && eq3(t.patch.pos, [3, 2, 2]), 'translate：当前 pos[1,2,3] + [2,0,-1] = [3,2,2]');
  assert(t.fields && JSON.stringify(t.fields) === '["translate"]', 'fields 只含本次给的字段');
  assert(!('rot' in t.patch) && !('scale' in t.patch), '未写的字段不进 patch（保持原值）');

  const r = resolveTransform3D({ id: 'cube', rotate: [0, 30, 0] }, s);
  assert(r.ok && eq3(r.patch.rot, [10, 50, 30]), 'rotate：当前 rot[10,20,30] + [0,30,0] = [10,50,30]');

  const sc = resolveTransform3D({ id: 'ball', scale: [1.5, 1, 0.5] }, s);
  assert(sc.ok && eq3(sc.patch.scale, [3, 2, 1]), 'scale：当前 [2,2,2] × [1.5,1,0.5] = [3,2,1]');
  assert(!('pos' in sc.patch), '只给 scale 时不改 pos');

  const all = resolveTransform3D(
    { id: 'cube', translate: [1, 1, 1], rotate: [5, 5, 5], scale: [2, 2, 2] }, s);
  assert(all.ok && eq3(all.patch.pos, [2, 3, 4]) && eq3(all.patch.rot, [15, 25, 35])
    && eq3(all.patch.scale, [2, 2, 2]), '三种增量在同一次命令里互不干扰');
  assert(JSON.stringify(all.fields) === '["translate","rotate","scale"]', 'fields 按白名单顺序输出');

  const str = resolveTransform3D({ id: 'cube', translate: ['1', '-2', '3'] }, s);
  assert(str.ok && eq3(str.patch.pos, [2, 0, 6]), '数字字符串容错（与 executor 的 num 同口径）');

  const lab = resolveTransform3D({ id: 'lblA', translate: [0, 1, 0] }, s);
  assert(lab.ok && eq3(lab.patch.pos, [-1, 1.5, 0]), 'label3d 锚点也支持 translate 平移');

  const noPos = resolveTransform3D({ id: 'x', translate: [1, 2, 3] },
    { objects: [{ id: 'x' }] });
  assert(noPos.ok && eq3(noPos.patch.pos, [1, 2, 3]), '当前 pos 缺失时回落 [0,0,0] 再叠加');
  const noScale = resolveTransform3D({ id: 'x', scale: [2, 2, 2] },
    { objects: [{ id: 'x' }] });
  assert(noScale.ok && eq3(noScale.patch.scale, [2, 2, 2]), '当前 scale 缺失时回落 [1,1,1] 再乘');

  const dirty = resolveTransform3D({ id: 'x', translate: [1, 0, 0], rotate: [0, 1, 0] },
    { objects: [{ id: 'x', pos: [NaN, 0, 0], rot: ['oops', 0, 0], scale: [Infinity, 1, 1] }] });
  assert(dirty.ok && finite3(dirty.patch.pos) && finite3(dirty.patch.rot)
    && eq3(dirty.patch.pos, [1, 0, 0]), '当前值含 NaN / Infinity / 脏字符串时回落默认，不污染输出');

  assert(resolveTransform3D({ id: 'cube', translate: [0, 0, 0] }, s).ok, '全零增量也是合法变换');
}

/* ---------------- C. 钳制边界 ---------------- */
section('C. 钳制边界');
{
  const big = resolveTransform3D({ id: 'x', translate: [1e9, -1e9, 0] },
    { objects: [{ id: 'x', pos: [0, 0, 0] }] });
  assert(big.ok && eq3(big.patch.pos, [TRANSFORM3D_COORD_LIMIT, -TRANSFORM3D_COORD_LIMIT, 0]),
    'translate 结果钳制到 ±COORD_LIMIT');

  const rot = resolveTransform3D({ id: 'x', rotate: [1e9, -1e9, 0] },
    { objects: [{ id: 'x', rot: [0, 0, 0] }] });
  assert(rot.ok && eq3(rot.patch.rot, [TRANSFORM3D_ROT_LIMIT, -TRANSFORM3D_ROT_LIMIT, 0]),
    'rotate 结果钳制到 ±ROT_LIMIT');

  const tiny = resolveTransform3D({ id: 'x', scale: [1e-9, 1e-9, 1e-9] },
    { objects: [{ id: 'x', scale: [1, 1, 1] }] });
  assert(tiny.ok && eq3(tiny.patch.scale, [0.05, 0.05, 0.05]), 'scale 乘后低于下限钳制到 0.05');

  const huge = resolveTransform3D({ id: 'x', scale: [1e9, 1e9, 1e9] },
    { objects: [{ id: 'x', scale: [1, 1, 1] }] });
  assert(huge.ok && eq3(huge.patch.scale, [100, 100, 100]), 'scale 乘后超上限钳制到 100');

  const negCur = resolveTransform3D({ id: 'x', scale: [1, 1, 1] },
    { objects: [{ id: 'x', scale: [-3, 0, 1] }] });
  assert(negCur.ok && finite3(negCur.patch.scale) && eq3(negCur.patch.scale, [0.05, 0.05, 1]),
    '当前 scale 含负值 / 零时乘积被钳制为合法值');

  for (const k of ['pos', 'rot', 'scale']) {
    const v = huge.patch[k] || tiny.patch[k] || big.patch[k] || rot.patch[k];
    if (v) assert(finite3(v), `钳制后 ${k} 三分量均有限`);
  }
  assert(big.patch.pos.every(Number.isFinite) && rot.patch.rot.every(Number.isFinite),
    '钳制后不残留 NaN / Infinity');
}

/* ---------------- D. 脏输入拒绝 ---------------- */
section('D. 脏输入一律拒绝');
{
  const s = scene();
  const bad = [
    [{}, '空命令'],
    [{ id: 'cube' }, '无任何增量字段'],
    [{ id: '', translate: [1, 0, 0] }, 'id 为空串'],
    [{ id: 123, translate: [1, 0, 0] }, 'id 非字符串'],
    [{ id: 'bad id', translate: [1, 0, 0] }, 'id 含空格'],
    [{ id: 'cube', translate: null }, 'translate 为 null'],
    [{ id: 'cube', translate: '1,0,0' }, 'translate 为字符串'],
    [{ id: 'cube', translate: { x: 1 } }, 'translate 为对象'],
    [{ id: 'cube', translate: [1, 2] }, 'translate 长度 2'],
    [{ id: 'cube', translate: [1, 2, 3, 4] }, 'translate 长度 4'],
    [{ id: 'cube', translate: [1, NaN, 3] }, 'translate 含 NaN'],
    [{ id: 'cube', translate: [1, Infinity, 3] }, 'translate 含 Infinity'],
    [{ id: 'cube', translate: ['1+1', 0, 0] }, 'translate 含表达式'],
    [{ id: 'cube', translate: ['', 0, 0] }, 'translate 含空串'],
    [{ id: 'cube', translate: [true, 0, 0] }, 'translate 含布尔'],
    [{ id: 'cube', translate: [undefined, 0, 0] }, 'translate 含 undefined'],
    [{ id: 'cube', rotate: [0, 0, null] }, 'rotate 含 null'],
    [{ id: 'cube', scale: [1, 0, 1] }, 'scale 含 0'],
    [{ id: 'cube', scale: [1, -1, 1] }, 'scale 含负数'],
    [{ id: 'cube', scale: [0, 0, 0] }, 'scale 全 0'],
    [{ id: 'cube', scale: [1, 'x', 1] }, 'scale 含非数值字符串'],
    [{ id: 'ghost', translate: [1, 0, 0] }, 'id 不存在于场景'],
  ];
  for (const [cmd, label] of bad) {
    const r = resolveTransform3D(cmd, s);
    assert(!r.ok && typeof r.error === 'string' && r.error.length > 0, '拒绝：' + label);
  }
  for (const v of [null, undefined, [], 'x', 42, true]) {
    const r = resolveTransform3D(v, s);
    assert(!r.ok && typeof r.error === 'string', '拒绝：cmd 为 ' + String(v));
  }
  for (const st of [null, undefined, {}, { objects: null }, { objects: 'x' }, 42]) {
    const r = resolveTransform3D({ id: 'cube', translate: [1, 0, 0] }, st);
    assert(!r.ok, '拒绝：state 为 ' + String(st));
  }
  const scaleErr = resolveTransform3D({ id: 'cube', scale: [1, -1, 1] }, s).error;
  assert(scaleErr.includes('正数'), 'scale 非法给出明确「必须为正数」提示');
  const noFieldErr = resolveTransform3D({ id: 'cube' }, s).error;
  assert(noFieldErr.includes('至少'), '无字段给出「至少给一个」提示');
}

/* ---------------- E. 只读性与返回数组全新 ---------------- */
section('E. 只读性');
{
  function deepFreeze(o) {
    if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
    return o;
  }
  const cmd = deepFreeze({ id: 'cube', op: 'transform3d', translate: [1, 2, 3], scale: [2, 2, 2] });
  const state = deepFreeze(scene());
  const beforeCmd = JSON.stringify(cmd), beforeState = JSON.stringify(state);
  let r;
  let threw = false;
  try { r = resolveTransform3D(cmd, state); } catch (_) { threw = true; }
  assert(!threw, '入参被深度冻结时调用不抛错（无写操作）');
  assert(r.ok && JSON.stringify(cmd) === beforeCmd && JSON.stringify(state) === beforeState,
    'cmd / state 前后逐字未变');
  assert(r.patch.pos !== state.objects[0].pos && r.patch.scale !== state.objects[0].scale,
    'patch 数组为全新对象，不复用入参数组引用');
  r.patch.pos[0] = 999;
  assert(state.objects[0].pos[0] === 1, '修改返回 patch 不反向影响 state');
  assert(r.fields !== TRANSFORM3D_FIELDS, 'fields 为独立数组');
}

/* ---------------- F. 执行器集成 ---------------- */
section('F. 执行器集成');
{
  function mockApi(seed) {
    const objects = (seed ? seed() : scene()).objects.map((o) => ({
      ...o,
      pos: o.pos && o.pos.slice(), rot: o.rot && o.rot.slice(), scale: o.scale && o.scale.slice(),
    }));
    const clone = () => objects.map((o) => ({
      ...o,
      pos: o.pos && o.pos.slice(), rot: o.rot && o.rot.slice(), scale: o.scale && o.scale.slice(),
    }));
    return {
      objects,
      getState() { return { objects: clone(), view: {} }; },
      add(o) {
        objects.push({
          ...o,
          pos: o.pos && o.pos.slice(), rot: o.rot && o.rot.slice(), scale: o.scale && o.scale.slice(),
        });
        return o.id;
      },
      update(id, patch) {
        const o = objects.find((x) => x.id === id);
        if (!o) return false;
        for (const k of ['pos', 'rot', 'scale']) if (Array.isArray(patch[k])) o[k] = patch[k].slice();
        if (patch.params && typeof patch.params === 'object') o.p = { ...o.p, ...patch.params };
        return true;
      },
      remove(id) { const i = objects.findIndex((x) => x.id === id); if (i < 0) return false; objects.splice(i, 1); return true; },
      clear() { objects.length = 0; },
      setView() {}, resetView() {},
    };
  }

  const api1 = mockApi();
  const r1 = applyBoard3DCommands([{ op: 'transform3d', id: 'cube', translate: [2, 0, -1] }], api1);
  assert(r1.length === 1 && r1[0].ok && r1[0].id === 'cube', '单条 transform3d 执行成功');
  assert(eq3(api1.objects.find((o) => o.id === 'cube').pos, [3, 2, 2]), '画板对象 pos 按当前值叠加');
  assert(r1[0].patch && eq3(r1[0].patch.pos, [3, 2, 2]) && JSON.stringify(r1[0].fields) === '["translate"]',
    '结果带真实 patch 与 fields，供前端展示画板算出的值');
  assert(api1.objects.length === 3, 'transform3d 不新增 / 不删除对象');

  const api2 = mockApi();
  const r2 = applyBoard3DCommands([
    { op: 'transform3d', id: 'cube', translate: [1, 1, 1], rotate: [5, 5, 5], scale: [2, 2, 2] },
  ], api2);
  const c2 = api2.objects.find((o) => o.id === 'cube');
  assert(r2[0].ok && eq3(c2.pos, [2, 3, 4]) && eq3(c2.rot, [15, 25, 35]) && eq3(c2.scale, [2, 2, 2]),
    '三字段同时变换写入画板');

  // 同一批命令里先建后变换：读的是「当前」状态，不是循环开始时的快照
  const api3 = mockApi(() => ({ objects: [] }));
  const r3 = applyBoard3DCommands([
    { op: 'add3d', id: 'newcube', type: 'box', pos: [0, 0, 0] },
    { op: 'transform3d', id: 'newcube', translate: [5, 1, -2] },
  ], api3);
  assert(r3.length === 2 && r3[0].ok && r3[1].ok, '同批先 add3d 再 transform3d 两条都成功');
  assert(eq3(api3.objects.find((o) => o.id === 'newcube').pos, [5, 1, -2]),
    '刚建好的对象也能被相对变换（读当前 getState）');

  const api4 = mockApi();
  const r4 = applyBoard3DCommands([{ op: 'transform3d', id: 'ghost', translate: [1, 0, 0] }], api4);
  assert(!r4[0].ok && r4[0].error.includes('不存在'), 'id 不存在被拒绝');
  const r4b = applyBoard3DCommands([{ op: 'transform3d', id: 'cube' }], api4);
  assert(!r4b[0].ok && r4b[0].error.includes('至少'), '无增量字段被拒绝且不改场景');
  assert(eq3(api4.objects.find((o) => o.id === 'cube').pos, [1, 2, 3]), '失败命令不产生副作用');

  // 2D 命令仍由 default 分支拒绝，3D / 2D 协议不混用
  const api5 = mockApi();
  const r5 = applyBoard3DCommands([
    { op: 'transform' }, { op: 'update' }, { op: 'measure' }, { op: 'point' },
  ], api5);
  assert(r5.length === 4 && r5.every((x) => !x.ok && x.error.includes('不支持的 3D 命令')),
    '2D 命令（transform/update/measure/point）仍被 3D 执行器拒绝');

  // api.update 返回 false：结果 ok:false
  const api6 = mockApi();
  api6.update = () => false;
  const r6 = applyBoard3DCommands([{ op: 'transform3d', id: 'cube', translate: [1, 0, 0] }], api6);
  assert(!r6[0].ok && r6[0].error.includes('未找到'), '画板 update 返回 false 时如实报错');

  // getState 缺失 / 抛错：整批命令不中断
  const api7 = { clear() {}, setView() {}, resetView() {}, add() {}, update() {}, remove() {} };
  const r7 = applyBoard3DCommands([
    { op: 'transform3d', id: 'cube', translate: [1, 0, 0] },
    { op: 'clear3d' },
  ], api7);
  assert(r7.length === 2 && !r7[0].ok && r7[1].ok, 'getState 缺失时降级为空场景，后续命令继续执行');

  // 命令数上限仍生效
  const api8 = mockApi();
  const r8 = applyBoard3DCommands([
    { op: 'reset3d' }, { op: 'reset3d' }, { op: 'reset3d' },
  ], api8, { maxCommands: 2 });
  assert(r8.length === 3 && r8[2].ok === false && r8[2].error.includes('上限'),
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
  assert(i2d >= 0 && i2d < i3d, '共享文件：2D 主干在 3D 追加段之前（未整体替换）');
  assert(i3d < iMeasure && iMeasure < iLabel, '共享文件：量测段 / 回注标注段顺序未变（纯追加）');
  assert(iLabel < iTransform, '共享文件：本轮新段追加在全部既有内容之后（末尾追加，未覆盖）');
  assert(prompt.includes('annotate 仅为展示增强，不影响量测精度。'),
    '既有回注标注段末句逐字保留（未删改对方 / 历史内容）');
  assert(prompt.includes('例8：细粒度样式'), '2D 主干 few-shot 未被删除（另一任务成果仍在）');
  assert(prompt.includes('isBoard3DIntent') && prompt.includes('BOARD3D_PROMPT_OPS'),
    '既有 3D 意图检测与 op 白名单仍在');
  assert(prompt.includes('BOARD3D_TRANSFORM_PROMPT_OPS'), '共享文件追加了本轮新导出');

  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD_SYSTEM_PROMPT'), '后端仍保留 2D 主干提示词');
  assert(backend.includes('resolveBoardMode'), '后端 3D 模式分支仍在');
  assert(backend.includes('BOARD3D_SYSTEM_PROMPT + BOARD3D_MEASURE_PROMPT + BOARD3D_MEASURE_LABEL_PROMPT'),
    '后端 3D 既有拼接串仍为前缀（既有断言零回归）');
  assert(backend.includes('+ BOARD3D_TRANSFORM_PROMPT'), '后端 3D 拼接追加了本轮新段');
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes("from './board3d-measure.js'"), '执行器既有量测接入仍在');
  assert(exec.includes("from './board3d-transform.js'"), '执行器接入本轮变换纯函数层');
  assert(exec.includes("case 'measure3d'") && exec.includes("case 'transform3d'"),
    '执行器含量测与变换两个扩展分支');
  assert(exec.includes('BOARD3D_FULL_OPS') && exec.includes('BOARD3D_ALL_OPS'),
    '执行器同时保留历史契约常量与完整集');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '3D 执行器仍不依赖 three / DOM');

  const tf = read('js/board3d-transform.js');
  assert(tf.includes('export function resolveTransform3D'), '纯函数层导出 resolveTransform3D');
  assert(!tf.includes("from 'three'") && !tf.includes('document.') && !tf.includes('window.'),
    '纯函数层不依赖 three / DOM / window');

  // 硬约束：新旧路径并存，绝不删除大角 SDK / appId / 旧编辑器
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：js/config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由：3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('transform3d'), '页面 AI 面板提示已列出 transform3d');
  assert(read('js/board3d-ai.js').includes("m.op === 'measure3d'"), '前端仍展示量测结果（未被本轮覆盖）');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

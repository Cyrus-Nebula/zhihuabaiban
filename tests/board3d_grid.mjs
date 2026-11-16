/**
 * 3D 矩形 / 立体网格阵列命令（grid3d · D12）无头回归。
 *
 * 覆盖：resolveGrid3D 纯函数（默认 / 三轴份数与几何位置 / spacing / center /
 *       总份数上限 / 单轴钳制 / 覆盖字段 / id 避让 / 深度只读性 / 脏输入原子拒绝）、
 *       执行器集成（同批先建后阵列、id 冲突、api 降级、2D 命令隔离、known 登记）、
 *       共享文件协议两侧一致性与协作铁律 / 硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_grid.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS,
  BOARD3D_TRANSFORM_PROMPT_OPS, BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_RADIAL_PROMPT_OPS,
  BOARD3D_MIRROR_PROMPT_OPS, BOARD3D_GRID_PROMPT_OPS, BOARD3D_GRID_PROMPT,
  BOARD3D_MIRROR_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS,
} from '../js/board3d-executor.js';
import {
  GRID3D_COPIES_MAX, GRID3D_AXIS_MAX, resolveGrid3D, resolveMirror3D,
  resolveRadial3D, resolveDuplicate3D,
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
    { id: 'cube', type: 'box', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#4f6bed', opacity: 1, p: { w: 2, h: 2, d: 2 } },
    { id: 'pillar', type: 'cylinder', pos: [1, 2, 3], rot: [10, 20, 30], scale: [1, 1.5, 1],
      color: '#0ea5e9', opacity: 0.8, p: { rt: 1, rb: 1, h: 2 } },
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

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量与历史契约零回归');
{
  assert(GRID3D_COPIES_MAX === 512, 'GRID3D_COPIES_MAX = 512');
  assert(GRID3D_AXIS_MAX === 32, 'GRID3D_AXIS_MAX = 32');
  assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 历史契约 7 条不变');
  assert(BOARD3D_ALL_OPS.length === 8, 'BOARD3D_ALL_OPS 历史契约 8 条不变');
  assert(BOARD3D_FULL_OPS.length === 9, 'BOARD3D_FULL_OPS 历史契约 9 条不变');
  assert(BOARD3D_COMPLETE_OPS.length === 10, 'BOARD3D_COMPLETE_OPS 历史契约 10 条不变');
  assert(BOARD3D_COMPLETE2_OPS.length === 11, 'BOARD3D_COMPLETE2_OPS 历史契约 11 条不变');
  assert(BOARD3D_COMPLETE3_OPS.length === 12, 'BOARD3D_COMPLETE3_OPS 历史契约 12 条不变');
  assert(JSON.stringify(BOARD3D_GRID_OPS) === JSON.stringify(['grid3d']), 'BOARD3D_GRID_OPS = [grid3d]');
  assert(BOARD3D_COMPLETE4_OPS.length === 13, 'BOARD3D_COMPLETE4_OPS 完整集 13 条');
  assert(BOARD3D_COMPLETE4_OPS.includes('grid3d') && BOARD3D_COMPLETE4_OPS.includes('mirror3d'),
    '完整集含 grid3d 且保留 mirror3d');
  assert(JSON.stringify(BOARD3D_GRID_PROMPT_OPS) === JSON.stringify(['grid3d']),
    '提示词侧 BOARD3D_GRID_PROMPT_OPS 与执行器一致');
  assert(BOARD3D_PROMPT_OPS.length === 7 && BOARD3D_MEASURE_PROMPT_OPS.length === 1
    && BOARD3D_TRANSFORM_PROMPT_OPS.length === 1 && BOARD3D_DUPLICATE_PROMPT_OPS.length === 1
    && BOARD3D_RADIAL_PROMPT_OPS.length === 1 && BOARD3D_MIRROR_PROMPT_OPS.length === 1,
    '共享文件全部既有 *_PROMPT_OPS 契约不变');
}

/* ---------------- B. 几何：默认与三轴位置 ---------------- */
section('B. resolveGrid3D 几何：默认 / 三轴份数 / 位置');
{
  const d = resolveGrid3D({ op: 'grid3d', id: 'cube' }, scene());
  assert(d.ok && d.items.length === 3, '默认 size=[3,1,1] → 3 份');
  assert(JSON.stringify(d.meta.size) === JSON.stringify([3, 1, 1]), 'meta.size 回读默认');
  assert(eq3(d.items[0].pos, [0, 0, 0]), '第 1 份与源位置重合（center=false）');
  assert(eq3(d.items[1].pos, [2, 0, 0]), '第 2 份 X+2（默认 spacing）');
  assert(eq3(d.items[2].pos, [4, 0, 0]), '第 3 份 X+4');

  const plane = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [3, 1, 3], spacing: [2, 0, 2] }, scene());
  assert(plane.ok && plane.items.length === 9, '3×1×3 → 9 份平面方阵');
  // 遍历顺序 i(X) 外层、j(Y) 中、k(Z) 内层
  assert(eq3(plane.items[0].pos, [0, 0, 0]), '方阵第 1 份 (0,0,0)');
  assert(eq3(plane.items[1].pos, [0, 0, 2]), '方阵第 2 份 Z+2（内层 Z 先走）');
  assert(eq3(plane.items[3].pos, [2, 0, 0]), '方阵第 4 份 X+2');
  assert(eq3(plane.items[8].pos, [4, 0, 4]), '方阵第 9 份 (4,0,4)');

  const cube8 = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [2, 2, 2], spacing: [1, 2, 3] }, scene());
  assert(cube8.ok && cube8.items.length === 8, '2×2×2 → 8 份立体点阵');
  assert(eq3(cube8.items[7].pos, [1, 2, 3]), '立体点阵最后一份 = 各轴一个步长');

  const single = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [1, 1, 1], newId: 'solo' }, scene());
  assert(single.ok && single.items.length === 1 && single.items[0].id === 'solo',
    'size=[1,1,1] 单份用显式 newId');
}

/* ---------------- C. center 居中 ---------------- */
section('C. center 以源为几何中心');
{
  const c = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [3, 1, 1], spacing: [2, 2, 2], center: true }, scene());
  assert(c.ok && c.meta.center === true, 'center=true 写入 meta');
  assert(eq3(c.items[0].pos, [-2, 0, 0]), '居中第 1 份 X-2');
  assert(eq3(c.items[1].pos, [0, 0, 0]), '居中第 2 份回到源位置');
  assert(eq3(c.items[2].pos, [2, 0, 0]), '居中第 3 份 X+2');
  const c4 = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [4, 1, 1], spacing: [2, 0, 0], center: true }, scene());
  assert(eq3(c4.items[0].pos, [-3, 0, 0]) && eq3(c4.items[3].pos, [3, 0, 0]),
    '偶数份居中：±1.5 步长（[-3,+3]）');
  const off = resolveGrid3D({ op: 'grid3d', id: 'pillar', size: [3, 1, 1], center: true }, scene());
  assert(eq3(off.items[1].pos, [1, 2, 3]), '源不在原点时居中中份仍为源位置');
}

/* ---------------- D. 覆盖字段 / 对象属性继承 ---------------- */
section('D. 覆盖字段与对象属性继承');
{
  const r = resolveGrid3D({ op: 'grid3d', id: 'pillar', size: [2, 1, 1],
    color: '#e11d48', opacity: 0.5, scale: [2, 2, 2], params: { h: 9 } }, scene());
  assert(r.ok, '带覆盖字段命令成功');
  for (const it of r.items) {
    assert(it.type === 'cylinder', '副本继承源 type');
    assert(it.color === '#e11d48' && it.opacity === 0.5, 'color / opacity 覆盖生效');
    assert(eq3(it.scale, [2, 2, 2]), 'scale 覆盖生效');
    assert(it.p.h === 9 && it.p.rt === 1 && it.p.rb === 1, 'params 逐键覆盖，其余键沿用');
    assert(eq3(it.rot, [10, 20, 30]), 'rot 沿用源朝向（不接受覆盖）');
  }
  const lbl = resolveGrid3D({ op: 'grid3d', id: 'lblA', size: [2, 1, 1] }, scene());
  assert(lbl.ok && lbl.items[0].type === 'label' && lbl.items[0].text === 'A',
    'label 锚点型也可网格阵列且继承 text');
}

/* ---------------- E. id 生成与避让 ---------------- */
section('E. id 生成 / 避让 / 冲突拒绝');
{
  const r = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [3, 1, 1] }, scene());
  assert(JSON.stringify(r.items.map((x) => x.id)) === JSON.stringify(['cube_grid1', 'cube_grid2', 'cube_grid3']),
    '自动 id = <src>_grid1..n');
  // 源场景已存在 cube_grid1 → 自动避让
  const withConflict = scene();
  withConflict.objects.push({ id: 'cube_grid1', type: 'point', pos: [0, 0, 0] });
  const rc = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [3, 1, 1] }, withConflict);
  assert(rc.items[0].id === 'cube_grid1_2', '自动 id 冲突 → 追加 _2 避让');
  const explicit = scene();
  explicit.objects.push({ id: 'taken', type: 'point', pos: [0, 0, 0] });
  assert(!resolveGrid3D({ op: 'grid3d', id: 'cube', size: [1, 1, 1], newId: 'taken' }, explicit).ok,
    '显式单份 id 冲突 → 拒绝');
  assert(!resolveGrid3D({ op: 'grid3d', id: 'cube', newId: 'bad id!' }, scene()).ok,
    '非法 newId → 拒绝');
}

/* ---------------- F. 脏输入原子拒绝 / 只读性 ---------------- */
section('F. 脏输入原子拒绝 / 入参只读');
{
  const bads = [
    [{ op: 'grid3d' }, '缺 id'],
    [{ op: 'grid3d', id: 'nope' }, '源不存在'],
    [{ op: 'grid3d', id: 'plain' }, '源缺 type'],
    [{ op: 'grid3d', id: 'cube', size: [2, 2] }, 'size 非三元组'],
    [{ op: 'grid3d', id: 'cube', size: [2, 'x', 1] }, 'size 含非数值'],
    [{ op: 'grid3d', id: 'cube', size: [32, 32, 32] }, '总份数超 512'],
    [{ op: 'grid3d', id: 'cube', spacing: [1, 2] }, 'spacing 非三元组'],
    [{ op: 'grid3d', id: 'cube', spacing: [1, null, 2] }, 'spacing 含非数值'],
    [{ op: 'grid3d', id: 'cube', center: 'yes' }, 'center 非布尔'],
    [{ op: 'grid3d', id: 'cube', newId: 123 }, 'newId 非字符串'],
    [null, '命令为空'],
  ];
  for (const [cmd, label] of bads) {
    const r = resolveGrid3D(cmd, scene());
    assert(r.ok === false && typeof r.error === 'string', `拒绝：${label}`);
  }
  // 单轴钳制
  const clamped = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [0, 99, 3.6] }, scene());
  assert(clamped.ok && JSON.stringify(clamped.meta.size) === JSON.stringify([1, 32, 4]),
    'size 钳制：0→1、99→32、3.6→4');
  // 只读：cmd / state 不被修改
  const cmd = { op: 'grid3d', id: 'cube', size: [2, 1, 1], params: { w: 9 } };
  const cmdBefore = JSON.stringify(cmd);
  const st = scene();
  const stBefore = JSON.stringify(st);
  resolveGrid3D(cmd, st);
  assert(JSON.stringify(cmd) === cmdBefore, 'cmd 未被修改');
  assert(JSON.stringify(st) === stBefore, 'state 未被修改');
  const r2 = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [2, 1, 1] }, scene());
  r2.items[0].pos[0] = 999; r2.items[0].p.w = 999;
  const fresh = resolveGrid3D({ op: 'grid3d', id: 'cube', size: [2, 1, 1] }, scene());
  assert(fresh.items[0].pos[0] === 0 && fresh.items[0].p.w === 2, '输出对象彼此独立（无共享引用）');
}

/* ---------------- G. 执行器集成 ---------------- */
section('G. applyBoard3DCommands 集成');
{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'add3d', id: 'seed', type: 'sphere', pos: [0, 0, 0], params: { r: 1 } },
    { op: 'grid3d', id: 'seed', size: [3, 1, 1], spacing: [2, 0, 0] },
  ], api);
  assert(res.length === 2 && res[0].ok && res[1].ok, '同批先建后阵列两条命令成功');
  assert(res[1].op === 'grid3d' && res[1].count === 3 && res[1].created.length === 3,
    'grid3d 结果 count / created 正确');
  assert(api.objects.filter((o) => o.type === 'sphere').length === 4, '场景新增 3 个球（共 4 个含源）');
  assert(api.objects.some((o) => o.id === 'seed_grid3' && o.pos[0] === 4), '第 3 个副本 id/位置正确');

  // 源不存在 → 失败但不中断
  const api2 = mockApi();
  const res2 = applyBoard3DCommands([
    { op: 'grid3d', id: 'ghost', size: [2, 1, 1] },
    { op: 'add3d', id: 'after', type: 'box' },
  ], api2);
  assert(res2[0].ok === false && res2[1].ok === true, '阵列失败不影响后续命令');

  // getState 缺失 / 抛错降级为空场景，整批不中断
  const minimal = {
    add(obj) { return obj.id; },
  };
  const res3 = applyBoard3DCommands([{ op: 'grid3d', id: 'x', size: [2, 1, 1] }], minimal);
  assert(res3[0].ok === false && /不存在/.test(res3[0].error), 'api 无 getState → 降级空场景，命令失败不抛异常');
  const throwing = {
    getState() { throw new Error('boom'); }, add(obj) { return obj.id; },
  };
  const res4 = applyBoard3DCommands([{ op: 'grid3d', id: 'x' }], throwing);
  assert(res4[0].ok === false, 'getState 抛错 → 整批不中断，返回失败结果');

  // 2D 命令隔离
  const api5 = mockApi();
  const res5 = applyBoard3DCommands([{ op: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }], api5);
  assert(res5[0].ok === false && /2D|不支持/.test(res5[0].error), '3D 执行器拒绝 2D line 命令');
}

/* ---------------- H. 协议一致性 / 协作铁律 / 硬约束 ---------------- */
section('H. 共享文件协议两侧一致性 / 协作铁律 / 硬约束静态复核');
{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');
  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveGrid3D') && exec.includes("case 'grid3d'"), '执行器接入 grid3d 分支');
  assert(exec.includes('BOARD3D_GRID_OPS') && exec.includes('BOARD3D_COMPLETE4_OPS'),
    '执行器导出独立 GRID OPS 与新完整集');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '执行器仍不依赖 three / DOM');
  const dup = read('js/board3d-duplicate.js');
  assert(dup.includes('export function resolveGrid3D')
    && dup.includes('export function resolveMirror3D')
    && dup.includes('export function resolveRadial3D')
    && dup.includes('export function resolveDuplicate3D'),
    '纯函数层四个 resolve 并存（旧函数逐字保留）');
  assert(!dup.includes("from 'three'") && !dup.includes('document.') && !dup.includes('window.'),
    '纯函数层仍不依赖 three / DOM / window');
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_GRID_PROMPT'), '后端 import 并拼接 GRID 提示词');
  assert(be.indexOf('BOARD3D_RADIAL_PROMPT + BOARD3D_MIRROR_PROMPT') > -1,
    '历史拼接串仍为新串前缀（既有断言零回归）');
  assert(be.indexOf('BOARD3D_MIRROR_PROMPT + BOARD3D_GRID_PROMPT') > -1,
    'GRID 段拼在提示词最末尾（fitPrompt 裁剪保留尾部）');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD3D_MIRROR_PROMPT_OPS')
    < prompt.indexOf('export const BOARD3D_GRID_PROMPT_OPS'),
    '共享文件 GRID 段追加在 mirror 段之后（仅末尾追加）');
  assert(prompt.includes('2D 的 reflect / mirror / symmetry / 轴对称等命令在本分支依旧不认识'),
    '共享文件既有 mirror 段尾行仍在（未删除对方内容）');
  assert(prompt.includes('BOARD_SYSTEM_PROMPT') && prompt.includes('例 1'),
    '共享文件 2D 主干与示例仍在（未整体替换）');
  assert(typeof BOARD3D_MIRROR_PROMPT === 'string' && typeof BOARD3D_GRID_PROMPT === 'string'
    && BOARD3D_GRID_PROMPT.includes('grid3d'),
    '既有 3D 提示词段仍可导入，GRID 段含 grid3d 命令说明');
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
  assert(page.includes('grid3d') && page.includes('mirror3d'),
    '页面 AI 面板提示新增 grid3d 且保留 mirror3d');
  const aiPanel = read('js/board3d-ai.js');
  assert(aiPanel.includes("r.op !== 'grid3d'") === false
    && aiPanel.includes("g.op !== 'grid3d'") && aiPanel.includes("r.op !== 'mirror3d'"),
    '前端新增网格阵列结果展示且保留既有镜像展示');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干 js/board.js / js/executor.js 仍在（未触碰）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')),
    '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')),
    '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

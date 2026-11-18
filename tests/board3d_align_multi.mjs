/**
 * 3D align3d 多轴同时对齐（align3d · D18）无头回归。
 *
 * 覆盖：resolveAlign3DMultiAxis 纯函数（axes 1~3 轴同时对齐 / 逐轴 mode·to·start·end 独立
 *       复用单轴语义 / 只改点名轴 / 未点名轴保持 / 坐标钳制 / 深度只读性 /
 *       各类脏输入原子拒绝）、单轴历史路径零回归、执行器集成（多轴分支成功与回读、
 *       known 校验、id 不存在、getState 降级、api 侧部分失败分项、2D 命令隔离、
 *       maxCommands）、共享文件协议两侧一致性与协作铁律 / 硬约束（新旧并存）静态复核。
 *
 * 运行：node tests/board3d_align_multi.mjs
 */
import {
  BOARD3D_SYSTEM_PROMPT, BOARD3D_ALIGN_PROMPT, BOARD3D_ALIGN_MULTI_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_ALL_OPS, BOARD3D_FULL_OPS,
  BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
} from '../js/board3d-executor.js';
import {
  ALIGN3D_MULTI_MAX_AXES, resolveAlign3D, resolveAlign3DMultiAxis,
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

// 五个对象，X/Y/Z 各有不同取值，便于验证「每轴独立计算 + 只改点名轴」。
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

/* ---------------- A. 常量与历史契约零回归 ---------------- */
section('A. 常量与历史契约零回归');
{
  assert(ALIGN3D_MULTI_MAX_AXES === 3, 'ALIGN3D_MULTI_MAX_AXES = 3');
  assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9,
    '历史契约 OPS 7/8/9 不变');
  assert(BOARD3D_COMPLETE_OPS.length === 10 && BOARD3D_COMPLETE2_OPS.length === 11
    && BOARD3D_COMPLETE3_OPS.length === 12 && BOARD3D_COMPLETE4_OPS.length === 13
    && BOARD3D_COMPLETE5_OPS.length === 14,
    '历史完整集 10~14 条全部不变');
  assert(JSON.stringify(BOARD3D_ALIGN_OPS) === JSON.stringify(['align3d']),
    'BOARD3D_ALIGN_OPS 仍 = [align3d]（多轴不是新 op）');
  assert(typeof BOARD3D_ALIGN_MULTI_PROMPT === 'string' && BOARD3D_ALIGN_MULTI_PROMPT.includes('axes'),
    '新提示词段 BOARD3D_ALIGN_MULTI_PROMPT 可导入且讲 axes');
  assert(BOARD3D_ALIGN_MULTI_PROMPT.indexOf('align3d') > -1, '新提示词段仍归属 align3d');
}

/* ---------------- B. 双轴同时对齐 ---------------- */
section('B. resolveAlign3DMultiAxis：双轴同时对齐');
{
  const s = scene();
  const r = resolveAlign3DMultiAxis({
    op: 'align3d', ids: ids5,
    axes: [
      { axis: 'y', mode: 'min' },          // y: min = -3
      { axis: 'x', mode: 'center', to: 0 }, // x: 显式 0
    ],
  }, s);
  assert(r.ok && r.items.length === 5, '双轴命令成功，返回 5 个 patch');
  assert(r.items.every((it) => it.patch.pos[1] === -3), 'y 轴全部对齐到 min=-3');
  assert(r.items.every((it) => it.patch.pos[0] === 0), 'x 轴全部对齐到 to=0');
  assert(r.items.every((it, i) => near(it.patch.pos[2], s.objects[i].pos[2])),
    '未点名的 z 轴保持各自当前值');
  assert(r.meta.axes.length === 2 && r.meta.axes[0].axis === 'y' && r.meta.axes[1].axis === 'x',
    'meta.axes 回读两轴顺序与命令一致');
  assert(r.meta.ids.join(',') === ids5.join(','), 'items/meta.ids 按 ids 原顺序');
}

/* ---------------- C. 三轴 + distribute 混用 ---------------- */
section('C. resolveAlign3DMultiAxis：三轴 + distribute + to');
{
  const s = scene();
  const r = resolveAlign3DMultiAxis({
    op: 'align3d', ids: ids5,
    axes: [
      { axis: 'x', mode: 'distribute', start: -3, end: 3 },
      { axis: 'y', mode: 'max' },          // y max = 5
      { axis: 'z', mode: 'center', to: '2.5' },
    ],
  }, s);
  assert(r.ok && r.meta.axes.length === 3, '三轴命令成功，meta.axes 三条');
  // x 按当前 x 升序 c(1),d(1),a(4),b(-2),e(9) → 排序 b(-2),c(1),d(1),a(4),e(9)，均分 -3..3
  const xs = r.items.map((it) => it.patch.pos[0]);
  assert(near(Math.min(...xs), -3) && near(Math.max(...xs), 3), 'distribute 端点 start=-3/end=3 命中');
  const sortedX = xs.slice().sort((m, n) => m - n);
  const gaps = sortedX.slice(1).map((v, i) => v - sortedX[i]);
  assert(gaps.every((g) => near(g, 1.5)), 'distribute 四段等距 1.5');
  assert(r.items.every((it) => it.patch.pos[1] === 5), 'y 轴 max=5');
  assert(r.items.every((it) => it.patch.pos[2] === 2.5), 'z 轴 to="2.5" 数字字符串容错');
  assert(r.meta.axes.find((a) => a.axis === 'x').mode === 'distribute'
    && r.meta.axes.find((a) => a.axis === 'z').target === 2.5, 'meta.axes 逐轴回读 mode/target');
}

/* ---------------- D. 逐轴独立：与分别调用单轴等价 ---------------- */
section('D. 多轴合并 == 逐轴单轴调用合并');
{
  const s = scene();
  const specs = [
    { axis: 'x', mode: 'min' },
    { axis: 'z', mode: 'distribute', start: -4, end: 4 },
  ];
  const multi = resolveAlign3DMultiAxis({ op: 'align3d', ids: ids5, axes: specs }, s);
  const sx = resolveAlign3D({ op: 'align3d', ids: ids5, ...specs[0] }, s);
  const sz = resolveAlign3D({ op: 'align3d', ids: ids5, ...specs[1] }, s);
  assert(multi.ok && sx.ok && sz.ok, '多轴与两次单轴调用均成功');
  assert(multi.items.every((it, i) => near(it.patch.pos[0], sx.items[i].patch.pos[0])
    && near(it.patch.pos[2], sz.items[i].patch.pos[2])
    && near(it.patch.pos[1], s.objects[i].pos[1])),
    '多轴每轴结果 == 对应单轴结果，未点名 y 轴保持当前值');
}

/* ---------------- E. 深度只读性 ---------------- */
section('E. 深度只读性 / 输出全新对象');
{
  const s = scene();
  const cmd = Object.freeze({
    op: 'align3d', ids: Object.freeze(ids5.slice()),
    axes: Object.freeze([
      Object.freeze({ axis: 'y', mode: 'min' }),
      Object.freeze({ axis: 'x', mode: 'center', to: 0 }),
    ]),
  });
  const snapshot = JSON.stringify(s);
  const r = resolveAlign3DMultiAxis(cmd, s);
  assert(r.ok, '冻结入参仍能正常解析');
  assert(JSON.stringify(s) === snapshot, 'state 全程未被修改');
  assert(cmd.axes.length === 2 && cmd.axes[0].axis === 'y', 'cmd/axes 未被修改');
  r.items[0].patch.pos[0] = 999;
  assert(s.objects[0].pos[0] === 4, '改输出 pos 不回写 state（全新数组）');
}

/* ---------------- F. 脏输入原子拒绝 ---------------- */
section('F. 脏输入原子拒绝（零副作用）');
{
  const s = scene();
  const rejects = [
    [{ op: 'align3d', ids: ids5 }, 'axes 缺失（应回落单轴，此处仅测非对象场景）'],
    [{ op: 'align3d', ids: ids5, axes: 'x' }, 'axes 非数组'],
    [{ op: 'align3d', ids: ids5, axes: [] }, 'axes 空数组'],
    [{ op: 'align3d', ids: ids5, axes: [1, 2, 3, 4] }, 'axes 超过 3 项'],
    [{ op: 'align3d', ids: ids5, axes: ['x'] }, '轴规格非对象'],
    [{ op: 'align3d', ids: ids5, axes: [{ axis: 'w', mode: 'min' }] }, 'axis 非法'],
    [{ op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'min' }, { axis: 'x', mode: 'max' }] }, 'axis 重复'],
    [{ op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'nope' }] }, 'mode 非法'],
    [{ op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'center', to: '1+2' }] }, 'to 脏值'],
    [{ op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'distribute', start: NaN }] }, 'start NaN'],
    [{ op: 'align3d', ids: ['a'], axes: [{ axis: 'x', mode: 'min' }] }, 'ids 少于 2 个'],
    [{ op: 'align3d', ids: ['a', 'a'], axes: [{ axis: 'x', mode: 'min' }] }, 'ids 重复'],
    [{ op: 'align3d', ids: ['a', 'ghost'], axes: [{ axis: 'x', mode: 'min' }] }, 'id 不存在'],
    [null, '命令为空'],
  ];
  // 第一条（axes 缺失）会被多轴函数拒绝；单轴回退由执行器按 hasOwnProperty 决定，另在 G 组验证。
  rejects.forEach(([cmd], idx) => {
    const r = resolveAlign3DMultiAxis(cmd, s);
    assert(r.ok === false, `拒绝用例 ${idx + 1}：${r.error || '(无 error)'}`);
  });
  const snap = JSON.stringify(s);
  resolveAlign3DMultiAxis({ op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'nope' }] }, s);
  assert(JSON.stringify(s) === snap, '拒绝用例零副作用（state 未变）');
}

/* ---------------- G. 单轴历史路径零回归 ---------------- */
section('G. 单轴历史路径零回归');
{
  const s = scene();
  const single = resolveAlign3D({ op: 'align3d', ids: ids5, axis: 'x', mode: 'center' }, s);
  assert(single.ok && single.meta.axes === undefined, '单轴结果不含 axes 字段（历史形状不变）');
  assert(single.items.every((it) => near(it.patch.pos[0], 3.5)), '单轴 center 仍算到 3.5');
  const api = mockApi();
  const res = applyBoard3DCommands([{ op: 'align3d', ids: ids5, axis: 'x', mode: 'center' }], api);
  assert(res[0].ok && res[0].axis === 'x' && res[0].mode === 'center' && res[0].axes === undefined,
    '执行器单轴写法仍回读 axis/mode、不带 axes');
  assert(api.objects.every((o) => near(o.pos[0], 3.5)), '执行器单轴仍真实 update 到 3.5');
  // 显式 axes:null 也应视作多轴分支并原子拒绝（hasOwnProperty 判定）
  const api2 = mockApi();
  const res2 = applyBoard3DCommands([{ op: 'align3d', ids: ids5, axes: null }], api2);
  assert(res2[0].ok === false, '显式 axes:null 走多轴分支被拒（不静默回落单轴）');
}

/* ---------------- H. applyBoard3DCommands 多轴执行器集成 ---------------- */
section('H. applyBoard3DCommands 多轴集成');
{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'align3d', ids: ids5, axes: [{ axis: 'y', mode: 'min' }, { axis: 'x', mode: 'center', to: 0 }] },
  ], api);
  assert(res[0].ok && res[0].applied.length === 5, '多轴执行成功，applied 5 项');
  assert(JSON.stringify(res[0].axes) === JSON.stringify(['y', 'x']), '结果回读 axes 顺序');
  assert(api.objects.every((o) => o.pos[1] === -3 && o.pos[0] === 0), 'api 里 y/x 真的被 update');
  assert(api.objects.every((o, i) => near(o.pos[2], scene().objects[i].pos[2])), 'api 里 z 未被改动');
  assert(api.objects.length === 5, '多轴对齐不新增对象');

  // 同批先 add3d 再多轴对齐
  const api2 = mockApi({ objects: [] });
  const res2 = applyBoard3DCommands([
    { op: 'add3d', id: 'n1', type: 'box', pos: [0, 3, 0] },
    { op: 'add3d', id: 'n2', type: 'box', pos: [6, 9, 4] },
    { op: 'add3d', id: 'n3', type: 'box', pos: [2, -1, 8] },
    { op: 'align3d', ids: ['n1', 'n2', 'n3'], axes: [{ axis: 'y', mode: 'min' }, { axis: 'z', mode: 'max' }] },
  ], api2);
  assert(res2.every((x) => x.ok), '同批先建对象再多轴对齐，四条全成功');
  assert(api2.objects.every((o) => o.pos[1] === -1 && o.pos[2] === 8), '新建对象多轴对齐到 y=-1 / z=8');

  // id 不存在 → 失败但不中断
  const api3 = mockApi();
  const res3 = applyBoard3DCommands([
    { op: 'align3d', ids: ['a', 'ghost'], axes: [{ axis: 'x', mode: 'min' }] },
    { op: 'add3d', id: 'after', type: 'box' },
  ], api3);
  assert(res3[0].ok === false && /不存在/.test(res3[0].error) && res3[1].ok === true,
    'id 不存在失败，后续命令不中断');
  assert(api3.objects[0].pos[0] === 4, '校验失败零副作用');

  // 纯函数拒绝（axis 重复）→ results 失败、整批不中断
  const api4 = mockApi();
  const res4 = applyBoard3DCommands([
    { op: 'align3d', ids: ids5, axes: [{ axis: 'x' }, { axis: 'x' }] },
    { op: 'clear3d' },
  ], api4);
  assert(res4[0].ok === false && res4[1].ok === true, 'axis 重复拒绝后 clear3d 仍执行');

  // getState 抛错降级，不抛异常
  const throwing = { getState() { throw new Error('boom'); }, add(obj) { return obj.id; }, update() { return true; } };
  const rt = applyBoard3DCommands([{ op: 'align3d', ids: ids5, axes: [{ axis: 'x' }] }], throwing);
  assert(rt[0].ok === false, 'getState 抛错 → 整批不中断，返回失败');

  // api.update 侧部分失败如实分项
  const partial = mockApi();
  const orig = partial.update;
  partial.update = (id, patch) => (id === 'c' ? false : orig.call(partial, id, patch));
  const rp = applyBoard3DCommands([
    { op: 'align3d', ids: ids5, axes: [{ axis: 'x', mode: 'min' }] },
  ], partial);
  assert(rp[0].ok === false && rp[0].applied.length === 4 && rp[0].failed.length === 1
    && rp[0].failed[0].id === 'c', 'api.update 单项失败 → applied/failed 分项如实回报');

  // 2D 命令隔离
  const r2d = applyBoard3DCommands([{ op: 'point', x: 0, y: 0 }], mockApi());
  assert(r2d[0].ok === false && /2D|不支持/.test(r2d[0].error), '3D 执行器仍拒绝 2D point 命令');

  // maxCommands 上限
  const rmax = applyBoard3DCommands(
    new Array(3).fill(0).map(() => ({ op: 'align3d', ids: ids5, axes: [{ axis: 'x' }] })),
    mockApi(), { maxCommands: 2 });
  assert(rmax.length === 3 && rmax[2].ok === false && /上限/.test(rmax[2].error), 'maxCommands 上限生效');
}

/* ---------------- I. 协议一致性 / 协作铁律 / 硬约束 ---------------- */
section('I. 共享文件协议一致性 / 协作铁律 / 硬约束静态复核');
{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 主干零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const align = read('js/board3d-align.js');
  assert(align.indexOf('export function resolveAlign3D')
    < align.indexOf('export function resolveAlign3DMultiAxis'), '多轴纯函数追加在单轴之后（仅末尾追加）');
  assert(align.includes('D18') && !align.includes("from 'three'") && !align.includes('document.')
    && !align.includes('window.'), '纯函数层仍不依赖 three/DOM/window');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes('resolveAlign3DMultiAxis') && exec.includes("hasOwnProperty.call(cmd, 'axes')"),
    '执行器接线多轴分支且用 hasOwnProperty 判定');
  assert(exec.indexOf("case 'align3d':") < exec.indexOf("case 'helix3d':"), 'align3d 分支历史位置未动');

  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_ALIGN_MULTI_PROMPT'), '后端 import 新提示词段');
  assert(be.includes('BOARD3D_ALIGN_PROMPT + BOARD3D_HELIX_PROMPT'), '历史拼接串仍为新串前缀');
  assert(be.indexOf('BOARD3D_POLYHEDRON_PROMPT + BOARD3D_ALIGN_MULTI_PROMPT') > -1,
    '新段拼在提示词最末尾（fitPrompt 裁剪保留尾部）');

  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD3D_ALIGN_PROMPT_OPS')
    < prompt.indexOf('export const BOARD3D_POLYHEDRON_PROMPT_OPS')
    && prompt.indexOf('export const BOARD3D_POLYHEDRON_PROMPT_OPS')
    < prompt.indexOf('export const BOARD3D_ALIGN_MULTI_PROMPT'),
    '共享文件新段追加在 polyhedron 段之后（仅末尾追加）');
  assert(prompt.includes('2D 的正多边形 / 多边形 / 正多面体等命令在本分支依旧不认识'),
    '共享文件既有 polyhedron 段尾行仍在（未删除对方内容）');
  assert(prompt.includes('BOARD_SYSTEM_PROMPT') && prompt.includes('例 1'),
    '共享文件 2D 主干与示例仍在（未整体替换）');
  assert(typeof BOARD3D_SYSTEM_PROMPT === 'string' && typeof BOARD3D_ALIGN_PROMPT === 'string'
    && BOARD3D_ALIGN_PROMPT.includes('distribute'), '既有 3D 提示词段仍可导入');

  // 硬约束：新旧路径并存，旧路径未被破坏
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
  assert(read('board3d.html').includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  const aiPanel = read('js/board3d-ai.js');
  assert(aiPanel.includes("al.op !== 'align3d'") && aiPanel.includes('Array.isArray(al.axes)'),
    '前端 AI 面板新增多轴 align3d 展示且保留单轴逻辑');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干仍在（未触碰）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

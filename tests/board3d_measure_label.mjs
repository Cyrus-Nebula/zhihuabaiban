/**
 * 3D 量测结果回注标注（measure3d -> label3d，annotate 开关）无头回归。
 *
 * 覆盖：measureToLabelSpec 纯函数（distance/angle/midpoint 锚点+文字、脏输入返回 null）、
 *       执行器 annotate:true 落 label3d 且进场景 / annotate:false 保持只读、
 *       协议两侧一致性、共享文件协作铁律与硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_measure_label.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS, BOARD3D_MEASURE_PROMPT, BOARD3D_MEASURE_LABEL_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
} from '../js/board3d-executor.js';
import {
  MEASURE3D_KINDS, resolveMeasure3D, measureToLabelSpec,
} from '../js/board3d-measure.js';
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

console.log('3D 量测结果回注标注（measure3d -> label3d）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');
{
  assert(Object.isFrozen(BOARD3D_OPS) && BOARD3D_OPS.length === 7, '既有 3D 命令白名单仍恒为 7 条');
  assert(Object.isFrozen(BOARD3D_MEASURE_OPS) && JSON.stringify([...BOARD3D_MEASURE_OPS]) === '["measure3d"]',
    '扩展命令仅 measure3d（annotate 不是新 op）');
  assert(JSON.stringify([...BOARD3D_ALL_OPS]) === '["add3d","label3d","update3d","remove3d","clear3d","view3d","reset3d","measure3d"]',
    '完整命令集仍为 8 条（annotate 未新增 op）');
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    '共享文件既有 7 条 op 与执行器仍逐项一致（2D 主干零回归）');
  assert(typeof BOARD3D_MEASURE_LABEL_PROMPT === 'string' && BOARD3D_MEASURE_LABEL_PROMPT.includes('annotate'),
    '新追加段导出且含 annotate 开关说明');
  assert(BOARD3D_MEASURE_PROMPT.includes('measure3d'), '既有量测追加段仍含 measure3d 命令');
  assert(!BOARD_SYSTEM_PROMPT.includes('measure3d'), '2D 主干提示词未被注入 3D 量测命令');
}

/* ---------------- B. measureToLabelSpec 纯函数 ---------------- */
section('B. measureToLabelSpec 锚点 / 文字');
{
  const d = resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [0, 4, 0] }, {});
  const ds = measureToLabelSpec(d);
  assert(ds && JSON.stringify(ds.pos) === '[0,2,0]' && ds.text === '4', '距离锚点=两端中点，文字=数值 4');

  const g = resolveMeasure3D({ kind: 'angle', vertex: [0, 0, 0], from: [1, 0, 0], to: [0, 1, 0] }, {});
  const gs = measureToLabelSpec(g);
  assert(gs && JSON.stringify(gs.pos) === '[0,0,0]' && gs.text === '90°', '夹角锚点=顶点，文字=90°');

  const m = resolveMeasure3D({ kind: 'midpoint', points: [[0, 0, 0], [2, 2, 2]] }, {});
  const ms = measureToLabelSpec(m);
  assert(ms && JSON.stringify(ms.pos) === '[1,1,1]' && ms.text === '[1, 1, 1]', '中点锚点=中点坐标，文字=[1, 1, 1]');

  for (const bad of [null, undefined, {}, { ok: true }, { ok: true, kind: 'distance', points: [] },
    { ok: false, kind: 'distance' }, { ok: true, kind: 'distance', points: [[0, 0], [1, 1, 1]] },
    { ok: true, kind: 'angle', points: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }]) {
    assert(measureToLabelSpec(bad) === null, `脏输入返回 null：${JSON.stringify(bad)}`);
  }
  // 纯函数：不修改入参
  const snap = JSON.stringify(d);
  measureToLabelSpec(d);
  assert(JSON.stringify(d) === snap, 'measureToLabelSpec 不修改入参 result');
}

/* ---------------- C. 执行器 annotate 开关 ---------------- */
section('C. 执行器 applyBoard3DCommands：annotate 落 label3d');
function mockApi(initial = []) {
  const objects = initial.map((o) => ({ ...o, pos: (o.pos || [0, 0, 0]).slice() }));
  return {
    objects,
    getState() { return { objects: objects.map((o) => ({ ...o })) }; },
    add(obj) { objects.push({ ...obj }); return obj.id; },
    update(id, patch) { const o = objects.find((x) => x.id === id); if (!o) return false; Object.assign(o, patch); return true; },
    remove(id) { const i = objects.findIndex((x) => x.id === id); if (i < 0) return false; objects.splice(i, 1); return true; },
    clear() { objects.length = 0; },
    setView() {}, resetView() {},
  };
}
const scene = [
  { id: 'A', type: 'label', pos: [0, 0, 0] },
  { id: 'B', type: 'label', pos: [0, 4, 0] },
  { id: 'O', type: 'point', pos: [0, 0, 0] },
  { id: 'P', type: 'point', pos: [1, 0, 0] },
  { id: 'Q', type: 'point', pos: [0, 1, 0] },
];
{
  const api = mockApi(scene);
  const before = api.objects.length;
  const r = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'A', to: 'B', annotate: true }], api);
  assert(r.length === 1 && r[0].ok && near(r[0].value, 4), 'annotate:true 距离量测生效 = 4');
  assert(r[0].label && r[0].label.id && JSON.stringify(r[0].label.pos) === '[0,2,0]' && r[0].label.text === '4',
    'annotate 结果带回 label 锚点 [0,2,0] 与文字 4');
  assert(api.objects.length === before + 1, 'annotate:true 在场景里新增了一个 label3d');
  const added = api.objects[api.objects.length - 1];
  assert(added.type === 'label' && added.text === '4' && JSON.stringify(added.pos) === '[0,2,0]', '新增对象确为 label3d 且内容正确');

  const api2 = mockApi(scene);
  const r2 = applyBoard3DCommands([{ op: 'measure3d', kind: 'angle', vertex: 'O', from: 'P', to: 'Q', annotate: true }], api2);
  assert(r2[0].ok && near(r2[0].value, 90) && r2[0].label.text === '90°' && JSON.stringify(r2[0].label.pos) === '[0,0,0]',
    'annotate 夹角落 label 在顶点、文字 90°');

  const api3 = mockApi(scene);
  const r3 = applyBoard3DCommands([{ op: 'measure3d', kind: 'midpoint', from: 'A', to: 'B', annotate: true }], api3);
  assert(r3[0].ok && r3[0].label && JSON.stringify(r3[0].label.pos) === '[0,2,0]' && r3[0].label.text === '[0, 2, 0]',
    'annotate 中点落 label 在中点坐标');

  // 默认 / 显式 false：只读，不落点
  const api4 = mockApi(scene);
  const before4 = api4.objects.length;
  const r4 = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'A', to: 'B' }], api4);
  assert(r4[0].ok && r4[0].label === null, '不写 annotate：量测只读，结果 label 为 null');
  assert(api4.objects.length === before4, '不写 annotate：场景对象数量不变（保持 D5 只读契约）');
  const r5 = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'A', to: 'B', annotate: false }], api4);
  assert(r5[0].ok && r5[0].label === null && api4.objects.length === before4, 'annotate:false 同样保持只读');

  // annotate 但量测本身失败：不落点
  const api6 = mockApi(scene);
  const before6 = api6.objects.length;
  const r6 = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'nope', to: 'A', annotate: true }], api6);
  assert(!r6[0].ok && r6[0].label === undefined && api6.objects.length === before6, '量测失败 + annotate 也不落点');
}

/* ---------------- D. 协作铁律与硬约束静态复核 ---------------- */
section('D. 协作铁律 / 硬约束静态复核');
{
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    '共享文件：2D 主干在 3D 追加段之前（未整体替换）');
  assert(prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_MEASURE_PROMPT'),
    '共享文件：measure3d 段在既有 3D 段之后（纯追加）');
  assert(prompt.indexOf('export const BOARD3D_MEASURE_PROMPT') < prompt.indexOf('export const BOARD3D_MEASURE_LABEL_PROMPT'),
    '共享文件：回注标注段在 measure3d 段之后（纯追加，未覆盖）');
  assert(prompt.includes('例8：细粒度样式'), '2D 主干 few-shot 未被删除（另一任务成果仍在）');
  assert(prompt.includes('isBoard3DIntent') && prompt.includes('BOARD3D_PROMPT_OPS'), '既有 3D 意图检测与 op 白名单仍在');
  assert(prompt.includes('annotate'), '共享文件追加了 annotate 开关说明');

  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD_SYSTEM_PROMPT'), '后端仍保留 2D 主干提示词');
  assert(backend.includes('resolveBoardMode'), '后端 3D 模式分支仍在');
  assert(backend.includes('BOARD3D_SYSTEM_PROMPT + BOARD3D_MEASURE_PROMPT + BOARD3D_MEASURE_LABEL_PROMPT'),
    '后端 3D 分支拼接量测追加段 + 回注标注段');
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes("from './board3d-measure.js'"), '执行器接入量测纯函数层');
  assert(exec.includes('measureToLabelSpec'), '执行器接入 measureToLabelSpec');
  assert(exec.includes("case 'measure3d'"), '执行器含 measure3d 分支');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'), '3D 执行器仍不依赖 three / DOM');
  const measure = read('js/board3d-measure.js');
  assert(measure.includes('export function measureToLabelSpec'), '量测纯函数层新增 measureToLabelSpec');
  assert(!measure.includes("from 'three'") && !measure.includes('document.') && !measure.includes('window.'),
    '量测纯函数层不依赖 three / DOM / window');

  // 硬约束：新旧路径并存，绝不删除大角 SDK / appId / 旧编辑器
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：js/config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由：3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('measure3d'), '页面 AI 面板提示已列出 measure3d');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

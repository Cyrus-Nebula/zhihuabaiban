/**
 * 3D 复制对象命令（duplicate3d · D9）无头回归。
 *
 * 覆盖：resolveDuplicate3D 纯函数（单份 / 批量阵列 / 偏移累加 / 覆盖字段 /
 *       只读性 / 脏输入拒绝 / 同名避让）、执行器集成（同批先建后复制、id 唯一、
 *       2D 命令隔离、getState 降级）、共享文件协议两侧一致性与协作铁律 /
 *       硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_duplicate.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS, BOARD3D_TRANSFORM_PROMPT_OPS,
  BOARD3D_DUPLICATE_PROMPT_OPS, BOARD3D_DUPLICATE_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
} from '../js/board3d-executor.js';
import { DUP3D_COPIES_MAX, resolveDuplicate3D } from '../js/board3d-duplicate.js';
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
    { id: 'cube', type: 'box', pos: [1, 2, 3], rot: [10, 20, 30], scale: [1, 1, 1],
      color: '#4f6bed', opacity: 1, p: { w: 2, h: 2, d: 2 } },
    { id: 'ball', type: 'sphere', pos: [0, 0, 0], rot: [0, 0, 0], scale: [2, 2, 2],
      color: '#0ea5e9', opacity: 0.5, p: { r: 1.2 } },
    { id: 'lblA', type: 'label', pos: [-1, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1], text: 'A' },
  ],
});

// 执行器用的最小 api 桩：add/update/remove 都作用于一份可变 objects
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

console.log('3D 复制对象命令（duplicate3d · D9）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');
{
  assert(DUP3D_COPIES_MAX === 32, '单次克隆上限 32（防刷屏）');
  assert(Object.isFrozen(BOARD3D_DUPLICATE_OPS)
    && JSON.stringify([...BOARD3D_DUPLICATE_OPS]) === '["duplicate3d"]',
    '扩展命令组 BOARD3D_DUPLICATE_OPS 仅 duplicate3d 且冻结');
  // 历史契约常量逐字未动（既有回归零回归的核心）
  assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 仍恒 7 条');
  assert(BOARD3D_ALL_OPS.length === 8 && BOARD3D_ALL_OPS[7] === 'measure3d',
    'BOARD3D_ALL_OPS 仍恒 8 条（历史契约）');
  assert(BOARD3D_FULL_OPS.length === 9 && BOARD3D_FULL_OPS[8] === 'transform3d',
    'BOARD3D_FULL_OPS 仍恒 9 条（历史契约）');
  assert(BOARD3D_COMPLETE_OPS.length === 10 && BOARD3D_COMPLETE_OPS[9] === 'duplicate3d',
    '完整集 BOARD3D_COMPLETE_OPS 为 10 条、末位 duplicate3d');
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    '共享文件基础 op 白名单仍与 BOARD3D_OPS 一致');
  assert(JSON.stringify([...BOARD3D_DUPLICATE_PROMPT_OPS]) === JSON.stringify([...BOARD3D_DUPLICATE_OPS]),
    '提示词侧 duplicate op 白名单与执行器侧一致');
  assert(BOARD3D_DUPLICATE_PROMPT.includes('duplicate3d') && BOARD3D_DUPLICATE_PROMPT.includes('count'),
    '提示词追加段含 duplicate3d 与 count 说明');
  assert(!BOARD3D_SYSTEM_PROMPT.includes('duplicate3d'), '既有 3D 主干逐字未动（新命令只在追加段）');
  assert(BOARD_SYSTEM_PROMPT.includes('例8') && !BOARD_SYSTEM_PROMPT.includes('duplicate3d'),
    '2D 主干未被本轮命令污染（另一任务成果保留）');
}

/* ---------------- B. 纯函数：单份复制 ---------------- */
section('B. resolveDuplicate3D 单份复制');
{
  const r = resolveDuplicate3D({ op: 'duplicate3d', id: 'ball', newId: 'ball2' }, scene());
  assert(r.ok && r.items.length === 1, '单份复制产出 1 个对象');
  const it = r.items[0];
  assert(it.id === 'ball2' && it.type === 'sphere', '新 id / type 正确');
  assert(eq3(it.pos, [0, 0, 0]) && eq3(it.scale, [2, 2, 2]), '未给覆盖时位置 / 缩放沿用源对象');
  assert(JSON.stringify(it.p) === JSON.stringify({ r: 1.2 }), '几何参数 p 从源对象克隆');
  assert(it.color === '#0ea5e9' && near(it.opacity, 0.5), '颜色 / 透明度沿用源对象');

  const r2 = resolveDuplicate3D({ id: 'cube' }, scene());
  assert(r2.ok && r2.items[0].id === 'cube_copy', '省略 newId 时自动命名 <id>_copy');

  const off = resolveDuplicate3D({ id: 'cube', newId: 'cube2', offset: [3, -1, 0.5] }, scene());
  assert(off.ok && eq3(off.items[0].pos, [4, 1, 3.5]), 'offset 第一份即叠加到源位置');
}

/* ---------------- C. 纯函数：批量阵列 / 覆盖 ---------------- */
section('C. resolveDuplicate3D 批量阵列与字段覆盖');
{
  const arr = resolveDuplicate3D({ id: 'ball', count: 4, offset: [1.5, 0, 0] }, scene());
  assert(arr.ok && arr.items.length === 4, 'count=4 产出 4 个对象');
  assert(arr.items.map((x) => x.id).join(',') === 'ball_copy1,ball_copy2,ball_copy3,ball_copy4',
    '批量自动加序号 newId');
  assert(eq3(arr.items[0].pos, [1.5, 0, 0]) && eq3(arr.items[1].pos, [3, 0, 0])
    && eq3(arr.items[2].pos, [4.5, 0, 0]) && eq3(arr.items[3].pos, [6, 0, 0]),
    'offset 第一份即生效并逐份累加形成等距阵列');

  const ov = resolveDuplicate3D({ id: 'cube', newId: 'c', pos: [9, 9, 9], offset: [1, 0, 0],
    rot: [0, 45, 0], scale: [2, 2, 2], color: '#e11d48', opacity: 0.3,
    params: { w: 5 } }, scene());
  assert(ov.ok, '带覆盖字段的命令解析成功');
  assert(eq3(ov.items[0].pos, [10, 9, 9]), '绝对 pos 覆盖后再叠加 offset（第一份即生效）');
  assert(eq3(ov.items[0].rot, [0, 45, 0]) && eq3(ov.items[0].scale, [2, 2, 2]), 'rot / scale 覆盖生效');
  assert(ov.items[0].color === '#e11d48' && near(ov.items[0].opacity, 0.3), 'color / opacity 覆盖生效');
  assert(near(ov.items[0].p.w, 5) && near(ov.items[0].p.h, 2), 'params 单键覆盖、其余键沿用');
}

/* ---------------- D. 纯函数：只读性 / 脏输入拒绝 / 边界 ---------------- */
section('D. 只读性 / 脏输入拒绝 / 边界');
{
  const state = scene();
  const cmd = { id: 'ball', newId: 'ball2', offset: [2, 0, 0], params: { r: 9 } };
  const snapshot = JSON.stringify({ state, cmd });
  resolveDuplicate3D(cmd, state);
  assert(JSON.stringify({ state, cmd }) === snapshot, '全程不修改 cmd / state（只读）');

  const bad = [
    [{}, '空命令'],
    [{ id: 123 }, 'id 非字符串'],
    [{ id: 'nope' }, '源 id 不存在'],
    [{ id: 'ball', count: 'abc' }, 'count 非数字'],
    [{ id: 'ball', newId: 'a b!' }, 'newId 非法'],
  ];
  for (const [c, label] of bad) {
    assert(resolveDuplicate3D(c, scene()).ok === false, `拒绝：${label}`);
  }
  assert(resolveDuplicate3D({ id: 'ball', count: 0 }, scene()).items.length === 1,
    'count=0 钳制到 1');
  assert(resolveDuplicate3D({ id: 'ball', count: 999 }, scene()).items.length === DUP3D_COPIES_MAX,
    'count 超上限钳制到 32');
  const clamped = resolveDuplicate3D({ id: 'ball', newId: 'x', offset: [1e9, 0, 0] }, scene());
  assert(clamped.items[0].pos[0] === 10000, '超大 offset 钳制到 10000');
  const badScale = resolveDuplicate3D({ id: 'ball', newId: 'x', scale: [0, -1, 2] }, scene());
  assert(eq3(badScale.items[0].scale, [0.05, 0.05, 2]), 'scale 负数/零钳制到下限 0.05');

  // 显式 newId 冲突 → 报错（与 add3d 同口径），不静默改名
  const conflict = resolveDuplicate3D({ id: 'cube', newId: 'ball' }, scene());
  assert(conflict.ok === false && conflict.error.includes('已存在'), '显式 newId 与现有冲突 → 拒绝');

  // 自动命名冲突 → 追加后缀避让（省略 newId，但 <id>_copy 已存在）
  const scWithCopy = { objects: [...scene().objects, { id: 'cube_copy', type: 'box', pos: [9, 9, 9] }] };
  const dup = resolveDuplicate3D({ id: 'cube' }, scWithCopy);
  assert(dup.ok && dup.items[0].id === 'cube_copy_2', '自动 id 冲突时避让 cube_copy_2');
}

/* ---------------- E. 执行器集成 ---------------- */
section('E. applyBoard3DCommands 集成');
{
  const api = mockApi();
  const r = applyBoard3DCommands([
    { op: 'duplicate3d', id: 'cube', newId: 'cubeB', offset: [3, 0, 0] },
  ], api);
  assert(r.length === 1 && r[0].ok && r[0].op === 'duplicate3d', '复制命令执行成功');
  assert(r[0].source === 'cube' && r[0].created.length === 1 && r[0].created[0].id === 'cubeB',
    '结果回带源 id 与新建对象清单');
  const made = api.objects.find((o) => o.id === 'cubeB');
  assert(made && made.type === 'box' && eq3(made.pos, [4, 2, 3]), '新对象落入场景且位置正确');

  // 同批先建后复制（源对象由本轮 add3d 建好并写入 getState）
  const api2 = mockApi({ objects: [] });
  const r2 = applyBoard3DCommands([
    { op: 'add3d', id: 's', type: 'sphere', pos: [0, 0, 0], params: { r: 1 } },
    { op: 'duplicate3d', id: 's', newId: 's2', offset: [2, 0, 0] },
  ], api2);
  assert(r2[0].ok && r2[1].ok, '同批先 add3d 再 duplicate3d 均成功');
  assert(api2.objects.length === 2 && api2.objects[1].id === 's2', '新建源对象后成功复制');

  // id 冲突：显式 newId 已存在 → 整条拒绝，不覆盖
  const api3 = mockApi();
  const r3 = applyBoard3DCommands([
    { op: 'duplicate3d', id: 'cube', newId: 'ball' },
  ], api3);
  assert(r3[0].ok === false && r3[0].error.includes('已存在'), '目标 id 已存在 → 整条拒绝');
  assert(api3.objects.find((o) => o.id === 'ball').type === 'sphere', '原对象未被覆盖');

  // 源不存在 / 2D 命令隔离
  const r4 = applyBoard3DCommands([{ op: 'duplicate3d', id: 'ghost' }], mockApi());
  assert(r4[0].ok === false, '源 id 不存在 → 失败');
  const r5 = applyBoard3DCommands([{ op: 'duplicate', id: 'cube' }], mockApi());
  assert(r5[0].ok === false && r5[0].error.includes('不识别 2D'), '2D 的 duplicate 命令被拒绝');

  // getState 抛错降级：整批不中断
  const broken = { add() { return 'x'; } };
  const r6 = applyBoard3DCommands([{ op: 'duplicate3d', id: 'cube' }], broken);
  assert(r6[0].ok === false && r6[0].error.includes('不存在'), 'getState 缺失降级为空场景、不抛异常');
}

/* ---------------- F. 协作铁律与硬约束静态复核 ---------------- */
section('F. 协作铁律 / 硬约束静态复核');
{
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes("from './board3d-duplicate.js'"), '执行器接入本轮复制纯函数层');
  assert(exec.includes("case 'duplicate3d'"), '执行器含 duplicate3d 分支');
  assert(exec.includes('BOARD3D_DUPLICATE_OPS') && exec.includes('BOARD3D_COMPLETE_OPS'),
    '执行器含独立扩展组与完整集导出');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'),
    '执行器仍不依赖 three / DOM');

  const dup = read('js/board3d-duplicate.js');
  assert(dup.includes('export function resolveDuplicate3D'), '纯函数层导出 resolveDuplicate3D');
  assert(!dup.includes("from 'three'") && !dup.includes('document.') && !dup.includes('window.'),
    '纯函数层不依赖 three / DOM / window');

  // 后端拼接：旧串仍是新串前缀（追加而非替换）
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_DUPLICATE_PROMPT'), '后端 import 并拼接 duplicate 提示词');
  assert(be.indexOf('BOARD3D_BATCH_PROMPT + BOARD3D_DUPLICATE_PROMPT') > -1,
    '3D 提示词在旧拼接串末尾追加新段');

  // 硬约束：新旧路径并存
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(page.includes('duplicate3d'), '页面 AI 面板提示已列出 duplicate3d');
  assert(read('js/board3d-ai.js').includes("d.op !== 'duplicate3d'"), '前端仍展示复制结果');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);

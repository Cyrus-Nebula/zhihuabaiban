/**
 * 3D 空间量测命令（measure3d）无头回归（不依赖 three / 浏览器 / WebGL / 网络）。
 *
 * 覆盖：纯函数向量工具、量测语义（distance / angle / midpoint）、id 与坐标两种点位写法、
 *       脏输入与退化防护、只读性、执行器集成（含同批命令先建后量）、协议两侧一致性、
 *       共享文件协作铁律与硬约束（新旧路径并存）静态复核。
 *
 * 运行：node tests/board3d_measure.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, BOARD3D_MEASURE_PROMPT_OPS, BOARD3D_MEASURE_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
} from '../js/board3d-executor.js';
import {
  MEASURE3D_KINDS, toVec3, dot3D, norm3D, distance3D, midpoint3D, angle3D,
  round3, resolveMeasure3D,
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

console.log('3D 空间量测命令（measure3d）无头回归');

/* ---------------- A. 常量与协议两侧一致性 ---------------- */
section('A. 常量 / 协议两侧一致性');
{
  assert(MEASURE3D_KINDS.length === 3, '量测种类共 3 种');
  assert(MEASURE3D_KINDS.includes('distance') && MEASURE3D_KINDS.includes('angle')
    && MEASURE3D_KINDS.includes('midpoint'), '三种量测：distance / angle / midpoint');
  assert(Object.isFrozen(MEASURE3D_KINDS), '量测种类白名单已冻结');
  assert(BOARD3D_OPS.length === 7, '既有 3D 命令白名单仍恒为 7 条（未被本轮扩展污染）');
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    '共享文件既有 7 条 op 与执行器仍逐项一致（2D 主干零回归）');
  assert(JSON.stringify([...BOARD3D_MEASURE_OPS]) === '["measure3d"]', '扩展命令仅 measure3d');
  assert(JSON.stringify([...BOARD3D_MEASURE_PROMPT_OPS]) === JSON.stringify([...BOARD3D_MEASURE_OPS]),
    '共享文件追加段的扩展 op 与执行器一致');
  assert(BOARD3D_ALL_OPS.length === 8 && BOARD3D_ALL_OPS[7] === 'measure3d',
    '完整命令集 = 既有 7 条 + measure3d');
  assert(Object.isFrozen(BOARD3D_MEASURE_OPS) && Object.isFrozen(BOARD3D_ALL_OPS), '扩展常量已冻结');
  for (const op of BOARD3D_OPS) assert(BOARD3D_SYSTEM_PROMPT.includes(op), `既有提示词仍含 ${op}`);
  assert(BOARD3D_MEASURE_PROMPT.includes('measure3d'), '追加段含 measure3d 命令');
  assert(BOARD3D_MEASURE_PROMPT.includes('"kind":"distance"')
    && BOARD3D_MEASURE_PROMPT.includes('"kind":"angle"')
    && BOARD3D_MEASURE_PROMPT.includes('"kind":"midpoint"'), '追加段含三种量测示例');
  assert(!BOARD_SYSTEM_PROMPT.includes('measure3d'), '2D 主干提示词未被注入 3D 量测命令');
  assert(BOARD_SYSTEM_PROMPT.includes('JSXGraph'), '2D 主干仍是 JSXGraph 协议');
}

/* ---------------- B. 基础向量工具 / 脏输入防护 ---------------- */
section('B. 基础向量工具 toVec3 / dot3D / norm3D');
{
  assert(JSON.stringify(toVec3([1, 2, 3])) === '[1,2,3]', '合法三维数组原样解析');
  assert(JSON.stringify(toVec3(['1', '2.5', '-3'])) === '[1,2.5,-3]', '数字字符串容错（与执行器 num 同口径）');
  for (const bad of [null, undefined, '', 'abc', 1, {}, [1, 2], [1, 2, 3, 4],
    [NaN, 0, 0], [Infinity, 0, 0], [1, null, 3], ['1+1', 2, 3], [true, 2, 3]]) {
    assert(toVec3(bad) === null, `脏输入被拒绝：${JSON.stringify(bad)}`);
  }
  assert(near(dot3D([1, 2, 3], [4, -5, 6]), 12), '点积正确 1*4+2*(-5)+3*6=12');
  assert(dot3D([1, 2], [1, 2, 3]) === null, '点积拒绝非法向量');
  assert(near(norm3D([3, 4, 0]), 5), '向量长度 3-4-5');
  assert(near(norm3D([0, 0, 0]), 0), '零向量长度为 0（不报错）');
  assert(norm3D([1, NaN, 0]) === null, '向量长度拒绝 NaN');
  assert(near(round3(1.23456), 1.235) && near(round3(-1.23456), -1.235), 'round3 三位小数');
}

/* ---------------- C. 三种量测的数学正确性 ---------------- */
section('C. 距离 / 中点 / 夹角数学正确性');
{
  assert(near(distance3D([0, 0, 0], [3, 4, 0]), 5), '平面 3-4-5 距离');
  assert(near(distance3D([0, 0, 0], [1, 1, 1]), Math.sqrt(3)), '空间体对角线 √3');
  assert(distance3D([2, 2, 2], [2, 2, 2]) === 0, '两点重合距离为 0（合法，不报错）');
  assert(distance3D([0, 0], [1, 1, 1]) === null, '距离拒绝非法坐标');
  assert(JSON.stringify(midpoint3D([0, 0, 0], [2, 4, 6])) === '[1,2,3]', '中点坐标正确');
  assert(JSON.stringify(midpoint3D([1, 1, 1], [1, 1, 1])) === '[1,1,1]', '重合点中点即自身');
  assert(midpoint3D([0, 0, 0], [1, 'x', 1]) === null, '中点拒绝非法坐标');
  assert(near(angle3D([0, 0, 0], [1, 0, 0], [0, 1, 0]), 90), 'X 轴与 Y 轴夹角 90°');
  assert(near(angle3D([0, 0, 0], [1, 0, 0], [-1, 0, 0]), 180), '反向共线夹角 180°');
  assert(near(angle3D([0, 0, 0], [1, 0, 0], [1, 0, 0]), 0), '同向夹角 0°');
  assert(near(angle3D([0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0]), 60), '60° 夹角');
  assert(near(angle3D([1, 1, 1], [2, 1, 1], [1, 2, 1]), 90), '平移到任意顶点仍为 90°');
  assert(angle3D([0, 0, 0], [0, 0, 0], [1, 0, 0]) === null, '顶点与端点重合（零向量）被拒绝');
  assert(angle3D([0, 0, 0], [1, 0, 0], [0, 0, 0]) === null, '另一个零向量被拒绝');
  assert(angle3D([0, 0], [1, 0, 0], [0, 1, 0]) === null, '角度拒绝非法顶点坐标');
  const a = angle3D([0, 0, 0], [1, 0, 0], [-1, 0, 0]);
  assert(a >= 0 && a <= 180, '夹角始终落在 [0,180]');
}

/* ---------------- D. resolveMeasure3D：按 id 解析场景对象 ---------------- */
section('D. 按 id 解析场景对象（含 label3d 标注锚点）');
const state = {
  objects: [
    { id: 'A', type: 'label', pos: [0, 0, 0] },
    { id: 'B', type: 'label', pos: [3, 4, 0] },
    { id: 'O', type: 'point', pos: [0, 0, 0] },
    { id: 'P', type: 'point', pos: [1, 0, 0] },
    { id: 'Q', type: 'point', pos: [0, 1, 0] },
    { id: 'cube', type: 'box', pos: [0, 1, 0] },
    { id: 'bad', type: 'point', pos: [0, 'x', 0] },
    { id: 'bad2', type: 'point', pos: null },
  ],
};
{
  const r = resolveMeasure3D({ op: 'measure3d', kind: 'distance', from: 'A', to: 'B' }, state);
  assert(r.ok && near(r.value, 5), 'A→B 距离 = 5');
  assert(r.unit === '' && JSON.stringify(r.ids) === '["A","B"]', '距离结果单位与 id 列表正确');
  assert(typeof r.text === 'string' && r.text.includes('5'), '距离结果带可读中文说明');
  assert(JSON.stringify(r.points) === '[[0,0,0],[3,4,0]]', '结果回带解析后的坐标');

  const m = resolveMeasure3D({ op: 'measure3d', kind: 'midpoint', from: 'cube', to: 'B' }, state);
  assert(m.ok && JSON.stringify(m.value) === '[1.5,2.5,0]', 'cube 与 B 的中点 = [1.5,2.5,0]');
  assert(m.text.includes('中点'), '中点结果带可读说明');

  const g = resolveMeasure3D({ op: 'measure3d', kind: 'angle', vertex: 'O', from: 'P', to: 'Q' }, state);
  assert(g.ok && near(g.value, 90) && g.unit === '°', '∠POQ = 90°');
  assert(g.text.includes('90'), '角度结果带可读说明');
  assert(JSON.stringify(g.ids) === '["O","P","Q"]', '角度结果三点 id 顺序正确');

  assert(!resolveMeasure3D({ kind: 'distance', from: 'nope', to: 'A' }, state).ok, '不存在的 id 被拒绝');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'a b', to: 'A' }, state).ok, '非法 id 格式被拒绝');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'bad', to: 'A' }, state).ok, '对象 pos 含非数值被拒绝');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'bad2', to: 'A' }, state).ok, '对象 pos 为 null 被拒绝');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'A', to: 'B' }, {}).ok, 'state 为空对象时 id 查找明确报错');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'A', to: 'B' }, null).ok, 'state 为 null 安全降级');
  assert(!resolveMeasure3D({ kind: 'distance', from: 'A', to: 'B' }, { objects: 'x' }).ok, 'objects 非数组安全降级');
}

/* ---------------- E. 坐标 / points / digits / 只读性 ---------------- */
section('E. 显式坐标 / points 写法 / digits / 只读性');
{
  const r1 = resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [1, 1, 1] }, state);
  assert(r1.ok && near(r1.value, Math.round(Math.sqrt(3) * 1000) / 1000), '显式坐标距离（默认 3 位小数）');
  assert(r1.ids.length === 0, '显式坐标不产生 id 列表');
  assert(r1.text.includes('点1') && r1.text.includes('点2'), '无名点用「点1/点2」占位说明');

  const r2 = resolveMeasure3D({ kind: 'distance', points: [[0, 0, 0], [1, 1, 1]] }, state);
  assert(r2.ok && near(r2.value, r1.value), 'points 数组写法与具名字段等价');
  const r3 = resolveMeasure3D({ kind: 'angle', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, state);
  assert(r3.ok && near(r3.value, 90), 'points 三元组写法算夹角');
  assert(!resolveMeasure3D({ kind: 'distance', points: [[0, 0, 0]] }, state).ok, 'points 长度不足被拒绝');
  assert(!resolveMeasure3D({ kind: 'angle', points: [[0, 0, 0], [1, 0, 0]] }, state).ok, 'angle 的 points 少一点被拒绝');

  assert(near(resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [1, 1, 1], digits: 1 }, state).value, 1.7),
    'digits:1 显示为 1.7');
  assert(near(resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [1, 1, 1], digits: 0 }, state).value, 2),
    'digits:0 显示为 2');
  assert(near(resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [1, 1, 1], digits: 99 }, state).value, 1.732051),
    'digits 越界钳制到 6 位');
  assert(near(resolveMeasure3D({ kind: 'distance', from: [0, 0, 0], to: [1, 1, 1], digits: 'x' }, state).value, 1.732),
    'digits 脏值回落默认 3 位');

  const cmd = { kind: 'midpoint', points: [[0, 0, 0], [2, 2, 2]] };
  const snapCmd = JSON.stringify(cmd), snapState = JSON.stringify(state);
  const before = state.objects[0].pos.slice();
  const res = resolveMeasure3D(cmd, state);
  assert(res.ok && JSON.stringify(res.value) === '[1,1,1]', '中点结果正确');
  assert(JSON.stringify(cmd) === snapCmd && JSON.stringify(state) === snapState, '只读：cmd / state 均未被修改');
  assert(JSON.stringify(state.objects[0].pos) === JSON.stringify(before), '只读：对象 pos 数组未被写入');
  assert(res.value !== state.objects[0].pos, '结果数组是新对象，不与场景共享引用');
}

/* ---------------- F. 脏输入与退化防护 ---------------- */
section('F. 脏输入与退化防护');
{
  const bad = [
    null, undefined, [], 'x', 42, {},
    { kind: '' }, { kind: 'length' }, { kind: 'DISTANCE' },
    { kind: 'distance' }, { kind: 'distance', from: 'A' },
    { kind: 'angle', from: 'P', to: 'Q' },
    { kind: 'distance', from: null, to: 'A' },
    { kind: 'distance', from: [0, 0], to: [1, 1, 1] },
    { kind: 'distance', from: [NaN, 0, 0], to: 'A' },
    { kind: 'distance', from: '1+1', to: 'A' },
    { kind: 'angle', vertex: 'O', from: 'O', to: 'Q' },
    { kind: 'midpoint', from: [0, 0, 0], to: [Infinity, 0, 0] },
  ];
  for (const c of bad) {
    const r = resolveMeasure3D(c, state);
    assert(r.ok === false && typeof r.error === 'string' && r.error.length > 0,
      `脏命令被拒绝并给出原因：${JSON.stringify(c)}`);
  }
  for (const r of [resolveMeasure3D(null, state), resolveMeasure3D({ kind: '' }, state)]) {
    assert(!('value' in r), '失败结果不返回 value（避免 NaN 传给前端 / LLM）');
  }
  const ok = resolveMeasure3D({ kind: 'distance', from: 'A', to: 'B' }, state);
  assert(Number.isFinite(ok.value), '成功结果的数值有限');
}

/* ---------------- G. 执行器集成 ---------------- */
section('G. 执行器 applyBoard3DCommands 集成');
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
{
  const api = mockApi(state.objects);
  const r = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'A', to: 'B' }], api);
  assert(r.length === 1 && r[0].ok && near(r[0].value, 5), '单条 measure3d 距离经执行器生效');
  assert(r[0].text && r[0].unit === '' && JSON.stringify(r[0].ids) === '["A","B"]', '执行器结果透传 text / unit / ids');
  assert(api.objects.length === state.objects.length, 'measure3d 只读：未改动画板对象数量');

  // 关键：同一批命令里先建对象再量测刚建好的 id（读当前状态而非初始快照）
  const api2 = mockApi([]);
  const r2 = applyBoard3DCommands([
    { op: 'label3d', id: 'pA', text: 'A', pos: [0, 0, 0] },
    { op: 'label3d', id: 'pB', text: 'B', pos: [0, 0, 3] },
    { op: 'measure3d', kind: 'distance', from: 'pA', to: 'pB' },
    { op: 'measure3d', kind: 'midpoint', from: 'pA', to: 'pB' },
    { op: 'measure3d', kind: 'angle', vertex: 'pA', from: 'pA', to: 'pB' },
  ], api2);
  assert(r2[2].ok && near(r2[2].value, 3), '同批先 label3d 再量测距离生效');
  assert(r2[3].ok && JSON.stringify(r2[3].value) === '[0,0,1.5]', '同批中点生效');
  assert(!r2[4].ok, '同批退化夹角（顶点与端点重合）被拒绝');
  assert(api2.objects.length === 2, '量测命令本身不新增对象');

  const badCmd = applyBoard3DCommands([{ op: 'measure', from: 'A', to: 'B' }], api);
  assert(!badCmd[0].ok && badCmd[0].error.includes('不支持的 3D 命令'), '2D measure 命令仍被 3D 执行器拒绝');
  const unknown = applyBoard3DCommands([{ op: 'foo3d' }], api);
  assert(!unknown[0].ok, '未知 3D 命令被拒绝');
  const dirty = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'nope', to: 'A' }], api);
  assert(!dirty[0].ok && dirty[0].error.includes('nope'), '量测失败原因透传到结果');

  // api 缺 getState：整批不中断，仅该条报错
  const noState = { add() {}, update() {}, remove() {}, clear() {}, setView() {}, resetView() {} };
  const r3 = applyBoard3DCommands([
    { op: 'measure3d', kind: 'distance', from: [0, 0, 0], to: [1, 0, 0] },
    { op: 'reset3d' },
  ], noState);
  assert(r3.length === 2 && r3[0].ok && near(r3[0].value, 1), '无 getState 时显式坐标量测仍可用');
  assert(r3[1].ok, '无 getState 不中断后续命令');

  // 既有 7 条命令未受本轮影响（冒烟）
  const api4 = mockApi([]);
  const r4 = applyBoard3DCommands([
    { op: 'add3d', id: 'c1', type: 'box', pos: [0, 0, 0] },
    { op: 'update3d', id: 'c1', pos: [1, 0, 0] },
    { op: 'label3d', id: 'l1', text: 'L', pos: [0, 0, 0] },
    { op: 'view3d', bg: 'dark', axes: true },
    { op: 'reset3d' },
    { op: 'remove3d', id: 'l1' },
    { op: 'clear3d' },
  ], api4);
  assert(r4.every((x) => x.ok), '既有 7 条 3D 命令全部仍可执行');
  assert(api4.objects.length === 0, 'clear3d 仍清空场景');

  const overflow = applyBoard3DCommands([{ op: 'measure3d', kind: 'distance', from: 'A', to: 'B' }], api, { maxCommands: 0 });
  assert(!overflow[0].ok, '命令数上限对量测命令同样生效');
}

/* ---------------- H. 协作铁律与硬约束静态复核 ---------------- */
section('H. 协作铁律 / 硬约束静态复核');
{
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    '共享文件：2D 主干在 3D 追加段之前（未整体替换）');
  assert(prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_MEASURE_PROMPT'),
    '共享文件：量测追加段在既有 3D 段之后（纯追加）');
  assert(prompt.includes('例8：细粒度样式'), '2D 主干 few-shot 未被删除（另一任务成果仍在）');
  assert(prompt.includes('isBoard3DIntent') && prompt.includes('BOARD3D_PROMPT_OPS'),
    '既有 3D 意图检测与 op 白名单仍在');
  assert(prompt.indexOf('↓') < prompt.lastIndexOf('↓'), '追加段落定位标记可解析');

  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD_SYSTEM_PROMPT'), '后端仍保留 2D 主干提示词');
  assert(backend.includes('resolveBoardMode'), '后端 3D 模式分支仍在');
  assert(backend.includes('BOARD3D_SYSTEM_PROMPT + BOARD3D_MEASURE_PROMPT'),
    '后端 3D 分支拼接量测追加段');
  assert(resolveBoardMode({}, '画三角形') === '2d', '后端默认仍为 2D（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '任意') === '3d', '后端显式 3D 仍生效');

  const exec = read('js/board3d-executor.js');
  assert(exec.includes("from './board3d-measure.js'"), '执行器接入量测纯函数层');
  assert(exec.includes("case 'measure3d'"), '执行器含 measure3d 分支');
  assert(!exec.includes("from 'three'") && !exec.includes('document.'), '3D 执行器仍不依赖 three / DOM');
  const measure = read('js/board3d-measure.js');
  assert(!measure.includes("from 'three'") && !measure.includes('document.') && !measure.includes('window.'),
    '量测纯函数层不依赖 three / DOM / window');
  assert(existsSync(join(ROOT, 'js/board3d-measure.js')), '量测模块文件存在');

  // ESM 依赖闭合：新增 / 改动模块的相对 import 都指向真实文件（防线上 404）
  for (const f of ['js/board3d-executor.js', 'js/board3d-measure.js', 'js/board3d-ai.js', 'ai/board-backend.js']) {
    const src = read(f);
    const re = /from\s*['"](\.[^'"]+)['"]/g;
    let m, allOk = true;
    const base = dirname(join(ROOT, f));
    while ((m = re.exec(src))) if (!existsSync(join(base, m[1]))) allOk = false;
    assert(allOk, `${f} 的相对 import 全部可解析到真实文件`);
  }

  const aiJs = read('js/board3d-ai.js');
  assert(aiJs.includes('量测：'), '前端 AI 面板展示量测结果');
  assert(!/from\s*['"](?:\.{1,2}\/)*(?:executor|board)\.js['"]/.test(aiJs), '3D AI 面板未混入 2D 代码');

  // 硬约束：新旧路径并存，绝不删除大角 SDK / appId / 旧编辑器
  assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍 import 大角 SDK');
  assert(read('js/editor.js').includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：js/config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由：3D→board3d.html、2D→board.html 仍在');
  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
  assert(!/jsdelivr[^>]*three|unpkg[^>]*three/.test(page), 'board3d.html 无 three 的 CDN 引用');
  assert(page.includes('measure3d'), '页面 AI 面板提示已列出 measure3d');
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干文件仍在（另一任务成果未被删）');
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

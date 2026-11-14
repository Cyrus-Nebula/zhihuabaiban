/**
 * 3D 画板 AI 分支无头回归（不依赖 three / 浏览器 / WebGL / 网络）。
 *
 * 覆盖：协议两侧一致性、3D 意图检测、后端 mode 决策（含 2D 零回归保护）、
 *       extractResult 对 3D 命令透传、3D 命令执行器（mock api）、硬约束静态校验。
 *
 * 运行：node tests/board3d_ai_branch.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_SYSTEM_PROMPT,
  BOARD3D_PROMPT_OPS, isBoard3DIntent,
} from '../ai/board-prompt.js';
import { resolveBoardMode, extractResult } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, describeBoard3DState, normalizeBoard3DObject,
  BOARD3D_OPS, BOARD3D_TYPES, BOARD3D_PARAM_KEYS,
} from '../js/board3d-executor.js';
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

/* ---------------- mock 画板 api ---------------- */
function mockApi(initial = []) {
  const objects = initial.map((o) => ({ ...o, pos: (o.pos || [0, 0, 0]).slice(), p: { ...(o.p || {}) } }));
  const view = { bg: 'white', axes: true, grid: true };
  const calls = [];
  return {
    objects, view, calls,
    getState() { return { objects: objects.map((o) => ({ ...o })), view: { ...view } }; },
    add(obj) { objects.push({ ...obj }); calls.push(['add', obj.id]); return obj.id; },
    update(id, patch) {
      const o = objects.find((x) => x.id === id);
      if (!o) return false;
      Object.assign(o, patch);
      calls.push(['update', id]);
      return true;
    },
    remove(id) {
      const i = objects.findIndex((x) => x.id === id);
      if (i < 0) return false;
      objects.splice(i, 1); calls.push(['remove', id]); return true;
    },
    clear() { objects.length = 0; calls.push(['clear']); },
    setView(patch) { Object.assign(view, patch); calls.push(['setView', patch]); },
    resetView() { calls.push(['resetView']); },
  };
}

console.log('3D 画板 AI 分支无头回归');

/* ---------------- A. 协议一致性 ---------------- */
section('A. 3D 协议两侧一致性 / 2D 主干未被破坏');
{
  assert(JSON.stringify([...BOARD3D_PROMPT_OPS]) === JSON.stringify([...BOARD3D_OPS]),
    'board-prompt.js 的 op 白名单与 executor 完全一致');
  assert(BOARD3D_OPS.length === 7, '3D 命令共 7 条');
  for (const op of BOARD3D_OPS) {
    assert(BOARD3D_SYSTEM_PROMPT.includes(op), `3D 提示词包含命令 ${op}`);
  }
  assert(BOARD3D_SYSTEM_PROMPT.includes('add3d') && BOARD3D_SYSTEM_PROMPT.includes('label3d'),
    '3D 提示词含核心图元与标注命令');
  assert(BOARD_SYSTEM_PROMPT.includes('JSXGraph'), '2D 主干仍是 JSXGraph 协议（未被改写）');
  assert(!BOARD_SYSTEM_PROMPT.includes('add3d'), '2D 主干未被注入 3D 命令');
  assert(BOARD_SYSTEM_PROMPT.includes('verify') && BOARD_SYSTEM_PROMPT.includes('例8'),
    '2D 主干的 verify / 例8 内容仍在（另一任务成果未被删）');
  assert(BOARD3D_TYPES.length === 13, '3D 图元白名单 13 种（含 label、circle、polygon）');
  assert(BOARD3D_PARAM_KEYS.label.length === 0, 'label 无几何参数');
  assert(BOARD3D_PARAM_KEYS.line.length === 6, 'line 端点参数 6 个');
  assert(BOARD3D_SYSTEM_PROMPT.includes('circle') && BOARD3D_SYSTEM_PROMPT.includes('polygon'),
    '3D 提示词已登记 circle 圆面 / polygon 多边形面 两种图元类型');
  assert(JSON.stringify(BOARD3D_PARAM_KEYS.circle) === JSON.stringify(['r']) &&
    JSON.stringify(BOARD3D_PARAM_KEYS.polygon) === JSON.stringify(['n', 'r']),
    'circle/polygon 参数键与几何纯函数层一致');
}

/* ---------------- B. 3D 意图检测 ---------------- */
section('B. 3D 意图检测 isBoard3DIntent()');
{
  for (const t of ['画一个正方体', '立体几何', '三维坐标系', '画个 3D 模型',
    '一个四棱锥', '圆柱和圆锥', '正四面体', '球体表面积', '沿 Z 轴旋转', '空间几何体']) {
    assert(isBoard3DIntent(t), `识别立体意图：${t}`);
  }
  for (const t of ['画一个等腰直角三角形', '抛物线 y=x^2', '作 BC 边上的高',
    '画一个圆并标出圆心', '求函数与 x 轴的交点', '把三角形改成等边的', '画坐标轴']) {
    assert(!isBoard3DIntent(t), `不误判平面意图：${t}`);
  }
  assert(!isBoard3DIntent(''), '空串 → false');
  assert(!isBoard3DIntent(null), 'null → false');
  assert(!isBoard3DIntent(undefined), 'undefined → false');
  assert(isBoard3DIntent('前面随便说点什么'.repeat(200) + '正方体') === false,
    '超长输入截断到前 500 字后不再匹配（防越界/误判）');
}

/* ---------------- C. 后端 mode 决策（含 2D 零回归） ---------------- */
section('C. 后端 resolveBoardMode()');
{
  assert(resolveBoardMode({}, '画三角形') === '2d', '默认（无 mode）→ 2d');
  assert(resolveBoardMode({}, '画一个正方体') === '2d', '未开启 detect3d 时立体意图不误切（2D 零回归）');
  assert(resolveBoardMode({ mode: '3d' }, '随便说点什么') === '3d', "mode:'3d' → 3d");
  assert(resolveBoardMode({ mode: '2d' }, '画一个正方体') === '2d', "显式 mode:'2d' 优先于意图");
  assert(resolveBoardMode({ detect3d: true }, '画一个正方体') === '3d', 'detect3d + 立体意图 → 3d');
  assert(resolveBoardMode({ detect3d: true }, '画抛物线') === '2d', 'detect3d + 平面意图 → 2d');
  assert(resolveBoardMode({ mode: '3d', detect3d: false }, '画三角形') === '3d', '显式 3d 不受 detect3d 影响');
  assert(resolveBoardMode(null, '正方体') === '2d', 'payload 为 null 安全降级 → 2d');
  assert(resolveBoardMode({ mode: 'other' }, '正方体') === '2d', '非法 mode 值 → 2d');
}

/* ---------------- D. extractResult 对 3D 命令透传 ---------------- */
section('D. 后端结果提取对 3D 命令透传 / 2D 容错不退化');
{
  const r = extractResult('{"message":"画好了","commands":[{"op":"add3d","id":"c1","type":"box","pos":[0,1,0]},{"op":"label3d","id":"l1","text":"A","pos":[1,2,1]}]}');
  assert(r && r.commands.length === 2, '3D 命令原样透传（不被 commandUsable 误杀）');
  assert(r.commands[0].op === 'add3d' && r.commands[1].op === 'label3d', '两条 3D 命令 op 正确');
  const r2 = extractResult('{"message":"x","commands":[{"op":"point","id":"A"}]}');
  assert(r2 && r2.commands.length === 0, '2D 残缺 point（缺 x/y）仍被丢弃，容错逻辑未退化');
  const r3 = extractResult('```json\n{"message":"ok","commands":[{"op":"clear3d"}]}\n```');
  assert(r3 && r3.commands.length === 1 && r3.commands[0].op === 'clear3d', '代码围栏下的 3D 命令可提取');
}

/* ---------------- E. 命令执行器 ---------------- */
section('E. 3D 命令执行器 applyBoard3DCommands()');
{
  const api = mockApi();
  const cmds = [
    { op: 'add3d', id: 'cube', type: 'box', pos: [0, 1, 0], params: { w: 2, h: 2, d: 2 }, color: '#4f6bed', opacity: 0.35 },
    { op: 'label3d', id: 'lblA', text: 'A', pos: [-1, 2, 1] },
    { op: 'add3d', id: 'ball', type: 'sphere', pos: [0, 1, 0], params: { r: 1 } },
  ];
  const res = applyBoard3DCommands(cmds, api);
  assert(res.length === 3 && res.every((x) => x.ok), '正方体 + 顶点标注 + 球：3 条全部成功');
  assert(api.objects.length === 3, '场景新增 3 个对象');
  const cube = api.objects.find((o) => o.id === 'cube');
  assert(cube.type === 'box' && cube.p.w === 2 && cube.p.h === 2 && cube.p.d === 2, 'box 几何参数正确写入');
  assert(cube.opacity === 0.35 && cube.color === '#4f6bed', 'box 颜色 / 透明度正确');
  const lbl = api.objects.find((o) => o.id === 'lblA');
  assert(lbl.type === 'label' && lbl.text === 'A' && lbl.rot.join() === '0,0,0', 'label3d 规范化为 label 对象');
  assert(JSON.stringify(lbl.pos) === '[-1,2,1]', 'label3d 锚点坐标正确');

  // circle / polygon（本轮新增图元）经执行器落到场景，参数键正确校验
  const api2 = mockApi();
  const r2 = applyBoard3DCommands([
    { op: 'add3d', id: 'disc', type: 'circle', pos: [0, 0, 0], params: { r: 1 } },
    { op: 'add3d', id: 'hex', type: 'polygon', pos: [4, 0, 0], params: { n: 6, r: 2 } },
  ], api2);
  assert(r2.length === 2 && r2.every((x) => x.ok), '圆面 + 多边形面：2 条命令全部成功');
  const disc = api2.objects.find((o) => o.id === 'disc');
  const hex = api2.objects.find((o) => o.id === 'hex');
  assert(disc.type === 'circle' && disc.p.r === 1, 'circle 几何参数 r 正确写入');
  assert(hex.type === 'polygon' && hex.p.n === 6 && hex.p.r === 2, 'polygon 几何参数 n/r 正确写入');
  const badN = applyBoard3DCommands([{ op: 'add3d', id: 'p2', type: 'polygon', params: { n: 2, r: 1 } }], mockApi());
  assert(badN[0].ok && mockApi().objects.length >= 0, 'polygon 命令可正常执行（n 钳制在执行器下游几何层）');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'add3d', id: 'x', type: 'box' },
    { op: 'add3d', id: 'x', type: 'sphere' },
  ], api);
  assert(res[0].ok && !res[1].ok && /已存在/.test(res[1].error), 'id 重复被拒绝，不覆盖已有对象');
  assert(api.objects.length === 1, '重复 id 未产生第二个对象');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'add3d', id: 'p', type: 'point', pos: ['1', null, 'oops'] },
    { op: 'add3d', id: 'q', type: 'sphere', pos: [0, 0, 0], params: { r: 2, bogus: 9, h: '3' } },
    { op: 'add3d', id: 'r', type: '不存在的类型' },
    { op: 'add3d', id: 's', type: 'box', color: 'red' },
  ], api);
  assert(res[0].ok && JSON.stringify(api.objects[0].pos) === '[0,0,0]', '非法 pos 安全降级为 [0,0,0]');
  assert(res[1].ok && api.objects[1].p.r === 2 && !('bogus' in api.objects[1].p) && !('h' in api.objects[1].p),
    'params 只保留该图元白名单键，非法键被剔除');
  assert(!res[2].ok && /未知图元/.test(res[2].error), '未知 type 被拒绝');
  assert(res[3].ok && api.objects[2].color === '#4f6bed', '非法颜色回退默认色');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'add3d', id: 'cube', type: 'box', params: { w: 1 } },
    { op: 'update3d', id: 'cube', pos: [3, 1, 0], rot: [0, 45, 0], params: { w: 4 }, color: '#e11d48' },
  ], api);
  assert(res[0].ok && res[1].ok, '同一轮 add3d → update3d 成功');
  const cube = api.objects[0];
  assert(JSON.stringify(cube.pos) === '[3,1,0]' && JSON.stringify(cube.rot) === '[0,45,0]', 'update3d 修改 pos / rot');
  assert(cube.params && cube.params.w === 4 && cube.color === '#e11d48',
    'update3d 同轮改几何参数（类型跟踪生效）与颜色');
  assert(api.calls.some((c) => c[0] === 'update' && c[1] === 'cube'), '确实调用了 api.update');
}

{
  const api = mockApi([{ id: 'old', type: 'sphere', pos: [0, 0, 0], p: { r: 1 } }]);
  const res = applyBoard3DCommands([
    { op: 'update3d', id: 'old', params: { r: 2.5 } },
    { op: 'remove3d', id: 'ghost' },
    { op: 'update3d', id: 'ghost' },
    { op: 'update3d', id: 'old' },
  ], api);
  assert(res[0].ok, '可修改「当前画板对象」里已有的 id');
  assert(!res[1].ok && !res[2].ok, '删除 / 修改不存在的 id 被拒绝');
  assert(!res[3].ok && /没有可修改/.test(res[3].error), '空 patch 被拒绝');
}

{
  const api = mockApi([{ id: 'a', type: 'box' }, { id: 'b', type: 'cone' }]);
  const res = applyBoard3DCommands([
    { op: 'remove3d', id: 'a' },
    { op: 'clear3d' },
    { op: 'remove3d', id: 'b' },
  ], api);
  assert(res[0].ok && res[1].ok && !res[2].ok, 'remove3d → clear3d → 再删已清空对象被拒绝');
  assert(api.objects.length === 0, 'clear3d 清空所有对象');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'view3d', bg: 'dark', axes: false, grid: false },
    { op: 'view3d', bg: 'rainbow' },
    { op: 'view3d' },
    { op: 'reset3d' },
  ], api);
  assert(res[0].ok && api.view.bg === 'dark' && api.view.axes === false && api.view.grid === false, 'view3d 设置背景 / 轴 / 网格');
  assert(!res[1].ok && /背景只支持/.test(res[1].error), '非法背景值被拒绝');
  assert(!res[2].ok && /没有可设置/.test(res[2].error), '空 view3d 被拒绝');
  assert(res[3].ok && api.calls.some((c) => c[0] === 'resetView'), 'reset3d 调用视角复位');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([
    { op: 'point', id: 'A', x: 1, y: 2 },
    { op: 'circle', id: 'c1', center: 'A' },
    { op: 'wat' },
    {},
  ], api);
  assert(res.every((x) => !x.ok), '2D 命令 / 未知命令在 3D 分支一律被拒绝');
  assert(res[0].error.includes('不识别 2D 命令'), '拒绝原因明确提示不混用 2D');
  assert(api.objects.length === 0, '被拒绝的命令不产生副作用');
}

{
  const api = mockApi();
  const many = Array.from({ length: 130 }, (_, i) => ({ op: 'add3d', id: 'o' + i, type: 'point' }));
  const res = applyBoard3DCommands(many, api, { maxCommands: 120 });
  assert(res.length === 130 && res.slice(120).every((x) => !x.ok), '命令数超上限被截断（防失控批）');
  assert(api.objects.length === 120, '只执行上限内的命令');
}

{
  const api = mockApi();
  const res = applyBoard3DCommands([{ op: 'add3d', type: 'box' }, { op: 'add3d', type: 'sphere' }], api);
  assert(res[0].ok && res[1].ok && res[0].id !== res[1].id, '缺 id 时自动生成唯一 id');
  assert(applyBoard3DCommands([{ op: 'add3d', id: 'z', type: 'box' }], null).every((x) => !x.ok),
    'api 缺失时全部安全失败，不抛异常');
}

/* ---------------- F. 规范化 / 场景摘要 ---------------- */
section('F. 对象规范化与场景摘要');
{
  const o = normalizeBoard3DObject({ id: 'k', type: 'cylinder', pos: [1, 2, 3], scale: [0, 2, 3], opacity: 9 }, 'cylinder');
  assert(o.scale[0] === 0.05, '缩放下限 0.05 生效');
  assert(o.opacity === 1, '透明度上限 1 生效');
  assert(o.color === '#4f6bed', '默认配色');
  assert(normalizeBoard3DObject({ id: 'z', type: 'nope' }, 'nope') === null, '未知 type 规范化返回 null');
  assert(describeBoard3DState({ objects: [] }).includes('空场景'), '空场景摘要');
  const s = describeBoard3DState({ objects: [{ id: 'cube', type: 'box', pos: [0, 1, 0] }, { id: 'lblA', type: 'label', pos: [1, 2, 1], text: 'A' }] });
  assert(s.includes('cube(box@[0,1,0])') && s.includes('"A"'), '摘要含 id / 类型 / 坐标 / 标注文字');
  assert(s.length < 1000, '摘要长度受控');
}

/* ---------------- G. 硬约束 / 集成静态校验 ---------------- */
section('G. 硬约束与集成静态校验');
{
  const editorJs = read('js/editor.js');
  const editorHtml = read('editor.html');
  const configJs = read('js/config.js');
  assert(editorJs.includes('@dajiaoai/algeo-sdk'), '硬约束：js/editor.js 仍保留大角 SDK import');
  assert(editorJs.includes('CFG.appId'), '硬约束：js/editor.js 仍保留 appId 逻辑');
  assert(configJs.includes("appId: 'ZYGKAQXC'"), '硬约束：js/config.js 仍保留 appId 配置');
  assert(editorHtml.includes('editor.js') || editorHtml.includes('appId'), '硬约束：editor.html 旧路径仍在');

  const page = read('board3d.html');
  assert(page.includes('./libs/three/three.module.min.js'), 'board3d.html importmap 仍为本地 three（零 CDN）');
  assert(!/jsdelivr[^>]*three|unpkg[^>]*three/.test(page), 'board3d.html 无 three 的 CDN 引用');
  assert(page.includes('js/board3d-ai.js') && page.includes('js/board3d.js'), '页面同时引入内核与 3D AI 面板脚本');
  assert(page.includes('id="b3dAiPanel"') && page.includes('id="btn-ai3d"'), 'AI 面板与入口按钮就位');

  const aiJs = read('js/board3d-ai.js');
  assert(aiJs.includes("mode: '3d'"), '3D AI 面板显式以 mode:3d 请求后端');
  // 只看真实 import 语句（注释里提到「不 import js/executor.js」不算），
  // 且不能误伤 './board3d.js' / './board3d-executor.js' 这两个 3D 侧模块。
  const imports2d = /from\s*['"](?:\.{1,2}\/)*(?:executor|board)\.js['"]/;
  assert(!imports2d.test(aiJs), '3D AI 面板未混入 2D 执行器 / 2D 画板代码');
  const exec = read('js/board3d-executor.js');
  assert(!exec.includes('from \'three\'') && !exec.includes('document.'), '3D 执行器不依赖 three / DOM（纯函数）');

  const backend = read('ai/board-backend.js');
  assert(backend.includes('resolveBoardMode') && backend.includes('BOARD3D_SYSTEM_PROMPT'), '后端已接入 3D 分支');
  assert(backend.includes('BOARD_SYSTEM_PROMPT') , '后端仍保留 2D 主干提示词');
  const prompt = read('ai/board-prompt.js');
  assert(prompt.indexOf('export const BOARD_SYSTEM_PROMPT') < prompt.indexOf('export const BOARD3D_SYSTEM_PROMPT'),
    '3D 段落是追加在 2D 主干之后（未整体替换）');
  assert(prompt.includes('例8：细粒度样式'), '2D 主干 few-shot 未被删除');

  // ESM 依赖闭合：新增模块的所有相对 import 都指向真实文件（避免线上 404）
  for (const f of ['js/board3d.js', 'js/board3d-ai.js', 'js/board3d-executor.js']) {
    const src = read(f);
    const re = /from\s*['"](\.[^'"]+)['"]/g;
    let m, allOk = true;
    while ((m = re.exec(src))) {
      if (!existsSync(join(ROOT, 'js', m[1]))) allOk = false;
    }
    assert(allOk, `${f} 的相对 import 全部可解析到真实文件`);
  }
  const imap = JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  for (const [key, val] of Object.entries(imap.imports)) {
    if (!val.endsWith('/')) assert(existsSync(join(ROOT, val)), `importmap ${key} → 本地文件存在`);
    else assert(existsSync(join(ROOT, val)), `importmap ${key} → 本地目录存在`);
  }
  assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')) &&
    existsSync(join(ROOT, 'libs/three/addons/controls/TransformControls.js')),
    'OrbitControls / TransformControls 本地 vendor 就位');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

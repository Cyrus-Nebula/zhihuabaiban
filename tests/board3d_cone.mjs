/**
 * 3D 通用圆锥 / 斜圆锥命令（cone3d · D28）无头回归。
 *
 * 覆盖：coneAxisUnit / coneBaseBasis / coneBasePoint / resolveCone3D 纯函数
 *       （正 / 斜圆锥、底圈半径守恒、底圈恒垂直法向、顶点轴向高与母线长守恒、
 *        apex 与 axis 分离表达斜圆锥、默认 / 指定 / 开关 / 小球与 S·A/B/C 标注 /
 *        样式 / 数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 /
 *        深度只读性）、执行器集成（逐项落地为 line + point + label、id 冲突避让、
 *       getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、maxCommands）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_cone.mjs
 */
import {
  BOARD3D_CONE_PROMPT, BOARD3D_CONE_PROMPT_OPS,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
  BOARD3D_ARC_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_POLYHEDRON_OPS, BOARD3D_COMPLETE9_OPS,
  BOARD3D_REVOLVE_OPS, BOARD3D_COMPLETE10_OPS, BOARD3D_TORUS_OPS, BOARD3D_COMPLETE11_OPS,
  BOARD3D_ELLIPSOID_OPS, BOARD3D_COMPLETE12_OPS, BOARD3D_CAPSULE_OPS, BOARD3D_COMPLETE13_OPS,
  BOARD3D_TUBE_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_PRISM_OPS, BOARD3D_COMPLETE15_OPS,
  BOARD3D_PYRAMID_OPS, BOARD3D_COMPLETE16_OPS, BOARD3D_FRUSTUM_OPS, BOARD3D_COMPLETE17_OPS,
  BOARD3D_VECTOR_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_CONE_OPS, BOARD3D_COMPLETE19_OPS,
} from '../js/board3d-executor.js';
import {
  CONE3D_RADIUS_MIN, CONE3D_RADIUS_MAX, CONE3D_RADIUS_DEFAULT,
  CONE3D_HEIGHT_MIN, CONE3D_HEIGHT_MAX, CONE3D_HEIGHT_DEFAULT,
  CONE3D_SEGMENTS_MIN, CONE3D_SEGMENTS_MAX, CONE3D_SEGMENTS_DEFAULT,
  CONE3D_VERTEX_SIZE_MIN, CONE3D_VERTEX_SIZE_MAX, CONE3D_VERTEX_SIZE_DEFAULT,
  CONE3D_MAX_SEGMENTS, CONE3D_DEFAULT_BASE, CONE3D_DEFAULT_AXIS,
  num, coneAxisUnit, coneBaseBasis, coneBasePoint, resolveCone3D,
} from '../js/board3d-cone.js';
import { readFileSync } from 'node:fs';
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
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);

// ---------------------------------------------------------------------------
section('一、常量与默认契约');
assert(CONE3D_RADIUS_DEFAULT === 1 && CONE3D_RADIUS_MIN === 0.01 && CONE3D_RADIUS_MAX === 10000, '半径默认/区间常量');
assert(CONE3D_HEIGHT_DEFAULT === 2 && CONE3D_HEIGHT_MIN === 0.01 && CONE3D_HEIGHT_MAX === 10000, '高度默认/区间常量');
assert(CONE3D_SEGMENTS_DEFAULT === 24 && CONE3D_SEGMENTS_MIN === 3 && CONE3D_SEGMENTS_MAX === 64, '分段默认/区间常量');
assert(CONE3D_VERTEX_SIZE_DEFAULT === 0.1 && CONE3D_VERTEX_SIZE_MIN === 0.01 && CONE3D_VERTEX_SIZE_MAX === 1, '顶点球默认/区间常量');
assert(CONE3D_MAX_SEGMENTS === 4096 && CONE3D_DEFAULT_AXIS === 'z', '段数上限与默认法向常量');
assert(frozen(CONE3D_DEFAULT_BASE) && frozen(CONE3D_DEFAULT_BASE[0]) && vecApprox(CONE3D_DEFAULT_BASE, [0, 0, 0]), '默认底面圆心深冻结且为原点');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、coneAxisUnit 底面法向解析');
assert(vecApprox(coneAxisUnit(undefined), [0, 0, 1]), '默认法向 z');
assert(vecApprox(coneAxisUnit('x'), [1, 0, 0]) && vecApprox(coneAxisUnit('Y'), [0, 1, 0]) && vecApprox(coneAxisUnit('Z'), [0, 0, 1]), 'x/y/z 大小写法向');
assert(vecApprox(coneAxisUnit([0, 3, 4]), [0, 0.6, 0.8]), '任意向量单位化');
assert(coneAxisUnit('q') === null && coneAxisUnit([0, 0, 0]) === null && coneAxisUnit([1, 'x', 0]) === null && coneAxisUnit(null) === null, '非法法向拒绝');

section('三、coneBaseBasis 正交标架');
for (const u of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0.6, 0.8], [0.577, 0.577, 0.577]]) {
  const B = coneBaseBasis(u);
  assert(B && approx(dot(B.n, B.n), 1) && approx(dot(B.b, B.b), 1) && approx(dot(B.n, B.b), 0) && approx(dot(B.n, u), 0) && approx(dot(B.b, u), 0), `标架正交归一 u=[${u}]`);
}
assert(coneBaseBasis('z') === null && coneBaseBasis([0, 0]) === null && coneBaseBasis([NaN, 0, 1]) === null, '非法 u 返回 null');

section('四、coneBasePoint 底圈点');
{
  const B = coneBaseBasis([0, 0, 1]);
  const p0 = coneBasePoint([0, 0, 0], B.n, B.b, 2, 0);
  const p90 = coneBasePoint([0, 0, 0], B.n, B.b, 2, Math.PI / 2);
  assert(vecApprox(p0, [2, 0, 0]) && vecApprox(p90, [0, 2, 0]), 'z 轴法向下底圈 0°/90° 点位');
}

section('五、resolveCone3D 正圆锥几何与守恒');
{
  const cmd = { op: 'cone3d', id: 'cone', base: [0, 0, 0], axis: 'z', radius: 2, height: 3, segments: 8 };
  const r = resolveCone3D(cmd, {});
  assert(r.ok && r.meta.isRight === true, '正圆锥解析成功且 isRight');
  assert(r.meta.axialHeight === 3 && approx(r.meta.slantHeight, Math.sqrt(13)), '轴向高 3、母线长 √13');
  assert(r.meta.baseRingCount === 8 && r.meta.sideCount === 8 && r.meta.pointCount === 0 && r.meta.labelCount === 0, '底圈/母线各 8、无点无标注');
  assert(r.items.length === 16 && r.items.every((it) => it.type === 'line'), '默认产 16 条 line');
  assert(r.meta.ring.every((p) => approx(len(sub(p, [0, 0, 0])), 2)), '底圈各点到圆心距离恒为 radius');
  assert(r.meta.ring.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '底圈各点 z=0、恒垂直法向');
  assert(r.meta.ring.every((p) => approx(len(sub(p, r.meta.apex)), Math.sqrt(13))), '正圆锥各母线等长 √13');
  assert(vecApprox(r.meta.apex, [0, 0, 3]), '默认顶点 = base + height·axis');
}

section('六、斜圆锥：apex 与 axis 分离');
{
  const r = resolveCone3D({ op: 'cone3d', base: [0, 0, 0], axis: 'z', apex: [1.5, 0, 3], radius: 2, segments: 8 });
  assert(r.ok && r.meta.isRight === false, '斜圆锥解析成功且 isRight=false');
  assert(r.meta.apexExplicit === true && vecApprox(r.meta.apex, [1.5, 0, 3]), '显式 apex 保留');
  assert(r.meta.axialHeight === 3 && approx(r.meta.slantHeight, Math.sqrt(9 + 4)), '斜圆锥轴向高 3、参考母线 √13');
  assert(r.meta.ring.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '斜圆锥底面仍垂直 axis');
  const sl = r.meta.ring.map((p) => len(sub(p, r.meta.apex)));
  assert(Math.max(...sl) - Math.min(...sl) > 0.1, '斜圆锥母线不等长（区分正圆锥）');
  assert(!('height' in r.meta) === false && r.meta.height === 2, '显式 apex 时 height 保持默认但被忽略');
}

section('七、开关、标注与样式');
{
  const r = resolveCone3D({ op: 'cone3d', segments: 5, asBase: false, asSides: false, asPoints: true, labelVertices: true, vertexSize: 0.2, color: '#ff0000', labelColor: '#00ff00', opacity: 0.6 });
  assert(r.ok && r.items.length === 12, '仅开点+标注：5 底圈点 + 1 顶点球 + 5 底圈标注 + 1 顶点标注 = 12');
  assert(r.items.filter((it) => it.type === 'point').length === 6 && r.items.filter((it) => it.type === 'label').length === 6, '6 点 + 6 标注');
  const labels = r.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.includes('S') && labels.includes('A') && labels.includes('E'), '顶点 S 与底圈 A..E 标注');
  assert(r.items.every((it) => it.color === '#ff0000' || it.type === 'label') && r.items.find((it) => it.type === 'label').color === '#00ff00', '线/点红、标注绿');
  assert(r.items.find((it) => it.type === 'point').p.s === 0.2 && approx(r.items[0].opacity, 0.6), '顶点球半径与透明度');
}

section('八、数字字符串容错与 id 避让');
{
  const r = resolveCone3D({ op: 'cone3d', id: 'c', radius: '2', height: '3', segments: '8', vertexSize: '0.2' }, { objects: [{ id: 'c_b1' }, { id: 'c_b2' }] });
  assert(r.ok && r.meta.radius === 2 && r.meta.height === 3 && r.meta.segments === 8, '数字字符串参数被接受');
  const ids = r.items.map((it) => it.id);
  assert(new Set(ids).size === ids.length && !ids.includes('c_b1') && !ids.includes('c_b2'), 'id 与 state 冲突时避让且无重复');
}
{
  const longId = 'x'.repeat(64);
  const r = resolveCone3D({ op: 'cone3d', id: longId, segments: 3 }, { objects: [{ id: longId }] });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '超长 id 截断后 ≤64 且不死循环');
}

section('九、脏输入原子拒绝');
const bad = [
  [{ op: 'cone3d', id: 'bad id' }, 'id 非法'],
  [{ op: 'cone3d', base: [0, 0] }, 'base 非法'],
  [{ op: 'cone3d', base: [0, 'x', 0] }, 'base 含非法数'],
  [{ op: 'cone3d', axis: 'q' }, 'axis 非法'],
  [{ op: 'cone3d', axis: [0, 0, 0] }, 'axis 零向量'],
  [{ op: 'cone3d', radius: 0 }, 'radius 下界'],
  [{ op: 'cone3d', radius: 10001 }, 'radius 上界'],
  [{ op: 'cone3d', radius: 'x' }, 'radius 非数'],
  [{ op: 'cone3d', height: 0 }, 'height 下界'],
  [{ op: 'cone3d', height: 10001 }, 'height 上界'],
  [{ op: 'cone3d', apex: [0, 0, 0] }, 'apex 与 base 重合'],
  [{ op: 'cone3d', apex: [1, 2] }, 'apex 非法'],
  [{ op: 'cone3d', apex: [10000, 10000, 10000] }, 'apex 距离越界'],
  [{ op: 'cone3d', segments: 2 }, 'segments 下界'],
  [{ op: 'cone3d', segments: 65 }, 'segments 上界'],
  [{ op: 'cone3d', segments: 3.5 }, 'segments 非整数'],
  [{ op: 'cone3d', asBase: 'yes' }, 'asBase 非布尔'],
  [{ op: 'cone3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'cone3d', vertexSize: 0 }, 'vertexSize 下界'],
  [{ op: 'cone3d', vertexSize: 2 }, 'vertexSize 上界'],
  [{ op: 'cone3d', opacity: NaN }, 'opacity 非数'],
  [{ op: 'cone3d', asBase: false, asSides: false }, '四开关全关'],
  [null, '命令为空'],
  [[], '命令为数组'],
];
for (const [cmd, label] of bad) {
  const r = resolveCone3D(cmd, {});
  assert(r.ok === false && typeof r.error === 'string', `${label} 原子拒绝`);
}

section('十、深度只读性');
{
  const cmd = Object.freeze({ op: 'cone3d', id: 'c', base: Object.freeze([0, 0, 0]), radius: 1, apex: Object.freeze([0, 0, 2]) });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'x' })]) });
  let threw = false;
  try { resolveCone3D(cmd, state); } catch (_) { threw = true; }
  assert(!threw, '冻结入参不抛错');
  assert(JSON.stringify(cmd.base) === '[0,0,0]' && state.objects.length === 1, '入参未被修改');
  const r = resolveCone3D(cmd, state);
  r.items[0].p.x1 = 999; r.meta.ring[0][0] = 999;
  assert(cmd.base[0] === 0, '输出改动不回流到入参');
}

// ---------------------------------------------------------------------------
section('十一、执行器常量与历史契约');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_OPS/ALL/FULL 条数不变');
assert([10, 11, 12, 13, 14, 15, 16, 17, 18].every((want, i) => {
  const c = [BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_COMPLETE9_OPS][i];
  return c.length === want;
}), '历史 COMPLETE~COMPLETE9 长度逐项不变');
assert(BOARD3D_COMPLETE10_OPS.length === 19 && BOARD3D_COMPLETE11_OPS.length === 20 && BOARD3D_COMPLETE12_OPS.length === 21 && BOARD3D_COMPLETE13_OPS.length === 22 && BOARD3D_COMPLETE14_OPS.length === 23 && BOARD3D_COMPLETE15_OPS.length === 24 && BOARD3D_COMPLETE16_OPS.length === 25 && BOARD3D_COMPLETE17_OPS.length === 26 && BOARD3D_COMPLETE18_OPS.length === 27, 'COMPLETE10~COMPLETE18 长度逐项不变');
assert(BOARD3D_CONE_OPS.length === 1 && BOARD3D_CONE_OPS[0] === 'cone3d' && BOARD3D_COMPLETE19_OPS.length === 28, '新增 CONE_OPS(1) 与 COMPLETE19(28)');
assert(BOARD3D_COMPLETE19_OPS.includes('cone3d') && BOARD3D_COMPLETE19_OPS.includes('vector3d'), 'COMPLETE19 含 cone3d 且保留 vector3d');
assert(!BOARD3D_OPS.includes('cone3d') && !BOARD3D_ALL_OPS.includes('cone3d') && !BOARD3D_FULL_OPS.includes('cone3d'), 'cone3d 未污染任何历史契约常量');

section('十二、执行器集成');
{
  const added = [];
  const api = {
    add: (o) => { added.push(o); return true; },
    remove: () => true, update: () => true, getState: () => ({ objects: [] }),
  };
  const res = applyBoard3DCommands([{ op: 'cone3d', id: 'c', segments: 4, asPoints: true }], api);
  assert(res.length === 1 && res[0].op === 'cone3d' && res[0].ok === true, 'cone3d 执行成功');
  assert(added.length === 13 && res[0].count === 13, '逐项落地 13 个对象（8 线 + 5 点）');
  assert(res[0].created.length === 13 && res[0].meta.isRight === true, 'created 与 meta 回报完整');
}
{
  const res = applyBoard3DCommands([{ op: 'cone3d', radius: 0 }], { add: () => true, getState: () => ({}) });
  assert(res.length === 1 && res[0].ok === false && /radius/.test(res[0].error), '执行器层级拒绝非法参数');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'cone3d' }], api);
  assert(res[0].ok === true, 'getState 抛错降级为空场景，整批不中断');
}
{
  let i = 0;
  const api = { add: () => (++i === 2 ? false : true), getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cone3d', segments: 4 }], api);
  assert(res[0].ok === false && res[0].failed && res[0].failed.length === 1 && res[0].created.length === 7, 'api.add 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'cone_b1' }] }) };
  const res = applyBoard3DCommands([{ op: 'cone3d', segments: 3 }], api);
  assert(res[0].ok === true && !res[0].failed, '执行器 id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cone', r: 1, h: 2 }], api);
  assert(res.length === 1 && res[0].ok === false && /不支持/.test(res[0].error), '2D/内置 cone 命令在 3D 分支被 default 拒绝');
}

section('十三、共享文件协议与 3D 意图检测');
assert(frozen(BOARD3D_CONE_PROMPT_OPS) && BOARD3D_CONE_PROMPT_OPS[0] === 'cone3d', 'board-prompt 新增 CONE_PROMPT_OPS');
assert(BOARD3D_CONE_PROMPT.includes('cone3d') && BOARD3D_CONE_PROMPT.includes('斜圆锥'), 'board-prompt CONE_PROMPT 含命令与斜圆锥说明');
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画一个圆锥') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十四、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolveCone3D \} from '\.\/board3d-cone\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'cone3d'/.test(exec), '执行器含 case cone3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_CONE_PROMPT'), '共享文件含 CONE_PROMPT 段（纯追加）');
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_CONE_PROMPT') && be.includes('BOARD3D_VECTOR_PROMPT'), 'backend 拼接串含 cone 且保留 vector');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('cone3d'), 'AI 面板结果展示含 cone3d');
  const html = read('board3d.html');
  assert(html.includes('cone3d') && html.includes('vector3d'), 'board3d.html AI tip 含 cone3d 且保留 vector3d');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D28') && doc.includes('cone3d'), '回归清单含 D28 记录');
  // 硬约束：旧路径与大角 SDK 引用仍在
  const wb = read('js/workbench.js');
  const ed = read('js/editor.js');
  const editorHtml = read('editor.html');
  assert(/board3d\.html/.test(wb), 'workbench.js 3D 路由指向 board3d.html（本任务早期已切换，未回退）');
  assert(/dajiaoai|algeo-sdk|appId/.test(editorHtml) || /dajiaoai|algeo-sdk/.test(ed), 'editor.html / editor.js 旧路径文件仍在、大角 SDK 引用未删除');
  assert(/dajiaoai|algeo-sdk/.test(ed), 'editor.js 仍保留大角 SDK 引用（未删除/破坏）');
  const hdr = read('board3d.html');
  assert(/importmap|three/.test(hdr), 'board3d.html 仍本地/自研 Three.js 引用');
}

console.log('\n结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);

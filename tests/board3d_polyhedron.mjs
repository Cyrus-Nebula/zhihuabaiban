/**
 * 3D 正多面体命令（polyhedron3d · D17）无头回归。
 *
 * 覆盖：常量与历史契约零回归 / kind 别名与拓扑 / 五种柏拉图立体顶点·棱·面数学
 *       （黄金比坐标 / 外接球半径恒定 / 棱等长且为最短顶点连线 / 面数欧拉公式）/
 *       命令解析（默认 / 中文别名 / center 偏移 / asVertices / labelVertices 标注 /
 *       样式透传 / 数字字符串 / id 避让）/ 脏输入原子拒绝 / 深度只读性 /
 *       执行器集成（逐项落地、id 冲突、getState 缺失与抛错降级、api 部分失败分项、
 *       2D 隔离、maxCommands）/ 共享文件协议两侧一致性 / 协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_polyhedron.mjs
 */
import {
  BOARD_SYSTEM_PROMPT, BOARD3D_PROMPT_OPS, BOARD3D_ARC_PROMPT,
  BOARD3D_POLYHEDRON_PROMPT_OPS, BOARD3D_POLYHEDRON_PROMPT,
} from '../ai/board-prompt.js';
import { resolveBoardMode } from '../ai/board-backend.js';
import {
  applyBoard3DCommands, BOARD3D_OPS, BOARD3D_MEASURE_OPS, BOARD3D_ALL_OPS,
  BOARD3D_TRANSFORM_OPS, BOARD3D_FULL_OPS, BOARD3D_DUPLICATE_OPS, BOARD3D_COMPLETE_OPS,
  BOARD3D_RADIAL_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_MIRROR_OPS, BOARD3D_COMPLETE3_OPS,
  BOARD3D_GRID_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_ALIGN_OPS, BOARD3D_COMPLETE5_OPS,
  BOARD3D_HELIX_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_BEZIER_OPS, BOARD3D_COMPLETE7_OPS,
  BOARD3D_ARC_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_POLYHEDRON_OPS, BOARD3D_COMPLETE9_OPS,
} from '../js/board3d-executor.js';
import {
  POLYHEDRON3D_KINDS, POLYHEDRON3D_TOPOLOGY, POLYHEDRON3D_ALIASES,
  POLYHEDRON3D_RADIUS_MIN, POLYHEDRON3D_RADIUS_MAX, POLYHEDRON3D_RADIUS_DEFAULT,
  POLYHEDRON3D_VERTEX_SIZE_MIN, POLYHEDRON3D_VERTEX_SIZE_MAX, POLYHEDRON3D_VERTEX_SIZE_DEFAULT,
  normalizeKind, unitVertices, polyhedronVertices, polyhedronEdges, resolvePolyhedron3D,
} from '../js/board3d-polyhedron.js';
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
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 1e-3) => a.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

section('A. 常量与历史契约（逐字不变）');
assert(BOARD3D_OPS.length === 7, 'BOARD3D_OPS 恒为 7 条');
assert(BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'MEASURE 1 / ALL 8 条');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9, 'TRANSFORM 1 / FULL 9 条');
assert(BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'DUPLICATE 1 / COMPLETE 10 条');
assert(BOARD3D_RADIAL_OPS.length === 1 && BOARD3D_COMPLETE2_OPS.length === 11, 'RADIAL 1 / COMPLETE2 11 条');
assert(BOARD3D_MIRROR_OPS.length === 1 && BOARD3D_COMPLETE3_OPS.length === 12, 'MIRROR 1 / COMPLETE3 12 条');
assert(BOARD3D_GRID_OPS.length === 1 && BOARD3D_COMPLETE4_OPS.length === 13, 'GRID 1 / COMPLETE4 13 条');
assert(BOARD3D_ALIGN_OPS.length === 1 && BOARD3D_COMPLETE5_OPS.length === 14, 'ALIGN 1 / COMPLETE5 14 条');
assert(BOARD3D_HELIX_OPS.length === 1 && BOARD3D_COMPLETE6_OPS.length === 15, 'HELIX 1 / COMPLETE6 15 条');
assert(BOARD3D_BEZIER_OPS.length === 1 && BOARD3D_COMPLETE7_OPS.length === 16, 'BEZIER 1 / COMPLETE7 16 条');
assert(BOARD3D_ARC_OPS.length === 1 && BOARD3D_COMPLETE8_OPS.length === 17, 'ARC 1 / COMPLETE8 17 条');
assert(BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_POLYHEDRON_OPS[0] === 'polyhedron3d', 'POLYHEDRON_OPS = [polyhedron3d]');
assert(BOARD3D_COMPLETE9_OPS.length === 18 && BOARD3D_COMPLETE9_OPS.includes('polyhedron3d'), 'COMPLETE9 完整集 18 条含 polyhedron3d');
assert(BOARD3D_COMPLETE9_OPS.slice(0, 17).join(',') === BOARD3D_COMPLETE8_OPS.join(','), 'COMPLETE9 前 17 条与 COMPLETE8 逐项一致（纯追加）');
assert(BOARD3D_POLYHEDRON_PROMPT_OPS.length === 1 && BOARD3D_POLYHEDRON_PROMPT_OPS[0] === 'polyhedron3d', '提示词侧 POLYHEDRON_PROMPT_OPS 一致');
assert(POLYHEDRON3D_KINDS.join(',') === 'tetra,cube,octa,dodeca,icosa', '五种立体规范名齐全');
assert(POLYHEDRON3D_RADIUS_MIN === 0.01 && POLYHEDRON3D_RADIUS_MAX === 1000 && POLYHEDRON3D_RADIUS_DEFAULT === 1.5, '半径区间与缺省值');
assert(POLYHEDRON3D_VERTEX_SIZE_MIN === 0.01 && POLYHEDRON3D_VERTEX_SIZE_MAX === 1 && POLYHEDRON3D_VERTEX_SIZE_DEFAULT === 0.14, '顶点球半径区间与缺省值');

section('B. kind 别名归一化');
for (const k of POLYHEDRON3D_KINDS) assert(normalizeKind(k) === k, `规范名 ${k} 归一为自身`);
assert(normalizeKind('正四面体') === 'tetra' && normalizeKind('四面体') === 'tetra', '中文四面体别名');
assert(normalizeKind('正方体') === 'cube' && normalizeKind('立方体') === 'cube' && normalizeKind('正六面体') === 'cube', '中文立方体别名');
assert(normalizeKind('正八面体') === 'octa' && normalizeKind('正十二面体') === 'dodeca' && normalizeKind('正二十面体') === 'icosa', '中文八/十二/二十面体别名');
assert(normalizeKind('TETRAHEDRON') === 'tetra' && normalizeKind(' Cube ') === 'cube' && normalizeKind('Icosahedron') === 'icosa', '英文全名与大小写/空白容错');
assert(normalizeKind('sphere') === null && normalizeKind(123) === null && normalizeKind('') === null, '非法/空 kind 返回 null');

section('C. 五种柏拉图立体拓扑数学（黄金比 / 外接球 / 棱等长 / 欧拉公式）');
const expectTopo = { tetra: [4, 6, 4], cube: [8, 12, 6], octa: [6, 12, 8], dodeca: [20, 30, 12], icosa: [12, 30, 20] };
for (const k of POLYHEDRON3D_KINDS) {
  const [nv, ne, nf] = expectTopo[k];
  const unit = unitVertices(k);
  const v = polyhedronVertices(k, [0, 0, 0], 2);
  const e = polyhedronEdges(v);
  const t = POLYHEDRON3D_TOPOLOGY[k];
  assert(unit.length === nv && v.length === nv, `${k} 顶点数 ${nv}`);
  assert(t.vertices === nv && t.edges === ne && t.faces === nf, `${k} TOPOLOGY 表数值正确`);
  assert(e.length === ne, `${k} 棱数 ${ne}`);
  assert(v.every((p) => p.every(Number.isFinite)), `${k} 全部顶点坐标有限（无 NaN）`);
  assert(v.every((p) => approx(Math.hypot(...p), 2)), `${k} 所有顶点到中心距离恒为 radius=2`);
  const lens = e.map(([i, j]) => dist(v[i], v[j]));
  assert(lens.every((l) => approx(l, lens[0])), `${k} 所有棱等长（唯一棱长 ${lens[0].toFixed(3)}）`);
  // 欧拉公式 V - E + F = 2
  assert(nv - ne + nf === 2, `${k} 满足欧拉公式 V-E+F=2`);
  // 棱是顶点对中的最短距离（柏拉图立体每条棱为最短顶点连线）
  let minPair = Infinity;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) minPair = Math.min(minPair, dist(v[i], v[j]));
  assert(approx(lens[0], minPair), `${k} 棱长等于最短顶点间距`);
}
{
  // center 平移：整体偏移后外接球心正确
  const c = [3, -2, 5];
  const v = polyhedronVertices('octa', c, 4);
  assert(v.every((p) => approx(dist(p, c), 4)), 'center 平移后所有顶点到球心距离恒为 4');
  assert(v.some((p) => approx(p[0], 7)) && v.some((p) => approx(p[0], -1)), 'octa 沿 X 轴顶点落在 cx±r');
}
{
  // 输出独立：两次调用互不影响
  const a = unitVertices('icosa');
  const b = unitVertices('icosa');
  a[0][0] = 999;
  assert(b[0][0] !== 999, 'unitVertices 每次返回全新数组（输出独立）');
}
{
  // 重复调用 dodeca 稳定去重（含 0 坐标列 +0/-0 重复）
  assert(unitVertices('dodeca').length === 20 && unitVertices('dodeca').length === unitVertices('dodeca').length, 'dodeca 每次稳定 20 顶点');
}

section('D. resolvePolyhedron3D 命令解析');
{
  const r = resolvePolyhedron3D({ op: 'polyhedron3d' }, {});
  assert(r.ok === true, '空参数给默认值仍成功');
  assert(r.meta.kind === 'cube' && r.meta.radius === POLYHEDRON3D_RADIUS_DEFAULT, '默认 kind=cube / radius=1.5');
  assert(r.meta.vertexCount === 8 && r.meta.edgeCount === 12 && r.meta.faceCount === 6, '默认立方体 8/12/6');
  assert(r.items.length === 12 + 8, '默认生成 12 棱 + 8 顶点球共 20 对象');
  assert(r.items.filter((it) => it.type === 'line').length === 12 && r.items.filter((it) => it.type === 'point').length === 8, 'line/point 数量正确');
}
{
  // 中文别名 + 顶点标注 + center 偏移
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', id: 'oct', kind: '正八面体', center: [0, 1, 0], radius: 2, labelVertices: true }, {});
  assert(r.ok === true && r.meta.kind === 'octa', '中文别名解析为 octa');
  assert(r.meta.vertexCount === 6 && r.meta.edgeCount === 12, '正八面体 6/12');
  const labels = r.items.filter((it) => it.type === 'label');
  assert(labels.length === 6 && r.meta.labels.join('') === 'ABCDEF', '生成 6 个顶点标注 A~F');
  // 标注锚点逐项落在 meta 顶点上（octa 绕 center=[0,1,0]，y 为 1±2 或 1，不是恒等于 1）
  assert(labels.every((it, i) => vecApprox(it.pos, r.meta.vertices[i])), '标注锚点落在 center 偏移后的顶点上');
  assert(labels.every((it) => it.text && it.text.length === 1), '每个标注 text 为单字母');
}
{
  // asVertices=false：只有棱无顶点球
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', kind: 'tetra', asVertices: false }, {});
  assert(r.items.every((it) => it.type === 'line') && r.items.length === 6, 'asVertices=false 仅 6 棱');
  assert(r.meta.asVertices === false, 'meta.asVertices=false');
}
{
  // labelVertices + asVertices=false：4 棱 + 4 标注
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', kind: 'tetra', asVertices: false, labelVertices: true }, {});
  assert(r.items.filter((it) => it.type === 'line').length === 6 && r.items.filter((it) => it.type === 'label').length === 4, '可独立标注顶点而不放球');
  assert(r.meta.labels.join('') === 'ABCD', '四面体标注 A~D');
}
{
  // 样式透传到棱与顶点球，标注用 labelColor
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', kind: 'cube', color: '#e05252', labelColor: '#00ff00', opacity: 0.6, labelVertices: true }, {});
  assert(r.items.filter((it) => it.type !== 'label').every((it) => it.color === '#e05252' && it.opacity === 0.6), 'color/opacity 透传到棱与顶点球');
  assert(r.items.filter((it) => it.type === 'label').every((it) => it.color === '#00ff00'), 'labelColor 透传到标注');
}
{
  // 数字字符串容错
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', radius: '2', vertexSize: '0.2', center: ['1', '2', '3'] }, {});
  assert(r.ok === true && r.meta.radius === 2 && r.meta.center.join(',') === '1,2,3', '数字字符串参数容错');
}
{
  // id 避让：state 已有同名对象
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', id: 'poly', kind: 'tetra', asVertices: false }, { objects: [{ id: 'poly_e1' }] });
  assert(r.ok === true && r.items[0].id === 'poly_e1_2', '已有 poly_e1 时自动避让为 poly_e1_2');
  const ids = r.items.map((it) => it.id);
  assert(new Set(ids).size === ids.length && !ids.includes('poly_e1'), '生成 id 唯一且不与已有冲突');
}
{
  // 长 id 截断后后缀仍唯一
  const longId = 'x'.repeat(64);
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', id: longId, kind: 'tetra', asVertices: false }, {});
  assert(new Set(r.items.map((it) => it.id)).size === 6, '超长 id 截断后各棱 id 仍唯一');
}
{
  // meta 顶点/棱与 items 一致
  const r = resolvePolyhedron3D({ op: 'polyhedron3d', kind: 'dodeca', labelVertices: true }, {});
  assert(r.meta.vertices.length === 20 && r.meta.edges.length === 30 && r.meta.labels.length === 20, 'dodeca meta 顶点/棱/标注齐全');
  assert(r.items.filter((it) => it.type === 'line').length === 30 && r.items.filter((it) => it.type === 'point').length === 20 && r.items.filter((it) => it.type === 'label').length === 20, 'dodeca items 30+20+20 落地');
  assert(r.items.filter((it) => it.type === 'line').every((it) => Number.isFinite(it.p.x1) && Number.isFinite(it.p.z2)), 'line 端点字段完整有限');
}

section('E. 脏输入原子拒绝（零副作用）');
const dirty = [
  [{ op: 'polyhedron3d', id: 123 }, 'id 非字符串'],
  [{ op: 'polyhedron3d', id: 'bad id!' }, 'id 含非法字符'],
  [{ op: 'polyhedron3d', kind: 'sphere' }, 'kind 非法'],
  [{ op: 'polyhedron3d', kind: 123 }, 'kind 非字符串'],
  [{ op: 'polyhedron3d', kind: '' }, 'kind 空串'],
  [{ op: 'polyhedron3d', radius: 0 }, 'radius = 0'],
  [{ op: 'polyhedron3d', radius: -1 }, 'radius 为负'],
  [{ op: 'polyhedron3d', radius: 1001 }, 'radius 超上限'],
  [{ op: 'polyhedron3d', radius: 'abc' }, 'radius 非数字'],
  [{ op: 'polyhedron3d', radius: NaN }, 'radius NaN'],
  [{ op: 'polyhedron3d', radius: Infinity }, 'radius Infinity'],
  [{ op: 'polyhedron3d', vertexSize: 0 }, 'vertexSize = 0'],
  [{ op: 'polyhedron3d', vertexSize: 2 }, 'vertexSize 超上限'],
  [{ op: 'polyhedron3d', vertexSize: 'x' }, 'vertexSize 非数字'],
  [{ op: 'polyhedron3d', center: [0, 0] }, 'center 非三元组'],
  [{ op: 'polyhedron3d', center: [0, 'x', 0] }, 'center 含非数值'],
  [{ op: 'polyhedron3d', center: '0,0,0' }, 'center 非数组'],
  [{ op: 'polyhedron3d', asVertices: 'yes' }, 'asVertices 非布尔'],
  [{ op: 'polyhedron3d', labelVertices: 1 }, 'labelVertices 非布尔'],
  [{ op: 'polyhedron3d', opacity: 'bad' }, 'opacity 非数字'],
];
for (const [cmd, label] of dirty) assert(resolvePolyhedron3D(cmd, {}).ok === false, `拒绝：${label}`);
assert(resolvePolyhedron3D(null, {}).ok === false && resolvePolyhedron3D(undefined, {}).ok === false, '拒绝空命令');
assert(resolvePolyhedron3D('polyhedron3d', {}).ok === false, '拒绝非对象命令');

section('F. 深度只读性（入参不被修改）');
{
  const cmd = Object.freeze({
    op: 'polyhedron3d', id: 'ro', kind: 'cube', center: Object.freeze([1, 2, 3]),
    radius: 2, asVertices: true, labelVertices: true,
  });
  const state = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'ro_e1' })]) });
  const r = resolvePolyhedron3D(cmd, state);
  assert(r.ok === true, '冻结入参仍可解析成功');
  assert(cmd.id === 'ro' && cmd.center[0] === 1 && state.objects.length === 1, '命令与 state 未被修改');
  r.items[0].p.x1 = 999;
  assert(cmd.radius === 2 && r.meta.vertices[0][0] !== 999, '改动输出不回流到入参');
}

section('G. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const r = applyBoard3DCommands([{ op: 'polyhedron3d', id: 'a', kind: 'tetra' }], api());
  assert(r[0].ok === true && r[0].count === 10 && r[0].created.length === 10, '执行器落地四面体 6 棱 + 4 顶点球 = 10');
  assert(r[0].op === 'polyhedron3d' && r[0].meta.vertexCount === 4, '执行器回执 op 与 meta 正确');
}
{
  const r = applyBoard3DCommands([{ op: 'polyhedron3d', id: 'b', kind: 'cube', labelVertices: true }], api());
  assert(r[0].ok === true && r[0].count === 28, '立方体 12 棱 + 8 球 + 8 标注 = 28');
  assert(r[0].created.filter((c) => c.type === 'label').length === 8, '8 个标注对象落地');
}
{
  const a = { getState: () => ({ objects: [{ id: 'a_e1' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'polyhedron3d', id: 'a', kind: 'tetra', asVertices: false }], a);
  assert(r[0].ok === true && !(r[0].failed && r[0].failed.length), '已有同名棱自动避让、全部成功');
}
{
  for (const a of [
    { add: (o) => o.id },
    { getState: () => { throw new Error('boom'); }, add: (o) => o.id },
  ]) {
    const r = applyBoard3DCommands([{ op: 'polyhedron3d', kind: 'tetra' }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  const a = { getState: () => ({ objects: [] }), add: () => false };
  const r = applyBoard3DCommands([{ op: 'polyhedron3d', kind: 'tetra' }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 10, 'api.add 失败如实分项回报');
}
{
  const r = applyBoard3DCommands([{ op: 'polyhedron', n: 5, r: 2 }], api());
  assert(r[0].ok === false, '2D 正多边形命令在 3D 分支被拒绝');
  const r2 = applyBoard3DCommands([{ op: 'unknown3d_placeholder2' }], api());
  assert(r2[0].ok === false, '未定义占位 3D 命令仍被 default 拒绝');
}
{
  const cmds = Array.from({ length: 4 }, () => ({ op: 'polyhedron3d', kind: 'tetra' }));
  const r = applyBoard3DCommands(cmds, api(), { maxCommands: 2 });
  assert(r[2].ok === false && r[3].ok === false, 'maxCommands 阻止超限命令');
}
{
  let addCalls = 0;
  const a = { getState: () => ({ objects: [] }), add: () => { addCalls++; return 'x'; } };
  const r = applyBoard3DCommands([{ op: 'polyhedron3d', kind: 'sphere' }], a);
  assert(r[0].ok === false && addCalls === 0, '执行器拒绝非法 kind 且未调用 add（零副作用）');
}

section('H. 共享文件协议两侧一致性');
const promptSrc = read('ai/board-prompt.js');
assert(promptSrc.includes('BOARD_SYSTEM_PROMPT') && promptSrc.includes('例 1'), '2D 主干源码仍在（未整体替换）');
assert(BOARD3D_PROMPT_OPS.length === 7, '共享文件基础 3D 协议 op 仍为 7 条');
assert(BOARD3D_POLYHEDRON_PROMPT.includes('polyhedron3d') && BOARD3D_POLYHEDRON_PROMPT.includes('正十二面体'), 'POLYHEDRON 提示词含命令说明与中文别名');
assert(BOARD3D_POLYHEDRON_PROMPT.includes('labelVertices') && BOARD3D_POLYHEDRON_PROMPT.includes('radius') && BOARD3D_POLYHEDRON_PROMPT.includes('kind'), '提示词含核心参数');
assert(BOARD3D_ARC_PROMPT.includes('arc3d'), '既有 ARC 提示词段仍在');
const iArc = promptSrc.indexOf('export const BOARD3D_ARC_PROMPT =');
const iPoly = promptSrc.indexOf('export const BOARD3D_POLYHEDRON_PROMPT =');
const iPolyOps = promptSrc.indexOf('export const BOARD3D_POLYHEDRON_PROMPT_OPS');
assert(iArc > 0 && iPoly > iArc, 'POLYHEDRON 追加段位于 ARC 段之后（末尾追加，未插入 / 未替换）');
assert(iPolyOps > 0 && iPolyOps < iPoly, 'POLYHEDRON_PROMPT_OPS 定义在其 PROMPT 之前');
assert(resolveBoardMode({ mode: '3d' }, '画个正四面体') === '3d', '3D 模式路由不变');
assert(resolveBoardMode({ mode: '2d' }, '画个正四面体') === '2d', '2D 模式路由不变');
assert(resolveBoardMode({}, '画一个圆') === '2d', '默认仍为 2D（3D 意图需显式开启）');

section('I. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍为本地 three（零 CDN）');
assert(page.includes('polyhedron3d') && page.includes('arc3d') && page.includes('bezier3d'), '页面 AI tip 新增 polyhedron3d 且保留 arc3d/bezier3d');
const aiPanel = read('js/board3d-ai.js');
assert(aiPanel.includes("ph.op !== 'polyhedron3d'") && aiPanel.includes("ac.op !== 'arc3d'"), '前端新增正多面体展示且保留既有圆弧展示');
const backend = read('ai/board-backend.js');
assert(backend.includes('BOARD3D_POLYHEDRON_PROMPT') && backend.includes('BOARD3D_ARC_PROMPT'), '后端 3D 拼接含 polyhedron 且保留 arc');
const arcConcat = 'BOARD3D_BEZIER_PROMPT + BOARD3D_ARC_PROMPT';
const polyConcat = 'BOARD3D_BEZIER_PROMPT + BOARD3D_ARC_PROMPT + BOARD3D_POLYHEDRON_PROMPT';
assert(backend.includes(arcConcat) && backend.includes(polyConcat), '后端新串以旧拼接串为前缀（纯追加）');
assert(existsSync(join(ROOT, 'js/board3d-polyhedron.js')), '新纯函数模块已入库');
assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')), '2D 主干仍在（未触碰）');
assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
assert(existsSync(join(ROOT, 'libs/three/addons/controls/OrbitControls.js')), '本地 vendor three 仍在');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
if (failed) process.exitCode = 1;

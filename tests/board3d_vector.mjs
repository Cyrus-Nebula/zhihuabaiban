/**
 * 3D 空间向量命令（vector3d · D27）无头回归。
 *
 * 覆盖：vectorDirection / vectorHeadBasis / vectorHeadBase / vectorHeadPoint / resolveVector3D
 *       纯函数（几何守恒：方向单位化、底心 = 终点 − 箭头长·方向、底圈半径守恒、
 *       底圈恒垂直杆方向、锥面顶点到轴线距离守恒、箭头长自动钳制、默认 / 指定 / 开关 /
 *       端点球与 A/B 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 / 各类脏输入原子拒绝 /
 *       深度只读性）、执行器集成（逐项落地为 line + point + label、id 冲突避让、
 *       getState 缺失 / 抛错降级、api 部分失败分项、2D 隔离、maxCommands）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_vector.mjs
 */
import {
  BOARD3D_VECTOR_PROMPT, BOARD3D_VECTOR_PROMPT_OPS,
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
  BOARD3D_VECTOR_OPS, BOARD3D_COMPLETE18_OPS,
} from '../js/board3d-executor.js';
import {
  VECTOR3D_LENGTH_MIN, VECTOR3D_LENGTH_MAX,
  VECTOR3D_HEAD_LENGTH_MIN, VECTOR3D_HEAD_LENGTH_MAX, VECTOR3D_HEAD_LENGTH_DEFAULT,
  VECTOR3D_HEAD_RADIUS_MIN, VECTOR3D_HEAD_RADIUS_MAX, VECTOR3D_HEAD_RADIUS_DEFAULT,
  VECTOR3D_HEAD_SEGMENTS_MIN, VECTOR3D_HEAD_SEGMENTS_MAX, VECTOR3D_HEAD_SEGMENTS_DEFAULT,
  VECTOR3D_HEAD_MAX_RATIO, VECTOR3D_VERTEX_SIZE_MIN, VECTOR3D_VERTEX_SIZE_MAX,
  VECTOR3D_VERTEX_SIZE_DEFAULT, VECTOR3D_MAX_SEGMENTS,
  VECTOR3D_DEFAULT_FROM, VECTOR3D_DEFAULT_TO,
  num, vectorDirection, vectorHeadBasis, vectorHeadBase, vectorHeadPoint, resolveVector3D,
} from '../js/board3d-vector.js';
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
const len = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);

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
assert(BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_COMPLETE9_OPS.length === 18, 'POLYHEDRON 1 / COMPLETE9 18 条');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_COMPLETE10_OPS.length === 19, 'REVOLVE 1 / COMPLETE10 19 条');
assert(BOARD3D_TORUS_OPS.length === 1 && BOARD3D_COMPLETE11_OPS.length === 20, 'TORUS 1 / COMPLETE11 20 条');
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_COMPLETE12_OPS.length === 21, 'ELLIPSOID 1 / COMPLETE12 21 条');
assert(BOARD3D_CAPSULE_OPS.length === 1 && BOARD3D_COMPLETE13_OPS.length === 22, 'CAPSULE 1 / COMPLETE13 22 条');
assert(BOARD3D_TUBE_OPS.length === 1 && BOARD3D_COMPLETE14_OPS.length === 23, 'TUBE 1 / COMPLETE14 23 条');
assert(BOARD3D_PRISM_OPS.length === 1 && BOARD3D_COMPLETE15_OPS.length === 24, 'PRISM 1 / COMPLETE15 24 条');
assert(BOARD3D_PYRAMID_OPS.length === 1 && BOARD3D_COMPLETE16_OPS.length === 25, 'PYRAMID 1 / COMPLETE16 25 条');
assert(BOARD3D_FRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE17_OPS.length === 26, 'FRUSTUM 1 / COMPLETE17 26 条');
assert(BOARD3D_VECTOR_OPS.length === 1 && BOARD3D_VECTOR_OPS[0] === 'vector3d', 'VECTOR OPS = [vector3d]');
assert(BOARD3D_COMPLETE18_OPS.length === 27, 'COMPLETE18 = 27 条（不并入历史契约）');
assert(frozen(BOARD3D_VECTOR_OPS) && frozen(BOARD3D_COMPLETE18_OPS), '新增 OPS 常量被冻结');
assert(VECTOR3D_LENGTH_MIN === 0.01 && VECTOR3D_LENGTH_MAX === 10000, '长度区间常量 0.01~10000');
assert(VECTOR3D_HEAD_LENGTH_DEFAULT === 0.4 && VECTOR3D_HEAD_LENGTH_MIN === 0.01 && VECTOR3D_HEAD_LENGTH_MAX === 1000, '箭头长度常量正确');
assert(VECTOR3D_HEAD_RADIUS_DEFAULT === 0.2 && VECTOR3D_HEAD_RADIUS_MIN === 0.01 && VECTOR3D_HEAD_RADIUS_MAX === 1000, '箭头半径常量正确');
assert(VECTOR3D_HEAD_SEGMENTS_DEFAULT === 12 && VECTOR3D_HEAD_SEGMENTS_MIN === 3 && VECTOR3D_HEAD_SEGMENTS_MAX === 48, '分段常量 3~48 默认 12');
assert(VECTOR3D_HEAD_MAX_RATIO === 0.9 && VECTOR3D_MAX_SEGMENTS === 4096, '钳制比例与段数上限常量正确');
assert(VECTOR3D_VERTEX_SIZE_DEFAULT === 0.1 && VECTOR3D_VERTEX_SIZE_MIN === 0.01 && VECTOR3D_VERTEX_SIZE_MAX === 1, '端点球尺寸常量正确');
assert(frozen(VECTOR3D_DEFAULT_FROM) && frozen(VECTOR3D_DEFAULT_TO), '默认起终点常量被冻结');
assert(num('2.5') === 2.5 && num(3) === 3 && num(null) === null && num('abc') === null && num('') === null, 'num 数值容错口径正确');

section('B. 纯函数：方向与正交标架');
{
  const u = vectorDirection([0, 0, 0], [3, 4, 0]);
  assert(vecApprox(u, [0.6, 0.8, 0]), 'vectorDirection 3-4-5 单位化正确');
  assert(approx(len(u), 1), '方向向量长度为 1');
  assert(vectorDirection([1, 2, 3], [1, 2, 3]) === null, '零向量方向返回 null');
  assert(vectorDirection([0, 0, 0], [0.001, 0, 0]) !== null, '方向函数本身不设最小长度（由解析器把关）');
  const a = [1, 2, 3], b = [4, 6, 3];
  const snap = JSON.stringify([a, b]);
  vectorDirection(a, b);
  assert(JSON.stringify([a, b]) === snap, 'vectorDirection 不修改入参');
}
{
  const z = vectorHeadBasis([0, 0, 1]);
  assert(vecApprox(z.n, [1, 0, 0]) && vecApprox(z.b, [0, 1, 0]), 'z 轴方向标架 n=X、b=Y');
  assert(approx(dot(z.n, z.b), 0) && approx(dot(z.n, [0, 0, 1]), 0) && approx(dot(z.b, [0, 0, 1]), 0), 'z 轴标架两两正交');
  const y = vectorHeadBasis([0, 1, 0]);
  assert(vecApprox(y.n, [0, 0, 1]) && vecApprox(y.b, [1, 0, 0]), 'y 轴方向改用 X 参考轴、标架不退化');
  assert(approx(dot(y.n, y.b), 0) && approx(dot(y.n, [0, 1, 0]), 0), 'y 轴标架两两正交');
  const d = vectorDirection([0, 0, 0], [1, 1, 1]);
  const diag = vectorHeadBasis(d);
  assert(diag && approx(dot(diag.n, diag.b), 0) && approx(dot(diag.n, d), 0) && approx(dot(diag.b, d), 0), '斜向方向标架两两正交');
  assert(approx(len(diag.n), 1) && approx(len(diag.b), 1), '标架基向量均为单位向量');
  assert(vectorHeadBasis(null) === null && vectorHeadBasis([0, 0]) === null && vectorHeadBasis(['a', 0, 0]) === null, '非法方向返回 null');
  const q = vectorHeadBase([0, 0, 2], [0, 0, 1], 0.4);
  assert(vecApprox(q, [0, 0, 1.6]), 'vectorHeadBase 按终点回退箭头长');
  const qSnap = JSON.stringify(q);
  vectorHeadPoint(q, z.n, z.b, 0.2, 0);
  assert(JSON.stringify(q) === qSnap, 'vectorHeadPoint 不修改底心');
  assert(vecApprox(vectorHeadPoint(q, z.n, z.b, 0.2, 0), [0.2, 0, 1.6]), 'θ=0 底圈点为 +n 方向');
  assert(vecApprox(vectorHeadPoint(q, z.n, z.b, 0.2, Math.PI / 2), [0, 0.2, 1.6]), 'θ=π/2 底圈点为 +b 方向');
}

section('C. resolveVector3D 命令解析');
{
  const r = resolveVector3D({ op: 'vector3d' });
  assert(r.ok === true, '默认命令解析成功');
  assert(r.items.length === 25 && r.meta.segmentCount === 25, '默认 1 杆 + 12 底圈 + 12 母线 = 25 段');
  assert(r.items.every((it) => it.type === 'line'), '默认产物全是 line');
  assert(vecApprox(r.meta.from, [0, 0, 0]) && vecApprox(r.meta.to, [0, 0, 2]), '默认起终点正确');
  assert(vecApprox(r.meta.direction, [0, 0, 1]) && r.meta.length === 2, '默认方向与长度正确');
  assert(r.meta.headLength === 0.4 && r.meta.headRadius === 0.2 && r.meta.headSegments === 12, '默认箭头参数正确');
  assert(vecApprox(r.meta.headBase, [0, 0, 1.6]), '默认箭头底心正确');
  assert(r.items[0].p.x1 === 0 && r.items[0].p.y1 === 0 && r.items[0].p.z1 === 0 && r.items[0].p.z2 === 2, '杆端点写入 p 字段');
}
{
  const r = resolveVector3D({ op: 'vector3d', headSegments: 6 });
  assert(r.ok && r.items.length === 13 && r.meta.headRingCount === 6 && r.meta.headRibCount === 6, '指定 6 分段 → 1+6+6=13 段');
  const shaftOnly = resolveVector3D({ op: 'vector3d', asHead: false });
  assert(shaftOnly.ok && shaftOnly.items.length === 1 && shaftOnly.meta.segmentCount === 1, 'asHead=false 只剩杆');
  const headOnly = resolveVector3D({ op: 'vector3d', asShaft: false });
  assert(headOnly.ok && headOnly.items.length === 24 && headOnly.meta.shaftCount === 0, 'asShaft=false 只有箭头 24 段');
  const points = resolveVector3D({ op: 'vector3d', asPoints: true });
  assert(points.ok && points.items.filter((it) => it.type === 'point').length === 2 && points.meta.pointCount === 2, 'asPoints 起终点各一球');
  assert(vecApprox(points.items[25].pos, [0, 0, 0]) && vecApprox(points.items[26].pos, [0, 0, 2]), '端点球位置对应 from / to');
  const labels = resolveVector3D({ op: 'vector3d', labelEndpoints: true });
  assert(labels.ok && labels.meta.labelCount === 2 && labels.items[25].text === 'A' && labels.items[26].text === 'B', 'labelEndpoints 输出 A/B 标注');
  const all = resolveVector3D({ op: 'vector3d', asPoints: true, labelEndpoints: true });
  assert(all.ok && all.items.length === 29 && all.meta.itemCount === 29, '全开关 25 line + 2 point + 2 label = 29 项');
}
{
  const r = resolveVector3D({ op: 'vector3d', from: [0, 0, 0], to: [3, 0, 4] });
  assert(r.ok && vecApprox(r.meta.direction, [0.6, 0, 0.8]) && r.meta.length === 5, '3-4-5 向量方向与长度解析正确');
  assert(vecApprox(r.meta.headBase, [2.76, 0, 3.68]), '斜向向量底心 = 终点 − 箭头长·方向');
  const clamped = resolveVector3D({ op: 'vector3d', to: [0, 0, 0.5], headLength: 0.9 });
  assert(clamped.ok && clamped.meta.headLength === 0.45 && clamped.meta.headLengthClamped === true, '箭头长按 0.9·L 钳制');
  assert(clamped.meta.headLengthRequested === 0.9 && vecApprox(clamped.meta.headBase, [0, 0, 0.05]), '钳制后底心仍在杆上');
  const big = resolveVector3D({ op: 'vector3d', headLength: 1000 });
  assert(big.ok && big.meta.headLength === 1.8 && big.meta.headLengthClamped === true, 'headLength=1000 被钳到 0.9·2=1.8');
  const noClamp = resolveVector3D({ op: 'vector3d', to: [0, 0, 10], headLength: 1 });
  assert(noClamp.ok && noClamp.meta.headLength === 1 && noClamp.meta.headLengthClamped === false, '未触发钳制时标记 false');
  assert(vecApprox(resolveVector3D({ op: 'vector3d', to: [0, 3, 0] }).meta.direction, [0, 1, 0]), '沿 y 轴向量方向正确');
  assert(vecApprox(resolveVector3D({ op: 'vector3d', to: [3, 0, 0] }).meta.direction, [1, 0, 0]), '沿 x 轴向量方向正确');
}
{
  const styled = resolveVector3D({ op: 'vector3d', color: '#ff0000', labelColor: '#00ff00', opacity: 0.5, labelEndpoints: true });
  assert(styled.items[0].color === '#ff0000' && styled.items[0].opacity === 0.5, 'color / opacity 透传到 line');
  assert(styled.items[25].color === '#00ff00' && styled.items[25].opacity === 1, 'labelColor 透传到 label');
  const badColor = resolveVector3D({ op: 'vector3d', color: 'not-a-color' });
  assert(badColor.items[0].color === '#4f6bed', '非法 color 回落默认色');
  const c1 = resolveVector3D({ op: 'vector3d', opacity: 2 });
  const c2 = resolveVector3D({ op: 'vector3d', opacity: 0 });
  assert(c1.meta.opacity === 1 && c2.meta.opacity === 0.1, 'opacity 钳制到 0.1~1');
  const str = resolveVector3D({ op: 'vector3d', from: ['0', '0', '0'], to: ['3', '0', '4'], headSegments: '6' });
  assert(str.ok && str.meta.length === 5 && str.meta.headSegments === 6, '数字字符串参数容错');
  const customId = resolveVector3D({ op: 'vector3d', id: 'myvec' });
  assert(customId.items[0].id === 'myvec_shaft' && customId.meta.id === 'myvec', '自定义 id 前缀生效');
  const evaded = resolveVector3D({ op: 'vector3d', id: 'myvec' }, { objects: [{ id: 'myvec_shaft' }, { id: 'myvec_shaft_2' }] });
  assert(evaded.ok && evaded.items[0].id === 'myvec_shaft_3', '已有 id 避让到 _3');
  const longId = 'v'.repeat(64);
  const long = resolveVector3D({ op: 'vector3d', id: longId }, { objects: [{ id: longId.slice(0, 56) + '_shaft' }] });
  assert(long.ok && long.items[0].id.length <= 64 && long.items[0].id !== longId.slice(0, 56) + '_shaft', '64 字符长 id 不退化 / 不死循环');
}

section('D. 几何守恒（真实参数方程断言）');
{
  const from = [1, 2, 3], to = [4, 6, 3];
  const r = resolveVector3D({ op: 'vector3d', from, to, headLength: 1, headRadius: 0.5, headSegments: 8 });
  const m = r.meta;
  assert(r.ok && approx(len(m.direction), 1), '方向单位化守恒');
  assert(vecApprox(m.direction, [0.6, 0.8, 0]) && vecApprox(sub(to, from), [3, 4, 0]), '方向 = (to−from)/L');
  assert(approx(dot(m.direction, sub(to, from)), m.length), '方向与杆同向（点积=长度）');
  assert(vecApprox(m.headBase, [3.4, 5.2, 3]), '底心 = 终点 − headLength·u');
  assert(approx(len(sub(m.headBase, to)), m.headLength), '底心到终点距离 = headLength');
  assert(m.ring.length === 8, '底圈采样点数 = headSegments');
  let radiusOk = true, perpOk = true, slantOk = true;
  for (const p of m.ring) {
    const vp = sub(p, m.headBase);
    if (!approx(len(vp), m.headRadius)) radiusOk = false;
    if (!approx(dot(vp, m.direction), 0)) perpOk = false;
    if (!approx(len(sub(p, to)), Math.sqrt(m.headLength ** 2 + m.headRadius ** 2))) slantOk = false;
  }
  assert(radiusOk, '底圈每点到轴线距离恒为 headRadius');
  assert(perpOk, '底圈每点相对底心的向量恒垂直杆方向');
  assert(slantOk, '锥面每点到终点距离恒为 √(headLength²+headRadius²)');
  assert(approx(len(sub(m.ring[0], m.ring[1])), 2 * m.headRadius * Math.sin(Math.PI / 8)), '相邻底圈点间距符合正八边形边长');
  const shaft = r.items[0];
  assert(shaft.p.x1 === 1 && shaft.p.y1 === 2 && shaft.p.z1 === 3 && shaft.p.x2 === 4 && shaft.p.y2 === 6 && shaft.p.z2 === 3, '杆端点恰为 from / to');
  const rings = r.items.slice(1, 9);
  assert(rings.length === 8 && rings.every((it) => it.type === 'line'), '前 8 段为底圈连线');
  const ribs = r.items.slice(9, 17);
  assert(ribs.every((it) => it.type === 'line' && it.p.x2 === 4 && it.p.y2 === 6 && it.p.z2 === 3), '后 8 段母线均以终点为尖端');
}

section('E. 脏输入原子拒绝');
function reject(label, cmd, state) {
  const r = resolveVector3D(cmd, state);
  assert(r.ok === false && typeof r.error === 'string' && r.error.length > 0, `原子拒绝：${label}`);
}
reject('命令为空', null);
reject('命令为数组', []);
reject('id 含空格', { op: 'vector3d', id: 'bad id' });
reject('id 超 64 字符', { op: 'vector3d', id: 'v'.repeat(65) });
reject('id 为数字', { op: 'vector3d', id: 12 });
reject('from 非数组', { op: 'vector3d', from: '0,0,0' });
reject('from 长度 2', { op: 'vector3d', from: [0, 0] });
reject('from 含 null', { op: 'vector3d', from: [0, null, 0] });
reject('from 含表达式', { op: 'vector3d', from: ['2+2', 0, 0] });
reject('from 含 NaN 字面串', { op: 'vector3d', from: ['NaN', 0, 0] });
reject('from 含 Infinity 字面串', { op: 'vector3d', from: ['Infinity', 0, 0] });
reject('to 非数组', { op: 'vector3d', to: { x: 1, y: 2, z: 3 } });
reject('to 含空串', { op: 'vector3d', to: ['', 0, 0] });
reject('from 与 to 重合（零向量）', { op: 'vector3d', from: [1, 2, 3], to: [1, 2, 3] });
reject('向量长度小于下限', { op: 'vector3d', to: [0.001, 0, 0] });
reject('向量长度超上限', { op: 'vector3d', from: [-10000, 0, 0], to: [10000, 0, 0] });
reject('headLength 为 null', { op: 'vector3d', headLength: null });
reject('headLength 为非法字符串', { op: 'vector3d', headLength: 'abc' });
reject('headLength = 0', { op: 'vector3d', headLength: 0 });
reject('headLength 超上限', { op: 'vector3d', headLength: 1001 });
reject('headRadius 为 null', { op: 'vector3d', headRadius: null });
reject('headRadius = 0', { op: 'vector3d', headRadius: 0 });
reject('headRadius 超上限', { op: 'vector3d', headRadius: 1001 });
reject('headSegments 非整数', { op: 'vector3d', headSegments: 3.5 });
reject('headSegments 小于 3', { op: 'vector3d', headSegments: 2 });
reject('headSegments 大于 48', { op: 'vector3d', headSegments: 49 });
reject('headSegments 为 null', { op: 'vector3d', headSegments: null });
reject('asShaft 非布尔', { op: 'vector3d', asShaft: 'true' });
reject('asHead 非布尔', { op: 'vector3d', asHead: 1 });
reject('asPoints 非布尔', { op: 'vector3d', asPoints: 'yes' });
reject('labelEndpoints 非布尔', { op: 'vector3d', labelEndpoints: 0 });
reject('四个输出开关全关', { op: 'vector3d', asShaft: false, asHead: false, asPoints: false, labelEndpoints: false });
reject('vertexSize = 0', { op: 'vector3d', vertexSize: 0 });
reject('vertexSize 超上限', { op: 'vector3d', vertexSize: 1.5 });
reject('vertexSize 非法字符串', { op: 'vector3d', vertexSize: 'abc' });
reject('opacity 非法', { op: 'vector3d', opacity: 'abc' });

section('F. 深度只读性');
{
  const from = [0, 0, 0], to = [3, 0, 4];
  const state = { objects: [{ id: 'vector_shaft' }] };
  const cmd = Object.freeze({
    op: 'vector3d',
    from: Object.freeze(from.slice()),
    to: Object.freeze(to.slice()),
    labelEndpoints: true,
  });
  const cmdSnap = JSON.stringify(cmd);
  const stateSnap = JSON.stringify(state);
  const r = resolveVector3D(cmd, state);
  assert(r.ok, '冻结入参仍能解析');
  assert(JSON.stringify(cmd) === cmdSnap, 'cmd 未被修改（深度只读）');
  assert(JSON.stringify(state) === stateSnap, 'state 未被修改（深度只读）');
  r.meta.from[0] = 999;
  r.meta.ring[0][0] = 999;
  r.items[0].id = 'mutated';
  assert(from[0] === 0 && to[0] === 3, '返回值与入参无引用共享');
  const r2 = resolveVector3D({ op: 'vector3d' });
  assert(r2.items[0].id === 'vector_shaft' && r2.meta.from[0] === 0, '再次解析不受前次改动影响');
}

section('G. 执行器集成');
const api = () => ({ getState: () => ({ objects: [] }), add: (o) => o.id });
{
  const added = [];
  const a = { getState: () => ({ objects: [] }), add: (o) => { added.push(o); return true; } };
  const r = applyBoard3DCommands([{ op: 'vector3d', id: 'vec', labelEndpoints: true, asPoints: true }], a);
  assert(r.length === 1 && r[0].ok === true && r[0].op === 'vector3d', '执行器单条成功');
  assert(r[0].count === 29 && r[0].created.length === 29 && added.length === 29, '29 项逐段落地');
  assert(added.filter((o) => o.type === 'line').length === 25 && added.filter((o) => o.type === 'point').length === 2 && added.filter((o) => o.type === 'label').length === 2, 'line/point/label 三类产物数量正确');
  assert(r[0].meta.headSegments === 12 && r[0].meta.length === 2, 'meta 回读正确');
}
{
  const a = { getState: () => ({ objects: [{ id: 'vec_shaft' }, { id: 'vec_shaft_2' }] }), add: (o) => o.id };
  const r = applyBoard3DCommands([{ op: 'vector3d', id: 'vec' }], a);
  assert(r[0].ok === true && r[0].created.some((c) => c.id === 'vec_shaft_3'), '已有 id 被避让（_3）');
}
{
  for (const gs of [undefined, () => { throw new Error('boom'); }]) {
    const a = gs ? { getState: gs, add: (o) => o.id } : { add: (o) => o.id };
    const r = applyBoard3DCommands([{ op: 'vector3d', id: 'x' }], a);
    assert(r[0].ok === true, 'getState 缺失/抛错降级为空场景仍生成');
  }
}
{
  const a = { getState: () => ({ objects: [] }), add: (o) => (o.id.endsWith('_hr2') ? false : (o.id.endsWith('_hb3') ? null : true)) };
  const r = applyBoard3DCommands([{ op: 'vector3d', id: 'vec' }], a);
  assert(r[0].ok === false && Array.isArray(r[0].failed) && r[0].failed.length === 2, 'api 部分失败（false/null）分项回报');
  assert(r[0].failed.every((f) => f.error === '画板新建失败'), '失败项错误文案正确');
}
{
  const r = applyBoard3DCommands([{ op: 'add', type: 'circle' }], api());
  assert(r[0].ok === false && /不支持的 3D 命令/.test(r[0].error), '2D 命令在 3D 分支被拒绝');
}
{
  const many = Array.from({ length: 5 }, (_, i) => ({ op: 'vector3d', id: 'v' + i }));
  const r = applyBoard3DCommands(many, api(), { maxCommands: 3 });
  assert(r.length === 5 && r[0].ok && r[1].ok && r[2].ok && r[3].ok === false && r[4].ok === false && /上限/.test(r[3].error), 'maxCommands 超限追加失败回执');
}
{
  const r = applyBoard3DCommands([{ op: 'vector3d', from: [0, 0, 0], to: [0, 0, 0] }], api());
  assert(r[0].ok === false && /重合|长度/.test(r[0].error), '脏参数在执行器内原子拒绝、零副作用');
}

section('H. 协议两侧一致性');
assert(BOARD3D_VECTOR_PROMPT_OPS.length === 1 && BOARD3D_VECTOR_PROMPT_OPS[0] === 'vector3d', '提示词 OP 常量 = [vector3d]');
assert(frozen(BOARD3D_VECTOR_PROMPT_OPS), '提示词 OP 常量被冻结');
assert(BOARD3D_VECTOR_PROMPT.includes('vector3d') && BOARD3D_VECTOR_PROMPT.includes('from') && BOARD3D_VECTOR_PROMPT.includes('to'), '提示词含命令名与核心参数');
assert(BOARD3D_VECTOR_PROMPT.includes('headLength') && BOARD3D_VECTOR_PROMPT.includes('headRadius') && BOARD3D_VECTOR_PROMPT.includes('headSegments'), '提示词含箭头参数说明');
assert(BOARD3D_VECTOR_PROMPT.includes('labelEndpoints') && BOARD3D_VECTOR_PROMPT.includes('标注'), '提示词含端点标注说明');
assert(BOARD3D_VECTOR_PROMPT.includes('2D') && BOARD3D_VECTOR_PROMPT.includes('铁律'), '提示词含 2D 隔离铁律');
assert(BOARD3D_VECTOR_PROMPT.includes('measure3d') && BOARD3D_VECTOR_PROMPT.includes('无向'), '提示词含与量测/无向线段的区别');
assert(BOARD3D_VECTOR_PROMPT.includes('钳制') && BOARD3D_VECTOR_PROMPT.includes('0.9'), '提示词含箭头长钳制说明');
assert(resolveBoardMode({ mode: '3d' }) === '3d' && resolveBoardMode({ mode: '2d' }) === '2d', 'resolveBoardMode 3D/2D 分流未变');
assert(resolveBoardMode({ detect3d: true }, '画一个3D空间向量') === '3d', '显式 detect3d 命中 3D 意图走 3D 协议');
assert(resolveBoardMode({}, '画个向量') === '2d', '未开 detect3d 默认 2D（不误伤 2D）');
{
  const promptSrc = read('ai/board-prompt.js');
  assert(promptSrc.indexOf('BOARD3D_FRUSTUM_PROMPT') < promptSrc.indexOf('BOARD3D_VECTOR_PROMPT'), '共享文件为末尾纯追加（FRUSTUM 在前、VECTOR 在后）');
  assert(/BOARD_SYSTEM_PROMPT/.test(promptSrc), '2D 主干 BOARD_SYSTEM_PROMPT 仍在');
  const backend = read('ai/board-backend.js');
  assert(backend.includes('BOARD3D_VECTOR_PROMPT') && backend.includes('BOARD3D_FRUSTUM_PROMPT + BOARD3D_VECTOR_PROMPT'), '后端 import 与 3D 拼接串末尾追加');
  assert(backend.includes('BOARD3D_FRUSTUM_PROMPT') && backend.includes('isBoard3DIntent'), '既有 3D 提示词与意图检测仍在');
}

section('I. 协作铁律与硬约束（新旧路径并存）');
assert(read('js/editor.js').includes('@dajiaoai/algeo-sdk'), '硬约束：editor.js 仍 import 大角 SDK');
assert(read('js/editor.js').includes('CFG.appId'), '硬约束：editor.js 仍保留 appId 逻辑');
assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
const wb = read('js/workbench.js');
assert(wb.includes('board3d.html') && wb.includes('board.html'), '路由 3D→board3d.html、2D→board.html 仍在');
const page = read('board3d.html');
assert(page.includes('./libs/three/three.module.min.js'), 'importmap 仍指向本地 vendor Three.js');
assert(page.includes('vector3d'), '页面 AI tip 已追加 vector3d 说明');
assert(read('js/board3d-ai.js').includes("vc.op !== 'vector3d'"), 'AI 面板已追加 vector3d 展示块');
const execSrc = read('js/board3d-executor.js');
assert(execSrc.includes("case 'vector3d'") && execSrc.includes("import { resolveVector3D }"), '执行器已追加 vector3d 分支与 import');
assert(read('docs/3D画板回归用例清单.md').includes('D27'), '回归清单已追加 D27 记录');

section('结果');
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exitCode = 1;

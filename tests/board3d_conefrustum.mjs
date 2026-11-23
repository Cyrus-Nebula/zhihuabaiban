/**
 * 3D 通用圆台 / 斜圆台命令（conefrustum3d · D31）无头回归。
 *
 * 覆盖：conefrustumAxisUnit / conefrustumBaseBasis / conefrustumRingPoint / resolveConefrustum3D 纯函数
 *       （正 / 斜圆台、上下底圈半径守恒、双圈恒垂直法向且平行、正圆台侧母线等长与锥顶在 axis 轴上、
 *        斜圆台侧母线变长与锥顶共线、锥顶公式、退化圆锥/圆柱、默认 / 指定 / 开关 / 小球与
 *        O·A/B/C·A'/B'/C' 标注 / 样式 / 数字字符串 / id 避让与 64 字符边界 /
 *        各类脏输入原子拒绝 / 深度只读性）、
 *       执行器集成（逐项落地为 line + point + label、id 冲突避让、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_conefrustum.mjs
 */
import {
  BOARD3D_CONEFRUSTUM_PROMPT, BOARD3D_CONEFRUSTUM_PROMPT_OPS,
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
  BOARD3D_CYLINDER_OPS, BOARD3D_COMPLETE20_OPS, BOARD3D_PLANE_OPS, BOARD3D_COMPLETE21_OPS,
  BOARD3D_CONEFRUSTUM_OPS, BOARD3D_COMPLETE22_OPS,
} from '../js/board3d-executor.js';
import {
  CONEFRUSTUM3D_RADIUS_BOTTOM_MIN, CONEFRUSTUM3D_RADIUS_BOTTOM_MAX, CONEFRUSTUM3D_RADIUS_BOTTOM_DEFAULT,
  CONEFRUSTUM3D_RADIUS_TOP_MIN, CONEFRUSTUM3D_RADIUS_TOP_MAX, CONEFRUSTUM3D_RADIUS_TOP_DEFAULT,
  CONEFRUSTUM3D_HEIGHT_MIN, CONEFRUSTUM3D_HEIGHT_MAX, CONEFRUSTUM3D_HEIGHT_DEFAULT,
  CONEFRUSTUM3D_SEGMENTS_MIN, CONEFRUSTUM3D_SEGMENTS_MAX, CONEFRUSTUM3D_SEGMENTS_DEFAULT,
  CONEFRUSTUM3D_VERTEX_SIZE_MIN, CONEFRUSTUM3D_VERTEX_SIZE_MAX, CONEFRUSTUM3D_VERTEX_SIZE_DEFAULT,
  CONEFRUSTUM3D_MAX_SEGMENTS, CONEFRUSTUM3D_DEFAULT_BASE, CONEFRUSTUM3D_DEFAULT_AXIS,
  num, conefrustumAxisUnit, conefrustumBaseBasis, conefrustumRingPoint, resolveConefrustum3D,
} from '../js/board3d-conefrustum.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** 从 git HEAD 读取改动前内容，用于共享文件字节级纯追加断言 */
const readHead = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ ' + msg); }
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
assert(CONEFRUSTUM3D_RADIUS_BOTTOM_DEFAULT === 2 && CONEFRUSTUM3D_RADIUS_BOTTOM_MIN === 0.01 && CONEFRUSTUM3D_RADIUS_BOTTOM_MAX === 10000, '下底半径默认/区间常量');
assert(CONEFRUSTUM3D_RADIUS_TOP_DEFAULT === 1 && CONEFRUSTUM3D_RADIUS_TOP_MIN === 0 && CONEFRUSTUM3D_RADIUS_TOP_MAX === 10000, '上底半径默认/区间常量（允许0）');
assert(CONEFRUSTUM3D_HEIGHT_DEFAULT === 2 && CONEFRUSTUM3D_HEIGHT_MIN === 0.01 && CONEFRUSTUM3D_HEIGHT_MAX === 10000, '高度默认/区间常量');
assert(CONEFRUSTUM3D_SEGMENTS_DEFAULT === 24 && CONEFRUSTUM3D_SEGMENTS_MIN === 3 && CONEFRUSTUM3D_SEGMENTS_MAX === 64, '分段默认/区间常量');
assert(CONEFRUSTUM3D_VERTEX_SIZE_DEFAULT === 0.1 && CONEFRUSTUM3D_VERTEX_SIZE_MIN === 0.01 && CONEFRUSTUM3D_VERTEX_SIZE_MAX === 1, '顶点球默认/区间常量');
assert(CONEFRUSTUM3D_MAX_SEGMENTS === 4096 && CONEFRUSTUM3D_DEFAULT_AXIS === 'z', '段数上限与默认法向常量');
assert(frozen(CONEFRUSTUM3D_DEFAULT_BASE) && frozen(CONEFRUSTUM3D_DEFAULT_BASE[0]) && vecApprox(CONEFRUSTUM3D_DEFAULT_BASE, [0, 0, 0]), '默认下底圆心深冻结且为原点');
assert(num(3) === 3 && num('2.5') === 2.5 && num(' 4 ') === 4 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 数字字符串容错与脏值拒绝');

section('二、法向解析');
assert(vecApprox(conefrustumAxisUnit(undefined), [0, 0, 1]), '默认法向 z');
assert(vecApprox(conefrustumAxisUnit('x'), [1, 0, 0]) && vecApprox(conefrustumAxisUnit('Y'), [0, 1, 0]) && vecApprox(conefrustumAxisUnit('Z'), [0, 0, 1]), 'x/y/z 大小写法向');
assert(vecApprox(conefrustumAxisUnit([0, 3, 4]), [0, 0.6, 0.8]), '任意向量单位化');
assert(conefrustumAxisUnit('q') === null && conefrustumAxisUnit([0, 0, 0]) === null && conefrustumAxisUnit([1, 'x', 0]) === null && conefrustumAxisUnit(null) === null, '非法法向拒绝');

section('三、正交标架');
for (const u of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0.6, 0.8]]) {
  const B = conefrustumBaseBasis(u);
  assert(B && approx(dot(B.n, B.n), 1) && approx(dot(B.b, B.b), 1) && approx(dot(B.n, B.b), 0) && approx(dot(B.n, u), 0) && approx(dot(B.b, u), 0), `标架正交归一 u=[${u}]`);
}
assert(conefrustumBaseBasis('z') === null && conefrustumBaseBasis([0, 0]) === null && conefrustumBaseBasis([NaN, 0, 1]) === null, '非法 u 返回 null');

section('四、圈点参数方程');
{
  const B = conefrustumBaseBasis([0, 0, 1]);
  const p0 = conefrustumRingPoint([0, 0, 0], B.n, B.b, 2, 0);
  const p90 = conefrustumRingPoint([0, 0, 0], B.n, B.b, 2, Math.PI / 2);
  assert(vecApprox(p0, [2, 0, 0]) && vecApprox(p90, [0, 2, 0]), 'z 轴法向下圈点 0°/90° 点位');
  const q0 = conefrustumRingPoint([0, 0, 3], B.n, B.b, 1, 0);
  assert(approx(len(sub(q0, [0, 0, 3])), 1), '上底圈点半径 1');
}

section('五、正圆台解析与守恒');
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', radiusBottom: 2, radiusTop: 1, height: 3, segments: 8 });
  assert(r.ok && r.meta.isRight === true, '正圆台解析成功且 isRight');
  assert(r.meta.degenerate === 'frustum', 'degenerate=frustum');
  assert(r.meta.radiusBottom === 2 && r.meta.radiusTop === 1 && r.meta.height === 3 && r.meta.segments === 8, '半径/高/分段读数正确');
  assert(r.meta.baseRingCount === 8 && r.meta.topRingCount === 8 && r.meta.sideCount === 8 && r.meta.pointCount === 0 && r.meta.labelCount === 0, '下底圈/上底圈/侧母线各 8、无点无标注');
  assert(r.items.length === 24 && r.items.every((it) => it.type === 'line'), '默认产 24 条 line');
  assert(r.meta.bottomRing.every((p) => approx(len(sub(p, [0, 0, 0])), 2)), '下底圈各点到圆心距离恒为 radiusBottom=2');
  assert(r.meta.topRing.every((p) => approx(len(sub(p, [0, 0, 3])), 1)), '上底圈各点到圆心距离恒为 radiusTop=1');
  assert(r.meta.bottomRing.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '下底圈各点 z=0、恒垂直法向');
  assert(r.meta.topRing.every((p) => approx(dot(sub(p, [0, 0, 3]), [0, 0, 1]), 0)), '上底圈各点 z=3、恒垂直法向');
  assert(approx(r.meta.axialHeight, 3), '轴向高 3');
  assert(approx(r.meta.slantHeight, Math.sqrt(9 + 1)), '侧母线长 √(3²+(2−1)²)=√10');
  assert(r.meta.slantMaxDeviation === 0, '正圆台各侧母线等长（偏差 0）');
  // 锥顶 S = base + shift·rb/(rb−rt) = [0,0,3]·2 = [0,0,6]，落在 axis 轴上
  assert(vecApprox(r.meta.apex, [0, 0, 6]), '锥顶落在 axis 轴上 z=6');
  assert(approx(r.meta.apexRatio, 2), '锥顶比例 rb/(rb−rt)=2');
  assert(r.meta.apexCollinearMaxDev === 0, '上下底圈各点与锥顶共线（偏差 0）');
  assert(vecApprox(r.meta.top, [0, 0, 3]) && vecApprox(r.meta.shift, [0, 0, 3]), '默认上底圆心=base+height·axis');
  // 上下底圈同一角度点 + 锥顶共线验证
  const P = r.meta.bottomRing[0], Q = r.meta.topRing[0], S = r.meta.apex;
  assert(len(cross(sub(Q, P), sub(S, P))) < 2e-3, '单点 P/Q/S 共线');
}

section('六、倒圆台（上大下小）');
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', radiusBottom: 1, radiusTop: 2, height: 3, segments: 8 });
  assert(r.ok && r.meta.isRight && r.meta.degenerate === 'frustum', '倒圆台解析成功');
  assert(approx(r.meta.slantHeight, Math.sqrt(10)) && r.meta.slantMaxDeviation === 0, '倒圆台侧母线等长 √10');
  assert(r.meta.apex[2] === -3, '倒圆台锥顶在下底下方 z=−3（rb/(rb−rt)=−1）');
  assert(r.meta.apexCollinearMaxDev === 0, '倒圆台各点与锥顶共线');
}

section('七、斜圆台解析与守恒');
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', radiusBottom: 2, radiusTop: 1, top: [1.5, 0, 3], segments: 8 });
  assert(r.ok && r.meta.isRight === false, '斜圆台解析成功且 isRight=false');
  assert(r.meta.topExplicit === true && vecApprox(r.meta.top, [1.5, 0, 3]), '显式 top 保留');
  assert(r.meta.slantMaxDeviation > 0.1, '斜圆台侧母线变长（偏差 > 0.1）');
  assert(vecApprox(r.meta.apex, [3, 0, 6]), '斜圆台锥顶偏离 axis 轴线');
  assert(r.meta.apexCollinearMaxDev !== null && r.meta.apexCollinearMaxDev < 2e-3, '斜圆台各点与锥顶仍共线');
  assert(r.meta.bottomRing.every((p) => approx(dot(sub(p, [0, 0, 0]), [0, 0, 1]), 0)), '斜圆台下底仍垂直 axis');
  assert(r.meta.topRing.every((p) => approx(dot(sub(p, [1.5, 0, 3]), [0, 0, 1]), 0)), '斜圆台上底仍垂直 axis（真圆）');
}

section('八、退化：圆锥 / 圆柱');
{
  const c = resolveConefrustum3D({ op: 'conefrustum3d', radiusTop: 0, segments: 6 });
  assert(c.ok && c.meta.degenerate === 'cone', 'radiusTop=0 退化为圆锥');
  assert(c.meta.topRing.every((p) => vecApprox(p, c.meta.top)), '退化圆锥上底圈收缩为一点');
  assert(vecApprox(c.meta.apex, c.meta.top), '退化圆锥锥顶=上底圆心');
  const cy = resolveConefrustum3D({ op: 'conefrustum3d', radiusBottom: 2, radiusTop: 2, segments: 6 });
  assert(cy.ok && cy.meta.degenerate === 'cylinder', 'radiusTop=radiusBottom 退化为圆柱');
  assert(cy.meta.apex === null && cy.meta.apexRatio === null, '退化圆柱无有限锥顶');
  assert(cy.meta.slantMaxDeviation === 0, '退化圆柱侧母线等长');
}

section('九、开关 / 点球 / 标注 / 样式');
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', segments: 10, asPoints: true, labelVertices: true, color: '#ff0000', labelColor: '#00ff00', opacity: 0.6, vertexSize: 0.2 });
  // 线 30（下底10+上底10+侧母线10）+ 点 22（2 圆心+20 圈点）+ 标注 22 = 74
  assert(r.ok && r.items.length === 74, '默认线+点+标注：30 线 + 22 点 + 22 标注 = 74');
}
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', segments: 10, asBase: false, asTop: false, asSides: false, asPoints: true, labelVertices: true });
  assert(r.ok && r.items.length === 44, '全关线、仅开点+标注：22 点 + 22 标注 = 44');
  assert(r.items.filter((it) => it.type === 'point').length === 22 && r.items.filter((it) => it.type === 'label').length === 22, '22 点 + 22 标注');
  const labels = r.items.filter((it) => it.type === 'label').map((it) => it.text);
  assert(labels.includes('O') && labels.includes("O'") && labels.includes('A') && labels.includes("A'") && labels.includes('E') && labels.includes("E'"), '圆心 O/O\' 与下底 A..E、上底 A\'..E\' 标注');
}
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', segments: 4, color: '#ff0000', labelColor: '#00ff00', opacity: 0.6, vertexSize: 0.2, asPoints: true, labelVertices: true });
  assert(r.items.filter((it) => it.type === 'line').every((it) => it.color === '#ff0000'), '线红色');
  assert(r.items.find((it) => it.type === 'label').color === '#00ff00', '标注绿色');
  assert(r.items.find((it) => it.type === 'point').p.s === 0.2 && approx(r.items[0].opacity, 0.6), '顶点球半径与透明度');
}

section('十、数字字符串 / id 避让 / 只读');
{
  const r = resolveConefrustum3D({ op: 'conefrustum3d', radiusBottom: '2', radiusTop: '1', height: '3', segments: '8' });
  assert(r.ok && r.meta.radiusBottom === 2 && r.meta.radiusTop === 1 && r.meta.height === 3 && r.meta.segments === 8, '数字字符串参数被接受');
}
{
  const state = { objects: [{ id: 'cfm_b1' }, { id: 'cfm_b1_2' }] };
  const r = resolveConefrustum3D({ op: 'conefrustum3d', segments: 3 }, state);
  const ids = r.items.map((it) => it.id);
  assert(r.ok && new Set(ids).size === ids.length && !ids.includes('cfm_b1') && !ids.includes('cfm_b1_2'), 'id 与 state 冲突时避让且无重复');
}
{
  const longId = 'x'.repeat(64);
  const r = resolveConefrustum3D({ op: 'conefrustum3d', id: longId, segments: 3 }, { objects: [{ id: longId }] });
  assert(r.ok && r.items.every((it) => it.id.length <= 64), '超长 id 冲突避让后 ≤64 且不死循环');
}
{
  const cmd = Object.freeze({ op: 'conefrustum3d', base: Object.freeze([0, 0, 0]), top: Object.freeze([1, 0, 3]) });
  const state = Object.freeze({ objects: Object.freeze([]) });
  let threw = false;
  try { const r = resolveConefrustum3D(cmd, state); assert(r.ok, '冻结入参仍解析成功'); } catch (_) { threw = true; }
  assert(!threw, '冻结入参不抛错');
}

section('十一、脏输入原子拒绝');
{
  const bad = [
    [null, '命令为空'],
    [[], '命令为数组'],
    [{ op: 'conefrustum3d', id: 'bad id' }, 'id 含空格'],
    [{ op: 'conefrustum3d', id: '!@#' }, 'id 非法字符'],
    [{ op: 'conefrustum3d', base: [0, 0] }, 'base 非3维'],
    [{ op: 'conefrustum3d', base: [0, 'x', 0] }, 'base 非数值'],
    [{ op: 'conefrustum3d', axis: 'q' }, 'axis 非法字母'],
    [{ op: 'conefrustum3d', axis: [0, 0, 0] }, 'axis 零向量'],
    [{ op: 'conefrustum3d', radiusBottom: 0 }, '下底半径 0'],
    [{ op: 'conefrustum3d', radiusBottom: -1 }, '下底半径负'],
    [{ op: 'conefrustum3d', radiusBottom: 10001 }, '下底半径越界'],
    [{ op: 'conefrustum3d', radiusTop: -0.1 }, '上底半径负'],
    [{ op: 'conefrustum3d', radiusTop: 10001 }, '上底半径越界'],
    [{ op: 'conefrustum3d', height: 0 }, '高度为 0'],
    [{ op: 'conefrustum3d', height: NaN }, '高度 NaN'],
    [{ op: 'conefrustum3d', top: [0, 0, 0] }, 'top 与 base 重合'],
    [{ op: 'conefrustum3d', segments: 2 }, 'segments 过小'],
    [{ op: 'conefrustum3d', segments: 65 }, 'segments 过大'],
    [{ op: 'conefrustum3d', segments: 3.5 }, 'segments 非整数'],
    [{ op: 'conefrustum3d', asBase: 'yes' }, '开关非布尔'],
    [{ op: 'conefrustum3d', asBase: false, asTop: false, asSides: false }, '五开关全关'],
    [{ op: 'conefrustum3d', vertexSize: 0 }, 'vertexSize 0'],
    [{ op: 'conefrustum3d', vertexSize: 2 }, 'vertexSize 越界'],
    [{ op: 'conefrustum3d', opacity: 'abc' }, 'opacity 非法'],
  ];
  for (const [cmd, label] of bad) {
    const r = resolveConefrustum3D(cmd, {});
    assert(r.ok === false && typeof r.error === 'string', `${label} 原子拒绝`);
  }
}

// ---------------------------------------------------------------------------
section('十二、执行器常量与历史契约');
assert(BOARD3D_OPS.length === 7 && BOARD3D_ALL_OPS.length === 8 && BOARD3D_FULL_OPS.length === 9, '历史契约 BOARD3D_OPS/ALL/FULL 条数不变');
assert([10, 11, 12, 13, 14, 15, 16, 17, 18].every((want, i) => {
  const c = [BOARD3D_COMPLETE_OPS, BOARD3D_COMPLETE2_OPS, BOARD3D_COMPLETE3_OPS, BOARD3D_COMPLETE4_OPS, BOARD3D_COMPLETE5_OPS, BOARD3D_COMPLETE6_OPS, BOARD3D_COMPLETE7_OPS, BOARD3D_COMPLETE8_OPS, BOARD3D_COMPLETE9_OPS][i];
  return c.length === want;
}), '历史 COMPLETE~COMPLETE9 长度逐项不变');
assert([19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].every((want, i) => {
  const c = [BOARD3D_COMPLETE10_OPS, BOARD3D_COMPLETE11_OPS, BOARD3D_COMPLETE12_OPS, BOARD3D_COMPLETE13_OPS, BOARD3D_COMPLETE14_OPS, BOARD3D_COMPLETE15_OPS, BOARD3D_COMPLETE16_OPS, BOARD3D_COMPLETE17_OPS, BOARD3D_COMPLETE18_OPS, BOARD3D_COMPLETE19_OPS, BOARD3D_COMPLETE20_OPS, BOARD3D_COMPLETE21_OPS][i];
  return c.length === want;
}), 'COMPLETE10~COMPLETE21 长度逐项不变');
assert(BOARD3D_CONEFRUSTUM_OPS.length === 1 && BOARD3D_CONEFRUSTUM_OPS[0] === 'conefrustum3d' && BOARD3D_COMPLETE22_OPS.length === 31, '新增 CONEFRUSTUM_OPS(1) 与 COMPLETE22(31)');
assert(BOARD3D_COMPLETE22_OPS.includes('conefrustum3d') && BOARD3D_COMPLETE22_OPS.includes('plane3d') && BOARD3D_COMPLETE22_OPS.includes('cylinder3d'), 'COMPLETE22 含 conefrustum3d 且保留 plane3d/cylinder3d');
assert(!BOARD3D_OPS.includes('conefrustum3d') && !BOARD3D_ALL_OPS.includes('conefrustum3d') && !BOARD3D_FULL_OPS.includes('conefrustum3d'), 'conefrustum3d 未污染任何历史契约常量');

section('十三、执行器集成');
{
  const added = [];
  const api = {
    add: (o) => { added.push(o); return true; },
    remove: () => true, update: () => true, getState: () => ({ objects: [] }),
  };
  const res = applyBoard3DCommands([{ op: 'conefrustum3d', id: 'c', segments: 4, asPoints: true }], api);
  assert(res.length === 1 && res[0].op === 'conefrustum3d' && res[0].ok === true, 'conefrustum3d 执行成功');
  // 4 段 ×(下底圈+上底圈+侧母线)=12 线；点=2 圆心+4 下底+4 上底=10 → 共 22
  assert(added.length === 22 && res[0].count === 22, '逐项落地 22 个对象（12 线 + 10 点）');
  assert(res[0].created.length === 22 && res[0].meta.isRight === true, 'created 与 meta 回报完整');
}
{
  const res = applyBoard3DCommands([{ op: 'conefrustum3d', radiusBottom: 0 }], { add: () => true, getState: () => ({}) });
  assert(res.length === 1 && res[0].ok === false && /radiusBottom/.test(res[0].error), '执行器层级拒绝非法参数');
}
{
  const api = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res = applyBoard3DCommands([{ op: 'conefrustum3d' }], api);
  assert(res[0].ok === true, 'getState 抛错降级为空场景，整批不中断');
}
{
  let i = 0;
  const api = { add: () => (++i === 2 ? false : true), getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'conefrustum3d', segments: 4 }], api);
  assert(res[0].ok === false && res[0].failed && res[0].failed.length === 1 && res[0].created.length === 11, 'api.add 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({ objects: [{ id: 'cfm_b1' }] }) };
  const res = applyBoard3DCommands([{ op: 'conefrustum3d', segments: 3 }], api);
  assert(res[0].ok === true && !res[0].failed, '执行器 id 冲突自动避让，不失败');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'conefrustum3d', radiusBottom: 2, radiusTop: 1, height: 3, segments: 6 }, { op: 'label', text: 'S' }], api);
  assert(res.length === 2 && res[0].ok === true && res[1].ok === false, 'conefrustum3d 与 2D 命令混排：3D 成功、2D 被默认拒绝');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const res = applyBoard3DCommands([{ op: 'cylinder', rt: 1, rb: 2, h: 3 }], api);
  assert(res.length === 1 && res[0].ok === false && /不支持/.test(res[0].error), '2D/内置 cylinder 命令在 3D 分支被 default 拒绝');
}

section('十四、共享文件协议与 3D 意图检测');
assert(frozen(BOARD3D_CONEFRUSTUM_PROMPT_OPS) && BOARD3D_CONEFRUSTUM_PROMPT_OPS[0] === 'conefrustum3d', 'board-prompt 新增 CONEFRUSTUM_PROMPT_OPS');
assert(BOARD3D_CONEFRUSTUM_PROMPT.includes('conefrustum3d') && BOARD3D_CONEFRUSTUM_PROMPT.includes('斜圆台'), 'board-prompt CONEFRUSTUM_PROMPT 含命令与斜圆台说明');
assert(BOARD3D_CONEFRUSTUM_PROMPT.includes('radiusBottom') && BOARD3D_CONEFRUSTUM_PROMPT.includes('radiusTop'), '提示词含上下底半径参数');
assert(resolveBoardMode({ mode: '3d' }, '画个正方体') === '3d', '显式 3d 模式直选');
assert(resolveBoardMode({}, '画个正方体') === '2d', '默认 2D 不误伤');
assert(resolveBoardMode({ detect3d: true }, '画一个圆柱') === '3d', '开启检测且命中立体意图切 3D');
assert(resolveBoardMode({ detect3d: true }, '画个函数图像') === '2d', '开启检测但 2D 意图仍留 2D');

section('十五、协作铁律与硬约束静态复核');
{
  const exec = read('js/board3d-executor.js');
  assert(/import \{ resolveConefrustum3D \} from '\.\/board3d-conefrustum\.js'/.test(exec), '执行器 import 新模块');
  assert(/case 'conefrustum3d'/.test(exec), '执行器含 case conefrustum3d');
  const bp = read('ai/board-prompt.js');
  assert(bp.includes('BOARD3D_CONEFRUSTUM_PROMPT') && bp.includes('BOARD3D_PLANE_PROMPT') && bp.includes('BOARD3D_CYLINDER_PROMPT'), '共享文件含 CONEFRUSTUM_PROMPT 段且保留 PLANE/CYLINDER（纯追加）');
  // 最高优先级：共享文件必须字节级纯追加，上方任何内容（含 2D 主干与既有 3D 段）逐字不动
  const oldBp = readHead('ai/board-prompt.js');
  assert(bp.startsWith(oldBp), `ai/board-prompt.js 字节级纯追加（旧 ${oldBp.length} 字节为新前缀，未覆盖 2D 主干或既有 3D 段）`);
  const be = read('ai/board-backend.js');
  assert(be.includes('BOARD3D_CONEFRUSTUM_PROMPT') && be.includes('BOARD3D_PLANE_PROMPT') && be.includes('BOARD3D_CYLINDER_PROMPT'), 'backend 拼接串含 conefrustum 且保留 plane/cylinder');
  const ai3 = read('js/board3d-ai.js');
  assert(ai3.includes('conefrustum3d') && ai3.includes('plane3d'), 'AI 面板结果展示含 conefrustum3d 且保留 plane3d');
  const html = read('board3d.html');
  assert(html.includes('conefrustum3d') && html.includes('plane3d') && html.includes('cylinder3d'), 'board3d.html AI tip 含 conefrustum3d 且保留 plane3d/cylinder3d');
  const doc = read('docs/3D画板回归用例清单.md');
  assert(doc.includes('D31') && doc.includes('conefrustum3d'), '回归清单含 D31 记录');
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

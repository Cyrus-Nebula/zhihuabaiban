/**
 * 3D 两空间直线夹角命令（lineangle3d · D36）无头回归。
 *
 * 覆盖：lineangleCore / resolveLineangle3D 纯函数
 *       （默认相交 45°、锐角约定、异面线夹角、相交顶点、平行/共线退化、
 *        弧半径与射线长度守恒、直角符号、开关组合、样式、id 避让与 64 字符边界、
 *        脏输入原子拒绝、深度只读性）、
 *       执行器集成（逐项落地、id 冲突分项、getState 缺失 / 抛错降级、
 *       api 部分失败分项、2D 隔离、历史契约长度）、
 *       共享文件协议两侧一致性、3D 意图分支、协作铁律与硬约束静态复核。
 *
 * 运行：node tests/board3d_lineangle.mjs
 */
import {
  BOARD3D_LINE_ANGLE_PROMPT, BOARD3D_LINE_ANGLE_PROMPT_OPS,
  isLineangle3DIntent,
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
  BOARD3D_CONEFRUSTUM_OPS, BOARD3D_COMPLETE22_OPS, BOARD3D_DIHEDRAL_OPS, BOARD3D_COMPLETE23_OPS,
  BOARD3D_LINEPLANE_OPS, BOARD3D_COMPLETE24_OPS, BOARD3D_POINT_PLANE_OPS, BOARD3D_COMPLETE25_OPS,
  BOARD3D_SKEWLINE_OPS, BOARD3D_COMPLETE26_OPS, BOARD3D_LINE_ANGLE_OPS, BOARD3D_COMPLETE27_OPS,
} from '../js/board3d-executor.js';
import {
  LINEANGLE3D_EXTEND_MIN, LINEANGLE3D_EXTEND_MAX, LINEANGLE3D_EXTEND_DEFAULT,
  LINEANGLE3D_RAY_LENGTH_MIN, LINEANGLE3D_RAY_LENGTH_MAX, LINEANGLE3D_RAY_LENGTH_DEFAULT,
  LINEANGLE3D_ARC_RADIUS_MIN, LINEANGLE3D_ARC_RADIUS_MAX, LINEANGLE3D_ARC_RADIUS_DEFAULT,
  LINEANGLE3D_SEGMENTS_MIN, LINEANGLE3D_SEGMENTS_MAX, LINEANGLE3D_SEGMENTS_DEFAULT,
  LINEANGLE3D_RIGHT_ANGLE_MIN, LINEANGLE3D_RIGHT_ANGLE_MAX, LINEANGLE3D_RIGHT_ANGLE_DEFAULT,
  LINEANGLE3D_VERTEX_SIZE_MIN, LINEANGLE3D_VERTEX_SIZE_MAX, LINEANGLE3D_VERTEX_SIZE_DEFAULT,
  LINEANGLE3D_MAX_SEGMENTS, LINEANGLE3D_DEFAULT_FROM1, LINEANGLE3D_DEFAULT_TO2,
  num, lineangleCore, resolveLineangle3D,
} from '../js/board3d-lineangle.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readHead = (p) => execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }
const approx = (a, b, eps = 2e-3) => Math.abs(a - b) <= eps;
const vecApprox = (a, b, eps = 2e-3) => Array.isArray(a) && a.length === 3 && b.length === 3 && a.every((x, i) => approx(x, b[i], eps));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));
const frozen = (o) => Object.isFrozen(o);
const DEFAULT = { from1: [0, 0, 0], to1: [2, 0, 0], from2: [0, 0, 0], to2: [1, 1, 0] };
const RIGHT = { from1: [-2, 0, 0], to1: [2, 0, 0], from2: [0, -2, 0], to2: [0, 2, 0] };

section('一、常量与历史契约零回归');
assert(BOARD3D_OPS.length === 7 && BOARD3D_MEASURE_OPS.length === 1 && BOARD3D_ALL_OPS.length === 8, 'BOARD3D_OPS 7 / MEASURE 1 / ALL 8');
assert(BOARD3D_TRANSFORM_OPS.length === 1 && BOARD3D_FULL_OPS.length === 9 && BOARD3D_DUPLICATE_OPS.length === 1 && BOARD3D_COMPLETE_OPS.length === 10, 'FULL 9 / COMPLETE 10');
assert(BOARD3D_RADIAL_OPS.length === 1 && BOARD3D_COMPLETE2_OPS.length === 11 && BOARD3D_MIRROR_OPS.length === 1 && BOARD3D_COMPLETE3_OPS.length === 12, 'COMPLETE2 11 / COMPLETE3 12');
assert(BOARD3D_GRID_OPS.length === 1 && BOARD3D_COMPLETE4_OPS.length === 13 && BOARD3D_ALIGN_OPS.length === 1 && BOARD3D_COMPLETE5_OPS.length === 14, 'COMPLETE4 13 / COMPLETE5 14');
assert(BOARD3D_HELIX_OPS.length === 1 && BOARD3D_COMPLETE6_OPS.length === 15 && BOARD3D_BEZIER_OPS.length === 1 && BOARD3D_COMPLETE7_OPS.length === 16, 'COMPLETE6 15 / COMPLETE7 16');
assert(BOARD3D_ARC_OPS.length === 1 && BOARD3D_COMPLETE8_OPS.length === 17 && BOARD3D_POLYHEDRON_OPS.length === 1 && BOARD3D_COMPLETE9_OPS.length === 18, 'COMPLETE8 17 / COMPLETE9 18');
assert(BOARD3D_REVOLVE_OPS.length === 1 && BOARD3D_COMPLETE10_OPS.length === 19 && BOARD3D_TORUS_OPS.length === 1 && BOARD3D_COMPLETE11_OPS.length === 20, 'COMPLETE10 19 / COMPLETE11 20');
assert(BOARD3D_ELLIPSOID_OPS.length === 1 && BOARD3D_COMPLETE12_OPS.length === 21 && BOARD3D_CAPSULE_OPS.length === 1 && BOARD3D_COMPLETE13_OPS.length === 22, 'COMPLETE12 21 / COMPLETE13 22');
assert(BOARD3D_TUBE_OPS.length === 1 && BOARD3D_COMPLETE14_OPS.length === 23 && BOARD3D_PRISM_OPS.length === 1 && BOARD3D_COMPLETE15_OPS.length === 24, 'COMPLETE14 23 / COMPLETE15 24');
assert(BOARD3D_PYRAMID_OPS.length === 1 && BOARD3D_COMPLETE16_OPS.length === 25 && BOARD3D_FRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE17_OPS.length === 26, 'COMPLETE16 25 / COMPLETE17 26');
assert(BOARD3D_VECTOR_OPS.length === 1 && BOARD3D_COMPLETE18_OPS.length === 27 && BOARD3D_CONE_OPS.length === 1 && BOARD3D_COMPLETE19_OPS.length === 28, 'COMPLETE18 27 / COMPLETE19 28');
assert(BOARD3D_CYLINDER_OPS.length === 1 && BOARD3D_COMPLETE20_OPS.length === 29 && BOARD3D_PLANE_OPS.length === 1 && BOARD3D_COMPLETE21_OPS.length === 30, 'COMPLETE20 29 / COMPLETE21 30');
assert(BOARD3D_CONEFRUSTUM_OPS.length === 1 && BOARD3D_COMPLETE22_OPS.length === 31 && BOARD3D_DIHEDRAL_OPS.length === 1 && BOARD3D_COMPLETE23_OPS.length === 32, 'COMPLETE22 31 / COMPLETE23 32');
assert(BOARD3D_LINEPLANE_OPS.length === 1 && BOARD3D_COMPLETE24_OPS.length === 33 && BOARD3D_POINT_PLANE_OPS.length === 1 && BOARD3D_COMPLETE25_OPS.length === 34, 'COMPLETE24 33 / COMPLETE25 34');
assert(BOARD3D_SKEWLINE_OPS.length === 1 && BOARD3D_COMPLETE26_OPS.length === 35, 'COMPLETE26 35');
assert(BOARD3D_LINE_ANGLE_OPS.length === 1 && BOARD3D_LINE_ANGLE_OPS[0] === 'lineangle3d' && BOARD3D_COMPLETE27_OPS.length === 36, 'LINE_ANGLE 1 / COMPLETE27 36');
assert(frozen(BOARD3D_LINE_ANGLE_OPS) && frozen(BOARD3D_COMPLETE27_OPS) && BOARD3D_COMPLETE27_OPS.includes('skewline3d'), '扩展集冻结且含历史命令');
assert(LINEANGLE3D_EXTEND_MIN === 0 && LINEANGLE3D_EXTEND_MAX === 1000 && LINEANGLE3D_EXTEND_DEFAULT === 0, 'extend 常量');
assert(LINEANGLE3D_RAY_LENGTH_MIN === 0.05 && LINEANGLE3D_RAY_LENGTH_MAX === 100 && LINEANGLE3D_RAY_LENGTH_DEFAULT === 1, 'rayLength 常量');
assert(LINEANGLE3D_ARC_RADIUS_MIN === 0.05 && LINEANGLE3D_ARC_RADIUS_MAX === 100 && LINEANGLE3D_ARC_RADIUS_DEFAULT === 0.5, 'arcRadius 常量');
assert(LINEANGLE3D_SEGMENTS_MIN === 3 && LINEANGLE3D_SEGMENTS_MAX === 64 && LINEANGLE3D_SEGMENTS_DEFAULT === 24, 'segments 常量');
assert(LINEANGLE3D_RIGHT_ANGLE_MIN === 0.05 && LINEANGLE3D_RIGHT_ANGLE_MAX === 100 && LINEANGLE3D_RIGHT_ANGLE_DEFAULT === 0.25, 'rightAngleSize 常量');
assert(LINEANGLE3D_VERTEX_SIZE_MIN === 0.01 && LINEANGLE3D_VERTEX_SIZE_MAX === 1 && LINEANGLE3D_VERTEX_SIZE_DEFAULT === 0.1, 'vertexSize 常量');
assert(LINEANGLE3D_MAX_SEGMENTS === 4096 && frozen(LINEANGLE3D_DEFAULT_FROM1) && frozen(LINEANGLE3D_DEFAULT_TO2), '上限与默认点冻结');
assert(num('1.5') === 1.5 && num(0) === 0 && num('') === null && num(null) === null && num(NaN) === null && num([]) === null, 'num 严格数值解析');

section('二、lineangleCore 几何守恒');
{
  const c = lineangleCore(DEFAULT.from1, DEFAULT.to1, DEFAULT.from2, DEFAULT.to2);
  assert(c.ok && c.kind === 'intersect' && c.intersects, '默认相交直线 kind=intersect');
  assert(approx(c.angleDeg, 45) && !c.flipped, '默认夹角 45°');
  assert(vecApprox(c.origin, [0, 0, 0]) && vecApprox(c.unitU, [1, 0, 0]), '默认顶点与 L1 单位方向');
  assert(vecApprox(c.copyDir, [Math.SQRT1_2, Math.SQRT1_2, 0]), '辅助线方向取 L2 正向');
  assert(approx(norm(c.unitU), 1) && approx(norm(c.unitV), 1) && approx(norm(c.copyDir), 1) && approx(norm(c.arcNormal), 1), '四个方向向量均为单位向量');
  assert(approx(dot(c.unitU, c.copyDir), Math.cos(Math.PI / 4)) && dot(c.unitU, c.copyDir) >= 0, 'cosθ 非负（锐角约定）');
  assert(approx(dot(c.arcNormal, c.unitU), 0) && approx(dot(c.arcNormal, c.copyDir), 0), '弧平面法向垂直两条射线');
  assert([c.origin, c.unitU, c.unitV, c.copyDir, c.arcNormal, c.rawU, c.rawV].every((v) => Array.isArray(v) && v.every(Number.isFinite)), '核心返回向量结构完整且有限');
}
{
  const a = lineangleCore(DEFAULT.from1, DEFAULT.to1, DEFAULT.from2, DEFAULT.to2);
  const b = lineangleCore(DEFAULT.from1, DEFAULT.to1, DEFAULT.to2, DEFAULT.from2);
  assert(a.ok && b.ok && b.flipped && approx(a.angleDeg, b.angleDeg), '反向取点触发翻转但锐角不变');
  assert(vecApprox(a.copyDir, b.copyDir) && vecApprox(a.arcNormal, b.arcNormal), '反向取点辅助线与弧平面一致');
}
{
  const c = lineangleCore(RIGHT.from1, RIGHT.to1, RIGHT.from2, RIGHT.to2);
  assert(c.ok && approx(c.angleDeg, 90) && c.intersects && vecApprox(c.origin, [0, 0, 0]), '正交直线 90° 且交点在原点');
}
{
  // 异面：x 轴与过 y=1 的 (1,0,1) 向直线，方向夹角 45°、两线距离 1。
  const c = lineangleCore([0, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 2]);
  assert(c.ok && c.kind === 'skew' && !c.intersects && approx(c.angleDeg, 45), '异面直线按方向求 45°');
  assert(vecApprox(c.origin, [0, 0, 0]), '异面时取 L1 上的 from1 作顶点');
  const shifted = lineangleCore([0, 0, 0], [2, 0, 0], [0, 1, -5], [2, 1, -3]);
  assert(approx(c.angleDeg, shifted.angleDeg), '沿 L2 平移不改变夹角');
}
{
  const c = lineangleCore([0, 0, 0], [4, 0, 0], [2, -2, 0], [2, 2, 0]);
  assert(c.ok && c.intersects && vecApprox(c.origin, [2, 0, 0]), '相交线顶点为真实交点');
}
{
  const c = lineangleCore([0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0]);
  assert(c.ok && c.kind === 'parallel' && approx(c.angleDeg, 0), '平行直线夹角 0°');
  assert(approx(norm(c.arcNormal), 1) && approx(dot(c.arcNormal, c.unitU), 0), '平行退化仍给合法弧平面法向');
  const col = lineangleCore([0, 0, 0], [2, 0, 0], [1, 0, 0], [3, 0, 0]);
  assert(col.ok && col.kind === 'collinear' && approx(col.angleDeg, 0), '共线直线夹角 0° 合法');
}
{
  const bad = [
    [[0, 0, 0], [0, 0, 0], [1, 1, 0], [1, 1, 2]],
    [[0, 0, 0], [2, 0, 0], [1, 1, 0], [1, 1, 0]],
    [null, [2, 0, 0], [1, 1, 0], [1, 1, 2]],
    [[0, 0], [2, 0, 0], [1, 1, 0], [1, 1, 2]],
    [[0, 0, Infinity], [2, 0, 0], [1, 1, 0], [1, 1, 2]],
  ];
  assert(bad.every((args) => lineangleCore(...args).ok === false), `几何核心拒绝退化点与非法点（${bad.length} 组）`);
}

section('三、resolveLineangle3D 命令解析与输出对象');
{
  const r = resolveLineangle3D({}, {});
  assert(r.ok && approx(r.meta.angleDeg, 45) && r.meta.kind === 'intersect', '最小命令默认出图 45°');
  assert(r.items.length === 30 && r.meta.segmentCount === 29 && r.meta.itemCount === 30, '默认输出 2+1+2+24 线段 + 1 角度标注 共 30 项');
  assert(r.items.filter((i) => i.type === 'line').length === 29 && r.items.filter((i) => i.type === 'label').length === 1, '默认对象类型正确');
  assert(r.items.every((i) => i.pos && i.rot && i.scale && i.color && typeof i.id === 'string'), '对象结构含完整姿态与样式字段');
  const line = r.items[0];
  assert(['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((k) => Number.isFinite(line.p[k])), '线段 p 六坐标有限');
  assert(r.items.filter((i) => i.type === 'label')[0].text === 'θ=45°', '角度读数文本正确');
  assert(!r.meta.rightAngleDrawn && r.meta.rightAngleCount === 0, '非直角不画直角符号');
}
{
  const r = resolveLineangle3D(RIGHT, {});
  assert(r.ok && approx(r.meta.angleDeg, 90) && r.meta.isRightAngle, '正交命令识别直角');
  assert(r.meta.rightAngleDrawn && r.meta.rightAngleCount === 2 && r.meta.arcCount === 24, '直角时额外画出 2 段直角符号');
  assert(r.items.length === 32 && r.meta.segmentCount === 31, '直角默认输出 32 项');
}
{
  const r = resolveLineangle3D({ ...RIGHT, extend: 2, rayLength: 2, arcRadius: 5, segments: 8, rightAngleSize: 0.5, asPoints: true, labelVertex: true, color: '#123456', labelColor: '#abcdef', opacity: 0.6 }, {});
  assert(r.ok && approx(r.meta.extend, 2) && approx(r.meta.rayLength, 2), 'extend / rayLength 生效');
  assert(approx(r.meta.arcRadius, 2) && approx(r.meta.arcRadiusInput, 5), 'arcRadius 超 rayLength 自动钳制');
  assert(r.meta.segments === 8 && approx(r.meta.rightAngleSize, 0.5), 'segments / rightAngleSize 生效');
  assert(r.meta.pointCount === 1 && r.meta.labelCount === 2 && r.items.length === 2 + 1 + 2 + 8 + 2 + 1 + 2, '全开计数正确');
  assert(r.items.every((i) => i.color === '#123456' || i.type === 'label' && i.color === '#abcdef'), '颜色样式生效');
  assert(r.items.every((i) => i.type !== 'line' || approx(i.opacity, 0.6)), '透明度生效');
  assert(r.items.filter((i) => i.type === 'point').every((i) => approx(i.p.s, 0.1)), '小球尺寸生效');
  const texts = r.items.filter((i) => i.type === 'label').map((i) => i.text);
  assert(texts.includes('θ=90°') && texts.includes('O'), '角度与顶点 O 标注');
  assert(vecApprox(r.meta.lineEnds[0], [-4, 0, 0]) && vecApprox(r.meta.lineEnds[1], [4, 0, 0]), 'extend 向两端延长');
}
{
  const r = resolveLineangle3D({}, {});
  const arc = r.meta.arcPoints;
  assert(Array.isArray(arc) && arc.length === 25, '弧采样点 segments+1 个');
  assert(arc.every((p) => approx(norm(sub(p, r.meta.origin)), r.meta.arcRadius, 3e-3)), '所有弧点到 O 等距 arcRadius');
  assert(vecApprox(sub(arc[0], r.meta.origin), [r.meta.arcRadius, 0, 0]), '弧首方向沿 eu');
  assert(vecApprox(sub(arc[24], r.meta.origin), [r.meta.arcRadius * Math.SQRT1_2, r.meta.arcRadius * Math.SQRT1_2, 0]), '弧末方向沿 copyDir');
  const chord = norm(sub(arc[1], arc[0]));
  assert(approx(chord, 2 * r.meta.arcRadius * Math.sin(Math.PI / 4 / 48), 3e-3), '相邻弧点弦长符合 θ/segments');
  assert(r.meta.rayEnds.every((p) => approx(norm(sub(p, r.meta.origin)), r.meta.rayLength, 3e-3)), '两条射线端点距 O 恒为 rayLength');
  const copyDir = sub(r.meta.copyEnds[1], r.meta.copyEnds[0]);
  assert(approx(norm(copyDir), 2 * r.meta.rayLength, 3e-3) && approx(Math.abs(dot(copyDir, r.meta.unitV)) / norm(copyDir), 1, 1e-3), '辅助线平行 L2 且长度 2·rayLength');
}
{
  const r = resolveLineangle3D(RIGHT, {});
  const [o, ra1, ra2] = r.meta.rightAngle;
  assert(approx(dot(sub(ra1, o), r.meta.unitU), r.meta.rightAngleSize, 3e-3), '直角符号第一边 ∥ eu');
  assert(approx(dot(sub(ra2, ra1), r.meta.copyDir), r.meta.rightAngleSize, 3e-3), '直角符号第二边 ∥ copyDir');
  assert(approx(dot(sub(ra1, o), sub(ra2, ra1)), 0, 3e-3), '直角符号两边互相垂直');
}
{
  const skew = resolveLineangle3D({ from1: [0, 0, 0], to1: [2, 0, 0], from2: [0, 1, 0], to2: [2, 1, 2] }, {});
  assert(skew.ok && skew.meta.kind === 'skew' && approx(skew.meta.angleDeg, 45), '异面命令保留 kind 与夹角');
  assert(vecApprox(skew.meta.origin, [0, 0, 0]) && skew.items.length === 30, '异面命令仍输出完整标准作图');
  const parallel = resolveLineangle3D({ from1: [0, 0, 0], to1: [2, 0, 0], from2: [0, 2, 0], to2: [2, 2, 0] }, {});
  assert(parallel.ok && parallel.meta.kind === 'parallel' && approx(parallel.meta.angleDeg, 0), '平行命令 θ=0°');
  assert(parallel.meta.arcCount === 0 && parallel.items.length === 6, 'θ=0 不画弧（2+1+2 线段 + 1 标注）');
}
{
  const s = resolveLineangle3D({ from1: ['0', '0', '0'], to1: ['2', '0', '0'], from2: ['0', '0', '0'], to2: ['1', '1', '0'], extend: '1', rayLength: '2', arcRadius: '0.3', segments: '12', rightAngleSize: '0.3', vertexSize: '0.2', opacity: '0.8', asPoints: true }, {});
  assert(s.ok && approx(s.meta.extend, 1) && approx(s.meta.rayLength, 2) && approx(s.meta.arcRadius, 0.3) && s.meta.segments === 12, '数字字符串容错');
  assert(approx(s.meta.rightAngleSize, 0.3) && approx(s.meta.vertexSize, 0.2) && approx(s.meta.opacity, 0.8), '其余数字参数字符串容错');
}
{
  const state = { objects: [{ id: 'lang_l1' }, { id: 'lang_l1_2' }, { id: 'lang_arc0' }] };
  const r = resolveLineangle3D({ id: 'lang' }, state);
  const ids = r.items.map((i) => i.id);
  assert(new Set(ids).size === ids.length && !ids.some((id) => state.objects.some((o) => o.id === id)), 'id 避让冲突');
  assert(ids.includes('lang_l1_3') && ids.includes('lang_arc0_2'), '冲突 id 依次加后缀');
  const long = resolveLineangle3D({ id: 'x'.repeat(64) }, { objects: [] });
  assert(long.ok && long.items.every((i) => i.id.length <= 64), 'id 64 字符边界收敛');
}
{
  const cmd = Object.freeze({ ...DEFAULT, asPoints: true, labelVertex: true });
  const snap = JSON.stringify(cmd);
  const st = Object.freeze({ objects: Object.freeze([Object.freeze({ id: 'lang_l1' })]) });
  const r = resolveLineangle3D(cmd, st);
  assert(r.ok && JSON.stringify(cmd) === snap, '冻结 cmd 深度只读');
  assert(JSON.stringify(st) === '{"objects":[{"id":"lang_l1"}]}', '冻结 state 深度只读');
  assert(r !== cmd && r.items !== cmd.items, '输出全新对象、无入参引用泄漏');
}
{
  const bad = [
    null, [], 'x',
    { id: 123 }, { id: 'a b' }, { id: '' },
    { from1: null }, { to1: [1, 2] }, { from2: [0, 0, 'x'] }, { to2: {} },
    { from1: [0, 0, 0], to1: [0, 0, 0] },
    { extend: 'x' }, { extend: -1 }, { extend: 1001 }, { extend: NaN },
    { rayLength: 0 }, { rayLength: 101 }, { rayLength: 'x' },
    { arcRadius: 0.01 }, { arcRadius: 101 }, { arcRadius: false },
    { segments: 2 }, { segments: 65 }, { segments: 12.5 }, { segments: 'x' },
    { rightAngleSize: 0 }, { rightAngleSize: 101 }, { rightAngleSize: 'x' },
    { vertexSize: 0 }, { vertexSize: 2 }, { vertexSize: false },
    { opacity: 'x' }, { opacity: [] },
    { asLines: 'yes' }, { asCopy: 1 }, { asRays: null }, { asArc: 'true' },
    { asRightAngle: 0 }, { asPoints: 'true' }, { labelAngle: 1 }, { labelVertex: 'no' },
    { asLines: false, asCopy: false, asRays: false, asArc: false, asRightAngle: false, asPoints: false, labelAngle: false, labelVertex: false },
  ];
  assert(bad.every((c) => resolveLineangle3D(c, {}).ok === false), `脏输入原子拒绝（${bad.length} 组）`);
  assert(resolveLineangle3D({ ...DEFAULT, from1: [0, 0, 0], to1: [0, 0, 0] }, { objects: [] }).ok === false, '方向退化整条拒绝、零副作用');
}

section('四、执行器集成（与 2D 执行器隔离）');
{
  const created = [];
  const api = { add: (o) => { created.push(o); return true; }, getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'lineangle3d', id: 'lang', labelVertex: true, asPoints: true }], api);
  assert(res.length === 1 && res[0].ok && res[0].op === 'lineangle3d' && res[0].count === 32, '执行器返回成功与项数');
  assert(created.length === 32 && created.every((o) => o.type === 'line' || o.type === 'point' || o.type === 'label'), '32 项全部落地为 3D 对象');
  assert(res[0].meta.kind === 'intersect' && approx(res[0].meta.angleDeg, 45), 'meta 透传类型与角度');
}
{
  const added = [];
  const api = { add: (o) => { added.push(o); return true; }, getState: () => ({ objects: [{ id: 'lang_l1' }, { id: 'lang_arc0' }] }) };
  const res = applyBoard3DCommands([{ op: 'lineangle3d', id: 'lang' }, { op: 'lineangle3d', id: 'lang' }], api);
  assert(res[0].ok && res[1].ok === false && res[1].failed && res[1].failed.length === 30, '同批 id 冲突分项失败，第二条整批回报 ok=false');
  assert(added.length === 30, '冲突项不落地，仅第一条 30 项正常落地');
  assert(res[0].created.every((c) => !['lang_l1', 'lang_arc0'].includes(c.id)), '语义层已避让场景原有 id');
}
{
  const api = { add: () => true };
  const res = applyBoard3DCommands([{ op: 'lineangle3d' }], api);
  assert(res[0].ok && res[0].count === 30, 'getState 缺失降级为空场景');
  const api2 = { add: () => true, getState: () => { throw new Error('boom'); } };
  const res2 = applyBoard3DCommands([{ op: 'lineangle3d' }], api2);
  assert(res2[0].ok && res2[0].count === 30, 'getState 抛错降级为空场景');
}
{
  let n = 0;
  const api = { add: () => (++n === 1 ? false : true), getState: () => ({ objects: [] }) };
  const res = applyBoard3DCommands([{ op: 'lineangle3d' }], api);
  assert(res[0].ok === false && res[0].failed.length === 1 && res[0].created.length === 29, 'api 部分失败分项回报');
}
{
  const api = { add: () => true, getState: () => ({}) };
  const minimal = { op: 'lineangle3d', asLines: false, asCopy: false, asRays: false, asArc: false, asRightAngle: false, asPoints: false, labelVertex: false };
  const res = applyBoard3DCommands([{ op: 'circle' }, { op: 'intersect' }, minimal], api);
  assert(res[0].ok === false && res[1].ok === false && /不识别 2D 命令/.test(res[0].error + res[1].error), '2D 命令在 3D 分支被拒绝');
  assert(res[2].ok === true && res[2].count === 1, '3D 命令与 2D 命令同批互不影响');
}
{
  const r = applyBoard3DCommands([{ op: 'lineangle3d', from1: [0, 0, 0], to1: [0, 0, 0] }], { add: () => true });
  assert(r[0].ok === false && /重合/.test(r[0].error), '执行器透传语义层错误');
}

section('五、协议两侧一致性与 3D 意图分支');
assert(BOARD3D_LINE_ANGLE_PROMPT_OPS.length === 1 && BOARD3D_LINE_ANGLE_PROMPT_OPS[0] === 'lineangle3d', '提示词 op 与执行器 op 一致');
assert(BOARD3D_LINE_ANGLE_PROMPT.includes('lineangle3d') && BOARD3D_LINE_ANGLE_PROMPT.includes('from1') && BOARD3D_LINE_ANGLE_PROMPT.includes('asRightAngle'), '提示词含完整命令格式');
assert(BOARD3D_LINE_ANGLE_PROMPT.includes('异面') && BOARD3D_LINE_ANGLE_PROMPT.includes('平行') && BOARD3D_LINE_ANGLE_PROMPT.includes('θ=0 退化为点'), '提示词说明退化情形');
assert(BOARD3D_LINE_ANGLE_PROMPT.includes('2D 的夹角 / 垂线命令在本分支依旧不认识'), '提示词保持 3D/2D 分支隔离铁律');
assert(isLineangle3DIntent('求两条异面直线的夹角') && isLineangle3DIntent('空间两直线夹角'), 'D36 意图词命中');
assert(isLineangle3DIntent('线线角是多少') && isLineangle3DIntent('两直线所成角'), '线线角与两直线所成角命中');
assert(!isLineangle3DIntent('画一个圆和一条直线') && !isLineangle3DIntent('点到直线的距离'), '2D 通用措辞不误命中');
assert(resolveBoardMode({ detect3d: true, message: '求两条异面直线的夹角' }, '求两条异面直线的夹角') === '3d', '显式 detect3d 时线线角进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '空间两直线夹角') === '3d', '空间两直线夹角进入 3D 命令集');
assert(resolveBoardMode({ detect3d: true }, '画两条异面直线的公垂线') === '3d', 'D35 意图词仍有效');
assert(resolveBoardMode({ message: '画一个圆' }, '画一个圆') === '2d', '未开启 detect3d 保持 2D 主干');
assert(resolveBoardMode({ detect3d: true }, '画一个圆和一条直线') === '2d', '2D 通用词不误切 3D');
assert(read('ai/board-backend.js').includes('+ BOARD3D_LINE_ANGLE_PROMPT'), '后端 3D 提示词已拼接新段');
assert(read('js/board3d-ai.js').includes("la.op !== 'lineangle3d'"), '前端 AI 面板展示新命令读数');
assert(read('board3d.html').includes('lineangle3d 给两条空间直线各两点'), '画板面板工具说明已追加');

section('六、协作铁律与硬约束静态复核');
{
  const headPrompt = readHead('ai/board-prompt.js');
  const nowPrompt = read('ai/board-prompt.js');
  // 纯追加兼容：本段已提交时允许后续轮次在其后继续追加，只要求 HEAD 全文仍是当前文件前缀。
  assert(nowPrompt.startsWith(headPrompt), '共享提示词文件对 HEAD 纯追加、零覆盖');
  assert(nowPrompt.lastIndexOf('BOARD3D_LINE_ANGLE_PROMPT') > nowPrompt.lastIndexOf('BOARD3D_SKEWLINE_PROMPT'), '新段追加在既有段之后');
  assert(nowPrompt.includes('2D 主干'), '2D 主干标志仍在');
}
{
  const headBackend = readHead('ai/board-backend.js');
  const nowBackend = read('ai/board-backend.js');
  assert(nowBackend.includes('BOARD_SYSTEM_PROMPT') && nowBackend.includes('resolveBoardMode'), '后端 2D 主干与模式分派仍在');
  const delta = nowBackend.split('\n').length - headBackend.split('\n').length;
  assert(delta === 0 || delta === 1, '后端仅行内追加与一行注释（delta=' + delta + '）');
  const inlineEdited = ['isSkewline3DIntent', 'return p.detect3d === true', '+ BOARD3D_POINT_PLANE_PROMPT + BOARD3D_SKEWLINE_PROMPT'];
  const historical = headBackend.split('\n').filter((line) => !inlineEdited.some((frag) => line.includes(frag)));
  assert(historical.every((line) => nowBackend.includes(line)), '后端历史行未被删除（仅 3 行行内追加）');
}
{
  const headHtml = readHead('board3d.html');
  const nowHtml = read('board3d.html');
  // 纯追加兼容：提示词插在同一行行尾的 </div> 之前，已提交后仍允许后续轮次继续追加；
  // 断言当前文件 = HEAD 全文插入一段连续文本（无删改任何既有字节）。
  let p = 0;
  while (p < headHtml.length && headHtml[p] === nowHtml[p]) p++;
  let s = 0;
  while (s < headHtml.length - p && headHtml[headHtml.length - 1 - s] === nowHtml[nowHtml.length - 1 - s]) s++;
  assert(p + s === headHtml.length && nowHtml.includes('lineangle3d 给两条空间直线'), 'board3d.html 只追加工具提示');
  assert(nowHtml.includes('"three": "./libs/three/three.module.min.js"'), '本地 Three.js 引用保持');
}
for (const f of ['editor.html', 'js/editor.js', 'js/workbench.js', 'js/board.js', 'js/executor.js']) {
  assert(readHead(f) === read(f), `${f} 本轮零改动（旧 appId 路径与 2D 主干保留）`);
}
assert(read('editor.html').includes('appId') || read('js/editor.js').includes('algeo-sdk'), '大角 SDK 旧路径仍在');
assert(read('js/board3d-executor.js').includes("case 'skewline3d'") && read('js/board3d-executor.js').includes("case 'lineangle3d'"), '新旧 3D 命令并存、历史分支未删');
assert(read('docs/3D画板回归用例清单.md').includes('D36') && read('docs/3D画板回归用例清单.md').includes('lineangle3d'), '回归清单含 D36 记录');

console.log(`\n合计 ${passed + failed} 项断言：通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);

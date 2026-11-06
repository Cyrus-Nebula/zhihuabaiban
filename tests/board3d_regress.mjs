/**
 * 独立自主 3D 画板 —— 无头逻辑回归（不依赖 WebGL / 浏览器）。
 *
 * 目标：在沙箱无 GPU 环境下，用「假 board」驱动真实的 createBoard3DExecutor，
 * 验证 3D 命令协议（正方体 / 四棱锥等）的：
 *   - 正常命令集全部执行成功（用例 1 / 2）
 *   - 依赖缺失（引用未定义 id）被安全捕获为 ok:false
 *   - id 重复定义被捕获
 *   - moves()/applyMoves() 坐标往返一致（持久化）
 *
 * 运行：node tests/board3d_regress.mjs
 * 注意：js/board3d.js 顶层会 import three；本测试仅用于加载模块，
 *       所有空间计算由假 board 记录，不触碰真实渲染。node_modules/three 已被 .gitignore 排除。
 */

import { createBoard3DExecutor, lineEndpoints, polygonTriangles, workPlaneForDrag } from '../js/board3d.js';
import { DEMO_CUBE, DEMO_PYRAMID } from '../js/board3d-demos.js';

let passed = 0;
let failed = 0;
const LINE_RADIUS_FOR_TEST = 14; // 与 js/board3d.js 的 LINE_RADIUS（AXIS_LEN*2）一致
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}

/** 只记录调用、不渲染的假 board —— 仅用于跑通执行器协议逻辑 */
class FakeBoard {
  constructor() {
    this.entries = new Map();
    this.points = new Map();
  }
  _reg(id, entry) { this.entries.set(id, entry); return entry; }
  createPoint3D(id, x, y, z, opts = {}) {
    if (this.entries.has(id)) throw new Error(`id「${id}」重复定义`);
    this.points.set(id, { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } });
    return this._reg(id, { obj: { position: { x, y, z }, add() {} }, type: 'point3d', deps: [], update: null });
  }
  createSegment3D(id, a, b, o = {}) { return this._reg(id, { type: 'segment3d', deps: [a, b], update: null }); }
  createLine3D(id, a, b, o = {}) { return this._reg(id, { type: 'line3d', deps: [a, b], update: null }); }
  createPolygon3D(id, ps, o = {}) { return this._reg(id, { type: 'polygon3d', deps: [...ps], update: null }); }
  createSphere3D(id, c, r, o = {}) { return this._reg(id, { type: 'sphere3d', deps: [c], update: null }); }
  createCircle3D(id, c, r, n, o = {}) { return this._reg(id, { type: 'circle3d', deps: [c], update: null }); }
  createCylinder3D(id, b, t, r, o = {}) { return this._reg(id, { type: 'cylinder3d', deps: [b, t], update: null }); }
  createCone3D(id, a, b, r, o = {}) { return this._reg(id, { type: 'cone3d', deps: [a, b], update: null }); }
  createText3D(id, x, y, z, text, o = {}) { return this._reg(id, { type: 'text3d', deps: [], update: null }); }
  createLabel3D(t, text) { const e = this.entries.get(t); if (!e) throw new Error(`标注目标「${t}」不存在`); return e; }
  setStyle(t, o = {}) { const e = this.entries.get(t); if (!e) throw new Error(`目标「${t}」不存在`); return e; }
  remove(id) { return this.entries.delete(id); }
  clear() { this.entries.clear(); this.points.clear(); }
  notifyPointMoved() {}
}

console.log('3D 画板无头回归');
console.log('— 用例 1：正方体命令集 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const res = exe.execute(DEMO_CUBE);
  assert(res.length === DEMO_CUBE.length, `返回结果数 == 命令数 (${DEMO_CUBE.length})`);
  assert(res.every((r) => r.ok), '全部命令执行成功');
  assert(board.entries.size === DEMO_CUBE.length, 'entries 注册数 == 命令数');
}

console.log('— 用例 2：四棱锥命令集 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const res = exe.execute(DEMO_PYRAMID);
  assert(res.length === DEMO_PYRAMID.length, `返回结果数 == 命令数 (${DEMO_PYRAMID.length})`);
  assert(res.every((r) => r.ok), '全部命令执行成功');
  // 四棱锥结构断言
  const pointCount = [...board.entries.values()].filter((e) => e.type === 'point3d').length;
  const faceCount = [...board.entries.values()].filter((e) => e.type === 'polygon3d').length;
  const edgeCount = [...board.entries.values()].filter((e) => e.type === 'segment3d').length;
  assert(pointCount === 5, '顶点数 == 5（底面 4 + 锥顶 1）');
  assert(faceCount === 5, '面数 == 5（底面 1 + 侧面 4）');
  assert(edgeCount === 4, '侧棱数 == 4');
  // 依赖闭环：侧面 fS1 依赖 P1/P2/A 都已定义
  assert([...board.entries.get('fS1').deps].sort().join(',') === 'A,P1,P2', 'fS1 依赖 P1/P2/A 均存在');
}

console.log('— 健壮性：依赖缺失 / id 重复 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const bad = exe.execute([
    { op: 'point3d', id: 'X', x: 0, y: 0, z: 0 },
    { op: 'segment3d', id: 's', from: 'X', to: 'GHOST' }, // GHOST 未定义
  ]);
  assert(bad[0].ok === true, '点 X 创建成功');
  assert(bad[1].ok === false && /不存在/.test(bad[1].error), '引用未定义 id 被捕获为 ok:false');
}
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const dup = exe.execute([
    { op: 'point3d', id: 'A', x: 0, y: 0, z: 0 },
    { op: 'point3d', id: 'A', x: 1, y: 0, z: 0 },
  ]);
  assert(dup[0].ok === true, '首个 A 创建成功');
  assert(dup[1].ok === false && /重复/.test(dup[1].error), '重复 id 被捕获为 ok:false');
}

console.log('— 持久化：moves() / applyMoves() 往返 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  exe.execute([{ op: 'point3d', id: 'A', x: 1, y: 0, z: 0 }]);
  const before = exe.moves();
  assert(before.length === 1 && before[0].id === 'A' && before[0].x === 1, 'moves() 读出当前坐标');
  exe.applyMoves([{ id: 'A', x: 2.5, y: 0.5, z: -1 }]);
  const after = exe.moves();
  assert(after[0].x === 2.5 && after[0].y === 0.5 && after[0].z === -1, 'applyMoves() 后 moves() 反映新坐标');
  assert(board.points.get('A').x === 2.5, '假 board 坐标随 applyMoves 更新');
}

console.log('— 会话描述 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  exe.execute(DEMO_PYRAMID);
  assert(/P1\(point3d\)/.test(exe.describe()), 'describe() 列出现有图元');
}

console.log('— 用例 3：空间几何体命令集（球 / 圆柱 / 圆锥 / 圆 / 直线）—');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const res = exe.execute([
    { op: 'point3d', id: 'O', x: 0, y: 0, z: 0 },
    { op: 'point3d', id: 'T', x: 0, y: 4, z: 0 },
    { op: 'sphere3d', id: 'S', center: 'O', radius: 2 },
    { op: 'cylinder3d', id: 'Cy', base: 'O', top: 'T', radius: 1 },
    { op: 'cone3d', id: 'Co', apex: 'T', base: 'O', radius: 1.5 },
    { op: 'circle3d', id: 'Ci', center: 'O', radius: 3, normal: [0, 1, 0] },
    { op: 'line3d', id: 'Ln', through: ['O', 'T'] },
  ]);
  assert(res.length === 7, '返回结果数 == 命令数 (7)');
  assert(res.every((r) => r.ok), '球/圆柱/圆锥/圆/直线 全部执行成功');
  assert(board.entries.get('S').type === 'sphere3d', 'sphere3d 注册成功');
  assert([...board.entries.get('S').deps].join(',') === 'O', 'sphere3d 依赖 center=O');
  assert(board.entries.get('Cy').type === 'cylinder3d', 'cylinder3d 注册成功');
  assert([...board.entries.get('Cy').deps].sort().join(',') === 'O,T', 'cylinder3d 依赖 base/top = O,T');
  assert(board.entries.get('Co').type === 'cone3d', 'cone3d 注册成功');
  assert([...board.entries.get('Co').deps].sort().join(',') === 'O,T', 'cone3d 依赖 apex/base = O,T');
  assert(board.entries.get('Ci').type === 'circle3d', 'circle3d 注册成功');
  assert(board.entries.get('Ln').type === 'line3d', 'line3d 注册成功');
  assert([...board.entries.get('Ln').deps].sort().join(',') === 'O,T', 'line3d 依赖 through = O,T');
}

console.log('— 用例 4：文字 / 标注 / 样式 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const res = exe.execute([
    { op: 'point3d', id: 'P', x: 1, y: 2, z: 3 },
    { op: 'text3d', id: 'Tx', x: 0, y: 0, z: 0, text: 'hello' },
    { op: 'label3d', target: 'P', text: '顶点P' },
    { op: 'style3d', target: 'P', color: '#ff0000' },
  ]);
  assert(res.length === 4, '返回结果数 == 命令数 (4)');
  assert(res.every((r) => r.ok), 'text3d/label3d/style3d 全部执行成功');
  assert(board.entries.get('Tx').type === 'text3d', 'text3d 注册成功');
  assert(board.entries.get('P') != null, 'label3d 作用于已存在的目标 P');
  assert(board.entries.size === 2, 'style3d 不新增图元（仅 P + Tx 两个元素）');
}

console.log('— 健壮性：体命令缺依赖 / 标注目标缺失 —');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  const r = exe.execute([{ op: 'sphere3d', id: 'S', center: 'NOPE', radius: 1 }]);
  assert(r[0].ok === false && /不存在/.test(r[0].error), 'sphere3d 引用未定义 center 被捕获');
  const r2 = exe.execute([{ op: 'label3d', target: 'NOPE', text: 'x' }]);
  assert(r2[0].ok === false && /不存在/.test(r2[0].error), 'label3d 引用未定义 target 被捕获');
}

console.log('— 用例 5：测量 measure3d（距离 / 夹角，纯计算不污染画板）—');
{
  const board = new FakeBoard();
  const exe = createBoard3DExecutor(board);
  exe.execute([
    { op: 'point3d', id: 'A', x: 0, y: 0, z: 0 },
    { op: 'point3d', id: 'B', x: 3, y: 0, z: 0 },
    { op: 'point3d', id: 'C', x: 0, y: 4, z: 0 }, // A(0,0,0) B(3,0,0) C(0,4,0) → 3-4-5 直角三角形
    { op: 'point3d', id: 'D', x: 1, y: 1, z: 0 },
  ]);
  const rAB = exe.execute([{ op: 'measure3d', kind: 'distance', of: ['A', 'B'] }]);
  assert(rAB[0].ok && rAB[0].value === 3, 'measure3d distance A-B == 3');
  const rBC = exe.execute([{ op: 'measure3d', kind: 'distance', of: ['B', 'C'] }]);
  assert(rBC[0].ok && rBC[0].value === 5, 'measure3d distance B-C == 5（3-4-5 斜边）');
  const rAng = exe.execute([{ op: 'measure3d', kind: 'angle', of: ['B', 'A', 'C'] }]);
  assert(rAng[0].ok && rAng[0].value === 90, 'measure3d angle ∠BAC == 90°');
  const rAng2 = exe.execute([{ op: 'measure3d', kind: 'angle', of: ['B', 'A', 'D'] }]);
  assert(rAng2[0].ok && rAng2[0].value === 45, 'measure3d angle ∠BAD == 45°（cos=1/√2）');
  const rBad = exe.execute([{ op: 'measure3d', kind: 'distance', of: ['A', 'GHOST'] }]);
  assert(rBad[0].ok === false && /不存在/.test(rBad[0].error), 'measure3d 引用未定义点被捕获为 ok:false');
  const rKind = exe.execute([{ op: 'measure3d', kind: 'warp', of: ['A', 'B'] }]);
  assert(rKind[0].ok === false && /kind/.test(rKind[0].error), 'measure3d 未知 kind 被捕获');
  assert(board.entries.size === 4, 'measure3d 不新增图元（仍只有 4 个点）');
}

console.log('— 用例 6：直线无限延伸（裁剪到参考系球）—');
{
  // 过原点 (0,0,0) 与 (0,4,0) 的直线沿 Y 轴；裁剪半径 14 → 端点应为 (0,-14,0) 与 (0,14,0)
  const e = lineEndpoints({ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, LINE_RADIUS_FOR_TEST);
  assert(!!e, 'Y 轴直线返回两个端点（非 null）');
  assert(Math.abs(e[0].y - (-14)) < 1e-6 && Math.abs(e[1].y - 14) < 1e-6, 'Y 轴直线端点裁剪到 ±14');
  assert(Math.abs(e[0].x) < 1e-9 && Math.abs(e[0].z) < 1e-9 && Math.abs(e[1].x) < 1e-9 && Math.abs(e[1].z) < 1e-9, 'X/Z 分量恒为 0');
  // 平行于 Z 轴、x=1 的直线：端点 z = ±√(14²-1²)≈±13.964，x 偏移保留
  const e2 = lineEndpoints({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 5 }, 14);
  const zr = Math.sqrt(14 * 14 - 1 * 1);
  assert(Math.abs(e2[0].z - (-zr)) < 1e-6 && Math.abs(e2[1].z - zr) < 1e-6, '平行于 Z 的直线端点裁剪正确');
  assert(Math.abs(e2[0].x - 1) < 1e-9 && Math.abs(e2[1].x - 1) < 1e-9, 'x 偏移在两端点保留');
  // 退化：两点重合 → 返回 null（方向未定义）
  const e3 = lineEndpoints({ x: 2, y: 2, z: 2 }, { x: 2, y: 2, z: 2 }, 14);
  assert(e3 === null, '两点重合返回 null（方向未定义）');
  // 中点必落在裁剪端点之间（任意 t∈[t1,t2] 都在球内或边界）
  const m = lineEndpoints({ x: 1, y: 2, z: 3 }, { x: -2, y: 0, z: 1 }, LINE_RADIUS_FOR_TEST);
  const mx = (m[0].x + m[1].x) / 2, my = (m[0].y + m[1].y) / 2, mz = (m[0].z + m[1].z) / 2;
  assert(Math.hypot(mx, my, mz) <= LINE_RADIUS_FOR_TEST + 1e-6, '线段中点在裁剪球内（无限直线被球包住）');
}

console.log('— 用例 7：拖拽工作面自适应视角（正视/侧视不再退化）—');
{
  const P = { x: 0, y: 2, z: 0 };
  // 等轴视线 (-9,-7,-11)：|dy|≈0.44 >= 0.25 → 仍是水平面（高度守恒语义不变）
  const iso = workPlaneForDrag({ x: -9, y: -7, z: -11 }, P);
  assert(iso.horizontal === true, '等轴视角仍用水平工作面（保持高度守恒）');
  assert(iso.normal.join(',') === '0,1,0' && iso.constant === -2, '水平面方程 y - 2 = 0');
  const top = workPlaneForDrag({ x: 0, y: -14, z: 0 }, P);
  assert(top.horizontal === true, '俯视视角仍用水平工作面');
  // 正视视线 (0,0,-14)：|dy| = 0 → 切换为面向相机的平面
  const front = workPlaneForDrag({ x: 0, y: 0, z: -14 }, P);
  assert(front.horizontal === false, '正视切换为面向相机的平面');
  assert(Math.abs(front.normal[2] + 1) < 1e-9, '正视平面法线归一化为单位视线 (0,0,-1)');
  const side = workPlaneForDrag({ x: -14, y: 0, z: 0 }, P);
  assert(side.horizontal === false && Math.abs(side.normal[0] + 1) < 1e-9, '侧视切换且法线 (-1,0,0)');
  // 平面必过被拖拽点：normal·point + constant = 0
  for (const wp of [iso, top, front, side]) {
    const n = wp.normal;
    assert(Math.abs(n[0] * P.x + n[1] * P.y + n[2] * P.z + wp.constant) < 1e-9,
      '平面过被拖拽点（' + (wp.horizontal ? '水平' : '面向相机') + '）');
  }
  // 关键：面向相机平面使射线求交分母 |n·dir| = 1（原水平面正视时为 0）
  assert(Math.abs(front.normal[2] * -1 - 1) < 1e-9, '面向相机平面令射线求交分母为 1（不再退化）');
  // 非单位视线输入同样安全归一化；阈值可配置
  const custom = workPlaneForDrag({ x: 0, y: 0, z: -5 }, P, 0.4);
  assert(custom.horizontal === false && Math.abs(custom.normal[2] + 1) < 1e-9, '非单位视线输入被正确归一化');
  const zero = workPlaneForDrag({ x: 0, y: 0, z: 0 }, P);
  assert(zero.horizontal === false, '零向量视线不抛错、安全降级');
}

console.log('— 用例 8：多边形三角扇顶点数组（纯计算，拖拽后同步刷新）—');
{
  const quad = [
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 },
  ];
  const v = polygonTriangles(quad);
  assert(v.length === 18, '4 点扇 → 2 三角形 → 18 个数字');
  assert(v.slice(0, 3).join(',') === '0,0,0' && v.slice(3, 6).join(',') === '2,0,0',
    '第一个三角形为 A-B-C');
  assert(v.slice(9, 12).join(',') === '0,0,0', '第二个三角形仍以 A 为公共顶点');
  const moved = quad.map((p, i) => (i === 0 ? { x: 20, y: 0, z: 20 } : p));
  const v2 = polygonTriangles(moved);
  assert(v2[0] === 20 && v2[2] === 20 && v2[9] === 20, '顶点变更后三角扇数据同步更新（包围体据此重算）');
  assert(polygonTriangles(quad.slice(0, 2)).length === 0, '少于 3 点返回空数组（安全降级）');
  assert(polygonTriangles(quad.slice(0, 3)).length === 9, '三角形 → 1 个三角形 → 9 个数字');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

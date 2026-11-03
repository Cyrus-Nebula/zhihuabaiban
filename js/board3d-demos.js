/**
 * 独立自主 3D 画板的演示场景命令集（与 js/board3d.js 的 createBoard3DExecutor 协议一一对应）。
 *
 * 同时被 board3d.html（浏览器加载真实 Three.js 渲染）与 tests/board3d_regress.mjs
 * （无头环境跑协议逻辑回归）引用——单一事实源，避免演示与回归之间的协议漂移。
 *
 * 命令约定见 js/board3d.js 顶部注释：
 *   - 点默认可拖拽；fixed:true 则锁定
 *   - 被引用的元素必须先定义（执行器按数组顺序执行）
 */

// 回归用例 1：棱长 3 的正方体（8 顶点 + 12 棱 + 6 面）
export const DEMO_CUBE = [
  { op: 'point3d', id: 'A', x: 0, y: 0, z: 0, label: 'A' },
  { op: 'point3d', id: 'B', x: 3, y: 0, z: 0, label: 'B' },
  { op: 'point3d', id: 'C', x: 3, y: 3, z: 0, label: 'C' },
  { op: 'point3d', id: 'D', x: 0, y: 3, z: 0, label: 'D' },
  { op: 'point3d', id: 'E', x: 0, y: 0, z: 3, label: 'E' },
  { op: 'point3d', id: 'F', x: 3, y: 0, z: 3, label: 'F' },
  { op: 'point3d', id: 'G', x: 3, y: 3, z: 3, label: 'G' },
  { op: 'point3d', id: 'H', x: 0, y: 3, z: 3, label: 'H' },
  { op: 'segment3d', id: 'sAB', from: 'A', to: 'B' },
  { op: 'segment3d', id: 'sBC', from: 'B', to: 'C' },
  { op: 'segment3d', id: 'sCD', from: 'C', to: 'D' },
  { op: 'segment3d', id: 'sDA', from: 'D', to: 'A' },
  { op: 'segment3d', id: 'sEF', from: 'E', to: 'F' },
  { op: 'segment3d', id: 'sFG', from: 'F', to: 'G' },
  { op: 'segment3d', id: 'sGH', from: 'G', to: 'H' },
  { op: 'segment3d', id: 'sHE', from: 'H', to: 'E' },
  { op: 'segment3d', id: 'sAE', from: 'A', to: 'E' },
  { op: 'segment3d', id: 'sBF', from: 'B', to: 'F' },
  { op: 'segment3d', id: 'sCG', from: 'C', to: 'G' },
  { op: 'segment3d', id: 'sDH', from: 'D', to: 'H' },
  { op: 'polygon3d', id: 'fBottom', points: ['A', 'B', 'C', 'D'], color: '#a5b4fc' },
  { op: 'polygon3d', id: 'fTop', points: ['E', 'F', 'G', 'H'], color: '#a5b4fc' },
  { op: 'polygon3d', id: 'fFront', points: ['A', 'B', 'F', 'E'], color: '#bfdbfe' },
  { op: 'polygon3d', id: 'fBack', points: ['D', 'C', 'G', 'H'], color: '#bfdbfe' },
  { op: 'polygon3d', id: 'fLeft', points: ['A', 'D', 'H', 'E'], color: '#c7d2fe' },
  { op: 'polygon3d', id: 'fRight', points: ['B', 'C', 'G', 'F'], color: '#c7d2fe' },
];

// 回归用例 2：四棱锥（底面正方形 + 锥顶）
//   - 底面 4 顶点在 XZ 平面（y=0），锥顶 A 在中心正上方
//   - 面：1 底面（四边形）+ 4 侧面（三角扇）
//   - 棱：4 条侧棱连到底面顶点与锥顶
export const DEMO_PYRAMID = [
  { op: 'point3d', id: 'P1', x: -1.5, y: 0, z: -1.5, label: 'P1' },
  { op: 'point3d', id: 'P2', x: 1.5, y: 0, z: -1.5, label: 'P2' },
  { op: 'point3d', id: 'P3', x: 1.5, y: 0, z: 1.5, label: 'P3' },
  { op: 'point3d', id: 'P4', x: -1.5, y: 0, z: 1.5, label: 'P4' },
  { op: 'point3d', id: 'A', x: 0, y: 3, z: 0, label: 'A' },
  { op: 'polygon3d', id: 'fBase', points: ['P1', 'P2', 'P3', 'P4'], color: '#a5b4fc' },
  { op: 'polygon3d', id: 'fS1', points: ['P1', 'P2', 'A'], color: '#bfdbfe' },
  { op: 'polygon3d', id: 'fS2', points: ['P2', 'P3', 'A'], color: '#c7d2fe' },
  { op: 'polygon3d', id: 'fS3', points: ['P3', 'P4', 'A'], color: '#bfdbfe' },
  { op: 'polygon3d', id: 'fS4', points: ['P4', 'P1', 'A'], color: '#c7d2fe' },
  { op: 'segment3d', id: 's1', from: 'P1', to: 'A' },
  { op: 'segment3d', id: 's2', from: 'P2', to: 'A' },
  { op: 'segment3d', id: 's3', from: 'P3', to: 'A' },
  { op: 'segment3d', id: 's4', from: 'P4', to: 'A' },
];

export const DEMOS = {
  cube: { name: '正方体', cmds: DEMO_CUBE },
  pyramid: { name: '四棱锥', cmds: DEMO_PYRAMID },
};

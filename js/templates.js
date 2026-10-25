/**
 * 内置模板与案例（经典脚本，挂 window.DAJIAO_TEMPLATES）
 *
 * 每个模板是一组路线B命令协议（与 ai/board-prompt.js / js/executor.js 对应），
 * 点「使用模板」即创建文件并打开，命令会原样重放。
 * thumb 是缩略图 SVG（内联，无需外部图片）。
 */
window.DAJIAO_TEMPLATES = [
  {
    id: 'tpl-gougu',
    title: '勾股定理可视化',
    category: '课堂演示',
    author: '智绘几何',
    desc: '3-4-5 直角三角形的三边上作正方形，面积关系一目了然',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="30" y="54" width="24" height="24" rx="2" fill="#BBDEFB"/>' +
      '<rect x="6" y="30" width="24" height="24" rx="2" fill="#C8E6C9"/>' +
      '<rect x="30" y="6" width="24" height="24" rx="2" fill="#FFCDD2"/>' +
      '<path d="M30 54 L54 54 L54 30 Z" fill="none" stroke="#37474F" stroke-width="2"/>' +
      '</svg>',
    commands: [
      { op: 'point', id: 'A', x: 0, y: 0, fixed: true },
      { op: 'point', id: 'B', x: 3, y: 0, fixed: true },
      { op: 'point', id: 'C', x: 0, y: 4, fixed: true },
      { op: 'point', id: 'A1', x: 0, y: -3, fixed: true },
      { op: 'point', id: 'B1', x: 3, y: -3, fixed: true },
      { op: 'point', id: 'A2', x: -4, y: 0, fixed: true },
      { op: 'point', id: 'C2', x: -4, y: 4, fixed: true },
      { op: 'point', id: 'B3', x: 7, y: 3, fixed: true },
      { op: 'point', id: 'C3', x: 4, y: 7, fixed: true },
      { op: 'segment', id: 'sAB', from: 'A', to: 'B' },
      { op: 'segment', id: 'sBC', from: 'B', to: 'C' },
      { op: 'segment', id: 'sCA', from: 'C', to: 'A' },
      { op: 'polygon', id: 'sq1', points: ['A', 'B', 'B1', 'A1'] },
      { op: 'polygon', id: 'sq2', points: ['A', 'C', 'C2', 'A2'] },
      { op: 'polygon', id: 'sq3', points: ['B', 'C', 'C3', 'B3'] },
      { op: 'angle', id: 'angA', points: ['B', 'A', 'C'] },
      { op: 'style', target: 'sq1', color: '#1565C0', fill: true, strokeWidth: 2 },
      { op: 'style', target: 'sq2', color: '#2E7D32', fill: true, strokeWidth: 2 },
      { op: 'style', target: 'sq3', color: '#C62828', fill: true, strokeWidth: 2 },
      { op: 'text', id: 't1', x: 1.5, y: -3.6, text: '9' },
      { op: 'text', id: 't2', x: -4.8, y: 2, text: '16' },
      { op: 'text', id: 't3', x: 5.4, y: 4.9, text: '25' },
      { op: 'text', id: 't4', x: 1.5, y: 2.5, text: '5' },
      { op: 'text', id: 't5', x: -9.5, y: -6, text: '勾股定理：3² + 4² = 5²' },
    ],
  },
  {
    id: 'tpl-yuanzhou',
    title: '圆周角定理',
    category: '动态演示',
    author: '智绘几何',
    desc: '同弧上的圆周角与圆心角，拖动 A/B/C 观察两角关系',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="60" cy="40" r="30" fill="none" stroke="#90A4AE" stroke-width="2"/>' +
      '<path d="M30 40 L60 10 L88 46 Z" fill="none" stroke="#C62828" stroke-width="2"/>' +
      '<circle cx="60" cy="40" r="2.5" fill="#37474F"/>' +
      '</svg>',
    commands: [
      { op: 'point', id: 'O', x: 0, y: 0, fixed: true },
      { op: 'circle', id: 'c1', center: 'O', radius: 5 },
      { op: 'glider', id: 'A', on: 'c1', x: -5, y: 0 },
      { op: 'glider', id: 'B', on: 'c1', x: 0, y: 5 },
      { op: 'glider', id: 'C', on: 'c1', x: 3, y: 4 },
      { op: 'segment', id: 'sCA', from: 'C', to: 'A' },
      { op: 'segment', id: 'sCB', from: 'C', to: 'B' },
      { op: 'segment', id: 'sOA', from: 'O', to: 'A' },
      { op: 'segment', id: 'sOB', from: 'O', to: 'B' },
      { op: 'angle', id: 'angC', points: ['A', 'C', 'B'] },
      { op: 'angle', id: 'angO', points: ['A', 'O', 'B'] },
      { op: 'text', id: 't1', x: -9.5, y: -6, text: '∠ACB 圆周角，∠AOB 圆心角' },
      { op: 'text', id: 't2', x: -9.5, y: -7.6, text: '拖动 A、B、C：圆周角 = 圆心角的一半' },
    ],
  },
  {
    id: 'tpl-jiangjun',
    title: '将军饮马·两定一动',
    category: '最短路径',
    author: '社区 · 子矜',
    desc: '造桥选址经典问题：利用对称点找 AM+MB 最短路径',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="8" y1="52" x2="112" y2="52" stroke="#1565C0" stroke-width="2" stroke-dasharray="5 4"/>' +
      '<path d="M30 20 L60 52 L86 26" fill="none" stroke="#C62828" stroke-width="2.5"/>' +
      '<path d="M30 20 L30 78" stroke="#BDBDBD" stroke-width="1.5" stroke-dasharray="4 3"/>' +
      '<circle cx="30" cy="20" r="3" fill="#37474F"/>' +
      '<circle cx="86" cy="26" r="3" fill="#37474F"/>' +
      '<circle cx="60" cy="52" r="3" fill="#C62828"/>' +
      '</svg>',
    commands: [
      { op: 'point', id: 'R1', x: -8, y: -2, fixed: true },
      { op: 'point', id: 'R2', x: 8, y: -2, fixed: true },
      { op: 'line', id: 'l1', through: ['R1', 'R2'] },
      { op: 'style', target: 'R1', hidden: true },
      { op: 'style', target: 'R2', hidden: true },
      { op: 'style', target: 'l1', color: '#1565C0', strokeWidth: 2, dash: 2 },
      { op: 'point', id: 'A', x: -3, y: 4, fixed: true },
      { op: 'point', id: 'B', x: 5, y: 3, fixed: true },
      { op: 'point', id: 'A2', x: -3, y: -8, fixed: true },
      { op: 'label', target: 'A2', text: "A'" },
      { op: 'segment', id: 'sA2B', from: 'A2', to: 'B' },
      { op: 'style', target: 'sA2B', color: '#9E9E9E', dash: 2 },
      { op: 'intersect', id: 'M', of: ['l1', 'sA2B'], index: 0 },
      { op: 'segment', id: 'sAM', from: 'A', to: 'M' },
      { op: 'style', target: 'sAM', color: '#C62828', strokeWidth: 2 },
      { op: 'segment', id: 'sMB', from: 'M', to: 'B' },
      { op: 'style', target: 'sMB', color: '#C62828', strokeWidth: 2 },
      { op: 'segment', id: 'sAA2', from: 'A', to: 'A2' },
      { op: 'style', target: 'sAA2', color: '#BDBDBD', dash: 2 },
      { op: 'text', id: 't1', x: 6.6, y: -0.5, text: '河' },
      { op: 'text', id: 't2', x: -9.5, y: 8.6, text: '将军饮马：AM + MB 最短' },
      { op: 'text', id: 't3', x: -9.5, y: 7.1, text: "A' 是 A 关于河的对称点" },
    ],
  },
  {
    id: 'tpl-parabola',
    title: '二次函数与参数 a',
    category: '课堂演示',
    author: '智绘几何',
    desc: '同屏对比 y=x²、y=0.5x²、y=2x²，理解 a 对开口的影响',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M15 8 Q60 76 105 8" fill="none" stroke="#2E7D32" stroke-width="2"/>' +
      '<path d="M25 15 Q60 75 95 15" fill="none" stroke="#C62828" stroke-width="2"/>' +
      '<path d="M35 40 Q60 72 85 40" fill="none" stroke="#1565C0" stroke-width="2"/>' +
      '</svg>',
    commands: [
      { op: 'function', id: 'f1', expr: 'x^2', from: -3, to: 3 },
      { op: 'style', target: 'f1', color: '#C62828', strokeWidth: 2 },
      { op: 'function', id: 'f2', expr: '0.5*x^2', from: -4.4, to: 4.4 },
      { op: 'style', target: 'f2', color: '#1565C0', strokeWidth: 2 },
      { op: 'function', id: 'f3', expr: '2*x^2', from: -2.1, to: 2.1 },
      { op: 'style', target: 'f3', color: '#2E7D32', strokeWidth: 2 },
      { op: 'point', id: 'V', x: 0, y: 0, fixed: true },
      { op: 'label', target: 'V', text: '顶点(0,0)' },
      { op: 'text', id: 't1', x: 3.4, y: 8.6, text: 'y = x²' },
      { op: 'text', id: 't2', x: -8.8, y: 3.2, text: 'y = 0.5x²' },
      { op: 'text', id: 't3', x: -8.8, y: 8.8, text: 'y = 2x²' },
      { op: 'text', id: 't4', x: -9.5, y: -8.6, text: 'a 决定开口大小：a 越大开口越小' },
    ],
  },
  {
    id: 'tpl-linear',
    title: '一次函数与 k、b',
    category: '课堂演示',
    author: '智绘几何',
    desc: '五条直线同屏对比，看清 k 控制倾斜、b 控制截距',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="15" y1="65" x2="105" y2="15" stroke="#C62828" stroke-width="2"/>' +
      '<line x1="15" y1="70" x2="105" y2="35" stroke="#1565C0" stroke-width="2"/>' +
      '<line x1="15" y1="45" x2="105" y2="5" stroke="#2E7D32" stroke-width="2"/>' +
      '<line x1="25" y1="65" x2="95" y2="25" stroke="#F9A825" stroke-width="2"/>' +
      '</svg>',
    commands: [
      { op: 'function', id: 'f1', expr: 'x', from: -8, to: 8 },
      { op: 'style', target: 'f1', color: '#C62828', strokeWidth: 2 },
      { op: 'function', id: 'f2', expr: '2*x', from: -5, to: 5 },
      { op: 'style', target: 'f2', color: '#1565C0', strokeWidth: 2 },
      { op: 'function', id: 'f3', expr: '0.5*x', from: -9, to: 9 },
      { op: 'style', target: 'f3', color: '#2E7D32', strokeWidth: 2 },
      { op: 'function', id: 'f4', expr: 'x + 2', from: -8, to: 6 },
      { op: 'style', target: 'f4', color: '#F9A825', strokeWidth: 2 },
      { op: 'function', id: 'f5', expr: 'x - 2', from: -6, to: 8 },
      { op: 'style', target: 'f5', color: '#6D28D9', strokeWidth: 2 },
      { op: 'text', id: 't1', x: 6.2, y: 6.6, text: 'y = x' },
      { op: 'text', id: 't2', x: 3.4, y: 8.6, text: 'y = 2x' },
      { op: 'text', id: 't3', x: 6.4, y: 4.2, text: 'y = 0.5x' },
      { op: 'text', id: 't4', x: -8.6, y: 6.4, text: 'y = x + 2' },
      { op: 'text', id: 't5', x: -8.6, y: -5.6, text: 'y = x - 2' },
      { op: 'text', id: 't6', x: -9.5, y: -8.6, text: 'k 定倾斜程度，b 定与 y 轴交点' },
    ],
  },
  {
    id: 'tpl-midline',
    title: '三角形中位线',
    category: '几何变换',
    author: '智绘几何',
    desc: '拖动顶点，中位线始终平行且等于第三边的一半',
    thumb:
      '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M20 62 L100 62 L58 14 Z" fill="none" stroke="#37474F" stroke-width="2"/>' +
      '<line x1="60" y1="62" x2="39" y2="38" stroke="#C62828" stroke-width="2.5"/>' +
      '</svg>',
    commands: [
      { op: 'point', id: 'A', x: -6, y: -4 },
      { op: 'point', id: 'B', x: 6, y: -4 },
      { op: 'point', id: 'C', x: 0, y: 5 },
      { op: 'segment', id: 'sAB', from: 'A', to: 'B' },
      { op: 'segment', id: 'sBC', from: 'B', to: 'C' },
      { op: 'segment', id: 'sCA', from: 'C', to: 'A' },
      { op: 'midpoint', id: 'M', of: ['A', 'B'] },
      { op: 'midpoint', id: 'N', of: ['A', 'C'] },
      { op: 'midpoint', id: 'P', of: ['B', 'C'] },
      { op: 'segment', id: 'sMN', from: 'M', to: 'N' },
      { op: 'style', target: 'sMN', color: '#C62828', strokeWidth: 2.5 },
      { op: 'text', id: 't1', x: -9.5, y: -7.4, text: '中位线 MN ∥ BC，且 MN = BC/2' },
      { op: 'text', id: 't2', x: -9.5, y: -9, text: '拖动 A、B、C，关系始终成立' },
    ],
  },
];

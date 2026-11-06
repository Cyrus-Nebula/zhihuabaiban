/**
 * 2D 命令协议无头回归：move 增量修正 + style 细粒度样式 + 向后兼容。
 *
 * 沙箱里没有真实 JSXGraph，这里用 mock board 把 executor.js 的元素接口（setAttribute /
 * setPosition / setValue / label.setAttribute）替身掉，只验证「命令 → 执行器属性/坐标」的映射，
 * 与 docs/AI作图回归用例清单.md 用例 35~42 一一对应。
 * 运行：node tests/executor_style_regress.mjs
 *
 * 说明：js/executor.js 是浏览器 ESM，但仓库没有 package.json（Node 会把 .js 当 CJS），
 * 因此用 data: URL 动态导入源码，避免改动任何构建配置。
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../js/executor.js', import.meta.url), 'utf8');
const { createExecutor } = await import(
  'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
);

/** 造一个够用的 JXG 元素替身 */
function makeEl(board, type, parents, attrs = {}) {
  const el = {
    elType: type,
    _attrs: { ...attrs },
    _x: 0, _y: 0, _v: 0, _moved: false, _text: '',
    label: {
      _attrs: {}, _text: '',
      setText(t) { this._text = String(t); },
      setAttribute(a) { Object.assign(this._attrs, a); },
    },
    setAttribute(a) { Object.assign(this._attrs, a); },
    setText(t) { this._text = String(t); },
    X() { return this._x; },
    Y() { return this._y; },
    Value() { return this._v; },
    setValue(v) { this._v = Number(v); },
  };
  // 点 / 滑动条才可移动；多边形等不让 move 悄悄成功
  if (['point', 'glider', 'slider'].includes(type)) {
    el.setPosition = (_mode, xy) => { el._x = Number(xy[0]); el._y = Number(xy[1]); el._moved = true; };
    el.moveTo = (xy) => { el._x = Number(xy[0]); el._y = Number(xy[1]); el._moved = true; };
  }
  if (type === 'point' || type === 'glider') {
    if (typeof parents[0] === 'number') el._x = parents[0];
    if (typeof parents[1] === 'number') el._y = parents[1];
  }
  if (type === 'slider') {
    const range = parents[2];
    if (Array.isArray(range)) el._v = Number(range[1]);
  }
  return el;
}

function makeBoard() {
  const created = [];
  const board = {
    defaultAxes: {},
    jc: null,
    create(type, parents, attrs) {
      const el = makeEl(board, type, parents || [], attrs || {});
      created.push(el);
      return el;
    },
    removeObject() {},
    update() { this._updates = (this._updates || 0) + 1; },
  };
  return board;
}

function fresh() {
  const board = makeBoard();
  const ex = createExecutor(board);
  const base = [
    { op: 'point', id: 'A', x: 0, y: 2.6 },
    { op: 'point', id: 'B', x: -2, y: -1 },
    { op: 'point', id: 'C', x: 3, y: -1 },
    { op: 'polygon', id: 'tri', points: ['A', 'B', 'C'] },
    { op: 'slider', id: 'a', min: -3, max: 3, value: 1 },
  ];
  const r = ex.execute(base);
  assert.ok(r.every((x) => x.ok), '基础图元应全部创建成功：' + JSON.stringify(r));
  return { board, ex, A: ex.registry.get('A'), tri: ex.registry.get('tri'), slider: ex.registry.get('a') };
}

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✔ ' + name); };

console.log('2D 协议无头回归：move + 细粒度 style');

// ---- 用例 35~38：style 细粒度字段与向后兼容 ----
check('38 旧版 style 字段行为不变，且不产生任何新属性', () => {
  const { ex, tri } = fresh();
  const r = ex.execute([{ op: 'style', target: 'tri', color: '#E11D48', strokeWidth: 3, dash: 2, hidden: false }]);
  assert.equal(r[0].ok, true);
  assert.equal(tri._attrs.strokeColor, '#E11D48');
  assert.equal(tri._attrs.highlightStrokeColor, '#E11D48');
  assert.equal(tri._attrs.fillColor, '#E11D48');
  assert.equal(tri._attrs.strokeWidth, 3);
  assert.equal(tri._attrs.dash, 2);
  assert.equal(tri._attrs.visible, true);
  assert.equal(tri._attrs.strokeOpacity, undefined);
  assert.equal(tri._attrs.fillOpacity, undefined);
  assert.deepEqual(tri.label._attrs, {});
});

check('35 组合样式：fillColor 覆盖同色填充、opacity 作用于描边+填充并覆盖 fill:true 的 0.25', () => {
  const { ex, tri } = fresh();
  const r = ex.execute([{
    op: 'style', target: 'tri', color: '#3E44D9', fillColor: '#DBEAFE',
    fill: true, opacity: 0.35, labelColor: '#1E1B4B', labelSize: 15,
  }]);
  assert.equal(r[0].ok, true);
  assert.equal(tri._attrs.strokeColor, '#3E44D9');   // 描边仍是 color
  assert.equal(tri._attrs.fillColor, '#DBEAFE');     // 填充被 fillColor 解耦
  assert.equal(tri._attrs.strokeOpacity, 0.35);
  assert.equal(tri._attrs.fillOpacity, 0.35);        // 覆盖 fill:true 的 0.25
  assert.equal(tri.label._attrs.strokeColor, '#1E1B4B');
  assert.equal(tri.label._attrs.fontSize, 15);
});

check('35 opacity 越界自动夹到 [0,1]', () => {
  const { ex, tri } = fresh();
  ex.execute([{ op: 'style', target: 'tri', opacity: 2 }]);
  assert.equal(tri._attrs.strokeOpacity, 1);
  assert.equal(tri._attrs.fillOpacity, 1);
  ex.execute([{ op: 'style', target: 'tri', opacity: -1 }]);
  assert.equal(tri._attrs.strokeOpacity, 0);
  assert.equal(tri._attrs.fillOpacity, 0);
});

check('36/37 labelColor 与 labelSize 只作用于 label；非法字号忽略', () => {
  const { ex, A, tri } = fresh();
  ex.execute([{ op: 'style', target: 'A', labelColor: '#E11D48', labelSize: 17 }]);
  assert.equal(A.label._attrs.strokeColor, '#E11D48');
  assert.equal(A.label._attrs.fontSize, 17);
  assert.equal(A._attrs.labelColor, undefined, '标签字段不能污染几何元素属性');
  ex.execute([{ op: 'style', target: 'A', labelSize: 'oops' }]);
  assert.equal(A.label._attrs.fontSize, 17, '非数值字号应被忽略');
  ex.execute([{ op: 'style', target: 'A', labelSize: 0 }]);
  assert.equal(A.label._attrs.fontSize, 17, '≤0 字号应被忽略');
  assert.deepEqual(tri.label._attrs, {}, '未指定 target 的元素不应被误改');
});

// ---- 用例 39/40：move 增量修正 ----
check('39 move 就地改自由点坐标，不新建图元、不重复注册 id', () => {
  const { ex, A } = fresh();
  const r = ex.execute([{ op: 'move', id: 'A', x: 0, y: 3 }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  assert.equal(A._x, 0);
  assert.equal(A._y, 3);
  assert.equal(ex.registry.get('A'), A, 'registry 仍指向原元素');
  assert.ok(ex.describe().includes('A(point)'), 'describe 仍能看到 A');
  assert.equal(ex.describe().split('A(point)').length - 1, 1, 'A 不应重复注册');
});

check('39 move 支持 to:[x,y] 等价写法', () => {
  const { ex, A } = fresh();
  const r = ex.execute([{ op: 'move', id: 'A', to: [1, 4] }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  assert.equal(A._x, 1);
  assert.equal(A._y, 4);
});

check('40 move 改滑动条当前值并触发 board.update()', () => {
  const { ex, slider, board } = fresh();
  const before = board._updates || 0;
  const r = ex.execute([{ op: 'move', id: 'a', v: 2 }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  assert.equal(slider._v, 2);
  assert.ok((board._updates || 0) > before, '滑动条改值后应刷新画板');
  assert.equal(slider._moved, false, '滑动条不应走 setPosition');
});

check('39 move 错误路径：不存在的 id / 缺坐标 / 目标不可移动', () => {
  const { ex, tri } = fresh();
  const bad = ex.execute([
    { op: 'move', id: 'NOPE', x: 1, y: 1 },
    { op: 'move', id: 'A' },
    { op: 'move', id: 'a' },
    { op: 'move', id: 'tri', x: 1, y: 1 },
  ]);
  assert.equal(bad[0].ok, false);
  assert.match(bad[0].error, /不存在/);
  assert.equal(bad[1].ok, false);
  assert.match(bad[1].error, /数值坐标/);
  assert.equal(bad[2].ok, false);
  assert.match(bad[2].error, /数值 v/);
  assert.equal(bad[3].ok, false);
  assert.match(bad[3].error, /不是可移动的点/);
  assert.equal(tri._moved, false);
});

check('39 旧铁律未被破坏：point 重复定义同 id 仍然报错', () => {
  const { ex, A } = fresh();
  const r = ex.execute([{ op: 'point', id: 'A', x: 9, y: 9 }]);
  assert.equal(r[0].ok, false);
  assert.match(r[0].error, /重复定义/);
  assert.equal(A._y, 2.6, '失败的重定义不应改动原点');
});

check('39 典型自检修正序列：verify ✘ → move → 复跑 verify 由闭环负责（这里只验命令可执行）', () => {
  const { ex } = fresh();
  const r = ex.execute([
    { op: 'verify', id: 'v1', kind: 'distance', of: ['A', 'B'], expect: 4, tol: 0.05 },
    { op: 'move', id: 'A', x: 0, y: 3 },
  ]);
  assert.equal(r[0].ok, true);
  assert.equal(r[0].pass, false, 'A(0,2.6) 到 B(-2,-1) 的距离不等于 4，断言应未通过');
  assert.equal(r[1].ok, true);
});

console.log(`\n全部通过：${passed} 项断言组（对应回归用例 35~42）`);

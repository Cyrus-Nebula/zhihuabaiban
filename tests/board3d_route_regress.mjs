/**
 * 3D 路由切换回归（无头，不依赖浏览器 / WebGL）。
 *
 * 用 vm 在最小 DOM 沙箱里加载真实的 js/workbench.js，验证：
 *   - 3D 默认路由到自研 board3d.html；2D 仍走 board.html（不受开关影响）
 *   - 历史大角 SDK 格式工程自动回退 editor.html（数据不丢）
 *   - 显式开关 ?engine=sdk / localStorage['b3d.engine'] 可整体回退；?engine=self 可覆盖
 *   - landing.js 依赖的 window.openBoardUrl 仍然挂载
 *   - 硬约束：editor.html / appId / 大角 SDK 引用仍然存在（新旧路径并存）
 *
 * 运行：node tests/board3d_route_regress.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}

// ---------- 最小 DOM 沙箱 ----------
function mockEl() {
  return {
    innerHTML: '', hidden: false, textContent: '', className: '', title: '', value: '',
    style: {}, dataset: {},
    addEventListener() {}, appendChild() {}, append() {}, querySelector() { return null; },
  };
}
const localStorageData = {};
const sandbox = {
  console,
  URLSearchParams,
  document: {
    getElementById: () => mockEl(),
    createElement: () => mockEl(),
  },
  localStorage: {
    getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
    setItem: (k, v) => { localStorageData[k] = String(v); },
    removeItem: (k) => { delete localStorageData[k]; },
  },
  location: { search: '', href: 'index.html' },
  Store: { list: () => [] },
  DAJIAO_CONFIG: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('js/workbench.js'), sandbox, { filename: 'js/workbench.js' });

const openBoardUrl = sandbox.window.openBoardUrl;
const routeApi = sandbox.window.__b3dRoute;

/** 在指定 URL 参数 / localStorage 开关下取路由结果 */
function route(f, { search = '', engine = null } = {}) {
  sandbox.location.search = search;
  if (engine === null) delete localStorageData['b3d.engine'];
  else localStorageData['b3d.engine'] = engine;
  return openBoardUrl(f);
}

const f2d = { id: 'f_2d', mode: '2d', content: { c: [] } };
const fNew3d = { id: 'f_new3d', mode: '3d', content: null };
const fNative3d = { id: 'f_native', mode: '3d', content: { cmds: [{ op: 'point3d', id: 'A' }], moves: [] } };
const fLegacy3d = { id: 'f_legacy', mode: '3d', content: { mode: '3d', elements: [{ type: 'point' }] } };

console.log('3D 路由切换回归');
console.log('— 默认路由（自研 3D 画板 + 2D 不受影响）—');
assert(route(f2d) === 'board.html?id=f_2d', '2D 文件仍走 board.html');
assert(route(fNew3d) === 'board3d.html?id=f_new3d', '3D 新文件默认走自研 board3d.html');
assert(route(fNative3d) === 'board3d.html?id=f_native', '3D 自研格式（content.cmds）走 board3d.html');
assert(route(f2d, { search: '?engine=sdk' }) === 'board.html?id=f_2d', '回退开关不影响 2D 路由');
assert(route(f2d, { engine: 'sdk' }) === 'board.html?id=f_2d', 'localStorage 回退开关不影响 2D 路由');

console.log('— 历史数据保护：大角 SDK 格式工程自动回退 —');
assert(route(fLegacy3d) === 'editor.html?id=f_legacy', '历史 SDK 格式 3D 工程回退 editor.html');
assert(route({ id: 'f_str', mode: '3d', content: 'sdk-json' }) === 'editor.html?id=f_str',
  '非对象 content 也回退 editor.html');
assert(route({ id: 'f_obj', mode: '3d', content: {} }) === 'editor.html?id=f_obj',
  '缺 cmds 数组的对象 content 回退 editor.html');
assert(route(fLegacy3d, { search: '?engine=self' }) === 'editor.html?id=f_legacy',
  '?engine=self 不覆盖历史数据保护');

console.log('— 显式回退开关（新旧路径并存）—');
assert(route(fNew3d, { search: '?engine=sdk' }) === 'editor.html?id=f_new3d', '?engine=sdk 整体回退旧编辑器');
assert(route(fNew3d, { engine: 'sdk' }) === 'editor.html?id=f_new3d', "localStorage['b3d.engine']=sdk 回退");
assert(route(fNew3d, { search: '?engine=self', engine: 'sdk' }) === 'board3d.html?id=f_new3d',
  '?engine=self 优先于 localStorage，强制自研');
assert(route(fNew3d, { search: '?other=1' }) === 'board3d.html?id=f_new3d', '无关 URL 参数不改变默认路由');

console.log('— 兼容性与边界 —');
assert(typeof openBoardUrl === 'function', 'window.openBoardUrl 仍挂载（landing.js 复用）');
assert(route({ id: 'a b&c', mode: '3d', content: null }) === 'board3d.html?id=a%20b%26c',
  'id 经 encodeURIComponent 转义');
assert(!!routeApi && routeApi.isNative3DContent({ cmds: [] }) === true, 'isNative3DContent 识别空 cmds 数组');
assert(routeApi.isNative3DContent({ c: [] }) === false, 'isNative3DContent 拒绝 2D 的 c 字段');
assert(routeApi.resolve3dPage(fNew3d) === 'board3d.html', 'resolve3dPage 可直接核对');

console.log('— 硬约束：旧路径 / appId / 大角 SDK 引用未被破坏 —');
const editorJs = read('js/editor.js');
const configJs = read('js/config.js');
const editorHtml = read('editor.html');
const workbenchJs = read('js/workbench.js');
assert(/cdn\.jsdelivr\.net\/npm\/@dajiaoai\/algeo-sdk/.test(editorJs), 'js/editor.js 仍保留大角 SDK 引用');
const appIdMatch = configJs.match(/appId\s*:\s*'([^']+)'/);
assert(!!appIdMatch && appIdMatch[1] !== 'YOUR_APP_ID', 'js/config.js 仍保留有效 appId 配置');
assert(/js\/editor\.js/.test(editorHtml), 'editor.html 仍加载 js/editor.js');
assert(/editor\.html/.test(workbenchJs) && /board3d\.html/.test(workbenchJs),
  'workbench.js 中新旧两条路径并存');
assert(/旧版打开/.test(workbenchJs), '3D 卡片保留用户可见的「旧版打开」入口');

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

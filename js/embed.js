/**
 * 智绘几何 · 嵌入运行时（本地 SDK）
 *
 * 对标大角几何「开放平台 · 嵌入式演示画板 / JS SDK」：把智绘几何的画板嵌到
 * 第三方网页、课件、博客或笔记里，图形保持可拖拽、滑动条可动。
 * 区别在于：本运行时就是几个静态 js 文件，不联网、不调云端接口、不要账号和 SDK Key，
 * 自托管到自己的站点 / 内网即可，符合开源 + 本地优先的定位。
 *
 * ── 用法（一行 module 脚本即可，页面里任意容器都行）──
 *   <div class="zhihui-board-embed" data-zhihui-title="勾股定理" style="height:480px">
 *     <script type="application/json">{"commands":[...],"moves":[...]}</script>
 *   </div>
 *   <script type="module" src="js/embed.js"></script>
 *
 * ── 数据来源（容器上二选一）──
 *   1. 容器内 <script type="application/json">…</script>   内联数据，贴哪都能用
 *   2. 容器属性 data-zhihui-src="boards/xxx.json"          外链数据，页面更轻
 *
 * ── 容器可选属性 ──
 *   data-zhihui-title    标题（显示在画板上方；不写就不显示）
 *   data-zhihui-credit   "off" 时不显示右下角「由智绘几何生成」署名
 *   data-zhihui-base     运行时与 vendor 的根路径（默认按 embed.js 自身位置推导）
 *
 * ── 依赖文件（同一份仓库拷过去即可，均为静态资源）──
 *   js/embed.js（本文件）、js/executor.js、vendor/jsxgraphcore.js、vendor/jsxgraph.css
 */

import { createExecutor } from './executor.js';

const VERSION = '1.0.0';
const CONTAINER_SEL = '[data-zhihui-board]';
const DEFAULT_BASE = new URL('../', import.meta.url).href; // js/embed.js -> 仓库根

const STYLE_TEXT =
  '.zhihui-board-embed{position:relative;box-sizing:border-box}' +
  '.zhihui-board-caption{margin:0 0 6px;font:600 14px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}' +
  '.zhihui-board-stage{width:100%;height:100%;min-height:240px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}' +
  '.zhihui-board-credit{position:absolute;right:10px;bottom:6px;font:11px/1.4 system-ui,sans-serif;color:#94a3b8}' +
  '.zhihui-board-credit a{color:#94a3b8;text-decoration:none}' +
  '.zhihui-board-error{padding:10px 12px;font:12px/1.6 system-ui,sans-serif;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px}';

/** 拼资源路径：base 末尾可能带也可能不带斜杠 */
function joinPath(base, rel) {
  return String(base || '').replace(/\/+$/, '') + '/' + rel;
}

function ensureStyle() {
  if (document.querySelector('style[data-zhihui-style]')) return;
  const st = document.createElement('style');
  st.setAttribute('data-zhihui-style', '1');
  st.textContent = STYLE_TEXT;
  document.head.appendChild(st);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('脚本加载失败：' + url));
    document.head.appendChild(s);
  });
}

/** 确保 JSXGraph 引擎就位（UMD 包会挂到 window.JXG） */
async function ensureEngine(base) {
  if (!(window.JXG && window.JXG.JSXGraph)) {
    await loadScript(joinPath(base, 'vendor/jsxgraphcore.js'));
  }
  if (!(window.JXG && window.JXG.JSXGraph)) throw new Error('JSXGraph 引擎加载失败');
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = joinPath(base, 'vendor/jsxgraph.css');
    document.head.appendChild(link);
  } catch (_) { /* 样式缺失不影响作图 */ }
}

/** 读容器内 <script type="application/json"> 的内联数据；没有则 null */
function readInlineData(box) {
  const s = box.querySelector('script[type="application/json"]');
  if (!s) return null;
  const raw = (s.textContent || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) {
    throw new Error('容器里的 JSON 数据解析失败：' + e.message);
  }
}

/** 读外链数据文件 */
async function readRemoteData(url) {
  let r;
  try { r = await fetch(url); } catch (e) {
    throw new Error('数据文件读取失败（' + url + '）：' + e.message);
  }
  if (!r.ok) throw new Error('数据文件读取失败（HTTP ' + r.status + '）：' + url);
  try { return await r.json(); } catch (e) {
    throw new Error('数据文件不是合法 JSON：' + e.message);
  }
}

/** 三种写法归一：命令数组 / {commands,moves} / 导出存档 {c,m} */
function normalize(data) {
  if (!data) throw new Error('没有拿到画板数据');
  if (Array.isArray(data)) return { settings: {}, commands: data, moves: [], name: '' };
  const commands = Array.isArray(data.commands) ? data.commands : (Array.isArray(data.c) ? data.c : []);
  const moves = Array.isArray(data.moves) ? data.moves : (Array.isArray(data.m) ? data.m : []);
  if (!commands.length) throw new Error('画板数据里没有 commands');
  return { settings: data.settings || {}, commands, moves, name: data.name || '' };
}

async function resolveData(box) {
  const inline = readInlineData(box);
  if (inline) return normalize(inline);
  const src = box.getAttribute('data-zhihui-src');
  if (src) return normalize(await readRemoteData(src));
  throw new Error('容器里既没有内联 JSON，也没有 data-zhihui-src 数据地址');
}

function showError(box, msg) {
  ensureStyle();
  const p = document.createElement('div');
  p.className = 'zhihui-board-error';
  p.textContent = '画板加载失败：' + msg;
  box.appendChild(p);
}

/**
 * 往容器里挂一个交互式画板
 * @param {HTMLElement} box 容器元素
 * @param {object} data     归一化后的画板数据 {settings, commands, moves, name}
 * @returns {{board, executor, ok:number, bad:Array}}
 */
export async function mount(box, data) {
  const base = box.getAttribute('data-zhihui-base') || DEFAULT_BASE;
  const title = box.getAttribute('data-zhihui-title') || (data && data.name) || '';
  const credit = box.getAttribute('data-zhihui-credit');
  await ensureEngine(base);
  ensureStyle();

  if (title) {
    const h = document.createElement('p');
    h.className = 'zhihui-board-caption';
    h.textContent = title;
    box.appendChild(h);
  }
  const stage = document.createElement('div');
  stage.className = 'zhihui-board-stage';
  if (title) stage.style.height = 'calc(100% - 26px)';
  if (!box.style.height) box.style.height = '420px';
  box.appendChild(stage);

  const s = (data && data.settings) || {};
  const board = window.JXG.JSXGraph.initBoard(stage, {
    boundingbox: [-10, 10, 10, -10],
    axis: s.axis !== false,
    grid: s.grid !== false,
    showCopyright: false,
    showNavigation: false,
    zoom: { wheel: true, needshift: false },
    pan: { needshift: false },
    keepaspectratio: true,
    // 文本必须用 SVG 渲染：默认的 'html' 是覆盖整板的 DIV，会破坏拖拽命中判定
    text: { display: 'internal' },
  });
  const executor = createExecutor(board);
  const r = executor.execute((data && data.commands) || []);
  executor.applyMoves((data && data.moves) || []);

  // 背景与画板页保持一致（深色模式靠 SVG 反色，几何关系不受影响）
  if (s.bg === 'dark') {
    stage.style.background = '#0f172a';
    const svg = stage.querySelector('svg');
    if (svg) svg.style.filter = 'invert(1) hue-rotate(180deg)';
  } else if (s.bg === 'beige') {
    stage.style.background = '#FAF5EC';
  }

  if (credit !== 'off') {
    const c = document.createElement('div');
    c.className = 'zhihui-board-credit';
    const a = document.createElement('a');
    a.href = 'https://github.com/Cyrus-Nebula/zhihuabaiban';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '由智绘几何生成';
    c.appendChild(a);
    box.appendChild(c);
  }

  const bad = r.filter((x) => !x.ok);
  if (bad.length) console.warn('[智绘几何] 部分命令执行失败', bad);
  box.dataset.zhihuiMounted = 'ok';
  const api = { board, executor, ok: r.length - bad.length, bad };
  box.__zhihuiBoard = api; // 调试/自测把手：从容器直接取到画布，便于验证拖拽/滑动条联动
  return api;
}

/** 扫描页面里所有未挂载的容器逐个挂载；返回每个容器对应的 Promise */
export function autoMount(root) {
  const scope = root || document;
  const boxes = Array.prototype.slice.call(scope.querySelectorAll(CONTAINER_SEL));
  return boxes
    .filter((b) => !b.dataset.zhihuiMounted)
    .map(async (box) => {
      try {
        box.dataset.zhihuiMounted = 'pending'; // 先占位，避免重复挂载
        return await mount(box, await resolveData(box));
      } catch (e) {
        delete box.dataset.zhihuiMounted;
        showError(box, e && e.message ? e.message : String(e));
        return { box, error: e };
      }
    });
}

const ready = Promise.resolve().then(() => Promise.all(autoMount()));
const api = { version: VERSION, mount, autoMount, resolveData, ready, containers: CONTAINER_SEL };
if (typeof window !== 'undefined') window.ZhihuiBoard = api;
export default api;

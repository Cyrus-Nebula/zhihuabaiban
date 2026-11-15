/**
 * A9「WebGL 真实像素渲染」回归（独立自主 3D 画板 · 验证闭环收尾）。
 *
 * 背景：历轮清单把 A9 记为 ⬜，理由是「无头 Chromium 缺 SwiftShader，无法创建 WebGL 上下文」。
 * 该结论只对 **headless** 成立；本轮实测 **Xvfb 虚拟显示 + headful Chromium +
 * `--use-angle=swiftshader`** 能拿到 WebGL 2.0 上下文并真实出图（软件渲染），因此把 A9
 * 的验证能力固化成一份可复跑脚本，避免「沙箱缺 GPU」再次成为验证闭环的空白。
 *
 * 本脚本分两段，任何环境都能 `node tests/board3d_webgl_render.mjs` 跑完且不会污染全量套件口径：
 *
 *   A 组（静态护栏，零外部依赖，永远执行）：
 *     - board3d.html importmap 完全本地化、vendor 三件套可达、内核确实用 WebGLRenderer / isReady；
 *     - 硬约束「新旧路径并存」：editor.html / js/editor.js 的 @dajiaoai/algeo-sdk 与 appId、
 *       js/config.js 的 appId 配置、js/workbench.js 的 3D→board3d.html 路由全部仍在；
 *     - 协作铁律：2D 主干 js/board.js / js/executor.js、另一任务的 docs/AI作图回归用例清单.md 未被删。
 *
 *   B 组（真实 WebGL 像素渲染，需 playwright + Xvfb headful + SwiftShader；缺环境则逐项 SKIP）：
 *     - 自起本地静态服务（127.0.0.1 随机端口）+ `--host-resolver-rules` 阻断全部外部域名，模拟断网；
 *     - 断言 THREE.REVISION === '160'、WebGL 2.0、board3dApi.isReady() === true、draw calls > 0；
 *     - 截图经浏览器内 2D canvas 解码（零 Node 侧 PNG 依赖），统计非背景像素比例与帧间差异：
 *       空场景有网格/坐标轴出图 → 加 box/pyramid/sphere/label 后占比显著上升 →
 *       切「正视」预设画面改变 → resetView 后与默认机位基线逐像素回到一致（C2 像素级证据）；
 *     - 真实相机规格复位到 (6,5,8)/target(0,0,0)/up+Y；three 相关外部请求为 0；
 *     - 3D 内核无 JS 异常（账号体系 supabase 断网报错属已知边界，单独白名单排除）。
 *
 * 环境探测（全部可选，找不到就 SKIP，不写进 package.json、不引入仓库依赖）：
 *   - playwright：环境变量 PLAYWRIGHT_MODULE → 项目本地 `playwright` → 全局 npm root 下的 playwright；
 *   - 浏览器：playwright 自带 chromium → /usr/bin/google-chrome → /usr/bin/chromium；
 *   - 虚拟显示：优先复用已有 DISPLAY，否则自起 Xvfb :97 并在退出时回收。
 *
 * 运行：node tests/board3d_webgl_render.mjs
 * 备注：B 组是软件渲染（SwiftShader）下的像素级出图断言，不等同于真 GPU 硬件目视；
 *       有 GPU 的机器仍建议补跑人工目视。脚本只新增测试与静态断言，不改任何产品代码。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0, skipped = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function skip(msg) { skipped++; console.log('  ⊘ SKIP ' + msg); }
function section(t) { console.log('\n' + t); }

/* ============================================================
 * A 组：静态护栏（永远执行）
 * ============================================================ */
section('A. 静态护栏：离线内核 / 新旧路径并存 / 协作铁律');
{
  const page = read('board3d.html');
  const im = page.match(/<script\s+type=["']importmap["'][\s\S]*?<\/script>/);
  assert(!!im, 'board3d.html 含 importmap 脚本块');
  let map = null;
  if (im) { try { map = JSON.parse(im[0].replace(/<[^>]+>/g, '')); } catch (_) { /* noop */ } }
  assert(!!map && map.imports && map.imports.three === './libs/three/three.module.min.js',
    'importmap: three → ./libs/three/three.module.min.js（本地）');
  assert(!!map && map.imports['three/addons/'] === './libs/three/addons/',
    'importmap: three/addons/ → ./libs/three/addons/（本地）');
  assert(!!map && !Object.values(map.imports).some((v) => /https?:|cdn|jsdelivr|unpkg/i.test(v)),
    'importmap 中无任何外部 CDN 键（three 运行时零 CDN）');
  assert(!/jsdelivr[^>]*three|unpkg[^>]*three/.test(page), 'board3d.html 无 three 的 CDN 引用');

  for (const f of [
    'libs/three/three.module.min.js',
    'libs/three/addons/controls/OrbitControls.js',
    'libs/three/addons/controls/TransformControls.js',
  ]) assert(existsSync(join(ROOT, f)), `本地 vendor 可达：${f}`);

  const core = read('js/board3d.js');
  assert(/new THREE\.WebGLRenderer\s*\(\s*\{\s*canvas/.test(core), '内核用 canvas 创建真实 WebGLRenderer（A9 前提）');
  assert(/renderer\.render\s*\(\s*scene\s*,\s*camera\s*\)/.test(core), '渲染循环逐帧 renderer.render(scene, camera)');
  assert(/isReady\s*\(\s*\)\s*\{\s*return\s*!!group\s*&&\s*!!scene/.test(core),
    'board3dApi.isReady() 以 group/scene 就绪为准（A9 断言接口）');
  assert(/window\.Board3D\s*=\s*board3dApi/.test(core), '内核把 board3dApi 挂到 window.Board3D');

  // 硬约束：新旧路径并存，绝不清理大角 SDK / appId / 旧路由
  const editor = read('js/editor.js');
  assert(/cdn\.jsdelivr\.net\/npm\/@dajiaoai\/algeo-sdk/.test(editor), '硬约束：editor.js 仍 import 大角 SDK');
  assert(/CFG\.appId/.test(editor), '硬约束：editor.js 仍保留 appId 逻辑');
  assert(read('js/config.js').includes('appId'), '硬约束：config.js 仍保留 appId 配置');
  assert(read('editor.html').includes('js/editor.js'), '硬约束：editor.html 旧路径仍在');
  const wb = read('js/workbench.js');
  assert(/mode\s*===\s*['"]3d['"]\s*\?\s*['"]board3d\.html['"]\s*:\s*['"]board\.html['"]/.test(wb),
    '硬约束：workbench.js 路由 3D→board3d.html、2D→board.html 仍在');

  // 协作铁律：2D 主干与另一任务的成果未被删
  assert(existsSync(join(ROOT, 'js/board.js')) && existsSync(join(ROOT, 'js/executor.js')),
    '2D 主干 js/board.js / js/executor.js 仍在（另一任务成果未删）');
  assert(existsSync(join(ROOT, 'docs/AI作图回归用例清单.md')), '另一任务维护的 2D 回归清单仍在');
  assert(existsSync(join(ROOT, 'ai/board-prompt.js')) && existsSync(join(ROOT, 'ai/board-backend.js')),
    '共享文件 ai/board-prompt.js / ai/board-backend.js 仍在（未被整体替换）');
}

/* ============================================================
 * 环境探测（B 组可选能力）
 * ============================================================ */
async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright');
  try {
    const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 8000 });
    const g = (r.stdout || '').trim().split('\n').pop();
    if (g) candidates.push(join(g, 'playwright', 'index.mjs'), join(g, 'playwright', 'index.js'));
  } catch (_) { /* npm 不可用则跳过 */ }
  for (const c of candidates) {
    try {
      const spec = c.startsWith('/') || c.startsWith('file:') ? pathToFileURL(c).href : c;
      const m = await import(spec);
      if (m && m.chromium) return m.chromium;
    } catch (_) { /* 逐个候选尝试 */ }
  }
  return null;
}

function findBrowser(chromium) {
  const list = [];
  try { list.push(chromium.executablePath()); } catch (_) { /* noop */ }
  list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/google-chrome-stable');
  return list.find((p) => p && existsSync(p)) || null;
}

/** 复用已有 DISPLAY；否则自起 Xvfb :97（返回 { display, own? } 或 null） */
async function ensureDisplay() {
  const probe = spawnSync('which', ['Xvfb'], { encoding: 'utf8' });
  if ((probe.stdout || '').trim()) {
    const sock = '/tmp/.X11-unix/X97';
    if (!existsSync(sock)) {
      const child = spawn('Xvfb', [':97', '-screen', '0', '1280x820x24', '-nolisten', 'tcp'],
        { stdio: 'ignore', detached: true });
      child.unref();
      for (let i = 0; i < 30 && !existsSync(sock); i++) await sleep(100);
      if (existsSync(sock)) return { display: ':97', own: child };
      try { child.kill(); } catch (_) { /* noop */ }
    } else {
      return { display: ':97', own: null };
    }
  }
  // 已有 DISPLAY 时直接复用（可能是外部提供的虚拟显示）
  if (process.env.DISPLAY) return { display: process.env.DISPLAY, own: null };
  return null;
}

/** 极简本地静态服务：只服务 ROOT 内文件，防目录穿越 */
function startServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon',
  };
  const srv = createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    if (rel === '/') rel = '/board3d.html';
    const abs = normalize(join(ROOT, rel));
    if (!abs.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    if (!existsSync(abs)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(abs));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/* ============================================================
 * B 组：真实 WebGL 像素渲染
 * ============================================================ */
section('B. 真实 WebGL 像素渲染（Xvfb headful + SwiftShader 软件渲染）');
const chromium = await loadPlaywright();
const browserPath = chromium ? findBrowser(chromium) : null;
const disp = browserPath ? await ensureDisplay() : null;

if (!chromium || !browserPath || !disp) {
  skip('缺 playwright / Chromium / Xvfb，B 组真实渲染跳过（A 组静态护栏仍全部生效）');
} else {
  let srv = null, browser = null;
  try {
    srv = await startServer();
    const port = srv.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const ext = [], jsErr = [], consoleErr = [];

    browser = await chromium.launch({
      headless: false,               // 关键：headless 下 SwiftShader 不创建 WebGL 上下文
      executablePath: browserPath,
      timeout: 30000,
      env: { ...process.env, DISPLAY: disp.display },
      args: [
        '--no-sandbox', '--disable-gpu-sandbox',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        // 断网：除本地服务外所有域名解析到 0.0.0.0
        `--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1`,
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:')) ext.push(u);
    });
    page.on('pageerror', (e) => jsErr.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text()); });
    // 统计真实 draw calls（hook WebGL1/2 的 draw* 入口）
    await page.addInitScript(() => {
      window.__b3dDraw = 0;
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
          if (typeof C.prototype[m] === 'function') {
            const o = C.prototype[m];
            C.prototype[m] = function (...a) { window.__b3dDraw++; return o.apply(this, a); };
          }
        }
      }
    });

    await page.goto(`${origin}/board3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2200);
    // 断网时账号体系 supabase CDN 失败会弹出登录墙遮罩；隐藏它以截取纯 3D 画布。
    // 这是账号体系边界（清单 A 组备注），不影响 3D 内核加载。
    await page.evaluate(() => { const w = document.getElementById('loginWall'); if (w) w.classList.add('hidden'); });
    await page.waitForTimeout(350);

    const envInfo = await page.evaluate(async () => {
      const T = await import('three');
      const cv = document.getElementById('b3d-canvas');
      const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl'));
      const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return {
        rev: T.REVISION, glVer: gl && gl.getParameter(gl.VERSION),
        renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '',
        isReady: !!(window.Board3D && window.Board3D.isReady()),
        draw: window.__b3dDraw,
        cam: window.Board3D && window.Board3D.getCameraSpec(),
      };
    });
    assert(envInfo.rev === '160', `本地 vendor Three.js r160 生效（REVISION=${envInfo.rev}）`);
    assert(/WebGL 2\.0/.test(envInfo.glVer || ''), `WebGL 2.0 上下文创建成功（${envInfo.glVer}）`);
    assert(/swiftshader/i.test(envInfo.renderer || ''), `SwiftShader 软件渲染就位（${envInfo.renderer.slice(0, 60)}…）`);
    assert(envInfo.isReady === true, 'board3dApi.isReady() === true（3D 内核真实就绪）');
    assert(envInfo.draw > 0, `renderer 真实出图：draw calls = ${envInfo.draw} > 0`);
    assert(!!envInfo.cam && [6, 5, 8].every((v, i) => Math.abs(envInfo.cam.position[i] - v) < 1e-6),
      '默认机位 (6,5,8) 与纯函数规格层一致（浮点容差 1e-6）');

    /** 截图 → 浏览器内 2D canvas 解码 → 仅回传统计值（避免大数组跨进程） */
    async function capture(asBaseline) {
      const buf = await page.locator('#b3d-canvas').screenshot();
      return await page.evaluate(async ({ data, setBase }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let nonBg = 0, total = 0; const colors = new Set();
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2]; total++;
          if (Math.abs(R - 245) > 14 || Math.abs(G - 247) > 14 || Math.abs(B - 251) > 14) nonBg++;
          if (total % 113 === 0) colors.add((R >> 3) + ',' + (G >> 3) + ',' + (B >> 3));
        }
        const diffTo = (ref) => {
          if (!ref || ref.length !== d.length) return null;
          let n = 0;
          for (let i = 0; i < d.length; i += 4 * 7) {
            if (Math.abs(d[i] - ref[i]) > 18 || Math.abs(d[i + 1] - ref[i + 1]) > 18 ||
                Math.abs(d[i + 2] - ref[i + 2]) > 18) n++;
          }
          return n;
        };
        const out = {
          w: c.width, h: c.height, ratio: +(nonBg / total).toFixed(4), colors: colors.size,
          diffFromPrev: diffTo(window.__b3dPrev), diffFromBase: diffTo(window.__b3dBase),
        };
        window.__b3dPrev = d;
        if (setBase) window.__b3dBase = d.slice();
        return out;
      }, { data: buf.toString('base64'), setBase: !!asBaseline });
    }

    const empty = await capture(false);
    assert(empty.w > 300 && empty.h > 300, `画布尺寸有效 ${empty.w}×${empty.h}`);
    assert(empty.ratio > 0.005, `空场景网格/坐标轴已出图：非背景像素 ${(empty.ratio * 100).toFixed(2)}%`);
    assert(empty.colors > 5, `画面含多色（坐标轴/网格）：采样色数 ${empty.colors}`);

    // 加典型空间几何体 + 顶点标注（覆盖 B1/B2/B4/D1 的像素层）
    const built = await page.evaluate(() => {
      const a = window.Board3D, ids = [];
      ids.push(a.add({ type: 'box', id: 'a9_box', pos: [-1.5, 0, 0], color: '#e0453a' }));
      ids.push(a.add({ type: 'pyramid', id: 'a9_pyr', pos: [1.5, 0, 0], color: '#2b6cd4' }));
      ids.push(a.add({ type: 'sphere', id: 'a9_sph', pos: [0, 1.8, 0], color: '#26a35b' }));
      ids.push(a.add({ type: 'label', id: 'a9_lab', pos: [0, 2.8, 0], text: '顶点 A' }));
      return { ids, types: a.getState().objects.map((o) => o.type) };
    });
    await page.waitForTimeout(650);
    const shapes = await capture(true);   // 作为「默认机位基线」
    assert(built.ids.every(Boolean) && built.types.length === 4, 'box/pyramid/sphere/label 四个对象成功加入场景');
    assert(shapes.ratio > empty.ratio * 1.3,
      `加图元后画面显著变化：非背景像素 ${(empty.ratio * 100).toFixed(2)}% → ${(shapes.ratio * 100).toFixed(2)}%`);
    assert(shapes.diffFromPrev > 500, `与空场景逐像素差异明显（${shapes.diffFromPrev} 个采样点）`);
    assert(shapes.colors > empty.colors, `彩色几何体提升画面色数 ${empty.colors} → ${shapes.colors}`);

    // 视角变换（C1）
    const front = await page.evaluate(() => {
      const a = window.Board3D; a.setCameraPreset('front'); return a.getCameraSpec();
    });
    await page.waitForTimeout(600);
    const frontShot = await capture(false);
    assert(Math.abs(front.position[0]) < 1e-6 && front.position[2] > 10,
      `「正视」预设把相机移到 +Z 轴（x≈0, z=${front.position[2].toFixed(3)}）`);
    assert(frontShot.diffFromPrev > 500, `视角切换后画面改变（${frontShot.diffFromPrev} 个采样点）`);
    assert(frontShot.diffFromBase > 500, '正视图与默认机位基线确实不同');

    // 复位（C2）：逐像素回到默认机位基线 + 相机三要素精确还原
    const reset = await page.evaluate(() => {
      const a = window.Board3D; a.resetView(); return a.getCameraSpec();
    });
    await page.waitForTimeout(650);
    const resetShot = await capture(false);
    assert(Math.abs(reset.position[0] - 6) < 1e-6 && Math.abs(reset.position[1] - 5) < 1e-6 &&
           Math.abs(reset.position[2] - 8) < 1e-6, 'resetView 后 position 精确回到 (6,5,8)');
    assert(reset.target.every((v) => Math.abs(v) < 1e-6) && reset.up[1] === 1,
      'resetView 后 target=(0,0,0)、up=+Y 同时复位');
    assert(resetShot.diffFromBase < 300,
      `复位后画面与默认机位基线逐像素一致（差异 ${resetShot.diffFromBase} 个采样点，≈0）`);

    // 断网：3D 内核零外部请求；账号体系 supabase 的失败属已知边界
    const threeExt = ext.filter((u) => /three|board3d/i.test(u));
    assert(threeExt.length === 0, `断网加载 three/3D 内核零外部请求（${threeExt.length} 个）`);
    const threeJsErr = jsErr.filter((e) => !/window\.supabase|createClient/i.test(e));
    assert(threeJsErr.length === 0, `3D 内核无 JS 异常（${threeJsErr.length} 个；supabase 账号体系断网报错已按 A 组备注排除）`);
    assert(ext.every((u) => /supabase/i.test(u)) || ext.length === 0,
      '断网时的外部请求仅来自账号体系 supabase CDN（不影响 3D 内核）');
    if (consoleErr.length) console.log(`  · 断网控制台错误 ${consoleErr.length} 条（账号体系 / CDN 预期内）`);

    // 可选：留一份像素目视证据到环境变量指定的路径
    if (process.env.A9_SCREENSHOT) {
      await page.screenshot({ path: process.env.A9_SCREENSHOT });
      console.log(`  · 像素目视截图已保存：${process.env.A9_SCREENSHOT}`);
    }
  } catch (e) {
    failed++;
    console.error('  ✗ B 组真实渲染异常：' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e)));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srv) await new Promise((r) => srv.close(r));
    if (disp && disp.own) { try { disp.own.kill(); } catch (_) { /* noop */ } }
  }
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}，跳过 ${skipped}`);
console.log('  （B 组 SKIP 仅表示当前环境缺 Xvfb/playwright/SwiftShader，不代表功能缺失；A 组护栏始终生效）');
process.exit(failed ? 1 : 0);

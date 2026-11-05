/* 工作台逻辑：文件列表 + 新建/打开/重命名/删除/导入导出 */
(function () {
  const CFG = window.DAJIAO_CONFIG || {};

  // ---------- 打开地址：3D 默认走自研画板（新旧路径并存）----------
  // 2D 一律 board.html（逻辑不变）；3D 默认 board3d.html（本地 Three.js，不依赖 appId / 大角 SDK）。
  // 旧路径 editor.html 完整保留，两种情形自动回退，保证历史数据不被破坏：
  //   1) 历史工程文件：content 存在但不是自研 3D 格式（缺 cmds 数组）→ 按大角 SDK 工程交给旧编辑器
  //   2) 显式开关：工作台 URL 加 ?engine=sdk，或 localStorage['b3d.engine'] === 'sdk' 可整体回退
  //      （?engine=self 则强制自研、忽略 localStorage；但不覆盖第 1 条的历史数据保护）
  // 硬约束：js/editor.js、editor.html、js/config.js 的 appId 与大角 SDK 引用一律不动。
  const B3D_ENGINE_KEY = 'b3d.engine';

  function isNative3DContent(content) {
    return !!(content && typeof content === 'object' && Array.isArray(content.cmds));
  }

  function legacy3DRequested() {
    try {
      const engine = new URLSearchParams(location.search).get('engine');
      if (engine === 'sdk') return true;
      if (engine === 'self') return false;
      return localStorage.getItem(B3D_ENGINE_KEY) === 'sdk';
    } catch (e) {
      return false;
    }
  }

  function resolve3dPage(f) {
    // 历史数据保护优先：不是自研 3D 格式就仍由旧编辑器打开，避免旧工程「打不开」
    if (f && f.content && !isNative3DContent(f.content)) return 'editor.html';
    if (legacy3DRequested()) return 'editor.html';
    return 'board3d.html';
  }

  function openUrl(f) {
    const page = f.mode === '3d' ? resolve3dPage(f) : 'board.html';
    return page + '?id=' + encodeURIComponent(f.id);
  }
  window.openBoardUrl = openUrl; // 供 landing.js 复用
  window.__b3dRoute = { isNative3DContent, legacy3DRequested, resolve3dPage }; // 便于控制台核对 / 回归测试

  // ---------- 配置状态（appId 只影响 3D） ----------
  function refreshConfigWarn() {
    const ok = CFG.appId && CFG.appId !== 'YOUR_APP_ID';
    const warn = document.getElementById('configWarn');
    if (warn) warn.hidden = !!ok;
  }

  // ---------- 文件列表渲染（卡片网格 + 命令缩略图） ----------
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const THUMB_W = 168, THUMB_H = 116, THUMB_PAD = 13;
  const THUMB_BLUE = '#3E44D9', THUMB_FILL = '#E0E7FF';

  /** 由保存的命令数组推算迷你预览 SVG；无内容时返回 null */
  function thumbSvg(cmds) {
    const pts = new Map(); // id -> [x, y]
    const shapes = [];
    for (const c of Array.isArray(cmds) ? cmds : []) {
      if (!c || typeof c !== 'object' || !c.id) continue;
      if (c.op === 'point' || c.op === 'glider') {
        const x = Number(c.x), y = Number(c.y);
        if (Number.isFinite(x) && Number.isFinite(y)) { pts.set(c.id, [x, y]); shapes.push({ t: 'dot', p: [x, y] }); }
      } else if (c.op === 'segment' && pts.has(c.from) && pts.has(c.to)) {
        shapes.push({ t: 'seg', a: pts.get(c.from), b: pts.get(c.to) });
      } else if ((c.op === 'line' || c.op === 'ray') && Array.isArray(c.through)) {
        const cs = c.through.map((id) => pts.get(id)).filter(Boolean);
        if (cs.length >= 2) shapes.push({ t: 'seg', a: cs[0], b: cs[1] });
      } else if (c.op === 'circle' && pts.has(c.center)) {
        const c0 = pts.get(c.center);
        let r = 1;
        if (c.through && pts.has(c.through) && String(c.through) !== String(c.center)) {
          const t = pts.get(c.through);
          r = Math.hypot(t[0] - c0[0], t[1] - c0[1]);
        } else if (Number.isFinite(Number(c.radius)) && Number(c.radius) > 0) r = Number(c.radius);
        if (r > 0) shapes.push({ t: 'circle', p: c0, r });
      } else if (c.op === 'polygon' && Array.isArray(c.points)) {
        const cs = c.points.map((id) => pts.get(id)).filter(Boolean);
        if (cs.length >= 3) shapes.push({ t: 'poly', ps: cs });
      } else if (c.op === 'arc' && pts.has(c.center) && pts.has(c.from) && pts.has(c.to)) {
        // 圆弧按 12 段折线采样逼近（缩略图够用）：from 点定半径，默认逆时针扫到 to
        const cc = pts.get(c.center), p1 = pts.get(c.from), p2 = pts.get(c.to);
        const r = Math.hypot(p1[0] - cc[0], p1[1] - cc[1]);
        if (r > 0) {
          const a1 = Math.atan2(p1[1] - cc[1], p1[0] - cc[0]);
          const a2 = Math.atan2(p2[1] - cc[1], p2[0] - cc[0]);
          let sweep = a2 - a1;
          if (c.clockwise) { if (sweep > 0) sweep -= 2 * Math.PI; }
          else if (sweep < 0) sweep += 2 * Math.PI;
          const ps = [];
          for (let k = 0; k <= 12; k++) { const a = a1 + (sweep * k) / 12; ps.push([cc[0] + r * Math.cos(a), cc[1] + r * Math.sin(a)]); }
          shapes.push({ t: 'arc', ps });
        }
      }
    }
    if (!shapes.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const eat = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
    for (const s of shapes) {
      if (s.t === 'dot') eat(s.p[0], s.p[1]);
      else if (s.t === 'circle') { eat(s.p[0] - s.r, s.p[1] - s.r); eat(s.p[0] + s.r, s.p[1] + s.r); }
      else if (s.t === 'seg') { eat(s.a[0], s.a[1]); eat(s.b[0], s.b[1]); }
      else if (s.t === 'poly') s.ps.forEach((p) => eat(p[0], p[1]));
      else if (s.t === 'arc') s.ps.forEach((p) => eat(p[0], p[1]));
    }
    const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((THUMB_W - 2 * THUMB_PAD) / spanX, (THUMB_H - 2 * THUMB_PAD) / spanY);
    const ox = (THUMB_W - spanX * scale) / 2, oy = (THUMB_H - spanY * scale) / 2;
    const tx = (x) => +(ox + (x - minX) * scale).toFixed(1);
    const ty = (y) => +(THUMB_H - (oy + (y - minY) * scale)).toFixed(1);
    const parts = [];
    for (const s of shapes) {
      if (s.t === 'dot') parts.push(`<circle cx="${tx(s.p[0])}" cy="${ty(s.p[1])}" r="2.8" fill="${THUMB_BLUE}"/>`);
      else if (s.t === 'seg') parts.push(`<line x1="${tx(s.a[0])}" y1="${ty(s.a[1])}" x2="${tx(s.b[0])}" y2="${ty(s.b[1])}" stroke="${THUMB_BLUE}" stroke-width="1.7" stroke-linecap="round"/>`);
      else if (s.t === 'circle') parts.push(`<circle cx="${tx(s.p[0])}" cy="${ty(s.p[1])}" r="${(s.r * scale).toFixed(1)}" fill="none" stroke="${THUMB_BLUE}" stroke-width="1.7"/>`);
      else if (s.t === 'poly') parts.push(`<polygon points="${s.ps.map((p) => tx(p[0]) + ',' + ty(p[1])).join(' ')}" fill="${THUMB_FILL}" fill-opacity=".85" stroke="${THUMB_BLUE}" stroke-width="1.7" stroke-linejoin="round"/>`);
      else if (s.t === 'arc') parts.push(`<path d="M ${s.ps.map((p) => tx(p[0]) + ' ' + ty(p[1])).join(' L ')}" fill="none" stroke="${THUMB_BLUE}" stroke-width="1.7"/>`);
    }
    return parts.join('');
  }

  /** 缩略图底板：淡网格；3D 文件给一个立方体占位符 */
  function thumbInner(f) {
    const gid = 'tg_' + f.id;
    const grid = `<defs><pattern id="${gid}" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#EDF1F7" stroke-width="1"/></pattern></defs><rect width="${THUMB_W}" height="${THUMB_H}" fill="#FDFEFF"/><rect width="${THUMB_W}" height="${THUMB_H}" fill="url(#${gid})"/>`;
    if (f.mode === '3d') {
      return grid + `<g fill="none" stroke="#A5B4FC" stroke-width="1.6" stroke-linejoin="round"><path d="M84 34 116 52 84 70 52 52Z"/><path d="M52 52v22l32 18V70"/><path d="M84 70v22"/></g>`;
    }
    const body = thumbSvg(f.content && f.content.c);
    if (body) return grid + body;
    return grid + `<g fill="none" stroke="#CBD5E1" stroke-width="1.6"><circle cx="84" cy="52" r="15"/><path d="M84 27v50M69 52h30" stroke-dasharray="3 3"/></g>`;
  }

  function render() {
    const list = Store.list();
    const box = document.getElementById('fileList');
    const empty = document.getElementById('emptyState');
    document.getElementById('fileCount').textContent = list.length ? `（${list.length} 个）` : '';
    box.innerHTML = '';
    empty.hidden = list.length > 0;

    list.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.dataset.id = f.id;

      const thumb = document.createElement('div');
      thumb.className = 'file-thumb';
      thumb.title = '点击打开';
      thumb.innerHTML = `<svg viewBox="0 0 ${THUMB_W} ${THUMB_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${thumbInner(f)}</svg><span class="file-open-layer"><span>打开</span></span>`;
      thumb.addEventListener('click', () => { location.href = openUrl(f); });

      const badge = document.createElement('span');
      badge.className = 'file-badge ' + (f.mode === '3d' ? 'mode-3d' : 'mode-2d');
      badge.textContent = f.mode === '3d' ? '3D' : '2D';
      thumb.appendChild(badge);

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = f.name;
      name.title = '双击重命名';
      name.addEventListener('dblclick', () => startRename(card, f));

      const time = document.createElement('div');
      time.className = 'file-time';
      time.textContent = '更新于 ' + fmtTime(f.updatedAt);

      const info = document.createElement('div');
      info.className = 'file-info';
      info.append(name, time);

      const ops = document.createElement('div');
      ops.className = 'file-actions';

      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn btn-primary btn-sm';
      btnOpen.textContent = '打开';
      btnOpen.addEventListener('click', () => { location.href = openUrl(f); });

      const btnExport = document.createElement('button');
      btnExport.className = 'btn btn-ghost btn-sm';
      btnExport.textContent = '导出原文件';
      btnExport.title = '导出 .json 工程文件';
      btnExport.addEventListener('click', () => Store.exportFile(f.id));

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm btn-danger';
      btnDel.textContent = '删除';
      btnDel.addEventListener('click', () => {
        if (confirm(`确定删除「${f.name}」？此操作不可恢复（建议先导出备份）。`)) {
          Store.remove(f.id);
          render();
        }
      });

      ops.append(btnOpen, btnExport, btnDel);

      // 新旧路径并存：3D 文件额外提供旧版（大角 SDK / editor.html）入口，
      // 便于打开历史工程或在自研画板异常时回退；appId 与 SDK 引用本身不作任何改动。
      if (f.mode === '3d') {
        const btnLegacy = document.createElement('button');
        btnLegacy.className = 'btn btn-ghost btn-sm';
        btnLegacy.textContent = '旧版打开';
        btnLegacy.title = '用大角几何 SDK 编辑器打开（需 appId）。3D 默认已切换为不依赖外站的自研画板，此入口仅用于历史工程与回退。';
        btnLegacy.addEventListener('click', () => {
          location.href = 'editor.html?id=' + encodeURIComponent(f.id);
        });
        ops.appendChild(btnLegacy);
      }

      card.append(thumb, info, ops);
      box.appendChild(card);
    });
  }

  function startRename(card, file) {
    const cell = card.querySelector('.file-name');
    const input = document.createElement('input');
    input.value = file.name;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      Store.rename(file.id, input.value);
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = file.name; input.blur(); }
      e.stopPropagation();
    });
  }

  // ---------- 新建 / 导入（需登录）----------
  document.getElementById('btnNew2d').addEventListener('click', () => Auth.requireLogin(() => {
    const f = Store.create('平面画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '2d');
    location.href = openUrl(f);
  }));
  document.getElementById('btnNew3d').addEventListener('click', () => Auth.requireLogin(() => {
    const f = Store.create('立体画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '3d');
    location.href = openUrl(f);
  }));
  // 顶栏「＋ 新建画板」：真按钮，点击直接建平面画板（原为锚点链接只滚动页面）
  const navNew = document.getElementById('navNewBoard');
  if (navNew) navNew.addEventListener('click', () => Auth.requireLogin(() => {
    const f = Store.create('平面画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '2d');
    location.href = openUrl(f);
  }));

  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnImport').addEventListener('click', () => Auth.requireLogin(() => fileInput.click()));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      await Store.importFile(file);
      render();
    } catch (e) {
      alert(e.message);
    } finally {
      fileInput.value = '';
    }
  });

  refreshConfigWarn();
  render();
})();

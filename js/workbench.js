/* 工作台逻辑：文件列表 + 新建/打开/重命名/删除/导入导出 */
(function () {
  const CFG = window.DAJIAO_CONFIG || {};

  // 打开地址：3D 走 SDK 编辑器（路线A），其余走自建画板（路线B）
  function openUrl(f) {
    const page = f.mode === '3d' ? 'editor.html' : 'board.html';
    return page + '?id=' + encodeURIComponent(f.id);
  }
  window.openBoardUrl = openUrl; // 供 landing.js 复用

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

  // ---------- 新建 / 导入 ----------
  document.getElementById('btnNew2d').addEventListener('click', () => {
    const f = Store.create('平面画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '2d');
    location.href = openUrl(f);
  });
  document.getElementById('btnNew3d').addEventListener('click', () => {
    const f = Store.create('立体画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '3d');
    location.href = openUrl(f);
  });

  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnImport').addEventListener('click', () => fileInput.click());
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

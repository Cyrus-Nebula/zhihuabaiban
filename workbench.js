/* 工作台逻辑：文件列表 + 新建/打开/重命名/删除/导入导出 */
(function () {
  const CFG = window.DAJIAO_CONFIG || {};

  // ---------- 配置状态 ----------
  function refreshConfigBadge() {
    const ok = CFG.appId && CFG.appId !== 'YOUR_APP_ID';
    const badge = document.getElementById('configBadge');
    badge.textContent = ok ? 'appId 已配置' : 'appId 未配置';
    badge.className = 'badge ' + (ok ? 'badge-ok' : 'badge-warn');
    document.getElementById('configWarn').hidden = !!ok;
  }

  // ---------- 文件列表渲染 ----------
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function render() {
    const list = Store.list();
    const box = document.getElementById('fileList');
    const empty = document.getElementById('emptyState');
    document.getElementById('fileCount').textContent = list.length ? `（${list.length} 个）` : '';
    box.innerHTML = '';
    empty.hidden = list.length > 0;

    list.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.dataset.id = f.id;

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = f.name;
      name.title = '双击重命名';
      name.addEventListener('dblclick', () => startRename(row, f));

      const mode = document.createElement('div');
      mode.className = 'mode-tag ' + (f.mode === '3d' ? 'mode-3d' : 'mode-2d');
      mode.textContent = f.mode === '3d' ? '3D' : '2D';

      const time = document.createElement('div');
      time.className = 'file-time';
      time.textContent = fmtTime(f.updatedAt);

      const ops = document.createElement('div');
      ops.className = 'file-ops';

      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn btn-primary btn-sm';
      btnOpen.textContent = '打开';
      btnOpen.addEventListener('click', () => {
        location.href = 'editor.html?id=' + encodeURIComponent(f.id);
      });

      const btnExport = document.createElement('button');
      btnExport.className = 'btn btn-ghost btn-sm';
      btnExport.textContent = '导出';
      btnExport.addEventListener('click', () => Store.exportFile(f.id));

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-danger';
      btnDel.textContent = '删除';
      btnDel.addEventListener('click', () => {
        if (confirm(`确定删除「${f.name}」？此操作不可恢复（建议先导出备份）。`)) {
          Store.remove(f.id);
          render();
        }
      });

      ops.append(btnOpen, btnExport, btnDel);
      row.append(name, mode, time, ops);
      box.appendChild(row);
    });
  }

  function startRename(row, file) {
    const cell = row.querySelector('.file-name');
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
    location.href = 'editor.html?id=' + encodeURIComponent(f.id);
  });
  document.getElementById('btnNew3d').addEventListener('click', () => {
    const f = Store.create('立体画板 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }), '3d');
    location.href = 'editor.html?id=' + encodeURIComponent(f.id);
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

  refreshConfigBadge();
  render();
})();

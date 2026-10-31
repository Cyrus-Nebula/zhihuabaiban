/**
 * 智绘几何 · 账号与云端同步（经典脚本，挂在 window.Auth；在 store.js 之后加载）
 *
 * 能力：
 *   - /api/auth/* 的注册/登录/登出/当前用户态
 *   - 登录弹窗（邮箱 + 密码，登录/注册双 Tab）
 *   - 导航栏登录态（未登录显示「登录」，已登录显示邮箱 + 下拉菜单）
 *   - 云端画板：列表 / 打开 / 删除 / 同步（首页「云端画板」区 + 画板页自动同步）
 *
 * 设计：所有网络请求都做了容错——后端未部署/数据库未绑定时，页面照常可用
 * （仅云端相关功能不可用，并给出友好提示），绝不阻断本地作图。
 */
window.Auth = (function () {
  const state = { user: null, ready: false };
  const listeners = [];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.message || data.error || ('HTTP ' + r.status));
      err.code = data.error;
      throw err;
    }
    return data;
  }

  /* ---------- 对外 API ---------- */
  function onChange(cb) { listeners.push(cb); }
  function emit() { state.ready = true; listeners.forEach((cb) => cb(state.user)); }

  async function me() { return getJSON('/api/auth/me'); }
  async function login(email, password) {
    return getJSON('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  async function register(email, password) {
    return getJSON('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    state.user = null;
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    emit();
  }

  async function listBoards() { return getJSON('/api/boards'); }
  async function deleteBoard(id) {
    return getJSON('/api/boards/' + encodeURIComponent(id), { method: 'DELETE' });
  }
  async function syncBoard(board) {
    return getJSON('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(board),
    });
  }
  /** 打开云端画板：拉取内容 → 落到本地（保持同一 id）→ 跳转画板页 */
  async function openCloudBoard(id) {
    const data = await getJSON('/api/boards/' + encodeURIComponent(id));
    Store.upsert({ id: data.id, name: data.name, mode: data.mode, content: data.content });
    location.href = 'board.html?id=' + encodeURIComponent(data.id);
  }
  /** 把本地所有画板推到云端 */
  async function syncAllLocal(onOne) {
    const list = Store.list();
    let done = 0, fail = 0;
    for (const f of list) {
      try {
        await syncBoard({ id: f.id, name: f.name, mode: f.mode, content: f.content });
        done++;
      } catch (_) {
        fail++;
      }
      if (onOne) onOne(done, fail, list.length);
    }
    return { done, fail, total: list.length };
  }

  /* ---------- 登录弹窗 ---------- */
  function injectModal() {
    if ($('authModal')) return;
    const m = el('div', 'auth-modal hidden');
    m.id = 'authModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card">
        <button class="auth-x" type="button" data-close aria-label="关闭">×</button>
        <div class="auth-tabs">
          <button type="button" class="auth-tab active" data-tab="login">登录</button>
          <button type="button" class="auth-tab" data-tab="signup">注册</button>
        </div>
        <form id="authForm" autocomplete="on">
          <label class="auth-field">
            <span>邮箱</span>
            <input type="email" id="authEmail" required placeholder="you@example.com" autocomplete="username" />
          </label>
          <label class="auth-field">
            <span>密码</span>
            <input type="password" id="authPw" required minlength="8" placeholder="至少 8 位" autocomplete="current-password" />
          </label>
          <p class="auth-err" id="authErr"></p>
          <button type="submit" class="btn btn-primary auth-submit" id="authSubmit">登录</button>
        </form>
        <p class="auth-hint">本账号仅用于把你的画板备份到云端、跨设备同步。密码以加盐哈希存储，服务端无法还原明文。</p>
      </div>`;
    document.body.appendChild(m);

    let tab = 'login';
    m.querySelectorAll('.auth-tab').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab;
        m.querySelectorAll('.auth-tab').forEach((x) => x.classList.toggle('active', x === b));
        $('authSubmit').textContent = tab === 'login' ? '登录' : '注册并登录';
        $('authPw').setAttribute('autocomplete', tab === 'login' ? 'current-password' : 'new-password');
        $('authErr').textContent = '';
      })
    );
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) closeModal(); });

    $('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('authEmail').value.trim();
      const pw = $('authPw').value;
      const errEl = $('authErr');
      errEl.textContent = '';
      const btn = $('authSubmit');
      btn.disabled = true;
      try {
        const data = tab === 'login' ? await login(email, pw) : await register(email, pw);
        state.user = data.user || { email };
        emit();
        closeModal();
      } catch (err) {
        errEl.textContent = err.message || '操作失败，请重试';
      } finally {
        btn.disabled = false;
      }
    });
  }
  function openLogin() { injectModal(); $('authModal').classList.remove('hidden'); setTimeout(() => $('authEmail') && $('authEmail').focus(), 30); }
  function openSignup() {
    injectModal();
    const m = $('authModal');
    m.classList.remove('hidden');
    m.querySelectorAll('.auth-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'signup'));
    $('authSubmit').textContent = '注册并登录';
    $('authPw').setAttribute('autocomplete', 'new-password');
  }
  function closeModal() { const m = $('authModal'); if (m) m.classList.add('hidden'); }

  /* ---------- 导航登录态 ---------- */
  let menuEl = null;
  function buildMenu() {
    if (menuEl || !state.user) return;
    const btn = $('authBtn');
    if (!btn) { menuEl = true; return; }
    menuEl = el('div', 'auth-menu hidden');
    menuEl.innerHTML = `
      <div class="auth-menu-head">${esc(state.user.email || '已登录')}</div>
      <button type="button" class="auth-menu-item" data-act="logout">退出登录</button>`;
    if ($('cloudSection')) {
      const cloud = el('button', 'auth-menu-item');
      cloud.type = 'button';
      cloud.dataset.act = 'cloud';
      cloud.textContent = '我的云端画板';
      cloud.addEventListener('click', () => {
        closeMenu();
        const sec = $('cloudSection');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      menuEl.insertBefore(cloud, menuEl.querySelector('[data-act="logout"]'));
    }
    btn.insertAdjacentElement('afterend', menuEl);
    menuEl.querySelector('[data-act="logout"]').addEventListener('click', () => { closeMenu(); logout(); });
  }
  function closeMenu() { if (menuEl && menuEl.classList) menuEl.classList.add('hidden'); }
  function renderNav() {
    const btn = $('authBtn');
    if (!btn) return;
    if (state.user) {
      btn.textContent = (state.user.email || '已登录').split('@')[0];
      btn.classList.add('is-user');
      btn.onclick = (e) => {
        e.stopPropagation();
        if (menuEl) menuEl.classList.toggle('hidden');
      };
      buildMenu();
    } else {
      btn.textContent = '登录';
      btn.classList.remove('is-user');
      btn.onclick = openLogin;
    }
  }
  document.addEventListener('click', () => closeMenu());

  /* ---------- 首页：云端画板区 ---------- */
  async function renderCloud() {
    const sec = $('cloudSection');
    if (!sec) return;
    if (!state.user) { sec.hidden = true; return; }
    sec.hidden = false;
    const listEl = $('cloudList');
    const emptyEl = $('cloudEmpty');
    listEl.innerHTML = '<div class="cloud-loading">加载中…</div>';
    emptyEl.hidden = true;
    try {
      const boards = await listBoards();
      listEl.innerHTML = '';
      if (!boards.length) { emptyEl.hidden = false; return; }
      boards.forEach((b) => {
        const row = el('div', 'cloud-row');
        row.innerHTML = `
          <button type="button" class="cloud-name" title="打开">${esc(b.name)}</button>
          <span class="cloud-mode ${b.mode === '3d' ? 'mode-3d' : 'mode-2d'}">${b.mode === '3d' ? '3D' : '2D'}</span>
          <span class="cloud-time">${fmtTime(b.updatedAt)}</span>
          <button type="button" class="cloud-del btn btn-ghost btn-sm" title="删除云端副本">删除</button>`;
        row.querySelector('.cloud-name').addEventListener('click', () => openCloudBoard(b.id).catch(showCloudErr));
        row.querySelector('.cloud-del').addEventListener('click', async () => {
          if (!confirm(`删除云端画板「${b.name}」？本地副本不受影响。`)) return;
          try { await deleteBoard(b.id); renderCloud(); } catch (e) { showCloudErr(e); }
        });
        listEl.appendChild(row);
      });
    } catch (e) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      showCloudErr(e);
    }
  }
  function showCloudErr(e) {
    const note = $('cloudNote');
    if (!note) return;
    note.textContent = '云端不可用：' + (e && e.message ? e.message : '请检查部署配置');
    note.hidden = false;
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ---------- 画板页：自动同步 + 手动按钮 ---------- */
  let lastSaved = 0;
  function bindBoardSync() {
    const syncBtn = $('btn-cloud');
    if (!syncBtn) return;
    syncBtn.addEventListener('click', () => syncCurrent(syncBtn));
    window.addEventListener('board:saved', (e) => {
      if (!state.user || !syncBtn) return;
      syncCurrent(syncBtn, e.detail);
    });
  }
  async function syncCurrent(btn, detail) {
    if (!state.user) return;
    const id = (detail && detail.id) || new URLSearchParams(location.search).get('id');
    if (!id) return;
    const name = (detail && detail.name) || ($('doc-name') && $('doc-name').value) || '未命名画板';
    const content = (detail && detail.content) || (window.__dajiao && window.__dajiao.getDoc && window.__dajiao.getDoc());
    const mode = (detail && detail.mode) || '2d';
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      await syncBoard({ id, name, mode, content });
      btn.textContent = '已同步 ✓';
    } catch (err) {
      btn.textContent = '同步失败';
      showToast('云端同步失败：' + (err.message || '请稍后重试'));
    } finally {
      btn.disabled = false;
      setTimeout(() => { if (btn.textContent !== '同步中…') btn.textContent = prev; }, 1800);
    }
  }
  let toastTimer = null;
  function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    injectModal();
    renderNav();
    bindBoardSync();
    if ($('cloudSyncAll')) {
      $('cloudSyncAll').addEventListener('click', async () => {
        const btn = $('cloudSyncAll');
        btn.disabled = true;
        const r = await syncAllLocal().catch(() => ({ done: 0, fail: 1, total: 0 }));
        btn.disabled = false;
        renderCloud();
        const note = $('cloudNote');
        if (note) { note.textContent = `已同步 ${r.done} 个${r.fail ? `，${r.fail} 个失败` : ''}`; note.hidden = false; }
      });
    }
    onChange(() => { renderNav(); renderCloud(); });

    me()
      .then((u) => { if (u && u.authenticated) state.user = { userId: u.userId, email: u.email }; })
      .catch(() => {})
      .finally(() => emit());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    get user() { return state.user; },
    get ready() { return state.ready; },
    onChange, login, register, logout, me,
    listBoards, deleteBoard, syncBoard, openCloudBoard, syncAllLocal,
    openLogin, openSignup,
  };
})();

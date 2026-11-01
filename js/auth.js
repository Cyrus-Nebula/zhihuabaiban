/**
 * 智绘几何 · 账号与云端同步（Supabase 版，挂在 window.Auth；在 store.js 之后加载）
 *
 * 能力：
 *   - 注册 / 登录 / 登出 / 当前用户态（supabase.auth）
 *   - 登录弹窗（邮箱 + 密码，登录/注册双 Tab）
 *   - 导航栏登录态（未登录显示「登录」，已登录显示头像 + 下拉菜单）
 *   - 云端画板：列表 / 打开 / 删除 / 同步（首页「云端画板」区 + 画板页自动同步）
 *   - 会员激活码兑换、管理员操作（走 Supabase 存储过程，见 supabase/setup.sql）
 *
 * 设计：所有网络请求都做了容错——Supabase 未配置/建表未完成时，页面照常可用
 * （仅云端相关功能不可用，并给出友好提示），绝不阻断本地作图。
 */
window.Auth = (function () {
  // ---- Supabase 客户端（CDN 版本 >=2，已在 HTML 中引入）----
  const { createClient } = window.supabase;
  const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

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
  function errText(code) {
    return ({
      unauthenticated: '请先登录',
      invalid_code: '激活码无效',
      code_disabled: '该激活码已被停用',
      code_used: '该激活码已被使用',
      missing_code: '请输入激活码',
    })[code] || '兑换失败';
  }

  /* ---------- 用户态加载 ---------- */
  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    return {
      userId: user.id,
      email: user.email || (p && p.email),
      name: (p && p.display_name) || (user.email ? user.email.split('@')[0] : ''),
      role: (p && p.role) || 'user',
      membership: (p && p.membership) || 'none',
    };
  }

  /* ---------- 对外 API ---------- */
  function onChange(cb) { listeners.push(cb); }
  function emit() { state.ready = true; listeners.forEach((cb) => cb(state.user)); }

  async function me() {
    const u = await loadUser();
    return u ? { authenticated: true, ...u } : { authenticated: false };
  }
  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { const e = new Error(error.message || '登录失败'); e.code = 'login_failed'; throw e; }
    const user = await loadUser();
    return { user };
  }
  async function register(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { const e = new Error(error.message || '注册失败'); e.code = 'register_failed'; throw e; }
    if (!data.session) {
      const e = new Error('注册成功，请查收验证邮件后登录');
      e.code = 'email_confirm_required';
      throw e;
    }
    const user = await loadUser();
    return { user };
  }
  async function logout() {
    try { await supabase.auth.signOut(); } catch (_) {}
    state.user = null;
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    emit();
  }
  async function changePassword(oldPassword, newPassword) {
    const cur = state.user && state.user.email;
    if (cur) {
      const { error: ve } = await supabase.auth.signInWithPassword({ email: cur, password: oldPassword });
      if (ve) { const e = new Error('当前密码错误'); e.code = 'bad_old'; throw e; }
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { const e = new Error(error.message || '修改失败'); e.code = 'update_failed'; throw e; }
  }
  async function deleteAccount(password) {
    const cur = state.user && state.user.email;
    if (cur) {
      const { error: ve } = await supabase.auth.signInWithPassword({ email: cur, password });
      if (ve) { const e = new Error('密码错误'); e.code = 'bad_password'; throw e; }
    }
    const { error } = await supabase.rpc('delete_self_account');
    if (error) { const e = new Error(error.message || '删除失败'); e.code = 'delete_failed'; throw e; }
    state.user = null;
  }
  async function forgotPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + '/reset.html',
    });
    if (error) { const e = new Error(error.message || '生成失败'); e.code = 'reset_failed'; throw e; }
    return { ok: true };
  }
  async function redeemCode(code) {
    const { data, error } = await supabase.rpc('redeem_activation_code', { p_code: code });
    if (error) { const e = new Error(error.message || '兑换失败'); e.code = 'redeem_failed'; throw e; }
    if (data && data.ok === false) { const e = new Error(errText(data.error)); e.code = data.error; throw e; }
    return data || { ok: true };
  }
  async function membershipMe() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { membership: 'none' };
    const { data } = await supabase.from('profiles').select('membership').eq('id', user.id).maybeSingle();
    return { membership: (data && data.membership) || 'none' };
  }
  async function getProviders() {
    try {
      const res = await fetch(window.SUPABASE_URL + '/auth/v1/settings?apikey=' + window.SUPABASE_ANON_KEY);
      const j = await res.json();
      const ext = (j && j.external) || {};
      const map = { google: 'Google', github: 'GitHub' };
      const providers = {};
      Object.keys(map).forEach((k) => { if (ext[k]) providers[k] = { label: map[k] }; });
      return { providers };
    } catch (_) {
      return { providers: {} };
    }
  }

  async function listBoards() {
    const { data, error } = await supabase.from('boards').select('*').order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((b) => ({
      id: b.id, name: b.name, mode: b.mode, updatedAt: (b.updated_at || 0) * 1000,
    }));
  }
  async function deleteBoard(id) {
    const { error } = await supabase.from('boards').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  async function syncBoard(board) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const now = Math.floor(Date.now() / 1000);
    const { error } = await supabase.from('boards').upsert({
      id: board.id,
      user_id: user.id,
      name: board.name || '未命名画板',
      mode: board.mode || '2d',
      content: board.content,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  /** 打开云端画板：拉取内容 → 落到本地（保持同一 id）→ 跳转画板页 */
  async function openCloudBoard(id) {
    const { data, error } = await supabase.from('boards').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('画板不存在');
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
        <p class="auth-alt"><a href="#" id="authForgot">忘记密码？</a></p>
        <div class="auth-oauth" id="oauthBox"></div>
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

    const forgotLink = $('authForgot');
    if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); closeModal(); openForgot(); });

    $('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('authEmail').value.trim();
      const pw = $('authPw').value;
      const errEl = $('authErr');
      errEl.textContent = '';
      const btn = $('authSubmit');
      btn.disabled = true;
      let caught = null;
      try {
        const data = tab === 'login' ? await login(email, pw) : await register(email, pw);
        state.user = data.user || { email };
        emit();
        closeModal();
      } catch (err) {
        caught = err;
        errEl.textContent = err.message || '操作失败，请重试';
      } finally {
        if (caught && caught.code === 'too_many_attempts') {
          let left = 30;
          const tick = () => {
            btn.textContent = left + ' 秒后可重试';
            if (left <= 0) { btn.disabled = false; btn.textContent = tab === 'login' ? '登录' : '注册并登录'; return; }
            left--;
            setTimeout(tick, 1000);
          };
          tick();
        } else {
          btn.disabled = false;
        }
      }
    });
  }
  function openLogin() { injectModal(); $('authModal').classList.remove('hidden'); setTimeout(() => $('authEmail') && $('authEmail').focus(), 30); renderOAuth(); }
  function openSignup() {
    injectModal();
    const m = $('authModal');
    m.classList.remove('hidden');
    m.querySelectorAll('.auth-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'signup'));
    $('authSubmit').textContent = '注册并登录';
    $('authPw').setAttribute('autocomplete', 'new-password');
    renderOAuth();
  }
  /** 登录后才执行：已登录立即执行 cb；未登录弹登录框，登录成功后自动执行。用于「必须登录才能使用」的入口拦截 */
  function requireLogin(cb) {
    if (state.user) { try { cb(); } catch (e) { console.error(e); } return; }
    openLogin();
    const handler = (u) => {
      if (!u) return;
      const i = listeners.indexOf(handler);
      if (i >= 0) listeners.splice(i, 1);
      try { cb(); } catch (e) { console.error(e); }
    };
    listeners.push(handler);
  }
  /** 渲染已配置的第三方登录按钮（无配置则不显示） */
  async function renderOAuth() {
    const box = $('oauthBox');
    if (!box) return;
    let data;
    try { data = await getProviders(); } catch { data = { providers: {} }; }
    const providers = (data && data.providers) || {};
    const keys = Object.keys(providers);
    if (!keys.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="auth-oauth-sep"><span>或使用第三方账号</span></div>';
    keys.forEach((k) => {
      const b = el('button', 'auth-oauth-btn', '继续使用 ' + (providers[k].label || k));
      b.type = 'button';
      b.dataset.provider = k;
      b.addEventListener('click', async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: k,
          options: { redirectTo: location.origin + '/' },
        });
        if (error) showToast('第三方登录失败：' + error.message);
      });
      box.appendChild(b);
    });
  }
  function closeModal() { const m = $('authModal'); if (m) m.classList.add('hidden'); }

  /* ---------- 修改密码弹窗 ---------- */
  function injectChangePwModal() {
    if ($('cpModal')) return;
    const m = el('div', 'auth-modal hidden');
    m.id = 'cpModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card">
        <button class="auth-x" type="button" data-close aria-label="关闭">×</button>
        <h3 class="auth-title">修改密码</h3>
        <form id="cpForm">
          <label class="auth-field"><span>当前密码</span><input type="password" id="cpOld" required autocomplete="current-password" /></label>
          <label class="auth-field"><span>新密码（至少 8 位）</span><input type="password" id="cpNew" required minlength="8" autocomplete="new-password" /></label>
          <label class="auth-field"><span>确认新密码</span><input type="password" id="cpNew2" required minlength="8" autocomplete="new-password" /></label>
          <p class="auth-err" id="cpErr"></p>
          <button type="submit" class="btn btn-primary auth-submit" id="cpSubmit">确认修改</button>
        </form>
        <p class="auth-hint">修改后本设备保持登录，其他设备的登录会自动失效。</p>
      </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => m.classList.add('hidden')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) m.classList.add('hidden'); });
    m.querySelector('#cpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldP = $('cpOld').value;
      const newP = $('cpNew').value;
      const newP2 = $('cpNew2').value;
      const errEl = $('cpErr');
      errEl.textContent = '';
      if (newP !== newP2) { errEl.textContent = '两次输入的新密码不一致'; return; }
      if (newP.length < 8) { errEl.textContent = '新密码至少 8 位'; return; }
      const btn = $('cpSubmit');
      btn.disabled = true;
      try {
        await changePassword(oldP, newP);
        m.classList.add('hidden');
        $('cpForm').reset();
        showToast('密码已修改，已重新登录');
      } catch (err) {
        errEl.textContent = err.message || '修改失败，请重试';
      } finally {
        btn.disabled = false;
      }
    });
  }
  function openChangePw() { injectChangePwModal(); const m = $('cpModal'); m.classList.remove('hidden'); setTimeout(() => { const i = $('cpOld'); if (i) i.focus(); }, 30); }

  /* ---------- 删除账号弹窗 ---------- */
  function injectDeleteModal() {
    if ($('delModal')) return;
    const m = el('div', 'auth-modal hidden');
    m.id = 'delModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card">
        <button class="auth-x" type="button" data-close aria-label="关闭">×</button>
        <h3 class="auth-title">删除账号</h3>
        <p class="auth-warn">此操作不可恢复：账号及其全部云端画板将被永久删除，本地浏览器中的画板不受影响。</p>
        <form id="delForm">
          <label class="auth-field"><span>输入密码确认</span><input type="password" id="delPw" required autocomplete="current-password" /></label>
          <p class="auth-err" id="delErr"></p>
          <button type="submit" class="btn auth-submit btn-danger" id="delSubmit">永久删除账号</button>
        </form>
      </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => m.classList.add('hidden')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) m.classList.add('hidden'); });
    m.querySelector('#delForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('delPw').value;
      const errEl = $('delErr');
      errEl.textContent = '';
      const btn = $('delSubmit');
      btn.disabled = true;
      try {
        await deleteAccount(pw);
        m.classList.add('hidden');
        $('delForm').reset();
        if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
        menuEl = null;
        emit();
        showToast('账号已删除');
      } catch (err) {
        errEl.textContent = err.message || '删除失败，请重试';
      } finally {
        btn.disabled = false;
      }
    });
  }
  function openDelete() { injectDeleteModal(); const m = $('delModal'); m.classList.remove('hidden'); setTimeout(() => { const i = $('delPw'); if (i) i.focus(); }, 30); }

  /* ---------- 找回密码弹窗 ---------- */
  function injectForgotModal() {
    if ($('fpModal')) return;
    const m = el('div', 'auth-modal hidden');
    m.id = 'fpModal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card">
        <button class="auth-x" type="button" data-close aria-label="关闭">×</button>
        <h3 class="auth-title">找回密码</h3>
        <p class="auth-hint">输入注册邮箱，系统会向该邮箱发送一封重置邮件。请在邮件中打开重置链接，并设置新密码。</p>
        <form id="fpForm">
          <label class="auth-field"><span>邮箱</span><input type="email" id="fpEmail" required autocomplete="username" placeholder="you@example.com" /></label>
          <p class="auth-err" id="fpErr"></p>
          <button type="submit" class="btn btn-primary auth-submit" id="fpSubmit">发送重置邮件</button>
        </form>
        <div class="auth-reset-result hidden" id="fpResult">
          <p>重置邮件已发送，请查收 <strong id="fpEmailShown"></strong> 的收件箱，点击邮件中的链接设置新密码。</p>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => m.classList.add('hidden')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) m.classList.add('hidden'); });
    m.querySelector('#fpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('fpEmail').value.trim();
      const errEl = $('fpErr'); errEl.textContent = '';
      const btn = $('fpSubmit'); btn.disabled = true;
      try {
        await forgotPassword(email);
        $('fpResult').classList.remove('hidden');
        $('fpEmailShown').textContent = email;
        $('fpForm').hidden = true;
      } catch (err) {
        errEl.textContent = err.message || '发送失败，请重试';
      } finally { btn.disabled = false; }
    });
  }
  function openForgot() { injectForgotModal(); const m = $('fpModal'); m.classList.remove('hidden'); setTimeout(() => { const i = $('fpEmail'); if (i) i.focus(); }, 30); }

  /* ---------- 会员中心弹窗 ---------- */
  function injectMembershipModal() {
    if ($('mbModal')) return;
    const m = el('div', 'auth-modal hidden');
    m.id = 'mbModal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card">
        <button class="auth-x" type="button" data-close aria-label="关闭">×</button>
        <h3 class="auth-title">会员中心</h3>
        <div class="mb-status" id="mbStatus">加载中…</div>
        <p class="auth-hint">会员制度将于 2030 年正式启用。现在即可凭「长期会员激活码」提前激活，激活后永久有效。</p>
        <form id="mbForm">
          <label class="auth-field"><span>激活码</span><input type="text" id="mbCode" placeholder="输入 12 位激活码" autocomplete="off" /></label>
          <p class="auth-err" id="mbErr"></p>
          <button type="submit" class="btn btn-primary auth-submit" id="mbSubmit">激活会员</button>
        </form>
      </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => m.classList.add('hidden')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) m.classList.add('hidden'); });
    m.querySelector('#mbForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = $('mbCode').value.trim().toUpperCase().replace(/\s+/g, '');
      const errEl = $('mbErr'); errEl.textContent = '';
      const btn = $('mbSubmit'); btn.disabled = true;
      try {
        await redeemCode(code);
        if (state.user) state.user.membership = 'lifetime';
        renderVipBadge(); emit();
        m.classList.add('hidden');
        showToast('已激活为长期会员');
      } catch (err) {
        errEl.textContent = err.message || '激活失败，请检查激活码';
      } finally { btn.disabled = false; }
    });
  }
  function openMembership() {
    injectMembershipModal();
    const m = $('mbModal'); m.classList.remove('hidden');
    renderMbStatus();
    setTimeout(() => { const i = $('mbCode'); if (i) i.focus(); }, 30);
  }
  async function renderMbStatus() {
    const s = $('mbStatus'); if (!s) return;
    if (!state.user) { s.textContent = '请先登录'; return; }
    if (state.user.membership === 'lifetime') { s.innerHTML = '<span class="mb-vip">您已是长期会员</span>'; return; }
    try {
      const info = await membershipMe();
      if (info && info.membership === 'lifetime') {
        s.innerHTML = '<span class="mb-vip">您已是长期会员</span>';
        if (state.user) state.user.membership = 'lifetime';
        renderVipBadge();
      } else s.textContent = '当前为免费用户';
    } catch { s.textContent = '当前为免费用户'; }
  }

  /* ---------- 导航登录态 ---------- */
  let menuEl = null;
  function buildMenu() {
    if (menuEl || !state.user) return;
    const btn = $('authBtn');
    if (!btn) { menuEl = true; return; }
    menuEl = el('div', 'auth-menu hidden');
    const head = el('div', 'auth-menu-head');
    head.textContent = state.user.name || state.user.email || '已登录';
    menuEl.appendChild(head);
    if ($('cloudSection')) {
      addMenuItem('我的云端画板', () => { closeMenu(); const sec = $('cloudSection'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }
    if (state.user.role === 'admin') {
      addMenuItem('管理后台', () => { closeMenu(); location.href = 'admin.html'; });
    }
    addMenuItem('会员中心', () => { closeMenu(); openMembership(); });
    addMenuItem('修改密码', () => { closeMenu(); openChangePw(); });
    addMenuItem('删除账号', () => { closeMenu(); openDelete(); }, true);
    addMenuItem('退出登录', () => { closeMenu(); logout(); });
    btn.insertAdjacentElement('afterend', menuEl);

    function addMenuItem(label, onClick, danger) {
      const b = el('button', 'auth-menu-item' + (danger ? ' danger' : ''));
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      menuEl.appendChild(b);
    }
  }
  function closeMenu() { if (menuEl && menuEl.classList) menuEl.classList.add('hidden'); }
  function renderNav() {
    const btn = $('authBtn');
    if (!btn) return;
    if (state.user) {
      const disp = state.user.name || state.user.email || '已登录';
      const label = disp.split('@')[0];
      // 头像圆点 + 名字的胶囊样式（比裸邮箱块更紧凑、更像主流站点的账号入口）
      btn.innerHTML = '<span class="avatar-dot" aria-hidden="true"></span><span class="auth-name"></span>';
      btn.querySelector('.avatar-dot').textContent = (label[0] || '用').toUpperCase();
      btn.querySelector('.auth-name').textContent = label;
      btn.title = disp;
      btn.classList.add('is-user');
      btn.onclick = (e) => {
        e.stopPropagation();
        if (menuEl) menuEl.classList.toggle('hidden');
      };
      renderVipBadge();
      buildMenu();
    } else {
      btn.textContent = '登录';
      btn.classList.remove('is-user');
      btn.onclick = openLogin;
      removeVipBadge();
    }
  }
  function renderVipBadge() {
    let b = $('authVip');
    if (state.user && state.user.membership === 'lifetime') {
      if (!b) {
        b = el('span', 'auth-vip'); b.id = 'authVip';
        const btn = $('authBtn');
        if (btn && btn.parentNode) btn.insertAdjacentElement('afterend', b);
      }
      b.textContent = '会员';
      b.hidden = false;
    } else if (b) {
      b.hidden = true;
    }
  }
  function removeVipBadge() { const b = $('authVip'); if (b) b.hidden = true; }
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

  /* ---------- 管理员 API（走 Supabase 存储过程） ---------- */
  async function adminListCodes() { return rpcAdmin('admin_list_codes'); }
  async function adminCreateCodes(n) { return rpcAdmin('admin_create_codes', { n }); }
  async function adminDisableCode(code) { return rpcAdmin('admin_disable_code', { p_code: code }); }
  async function adminListUsers() { return rpcAdmin('admin_list_users'); }
  async function adminSetMembership(userId, type) { return rpcAdmin('admin_set_membership', { p_user: userId, p_type: type }); }
  async function rpcAdmin(fn, params) {
    const { data, error } = await supabase.rpc(fn, params || {});
    if (error) { const e = new Error(error.message || '操作失败'); e.code = error.code; throw e; }
    return data;
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    injectModal();
    renderNav();
    bindBoardSync();

    // 处理 OAuth 回调（URL 里带 code/token 时，建立 session）
    try { await supabase.auth.getSessionFromUrl(); } catch (_) {}
    // 监听登录态变化（OAuth 回调、token 刷新等）
    supabase.auth.onAuthStateChange(() => {
      loadUser().then((u) => { state.user = u; emit(); });
    });

    // 初始加载当前用户
    try { state.user = await loadUser(); } catch (_) { state.user = null; }
    emit();

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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    get user() { return state.user; },
    get ready() { return state.ready; },
    onChange, login, register, logout, me,
    listBoards, deleteBoard, syncBoard, openCloudBoard, syncAllLocal,
    changePassword, deleteAccount, openChangePw, openDelete,
    openLogin, openSignup, requireLogin,
    forgotPassword, redeemCode, membershipMe, getProviders,
    openMembership, openForgot,
    adminListCodes, adminCreateCodes, adminDisableCode, adminListUsers, adminSetMembership,
  };
})();

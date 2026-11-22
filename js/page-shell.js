/**
 * 智绘几何 · v4 共享页面壳层增强
 * 作用：给子页/AI生成页补统一导航登录态、页脚、状态提示、资源库筛选、首页空态收起。
 * 设计：不替换原有 DOM，只追加/包装；可单独删除本文件回滚。
 */
(function () {
  'use strict';

  var LINKS = [
    { href: '/quickstart.html', text: '快速入门' },
    { href: '/templates.html', text: '资源库' },
    { href: '/files.html', text: '我的画板' },
    { href: '/about.html', text: '关于' },
    { href: '/generate.html?v=n1', text: 'AI 生成' }
  ];

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function path() { return location.pathname.replace(/\/+$/, '') || '/'; }
  function isPage(name) { return path().indexOf(name) !== -1; }

  function insertAuthButton() {
    var header = document.querySelector('.site-nav');
    if (!header || document.getElementById('authBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'authBtn';
    btn.className = 'auth-btn';
    btn.type = 'button';
    btn.textContent = '登录';
    var back = header.querySelector('.back');
    if (back) header.insertBefore(btn, back);
    else header.appendChild(btn);
  }

  function injectGenerateNav() {
    var header = document.querySelector('.site-nav');
    if (!header) return;
    var links = header.querySelector('.site-links');
    if (!links) {
      links = document.createElement('nav');
      links.className = 'site-links';
      links.setAttribute('aria-label', '主导航');
      LINKS.forEach(function (item) {
        var a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.text;
        links.appendChild(a);
      });
      var back = header.querySelector('.back');
      if (back) header.insertBefore(links, back);
      else header.appendChild(links);
    }
  }

  function injectFooter() {
    if (document.querySelector('footer.site-footer')) return;
    var f = document.createElement('footer');
    f.className = 'site-footer';
    var year = new Date().getFullYear();
    f.innerHTML =
      '<div class="site-footer-in">' +
        '<span>© ' + year + ' 智绘几何 · 开源</span><span class="sep">·</span>' +
        '<a href="https://github.com/Cyrus-Nebula/zhihuabaiban" target="_blank" rel="noopener">GitHub 源码（MIT）</a><span class="sep">·</span>' +
        '<a href="/about.html#updates">更新记录</a><span class="sep">·</span>' +
        '<a href="/about.html#privacy">隐私说明</a><span class="sep">·</span>' +
        '<span>不投广告 · 不追踪 · 画板默认只存本机</span>' +
      '</div>';
    document.body.appendChild(f);
  }

  function notice(html, beforeSelector) {
    if (document.querySelector('.v4-notice')) return null;
    var n = document.createElement('div');
    n.className = 'v4-notice';
    n.innerHTML = html;
    var anchor = beforeSelector ? document.querySelector(beforeSelector) : null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(n, anchor);
    else {
      var main = document.querySelector('main');
      if (main) main.insertBefore(n, main.firstChild);
    }
    return n;
  }

  function enhanceFilesPage() {
    if (!isPage('files.html')) return;
    var n = notice(
      '<span id="fileSyncStatus">本机文件保存在此浏览器 · 云端登录后显示</span>' +
      '<button class="btn" type="button" id="fileLoginBtn">登录同步</button>',
      '#stats'
    );
    if (!n) return;
    var loginBtn = document.getElementById('fileLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      if (window.Auth) window.Auth.openLogin();
    });
    if (window.Auth) {
      window.Auth.onChange(function (user) {
        var el = document.getElementById('fileSyncStatus');
        if (!el) return;
        if (!user) { el.textContent = '本机文件保存在此浏览器 · 云端登录后显示'; return; }
        el.textContent = '已登录 · 正在读取云端画板…';
        window.Auth.listBoards().then(function (list) {
          el.textContent = '本机 ' + (window.Store ? Store.list().length : 0) + ' 个 · 云端 ' + (list ? list.length : 0) + ' 个（登录后显示）';
        }).catch(function () { el.textContent = '已登录 · 云端列表暂时不可用'; });
      });
    }
  }

  function enhanceTemplatesPage() {
    if (!isPage('templates.html')) return;
    notice('<span>模板将创建到本机浏览器；登录后可同步到云端，未登录也能直接使用。</span>', '#tplGrid');
    var grid = document.getElementById('tplGrid');
    if (!grid || document.querySelector('.tpl-filter')) return;
    var bar = document.createElement('div');
    bar.className = 'tpl-filter';
    bar.innerHTML =
      '<input id="tplSearch" type="search" placeholder="搜索模板名称或知识点…" aria-label="搜索模板" />' +
      '<select id="tplStage" aria-label="按学段筛选"><option value="">全部学段</option></select>';
    grid.parentNode.insertBefore(bar, grid);

    var templates = window.DAJIAO_TEMPLATES || [];
    var catSet = {};
    templates.forEach(function (t) { if (t.category) catSet[t.category] = 1; });
    var stage = document.getElementById('tplStage');
    Object.keys(catSet).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; stage.appendChild(o);
    });

    // 给已有卡片补对象数 / 可回放徽标
    Array.prototype.forEach.call(grid.querySelectorAll('.tpl'), function (card, i) {
      var t = templates[i] || {};
      var badges = document.createElement('div');
      badges.className = 'tpl-badges';
      var n = Array.isArray(t.commands) ? t.commands.length : 0;
      badges.innerHTML = '<span>' + n + ' 个对象</span><span>可回放</span>';
      var body = card.querySelector('.tpl-body');
      if (body) body.insertBefore(badges, body.querySelector('.tpl-foot'));
    });

    function applyFilter() {
      var q = (document.getElementById('tplSearch').value || '').trim().toLowerCase();
      var c = stage.value;
      Array.prototype.forEach.call(grid.querySelectorAll('.tpl'), function (card, i) {
        var t = templates[i] || {};
        var text = ((t.title || '') + ' ' + (t.desc || '') + ' ' + (t.category || '')).toLowerCase();
        card.hidden = !!(q && text.indexOf(q) === -1) || !!(c && t.category !== c);
      });
    }
    document.getElementById('tplSearch').addEventListener('input', applyFilter);
    stage.addEventListener('change', applyFilter);
  }

  function enhanceGeneratePage() {
    if (!isPage('generate.html')) return;
    notice(
      '<span id="genQuotaText">当前模型状态未知 · 生成结果只在本页展示，不会自动上传</span>' +
      '<button class="btn" type="button" id="genLoginBtn">登录查看状态</button>',
      'section.card'
    );
    var loginBtn = document.getElementById('genLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      if (window.Auth) window.Auth.openLogin();
    });
    if (window.Auth) window.Auth.onChange(function (user) {
      var el = document.getElementById('genQuotaText');
      if (!el) return;
      el.textContent = user ? '已登录 ' + (user.name || user.email) + ' · 当前模型状态正常，生成结果只在本页展示' : '当前模型状态未知 · 生成结果只在本页展示，不会自动上传';
    });

    var main = document.querySelector('main');
    if (!main || document.getElementById('genHistory')) return;
    var hist = document.createElement('section');
    hist.id = 'genHistory';
    hist.innerHTML = '<h2 style="font-size:16px;margin:28px 0 12px">最近生成</h2><div id="genHistoryList" class="card" style="color:var(--app-muted);font-size:13px">还没有记录。生成一次后会自动保存在本机。</div>';
    main.appendChild(hist);

    var KEY = 'geora-gen-history';
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
    function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch (e) {} }
    function render() {
      var list = read(), box = document.getElementById('genHistoryList');
      if (!box) return;
      if (!list.length) { box.textContent = '还没有记录。生成一次后会自动保存在本机。'; return; }
      box.innerHTML = '';
      list.forEach(function (item) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--app-line)';
        var a = document.createElement('a');
        a.href = item.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = (item.time || '') + ' · ' + item.model + ' · ' + item.kind;
        a.style.cssText = 'color:var(--app-brand);text-decoration:none';
        row.appendChild(a);
        box.appendChild(row);
      });
    }
    render();
    var result = document.getElementById('genResult');
    if (result && window.MutationObserver) {
      var recorded = false;
      new MutationObserver(function () {
        if (recorded) return;
        var media = result.querySelector('img, video');
        if (!media || !media.src) return;
        recorded = true;
        var list = read();
        list.unshift({
          time: new Date().toLocaleString('zh-CN', { hour12: false }),
          model: (document.getElementById('genModel') || {}).value || '',
          kind: media.tagName === 'VIDEO' ? '视频' : '图片',
          url: media.src
        });
        write(list); render();
      }).observe(result, { childList: true, subtree: true });
    }
  }

  function compactHomeEmpty() {
    var list = document.getElementById('fileList');
    var empty = document.getElementById('emptyState');
    var section = document.getElementById('files');
    if (!list || !empty || !section) return;
    function apply() {
      if (list.children.length === 0 && !empty.hidden) {
        section.classList.add('empty-collapsed');
        if (!empty.querySelector('a')) {
          empty.innerHTML = '还没有画板 → <a href="/templates.html">从模板开始</a>';
        }
      } else {
        section.classList.remove('empty-collapsed');
      }
    }
    apply();
    if (window.MutationObserver) {
      new MutationObserver(apply).observe(list, { childList: true });
    }
  }

  ready(function () {
    injectGenerateNav();
    insertAuthButton();
    injectFooter();
    enhanceFilesPage();
    enhanceTemplatesPage();
    enhanceGeneratePage();
    compactHomeEmpty();

    // v4：注册离线壳层（仅在支持的浏览器、生产域名下生效）
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
  });
})();

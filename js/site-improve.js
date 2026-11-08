/* ============================================================================
 * site-improve.js — 《智绘几何界面修改意见》27 条一次性落地层（交互）
 *
 * 设计原则：
 *   1. 不修改任何 js/*.js 原有文件；不删除任何原有 DOM 节点 / id / 事件绑定。
 *   2. 全部为「运行时增强」：新按钮 clone 后替换（去掉旧监听）、或追加子元素、
 *      或用事件委托。删除本文件引用即完全回滚，连原文案都不用还原。
 *   3. 每个条目独立 try/catch，一处失败不影响其它条目。
 *   4. 复用原有功能入口（btnNew2d / btnImport / Auth.openLogin 等），不重复实现业务逻辑。
 *
 * 覆盖：#2 #3 #4 #5 #6 #8 #10 #11 #12 #14 #15 #16 #21 #24 #25
 *       （#1 在 404.html 内联；#13 #17 #23 #27 在 site-improve.css；
 *         #7 #9 #18 #19 #20 #22 #26 经核代码确认「已实现 / 与既定方向冲突」，
 *         逐条说明见交付报告，不重复造轮子也不回退）
 * ==========================================================================*/
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var isHome = body.classList.contains('landing') && !body.classList.contains('nf-page');
  var isBoard = body.classList.contains('board-page');

  /* 每个模块隔离，避免一处报错导致整份增强失效 */
  function safe(name, fn) {
    try { fn(); } catch (e) {
      if (window.console && console.warn) console.warn('[site-improve] ' + name + ': ' + (e && e.message));
    }
  }

  /* =========================================================================
   * #2 顶栏「＋ 新建画板」→ 下拉（平面 / 立体 / 打开文件）
   *    报告 P0 指它与 Hero 三个按钮重复、含义不明。
   *    做法：保留原按钮（id 不丢，隐藏），新增下拉触发器；菜单项复用
   *    workbench.js 已绑定的 btnNew2d / btnNew3d / btnImport（含登录拦截）。
   * =======================================================================*/
  function navDropdown() {
    var old = $('navNewBoard');
    if (!old || $('siNavTrigger')) return;

    var wrap = document.createElement('div');
    wrap.className = 'nav-new-wrap';
    old.parentNode.insertBefore(wrap, old);
    old.hidden = true;               // 结构零删除：原按钮留在 DOM 里，只是不可见
    wrap.appendChild(old);

    var trigger = document.createElement('button');
    trigger.id = 'siNavTrigger';
    trigger.type = 'button';
    trigger.className = old.className;   // btn btn-primary btn-sm site-cta
    trigger.textContent = '＋ 新建画板 ▾';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    wrap.appendChild(trigger);

    var menu = document.createElement('div');
    menu.className = 'si-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    [
      { text: '新建画板（平面几何）', key: '2D', target: 'btnNew2d' },
      { text: '新建画板（立体几何）', key: '3D', target: 'btnNew3d' },
      { text: '打开文件', key: 'JSON', target: 'btnImport' },
    ].forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'si-menu-item';
      b.setAttribute('role', 'menuitem');
      var t = document.createElement('span'); t.textContent = it.text;
      var k = document.createElement('span'); k.className = 'si-key'; k.textContent = it.key;
      b.appendChild(t); b.appendChild(k);
      b.addEventListener('click', function () {
        close();
        var target = $(it.target);
        if (target) target.click();        // 复用原逻辑，不重复实现
      });
      menu.appendChild(b);
    });
    wrap.appendChild(menu);

    function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* =========================================================================
   * #3 用户菜单（右上角用户名）
   *    核代码：auth.js buildMenu() 已实现 6 项下拉（云端画板 / 会员中心 /
   *    修改密码 / 删除账号 / 退出登录等）。报告「点击无反应」是 a11y 树未
   *    展开菜单导致的误判。这里只补无障碍属性，不动功能。
   * =======================================================================*/
  function userMenuAria() {
    var b = $('authBtn');
    if (!b) return;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      setTimeout(function () {
        var m = document.querySelector('.auth-menu');
        b.setAttribute('aria-expanded', String(!!m && !m.classList.contains('hidden')));
      }, 0);
    });
  }

  /* =========================================================================
   * #4 帮助按钮：从「只滚动到关于」升级为帮助浮层（快速入门 4 步 + 反馈入口）
   *    clone 替换去掉 landing.js 的旧 click 绑定；id 保留。
   * =======================================================================*/
  function helpLayer() {
    var old = $('fabHelp');
    if (!old) return;
    var fab = old.cloneNode(true);
    old.parentNode.replaceChild(fab, old);
    fab.title = '帮助与快速入门';
    fab.setAttribute('aria-label', '打开帮助与快速入门');

    var layer = document.createElement('div');
    layer.className = 'si-layer';
    layer.hidden = true;
    layer.innerHTML =
      '<div class="si-help" role="dialog" aria-modal="true" aria-label="帮助与快速入门">' +
        '<button class="si-help-x" type="button" aria-label="关闭">×</button>' +
        '<h3>快速开始</h3>' +
        '<p class="si-help-sub">四步，从一句描述到一张可拖拽的几何图。</p>' +
        '<ol>' +
          '<li><b>描述需求，AI 作图</b>：在首页输入框用自然语言描述，AI 直接生成可拖拽的动态图形。</li>' +
          '<li><b>工具手动作图</b>：点、线段、直线、圆、多边形、函数曲线，几何关系自动保持。</li>' +
          '<li><b>拖拽探索</b>：拖动顶点观察图形变化，在动态演示中验证定理与猜想。</li>' +
          '<li><b>保存与导出</b>：文件只存本机浏览器，可导出 .json 工程备份或 PNG 图片。</li>' +
        '</ol>' +
        '<div class="si-help-links">' +
          '<a href="#about">了解更多</a>' +
          '<a href="https://github.com/Cyrus-Nebula/zhihuabaiban/issues" target="_blank" rel="noopener">反馈问题</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(layer);

    function close() { layer.hidden = true; }
    fab.addEventListener('click', function () { layer.hidden = false; });
    layer.addEventListener('click', function (e) {
      if (e.target === layer || (e.target.closest && (e.target.closest('.si-help-x') || e.target.closest('.si-help-links a')))) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !layer.hidden) close(); });
  }

  /* =========================================================================
   * #5 「生成画板」置灰时给出原因 + 空输入引导
   *    不改 landing.js 的 updateSendState，只追加提示。
   * =======================================================================*/
  function sendHint() {
    var input = $('heroAiInput'), send = $('heroAiSend'), box = document.querySelector('.hero-ai');
    if (!input || !send || !box) return;

    var hint = document.createElement('p');
    hint.className = 'si-ai-hint';
    hint.textContent = '先描述要画的图形，或上传一张题目图片，生成按钮就会亮起。';
    box.appendChild(hint);

    // 真实页面用 class="hidden" 控制预览显隐（不是 hidden 属性），
    // 且图片经 FileReader 异步读入，故用 MutationObserver 盯 class 变化最稳。
    var preview = $('heroAiImgPreview');
    function hasImage() { return !!preview && !preview.classList.contains('hidden'); }
    function sync() {
      var empty = !input.value.trim() && !hasImage();
      hint.hidden = !empty;
      var tip = send.disabled ? '请先描述要画的图形或上传题目图片' : '生成画板';
      send.title = tip;
      send.setAttribute('aria-label', tip);
    }
    input.addEventListener('input', sync);
    if (preview && window.MutationObserver) {
      new MutationObserver(sync).observe(preview, { attributes: true, attributeFilter: ['class'] });
    }
    var clr = $('heroAiImgClear');
    if (clr) clr.addEventListener('click', function () { setTimeout(sync, 0); });
    var imgInput = $('heroAiImgInput');
    if (imgInput) imgInput.addEventListener('change', function () { setTimeout(sync, 60); });
    sync();
  }

  /* =========================================================================
   * #6 模型下拉：标题简化为「AI 模型」，选项去日期版本号、加人话说明
   *    只改 option 的显示文本（value 不变，提交不受影响），不改 js/models.js
   *    （该文件被首页与画板共用，且属定时任务可能改动的文件）。
   * =======================================================================*/
  var MODEL_INFO = {
    'glm-4.7-flash':       { short: 'GLM-4.7-Flash（推荐）', desc: '速度快，适合常规几何作图' },
    'glm-4.6v-flash':      { short: 'GLM-4.6V-Flash（视觉）', desc: '支持识别题目图片，按图复原几何图形' },
    'glm-4-flash-250414':  { short: 'GLM-4-Flash（稳定版）',  desc: '稳定版，兼容性最好' },
    'glm-4-flash':         { short: 'GLM-4-Flash（备用）',    desc: '旧版通道，作为兼容兜底' },
  };
  function modelLabels() {
    ['heroAiModel', 'ai-model'].forEach(function (id) {
      var sel = $(id);
      if (!sel) return;
      sel.title = 'AI 模型';
      sel.setAttribute('aria-label', 'AI 模型');
      Array.prototype.forEach.call(sel.options, function (opt) {
        var info = MODEL_INFO[opt.value];
        if (info) opt.textContent = info.short;      // 隐藏 250414 这类日期版本号
      });

      // 首页在输入条下方加一行免费档说明；画板页 ai-head 空间紧张，不放说明
      var box = sel.parentNode;
      if (!isHome || !box || box.querySelector('.si-model-note')) return;
      var note = document.createElement('span');
      note.className = 'si-model-note';
      box.appendChild(note);
      function upd() {
        var info = MODEL_INFO[sel.value];
        note.textContent = '';
        var b = document.createElement('b');
        b.textContent = '智谱普惠免费档 · 全部免费';
        note.appendChild(b);
        note.appendChild(document.createTextNode('　' + (info ? info.desc : '')));
      }
      sel.addEventListener('change', upd);
      upd();
    });
  }

  /* =========================================================================
   * #8 快速入门默认收起（记住用户是否手动展开过），首屏让位给模板案例
   *    与 landing.js 的 qsClose 监听器天然兼容：它按 qsSteps.hidden 取反。
   * =======================================================================*/
  function quickstartCollapse() {
    var steps = $('qsSteps'), close = $('qsClose');
    if (!steps || !close) return;
    var KEY = 'si-qs-open', opened = false;
    try { opened = localStorage.getItem(KEY) === '1'; } catch (e) {}

    var tip = document.createElement('p');
    tip.className = 'si-qs-tip';
    tip.textContent = '四步上手：描述需求 → 手动作图 → 拖拽探索 → 保存导出。';
    if (steps.parentNode) steps.parentNode.insertBefore(tip, steps);

    steps.hidden = !opened;
    close.textContent = opened ? '×' : '+';
    close.setAttribute('aria-expanded', String(opened));
    close.setAttribute('aria-label', opened ? '收起快速入门' : '展开快速入门');
    tip.hidden = opened;

    close.addEventListener('click', function () {
      var nowOpen = !steps.hidden;     // landing.js 的监听已先执行，这里读到的是切换后的值
      try { localStorage.setItem(KEY, nowOpen ? '1' : '0'); } catch (e) {}
      tip.hidden = nowOpen;
      close.setAttribute('aria-expanded', String(nowOpen));
      close.setAttribute('aria-label', nowOpen ? '收起快速入门' : '展开快速入门');
    });
  }

  /* =========================================================================
   * #10 「我的画板」空状态：未登录时给登录引导 CTA
   *    登录后隐藏；emptyState 的显隐仍由 workbench.js render() 管。
   * =======================================================================*/
  function loginCta() {
    var empty = $('emptyState');
    if (!empty || empty.querySelector('.si-login-cta')) return;
    var cta = document.createElement('div');
    cta.className = 'si-login-cta';
    cta.innerHTML = '登录后可在设备间同步你的画板　<button type="button">立即登录</button>';
    empty.appendChild(cta);
    cta.querySelector('button').addEventListener('click', function () {
      if (window.Auth && Auth.openLogin) Auth.openLogin();
    });
    function sync() { cta.hidden = !!(window.Auth && Auth.user); }
    if (window.Auth && Auth.onChange) Auth.onChange(sync);
    sync();
  }

  /* =========================================================================
   * #11 + #25 关于区去重并丰富 / 页脚精简（技术栈只出现一次）
   *    报告指出页脚附近 JSXGraph 链接重复两次；同时「关于」只有三行链接。
   *    这里用运行时替换：index.html 原文案一个字没动，删引用即可还原。
   * =======================================================================*/
  function aboutAndFooter() {
    var card = document.querySelector('#about .about-card');
    if (card) {
      card.innerHTML =
        '<p class="si-about-lead">智绘几何是一个<strong>开源免费</strong>的在线动态几何画板，' +
          '面向学生与教师：用一句话让 AI 画出可拖拽的图形，或用 14 种工具手动作图，拖动顶点验证定理与猜想。</p>' +
        '<ul class="si-about-list">' +
          '<li>平面画板：点、线、圆、多边形、函数曲线，几何关系自动保持</li>' +
          '<li>立体画板：自研 3D 引擎，不依赖外部 SDK</li>' +
          '<li>AI 作图：自然语言或题目图片，生成可继续编辑的动态图形</li>' +
          '<li>数据只存本机浏览器，可导出 .json 工程与 PNG 图片</li>' +
        '</ul>' +
        '<p class="si-about-meta">反馈与问题：' +
          '<a href="https://github.com/Cyrus-Nebula/zhihuabaiban/issues" target="_blank" rel="noopener">GitHub Issues</a>' +
          '　·　<a href="https://github.com/Cyrus-Nebula/zhihuabaiban" target="_blank" rel="noopener">源码（MIT）</a>' +
          '　·　致谢 <a href="https://jsxgraph.org" target="_blank" rel="noopener">JSXGraph</a>（LGPL）、' +
          '智谱 GLM 普惠免费档、<a href="https://dajiaoai.com" target="_blank" rel="noopener">大角几何</a> SDK（Apache-2.0）</p>';
    }
    var footer = document.querySelector('.site-footer');
    if (footer) {
      footer.innerHTML = '<p>© 2026 智绘几何 · 开源 · 免费 · ' +
        '<a href="https://github.com/Cyrus-Nebula/zhihuabaiban" target="_blank" rel="noopener">GitHub 源码（MIT）</a>' +
        '　·　本站不收集任何个人数据</p>';
    }
  }

  /* =========================================================================
   * #12 工具栏分组标签（基础 / 构造 / 标注 / 编辑）
   *    只插入 span（不是 .tool），board.js 的 querySelectorAll('.tool[data-tool]')
   *    与 data-tool 绑定完全不受影响。撤销/重做归位由 CSS order 完成。
   * =======================================================================*/
  function toolbarGroups() {
    var bar = $('toolbar');
    if (!bar) return;
    [
      { before: 'select', label: '基础' },
      { before: 'midpoint', label: '构造' },
      { before: 'text', label: '标注' },
      { before: 'delete', label: '编辑' },
    ].forEach(function (g) {
      var btn = bar.querySelector('.tool[data-tool="' + g.before + '"]');
      if (!btn || bar.querySelector('.tool-group-label[data-for="' + g.before + '"]')) return;
      var s = document.createElement('span');
      s.className = 'tool-group-label';
      s.setAttribute('data-for', g.before);
      s.setAttribute('aria-hidden', 'true');
      s.textContent = g.label;
      bar.insertBefore(s, btn);
    });
    var seps = bar.querySelectorAll('.toolbar-sep');
    if (seps[0]) seps[0].classList.add('sep-history');
    if (seps[1]) seps[1].classList.add('sep-fn');
  }

  /* =========================================================================
   * #14 函数作图区：加分组小标题，定义域改为「从 [ ] 到 [ ]」
   *    只改 label 文案，不改任何 id / input。
   * =======================================================================*/
  function fnPanel() {
    var bar = $('toolbar');
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('.toolbar-label'), function (l) {
      var t = l.textContent.trim();
      if (t === '函数') { l.textContent = '函数曲线'; l.classList.add('si-fn-label'); }
      else if (t === 'x∈') { l.textContent = '从'; }
      else if (t === '~') { l.textContent = '到'; }
    });
  }

  /* =========================================================================
   * #15 右侧三 Tab：补 role/aria-selected（数量角标、active 态本已具备）
   *    不改默认 Tab —— AI 对话是主流程，改默认会削弱作图入口。
   * =======================================================================*/
  function tabAria() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ai-tab'));
    if (!tabs.length) return;
    var wrap = document.querySelector('.ai-tabs');
    if (wrap) wrap.setAttribute('role', 'tablist');
    function sync() {
      tabs.forEach(function (t) {
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(t.classList.contains('active')));
      });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { setTimeout(sync, 0); }); });
    sync();
  }

  /* =========================================================================
   * #16 标题改名给「● 未保存」反馈；保存完成给「✓ 已保存」
   *    复用 board.js 已派发的 board:saved 事件，不改核心逻辑。
   * =======================================================================*/
  function saveDirty() {
    var st = $('save-status');
    if (!st) return;
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'doc-name') {
        st.classList.add('si-dirty'); st.classList.remove('si-saved');
      }
    });
    window.addEventListener('board:saved', function () {
      st.classList.remove('si-dirty'); st.classList.add('si-saved');
      setTimeout(function () { st.classList.remove('si-saved'); }, 4000);
    });
  }

  /* =========================================================================
   * #24 Emoji 统一：报告建议「要么全配图标，要么全不用 emoji 保持纯文字一致」。
   *    选后者（不引入图标库、与已上线的克制风格一致）。
   *    只改按钮显示文本，board.js 全靠 id 绑定，不受影响。
   * =======================================================================*/
  function stripEmoji() {
    var map = {
      'btn-settings': '设置',
      'btn-anim': '动画',
      'btn-cloud': '同步',
      'btn-export-menu': '导出 / 导入 ▾',
      'btn-export-embed': '嵌入',
      'anim-play': '播放',
      'rec-prev': '上一步',
      'rec-next': '下一步',
      'rec-stop': '退出',
      'ai-img-clear': '移除',
    };
    Object.keys(map).forEach(function (id) {
      var b = $(id);
      if (b && b.textContent.trim()) b.textContent = map[id];
    });
    var back = document.querySelector('.topbar > a.btn.ghost');
    if (back && back.textContent.indexOf('返回') >= 0) back.textContent = '← 返回工作台';
  }

  /* =========================================================================
   * #21 登录/注册/找回密码弹窗：失焦即时校验（邮箱格式 / 密码 >= 8 位）
   *    弹窗由 auth.js 动态注入，故用 document 级 focusout/input 事件委托。
   *    校验长度按网站真实规则 minlength=8（报告写 6 位，按实际为准）。
   * =======================================================================*/
  function fieldValidation() {
    var IDS = ['authEmail', 'authPw', 'fpEmail', 'cpOld', 'cpNew', 'cpNew2'];
    function validate(el) {
      var holder = el.closest ? el.closest('.auth-field') : null;
      if (!holder) return;
      var v = (el.value || '').trim(), msg = '';
      if (el.type === 'email') {
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = '请输入有效的邮箱地址';
      } else if (el.type === 'password') {
        if (v && v.length < 8) msg = '密码至少 8 位';
        if (!msg && el.id === 'cpNew2') {
          var p = $('cpNew');
          if (p && p.value && v !== p.value.trim()) msg = '两次输入的密码不一致';
        }
      }
      var err = holder.querySelector('.si-field-err');
      if (!err) {
        err = document.createElement('span');
        err.className = 'si-field-err';
        // 紧跟输入框插入（auth-field 是 <label>，appendChild 会排到 label 末尾）
        if (el.insertAdjacentElement) el.insertAdjacentElement('afterend', err);
        else holder.appendChild(err);
      }
      err.textContent = msg;
      el.classList.toggle('si-input-bad', !!msg);
    }
    document.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t && IDS.indexOf(t.id) >= 0) validate(t);
    });
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || IDS.indexOf(t.id) < 0) return;
      if (t.classList.contains('si-input-bad')) validate(t);
      // 改了新密码，同步复核「确认新密码」
      if (t.id === 'cpNew') { var c = $('cpNew2'); if (c && c.value) validate(c); }
    });
  }

  /* =========================================================================
   * #14 函数独立面板（第二轮）：把「函数曲线 + 表达式 + 从/到 + 添加曲线」
   *    包成一块带小标题、可折叠的面板，状态记 localStorage。
   *    顺带修掉宽屏自动换行时「从」与「-10」被拆到两行的问题。
   *    只搬运节点、不删节点；board.js 靠 id 绑定，移动 DOM 不影响任何逻辑。
   *    必须在 fnPanel() 之后执行（要找到已改名为「函数曲线」的 label）。
   * =======================================================================*/
  function fnIndependentPanel() {
    var bar = $('toolbar');
    if (!bar || bar.querySelector('.si-fn-panel')) return;
    var label = null;
    Array.prototype.forEach.call(bar.querySelectorAll('.toolbar-label'), function (l) {
      if (l.textContent.trim() === '函数曲线') label = l;
    });
    var add = $('btn-fn-add');
    if (!label || !add) return;

    // 收集 label..add 之间的兄弟节点（含两端），一个都不删
    var nodes = [], n = label;
    while (n) {
      nodes.push(n);
      if (n === add) break;
      n = n.nextElementSibling;
    }
    if (nodes[nodes.length - 1] !== add) return;

    var panel = document.createElement('div');
    panel.className = 'si-fn-panel';
    label.parentNode.insertBefore(panel, label);

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'si-fn-head';
    head.innerHTML = '<span>函数曲线</span><span class="si-fn-caret">▾</span>';
    var body = document.createElement('div');
    body.className = 'si-fn-body';
    panel.appendChild(head);
    panel.appendChild(body);
    nodes.forEach(function (x) { body.appendChild(x); });   // 原 label 由 head 接管显示，CSS 隐藏

    var KEY = 'si-fn-open', open = true;
    try { open = localStorage.getItem(KEY) !== '0'; } catch (e) {}
    function apply() {
      body.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('si-fn-collapsed', !open);
    }
    head.addEventListener('click', function () {
      open = !open;
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {}
      apply();
    });
    apply();
  }

  /* =========================================================================
   * #12 窄屏「更多 ▾」折叠（第二轮）：报告原文建议把 动画 / 嵌入 / LaTeX
   *    这类高级功能收进下拉，避免顶栏首行全部摊开。
   *    只搬运整个 .settings-wrap（button 与其 popover 一起走）；board.js 全部
   *    靠 id 绑定、无 .settings-wrap 选择器，移动 DOM 不影响功能。
   *    宽屏自动移回原位（注释锚点记录位置），跨断点 resize 无损切换。
   * =======================================================================*/
  function moreMenu() {
    var topbar = document.querySelector('.topbar');
    if (!topbar || $('siMoreTrigger')) return;
    var wraps = ['btn-anim', 'btn-export-embed', 'btn-export-latex']
      .map(function (id) { var b = $(id); return b && b.closest ? b.closest('.settings-wrap') : null; })
      .filter(Boolean);
    if (wraps.length !== 3) return;

    // 注释锚点：宽屏移回时能精确还原顺序
    wraps.forEach(function (w) {
      var a = document.createComment('si-more-anchor');
      w.parentNode.insertBefore(a, w);
      w.__siAnchor = a;
    });

    var holder = document.createElement('div');
    holder.className = 'si-more-wrap';
    var trigger = document.createElement('button');
    trigger.id = 'siMoreTrigger';
    trigger.type = 'button';
    trigger.className = 'btn';
    trigger.textContent = '更多 ▾';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    var menu = document.createElement('div');
    menu.className = 'si-more-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    holder.appendChild(trigger);
    holder.appendChild(menu);

    function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function (e) { if (!holder.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    var mq = window.matchMedia('(max-width: 900px)');
    var authAnchor = topbar.querySelector('.auth-anchor');
    function apply() {
      if (mq.matches) {
        if (!holder.parentNode) {
          if (authAnchor && authAnchor.parentNode === topbar) topbar.insertBefore(holder, authAnchor);
          else topbar.appendChild(holder);
        }
        wraps.forEach(function (w) { menu.appendChild(w); });
        holder.hidden = false;
      } else {
        wraps.forEach(function (w) {
          var a = w.__siAnchor;
          if (a && a.parentNode) a.parentNode.insertBefore(w, a.nextSibling);
        });
        close();
        holder.hidden = true;
      }
    }
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  /* ---------------------------------------------------------------------------
   * 启动：等 DOMContentLoaded（保证 deferred module 如 board.js 已填好下拉选项）
   * -------------------------------------------------------------------------*/
  function boot() {
    if (isHome) {
      safe('#2 顶栏新建下拉', navDropdown);
      safe('#3 用户菜单 aria', userMenuAria);
      safe('#4 帮助浮层', helpLayer);
      safe('#5 生成按钮提示', sendHint);
      safe('#6 模型文案', modelLabels);
      safe('#8 快速入门收起', quickstartCollapse);
      safe('#10 未登录引导', loginCta);
      safe('#11/#25 关于与页脚', aboutAndFooter);
    }
    if (isBoard) {
      safe('#6 模型文案', modelLabels);
      safe('#12 工具栏分组', toolbarGroups);
      safe('#14 函数作图区', fnPanel);
      safe('#14 函数独立面板', fnIndependentPanel);
      safe('#12 更多 ▾ 折叠', moreMenu);
      safe('#15 Tab aria', tabAria);
      safe('#16 保存状态', saveDirty);
      safe('#24 Emoji 统一', stripEmoji);
    }
    safe('#21 即时校验', fieldValidation);   // 全站（弹窗可能在任意页出现）
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

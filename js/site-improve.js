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

  /* =========================================================================
   * 第三轮 · 手动同步闸门（必须在解析阶段同步注册，不能放进 boot）
   *
   * 根因：board.js 在每次 mouseup 后 800ms 调 saveNow()，saveNow() 派发
   *       board:saved；auth.js 的 bindBoardSync() 监听该事件后立刻 syncCurrent()
   *       往云端上传 —— 于是「一直在同步」，按钮在「同步中…/已同步 ✓」反复跳。
   *
   * auth.js 是在 DOMContentLoaded 的 init() 里才注册该监听的；本文件是解析阶段
   * 就执行的普通脚本，注册更早。对 window 上派发的事件，AT_TARGET 阶段按注册
   * 顺序调用监听器，故这里先跑并 stopImmediatePropagation，即可挡住自动上传。
   *
   * 副作用：同事件上的其它监听也会被挡（包括旧 saveDirty 的 board:saved），
   * 所以把「✓ 已保存」状态更新改由 siSync.onSaved 回调驱动（见 saveDirty）。
   * 用户主动点「同步」按钮不受影响 —— 那条路径不走 board:saved。
   * =======================================================================*/
  var siSync = {
    dirty: false,          // 本地已保存、云端未同步
    lastDetail: null,      // 最近一次 board:saved 携带的完整工程
    lastSync: null,
    onSaved: [],
    onSynced: [],
    saveAndSync: null,
    fireSaved: function (d) {
      this.onSaved.forEach(function (fn) { try { fn(d); } catch (_) {} });
    },
    fireSynced: function (ok) {
      this.onSynced.forEach(function (fn) { try { fn(ok); } catch (_) {} });
    },
  };
  if (isBoard) {
    window.addEventListener('board:saved', function (e) {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      siSync.lastDetail = e.detail || null;
      siSync.dirty = true;
      siSync.fireSaved(e.detail);
    }, true);
  }

  /* 每个模块隔离，避免一处报错导致整份增强失效 */
  function safe(name, fn) {
    try { fn(); } catch (e) {
      if (window.console && console.warn) console.warn('[site-improve] ' + name + ': ' + (e && e.message));
    }
  }

  /* 轻量提示：复用页面原有 #toast，不新建浮层 */
  var siToastTimer = null;
  function siToast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(siToastTimer);
    siToastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
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
    // 第三轮起 board:saved 由闸门接管并 stopImmediatePropagation，
    // 原来的 window 监听收不到事件，改订阅闸门的 onSaved 回调（行为不变）。
    siSync.onSaved.push(function () {
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

    // 第三轮：「保存所有同步」——把本机所有画板一次性推到云端。
    // 复用 auth.js 暴露的 syncAllLocal()，不重复实现上传逻辑。
    // 用 button.si-menu-item（不是 .settings-wrap），不影响原有 3 个折叠项的断言。
    var syncAll = document.createElement('button');
    syncAll.type = 'button';
    syncAll.id = 'siSyncAll';
    syncAll.className = 'si-menu-item';
    syncAll.textContent = '同步全部画板';
    syncAll.addEventListener('click', function () {
      close();
      if (!window.Auth || !Auth.user || !Auth.syncAllLocal) {
        siToast('请先登录，再同步全部画板');
        return;
      }
      syncAll.disabled = true;
      syncAll.textContent = '同步中…';
      Promise.resolve(Auth.syncAllLocal()).then(function (r) {
        siSync.dirty = false;
        siSync.fireSynced(true);
        siToast('已同步 ' + ((r && r.done) || 0) + ' 个画板' + ((r && r.fail) ? '，' + r.fail + ' 个失败' : ''));
      }).catch(function () {
        siToast('同步失败，请稍后重试');
      }).then(function () {
        syncAll.disabled = false;
        syncAll.textContent = '同步全部画板';
      });
    });
    menu.appendChild(syncAll);

    function close() { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    // 第三轮：顶栏强制换行后「更多 ▾」可能落到某行最左侧，原先
    // absolute + right:0 会向左展开到屏幕外（实测 left=-181，整块不可点）。
    // 改为 fixed，打开时按触发按钮位置夹进视口，不再依赖顶栏换行位置。
    function place() {
      var r = trigger.getBoundingClientRect();
      var w = menu.offsetWidth || 252;
      var vw = document.documentElement.clientWidth;
      var max = Math.max(8, vw - w - 8);
      var left = Math.min(Math.max(8, r.right - w), max);
      menu.style.right = 'auto';
      menu.style.left = Math.round(left) + 'px';
      menu.style.top = Math.round(r.bottom + 8) + 'px';
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) place();
    });
    window.addEventListener('resize', function () { if (!menu.hidden) place(); });
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

  /* =========================================================================
   * 第三轮 ① 工具栏侧拉抽屉（手机）
   *    原工具栏 16 个工具按钮在窄屏只能一路横滑找，用户要求改成「侧拉」。
   *    做法：只搬运节点，不删除、不重建 —— board.js:1122 在模块执行时用
   *    querySelectorAll('.tool[data-tool]') 缓存引用并逐个绑定 click，搬移 DOM
   *    不改变引用，所有作图逻辑原样生效。宽屏按注释锚点精确还原顺序。
   *    函数区 .si-fn-panel 与撤销/重做保留在工具条（高频操作不必进抽屉）。
   * =======================================================================*/
  function toolsDrawer() {
    var bar = $('toolbar');
    if (!bar || $('siToolsTrigger')) return;
    var nodes = Array.prototype.slice.call(
      bar.querySelectorAll('.tool[data-tool], .tool-group-label, .toolbar-sep')
    );
    if (nodes.length < 10) return;

    var trigger = document.createElement('button');
    trigger.id = 'siToolsTrigger';
    trigger.type = 'button';
    trigger.className = 'si-tools-trigger';
    trigger.textContent = '工具 ▾';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    bar.insertBefore(trigger, bar.firstChild);

    var mask = document.createElement('div');
    mask.className = 'si-drawer-mask';
    mask.hidden = true;
    mask.innerHTML =
      '<div class="si-drawer-panel" role="dialog" aria-modal="true" aria-label="作图工具">' +
        '<div class="si-drawer-head"><span class="si-drawer-title">作图工具</span>' +
        '<button class="si-drawer-x" type="button" aria-label="关闭工具面板">×</button></div>' +
        '<div class="si-drawer-body"><div class="si-drawer-tools"></div>' +
        '<p class="si-drawer-tip">选好工具后点画布作图。撤销 / 重做与函数曲线仍在上方工具条。</p>' +
        '</div></div>';
    document.body.appendChild(mask);
    var panel = mask.querySelector('.si-drawer-tools');

    // 注释锚点：宽屏还原时保持原始顺序（与 moreMenu 同一套手法）
    nodes.forEach(function (n) {
      var a = document.createComment('si-tool-anchor');
      n.parentNode.insertBefore(a, n);
      n.__siAnchor = a;
    });

    function open() {
      mask.hidden = false;
      body.classList.add('si-drawer-lock');
      requestAnimationFrame(function () { mask.classList.add('si-open'); });
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
      mask.classList.remove('si-open');
      body.classList.remove('si-drawer-lock');
      trigger.setAttribute('aria-expanded', 'false');
      setTimeout(function () {
        if (!mask.classList.contains('si-open')) mask.hidden = true;
      }, 240);
    }
    function syncTrigger() {
      var a = bar.querySelector('.tool.active[data-tool]') || panel.querySelector('.tool.active[data-tool]');
      trigger.textContent = '工具' + (a ? '：' + a.textContent.trim() : '') + ' ▾';
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (mask.classList.contains('si-open')) close(); else open();
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask || (e.target.closest && e.target.closest('.si-drawer-x'))) { close(); return; }
      if (e.target.closest && e.target.closest('.tool[data-tool]')) {
        setTimeout(function () { close(); syncTrigger(); }, 0);
      }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mask.hidden) close(); });

    if (window.MutationObserver) {
      var mo = new MutationObserver(syncTrigger);
      [bar, panel].forEach(function (root) {
        mo.observe(root, { attributes: true, subtree: true, attributeFilter: ['class'] });
      });
    }

    var mq = window.matchMedia('(max-width: 640px)');
    function apply() {
      if (mq.matches) {
        nodes.forEach(function (n) { panel.appendChild(n); });
        trigger.hidden = false;
      } else {
        nodes.forEach(function (n) {
          var a = n.__siAnchor;
          if (a && a.parentNode) a.parentNode.insertBefore(n, a.nextSibling);
        });
        close();
        trigger.hidden = true;
      }
      syncTrigger();
    }
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  /* =========================================================================
   * 第三轮 ② 手动「保存并同步」
   *    board.js 仍会在每次操作后 800ms 自动保存「本地」副本（数据安全网，保留），
   *    但闸门已挡住自动云端上传。这里把「保存」升级为一次点击完成：
   *      本地保存（复用 board.js 原有 saveNow） + 云端同步（复用 Auth.syncBoard）。
   *    未登录时只存本机并给出提示，不报错、不阻断作图。
   * =======================================================================*/
  function manualSyncSave() {
    var saveBtn = $('btn-save'), cloudBtn = $('btn-cloud');
    if (!saveBtn) return;

    saveBtn.textContent = '保存并同步';
    saveBtn.title = '保存到本机浏览器，并同步到云端（登录后生效）';
    saveBtn.setAttribute('aria-label', saveBtn.title);
    if (cloudBtn) {
      cloudBtn.textContent = '同步';
      cloudBtn.title = '仅把当前画板同步到云端，不改动本地保存';
    }

    function pushCloud(detail) {
      if (!window.Auth || !Auth.syncBoard) return Promise.resolve({ ok: false, reason: 'noauth' });
      if (!Auth.user) return Promise.resolve({ ok: false, reason: 'nologin' });
      var d = detail || siSync.lastDetail || {};
      var id = d.id || new URLSearchParams(location.search).get('id');
      if (!id) return Promise.resolve({ ok: false, reason: 'noid' });
      var content = d.content || (window.__dajiao && window.__dajiao.getDoc && window.__dajiao.getDoc());
      var name = d.name || ($('doc-name') && $('doc-name').value) || '未命名画板';
      if (!content) return Promise.resolve({ ok: false, reason: 'nodata' });
      return Promise.resolve(Auth.syncBoard({ id: id, name: name, mode: d.mode || '2d', content: content }))
        .then(function () { return { ok: true }; })
        .catch(function (err) { return { ok: false, reason: (err && err.message) || '网络错误' }; });
    }

    function doSync() {
      saveBtn.classList.add('si-saving');
      return pushCloud(siSync.lastDetail).then(function (r) {
        saveBtn.classList.remove('si-saving');
        if (r.ok) {
          siSync.dirty = false;
          siSync.fireSynced(true);
          saveBtn.textContent = '✓ 已同步';
          setTimeout(function () { saveBtn.textContent = '保存并同步'; }, 1800);
          siToast('已保存并同步到云端');
        } else if (r.reason === 'nologin' || r.reason === 'noauth') {
          siToast('已保存到本机浏览器；登录后可同步到云端');
        } else {
          siToast('已保存到本机，云端同步失败：' + r.reason);
        }
        return r;
      });
    }

    // boot 在 DOMContentLoaded 触发，board.js（module/defer）此时已绑定 saveNow，
    // 故本监听排在 saveNow 之后：saveNow 先存本地并派发 board:saved，闸门更新
    // lastDetail，再由这里读取最新工程上传，顺序确定。
    saveBtn.addEventListener('click', function () { siSync.lastSync = doSync(); });

    // 退出确认复用：模拟一次真实的「保存并同步」点击，返回其 Promise
    siSync.saveAndSync = function () {
      saveBtn.click();
      return siSync.lastSync || Promise.resolve({ ok: false, reason: 'noop' });
    };

    // 用户手动点原「同步」按钮且成功时也算已同步，退出不再追问
    if (cloudBtn && window.MutationObserver) {
      new MutationObserver(function () {
        if (/已同步/.test(cloudBtn.textContent)) {
          siSync.dirty = false;
          siSync.fireSynced(true);
        }
      }).observe(cloudBtn, { childList: true, characterData: true, subtree: true });
    }
  }

  /* =========================================================================
   * 第三轮 ③ 离开画板时询问是否保存
   *    有「本地已存、云端未同步」的改动时，点「返回工作台」弹三选一：
   *    保存并同步 / 不保存直接离开 / 取消；没有未同步改动时直接放行。
   *    浏览器返回键用一层哨兵 history 覆盖（移动端主要退出方式）；
   *    不用 beforeunload —— 移动端支持不稳定，且会给自动化验收带来 dialog。
   * =======================================================================*/
  function exitConfirm() {
    var back = document.querySelector('.topbar > a.btn.ghost');
    if (!back) return;
    var href = back.getAttribute('href') || 'index.html';

    var layer = document.createElement('div');
    layer.className = 'si-layer';
    layer.hidden = true;
    layer.innerHTML =
      '<div class="si-confirm" role="dialog" aria-modal="true" aria-label="离开画板">' +
        '<h3>要保存并同步后再离开吗？</h3>' +
        '<p>当前改动已自动存在本机浏览器，但还没有同步到云端，其它设备暂时看不到。</p>' +
        '<div class="si-confirm-acts">' +
          '<button class="si-cf-primary" type="button">保存并同步</button>' +
          '<button class="si-cf-plain" type="button">不保存，直接离开</button>' +
          '<button class="si-cf-ghost" type="button">取消</button>' +
        '</div></div>';
    document.body.appendChild(layer);

    var leaving = false, primary = layer.querySelector('.si-cf-primary');
    function close() { layer.hidden = true; }
    function go() { leaving = true; siSync.dirty = false; location.href = href; }

    back.addEventListener('click', function (e) {
      if (leaving || !siSync.dirty) return;
      e.preventDefault();
      layer.hidden = false;
    });

    primary.addEventListener('click', function () {
      primary.disabled = true;
      primary.textContent = '保存并同步中…';
      var pr = siSync.saveAndSync ? siSync.saveAndSync() : Promise.resolve();
      Promise.resolve(pr).then(function () { setTimeout(go, 280); }, function () { setTimeout(go, 280); });
    });
    layer.querySelector('.si-cf-plain').addEventListener('click', function () { close(); go(); });
    layer.querySelector('.si-cf-ghost').addEventListener('click', close);
    layer.addEventListener('click', function (e) { if (e.target === layer) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !layer.hidden) close(); });

    // 浏览器返回键：push 一条同 URL 的哨兵，返回时先弹确认并留在当前页
    try {
      history.pushState({ siGuard: true }, '');
      window.addEventListener('popstate', function () {
        if (leaving) return;
        if (siSync.dirty) {
          history.pushState({ siGuard: true }, '');
          layer.hidden = false;
        }
      });
    } catch (_) {}
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
      // 第三轮（手机实拍反馈）：侧拉工具 / 手动保存并同步 / 离开确认
      safe('工具侧拉抽屉', toolsDrawer);
      safe('手动保存并同步', manualSyncSave);
      safe('离开确认', exitConfirm);
    }
    safe('#21 即时校验', fieldValidation);   // 全站（弹窗可能在任意页出现）
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

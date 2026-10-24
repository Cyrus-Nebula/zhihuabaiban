/**
 * 首页（landing）逻辑：hero 的 AI 快速生成 + 模板与案例渲染
 * 依赖经典脚本：config.js / store.js / models.js / templates.js / workbench.js
 */
(function () {
  const CFG = window.DAJIAO_CONFIG || {};
  const MODELS = Array.isArray(window.DAJIAO_MODELS) ? window.DAJIAO_MODELS : [];
  const TEMPLATES = Array.isArray(window.DAJIAO_TEMPLATES) ? window.DAJIAO_TEMPLATES : [];
  const $ = (id) => document.getElementById(id);

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* ---------- hero AI 快速生成 ---------- */
  const modelSel = $('heroAiModel');
  MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    modelSel.appendChild(opt);
  });
  const savedModel = localStorage.getItem('dajiao-board-model');
  if (savedModel && MODELS.some((m) => m.id === savedModel)) modelSel.value = savedModel;
  modelSel.addEventListener('change', () => {
    localStorage.setItem('dajiao-board-model', modelSel.value);
  });

  const heroInput = $('heroAiInput');
  const heroSend = $('heroAiSend');
  const heroStatus = $('heroAiStatus');

  async function heroAiGenerate() {
    const message = heroInput.value.trim();
    if (!message) { toast('先描述一下要画的图形'); heroInput.focus(); return; }
    heroSend.disabled = true;
    heroSend.textContent = '生成中…';
    heroStatus.hidden = false;
    heroStatus.textContent = 'AI 正在思考并作图…';
    heroStatus.className = 'hero-ai-status pending';
    try {
      const res = await fetch(CFG.boardAiEndpoint || '/api/ai/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model: modelSel.value, context: '（空画板）' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
      if (Array.isArray(data.commands) && data.commands.length) {
        const name = message.slice(0, 16) || 'AI 画板';
        const f = Store.create(name, '2d');
        Store.saveContent(f.id, { name, commands: data.commands, moves: [] });
        location.href = 'board.html?id=' + encodeURIComponent(f.id);
        return;
      }
      // 纯聊天回复：没作图，把回复展示出来
      heroStatus.className = 'hero-ai-status';
      heroStatus.textContent = data.message || 'AI 没有生成作图命令，换个更具体的描述试试（如：画一个半径为 3 的圆）。';
    } catch (e) {
      heroStatus.className = 'hero-ai-status error';
      heroStatus.textContent = '生成失败：' + e.message;
    } finally {
      heroSend.disabled = false;
      heroSend.textContent = '生成画板';
    }
  }
  heroSend.addEventListener('click', heroAiGenerate);
  heroInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); heroAiGenerate(); }
  });

  /* ---------- 模板与案例 ---------- */
  const grid = $('tplGrid');
  TEMPLATES.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tpl-card';

    const thumb = document.createElement('div');
    thumb.className = 'tpl-thumb';
    thumb.innerHTML = t.thumb;

    const body = document.createElement('div');
    body.className = 'tpl-body';
    body.innerHTML =
      '<span class="tpl-cat"></span>' +
      '<h3 class="tpl-title"></h3>' +
      '<p class="tpl-desc"></p>' +
      '<div class="tpl-foot"><span class="tpl-author"></span></div>';
    body.querySelector('.tpl-cat').textContent = t.category;
    body.querySelector('.tpl-title').textContent = t.title;
    body.querySelector('.tpl-desc').textContent = t.desc;
    body.querySelector('.tpl-author').textContent = t.author;

    const useBtn = document.createElement('button');
    useBtn.className = 'btn btn-primary btn-sm';
    useBtn.textContent = '使用模板';
    useBtn.addEventListener('click', () => {
      const f = Store.create(t.title, '2d');
      Store.saveContent(f.id, { name: t.title, commands: t.commands, moves: [] });
      location.href = 'board.html?id=' + encodeURIComponent(f.id);
    });
    body.querySelector('.tpl-foot').appendChild(useBtn);

    card.append(thumb, body);
    grid.appendChild(card);
  });
})();

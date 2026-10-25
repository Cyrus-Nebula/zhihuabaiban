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

  /* ---------- 题目图片上传（看图作图） ---------- */
  const MAX_IMG_BYTES = 5 * 1024 * 1024;
  let pendingImage = null; // {dataUrl, name}
  const imgBtn = $('heroAiImgBtn');
  const imgInput = $('heroAiImgInput');
  const imgPreview = $('heroAiImgPreview');
  const imgThumb = $('heroAiImgThumb');
  const imgName = $('heroAiImgName');

  function clearImage() {
    pendingImage = null;
    imgPreview.classList.add('hidden');
    imgThumb.removeAttribute('src');
    imgName.textContent = '';
  }
  imgBtn.addEventListener('click', () => imgInput.click());
  $('heroAiImgClear').addEventListener('click', clearImage);
  imgInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    if (file.size > MAX_IMG_BYTES) { toast('图片不能超过 5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = { dataUrl: String(reader.result), name: file.name };
      imgThumb.src = pendingImage.dataUrl;
      imgName.textContent = pendingImage.name + '（AI 将看图作图）';
      imgPreview.classList.remove('hidden');
      // 只有视觉模型能看懂图片：当前模型不支持时自动切换
      const cur = modelSel.value;
      if (!MODELS.some((m) => m.id === cur && m.vision)) {
        const v = MODELS.find((m) => m.vision);
        if (v) {
          modelSel.value = v.id;
          localStorage.setItem('dajiao-board-model', v.id);
          heroStatus.hidden = false;
          heroStatus.className = 'hero-ai-status';
          heroStatus.textContent = `已自动切换为「${v.name}」——只有视觉模型能看懂图片。`;
        }
      }
    };
    reader.onerror = () => toast('图片读取失败');
    reader.readAsDataURL(file);
  });
  // 手动切换模型时，若挂着图片且切到了非视觉模型，给个提醒
  modelSel.addEventListener('change', () => {
    localStorage.setItem('dajiao-board-model', modelSel.value);
    if (pendingImage && !MODELS.some((m) => m.id === modelSel.value && m.vision)) {
      toast('当前模型看不懂图片，将只按文字描述作图');
    }
  });

  async function heroAiGenerate() {
    const message = heroInput.value.trim();
    const image = pendingImage ? pendingImage.dataUrl : undefined;
    if (!message && !image) { toast('先描述一下要画的图形，或上传一张题目图片'); heroInput.focus(); return; }
    heroSend.disabled = true;
    heroSend.textContent = '生成中…';
    heroStatus.hidden = false;
    heroStatus.textContent = image && !message ? 'AI 正在看题并作图…' : 'AI 正在思考并作图…';
    heroStatus.className = 'hero-ai-status pending';
    try {
      const res = await fetch(CFG.boardAiEndpoint || '/api/ai/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message || '请按这张图片中的题目画出几何图形，保留题目中的标注与已知条件',
          model: modelSel.value,
          image,
          context: '（空画板）',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
      if (Array.isArray(data.commands) && data.commands.length) {
        const name = (message || pendingImage?.name || '看图作图').slice(0, 16) || 'AI 画板';
        const f = Store.create(name, '2d');
        Store.saveContent(f.id, { name, commands: data.commands, moves: [] });
        location.href = 'board.html?id=' + encodeURIComponent(f.id);
        return;
      }
      // 纯聊天回复：没作图，把回复展示出来
      heroStatus.className = 'hero-ai-status';
      heroStatus.textContent = data.message || 'AI 没有生成作图命令，换个更具体的描述试试（如：画一个半径为 3 的圆）。';
    } catch (e) {
      // 后端已返回面向用户的完整句式时直接展示，看不懂的原始错误才加前缀
      const msg = (e && e.message) || '网络异常，请检查网络后重试';
      heroStatus.className = 'hero-ai-status error';
      heroStatus.textContent = /失败|重试|稍后|请|异常/.test(msg) ? msg : '生成失败：' + msg;
    } finally {
      heroSend.disabled = false;
      heroSend.textContent = '生成画板';
      clearImage();
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

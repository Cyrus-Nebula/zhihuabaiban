/**
 * 路线B · 多步作图工具引擎（原生交互体验核心）
 *
 * 设计目标：对标大角几何的"原生态"手感——
 *  - 点在已有对象上时自动吸附（复用该点，而不是新建一个）
 *  - 交点自动选取离点击位置近的那个
 *  - 多步工具有进度提示；Esc 取消并清理半成品；回车结束多边形
 *  - 删除工具联动 board.js 的级联删除（依赖它的对象一起删除）
 *
 * 每个工具 = 若干步骤（steps），每步分三类：
 *  'point'    自由点击取点；若命中已有点则吸附复用它
 *  'newpoint' 同 point 但不吸附（文本定位用）
 *  'object'   必须拾取已有对象（线/圆/多边形…，删除工具则任意对象）
 *
 * 依赖 ctx（由 board.js 注入）：
 *  { board, executor, nextId, runCommands, beginAction, endAction,
 *    deleteObject, removeCmds, toast, usrCoords, usrToScreen,
 *    onToolChange, onProgress }
 */

import { intersectCandidates, intersectCandidateLabels } from './executor.js';

// 点类元素：屏幕取点（吸附/选中）时优先命中它们
const POINT_LIKE = new Set(['point', 'glider', 'midpoint', 'intersection']);

export function createTools(ctx) {
  const { board, executor, nextId, runCommands, toast, usrCoords, usrToScreen } = ctx;

  const TOOLS = {
    select:        { label: '选择',   hint: '点击选中对象；可拖拽点、平移画板', steps: [] },
    point:         { label: '点',     hint: '点击画板添加一个点', steps: ['point'] },
    segment:       { label: '线段',   hint: '点击两个点画线段（点在已有对象上可自动吸附）', steps: ['point', 'point'] },
    line:          { label: '直线',   hint: '点击两个点画直线', steps: ['point', 'point'] },
    ray:           { label: '射线',   hint: '先点起点，再点经过的点', steps: ['point', 'point'] },
    circle:        { label: '圆',     hint: '先点圆心，再点圆上一点', steps: ['point', 'point'] },
    polygon:       { label: '多边形', hint: '依次点击顶点（≥3 个），回车结束', steps: ['point'], open: true },
    midpoint:      { label: '中点',   hint: '点击两个点，取它们的中点', steps: ['point', 'point'] },
    intersect:     { label: '交点',   hint: '点击两条线/圆，有多个交点时在弹出的候选里挑一个', steps: ['object', 'object'] },
    perpendicular: { label: '垂线',   hint: '先点一条线，再点线外一点作垂线', steps: ['object', 'point'] },
    parallel:      { label: '平行线', hint: '先点一条线，再点线外一点作平行线', steps: ['object', 'point'] },
    angle:         { label: '角',     hint: '依次点击：起点、顶点、终点', steps: ['point', 'point', 'point'] },
    trim:          { label: '裁剪',   hint: '先点一条线/圆，再在它上面点两点，取中间一段', steps: ['object', 'point', 'point'] },
    text:          { label: '文本',   hint: '点击画板放置文本', steps: ['newpoint'] },
    slider:        { label: '滑动条', hint: '点击画板放置滑动条：可调范围的数值参数控件', steps: ['newpoint'] },
    delete:        { label: '删除',   hint: '点击对象删除（依赖它的对象会一起删除）', steps: ['object'] },
  };

  const PREFIX = {
    segment: 's', line: 'l', ray: 'r', circle: 'c', polygon: 'poly', midpoint: 'm',
    intersect: 'x', perpendicular: 'pd', parallel: 'pl', angle: 'a', text: 't',
  };

  let current = 'select';
  let pending = [];   // {kind:'point'|'object', id, x?, y?}
  let created = [];   // 本次作图新建的点 id（取消时清理）
  let lastClick = [0, 0];

  /* ---------- 多边形绘制预览（对标大角几何：折线预览 + 到鼠标的虚线） ---------- */
  const PREVIEW_STYLE = { strokeColor: '#6549D5', strokeWidth: 1.5, dash: 2, withLabel: false, highlight: false, name: '__preview__' };
  let previewChain = null; // 已选顶点折线
  let previewSeg = null;   // 最后顶点 -> 鼠标
  let previewRaf = 0;
  let previewPos = [0, 0];

  function clearPreview() {
    if (previewChain) { try { board.removeObject(previewChain); } catch (_) { /* 忽略 */ } previewChain = null; }
    if (previewSeg) { try { board.removeObject(previewSeg); } catch (_) { /* 忽略 */ } previewSeg = null; }
  }
  /** 屏幕坐标 -> 用户坐标（不依赖 JXG 事件封装，原生 mousemove 也能用） */
  function usrFromClient(cx, cy) {
    const o = board.origin.scrCoords;
    const r = board.renderer.svgRoot.getBoundingClientRect();
    return [Math.round(((cx - r.left - o[1]) / board.unitX) * 1000) / 1000,
            Math.round(((o[2] - (cy - r.top)) / board.unitY) * 1000) / 1000];
  }
  function updatePreview() {
    clearPreview();
    if (current !== 'polygon' || !pending.length) return;
    const els = pending.map((p) => executor.registry.get(p.id)).filter(Boolean);
    if (els.length >= 2) {
      try { previewChain = board.create('polygonalchain', els, { ...PREVIEW_STYLE }); } catch (_) { previewChain = null; }
    }
    if (els.length) {
      try { previewSeg = board.create('segment', [els[els.length - 1], previewPos], { ...PREVIEW_STYLE }); } catch (_) { previewSeg = null; }
    }
  }
  // 注意：必须绑在 board 容器而不是 svgRoot——JXGraph 的 html 覆盖层会挡住真实
  // mousemove，事件 bubble 不经过 svg；JXGraph 自己也正是把事件监听挂在容器上的
  function onSvgMove(evt) {
    if (current !== 'polygon' || !pending.length) { if (previewChain || previewSeg) clearPreview(); return; }
    previewPos = usrFromClient(evt.clientX, evt.clientY);
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => { previewRaf = 0; updatePreview(); });
  }
  const boardBox = board.containerObj || document.getElementById('box');
  boardBox.addEventListener('mousemove', onSvgMove);
  boardBox.addEventListener('mouseleave', () => { if (previewChain || previewSeg) clearPreview(); });

  /* ---------- 拾取 ---------- */
  function underMouse(evt) {
    try { return board.getAllObjectsUnderMouse(evt) || []; } catch (_) { return []; }
  }
  function reverseRegistry() {
    const m = new Map();
    for (const [id, el] of executor.registry) m.set(el, id);
    return m;
  }
  /** 拾取对象；lineFirst=true 时优先线状/面状（线段/直线/圆/多边形/曲线） */
  function pickObject(evt, lineFirst = true) {
    const rev = reverseRegistry();
    let any = null;
    for (const el of underMouse(evt)) {
      const id = rev.get(el);
      if (!id) continue;
      if (any === null) any = id;
      const t = el.elType;
      if (lineFirst && (t === 'point' || t === 'glider')) continue;
      return id;
    }
    return any;
  }
  /** 拾取已有点（吸附/选中用）。交点、中点这类"派生点"也算点——
   *  否则点一个落在圆上的交点时，会先命中底下的圆而选不中点本身。 */
  function pickPoint(evt) {
    const rev = reverseRegistry();
    for (const el of underMouse(evt)) {
      if (POINT_LIKE.has(el.elType)) { const id = rev.get(el); if (id) return id; }
    }
    return null;
  }

  /* ---------- 工具切换 ---------- */
  function setTool(t) {
    if (!TOOLS[t]) t = 'select';
    cancelPending(false);
    current = t;
    if (ctx.onToolChange) ctx.onToolChange(t, TOOLS[t]);
  }
  function progress(text) { if (ctx.onProgress) ctx.onProgress(text); }

  /* ---------- 主流程 ---------- */
  function onDown(evt) {
    const def = TOOLS[current];
    if (!def || !def.steps.length) return false;
    const [x, y] = usrCoords(evt);
    lastClick = [x, y];
    // 一次完整作图 = 一个撤销单元（删除工具自己管理撤销）
    if (current !== 'delete' && !pending.length && !created.length) ctx.beginAction();

    const step = def.steps[Math.min(pending.length, def.steps.length - 1)];

    if (step === 'object') {
      const id = pickObject(evt, current !== 'delete');
      if (!id) { toast('请点击已有的线段、直线、圆等对象'); return true; }
      if (current === 'delete') {
        ctx.deleteObject(id);
        setTool('select');
        return true;
      }
      if (current === 'trim') {
        // 分段裁剪只认直线/射线/线段/圆（射线在 JXGraph 里也是 line）
        const el = executor.registry.get(id);
        const t = el && el.elType;
        if (!el || (t !== 'line' && t !== 'segment' && t !== 'circle')) {
          toast('分段裁剪只支持直线、射线、线段和圆');
          return true;
        }
      }
      pending.push({ kind: 'object', id });
      afterStep(def);
      return true;
    }

    if (current === 'text') {
      askText(x, y, (v) => {
        if (v) runCommands([{ op: 'text', id: nextId('t'), x, y, text: v }]);
        ctx.endAction();
        setTool('select');
      });
      return true;
    }

    if (current === 'slider') {
      askSlider(x, y, (p) => {
        if (p) {
          runCommands([{ op: 'slider', id: nextId('slider'), x1: x, y1: y, x2: x + 6, y2: y,
            min: p.min, max: p.max, step: p.step, value: p.start }]);
        }
        ctx.endAction();
        setTool('select');
      });
      return true;
    }

    if (current === 'trim') {
      // 第 2/3 步：在选中的线/圆上放一个动点（自动吸附到对象上），两点定一段
      const target = pending[0].id;              // 第 1 步拾取的线/圆
      const prev = pending[pending.length - 1];  // 上一个裁剪点（动点，带坐标）
      if (prev && Math.hypot(x - prev.x, y - prev.y) < 0.4) { toast('两个裁剪点太近了，分开一点'); return true; }
      const gid = nextId('g');
      const r = runCommands([{ op: 'glider', id: gid, on: target, x, y }]);
      if (!r[0] || !r[0].ok) { toast('裁剪点放置失败：' + (r[0] && r[0].error)); return true; }
      created.push(gid); // 取消时连这点一起清掉
      pending.push({ kind: 'point', id: gid, x, y });
      afterStep(def);
      return true;
    }

    let id = step === 'point' ? pickPoint(evt) : null;
    if (!id) {
      id = createPoint(x, y);
      if (!id) return true;
    }
    // 多边形：点击已选顶点 = 闭合图形（对标大角几何的交互）
    if (def.open && pending.length >= 3 && pending.some((p) => p.id === id)) { finish(); return true; }
    pending.push({ kind: 'point', id, x, y });
    afterStep(def);
    return true;
  }

  function afterStep(def) {
    if (def.open) {
      if (pending.length >= 3) progress(`多边形：已选 ${pending.length} 个顶点——点击起点闭合，或按回车/点“完成多边形”`);
      else progress(`多边形：继续点击顶点（${pending.length}/至少3个）`);
      return;
    }
    if (pending.length >= def.steps.length) { finish(); return; }
    progress(`${def.hint}（${pending.length}/${def.steps.length}）`);
  }

  /** 交点命令：候选有方位语义就写 select（拖动后仍稳定指向同一支），否则写序号 index */
  function makeIntersectCmd(ids, cands, label) {
    const c = { op: 'intersect', of: [ids[0], ids[1]] };
    const L = label || null;
    if (L && L.select) c.select = L.select;
    else {
      const cand = (cands && cands[L ? L.index : 0]) || null;
      c.index = cand ? cand.index : 0;
    }
    return c;
  }
  /** 候选点的坐标小字：(1.23, 4.56) */
  function fmtCoord(p) {
    const r = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '?');
    return `(${r(p && p.x)}, ${r(p && p.y)})`;
  }

  /** 多交点时让用户在候选里挑一个（Esc / 点外部 = 取消，回传 null） */
  function askChoice(x, y, opts, done) {
    const o = opts || {};
    const [sx, sy] = usrToScreen(x, y);
    const box = document.createElement('div');
    box.className = 'float-choice';
    if (o.title) {
      const t = document.createElement('div');
      t.className = 'float-choice-title';
      t.textContent = o.title;
      box.appendChild(t);
    }
    for (const op of (o.options || [])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'float-choice-item';
      const lab = document.createElement('span');
      lab.className = 'fc-text';
      lab.textContent = op.text;
      b.appendChild(lab);
      if (op.sub) {
        const s = document.createElement('span');
        s.className = 'fc-sub';
        s.textContent = op.sub;
        b.appendChild(s);
      }
      b.addEventListener('click', () => close(op.value));
      box.appendChild(b);
    }
    document.body.appendChild(box);
    const W = box.offsetWidth || 208;
    const H = box.offsetHeight || 120;
    box.style.left = Math.max(8, Math.min(sx, window.innerWidth - W - 8)) + 'px';
    box.style.top = Math.max(8, Math.min(sy, window.innerHeight - H - 8)) + 'px';
    let closed = false;
    const close = (val) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      box.remove();
      done(val);
    };
    function outside(ev) { if (!box.contains(ev.target)) close(null); }
    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(null); } }
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  function createPoint(x, y) {
    const cmd = { op: 'point', id: nextId('P'), x, y };
    const r = runCommands(cmd);
    if (!r[0] || !r[0].ok) return null;
    created.push(cmd.id);
    return cmd.id;
  }

  function finish() {
    clearPreview();
    const def = TOOLS[current];
    const ids = pending.map((p) => p.id);
    let cmd = null;
    let deferred = false; // 交点筛选等需要用户再选一次：由回调收尾，避免下面提前 endAction
    const extra = []; // 裁剪：隐藏原对象的后续命令（与主命令同一撤销单元）
    switch (current) {
      case 'segment': cmd = { op: 'segment', from: ids[0], to: ids[1] }; break;
      case 'line': cmd = { op: 'line', through: [ids[0], ids[1]] }; break;
      case 'ray': cmd = { op: 'ray', from: ids[0], to: ids[1] }; break;
      case 'circle': cmd = { op: 'circle', center: ids[0], through: ids[1] }; break;
      case 'polygon': cmd = { op: 'polygon', points: ids }; break;
      case 'midpoint': cmd = { op: 'midpoint', of: [ids[0], ids[1]] }; break;
      case 'perpendicular': cmd = { op: 'perpendicular', of: ids[0], through: ids[1] }; break;
      case 'parallel': cmd = { op: 'parallel', of: ids[0], through: ids[1] }; break;
      case 'angle': cmd = { op: 'angle', points: [ids[0], ids[1], ids[2]] }; break;
      case 'intersect': {
        // 交点筛选（对标大角几何 2D 工具「交点筛选」）：
        // 先把有效候选算出来——只有一个就直接画（保持原有的顺手）；
        // 有多个则弹候选浮层让用户按方位明确指定，写进命令的 select 字段，
        // 这样之后拖动画图、保存重开、回放都稳定指向同一个分支。
        const o1 = executor.registry.get(ids[0]);
        const o2 = executor.registry.get(ids[1]);
        let cands = [];
        try { cands = intersectCandidates(board, o1, o2); } catch (_) { cands = []; }
        if (!cands.length) { toast('这两个对象没有交点'); break; }
        const labels = intersectCandidateLabels(cands);
        if (labels.length > 1) {
          deferred = true;
          askChoice(lastClick[0], lastClick[1], {
            title: `选一个交点（${labels.length} 个候选）`,
            options: labels.map((L) => ({
              value: L,
              text: L.text,
              sub: fmtCoord(cands[L.index]),
            })),
          }, (choice) => {
            if (!choice) { ctx.endAction(); toast('已取消'); setTool('select'); return; }
            const c = makeIntersectCmd(ids, cands, choice);
            c.id = nextId('x');
            runCommands([c]);
            ctx.endAction();
            setTool('select');
          });
          break;
        }
        cmd = makeIntersectCmd(ids, cands, labels[0]);
        break;
      }
      case 'trim': {
        // 分段裁剪（对标大角几何：一个圆裁半边、一条线取一段，无需重画）：
        // 两个裁剪点是放在原对象上的动点，所以裁剪结果会随原对象动态变化。
        const target = ids[0];
        const el = executor.registry.get(target);
        const c0 = ctx.findCmd(target);
        // 继承原对象的颜色/线宽/线型：裁剪后看起来就是"原来那条被截短了"
        let sc = null, sw = null, sd = null;
        try { sc = el.evalVisProp('strokeColor'); } catch (_) { /* 忽略 */ }
        try { sw = Number(el.evalVisProp('strokeWidth')); } catch (_) { /* 忽略 */ }
        try { sd = Number(el.evalVisProp('dash')); } catch (_) { /* 忽略 */ }
        if (el && el.elType === 'circle' && c0 && c0.center != null) {
          cmd = { op: 'arc', id: nextId('arc'), center: c0.center, from: ids[1], to: ids[2] };
          if (typeof sc === 'string') cmd.color = sc;
          if (Number.isFinite(sw)) cmd.strokeWidth = sw;
          if (Number.isFinite(sd)) cmd.dash = sd;
        } else if (el && (el.elType === 'line' || el.elType === 'segment')) {
          cmd = { op: 'segment', id: nextId('s'), from: ids[1], to: ids[2] };
          if (typeof sc === 'string' || Number.isFinite(sw) || Number.isFinite(sd)) {
            extra.push({ op: 'style', target: cmd.id,
              color: typeof sc === 'string' ? sc : undefined,
              strokeWidth: Number.isFinite(sw) ? sw : undefined,
              dash: Number.isFinite(sd) ? sd : undefined });
          }
        } else {
          toast('分段裁剪只支持直线、射线、线段和圆');
        }
        if (cmd) extra.push({ op: 'style', target, hidden: true }); // 原对象隐藏，对象面板可随时恢复
        break;
      }
      default: break;
    }
    pending = [];
    created = [];
    if (deferred) return; // 弹出筛选层了，等用户选完再落命令
    // 点/单步工具没有对象命令，不分配 id（避免编号跳号）
    if (cmd) { if (!cmd.id) cmd.id = nextId(PREFIX[current] || 'o'); runCommands(cmd); }
    for (const c of extra) runCommands(c);
    if (cmd && current === 'trim') toast('已裁剪：原对象已隐藏，可在对象面板「显示」恢复');
    ctx.endAction();
    setTool('select');
  }

  /* ---------- 取消 / 结束多边形 ---------- */
  function cancelPending(silent) {
    clearPreview();
    if (created.length) {
      for (const cid of created) executor.remove(cid);
      ctx.removeCmds(created);
    }
    pending = [];
    created = [];
    if (!silent) ctx.endAction();
  }
  function cancel() {
    const had = pending.length || created.length;
    cancelPending(false);
    if (had) toast('已取消');
    setTool('select');
  }
  function finishPolygon() {
    if (current !== 'polygon' || pending.length < 3) { toast('至少需要 3 个顶点'); return; }
    finish();
  }

  /* ---------- 文本浮动输入框 ---------- */
  /** 通用浮动输入框：在画板坐标 (x,y) 处弹框，done(value|null) 回调 */
  function askInput(x, y, opts, done) {
    const o = opts || {};
    const [sx, sy] = usrToScreen(x, y);
    const box = document.createElement('div');
    box.className = 'float-input';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = o.placeholder || '输入文本';
    inp.maxLength = o.maxLength || 60;
    if (o.value != null) inp.value = o.value;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn small';
    ok.textContent = o.okLabel || '确定';
    box.append(inp, ok);
    const W = 250, H = 46;
    box.style.left = Math.max(8, Math.min(sx, window.innerWidth - W - 8)) + 'px';
    box.style.top = Math.max(8, Math.min(sy, window.innerHeight - H - 8)) + 'px';
    document.body.appendChild(box);
    inp.focus();
    if (o.value != null) inp.select();
    let closed = false;
    const close = (val) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('mousedown', outside, true);
      box.remove();
      done(val);
    };
    const submit = () => close(inp.value.trim() || null);
    ok.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
    function outside(ev) { if (!box.contains(ev.target)) close(null); }
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }

  function askText(x, y, done) {
    askInput(x, y, { placeholder: '输入文本，回车确认' }, done);
  }

  /** 滑动条参数输入：一行写「最小值 最大值 步长」，如 "0 10 0.5"（步长省略=连续） */
  function askSlider(x, y, done) {
    askInput(x, y, {
      placeholder: '最小值 最大值 步长，如：0 10 0.5', value: '0 10 0.5',
      maxLength: 40, okLabel: '确定',
    }, (raw) => {
      if (!raw) { done(null); return; }
      const parts = raw.split(/[\s,，]+/).map(Number).filter((n) => Number.isFinite(n));
      let min = Number.isFinite(parts[0]) ? parts[0] : 0;
      let max = Number.isFinite(parts[1]) ? parts[1] : min + 10;
      let step = Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : -1;
      if (max < min) [min, max] = [max, min];
      if (step > 0 && step > max - min) step = -1; // 步长比整个量程还大，退化成连续
      // 起点：0 在范围内就从 0 开始，否则从最小值开始
      const start = (min <= 0 && 0 <= max) ? 0 : min;
      done({ min, max, step, start });
    });
  }

  return {
    TOOLS,
    onDown,
    setTool,
    current: () => current,
    getPending: () => pending.slice(),
    finishPolygon,
    cancel,
    pick: pickObject,
    pickPoint,
    askInput,
    askChoice,
    clearPreview,
  };
}

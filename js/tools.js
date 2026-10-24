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
    intersect:     { label: '交点',   hint: '点击两条线/圆，自动取离点击近的交点', steps: ['object', 'object'] },
    perpendicular: { label: '垂线',   hint: '先点一条线，再点线外一点作垂线', steps: ['object', 'point'] },
    parallel:      { label: '平行线', hint: '先点一条线，再点线外一点作平行线', steps: ['object', 'point'] },
    angle:         { label: '角',     hint: '依次点击：起点、顶点、终点', steps: ['point', 'point', 'point'] },
    text:          { label: '文本',   hint: '点击画板放置文本', steps: ['newpoint'] },
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
  /** 拾取已有点（吸附用） */
  function pickPoint(evt) {
    const rev = reverseRegistry();
    for (const el of underMouse(evt)) {
      const t = el.elType;
      if (t === 'point' || t === 'glider') { const id = rev.get(el); if (id) return id; }
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

    let id = step === 'point' ? pickPoint(evt) : null;
    if (!id) {
      id = createPoint(x, y);
      if (!id) return true;
    }
    pending.push({ kind: 'point', id, x, y });
    afterStep(def);
    return true;
  }

  function afterStep(def) {
    if (def.open) {
      if (pending.length >= 3) progress(`多边形：已选 ${pending.length} 个顶点，回车或点“完成多边形”结束`);
      else progress(`多边形：继续点击顶点（${pending.length}/至少3个）`);
      return;
    }
    if (pending.length >= def.steps.length) { finish(); return; }
    progress(`${def.hint}（${pending.length}/${def.steps.length}）`);
  }

  function createPoint(x, y) {
    const cmd = { op: 'point', id: nextId('P'), x, y };
    const r = runCommands(cmd);
    if (!r[0] || !r[0].ok) return null;
    created.push(cmd.id);
    return cmd.id;
  }

  function finish() {
    const def = TOOLS[current];
    const ids = pending.map((p) => p.id);
    const id = nextId(PREFIX[current] || 'o');
    let cmd = null;
    switch (current) {
      case 'segment': cmd = { op: 'segment', id, from: ids[0], to: ids[1] }; break;
      case 'line': cmd = { op: 'line', id, through: [ids[0], ids[1]] }; break;
      case 'ray': cmd = { op: 'ray', id, from: ids[0], to: ids[1] }; break;
      case 'circle': cmd = { op: 'circle', id, center: ids[0], through: ids[1] }; break;
      case 'polygon': cmd = { op: 'polygon', id, points: ids }; break;
      case 'midpoint': cmd = { op: 'midpoint', id, of: [ids[0], ids[1]] }; break;
      case 'perpendicular': cmd = { op: 'perpendicular', id, of: ids[0], through: ids[1] }; break;
      case 'parallel': cmd = { op: 'parallel', id, of: ids[0], through: ids[1] }; break;
      case 'angle': cmd = { op: 'angle', id, points: [ids[0], ids[1], ids[2]] }; break;
      case 'intersect': {
        // 两个候选交点都试算，保留离点击位置近的那个
        let index = 0;
        try {
          const o1 = executor.registry.get(ids[0]);
          const o2 = executor.registry.get(ids[1]);
          const pts = board.create('intersection', [o1, o2]);
          const arr = Array.isArray(pts) ? pts : [pts];
          if (arr.length > 1) {
            let bd = Infinity;
            arr.forEach((p, i) => {
              const d = (p.X() - lastClick[0]) ** 2 + (p.Y() - lastClick[1]) ** 2;
              if (d < bd) { bd = d; index = i; }
            });
          }
          arr.forEach((p) => { try { board.removeObject(p); } catch (_) { /* 忽略 */ } });
        } catch (_) { /* 交不存在等情况交给 execute 报错 */ }
        cmd = { op: 'intersect', id, of: [ids[0], ids[1]], index };
        break;
      }
      default: break;
    }
    pending = [];
    created = [];
    if (cmd) runCommands(cmd);
    ctx.endAction();
    setTool('select');
  }

  /* ---------- 取消 / 结束多边形 ---------- */
  function cancelPending(silent) {
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
  };
}

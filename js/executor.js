/**
 * 路线B · 命令执行器（自建画板核心）
 *
 * 把 AI 生成的 JSON 命令协议翻译成 JSXGraph 构造调用。
 * 协议说明与 ai/board-prompt.js 保持一一对应，改协议时两边同步改。
 *
 * 命令协议（commands 数组，按依赖顺序执行）：
 *   clear                                      清空画板
 *   point     {id,x,y,fixed?}                  点（默认可拖拽）
 *   segment   {id,from,to}                     线段
 *   ray       {id,from,to}                     射线
 *   line      {id,through:[A,B]}               直线
 *   circle    {id,center,through|radius}       圆
 *   polygon   {id,points:[A,B,C]}              多边形
 *   midpoint  {id,of:[A,B]}                    中点
 *   intersect {id,of:[o1,o2],index?}           交点（index 0/1）
 *   glider    {id,on,x,y}                      对象上的动点
 *   perpendicular {id,of,through}              垂线
 *   parallel  {id,of,through}                  平行线
 *   function  {id,expr,from,to}                函数曲线（JSXGraph语法，如 "x^2"）
 *   text      {id,x,y,text}                    自由文本
 *   text      {id,x,y,bind:{kind,of}}          动态测量文本（kind: distance/length/radius/angle）
 *   angle     {id,points:[A,B,C]}              角（B为顶点）
 *   label     {target,text}                    设置/修改标签
 *   style     {target,color?,strokeWidth?,dash?,fill?,hidden?}  样式
 */

const POINT_STYLE = { size: 3.5, fillColor: '#1565C0', strokeColor: '#1565C0', face: 'o', withLabel: true };

/** 动态测量文本：返回 JXG 文本内容函数（每次画板更新时调用，拖拽实时刷新） */
function bindText(bind, registry) {
  const get = (id) => registry.get(id);
  const gone = () => '—'; // 绑定对象已不存在
  const f2 = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '?');
  if (bind.kind === 'distance') {
    const a = get(bind.of && bind.of[0]);
    const b = get(bind.of && bind.of[1]);
    if (!a || !b) return gone;
    return () => '距离 = ' + f2(Math.hypot(b.X() - a.X(), b.Y() - a.Y()));
  }
  if (bind.kind === 'length') {
    const el = get(bind.of);
    if (!el) return gone;
    return () => '长度 = ' + f2(typeof el.L === 'function' ? el.L() : NaN);
  }
  if (bind.kind === 'radius') {
    const el = get(bind.of);
    if (!el) return gone;
    return () => '半径 = ' + f2(typeof el.Radius === 'function' ? el.Radius() : NaN);
  }
  if (bind.kind === 'angle') {
    const el = get(bind.of);
    if (!el) return gone;
    return () => '角度 = ' + (typeof el.Value === 'function' ? (el.Value() * 180 / Math.PI).toFixed(1) : '?') + '°';
  }
  return gone;
}

export function createExecutor(board) {
  const registry = new Map();    // id -> JXG 元素
  const plainPoints = new Set(); // 可通过 moves 覆盖坐标的自由点

  function resolve(ref) {
    if (typeof ref === 'number') return ref;
    if (typeof ref === 'string') {
      // 画板自带坐标轴的伪 id：AI 求函数与轴的交点时直接引用，无需自己画轴
      if (ref === 'xaxis' && board.defaultAxes && board.defaultAxes.x) return board.defaultAxes.x;
      if (ref === 'yaxis' && board.defaultAxes && board.defaultAxes.y) return board.defaultAxes.y;
      const el = registry.get(ref);
      if (!el) throw new Error(`引用了不存在的元素「${ref}」`);
      return el;
    }
    throw new Error('非法引用: ' + JSON.stringify(ref));
  }
  const resolveList = (arr) => (Array.isArray(arr) ? arr.map(resolve) : []);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  // 给元素设置标签文本（point 行内 label 与 label op 共用）
  function applyLabel(el, text) {
    if (!el || text == null || text === '') return;
    try {
      if (el.label && typeof el.label.setText === 'function') el.label.setText(String(text));
      else if (typeof el.setLabelText === 'function') el.setLabelText(String(text));
    } catch (_) { /* 个别元素类型没有标签，忽略 */ }
  }

  function build(cmd) {
    const opt = { name: cmd.id || '' };
    switch (cmd.op) {
      case 'point': {
        const pt = board.create('point', [num(cmd.x, 0), num(cmd.y, 0)], { ...POINT_STYLE, ...opt, fixed: !!cmd.fixed });
        applyLabel(pt, cmd.label); // 模型有时把 label 直接放在点上，与独立 label op 等价
        return pt;
      }
      case 'segment':
        return board.create('segment', [resolve(cmd.from), resolve(cmd.to)], opt);
      case 'ray': // JSXGraph 无独立 ray，用 line 单向延伸实现
        return board.create('line', [resolve(cmd.from), resolve(cmd.to)], { ...opt, straightFirst: false, straightLast: true });
      case 'line': {
        // 宽容两种写法：through 给两个点的 id（标准），或直接给 4 个坐标 (x1,y1,x2,y2)
        const th = cmd.through;
        if (Array.isArray(th) && th.length >= 4 && th.slice(0, 4).every((v) => Number.isFinite(Number(v)))) {
          return board.create('line', [[Number(th[0]), Number(th[1])], [Number(th[2]), Number(th[3])]], opt);
        }
        return board.create('line', resolveList(th).slice(0, 2), opt);
      }
      case 'circle': {
        const c = resolve(cmd.center);
        // 模型有时会同时给出 through 和 radius（甚至 through==center），按优先级取：
        // through（且不是圆心自己）> radius（有限正数）> 1
        let second = null;
        if (cmd.through !== undefined && cmd.through !== null && String(cmd.through) !== String(cmd.center)) {
          try { second = resolve(cmd.through); } catch (_) { second = null; }
        }
        if (second === null) {
          const r = Number(cmd.radius);
          second = Number.isFinite(r) && r > 0 ? r : 1;
        }
        return board.create('circle', [c, second], opt);
      }
      case 'polygon':
        return board.create('polygon', resolveList(cmd.points), opt);
      case 'midpoint':
        return board.create('midpoint', resolveList(cmd.of), opt);
      case 'intersect': {
        const pts = board.create('intersection', [resolve(cmd.of && cmd.of[0]), resolve(cmd.of && cmd.of[1])]);
        const i = Math.max(0, Math.min(1, num(cmd.index, 0)));
        return Array.isArray(pts) ? pts[i] : pts;
      }
      case 'glider':
        return board.create('glider', [num(cmd.x, 0), num(cmd.y, 0), resolve(cmd.on)], opt);
      case 'function':
        return board.create('functiongraph', [String(cmd.expr || ''), num(cmd.from, -10), num(cmd.to, 10)], { ...opt, strokeColor: '#C62828', strokeWidth: 2 });
      case 'text': {
        // bind：动态测量文本（内容为函数，拖拽时实时刷新）
        //   {kind:'distance', of:[A,B]} 两点距离
        //   {kind:'length',   of:线段id} 线段长度
        //   {kind:'radius',   of:圆id}   圆半径
        //   {kind:'angle',    of:角id}   角度（度）
        const content = cmd.bind ? bindText(cmd.bind, registry) : String(cmd.text == null ? '' : cmd.text);
        // display:'internal' 用 SVG <text> 渲染；默认的 'html' 是覆盖整个画板的 DIV，
        // 会让 getAllObjectsUnderMouse 在任何位置都命中文本，破坏点选/删除
        return board.create('text', [num(cmd.x, 0), num(cmd.y, 0), content], { ...opt, display: 'internal' });
      }
      case 'angle': {
        const ang = board.create('angle', resolveList(cmd.points), opt);
        // JXGraph 默认把元素名当角标签（如 "ang1"），清掉只留弧线/直角标记
        if (ang.label && typeof ang.label.setText === 'function') ang.label.setText('');
        return ang;
      }
      case 'perpendicular':
        return board.create('perpendicular', [resolve(cmd.of), resolve(cmd.through)], opt);
      case 'parallel':
        return board.create('parallel', [resolve(cmd.of), resolve(cmd.through)], opt);
      case 'label': {
        const el = resolve(cmd.target);
        const t = String(cmd.text == null ? '' : cmd.text);
        if (el.elType === 'text') { if (typeof el.setText === 'function') el.setText(t); }
        else if (el.label && typeof el.label.setText === 'function') el.label.setText(t);
        else if (typeof el.setText === 'function') el.setText(t);
        else if (typeof el.setLabel === 'function') el.setLabel(t);
        return null;
      }
      case 'style': {
        const el = resolve(cmd.target);
        const a = {};
        if (cmd.color) { a.strokeColor = cmd.color; a.highlightStrokeColor = cmd.color; a.fillColor = cmd.color; }
        if (cmd.strokeWidth != null) a.strokeWidth = num(cmd.strokeWidth, 2);
        if (cmd.dash != null) a.dash = num(cmd.dash, 0);
        if (cmd.fill) { a.fillColor = cmd.color || '#90CAF9'; a.fillOpacity = 0.25; }
        if (cmd.hidden != null) a.visible = !cmd.hidden;
        el.setAttribute(a);
        return null;
      }
      default:
        throw new Error('未知命令 op: ' + cmd.op);
    }
  }

  function clearAll() {
    for (const el of registry.values()) {
      try { board.removeObject(el); } catch (_) { /* 忽略 */ }
    }
    registry.clear();
    plainPoints.clear();
  }

  /** 从画板和注册表移除单个元素（删除工具/取消未完成作图用） */
  function remove(id) {
    const el = registry.get(id);
    if (!el) return false;
    try { board.removeObject(el); } catch (_) { /* 忽略 */ }
    registry.delete(id);
    plainPoints.delete(id);
    return true;
  }

  /** 执行命令数组，返回每条命令的执行结果（成功/失败+原因） */
  function execute(commands) {
    const out = [];
    for (const cmd of Array.isArray(commands) ? commands : []) {
      if (!cmd || typeof cmd !== 'object') continue;
      try {
        if (cmd.op === 'clear') { clearAll(); out.push({ ok: true, op: 'clear' }); continue; }
        const el = build(cmd);
        if (cmd.id) {
          if (registry.has(cmd.id)) throw new Error(`id「${cmd.id}」重复定义`);
          if (el) registry.set(cmd.id, el);
          if (cmd.op === 'point') plainPoints.add(cmd.id);
        }
        out.push({ ok: true, op: cmd.op, id: cmd.id || null });
      } catch (e) {
        out.push({ ok: false, op: cmd.op, id: cmd.id || null, error: String((e && e.message) || e) });
      }
    }
    return out;
  }

  /** 当前画板元素摘要（作为 AI 的上下文） */
  function describe() {
    const items = [];
    for (const [id, el] of registry) items.push(id + '(' + (el.elType || '?') + ')');
    return items.length ? items.join(', ') : '（空画板）';
  }

  /** 导出自由点当前坐标（拖拽后保存用） */
  function moves() {
    const out = [];
    for (const id of plainPoints) {
      const el = registry.get(id);
      if (el && typeof el.X === 'function') {
        out.push({ id, x: Math.round(el.X() * 1000) / 1000, y: Math.round(el.Y() * 1000) / 1000 });
      }
    }
    return out;
  }

  /** 加载时把保存的坐标覆盖回自由点 */
  function applyMoves(list) {
    const COORDS_BY_USER = 1; // JXG.COORDS_BY_USER 的固定值，避免依赖全局
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || !plainPoints.has(m.id)) continue;
      const el = registry.get(m.id);
      if (!el) continue;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      try { el.setPosition(COORDS_BY_USER, [x, y]); }
      catch (_) { try { el.moveTo([x, y]); } catch (_) { /* 忽略 */ } }
    }
  }

  return { execute, describe, moves, applyMoves, clearAll, remove, registry, has: (id) => registry.has(id) };
}

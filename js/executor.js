/**
 * 路线B · 命令执行器（自建画板核心）
 *
 * 把 AI 生成的 JSON 命令协议翻译成 JSXGraph 构造调用。
 * 协议说明与 ai/board-prompt.js 保持一一对应，改协议时两边同步改。
 *
 * 命令协议（commands 数组，按依赖顺序执行）：
 *   clear                                      清空画板
 *   point     {id,x,y,fixed?}                  点（默认可拖拽；x/y 也可以是滑动条 id）
 *   segment   {id,from,to}                     线段
 *   ray       {id,from,to}                     射线
 *   line      {id,through:[A,B]}               直线
 *   circle    {id,center,through|radius}       圆（radius 也可以是滑动条 id）
 *   polygon   {id,points:[A,B,C]}              多边形
 *   midpoint  {id,of:[A,B]}                    中点
 *   intersect {id,of:[o1,o2],index?}           交点（index 0/1）
 *   glider    {id,on,x,y}                      对象上的动点
 *   arc       {id,center,from,to,color?,strokeWidth?,dash?,clockwise?}  圆弧（以 center 为圆心，从 from 点扫到 to 点）
 *   perpendicular {id,of,through}              垂线
 *   parallel  {id,of,through}                  平行线
 *   slider    {id,x1,y1,x2,y2,min,max,value?,step?}  滑动条参数控件（拖动改值）
 *   function  {id,expr,from,to}                函数曲线（JSXGraph语法，如 "x^2"）
 *   text      {id,x,y,text}                    自由文本
 *   text      {id,x,y,bind:{kind,of}}          动态测量文本（kind: distance/length/radius/angle/value）
 *   angle     {id,points:[A,B,C]}              角（B为顶点）
 *   label     {target,text}                    设置/修改标签
 *   style     {target,color?,strokeWidth?,dash?,fill?,hidden?}  样式
 *
 * 动态联动：凡是能写常数的地方（point 的 x/y、circle 的 radius）都可以写滑动条 id，
 * 执行器会把它翻译成取值函数，拖动滑动条时几何体实时跟着变。
 * 函数曲线的 expr 里直接写滑动条 id 即可（JSXGraph 会自动替换成 .Value()）。
 */

const POINT_STYLE = { size: 3.5, fillColor: '#3E44D9', strokeColor: '#3E44D9', face: 'o', withLabel: true };

/** 取元素的数值（滑动条/角等有 Value() 的元素），取不到返回 NaN */
function numericOf(el) {
  if (!el || typeof el.Value !== 'function') return NaN;
  const v = Number(el.Value());
  return Number.isFinite(v) ? v : NaN;
}

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
  if (bind.kind === 'value') {
    // 显示滑动条（或其他有 Value() 的元素）的实时数值
    const el = get(bind.of);
    if (!el) return gone;
    const dg = Number(bind.digits);
    const digits = Math.max(0, Math.min(6, Number.isFinite(dg) ? dg : 2));
    const prefix = bind.prefix == null ? '' : String(bind.prefix);
    return () => {
      const v = numericOf(el);
      return prefix + (Number.isFinite(v) ? v.toFixed(digits) : '?');
    };
  }
  return gone;
}

export function createExecutor(board) {
  const registry = new Map();    // id -> JXG 元素
  const plainPoints = new Set(); // 可通过 moves 覆盖坐标的自由点
  const sliders = new Set();     // 滑动条 id（值随 moves 一起持久化）

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

  /** 数值位置上的反查：字符串若是已注册 id，返回取实时值的函数（交给 JXG 做动态依赖） */
  function valueGetter(v) {
    if (typeof v === 'string' && registry.has(v)) {
      const el = registry.get(v);
      return () => numericOf(el);
    }
    return null;
  }
  /** 数值参数：数字照旧；元素 id 则转成取值函数；都不是则用默认值 */
  function numOrRef(v, d) {
    if (v == null) return d;
    const direct = Number(v);
    if (Number.isFinite(direct)) return direct;
    const g = valueGetter(v);
    return g || d;
  }

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
        // x/y 可以是常数，也可以是滑动条 id —— 后者拖条时点会跟着移动
        const pt = board.create('point', [numOrRef(cmd.x, 0), numOrRef(cmd.y, 0)], { ...POINT_STYLE, ...opt, fixed: !!cmd.fixed });
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
          const g = valueGetter(cmd.radius);
          if (g) {
            // 半径绑定滑动条：夹一个下限，避免拖到 0 时圆退化报错
            second = () => {
              const v = g();
              const a = Number.isFinite(v) ? Math.abs(v) : NaN;
              return Number.isFinite(a) && a > 1e-6 ? a : 1e-6;
            };
          } else {
            const r = Number(cmd.radius);
            second = Number.isFinite(r) && r > 0 ? r : 1;
          }
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
      case 'arc': {
        // 圆弧：JSXGraph arc 三件套 = 圆心 + 半径点 + 终角点（底层是 curve）。
        // from/to 一般为圆上的两个点（分段裁剪工具会把它们放成圆上的动点），
        // 原圆变大变小时弧随之贴合；color/strokeWidth/dash 可省略，默认与线/圆一致（蓝 2px 实线）。
        const a = {
          ...opt,
          strokeColor: cmd.color || '#0072B2',
          highlightStrokeColor: cmd.color || '#0072B2',
          strokeWidth: cmd.strokeWidth != null ? num(cmd.strokeWidth, 2) : 2,
          orientation: cmd.clockwise ? 'clockwise' : 'counterclockwise',
        };
        if (cmd.dash != null) a.dash = num(cmd.dash, 0);
        return board.create('arc', [resolve(cmd.center), resolve(cmd.from), resolve(cmd.to)], a);
      }
      case 'slider': {
        // 滑动条：可拖动的数值参数控件。id 应尽量用单个小写字母（a/b/c…），
        // 因为函数表达式里是直接按名字引用它的（JSXGraph 会自动替换成 .Value()）。
        // 未指定位置时按已有个数往下排，避免多个滑动条叠在一起。
        const idx = sliders.size;
        const x1 = num(cmd.x1, -8), y1 = num(cmd.y1, Math.min(-1.5, -9 + idx * 0.9));
        const x2 = num(cmd.x2, x1 + 6), y2 = num(cmd.y2, y1);
        let min = num(cmd.min, 0), max = num(cmd.max, 10);
        if (max < min) [min, max] = [max, min];
        const start = Math.min(max, Math.max(min, num(cmd.value, num(cmd.start, min))));
        const step = Number(cmd.step);
        return board.create('slider', [[x1, y1], [x2, y2], [min, start, max]], {
          ...opt,
          withLabel: true,
          snapWidth: Number.isFinite(step) && step > 0 ? step : -1,
        });
      }
      case 'function': {
        // expr 里出现滑动条名字时，JSXGraph 的表达式解析器会自动取它的实时值，
        // 因此拖动滑动条曲线会跟着重算——无需额外处理。
        // 取值范围：from/to 是定义域（x 区间，默认 -10~10）；ymin/ymax 是值域裁剪
        // （只画 y 落在区间内的那一段曲线，留空表示不裁剪）。
        const expr = String(cmd.expr || '');
        let from = num(cmd.from, -10), to = num(cmd.to, 10);
        if (to < from) { const t = from; from = to; to = t; }
        let ymin = cmd.ymin, ymax = cmd.ymax;
        if (Array.isArray(cmd.range) && ymin == null && ymax == null) { ymin = cmd.range[0]; ymax = cmd.range[1]; }
        const lo = Number(ymin), hi = Number(ymax);
        let fn = expr;
        if (Number.isFinite(lo) || Number.isFinite(hi)) {
          let a = Number.isFinite(lo) ? lo : -Infinity;
          let b = Number.isFinite(hi) ? hi : Infinity;
          if (b < a) { const t = a; a = b; b = t; }
          // 值域裁剪：把区间外的采样点记成 NaN，JXGraph 会自动断开/略过这些点。
          // 表达式仍走 JessieCode 编译（与 JXGraph 内部一致），所以滑动条联动照样生效。
          const compile = board.jc && typeof board.jc.snippet === 'function';
          if (!compile) {
            // 极端情况（引擎缺 JessieCode）：退化为只按定义域出图，不裁剪值域
            return board.create('functiongraph', [expr, from, to], { ...opt, strokeColor: '#C62828', strokeWidth: 2 });
          }
          const snip = board.jc.snippet(expr, true, 'x', false);
          fn = (x) => {
            const v = snip(x);
            return (Number.isFinite(v) && v >= a && v <= b) ? v : NaN;
          };
        }
        return board.create('functiongraph', [fn, from, to], { ...opt, strokeColor: '#C62828', strokeWidth: 2 });
      }
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
        if (cmd.fill) { a.fillColor = cmd.color || '#C7D2FE'; a.fillOpacity = 0.25; }
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
    sliders.clear();
  }

  /** 从画板和注册表移除单个元素（删除工具/取消未完成作图用） */
  function remove(id) {
    const el = registry.get(id);
    if (!el) return false;
    try { board.removeObject(el); } catch (_) { /* 忽略 */ }
    registry.delete(id);
    plainPoints.delete(id);
    sliders.delete(id);
    return true;
  }

  const isLiteralNum = (v) => v != null && Number.isFinite(Number(v));

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
          // 坐标被别的对象驱动的点是依赖点，不能再当成可拖拽的自由点保存坐标
          if (cmd.op === 'point' && isLiteralNum(cmd.x) && isLiteralNum(cmd.y)) plainPoints.add(cmd.id);
          if (cmd.op === 'slider') sliders.add(cmd.id);
        }
        out.push({ ok: true, op: cmd.op, id: cmd.id || null });
      } catch (e) {
        out.push({ ok: false, op: cmd.op, id: cmd.id || null, error: String((e && e.message) || e) });
      }
    }
    return out;
  }

  /** 当前画板元素摘要（作为 AI 的上下文）；滑动条带出当前值，方便 AI 接着改 */
  function describe() {
    const items = [];
    for (const [id, el] of registry) {
      if (el.elType === 'slider') {
        const v = numericOf(el);
        items.push(id + '(滑动条=' + (Number.isFinite(v) ? Math.round(v * 100) / 100 : '?') + ')');
      } else {
        items.push(id + '(' + (el.elType || '?') + ')');
      }
    }
    return items.length ? items.join(', ') : '（空画板）';
  }

  /** 导出自由点坐标 + 滑动条当前值（拖拽后保存用） */
  function moves() {
    const out = [];
    for (const id of plainPoints) {
      const el = registry.get(id);
      if (el && typeof el.X === 'function') {
        out.push({ id, x: Math.round(el.X() * 1000) / 1000, y: Math.round(el.Y() * 1000) / 1000 });
      }
    }
    for (const id of sliders) {
      const v = numericOf(registry.get(id));
      if (Number.isFinite(v)) out.push({ id, v: Math.round(v * 1000) / 1000 });
    }
    return out;
  }

  /** 加载时把保存的坐标覆盖回自由点、把保存的数值写回滑动条 */
  function applyMoves(list) {
    const COORDS_BY_USER = 1; // JXG.COORDS_BY_USER 的固定值，避免依赖全局
    let restoredSlider = false;
    for (const m of Array.isArray(list) ? list : []) {
      if (!m) continue;
      // 滑动条：{id, v}
      if (m.v !== undefined && sliders.has(m.id)) {
        const el = registry.get(m.id);
        const v = Number(m.v);
        if (!el || !Number.isFinite(v)) continue;
        try { el.setValue(v); restoredSlider = true; } catch (_) { /* 忽略 */ }
        continue;
      }
      if (!plainPoints.has(m.id)) continue;
      const el = registry.get(m.id);
      if (!el) continue;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      try { el.setPosition(COORDS_BY_USER, [x, y]); }
      catch (_) { try { el.moveTo([x, y]); } catch (_) { /* 忽略 */ } }
    }
    // 滑动条是几何体的上游，写回后必须整体刷新一次，依赖它的点/圆/曲线才会跟到新值
    if (restoredSlider) { try { board.update(); } catch (_) { /* 忽略 */ } }
  }

  return { execute, describe, moves, applyMoves, clearAll, remove, registry, has: (id) => registry.has(id) };
}

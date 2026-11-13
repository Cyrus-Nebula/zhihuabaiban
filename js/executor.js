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
 *   intersect {id,of:[o1,o2],index?|select?}  交点（多个交点时用 index 或 select 指定取哪一个：
 *                                              select = top/bottom/left/right/near(配 near:[x,y])；
 *                                              index = 0/1/2… 按序号取）
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
 *   style     {target,color?,strokeColor?,fillColor?,strokeWidth?,dash?,fill?,opacity?,fillOpacity?,labelColor?,labelSize?,hidden?}  样式
 *             （细粒度：描边/填色可分设；opacity 0~1 整体透明，fillOpacity 单管填充；labelColor/labelSize 改标签文字）
 *   measure   {kind:'distance',of:[A,B]} | {kind:'angle',of:[A,B,C]} | {kind:'evaluate',expr,x?}  测量/自检（回读数值；画板上生成临时读数文本，不持久化）
 *   verify    {kind,of|expr,expect?,tol?,rtol?,expectRange?:[lo,hi],label?}  声明式自检断言：在 measure 三种求值之上加机器判定
 *             （expect + tol(默认0.05) 或 rtol 相对容差；expectRange 区间），execute 回传 pass:true/false/null；pass:false 触发前端多轮收敛修正轮（最多 3 轮）
 *             · 关系断言（本轮新增，贴近大角几何符号自检）：以下 kind 把"关系"折算成「残差≈0」的标量，直接复用 expect/tol 判定
 *               perpendicular {kind,of:[A,B,C,D],expect:0,tol:0.5}  AB⊥CD（残差=|两线夹角-90°|）
 *               parallel      {kind,of:[A,B,C,D],expect:0,tol:0.5}  AB∥CD（残差=两线夹角[0,90]）
 *               collinear     {kind,of:[A,B,C,...],expect:0,tol:0.05}  多点共线（残差=各点到首连线段的最大距离）
 *               online        {kind,of:[P,lineId]|[P,A,B],expect:0,tol:0.05}  点 P 在直线上（残差=点到线距离；第二项可填直线/线段 id 或两点）
 *               oncircle      {kind,of:[P,circleId],expect:0,tol:0.05}  点 P 在圆上（残差=|P到圆心距离-半径|）
 *             · 关系断言只判定「成立与否」（残差夹在容差内即 pass:true），不回读具体距离/角度；label 可另起中文名
 *   transform {id,of,type,by?|angle?|center?|axis?}  几何变换：把 of 元素平移/旋转/反射成一份新副本（以 id 命名），
 *                                                            type=translate(by:[dx,dy]) / rotate(angle,center?) / reflect(axis|center?)；支持 point/segment/line/ray/polygon/circle
 *   animate    {id|ids,pingpong?,speed?}             动画：让指定滑动条（id 或 ids，或 "__all__"）自动连续改值，依赖它的几何实时播放；speed: slow/normal/fast，pingpong:true 往复。仅前端播放，不进文档
 *   move      {id,x,y} | {id,v}                      增量修正：就地移动已存在的自由点 / 改滑动条当前值（不新建图元、不改 id）。
 *                                                    同 id 重新 point 会被 execute 判「id 重复定义」而失败，自检自动修正改坐标一律用 move；
 *                                                    依赖它的线/圆/多边形由 JSXGraph 联动自动刷新。多轮收敛闭环的核心配套命令。
 *
 * 本文件职责（命令协议执行）：measure 命令回读几何量，并经 execute 结果透传 value（见 case 'measure'），
 *   画板上生成的临时灰色读数不进注册表/文档（transient）。
 * 其余分工：
 *   - 协议新增几何变换 op（reflect/rotate/translate）与 animate 命令：已完成（见 transform / animate 分支）。
 *   - read-back 闭环（测量→与预期不符则自动修正）：已在 js/board.js 的 aiSend() 前端驱动——执行命令后收集
 *     measure 的 value，回传给 LLM 二次核对并自动补发修正命令（对标大角几何 MCP 式读画板状态后改图）。
 *     本文件提供 clearMeasures() 供闭环在每轮自检前清掉上一轮的临时读数，避免堆积。
 * TODO(下一步): 1) 打磨自动修正策略（放宽/收紧"不符"判定阈值、支持多轮收敛、修正前先 diff 再改）；
 *   2) 前端可视化：在 AI 面板更清晰地呈现自检读数/修正动作（如"已自检：∠AHB=90.0° ✔ 已修正 1 处"）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-07 第二轮）：
 *   (1) 新增 verify 声明式自检断言：把 measure 的 distance/angle/evaluate 求值抽成 measureValue()，
 *       叠加 expect/tol/rtol/expectRange 机器判定并回传 pass；此前注释声称 read-back 闭环已落地，
 *       实际 aiSend() 未接入，本轮在 js/board.js 补齐（verify pass:false → 一次【自检回读】修正轮，不递归）。
 *   (2) style 细粒度样式（兑现上一轮 TODO 交接项）：opacity/fillOpacity/strokeColor/fillColor/labelColor/labelSize；
 *       标签是独立 text 对象，单独 setAttribute。measure/verify 临时读数按 pass 着色（绿✓/红✗/灰·）。
 * TODO(下一步·本轮之后): 1) 多轮收敛（连续 2~3 轮 verify→修正，带上限与改动 diff，避免反复横跳）；
 *   2) [本轮已完成] 把 expect 扩展到"关系断言"（perpendicular/parallel/collinear/online/oncircle，残差≈0 复用 judgeMeasure；见 measureValue 新分支与 ai/board-prompt.js 例9、docs 用例 32~36）；
 *   3) 自检状态条可视化（"已自检 2 项，✘ 1 项，已修正 1 处"）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-12 第二轮）：只改 2D 协议，3D 分支零触碰。
 *   (1) 恢复 move 增量修正命令（曾被 84815b71 简化掉）：就地改自由点坐标 / 滑动条当前值，
 *       不新建图元、不改注册表，execute 对 move 单独放行（跳过「id 重复定义」检查）；
 *       同 id 重新 point 会失败，自检自动修正改坐标一律走 move，依赖几何由 JSXGraph 联动刷新。
 *   (2) 新增 probeVerify(cmd) 并导出：静默复判一条 verify（只求值 + judgeMeasure 判定，
 *       不生成画板读数、不落文档），供 js/board.js 的多轮收敛闭环在每轮修正后复跑
 *       首轮原始 verify，用 pass 机器判定是否收敛，避免每轮堆一叠 ✔/✘ 文本。
 * TODO(下一步): 1) 自检状态条做成 AI 面板固定徽标（现为逐轮日志行）；
 *   2) 收敛判定引入"残差改善量"而不只数失败项（如 63°→85° 已接近，可再给一轮）；
 *   3) 收敛后把 probeVerify 的结果回画成最终 ✔ 读数（现在修正轮清掉临时读数，只留面板日志）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-12 第四轮）：只改 2D 协议，3D 分支零触碰。
 *   补齐「读取画板状态」的实质短板：此前 describe() 只回 id(类型)（+滑动条值），AI 看不到
 *   已有元素的坐标/半径/定义域，因此在现有图形上继续构造（作高线、求外心、求交点）时只能猜坐标。
 *   本轮把状态升级为「数值快照」：点/交点/中点/glider 带当前坐标、直线/线段带两端点、圆带圆心与半径、
 *   多边形带顶点坐标、函数曲线带表达式与定义域、滑动条带当前值；execute 为 functiongraph 挂
 *   __aiExpr/__aiRange 供 describe 读取。快照带 60 元素 / 2200 字符上限，后端 context 上限同步放宽。
 *   配套：ai/board-prompt.js 新增「读取画板状态」规则 + 例12 few-shot、docs 回归用例 41/42。
 * TODO(下一步): 1) [本轮已完成 2026-11-13 第二轮] 新增 inspect 命令让 AI 主动查询任意元素数值（两阶段回读）；
 *   2) 自检状态条做成 AI 面板固定徽标；3) 收敛判定引入「残差改善量」而不只数失败项。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-13 第二轮）：只改 2D 协议，3D 分支零触碰。
 *   落实三处 TODO 一致的头号待办——新增 inspect 主动查询命令（两阶段回读，对标大角几何 MCP 式
 *   「读画板状态 → 再构造」）：AI 首轮可只发 inspect 读派生对象（交点/中点/圆心半径/滑动条值）的
 *   精确数值，js/board.js 把读数以【查询读数】回填，AI 第二轮据此输出构造命令。
 *   (1) 把 describe() 的单元素数值摘要抽成 elementSummary(id, el)，describe() 与 inspectValue() 共用，
 *       保证「状态快照」与「主动查询读数」格式严格一致；describe() 输出行为不变。
 *   (2) 新增 inspectValue(cmd)：支持 id / ids:[] / ids:"__all__"（不给即查全部）；只读注册表，
 *       不创建任何画板对象、不画临时读数、不进注册表/文档；未知 id 返回 "id(不存在)" 而不抛错；
 *       读数带 60 元素 / 2200 字符双上限，经 execute 的 {reading:{items,text}} 透传给前端闭环。
 *   (3) build() 与 execute() 新增 inspect 分支（在 registry.set 之前 continue，避免把纯数据对象注册成图元）。
 *   配套：ai/board-prompt.js 命令清单登记 inspect +「主动查询」小节 + 例16；docs 回归用例 47/48。
 * TODO(下一步): ① inspect 支持带 x 直接查函数值 / 两点距离等派生量（现可用 measure evaluate 替代）；
 *   ② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；
 *   ④ 收敛后把 probeVerify 结果回画成最终 ✔ 读数。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-13 第四轮）：只改 2D 协议，3D 分支零触碰。
 *   落实上一轮 TODO 头号待办①——inspect 派生量查询（AI 不再需要心算 / 猜派生数值）：
 *   (1) 新增 deriveName(d) / deriveReading(d)：复用 measureValue 的 8 种 kind 求值，
 *       格式 "|AH|=4.000" / "∠AHB=90.0°" / "evaluate(x^2-4,x=2)=0.000"；
 *   (2) inspectValue(cmd) 追加三种写法：顶层 kind 简写、derive 数组批量、id + x / xs 查已注册函数值；
 *       单条求值失败宽容降级为 "xxx(?)"，不整批失败；reading 新增 derived 数组，text 合并摘要与派生量；
 *   (3) 纯查派生量（未给 id/ids）时不再默认列出全部元素，避免读数噪音；旧 inspect 形态输出逐字节不变。
 *   零改动 js/board.js：读数仍走既有【查询读数】两阶段回读（isTransient 已含 inspect，registry.set 前 continue）。
 *   配套：ai/board-prompt.js 命令清单登记 +「派生量查询」小节 + 例18；docs 回归用例 50~52。
 * TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *   ③ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；④ derive 支持「符号化简」输出（如顶点式配方）；
 *   ⑤ 给 inspect 派生量补无头单测脚本并纳入仓库 tests/。
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

/* ---------- 交点筛选（对标大角几何 2D 工具「交点筛选」）----------
 * 两个对象相交时可能有多个交点。JSXGraph 的 intersection 接受第三个 parent 作为
 * "取第几个交点"的下标（0/1/2…），但一次只返回单个点、下标越界也不报错（坐标变成 NaN）。
 * 之前所有写法都漏了这个下标参数——AI 写 {"index":1} 想取第二个交点时，实际画出来的
 * 仍然是第一个点。这里把候选算出来再按条件挑一个，顺便让「取上方那个交点」这种
 * 语义化需求能表达成命令里的 select 字段（重建/拖拽后依然稳定指向同一个分支）。
 */

/** 语义筛选条件 select 的中文名（UI 与作图记录共用） */
export const SELECT_CN = {
  top: '上方', bottom: '下方', left: '左侧', right: '右侧',
  near: '最近', first: '第一个', last: '最后一个',
};

/** 几何体是否真的经过某点（用于识破"伪交点"）——认不出来的类型一律放行，避免误杀 */
function elContainsPoint(el, x, y, tol) {
  const t = el && el.elType;
  try {
    if (t === 'circle') {
      return Math.abs(Math.hypot(x - el.center.X(), y - el.center.Y()) - el.Radius()) < tol;
    }
    if (t === 'line' || t === 'axis' || t === 'segment' || t === 'arrow' || t === 'ticks') {
      const p1 = el.point1, p2 = el.point2;
      if (p1 && p2) {
        const dx = p2.X() - p1.X(), dy = p2.Y() - p1.Y();
        const len = Math.hypot(dx, dy);
        if (len > 0) return Math.abs((x - p1.X()) * dy - (y - p1.Y()) * dx) / len < tol;
      }
      return true;
    }
    if ((t === 'curve' || t === 'functiongraph') && typeof el.X === 'function' && typeof el.Y === 'function') {
      // 函数曲线的参数就是 x：X(x)≈x 时，只要 Y(x) 也对得上就算在曲线上
      if (Math.abs(el.X(x) - x) < tol) return Math.abs(el.Y(x) - y) < tol * 8;
    }
  } catch (_) { /* 忽略：算不出来就当通过 */ }
  return true;
}

/** 试探两个对象的全部交点：返回 [{index,x,y}…]（index 是 JSXGraph 的下标，去重后可能不连续） */
export function intersectCandidates(board, o1, o2, limit) {
  const out = [];
  if (!board || !o1 || !o2) return out;
  const unit = Math.abs(Number(board.unitX)) > 0 ? Math.abs(Number(board.unitX)) : 30;
  const tol = Math.max(0.5 / unit, 1e-6);       // 判定"在不在几何体上"：约半个屏幕像素
  const same = Math.max(0.05 / unit, 1e-9);     // 判定"是不是同一个点"：相切时两支只差浮点噪声
  const max = Number(limit) > 0 ? Number(limit) : 4;
  for (let i = 0; i < max; i++) {
    let made = null;
    try { made = board.create('intersection', [o1, o2, i], { name: '', withLabel: false }); }
    catch (_) { break; } // 这两个类型根本不能求交
    const arr = Array.isArray(made) ? made : [made];
    let x = NaN, y = NaN;
    try { x = Number(arr[0].X()); y = Number(arr[0].Y()); } catch (_) { /* 忽略 */ }
    arr.forEach((p) => { try { board.removeObject(p); } catch (_) { /* 忽略 */ } });
    if (!Number.isFinite(x) || !Number.isFinite(y)) break; // 越界：后面也不会再有
    // 并不相交时 JSXGraph 不会报错，而是给回一个 (0,0) 之类的伪点——必须验明正身
    if (!elContainsPoint(o1, x, y, tol) || !elContainsPoint(o2, x, y, tol)) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.y - y) < same)) continue; // 相切：两支是同一个点
    out.push({ index: i, x, y });
  }
  return out;
}

/** 按命令里的 select / index 决定用第几个候选（返回 cands 的下标） */
export function pickIntersectIndex(cands, cmd) {
  const list = Array.isArray(cands) ? cands : [];
  const n = list.length;
  if (!n) return 0;
  const argmin = (fn) => { let bi = 0, bv = Infinity; list.forEach((c, i) => { const v = fn(c); if (v < bv) { bv = v; bi = i; } }); return bi; };
  const argmax = (fn) => argmin((c) => -fn(c));
  const sel = String((cmd && (cmd.select || cmd.pick)) || '').toLowerCase();
  switch (sel) {
    case 'top': case 'upper': case '上': return argmax((c) => c.y);
    case 'bottom': case 'lower': case '下': return argmin((c) => c.y);
    case 'left': case '左': return argmin((c) => c.x);
    case 'right': case '右': return argmax((c) => c.x);
    case 'first': return 0;
    case 'last': return n - 1;
    case 'near': case 'nearest': case '最近': {
      const raw = cmd && cmd.near;
      const ref = Array.isArray(raw) ? [Number(raw[0]), Number(raw[1])] : null;
      if (!ref || !Number.isFinite(ref[0]) || !Number.isFinite(ref[1])) break;
      return argmin((c) => Math.hypot(c.x - ref[0], c.y - ref[1]));
    }
    default: break;
  }
  // 没写筛选条件（或条件认不出来）：写了 index 就按 index 取，否则第 0 个（旧行为）
  const idx = Number(cmd && cmd.index);
  if (Number.isFinite(idx)) return Math.max(0, Math.min(n - 1, Math.trunc(idx)));
  return 0;
}

/** 候选的人类可读标签：两个候选按方位说（上/下、左/右），多了就报序号 */
export function intersectCandidateLabels(cands) {
  const list = Array.isArray(cands) ? cands : [];
  if (list.length < 2) return list.length ? [{ key: 'only', text: '交点', select: null, index: 0 }] : [];
  if (list.length === 2) {
    const [a, b] = list;
    const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    if (vertical) {
      const upper = a.y >= b.y ? 0 : 1;
      return [
        { key: 'top', text: SELECT_CN.top, select: 'top', index: upper },
        { key: 'bottom', text: SELECT_CN.bottom, select: 'bottom', index: 1 - upper },
      ];
    }
    const left = a.x <= b.x ? 0 : 1;
    return [
      { key: 'left', text: SELECT_CN.left, select: 'left', index: left },
      { key: 'right', text: SELECT_CN.right, select: 'right', index: 1 - left },
    ];
  }
  return list.map((c, i) => ({ key: 'i' + i, text: `第 ${i + 1} 个`, select: null, index: i }));
}

/** 命令当前选中的是哪个候选（用于在 UI 里标记激活态） */
export function intersectActiveLabel(cands, cmd) {
  const labels = intersectCandidateLabels(cands);
  if (!labels.length) return null;
  const list = Array.isArray(cands) ? cands : [];
  const xi = list[pickIntersectIndex(list, cmd)];
  if (xi) {
    const hit = labels.find((L) => L.index === xi.index);
    if (hit) return hit;
  }
  return labels[0];
}

export function createExecutor(board) {
  const registry = new Map();    // id -> JXG 元素
  const plainPoints = new Set(); // 可通过 moves 覆盖坐标的自由点
  const sliders = new Set();     // 滑动条 id（值随 moves 一起持久化）
  const measureEls = [];         // 上一轮自检的临时读数文本，clearMeasures() 清掉，避免堆积

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

  // verify 关系断言的中文读数名（其余沿用 distance/angle 或 expr/kind）
  const KIND_NAME = {
    distance: '距离', angle: '∠',
    perpendicular: '⊥残差', parallel: '∥残差', collinear: '共线残差', online: '在线上残差', oncircle: '在圆上残差',
  };

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

  /** 三点夹角（度），B 为顶点；用于 measure kind=angle 自检 */
  function angleDeg(A, B, C) {
    const ux = A.X() - B.X(), uy = A.Y() - B.Y();
    const vx = C.X() - B.X(), vy = C.Y() - B.Y();
    const dot = ux * vx + uy * vy;
    const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
    if (la < 1e-9 || lb < 1e-9) return NaN;
    let c = dot / (la * lb);
    c = Math.max(-1, Math.min(1, c));
    return Math.acos(c) * 180 / Math.PI;
  }

  /** 取一组点 id 的当前坐标 [x,y]（关系断言用） */
  function coordsOf(refs) {
    return (Array.isArray(refs) ? refs : [refs]).map((r) => {
      const el = resolve(r);
      return [el.X(), el.Y()];
    });
  }

  /** 取直线/线段/射线元素的两个端点坐标（关系断言用），取不到返回 null */
  function lineEndpoints(el) {
    let p1 = el.point1, p2 = el.point2;
    if ((!p1 || typeof p1.X !== 'function') && Array.isArray(el.points) && el.points.length >= 2) {
      p1 = el.points[0]; p2 = el.points[1];
    }
    if (!p1 || !p2 || typeof p1.X !== 'function' || typeof p2.X !== 'function') return null;
    return [[p1.X(), p1.Y()], [p2.X(), p2.Y()]];
  }

  /** 取圆元素圆心与半径（关系断言用），取不到返回 null */
  function circleGeom(el) {
    const c = el.center;
    if (!c || typeof c.X !== 'function') return null;
    const cx = c.X(), cy = c.Y();
    let r = el.radius;
    if (typeof r === 'number') { /* number */ }
    else if (typeof r === 'function') r = r();
    else if (r && typeof r.X === 'function') r = Math.hypot(r.X() - cx, r.Y() - cy);
    else if (typeof el.Radius === 'function') r = el.Radius();
    else return null;
    return [cx, cy, r];
  }

  /** 点 P 到过 A、B 两点的直线的距离 */
  function pointLineDist(P, A, B) {
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(P[0] - A[0], P[1] - A[1]);
    return Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / len;
  }

  /** 两方向向量夹角（度，归一到 [0,180]） */
  function angleBetweenDirs(d1, d2) {
    const a1 = Math.atan2(d1[1], d1[0]);
    const a2 = Math.atan2(d2[1], d2[0]);
    let d = Math.abs(a1 - a2) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d * 180 / Math.PI;
  }

  /** 在 x 处求表达式（JSXGraph 语法）的数值；优先用 JessieCode 编译，失败回退到受限算术求值 */
  function evalExprAt(expr, x) {
    const s = String(expr || '');
    if (board.jc && typeof board.jc.snippet === 'function') {
      try {
        const fn = board.jc.snippet(s, true, 'x', false);
        const v = Number(fn(Number(x)));
        if (Number.isFinite(v)) return v;
      } catch (_) { /* 回退 */ }
    }
    try {
      const js = s.replace(/\^/g, '**')
        .replace(/\bpi\b/gi, '(' + Math.PI + ')')
        .replace(/\be\b/gi, '(' + Math.E + ')');
      return Number(Function('x', 'return (' + js + ');')(Number(x)));
    } catch (_) { return NaN; }
  }

  /** 画一个临时测量读数文本（不进注册表/文档；按 pass 着色：绿✓/红✗/灰·） */
  function measureReadout(text, pos, pass) {
    const color = pass === false ? '#C62828' : pass === true ? '#2E7D32' : '#555';
    return board.create('text', [pos[0], pos[1], text], {
      name: '', withLabel: false, display: 'internal',
      fontSize: 11, color, strokeColor: color,
    });
  }

  /** measure / verify 共用的求值：返回 {value, kind, unit, at}；kind 非法抛错由外层捕获 */
  function measureValue(cmd) {
    const kind = String(cmd.kind || 'distance').toLowerCase();
    if (kind === 'distance') {
      const a = resolve(cmd.of && cmd.of[0]);
      const b = resolve(cmd.of && cmd.of[1]);
      return { value: Math.hypot(b.X() - a.X(), b.Y() - a.Y()), kind, unit: '',
        at: [(a.X() + b.X()) / 2 + 0.4, (a.Y() + b.Y()) / 2 + 0.4] };
    }
    if (kind === 'angle') {
      const A = resolve(cmd.of && cmd.of[0]);
      const B = resolve(cmd.of && cmd.of[1]);
      const C = resolve(cmd.of && cmd.of[2]);
      return { value: angleDeg(A, B, C), kind, unit: '°', at: [B.X() + 0.4, B.Y() + 0.4] };
    }
    if (kind === 'evaluate') {
      const value = evalExprAt(cmd.expr, cmd.x);
      return { value, kind, unit: '',
        at: Array.isArray(cmd.at) ? cmd.at : [Number(cmd.x) || 0, (Number.isFinite(value) ? value : 0) + 0.6] };
    }
    // —— 关系断言（本轮新增）：把"关系"折算成「残差≈0」的标量，复用 judgeMeasure 的 expect/tol 判定 ——
    if (kind === 'perpendicular' || kind === 'parallel') {
      const [A, B, C, D] = coordsOf(cmd.of);
      const d1 = [B[0] - A[0], B[1] - A[1]];
      const d2 = [D[0] - C[0], D[1] - C[1]];
      const ang = angleBetweenDirs(d1, d2); // [0,180]
      const value = kind === 'perpendicular' ? Math.abs(ang - 90) : Math.min(ang, 180 - ang);
      return { value, kind, unit: '°', at: [(A[0] + D[0]) / 2 + 0.4, (A[1] + D[1]) / 2 + 0.4] };
    }
    if (kind === 'collinear') {
      const pts = coordsOf(cmd.of);
      let A = null, B = null;
      outer:
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) > 1e-6) { A = pts[i]; B = pts[j]; break outer; }
        }
      }
      let value = 0;
      if (A && B) for (const P of pts) value = Math.max(value, pointLineDist(P, A, B));
      const c = pts[0] || [0, 0];
      return { value, kind, unit: '', at: [c[0] + 0.4, c[1] + 0.4] };
    }
    if (kind === 'online') {
      const refs = Array.isArray(cmd.of) ? cmd.of : [];
      if (refs.length === 2) {
        // of:[P, lineId]：第二项是直线/线段/射线 id
        const P = coordsOf(refs[0])[0];
        const line = lineEndpoints(resolve(refs[1]));
        const value = line ? pointLineDist(P, line[0], line[1]) : NaN;
        return { value, kind, unit: '', at: [P[0] + 0.4, P[1] + 0.4] };
      }
      // of:[P, A, B] 三点式：点 P 到过 A、B 的直线
      const [P, A, B] = coordsOf(refs);
      return { value: pointLineDist(P, A, B), kind, unit: '', at: [P[0] + 0.4, P[1] + 0.4] };
    }
    if (kind === 'oncircle') {
      const refs = Array.isArray(cmd.of) ? cmd.of : [];
      const P = coordsOf(refs[0])[0];
      const g = circleGeom(resolve(refs[1]));
      const value = g ? Math.abs(Math.hypot(P[0] - g[0], P[1] - g[1]) - g[2]) : NaN;
      return { value, kind, unit: '', at: [P[0] + 0.4, P[1] + 0.4] };
    }
    throw new Error('kind 只能是 distance / angle / evaluate / perpendicular / parallel / collinear / online / oncircle');
  }

  /** verify 期望值机器判定：expect(+tol/rtol) 点判定 / expectRange:[lo,hi] 区间；没给期望字段则只回读 */
  function judgeMeasure(value, cmd) {
    const tol = num(cmd.tol, num(cmd.atol, 0.05));
    const rtol = Number(cmd.rtol);
    if (Array.isArray(cmd.expectRange) && cmd.expectRange.length >= 2) {
      const lo = Number(cmd.expectRange[0]), hi = Number(cmd.expectRange[1]);
      const a = Math.min(lo, hi), b = Math.max(lo, hi);
      return { pass: Number.isFinite(value) && value >= a - tol && value <= b + tol, expected: `[${a}, ${b}]` };
    }
    if (cmd.expect != null || cmd.expected != null) {
      const e = Number(cmd.expect != null ? cmd.expect : cmd.expected);
      if (!Number.isFinite(e)) return { pass: false, expected: null };
      const t = Number.isFinite(rtol) ? Math.max(tol, Math.abs(e) * rtol) : tol;
      return { pass: Number.isFinite(value) && Math.abs(value - e) <= t, expected: e };
    }
    return { pass: null, expected: null }; // 无期望值：只回读，不判定（等价 measure）
  }

  /**
   * 静默复判一条 verify：只求值 + 机器判定，不生成画板临时读数、不进注册表/文档。
   * 供 js/board.js 的多轮收敛闭环在每轮修正后复跑「首轮原始 verify」，用 pass 判定是否收敛，
   * 避免每轮都往画板堆一叠 ✔/✘ 文本（首轮读数保留、修正轮静默）。
   * 返回 { value, kind, pass, expected }；kind 非法 / 元素缺失时抛错，由外层 try 兜住。
   */
  function probeVerify(cmd) {
    const m = measureValue(cmd);
    const j = judgeMeasure(m.value, cmd);
    return { value: m.value, kind: m.kind, pass: j.pass, expected: j.expected };
  }

  /** 点 (x,y) 关于过 p1、p2 两点的直线的对称点坐标 */
  function reflectAcrossLine(x, y, p1, p2) {
    const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return [x, y]; // 两点重合退化：当关于该点对称处理
    const t = ((x - x1) * dx + (y - y1) * dy) / len2;
    const px = x1 + t * dx, py = y1 + t * dy; // 在直线上的投影
    return [2 * px - x, 2 * py - y];
  }

  /** 解析几何变换命令，返回映射函数 (x,y) => [x', y']（translate / rotate / reflect） */
  function transformFn(cmd, resolve) {
    const type = String(cmd.type || '').toLowerCase();
    // center 既可以是点 id，也可以是 [x,y] 坐标（省缺原点）
    const centerOf = (c) => {
      if (c == null) return [0, 0];
      if (Array.isArray(c) && c.length >= 2) return [Number(c[0]) || 0, Number(c[1]) || 0];
      const el = resolve(c); // 点 id：取其实时坐标
      return [el.X(), el.Y()];
    };
    if (type === 'translate') {
      const by = Array.isArray(cmd.by) ? cmd.by : (Array.isArray(cmd.vector) ? cmd.vector : [0, 0]);
      const dx = Number(by[0]) || 0, dy = Number(by[1]) || 0;
      return (x, y) => [x + dx, y + dy];
    }
    if (type === 'rotate') {
      const th = (Number(cmd.angle) || 0) * Math.PI / 180;
      const [cx, cy] = centerOf(cmd.center);
      const cos = Math.cos(th), sin = Math.sin(th);
      return (x, y) => {
        const rx = x - cx, ry = y - cy;
        return [cx + (rx * cos - ry * sin), cy + (rx * sin + ry * cos)];
      };
    }
    if (type === 'reflect') {
      if (cmd.axis != null) {
        const ax = resolve(cmd.axis); // 直线/线段 id：取它的两个端点定轴
        const p1 = [ax.point1.X(), ax.point1.Y()];
        const p2 = [ax.point2.X(), ax.point2.Y()];
        return (x, y) => reflectAcrossLine(x, y, p1, p2);
      }
      const [cx, cy] = centerOf(cmd.center); // 关于点中心对称（省缺原点）
      return (x, y) => [2 * cx - x, 2 * cy - y];
    }
    throw new Error('transform.type 只能是 translate / rotate / reflect');
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
        // 两个对象可能有多个交点：先算出有效候选，再按 select（方位语义）/ index（序号）挑一个，
        // 最后把下标作为第三个 parent 交给 JSXGraph——不给下标它就永远只返回第一个分支。
        const o1 = resolve(cmd.of && cmd.of[0]);
        const o2 = resolve(cmd.of && cmd.of[1]);
        const cands = intersectCandidates(board, o1, o2);
        if (!cands.length) throw new Error('这两个对象没有交点（可能并不相交，或交点超出了画板范围）');
        const pick = cands[pickIntersectIndex(cands, cmd)];
        return board.create('intersection', [o1, o2, pick.index], opt);
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
        const clamp01 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null; };
        if (cmd.color) { a.strokeColor = cmd.color; a.highlightStrokeColor = cmd.color; a.fillColor = cmd.color; }
        // 细粒度：单独指定描边/填色，覆盖 color 里的对应项
        if (cmd.strokeColor) { a.strokeColor = cmd.strokeColor; a.highlightStrokeColor = cmd.strokeColor; }
        if (cmd.fillColor) a.fillColor = cmd.fillColor;
        if (cmd.strokeWidth != null) a.strokeWidth = num(cmd.strokeWidth, 2);
        if (cmd.dash != null) a.dash = num(cmd.dash, 0);
        if (cmd.fill) { a.fillColor = cmd.color || cmd.fillColor || '#C7D2FE'; a.fillOpacity = 0.25; }
        // 透明度 0~1：opacity 同时管描边与填充，fillOpacity 可再单独覆盖填充
        if (cmd.opacity != null) {
          const o = clamp01(cmd.opacity);
          if (o != null) { a.strokeOpacity = o; a.fillOpacity = o; }
        }
        if (cmd.fillOpacity != null) {
          const o = clamp01(cmd.fillOpacity);
          if (o != null) a.fillOpacity = o;
        }
        if (cmd.hidden != null) a.visible = !cmd.hidden;
        el.setAttribute(a);
        // JSXGraph 的标签是独立 text 对象，颜色/字号要单独设（不是图元自身的属性）
        if (el.label && typeof el.label.setAttribute === 'function' &&
            (cmd.labelColor != null || cmd.labelSize != null || cmd.labelOpacity != null)) {
          const la = {};
          if (cmd.labelColor != null) la.strokeColor = String(cmd.labelColor);
          if (cmd.labelSize != null) {
            const s = Number(cmd.labelSize);
            if (Number.isFinite(s) && s > 0) la.fontSize = s;
          }
          if (cmd.labelOpacity != null) {
            const o = clamp01(cmd.labelOpacity);
            if (o != null) la.strokeOpacity = o;
          }
          try { el.label.setAttribute(la); } catch (_) { /* 个别元素标签不可改，忽略 */ }
        }
        return null;
      }
      case 'move': {
        // 增量修正（多轮收敛闭环的配套命令）：就地改已存在自由点的坐标 / 滑动条当前值。
        // 同 id 重新 point 会被 execute 判「id 重复定义」而失败，move 直接 setPosition，
        // 依赖它的线/圆/多边形由 JSXGraph 联动刷新，是自检自动修正最稳的改法。
        // 本分支不新建图元、返回 null，execute 里对 move 单独放行（跳过注册表重复检查）。
        const target = registry.get(cmd.id);
        if (!target) throw new Error(`move.id「${cmd.id}」不存在（只能改已建好的元素）`);
        if (cmd.v !== undefined && typeof target.setValue === 'function') {
          const v = Number(cmd.v);
          if (!Number.isFinite(v)) throw new Error('move.v 必须是数字');
          target.setValue(v);
          try { board.update(); } catch (_) { /* 忽略 */ }
          return null;
        }
        if (!plainPoints.has(cmd.id)) throw new Error('move 只支持自由点（point）或滑动条，不能移动依赖点/线');
        const x = Number(cmd.x), y = Number(cmd.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('move.x / move.y 必须是数字');
        const COORDS_BY_USER = 1; // JXG.COORDS_BY_USER 的固定值，避免依赖全局
        try { target.setPosition(COORDS_BY_USER, [x, y]); }
        catch (_) { try { target.moveTo([x, y]); } catch (_) { /* 忽略 */ } }
        try { board.update(); } catch (_) { /* 忽略 */ }
        return null;
      }
      case 'inspect': {
        // 主动查询（两阶段回读）：只读注册表元素的当前数值，不创建任何画板对象、
        // 不画临时读数、不进注册表/文档；读数由 execute 透传给 js/board.js 的【查询读数】闭环。
        return { __inspect: true, reading: inspectValue(cmd) };
      }
      case 'measure': {
        // 测量/自检回读（对标大角几何 MCP 式读画板状态）：求值交给 measureValue，
        // 生成临时读数文本（不进注册表/文档），数值经 execute 结果透传给前端闭环。
        const m = measureValue(cmd);
        const name = cmd.label || KIND_NAME[m.kind] || (m.kind === 'distance' ? '距离' : m.kind === 'angle' ? '∠' : String(cmd.expr || m.kind));
        const shown = Number.isFinite(m.value) ? m.value.toFixed(m.kind === 'angle' ? 1 : 2) + m.unit : '?';
        const el = measureReadout('✓ ' + name + ' = ' + shown, m.at);
        measureEls.push(el);
        return { __measure: true, el, value: m.value };
      }
      case 'verify': {
        // 声明式自检断言：在 measure 的 distance/angle/evaluate 求值之上加期望值机器判定。
        //   expect + tol(绝对容差，默认 0.05) / rtol(相对容差) → 点判定
        //   expectRange:[lo,hi] → 区间判定
        // 关系断言（perpendicular/parallel/collinear/online/oncircle）把"关系"折算成「残差≈0」的标量，
        // 同样走 expect/tol 判定（残差落在容差内即 pass:true）。
        // 不给期望字段则 pass:null（只回读，等价 measure）。pass:false 由 js/board.js 的
        // read-back 闭环自动发起多轮收敛修正（最多 3 轮，每轮 probeVerify 复判），AI 收【自检回读】只发修正命令（见提示词例6/例7/例10）。
        const m = measureValue(cmd);
        const j = judgeMeasure(m.value, cmd);
        const name = cmd.label || KIND_NAME[m.kind] || (m.kind === 'distance' ? '距离' : m.kind === 'angle' ? '∠' : String(cmd.expr || m.kind));
        const shown = Number.isFinite(m.value) ? m.value.toFixed(m.kind === 'angle' ? 1 : 3) + m.unit : '?';
        const mark = j.pass === true ? '✓' : j.pass === false ? '✗' : '·';
        const el = measureReadout(mark + ' ' + name + ' = ' + shown + (j.expected != null ? ' / 期望 ' + j.expected : ''), m.at, j.pass);
        measureEls.push(el);
        return { __verify: true, el, value: m.value, kind: m.kind, pass: j.pass, expected: j.expected };
      }
      case 'transform': {
        // 几何变换 op（本轮新增，对标"几何变换"作图）：把源元素按 type 做平移/旋转/反射，
        // 生成一份以 cmd.id 命名的新副本。此前只能靠"坐标数值化手算"兜底（易错），现由执行器
        // 在运行期读取源元素坐标后计算并落点——AI 只需声明"对谁做哪种变换"，无需手算坐标。
        //   translate: {type:'translate', by:[dx,dy]}                               平移向量
        //   rotate:    {type:'rotate', angle:角度(度), center:'O'|[x,y]（省缺绕原点）}  旋转
        //   reflect:   {type:'reflect', axis:'l1'（直线/线段 id，关于该线对称）}
        //                       | {center:'O'|[x,y]（关于该点中心对称，省缺原点）}
        // 支持 point / segment / line / ray / polygon / circle；副本为静态落点（不随源拖拽实时
        // 联动），但回放/保存时按命令重建，行为稳定。type 非法时抛错由外层捕获。
        const src = resolve(cmd.of);
        if (!src) throw new Error('transform.of 引用的元素不存在');
        const f = transformFn(cmd, resolve);
        const et = src.elType;
        if (et === 'point') {
          const [nx, ny] = f(src.X(), src.Y());
          const pt = board.create('point', [nx, ny], { ...POINT_STYLE, ...opt });
          applyLabel(pt, cmd.label);
          return pt;
        }
        if (et === 'circle') {
          const [cx, cy] = f(src.center.X(), src.center.Y());
          const r = typeof src.Radius === 'function' ? src.Radius() : 1;
          return board.create('circle', [[cx, cy], r], opt);
        }
        if (et === 'polygon') {
          const coords = (src.vertices || []).map((v) => { const [x, y] = f(v.X(), v.Y()); return [x, y]; });
          if (coords.length < 2) throw new Error('多边形顶点数不足，无法变换');
          return board.create('polygon', coords, opt);
        }
        if (['segment', 'arrow', 'line', 'axis', 'ray'].includes(et)) {
          const p1 = src.point1, p2 = src.point2;
          if (!p1 || !p2) throw new Error('该对象无可用的两个端点，无法变换');
          const [x1, y1] = f(p1.X(), p1.Y());
          const [x2, y2] = f(p2.X(), p2.Y());
          if (et === 'line' || et === 'axis') return board.create('line', [[x1, y1], [x2, y2]], opt);
          if (et === 'ray') return board.create('line', [[x1, y1], [x2, y2]], { ...opt, straightFirst: false, straightLast: true });
          return board.create('segment', [[x1, y1], [x2, y2]], opt);
        }
        throw new Error('transform 暂不支持 elType=' + et + '（目前支持 point/segment/line/polygon/circle）');
      }
      case 'animate': {
        // 动画命令（本轮新增，对标大角几何「滑动条 + 自动播放」）：
        // 让指定滑动条(id 或 ids，或 "__all__")自动连续改值，依赖它的点/圆/曲线随之实时重算，
        // 形成可讲解的动态演示。执行器只做校验并返回目标，真正的播放由前端按既有动画引擎驱动
        // （见 js/board.js 的 animPlayTargets）。不注册任何画板元素、不进文档/历史。
        //   {"op":"animate","id":"a"}                 播放单个滑动条
        //   {"op":"animate","ids":["a","b"]}          同时播放多个
        //   {"op":"animate","ids":"__all__"}          播放全部滑动条
        //   {"op":"animate","id":"a","pingpong":true,"speed":"normal"}  往复 / 速度(slow|normal|fast)
        const ids = cmd.ids != null
          ? (Array.isArray(cmd.ids) ? cmd.ids : [cmd.ids])
          : (cmd.id != null ? [cmd.id] : []);
        if (!ids.length) throw new Error('animate 必须指定 id 或 ids');
        const bad = ids.filter((id) => {
          const el = registry.get(id);
          return !(el && el.elType === 'slider');
        });
        if (bad.length) throw new Error('animate 目标不是滑动条或不存在：' + bad.join(', '));
        const speed = ['slow', 'normal', 'fast'].includes(cmd.speed) ? cmd.speed : 'normal';
        return { ids: ids.filter((id) => registry.has(id)), pingpong: cmd.pingpong === true, speed };
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
      const built = build(cmd);
      if (cmd.op === 'inspect') {
        // 主动查询：纯只读动作，读数透传给前端【查询读数】两阶段回读；不注册图元、不进文档。
        // 必须在 registry.set 之前 continue —— build 返回的是纯数据对象而非 JXG 元素。
        out.push({ ok: true, op: 'inspect', id: cmd.id || null,
          reading: (built && built.reading) || { items: [], text: '' } });
        continue;
      }
      // 测量/自检断言命令：build 已在画板生成临时读数文本（副作用），数值（及 pass）回传；不进注册表/文档
      if (cmd.op === 'measure' || cmd.op === 'verify') {
        const isVerify = cmd.op === 'verify';
        out.push({
          ok: true, op: cmd.op, id: cmd.id || null,
          value: built && built.value,
          ...(isVerify ? {
            kind: built && built.kind,
            pass: built && built.__verify ? built.pass : null,
            expected: built && built.expected,
          } : {}),
        });
        continue;
      }
      if (cmd.op === 'animate') {
        // 动画是纯前端动作（驱动既有滑动条播放），不注册画板元素；把目标回传给前端去启动播放
        out.push({ ok: true, op: 'animate', ids: (built && built.ids) || [], pingpong: !!(built && built.pingpong), speed: (built && built.speed) || 'normal' });
        continue;
      }
      if (cmd.op === 'move') {
        // 就地修正：不新建图元、不改注册表（id 已存在，跳过「重复定义」检查）；
        // build 的 move 分支已完成 setPosition / setValue，这里只回透传成功结果。
        out.push({ ok: true, op: 'move', id: cmd.id || null });
        continue;
      }
      const el = built;
      // 函数曲线把表达式与定义域挂在元素上，describe() 才能把它们写进 AI 的数值状态快照
      if (cmd.op === 'function' && el) {
        el.__aiExpr = String(cmd.expr || '');
        const a = Number.isFinite(Number(cmd.from)) ? Number(cmd.from) : -10;
        const b = Number.isFinite(Number(cmd.to)) ? Number(cmd.to) : 10;
        el.__aiRange = [Math.min(a, b), Math.max(a, b)];
      }
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

  /** 清掉上一轮自检留下的临时读数文本（read-back 闭环在每轮自检前调用，避免堆积） */
  function clearMeasures() {
    for (const el of measureEls) {
      try { board.removeObject(el); } catch (_) { /* 忽略 */ }
    }
    measureEls.length = 0;
  }

  /* ---------- 元素数值摘要（describe 与 inspect 共用，保证两处读数格式一致） ---------- */
  const fmtNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '?';
  };
  const fmtPoint = (p) => '(' + fmtNum(p[0]) + ',' + fmtNum(p[1]) + ')';
  const POINT_TYPES = new Set(['point', 'glider', 'intersection', 'midpoint']);
  const LINE_TYPES = new Set(['line', 'segment', 'ray', 'arrow', 'axis', 'ticks']);

  /**
   * 单个元素的数值摘要："id(类型@数值)"；取值失败退回 "id(类型)"，绝不抛错。
   * describe()（首轮状态快照）与 inspectValue()（inspect 主动查询）共用同一套格式，
   * 避免两处读数漂移；新增元素类型时只需改这里。
   */
  function elementSummary(id, el) {
    const t = (el && el.elType) || '?';
    let desc = t;
    try {
      if (t === 'slider' || t === 'checkbox') {
        const v = numericOf(el);
        desc = '滑动条=' + (Number.isFinite(v) ? Math.round(v * 100) / 100 : '?');
      } else if (POINT_TYPES.has(t) && typeof el.X === 'function' && typeof el.Y === 'function') {
        desc = t + '@' + fmtPoint([el.X(), el.Y()]);
      } else if (t === 'circle') {
        const g = circleGeom(el);
        if (g) desc = 'circle@O' + fmtPoint([g[0], g[1]]) + ',r=' + fmtNum(g[2]);
      } else if (LINE_TYPES.has(t)) {
        const ep = lineEndpoints(el);
        if (ep) desc = t + '@' + fmtPoint(ep[0]) + '->' + fmtPoint(ep[1]);
      } else if (t === 'polygon' && Array.isArray(el.vertices)) {
        const vs = el.vertices.slice(0, 6)
          .filter((v) => v && typeof v.X === 'function' && typeof v.Y === 'function')
          .map((v) => fmtPoint([v.X(), v.Y()]));
        if (vs.length) desc = 'polygon@[' + vs.join(' ') + (el.vertices.length > 6 ? ' …' : '') + ']';
      } else if (t === 'functiongraph' || t === 'curve') {
        desc = 'function' + (el.__aiExpr ? ':"' + el.__aiExpr + '"' : '')
          + (Array.isArray(el.__aiRange) ? '@[' + fmtNum(el.__aiRange[0]) + ',' + fmtNum(el.__aiRange[1]) + ']' : '');
      }
    } catch (_) { desc = t; /* 单个元素取值失败就退回类型摘要 */ }
    return id + '(' + desc + ')';
  }

  /** 拼接并截断一组摘要（describe / inspect 共用，60 元素 / 2200 字符双上限） */
  function joinSummaries(items) {
    const MAX_ITEMS = 60;
    let out = items.slice(0, MAX_ITEMS).join(', ');
    if (items.length > MAX_ITEMS) out += ` …（另有 ${items.length - MAX_ITEMS} 个元素省略）`;
    if (out.length > 2200) out = out.slice(0, 2200) + ' …（状态快照过长已截断）';
    return out;
  }

  /**
   * 当前画板元素摘要（AI 的「读取画板状态」上下文）——数值快照，不只是 id(类型)。
   * 点/交点/中点/动点带坐标、线/线段带端点、圆带圆心半径、多边形带顶点、
   * 函数带表达式与定义域、滑动条带当前值；取不到数值时退回类型摘要，绝不让 describe 抛错。
   * 逐元素 try/catch + 总长上限，避免复杂画板把上下文撑爆或被后端截断掉后半段。
   */
  function describe() {
    const items = [];
    for (const [id, el] of registry) items.push(elementSummary(id, el));
    const out = joinSummaries(items);
    return items.length ? out : '（空画板）';
  }

  /**
   * 主动查询元素当前数值（inspect 命令 · 两阶段回读）。
   * 只读注册表，不创建任何画板对象、不画临时读数、不进注册表/文档；读数以 text 回传给
   * js/board.js，由前端以【查询读数】回填给 LLM，AI 第二轮据此继续构造
   * （对标大角几何 MCP 式「读画板状态 → 再构造」）。
   *   {"op":"inspect","id":"H"}              查单个
   *   {"op":"inspect","ids":["H","c1"]}      查多个
   *   {"op":"inspect","ids":"__all__"}       查全部（等价 describe()）
   * 不给 id/ids/target 默认查全部；未知 id 回 "id(不存在)"，不抛错。
   * 本轮新增「派生量查询」：带 kind / derive / x / xs 时，在元素摘要之外再回读由元素算出的
   * 数值（距离 / 夹角 / 表达式取值 / 关系残差），见下方 deriveName / deriveReading。
   * 纯查派生量（没给 id）时不默认列全部元素，避免读数噪音。
   */
  /** inspect 派生量读数名：单条求值失败也要留个可读名字，不让整批查询失败。 */
  function deriveName(d) {
    const kind = String((d && d.kind) || 'distance').toLowerCase();
    if (d && d.label) return String(d.label);
    if (kind === 'distance') return '|' + (Array.isArray(d.of) ? d.of.join('') : '?') + '|';
    if (kind === 'angle') return '∠' + (Array.isArray(d.of) ? d.of.join('') : '?');
    if (kind === 'evaluate') return 'evaluate(' + String(d.expr) + ',x=' + String(d.x) + ')';
    return kind + '(' + (Array.isArray(d.of) ? d.of.join(',') : '') + ')';
  }

  /** 单条派生量求值 → "名字=数值+单位"；复用 measureValue（纯计算，不画读数、不进注册表）。 */
  function deriveReading(d) {
    const m = measureValue(d);
    const v = Number.isFinite(m.value) ? m.value.toFixed(m.kind === 'angle' ? 1 : 3) : '?';
    return deriveName(d) + '=' + v + (m.unit || '');
  }

  function inspectValue(cmd) {
    const raw = cmd.ids != null ? cmd.ids
      : (cmd.id != null ? cmd.id : (cmd.target != null ? cmd.target : null));

    // —— 本轮新增：派生量查询（对标大角几何「符号计算 / 读状态后求量」）——
    // 除「元素数值摘要」外，允许 AI 直接查询由这些元素算出的数值：两点距离、三点夹角、
    // 表达式/函数在某 x 处的值、以及关系残差（点到线距离 / 共线 / 垂直 / 在圆上 …）。
    // 求值完全复用 measureValue（纯计算，不画临时读数、不进注册表），因此与 measure/verify
    // 读数天然一致，且 js/board.js 的【查询读数】两阶段回读链路零改动（只透传 reading.text）。
    // 三种写法可混用、可叠加：
    //   {"op":"inspect","kind":"distance","of":["A","H"]}                   顶层单条（简写）
    //   {"op":"inspect","derive":[{"kind":"angle","of":["A","H","B"]}, …]}   批量
    //   {"op":"inspect","id":"f1","x":2} / {"...","xs":[-1,0,2]}             查已注册函数在 x 处的值
    // 单条失败只回 "xxx(?)"，绝不整批失败；旧命令（无 kind/derive/x/xs）行为逐字节不变。
    const derives = [];
    if (cmd.kind != null) derives.push(cmd);
    if (Array.isArray(cmd.derive)) derives.push(...cmd.derive.filter((d) => d && typeof d === 'object'));
    else if (cmd.derive && typeof cmd.derive === 'object') derives.push(cmd.derive);
    const xs = cmd.xs != null
      ? (Array.isArray(cmd.xs) ? cmd.xs : [cmd.xs])
      : (cmd.x != null ? [cmd.x] : []);
    const hasDerive = derives.length > 0 || xs.length > 0;

    let ids;
    if (raw == null) ids = hasDerive ? [] : Array.from(registry.keys());
    else if (raw === '__all__') ids = Array.from(registry.keys());
    else if (Array.isArray(raw)) ids = raw.map(String);
    else ids = [String(raw)];
    const items = ids.map((id) => registry.has(id) ? elementSummary(id, registry.get(id)) : id + '(不存在)');

    const derived = [];
    for (const d of derives) {
      try { derived.push(deriveReading(d)); }
      catch (_) { derived.push(deriveName(d) + '(?)'); }   // 宽容降级：坏一条不拖垮整批
    }
    // 函数值简写：id/target 是单个已注册函数，带 x（或 xs 数组）时按注册表里的表达式求值。
    if (xs.length && typeof raw === 'string' && raw !== '__all__') {
      const fx = registry.get(raw);
      for (const xv of xs) {
        const x = Number(xv);
        if (!Number.isFinite(x)) { derived.push(raw + '(x=?)'); continue; }
        if (!fx || !fx.__aiExpr) { derived.push(raw + '(' + x + ')=?无函数表达式'); continue; }
        try {
          const m = measureValue({ kind: 'evaluate', expr: fx.__aiExpr, x });
          derived.push(raw + '(' + x + ')=' + (Number.isFinite(m.value) ? m.value.toFixed(3) : '?'));
        } catch (_) { derived.push(raw + '(' + x + ')=?'); }
      }
    }

    const text = joinSummaries(items.concat(derived)) || '（空画板，没有可查询的元素）';
    return { items, derived, text };
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

  return { execute, describe, moves, applyMoves, clearAll, remove, clearMeasures, probeVerify, registry, has: (id) => registry.has(id) };
}

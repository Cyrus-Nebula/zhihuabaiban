/**
 * 路线B · 命令执行器（自建画板核心）
 *
 * 把 AI 生成的 JSON 命令协议翻译成 JSXGraph 构造调用。
 * 协议说明与 ai/board-prompt.js 保持一一对应，改协议时两边同步改。
 *
 * 命令协议（commands 数组，按依赖顺序执行）：
 *   clear                                      清空画板
 *   remove    {id|ids}                         删除图元（id 字符串或 ids 数组；沿依赖图级联删除引用它的对象 + 正多边形派生顶点，
 *                                             与画板删除工具同语义，避免留下悬空引用；不支持 "__all__"（请改用 clear）；
 *                                             不存在的 id 记入 missing 不报错；删完可用同名 id 重新 point / regularPolygon，
 *                                             实现「读状态 → 删旧图元 → 局部重画」，见 planRemove）
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
 *   function  {id,expr,from,to,ymin?,ymax?,segments?,exclude?}  函数曲线（JSXGraph语法，如 "x^2"）
 *             （from/to 整体定义域；ymin/ymax 值域裁剪；segments:[[a,b],…] 多段定义域白名单、
 *               exclude:[[a,b],…] 挖洞黑名单，端点一律数字，二者可叠加，见 parseFunctionSegments；
 *               区间外采样点记 NaN 自动断开，__aiSegments 供 describe()/inspect 回读分段）
 *   polar     {id,expr,from?,to?,turns?,samples?,color?,strokeWidth?,dash?}  极坐标曲线 r=r(t)（本轮新增，对标大角几何数学 DSL）：
 *             expr 是 r(t) 表达式（变量写 t，也认 theta/θ），如 "3*cos(3*t)" 玫瑰线 / "2+2*cos(t)" 心形线；
 *             from/to 是极角弧度范围（默认 0~2π，也认 turns:圈数），samples 采样提示 60~2000（默认 360）；
 *             执行器按 x=r·cos t / y=r·sin t 换算成参数曲线，r 为 NaN 时断开；见 polarSpec，
 *             __aiExpr/__aiRange/__aiPolar 挂元素供 describe()/inspect 数值快照回读
 *   text      {id,x,y,text}                    自由文本
 *   text      {id,x,y,bind:{kind,of}}          动态测量文本（kind: distance/length/radius/angle/value）
 *   angle     {id,points:[A,B,C]}              角（B为顶点）
 *   label     {target,text}                    设置/修改标签
 *   style     {target,color?,strokeColor?,fillColor?,strokeWidth?,dash?,fill?,opacity?,fillOpacity?,labelColor?,labelSize?,hidden?,face?,size?,hollow?,solid?}  样式
 *             （细粒度：描边/填色可分设；opacity 0~1 整体透明，fillOpacity 单管填充；labelColor/labelSize 改标签文字）
 *             点型样式（本轮新增，分段端点空心/实心标记）：face 点型（o/circle/圆、[]/square/方、diamond/菱形、^/^/三角、v、>、<、+/十字、-、|），
 *               size 点大小(1~20 数字)；hollow:true 空心（face 默认 o、fillOpacity:0、strokeWidth 保底 1.5）、solid:true 实心（fillOpacity:1、填充跟随描边色）；
 *               见导出纯函数 stylePointSpec。仅写了 face/size/hollow/solid 才生效，未写则零回归。
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
 *   transform {id,of,type,by?|angle?|center?|axis?|k?}  几何变换：把 of 元素平移/旋转/反射/位似成一份新副本（以 id 命名），
 *                                                            type=translate(by:[dx,dy]) / rotate(angle,center?) / reflect(axis|center?) / scale(k,center?)（位似比 k：|k|>1 放大、0<|k|<1 缩小、k<0 反向；半径随 |k| 缩放）；
 *                                                            支持 point/segment/line/ray/polygon/circle
 *   animate    {id|ids,pingpong?,speed?}             动画：让指定滑动条（id 或 ids，或 "__all__"）自动连续改值，依赖它的几何实时播放；speed: slow/normal/fast，pingpong:true 往复。仅前端播放，不进文档
 *   conic     {id,type:'ellipse',foci:[F1,F2],sum:2a} | {type:'ellipse'|'hyperbola',center:[h,k],a,b}
 *             | {type:'parabola',focus:F,directrix:直线id} | {type:'parabola',vertex:[h,k],p}
 *             圆锥曲线（本轮新增，见 conicSpec）：第一定义 / 第二定义 / 标准式统一换算成参数曲线；
 *             双曲线两支以 NaN 断开；方程与参数挂 __aiExpr/__aiConic 供 describe() 数值快照回读
 *   regularPolygon {id,center,radius|circle|vertex|edge:[A,B],sides,mode?,rotate?,side?,flip?,vertexIds?}  正多边形（本轮新增，见 regularPolygonSpec）：
 *             AI 只给语义参数，执行器用三角函数精确算 n 个顶点并落成「n 个可引用 point + 1 个 polygon」；
 *             inscribed 内接（顶点在圆上）/ circumscribed 外切（边与圆相切，顶点半径 R/cos(180°/n)）；
 *             circle 读已画圆的圆心半径、vertex 用已有点定首顶点、radius 可填滑动条 id 动态联动；
 *             edge:[A,B] 以给定边反推中心/半径/朝向（a=s/(2tan(π/n))、顶点半径=s/(2sin(π/n))、
 *               side:left/right 选边的一侧），与 center/radius/circle/vertex/rotate 互斥；
 *               toward:点id|[x,y]（2026-11-16 第七轮新增）：用已有的一点「朝哪侧」自动定 side，
 *               按 (A→B)×(A→T) 符号取 left/right，与 side/flip 互斥；T 落在 AB 直线上抛错（不静默猜），
 *               meta.towardSide 供 describe()/inspect 数值快照回读；
 *             顶点按 vertexIds 或 <id>1..<id>n 注册，挂 __aiRegular/__aiRegularVertexIds 供数值快照回读与删除联动
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
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-14 第三轮）：只改 2D 协议，3D 分支零触碰。
 *   落实上一轮 TODO 交接项④「derive 支持符号化简」——新增 inspect 派生量 kind:"vertex"
 *   （二次函数顶点式配方，对标大角几何的符号计算）：AI 不必心算配方，画板直接回读
 *   「y=a(x-h)^2+k / 顶点 / 对称轴 / 最值」，再把精确数字写进 point / line / verify 期望值。
 *   (1) 新增 quadraticCoeffs(expr)：复用 evalExprAt 在 x=-1,0,1 三点取值反推 a,b,c，
 *       再以 x=2 校验确为二次多项式（非二次式 / 含不可求值变量一律宽容降级，不抛错）；
 *       因此 (x-2)^2-3 / 2*x^2+8x+3 等任意可求值写法都能配方，无需另写符号解析器。
 *   (2) 新增 vertexReading(d)：表达式可取 d.expr，或按 d.id / target / of[0] 读已注册函数的
 *       __aiExpr；输出单条文本读数，走既有 reading.text →【查询读数】链路，js/board.js 零改动。
 *   (3) deriveName / deriveReading 各加一个 vertex 分支；既有 8 种 kind 行为逐字节不变。
 *   配套：ai/board-prompt.js 命令清单登记 +「符号化简 / 顶点式配方」小节 + 例21；docs 用例 55/56。
 *   未触碰 3D 分支 / editor.html / appId / js/board.js。
 * TODO(下一步): ① 圆锥曲线第二定义（焦点-准线）few-shot 或 conic/locus 协议；
 *   ② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；
 *   ④ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；⑤ 给 2D inspect 派生量补入库无头单测脚本。

 * 本轮（AI作图对标大角几何·增量·2026-11-15 第二轮）：只改 2D 协议，3D 分支零触碰。
 *   落实三处 TODO 一致的头号待办「圆锥曲线 / conic 协议」——新增原生 conic 命令（对标大角几何
 *   「自研数学 DSL / 符号计算」）：此前画椭圆/双曲线/抛物线只能让 AI 手算 a,b,c 再拼两条
 *   functiongraph（定义域截断、上下半支拼接、焦点方向都易错），或逐点插值猜坐标。
 *   (1) 新增模块级纯函数 conicSpec(cmd, refs)：把语义参数统一换算成参数曲线 at(t)（t∈[0,1]）；
 *       ellipse 支持第一定义 foci+sum 与标准式 center+a+b(rotate)，hyperbola 支持 foci+diff
 *       与标准式，parabola 支持第二定义 focus+directrix 与标准式 vertex+p；非法/退化参数抛错。
 *   (2) build() 新增 conic 分支：board.create('curve',[fx,fy,0,1]) 绘制，双曲线两支之间返回
 *       [NaN,NaN] 断开（与 function 的 ymin/ymax 裁剪同理），挂 __aiExpr/__aiRange/__aiConic。
 *   (3) elementSummary() 在 curve 分支前加 __aiConic 分支，describe()/inspect 的数值快照能回读
 *       圆锥曲线类型与 a/b/p/中心；既有元素摘要输出逐字节不变。
 *   配套：ai/board-prompt.js 命令清单登记 conic +「圆锥曲线」小节 + 例23/例24 few-shot；
 *   docs/AI作图回归用例清单.md 用例 59~61。未碰 3D 分支 / editor.html / appId / js/board.js。
 * TODO(下一步): ① 圆锥曲线第二定义通用离心率形式（focus+directrix+eccentricity 覆盖 e<1/=1/>1）；
 *   ② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；
 *   ④ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；⑤ 给 2D 协议补入库无头单测脚本。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-15 第四轮）：只改 2D 协议，3D 分支零触碰。
 *   落实上一轮 TODO 交接项④「其它易错图形」中最该由执行器兜底的一项——原生 regularPolygon 命令：
 *   此前例20 只能教 AI 手算 cos(2πk/n) 逐个 point（1.732 抄错、内接/外切半径混淆、外切顶点
 *   放错到 R 而非 R/cos(180°/n)，回归用例 54 至今仍是 ⬜ 待验证），属于「让 AI 做符号计算」的
 *   反模式。本轮把三角换算收进执行器（对标大角几何自研 DSL / 符号计算）：
 *   (1) 新增模块级纯函数 regularPolygonSpec(cmd, refs)：支持 center + radius / circle（读已画圆的
 *       圆心半径）/ vertex（已有点定首顶点）三种定半径方式，sides 3~24，inscribed/circumscribed
 *       （含中文别名）、rotate、vertexIds；非法参数一律抛错、不产生任何元素，便于无头回归。
 *   (2) build() 新增 regularPolygon 分支：n 个顶点落成独立可引用的 point（fixed:true 防拖变形）
 *       + 1 个 polygon；center 是点 / radius 是滑动条时顶点坐标写成函数，动态联动；
 *       挂 __aiExpr/__aiRegular/__aiRegularVertexIds。
 *   (3) elementSummary() 在 polygon 分支前加 __aiRegular 分支，describe()/inspect 能回读
 *       「regularPolygon:inscribed@n=6,中心(0,0),R=2,旋转0°,顶点[hex1 …]」；remove() 删主图元时
 *       联动清掉派生顶点，避免孤儿点占 id。既有元素摘要 / 命令执行结果逐字节不变。
 *   配套：ai/board-prompt.js 命令清单 +「正多边形」小节 + 例26/例27 few-shot；
 *   docs/AI作图回归用例清单.md 用例 65~69。未碰 3D 分支 / editor.html / appId / js/board.js。
 * TODO(下一步): ① 给 2D 协议补入库无头单测脚本（regularPolygonSpec 优先）；② 自检状态条固定 DOM 徽标；
 *   ③ 收敛判定引入「残差改善量」；④ 其它易错图形（弓形面积阴影、函数图像对称演示）；
 *   ⑤ 正多边形支持「给定一条边 two vertices」定半径/朝向的写法。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-16 第五轮）：只改 2D 协议，3D 分支 / editor.html / appId 零触碰。
 *   落实上一轮 TODO 交接项⑤「给定一条边的两个顶点定半径/朝向」——给 regularPolygon 新增 edge:[A,B] 写法，
 *   把「已知一条边 → 求正 n 边形中心」的三角换算也收进执行器（对标大角几何自研 DSL / 符号计算）：
 *   (1) regularPolygonSpec 新增 edge 分支：边长 s=|AB| → 边心距 a=s/(2tan(π/n))、顶点半径=s/(2sin(π/n))，
 *       中心 = AB 中点 ± a·单位法向（side:left/right、中文「左」「右」、flip:true 选侧），
 *       内接 radius=顶点半径、外切 radius=边心距；rotate 由 A 的极角反推使第 0 个顶点正好落在 A 上；
 *       edge 与 center/radius/circle/vertex/rotate 互斥、端点重合/非法 side/非法数组一律抛错不注册。
 *   (2) 执行分支复用既有 polyRefs.point 解析 A/B（无新分支），edge 模式 centerEl/radiusGetter 均为 null、
 *       dynamic=false（顶点按推导值静态落成 fixed:true 的 point，与其它静态定义一致）；
 *       __aiExpr 仅在 edge 定义时加 ' def=edge' 标记，既有定义逐字节不变；__aiRegular.meta.definition='edge'
 *       供 describe()/inspect 数值快照继续回读中心/R/旋转/顶点 id。
 *   配套：ai/board-prompt.js 命令清单登记 +「正多边形·edge」追加小节 + 例29 few-shot；
 *   docs/AI作图回归用例清单.md 用例 71/72。无头桩回归见本轮说明（旧定义结果逐项对照不变）。
 * TODO(下一步): ① [本轮已完成 2026-11-16 第六轮] 给 2D 协议补入库无头单测脚本（见 tests/board2d_regularPolygon_spec.mjs）；
 *   ② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；
 *   ④ 其它易错图形（弓形面积阴影、旋转相似——函数图像对称演示已补，见例28）；
 *   ⑤ [本轮已完成 2026-11-16 第五轮] regularPolygon 支持「给定一条边两个顶点」定半径与朝向（edge:[A,B]）；
 *   ⑥ edge 支持「给定边 + 一个已有点在内部/外部」的朝向语义（toward 点），或边中点到中心的显式距离。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-16 第六轮）：只入库 2D 回归基建，改本文件头部注释 + 新增 tests/ 单测，
 *   3D 分支 / editor.html / appId 零触碰，执行逻辑零改动。
 *   落实连续多轮 TODO 交接项①——此前 regularPolygonSpec 的无头桩回归只在沙盒里临时跑，未入库，易随环境丢失。
 *   本轮新增 tests/board2d_regularPolygon_spec.mjs：直接 import 本模块导出的纯函数 regularPolygonSpec
 *   （Node 22 ESM 语法探测可直接加载 .js，无需 package.json），59 项断言全通过，覆盖：
 *   center+radius / circle / vertex / edge 四种定半径、inscribed/circumscribed 两模式、sides|n|edges 三别名、
 *   rotate 旋转、edge 的 side:left|right / flip / 数值换算、vertexIds 校验、12 类非法参数抛错、
 *   几何性质（顶点等距/边长公式/首顶点落点）与 expr 摘要逐字节冻结（防回放/状态回读格式回归）。
 *   运行：node tests/board2d_regularPolygon_spec.mjs。配套 docs/AI作图回归用例清单.md 用例 73。
 * TODO(下一步): ① [本轮已完成 2026-11-16 第六轮] regularPolygonSpec 无头单测入库；
 *   ② 把 conicSpec 也补入库无头单测（第一定义 foci+sum / 第二定义 focus+directrix+e / 三分支离心率）；
 *   ③ 自检状态条做成 AI 面板固定 DOM 徽标；④ 收敛判定引入「残差改善量」；
 *   ⑤ 其它易错图形（弓形面积阴影、旋转相似）；⑥ edge 的 toward 点 / 显式边心距朝向语义。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-16 第七轮）：只追加 2D 作图主干逻辑，
 *   3D 命令分支 / editor.html / appId / js/board.js 零改动，既有例1-29 few-shot 与命令执行语义逐字未动。
 *   落实连续多轮 TODO 交接项⑥ 的前半——给 regularPolygon 的 edge:[A,B] 新增 toward 点朝向语义：
 *   此前「以 AB 为一边补全正 n 边形」只能用 side:left/right 定侧，斜边 / 任意朝向的边上 AI 极易把
 *   左右判反（用户说的是「朝三角形内部 / 朝 C 点那侧补」）。本轮让 AI 直接引用状态快照里已有的点 id，
 *   执行器按 (A→B)×(A→T) 的符号自动取 left/right（MCP 式「读取画板状态 → 继续构造」的又一种入口），
 *   把朝向判定也交给符号计算，AI 不必自己判方位；toward 与 side/flip 互斥，T 落在 AB 所在直线上或
 *   引用不到点时整条命令抛错（不静默猜测），meta.towardSide 记录判定侧别供 describe()/inspect 回读。
 *   配套：js/executor.js 头部协议注释 + regularPolygonSpec JSDoc/edge 分支 + meta；
 *   ai/board-prompt.js 命令清单登记 toward、「正多边形·edge toward 点定侧」小节与例30 few-shot；
 *   tests/board2d_regularPolygon_spec.mjs 新增 toward 断言；docs/AI作图回归用例清单.md 用例 74/75。
 *   expr 摘要格式逐字节不变（toward 只改 center 数值），旧 59 项断言全部保持通过。
 * TODO(下一步): ① 把 conicSpec 也补入库无头单测（第一定义 foci+sum / 第二定义 focus+directrix+e / 三分支离心率）；
 *   ② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；
 *   ④ 其它易错图形（弓形面积阴影、旋转相似）；⑤ edge 的「显式边心距」朝向语义
 *     （注意：边长 s 与边数 n 已唯一确定 a=s/(2tan(180°/n))，显式给 a 与「AB 是一条边」冲突，
 *      宜另立 center+apothem 定义或改由 center/vertex 表达，不要塞进 edge 破坏几何自洽）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-17 第九轮）：只改 2D 协议，3D 分支 / editor.html / appId / js/board.js 零改动。
 *   落实「MCP 式读画板状态后修改图形」长期缺失的一环——新增原生 remove 命令：此前 executor 内部虽有
 *   remove(id)（供前端删除工具调用），但 AI 的 JSON 命令协议里没有这个 op，而提示词 / 回归清单却反复要求
 *   「先 remove 主图元再重发」，AI 根本发不出来；想改一个图元只能 clear 整板重画或 move 挪点。
 *   (1) 新增导出纯函数 planRemove(cmd, registry)：规范化 id / ids、拒绝 __all__ 与非法值（清空只能 clear），
 *       沿 JSXGraph 元素的 parents / childElements 依赖图做不动点 BFS 级联收集依赖者（与前端删除工具同语义，
 *       防悬空），补上 regularPolygon 派生顶点，按「依赖者先删、显式目标后删」排序；引擎无依赖信息时
 *       降级为只删显式项，不抛错、不误删。
 *   (2) execute() 前置 remove 分支（与 clear 同级，在 build 之前），删完回传 removed / missing；
 *       不存在的 id 宽容记入 missing，删完同名 id 可重新 point / regularPolygon 实现局部重画。
 *   前端零改动：aiSend() 的 isTransient 只含 measure/verify/animate/inspect，remove 会进 doc.commands
 *   可回放 / 可保存，自检修正轮与查询回读轮也不过滤它。配套 ai/board-prompt.js 命令清单登记 +
 *   「删除与局部重画」小节 + 例31，docs 用例 77/78，tests/board2d_remove_spec.mjs 无头单测 +
 *   tests/run-2d-specs.mjs 聚合入口（落实连续多轮 TODO ⑤）。
 * TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *   ③ 其它易错图形（弓形面积阴影、旋转相似）；④ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；
 *   ⑤ remove 的级联在真实 JSXGraph 上目视确认（parents / childElements 形状因引擎版本而异，
 *     沙箱无头单测只能用 mock 依赖图覆盖）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-17 第十一轮）：只改 2D 协议，3D 分支 / editor.html / appId / js/board.js 零改动。
 *   落实任务清单 §2「扩展 JSON 命令协议」里唯一未落地的一项——函数图像「分段裁剪 / 多区间定义域」。
 *   此前画「定义域 [-5,-1]∪[1,5]」「y=1/x 挖掉 x=0 附近」「tan(x) 断在渐近线」「只看 x<0 与 x≥2 两段」
 *   只能拆多条 function 各自 from/to 拼接（用例 11 的权宜做法）：同一函数占多个 id、样式要逐条重复、
 *   intersect of:[f1,…] 不知引用哪段、改一处要改一批。本轮把分段下沉成 function 原生能力：
 *   (1) 新增导出纯函数 parseFunctionSegments(cmd, from, to) + normalizeIntervals：
 *       segments:[[a,b],…] 白名单（多段并集）/ exclude:[[a,b],…] 黑名单（挖洞），可叠加；
 *       端点数值化（NaN/倒序自动归一、排序合并重叠相邻段、钳制到 from~to、上限 12 段、非法项静默丢弃不整批失败），
 *       返回 inRange(x) 与 summary，供无头单测直接 import（tests/board2d_function_segments_spec.mjs）。
 *   (2) case 'function' 把 seg.inRange(x) 接入原有 ymin/ymax 的「采样点记 NaN」路径（同一 JessieCode 编译闭包），
 *       区间外自动断开、多段之间不连线；未写分段时 active=false，走原整段出图路径，零回归。
 *   (3) 分段元数据挂 el.__aiSegments，describe()/inspect 数值快照回读「这条曲线画了哪几段」，
 *       AI 在已有曲线上继续构造 / 局部重画时不必猜定义域（对标大角几何 MCP 式读画板状态）。
 *   前端零改动：segments/exclude 随 doc.commands 一起回放 / 保存，后端 commandUsable 无字段白名单不会拦。
 *   配套：ai/board-prompt.js 命令清单登记 + 「函数图像分段裁剪」小节 + 例34 few-shot、
 *   docs 用例 81/82、tests 无头单测 + run-2d-specs.mjs 聚合入口。
 * TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *   ③ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；④ 分段交界处的空心/实心端点标记（新 op 或 point+style 组合）；
 *   ⑤ 分段裁剪在真实 JSXGraph 上目视确认（NaN 断点是否如预期断开、线宽/颜色，沙箱无头只验证区间纯函数）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-19 第十二轮）：只改 2D 协议，3D 分支 / editor.html / appId / js/board.js 零改动。
 *   落实连续多轮 TODO 交接项④——「分段交界处的空心 / 实心端点标记」：上一轮已做 function 分段裁剪（segments/exclude），
 *   但数学上「x∈[-5,-1)」与「x∈[-5,-1]」的端点开闭无法表达：AI 之前只能在区间端点附近另放 point，
 *   却因协议无点型样式而无法把端点画成空心圆 / 实心圆（默认 point 是 face:'o' 半透明填充，空心实心一个样）。
 *   本轮给 2D style 命令补点型样式能力，不改 point 创建协议（沿用既有 id 引用）：
 *   (1) 新增导出纯函数 stylePointSpec(cmd)：face（英文/中文别名归一到 JSXGraph 点型 o/[]/diamond/^/v/>/</+/-/|）、
 *       size（点大小，数值化钳制 1~20）、hollow:true（空心：face 默认 o + fillOpacity:0 + strokeWidth 保底 1.5）、
 *       solid:true（实心：fillOpacity:1 + 填充跟随描边色）、fillColor；未写这四类字段时 active=false，执行分支零回归；
 *       非法/非数字值宽容丢弃，不整批失败。供无头单测直接 import（tests/board2d_style_point_spec.mjs）。
 *   (2) case 'style' 在 el.setAttribute 之前并入 stylePointSpec 的属性；空心点用白底+描边实现"空心圆"观感，
 *       实心点把 fillColor 跟到本次 strokeColor（或元素现有描边色），避免"蓝心红边"；标签颜色逻辑零改动。
 *   配合分段裁剪的范式：function f1 segments → 端点处 point + style hollow/solid → verify 回读端点 id 存在。
 *   配套：ai/board-prompt.js 命令清单登记 + 「分段端点开闭（空心/实心）」小节 + 例35 few-shot、docs 用例 83/84、
 *   tests 无头单测 + run-2d-specs.mjs 聚合入口。
 * TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *   ③ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；④ 分段裁剪 + 空心/实心端点在真实 JSXGraph 上目视确认；
 *   ⑤ 更多易错图形 few-shot（旋转体截面 / 极坐标曲线 / 含参不等式区域，需先确认执行器支持）。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-19 第十三轮）：落实 TODO⑤「极坐标曲线」——执行器支持确认可达，
 *   新增原生 polar 命令（对标大角几何「自研数学 DSL / 符号计算」强项）。此前画玫瑰线/心形线/螺线只能让 AI
 *   手算每个采样点的 (x,y) 再逐点 point 连 polygon，坐标难算、点数僵硬、变形无法参数化。
 *   (1) 新增导出纯函数 polarSpec(cmd)：expr 归一（变量 t/theta/θ）、from/to 极角范围（默认 0~2π，
 *       turns 圈数别名）、samples 采样数（默认 360，钳制 60~2000），端点数值化、非法参数抛错，
 *       返回 at(t)->[x,y]、summary、meta，供无头单测与 describe()/inspect 回读（与 conicSpec 同范式）。
 *   (2) case 'polar' 接入 board.create('curve', [fx,fy,from,to])（与 conic 同一引擎元素），
 *       r(t) 走 JessieCode 编译闭包、滑动条联动照旧生效，NaN 断点自动断开；
 *       __aiExpr/__aiRange/__aiPolar 挂元素供状态快照回读（MCP 式读状态）。
 *   (3) elementSummary() 在 curve 分支前加 __aiPolar 分支，describe()/inspect 回读 "polar:r(t)@..."。
 *   配套：ai/board-prompt.js 命令清单登记 + 「极坐标曲线」小节 + 例36 few-shot、docs 用例 85/86、
 *   tests/board2d_polar_spec.mjs 无头单测 + run-2d-specs.mjs 聚合入口。
 *   TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *     ③ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；④ [本轮已完成] 极坐标曲线（例36 / 用例 85/86）；
 *     ⑤ 含参不等式区域（需先确认执行器是否支持区域填充）/ 旋转体截面 few-shot；
 *     ⑥ polar 曲线在真实 JSXGraph 上的采样密度 / NaN 断点渲染目视确认。
 *
 * 本轮（AI作图对标大角几何·增量·2026-11-19 第十四轮）：落实 TODO 交接项⑤「含参不等式区域」——
 *   确认 vendor/jsxgraphcore.js 原生注册 inequality 元素（接受 line / functiongraph 作边界）后，
 *   新增原生 inequality 命令（对标大角几何「数学 DSL / 区域填充」强项）。此前画 y≥x²-4 的可行域、
 *   线性规划阴影只能让 AI 手算大量采样点拼 polygon 近似：点数僵硬、边界锯齿、滑动条无法联动。
 *   (1) 模块级纯函数 inequalitySpec()：expr（函数边界 y=f(x)，容忍 "y<…"/"y>=…" 前缀）或
 *       boundary（已画直线/函数 id，MCP 式读状态）二选一；side（上/下/左/右 + 中英文别名）→ inverse
 *       映射、显式 inverse 优先；from/to 数值化交换、fillColor/fillOpacity（0.05~0.9 钳制）、strokeColor；
 *       非法参数抛错。纯归一不求值，供无头单测回归。
 *   (2) case 'inequality'：expr 走 JessieCode 编译成边界 functiongraph（滑动条联动、NaN 断开），
 *       boundary 走 resolve 引用已有图元；board.create('inequality',[boundaryEl],{inverse,fillColor,…})；
 *       __aiInequality/__aiExpr 挂元素供状态快照回读。
 *   (3) elementSummary() 在 curve 分支前加 __aiInequality 分支，回读 "inequality:y>… side=… fill=…"。
 *   配套：ai/board-prompt.js 命令清单登记 + 「不等式区域」小节 + 例37 few-shot、docs 用例 87/88、
 *   tests/board2d_inequality_spec.mjs 无头单测 + run-2d-specs.mjs 聚合入口。
 *   本文件只追加 2D 主干逻辑，3D 命令分支 / editor.html / js/board.js / appId 零改动。
 *   TODO(下一步): ① 自检状态条做成 AI 面板固定 DOM 徽标；② 收敛判定引入「残差改善量」；
 *     ③ 收敛后把 probeVerify 结果回画成最终 ✔ 读数；④ [本轮已完成] 含参不等式区域（例37 / 用例 87/88）；
 *     ⑤ 旋转体截面 few-shot；⑥ inequality 填充方向（inverse ↔ side）在真实 JSXGraph 上目视确认。
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

/**
 * 圆锥曲线参数解析（纯函数，便于无头回归；对标大角几何「自研数学 DSL / 符号计算」）。
 * 把语义化声明统一换算成一条参数曲线的采样函数 at(t)（t∈[0,1]）：
 *   ellipse   · 第一定义 {foci:[F1,F2], sum:2a} 或标准式 {center:[h,k], a, b(,rotate)}
 *   hyperbola · 第一定义 {foci:[F1,F2], diff:2a} 或标准式 {center:[h,k], a, b(,rotate)}
 *   parabola  · 第二定义 {focus:F, directrix:直线id} 或标准式 {vertex:[h,k], p(,rotate)}
 *   通用第二定义 {focus:F, directrix:直线id, eccentricity:e}（别名 ecc/e）：|PF| = e·dist(P,准线)，
 *     e<1 椭圆 / e=1 抛物线 / e>1 双曲线统一换算（对标大角几何符号计算，本轮新增）。
 * 双曲线两支之间返回 [NaN, NaN] 断开（JXG curve 遇 NaN 自动断开，与 function 的 ymin/ymax 裁剪同理）。
 * refs.point(ref) / refs.line(ref) 由 createExecutor 注入；本函数不依赖 board，可独立单测。
 */
export function conicSpec(cmd, refs) {
  const alias = { 椭圆: 'ellipse', 双曲线: 'hyperbola', 抛物线: 'parabola' };
  const type = alias[cmd.type] || String(cmd.type || 'ellipse').toLowerCase();
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pos = (v, label, d) => {
    if (v == null) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error('conic.' + label + ' 必须是正数');
    return n;
  };
  const point2 = (v, d) => (Array.isArray(v) && v.length >= 2 &&
    Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1])))
    ? [Number(v[0]), Number(v[1])] : d;
  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  const basis = (deg) => {
    const r = num(deg, 0) * Math.PI / 180;
    return { u: [Math.cos(r), Math.sin(r)], v: [-Math.sin(r), Math.cos(r)] };
  };
  const combine = (C, cu, cv, u, v) => [
    C[0] + cu * u[0] + cv * v[0],
    C[1] + cu * u[1] + cv * v[1],
  ];

  // 第二定义通用形式（本轮新增）：|PF| = e · dist(P, 准线)，e 为离心率。
  // e<1 椭圆 / e=1 抛物线 / e>1 双曲线——AI 只给「焦点 + 准线 + 离心率」，执行器按统一定义
  // 换算中心/a/b/c 并采样（对标大角几何符号计算）。别名：eccentricity / ecc / e。
  // 放在第一定义/标准式之前：只要同时给了 focus + directrix + eccentricity 就走本分支。
  const eccRaw = cmd.eccentricity != null ? cmd.eccentricity
    : (cmd.ecc != null ? cmd.ecc : cmd.e);
  if (cmd.focus != null && cmd.directrix != null && eccRaw != null) {
    const e = num(eccRaw, NaN);
    if (!Number.isFinite(e) || e <= 0) throw new Error('conic.eccentricity 必须是正数');
    const F = refs.point(cmd.focus);
    const seg = refs.line(cmd.directrix);   // [[x1,y1],[x2,y2]]
    const A = seg[0], B = seg[1];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) throw new Error('conic.directrix 准线的两个端点不能重合');
    const t0 = [dx / len, dy / len];
    const n0 = [-t0[1], t0[0]];
    const signed = (F[0] - A[0]) * n0[0] + (F[1] - A[1]) * n0[1];
    const d0 = Math.abs(signed);            // 焦点到准线距离
    if (d0 < 1e-9) throw new Error('conic.focus 不能落在准线上');
    const n = signed >= 0 ? n0 : [-n0[0], -n0[1]];   // 从准线指向焦点
    const u = n, v = t0;
    const focusTxt = '焦点(' + fmt(F[0]) + ',' + fmt(F[1]) + ')';
    if (Math.abs(e - 1) < 1e-9) {
      // e=1：抛物线，|PF|=dist 的退化情形，与 focus+directrix 采样逐字节一致
      const p = d0 / 2;
      const V = [F[0] - p * u[0], F[1] - p * u[1]];
      const VMAX = Math.sqrt(4 * p * 9);
      const at = (t) => {
        const s = (2 * t - 1) * VMAX;
        return combine(V, (s * s) / (4 * p), s, u, v);
      };
      return { type: 'parabola', at, tMin: 0, tMax: 1,
        expr: 'conic(focus+directrix+e): e=1, ' + focusTxt + ', p=' + fmt(p)
          + ', 顶点(' + fmt(V[0]) + ',' + fmt(V[1]) + ')',
        meta: { definition: 'focus+directrix+eccentricity', eccentricity: 1,
          vertex: V, p, axis: u } };
    }
    // 统一定义：以焦点为原点、u 轴从准线指向焦点，记中心沿 u 偏移 sC = e²·d0/(1−e²)，
    //   a = e·d0/|1−e²|，b = e·d0/√|1−e²|，c = |sC|；e<1 中心在焦点+u 侧，e>1 在 −u 侧。
    const denom = 1 - e * e;
    const sC = e * e * d0 / denom;
    const a = e * d0 / Math.abs(denom);
    const b = e * d0 / Math.sqrt(Math.abs(denom));
    const c = Math.abs(sC);
    const C = [F[0] + sC * u[0], F[1] + sC * u[1]];
    const finalType = e < 1 ? 'ellipse' : 'hyperbola';
    const S = 2.4, GAP = 0.06;   // 与既有双曲线分支同参数，NaN 断开带一致
    const at = (t) => {
      if (finalType === 'ellipse') {
        const th = 2 * Math.PI * t;
        return combine(C, a * Math.cos(th), b * Math.sin(th), u, v);
      }
      if (Math.abs(t - 0.5) < GAP / 2) return [NaN, NaN];
      const right = t < 0.5;
      const span = 0.5 - GAP / 2;
      const q = right ? t / span : (t - 0.5 - GAP / 2) / span;
      const s = (2 * q - 1) * S;
      return combine(C, (right ? 1 : -1) * a * Math.cosh(s), b * Math.sinh(s), u, v);
    };
    return { type: finalType, at, tMin: 0, tMax: 1,
      expr: 'conic(focus+directrix+e): ' + finalType + ', e=' + fmt(e) + ', ' + focusTxt
        + ', 中心(' + fmt(C[0]) + ',' + fmt(C[1]) + '), a=' + fmt(a) + ', b=' + fmt(b)
        + ', c=' + fmt(c),
      meta: { definition: 'focus+directrix+eccentricity', eccentricity: e,
        center: C, a, b, c, axis: u } };
  }

  if (type === 'ellipse' || type === 'hyperbola') {
    let C, a, b, u, v, c = 0, definition, expr;
    const foci = Array.isArray(cmd.foci) ? cmd.foci : null;
    if (foci && foci.length === 2) {
      const F1 = refs.point(foci[0]), F2 = refs.point(foci[1]);
      const dx = F2[0] - F1[0], dy = F2[1] - F1[1];
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) throw new Error('conic.foci 两个焦点不能重合');
      const k = type === 'ellipse' ? Number(cmd.sum) : Number(cmd.diff);
      const key = type === 'ellipse' ? 'sum（常数和 2a）' : 'diff（常数差 2a）';
      if (!Number.isFinite(k) || k <= 0) throw new Error('conic 需要 ' + key + ' 为正数');
      a = k / 2; c = d / 2;
      if (type === 'ellipse' && a <= c) throw new Error('椭圆 sum 必须大于两焦点距离（2a > 2c）');
      if (type === 'hyperbola' && a >= c) throw new Error('双曲线 diff 必须小于两焦点距离（2a < 2c）');
      b = Math.sqrt(type === 'ellipse' ? a * a - c * c : c * c - a * a);
      C = [(F1[0] + F2[0]) / 2, (F1[1] + F2[1]) / 2];
      u = [dx / d, dy / d]; v = [-u[1], u[0]];
      definition = type === 'ellipse' ? 'foci+sum' : 'foci+diff';
      expr = type + ': ' + definition.split('+')[1] + '=' + fmt(k) + ', a=' + fmt(a) + ', b=' + fmt(b)
        + ', 中心(' + fmt(C[0]) + ',' + fmt(C[1]) + '), 焦距2c=' + fmt(2 * c);
    } else {
      C = point2(cmd.center, [0, 0]);
      a = pos(cmd.a, 'a', 3); b = pos(cmd.b, 'b', 2);
      const bs = basis(cmd.rotate); u = bs.u; v = bs.v;
      c = Math.sqrt(type === 'ellipse' ? Math.max(0, a * a - b * b) : a * a + b * b);
      definition = 'standard';
      expr = type + ': (x-' + fmt(C[0]) + ')²/' + fmt(a * a) + (type === 'ellipse' ? ' + ' : ' − ')
        + '(y-' + fmt(C[1]) + ')²/' + fmt(b * b) + ' = 1'
        + (num(cmd.rotate, 0) ? ', 旋转' + fmt(num(cmd.rotate, 0)) + '°' : '');
    }
    const S = 2.4;      // 双曲线参数 s∈[-S,S]，cosh(2.4)≈5.6，落在 ±10 视野内
    const GAP = 0.06;   // t≈0.5 的 NaN 断开带，保证 JXG 采样能命中
    const at = (t) => {
      if (type === 'ellipse') {
        const th = 2 * Math.PI * t;
        return combine(C, a * Math.cos(th), b * Math.sin(th), u, v);
      }
      if (Math.abs(t - 0.5) < GAP / 2) return [NaN, NaN];
      const right = t < 0.5;
      const span = 0.5 - GAP / 2;
      const q = right ? t / span : (t - 0.5 - GAP / 2) / span;
      const s = (2 * q - 1) * S;
      return combine(C, (right ? 1 : -1) * a * Math.cosh(s), b * Math.sinh(s), u, v);
    };
    return { type, expr, at, tMin: 0, tMax: 1,
      meta: { definition, center: C, a, b, c, axis: u } };
  }

  if (type === 'parabola') {
    let V, p, u, v, definition, expr;
    if (cmd.focus != null && cmd.directrix != null) {
      const F = refs.point(cmd.focus);
      const seg = refs.line(cmd.directrix);   // [[x1,y1],[x2,y2]]
      const A = seg[0], B = seg[1];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) throw new Error('conic.directrix 准线的两个端点不能重合');
      const t0 = [dx / len, dy / len];
      const n0 = [-t0[1], t0[0]];
      const signed = (F[0] - A[0]) * n0[0] + (F[1] - A[1]) * n0[1];
      const d0 = Math.abs(signed);
      if (d0 < 1e-9) throw new Error('conic.focus 不能落在准线上');
      const n = signed >= 0 ? n0 : [-n0[0], -n0[1]];   // 从准线指向焦点
      u = n; v = t0;
      p = d0 / 2;                                      // 焦准距的一半
      V = [F[0] - p * u[0], F[1] - p * u[1]];         // 顶点 = 焦点到准线垂足的中点
      definition = 'focus+directrix';
      expr = 'parabola: 焦点(' + fmt(F[0]) + ',' + fmt(F[1]) + '), 准线过('
        + fmt(A[0]) + ',' + fmt(A[1]) + ')-(' + fmt(B[0]) + ',' + fmt(B[1])
        + '), p=' + fmt(p) + ', 顶点(' + fmt(V[0]) + ',' + fmt(V[1]) + ')';
    } else {
      V = point2(cmd.vertex, [0, 0]);
      p = pos(cmd.p, 'p', 1);
      const bs = basis(cmd.rotate); u = bs.u; v = bs.v;
      definition = 'standard';
      expr = 'parabola: (y-' + fmt(V[1]) + ')² = ' + fmt(4 * p) + '·(x-' + fmt(V[0])
        + ')（轴向旋转' + fmt(num(cmd.rotate, 0)) + '°, p=' + fmt(p) + '）';
    }
    const VMAX = Math.sqrt(4 * p * 9);   // 轴向最远约到 9，落在 ±10 视野内
    const at = (t) => {
      const s = (2 * t - 1) * VMAX;
      return combine(V, (s * s) / (4 * p), s, u, v);
    };
    return { type, expr, at, tMin: 0, tMax: 1,
      meta: { definition, vertex: V, p, axis: u } };
  }
  throw new Error('conic.type 只能是 ellipse / hyperbola / parabola');
}

/* ---------- 极坐标曲线（polar）r=r(t) 语义参数 → 参数曲线采样（模块级纯函数，便于无头回归） ---------- */
/**
 * 对标大角几何「自研数学 DSL / 符号计算」：AI 只声明 r(t) 表达式 + 极角范围，
 * 由执行器用 x=r·cosθ / y=r·sinθ 换算成参数曲线，不再让 AI 手算每个采样点坐标。
 *
 * 参数：
 *   expr      r(t) 表达式字符串（JSXGraph/JessieCode 语法，变量写 "t"，也认 "theta"/"θ"），
 *             如 "3*cos(3*t)" 三叶玫瑰线 / "2+2*cos(t)" 心形线 / "a*theta"（a 可为滑动条 id）
 *   from/to   极角 t 的范围（弧度），默认 0 ~ 2π；to<from 自动交换
 *   turns     圈数别名：写了 turns:1 等价于 from:0,to:2π（未在 to 显式给定时生效）
 *   samples   采样点个数提示，默认 360、钳制 60~2000（curve 是连续求值，samples 仅用于摘要回读，
 *             真实采样密度由 JSXGraph 决定；给 AI 一个显式旋钮表达"粗糙示意/精细曲线"）
 *
 * 返回 { at(t)->[x,y], rAt(t)->number（原始极径）, tMin, tMax, expr, samples, summary, meta }。
 * 表达式不在本纯函数里求值（没有 JessieCode 上下文），由 case 'polar' 编译后注入 rFn；
 * 这里 at/rAt 默认用一个数值占位 r=0，执行分支会覆盖为真实编译器。非法参数一律抛错，不产生元素。
 */
export function polarSpec(cmd) {
  const raw = cmd && cmd.expr != null ? String(cmd.expr).trim() : '';
  if (!raw) throw new Error('polar.expr 不能为空（需给出 r(t) 表达式，如 "3*cos(3*t)"）');
  // 变量名归一：theta / θ → t（JessieCode snippet 的变量名统一为 t，避免 AI 写法不一导致取不到值）
  const expr = raw.replace(/\btheta\b/gi, 't').replace(/θ/g, 't');
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  let from = num(cmd.from, 0);
  let to = cmd.to != null ? num(cmd.to, NaN) : NaN;
  if (!Number.isFinite(to)) {
    const turns = num(cmd.turns, NaN);
    to = Number.isFinite(turns) && turns > 0 ? turns * 2 * Math.PI : 2 * Math.PI;
  }
  if (to < from) { const tmp = from; from = to; to = tmp; }
  if (to - from < 1e-9) throw new Error('polar 的极角范围 from~to 不能为零');
  let samples = Math.round(num(cmd.samples, 360));
  if (samples < 60) samples = 60;
  if (samples > 2000) samples = 2000;
  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  // 默认占位：真实极径由执行分支注入。at(t) 统一走 rAt，覆盖后即为 x=r·cos t / y=r·sin t。
  const rAt = () => 0;
  const at = (t) => { const r = rAt(t); return [r * Math.cos(t), r * Math.sin(t)]; };
  return {
    at, rAt, tMin: from, tMax: to, expr, samples,
    summary: 'r=' + expr + ' θ∈[' + fmt(from) + ',' + fmt(to) + '] 采样' + samples,
    meta: { definition: 'r(t)', expr, samples },
  };
}

/* ---------- 不等式区域（inequality）语义参数归一化（模块级纯函数，便于无头回归） ---------- */
/**
 * 对标大角几何「自研数学 DSL / 区域填充」：AI 只声明边界（函数 y=f(x) 或已画直线 id）与
 * 填充侧，交给 JSXGraph 原生 inequality 元素填充满足不等式的一侧，不再让 AI 手算大量采样点
 * 拼 polygon 近似阴影（点数僵硬、边界锯齿、滑动条无法联动）。
 *
 * 两种边界来源（二选一，expr 优先）：
 *   expr      函数边界 y=f(x) 表达式（变量写 x），如 "x^2-4"、"a*x+1"（a 可为滑动条 id），
 *             也容忍 "y<x^2-4"/"y>=a*x+1" 这类带比较符的写法（自动剥离前缀并推断侧）
 *   boundary  已画的 line/segment/functiongraph 的 id（MCP 式「读画板状态 → 在已有边界上填充」）
 * 侧与方向：
 *   side      below/下/lower/下方 → 填曲线下方（y<f）；above/上/upper/上方 → 填上方（y>f）；
 *             left/左/right/右 供直线边界用；显式 inverse:boolean 优先于 side
 *   from/to   expr 模式的 x 定义域（默认 -10~10，to<from 自动交换）；boundary 模式忽略
 * 样式：fillColor/fillOpacity（默认 #C62828 / 0.2，透明度钳制 0.05~0.9）、strokeColor（边界线色）
 *
 * 返回 { mode, expr, boundary, side, inverse, from, to, fillColor, fillOpacity, strokeColor,
 *        summary, meta }。表达式不在本纯函数里求值（无 JessieCode 上下文），由 case 'inequality'
 * 编译后注入边界 functiongraph。非法参数（expr/boundary 都缺、expr 空白）一律抛错。
 */
export function inequalitySpec(cmd) {
  const c = cmd || {};
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const hasExpr = c.expr != null && String(c.expr).trim() !== '';
  const hasBoundary = !hasExpr && c.boundary != null && String(c.boundary).trim() !== '';
  if (!hasExpr && !hasBoundary) {
    throw new Error('inequality 需给 expr（边界函数 y=f(x)）或 boundary（已画的线/函数 id）');
  }
  const mode = hasExpr ? 'expr' : 'boundary';
  let expr = hasExpr ? String(c.expr).trim() : '';
  const boundary = hasBoundary ? String(c.boundary).trim() : '';

  let from = num(c.from, -10), to = num(c.to, 10);
  if (to < from) { const t = from; from = to; to = t; }

  // 侧 → JSXGraph inverse 的映射约定（真实填充方向需在带浏览器环境目视确认，见 docs 已知限制）
  const SIDE_MAP = {
    below: ['below', false], lower: ['below', false], under: ['below', false], down: ['below', false], '下': ['below', false], '下方': ['below', false],
    above: ['above', true], upper: ['above', true], over: ['above', true], up: ['above', true], '上': ['above', true], '上方': ['above', true],
    left: ['left', true], '左': ['left', true], '左侧': ['left', true],
    right: ['right', false], '右': ['right', false], '右侧': ['right', false],
  };
  const sideRaw = c.side != null ? String(c.side).trim().toLowerCase() : '';
  const hit = SIDE_MAP[sideRaw] || ['below', false];
  let side = hit[0];
  let inverse = hit[1];

  // 容忍 "y<expr" / "y>=expr" 前缀：剥离后按比较符推断侧（未显式给 side/inverse 时）
  const ycmp = expr.match(/^y\s*(<=|>=|<|>)\s*(.*)$/i);
  let strippedByCompare = false;
  if (ycmp) {
    expr = ycmp[2].trim();
    strippedByCompare = true;
    if (!sideRaw && c.inverse == null) {
      side = (ycmp[1] === '>' || ycmp[1] === '>=') ? 'above' : 'below';
      inverse = side === 'above';
    }
  }
  if (!expr && mode === 'expr') throw new Error('inequality.expr 剥离比较符后不能为空');

  if (typeof c.inverse === 'boolean') inverse = c.inverse;
  else if (c.inverse != null) {
    const iv = String(c.inverse).trim().toLowerCase();
    if (iv === 'true' || iv === '1') inverse = true;
    else if (iv === 'false' || iv === '0') inverse = false;
  }

  const fillColor = String(c.fillColor || c.color || '#C62828');
  const strokeColor = String(c.strokeColor || fillColor);
  let fillOpacity = num(c.fillOpacity, 0.2);
  if (fillOpacity < 0.05) fillOpacity = 0.05;
  if (fillOpacity > 0.9) fillOpacity = 0.9;

  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  const summary = mode === 'expr'
    ? ('inequality:y' + (inverse ? '>' : '<') + expr + ' x∈[' + fmt(from) + ',' + fmt(to) + ']')
    : ('inequality:' + boundary + ' ' + side + ' fill=' + fillColor);
  const meta = { mode, expr, boundary, side, inverse, from, to, fillColor, fillOpacity, strokeColor, strippedByCompare };
  return { mode, expr, boundary, side, inverse, from, to, fillColor, fillOpacity, strokeColor, summary, meta };
}

/* ---------- 正多边形（regularPolygon）语义参数 → 顶点坐标（模块级纯函数，便于无头回归） ---------- */
/**
 * 对标大角几何「自研数学 DSL / 符号计算」：AI 只声明「中心 + 半径 + 边数 + 内接/外切 + 旋转」，
 * 由执行器用三角函数精确算出 n 个顶点，不再让 AI 手算 cos(2πk/n)（例20 的手算法极易把
 * 1.732 抄成 1.73、把外切顶点放错到半径 R 上）。顶点是独立可引用的 point，AI 可继续
 * 连对角线 / 取中点 / verify 共圆，延续「读状态→规划→分步构造→自检」工作流。
 *
 * 参数：
 *   center    [x,y] 或已定义点 id（默认原点）
 *   radius    正数（内接=外接圆半径 R，外切=内切圆半径 R）；可填滑动条 id 实现动态联动
 *   circle    已画圆的 id：直接读它的圆心 + 半径（与 center/radius 二选一，MCP 式读画板状态）
 *   vertex    已定义点 id：以它作第一个顶点来定半径与起始角（与 radius 二选一）
 *   edge      [A,B] 两个已定义点（点 id 或 [x,y]）：以 AB 为正 n 边形的一条边，反推中心/半径/朝向
 *             （2026-11-16 新增，落实 TODO ⑤）。与 center/radius/circle/vertex/rotate 互斥；
 *             边心距 a=s/(2tan(π/n))、顶点半径 s/(2sin(π/n))；A 恒为第 0 个顶点、B 为相邻顶点。
 *             side:left(默认)/right 或中文「左」「右」、flip:true 决定正多边形落在有向边 AB 的哪一侧。
 *   toward    已定义点 id 或 [x,y]（2026-11-16 第七轮新增，仅 edge 定义可用）：用「朝哪个点」定侧，
 *             执行器按 (A→B)×(A→T) 的符号自动选 left/right，AI 不必自己判方位（斜边上 left/right 极易判反）；
 *             与 side/flip 互斥；T 落在 AB 所在直线上或引用不到点时抛错（不静默猜测），
 *             判定结果写进 meta.towardSide 供 describe()/inspect 回读。
 *   sides/n   边数，整数 3~24（默认 6）
 *   mode      inscribed 内接（默认，顶点在圆上）/ circumscribed 外切（边与圆相切，
 *             顶点到圆心 = R/cos(180°/n)）；也认中文「内接」「外切」
 *   rotate    起始旋转角（度）
 *   vertexIds 可选，n 个顶点 id；省略则按 <id>1..<id>n 自动命名
 *
 * refs：{ point(id|[x,y])->[x,y], value(v)->number, circle(id)->{center,radius} }
 * 返回 { vertices, angles, center, radius, sides, mode, rotate, vertexRadius, vertexIds, expr, meta }
 * 纯函数不碰 JSXGraph，非法参数一律抛错且不产生任何元素。
 */
export function regularPolygonSpec(cmd, refs) {
  const point2 = (v, label) => {
    if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) {
      return [Number(v[0]), Number(v[1])];
    }
    if (v != null && typeof v === 'string' && refs && typeof refs.point === 'function') return refs.point(v);
    throw new Error('regularPolygon.' + label + ' 需要 [x,y] 或已定义的点 id');
  };
  const valueOf = (v) => {
    if (v == null) return NaN;
    if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))) return Number(v);
    if (typeof v === 'string' && refs && typeof refs.value === 'function') return refs.value(v);
    return NaN;
  };
  const fmt = (n) => String(Math.round(n * 1000) / 1000);

  // 边数：sides / n / edges 三种写法等价，必须是 3~24 的整数
  const sidesRaw = cmd.sides != null ? cmd.sides : (cmd.n != null ? cmd.n : cmd.edges);
  const sides = valueOf(sidesRaw);
  // 严格整数：不把 3.5 静默四舍五入成 4（AI 写出小数边数说明规划有误，整条失败更安全）
  if (!Number.isFinite(sides) || !Number.isInteger(sides) || sides < 3 || sides > 24) {
    throw new Error('regularPolygon.sides 必须是 3~24 的整数');
  }

  // 内接 / 外切（含中文别名）
  const MODE = {
    inscribed: 'inscribed', 内接: 'inscribed', 内接于圆: 'inscribed', in: 'inscribed',
    circumscribed: 'circumscribed', 外切: 'circumscribed', 外切于圆: 'circumscribed', out: 'circumscribed',
  };
  const mode = MODE[String(cmd.mode == null ? 'inscribed' : cmd.mode).toLowerCase()];
  if (!mode) throw new Error('regularPolygon.mode 只能是 inscribed / circumscribed（内接 / 外切）');

  // 中心 + 半径：edge > circle > radius > vertex（四选一，优先级从高到低）
  // 2026-11-16 新增 edge：给定正 n 边形「一条边的两个端点」反推中心 / 半径 / 朝向，
  //   把 sin/tan 三角换算收进执行器（对标大角几何自研数学 DSL / 符号计算），
  //   AI 只声明「这条边 + 边数 + 落在哪一侧」，不必手算边长→外接圆半径。
  let center = [0, 0];
  let radius = NaN;
  let definition = 'center+radius';
  let vertexAngleDeg = 0;
  let towardSide = null;   // edge + toward 点定侧时记录最终落在 left / right，供 describe() 回读
  // toward 是 edge 专属的朝向语义；在 center+radius / circle / vertex 定义里出现说明 AI 规划有误，
  // 整条失败而不是静默忽略（避免 AI 以为朝向已生效、实际画到默认侧）。
  if (cmd.toward != null && cmd.edge == null) {
    throw new Error('regularPolygon.toward 仅在 edge:[A,B] 定义下可用');
  }
  if (cmd.edge != null) {
    const conflict = ['center', 'radius', 'circle', 'vertex', 'rotate'].filter((k) => cmd[k] != null);
    if (conflict.length) {
      throw new Error('regularPolygon.edge 不能与 ' + conflict.join('/') + ' 混用（edge 已定中心/半径/朝向）');
    }
    if (!Array.isArray(cmd.edge) || cmd.edge.length !== 2) {
      throw new Error('regularPolygon.edge 必须是 [A,B] 两个点（点 id 或 [x,y]）');
    }
    const A = point2(cmd.edge[0], 'edge[0]');
    const B = point2(cmd.edge[1], 'edge[1]');
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const s = Math.hypot(dx, dy);
    if (!Number.isFinite(s) || s < 1e-9) throw new Error('regularPolygon.edge 两个端点不能重合');
    // 有向边 A→B 的单位法向（默认取左法向，即中心落在 AB 的逆时针一侧）；
    // side:right / flip:true 让正多边形落到另一侧（仍是同一条边、同一组顶点集合）。
    const SIDE = { left: 1, 左: 1, 逆时针: 1, right: -1, 右: -1, 顺时针: -1 };
    let dir = 1;
    if (cmd.side != null) {
      dir = SIDE[String(cmd.side).toLowerCase()];
      if (!dir) throw new Error('regularPolygon.side 只能是 left / right（左 / 右）');
    }
    if (cmd.flip === true) dir = -dir;
    // toward 点朝向（2026-11-16 第七轮新增，落实连续多轮 TODO ⑥）：
    // 用画板上已有的一点决定正多边形落在有向边 A→B 的哪一侧——AI 不必自己判 left/right
    // （斜边 / 任意朝向的边上极易判反），直接引用状态快照里的点 id 即可，属 MCP 式
    // 「读取画板状态 → 继续构造」。与 side / flip 互斥，避免两种朝向语义打架。
    if (cmd.toward != null) {
      if (cmd.side != null || cmd.flip != null) {
        throw new Error('regularPolygon.toward 不能与 side / flip 混用（朝向已由 toward 点唯一决定）');
      }
      const T = point2(cmd.toward, 'toward');
      if (!Array.isArray(T) || !Number.isFinite(T[0]) || !Number.isFinite(T[1])) {
        throw new Error('regularPolygon.toward 需要 [x,y] 或已定义的点 id');
      }
      // (A→B) × (A→T) 的 z 分量：>0 表示 T 在 AB 的逆时针一侧（dir=+1），<0 在另一侧。
      const cross = dx * (T[1] - A[1]) - dy * (T[0] - A[0]);
      if (!Number.isFinite(cross) || Math.abs(cross) < 1e-9) {
        throw new Error('regularPolygon.toward 点不能落在边 AB 所在直线上（无法判定朝向）');
      }
      dir = cross > 0 ? 1 : -1;
      towardSide = cross > 0 ? 'left' : 'right';
    }
    // 边心距 a = s/(2tan(π/n))，顶点半径 vr = s/(2sin(π/n))：内接与外切的中心都在
    // AB 中垂线上距边 a 处，只是「radius」语义不同（外接圆半径 vs 内切圆半径）。
    const apothem = s / (2 * Math.tan(Math.PI / sides));
    const vr = s / (2 * Math.sin(Math.PI / sides));
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    center = [mx + dir * apothem * (-dy / s), my + dir * apothem * (dx / s)];
    radius = mode === 'circumscribed' ? apothem : vr;
    definition = 'edge';
    // 让第 0 个顶点正好落在 A 上（顶点角 = rotate + offset + k·2π/n，offset 见下方循环）
    vertexAngleDeg = Math.atan2(A[1] - center[1], A[0] - center[0]) * 180 / Math.PI;
  } else if (cmd.circle != null) {
    const g = refs && typeof refs.circle === 'function' ? refs.circle(cmd.circle) : null;
    if (!g || !Array.isArray(g.center) || !Number.isFinite(g.radius) || g.radius <= 0) {
      throw new Error('regularPolygon.circle 必须引用已画好的圆（取不到圆心/半径）');
    }
    center = g.center; radius = g.radius; definition = 'circle';
  } else {
    center = point2(cmd.center == null ? [0, 0] : cmd.center, 'center');
    if (cmd.radius != null) {
      radius = valueOf(cmd.radius);
      definition = 'center+radius';
    } else if (cmd.vertex != null) {
      const V = point2(cmd.vertex, 'vertex');
      const d = Math.hypot(V[0] - center[0], V[1] - center[1]);
      if (d < 1e-9) throw new Error('regularPolygon.vertex 不能与 center 重合');
      vertexAngleDeg = Math.atan2(V[1] - center[1], V[0] - center[0]) * 180 / Math.PI;
      // vertex 给的是「第一个顶点」：内接时顶点半径=d；外切时 R = d·cos(180°/n)
      radius = mode === 'circumscribed' ? d * Math.cos(Math.PI / sides) : d;
      definition = 'center+vertex';
    }
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error('regularPolygon.radius 必须是正数（或给 circle / vertex 定半径）');
  }

  // 旋转：显式 rotate 优先；vertex / edge 定顶点时让第一个顶点正好落在给定点上
  //   （外切顶点相对内接多偏 180°/n 的 offset，这里预先减掉，保证 k=0 落在 A / V 上）
  let rotate = Number.isFinite(Number(cmd.rotate)) && cmd.rotate != null ? Number(cmd.rotate) : 0;
  if ((definition === 'center+vertex' || definition === 'edge') && cmd.rotate == null) {
    rotate = vertexAngleDeg - (mode === 'circumscribed' ? 180 / sides : 0);
  }
  const rotateRad = rotate * Math.PI / 180;
  const vertexRadius = mode === 'circumscribed' ? radius / Math.cos(Math.PI / sides) : radius;
  const offset = mode === 'circumscribed' ? Math.PI / sides : 0;

  const angles = [], vertices = [];
  for (let k = 0; k < sides; k++) {
    const a = rotateRad + offset + k * 2 * Math.PI / sides;
    angles.push(a);
    vertices.push([center[0] + vertexRadius * Math.cos(a), center[1] + vertexRadius * Math.sin(a)]);
  }

  // 顶点 id：显式给就逐个校验（长度=边数、非空、不重复、不与主 id 同名），否则自动 <id>1..<id>n
  let vertexIds;
  if (cmd.vertexIds != null) {
    if (!Array.isArray(cmd.vertexIds) || cmd.vertexIds.length !== sides ||
        !cmd.vertexIds.every((v) => typeof v === 'string' && v.trim())) {
      throw new Error('regularPolygon.vertexIds 必须是 ' + sides + ' 个非空 id 的数组');
    }
    vertexIds = cmd.vertexIds.slice();
  } else {
    const base = String(cmd.id || 'poly');
    vertexIds = Array.from({ length: sides }, (_, k) => base + (k + 1));
  }
  if (new Set(vertexIds).size !== sides) throw new Error('regularPolygon.vertexIds 不能有重复 id');
  if (cmd.id != null && vertexIds.includes(String(cmd.id))) {
    throw new Error('regularPolygon.vertexIds 不能与主 id「' + cmd.id + '」同名');
  }

  // expr 尾部只在 edge 定义时多一个标记：既有 center+radius / circle / vertex 分支
  // 的 __aiExpr（describe / 回放）保持逐字节不变，便于无头回归对照。
  const expr = `regularPolygon: ${mode} n=${sides} R=${fmt(radius)} center(${fmt(center[0])},${fmt(center[1])}) rotate=${fmt(rotate)}${definition === 'edge' ? ' def=edge' : ''}`;
  const meta = { definition, center, radius, sides, mode, rotate, vertexRadius, vertexIds };
  // toward 定侧只影响 center 的数值（已体现在 expr 里），额外把判定出的侧别记进 meta，
  // 让 describe()/inspect 的 __aiRegular 快照能回读；expr 格式保持逐字节不变（旧回归护栏不破）。
  if (towardSide) meta.towardSide = towardSide;
  return { vertices, angles, center, radius, sides, mode, rotate, vertexRadius, vertexIds, expr, meta };
}

/**
 * remove 删除规划（模块级纯函数，不依赖 JSXGraph / DOM，可无头单测）。
 *
 * 从 cmd.id / cmd.ids 出发，沿注册表元素的 parents / childElements 依赖图做不动点 BFS，
 * 把「依赖这些对象」的后代对象一并纳入删除集合（与 js/board.js 删除工具的级联语义一致，
 * 防止删掉一个点后留下悬空的线段/圆/多边形让画板更新报错）；并补上 regularPolygon 主图元
 * 派生的 n 个顶点 id（与 remove() 内部联动一致）。
 *
 * 返回 { removed: 按「依赖者先删、显式目标后删」排序的 id 列表, missing: 不存在的 id,
 *        seeds: 显式指定且存在的 id, cascade: 由级联额外纳入的 id }。
 * 引擎不提供 parents / childElements 时自动降级为「只删显式指定项」，不抛错、不误删。
 * 显式拒绝 __all__ / 空值 / 非字符串：清空画板只能用 clear，避免 AI 一条命令误删整幅图。
 */
export function planRemove(cmd, registry) {
  const raw = cmd && (cmd.ids !== undefined ? cmd.ids : cmd.id);
  // 严格校验、早失败不猜：任何非字符串 / 空值 / '__all__' 成员都整条拒绝，不静默过滤脏数据。
  if (raw === undefined || raw === null) throw new Error('remove 需要 id 或 ids；要清空请用 clear');
  const seeds = Array.isArray(raw) ? raw : [raw];
  if (!seeds.length) throw new Error('remove 的 ids 不能是空数组；要清空请用 clear');
  for (const s of seeds) {
    if (typeof s !== 'string' || !s.trim() || s.trim() === '__all__') {
      throw new Error('remove 的 id / ids 只能是非空字符串，不支持 __all__ / 空值 / 非字符串；要清空请用 clear');
    }
  }
  const ids = [...new Set(seeds.map((s) => s.trim()))];
  const map = registry instanceof Map ? registry : new Map();
  const missing = ids.filter((s) => !map.has(s));
  const doomed = new Set(ids.filter((s) => map.has(s)));
  const seedSet = new Set(doomed);

  // JSXGraph 元素对象 → 注册表 id 的反向索引（childElements / parents 里通常存的是元素对象）
  const byEl = new Map();
  for (const [k, el] of map) if (el && typeof el === 'object') byEl.set(el, k);
  const keyFor = (v) => {
    if (v == null) return null;
    if (typeof v === 'string' && map.has(v)) return v;
    const mapped = byEl.get(v);
    if (mapped) return mapped;
    if (typeof v === 'object' && typeof v.id === 'string' && map.has(v.id)) return v.id;
    return null;
  };
  const refsOf = (el) => {
    const res = [];
    if (!el || typeof el !== 'object') return res;
    if (Array.isArray(el.parents)) res.push(...el.parents);
    const cs = el.childElements;
    if (cs instanceof Map) res.push(...cs.values());
    else if (Array.isArray(cs)) res.push(...cs);
    else if (cs && typeof cs === 'object') res.push(...Object.values(cs));
    return res;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, el] of map) {
      if (doomed.has(id) || !el || typeof el !== 'object') continue;
      if (refsOf(el).some((r) => { const k = keyFor(r); return k && doomed.has(k); })) {
        doomed.add(id); changed = true;
      }
    }
  }
  // 正多边形主图元被删时，派生顶点一并纳入（与 remove() 的联动保持一致）
  for (const id of [...doomed]) {
    const el = map.get(id);
    const kids = Array.isArray(el && el.__aiRegularVertexIds) ? el.__aiRegularVertexIds : [];
    for (const k of kids) if (map.has(k)) doomed.add(k);
  }
  // 按依赖倒序：不动点 BFS 后加入的是依赖者，先删它们，最后删显式目标，避免悬空
  const ordered = [...doomed].reverse();
  return {
    removed: ordered,
    missing,
    seeds: ids.filter((s) => seedSet.has(s)),
    cascade: ordered.filter((id) => !seedSet.has(id)),
  };
}

/* ---------- 函数图像分段裁剪 / 多区间定义域（2026-11-17 第十一轮新增）----------
 * 此前 `function` 只有 from~to 一个连续定义域 + ymin/ymax 值域裁剪。遇到
 *   「定义域 [-5,-1]∪[1,5]」「y=1/x 去掉 x=0 附近」「tan(x) 断在渐近线」
 *   「只看 x<0 和 x≥2 两段」这类需求，AI 只能拆成多条 function 各自 from/to
 *   拼接（回归清单用例 11 的权宜做法），于是同一个函数占多个 id、样式要逐条
 *   重复设置、交点筛选（intersect of:[f1,…]）不知道该引用哪一段，改一处要改一批。
 * 本轮把「分段」下沉为 function 的原生能力：
 *   segments: [[a,b], [c,d], …]   只画这些 x 闭区间的并集（白名单 / 多段定义域）
 *   exclude:  [[a,b], …]          在这些 x 闭区间内不画（黑名单 / 挖洞去间断）
 *   二者可叠加：先按 segments 取并集，再减去 exclude；都不写则整条 from~to 全画。
 * 关键约束：端点一律写数字（坐标数值化），不写 "pi"/"a"/表达式；区间自动
 *   归一（去 NaN、交换倒序、按起点排序、合并重叠/相邻段、钳制到 from~to），
 *   段数上限 12，超出只取前 12 段；非法项静默丢弃、不整批失败。
 * 实现与 ymin/ymax 值域裁剪走同一条路径：把区间外的采样点记成 NaN，
 *   JSXGraph 的 functiongraph 会自动断开/略过，滑动条联动（JessieCode）照旧。
 * 纯函数导出（不依赖 board / DOM），供 tests/board2d_function_segments_spec.mjs
 *   无头回归直接 import；区间元数据挂 __aiSegments 供 describe()/inspect 回读。
 */
const FUNC_SEG_MAX = 12;

/** 把一段区间数组归一成「已排序、已合并、已钳制」的闭区间列表（纯函数） */
function normalizeIntervals(raw, from, to) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    let a = Number(item[0]), b = Number(item[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) { const t = a; a = b; b = t; }
    // 钳制到函数整体定义域 [from,to]，完全落在域外的段直接丢掉
    a = Math.max(a, from); b = Math.min(b, to);
    if (b < a) continue;
    out.push([a, b]);
    if (out.length >= FUNC_SEG_MAX) break;
  }
  out.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && seg[0] <= last[1]) { if (seg[1] > last[1]) last[1] = seg[1]; }
    else merged.push(seg);
  }
  return merged;
}

/**
 * 解析 function 命令的分段定义域（导出纯函数，供无头单测）。
 * @param {object} cmd function 命令
 * @param {number} from 整体定义域下界（已归一）
 * @param {number} to   整体定义域上界（已归一）
 * @returns {{active:boolean, segments:number[][], exclude:number[][], inRange:function(number):boolean, summary:string}}
 *   active=false 表示没写分段（走原有整段出图路径，零回归）；
 *   inRange(x) 判断某个 x 采样点是否该画；summary 是给状态快照回读的简短文本。
 */
export function parseFunctionSegments(cmd, from, to) {
  const segments = normalizeIntervals(cmd && cmd.segments, from, to);
  const exclude = normalizeIntervals(cmd && cmd.exclude, from, to);
  const active = segments.length > 0 || exclude.length > 0;
  const inSeg = (x) => segments.length === 0 || segments.some(([a, b]) => x >= a && x <= b);
  const inExc = (x) => exclude.some(([a, b]) => x >= a && x <= b);
  const inRange = (x) => !active || (inSeg(x) && !inExc(x));
  const fmt = (list) => list.map(([a, b]) => '[' + a + ',' + b + ']').join('∪');
  const parts = [];
  if (segments.length) parts.push('segments=' + fmt(segments));
  if (exclude.length) parts.push('exclude=' + fmt(exclude));
  return { active, segments, exclude, inRange, summary: parts.join(' ') };
}

/**
 * 解析 style 命令里的「点型样式」子集（导出纯函数，供无头单测）。
 * 用于把分段函数端点和区间内区间外画成空心/实心圆点，表达端点开闭（数学上 [-5,-1) 与 [-5,-1] 的区别）。
 * 不写 face/size/hollow/solid 任一项时 active=false（走原有 style 路径，零回归）。
 * @param {object} cmd style 命令
 * @returns {{active:boolean, attrs:object, summary:string}}
 *   attrs 是可直接并入 setAttribute 的属性（face/size/fillColor/fillOpacity/strokeWidth）；
 *   summary 是给状态快照回读的简短文本。
 */
const POINT_FACE_MAP = Object.freeze({
  o: 'o', circle: 'o', round: 'o', '圆': 'o', '圆点': 'o', '空心圆': 'o',
  '[]': '[]', square: '[]', rect: '[]', '方': '[]', '方块': '[]',
  diamond: 'diamond', '菱形': 'diamond',
  '^': '^', triangle: '^', '三角': '^', up: '^',
  v: 'v', down: 'v', '>': '>', right: '>', '<': '<', left: '<',
  '+': '+', plus: '+', '十字': '+', '-': '-', minus: '-', '|': '|',
});

export function stylePointSpec(cmd) {
  const c = cmd || {};
  const hasFace = c.face != null && String(c.face).trim() !== '';
  const hasSize = c.size != null && String(c.size).trim() !== '';
  const hasHollow = c.hollow === true || c.hollow === 'true';
  const hasSolid = c.solid === true || c.solid === 'true';
  const hasFill = c.fillColor != null && String(c.fillColor).trim() !== '';
  const active = hasFace || hasSize || hasHollow || hasSolid || hasFill;
  const attrs = {};
  const parts = [];

  // face：英文/中文别名归一；未知值宽容丢弃（不整批失败）
  if (hasFace) {
    const key = String(c.face).trim().toLowerCase();
    const face = POINT_FACE_MAP[key];
    if (face) { attrs.face = face; parts.push('face:' + face); }
  }
  // size：点大小，数值化并钳制到 1~20；NaN/非数字丢弃
  if (hasSize) {
    const s = Number(c.size);
    if (Number.isFinite(s)) {
      const size = Math.max(1, Math.min(20, s));
      attrs.size = size; parts.push('size:' + size);
    }
  }
  // hollow：空心圆——face 缺省 o、填充透明、描边保底 1.5（否则看不见轮廓）
  if (hasHollow) {
    if (attrs.face == null) attrs.face = 'o';
    attrs.fillOpacity = 0;
    if (c.strokeWidth == null) attrs.strokeWidth = 1.5;
    parts.push('hollow');
  }
  // solid：实心圆——填充不透明
  if (hasSolid) {
    attrs.fillOpacity = 1;
    parts.push('solid');
  }
  // fillColor：自定义填充色（空心点可给白底，实心点给描边同色由执行分支补全）
  if (hasFill) { attrs.fillColor = String(c.fillColor).trim(); parts.push('fill:' + attrs.fillColor); }

  return { active, attrs, summary: parts.join(' ') };
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

  /** conic 的语义引用解析：点 id → 坐标，直线 id → 两端点坐标（供 conicSpec 纯函数使用） */
  const conicRefs = {
    point: (r) => {
      const el = resolve(r);
      if (!el || typeof el.X !== 'function' || typeof el.Y !== 'function') {
        throw new Error('conic 引用的「' + r + '」不是点');
      }
      return [el.X(), el.Y()];
    },
    line: (r) => {
      const ep = lineEndpoints(resolve(r));
      if (!ep) throw new Error('conic 引用的「' + r + '」不是直线/线段');
      return ep;
    },
  };

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
    if (type === 'scale') {
      // 位似 / 相似变换（本轮新增，落实待办⑤「相似/位似变换」缺口）：
      // 以 center 为位似中心、k 为位似比，把 (x,y) 映到 center + k·(x-center)。
      // k 可正可负：|k|>1 放大、0<|k|<1 缩小、k<0 反向（含中心对称）。半径随 |k| 缩放。
      const k = Number(cmd.k);
      if (!Number.isFinite(k)) throw new Error('transform.type=scale 需要数值 k（位似比，如 2 或 0.5）');
      const [cx, cy] = centerOf(cmd.center);
      return (x, y) => [cx + k * (x - cx), cy + k * (y - cy)];
    }
    throw new Error('transform.type 只能是 translate / rotate / reflect / scale');
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
      case 'regularPolygon': {
        // 正多边形（本轮新增，对标大角几何「自研 DSL / 符号计算」）：
        // AI 只给中心/半径/边数/内接或外切/旋转，执行器用三角函数精确算 n 个顶点，
        // 落成「n 个可引用的独立 point + 一个 polygon」，不再让 AI 手算 cos(2πk/n)
        // （见 ai/board-prompt.js 例20 手算法的易错点：1.732 抄错、外切顶点放错半径）。
        // 2026-11-16 第五轮同步：cmd.edge=[A,B] 时两点由下面的 polyRefs.point 解析，
        // 中心/半径/朝向全由 regularPolygonSpec 推导；此时 cmd.center/cmd.radius 都为空，
        // centerEl / radiusGetter 自然为 null → dynamic=false，顶点按推导值静态落成 fixed:true 的
        // point（与 circle / vertex 定义的静态行为一致），无需在此另开分支。
        const polyRefs = {
          point: (r) => {
            const el = resolve(r);
            if (!el || typeof el.X !== 'function' || typeof el.Y !== 'function') {
              throw new Error('regularPolygon 引用的「' + r + '」不是点');
            }
            return [el.X(), el.Y()];
          },
          value: (r) => {
            const v = numericOf(resolve(r));
            if (!Number.isFinite(v)) throw new Error('regularPolygon.radius 引用的「' + r + '」不是滑动条/数值');
            return v;
          },
          circle: (r) => {
            const g = circleGeom(resolve(r));
            if (!g) throw new Error('regularPolygon.circle 引用的「' + r + '」不是圆');
            return { center: [g[0], g[1]], radius: g[2] };
          },
        };
        // toward 点定侧也走这里的 refs.point（点 id → 坐标），与 edge 两端点共用同一套
        // 「先创建后引用」解析；执行分支无需新增 case，语义在纯函数 regularPolygonSpec 内闭环。
        const spec = regularPolygonSpec(cmd, polyRefs);
        // 幂等校验：任一顶点 id 已被占用就整条失败，避免留下半套图形 / 覆盖别的对象
        for (const vid of spec.vertexIds) {
          if (registry.has(vid)) throw new Error(`id「${vid}」重复定义（regularPolygon 顶点）`);
        }

        // 动态联动：center 是已注册点、radius 是已注册滑动条时，顶点坐标写成函数，
        // 拖动中心点 / 滑动条会实时重算整块正多边形（与 point 的 x:"a" 同一套机制）。
        const centerEl = (typeof cmd.center === 'string' && cmd.circle == null && registry.has(cmd.center))
          ? registry.get(cmd.center) : null;
        const radiusGetter = (typeof cmd.radius === 'string' && cmd.circle == null && !Number.isFinite(Number(cmd.radius)))
          ? valueGetter(cmd.radius) : null;
        const dynamic = !!(centerEl || radiusGetter);
        const cNow = () => (centerEl && typeof centerEl.X === 'function' ? [centerEl.X(), centerEl.Y()] : spec.center);
        const rNow = () => {
          const base = radiusGetter ? Number(radiusGetter()) : spec.radius;
          const r = Number.isFinite(base) && base > 0 ? base : spec.radius;
          return spec.mode === 'circumscribed' ? r / Math.cos(Math.PI / spec.sides) : r;
        };

        // 顶点是由参数派生出来的，fixed:true 防止拖单个顶点把「正」破坏掉；
        // 想改整体请拖 center 点 / 改滑动条，或再发一条 regularPolygon。
        const pts = spec.vertices.map((p, k) => {
          const a = spec.angles[k];
          const xy = dynamic
            ? [() => cNow()[0] + rNow() * Math.cos(a), () => cNow()[1] + rNow() * Math.sin(a)]
            : [p[0], p[1]];
          return board.create('point', xy, { ...POINT_STYLE, name: spec.vertexIds[k], fixed: true });
        });

        const style = { ...opt };
        if (cmd.color) { style.strokeColor = cmd.color; style.highlightStrokeColor = cmd.color; }
        if (cmd.strokeWidth != null) style.strokeWidth = num(cmd.strokeWidth, 2);
        if (cmd.dash != null) style.dash = num(cmd.dash, 0);
        if (cmd.fill) { style.fillColor = cmd.fillColor || cmd.color || '#C7D2FE'; style.fillOpacity = 0.25; }
        if (cmd.fillColor) style.fillColor = cmd.fillColor;
        if (cmd.fillOpacity != null) style.fillOpacity = num(cmd.fillOpacity, 0.25);
        const poly = board.create('polygon', pts, style);

        // 顶点逐个进注册表：AI 后续可直接用顶点 id 连对角线 / 取中点 / verify 共圆；
        // 主 id 指向 polygon（execute 随后注册），__aiRegular* 供 describe()/inspect 数值快照回读。
        spec.vertexIds.forEach((vid, k) => registry.set(vid, pts[k]));
        poly.__aiExpr = spec.expr;
        poly.__aiRegular = { type: 'regularPolygon', ...spec.meta };
        poly.__aiRegularVertexIds = spec.vertexIds.slice();
        return poly;
      }
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
        // 取值范围：from/to 是整体定义域（x 区间，默认 -10~10）；ymin/ymax 是值域裁剪
        // （只画 y 落在区间内的那一段曲线，留空表示不裁剪）；segments/exclude 是分段
        // 定义域（本轮新增，见 parseFunctionSegments：多段并集 / 挖洞，端点数值化）。
        // 三种裁剪都落在「区间外的采样点记 NaN」这条路径上，JSXGraph 自动断开。
        const expr = String(cmd.expr || '');
        let from = num(cmd.from, -10), to = num(cmd.to, 10);
        if (to < from) { const t = from; from = to; to = t; }
        let ymin = cmd.ymin, ymax = cmd.ymax;
        if (Array.isArray(cmd.range) && ymin == null && ymax == null) { ymin = cmd.range[0]; ymax = cmd.range[1]; }
        const lo = Number(ymin), hi = Number(ymax);
        const hasYClip = Number.isFinite(lo) || Number.isFinite(hi);
        const seg = parseFunctionSegments(cmd, from, to);
        let fn = expr;
        if (hasYClip || seg.active) {
          let a = Number.isFinite(lo) ? lo : -Infinity;
          let b = Number.isFinite(hi) ? hi : Infinity;
          if (b < a) { const t = a; a = b; b = t; }
          // 值域裁剪：把区间外的采样点记成 NaN；分段定义域：把 x 不在允许区间内的
          // 采样点同样记成 NaN（JXGraph 会自动断开/略过这些点，多段之间不会连线）。
          // 表达式仍走 JessieCode 编译（与 JXGraph 内部一致），所以滑动条联动照样生效。
          const compile = board.jc && typeof board.jc.snippet === 'function';
          if (!compile) {
            // 极端情况（引擎缺 JessieCode）：退化为只按定义域出图，不裁剪值域/分段
            return board.create('functiongraph', [expr, from, to], { ...opt, strokeColor: '#C62828', strokeWidth: 2 });
          }
          const snip = board.jc.snippet(expr, true, 'x', false);
          fn = (x) => {
            if (!seg.inRange(x)) return NaN;
            const v = snip(x);
            return (Number.isFinite(v) && v >= a && v <= b) ? v : NaN;
          };
        }
        const el = board.create('functiongraph', [fn, from, to], { ...opt, strokeColor: '#C62828', strokeWidth: 2 });
        // 分段元数据挂到元素上：describe()/inspect 的数值快照要能回读「这条曲线画了哪几段」，
        // AI 在已有曲线上继续构造 / 局部重画时不必猜定义域（MCP 式读状态）。
        if (seg.active) el.__aiSegments = seg.summary;
        return el;
      }
      case 'conic': {
        // 圆锥曲线（本轮新增，对标大角几何「自研数学 DSL / 符号计算」）：
        // AI 只声明语义参数（第一定义 foci+sum/diff、第二定义 focus+directrix、标准式），
        // conicSpec 统一换算成参数曲线采样函数，交给 JSXGraph 的 curve 元素绘制；
        // 双曲线两支之间返回 NaN 断开（与 function 的 ymin/ymax 裁剪同理）。
        const spec = conicSpec(cmd, conicRefs);
        const fx = (t) => spec.at(t)[0];
        const fy = (t) => spec.at(t)[1];
        const el = board.create('curve', [fx, fy, spec.tMin, spec.tMax], {
          ...opt,
          strokeColor: cmd.color || '#C62828',
          highlightStrokeColor: cmd.color || '#C62828',
          strokeWidth: cmd.strokeWidth != null ? num(cmd.strokeWidth, 2) : 2,
          ...(cmd.dash != null ? { dash: num(cmd.dash, 0) } : {}),
        });
        // 方程与参数挂到元素上：describe() 的「数值快照」/ inspect 才能回读，
        // AI 在已有圆锥曲线上继续构造时不用猜参数（与 function 的 __aiExpr/__aiRange 一致）。
        el.__aiExpr = spec.expr;
        el.__aiRange = [spec.tMin, spec.tMax];
        el.__aiConic = { type: spec.type, ...spec.meta };
        return el;
      }
      case 'polar': {
        // 极坐标曲线 r=r(t)（本轮新增，对标大角几何数学 DSL）：把 r(t) 表达式按
        // x=r·cos t / y=r·sin t 换算成参数曲线，交给与 conic 相同的 curve 元素绘制；
        // r 为 NaN / 非有限值时该采样点断开（玫瑰线负半径、螺线越界交给引擎自动处理）。
        const spec = polarSpec(cmd);
        const compile = board.jc && typeof board.jc.snippet === 'function';
        const injected = compile
          ? board.jc.snippet(spec.expr, true, 't', false)
          : (t) => { try { return Function('t', 'return (' + spec.expr + ')')(t); } catch (_) { return NaN; } };
        const rAt = (t) => { const v = injected(t); return Number.isFinite(v) ? v : NaN; };
        const fx = (t) => { const r = rAt(t); return Number.isFinite(r) ? r * Math.cos(t) : NaN; };
        const fy = (t) => { const r = rAt(t); return Number.isFinite(r) ? r * Math.sin(t) : NaN; };
        const el = board.create('curve', [fx, fy, spec.tMin, spec.tMax], {
          ...opt,
          strokeColor: cmd.color || '#C62828',
          highlightStrokeColor: cmd.color || '#C62828',
          strokeWidth: cmd.strokeWidth != null ? num(cmd.strokeWidth, 2) : 2,
          ...(cmd.dash != null ? { dash: num(cmd.dash, 0) } : {}),
        });
        // 方程 / 极角范围 / 采样提示挂元素：describe()/inspect 的数值快照能回读，
        // AI 在已有极坐标曲线上继续作图或局部重画时不必猜表达式与范围（MCP 式读状态）。
        el.__aiExpr = 'r=' + spec.expr;
        el.__aiRange = [spec.tMin, spec.tMax];
        el.__aiPolar = spec.meta;
        return el;
      }
      case 'inequality': {
        // 不等式区域填充（本轮新增，对标大角几何区域填充 / 数学 DSL）：AI 只声明边界
        // （函数 y=f(x) 或已画的直线 id）+ 填充侧，交给 JSXGraph 原生 inequality 元素填充
        // 满足不等式的一侧，不再手算采样点拼 polygon 近似阴影（点数僵硬、边界锯齿、无法联动）。
        const spec = inequalitySpec(cmd);
        let boundaryEl;
        if (spec.mode === 'boundary') {
          // MCP 式：直接引用画板上已有的 line/segment/functiongraph 作边界（读状态 → 继续构造）
          boundaryEl = resolve(cmd.boundary);
        } else {
          // expr 模式：把 y=f(x) 编译成边界 functiongraph（JessieCode 优先，滑动条联动），
          // 非有限值记 NaN 自动断开；边界曲线保留可见，作为「函数图像 + 阴影」的一部分。
          const compile = board.jc && typeof board.jc.snippet === 'function';
          let fn = spec.expr;
          if (compile) {
            const snip = board.jc.snippet(spec.expr, true, 'x', false);
            fn = (x) => { const v = snip(x); return Number.isFinite(v) ? v : NaN; };
          }
          boundaryEl = board.create('functiongraph', [fn, spec.from, spec.to], {
            name: '', strokeColor: spec.strokeColor, strokeWidth: 2,
            highlightStrokeColor: spec.strokeColor,
          });
        }
        const el = board.create('inequality', [boundaryEl], {
          fillColor: spec.fillColor,
          fillOpacity: spec.fillOpacity,
          strokeColor: 'none',
          inverse: spec.inverse,
          highlightFillColor: spec.fillColor,
          highlightFillOpacity: Math.min(1, spec.fillOpacity + 0.15),
        });
        // 语义参数挂元素：describe()/inspect 的数值快照能回读边界与填充侧，
        // AI 在已有区域上继续作图（换色 / 叠加 / 删改）时不必猜（MCP 式读状态）。
        el.__aiInequality = spec.meta;
        el.__aiExpr = spec.mode === 'expr' ? ('y' + (spec.inverse ? '>' : '<') + spec.expr) : ('边界' + spec.boundary);
        return el;
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
        // 点型样式（本轮新增，见 stylePointSpec）：把端点画成空心/实心圆，表达分段区间端点开闭。
        // Object.assign 放最后，使点型属性覆盖 color/fill 等通用设置；solid 且未指定填充色时填充跟随描边色，
        // 避免"蓝心红边"；读不到描边色时保留 JSXGraph 默认填充。
        const ps = stylePointSpec(cmd);
        if (ps.active) {
          Object.assign(a, ps.attrs);
          if ((cmd.solid === true || cmd.solid === 'true') && cmd.fillColor == null && !cmd.color && a.fillColor == null) {
            let stroke = a.strokeColor;
            if (stroke == null && typeof el.getAttribute === 'function') stroke = el.getAttribute('strokeColor');
            if (typeof stroke === 'function') stroke = stroke.call(el);
            if (stroke) a.fillColor = stroke;
          }
          // 数值快照回读（MCP 式读状态）：把点型摘要挂到元素，describe() 据此回报端点开闭
          if (el && ps.summary) el.__aiPointStyle = ps.summary;
        }
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
        //   scale:     {type:'scale', k:位似比, center:'O'|[x,y]（省缺原点）}         位似/相似变换
        //                       | k 可正可负：|k|>1 放大、0<|k|<1 缩小、k<0 反向（含中心对称）；圆/多边形半径随 |k| 缩放
        // 支持 point / segment / line / ray / polygon / circle；副本为静态落点（不随源拖拽实时
        // 联动），但回放/保存时按命令重建，行为稳定。type 非法时抛错由外层捕获。
        const src = resolve(cmd.of);
        if (!src) throw new Error('transform.of 引用的元素不存在');
        const f = transformFn(cmd, resolve);
        const scaleK = (String(cmd.type || '').toLowerCase() === 'scale') ? Math.abs(Number(cmd.k)) : 1;
        const et = src.elType;
        if (et === 'point') {
          const [nx, ny] = f(src.X(), src.Y());
          const pt = board.create('point', [nx, ny], { ...POINT_STYLE, ...opt });
          applyLabel(pt, cmd.label);
          return pt;
        }
        if (et === 'circle') {
          const [cx, cy] = f(src.center.X(), src.center.Y());
          const r = (typeof src.Radius === 'function' ? src.Radius() : 1) * scaleK;
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
    // 正多边形删除主图元时，把它派生出来的 n 个顶点一起清掉，避免留下孤儿点占着 id
    const kids = Array.isArray(el.__aiRegularVertexIds) ? el.__aiRegularVertexIds : [];
    for (const kid of kids) {
      const k = registry.get(kid);
      if (k) { try { board.removeObject(k); } catch (_) { /* 忽略 */ } }
      registry.delete(kid);
      plainPoints.delete(kid);
    }
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
      if (cmd.op === 'remove') {
        // 按 id / ids 删除图元（MCP 式「读画板状态 → 局部删除 → 重画」）：
        // planRemove 已沿依赖图把依赖者一并纳入并按依赖倒序排好；不存在的 id 记入 missing 不整批失败；
        // 删完后同名 id 可重新 point / regularPolygon（registry 已释放该 id，不会报「重复定义」）。
        const plan = planRemove(cmd, registry);
        for (const rid of plan.removed) remove(rid);
        out.push({ ok: true, op: 'remove', removed: plan.removed, missing: plan.missing });
        continue;
      }
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
        desc = t + '@' + fmtPoint([el.X(), el.Y()])
          + (el.__aiPointStyle ? ' 点型{' + el.__aiPointStyle + '}' : '');
      } else if (t === 'circle') {
        const g = circleGeom(el);
        if (g) desc = 'circle@O' + fmtPoint([g[0], g[1]]) + ',r=' + fmtNum(g[2]);
      } else if (LINE_TYPES.has(t)) {
        const ep = lineEndpoints(el);
        if (ep) desc = t + '@' + fmtPoint(ep[0]) + '->' + fmtPoint(ep[1]);
      } else if (el.__aiRegular) {
        // 正多边形：回读语义参数（边数/内接外切/中心/半径/旋转/顶点 id），
        // AI 在已有正多边形上继续构造时直接用这些数值，不用猜顶点坐标。
        const m = el.__aiRegular;
        desc = 'regularPolygon:' + m.mode + '@n=' + m.sides
          + ',中心(' + fmtNum(m.center[0]) + ',' + fmtNum(m.center[1]) + ')'
          + ',R=' + fmtNum(m.radius) + ',旋转' + fmtNum(m.rotate) + '°'
          + ',顶点[' + m.vertexIds.slice(0, 6).join(' ') + (m.vertexIds.length > 6 ? ' …' : '') + ']';
      } else if (t === 'polygon' && Array.isArray(el.vertices)) {
        const vs = el.vertices.slice(0, 6)
          .filter((v) => v && typeof v.X === 'function' && typeof v.Y === 'function')
          .map((v) => fmtPoint([v.X(), v.Y()]));
        if (vs.length) desc = 'polygon@[' + vs.join(' ') + (el.vertices.length > 6 ? ' …' : '') + ']';
      } else if (el.__aiConic) {
        // 圆锥曲线：回读语义参数（中心/顶点、a/b/p），AI 在已有曲线上继续构造时不用猜
        const m = el.__aiConic;
        const c = m.center || m.vertex || [0, 0];
        desc = 'conic:' + m.type + '@' + m.definition + ',中心(' + fmtNum(c[0]) + ',' + fmtNum(c[1]) + ')'
          + (Number.isFinite(m.a) ? ',a=' + fmtNum(m.a) + ',b=' + fmtNum(m.b) : '')
          + (Number.isFinite(m.p) ? ',p=' + fmtNum(m.p) : '');
      } else if (el.__aiPolar && t === 'curve') {
        // 极坐标曲线（本轮新增）：回读 r(t) 表达式与极角范围，AI 在已有曲线上继续构造时照抄，
        // 不必猜采样点坐标（与 conic / function 的数值快照同范式，MCP 式读状态）。
        const m = el.__aiPolar;
        desc = 'polar:' + (el.__aiExpr || ('r=' + m.expr))
          + (Array.isArray(el.__aiRange) ? ' θ∈[' + fmtNum(el.__aiRange[0]) + ',' + fmtNum(el.__aiRange[1]) + ']' : '')
          + (Number.isFinite(m.samples) ? ' 采样' + m.samples : '');
      } else if (el.__aiInequality) {
        // 不等式区域（本轮新增）：回读边界与填充侧，AI 在已有阴影上继续换色/叠加/删改时照抄，
        // 不必猜边界表达式或侧（与 polar / conic 的数值快照同范式，MCP 式读状态）。
        const m = el.__aiInequality;
        desc = 'inequality:' + (m.mode === 'expr' ? (el.__aiExpr || ('y=' + m.expr)) : ('边界' + m.boundary))
          + ' side=' + m.side + ' fill=' + m.fillColor;
      } else if (t === 'functiongraph' || t === 'curve') {
        desc = 'function' + (el.__aiExpr ? ':"' + el.__aiExpr + '"' : '')
          + (Array.isArray(el.__aiRange) ? '@[' + fmtNum(el.__aiRange[0]) + ',' + fmtNum(el.__aiRange[1]) + ']' : '')
          + (el.__aiSegments ? ' 分段{' + el.__aiSegments + '}' : '');
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
    if (kind === 'vertex') return 'vertex(' + String((d && (d.id || d.expr || (Array.isArray(d.of) ? d.of[0] : null))) || '?') + ')';
    return kind + '(' + (Array.isArray(d.of) ? d.of.join(',') : '') + ')';
  }

  /**
   * 纯算术降级环境补隐式乘（JessieCode 环境本来就能解析，原样求值即可）：
   * 4x→4*x、2x^2→2*x^2、x(x-2)→x*(x-2)、(x-1)(x+2)→(x-1)*(x+2)、-x^2→-(x^2)。
   * 只在 vertex 配方内部作为「原式求值失败后的重试变体」使用，不改 evalExprAt 的既有行为。
   */
  function normalizePolyExpr(expr) {
    return String(expr)
      .replace(/(^|[+\-])\s*-\s*x\^2/g, '$1-(x^2)')
      .replace(/(\d)\s*(?=x\b)/gi, '$1*')
      .replace(/([x)])\s*(?=\()/gi, '$1*')
      .replace(/(\))\s*(?=x\b)/gi, '$1*');
  }

  /**
   * 二次函数配方（inspect kind:"vertex"，本轮新增）：用数值采样反推 a,b,c，避免另写符号解析器。
   * 取 f(-1), f(0), f(1) 解出 a=(f(1)+f(-1)-2f(0))/2、b=(f(1)-f(-1))/2、c=f(0)，
   * 再以 f(2) 校验是否确为二次多项式（排除 x^3 / sin(x) / 含未知变量被误判）。
   * 求值复用 evalExprAt（JessieCode 优先、受限算术回退）；原式求值失败时再试一次
   * normalizePolyExpr 补齐隐式乘的变体，故 (x-2)^2-3 / x^2-4x+1 等写法都能配方。
   */
  function quadraticCoeffs(expr) {
    const variants = [String(expr)];
    const normalized = normalizePolyExpr(String(expr));
    if (normalized !== String(expr)) variants.push(normalized);
    for (const e of variants) {
      const f = (x) => evalExprAt(e, x);
      const c = f(0), p = f(1), m = f(-1);
      if (![c, p, m].every(Number.isFinite)) continue;
      const a = (p + m - 2 * c) / 2;
      const b = (p - m) / 2;
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < 1e-9) continue;
      const t = f(2);
      if (!Number.isFinite(t) || Math.abs(t - (4 * a + 2 * b + c)) > 1e-6 * Math.max(1, Math.abs(t))) continue;
      return { a, b, c };
    }
    return null;
  }

  const qfmt = (v) => String(Number(v.toFixed(3)));

  /**
   * 单条 vertex 读数：配方字符串 + 顶点 / 对称轴 / 最值 / 首项系数，
   * 供 AI 把「顶点(h,k)」落成 point 数字坐标、「轴 x=h」落成 line、最值写进 verify 的 expect。
   * 表达式可取 d.expr，或按 d.id / target / of[0] 读已注册函数的 __aiExpr；只读、不画图元。
   */
  function vertexReading(d) {
    let expr = d && d.expr != null ? String(d.expr) : '';
    let src = '';
    if (!expr && d) {
      const ref = d.id != null ? d.id : (d.target != null ? d.target : (Array.isArray(d.of) ? d.of[0] : null));
      if (ref != null) {
        const el = registry.get(String(ref));
        if (el && el.__aiExpr) { expr = String(el.__aiExpr); src = String(ref) + ':'; }
      }
    }
    if (!expr) return deriveName(d) + '=?无函数表达式';
    const q = quadraticCoeffs(expr);
    if (!q) return deriveName(d) + '=?非二次多项式';
    const h = -q.b / (2 * q.a);
    const k = q.c - q.b * q.b / (4 * q.a);
    const A = qfmt(q.a), H = qfmt(h), K = qfmt(k);
    const lead = Math.abs(q.a - 1) < 1e-9 ? '' : (Math.abs(q.a + 1) < 1e-9 ? '-' : A);
    const shift = Math.abs(h) < 1e-9 ? 'x' : (h > 0 ? '(x-' + H + ')' : '(x+' + qfmt(-h) + ')');
    const tail = k >= 0 ? '+' + K : '-' + qfmt(-k);
    const form = 'y=' + lead + shift + '^2' + (Math.abs(k) < 1e-9 ? '' : tail);
    const extremum = (q.a > 0 ? '最小值' : '最大值') + qfmt(k);
    return 'vertex(' + src + '"' + expr + '"): ' + form + '; 顶点(' + H + ',' + K + '); 轴 x=' + H
      + '; ' + extremum + '; a=' + A;
  }

  /** 单条派生量求值 → "名字=数值+单位"；复用 measureValue（纯计算，不画读数、不进注册表）。 */
  function deriveReading(d) {
    if (String((d && d.kind) || '').toLowerCase() === 'vertex') return vertexReading(d);
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
    //   {"op":"inspect","kind":"vertex","id":"f1"} / {"...","expr":"x^2-4x+1"}  二次函数符号化简（本轮新增，见 vertexReading）
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

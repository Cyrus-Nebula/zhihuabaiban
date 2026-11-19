# AI 作图回归用例清单

> 路线B 自建画板（board.html + js/board.js + js/executor.js + ai/board-prompt.js + ai/board-backend.js）。
> 目的：把「自然语言描述 → JSON 命令序列」的对照固化下来，每轮 AI 作图质量增量后跑通打勾，
> 防止提示词 / 协议改动把已修好的图形打回原形。
> 命令协议与 `js/executor.js` 一一对应，改协议两边同步改；提示词见 `ai/board-prompt.js`。
> 状态列：✅ 已验证 / ⬜ 待验证（沙箱无头环境无法跑真实 JSXGraph，需有浏览器的环境目视或单测确认）。

## 基础图元

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 1 | 画一个三角形 ABC | `point`×3 → `polygon` points:[A,B,C] | ✅ | 先建点再 polygon |
| 2 | 画圆，圆心 A 半径 3 | `point` A → `circle` center:A radius:3 | ✅ | through 与 radius 二选一 |
| 3 | 画过 (1,2)(3,4) 的直线 | 先建 P1(1,2) P2(3,4) → `line` through:[P1,P2] | ✅ | line 不能直接给裸坐标 |
| 4 | 标出 ∠ABC（B 为顶点） | `angle` points:[A,B,C] | ✅ | 顶点放中间 |
| 5 | 取 AB 中点 M | `midpoint` of:[A,B] | ✅ | 依赖已存在的 A、B |

## 交点与筛选

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 6 | 求抛物线与 x 轴的两个交点 | `function` f1 → `intersect`×2：of:[f1,xaxis] select:left / right | ✅ | 两交点必须两条命令不同 select |
| 7 | 求两圆交点 A、B | `intersect`×2：of:[c1,c2] select:left / right | ✅ | 同上 |
| 8 | 求直线与圆的交点 | `intersect` of:[l1,c1] select:near 或 index | ✅ | 可能 0/1/2 个，缺省取第 0 个 |

## 函数与取值范围

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 9 | 画 y=x²，定义域 [-3,3] | `function` expr:"x^2" from:-3 to:3 | ✅ | from>to 会自动交换 |
| 10 | 只要抛物线在 x 轴上方的部分 | `function` expr:"x^2-4" ymin:0 | ✅ | 值域裁剪用 ymin/ymax |
| 11 | 分段：x<0 画 -x，x≥0 画 x | 两条 `function` 各自 from/to 拼接 | ✅ | 分段需两条曲线 |

## 动态演示（滑动条）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 12 | 参数 a 控制抛物线开口 | `slider` a → `function` expr:"a*x^2"（slider 必须在前） | ✅ | 滑动条 id 必须先于引用它的命令 |
| 13 | 半径随滑动条 r 变 | `slider` r → `circle` radius:"r" | ✅ | radius 写字符串 id 触发联动 |
| 23 | 画好参数演示后自动播放 | `slider` a → `function` expr:"a*x^2" → `animate` id:"a"（或 ids:["a","b"] / "__all__"，配 pingpong、speed） | ✅ | animate 必须放在滑动条定义之后；它不是画板元素，不进文档 |

## 易错构造（本次增量重点 few-shot）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 说明 |
|---|------|-----------|------|------|
| 14 | 三角形 BC 边上的高 | `point`×3 → `polygon` → `line` lBC through:[B,C] → `perpendicular` h of:lBC through:A → `intersect` H of:[h,lBC] → `segment` AH → `style` h hidden:true → `measure` angle A,H,B | ✅ | 垂线是全直线，需隐藏并连成线段；measure 自检 ∠AHB≈90° |
| 15 | ∠ABC 的角平分线 | `point` B,A,C → `segment` sBA,sBC → `glider` P on:sBA, Q on:sBC → `midpoint` M of:[P,Q] → `line` bis through:[B,M] | ✅ | 协议无原生角平分线 op，用等距点+中点法；P/Q 用 glider 保证在边上 |
| 16 | 二次函数顶点式（顶点(2,3)开口向下） | `function` expr:"3-(x-2)^2" → `point` V(2,3) → `measure` evaluate expr:"3-(x-2)^2" x:2 | ✅ | 写成 "3-(x-2)^2" 避免负号/幂歧义；measure 核对 x=2→3 |
| 17 | 几何变换：向右平移 3 上移 1 | 原 `point`/`polygon` tri → `transform` id:tri2 of:tri type:translate by:[3,1] | ✅ | 本轮起有原生 transform op，不再手算坐标；of 必须已存在 |
| 21 | 几何变换：绕原点逆时针旋转 90° | `transform` id:tri3 of:tri type:rotate angle:90 center:[0,0]（center 省缺即原点） | ✅ | 角度用度；center 可写点 id 或 [x,y] |
| 22 | 几何变换：关于直线 BC 对称 | 先 `line` lBC through:[B,C] → `transform` id:triS of:tri type:reflect axis:lBC | ✅ | 轴对称用 axis（直线/线段 id）；中心对称则用 center |
| 53 | 几何变换：以原点为位似中心、位似比 2 放大三角形（相似/位似变换） | 原 `polygon` tri → `transform` id:triH of:tri type:scale k:2 center:[0,0]（整份副本落点，圆/多边形半径随 \|k\| 缩放）；逐顶点核对可对单点 `transform` Ap of:A type:scale k:2 center:[0,0] → `verify` kind:distance of:["O","Ap"] expect:2.828 tol:0.05 | ⬜ | 本轮（2026-11-14）起有原生 scale（位似/相似）：k>1 放大、0<k<1 缩小、k<0 反向（含中心对称）；center 省缺即原点；不要再逐点手算乘以 k 的坐标；见 `ai/board-prompt.js` 例19 |

## 样式与标注（线型 / 颜色 / 标签，本轮新增）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 25 | 三角形描红加粗 | `polygon` tri → `style` target:tri color:"#E11D48" strokeWidth:3 | ✅ | color 同时改描边+填充；strokeWidth 为像素线宽 |
| 26 | 辅助线改成虚线 | `style` target:h dash:2（dash:0 实线，1/2/3 虚线疏密递增） | ✅ | dash≠0 即虚线；只改外观不新建图元 |
| 27 | 给顶点 A 加标签「顶点A」 | `label` target:A text:"顶点A" | ✅ | 标签改的是元素名/文字，不是新建点；可多次追加 |
| 31 | 填充调淡 / 半透明描边 / 标签红色大字 | `style` target:tri strokeColor:"#1D4ED8" fillColor:"#93C5FD" fillOpacity:0.15 opacity:0.85 → `style` target:A labelColor:"#E11D48" labelSize:16 | ✅ | 本轮新增细粒度样式；opacity/fillOpacity 取 0~1，标签是独立 text 对象单独设色/字号；见 `ai/board-prompt.js` 例8 |

## 测量 / 自检（verify 层）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 说明 |
|---|------|-----------|------|------|
| 18 | 量 AB 的距离 | `measure` kind:distance of:[A,B] | ✅ | 画板生成灰色 ✓ 读数，不污染文档 |
| 19 | 量 ∠ABC 角度 | `measure` kind:angle of:[A,B,C] | ✅ | 中点是顶点 |
| 20 | 量函数在 x=2 处的值 | `measure` kind:evaluate expr:"x^2" x:2 | ✅ | 数值经 execute 结果回传 |
| 24 | AI 作图后自动自检并修正（read-back 闭环） | AI 输出作图命令 + `measure`；前端执行后把 measure 数值回传 LLM 二次核对，几何关系不符时自动补发修正命令 | ✅ | 前端 `js/board.js` 的 `aiSend()` 驱动；仅当一轮含 `measure` 时触发一次额外 LLM 调用；`executor.clearMeasures()` 清上一轮读数 |
| 28 | AI 收【自检回读】后只发修正命令（闭环回合示例，见 `ai/board-prompt.js` 例6） | 第一轮发作图命令 + `measure`；回读 ∠AHB≈90° 则回 `{"commands":[]}`；回读不符（如 63°）则只补发修正命令（重算垂足 / 改 intersect select），不整段重画 | ✅ | 收【自检回读】消息铁律：只输出修正命令或空 commands |
| 29 | 作 BC 边上的高并机器判定是否垂直 | 作图命令（同用例 14）→ `verify` kind:angle of:[A,H,B] expect:90 tol:0.5；`verify` kind:distance of:[A,H] expectRange:[3,5] | ✅ | 本轮新增 `verify`：expect + 默认 tol 0.05 / rtol，expectRange 区间；回传 pass:true/false，读数绿✓/红✗/灰·；见例7 |
| 30 | 自检不符时自动修正（read-back 闭环真正落地） | 一轮含 `verify` 且 pass:false → 前端 `aiSend()` 发【自检回读】二次 LLM 调用 → 只执行修正命令（改 intersect select / 重画那一处）；后续已演进为多轮收敛，见用例 38 | ✅ | 本轮补齐：此前注释声称已落地、实际前端未接入；纯 measure 只展示读数不额外调用 LLM；自检/动画命令不写入 doc.commands |

## 关系断言（verify 层·本轮新增 2026-11-12，对标大角几何符号自检）

> 关系断言把「几何关系」折算成「残差≈0」标量，复用既有 `expect`/`tol` 机器判定（`judgeMeasure` 零改动）；残差落在容差内即 `pass:true`，不回读具体距离/角度。命令末尾一律 `expect:0`。协议见 `js/executor.js` 的 `measureValue` 新分支与 `ai/board-prompt.js` 的 verify 行与例9。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 32 | 验证 AB⊥BC（垂直） | `verify` kind:perpendicular of:[A,B,B,C] expect:0 tol:0.5（残差=\|两直线夹角-90°\|） | ✅ | of 取 4 个点：前两定义第一条线 AB，后两定义第二条线 BC；角度类 tol 建议 0.5 |
| 33 | 验证 AB∥CD（平行） | `verify` kind:parallel of:[A,B,C,D] expect:0 tol:0.5（残差=两线夹角[0,90]） | ✅ | 比"量两组同位角相等"更直接；残差=0 即平行 |
| 34 | 验证 A、B、C、D 共线（如都在对角线上） | `verify` kind:collinear of:[A,B,C,D] expect:0 tol:0.05（残差=各点到首连线段最大距离） | ✅ | 多点一次判；tol 用坐标单位（0.05 较严） |
| 35 | 验证点 P 在直线上 | `verify` kind:online of:[P,"l1"] expect:0 tol:0.05（第二项填直线/线段 id）或 of:[P,A,B] 两点式 | ✅ | 第二项可填直线 id 或两点；残差=点到线距离 |
| 36 | 验证点 P 在圆上（如顶点在外接圆上） | `verify` kind:oncircle of:[P,"c1"] expect:0 tol:0.05（残差=\|P到圆心距离-半径\|） | ✅ | 圆半径若用滑动条需给对初值（如 √2/2）；否则残差偏大 pass:false 触发修正轮 |

## 多轮收敛与增量修正（verify 层·本轮新增 2026-11-12 第二轮）

> 恢复并升级 `b79292af` 的多轮修正闭环（曾被 `84815b71` 重写 `aiSend()` 时简化成一轮）：
> 修正后**静默复跑首轮原始 verify**（`js/executor.js` 的 `probeVerify`，只求值不画读数），机器判定是否真的收敛；
> 每轮带【上一轮改动 diff】/【已通过项，请勿重画】，最多 3 轮，横跳 / 失败项变多 / 连续 2 轮无改善即收手。
> 配套恢复 `move` 增量修正命令：同 id 重新 `point` 会被判「重复定义」而失败，改坐标一律用 `move`。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 说明 |
|---|------|-----------|------|------|
| 37 | 自检修正时把自由点 A 挪到 (0,3) | `move` id:A x:0 y:3（不新建图元、不改 id；依赖它的线/圆/多边形自动联动） | ✅ | 本轮恢复 `move`；同 id 重新 `point` 会报「id 重复定义」；`move` 也支持 `{"op":"move","id":"a","v":2}` 改滑动条当前值 |
| 38 | 多轮收敛：第 1 轮没修好，第 2 轮换改法后收敛 | 首轮作图 + `verify`；`pass:false` → 前端发【自检回读】→ 只发修正命令 → 静默复跑原始 `verify` → 仍 `pass:false` 且未横跳则第 2 轮换改法（`move` 就地改坐标）→ `pass:true` 收敛 | ✅ | `MAX_FIX_ROUNDS=3`；每轮附【自检状态条】与【上一轮已尝试的改动】；见 `ai/board-prompt.js` 例10 |
| 39 | 防反复横跳 / 提前收手 | 第 2 轮修正命令与第 1 轮完全相同 → 立即停止；失败项变多、连续 2 轮没减少、或达 3 轮上限 → 停止并如实显示读数 | ✅ | 修正轮过滤 `clear`/`measure`/`verify`（防误清画板、防读数堆积）；纯 `measure`（无断言）不额外消耗 LLM |

## 外接圆 / 外心（易错构造·本轮新增 2026-11-12 第三轮）

> 协议无原生外接圆 op，必须先在规划阶段算外心：直角三角形外心 = 斜边中点；一般三角形用「垂直平分线交点」法。
> 画外心点 + 一条 `circle`(center:外心, radius:外心到任一顶点距离)；末尾用 `verify` 的 `oncircle` 三顶点共圆自检（见 `ai/board-prompt.js` 例11）。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 40 | 直角三角形 A(0,0)B(4,0)C(0,3) 的外接圆 | 建三角形 → `point` O(2,1.5)（斜边 BC 中点当外心）→ `circle` cO center:O radius:2.5 → `verify` kind:oncircle of:[A/B/C,cO] expect:0 tol:0.05 ×3 | ✅ | 外心坐标必须规划阶段算好（直角用斜边中点，一般三角形用垂直平分线交点）；半径=外心到任一顶点距离；末尾 oncircle 自检算得对不对，pass:false 触发修正轮 |

## 读取画板状态（数值快照·本轮新增 2026-11-12 第四轮）

> `js/executor.js` 的 `describe()` 由 `id(类型)` 升级为**数值快照**：点/交点/中点/glider 带坐标、线/线段带端点、圆带圆心半径、多边形带顶点、函数曲线带表达式与定义域、滑动条带当前值；`ai/board-backend.js` 的 context 上限 1000→2400 防截断。AI 据此在已有图形上精确继续构造（对标大角几何 MCP 式「读画板状态后改图」），规则见 `ai/board-prompt.js` 的「读取画板状态（数值快照）」小节与例12。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 41 | 当前画板已有三角形 A(0,3) B(-2,-1) C(3,-1)，"在这个三角形上作 BC 边上的高，标出垂足" | 读快照得坐标 → **不 clear / 不重画**：`line` lBC through:[B,C] → `perpendicular` h of:lBC through:A → `intersect` H of:[h,lBC] → `segment` AH → `style` h hidden:true → `label` H → `verify` kind:angle of:[A,H,B] expect:90 tol:0.5 | ⬜ | 已有 id 不能再 `point`（会报「id 重复定义」）；关键坐标必须取自快照而非猜测 |
| 42 | 画板已有 `f1(function:"3-(x-2)^2"@[-2,6])`，"标出这条抛物线的顶点" | 按快照表达式与定义域算顶点 (2,3) → 不重画曲线：`point` V(2,3) → `verify` kind:evaluate expr:"3-(x-2)^2" x:2 expect:3；变式"把 A 往上挪 1"用 `move` id:A x:0 y:4 | ⬜ | 表达式/定义域来自 `execute()` 挂在 functiongraph 上的 `__aiExpr`/`__aiRange`；改坐标一律 `move` |

> 状态标 ⬜：命令序列已与 `js/executor.js` 协议逐条对齐，`describe()` 已用无头桩元素验证输出格式（点/线/圆/多边形/函数/滑动条 + 取值失败回退 + 60 元素上限）；浏览器侧真实 JSXGraph 元素的 `elType` / `vertices` / `Radius()` 取值仍需带浏览器环境目视确认。

## 协议扩展 TODO（不在本轮，供下一步）
- [本轮已完成] `reflect` / `rotate` / `translate`：原生几何变换 op（见用例 17/21/22 与 `js/executor.js` 的 transform 分支）。
- [本轮已完成] `animate`：自动播放参数动画命令（见用例 23 与 `js/executor.js` 的 animate 分支、`js/board.js` 的 animPlayTargets；前端复用既有滑动条动画引擎）。
- [本轮已完成] read-back 闭环：在 `js/board.js` 的 `aiSend()` 前端驱动——执行命令后收集 `measure` 的 `value`，回传给 LLM 二次核对，几何关系不符则自动补发修正命令（对标大角几何 MCP 式读画板状态后改图）。`ai/board-prompt.js` 第 4 步已约定 AI 收到【自检回读】时只输出修正命令或空 commands；`js/executor.js` 提供 `clearMeasures()` 清上一轮读数。（注：因画板实例在浏览器侧，闭环放在前端而非后端，效果等价。）
- [本轮新增] 样式与标注 few-shot 与回归用例（线型 dash / 颜色 color / 线宽 strokeWidth / 标签 label）：见用例 25/26/27 与 `ai/board-prompt.js` 例5；`js/executor.js` 的 `style` / `label` 分支已支持，本次补齐"教学示例"，让 AI 主动把成品描红、加粗、虚线化、加标签（对标大角几何"生产级成品度"）。
- [下一步·待办] 给 `style` 增加 `opacity` / `labelColor` 等细粒度样式；或把「自检点」(measure 读数) 用高亮色自动标注，进一步提升成品辨识度与"教科书图"观感。
- [本轮新增 2026-11-07] 自检回读闭环回合示例（例6 / 用例 28）：AI 收【自检回读】后只发修正命令或空 commands，把「读画板状态->改图」的 MCP 式闭环落成可照抄范式（对标大角几何强项）；下一步给 `style` 加 `opacity` / `labelColor` 细粒度样式。

- [本轮已完成 2026-11-07 第二轮] `verify` 声明式自检断言：在 `measure` 的 distance/angle/evaluate 求值之上加 `expect`+`tol`/`rtol` 或 `expectRange` 机器判定 `pass`（见用例 29、`js/executor.js` 的 verify 分支、`ai/board-prompt.js` 例7）；AI 作图末尾优先用 verify 写进预期数值。
- [本轮已完成 2026-11-07 第二轮] read-back 闭环真正落地：`js/board.js` 的 `aiSend()` 收集回读值，`verify` pass:false 时发起一次【自检回读】修正轮（不递归），并把 measure/verify/animate 从 `doc.commands` 里排除（见用例 30）。此前注释与实现不符，本轮补齐。
- [本轮已完成 2026-11-07 第二轮] `style` 细粒度样式（兑现上一条 TODO 交接项）：`opacity` / `fillOpacity` / `strokeColor` / `fillColor` / `labelColor` / `labelSize` / `labelOpacity`（见用例 31、`js/executor.js` 的 style 分支、`ai/board-prompt.js` 例8）。
- [下一步·待办] ① 多轮收敛（连续 2~3 轮 verify→修正，带上限与改动 diff，避免反复横跳）；② [本轮已完成 2026-11-12] 把 `expect` 扩展到「关系断言」（perpendicular/parallel/collinear/online/oncircle，残差≈0 复用 judgeMeasure；见用例 32~36、`js/executor.js` 的 measureValue 新分支、`ai/board-prompt.js` 例9），贴近大角几何符号自检；③ 自检状态条可视化（"已自检 2 项，✘ 1 项，已修正 1 处"）。
- [本轮已完成 2026-11-12 第二轮] 多轮收敛 + `move` 增量修正（兑现待办①③）：`js/board.js` 的 `aiSend()` 改为「修正 → `probeVerify` 静默复跑首轮 verify → 机器判定收敛」循环（`MAX_FIX_ROUNDS=3`，带上一轮改动 diff、已通过项白名单、横跳/失败项变多/连续 2 轮无改善/上限提前收手，逐轮【自检状态条】）；`js/executor.js` 新增 `move` 执行分支与 `probeVerify` 导出；见用例 37~39、`ai/board-prompt.js` 例10 与「多轮收敛」小节。
- [下一步·待办] ① 自检状态条做成 AI 面板固定 DOM 徽标（现为逐轮日志行）；② 收敛判定引入「残差改善量」而非只数失败项；③ 收敛后把 `probeVerify` 结果回画成最终 ✔ 读数。
- [本轮新增 2026-11-12 第三轮] 外接圆 / 外心 few-shot 与回归用例（易错构造补全）：协议无原生外接圆 op，本轮在「核心工作流」第 2 步明确"外接圆需先算外心坐标"，并新增 `ai/board-prompt.js` 例11（直角三角形外心=斜边中点，一般三角形用垂直平分线交点法；末尾 `verify` kind:oncircle 三顶点共圆自检，pass:false 触发修正轮）；纯提示词增量，未改 `js/executor.js` 执行分支，无 3D / editor.html 改动；见用例 40。
- [本轮新增 2026-11-12 第四轮] 读取画板状态升级为数值快照：`js/executor.js` 的 `describe()` 由 `id(类型)` 改为带出点坐标 / 线端点 / 圆心半径 / 多边形顶点 / 函数表达式与定义域 / 滑动条当前值（60 元素、2200 字符双上限），`execute()` 为 functiongraph 挂 `__aiExpr`/`__aiRange`；`ai/board-backend.js` 的 context 上限 1000→2400；`ai/board-prompt.js` 核心工作流第 1 步改用快照数值规划，新增「读取画板状态」小节与例12；见用例 41/42。纯 2D 增量，未碰 3D 分支 / `editor.html`。
- [下一步·待办·本轮之后] ① 新增 `inspect` 命令让 AI 主动查询任意元素的数值（两阶段回读：先发查询、拿到读数再构造，需 `js/board.js` 把查询读数并入 read-back 闭环）；② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；④ 收敛后把 `probeVerify` 结果回画成最终 ✔ 读数；⑤ 补中位线 / 扇形弓形 / 函数图像平移演示 few-shot。
- [本轮已完成 2026-11-13] 易错图形 few-shot 补全（落实待办⑤）：纯提示词增量，新增 `ai/board-prompt.js` 例13（中位线）、例14（扇形/弓形）、例15（函数图像平移演示）；回归用例见 43~46。全程只引用既有命令（`midpoint`/`segment`/`arc`/`slider`/`function`/`transform`/`verify`），未改 `js/executor.js` 执行分支、未碰 3D 分支 / `editor.html`。下一步回到待办①②③④（inspect 命令、自检状态条徽标、残差改善量收敛、probeVerify 回画 ✔ 读数）。
- [本轮已完成 2026-11-13 第二轮] `inspect` 主动查询命令 + 两阶段回读（落实待办①）：`js/executor.js` 新增 `inspect` 执行分支（抽出 `elementSummary(id, el)` 让 `describe()` 与查询读数共用同一格式；`inspectValue()` 支持 `id` / `ids:[]` / `ids:"__all__"`，只读注册表、不画图元/不画读数/不进文档，读数经 `execute` 的 `reading:{items,text}` 透传）；`js/board.js` 的 `aiSend()` 新增【查询读数】二次调用（只回读一轮、过滤 `clear`/`inspect`/`measure`，查询轮的 `verify` 并入 `origVerifies`/`readings` 自检闭环，`isTransient` 纳入 `inspect`）；`ai/board-prompt.js` 仅追加 2D 主干（命令清单登记、「主动查询」小节、例16），3D 分支零改动。见用例 47/48。
- [本轮已完成 2026-11-13 第三轮] 切线 few-shot（落实待办⑤ 的「切线」缺口）：协议无原生 `tangent` op，新增 `ai/board-prompt.js` 例17，给出教科书式「辅助圆法」（以 OP 为直径作辅助圆 cM 与原圆相交取切点，连切点与外点；末尾 `verify` kind:angle=90° 自检 OT⟂PT 相切）；纯提示词增量，未改 `js/executor.js` 执行分支、未碰 3D 分支 / `editor.html`。回归用例见 49。下一步回到待办①②③④，⑤ 剩下内/外接多边形、圆锥曲线第二定义、相似/位似变换。
- [下一步·待办] ① `inspect` 支持带 `x` 直接查函数值 / 两点距离等派生量；② 自检状态条做成 AI 面板固定 DOM 徽标；③ 收敛判定引入「残差改善量」；④ 收敛后把 `probeVerify` 结果回画成最终 ✔ 读数；⑤ 继续补易错图形（内/外接多边形、圆锥曲线第二定义、相似/位似变换——切线已补）。
- [本轮已完成 2026-11-14] 相似/位似变换协议（落实待办⑤ 的「相似/位似变换」缺口）：给 2D `transform` op 新增 `type=scale`（位似比 k + center，圆/多边形半径随 |k| 缩放）。`js/executor.js` 的 `transformFn` 新增 scale 分支、transform 执行分支对圆/多边形半径乘 |k|、头部协议注释登记；`ai/board-prompt.js` 在 transform 命令清单登记 scale 并新增 例19 few-shot（含 `verify` 核对位似比），顺手修了 例5 的重复注释行。只追加 2D 作图主干逻辑，未碰 3D 分支 / `editor.html` / 另一任务负责的文件。回归用例见 53。下一步：内/外接多边形、圆锥曲线第二定义（待办⑤ 余下缺口）、inspect 带 x 查派生量、自检状态条固定徽标、残差改善量收敛。

- [本轮已完成 2026-11-15 第二轮] `conic` 原生圆锥曲线命令（落实三处 TODO 一致的头号待办「圆锥曲线 / conic 协议」）：`js/executor.js` 新增模块级纯函数 `conicSpec()` + `conic` 执行分支（把第一定义 `foci+sum` / `foci+diff`、第二定义 `focus+directrix`、标准式 `center+a+b` / `vertex+p` 统一换算成参数曲线，双曲线两支以 NaN 断开）+ `elementSummary` 的 `__aiConic` 数值摘要；`ai/board-prompt.js` 仅追加 2D 主干（命令清单登记、小节、例23/例24），3D 段零改动。见用例 59~61。下一步：① 第二定义通用离心率形式（focus+directrix+eccentricity 覆盖 e<1/=1/>1）；② 自检状态条固定 DOM 徽标；③ 收敛判定引入「残差改善量」；④ 收敛后回画 `probeVerify` 最终 ✔ 读数；⑤ 其它易错图形（旋转相似、弓形面积阴影、函数图像对称演示）。
- [本轮已完成 2026-11-16 第七轮] `regularPolygon edge` 新增 `toward` 点定侧（落实连续多轮 TODO 交接项⑥ 前半）：AI 直接引用状态快照里已有的点 id，执行器按 `(A→B)×(A→T)` 叉积自动判 `left/right`，斜边上不再人工判反（MCP 式「读画板状态→继续构造」）。`js/executor.js` 的 `regularPolygonSpec` edge 分支 + 协议注释 / JSDoc + `meta.towardSide`；`ai/board-prompt.js` 命令清单登记 toward + 新小节 + 例30 few-shot；`tests/board2d_regularPolygon_spec.mjs` section I（19 项断言，共 78/78）；见用例 74/75。下一步：① `conicSpec` 补入库无头单测（第一定义 foci+sum / 第二定义 focus+directrix+e / 三分支离心率）；② 自检状态条固定 DOM 徽标；③ 收敛判定引入「残差改善量」；④ 其它易错图形（弓形面积阴影、旋转相似）；⑤ `edge` 的「显式边心距」语义（边长 s 与 n 已唯一确定 a=s/(2tan(180°/n))，显式给 a 与「AB 是一条边」冲突，宜另立定义而非塞进 edge）。

## 易错图形补充：中位线 / 扇形弓形 / 函数图像平移（本轮新增 2026-11-13）

> 落实上一轮 TODO 交接项⑤：补「易错图形 few-shot」覆盖缺口。这些图形都能用协议已有命令
> （`midpoint`/`segment`/`arc`/`slider`/`function`/`transform`/`verify`）直接拼出，但此前 AI 没有可照抄的范式，
> 容易拼错（中位线错连成中线、扇形漏两条半径、平移演示用多张静态图替代滑动条）。纯提示词增量，
> 未改 `js/executor.js` 执行分支、未碰 3D 分支 / `editor.html`；few-shot 见 `ai/board-prompt.js` 例13~15。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 43 | 三角形 ABC 的中位线（连 AB、AC 中点） | 建三角形 → `midpoint` M of:[A,B]、N of:[A,C] → `segment` MN → `verify` kind:parallel of:[M,N,B,C] expect:0（MN∥BC）→ `verify` kind:distance of:[M,N] expect:4（=½\|BC\|） | ✅ | 中位线是「两邻边中点连线」≠「顶点到对边中点的中线」；别把 M/N 取成 BC 中点 |
| 44 | 圆心原点、半径 3、第一象限 1/4 扇形 | `circle` c1 center:O r:3 → `point` P1(3,0) P2(0,3) → `arc` secArc center:O from:P1 to:P2 → `segment` r1 O→P1、r2 O→P2 → `verify` oncircle of:[P1/P2,c1] | ✅ | 扇形 = 圆弧 + 两条半径；别只画弧漏半径；arc 的 from/to 必须是圆上点 |
| 45 | 弓形（弧 + 弦，不要半径） | 同用例 44 的 `arc` → 只连 `segment` chord from:P1 to:P2（不要两条半径） | ✅ | 弓形 = 弧 + 弦，扇形 = 弧 + 两半径；别把弓形画成整圆或多画半径 |
| 46 | 画 y=x² 并动画演示向右平移 | `slider` t → `function` f1 expr:"(x-t)^2" → `animate` ids:["t"] pingpong:true speed:normal → `verify` evaluate expr:"(x-t)^2" x:0 expect:0 | ✅ | 平移演示一律用「滑动条 + 参数化表达式」，勿用多张静态图替代；`transform` by 是静态偏移、不能由滑动条驱动，故此处不用 transform |

## 切线（辅助圆法）（本轮新增 2026-11-13 第三轮）

> 落实上一轮 TODO 交接项⑤ 的「切线」缺口：协议无原生 `tangent` op，AI 容易硬猜切点坐标、或把切线画成
> "过圆上某点的普通直线"。教科书式「辅助圆法」：以 OP 为直径作辅助圆 cM（圆心 M=OP 中点、半径 |OP|/2），
> 据泰勒斯定理它与原圆 c1 的两交点即切点（∠OTP=90° ⇒ OT⟂PT），连 PT 即得切线。全程只用既有命令
> （`point`/`circle`/`line`/`intersect`/`verify`），切点交给 `intersect` 的 `select` 取上/下，
> 末尾用 `verify` kind:angle=90° 自检 OT⟂PT（等价于相切）。纯提示词增量，未改 `js/executor.js` 执行分支、
> 未碰 3D 分支 / `editor.html`；few-shot 见 `ai/board-prompt.js` 例17。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 49 | 过圆外一点 P(7,0) 作圆 O(0,0) r=3 的两条切线 | 建圆 → `point` M(3.5,0)（OP 中点）→ `circle` cM center:M r:3.5（以 OP 为直径）→ `intersect` T1 of:[c1,cM] select:top、T2 select:bottom → `line` tg1 through:[P,T1]、tg2 through:[P,T2] → `verify` kind:angle of:[O,T1,P] expect:90 tol:0.5（OT⟂PT 即相切）×2 → `verify` oncircle of:[T1,c1] | ✅ | 无原生 tangent op：用「辅助圆 cM」求切点，别硬猜坐标；两交点用不同 `select`（top/bottom）分开取；末尾用 angle=90° 自检相切，pass:false 触发修正轮；P 在圆上则切线唯一、在圆内则无切线（勿硬画） |

## 主动查询（inspect · 两阶段回读）（本轮新增 2026-11-13 第二轮）

> 落实上一轮 TODO 交接项①：此前 AI 只能读「作图前」的状态快照，无法在同一轮里读取刚构造出的
> 派生对象（交点/中点/圆半径/滑动条当前值）的精确数值，继续构造只能猜坐标。`inspect` 让 AI
> 首轮先发查询，系统把读数以【查询读数】回填，AI 第二轮基于精确数值再构造（对标大角几何 MCP 式
> 「读画板状态 → 再构造」）。`inspect` 只读：不画图元、不画读数、不进 `doc.commands`、重放不重复查询；
> 查询只回读一轮（第二轮禁止再发 `inspect`/`measure`/`clear`），不会与自检闭环互相递归。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 47 | 画三角形 ABC 并作 BC 边上的高，再以垂足 H 为圆心、AH 的一半为半径画圆（H 是本轮才产生的交点，快照里没有） | **第 1 轮**：point A/B/C → `line` lBC → `perpendicular` h → `intersect` H of:[h,lBC] select:top → `inspect` ids:["H","A"]（**不写 circle**）→ 系统回【查询读数】H(intersection@(0,-1)), A(point@(0,3))；**第 2 轮**：`circle` cH center:H radius:2 → `verify` kind:distance of:["A","H"] expect:4 tol:0.05 | ✅ | 第 1 轮不要写依赖未知数值的命令；第 2 轮不要再发 `inspect`/`measure`/`clear`、不要重画三角形；读数格式与状态快照一致；半径由读数算出（AH=4→r=2） |
| 48 | 查询已有元素数值：`inspect` 单 id / 多 id / `__all__` / 未知 id；确认只读不落文档 | `{"op":"inspect","id":"H"}` → reading.text="H(intersection@(0,-1))"；`{"op":"inspect","ids":["A","c1","a"]}` → 分别回点坐标/圆心半径/滑动条值；`{"op":"inspect","ids":"__all__"}` 与 `describe()` 等价；不写 id 默认查全部；`{"op":"inspect","id":"ghost"}` → "ghost(不存在)" 且 `ok:true`；执行后 `registry.size` 不变、`board.create` 调用数为 0、`describe()` 不变 | ✅ | `inspect` 的 `id` 是**查询目标**不是新建图元 id，执行器必须在 `registry.set` 之前 `continue`；未知 id 不得整批失败；`isTransient` 必须含 `inspect`，否则重放会重复查询 |

> 状态 ✅：`js/executor.js` 已用无头桩元素回归 26/26（含 `describe()` 改动前后逐字节一致、`inspect` 各形态、
> 与 `point`/`verify`/`probeVerify` 共存、空画板/未知 id）；`js/board.js` 的【查询读数】二次调用链路
> 需在带浏览器 + LLM 环境目视确认（沙箱无法实例化真实 JSXGraph / 调 LLM）。

## 派生量查询（inspect · derive）（本轮新增 2026-11-13 第四轮）

> 落实连续两轮 TODO 交接项①：此前 `inspect` 只能回读元素的原始坐标 / 半径 / 定义域，AI 想用
> 「两点距离 / 三点夹角 / 某点函数值 / 点到线距离」规划下一步构造时仍要心算或猜数（大角几何靠符号计算
> 直接给出）。本轮让 `inspect` 在元素摘要之外，按 `measureValue` 同一套求值回读派生量（8 种 kind 全复用），
> 读数经既有【查询读数】两阶段回读链路透传，`js/board.js` 零改动；纯查派生量时不再默认列出全部元素。
> 三种写法：顶层 `kind` 简写、`derive` 数组批量、`id` + `x`/`xs` 查已注册函数值；单条失败宽容降级。
> few-shot 见 `ai/board-prompt.js` 例18。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 50 | 查询派生量：两点距离、三点夹角、表达式取值、关系残差，支持顶层简写与 `derive` 批量 | `{"op":"inspect","kind":"distance","of":["A","H"]}` → 回 ``\|AH\|=4.000``；`{"op":"inspect","kind":"angle","of":["A","H","B"]}` → `∠AHB=90.0°`；`{"op":"inspect","kind":"evaluate","expr":"x^2-4","x":2}` → `evaluate(x^2-4,x=2)=0.000`；`{"op":"inspect","derive":[{"kind":"distance","of":["A","H"]},{"kind":"online","of":["H","lBC"]}]}` → 两条读数；`label:"高 AH"` → `高 AH=4.000` | ✅ | 纯查派生量（未给 `id`/`ids`）时 `items` 不含全部元素，避免读数噪音；`kind` 与 `measure`/`verify` 同源，读数口径一致；坏一条只回 `xxx(?)`，不得整批失败 |
| 51 | 带 `x` 直接查已注册函数值（含批量 `xs` 与异常降级） | `{"op":"inspect","id":"f1","x":2}` → 元素摘要 `f1(function:"x^2-4"@[-5,5])` + `f1(2)=0.000`；`{"op":"inspect","id":"f1","xs":[-2,0,2]}` → `f1(-2)=0.000, f1(0)=-4.000, f1(2)=0.000`；`{"op":"inspect","id":"ghost","x":2}` → `ghost(不存在)` + `ghost(2)=?无函数表达式`；`{"op":"inspect","id":"f1","x":"abc"}` → `f1(x=?)` | ✅ | `x`/`xs` 只在 `id`（或 `target`）是**单个**已注册函数 id 时生效；表达式含滑动条变量时由引擎取当前值；非法 x / 非函数元素必须宽容降级，不能抛错 |
| 52 | 两阶段回读完整回合：先查派生量，再用读数算半径继续构造（例18） | **第 1 轮**：`point` A(0,3)/B(-2,-1)/C(3,-1) → `polygon` → `line` lBC → `perpendicular` h → `intersect` H select:top → `function` f1 `x^2-4` → `inspect` ids:["H"] + `derive` [高 AH / ∠AHB / online(H,lBC)] → `inspect` id:"f1" xs:[0,2]（**不写 circle**）；系统回【查询读数】合并两条读数；**第 2 轮**：`circle` cH center:H radius:2 → `verify` distance(A,H)=4 → `verify` angle(A,H,B)=90 | ✅ | 第 1 轮不能写依赖未知半径的 `circle`；第 2 轮禁止再发 `inspect`/`measure`/`clear`、不重画三角形；半径必须落成数字 `2`，不能写 `4/2` 表达式；同一轮允许多条 `inspect`，读数合并回传；`isTransient` 已含 `inspect`，重放不重复查询 |

> 状态 ✅：`js/executor.js` 的 `inspectValue` 派生量分支已用无头桩元素回归（旧形态输出逐字节不变、
> 8 种 kind 求值、单条失败降级、`x`/`xs` 异常、纯派生量不列全元素、只读不进 `registry`）。
> 前端【查询读数】二次调用链路仍需在带浏览器 + LLM 环境目视确认（与用例 47/48 同理）。


## 内接 / 外切正多边形（本轮新增 2026-11-14 第二轮）

> 落实上一轮 TODO 交接项①：协议无原生「正多边形」op，AI 之前容易插值/猜点导致顶点不在圆上，
> 或把外切顶点直接放 (±R,±R) 而非距圆心 R/cos(180°/n) 处。本轮新增 例20 few-shot（纯提示词增量，
> 未触碰 `js/executor.js` 执行分支、未碰 3D 分支 / `editor.html`），给出「算顶点数值 → polygon 连点 →
> verify 自检」范式：内接顶点用 (R·cosθk, R·sinθk)，外切顶点到圆心 = R/cos(180°/n)。回归用例 54。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 54 | 画圆 O(0,0) R=2，再画内接正六边形与外切正方形；自检共圆/相切 | `point` O(0,0) → `circle` c1 R=2；**内接正六边形** `point` A(2,0)/B(1,1.732)/C(-1,1.732)/D(-2,0)/E(-1,-1.732)/F(1,-1.732) → `polygon` hex；**外切正方形** `point` P1(2,2)/P2(-2,2)/P3(-2,-2)/P4(2,-2) → `polygon` sq（顶点到圆心 2√2≈2.828）；`verify` oncircle(A,c1)=0、oncircle(F,c1)=0、`verify` distance(O,P1)=2.828 tol:0.05 | ⬜ | 顶点坐标是算出数字不要写表达式/插值；内接顶点在圆上、外切顶点距圆心 R/cos(180°/n)（正方形 R√2、正三角 2R），别把外切顶点放错；末尾用 oncircle 核内接共圆、distance 核外切半径，见 `ai/board-prompt.js` 例20 |

## 符号化简 / 顶点式配方（inspect kind:vertex，本轮新增 2026-11-14 第三轮）

> 落实 TODO 交接项④「派生量支持符号化简」：对标大角几何的符号计算能力，AI 不必心算配方。
> `js/executor.js` 新增 `quadraticCoeffs(expr)`（三点求值反推 a,b,c + 第四点校验确为二次式）
> 与 `vertexReading(d)`，`inspect` 派生量新增 `kind:"vertex"`，回读配方文本 / 顶点 / 对称轴 / 最值；
> 读数仍走既有【查询读数】两阶段回读（`js/board.js` 零改动）。few-shot 见 `ai/board-prompt.js` 例21。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 55 | 配方读数：查已注册函数 / 直接给表达式 / 批量混查 / 异常降级 | `function` f1 `x^2-4*x+1` → `{"op":"inspect","kind":"vertex","id":"f1"}` → 回 `vertex(f1:"x^2-4*x+1"): y=(x-2)^2-3; 顶点(2,-3); 轴 x=2; 最小值-3; a=1`；`{"op":"inspect","kind":"vertex","expr":"2*x^2+8*x+3"}` → `y=2(x+2)^2-5; 顶点(-2,-5)`；`(x-2)^2-3` 展开式同样能配方；`{"op":"inspect","kind":"vertex","expr":"x^2-4x+1"}` 省略乘号也回同一配方（执行器补齐隐式乘）；`{"op":"inspect","derive":[{"kind":"vertex","of":["f1"]},{"kind":"distance","of":["A","B"]}]}` 与数值派生量混查；`expr:"x^3+1"` → `?非二次多项式`；无 expr/id → `?无函数表达式` | ✅ | 三点采样 + 第 4 点校验才认定二次式，避免 x³ / sin 被误判；只读、不进 `registry`、不画读数；既有 8 种 kind 输出逐字节不变；`vertex` 是 inspect 专用，measure/verify 不认 |
| 56 | 两阶段回读完整回合：先查配方，再落点画轴并 verify（例21） | **第 1 轮**：`function` f1 `x^2-4*x+1` from:-3 to:6 → `inspect` kind:vertex id:f1（**不写 point/line**）；系统回【查询读数】带 `顶点(2,-3); 轴 x=2`；**第 2 轮**：`point` V(2,-3) → `label` → `point` S1(2,-5)/S2(2,4) → `line` axis through:[S1,S2] → `style` dash:2 → `verify` evaluate(x=2) expect:-3、`verify` evaluate(x=1) expect:-2、`verify` evaluate(x=3) expect:-2（tol:0.001） | ⬜ | 顶点别抄成 (-2,-3)/(2,3)；轴要先建两个点再 `line through`（不能裸坐标）；第 2 轮禁止再发 `inspect`/`measure`/`clear`、不重画 f1；读数落成数字不要写表达式 |

> 状态：用例 55 已用无头桩回归 17/17 全通过（配方系数 / 隐式乘与因式连乘 / 负首项 / 异常降级 /
> 既有 8 种 kind 与旧 x/xs 形态输出不变 / 只读 / 例21 三条 verify 全 pass）；用例 56 的两阶段回读链路
> 需在带浏览器 + LLM 环境目视确认（与用例 47/48 同理）。表达式含滑动条变量时依赖引擎取当前值。

## 相似三角形（平行线截取法，本轮新增 2026-11-15）

> 落实上一轮 TODO 交接项⑤「继续补易错图形」：协议无原生「相似三角形」op，AI 之前容易把小三角形画成和原三角形
> 一样大（混淆相似与全等）或逐点手算缩放坐标。本轮新增 例22 few-shot（纯提示词增量，未触碰 `js/executor.js`
> 执行分支、未碰 3D 分支 / `editor.html`），给出「在 AB 上取定比分点 D → 过 D 作 BC 的平行线交 AC 于 E →
> △ADE∽△ABC（AA）」教科书范式；末尾用 `verify` 关系断言 parallel(DE,BC)/online(D,AB)/online(E,AC) 证明相似、
> 用 distance 核相似比（AD=3=½AB、DE=√8≈2.828=½BC）。若题目给定位似中心则改用 例19 的 transform type=scale。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 57 | △ABC（A(0,0)B(6,0)C(2,4)）作相似比 1/2 的相似三角形（平行线截取法，不用位似中心） | `point` A/B/C → `polygon` tri → `midpoint` D of:[A,B]（D(3,0)，AD/AB=1/2）→ `line` lBC through:[B,C] → `parallel` lDE of:lBC through:D → `line` lAC through:[A,C] → `intersect` E of:[lDE,lAC] → `polygon` tri2 [A,D,E]；`verify` parallel(D,E,B,C)=0、`verify` online(D,A,B)=0、`verify` online(E,A,C)=0、`verify` distance(A,D)=3、`verify` distance(D,E)=2.828 tol:0.05 | ⬜ | 相似≠全等：小三角形必须比原三角形小，相似比由分点 D 位置决定（取中点=1/2）；用平行线法靠 DE∥BC 自动保证 AA 相似，别逐点手算缩放坐标；若给定位似中心改用 例19 的 transform type=scale；见 `ai/board-prompt.js` 例22 |
| 58 | 相似三角形自检：证明相似并核相似比 | 在用例 57 命令之后追加 `verify` kind:parallel of:[D,E,B,C] expect:0（DE∥BC 是相似核心条件）、`verify` kind:online of:[D,A,B]/[E,A,C] expect:0（D/E 分别在 AB/AC 上）、`verify` kind:distance of:[A,D] expect:3 与 of:[D,E] expect:2.828（核 AD=½AB、DE=½BC） | ⬜ | 关系断言 parallel/online 残差夹容差内即 pass:true，比"量两组对应角相等"更直接；distance 期望用算出数字（AD=3、DE=√8≈2.828），不要写表达式；pass:false 触发自动修正轮 |

## 圆锥曲线（conic 原生命令，本轮新增 2026-11-15 第二轮）

> 落实三处 TODO 一致的头号待办「圆锥曲线 / conic 协议」。此前画椭圆 / 双曲线 / 抛物线只能让 AI
> 手算 a,b,c 再拼两条 `function`（定义域截断、上下半支拼接、焦点方向都易错），或逐点插值猜坐标。
> 本轮 `js/executor.js` 新增纯函数 `conicSpec()` 与 `conic` 执行分支，把数学定义统一换算成参数曲线
> （双曲线两支以 NaN 断开）；`__aiConic` 让 `describe()` / `inspect` 回读类型与 a/b/p/中心。
> 配套 `ai/board-prompt.js` 命令清单 +「圆锥曲线」小节 + 例23 / 例24 few-shot。纯 2D 增量，
> 3D 分支 / `editor.html` / `appId` / `js/board.js` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 59 | 椭圆第一定义：焦点 F1(-3,0)、F2(3,0)，点到两焦点距离之和 = 10 | `point` F1/F2 → `conic` e1 type:ellipse foci:[F1,F2] sum:10（执行器求 a=5,c=3,b=4）→ `point` P(5,0) → `style` e1 → `verify` distance(F1,F2)=6、`verify` distance(P,F1)=8、`verify` distance(P,F2)=2（8+2=10=sum） | ✅ | sum 是距离之和 =2a（不是 a），必须 sum > 焦距；foci 用已建点 id（先创建后引用），sum 写数字不写表达式；别手算 a/b/c 拼两条 `function`；焦点倾斜时执行器自动旋转，别自己算角度；见 `ai/board-prompt.js` 例23 |
| 60 | 抛物线第二定义：焦点 F(2,0)、准线 x=-2 | `point` F/D1(-2,-5)/D2(-2,5) → `line` d through:[D1,D2] → `conic` p1 type:parabola focus:F directrix:d（顶点(0,0)、p=2、y²=8x）→ `point` Q(2,4) → `verify` distance(Q,F)=4（= Q 到准线距离）、`verify` evaluate(8*x, x=2)=16 | ✅ | directrix 必须是已定义的 `line`/`segment` id，不能裸坐标；开口自动朝焦点，不用写方向；别手算 p 拼 y²=8x；见 例24 |
| 61 | 双曲线标准式、参数校验与状态回读 | `conic` h1 type:hyperbola center:[0,0] a:3 b:2（x²/9−y²/4=1，两支自动断开）→ `verify` evaluate("4*(x^2/9-1)", x=5)=7.111 tol:0.01；`conic` e2 type:ellipse center:[0,0] a:5 b:3 rotate:30；`inspect` id:h1 → 回 `conic:hyperbola@standard,中心(0,0),a=3,b=2`；非法参数（`sum`≤焦距 / `diff`≥焦距 / `a`≤0 / 未知 type）一律 `ok:false` 且不注册 | ✅ | 双曲线两支别拆成两条命令或两条 `function`（执行器以 NaN 断开）；标准式 a/b 写正数、不写表达式；`rotate` 是角度（度）；`conic` 是普通图元，可 `style`/`label`/被 `intersect` 引用、进 `doc.commands`；中文 type（椭圆/双曲线/抛物线）同样可用 |

> 状态 ✅：`conicSpec()` 与 `conic` 执行分支已用无头桩回归 **355/355** 全通过：三类定义的采样点
> 满足 |PF1|+|PF2|=sum（含倾斜椭圆）/ |PF1|−|PF2|=±diff / |PF|=点到准线距离 / 标准方程（含 rotate），
> 双曲线 NaN 断点与左右两支齐全、非法参数抛错且不进注册表、例23/例24 的 6 条 `verify` 全 pass、
> `describe()`/`inspect` 回读 `conic:...` 摘要、`style` 生效；既有 `point`/`function`/`verify`/
> `inspect`/`measure`/`move`/`style` 命令结果与 `describe()` 输出与改动前**逐项、逐字节一致**。
> 真实 JSXGraph `curve` 渲染与浏览器侧目视确认仍需带浏览器环境（见「已知限制」）。

## 圆锥曲线通用第二定义（焦点+准线+离心率 e，本轮新增 2026-11-15 第三轮）

> 落实连续多轮 TODO 交接项①「第二定义通用离心率形式」。此前 `conic` 的第二定义只覆盖抛物线
> （焦点 + 准线，隐含 e=1），要画"给定离心率的椭圆/双曲线"只能手算 a/b/c 再走第一定义或标准式。
> 本轮 `conicSpec()` 新增通用分支 `{focus, directrix, eccentricity}`（别名 `ecc`/`e`），按统一定义
> `|PF| = e·dist(P,准线)` 换算中心/a/b/c，e<1 椭圆 / e=1 抛物线 / e>1 双曲线一条命令覆盖，
> 类型可省略由 e 自动决定。配套 `ai/board-prompt.js` 命令清单 +「圆锥曲线」小节 + 例25，
> `js/executor.js` 的 `conicSpec` eccentricity 分支。纯 2D 增量，3D 分支 / `editor.html` / `appId` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 62 | 通用第二定义·椭圆：焦点 F(1,0)、准线 x=4、e=0.5 | `point` F/D1/D2 → `line` d through:[D1,D2] → `conic` cE focus:F directrix:d eccentricity:0.5（type 省略→椭圆，中心(0,0)、a=2、b=√3）→ `point` P(2,0)/T(4,0) → `verify` distance(P,F)=1、`verify` distance(P,T)=2（0.5×2=1=\|PF\|） | ✅ | e<1→椭圆由 e 自动判、type 可省略；焦点/准线先建后引用；e 写正数不写表达式；verify 期望写算好的数字（1/2）；别手算 a/b/c 拼两条 `function`；见 `ai/board-prompt.js` 例25 |
| 63 | 通用第二定义·双曲线与抛物线（同焦点准线、不同 e） | 沿用例 62 的 F/d → `conic` cH focus:F directrix:d ecc:2（别名 ecc，e>1→双曲线，两支自动断开）→ `conic` cP focus:F directrix:d e:1（别名 e，e=1→抛物线，与旧 focus+directrix 逐点一致） | ✅ | eccentricity/ecc/e 三写法等价、必须为正；双曲线两支由执行器 NaN 断开别拆两条；e=1 结果与旧 `focus+directrix` 分支逐字节一致（415 项无头回归含此项） |
| 64 | 离心率分支的非法参数校验与状态回读 | `conic` e≤0 / e 非数 → 抛错不注册；焦点落准线上、准线两端点重合 → 抛错不注册；合法 e=0.5 的 `inspect` id:cE → 回 `conic:ellipse@focus+directrix+eccentricity,中心(0,0),a=2,b=1.732` | ✅ | e 必须是正数（0/负/非数一律拒绝）；焦点不能在准线上、准线端点不能重合；`__aiConic.meta` 携带 definition/eccentricity/中心/a/b/c 供内部继续构造，`elementSummary` 回读中心/a/b（与既有 conic 摘要格式一致，不额外回 c/e）；倾斜准线同样按统一定义换算（无头回归已含 x+y=3 倾斜用例） |

> 状态 ✅：`conicSpec` eccentricity 分支已用无头桩回归 **415/415** 全通过：e<1 椭圆（含倾斜准线）、
> e=1 抛物线（与旧 `focus+directrix` 采样逐点一致）、e>1 双曲线（左右两支齐全、NaN 断点）、
> 三种别名、`__aiConic.meta` 回读、非法参数抛错，以及旧 `foci+sum` / `foci+diff` / 标准式分支
> 与改动前逐字节一致。真实 JSXGraph `curve` 渲染仍需带浏览器环境目视确认（见「已知限制」）。

## 正多边形（regularPolygon 原生命令，本轮新增 2026-11-15 第四轮）

> 落实上一轮 TODO 交接项④「其它易错图形」里最该由执行器兜底的一项。此前用例 54 / `ai/board-prompt.js` 例20
> 只能教 AI 手算 `cos(2πk/n)` 逐个 `point`：`1.732` 抄成 `1.73`、内接/外切半径混淆、外切顶点放错到半径 `R`
> 而非 `R/cos(180°/n)`，导致用例 54 至今仍是 ⬜ 待验证。本轮把三角换算收进执行器（对标大角几何
> 「自研数学 DSL / 符号计算」）：AI 只给语义参数，`regularPolygonSpec()` 精确算 n 个顶点并落成
> 「n 个可引用 `point` + 1 个 `polygon`」。配套 `ai/board-prompt.js` 命令清单 +「正多边形」小节 +
> 例26 / 例27，`js/executor.js` 的 `regularPolygonSpec` 纯函数 + 执行分支 + `__aiRegular` 数值快照 +
> `remove()` 派生顶点联动。纯 2D 增量，3D 分支 / `editor.html` / `appId` / `js/board.js` 零改动。
> **用例 54 的旧手算范式保留作对照，新作图一律优先用 `regularPolygon`。**

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 65 | 以 O(0,0) 为圆心、半径 2 画内接正六边形并标出顶点 | `point` O(0,0) fixed:true → `circle` c1 center:O radius:2 → `regularPolygon` hex center:O radius:2 sides:6 vertexIds:[A,B,C,D,E,F]（执行器算 A(2,0)、B(1,1.732)、C(-1,1.732)、D(-2,0)、E(-1,-1.732)、F(1,-1.732)）→ `verify` oncircle(A,c1)=0 / oncircle(D,c1)=0 / distance(A,B)=2 | ✅ | 一条命令画一圈，别逐个 `point` 手算 1.732；`vertexIds` 长度必须=6、互不重复；省略则自动 `hex1..hex6`；顶点是可引用 `point`，可直接 `oncircle`/`distance`/`segment`/`midpoint`；正 n 边形边长 = 2R·sin(180°/n)，正六边形即 R；见 `ai/board-prompt.js` 例26 |
| 66 | 读已画圆 c1 画它的外切正方形并验证相切 | 沿用例 65 的 c1 → `regularPolygon` sq circle:"c1" sides:4 mode:"circumscribed" vertexIds:[P1,P2,P3,P4]（顶点 (2,2)/(-2,2)/(-2,-2)/(2,-2)，到圆心 2√2≈2.828）→ `verify` distance(O,P1)=2.828 tol:0.05 | ✅ | `circle:"c1"` 直接读已画圆的圆心+半径（MCP 式读画板状态，先创建后引用），不用再抄 center/radius；外切顶点到圆心 = R/cos(180°/n)（正方形 R√2、正三角 2R），别放错到 R；`mode` 也认中文「外切」；边中点(切点)到圆心 = R；见 例26 |
| 67 | 以 A(2,0) 为首顶点画正三角形；再画旋转 90° 的内接正八边形 | `point` O / `point` A(2,0) → `regularPolygon` tri center:O vertex:"A" sides:3 vertexIds:[T1,T2,T3]（首顶点正好落在 A，半径 2、起始角 0°）→ `regularPolygon` oct center:O radius:2 sides:8 rotate:90 → `verify` distance(O,T1)=2 / distance(T1,T2)=3.464 tol:0.05 | ✅ | `radius`/`circle`/`vertex` 一次只给一种别混写；`vertex:"A"` 起始角由 A 定，不要再叠 `rotate`；`rotate` 是度、写数字；正三角形边长 2R·sin60°=2√3≈3.464；`sides` 必须 3~24 的整数（别名 `n`），3.5 之类整条失败；见 例27 |
| 68 | 用滑动条 r 驱动正五边形大小并自动播放 | `slider` r min:0.5 max:4 value:2 step:0.1 → `regularPolygon` pent center:O radius:"r" sides:5 vertexIds:[Q1..Q5] → `animate` id:"r" pingpong:true speed:"normal" | ✅ | `radius:"r"` 填滑动条 id 字符串（不是数字），`slider` 必须先建、`animate` 最后发；拖条时 5 个顶点坐标写成函数实时重算，整块正多边形跟着缩放（与 `point` 的 x:"a" 同一套联动）；`center` 填点 id 时拖中心点也会带动整块；顶点 `fixed:true` 不可单独拖（拖一个就不再「正」）；见 例27 |
| 69 | 非法参数校验、状态回读与删除联动 | `regularPolygon` sides:2 / 25 / 3.5 / radius:-1 / 缺 radius / mode:wat / circle 不存在 / vertex 与 center 重合 / vertexIds 长度不符或重复或与主 id 同名 → 一律 `ok:false` 且**不注册任何元素**；合法命令的 `inspect` id:hex 回 `regularPolygon:inscribed@n=6,中心(0,0),R=2,旋转0°,顶点[hex1 …]`；`remove("hex")` 连带清掉 6 个派生顶点、不影响 O/c1 | ✅ | 顶点 id 冲突整条失败且**不覆盖**已有对象（幂等）；`center`/`circle`/`vertex`/滑动条 id 都遵守先创建后引用；`describe()`/`inspect` 数值快照口径一致；删主图元不留孤儿点；非法参数由 `regularPolygonSpec` 抛错，不产生半套图形 |

> 状态 ✅：`regularPolygonSpec()` 与执行分支已用无头桩回归 **59/59** 全通过：
> 内接六顶点全部落在 R=2 圆上、六边相等且边长=2；外切正方形四顶点与用例 54 / 例20 的
> (2,2)/(-2,2)/(-2,-2)/(2,-2) **逐点一致**、四条边中点(切点)到圆心=R；`circle`/`vertex`/滑动条/
> `rotate`/`vertexIds`/中文别名 6 类参数形式与 12 类非法参数抛错；`createExecutor` 桩件下
> 主图元 + 6 顶点注册、`__aiRegular` 元数据、`describe()` 快照、`verify oncircle` 判定、删除联动、
> 顶点 id 冲突不覆盖；既有 `point`/`polygon`/`function`/`style`/`move`/`verify` 命令结果、
> `describe()` 输出与改动前**逐项一致**。真实 JSXGraph 渲染与拖动联动仍需带浏览器环境目视确认
> （见「已知限制」）。

## 函数图像对称演示（本轮新增 2026-11-16 第四轮）

> 落实连续多轮 TODO 交接项④「其它易错图形」——函数图像对称演示（与用例 46 / `ai/board-prompt.js` 例15
> 的「平移演示」成姊妹篇）。纯提示词增量：AI 之前容易把"沿 y 轴翻折"做成两张静态 `function` 或
> `transform reflect` 静态副本（不能参数化联动），或把"关于 y 轴对称 f(-x)"误写成"-f(x)"（那是关于 x 轴）。
> 本轮新增 `ai/board-prompt.js` 例28，给出「滑动条 t 参数化 m=1-2t、expr:"(m*x)^2" 连续翻折 + animate」范式；
> 全程复用既有 `slider`/`function`/`animate`/`verify`，未触碰 `js/executor.js` 执行分支，
> 3D 分支 / `editor.html` / `appId` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 70 | 画 y=x²，动画演示它沿 y 轴翻折（关于 y 轴对称）的连续过程 | `slider` t min:0 max:1 value:0 step:0.01 → `function` f1 expr:"((1-2*t)*x)^2" from:-5 to:5（水平缩放因子 m=1-2t，t:0→1 从原图经压扁到关于 y 轴的镜像）→ `animate` ids:[t] pingpong:true → `verify` evaluate "((1-2*t)*x)^2" x:2 expect:4 rtol:0.01（t=0 基准 f(2)=4） | ✅ | 对称演示用「滑动条 + 参数化表达式」+ `animate`，别用两张静态 `function` 或 `transform reflect` 静态副本（不能实时联动）；关于 y 轴是 f(-x)（换 x 符号），别写成 -f(x)（那是关于 x 轴）；插值用 m=1-2t 而非 -t（后者起点 m=0 直接压扁、缺原图）；关于 x 轴写 -f(x)、原点写 -f(-x)；`slider` 先建后引用、含变量的 verify 需浏览器环境确认；见 `ai/board-prompt.js` 例28 |

## 正多边形·给定一条边（regularPolygon edge:[A,B]，本轮新增 2026-11-16 第五轮）

> 落实连续多轮 TODO 交接项⑤「正多边形支持给定一条边的两个顶点定半径与朝向」。此前 AI 遇到
> 「已知一条边 AB，补全正 n 边形」只能手算 `s/(2sin(180°/n))` 逐个 `point`，或用
> 「垂直平分线 + 辅助圆 + `intersect`」凑中心，既违背「坐标数值化 / 把符号计算交给执行器」，
> 又容易把中心放错边的一侧。本轮给 `regularPolygon` 新增 `edge:[A,B]` 写法（对标大角几何
> 自研数学 DSL）：执行器由边长精确算 边心距 `a=s/(2tan(180°/n))`、顶点半径 `s/(2sin(180°/n))`，
> 中心落在 AB 中垂线距边 a 处，`side:left/right` 选侧，第 0 个顶点正好落在 A 上。
> 配套 `ai/board-prompt.js` 命令清单 +「正多边形·给定一条边」小节 + 例29，
> `js/executor.js` 的 `regularPolygonSpec` edge 分支 + 协议注释 + 执行分支注释。
> 纯 2D 增量，3D 分支 / `editor.html` / `appId` / `js/board.js` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 71 | 已知 A(-1,0)、B(1,0)，以 AB 为一条边在上方补全正六边形并验证边长 | `point` A(-1,0) / B(1,0) → `segment` ab → `regularPolygon` hex edge:["A","B"] sides:6 side:"left" vertexIds:[V0..V5]（执行器算 边心距 √3≈1.732、顶点半径 2、中心(0,√3)，V0=A、V1=B）→ `verify` distance(A,V0)=0 / distance(B,V1)=0 / distance(V0,V1)=2 / distance(V2,V3)=2 | ✅ | 一条 `edge` 命令画一圈，别逐个 `point` 手算 1.732、更别用垂直平分线+辅助圆凑中心；`edge` 两端点是已建点 id（先创建后引用），也可写 `[[-1,0],[1,0]]`；默认 `side:"left"` 是 A→B 的逆时针一侧（A→B 向右即「上方」）；`edge` 与 `center`/`radius`/`circle`/`vertex`/`rotate` **互斥**，混用整条失败；`vertexIds` 长度=6、省略则 `hex1..hex6`；见 `ai/board-prompt.js` 例29 |
| 72 | 给定边画正方形 / 翻到另一侧 / 外切模式 / 非法参数与状态回读 | `point` A2(0,0) / B2(2,0) → `regularPolygon` sq edge:["A2","B2"] sides:4（中心(1,1)、顶点 (0,0)/(2,0)/(2,2)/(0,2)、边长 2）→ `regularPolygon` sqR edge:["A2","B2"] sides:4 side:"right"（或中文「右」/ `flip:true`，中心(1,-1)）→ `regularPolygon` sqC edge:["A2","B2"] sides:4 mode:"circumscribed" side:"right"（中心(1,-1)、radius=1=边心距、顶点半径 √2、边中点(切点)到中心=1）→ `verify` distance(A2,sq1)=0 / distance(sq1,sq2)=2 / distance(A2,sqC1)=0 | ✅ | `side:left` 默认可省，`side:"right"`/`flip:true`/中文「右」等价（同一条边、同一组顶点集合，只是绕行方向不同，B 变成最后一个顶点）；外切时 radius 回读**内切圆半径(边心距)**而非外接圆半径，AB 与内切圆相切于边中点；`inspect` id:sq 回 `regularPolygon:inscribed@…` 且 `__aiRegular.meta.definition="edge"`、`__aiExpr` 尾部带 `def=edge`；非法参数一律 `ok:false` **不注册任何元素**：`edge` 长度≠2 / 非数组 / 两端点重合 / 与 `center`/`radius`/`circle`/`vertex`/`rotate` 混用 / `side:wat` / 引用未定义点 / `sides` 2、25、3.5 / `vertexIds` 长度不符或重复 |

> 状态 ✅：`regularPolygonSpec` 的 edge 分支已用无头桩回归 **119/119** 全通过：
> 正六边形 A(-1,0)→B(1,0) 六顶点全部落在半径 2 圆上、六边等长且边长=2、V0=A / V1=B；
> `side:right`/`flip:true`/中文「右」三者顶点集合逐点一致且 B 落在最后一个顶点；
> 正方形 A2(0,0)→B2(2,0) 四顶点 (0,0)/(2,0)/(2,2)/(0,2)；外切模式边中点(切点)到中心
> 恰等于内切圆半径 √3（用例 71 的六边形）与 1（用例 72 的正方形）；`[x,y]` 端点与点 id
> 等价、`vertexIds`/中文 mode 生效、12 类非法参数抛错。
> **旧定义（`center+radius` / `circle` / `vertex` / `rotate` / 滑动条 / 中文别名）10 组结果与
> 改动前 HEAD 逐字节一致**，8 组旧非法参数仍抛错，`__aiExpr` 不带 `def=edge` 标记。
> 真实 JSXGraph 渲染、`fixed:true` 派生顶点交互仍需带浏览器环境目视确认（见「已知限制」）。
> edge 定义的顶点是静态派生点：改整体需先 `remove` 主图元再重发（同名重发会因顶点 id 冲突失败）。

## 2D 协议无头单测入库（本轮新增 2026-11-16 第六轮）

> 落实连续多轮 TODO 交接项①——此前 `regularPolygonSpec` 的无头桩回归只在沙盒里临时跑、未入库，
> 易随环境丢失，无法在后续改动（尤其符号计算 / 坐标数值化 / 先创建后引用等铁律相关逻辑）后自动复验。
> 本轮把它正式入库成 `tests/board2d_regularPolygon_spec.mjs`：Node 22 可直接 `import`
> `js/executor.js` 导出的纯函数（ESM 语法探测，无需 `package.json`），**真实调用纯函数**做数值断言，
> 而非旧桩的静态正则比对。运行：`node tests/board2d_regularPolygon_spec.mjs`。
> 该单测是 AI 命令协议执行语义的机器化回归护栏，纯 2D，3D 分支 / `editor.html` / `appId` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 73 | 对正多边形 DSL 执行器做无头回归：四种定半径 + 内接/外切 + edge 分支 + 非法参数 + expr 格式冻结 | `node tests/board2d_regularPolygon_spec.mjs`（直接 `import` `regularPolygonSpec` 纯函数）：断言 ①`center+radius` 内接六边形 6 顶点到心等距=2、`expr` 逐字节冻结；②外切正方形 vertexRadius=2√2、边长=2R=4；③`circle`/`vertex`/`rotate`/中文别名与 `sides\|n\|edges` 三别名；④`edge` 内接/外切中心与半径换算、`side:left\|right`/`flip`/点 id、首顶点落在 A；⑤12 类非法参数抛错；⑥几何性质（顶点等距、边长=2R·sin(180°/n)）与显式 `vertexIds` | ✅ | 单测必须**真实调用** `regularPolygonSpec` 并做容差数值断言（`near`/`nearPt`），不要用静态正则替代；`expr` 摘要逐字节冻结，防 AI 回放 / `describe()` 状态回读格式被无意改动而回归；`sides=3.5` 必须抛错（不静默四舍五入成 4）；Node 22 的 ESM 语法探测可直接 import 无 `type` 字段的 `.js`，无需加 `package.json`；沙箱无真实 JSXGraph，渲染/拖动仍需带浏览器目视确认 |

> 状态 ✅：`tests/board2d_regularPolygon_spec.mjs` 本地实跑 **59/59** 断言全通过（8 个 section：
> `center+radius` / `sides` 别名与中文 mode / `rotate` / `circle` / `vertex` / `edge` / 错误分支 /
> 几何性质与显式 `vertexIds`）。覆盖 `regularPolygonSpec` 四种定半径定义、内接外切两模式、
> edge 的 side/flip/数值换算、12 类非法参数抛错、几何性质与 `expr` 摘要逐字节冻结。
> 该单测由纯函数直接驱动，无浏览器 / JSXGraph 依赖，稳定可复跑；真实渲染与拖动联动仍需带浏览器环境目视确认（见「已知限制」）。

## 正多边形·edge toward 点定侧（本轮新增 2026-11-16 第七轮）

> 落实连续多轮 TODO 交接项⑥ 的前半——此前「以 AB 为一边补全正 n 边形」只能用 `side:left/right` 定侧，
> 斜边 / 任意朝向的边上 AI 极易把左右判反（用户说的是「朝三角形内侧 / 朝 C 点那一侧补」）。
> 本轮给 `regularPolygon` 的 `edge:[A,B]` 新增 `toward` 参数：直接引用状态快照里已有的点 id，
> 执行器按 `(A→B)×(A→T)` 的符号自动取 `left/right`（MCP 式「读取画板状态 → 继续构造」的又一种入口），
> 把朝向判定也交给符号计算。配套 `js/executor.js` 的 `regularPolygonSpec` edge 分支 + 头部协议注释 + JSDoc、
> `ai/board-prompt.js` 命令清单登记 toward +「正多边形·edge toward 点定侧」小节 + 例30 few-shot、
> `tests/board2d_regularPolygon_spec.mjs` 新增 section I（19 项断言）。
> 纯 2D 增量，3D 分支 / `editor.html` / `appId` / `js/board.js` 零改动，`expr` 摘要格式逐字节不变。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 74 | 三角形 A(0,0) B(4,0) C(1,3)，以 AB 为一边、朝 C 点那侧（三角形内侧）补正方形并验证边长 | `point` A/B/C → `polygon` tri → `regularPolygon` sq edge:["A","B"] sides:4 **toward:"C"** vertexIds:[Q0..Q3]（执行器按叉积判 left，中心 (2,2)、Q0=A、Q1=B、Q2=(4,4)、Q3=(0,4)）→ `verify` distance(A,Q0)=0 / distance(B,Q1)=0 / distance(Q0,Q1)=4 / distance(Q2,Q3)=4 / distance(A,Q3)=4 | ✅ | 别自己判 `side:left/right`：斜边上左右极易判反，直接把已有的点 id 交给 `toward`；不要为补正方形 `clear` 已有三角形、不要重复 `point` 已有 id；`toward` 与 `side`/`flip` **互斥**（同时给整条失败）、只在 `edge` 定义下可用；`toward` 点落在 AB 所在直线（含延长线）或引用不到点时整条报错，换一个明确在某侧的点；`verify` 只写可直接给出的预期值；见 `ai/board-prompt.js` 例30 |
| 75 | 斜边定侧 / 与 side 等价 / 非法参数 / 单测护栏 | `regularPolygon` sq2 edge:[[0,0],[2,2]] sides:4 toward:[0,3]（斜边，叉积自动判 left，与 `side:"left"` 产出同一 `expr`）→ toward:[3,0] 判 right → 点 id 写法 `toward:"C"`（refs.point 与 `[x,y]` 等价）→ 外切 + toward 下方（中心 (1,-1)、radius=边心距=1、顶点半径 √2）→ 非法：`toward` 与 `side`/`flip` 混用 / 与 AB 共线 / 用在非 `edge` 定义 / 引用未定义点 → `node tests/board2d_regularPolygon_spec.mjs` | ✅ | `toward` 定侧只改中心坐标，`expr` 摘要格式不变（旧 59 项断言全保持通过）；判定侧别写进 `__aiRegular.meta.towardSide` 供 `describe()`/`inspect` 回读；单测新增 19 项断言共 **78/78** 全通过，含斜边、外切、点 id、6 类抛错与「不带 toward 的 edge 行为逐字节不变」回归护栏；真实 JSXGraph 渲染仍需浏览器目视确认 |

> 状态 ✅：`tests/board2d_regularPolygon_spec.mjs` 本地实跑 **78/78** 断言全通过
> （原 8 个 section 的 59 项 + 新增 section I 的 19 项），`toward(上)` 与 `side:"left"`、
> `toward(下)` 与 `side:"right"` 的 `expr` 逐字节一致；不带 `toward` 的 `edge` 输出与改动前一致。
> 朝向由 `(A→B)×(A→T)` 符号判定，与人工判左右等价但不会在斜边上判反；共线 / 未知点 / 混用 /
> 非 edge 定义一律抛错，不静默猜测。真实画板渲染与 `meta.towardSide` 的面板呈现仍需浏览器环境确认。

## 圆锥曲线 conicSpec 无头单测（本轮新增 2026-11-17 第八轮）

> 落实连续多轮 TODO 交接项①——把 conic 三种定义与通用离心率的符号换算固化成机器化回归护栏，
> 与上一轮 `regularPolygonSpec` 单测是姊妹篇。`conicSpec` 是 `js/executor.js` 的模块级纯函数
> （不依赖 JSXGraph / DOM），Node 22 的 ESM 语法探测可直接 import，无需 package.json。
> 新增 `tests/board2d_conic_spec.mjs`，真实调用 `conicSpec().at(t)` 采样点做几何性质容差断言，
> 覆盖第一定义 / 第二定义 / 标准式 / 通用离心率三分支 / 中文别名 / 非法参数 / `expr` 逐字节冻结。
> 纯 2D 回归基建，`js/executor.js` 执行分支 / 3D 分支 / `editor.html` / `appId` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 76 | 对 conic 执行器做无头回归：椭圆/双曲线第一定义、抛物线第二定义、通用离心率三分支、标准式、非法参数与 expr 冻结 | `node tests/board2d_conic_spec.mjs`（直接 `import` `conicSpec` 纯函数）：①`ellipse{foci+sum}` 采 8 点核 \|PF1\|+\|PF2\|=sum=10、a=5/b=4/c=3、倾斜焦点轴仍成立；②`hyperbola{foci+diff}` 核差=diff=4、t≈0.5 返 `[NaN,NaN]` 两支断开；③`parabola{focus+directrix}` 核 \|PF\|=dist(P,准线)、p=2、顶点(0,0)、焦点在准线下方时轴自动翻转；④标准式 ellipse/hyperbola/parabola（含 rotate:90 旋转轴）；⑤通用 e=0.5 椭圆/e=1 抛物线/e=2 双曲线，别名 `eccentricity`/`ecc`/`e` 产出一致、核 \|PF\|=e·dist；⑥中文 type；⑦12 类非法参数抛错；⑧expr 摘要逐字节冻结 | ✅ | 单测必须**真实调用** `conicSpec` 并做容差数值断言（`near`/`nearPt`/`dist`/`distLine`），不要用静态正则替代；`expr` 摘要逐字节冻结（含全角括号、`−` U+2212 减号、中文），防 AI 回放 / `describe()` 状态回读格式被无意改动而回归；双曲线 NaN 断开带用 `Number.isNaN` 判定（JSON 化会显示成 null）；旧 `regularPolygonSpec` 78 项无回归；Node 22 ESM 可直接 import 无 `type` 字段的 `.js`，无需 `package.json`；沙箱无真实 JSXGraph，曲线渲染 / 断点断开 / 线型颜色仍需浏览器目视确认 |

> 状态 ✅：`tests/board2d_conic_spec.mjs` 本地实跑 **72/72** 断言全通过（7 个 section：
> A 椭圆第一定义 / B 双曲线第一定义 / C 抛物线第二定义 / D 标准式+rotate /
> E 通用离心率三分支 / F 中文 type 别名 / G 非法参数抛错）。几何性质全部由 `at(t)` 采样点
> 容差断言驱动，非静态正则；`expr` 摘要逐字节冻结。回归 `tests/board2d_regularPolygon_spec.mjs`
> **78/78** 全绿、无回归。该单测由纯函数直接驱动，无浏览器 / JSXGraph 依赖，稳定可复跑；
> 真实曲线渲染与断点断开仍需带浏览器环境目视确认（见「已知限制」）。

## 原生 remove 命令 · 删除与局部重画（本轮新增 2026-11-17 第九轮）

> 落实「MCP 式读取画板状态后修改图形」长期缺失的一环——此前 `js/executor.js` 内部虽有
> `remove(id)`（供画板删除工具调用），但 AI 的 JSON 命令协议里**没有 `remove` 这个 op**，
> 而提示词例26 / 例30 与本清单用例 72 却写着「要改整体请先 `remove` 主图元再重发」，AI 照抄也发不出来；
> 想改掉一个已画好的图元只能 `clear` 整板重画（丢掉用户其它已有图形）或 `move` 挪自由点。
> 本轮补上原生 `remove`：`planRemove` 纯函数沿依赖图级联收集依赖者并按依赖倒序删除，
> `execute()` 前置分支回传 `removed` / `missing`；前端 `js/board.js` **零改动**
> （`remove` 不在 `isTransient` 名单内，会进 `doc.commands` 可回放 / 可保存，自检修正轮也不过滤它）。
> 同时落实连续多轮 TODO ⑤：新增 `tests/run-2d-specs.mjs` 聚合 3 个 2D 单测（不新增 `package.json`，
> 以免 Cloudflare Pages 因根目录出现 package.json 触发构建影响静态部署）。
> 纯 2D 协议增量，3D 分支 / `editor.html` / `appId` 零改动。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 77 | 把已画好的内接正六边形改成同圆内接正三角形（读状态 → 删除 → 同名重发 → 自检） | 状态快照有 O(0,0) / `circle` c1(O,2) / `regularPolygon` hex(inscribed@n=6, 顶点 hex1..hex6) → `remove` id:"hex"（级联清掉 hex1..hex6）→ `regularPolygon` id:"hex" circle:"c1" sides:3 vertexIds:[P1,P2,P3] → `verify` oncircle(P1,c1)/(P2,c1)/(P3,c1) expect:0 tol:0.05 → `verify` distance(P1,P2) expect:3.4641 tol:0.01（内接正三角形边长 R√3 = 2√3 ≈ 3.4641） | ✅ | **别 `clear` 整板**（会丢掉 O / c1 等用户已有图形）、别给新图元另起 id 堆垃圾；删完用**同名 id** 重发才不会撞「id 重复定义」；`c1` / `O` 没被删，直接引用，不要重新 `point` / `circle`；`remove` 的 id 必须来自状态快照（先读状态后引用）；verify 只写可直接给出的预期值；见 `ai/board-prompt.js` 例31 |
| 78 | ids 批量删除 / 级联依赖 / 缺失 id 宽容 / 非法参数 / 单测护栏 | `remove` ids:["h","cM","T1"]（一次删多条辅助线与切点）→ 删点 A 时级联删掉引用它的 `segment` s1 / `polygon` tri（依赖者先删、目标后删）→ `remove` id:"notExist" 回 `ok:true` 且 `missing:["notExist"]`，不整批失败 → 非法：`ids:"__all__"` / 空数组 / 空字符串 / 非字符串成员 / 缺 id 一律 `ok:false` → `node tests/board2d_remove_spec.mjs` → `node tests/run-2d-specs.mjs` | ✅ | `remove` **不支持 `ids:"__all__"`**（清空只能 `clear`，且只在用户明确要求重画/新建时用）；级联与画板删除工具同语义，防悬空引用；`planRemove` 在引擎无 `parents`/`childElements` 时降级为只删显式项、不抛错不误删；`removed` 按依赖倒序回传供 AI 自检；删 `regularPolygon` 主图元会连带清掉派生顶点，同名重发不撞 id |

> 状态 ✅：`tests/board2d_remove_spec.mjs` 本地实跑 **38/38** 断言全通过（9 个 section：
> 单 id / ids 去重 trim / 缺失宽容 / 多级 `parents` 级联与倒序 / 三种 `childElements` 形状 /
> `regularPolygon` 派生顶点 / 无依赖信息降级 / 10 类非法参数抛错 / 4 层链式不动点收敛），
> 真实调用 `planRemove` 做断言、非静态正则；`tests/run-2d-specs.mjs` 聚合 **3/3** 脚本全通过，
> 既有 `conicSpec` **72/72**、`regularPolygonSpec` **78/78** 无回归。全仓 68 个 JS 文件 `node --check` 通过。
> 真实 JSXGraph 上级联所依赖的 `parents` / `childElements` 形状仍需带浏览器环境目视确认（见「已知限制」）。

## 易错图形补遗：弓形面积阴影 / 旋转相似（本轮新增 2026-11-17 第十轮）

> 落实连续多轮 TODO 交接项④「其它易错图形」里剩的两项。两者协议都没有单条原生命令，
> 此前 AI 要么硬找不存在的参数、要么手算复合坐标。本轮只增 `ai/board-prompt.js` 例32/例33 few-shot，
> 全程复用既有 `point`/`polygon`/`style`/`arc`/`segment`/`transform`/`verify`，**未改执行器 / 3D / editor.html**。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 79 | 圆心 O(0,0)、半径 3，把第一象限弧与弦围成的弓形区域涂阴影 | `point` O/P0(3,0)/P1(2.121,2.121)/P2(1.5,2.598)/P3(0,3)（弧上采样点 R·cosθ/R·sinθ 数值化）→ `polygon` bow points:[P0,P1,P2,P3]（闭合边 P3→P0 即弦）→ `style` bow fill:true fillColor:"#93C5FD" fillOpacity:0.35 → `arc` bowArc center:O from:P0 to:P3（光滑弧边）→ `segment` bowChord P0→P3 → `verify` oncircle(P1,c1)=0 / distance(P0,P3)=4.243≈3√2 | ✅ | **没有「填充弓形」原生参数**，别在 arc/circle 上找 fill（circle 的 fill 是整圆）；fill 打在 polygon 上；采样点先 `point` 建好再进 `polygon`（先创建后引用）；坐标写成算好的数字、不写 cos(45)；扇形变式 polygon points 前加圆心 O 才对；见 `ai/board-prompt.js` 例32 |
| 80 | 以 O 为中心把 △ABC 放大 2 倍再逆时针旋转 90°，确认相似比 2、旋转角 90° | `point` O/A(1,1)/B(3,1)/C(2,3) → `polygon` tri → `transform` triS of:tri type:scale k:2 center:O → `transform` triSR of:triS type:rotate angle:90 center:O（链式，第二条 of 引用第一条输出 id）→ 逐点核对：单独 `transform` A1 of:A scale k2 → `transform` A2 of:A1 rotate 90 → `verify` distance(O,A)=1.414(√2) / distance(O,A2)=2.828(2√2) / angle(A,O,A2)=90 tol:0.5 | ✅ | **没有单条「旋转相似/spiral similarity」命令**，别找、别手算 cos/sin 复合坐标；两条 `transform` 链式、都带同一 center:O（共心）；第二条 of 必须引用第一条输出 id（triS/A1），写成原始 tri/A 会漏掉放大；transform 输出按 id 注册可被下一条引用（先创建后引用）；整份 polygon 副本顶点不单独命名，逐点核对就单独变换一个已命名点；verify 只写可直接给出的预期值；见 `ai/board-prompt.js` 例33 |

> 状态 ✅：两例全程复用既有命令，`node --check ai/board-prompt.js` 通过；采样点/相似比/旋转角的期望值按
> R·cosθ/R·sinθ 与位似+旋转公式手算核对（弓形弦长 3√2≈4.243、|OA|=√2≈1.414、2 倍后 2√2≈2.828、∠AOA₂=90°）。
> 真实 JSXGraph 上 polygon 填充用折线逼近弧的圆滑度、`transform` 链式输出被下一条 of 引用的运行时行为仍需带浏览器环境目视确认（见「已知限制」）。

## 函数图像分段裁剪 / 多区间定义域（本轮新增 2026-11-17 第十一轮）

> 落实任务清单 §2「扩展 JSON 命令协议」里唯一未落地的一项。此前「定义域 [-5,-1]∪[1,5]」
> 「1/x 挖掉 x=0 附近」「tan(x) 断渐近线」只能拆多条 `function` 各自 from/to（用例 11 的权宜做法）：
> 同一函数占多个 id、样式重复、交点筛选不知引用哪段、改一处改一批。本轮把分段下沉为
> `function` 的原生 `segments` / `exclude` 字段，执行器（parseFunctionSegments 纯函数）与提示词同步。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 81 | 画 y=1/x，只保留 x∈[-5,-1] 和 x∈[1,5] 两段，标出 x=2 处取值 | `function` f1 expr:"1/x" from:-5 to:5 **segments:[[-5,-1],[1,5]]** → `style` f1 color/strokeWidth（一条命令一个 id）→ `verify` kind:evaluate expr:"1/x" x:2 expect:0.5 tol:0.001 | ✅ | **别拆成两条 function**（多 id / 样式重复 / intersect 不知引用哪条）；端点写数字不写 `-pi/2`/`a`/`x<0`（非法段被静默丢弃可能整段消失）；segments 是白名单、区间外采样点记 NaN 自动断开，段间**不连线**；分段只决定画哪几段 x、不决定每段换表达式（分段函数仍需两条不同 expr，见用例 11）；见 `ai/board-prompt.js` 例34 |
| 82 | y=1/x 去掉中间间断；tan(x) 在渐近线处断开；叠加值域裁剪 | 变式 A：`function` f1 expr:"1/x" from:-5 to:5 **exclude:[[-1,1]]**（挖洞黑名单）；变式 B：`function` g expr:"tan(x)" from:-5 to:5 **exclude:[[1.5,1.7]]**；变式 C：在 81 命令后加 `ymin`:-4,`ymax`:4 去掉趋近 ±∞ 的尾部 | ✅ | exclude 是黑名单、闭区间端点也不画；segments 与 exclude 可叠加（先并集后相减）；与 ymin/ymax、滑动条表达式、style、intersect 全兼容（仍是**一个**图元、一个 id）；倒序 / 重叠 / 相邻段自动归一、超出 from~to 自动钳制、最多 12 段、非法项静默丢弃不整批失败；describe()/inspect 回读带「分段{…}」 |
| 83 | 画 y=x+1 在 x∈[-4,2) 上，左端点实心、右端点空心，并验证 f(0)=1 | `function` f1 expr:"x+1" from:-4 to:2 segments:[[-4,2]] → `style` f1 color/strokeWidth → `point` L(-4,-3) + `style` L face:"o" size:6 **solid:true** → `point` R(2,3) + `style` R face:"o" size:6 **hollow:true** → `verify` kind:evaluate expr:"x+1" x:0 expect:1 tol:0.001 | ✅ | **先 point 建点、再 style 改点 id**，别 style 不存在的 id；端点坐标数值化（y=f(端点x)）；空心用 hollow、实心用 solid，二者二选一；见 `ai/board-prompt.js` 例35 |
| 84 | 数轴开区间 (0,3] 端点标记；把已有空心端点改成实心 | 变式 A（开区间）：`point` E0(0,0) + `style` E0 face:"o" hollow:true（空心）+ `point` E3(3,0) + `style` E3 face:"[]" solid:true（方点表闭）；变式 B（改开闭）：只重发 `style` R hollow:false solid:true，**别重新 point 同名 id**（重复定义失败） | ✅ | hollow 别与 fill:true 同写（fill 加半透明底色会糊住空心）；size 写 1~20 数字、端点常用 5~7；face 支持 o/圆、[]/方、菱形、三角等中文别名；点型进数值快照回读形如 point@(0,0) 点型{face:o hollow}，改外观只发 style |

> 状态 ✅：`tests/board2d_function_segments_spec.mjs` 无头单测真实调用 `parseFunctionSegments`，
> 覆盖未写分段零回归、多段并集、挖洞、叠加、区间归一/钳制/上限、闭区间边界（随聚合入口一起跑）。
> 未写 segments/exclude 时 `active=false`，走原有整段出图路径，`ymin/ymax` 旧行为不变。
> 状态 ✅：`tests/board2d_style_point_spec.mjs`（本轮新增）无头单测真实调用 `stylePointSpec`，
> 覆盖未写点型字段零回归、face 中英文别名归一、未知值宽容、size 数值化与 1~20 钳制、
> hollow（face 缺省 o / 透填充 / 描边保底 1.5）、solid（fillOpacity:1）、二者互斥、fillColor、summary 回读（50 项断言）。
> 真实 JSXGraph 上 NaN 断点是否如预期断开、空心/实心端点渲染与线宽/颜色仍需带浏览器环境目视确认（见「已知限制」）。

## TODO 交接（下一步）
1. 自检状态条做成 AI 面板固定 DOM 徽标（现为逐轮日志行）。
2. 收敛判定引入「残差改善量」而不只数失败项。
3. 收敛后把 `probeVerify` 结果回画成最终 ✔ 读数。
4. [本轮已完成] 其它易错图形（弓形面积阴影、旋转相似）few-shot——见例32/例33、用例 79/80。
5. [本轮已完成] 分段交界处的空心 / 实心端点标记——给 2D `style` 补点型样式 `face`/`size`/`hollow`/`solid`，见例35、用例 83/84、`stylePointSpec` 单测；仅剩分段裁剪 + 空心/实心端点在真实 JSXGraph 上目视确认。
6. 更多易错图形 few-shot（如旋转体截面、极坐标曲线、含参不等式区域，需先确认执行器是否支持对应协议）。
7. `remove` 的级联在真实 JSXGraph 上目视确认（见「已知限制」）；`expressions` 里按标识符引用滑动条的曲线是否随级联一并删除也需浏览器复验。

## 已知限制
- `inspect` 派生量查询（本轮新增）复用 `measureValue` 求值，表达式含滑动条变量时依赖画板引擎的
  JessieCode 上下文取当前值；沙箱无头环境只验证纯数值表达式（用例 50~52），带滑动条的函数需在
  浏览器环境补测。派生量不画临时读数、不进 `doc.commands`，仍受两阶段回读「只回读一轮」约束。
- `inspect` 两阶段回读由前端 `aiSend()` 驱动（与自检回读闭环同理，画板实例在浏览器侧）：读数来自 `executor` 注册表，需在带浏览器 + LLM 环境确认二次调用链路与面板展示（用例 47/48）；查询轮最多一次，不会与自检修正轮互相递归。
- 沙箱无头环境无法实例化真实 JSXGraph，上述用例需在带浏览器的环境目视确认或补单测；命令序列本身已与 `js/executor.js` 协议逐条对齐。
- `measure` 在前端画板生成临时读数并回传数值；read-back 闭环已在 `js/board.js` 接入（执行后用 measure 数值驱动 LLM 二次核对并自动修正），无需后端改造。沙箱无头环境无法跑真实 JSXGraph + LLM，闭环行为需在带浏览器的环境目视确认（用例 14/15/16/20/24）。
- 本轮起 read-back 闭环由 `verify` 的 `pass:false` 精确触发（纯 `measure` 只展示读数、不再消耗一次 LLM 调用）；判定容差默认 `tol=0.05`，角度用例建议显式给 `tol:0.5`。闭环最多自动修正 3 轮（每轮静默复跑原始 verify 机器判定收敛，横跳 / 失败项变多 / 连续 2 轮无改善 / 达上限提前收手），不递归；`expect`/`expectRange` 的取值合理性由 AI 在规划阶段给出，仍需带浏览器环境回归确认（用例 29/30、37~39）。
- `conic` 用 JSXGraph 的 `curve` 元素（参数曲线函数 `[fx,fy,0,1]`）绘制：沙箱无头环境只验证了参数换算与采样点的数学正确性，**曲线在真实画板上的渲染、NaN 断点是否如预期断开、线宽/颜色**仍需带浏览器环境目视确认（用例 59~61）。`focus`+`directrix` 形态依赖注册表里准线元素的端点坐标；已画出的 `conic` 是静态参数曲线（不随焦点/准线被 `move` 拖动实时重算，回放/保存时按命令重建），与 `transform` 的静态副本行为一致。
- `regularPolygon` 的 n 个顶点落成 `fixed:true` 的独立 `point`（用例 65~69）：沙箱无头环境只验证了顶点坐标的数学正确性与注册表/数值快照/删除联动，**真实画板上拖动滑动条 `radius` 或 `center` 点时函数坐标是否实时刷新、拖动交互是否被 `fixed` 正确禁用**仍需带浏览器环境目视确认。它按命令重建（回放/保存时重算顶点），与 `conic` / `transform` 的静态行为一致；派生顶点占 id，删除主图元时联动清理，勿把顶点 id 当成用户可长期持有的自由点。
- `remove` 的级联依赖来自 JSXGraph 元素的 `parents` / `childElements`（用例 77/78）：沙箱无头单测只能用 mock 依赖图覆盖，真实引擎里这两种字段的形状因 JSXGraph 版本 / 图元类型而异；若引擎不提供，执行器会**降级为只删显式指定项**（不抛错、不误删），此时需按依赖倒序逐条 `remove`。真实画板上删点后依赖它的线段 / 圆是否如预期一并消失、同名 id 重发是否顺畅，仍需带浏览器环境目视确认；`expressions` 里按标识符引用滑动条的曲线（`expr:"a*x^2"`）是否随级联一并删除，也需在浏览器复验（前端删除工具已有 `exprMentions` 匹配，AI 的 `remove` 走执行器依赖图，二者语义可能不完全一致）。
- 点型样式（本轮新增，用例 83/84）：沙箱无头单测只验证了 `stylePointSpec` 的属性归一/钳制/互斥逻辑与命令序列对齐，**真实 JSXGraph 上 `face` 各点型（尤其 `hollow` 透填充+描边的空心观感、`solid` 填充跟随描边色、方点/菱形/三角）的渲染效果**仍需带浏览器环境目视确认；`hollow` 不要与 `fill:true` 同写，否则半透明底色会糊住空心。点型摘要挂在元素 `__aiPointStyle` 供 describe()/inspect 回读，回放/保存时随命令重建。

## 极坐标曲线（polar 原生命令，本轮新增 2026-11-19 第十三轮）

> 落实连续多轮 TODO 交接项⑤「极坐标曲线」，且执行器支持已确认可达。此前画玫瑰线 / 心形线 / 阿基米德螺线
> 只能让 AI 手算每个采样点的 (x,y) 再逐点 `point` 连 `polygon`：坐标难算、点数僵硬、无法参数化联动，
> 对标大角几何「自研数学 DSL / 符号计算」明显吃亏。本轮新增原生 `polar`：AI 只给 r(t) 表达式与极角范围，
> 执行器（`polarSpec` 纯函数 + `curve` 元素）按 x=r·cos t / y=r·sin t 换算成参数曲线。

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 易错点 |
|---|------|-----------|------|------|
| 85 | 画三叶玫瑰线 r=3cos(3θ)，并验证 r(0)=3、r(π/3)=0 | `polar` id:"rose" expr:"3*cos(3*t)" from:0 to:6.283 samples:600 color:"#E11D48" strokeWidth:2.5 → `verify` kind:evaluate expr:"3*cos(3*t)" x:0 expect:3 tol:0.001 → `verify` x:1.047198 expect:0 tol:0.001 | ✅ | **别手算采样点逐点 point + polygon**（坐标抄错、点数僵硬）；变量写 `t`（θ/theta 执行器归一），from/to 写弧度**数字**不写 "pi"/"2π"；r<0 的瓣由引擎按参数曲线自然绘出，别取 abs 或拆段；自检用 `evaluate` 核 r(t) 表达式值，别用 `measure distance` 量曲线本身；describe()/inspect 回读 `polar:r=3*cos(3*t) θ∈[0,6.283] 采样600`；见 `ai/board-prompt.js` 例36 |
| 86 | 画心形线 r=2+2cosθ；再用滑动条 a 驱动螺线 r=a·t 配 animate 自动演示 | 变式 A：`polar` id:"cardioid" expr:"2+2*cos(t)" from:0 to:6.283 color:"#1D4ED8"；变式 B：`slider` id:"a" min:0.5 max:3 value:1 step:0.1 → `polar` id:"spiral" expr:"a*t" from:0 to:12.566 color:"#059669" → `animate` id:"a" | ✅ | 表达式内可引用滑动条 id（a 由引擎取实时值，拖动曲线联动），但 from/to/turns/samples 仍须写**数字**；螺线多圈把 to 写大（12.566≈4π 两圈），turns 仅在未给 to 时生效；polar 是普通 curve 图元，可 style / label / 被 intersect 引用、进文档；回放/保存按命令重建 |

> 状态 ✅：`tests/board2d_polar_spec.mjs` 无头单测真实调用 `polarSpec`，覆盖 expr 非空与变量归一
> （t/theta/θ）、from/to 默认与交换、turns 圈数别名、samples 60~2000 钳制、非法参数抛错、
> 占位 at/rAt 形状、summary/meta 回读、综合命令（玫瑰线 + 滑动条螺线）；与 `tests/run-2d-specs.mjs`
> 聚合入口一起跑。真实极径 r(t) 由 `case 'polar'` 用 JessieCode 编译闭包注入，沙箱无头环境不实例化
> JSXGraph，**真实画板上 r(t) 求值、滑动条联动、r<0 负半径瓣的绘制、采样密度与断点渲染**仍需带浏览器目视确认（见「已知限制」）。

## TODO 交接更新（2026-11-19 第十三轮）
1. [本轮已完成] 极坐标曲线协议与 few-shot——原生 `polar` + `polarSpec` + 例36 + 用例 85/86。
2. [待办] 自检状态条做成 AI 面板固定 DOM 徽标。
3. [待办] 收敛判定引入「残差改善量」；收敛后把 probeVerify 结果回画成最终 ✔ 读数。
4. [待办] 含参不等式区域（需先确认执行器是否支持区域填充）/ 旋转体截面 few-shot。
5. [待办] polar 在真实 JSXGraph 上的采样密度 / NaN 断点渲染目视确认。

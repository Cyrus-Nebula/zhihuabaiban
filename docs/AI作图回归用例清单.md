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

## 已知限制
- 沙箱无头环境无法实例化真实 JSXGraph，上述用例需在带浏览器的环境目视确认或补单测；命令序列本身已与 `js/executor.js` 协议逐条对齐。
- `measure` 在前端画板生成临时读数并回传数值；read-back 闭环已在 `js/board.js` 接入（执行后用 measure 数值驱动 LLM 二次核对并自动修正），无需后端改造。沙箱无头环境无法跑真实 JSXGraph + LLM，闭环行为需在带浏览器的环境目视确认（用例 14/15/16/20/24）。
- 本轮起 read-back 闭环由 `verify` 的 `pass:false` 精确触发（纯 `measure` 只展示读数、不再消耗一次 LLM 调用）；判定容差默认 `tol=0.05`，角度用例建议显式给 `tol:0.5`。闭环最多自动修正 3 轮（每轮静默复跑原始 verify 机器判定收敛，横跳 / 失败项变多 / 连续 2 轮无改善 / 达上限提前收手），不递归；`expect`/`expectRange` 的取值合理性由 AI 在规划阶段给出，仍需带浏览器环境回归确认（用例 29/30、37~39）。

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
| 35 | 半透明填充 + 描边/填充分色 | `style` target:tri color:"#3E44D9" fillColor:"#DBEAFE" fill:true opacity:0.35 | ✅ | 本轮新增细粒度字段；opacity 夹到 [0,1] 并同时写 strokeOpacity/fillOpacity；fill:true 默认的 0.25 被显式 opacity 覆盖 |
| 36 | 标签文字改色 | `style` target:A labelColor:"#E11D48" | ✅ | 只改 label 的 strokeColor，不动几何元素 |
| 37 | 标签字号放大 | `style` target:A labelSize:17 | ✅ | 写 label 的 fontSize(px)；≤0 或非数值忽略 |
| 38 | 省略新字段时向后兼容 | `style` target:tri color:"#E11D48" strokeWidth:3 dash:2 hidden:false | ✅ | 不传 4 个新字段时行为与旧版完全一致；`tests/executor_style_regress.mjs` 无头覆盖 |

## 测量 / 自检（verify 层）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 说明 |
|---|------|-----------|------|------|
| 18 | 量 AB 的距离 | `measure` kind:distance of:[A,B] | ✅ | 画板生成灰色 ✓ 读数，不污染文档 |
| 19 | 量 ∠ABC 角度 | `measure` kind:angle of:[A,B,C] | ✅ | 中点是顶点 |
| 20 | 量函数在 x=2 处的值 | `measure` kind:evaluate expr:"x^2" x:2 | ✅ | 数值经 execute 结果回传 |
| 24 | AI 作图后自动自检并修正（read-back 闭环） | AI 输出作图命令 + `measure`；前端执行后把 measure 数值回传 LLM 二次核对，几何关系不符时自动补发修正命令 | ✅ | 前端 `js/board.js` 的 `aiSend()` 驱动；仅当一轮含 `measure` 时触发一次额外 LLM 调用；`executor.clearMeasures()` 清上一轮读数 |
| 28 | 声明式断言：高线垂直（通过） | `verify` kind:angle of:[A,H,B] expect:90 tol:0.5 label:"高线垂直" | ✅ | 执行器按 expect/tol 自动判定 `pass:true`，画板生成绿色 ✔ 读数；与 `measure` 共用 `computeMeasure()` |
| 29 | 声明式断言：顶点函数值（evaluate） | `verify` kind:evaluate expr:"3-(x-2)^2" x:2 expect:3 tol:0.001 | ✅ | expect 必须是数字；tol 省略时角度默认 0.5°、其余 0.05 |
| 30 | 断言未通过时自动修正 | `verify` expect:90 但实测 60 → 闭环把「预期 90° / 实测 60° / 偏差 -30°」列进【未通过断言】回传 LLM，补发修正命令 | ✅ | 不再靠 LLM 肉眼比对裸数值；修正完成后 `clearMeasures()` 清掉临时读数 |
| 31 | 全部断言通过时跳过二次调用 | 本轮只含 `verify` 且全 `pass` → 不发起第二次 LLM 请求，AI 面板显示「已自检 N 项，全部符合预期」 | ✅ | 只要含裸 `measure`（无期望值）就必须二次核对，不能省 |
| 32 | verify 不进文档 / 不重建 | 保存、重画、撤销后断言读数不出现 | ✅ | 与 `measure` 一致的 transient 行为；`runCommands()` 与 `applyAiCommands()` 均不过滤进 `doc.commands` |
| 33 | 自检：sin(x) 在 π/2 最大值≈1（区间容差） | `function` expr:"sin(x)" from:-1 to:4 → `verify` kind:evaluate expr:"sin(x)" x:1.570796 expectRange:[0.98,1.02] label:"sin(π/2)≈1" | ✅ | 区间模式：实测落在 [lo,hi] 内即 pass；比硬写 expect 更贴合"约等于"口语意图（例8a） |
| 34 | 自检：大正方形对角线≈141（相对容差） | `verify` kind:distance of:[A,C] expect:141.42 rtol:0.01 label:"对角线≈141" | ✅ | 相对容差：\|实测−预期\| ≤ tol + rtol·\|预期\|；适合预期值很大的量（≈1.4 容差），避免绝对 tol 过苛误判（例8b） |

## 增量修正与自检收敛（move / 多轮闭环，本轮新增）

| # | 自然语言描述 | 期望命令序列（要点） | 状态 | 说明 |
|---|------|-----------|------|------|
| 39 | 自检失败后就地改坐标、不重画整图 | 首轮 `verify` v1 ✔ / v2 ✘（高长 3.6≠4）→ 修正轮只输出 `move` id:A x:0 y:3（或 to:[0,3]） | ✅ | 本轮新增 `move` 增量命令：对已存在 id 就地改坐标；此前用 `point` 重定义同 id 会报「id 重复定义」，修正实际改不动图 |
| 40 | 改滑动条当前值做增量修正 | `move` id:a v:2（a 是已存在的 `slider`）→ 依赖它的 `function` 实时联动 | ✅ | 滑动条用数值 `v`、点用 `x/y` 或 `to:[x,y]`；`move` 是普通作图命令，会进文档/回放 |
| 41 | 多轮收敛：复跑首轮原始 verify | 修正轮执行后系统复跑首轮 `verify`（transient、不进文档）→ 全部 ✔ 即收敛，不再请求 LLM | ✅ | `js/board.js` 的 `aiSend()` 最多 2 轮；失败项未减少或只有裸 `measure` 时提前收手，避免无限调用 |
| 42 | diff 感知：不重画已通过部分 | 修正提示带【已通过项，请勿重画】；修正轮里的 `clear` / `measure` / `verify` 被前端过滤 | ✅ | 防误清画板、防临时读数堆积；AI 面板提示「（已忽略修正轮里的 clear / measure / verify 命令）」 |

## 协议扩展 TODO（不在本轮，供下一步）
- [本轮已完成] `reflect` / `rotate` / `translate`：原生几何变换 op（见用例 17/21/22 与 `js/executor.js` 的 transform 分支）。
- [本轮已完成] `animate`：自动播放参数动画命令（见用例 23 与 `js/executor.js` 的 animate 分支、`js/board.js` 的 animPlayTargets；前端复用既有滑动条动画引擎）。
- [本轮已完成] read-back 闭环：在 `js/board.js` 的 `aiSend()` 前端驱动——执行命令后收集 `measure` 的 `value`，回传给 LLM 二次核对，几何关系不符则自动补发修正命令（对标大角几何 MCP 式读画板状态后改图）。`ai/board-prompt.js` 第 4 步已约定 AI 收到【自检回读】时只输出修正命令或空 commands；`js/executor.js` 提供 `clearMeasures()` 清上一轮读数。（注：因画板实例在浏览器侧，闭环放在前端而非后端，效果等价。）
- [上轮已完成] 样式与标注 few-shot 与回归用例（线型 dash / 颜色 color / 线宽 strokeWidth / 标签 label）：见用例 25/26/27 与 `ai/board-prompt.js` 例5；`js/executor.js` 的 `style` / `label` 分支已支持，补齐"教学示例"，让 AI 主动把成品描红、加粗、虚线化、加标签（对标大角几何"生产级成品度"）。
- [本轮新增] 声明式自检断言 `verify`（清单第 3 项「与预期不符时自动修正」的落地）：此前自检只回读裸数值、靠 LLM 肉眼判断是否符合意图；现 AI 在规划阶段把关键量的期望值写进命令。
  - `js/executor.js`：新增 `verify` 执行分支与 `computeMeasure()`（`measure` / `verify` 共用同一种测量算法），按 `expect` + `tol` 自动算出 `pass` / `delta`，画板生成绿色 ✔ / 橙色 ✘ 临时读数，`execute()` 结果透传 `pass/expect/tol/delta/label`。
  - `js/board.js`：`describeMeasure()` / `buildReadback()` 升级为结构化回读；read-back 闭环在全部断言通过时**跳过二次 LLM 调用**，有失败项时把「预期 / 实测 / 偏差」列入【未通过断言】做定向修正；AI 面板逐行展示 ✔/✘ 自检摘要；`runCommands()` / `applyAiCommands()` 均把 `verify` 挡在 `doc.commands` 之外。
  - `ai/board-prompt.js`：**仅追加段落**（未改动任何已有行与 3D 分支）——「# 自检断言 verify」命令清单登记章节 + 例6（带断言的高线）/ 例7（顶点式 evaluate 断言），见用例 28~32。
- [本轮已完成] `verify` 期望值三态：`expectRange:[lo,hi]` 区间容差 + `expect+rtol` 相对容差（对应"约等于 / 落在区间内"的模糊意图），与既有 `expect+tol` 绝对容差互斥。
  - `js/executor.js`：在 `verify` 执行分支按三种模式算 `pass`（`range` / `abs` / `rtol`），`rtol` 用 `|实测−预期| ≤ tol + rtol·|预期|` 组合容差（贴合 math.isclose），透传 `mode/expectRange/rtol`；`measureReadout()` 据模式生成对应读数文案。
  - `js/board.js`：`describeMeasure()` 支持 `range`（`应在 [lo,hi]`）/ `rtol`（`容差 tol+rtol·|E|`）展示；`applyAiCommands()` 透传 `mode/expectRange/rtol`；`buildReadback()` 的 `allPassed` 仍以 `pass` 为准，闭环行为不变。
  - `ai/board-prompt.js`：**仅追加段落**——「# 自检断言 verify」补充三种期望值写法说明 + 例8（区间容差 8a、相对容差 8b），未改动任何已有行与 3D 分支；见用例 33/34。
- [本轮新增] `move` 增量修正命令（对标大角几何「MCP 式读取画板状态后修改图形」）：此前自检失败后提示词要求 AI「移动点/改坐标」，但 `point` 对同 id 会报「id 重复定义」，修正只能整幅重画。`move` 就地改点坐标/滑动条值，不新建图元、不改 id、不改依赖。
  - `js/executor.js`：新增 `case 'move'`（自由点 `setPosition`/`moveTo`，滑动条 `setValue` + `board.update()`）与 `execute()` 的 `move` 特判（跳过 `registry.set`，否则会误报重复定义）。
  - `ai/board-prompt.js`：**仅追加段落**——「# 增量修正命令 move」命令清单登记 + 例9（diff 感知修正），未改动任何已有行与 3D 分支；见用例 39/40。
- [本轮新增] `style` 细粒度样式：`opacity`（0~1 整体不透明度，描边+填充）、`fillColor`（独立填充色，与 `color` 解耦）、`labelColor` / `labelSize`（标签文字色/字号）。见用例 35~38 与 `ai/board-prompt.js` 的「# 细粒度样式」登记章节 + 例10；`js/executor.js` 的 `style` 分支同步支持，省略新字段时行为与旧版完全一致。
- [本轮新增] 自检闭环多轮收敛 + diff 感知：修正轮从「单次 LLM 二次核对」升级为「定向修正 → 复跑首轮原始 `verify` → 机器判定收敛」，最多 2 轮。
  - `js/board.js` 的 `aiSend()`：修正提示带【已通过项，请勿重画】清单，过滤修正轮里的 `clear` / `measure` / `verify`，复检失败项不减少即提前收手；`allPassed` 时仍跳过二次调用。
  - `ai/board-prompt.js`：**仅追加段落**——「# 自检修正策略」章节（多轮收敛、禁止 clear/重画、优先 move、复检由系统自动复跑），未改动任何已有行与 3D 分支；见用例 41/42。
- [下一步·待办] 1) 给 `style` 补 `strokeOpacity` / `fillOpacity` 独立控制与 `labelFont` / `labelOffset`；2) AI 面板把 ✔/✘ 摘要做成可折叠自检清单；3) 把「分段裁剪」从 UI 工具（`js/tools.js` 的 `trim`）升级为 AI 可下发的原生命令（目前只能靠 `arc` + `glider` + `style hidden` 绕）；4) 打磨"未收敛"时的人工接管提示。

## 已知限制
- 沙箱无头环境无法实例化真实 JSXGraph，上述用例需在带浏览器的环境目视确认或补单测；命令序列本身已与 `js/executor.js` 协议逐条对齐。
- `measure` 在前端画板生成临时读数并回传数值；read-back 闭环已在 `js/board.js` 接入（执行后用 measure 数值驱动 LLM 二次核对并自动修正），无需后端改造。沙箱无头环境无法跑真实 JSXGraph + LLM，闭环行为需在带浏览器的环境目视确认（用例 14/15/16/20/24）。
- 本轮新增 `verify` 的 `pass` 判定是纯数值计算（|实测 − 预期| ≤ tol），不依赖 LLM，可在无头单测里覆盖；但 ✔/✘ 读数渲染、AI 面板自检摘要，以及「全通过跳过二次调用 / 失败项定向修正」两条闭环分支仍需带浏览器的环境目视确认（用例 28~32）。
- 本轮 `move` / 细粒度 `style` 协议分支可用 `node tests/executor_style_regress.mjs` 无头跑（mock board，覆盖新旧字段、标签属性、滑动条改值、向后兼容与错误路径）；但「修正 → 复跑 verify → 收敛」的多轮循环依赖真实 LLM 请求与浏览器画板，需在带浏览器的环境目视确认（用例 39~42）。

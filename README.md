# 智绘几何 · 开源免费的在线几何画板

强大直观的几何图形创建与编辑工具，让数学可视化变得简单。**完全免费、代码开源**；核心功能须登录后使用（登录即开通账号，邮箱 + 密码，完全自建、零外部依赖）。

- **在线体验**：https://zhihuabaiban.pages.dev
- **源代码**：https://github.com/Cyrus-Nebula/zhihuabaiban （欢迎 Star / Fork / 提 Issue）

## 功能特性

- **AI 作图**：输入文字描述（如"画一个等腰直角三角形，标注三个顶点"）或上传题目图片，AI 自动生成可继续编辑的动态图形；支持多轮对话修改
- **双路线画板**：平面几何（自建引擎，零依赖）+ 立体几何（3D）
- **16 种作图工具**：选择 / 点 / 线段 / 直线 / 射线 / 圆 / 多边形 / 中点 / 交点 / 垂线 / 平行线 / 角 / **裁剪** / 文本 / **滑动条** / 删除
- **交点筛选**：两个对象有多个交点时（两圆、直线与圆、函数与轴），作图时弹出候选让你按方位指定取哪一个；画好后对象面板「交点」行也能随时切换取哪一支
- **动态演示（滑动条 + 自动播放）**：滑动条参数控件可拖动改值，驱动曲线、点坐标、圆半径实时联动；顶部「▶ 动画」可让滑动条自动播放（慢/中/快、往复来回、可多选同步），适合演示"a 变化时开口如何变化"
- **动态测量**：长度 / 半径 / 角度 / 两点距离、**滑动条参数值**，拖拽实时刷新
- **作图记录与回放**：每一步操作以中文列出，可逐步 / 变速重演绘制过程
- **画板设置**：坐标轴与网格显隐、三种背景色、新画的点自动对齐网格
- **嵌入到网页 / 笔记**：顶栏「嵌入」生成可粘贴的嵌入代码，图形保持可拖拽、滑动条可动；`iframe` 方式配合下载的自包含单文件 HTML，`JS 内嵌` 方式由本地运行时 `js/embed.js` 在原页挂载画板——两条路都不联网、不需要账号与 SDK Key
- **文件管理**：本地保存多个画板，卡片网格 + 自动缩略图，支持导入 / 导出 JSON 原文件、导出 PNG、导出 JPG、导出 SVG、**导出黑白试题图**、**导出离线 HTML**、**导出 LaTeX / TikZ**、**嵌入到网页 / 笔记**
- **离线 HTML 导出**：一键把画板打包成单个 HTML 文件（内嵌画板引擎与图形），双击即开、无需联网和账号，适合课件分发与离线环境
- **黑白试题图导出**：一键把当前图形导出为纯黑线条 + 白底的 PNG / SVG（彩色几何统一变黑、网格保留浅灰、文本黑色、去掉彩色填充），适合直接贴进试卷 / 打印，全程离线、无需联网与账号
- **LaTeX / TikZ 导出**：把图形翻译成 TikZ 画图语句，产出可直接编译的 `.tex`（或可粘贴的 `tikzpicture` 片段），矢量无损缩放，方便写论文、讲义与试卷；覆盖点（含标签）、线段 / 直线 / 射线、圆、多边形（含填充）、圆弧、角度标记、曲线与文本，坐标轴和网格跟随画板设置，另有黑白版可选。三种导出都是在本浏览器里即时算出来的，不联网、不需要账号
- **JPG 导出**：一键把当前图形栅格化为带白底的 JPG 图片（体积小，适合贴进 Word / 课件与网页），与 PNG 同源、全程离线、无需联网与账号
- **模板案例**：内置勾股定理、圆周角定理、将军饮马、一次 / 二次函数等 6 个经典模型，一键开始
- **多设备适配**：桌面 / 平板 / 手机，手机上 AI 面板收为底部抽屉

## 技术路线

内置两条路线，首页「新建画板」按钮直接选择：

| | 路线B · 自建画板（默认） | 路线A · SDK 编辑器 |
|---|---|---|
| 入口 | `board.html`（平面画板） | `editor.html`（立体/3D 画板） |
| 画板引擎 | **JSXGraph**（LGPL 开源，`vendor/` 本地加载，不依赖外网） | 大角几何开放 SDK（iframe 嵌入） |
| 依赖 | 无（不需要 appId、不需要对方服务器） | 需要 appId + 域名白名单 |
| AI | 免费 LLM（默认智谱 GLM-4.7-Flash，面板可切换） | 免费 LLM（同一套 Key） |
| 费用 | **托管免费 + LLM 免费额度** | 基础功能免费，对方平台高级能力计费 |

两条路线的 AI 共用同一个免费 LLM Key，分别对应两个端点（`/api/ai/board` 和 `/api/ai/run`）。

## 文件结构

```
├── index.html / js/landing.js / js/workbench.js / js/store.js   首页（hero/AI快建/模板）+ 工作台
├── js/templates.js                  内置模板与案例（6 个，命令协议）
├── board.html / js/board.js / js/executor.js    路线B：自建画板页 + 命令执行器
├── js/tools.js                      路线B：多步作图工具引擎（吸附/交点就近/取消清理）
├── editor.html / js/editor.js                   路线A：SDK 编辑器页
├── vendor/jsxgraphcore.js / jsxgraph.css        JSXGraph 引擎（本地化）
├── ai/
│   ├── models.js        免费模型清单（白名单，与 js/models.js 同步）
│   ├── board-prompt.js   路线B的 AI 系统提示词（命令协议）
│   ├── board-backend.js  路线B的 AI 后端核心（LLM→JSON 命令）
│   ├── system-prompt.js  路线A的 AI 系统提示词
│   └── ai-backend.js     路线A的 AI 后端核心（LLM→SSE 翻译层）
├── functions/api/ai/board.js   线上：路线B AI 入口（Cloudflare Pages Function）
├── functions/api/ai/run.js     线上：路线A AI 入口
├── server/local-proxy.mjs      本地：两个入口的零依赖 Node 代理
├── js/config.js                ★ 唯一可能要改的文件
├── js/models.js                前端模型下拉框清单（经典脚本）
└── css/style.css
```

## 快速开始（本地，5 分钟）

**1. 拿一个免费 LLM Key**（智谱，以下模型全部免费）

打开 [bigmodel.cn](https://bigmodel.cn) 注册 → 控制台 → 「API 密钥」→ 新建，复制那串 `xxx.xxx`。一个 Key 通用所有模型，模型在 AI 面板顶部的下拉框随时切换（默认 `glm-4.7-flash`）：

| 模型 | 类型 | 特点 |
|---|---|---|
| `glm-4.7-flash` | 文本 | 200K 上下文，最新最强，**默认** |
| `glm-4.6v-flash` | 视觉 | 128K，可上传图片按图复原图形 |
| `glm-4-flash-250414` / `glm-4-flash` | 文本 | 旧版，留着兼容 |

**2. 起静态服务 + AI 代理**（两个终端）

```bash
# 终端1：静态页
python3 -m http.server 8000

# 终端2：AI 代理（零依赖）
LLM_API_KEY=你的key node server/local-proxy.mjs
```

**3. 打开 http://localhost:8000** → 首页直接输入「画一个等腰直角三角形，标注三个顶点」→ 点「生成画板」直达画板；也可以从「模板与案例」挑一个一键开始。

> 本地模式下，把 `js/config.js` 里 `boardAiEndpoint` 的注释行切过去（指向 `http://localhost:8787/api/ai/board`）。

## 部署（Cloudflare Pages，免费）

仓库连着 GitHub，推代码即自动部署：

1. 代码 push 到 GitHub（Cloudflare Pages 项目已连接该仓库）
2. Pages 项目 → **设置 → 变量和密钥** → 添加：

   | 变量 | 值 | 必填 |
   |---|---|---|
   | `LLM_API_KEY` | 智谱 Key | ✓ |
   | `LLM_MODEL` | `glm-4.7-flash` | 否（有默认值，前端下拉框优先级更高） |
   | `LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 否 |
   | `JWT_SECRET` | 任意长随机串，如 `openssl rand -hex 32` | 启用登录必填 |
   | `DB` | D1 数据库绑定（见下） | 启用登录/云端必填 |
   | `ADMIN_EMAILS` | 逗号分隔的管理员邮箱，如 `a@x.com,b@y.com`；这些邮箱首次登录即获最高权限 | 否（不设则无管理员） |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 应用凭据 | 否（仅配置了才显示对应按钮） |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth 应用凭据 | 否 |
   | `WECHAT_APPID` / `WECHAT_APPSECRET` | 微信开放平台凭据 | 否 |
   | `QQ_APPID` / `QQ_APPSECRET` | QQ 互联凭据 | 否 |
   | `RESEND_API_KEY` | 邮件服务密钥（用于自动发送密码重置邮件） | 否（不配则重置链接直接在接口响应返回，由用户/管理员转达） |

3. 保存后 **重试部署**（环境变量不会自动应用到旧部署）
4. `js/config.js` 保持默认（`boardAiEndpoint: '/api/ai/board'` 同域）

3D 画板额外需要：`js/config.js` 填 appId + 大角控制台加域名白名单。

## 账号与云端同步（自建，零外部依赖，免费）

不想用第三方登录服务（Clerk/Supabase 等）也能拥有账号：**账号体系完全自建**，只用到你已经有的 Cloudflare 栈（Pages Functions + D1），不注册任何新账号、不产生额外费用。

**功能**：邮箱 + 密码注册登录（密码加盐哈希存储），登录后画板可备份到云端、跨设备同步。

**登录门禁**：首页与公开内容可免登录浏览；但新建/打开画板、云端同步、会员中心、激活码、第三方登录等核心功能**必须登录后使用**，未登录时点击会弹出登录框。画板页（`board.html`）对未登录用户显示全屏登录墙，登录后自动解锁。

**一键部署步骤**：

1. **建 D1 数据库**：Cloudflare 控制台 → Workers & Pages → **D1** → Create database（命名如 `zhihui_geo`，免费 5GB）。
2. **绑到 Pages 项目**：你的 Pages 项目 → **设置 → Functions → D1 bindings** → 添加绑定，变量名填 `DB`，选择上一步的库。
3. **设 JWT_SECRET**：Pages → 设置 → 变量和密钥 → 加一个 `JWT_SECRET`，值用 `openssl rand -hex 32` 生成（**只存 Cloudflare，不要写进代码**）。
4. **重试部署**（环境变量与绑定需重新部署才生效）。

> 数据库表（`users` / `boards` / `login_throttle`）会在首次访问登录接口时**自动创建**，无需手动跑 SQL；`auth/schema.sql` 仅供查阅或手动建表参考。

完成后首页右上角出现「登录」，注册即开通账号；画板页「同步到云端」、首页「云端画板」区即可使用。本地仍是工作副本，云端为备份/同步源——即便后端不可用，作图也不受影响。

实现位置：`auth/auth-backend.js`（密码哈希 + JWT + D1 操作）、`functions/api/auth/*`（注册/登录/登出/探针）、`functions/api/boards/*`（画板 CRUD）、`js/auth.js`（前端弹窗与同步）。

### 管理员（最高权限）

把站长/运营邮箱放进 `ADMIN_EMAILS`（逗号分隔）即可获得**最高权限**，无需改代码、无需数据库初始化脚本：

- 该邮箱首次登录（或 `ensureProfile` 时）会被自动把 `user_profiles.role` 提升为 `admin` 并落库，与 JWT 角色保持一致。
- 登录后导航菜单出现「管理后台」入口（直达 `admin.html`）。
- 管理后台可：① 一键**生成会员激活码**（默认 1 个、最多 50 个）；② 查看激活码列表与状态；③ 查看全部用户（邮箱 / 角色 / 会员 / 注册时间）。
- 后端 `functions/api/admin/*` 对每个请求都用 `resolveUser` + `isAdminEmail` 双重校验，非管理员返回 `403`。

### 会员制度与激活码

会员功能为**长期规划**（计划 2030 启用），但激活码体系现已就绪、现在就能激活：

- 管理员在后台生成激活码（`activation_codes` 表，含 `code` / 创建人 / 是否已兑换 / 兑换用户）。
- 用户在「会员中心」(`js/auth.js` 的 `openMembership`) 输入激活码 → `POST /api/membership/redeem` → 账号升级为**长期会员**（`membership='lifetime'`，写入 JWT 与 `user_profiles`），并立即重签 Cookie 让会员态生效。
- 会员态在前端由 `Auth.user.membership === 'lifetime'` 驱动（如导航 VIP 徽标）；后续 2030 启用会员权益时直接读取该字段即可。

### 第三方登录（通用 OAuth 框架）

内置通用 OAuth 2.0 流程，支持 Google / GitHub / 微信 / QQ 四家，按「有没有配凭据」决定是否显示按钮——**未配置任何 OAuth 凭据时，登录框不展示第三方按钮，界面零暴露**。

- 授权跳转：`GET /api/auth/oauth/<provider>` → 生成 `state` 写入 HttpOnly Cookie 防 CSRF → 302 到服务商授权页。
- 回调：`GET /api/auth/oauth/callback/<provider>?code=&state=` → 校验 `state` 防 CSRF → 换令牌 → 建/关联账号 → 下发本站 `auth_token` Cookie → 跳回首页（`?oauth=success`）。
- 已启用列表：`GET /api/auth/oauth-providers` 仅返回已配 AppID/Secret 的提供商，前端据此渲染按钮，密钥永不进浏览器。
- 首次用某 OAuth 账号登录会自动建本站账号（邮箱取自服务商返回，缺失则生成占位邮箱）；同一邮箱再次登录自动关联。

### 找回密码（重置链接方案）

不依赖任何邮件服务也能找回：

1. 登录框点「忘记密码」→ `POST /api/auth/forgot-password {email}` → 后端生成一次性重置令牌（`password_resets` 表，30 分钟有效）并**直接在响应里返回重置链接** `reset.html?token=...`。
2. 打开该链接填新密码 → `POST /api/auth/reset-password {token, newPassword}` → 校验后更新密码、使所有旧会话失效，并直接下发新 Cookie 完成登录。
3. 配置 `RESEND_API_KEY` 后可改为真发邮件（接口结构不变，仅把返回链接改为投递邮件）。

> 当前为「重置链接」方案：链接由调用方（用户自己或管理员）复制转达给本人，便于无邮件基础设施也能跑通；页面 `reset.html` 仅消费 `?token=`。


## AI 命令协议

AI 输出 `{"message": "...", "commands": [...]}`，前端 `js/executor.js` 逐条翻译成 JSXGraph 调用：

| 命令 | 说明 |
|---|---|
| `clear` | 清空画板 |
| `point` `{id,x,y,fixed?}` | 点（默认可拖拽） |
| `segment` `{id,from,to}` / `ray` / `line {through:[A,B]}` | 线段/射线/直线 |
| `circle` `{center,through｜radius}` | 圆 |
| `polygon` `{points:[A,B,C]}` | 多边形 |
| `midpoint` / `intersect` / `glider` | 中点/交点/动点（依赖对象） |
| `arc` `{center,from,to,clockwise?}` | 圆弧（以 center 为圆心，从 from 点扫到 to 点；直径两端 = 半圆） |
| `perpendicular` / `parallel` | 垂线/平行线 |
| `function` `{expr,from,to}` | 函数曲线（`x^2`、`sin(x)`），表达式里可直接写滑动条名字 |
| `slider` `{min,max,value?,step?,x1,y1,x2,y2?}` | **滑动条**参数控件：用户拖动改值，可驱动几何体实时变化 |
| `text` `{id,x,y,text}` | 自由文本 |
| `text` `{id,x,y,bind:{kind,of}}` | 动态测量文本（kind: distance 两点距离 / length 线段长 / radius 圆半径 / angle 角度 / value 参数值），拖拽实时刷新 |
| `angle` / `label` / `style` | 角/标签/样式 |

协议全量定义在 `ai/board-prompt.js`（提示词）和 `js/executor.js`（执行器）中。

### 滑动条与动态演示

工具条「滑动条」按钮点击画板即可放置，输入一行 `最小值 最大值 步长`（如 `-2 6 0.5`，步长省略表示连续）。滑动条 id 优先用单个小写字母（`a`/`b`/`k`…），这样它能直接参与联动：

```json
{"op":"slider","id":"a","min":-3,"max":3,"value":1,"step":0.1}
{"op":"function","id":"f1","expr":"a*x^2","from":-5,"to":5}
{"op":"point","id":"P","x":"a","y":0}
{"op":"circle","id":"c1","center":"O","radius":"a"}
{"op":"text","id":"t1","x":-8,"y":-7,"bind":{"kind":"value","of":"a","prefix":"a = "}}
```

- 拖滑块 → 曲线、依赖点、圆半径、绑定的文本全部实时重算。
- 点的 `x`/`y`、圆的 `radius` 写滑动条 id 即建立依赖；函数表达式里直接写名字。
- 依赖点不参与拖拽存坐标；滑动条的当前值随 `moves` 一起持久化，重新打开文件时图形还原到最后状态。
- 删掉滑动条会级联删除依赖它的对象（含表达式里引用它的曲线），避免悬空引用导致画板报错。
- **自动播放**：顶部「▶ 动画」→ 选滑动条（或"全部同步"）→ 播放，慢/中/快三档速度与"往复"开关；手动拖滑块会自动暂停。动画只改画面上的当前值，不写入保存的数据，刷新后回到保存值。

文件保存格式：`{name, commands[], moves[]}`——commands 是作图命令（重放即还原），moves 记录自由点拖拽后的坐标**和滑动条当前值**。

## 画板交互（路线B）

- **自动吸附**：画线段/圆/中点时，点已有对象上的点会复用该点（而不是新建）；
- **分段裁剪**：「裁剪」工具先点一条线/圆，再在它上面点两点——圆变成两点间的弧、线变成两点间的子线段（裁剪点是对象上的动点，会随原对象动态变化），原对象自动隐藏、可在对象面板恢复显示，无需重画；
- **交点就近**：交点工具自动选取离点击位置近的那个交点；
- **选中高亮**：选择工具点对象即橙色高亮——点类对象外描一个空心圆环（屏幕像素固定、跟随拖拽、删点自动消失），线/面类对象（含多边形三条边）整体变为选中色，取消选中后恢复原色；
- **级联删除**：删除对象时，依赖它的对象一起删除（如删点会删掉以它为端点的线段）；
- **右键菜单**：右键对象 → 重命名 / 颜色 / 线宽 / 虚线点线 / 显隐 / 测量 / 删除；
- **对象面板**：AI 面板切到「对象」tab → 列表（眼睛显隐、删除）、属性编辑（颜色/线宽/线型/改名），属性区「构造」行显示该对象由哪条命令产生；
- **动态测量**：右键或对象面板「测量」→ 长度/半径/角度/两点距离，文本随拖拽实时刷新。

**快捷键**：`Ctrl+Z` 撤销 / `Ctrl+Y`（或 `Ctrl+Shift+Z`）重做 / `Ctrl+S` 保存 / `Delete` 删除选中 / `Esc` 取消当前作图 / `Enter` 结束多边形。AI 作图整批算一步撤销，逐条执行、肉眼可见过程。

**作图记录 / 回放**：AI 面板切到「记录」tab，每一步作图命令都以中文列出（如「绘制点 P1 (0, 0)」「连接线段 s4：P1 — P3」「绘制圆 c6：圆心 P1，经过 P5」）。

- 点「进入回放」后逐步重演：`上一步/下一步`、点击任一步骤跳转、`播放/暂停`（0.5×～4× 速度）；
- 回放中 `←/→` 单步、`空格` 播放/暂停、`Esc` 退出；此时编辑类操作（撤销/删除/AI/保存）全部禁用，避免破坏重演；
- 退出后自动恢复完整图形（含拖拽后的坐标），不产生新的撤销记录；
- 记录数量实时显示在 tab 徽标上；AI 批量生成的每条命令也是一步。

## 多设备适配

- **桌面**：画板在左、AI 面板在右，模板 3 列、快速入门 4 列、「我的画板」卡片网格自适应列数。
- **平板**（≤1024px）：模板/步骤自动降为 2 列。
- **手机**（≤860px）：AI 面板收成底部抽屉，点右下角「AI 作图」按钮唤出；顶栏与工具条自适应收窄/横滑；模板单列、主按钮纵向排列、画板卡片 2 列。
- 首页 hero 的 AI 输入框在手机上同样可用（Enter 直接生成）。
- 首页「我的画板」每张卡片带真实缩略图：由保存的作图命令实时推算（点/线/圆/多边形按比例缩放绘制），3D 与空画板有占位符。

## 常见问题

- **AI 面板报错「LLM_API_KEY 未配置」**：环境变量没配或没重试部署。
- **AI 回复了但不作图**：看浏览器 Console；后端对模型输出做了多层容错提取（代码围栏 / 裸 JSON / 多候选 / 截断修复 / 命令级打捞），输出不完整也会尽量救回已完成的部分；极端情况会提示重试，换一种描述即可。
- **想换模型**：AI 面板顶部的下拉框直接切（glm-4.7-flash / glm-4.6v-flash / glm-4-flash-250414 / glm-4-flash，全部免费，选择会记住）；也可以环境变量设 `LLM_MODEL` 改默认。
- **上传图片按图复原**：下拉框切到「GLM-4.6V-Flash（视觉）」→ 点「📷 图片」选图（≤5MB）→ 可附加文字说明 → 生成。视觉模型会先看图再输出作图命令。
- **3D 画板打不开**：appId 未配或域名没加白名单（3D 是路线A，需要对方平台）。
- **换浏览器/清缓存文件会丢**：文件默认只在 localStorage；开通账号后可用「同步到云端」把画板备份到 D1，换设备登录即可取回，重要画板也建议「导出 JSON」双保险。
- **想把画板发给别人 / 离线打开**：顶栏「导出离线 HTML」——下载到的是一个自包含单文件（约 1 MB，内嵌 JSXGraph 引擎和当前图形），拷到任何电脑上双击就能打开，图形照样可以拖拽，不依赖网络、服务器和账号。
- **想把画板嵌进自己的网页 / 课件 / 笔记**：顶栏「嵌入」——选 `iframe`（通用，配合同目录下那份自包含 HTML）或 `JS 内嵌`（数据内联 + 本地运行时 `js/embed.js` 原页挂载），生成带宽高设置的可粘贴代码，复制即可；运行时只需三个静态文件：`js/embed.js`、`js/executor.js`、`vendor/`（含 `jsxgraphcore.js` 与 `jsxgraph.css`），没有 CDN、没有账号、没有 SDK Key。

### 嵌入用法示例

```html
<!-- 方式一：JS 内嵌（本地运行时原页挂载，数据内联） -->
<div class="zhihui-board-embed" data-zhihui-board data-zhihui-title="勾股定理" style="width:100%;height:480px">
  <script type="application/json">{"name":"勾股定理","commands":[{"op":"point","id":"A","x":-4,"y":-2}],"moves":[]}</script>
</div>
<script type="module" src="js/embed.js"></script>

<!-- 方式二：iframe（指向同目录下的自包含单文件） -->
<iframe src="勾股定理.html" title="勾股定理" loading="lazy"
        style="width:100%;max-width:100%;height:480px;border:1px solid #e5e7eb;border-radius:12px;background:#fff"></iframe>
```

容器还支持 `data-zhihui-src="boards/xxx.json"`（数据放外链文件、页面更轻）与 `data-zhihui-credit="off"`（不显示署名）；运行时 API 为 `window.ZhihuiBoard.mount(容器, 数据)` / `ZhihuiBoard.autoMount()`。

## 开源致谢

- [JSXGraph](https://jsxgraph.org)（LGPL）——路线B 画板引擎
- 大角几何开放 SDK（Apache-2.0）——路线A 画板引擎

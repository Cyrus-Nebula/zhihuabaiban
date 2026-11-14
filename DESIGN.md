# 设计系统（Design System）

> 本文件是智绘几何视觉规范的单一事实源。任何 UI 改动（人工或自动 Agent）都必须遵守；
> 2026-10-26 全站改版已按此落地，2026-10-27 品牌色升级为新 logo（圆规）靛紫渐变系，后续迭代在此基础上增量修改，不要回退。

## 2026-11 界面改版 v3（当前生效，覆盖 v2 的色彩 / 圆角 / 首屏条目）

改版目标：v2 把画板做成了紧凑的工具，v3 让首页有「平台感」。参考支付宝 AI 付的平台页语言，但只借版式与配色，不堆光晕、不写空话。画板内部保持 v2 的 200 / 1fr / 320 三栏密度，不跟着首页放大。实现集中在 `css/redesign.css` 末尾的 v3 层（开关为 `<html class="ui-v3">`）与 `js/site-improve.js` 末尾的独立增强层 IIFE；删除 `redesign.css` 的 link 即整体回滚，去掉 `hero-centered` 类即回到 v2 首屏。

| 项 | v2（历史） | v3（当前） | 原因 |
|---|---|---|---|
| 页面底色 | `#F2F2EC` 纸白 | `#FFFFFF` 纯白 | 首页要像平台，不再像纸张 |
| 品牌深色 | 墨黑 `#191A1C` | 海军蓝 `#002B66` | 深色区、数据数字、标题高亮承担品牌 |
| 强调色 | 蓝笔 `#2B4C9B` | `#1677FF` 只用于可点 / 画布点 | 蓝色不做大面积背景 |
| 冰蓝 | 无 | `#EEF4FA` / `#DBE8F4` | 产品卡、开源区、标题色块 |
| 主按钮 | 3px 小圆角墨黑 | 999px 黑胶囊（画板内仍 6px） | 营销区与工具区区分语言 |
| 圆角 | 3–5px | 产品卡 18px / 大面板 24px / 登录 24px | 平台卡片感 |
| 首屏 | 左右双栏 | 居中两行 48px 标题 + 1080 宽画板 | 一眼看到画板，1440×900 内可见底边 |
| 首页内容 | 快速入门 / 模板 / 文件 / 关于 | 追加数据条、四张产品卡、深蓝本机区、对比表、开源区 | 讲清「能交付什么」 |
| 画板 AI | 只有作图 | 增加「作图 / 查询」两段，查询只读 | 把 `board.js` 已有的 `inspect` 能力暴露出来 |
| 登录 | 4px 小卡片 | 420px / 24px 居中卡片 + 淡蓝光晕 | 与平台语言一致 |

**保留不改**：v2 三栏画板、16 工具 DOM 与全部 `id` / `data-*`、文件行、导出算法、对象模型、Supabase 配置、`js/board.js` 与 `js/auth.js` 的业务逻辑。查询模式只通过 `window.__dajiao.executor` 调用只读 `inspect` 命令，不调用任何构造接口，不改 `doc.commands`。

**明确不做**：不新增图片 / JS 库 / 构建工具；不写无法核实的数字（统计卡数字取自 localStorage 与真实 DOM）；设计稿原型里的「平面/立体分段控件」与「底部状态条」在真实站点无对应 DOM，前者改用既有 `.obj-seg` 的胶囊样式，后者只展示真实对象数与静态设置说明，不伪造坐标与缩放值。

**与旧条目的冲突处理**：下文及 v2 章节中凡涉及主色、页面底色、圆角、按钮形态、首屏布局的条目，一律以本表为准；其余（图标 `stroke-width`、装饰 SVG `aria-hidden`、动效缓动、制图纸线感、红色测量标注）继续有效。旧内容完整保留，仅作历史记录。

**实施记录**：基线 `54a4052`（v2 已合并）；T00–T08 逐项验收见交付目录 `tasks-v3.json`。

**2026-11-14 首页文案校正（只改文字，不动 DOM 结构 / CSS / JS）**：v3 首页沿用了设计稿的营销措辞，与当前站点的登录门禁、手动同步、导出实现不一致。按可核验的代码事实逐条改写，避免首页承诺网站没有的能力。

| 位置 | 原措辞 | 真实依据 | 校正后 |
|---|---|---|---|
| 首屏 note | 不用注册 | `js/landing.js` 的 `Auth.requireLogin(heroAiGenerate)`；`board.html` / `board3d.html` 全屏 `.login-wall` | 免费账号登录 |
| 深蓝本机区 | 没有账号也能画 / 不上传到服务器 | 登录墙；`js/site-improve.js` 的「保存并同步」闸门：本地自动保存，云端只在点击后上传 | 登录免费账号后即可作图；同步由你决定 |
| 对比表 ① | 可以，直接画 | 新建 / 打开画板 / 模板均经 `Auth.requireLogin`（`js/workbench.js`、`js/landing.js`） | 也要登录：免费账号，画板页有登录墙 |
| 对比表 ② | 每个点、线都是对象 | `js/board.js`：`doc = {name, commands, moves}` 存 localStorage；导出 / 导入 JSON 重放命令；PNG / SVG 为定稿图片 | 工程可继续编辑，导出 JSON 可再导入 |
| 对比表 ③ | 黑白试题图，一步导出 | `board.html` 的 `btn-export-bw-png` / `btn-export-bw-svg`，只导出图形、不含题文 | 黑白试题图 PNG / SVG 一键导出，题文另排 |
| 对比表 ④ | 本机浏览器，可选同步 | localStorage + 登录后 `Auth.syncBoard`（`site-improve.js` 手动触发） | 本机 localStorage，登录后可手动同步 |
| 云端空状态 | 画板页会自动备份 | 自动云端上传已被 `board:saved` 闸门拦截 | 在画板页点「保存并同步」 |

表格行数 / 列数 / class 与 CSS 一律不变；第一行右列去掉 `.yes` 蓝色强调，避免把「必须登录」写成卖点。深蓝区 `1.8 MB` / `0` 是设计稿静态示意数字，本次未改（如需展示真实占用，应接 localStorage 用量）。

**2026-11-14 首页精简（删深蓝本机区 + 对比表，开源区拆到开放平台页 `open.html`）**：用户反馈首页面向老师、内容过多，图1（深蓝本机区）、图2（对比表）两块价值低、可整段不出现。据此删除「深蓝本机区（`#local`）」与「对比表（`#compare`）」两个 `<section>`；原「开源区（`#opensource`）」不再内联 MIT / 本地优先 / AI 密钥 三栏长文，改为一行浅色卡片 + 「开放平台 ↗」按钮，跳转新建的 `open.html`（线上即 `geora.de5.net/open`）。`open.html` 承接三栏与「自己部署 / 依赖与协议」两节编号步骤，footer 标注立体画板为自研引擎。`css/redesign.css` 同步移除 `.v3-navy-band` / `.v3-compare` 死代码，新增 `.v3-open-link`（首页入口）与 open 页 `.v3-open-cta` / `.v3-sub` / `.v3-steps` 样式；open 页不加载 `landing.js` / `workbench.js` / `templates.js`（无对应 DOM），两页 1440 / 390 双档验收 0 控制台报错、0 横向溢出。

---

## 2026-11 界面改版 v2（历史版本，2026-11-13；v3 在其之上叠加）

改版目标：从「设计作品」回到「老师每天打开干活的真实教学软件」。中性纸白、系统无衬线、黑色主按钮、表格与文件行，减少卡片与装饰。实现集中在 `css/redesign.css`（在 `style.css` / `unslop.css` / `site-improve.css` **之后**引入），删除该 `<link>` 即可回滚；不改动任何 `id` / `data-*` / `js/*.js` 业务逻辑。

| 项 | 旧（2026-10，历史） | 新（v2，当前） | 原因 |
|---|---|---|---|
| 主色 | `#6549d5` 品牌紫 | `#2B4C9B` 蓝笔色 | 只用于链接、选中、当前工具、画布上的点；不再做主按钮 |
| 页面底色 | `#f5f6f8` 冷灰 | `#F2F2EC` 中性纸白 | 去掉暖米色「作品集」感，减少冷灰的 SaaS 感 |
| 主按钮 | 品牌紫 / 渐变 | `#191A1C` 墨黑 | 一屏只留一个强操作 |
| 标题字体 | Manrope / 衬线 | 系统无衬线 600 | 更像软件，不像杂志；Manrope 可继续加载但不作标题 |
| 圆角 | 16px | 3–5px | 接近工具，而非消费级 App |
| 卡片 | 三列网格 | 两列文件行 | 提高信息密度，减少滚动 |
| 画板布局 | 单行横排工具条 | 200 / 1fr / 320 三栏工具轨 | 左工具、大画布、右检查器 |
| 顶栏 | 44px 对齐块 | 48px / 28px 按钮 | 信息密度对齐工具软件 |

**保留不改**：制图纸线感、红色测量标注、等宽数字、左侧工具轨、三栏画板、16 种几何工具字形、全部功能与导出算法。

**明确不做**：不改画板引擎 / 对象模型 / 导出算法 / Supabase 配置；不引入 React / Vue / Tailwind / 构建工具；不做暗色主题；不新增字体 CDN。

**与旧条目的冲突处理**：下文「字体 / 色彩 / 间距 / 圆角 / 字号 / 图标 / 动效」章节中，凡涉及**主色、页面底色、标题字体、圆角、卡片形态**的条目，一律以本表为准；其余（图标 `stroke-width`、装饰 SVG `aria-hidden`、动效缓动等）继续有效。旧内容完整保留，仅作为历史记录，供追溯改版前的决策。

**实施记录**：见 `docs/` 下改版验收材料；`tasks.json` 的 T00–T10 为逐项验收清单。2026-11-13 首次落地。

---

## 以下为历史规范（2026-10，色彩 / 字体 / 圆角条目已被上方 v2 覆盖）

## 字体

- 中文/UI：**Manrope**（fontsource CDN 加载，`--font-sans` 定义在 `css/style.css`），回退 `-apple-system / PingFang SC / Hiragino Sans GB / MiSans / Microsoft YaHei`
- 禁用 Inter / Roboto / Arial 作为主字体
- 数字/代码场景可用等宽字体回退，不强制引入新 CDN
- 全站**无斜体**；字重 ≤ 700

## 色彩

- **品牌色取自 logo（圆规）渐变**：靛蓝 `#3E44D9` → 紫罗兰 `#6549D5` → 紫 `#9444DA`
- UI 令牌（`css/style.css`）：`--primary: #6549d5`（渐变中值，白底对比度约 5.8:1）、`--primary-hover: #5a41c4`、`--primary-soft: #f0effc`、`--primary-soft-border: #d8d3f5`、`--primary-ink: #4c3dbe`
- 几何图形默认色：点/线 `#3E44D9`（品牌靛蓝）；函数曲线默认红 `#C62828`（数学教学惯例，保留）；分类色板 `OBJ_COLORS` 首位为品牌靛蓝；多边形填充默认 `#C7D2FE`
- 深色仅允许：`#000000 / #181818 / #1F1F1F / #272727 / #313131 / #131209`
- 页面背景：**平铺浅灰** `--bg`（≈`#f5f6f8`），不得用渐变背景
- **渐变只允许两处**：① hero 标题 `linear-gradient(90deg,#000000,#666666)`（background-clip:text）；② logo 品牌标记本体（导航 SVG 与 favicon，属品牌资产非界面装饰）
- 选中/激活态一律用品牌靛紫系；选中高亮 `SEL_COLOR = #3E44D9`；禁止旧青绿 `#01b88b/#0E9F9F/#34C759` 与旧蓝 `#1565C0/#eff6ff` 残留
- 涨红跌绿等金融场景不适用本站（非金融产品）

## 间距 / 圆角 / 字号

- 间距刻度：0 / 2 / 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96
- 圆角仅用 Tailwind 刻度（2/4/6/8/12/16/999）；嵌套圆角公式 inner = outer − gap，且 gap < 32px 时结果须 > 2px
- 字号对齐 Tailwind 刻度；不在刻度上的值下沉到最近下一档

## 图标

- Phosphor / Solar / Iconamoon 风格；内联 SVG `stroke-width` 统一 **1.8**（logo 除外）
- 装饰性 SVG 必须 `aria-hidden="true"`

## 动效

- 缓动：`cubic-bezier(0.32, 0.72, 0, 1)`（`--ease`）
- 微交互 ≥ 200ms（`--dur-micro`）；面板/容器过渡 500ms（`--dur-surface`）
- 滚动渐升入场：800ms + IntersectionObserver，`[data-reveal]` 由 JS 运行时打标（无 JS 不白屏）
- 汉堡菜单：双线旋成 X（`.nav-toggle-line` + `aria-expanded`）；移动端全屏毛玻璃菜单
- `prefers-reduced-motion: reduce` 时必须直接显示，不得留隐藏态
- `100vh` 一律写 `100dvh`

## 交互状态

- 所有可交互元素必须具备 hover / active / focus-visible 三态
- `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` 全局生效，不得移除
- `:active { transform: scale(.96) }` 为全局按压反馈

## 组件基线

- 加载态用**骨架屏**（`.skel-board`），不用旋转 spinner
- 空状态（`.empty`）、错误态（`.error-mask`）必须面向用户给可操作建议
- 弹层/菜单打开时 `aria-expanded` 同步；Esc 可关；点空白处可关

## 账号与云端（Supabase 托管）

> 账号体系由 **Supabase** 托管（Auth + Postgres + RLS），与 Cloudflare 解耦。详见 `js/supabase-config.js`、`js/auth.js`、`supabase/setup.sql`。

- **登录方式**：邮箱 + 密码，由 Supabase Auth 托管密码哈希与会话；可选开启 Google / GitHub 第三方登录（`signInWithOAuth`）。
- **登录态**：Supabase 签发会话（access + refresh token），前端 `supabase-js` 自动管理并持久化到 localStorage；`onAuthStateChange` 同步给前端 `Auth`，`Auth.me()` 读取当前 `profiles` 行（角色 / 会员）。
- **权限模型**：表级由 RLS 兜底——`boards` 仅本人可读写；`activation_codes` 客户端完全不可直读。高权限操作走数据库 `SECURITY DEFINER` 存储过程（`redeem_activation_code` / `admin_*` / `delete_self_account`），每个管理员过程内首行 `if not public.is_admin() then raise exception 'forbidden'` 守卫。
- **管理员判定**：`admin_emails()` 白名单（默认含 `3616927242@qq.com`）；`handle_new_user` 触发器在注册时按名单把 `profiles.role` 置为 `admin`。也可用 `set_admin('邮箱')` 提存量账号。
- **账号自管理**（已登录下拉菜单）：`修改密码`（`updateUser`）、`删除账号`（调用 `delete_self_account` → 级联删 `profiles` / `boards`），改密即所有旧会话失效。
- **密钥边界**：`SUPABASE_URL` + anon key 写进前端 `js/supabase-config.js`（可公开，靠 RLS 兜底）；`service_role` 仅存 Supabase 侧、**不进仓库、不进 Cloudflare 环境变量**。会员/管理算法在数据库存储过程里，仓库保持 public 也不暴露。
- **画板云端存储**：Supabase Postgres `boards` 表，以 `user_id` 做账户隔离；本地 localStorage 仍是工作副本，云端为备份/同步源。
- **容错**：Supabase 未建表 / 网络不可达时，登录相关功能不可用并给出友好提示；登录态探测失败按未登录处理。
- **登录门禁**：首页与公开内容可免登录浏览；新建/打开画板、云端同步、会员中心、激活码、第三方登录等核心功能**须登录后使用**。前端拦截由 `js/auth.js` 的 `Auth.requireLogin(cb)`（未登录先弹登录框、登录成功再执行回调）实现；画板页 `board.html` 对未登录用户显示全屏 `.login-wall` 覆盖层，订阅 `Auth.onChange` 在登录后自动隐藏。
- UI 令牌沿用品牌色（`--primary` 系）；登录弹窗、导航用户态、云端列表、会员中心、OAuth 按钮、登录墙、管理后台样式见 `css/style.css` 末尾「账号登录 / 云端画板」段落。

### 会员与激活码

- 激活码由管理员在后台生成（`activation_codes` 表），由 `admin_create_codes(n)` 存储过程批量生成随机码（去除易混字符 I/O/0/1），字段含 `code` / 类型 / 创建人 / 是否已兑换 / 兑换用户。
- 用户在「会员中心」(`js/auth.js` 的 `openMembership`) 输入激活码 → `rpc('redeem_activation_code', {p_code})` → 账号 `membership` 置为 `'lifetime'`，会员态立即在前端生效。兑换校验（有效性 / 是否已用 / 是否已停用）全在 `redeem_activation_code` 存储过程内完成。
- 前端会员态由 `Auth.user.membership === 'lifetime'` 驱动（导航 VIP 徽标等）；会员权益作为长期规划（计划 2030 启用），届时直接读取该字段即可。

### 管理员权限

- 管理员由 `supabase/setup.sql` 的 `admin_emails()` 白名单决定（或 `set_admin('邮箱')` 提存量账号），非环境变量。
- 新用户注册时 `handle_new_user` 触发器按名单自动把 `profiles.role` 提升为 `'admin'` 并落库。
- 管理后台 `admin.html` 调用 `Auth.me()` 校验 `role==='admin'`，非管理员显示拦截页；面板经 `Auth.admin*` 接口调用 `admin_*` 存储过程：生成/列出激活码、列出全部用户（邮箱/角色/会员/注册时间）。

### 第三方登录（Supabase Auth Providers）

- 走 Supabase 原生 Provider，本期支持 **Google / GitHub**（微信 / QQ 暂未接入）。`oauthEnabled` 由 Supabase 侧是否已启用该 Provider 决定，前端据此渲染按钮——**未启用任何第三方时不显示第三方按钮**，密钥不进浏览器。

### 找回密码

- Supabase Recovery 流程：`resetPasswordForEmail(email)` 由 Supabase 向用户邮箱发带 `token_hash` 的重置链接（指向 `reset.html`）；页面用 `token_hash` + `type=recovery` 兑换临时会话后 `updateUser({ password })` 设新密码，改密即旧会话失效。

## 平台硬约束（改动前必读）

- **JXGraph 标签定位修复**：`css/style.css` 中 `.board-box > div:not(.JXGtext):not(.JXGinfobox)` 规则与 `.JXG_navigation{display:none!important}` 是 1.14 标签全不可见 bug 的修复，**原样保留，禁止删除或改选择器**
- 导航 `.site-nav` 的毛玻璃必须挂在 `::before` 伪元素上：`backdrop-filter` 直接挂在元素上会成为 `position:fixed` 子元素的包含块，导致移动端全屏菜单被限制在导航条内
- 数据**本地优先**：默认只存 localStorage，不上传服务器；账号/云端为**可选增强**（自建，零外部付费服务）。**登录门禁**：首页与公开内容可免登录浏览，新建/打开画板、云端同步、会员中心、激活码、第三方登录等核心功能须登录后使用（前端 `Auth.requireLogin` 拦截 + 画板页全屏登录墙）。

## 提交前自测清单

1. 桌面 + 390px 移动两种视口截图
2. 控制台/errors 无新增报错
3. 画板页 JXGraph 标签可见（`.JXGtext` 元素 offsetParent 非空）
4. 汉堡菜单开合、Esc 关闭、滚动高亮正常
5. `prefers-reduced-motion` 下内容直接可见

## 决策记录 · 免费模型全接入（2026-11-14）

- **目标**：智谱普惠免费档全部 8 款模型在站点内可调用；原有的 `glm-4-flash` 继续保留兼容，合计 9 款。
- **分类是硬约束，不是偏好**：`glm-4.7-flash` / `glm-4.5-flash` / `glm-4-flash-250414` / `glm-4-flash` / `glm-4.6v-flash` / `glm-4.1v-thinking-flash` / `glm-4v-flash` 走 `/chat/completions`；`cogview-3-flash` 走 `/images/generations`，`cogvideox-flash` 走 `/videos/generations` 且必须经 `/async-result/{id}` 轮询。**生成模型不进作图下拉框**——端点与返回结构都不同，混用必然报错。
- **单一事实源**：`ai/models.js` 导出 `FREE_MODELS`（对话）+ `GENERATION_MODELS`（生成）与两类 `resolve*()`；`js/models.js` 只做前端镜像，并另挂 `window.DAJIAO_GENERATION_MODELS`。后端三条链路 `/api/ai/run`、`/api/ai/board`、`/api/ai/generate` 都从同一份白名单校验，非法 id 不静默生效。
- **新增链路不改旧链路**：`ai/generate-backend.js` 与既有 `ai-backend.js` / `board-backend.js` 并列、零 import 交叉；`ai/board-backend.js` 与 `board.html` 仅把写死单一视觉模型名的两句提示改为「名称里带视觉」，其余逻辑逐字不动。
- **UI 边界**：新增独立页 `generate.html`（`/generate`），极简白底、只有模型/描述/生成/结果，顶栏只有品牌与「返回首页」，**不出现工作台按钮**（＋ / 登录 / 菜单 / 帮助），不引入 `site-improve.js`，不依赖登录，不往首页和画板页加任何可见入口。老师用的页面保持简洁。
- **密钥与错误**：`LLM_API_KEY` 只在服务端环境变量或本地代理使用，与作图链路共用；`GENERATION_BASE_URL` 可单独覆盖生成端点前缀。429 / 401 / 403 转成中文可操作提示，上游原始 JSON 不返回浏览器。
- **并发**：免费档并发 1，视频采用 5 秒间隔轮询、最多 60 次，前端用递增序号隔离旧轮询，切换模型或重新生成不会串结果。

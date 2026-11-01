# 设计系统（Design System）

> 本文件是智绘几何视觉规范的单一事实源。任何 UI 改动（人工或自动 Agent）都必须遵守；
> 2026-10-26 全站改版已按此落地，2026-10-27 品牌色升级为新 logo（圆规）靛紫渐变系，后续迭代在此基础上增量修改，不要回退。

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

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

## 账号与云端（自建，零外部依赖）

> 账号体系完全自建，**不依赖 Clerk / Supabase 等任何第三方服务**。详见 `auth/auth-backend.js`、`functions/api/auth/*`、`functions/api/boards/*`、`js/auth.js`。

- **登录方式**：邮箱 + 密码。密码用 `PBKDF2-HMAC-SHA256`（10 万次迭代 + 16 字节随机盐）加盐哈希，存储格式 `pbkdf2$<iters>$<salt>$<hash>`；服务端不保存明文；密码长度限定 8–200 位。
- **登录态**：登录/注册成功后服务端签发 **HS256 JWT**，写入 `HttpOnly + Secure + SameSite=Lax` 的 `auth_token` Cookie（有效期 30 天）；前端不持有令牌，仅通过 `/api/auth/me` 探测登录态。
- **令牌版本（主动吊销）**：`users.token_version` 随改密/删号自增；`resolveUser` 校验 JWT 内 `tv` 与库内一致，不一致即视为失效 → 改密/删号后所有旧会话立即掉线（无状态 JWT 的集中吊销手段）。
- **防爆破限流**：`login_throttle` 表按「邮箱 + 访问 IP」双桶计数（仅对真实存在的邮箱计邮箱桶，避免对未注册邮箱做锁死 DoS）；连续失败 5 次锁定 30 分钟，触发时登录返回 `429 + Retry-After`，前端按钮进入倒计时。
- **账号自管理**（已登录下拉菜单）：`修改密码`（验旧密 → 改哈希 → 令牌版本 +1 → 重签 Cookie，本设备保持登录）、`删除账号`（验密 → 删该用户全部画板与账号 → 清 Cookie 登出）。因无邮件服务，改密是找回访问的唯一自助途径。
- **密钥**：`JWT_SECRET`（Pages → Settings → Environment variables 配置，任意长随机串，如 `openssl rand -hex 32`）。用于签发/校验 JWT，**切勿提交进仓库**。
- **画板云端存储**：Cloudflare D1（绑定变量名 `DB`，建表见 `auth/schema.sql`）。`boards` 表以 `user_id` 做账户隔离；本地 localStorage 仍是工作副本，云端为备份/同步源（`Store.upsert` 保持 id 一致）。
- **容错**：后端未部署 / D1 未绑定时，登录相关功能不可用并给出友好提示；登录态探测失败按未登录处理。
- **登录门禁**：首页与公开内容可免登录浏览；新建/打开画板、云端同步、会员中心、激活码、第三方登录等核心功能**须登录后使用**。前端拦截由 `js/auth.js` 的 `Auth.requireLogin(cb)`（未登录先弹登录框、登录成功再执行回调）实现；画板页 `board.html` 对未登录用户显示全屏 `.login-wall` 覆盖层，订阅 `Auth.onChange` 在登录后自动隐藏。
- UI 令牌沿用品牌色（`--primary` 系）；登录弹窗、导航用户态、云端列表、会员中心、OAuth 按钮、登录墙、管理后台样式见 `css/style.css` 末尾「账号登录 / 云端画板」段落。

### 会员与激活码

- 激活码由管理员在后台生成（`activation_codes` 表），字段含 `code` / `created_by` / `redeemed` / `redeemed_by` / `redeemed_at`。
- 用户在「会员中心」(`js/auth.js` 的 `openMembership`) 输入激活码 → `POST /api/membership/redeem` → 账号 `membership` 置为 `'lifetime'`（同时写 JWT 与 `user_profiles`），并立即重签 Cookie 使会员态生效。
- 前端会员态由 `Auth.user.membership === 'lifetime'` 驱动（导航 VIP 徽标等）；会员权益作为长期规划（计划 2030 启用），届时直接读取该字段即可。

### 管理员权限

- 管理员邮箱清单由 `ADMIN_EMAILS`（逗号分隔）环境变量指定；判定函数 `isAdminEmail(env, email)` 读取该变量。
- 邮箱命中清单的用户在 `ensureProfile` 时自动把 `user_profiles.role` 提升为 `'admin'` 并落库，与 JWT 角色一致。
- 管理后台 `admin.html` 调用 `/api/auth/me` 校验 `role==='admin'`，非管理员显示拦截页；面板含生成/列出激活码、列出全部用户（邮箱/角色/会员/注册时间）。
- 后端 `functions/api/admin/*` 对每个请求用 `resolveUser` + `isAdminEmail` 双重校验，非管理员返回 `403`。

### 第三方登录（OAuth）

- 通用 OAuth 2.0 框架，支持 Google / GitHub / 微信 / QQ。`oauthEnabled(env)` 只返回已配 AppID/Secret 的提供商，前端据此渲染按钮——**未配置任何凭据时不显示第三方按钮**，密钥不进浏览器。
- 授权跳转 `functions/api/auth/oauth/[provider].js` 生成 `state` 写入 HttpOnly Cookie 防 CSRF，再 302 到服务商页；回调 `[provider].js` 校验 `state` 后换令牌、建/关联账号、下发本站 Cookie。
- `oauth_identities` 表存第三方身份与本站用户的绑定。

### 找回密码

- 「重置链接」方案：不依赖邮件服务。`forgotPassword` 生成一次性令牌（`password_resets` 表，默认 10 分钟有效）并**直接在响应返回重置链接** `reset.html?token=...`；`reset.html` 读 `?token=` 提交新密码到 `reset-password` 接口，校验后改密 + 使旧会话失效 + 直接下发新 Cookie。
- 配置 `RESEND_API_KEY` 后可改为真发邮件，接口结构不变。

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

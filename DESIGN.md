# 设计系统（Design System）

> 本文件是智绘几何视觉规范的单一事实源。任何 UI 改动（人工或自动 Agent）都必须遵守；
> 2026-10-26 全站改版已按此落地，后续迭代请在此基础上增量修改，不要回退已完成的规范。

## 字体

- 中文/UI：**Manrope**（fontsource CDN 加载，`--font-sans` 定义在 `css/style.css`），回退 `-apple-system / PingFang SC / Hiragino Sans GB / MiSans / Microsoft YaHei`
- 禁用 Inter / Roboto / Arial 作为主字体
- 数字/代码场景可用等宽字体回退，不强制引入新 CDN
- 全站**无斜体**；字重 ≤ 700

## 色彩

- 品牌主色：青绿 `#01b88b`（`--primary`），浅色底 `--primary-soft`，描边 `--primary-soft-border`
- 深色仅允许：`#000000 / #181818 / #1F1F1F / #272727 / #313131 / #131209`
- 页面背景：**平铺浅灰** `--bg`（≈`#f5f6f8`），不得恢复紫蓝渐变首屏背景
- **渐变只允许一处**：hero 标题 `linear-gradient(90deg,#000000,#666666)`（background-clip:text）
- 选中/激活态一律用品牌青绿系，禁止旧蓝 `#eff6ff` / `rgba(21,101,192,*)` 残留
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

## 平台硬约束（改动前必读）

- **JXGraph 标签定位修复**：`css/style.css` 中 `.board-box > div:not(.JXGtext):not(.JXGinfobox)` 规则与 `.JXG_navigation{display:none!important}` 是 1.14 标签全不可见 bug 的修复，**原样保留，禁止删除或改选择器**
- 导航 `.site-nav` 的毛玻璃必须挂在 `::before` 伪元素上：`backdrop-filter` 直接挂在元素上会成为 `position:fixed` 子元素的包含块，导致移动端全屏菜单被限制在导航条内
- 数据只存 localStorage，不上传服务器；不得引入账号/付费/云端依赖

## 提交前自测清单

1. 桌面 + 390px 移动两种视口截图
2. 控制台/errors 无新增报错
3. 画板页 JXGraph 标签可见（`.JXGtext` 元素 offsetParent 非空）
4. 汉堡菜单开合、Esc 关闭、滚动高亮正常
5. `prefers-reduced-motion` 下内容直接可见

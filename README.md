# 自用几何画板（双路线）

自用的在线几何画板，**全免费**。内置两条路线：

| | 路线B · 自建画板（默认） | 路线A · SDK 编辑器 |
|---|---|---|
| 入口 | `board.html`（平面画板） | `editor.html`（立体/3D 画板） |
| 画板引擎 | **JSXGraph**（LGPL 开源，`vendor/` 本地加载，不依赖外网） | 大角几何开放 SDK（iframe 嵌入） |
| 依赖 | 无（不需要 appId、不需要对方服务器） | 需要 appId + 域名白名单 |
| AI | 免费 LLM（默认智谱 GLM-4.7-Flash，面板可切换） | 免费 LLM（同一套 Key） |
| 费用 | **托管免费 + LLM 免费额度** | 基础功能免费，对方平台高级能力计费 |

> 工作台里「新建平面画板」走路线B，「新建立体画板」走路线A。两条线的 AI 用的是同一个免费 LLM Key，分别存在两个端点（`/api/ai/board` 和 `/api/ai/run`）。

## 文件结构

```
├── index.html / js/landing.js / js/workbench.js / js/store.js   首页（hero/AI快建/模板）+ 工作台
├── js/templates.js                  内置模板与案例（6 个，命令协议）
├── board.html / js/board.js / js/executor.js    路线B：自建画板页 + 命令执行器
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

打开 [bigmodel.cn](https://bigmodel.cn) 注册 → 控制台 → 「API 密钥」→ 新建，复制那串 `xxx.xxx`。一个 Key 通用所有模型，模型在请求里指定（AI 面板顶部的下拉框随时切换，默认 `glm-4.7-flash`）：

| 模型 | 类型 | 特点 |
|---|---|---|
| `glm-4.7-flash` | 文本 | 200K 上下文，最新最强，**默认** |
| `glm-4.6v-flash` | 视觉 | 128K，可上传图片按图复原图形 |
| `glm-4-flash-250414` / `glm-4-flash` | 文本 | 旧版，留着兼容 |

免费档限制：并发 1 个请求（自用足够）。

**2. 起静态服务 + AI 代理**（两个终端）

```bash
# 终端1：静态页
python3 -m http.server 8000

# 终端2：AI 代理（零依赖）
LLM_API_KEY=你的key node server/local-proxy.mjs
```

**3. 打开 http://localhost:8000** → 首页直接输入「画一个等腰直角三角形，标注三个顶点」→ 点「生成画板」直达画板；也可以从「模板与案例」挑一个（勾股定理 / 圆周角定理 / 将军饮马 / 二次函数…）一键开始。

> 本地模式下要把 `js/config.js` 里 `boardAiEndpoint` 的注释行切过去（指向 `http://localhost:8787/api/ai/board`）。

## 部署（Cloudflare Pages，免费）

仓库连着 GitHub，推代码即自动部署：

1. 代码 push 到 GitHub（Cloudflare Pages 项目已连接该仓库）
2. Pages 项目 → **设置 → 变量和密钥** → 添加：

   | 变量 | 值 | 必填 |
   |---|---|---|
   | `LLM_API_KEY` | 智谱 Key | ✓ |
   | `LLM_MODEL` | `glm-4.7-flash` | 否（有默认值，前端下拉框优先级更高） |
   | `LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 否 |

3. 保存后 **重试部署**（环境变量不会自动应用到旧部署）
4. `js/config.js` 保持默认（`boardAiEndpoint: '/api/ai/board'` 同域）

3D 画板额外需要：`js/config.js` 填 appId + 大角控制台加域名白名单。

## 路线B 的 AI 命令协议

AI 输出 `{"message": "...", "commands": [...]}`，前端 `js/executor.js` 逐条翻译成 JSXGraph 调用：

| 命令 | 说明 |
|---|---|
| `clear` | 清空画板 |
| `point` `{id,x,y,fixed?}` | 点（默认可拖拽） |
| `segment` `{id,from,to}` / `ray` / `line {through:[A,B]}` | 线段/射线/直线 |
| `circle` `{center,through｜radius}` | 圆 |
| `polygon` `{points:[A,B,C]}` | 多边形 |
| `midpoint` / `intersect` / `glider` | 中点/交点/动点（依赖对象） |
| `perpendicular` / `parallel` | 垂线/平行线 |
| `function` `{expr,from,to}` | 函数曲线（`x^2`、`sin(x)`） |
| `text` / `angle` / `label` / `style` | 文本/角/标签/样式 |

协议全量定义在 `ai/board-prompt.js`（提示词）和 `js/executor.js`（执行器），**两边同步改**。

文件保存格式：`{name, commands[], moves[]}`——commands 是作图命令（重放即还原），moves 记录自由点拖拽后的坐标。

## 多设备适配

- **桌面**：画板在左、AI 面板在右，模板 3 列、快速入门 4 列。
- **平板**（≤1024px）：模板/步骤自动降为 2 列。
- **手机**（≤860px）：AI 面板收成底部抽屉，点右下角「AI 作图」按钮唤出；顶栏与工具条自适应收窄/横滑；模板单列、主按钮纵向排列。
- 首页 hero 的 AI 输入框在手机上同样可用（Enter 直接生成）。

## 常见问题

- **AI 面板报错「LLM_API_KEY 未配置」**：环境变量没配或没重试部署。
- **AI 回复了但不作图**：看浏览器 Console；模型偶尔输出非 JSON，后端已做万能提取（围栏/裸JSON），极端情况会返回解析失败提示，重试一次即可。
- **想换模型**：AI 面板顶部的下拉框直接切（glm-4.7-flash / glm-4.6v-flash / glm-4-flash-250414 / glm-4-flash，全部免费，选择会记住）；也可以环境变量设 `LLM_MODEL` 改默认。
- **上传图片按图复原**：下拉框切到「GLM-4.6V-Flash（视觉）」→ 点「📷 图片」选图（≤5MB）→ 可附加文字说明 → 生成。视觉模型会先看图再输出作图命令。
- **3D 画板打不开**：appId 未配或域名没加白名单（3D 是路线A，需要对方平台）。
- **换浏览器/清缓存文件会丢**：文件只在 localStorage，重要画板及时「导出 JSON」。

## 开源致谢

- [JSXGraph](https://jsxgraph.org)（LGPL）——路线B 画板引擎
- 大角几何开放 SDK（Apache-2.0）——路线A 画板引擎

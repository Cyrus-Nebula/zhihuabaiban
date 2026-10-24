# 自用几何画板 · 免费 AI 版

功能对标 [dajiaoai.com](https://dajiaoai.com)（大角几何）的**自用、全免费**复刻：
平面/立体几何画板、**免费 LLM 驱动的 AI 对话作图**、文件管理、导入导出。

- 画板引擎：大角几何开放平台 iframe 嵌入（[algeo-sdk](https://github.com/dajiaoai/algeo-sdk)，Apache-2.0），**不花钱**
- AI：**自己接免费 LLM**（默认智谱 GLM-4-Flash，可换 Gemini），**不花钱**
- 托管：Cloudflare Pages 免费档（无限带宽 + Pages Functions 每天 10 万次请求），**不花钱**
- 文件：浏览器 localStorage + .json 导入导出，**不花钱**

> 全程不需要大角几何的 API Key，不产生任何费用。AI 事件流经自建翻译层转换为编辑器原生协议，官方 AI 面板 UI 原样保留。

## 文件清单（全部 12 个，都有用）

```
├── index.html            工作台：画板文件列表、新建 2D/3D、导入导出
├── editor.html           编辑器页：挂载画板 + 状态栏
├── css/style.css         样式
├── js/
│   ├── config.js         ★唯一要改的文件：appId、AI 后端地址
│   ├── store.js          画板文件存 localStorage
│   ├── workbench.js      工作台逻辑
│   └── editor.js         编辑器逻辑（嵌入画板 + AI 转发）
├── ai/
│   ├── system-prompt.js  AI 系统提示词 + algeo_repl 工具定义
│   └── ai-backend.js     免费 LLM 翻译层（AI 心脏）
├── functions/api/ai/run.js   线上 AI 入口（Cloudflare Pages Function）
├── server/local-proxy.mjs    本地 AI 入口（Node 18+ 零依赖）
└── README.md            本文件
```

## 快速开始（本地，5 分钟）

```bash
# 1. appId：编辑 js/config.js，把 YOUR_APP_ID 换成控制台创建应用后的 appId
#    （https://open.dajiaoai.com/console/dashboard；本地测试把 localhost 加白名单）

# 2. 免费 LLM Key：智谱开放平台（bigmodel.cn）注册即可免费使用 GLM-4-Flash
#    或 Google AI Studio 的 Gemini 免费档

# 3. 起服务（两个终端）
LLM_API_KEY=你的key node server/local-proxy.mjs   # 终端 A：AI 代理 :8787
python3 -m http.server 8000                        # 终端 B：静态页 :8000

# 4. js/config.js 里把 aiEndpoint 注释切换为：
#    aiEndpoint: 'http://localhost:8787/api/ai/run'

# 5. 打开 http://localhost:8000，新建画板，在 AI 面板输入：
#    "画一个等腰直角三角形，标注三个顶点"
```

## 部署到 Cloudflare Pages（免费、免备案、可公网访问）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Upload assets**，把本目录（或 dajiao-clone.zip）整个拖进去（`functions/` 会自动识别为 Pages Functions）
2. 得到免费域名 `https://<项目名>.pages.dev`
3. Settings → Environment variables 添加：
   - `LLM_API_KEY`（必填，免费 LLM 的 Key）
   - `LLM_BASE_URL`（可选，默认 `https://open.bigmodel.cn/api/paas/v4`）
   - `LLM_MODEL`（可选，默认 `glm-4-flash`）
4. 保存后 Redeploy；控制台白名单添加 `https://<项目名>.pages.dev`
5. `js/config.js` 保持默认 `aiEndpoint: '/api/ai/run'` 不用动

## 免费 LLM 选哪个

| 提供商 | 免费额度 | 配置 |
|---|---|---|
| **智谱 GLM-4-Flash（默认）** | 免费 | `LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4`，`LLM_MODEL=glm-4-flash`，Key 在 bigmodel.cn 注册 |
| **Google Gemini** | 免费档 | `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`，`LLM_MODEL=gemini-2.5-flash`，Key 在 aistudio.google.com |
| 任意 OpenAI 兼容服务 | 看各家 | DeepSeek / 通义千问 / Kimi / 302.ai 等，填对应 baseUrl + model |

模型不支持 function calling 也没关系：后端会自动把 ```repl 代码块里的命令提取成工具调用（兜底路径）。

## AI 是怎么工作的

```
编辑器 AI 面板 ──aiRequest(payload)──> 我们的后端(Pages Function / 本地代理)
   │                                      │ 1. 取出对话历史
   │                                      │ 2. 拼上系统提示词
   │                                      │ 3. 调用免费 LLM(带 algeo_repl 工具)
   │                                      │ 4. 流式输出翻译成"原始事件"
   └──<── SSE: {type:"raw",event:"response.output_text.delta",...}
       editor.ai.consumeStream() 解析渲染；function_call 事件即执行作图
```

翻译层输出已用大角几何官方协议包的 zod schema 逐事件校验通过（事件序列：run.created → response.created → output_item.added → content_part.added → output_text.delta → … → function_call_arguments.done → response.completed）。

## 常见问题

**AI 面板报错/没反应？** 本地模式确认代理在跑、`aiEndpoint` 指向 8787、`LLM_API_KEY` 已设置；线上模式确认 Pages 环境变量已配并 Redeploy。错误信息会直接显示在 AI 面板里。

**画板白屏？** ① appId 填了没；② 域名加白名单了没（本地 `localhost`，线上 `https://xxx.pages.dev`）；③ 网络能访问 dajiaoai.com。

**AI 画的图不满意？** 直接说人话继续改，如"把三角形填充浅蓝色""加一条高 AD""新建一个画板画圆"。多轮对话里 AI 能看到你之前的修改（工具执行结果会随下次请求回传）。

**文件会丢吗？** 存浏览器 localStorage，换浏览器/清缓存会丢，重要画板及时导出 .json。

## 合规提示

个人学习自用：功能仿写不侵权；请勿照搬大角几何的界面设计、图标与商标上线运营。algeo-sdk 为 Apache-2.0，按其许可证要求保留声明即可。系统提示词改编自官方公开开源的 Skill（dino-algeo），版权归原作者。

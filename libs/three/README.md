# Three.js 本地 vendor（r160）

立体画板 `board3d.html` 的 3D 内核已本地化：运行时不再向 jsdelivr / unpkg 请求 Three.js。
断网、第三方 CDN 被墙或下线时，3D 画板仍可正常加载与作图。

## 版本与来源

- 版本：`three@0.160.0`（r160），与 vendor 前 importmap 指向的版本一致，行为不变
- 来源：`https://cdn.jsdelivr.net/npm/three@0.160.0/`（npm 官方包，等价于 three.js 仓库 r160 tag）
- 许可：MIT，Copyright © 2010-2023 three.js authors
  （上游许可证：https://github.com/mrdoob/three.js/blob/r160/LICENSE）

## 文件清单

| 文件 | 对应上游路径 | 用途 |
|------|--------------|------|
| `three.module.min.js` | `build/three.module.min.js` | Three.js 核心 ESM（压缩版） |
| `addons/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` | 视角旋转 / 缩放 / 平移 |
| `addons/controls/TransformControls.js` | `examples/jsm/controls/TransformControls.js` | 物体移动 / 旋转 / 缩放 gizmo |

两个 addon 只 `import { ... } from 'three'`，没有任何其他相对依赖。`board3d.html` 的 importmap
把裸模块名 `three` 与前缀 `three/addons/` 解析到本目录，因此 `js/board3d.js` 里的三条
`import` 语句无需改动即可继续工作。

## 升级方式

1. 从 `https://cdn.jsdelivr.net/npm/three@<版本>/` 下载上述三个文件，覆盖到对应路径；
2. 保持 `board3d.html` importmap 的两个键名不变（只换键，不换值里的目录结构）；
3. 跑一遍 `docs/3D画板回归用例清单.md` 的「离线加载」分组，确认浏览器无任何外部 three 请求。

## 边界说明

- `board3d.html` 中的 `@supabase/supabase-js` CDN 脚本属于账号体系（登录墙 / 云同步），
  与本 3D 内核无关，不在本目录管理范围内；本轮未改动它。
- 旧路径 `editor.html` / `js/editor.js` 及 `@dajiaoai/algeo-sdk`、appId 逻辑保持原样并存，
  自研 3D 全量验证通过前不做清理。

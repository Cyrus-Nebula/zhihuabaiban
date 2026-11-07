/**
 * 无头回归专用：把裸模块说明符 'three' 解析到仓库内的 vendor 副本。
 *
 * 背景：js/board3d.js 顶层是 `import * as THREE from 'three'`，浏览器里由
 * board3d.html 的 importmap 映射到 ./libs/three/three.module.min.js；但 Node 没有
 * importmap，此前必须先 `npm i three`（而 node_modules/ 又被 .gitignore 排除），
 * 干净 clone / CI 直接跑 `node tests/board3d_regress.mjs` 会报 ERR_MODULE_NOT_FOUND。
 *
 * 本 loader 由 tests/board3d_regress.mjs 用 node:module 的 register() 在运行时注册，
 * 只作用于该进程的模块解析：不改线上代码、不需要 npm install、不发起任何外部请求。
 * 浏览器端仍走 importmap（无 GPU 冒烟页把 'three' 指向 three-webgl-stub.mjs），不受影响。
 *
 * 与 tests/three-webgl-stub.mjs 的分工：那个文件在浏览器里替换 WebGLRenderer；
 * 本文件只负责 Node 下的说明符解析，不替换任何 Three.js 类，也不参与线上页面加载。
 */

const VENDOR_THREE = new URL('../libs/three/three.module.min.js', import.meta.url).href;
const VENDOR_DIR = new URL('../libs/three/', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return nextResolve(VENDOR_THREE, context);
  }
  // 预留 three/addons/... 之类的子路径，同样落到本地 vendor 目录，杜绝回退到 npm 包
  if (specifier.startsWith('three/')) {
    return nextResolve(new URL(specifier.slice('three/'.length), VENDOR_DIR).href, context);
  }
  return nextResolve(specifier, context);
}

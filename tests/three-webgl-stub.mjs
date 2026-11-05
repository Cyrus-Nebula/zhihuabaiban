/**
 * 浏览器冒烟自测专用：Three.js 的「无 GPU 替身渲染器」。
 *
 * 沙箱 / CI 环境常常没有 WebGL（GPU 与 SwiftShader 均被禁用），
 * 此时 `new THREE.WebGLRenderer()` 会直接抛错，Board3D 根本构造不出来。
 * 这里只替换 WebGLRenderer 一个类，其余导出全部从本地 vendor 的 Three.js 原样透传：
 *   - 相机投影矩阵、Raycaster 射线拾取、Vector3 空间计算仍是真实实现
 *   - OrbitControls 仍是本地 vendor 的真实实现（它从 'three' 取名字，走 importmap 到本模块）
 *   - BufferGeometry / Sprite / CanvasTexture 等仍是真实实现
 * 因此视角预设、重置、拖拽反投影、依赖联动等交互逻辑可以在无 GPU 环境里被真实验证。
 *
 * 注意：ES 模块规范中，显式的本地导出会遮蔽 `export *` 里的同名导出，故此处
 * `WebGLRenderer` 会覆盖 vendor 的原始实现，而不会报重复导出。
 *
 * 本文件只被 tests/board3d_browser_smoke.html 引用，不参与线上页面加载。
 */
export * from '../libs/three/three.module.min.js';

export class WebGLRenderer {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.domElement.width = 800;
    this.domElement.height = 600;
    // 给 Board3D._updatePointer 一个稳定的 800x600 视口（不依赖真实布局）
    this.domElement.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    });
    this.info = { render: { calls: 0 } };
    this._loop = null;
  }
  setPixelRatio() {}
  setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
  setAnimationLoop(cb) { this._loop = cb; }   // 不真的起 rAF 循环，避免无 GPU 时空转
  render() { this.info.render.calls++; }
  dispose() {}
  getContext() { return null; }               // 明确表示没有真实 GL 上下文
}

/**
 * 智绘几何 · 3D v4 增强
 * 1) 进阶图元按钮：点击即用 3D 命令执行器插入示例图元（不经过 LLM）。
 * 2) 移动端图元抽屉开关。
 * 3) 执行结果写入 3D AI 面板日志，方便用户看到命令是否生效。
 */
import { board3dApi } from './board3d.js';
import { applyBoard3DCommands } from './board3d-executor.js';

const SAMPLES = {
  torus: {
    op: 'torus3d', axis: 'y', center: [0, 0, 0], R: 1.6, r: 0.6,
    majorSegments: 24, minorSegments: 12, asMeridians: true, asRings: true,
    color: '#1677ff', opacity: 1,
  },
  capsule: {
    op: 'capsule3d', axis: 'y', center: [0, 0, 0], radius: 0.6, length: 1.6,
    meridians: 16, rings: 10, asMeridians: true, asRings: true,
    color: '#1677ff', opacity: 1,
  },
  ellipsoid: {
    op: 'ellipsoid3d', axis: 'y', center: [0, 0, 0], a: 1.6, b: 1, c: 1,
    meridians: 16, parallels: 10, asMeridians: true, asParallels: true,
    color: '#1677ff', opacity: 1,
  },
  polyhedron: {
    op: 'polyhedron3d', kind: 'cube', center: [0, 0, 0], radius: 1.2,
    asVertices: true, labelVertices: true, vertexSize: 0.1, color: '#1677ff',
  },
  revolve: {
    op: 'revolve3d', profile: [[0, 0], [1, 0], [1, 2], [0, 2]],
    axis: 'y', segments: 18, sweep: 360, asMeridians: true, asRings: true,
    color: '#1677ff', opacity: 1,
  },
  helix: {
    op: 'helix3d', axis: 'y', radius: 1, pitch: 0.6, turns: 4,
    segments: 96, asPoints: false, color: '#1677ff',
  },
  arc: {
    op: 'arc3d', axis: 'z', center: [0, 0, 0], radius: 1.5,
    startAngle: 0, sweep: 120, segments: 32, asPoints: false, color: '#1677ff',
  },
};

function log(text) {
  const box = document.getElementById('b3dAiLog');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'b3d-ai-msg ai';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  const sample = SAMPLES[btn.dataset.cmd];
  if (!sample) return;
  if (!board3dApi.isReady()) {
    log('3D 内核未就绪，当前浏览器可能不支持 WebGL。');
    toast('3D 内核未就绪');
    return;
  }
  try {
    const results = applyBoard3DCommands([JSON.parse(JSON.stringify(sample))], board3dApi);
    const ok = results.filter((r) => r.ok).length;
    const bad = results.filter((r) => !r.ok);
    log(`已插入「${btn.textContent}」示例：${ok}/${results.length} 条命令成功`
      + (bad.length ? '；失败：' + bad.map((b) => b.error || b.op).join('、') : ''));
    toast(bad.length ? '部分图元插入失败，请看日志' : `已插入${btn.textContent}`);
  } catch (err) {
    log('插入失败：' + (err && err.message ? err.message : err));
    toast('插入失败');
  }
});

const toggle = document.getElementById('btn-palette-toggle');
const main = document.querySelector('.board3d-main');
if (toggle && main) {
  toggle.addEventListener('click', () => {
    const open = main.classList.toggle('palette-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

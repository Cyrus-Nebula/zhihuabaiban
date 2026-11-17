/**
 * 立体画板 AI 面板（路线B · 3D 分支，本轮增量 优先级 3）
 *
 * 与 2D 侧完全平行、互不引用：
 *   - 不 import js/executor.js、不 import js/board.js；
 *   - 命令只经 js/board3d-executor.js 的 applyBoard3DCommands() 执行；
 *   - 固定以 mode:'3d' 调 /api/ai/board，让后端切到 BOARD3D_SYSTEM_PROMPT。
 *
 * 画板副作用全部走 board3dApi（窄接口），本文件只负责面板交互与请求编排。
 */
import { board3dApi } from './board3d.js';
import { applyBoard3DCommands, describeBoard3DState } from './board3d-executor.js';

const CFG = window.DAJIAO_CONFIG || {};
const ENDPOINT = CFG.boardAiEndpoint || '/api/ai/board';

let panel, logEl, inputEl, sendBtn;
const history = [];

const $ = (id) => document.getElementById(id);

function appendLog(role, text) {
  if (!logEl) return;
  const div = document.createElement('div');
  div.className = 'b3d-ai-msg ' + role;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

/** 当前场景摘要，作为「当前画板对象」发给 LLM */
function sceneContext() {
  try { return describeBoard3DState(board3dApi.getState()); }
  catch (_) { return '（场景读取失败）'; }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  if (!board3dApi.isReady()) {
    appendLog('err', '3D 内核未就绪（当前浏览器可能不支持 WebGL），无法执行命令。');
    return;
  }
  appendLog('user', text);
  history.push({ role: 'user', content: text });
  inputEl.value = '';
  sendBtn.disabled = true;
  sendBtn.textContent = '生成中…';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        mode: '3d',
        detect3d: true,
        context: sceneContext(),
        history: history.slice(-10),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);

    // 旧版后端没有 3D 分支时不会返回 mode；有新分支但没切到 3D 属异常，先提示再执行
    if (data.mode && data.mode !== '3d') {
      appendLog('err', `后端按 ${data.mode} 协议应答了，请确认线上 /api/ai/board 已部署 3D 分支。`);
    }

    const cmds = Array.isArray(data.commands) ? data.commands : [];
    if (cmds.length) {
      const results = applyBoard3DCommands(cmds, board3dApi);
      const ok = results.filter((r) => r.ok).length;
      const bad = results.filter((r) => !r.ok);
      let line = `已执行 ${ok}/${results.length} 条 3D 命令`;
      if (bad.length) line += '；失败：' + bad.map((b) => `${b.op || '?'}(${b.error})`).join('、');
      appendLog('ai', line);
      // measure3d 是只读量测命令：把画板按当前场景真实坐标算出的结果逐条展示，
      // 数值以画板返回为准，避免 LLM 在 message 里凭空估算。
      for (const m of results) {
        if (m.ok && m.op === 'measure3d' && m.text) appendLog('ai', '量测：' + m.text);
      }
      // transform3d 是相对变换：展示画板按「当前真实值 + 增量」算出的目标值，
      // 数值以画板返回为准，避免 LLM 在 message 里凭空估算绝对坐标。
      for (const t of results) {
        if (!t.ok || t.op !== 'transform3d' || !t.patch) continue;
        const bits = Object.keys(t.patch)
          .map((k) => `${k}=[${t.patch[k].join(', ')}]`).join('  ');
        appendLog('ai', `变换 ${t.id}：${bits}`);
      }
      // 2026-11-15 D8：ids 批量变换同样逐 id 展示画板算出的目标值；
      // 单 id 结果没有 batch 标记，既有循环与这里互不重复。
      for (const t of results) {
        if (t.op !== 'transform3d' || t.batch !== true || !Array.isArray(t.applied)) continue;
        for (const a of t.applied) {
          const bits = Object.keys(a.patch)
            .map((k) => `${k}=[${a.patch[k].join(', ')}]`).join('  ');
          appendLog('ai', `批量变换 ${a.id}：${bits}`);
        }
      }
      // 2026-11-16 D9：duplicate3d 复制对象展示画板实际新建的 id 与数量。
      for (const d of results) {
        if (!d.ok || d.op !== 'duplicate3d' || !Array.isArray(d.created)) continue;
        const ids = d.created.map((c) => c.id).join('、');
        appendLog('ai', `已复制 ${d.created.length} 个对象：${ids}`);
      }
      // 2026-11-16 D10：radial3d 环形阵列展示画板实际生成的份数、环绕轴与 id。
      for (const r of results) {
        if (!r.ok || r.op !== 'radial3d' || !Array.isArray(r.created)) continue;
        const axis = r.meta && r.meta.axis ? r.meta.axis : '?';
        const ids = r.created.map((c) => c.id).join('、');
        appendLog('ai', `已绕 ${axis} 轴环形阵列 ${r.created.length} 个对象：${ids}`);
      }      // 2026-11-16 D10：radial3d 环形阵列展示画板实际生成的份数、环绕轴与 id。
      for (const r of results) {
        if (!r.ok || r.op !== 'radial3d' || !Array.isArray(r.created)) continue;
        const axis = r.meta && r.meta.axis ? r.meta.axis : '?';
        const ids = r.created.map((c) => c.id).join('、');
        appendLog('ai', `已绕 ${axis} 轴环形阵列 ${r.created.length} 个对象：${ids}`);
      }
      // 2026-11-16 D11：mirror3d 镜像复制展示画板实际生成的副本、镜像平面与位置。
      for (const r of results) {
        if (!r.ok || r.op !== 'mirror3d' || !Array.isArray(r.created)) continue;
        const axis = r.meta && r.meta.axis ? r.meta.axis : '?';
        const through = r.meta && typeof r.meta.through === 'number' ? r.meta.through : 0;
        const c = r.created[0];
        const pos = c && Array.isArray(c.pos) ? c.pos.join(', ') : '';
        appendLog('ai', `已关于 ${axis}=${through} 平面镜像生成 ${c ? c.id : '?'}：pos=[${pos}]`);
      }
      // 2026-11-17 D12：grid3d 网格阵列展示画板实际生成的份数、size 与 id。
      for (const g of results) {
        if (!g.ok || g.op !== 'grid3d' || !Array.isArray(g.created)) continue;
        const size = g.meta && Array.isArray(g.meta.size) ? g.meta.size.join('×') : '?';
        const ids = g.created.map((c) => c.id).join('、');
        appendLog('ai', `已生成 ${size} 网格阵列 ${g.created.length} 个对象：${ids}`);
      }
      // 2026-11-17 D13：align3d 展示画板按当前真实坐标算出的目标轴坐标（数值以画板返回为准）。
      for (const al of results) {
        if (!al.ok || al.op !== 'align3d' || !Array.isArray(al.applied)) continue;
        const axis = al.axis || '?';
        const mode = al.mode || '?';
        const bits = al.applied
          .map((a) => `${a.id}→${axis}=${Array.isArray(a.patch && a.patch.pos) ? a.patch.pos[['x', 'y', 'z'].indexOf(axis)] : '?'}`)
          .join('、');
        appendLog('ai', `已按 ${mode} 对齐 ${al.applied.length} 个对象：${bits}`);
      }
      // 2026-11-17 D14：helix3d 展示画板按参数方程生成的螺旋线段数（与 meta 一致）。
      for (const hx of results) {
        if (!hx.ok || hx.op !== 'helix3d') continue;
        const m = hx.meta || {};
        const shape = m.axis ? `绕 ${String(m.axis).toUpperCase()} 轴` : '';
        const turns = m.turns != null ? `、${m.turns} 圈` : '';
        appendLog('ai', `已生成螺旋线 ${hx.created.length} 段${shape ? '（' + shape + turns + '）' : ''}。`);
      }
      // 2026-11-17 D15：bezier3d 展示画板按控制点生成的曲线段数与次数（数值以画板返回为准）。
      for (const bz of results) {
        if (!bz.ok || bz.op !== 'bezier3d') continue;
        const m = bz.meta || {};
        const deg = m.degree != null ? `（${m.degree} 次）` : '';
        appendLog('ai', `已生成贝塞尔曲线 ${bz.created.length} 段${deg}。`);
      }
      // 2026-11-18 D16：arc3d 展示画板按圆心/半径/起止角生成的圆弧段数与扫角（数值以画板返回为准）。
      for (const ac of results) {
        if (!ac.ok || ac.op !== 'arc3d') continue;
        const m = ac.meta || {};
        const sweep = m.sweep != null ? `、扫角 ${m.sweep}°` : '';
        appendLog('ai', `已生成空间圆弧 ${ac.created.length} 段${sweep}。`);
      }
    }
    if (data.message) {
      appendLog('ai', data.message);
      history.push({ role: 'assistant', content: data.message });
    }
  } catch (e) {
    appendLog('err', '⚠️ ' + (e && e.message ? e.message : String(e)));
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = '生成';
  }
}

function init() {
  panel = $('b3dAiPanel');
  logEl = $('b3dAiLog');
  inputEl = $('b3dAiInput');
  sendBtn = $('b3dAiSend');
  if (!panel || !logEl || !inputEl || !sendBtn) return;

  const openBtn = $('btn-ai3d');
  if (openBtn) openBtn.addEventListener('click', () => { panel.classList.remove('hidden'); inputEl.focus(); });
  const closeBtn = $('b3dAiClose');
  if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  appendLog('ai', '立体画板 AI 助手已就绪。试试说：「画一个棱长 2 的正方体，标出顶点 A」。');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

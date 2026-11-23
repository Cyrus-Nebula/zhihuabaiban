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
      // 2026-11-19 D18：多轴写法（al.axes 数组）优先按 axes 逐轴展示；单轴路径逐字未动。
      for (const al of results) {
        if (!al.ok || al.op !== 'align3d' || !Array.isArray(al.applied)) continue;
        const axes = Array.isArray(al.axes) && al.axes.length ? al.axes : null;
        if (axes) {
          // 多轴：每个对象展示形如 a→x=0,y=-3，数值以画板回读的 patch.pos 为准。
          const bits = al.applied.map((a) => {
            const pos = a.patch && a.patch.pos;
            const kv = axes.map((ax) => `${ax}=${Array.isArray(pos) ? pos[['x', 'y', 'z'].indexOf(ax)] : '?'}`).join(',');
            return `${a.id}→${kv}`;
          }).join('、');
          appendLog('ai', `已在 ${axes.join('/')} 轴对齐 ${al.applied.length} 个对象：${bits}`);
          continue;
        }
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
      // 2026-11-19 D17：polyhedron3d 展示画板按标准坐标生成的立体种类 / 顶点 / 棱 / 面数（数值以画板返回为准）。
      for (const ph of results) {
        if (!ph.ok || ph.op !== 'polyhedron3d') continue;
        const m = ph.meta || {};
        const kind = m.kind || '?';
        const v = m.vertexCount != null ? m.vertexCount : '?';
        const e = m.edgeCount != null ? m.edgeCount : '?';
        const f = m.faceCount != null ? m.faceCount : '?';
        const marked = m.labelVertices ? '，已标注顶点' : '';
        appendLog('ai', `已生成正多面体 ${kind}：${v} 顶点 / ${e} 棱 / ${f} 面${marked}。`);
      }
      // 2026-11-19 D19：revolve3d 展示母线点数 / 轴 / 段数 / 经线纬线圈与采样点（数值以画板返回为准）。
      for (const rv of results) {
        if (!rv.ok || rv.op !== 'revolve3d') continue;
        const m = rv.meta || {};
        const axis = m.axis || '?';
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.meridianCount) parts.push(`${m.meridianCount} 经线`);
        if (m.ringCount) parts.push(`${m.ringCount} 纬线圈`);
        if (m.pointCount) parts.push(`${m.pointCount} 标记点`);
        const sweep = m.closed ? '' : `、扫角 ${m.sweep}°`;
        appendLog('ai', `已生成旋转体（绕 ${axis} 轴，母线 ${m.profileCount || '?'} 点）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}${sweep}。`);
      }
      // 2026-11-19 D20：torus3d 展示环心 / 对称轴 / 主圆半径 R / 管半径 r / 经线圆纬线圈与采样点（数值以画板返回为准）。
      for (const tr of results) {
        if (!tr.ok || tr.op !== 'torus3d') continue;
        const m = tr.meta || {};
        const axis = m.axis || '?';
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.meridianCount) parts.push(`${m.meridianCount} 经线圆`);
        if (m.ringCount) parts.push(`${m.ringCount} 纬线圈`);
        if (m.pointCount) parts.push(`${m.pointCount} 标记点`);
        appendLog('ai', `已生成圆环面（绕 ${axis} 轴，主圆 R=${m.R != null ? m.R : '?'}、管半径 r=${m.r != null ? m.r : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-20 D21：ellipsoid3d 展示极轴 / 三半轴 / 经线纬线圈与采样点（数值以画板返回为准）。
      for (const el of results) {
        if (!el.ok || el.op !== 'ellipsoid3d') continue;
        const m = el.meta || {};
        const axis = m.axis || '?';
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.meridianCount) parts.push(`${m.meridianCount} 经线`);
        if (m.parallelCount) parts.push(`${m.parallelCount} 纬线圈`);
        if (m.pointCount) parts.push(`${m.pointCount} 标记点`);
        appendLog('ai', `已生成椭球（${axis} 轴，半轴 a=${m.a != null ? m.a : '?'}、b=${m.b != null ? m.b : '?'}、c=${m.c != null ? m.c : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-21 D22：capsule3d 展示对称轴 / 半径 / 两球心距 / 经线纬线圈与采样点（数值以画板返回为准）。
      for (const cp of results) {
        if (!cp.ok || cp.op !== 'capsule3d') continue;
        const m = cp.meta || {};
        const axis = m.axis || '?';
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.meridianCount) parts.push(`${m.meridianCount} 经线`);
        if (m.ringCount) parts.push(`${m.ringCount} 纬线圈`);
        if (m.pointCount) parts.push(`${m.pointCount} 标记点`);
        appendLog('ai', `已生成胶囊体（${axis} 轴，半径 r=${m.radius != null ? m.radius : '?'}、两球心距 h=${m.length != null ? m.length : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-22 D23：tube3d 展示路径控制点数 / 采样点数 / 管半径 / 截面圆环与母线（数值以画板返回为准）。
      for (const tb of results) {
        if (!tb.ok || tb.op !== 'tube3d') continue;
        const m = tb.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.ringCount) parts.push(`${m.ringCount} 截面圆环`);
        if (m.meridianCount) parts.push(`${m.meridianCount} 母线`);
        if (m.pointCount) parts.push(`${m.pointCount} 标记点`);
        appendLog('ai', `已生成管道（${m.path && m.path.length ? m.path.length : '?'} 个路径控制点 → ${m.sampleCount != null ? m.sampleCount : '?'} 个采样截面，管半径 r=${m.radius != null ? m.radius : '?'}，每段细分 ${m.steps != null ? m.steps : '?'}，截面 ${m.radialSegments != null ? m.radialSegments : '?'} 段）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-22 D24：prism3d 展示底面顶点数 / 拉伸向量与高度 / 底面顶面侧棱与顶点标注（数值以画板返回为准）。
      for (const pr of results) {
        if (!pr.ok || pr.op !== 'prism3d') continue;
        const m = pr.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseEdgeCount) parts.push(`${m.baseEdgeCount} 底边`);
        if (m.topEdgeCount) parts.push(`${m.topEdgeCount} 顶边`);
        if (m.sideEdgeCount) parts.push(`${m.sideEdgeCount} 侧棱`);
        if (m.pointCount) parts.push(`${m.pointCount} 顶点球`);
        if (m.labelCount) parts.push(`${m.labelCount} 顶点标注`);
        appendLog('ai', `已生成棱柱（${m.vertexCount != null ? m.vertexCount : '?'} 边形底面，拉伸向量 [${m.vector && m.vector.length ? m.vector.join(',') : '?'}、高度 ${m.height != null ? m.height : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-22 D25：pyramid3d 展示底面顶点数 / 顶点与抬升方式 / 底面侧棱与顶点标注（数值以画板返回为准）。
      for (const py of results) {
        if (!py.ok || py.op !== 'pyramid3d') continue;
        const m = py.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseEdgeCount) parts.push(`${m.baseEdgeCount} 底边`);
        if (m.sideEdgeCount) parts.push(`${m.sideEdgeCount} 侧棱`);
        if (m.pointCount) parts.push(`${m.pointCount} 顶点球`);
        if (m.labelCount) parts.push(`${m.labelCount} 顶点标注`);
        const apexDesc = m.apexMode === 'explicit'
          ? `显式顶点 [${m.apex && m.apex.length ? m.apex.join(',') : '?'}]`
          : `质心沿 ${m.axis || '?'} 抬升 ${m.height != null ? m.height : '?'}`;
        appendLog('ai', `已生成棱锥（${m.vertexCount != null ? m.vertexCount : '?'} 边形底面，${apexDesc}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-22 D26：frustum3d 展示底面顶点数 / 相似比与抬升方式 / 底面顶边侧棱与顶点标注（数值以画板返回为准）。
      for (const fr of results) {
        if (!fr.ok || fr.op !== 'frustum3d') continue;
        const m = fr.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseEdgeCount) parts.push(`${m.baseEdgeCount} 底边`);
        if (m.topEdgeCount) parts.push(`${m.topEdgeCount} 顶边`);
        if (m.sideEdgeCount) parts.push(`${m.sideEdgeCount} 侧棱`);
        if (m.pointCount) parts.push(`${m.pointCount} 顶点球`);
        if (m.labelCount) parts.push(`${m.labelCount} 顶点标注`);
        const topDesc = m.topMode === 'explicit'
          ? '显式顶面顶点'
          : `相似比 ${m.ratio != null ? m.ratio : '?'} 沿 ${m.axis || '?'} 抬升 ${m.height != null ? m.height : '?'}`;
        appendLog('ai', `已生成棱台（${m.vertexCount != null ? m.vertexCount : '?'} 边形底面，${topDesc}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-23 D27：vector3d 展示起点→终点、长度与方向、箭头尺寸、杆/底圈/母线与端点标注（数值以画板返回为准）。
      for (const vc of results) {
        if (!vc.ok || vc.op !== 'vector3d') continue;
        const m = vc.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.shaftCount) parts.push(`${m.shaftCount} 杆`);
        if (m.headRingCount) parts.push(`${m.headRingCount} 底圈`);
        if (m.headRibCount) parts.push(`${m.headRibCount} 母线`);
        if (m.pointCount) parts.push(`${m.pointCount} 端点球`);
        if (m.labelCount) parts.push(`${m.labelCount} 端点标注`);
        const dir = m.direction && m.direction.length ? `[${m.direction.join(',')}]` : '?';
        const headDesc = m.headLengthClamped ? `${m.headLength}（已按杆长钳制）` : `${m.headLength}`;
        appendLog('ai', `已生成空间向量（[${m.from && m.from.length ? m.from.join(',') : '?'}] → [${m.to && m.to.length ? m.to.join(',') : '?'}]，长度 ${m.length != null ? m.length : '?'}，方向 ${dir}，箭头长 ${headDesc}/半径 ${m.headRadius != null ? m.headRadius : '?'}/${m.headSegments != null ? m.headSegments : '?'} 分段）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-23 D28：cone3d 展示正/斜圆锥、底面圆心与法向、半径/高（或显式顶点）、底圈/母线与顶点标注（数值以画板返回为准）。
      for (const cc of results) {
        if (!cc.ok || cc.op !== 'cone3d') continue;
        const m = cc.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseRingCount) parts.push(`${m.baseRingCount} 底圈`);
        if (m.sideCount) parts.push(`${m.sideCount} 母线`);
        if (m.pointCount) parts.push(`${m.pointCount} 小球`);
        if (m.labelCount) parts.push(`${m.labelCount} 标注`);
        const kind = m.isRight ? '正圆锥' : '斜圆锥';
        const apexDesc = m.apexExplicit
          ? `顶点 [${m.apex && m.apex.length ? m.apex.join(',') : '?'}]`
          : `高 ${m.height != null ? m.height : '?'} 沿 [${m.axis && m.axis.length ? m.axis.join(',') : '?'}]`;
        appendLog('ai', `已生成${kind}（圆心 [${m.base && m.base.length ? m.base.join(',') : '?'}]，半径 ${m.radius != null ? m.radius : '?'}，${apexDesc}，母线 ${m.slantHeight != null ? m.slantHeight : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-23 D29：cylinder3d 展示正/斜圆柱、底面圆心与法向、半径/高（或显式顶面圆心）、底圈/顶圈/侧母线与圆心标注（数值以画板返回为准）。
      for (const cc of results) {
        if (!cc.ok || cc.op !== 'cylinder3d') continue;
        const m = cc.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseRingCount) parts.push(`${m.baseRingCount} 底圈`);
        if (m.topRingCount) parts.push(`${m.topRingCount} 顶圈`);
        if (m.sideCount) parts.push(`${m.sideCount} 侧母线`);
        if (m.pointCount) parts.push(`${m.pointCount} 小球`);
        if (m.labelCount) parts.push(`${m.labelCount} 标注`);
        const kind = m.isRight ? '正圆柱' : '斜圆柱';
        const topDesc = m.topExplicit
          ? `顶面圆心 [${m.top && m.top.length ? m.top.join(',') : '?'}]`
          : `高 ${m.height != null ? m.height : '?'} 沿 [${m.axis && m.axis.length ? m.axis.join(',') : '?'}]`;
        appendLog('ai', `已生成${kind}（圆心 [${m.base && m.base.length ? m.base.join(',') : '?'}]，半径 ${m.radius != null ? m.radius : '?'}，${topDesc}，侧母线长 ${m.sideLength != null ? m.sideLength : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-23 D30：plane3d 展示中心与法向、宽高与网格、边界/网格/法向量线、角点小球与 O/A/B/C/D 标注（数值以画板返回为准）。
      for (const pc of results) {
        if (!pc.ok || pc.op !== 'plane3d') continue;
        const m = pc.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.borderCount) parts.push(`${m.borderCount} 边界`);
        if (m.gridLineCount) parts.push(`${m.gridLineCount} 网格`);
        if (m.normalCount) parts.push(`${m.normalCount} 法向量`);
        if (m.pointCount) parts.push(`${m.pointCount} 小球`);
        if (m.labelCount) parts.push(`${m.labelCount} 标注`);
        const fromDesc = m.byPoints ? '三点定面' : `法向 [${m.axis && m.axis.length ? m.axis.join(',') : '?'}]`;
        appendLog('ai', `已生成平面面片（中心 [${m.center && m.center.length ? m.center.join(',') : '?'}]，${fromDesc}，宽 ${m.width != null ? m.width : '?'} × 高 ${m.height != null ? m.height : '?'}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-24 D31：conefrustum3d 展示正/斜圆台、下底圆心与法向、上下底半径/高（或显式顶面圆心）、底圈/顶圈/侧母线与圆心标注（数值以画板返回为准）。
      for (const fc of results) {
        if (!fc.ok || fc.op !== 'conefrustum3d') continue;
        const m = fc.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.baseRingCount) parts.push(`${m.baseRingCount} 下底圈`);
        if (m.topRingCount) parts.push(`${m.topRingCount} 上底圈`);
        if (m.sideCount) parts.push(`${m.sideCount} 侧母线`);
        if (m.pointCount) parts.push(`${m.pointCount} 小球`);
        if (m.labelCount) parts.push(`${m.labelCount} 标注`);
        const kind = m.degenerate === 'cone' ? '圆锥（退化）' : (m.degenerate === 'cylinder' ? '圆柱（退化）' : (m.isRight ? '正圆台' : '斜圆台'));
        const topDesc = m.topExplicit
          ? `上底圆心 [${m.top && m.top.length ? m.top.join(',') : '?'}]`
          : `高 ${m.height != null ? m.height : '?'} 沿 [${m.axis && m.axis.length ? m.axis.join(',') : '?'}]`;
        const apexDesc = m.apex ? `，锥顶 [${m.apex.join(',')}]` : '';
        appendLog('ai', `已生成${kind}（圆心 [${m.base && m.base.length ? m.base.join(',') : '?'}]，下底半径 ${m.radiusBottom != null ? m.radiusBottom : '?'} / 上底半径 ${m.radiusTop != null ? m.radiusTop : '?'}，${topDesc}，母线 ${m.slantHeight != null ? m.slantHeight : '?'}${apexDesc}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
      }
      // 2026-11-24 D32：dihedral3d 展示二面角平面角大小、棱与垂足、两半平面射线与圆弧读数（数值以画板返回为准）。
      for (const dh of results) {
        if (!dh.ok || dh.op !== 'dihedral3d') continue;
        const m = dh.meta || {};
        const seg = m.segmentCount != null ? m.segmentCount : '?';
        const parts = [];
        if (m.edgeCount) parts.push(`${m.edgeCount} 棱`);
        if (m.rayCount) parts.push(`${m.rayCount} 平面角边`);
        if (m.arcCount) parts.push(`${m.arcCount} 圆弧`);
        if (m.chordCount) parts.push(`${m.chordCount} 连线`);
        if (m.pointCount) parts.push(`${m.pointCount} 小球`);
        if (m.labelCount) parts.push(`${m.labelCount} 角度标注`);
        const edgeDesc = m.edge && m.edge.length === 2 ? `[${m.edge[0].join(',')}]→[${m.edge[1].join(',')}]` : '?';
        const footDesc = m.footExplicit ? `显式垂足 [${m.foot && m.foot.length ? m.foot.join(',') : '?'}]` : `垂足 [${m.foot && m.foot.length ? m.foot.join(',') : '?'}]（棱上 ${m.footT != null ? m.footT : '?'}）`;
        appendLog('ai', `已生成二面角（平面角 ${m.angleDeg != null ? m.angleDeg : '?'}°，棱 ${edgeDesc}，${footDesc}，射线长 ${m.rayLength != null ? m.rayLength : '?'} / 弧半径 ${m.arcRadius != null ? m.arcRadius : '?'}${m.arcRadiusClamped ? '（已钳制）' : ''}）：${seg} 段${parts.length ? ' / ' + parts.join(' + ') : ''}。`);
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

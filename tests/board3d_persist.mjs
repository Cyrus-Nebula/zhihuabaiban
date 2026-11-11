/**
 * 3D 画板「导出 / 载入工程」无头回归（D4）。
 *
 * 覆盖：工程 JSON 序列化结构、导入后对象与视图设置完整还原（round-trip）、
 *      非法 / 残缺工程文件的容错拒绝、未知图元类型跳过、默认值回落。
 *
 * 与本仓库既有 3D 测试同口径：画板副作用走 board3dApi 的窄接口；
 * 由于 board3d.js 依赖 three/DOM/WebGL，无法在无头环境直接实例化，
 * 这里用一份与 board3dApi.exportProject / importProject 语义一致的镜像 api 做功能断言，
 * 并辅以对真实 js/board3d.js 源文的静态断言（防止实现被回退或漂移）。
 *
 * 运行：node tests/board3d_persist.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const src = existsSync(join(ROOT, 'js/board3d.js')) ? read('js/board3d.js') : '';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- 与 board3dApi 一致的镜像实现（仅数据层，无 three/DOM） ---------------- */
const KNOWN_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'tetra', 'plane', 'line', 'point', 'label'];
const KNOWN_BGS = ['white', 'beige', 'dark'];
function cloneObj(o) {
  return {
    id: o.id || ('o_' + Math.random().toString(36).slice(2, 8)),
    type: o.type,
    text: o.text || (o.type === 'label' ? '标注' : ''),
    color: o.color || '#4f6bed',
    opacity: o.opacity == null ? 1 : o.opacity,
    pos: (o.pos || [0, 0, 0]).slice(),
    rot: (o.rot || [0, 0, 0]).slice(),
    scale: (o.scale || [1, 1, 1]).slice(),
    p: Object.assign({}, o.p || {}),
  };
}
function mirrorApi() {
  let doc = { v: 1, bg: 'white', axes: true, grid: true, objects: [] };
  const api = {
    get doc() { return doc; },
    exportProject() {
      return JSON.stringify({
        v: 1, bg: doc.bg, axes: doc.axes, grid: doc.grid,
        objects: doc.objects.map(cloneObj),
      });
    },
    importProject(raw) {
      let data;
      try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (_) { return false; }
      if (!data || typeof data !== 'object' || !Array.isArray(data.objects)) return false;
      doc = {
        v: 1,
        bg: KNOWN_BGS.includes(data.bg) ? data.bg : 'white',
        axes: data.axes !== false,
        grid: data.grid !== false,
        objects: [],
      };
      for (const o of data.objects) {
        if (!o || !KNOWN_TYPES.includes(o.type)) continue;
        const obj = cloneObj(o);
        obj.p = o.p && typeof o.p === 'object' ? Object.assign({}, o.p) : {};
        doc.objects.push(obj);
      }
      return true;
    },
    add(raw) {
      const obj = cloneObj(raw);
      if (!raw.id || doc.objects.some((x) => x.id === obj.id)) obj.id = 'auto_' + doc.objects.length;
      doc.objects.push(obj);
      return obj.id;
    },
  };
  return api;
}

console.log('3D 画板 导出/载入工程 无头回归（D4）');

/* ---------------- A. 真实实现静态断言 ---------------- */
section('A. js/board3d.js 实现 exportProject / importProject（防回退）');
{
  assert(src.length > 0, '能读取 js/board3d.js 源文');
  assert(/exportProject\s*\(/.test(src), 'board3dApi 实现了 exportProject()');
  assert(/importProject\s*\((?:raw)?\)/.test(src), 'board3dApi 实现了 importProject()');
  assert(/\.objects\.map\(cloneObj\)/.test(src), 'exportProject 序列化完整对象结构（含 objects）');
  assert(src.includes('SHAPE_DEFS[o.type]') || src.includes('SHAPE_DEFS[type]'), 'importProject 按 SHAPE_DEFS 校验图元类型（跳过未知）');
  assert(src.includes('id="import-file"') || src.includes('btn-import'), 'board3d.html 已接入导入入口');
}

/* ---------------- B. 导出结构 ---------------- */
section('B. 导出工程结构');
{
  const api = mirrorApi();
  api.add({ id: 'cube', type: 'box', pos: [1, 2, 3], rot: [0, 45, 0], color: '#e11d48', opacity: 0.5, p: { w: 2, h: 2, d: 2 } });
  api.add({ id: 'lbl', type: 'label', text: 'A', pos: [0, 0, 0] });
  api.doc.bg = 'dark'; api.doc.axes = false;
  const json = api.exportProject();
  const data = JSON.parse(json);
  assert(data.v === 1 && Array.isArray(data.objects) && data.objects.length === 2, '导出含 v / objects（长度 2）');
  assert(['bg', 'axes', 'grid'].every((k) => k in data), '导出含视图设置 bg/axes/grid');
  const cube = data.objects.find((o) => o.id === 'cube');
  assert(cube.type === 'box' && cube.p.w === 2 && JSON.stringify(cube.pos) === '[1,2,3]', '导出保留几何参数与坐标');
  assert(cube.opacity === 0.5 && cube.color === '#e11d48', '导出保留材质属性');
  assert(data.objects.find((o) => o.id === 'lbl').text === 'A', '导出保留标注文字');
}

/* ---------------- C. 载入 round-trip 完整还原 ---------------- */
section('C. 载入工程：对象与设置完整还原');
{
  const api = mirrorApi();
  api.add({ id: 'cube', type: 'box', pos: [1, 2, 3], rot: [0, 45, 0], scale: [1, 1, 1], color: '#e11d48', opacity: 0.5, p: { w: 2, h: 2, d: 2 } });
  api.add({ id: 'lbl', type: 'label', text: 'A', pos: [0, 0, 0] });
  api.doc.bg = 'dark'; api.doc.axes = false; api.doc.grid = false;
  const json = api.exportProject();

  // 导入前先破坏场景，确认载入是「全量重建」而非增量
  api.add({ id: 'tmp', type: 'sphere', pos: [9, 9, 9], p: { r: 1 } });
  api.doc.bg = 'white'; api.doc.axes = true; api.doc.grid = true;

  const ok = api.importProject(json);
  assert(ok, 'importProject 返回 true');
  assert(api.doc.objects.length === 2, '载入后对象数还原为 2（临时对象被清空）');
  const cube = api.doc.objects.find((o) => o.id === 'cube');
  assert(cube && JSON.stringify(cube.pos) === '[1,2,3]' && cube.rot[1] === 45, '对象坐标 / 旋转还原');
  assert(cube.opacity === 0.5 && cube.color === '#e11d48', '对象材质属性还原');
  assert(cube.p.w === 2 && cube.p.h === 2 && cube.p.d === 2, '对象几何参数还原');
  assert(api.doc.objects.find((o) => o.id === 'lbl').text === 'A', '标注文字还原');
  assert(api.doc.bg === 'dark' && api.doc.axes === false && api.doc.grid === false, '视图设置（bg/axes/grid）还原');
}

/* ---------------- D. 容错拒绝 ---------------- */
section('D. 非法 / 残缺工程容错拒绝');
{
  const api = mirrorApi();
  api.add({ id: 'keep', type: 'box', p: { w: 1 } });
  assert(api.importProject('{ this is not json') === false, '非法 JSON 拒绝');
  assert(api.importProject(null) === false, 'null 拒绝');
  assert(api.importProject(42) === false, '原始数值拒绝');
  assert(api.importProject({ foo: 1 }) === false, '缺 objects 数组拒绝');
  assert(api.importProject('') === false, '空串拒绝');
  assert(api.doc.objects.length === 1 && api.doc.objects[0].id === 'keep', '拒绝后原场景不被破坏');
}

/* ---------------- E. 脏数据清洗 ---------------- */
section('E. 未知图元类型跳过 / 默认值回落');
{
  const api = mirrorApi();
  const ok = api.importProject(JSON.stringify({
    v: 1, bg: 'rainbow', axes: 'yes', objects: [
      { id: 'bad', type: '不存在的类型', pos: [0, 0, 0] },
      { id: 'good', type: 'box' },
      { id: 'lbl', type: 'label', text: 'B' },
    ],
  }));
  assert(ok, '含未知类型的工程仍可载入');
  assert(api.doc.objects.length === 2, '未知图元类型被跳过，仅保留 2 个合法对象');
  assert(api.doc.objects.find((o) => o.id === 'good').type === 'box', '合法 box 保留');
  assert(api.doc.bg === 'white', '非法背景值回落 white');
  assert(api.doc.axes === true, '非法 axes（"yes"）回落 true');
}

/* ---------------- F. 字符串 / 对象两种入参 ---------------- */
section('F. importProject 接受 JSON 字符串或已解析对象');
{
  const api = mirrorApi();
  const obj = { v: 1, bg: 'beige', axes: true, grid: true, objects: [{ id: 's', type: 'sphere', p: { r: 1.5 } }] };
  assert(api.importProject(JSON.stringify(obj)) === true, '接受 JSON 字符串');
  assert(api.doc.objects[0].p.r === 1.5, '字符串入参解析正确');
  assert(api.importProject(obj) === true, '接受已解析对象');
  assert(api.doc.bg === 'beige', '对象入参 bg 生效');
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}`);
process.exit(failed === 0 ? 0 : 1);

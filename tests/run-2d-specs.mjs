/**
 * 2D 协议无头单测 · 聚合入口（落实连续多轮 TODO 交接项⑤ · 2026-11-17 第九轮）
 *
 * 一条命令跑齐全部 2D AI 作图协议单测，避免只跑其中一个而漏掉回归：
 *   node tests/run-2d-specs.mjs
 *
 * 只聚合 2D 用例；tests/board3d_*.mjs 归「独立自主 3D 画板」任务维护，不纳入本入口。
 * 故意不新增 package.json / npm test：Cloudflare Pages 会因仓库根目录出现 package.json
 * 而尝试执行构建，影响纯静态站点部署；用 node 直接跑即可，无需安装任何依赖。
 * 硬约束：纯 2D 回归基建，不触碰 3D 分支 / editor.html / appId。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SPECS = [
  'board2d_conic_spec.mjs',
  'board2d_regularPolygon_spec.mjs',
  'board2d_remove_spec.mjs',
  'board2d_function_segments_spec.mjs',
  'board2d_style_point_spec.mjs',
  'board2d_polar_spec.mjs',
  'board2d_inequality_spec.mjs',
  'board2d_center_spec.mjs',
  'board2d_roots_spec.mjs',
  'board2d_zeros_spec.mjs',
  'board2d_intersections_spec.mjs',
];

let failed = 0;
for (const f of SPECS) {
  console.log('\n========== ' + f + ' ==========');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.error) { failed++; console.error('  ✗ ' + f + ' 启动失败：' + r.error.message); continue; }
  if (r.status !== 0) { failed++; console.error('  ✗ ' + f + ' 未通过（exit ' + r.status + '）'); }
}

console.log(`\n=== 2D 单测聚合：${SPECS.length - failed}/${SPECS.length} 个脚本通过 ===`);
if (failed > 0) process.exit(1);

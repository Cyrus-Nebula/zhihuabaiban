/**
 * 立体画板 —— 坐标轴刻度规格（纯函数，不依赖 three / DOM）。
 * 供 js/board3d.js 构建刻度几何与数值标注，亦供无头单测复用，
 * 因此刻意不引入 three，保证 `node tests/board3d_axis_ticks.mjs` 可独立运行。
 */

/**
 * 生成单条坐标轴的刻度规格：从 -axisLen 到 +axisLen，每 1 单位一个刻度，
 * 每 majorEvery 单位为主刻度（附数值标注），其余为次刻度（仅短线）。
 * @param {number} axisLen    轴半长（需与 AxesHelper 长度保持一致）
 * @param {number} majorEvery 主刻度间隔
 * @returns {{value:number, major:boolean, minor:boolean}[]}
 */
export function axisTickSpec(axisLen = 5, majorEvery = 5) {
  if (!(axisLen >= 1)) throw new Error('axisLen 必须 >= 1');
  if (!(majorEvery >= 1)) throw new Error('majorEvery 必须 >= 1');
  const ticks = [];
  for (let v = -axisLen; v <= axisLen; v++) {
    const major = v % majorEvery === 0;
    ticks.push({ value: v, major, minor: !major });
  }
  return ticks;
}

/**
 * 需要打数值标注的主刻度个数（排除以 0 的原点，原点不打数字）。
 * @param {number} axisLen
 * @param {number} majorEvery
 * @returns {number}
 */
export function majorTickCount(axisLen = 5, majorEvery = 5) {
  return axisTickSpec(axisLen, majorEvery).filter((t) => t.major && t.value !== 0).length;
}

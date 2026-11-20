/**
 * 给注入到宿主页面的 UI 打「不可翻译」标记：translate="no"（HTML 标准，会被后代继承）
 * + notranslate class（旧版 Google Translate 约定，主流翻译扩展也识别）+ lang="zh-CN"。
 * 幂等：setAttribute / classList.add 重复调用无副作用。
 * 浮层面板与 toast 共用这一份实现，避免各写一套标记。
 */
export function applyNoTranslate(el: Element): void {
  el.setAttribute("translate", "no");
  el.classList.add("notranslate");
  el.setAttribute("lang", "zh-CN");
}

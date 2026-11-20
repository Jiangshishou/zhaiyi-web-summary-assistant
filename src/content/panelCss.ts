
export const PANEL_OPEN_MS = 200;
export const PANEL_CLOSE_MS = 150;
const FLOATING_DOCK_ENTER_MS = 200;
const FLOATING_DOCK_ACTION_STAGGER_MS = 28;
const SETTINGS_ENTER_MS = 220;
export const SETTINGS_EXIT_MS = 120;
export const SOURCE_TEXT_VIEW_ENTER_MS = 220;
export const SOURCE_TEXT_VIEW_EXIT_MS = 120;
export const STREAM_NODE_ENTER_MS = 160;

export const panelCss = `
  :host {
    display: none;
    /* 视口窄于 426px 时按视口收缩，否则右对齐的面板会从左侧溢出屏幕 */
    width: min(390px, calc(100vw - 36px));
    min-width: min(300px, calc(100vw - 24px));
    max-width: 600px;
    height: calc(100vh * 0.9);
    min-height: 400px;
    max-height: calc(100vh - 40px);
    color-scheme: light dark;
    --rail-x: 20px;
    /* 圆角阶梯（Apple 同心圆角的工程写法）。
       纯公式「内 = 外 − 间隙」只对紧贴嵌套成立：我们列表里的间隙是 12–20px，
       套公式会把所有控件压成 0。等价的可用规则是：
         每一级只比上一级小一个固定台阶，且永远不超过上一级。
       20 → 12 → 8 → 6：面板 → 卡片/浮层菜单 → 控件（按钮/输入/触发器/小图标）
       → 菜单项（= 菜单 12 − 菜单内距 6）。
       浮层菜单取 12 而不是更大：它浮在卡片之上，内圆角不得超过被覆盖的表面。
       胶囊(999 / 50%) 只保留给形状本身有语义的元件：开关轨道与滑块、浮动 dock
       与其内按钮与 tooltip、骨架占位条、圆点、内联在正文行里的标记。 */
    /* 以 24px 为基准的一档：卡片 24，控件 24（36px 高的控件上会被浏览器夹到半高，
       也就是胶囊），面板与浮层再大一级。 */
    --radius-panel: 32px;
    --radius-card: 24px;
    --radius-control: 24px;
    --radius-menu: 24px;
    --radius-menu-option: calc(var(--radius-menu) - 8px);
    --ym-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --ym-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
    --ym-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
    --duration-fast: 150ms;
    --duration-base: 200ms;
    --duration-slow: 300ms;
    --duration-tooltip-delay: 260ms;
    --ym-font-sans: "苹方-简", "PingFang SC", "Source Han Sans CN", "Source Han Sans SC", "Noto Sans CJK SC", "思源黑体 CN", "思源黑体 SC", "思源黑体", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
    /* 字号阶梯：整页只用这四档，层级靠字重与颜色区分，不靠新增字号 */
    --fs-xs: 12px;
    --fs-s: 13px;
    --fs-m: 14px;
    --fs-l: 16px;
    font-family: var(--ym-font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :host([data-open="true"]) {
    display: block;
  }

  .panel {
    position: relative;
    /* 切断「未显式设行高的文本继承被注入网页行高」这条链：面板是注入到任意站点的
       浮层，宿主页的 html { line-height } 会把标题、标签等挤出字形应有的行盒 */
    line-height: 1.5;
    --bg: #201d1b;
    --bg-elevated: #292522;
    --text: #efeae4;
    --muted: #ada69f;
    --soft: #948b83;
    --border: #3b3532;
    --danger: #c97b6b;
    --accent: #6ba8b0;
    --success: #7a9a72;
    --shadow-color: rgba(28, 22, 18, 0.28);
    --shadow-color-light: rgba(40, 32, 24, 0.10);
    /* 二级按钮/下拉触发器共用这一层表面：正文色的低透明度压在卡片上，明暗都得到
       与卡片可分辨的边界。旧的 --bg-elevated 系是近白，浅色卡片上等于没有边界。
       必须声明在 .panel 里——它引用 --text，而 --text 就定义在这块，
       放到 :host 会让 var(--text) 落空、整条背景失效成透明。 */
    --surface-secondary: color-mix(in srgb, var(--text), transparent 90%);
    --surface-secondary-hover: color-mix(in srgb, var(--text), transparent 84%);
    /* 浮在滚动内容之上的控件（设置页头部的返回/清除）用不透明表面：
       半透明表面会让下面滚过的文字透出来，看起来像「按钮没背景」。 */
    --surface-raised: color-mix(in srgb, var(--bg-elevated), var(--text) 10%);
    --surface-raised-hover: color-mix(in srgb, var(--bg-elevated), var(--text) 16%);
    background: var(--bg);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.06),
      0 12px 40px var(--shadow-color);
    border-radius: var(--radius-panel);
    height: 100%;
    max-height: inherit;
    display: flex;
    flex-direction: column;
    overflow: visible;
    opacity: 1;
    transform: translateY(0) scale(1);
    transform-origin: top right;
  }

  .panel::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    height: 48px;
    border-radius: 0 0 var(--radius-panel) var(--radius-panel);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ym-ease-out);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--bg), transparent 34%) 0%,
      color-mix(in srgb, var(--bg), transparent 78%) 64%,
      transparent 100%
    );
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--soft), transparent 30%) transparent;
  }

  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--soft), transparent 35%);
    border-radius: 999px;
  }

  :host([data-theme="light"]) .panel {
    /* 中性灰白：主底带一点点灰，卡面纯白。浅色取色只在这一块定义一次，
       其余控件靠 --bg / --text 互相取反自动跟随，不再各自写死颜色。 */
    --bg: #f5f5f6;
    --bg-elevated: #ffffff;
    --text: #1f2024;
    --muted: #6b6d72;
    --soft: #74767c;
    --border: #e7e7e9;
    --accent: #3f686d;
    /* 语义色在浅色下要自己的取值：暗色块那两颗放在灰白底上偏旧纸色 */
    --danger: #b4544a;
    --success: #5f7d57;
    /* 面板投影一律中性灰蓝：灰白底配暖棕阴影会发脏 */
    --shadow-color: rgba(15, 23, 42, 0.10);
    --shadow-color-light: rgba(15, 23, 42, 0.05);
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.06),
      0 12px 40px var(--shadow-color);
  }

  .topbar {
    position: relative;
    z-index: 20;
    height: 54px;
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(72px, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 14px;
    border-bottom: 0;
    cursor: grab;
    user-select: none;
    flex: 0 0 auto;
    overflow: visible;
  }
  .panel-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .thinking-slot {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
  }

  .model-fallback,
  .model-current {
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 178px;
  }

  .model-select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 190px;
  }

  .model-current {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 172px;
    line-height: 1.2;
  }

  .model-current-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-thinking-icon {
    width: 13px;
    height: 13px;
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--accent);
  }

  .model-thinking-icon svg {
    width: 13px;
    height: 13px;
  }

  details > summary {
    list-style: none;
  }

  details > summary::-webkit-details-marker {
    display: none;
  }

  .model-trigger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: var(--radius-control);
    color: var(--text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
    border-radius: 999px;
    padding: 0 4px;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-toggle:active {
    scale: 0.97;
  }

  .thinking-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .thinking-icon {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--muted);
    transition: color var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-toggle-on .thinking-icon {
    color: var(--accent);
  }

  .thinking-icon svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .thinking-track {
    position: relative;
    width: 30px;
    height: 18px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text), transparent 82%);
    transition: background var(--duration-fast) var(--ym-ease-out);
    flex: 0 0 auto;
  }

  .thinking-toggle-on .thinking-track {
    background: var(--accent);
  }

  .thinking-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--bg-elevated);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-toggle-on .thinking-thumb {
    transform: translateX(12px);
  }

  .thinking-current {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    font-weight: 800;
    color: var(--muted);
    transition: color var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-toggle-on .thinking-current {
    color: var(--text);
  }

  .model-trigger:hover {
    color: var(--text);
  }

  .thinking-select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 112px;
  }

  .thinking-trigger {
    box-sizing: border-box;
    min-width: 82px;
    max-width: 112px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 9px;
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    color: var(--muted);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-trigger:hover {
    background: var(--surface-secondary-hover);
    color: var(--text);
  }

  .thinking-trigger:active,
  .thinking-trigger.pressed {
    scale: 0.97;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }

  .thinking-trigger svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .thinking-chevron {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
  }

  .model-trigger svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
    transition: transform var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out);
  }

  .model-chevron {
    display: inline-grid;
    place-items: center;
    color: var(--muted);
  }

  details[open] .model-chevron svg {
    transform: rotate(180deg);
  }
  details[open] > *:not(summary):not(.liquid-menu) {
    opacity: 1;
    transform: translateY(0);
    transition: opacity var(--duration-base) var(--ym-ease-out), transform var(--duration-base) var(--ym-ease-out);
  }
  @starting-style {
    details[open] > *:not(summary):not(.liquid-menu) {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  .liquid-menu {
    position: absolute;
    top: calc(100% + 9px);
    left: 0;
    z-index: 12;
    min-width: 180px;
    /* 菜单宽度由内容撑开时必须封顶，否则长服务商名会把菜单推出面板右侧 */
    max-width: min(260px, calc(100vw - 60px));
    display: grid;
    gap: 4px;
    padding: 7px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 35%);
    border-radius: var(--radius-menu);
    background: color-mix(in srgb, var(--bg-elevated), transparent 34%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 8px 24px rgba(40, 36, 32, 0.14);
    backdrop-filter: blur(20px) saturate(1.1);
    transform-origin: top left;
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
    overflow: hidden;
  }

  .model-menu[open] .liquid-menu,
  .settings-select[open] .liquid-menu {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  /* 菜单被通用规则 details[open] > *:not(summary) 排除（避免它 150ms 的过渡被
     拉长到 200ms 后被 160ms 的关闭定时器截断），因此不再从那条规则获得入场起始态。
     这里补一份，否则首次渲染直接是终态、入场淡入消失。 */
  @starting-style {
    .model-menu[open] > .liquid-menu,
    .thinking-menu[open] > .liquid-menu,
    .settings-select[open] > .liquid-menu {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }

  .model-menu.closing .liquid-menu,
  .settings-select.closing .liquid-menu {
    pointer-events: none;
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }

  :host([data-theme="light"]) .liquid-menu {
    background: color-mix(in srgb, var(--bg-elevated), transparent 30%);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  }

  .model-menu .liquid-menu {
    /* 与上面的触发器左对齐：居中会让比触发器更宽的菜单从左侧探出去，
       看着像错位。 */
    left: 0;
    /* 宽度跟着内容走，只封顶不设固定窄宽：112px 装不下「DeepSeek 网页端」，
       会逼出换行。 */
    width: max-content;
    min-width: 136px;
    max-width: calc(100vw - 32px);
    max-height: min(420px, calc(100vh - 140px));
    overflow-x: hidden;
    overflow-y: auto;
    transform-origin: top left;
  }

  .thinking-menu[open] .liquid-menu {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .thinking-menu.closing .liquid-menu {
    pointer-events: none;
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }

  .thinking-menu .liquid-menu {
    left: 50%;
    min-width: 112px;
    max-width: calc(100vw - 32px);
    max-height: min(420px, calc(100vh - 140px));
    overflow-x: hidden;
    overflow-y: auto;
    transform-origin: top center;
    translate: -50% 0;
  }

  .liquid-option {
    width: 100%;
    min-width: 0;
    border-radius: var(--radius-menu-option);
    padding: 8px 10px;
    background: transparent;
    color: var(--muted);
    text-align: left;
    font-size: var(--fs-xs);
    font-weight: 700;
    /* 菜单项永远单行：换行会把「DeepSeek 网页版 · DeepSeek」拆成三行，
       菜单看起来像个列表而不是选择器。超长由 .liquid-option-label 省略。 */
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  /* 文本层单独收省略号：svg 勾选图标是 flex 兄弟，不能被一起截断 */
  .liquid-option-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .liquid-option:hover {
    background: color-mix(in srgb, var(--text), transparent 94%);
    color: var(--text);
  }

  .liquid-option.active {
    color: var(--accent, var(--text));
  }

  .liquid-option.active:hover {
    background: color-mix(in srgb, var(--text), transparent 94%);
  }

  .liquid-option-active-indicator {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    opacity: 1;
    color: var(--accent, var(--text));
  }

  .liquid-option-active-indicator svg {
    width: 14px;
    height: 14px;
  }

  .liquid-option:active,
  .liquid-option.pressed {
    scale: 0.97;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }

  .liquid-option:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .top-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }

  button {
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  .icon-button {
    width: 32px;
    height: 32px;
    display: inline-grid;
    place-items: center;
    background: transparent;
    color: var(--muted);
    border-radius: var(--radius-control);
    font-size: var(--fs-l);
    line-height: 1;
    transition-property: background, color, scale;
    transition-duration: var(--duration-fast);
    transition-timing-function: var(--ym-ease-out);
  }

  .icon-button:hover {
    background: var(--bg-elevated);
    color: var(--text);
  }

  .icon-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .icon-button:active,
  .icon-button.pressed {
    scale: 0.96;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }

  .icon-button.spinning svg {
    animation: ym-top-action-spin 260ms var(--ym-ease-out);
  }

  @keyframes ym-top-action-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .dots {
    font-size: var(--fs-s);
    letter-spacing: 1px;
  }

  .page-row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 12px 0;
    padding: 8px 12px;
    min-height: 48px;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--border), transparent 30%);
    border-radius: calc(var(--radius-card) - 4px);
    flex: 0 0 auto;
  }

  .page-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 800;
  }

  .page-title-copy {
    position: relative;
    min-width: 0;
    max-width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .page-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
    flex-wrap: wrap;
  }

  .page-title-text,
  .page-author {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-title-text {
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.25;
    /* 不要在此加 text-wrap：它是长属性，会覆盖上面 white-space: nowrap 简写的
       text-wrap 分量，导致 span 标题折行、行高变化、作者头像跳动 */
  }

  .page-author {
    color: color-mix(in srgb, var(--muted), var(--soft) 22%);
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: 0.01em;
  }

  .page-title img,
  .leaf {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex: 0 0 auto;
    outline: 1px solid rgba(255, 255, 255, 0.1);
    outline-offset: -1px;
  }

  :host([data-theme="light"]) .page-title img,
  :host([data-theme="light"]) .leaf {
    outline-color: rgba(0, 0, 0, 0.1);
  }

  .leaf {
    background: var(--accent);
  }

  button.page-title-text {
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }
  button.page-title-text:active {
    scale: 0.97;
  }
  button.page-title-text:focus-visible {
    outline: 1px solid var(--text);
    outline-offset: 2px;
    border-radius: 2px;
  }
  @media (hover: hover) and (pointer: fine) {
    button.page-title-text:hover {
      opacity: 0.8;
    }
  }

  .diagnostic-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 20px;
    background: color-mix(in srgb, #000, transparent 40%);
    backdrop-filter: blur(6px) saturate(1.2);
    border-radius: var(--radius-panel);
    overflow: hidden;
    opacity: 1;
    transition: opacity var(--duration-base) var(--ym-ease-out);
  }

  @starting-style {
    .diagnostic-overlay {
      opacity: 0;
    }
  }

  .diagnostic-modal {
    position: relative;
    width: 100%;
    max-width: 520px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--border), transparent 28%);
    border-radius: var(--radius-menu);
    box-shadow: 0 8px 24px rgba(40, 36, 32, 0.18);
    opacity: 1;
    scale: 1;
    transition: opacity var(--duration-base) var(--ym-ease-out), scale var(--duration-base) var(--ym-ease-out);
  }

  @starting-style {
    .diagnostic-modal {
      opacity: 0;
      scale: 0.96;
    }
  }

  :host([data-theme="light"]) .diagnostic-modal {
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  }

  .diagnostic-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 0 16px;
  }

  .diagnostic-modal-header h3 {
    margin: 0;
    font-size: var(--fs-m);
    font-weight: 800;
    color: var(--text);
  }

  .diagnostic-modal-body {
    margin: 8px 12px;
    padding: 10px 12px;
    overflow: auto;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--bg-elevated), transparent 60%);
    font-family: ui-monospace, monospace;
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--soft);
    white-space: pre-wrap;
    tab-size: 2;
    max-height: 55vh;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .diagnostic-modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 0 12px 12px;
  }
  .diagnostic-modal-footer .icon-button {
    width: auto;
    height: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: var(--fs-xs);
  }
  .icon-button.source-refresh-loading svg {
    animation: ym-translate-icon-fade 900ms linear infinite;
  }

  .icon-button[data-action="refresh-source"] .lucide-refresh-cw {
    width: 16px;
    height: 16px;
  }

  .icon-button.source-refresh-success {
    color: var(--accent);
    animation: ym-action-feedback-crossfade 160ms var(--ym-ease-out);
  }

  .icon-button.source-refresh-failure {
    color: var(--danger);
    animation: ym-action-feedback-crossfade 160ms var(--ym-ease-out);
  }

  .warning-line {
    margin: 9px var(--rail-x) 0;
    color: var(--danger);
    font-size: var(--fs-xs);
    line-height: 1.5;
    flex: 0 0 auto;
    opacity: 1;
    transform: translateY(0);
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
  }

  @starting-style {
    .warning-line {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  /* 胶囊：这类标记内联在正文行里，圆角跟文字基线走，不参与控件阶梯 */
  .inline-action {
    margin-left: 8px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-secondary);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 700;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .inline-action:hover {
    background: color-mix(in srgb, var(--text), transparent 84%);
  }

  .inline-action:active {
    scale: 0.97;
  }

  .content-view > .loading,
  .error-box {
    margin: 14px;
    padding: 14px;
    border: 1px solid var(--border);
    /* 这是卡片级表面（面板内缩 14px 的浮起块），不是控件；用控件圆角会让它
       比同级的 .setup-card 方一大截 */
    border-radius: var(--radius-card);
    background: var(--bg-elevated);
    color: var(--muted);
    font-size: var(--fs-s);
    opacity: 1;
    transform: translateY(0) scale(1);
    transition: opacity var(--duration-base) var(--ym-ease-out), transform var(--duration-base) var(--ym-ease-out);
  }

  /* 空态卡：一张「这一页的卡」，四段结构 —— 封面、站点行、标题、动作。
     它必须从状态卡共用规则里拆出来：封面要贴着卡片边缘，与共用规则的内距冲突。
     共用规则里另两张（失败态、加载骨架）的几何逐字不变。 */

  /* Static deck: every layer is centered and 95% of the previous one. */
  .empty-stack {
    position: relative;
    width: min(256px, 100%);
    aspect-ratio: 32 / 37;
    height: auto;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    margin: auto;
    isolation: isolate;
  }

  .empty-stack::before,
  .empty-stack::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    border-radius: var(--radius-panel);
    pointer-events: none;
  }

  .empty-stack::before {
    z-index: 1;
    width: 90%;
    height: 90%;
    transform: translate(-50%, calc(-50% + 24px));
    background: var(--bg-elevated);
    filter: blur(0.2px);
    opacity: 0.88;
  }

  .empty-stack::after {
    z-index: 0;
    width: 81%;
    height: 81%;
    transform: translate(-50%, calc(-50% + 48px));
    background: var(--bg-elevated);
    filter: blur(1.2px);
    opacity: 0.4;
  }

  .empty {
    position: relative;
    z-index: 2;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    margin: 0;
    /* The main card and both backs follow the larger panel radius token. */
    padding: 12px;
    border: 0;
    border-radius: var(--radius-panel);
    background: var(--bg-elevated);
    color: var(--muted);
    font-size: var(--fs-xs);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--border), transparent 35%),
      0 8px 20px var(--shadow-color);
    transition: box-shadow var(--duration-base) var(--ym-ease-out);
    overflow: visible;
  }

  /* 缩略图区：占卡片内容高的 46%，与参考图里那块图的占比一致。
     文字块在下半部，不压图。 */
  .empty-cover {
    position: relative;
    flex: 0 0 auto;
    aspect-ratio: 58 / 43;
    /* Match the reference cover ratio and shrink with the card on narrow viewports. */
    height: auto;
    display: grid;
    place-items: center;
    border-radius: var(--radius-card);
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--text), transparent 93%),
      color-mix(in srgb, var(--text), transparent 86%)
    );
    overflow: hidden;
  }

  /* 固定占位插画：抓不到封面时用它，形状照参考图那张「一张纸 + 一叠行」 */
  .empty-cover-art {
    /* 固定高：缩略图高由卡片尺寸推出（290 − 2×7% ≈ 258，其中 46% 约 118px），
       百分比高度在 grid 里会退回内容高度，插画会缩成一小块。 */
    height: 92px;
    width: auto;
    display: block;
    filter: drop-shadow(0 2px 7px rgba(15, 23, 42, 0.14));
  }

  .empty-art-face {
    fill: color-mix(in srgb, var(--text), transparent 74%);
  }

  .empty-art-back {
    fill: color-mix(in srgb, var(--text), transparent 86%);
  }

  .empty-art-line {
    fill: color-mix(in srgb, var(--text), transparent 80%);
  }

  :host([data-theme="light"]) .empty-art-face {
    fill: #ffffff;
  }

  :host([data-theme="light"]) .empty-art-back {
    fill: #f4f4f7;
  }

  :host([data-theme="light"]) .empty-art-line {
    fill: #c9c9d2;
  }

  /* 真封面：顶部对齐裁切，固定高度内铺满；高度不随页面变化，卡片不会高低跳 */
  .empty-cover-img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    object-position: top center;
  }

  .empty-cover-icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    object-fit: contain;
  }

  .empty-cover-letter {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--text), transparent 90%);
    color: var(--soft);
    font-size: var(--fs-l);
    font-weight: 800;
  }

  /* 占位层叠在封面之上：有真封面时隐藏，封面加载失败时立刻露出来 */
  .empty-cover-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .empty-cover-fallback[hidden] {
    display: none;
  }

  /* 文字块回到封面下方：站点行在上、标题在下，都走正常流，不叠在图上 */
  /* 紧贴封面下沿：不留大段空白；margin-bottom 只负责与压边胶囊拉开距离 */
  .empty-info {
    margin-top: 0;
    margin-bottom: 10px;
    display: grid;
    gap: 4px;
    padding-top: 7px;
  }

  .empty-site {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--soft);
    font-size: 11px;
  }

  .empty-site-icon,
  .empty-site-dot {
    width: 17px;
    height: 17px;
    border-radius: 4px;
    flex: 0 0 auto;
    object-fit: contain;
  }

  .empty-site-dot {
    background: color-mix(in srgb, var(--text), transparent 86%);
  }

  .empty-site-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: 700;
  }

  .empty-site-meta {
    margin-left: auto;
    flex: 0 0 auto;
    color: var(--soft);
    font-variant-numeric: tabular-nums;
  }

  .empty-title {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0;
    text-wrap: pretty;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @starting-style {
    .error-box {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  .content-view > .loading {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 20px 24px;
  }

  /* 状态区按钮：主按钮与次要按钮共用同一套几何（等高、同内距、同圆角），
     主次只靠填充区分。描边一律用 inset 阴影画，不用真实 border——
     真实 border 会让次要按钮比主按钮高 2px，而主按钮原先的 margin-top: 8px
     在 flex 行里会被拉伸吃掉，又是 8px 落差，两者叠加就成了「重试比别的按钮小」。 */
  .empty button,
  .error-box button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-control);
    background: var(--text);
    color: var(--bg);
    font-size: var(--fs-s);
    font-weight: 700;
    box-shadow: inset 0 0 0 1px transparent;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), box-shadow var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  /* 空态主操作保持胶囊形状，并固定在卡片内部左下角。 */
  .empty button {
    position: absolute;
    left: 12px;
    bottom: 12px;
    top: auto;
    z-index: 3;
    min-height: 31px;
    padding: 0 16px;
    border-radius: 999px;
    font-size: 13px;
    white-space: nowrap;
    transform: none;
    transition:
      background var(--duration-fast) var(--ym-ease-out),
      color var(--duration-fast) var(--ym-ease-out),
      box-shadow var(--duration-fast) var(--ym-ease-out),
      scale var(--duration-fast) var(--ym-ease-out),
      transform var(--duration-fast) var(--ym-ease-out);
    box-shadow:
      0 2px 6px var(--shadow-color-light),
      0 10px 22px var(--shadow-color);
  }

  /* 首次运行引导卡：面板正文区的空态容器，不做卡片套卡片，只用一层中性边框 */
  .setup-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 14px;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 20%);
    border-radius: var(--radius-card);
    background: var(--bg-elevated);
  }

  .setup-title {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-l);
    font-weight: 700;
    line-height: 1.35;
  }

  .setup-desc {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-s);
    font-weight: 400;
    line-height: 1.6;
    text-wrap: pretty;
  }

  .setup-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .setup-action {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: 100%;
    box-sizing: border-box;
    padding: 11px 13px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 20%);
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text);
    text-align: left;
    transition: background var(--duration-fast) var(--ym-ease-out), border-color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  /* 主按钮只用强调色的低饱和底与描边，不做整块高饱和填充 */
  .setup-action-primary {
    border-color: color-mix(in srgb, var(--accent), transparent 45%);
    background: color-mix(in srgb, var(--accent), transparent 92%);
  }

  .setup-action-label {
    font-size: var(--fs-m);
    font-weight: 700;
    line-height: 1.4;
  }

  .setup-action-meta {
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: 400;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .setup-action:hover {
    border-color: color-mix(in srgb, var(--accent), transparent 30%);
  }

  .setup-action:active {
    scale: 0.98;
  }

  /* 正文视图标题里的字数：最小一档，次要色，数字等宽对齐 */
  .source-text-count {
    color: var(--soft);
    font-size: var(--fs-xs);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }

  .error-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .error-box button.error-secondary {
    background: var(--surface-secondary);
    color: var(--text);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border), transparent 15%);
  }

  .error-box button.error-secondary:hover {
    background: var(--surface-secondary-hover);
  }

  .empty button:active,
  .error-box button:active {
    scale: 0.96;
  }

  .error-box strong {
    color: var(--danger);
  }

  .ocr-ready-view {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12px;
  }

  .ocr-ready-card {
    width: 100%;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--bg-elevated);
    opacity: 1;
    transform: translateY(0) scale(1);
    transition: opacity var(--duration-slow) var(--ym-ease-out), transform var(--duration-slow) var(--ym-ease-out);
  }

  @starting-style {
    .ocr-ready-card {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
  }

  .ocr-ready-icon {
    width: 34px;
    height: 34px;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text), transparent 92%);
    color: var(--text);
  }

  .ocr-ready-icon svg {
    width: 18px;
    height: 18px;
  }

  .ocr-ready-copy h2 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 700;
    line-height: 1.35;
  }

  .ocr-ready-copy p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .ocr-detail {
    margin-top: 8px;
    color: var(--soft);
    font-size: var(--fs-xs);
  }

  .ocr-detail summary {
    cursor: pointer;
    color: var(--muted);
  }

  .ocr-detail pre {
    margin: 6px 0 0;
    padding: 8px;
    max-height: 120px;
    overflow-x: hidden;
    overflow-y: auto;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text), transparent 94%);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .ocr-actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }

  .ocr-primary-action {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 7px 12px;
    border-radius: var(--radius-control);
    background: var(--text);
    color: var(--bg);
    font-size: var(--fs-xs);
    font-weight: 800;
    transition: opacity var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .ocr-primary-action svg {
    width: 15px;
    height: 15px;
  }

  .ocr-primary-action:disabled {
    cursor: default;
    opacity: 0.72;
  }

  .ocr-primary-action:active:not(:disabled) {
    scale: 0.97;
  }

  .summary {
    position: relative;
    padding: 0 var(--rail-x) 56px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    overflow-wrap: anywhere;
    max-height: none;
    flex: 1 1 auto;
    min-height: 120px;
  }

  .content-view-summary > .summary {
    padding-right: 12px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .content-view-summary > .summary::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .summary::before {
    content: "";
    display: block;
    position: sticky;
    left: calc(var(--rail-x) * -1);
    width: calc(100% + (var(--rail-x) * 2));
    z-index: 2;
    height: 42px;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ym-ease-out);
  }

  .summary::before {
    top: 0;
    margin-bottom: -42px;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--bg), transparent 36%) 0%,
      color-mix(in srgb, var(--bg), transparent 76%) 64%,
      transparent 100%
    );
  }

  .panel.scrolled.scroll-has-overflow .summary::before,
  .panel.scroll-has-overflow:not(.scroll-at-bottom)::before {
    opacity: 1;
  }

  .summary.overview-loading-wrap {
    position: absolute;
    inset: 0 0 18px;
    display: grid;
    place-items: stretch;
    padding: 0;
    height: auto;
    max-height: calc(100% - 18px);
    min-height: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .tabs {
    box-sizing: border-box;
    position: relative;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 24px;
    height: 58px;
    padding: 14px var(--rail-x) 12px;
    flex: 0 0 auto;
  }

  .panel.scrolled .tabs {
    height: 0;
    max-height: 0;
    padding: 0 var(--rail-x);
    overflow: hidden;
  }

  /* 空态这一叠刻意要溢出内容区顶部一点，才可能相对整个浮窗居中：
     其余状态一律裁切，避免滚动内容渗出。 */
  .content-view:has(> .empty-stack) {
    overflow: visible;
    /* 上抬 168 的一半，把卡片中线从「内容区中线」对到「浮窗中线」。
       用 padding 而不是给卡片写下外边距：均分公式对卡片高度不敏感。 */
    padding-bottom: 168px;
  }

  .content-view {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 1;
    transform: translateY(0);
  }

  .content-view.entering {
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
  }

  .content-view > .summary,
  .content-view > .subtitle-view {
    flex: 1 1 auto;
  }

  @starting-style {
    .content-view.entering {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .tab {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 7px;
    height: 30px;
    background: transparent;
    color: var(--soft);
    font-size: var(--fs-m);
    font-weight: 700;
    line-height: 30px;
    padding: 0;
    opacity: 0.55;
    white-space: nowrap;
    transition: opacity var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .tab svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .tab.active {
    color: var(--text);
    opacity: 1;
  }

  .tab:active {
    scale: 0.96;
  }

  .tab:disabled {
    cursor: default;
  }

  .floating-action-dock {
    position: absolute;
    left: auto;
    right: var(--rail-x);
    bottom: 16px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 28%);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-elevated), transparent 62%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.10),
      inset 0 -1px 0 rgba(255, 255, 255, 0.04),
      0 6px 18px rgba(40, 36, 32, 0.12);
    backdrop-filter: blur(12px) saturate(1.1);
    isolation: isolate;
    opacity: 1;
    transform: translateX(0) translateY(0) scale(1);
    transition: opacity ${FLOATING_DOCK_ENTER_MS}ms var(--ym-ease-out), transform ${FLOATING_DOCK_ENTER_MS}ms var(--ym-ease-out);
    will-change: opacity, transform;
  }

  :host([data-theme="light"]) .floating-action-dock {
    background: color-mix(in srgb, var(--bg-elevated), transparent 64%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.48),
      inset 0 -1px 0 rgba(255, 255, 255, 0.24),
      0 6px 18px rgba(15, 23, 42, 0.08);
  }

  .panel.dock-hidden .floating-action-dock {
    opacity: 0;
    transform: translateX(0) translateY(12px) scale(0.98);
    pointer-events: none;
  }

  .dock-action {
    position: relative;
    width: 32px;
    height: 32px;
    min-width: 32px;
    box-sizing: border-box;
    display: inline-grid;
    place-items: center;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-elevated), transparent 76%);
    color: var(--soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border), transparent 62%);
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .floating-action-dock .dock-action {
    opacity: 1;
    transform: translateY(0) scale(1);
    transition:
      background var(--duration-fast) var(--ym-ease-out),
      color var(--duration-fast) var(--ym-ease-out),
      scale var(--duration-fast) var(--ym-ease-out),
      opacity var(--duration-fast) var(--ym-ease-out) calc(var(--dock-action-index, 0) * ${FLOATING_DOCK_ACTION_STAGGER_MS}ms),
      transform var(--duration-fast) var(--ym-ease-out) calc(var(--dock-action-index, 0) * ${FLOATING_DOCK_ACTION_STAGGER_MS}ms);
    will-change: opacity, transform;
  }

  .dock-action:hover {
    background: color-mix(in srgb, var(--bg-elevated), transparent 44%);
    color: var(--text);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 0 0 1px color-mix(in srgb, var(--text), transparent 78%);
  }

  .dock-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .dock-action:active,
  .dock-action.pressed {
    scale: 0.96;
    transition: scale var(--duration-fast) var(--ym-ease-out);
  }

  .dock-action.success {
    color: var(--text);
    background: color-mix(in srgb, var(--text), transparent 88%);
    animation: ym-action-feedback-crossfade 160ms var(--ym-ease-out);
  }

  .dock-action.failure {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger), transparent 88%);
    animation: ym-action-feedback-crossfade 160ms var(--ym-ease-out);
  }

  .dock-action:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .dock-action.loading {
    color: var(--text);
  }

  .dock-action.loading svg {
    animation: ym-translate-icon-fade 900ms linear infinite;
  }

  .icon-button svg,
  .dock-action svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .icon-button {
    position: relative;
  }

  .icon-button::after,
  .dock-action::after {
    content: attr(aria-label);
    position: absolute;
    left: 50%;
    z-index: 40;
    width: max-content;
    max-width: 160px;
    padding: 6px 9px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 38%);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--bg-elevated), transparent 12%);
    color: var(--text);
    box-shadow: 0 6px 18px rgba(40, 36, 32, 0.14);
    backdrop-filter: blur(12px) saturate(1.1);
    font-size: var(--fs-xs);
    font-weight: 700;
    line-height: 1.2;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%) translateY(4px) scale(0.98);
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
  }

  .icon-button::after {
    top: calc(100% + 8px);
    transform-origin: top center;
  }

  .dock-action::after {
    bottom: calc(100% + 8px);
    transform-origin: bottom center;
  }

  :host([data-theme="light"]) .icon-button::after,
  :host([data-theme="light"]) .dock-action::after {
    background: color-mix(in srgb, var(--bg-elevated), transparent 10%);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  }

  .subtitle-actions,
  .content-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  @starting-style {
    .floating-action-dock {
      opacity: 0;
      transform: translateX(0) translateY(8px) scale(0.96);
    }

    .floating-action-dock .dock-action {
      opacity: 0;
      transform: translateY(4px) scale(0.96);
    }
  }

  @keyframes ym-translate-icon-fade {
    0%, 100% {
      opacity: 0.42;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes ym-action-feedback-crossfade {
    from {
      opacity: 0.62;
    }
    to {
      opacity: 1;
    }
  }

  .panel-settings {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    /* 设置页按自身宽度做容器查询，窄面板时标签与控件改为上下两段 */
    container-type: inline-size;
    container-name: panel;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 10px var(--rail-x) 60px;
    overscroll-behavior-y: contain;
    scrollbar-width: none;
    -ms-overflow-style: none;
    opacity: 1;
    transform: translateX(0);
    transition: opacity ${SETTINGS_ENTER_MS}ms var(--ym-ease-out), transform ${SETTINGS_ENTER_MS}ms var(--ym-ease-out);
  }

  .panel-settings::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .panel-settings::before {
    content: "";
    position: sticky;
    left: 0;
    right: 0;
    z-index: 3;
    display: block;
    margin-left: calc(var(--rail-x) * -1);
    margin-right: calc(var(--rail-x) * -1);
    pointer-events: none;
  }

  .panel-settings::before {
    top: -10px;
    height: 72px;
    margin-top: -10px;
    margin-bottom: -62px;
    border-radius: var(--radius-panel) var(--radius-panel) 0 0;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--bg), transparent 0%) 0%,
      color-mix(in srgb, var(--bg), transparent 22%) 34%,
      color-mix(in srgb, var(--bg), transparent 56%) 72%,
      transparent 100%
    );
  }

  .panel-settings.entering {
    transition-duration: ${SETTINGS_ENTER_MS}ms;
  }

  .panel-settings.exiting {
    opacity: 0;
    transform: translateX(12px);
    transition-duration: ${SETTINGS_EXIT_MS}ms;
    transition-timing-function: var(--ym-ease-out);
    pointer-events: none;
  }

  @starting-style {
    .panel-settings.entering {
      opacity: 0;
      transform: translateX(18px);
    }
  }

  .settings-head {
    position: sticky;
    top: 0;
    z-index: 30;
    isolation: isolate;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -10px calc(var(--rail-x) * -1) 18px;
    padding: 10px 16px 12px;
    background: transparent;
    cursor: grab;
    user-select: none;
  }

  .settings-back,
  .settings-save,
  .settings-pill-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-control);
    padding: 8px 12px;
    background: var(--surface-raised);
    color: var(--text);
    font-size: var(--fs-s);
    font-weight: 700;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .settings-back:hover,
  .settings-pill-action:hover {
    background: var(--surface-raised-hover);
  }

  .settings-save:hover {
    background: color-mix(in srgb, var(--text), transparent 8%);
    color: var(--bg);
  }

  .settings-back:active,
  .settings-save:active,
  .settings-pill-action:active {
    scale: 0.96;
  }

  .settings-back svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
    transform: rotate(90deg);
  }

  .settings-save {
    min-width: 84px;
    justify-content: center;
    background: var(--text);
    color: var(--bg);
  }

  .settings-save.success,
  .settings-pill-action.success {
    min-width: 84px;
    padding-inline: 16px;
    background: color-mix(in srgb, var(--text), transparent 10%);
    color: var(--bg);
  }

  .settings-pill-action {
    min-width: 84px;
    justify-content: center;
  }

  /* 间距走 4 的网格：22 不在网格上，与 16/24 的分组内距凑不成节奏 */
  .settings-group {
    margin: 0 0 24px;
  }

  /* 「浏览器登录」是嵌在「AI 服务」组内部的二级组：父组只有下外边距，
     它的上边缘会紧贴上方卡片底边。取同组内另一处子块（自定义服务商列表）
     的既有间距值，既补上间距又维持「子段比大段紧」的层级。 */
  .settings-group-provider > .settings-group-web {
    margin-top: 12px;
  }

  .settings-group h2 {
    margin: 0 0 10px;
    color: var(--text);
    font-size: var(--fs-l);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.4;
    text-wrap: balance;
  }

  .settings-card {
    border: 1px solid color-mix(in srgb, var(--border), transparent 20%);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--bg-elevated), transparent 58%);
    overflow: visible;
  }

  .custom-provider-list {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    overflow: visible;
  }

  .settings-group-provider .settings-group-web .settings-card + .settings-card {
    margin-top: 10px;
  }

  .custom-provider-group {
    position: relative;
    border: 1px solid color-mix(in srgb, var(--border), transparent 24%);
    border-radius: var(--radius-card);
    background: color-mix(in srgb, var(--bg-elevated), transparent 64%);
    overflow: visible;
  }

  .custom-provider-summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 14px;
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 800;
    list-style: none;
    cursor: pointer;
  }

  .custom-provider-summary::-webkit-details-marker {
    display: none;
  }

  .custom-provider-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .custom-provider-chevron {
    display: inline-grid;
    place-items: center;
    color: var(--muted);
    transition: transform var(--duration-fast) var(--ym-ease-out);
  }

  .custom-provider-chevron svg {
    transition: transform var(--duration-fast) var(--ym-ease-out);
  }

  details[open] .custom-provider-chevron svg {
    transform: rotate(180deg);
  }

  .custom-provider-summary svg,
  .provider-model-head svg,
  .provider-model-row svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .custom-provider-card {
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--border), transparent 30%);
    border-radius: 0;
    background: transparent;
    overflow: visible;
  }

  @keyframes ym-provider-card-reveal {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .custom-provider-group[data-provider-revealing="true"] .custom-provider-card {
    transform-origin: top center;
    animation: ym-provider-card-reveal 160ms var(--ym-ease-out) both;
  }

  .provider-model-config {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 12px 14px 14px;
    border-top: 1px solid color-mix(in srgb, var(--border), transparent 28%);
    contain: layout paint;
  }

  .provider-model-head {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: var(--fs-s);
    font-weight: 800;
    contain: layout paint;
  }

  .provider-model-head .icon-mini {
    width: 28px;
    height: 28px;
    min-width: 28px;
    flex: 0 0 28px;
    box-sizing: border-box;
    padding: 0;
    line-height: 0;
    overflow: hidden;
    scale: 1;
  }

  .provider-model-head .icon-mini:hover,
  .provider-model-head .icon-mini:active,
  .provider-model-head .icon-mini.loading,
  .provider-model-head .icon-mini.success,
  .provider-model-head .icon-mini.failure {
    scale: 1;
  }

  .provider-model-head .icon-mini svg {
    transition: transform var(--duration-fast) var(--ym-ease-out), opacity var(--duration-fast) var(--ym-ease-out);
  }

  .provider-model-head .icon-mini:active svg {
    transform: scale(0.96);
  }

  .provider-model-head [data-action='fetch-provider-models'] {
    appearance: none;
    display: inline-grid;
    place-items: center;
    contain: layout paint;
    position: relative;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    max-width: 28px;
    max-height: 28px;
    margin: 0;
    border: 0;
    padding: 0;
    transform: none;
    translate: 0 0;
  }

  .provider-model-head [data-action='fetch-provider-models'] svg,
  .provider-model-head [data-action='fetch-provider-models']:hover svg,
  .provider-model-head [data-action='fetch-provider-models']:active svg,
  .provider-model-head [data-action='fetch-provider-models'].loading svg,
  .provider-model-head [data-action='fetch-provider-models'].success svg,
  .provider-model-head [data-action='fetch-provider-models'].failure svg {
    transform: none;
  }

  .provider-fetch-icon-stack {
    position: relative;
    width: 16px;
    height: 16px;
    min-width: 16px;
    max-width: 16px;
    display: block;
    flex: 0 0 16px;
    overflow: hidden;
    pointer-events: none;
  }

  .provider-fetch-icon {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ym-ease-out);
  }

  .provider-fetch-icon svg {
    display: block;
    width: 16px;
    height: 16px;
    min-width: 16px;
    max-width: 16px;
  }

  .provider-fetch-icon.search {
    opacity: 1;
  }

  .provider-model-head [data-action='fetch-provider-models'].success .provider-fetch-icon,
  .provider-model-head [data-action='fetch-provider-models'].failure .provider-fetch-icon {
    opacity: 0;
  }

  .provider-model-head [data-action='fetch-provider-models'].success .provider-fetch-icon.check,
  .provider-model-head [data-action='fetch-provider-models'].failure .provider-fetch-icon.failure {
    opacity: 1;
  }

  .provider-model-head [data-action='fetch-provider-models'].loading svg {
    animation: none;
  }

  .provider-model-head [data-action='fetch-provider-models'].loading .provider-fetch-icon.search {
    opacity: 0.74;
  }

  .provider-key-control {
    position: relative;
    display: inline-block;
    width: 100%;
    min-width: 142px;
    max-width: 190px;
  }

  .provider-key-control input[data-panel-provider-field] {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: none;
    padding-right: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-key-control .icon-mini {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    min-width: 0;
    background: color-mix(in srgb, var(--bg-elevated), transparent 34%);
    /* 小图标按钮不做毛玻璃：它们贴在设置卡片里，不是浮层 */
  }

  .icon-mini {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    color: var(--muted);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .icon-mini:hover {
    background: var(--surface-secondary-hover);
    color: var(--text);
  }

  .icon-mini.danger:hover {
    background: color-mix(in srgb, var(--danger), transparent 86%);
    color: var(--danger);
  }

  .icon-mini.loading {
    color: var(--text);
  }

  .icon-mini.loading:hover,
  .icon-mini.loading:active {
    scale: 1;
  }

  .icon-mini.loading svg {
    animation: ym-icon-pulse 900ms linear infinite;
  }

  .icon-mini.success {
    color: var(--success);
    background: color-mix(in srgb, var(--success), transparent 86%);
  }

  .icon-mini.failure {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger), transparent 86%);
  }

  @keyframes ym-icon-pulse {
    0%, 100% { opacity: 0.52; }
    50% { opacity: 1; }
  }

  .provider-model-list {
    display: grid;
    gap: 8px;
    grid-auto-rows: 38px;
    align-content: start;
    height: var(--provider-model-list-height);
    min-height: 0;
    max-height: 222px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-inline-end: 2px;
    contain: layout paint;
    transition: none;
  }

  .provider-model-candidates {
    position: absolute;
    z-index: 24;
    max-height: 208px;
    display: grid;
    grid-auto-rows: 34px;
    align-content: start;
    gap: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 7px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 35%);
    border-radius: var(--radius-menu);
    background: color-mix(in srgb, var(--bg-elevated), transparent 34%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 8px 24px rgba(40, 36, 32, 0.14);
    backdrop-filter: blur(20px) saturate(1.1);

    opacity: 1;
    transform: translateY(0) scale(1);
    transform-origin: top right;
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
    will-change: opacity, transform;
  }

  @starting-style {
    .provider-model-candidates {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }

  .provider-model-candidate {
    box-sizing: border-box;
    height: 34px;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    align-items: center;
    gap: 8px;
    padding: 3px 4px 3px 10px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text), transparent 93%);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 700;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), opacity var(--duration-fast) var(--ym-ease-out);
  }

  .provider-model-candidate[hidden] {
    display: none;
  }

  .provider-model-candidate:hover {
    background: color-mix(in srgb, var(--text), transparent 88%);
  }

  .provider-model-candidate:active {
    opacity: 0.86;
  }

  .provider-model-candidate .icon-mini:active {
    scale: 0.96;
  }

  .provider-model-candidate span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-model-row {
    min-height: 38px;
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) 28px;
    align-items: center;
    justify-content: stretch;
    gap: 10px;
    color: var(--muted);
    font-size: var(--fs-xs);
    font-weight: 700;
  }

  .provider-model-row[data-entering="true"] {
    opacity: 1;
    transform: translateY(0) scale(1);
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
  }

  @starting-style {
    .provider-model-row[data-entering="true"] {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
  }

  .provider-model-row input[data-panel-provider-model-id] {
    box-sizing: border-box;
    width: 142px;
    min-width: 142px;
    max-width: 142px;
    justify-self: end;
    height: 36px;
    border: 0;
    border-radius: var(--radius-control);
    padding: 0 12px;
    background: color-mix(in srgb, var(--text), transparent 90%);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-s);
    font-weight: 700;
    outline: none;
  }

  .provider-model-row input[data-panel-provider-model-id][data-needs-value="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), transparent 48%);
    background: color-mix(in srgb, var(--text), transparent 90%);
  }

  .shortcut-controls {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 142px;
    min-width: 142px;
    max-width: 142px;
  }

  .shortcut-controls .shortcut-link {
    position: absolute;
    top: 50%;
    right: 4px;
    transform: translateY(-50%);
    min-width: 0;
    background: color-mix(in srgb, var(--bg-elevated), transparent 34%);
    /* 小图标按钮不做毛玻璃：它们贴在设置卡片里，不是浮层 */
  }

  .shortcut-display {
    box-sizing: border-box;
    width: 142px;
    min-width: 0;
    max-width: 142px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-control);
    padding: 0 12px;
    padding-right: 44px;
    background: color-mix(in srgb, var(--text), transparent 90%);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-s);
    font-weight: 800;
    outline: none;
    text-align: left;
  }

  .settings-row {
    min-height: 58px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 0 14px;
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 700;
  }

  /* 行标签不许被逐字拆行：窄面板下压缩控件宽度，标签保持完整一行 */
  .settings-row > span:first-child,
  .settings-row > label > span:first-child {
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
  }

  /* 窄面板下设置行改为上下两段：标签在上、控件在下占满宽度。
     面板宽度可被用户拖动改变，视口宽度不可靠，因此用容器查询按面板自身宽度判断。 */
  @container panel (max-width: 320px) {
    .settings-row {
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 14px;
    }

    .settings-row > span:first-child,
    .settings-row > label > span:first-child {
      flex: 1 1 100%;
    }

    .settings-select,
    .provider-key-control,
    .settings-provider-control,
    input.settings-provider-control {
      flex: 1 1 100%;
      width: 100%;
      min-width: 0;
      max-width: none;
    }
  }

  .settings-row + .settings-row {
    border-top: 1px solid color-mix(in srgb, var(--border), transparent 28%);
  }

  .deepseek-web-status-row .icon-mini {
    margin-left: auto;
  }

  .settings-row input[type="number"],
  .settings-row input[data-panel-provider-model],
  .settings-row input[data-panel-provider-field] {
    min-width: 142px;
    max-width: 190px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-control);
    padding: 0 12px;
    background: color-mix(in srgb, var(--text), transparent 90%);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-s);
    font-weight: 700;
    outline: none;
  }

  .settings-row input[type="number"] {
    appearance: textfield;
  }

  .settings-row input[type="number"]::-webkit-outer-spin-button,
  .settings-row input[type="number"]::-webkit-inner-spin-button {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
  }

  .settings-row input[data-panel-setting="pageCacheLimit"] {
    box-sizing: border-box;
    width: 142px;
    min-width: 142px;
    max-width: 142px;
  }

  .settings-provider-control,
  input.settings-provider-control {
    box-sizing: border-box;
    width: 142px;
    min-width: 142px;
    max-width: 142px;
    flex: 0 0 142px;
  }

  .custom-provider-card > .settings-row > input {
    box-sizing: border-box;
    width: 100%;
  }

  .settings-select {
    position: relative;
    /* 窄面板下让控件收缩，优先保证标签完整可读 */
    flex: 0 1 142px;
    min-width: 96px;
    max-width: 190px;
  }

  .settings-select summary {
    list-style: none;
  }

  .settings-select summary::-webkit-details-marker {
    display: none;
  }

  .settings-select-trigger {
    box-sizing: border-box;
    width: 100%;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-radius: var(--radius-control);
    padding: 0 12px;
    background: var(--surface-secondary);
    color: var(--text);
    font-size: var(--fs-s);
    font-weight: 700;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .settings-select-trigger:hover {
    background: var(--surface-secondary-hover);
  }

  .settings-select-trigger:active {
    scale: 0.97;
  }

  .settings-select-trigger svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }

  .settings-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-select-menu {
    position: absolute;
    box-sizing: border-box;
    top: calc(100% + 8px);
    right: 0;
    min-width: 100%;
    /* 基类 .liquid-menu 有一条 min(260px, …) 的 max-width 封顶；菜单必须与触发器等宽，
       这里改成 100%（= 触发器宽度），否则触发器一旦宽过 260px 菜单就会被截窄 */
    max-width: 100%;
    max-height: 220px;
    overflow-y: auto;
    pointer-events: none;
    transform-origin: top right;
  }

  .settings-select-menu .liquid-option {
    pointer-events: auto;
  }

  /* 浅色下设置页菜单改用面板主底色：与面板同色后靠不透明边框与加重投影保持浮层可辨认。
     公共浅色规则（:host([data-theme="light"]) .liquid-menu）被顶栏两个菜单共用，不能动。 */
  :host([data-theme="light"]) .settings-select-menu {
    background: var(--bg);
    border-color: var(--border);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
    backdrop-filter: none;
  }

  .settings-select-up .settings-select-menu {
    top: auto;
    bottom: calc(100% + 8px);
    transform-origin: bottom right;
    transform: translateY(4px) scale(0.98);
  }

  .settings-select-up.closing .settings-select-menu {
    transform: translateY(4px) scale(0.98);
  }

  .panel-switch {
    cursor: pointer;
  }

  .panel-switch input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .switch-control {
    position: relative;
    width: 42px;
    height: 24px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: color-mix(in srgb, var(--soft), transparent 52%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border), transparent 35%);
    transition: background var(--duration-fast) var(--ym-ease-out);
  }

  .switch-control::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: 0 4px 12px rgba(40, 36, 32, 0.22);
    transition: transform var(--duration-fast) var(--ym-ease-out), background var(--duration-fast) var(--ym-ease-out);
  }

  .panel-switch input:checked + span + .switch-control {
    background: var(--text);
  }

  .panel-switch input:checked + span + .switch-control::after {
    transform: translateX(18px);
    background: var(--bg);
  }

  .subtitle-view {
    padding: 0 var(--rail-x) 18px;
  }

  .subtitle-track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .subtitle-item {
    display: flex;
    gap: 14px;
    align-items: baseline;
    cursor: pointer;
    margin: 0 -10px;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    transition: background var(--duration-fast) var(--ym-ease-out), box-shadow var(--duration-fast) var(--ym-ease-out), opacity var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out);
  }

  .subtitle-item:hover {
    background: color-mix(in srgb, var(--text), transparent 94%);
    color: var(--text);
    opacity: 0.92;
  }

  .subtitle-item.active {
    background: color-mix(in srgb, var(--accent), transparent 72%);
    opacity: 1;
  }

  :host([data-theme="light"]) .subtitle-item.active {
    background: color-mix(in srgb, var(--accent), transparent 82%);
  }

  .subtitle-time {
    flex: 0 0 auto;
    min-width: 42px;
    color: color-mix(in srgb, var(--soft), transparent 8%);
    font-size: var(--fs-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .subtitle-text {
    flex: 1 1 auto;
    color: color-mix(in srgb, var(--muted), var(--soft) 18%);
    font-size: var(--fs-s);
    font-weight: 400;
    line-height: 1.42;
    text-wrap: pretty;
  }

  .subtitle-original {
    color: color-mix(in srgb, var(--muted), var(--soft) 16%);
  }

  .subtitle-bilingual {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .subtitle-bilingual .subtitle-original {
    color: color-mix(in srgb, var(--muted), var(--soft) 16%);
  }

  .subtitle-bilingual .subtitle-translated {
    color: color-mix(in srgb, var(--text), var(--muted) 18%);
    font-weight: 500;
    text-decoration-line: underline;
    text-decoration-style: dashed;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
    text-decoration-color: color-mix(in srgb, var(--text), transparent 42%);
  }

  .subtitle-item.active .subtitle-time {
    color: color-mix(in srgb, var(--text), var(--muted) 22%);
  }

  .subtitle-item.active .subtitle-text {
    color: color-mix(in srgb, var(--text), var(--muted) 14%);
    font-weight: 500;
  }

  .subtitle-fallback {
    margin: 12px 0;
    color: var(--muted);
    font-size: var(--fs-s);
  }

  .subtitle-plain {
    margin: 0;
    padding: 16px;
    border-radius: var(--radius-control);
    background: var(--bg-elevated);
    color: var(--text);
    font-size: var(--fs-s);
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .overview {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0 0 22px;
    padding: 0 var(--summary-edge-pad, 12px) 0 var(--summary-rail-x, 8px);
  }

  .overview-text {
    font-family: var(--ym-font-sans);
    color: var(--muted);
    font-size: var(--fs-s);
    font-weight: 400;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .summary-stream-overview .overview {
    padding-top: 8px;
    margin-bottom: 12px;
  }

  .summary-stream-overview .summary-tree-loading {
    min-height: 18px;
    padding: 0 var(--summary-edge-pad, 12px) 0 var(--summary-rail-x, 8px);
  }

  .summary-stream-overview .summary-tree-loading .streaming-sparkle {
    margin-left: 0;
  }

  .summary-stream-pending .overview-text {
    min-height: 24px;
    display: flex;
    align-items: center;
  }

  .summary-stream-pending .streaming-sparkle {
    margin-left: 0;
  }

  .streaming-sparkle {
    position: relative;
    display: inline-block;
    width: 22px;
    height: 18px;
    margin-left: 6px;
    vertical-align: -3px;
    color: color-mix(in srgb, var(--text), var(--accent) 18%);
  }

  .streaming-sparkle-star {
    position: absolute;
    display: block;
    width: var(--spark-size);
    height: var(--spark-size);
    clip-path: polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%);
    background: currentColor;
    /* 静止底色取可见值（0.48 / 0.88）：减少动态效果时循环被关掉，
       元素回到这里的三份声明，仍要看得见。 */
    opacity: 0.48;
    transform: scale(0.88);
    transform-origin: center;
    /* 三颗星共用一条只改透明度的循环，靠每颗自己的负延迟错开相位：
       负延迟让第一帧就落在周期中段，否则后两颗要空等一整段才亮。
       相的排法按屏幕顺时针走（角度以正上方为 0、向右为正）：
       大星 98° → 中星 222° → 小星 343°，即右上 → 左下 → 左上。
       900ms 一个整圈 = 每 300ms 亮起一颗。用 linear 而不是 ease-in-out：
       带缓动的关键帧在每一站速度都归零，三颗星各停一次，合起来就是一顿一顿的；
       实测 1200ms + ease-in-out 每圈有 6% 的时间合亮度几乎不动，换成 900ms + linear 后归零。 */
    animation: ym-sparkle-breathe 900ms linear var(--spark-delay, 0ms) infinite;
  }

  .streaming-sparkle-star.large {
    --spark-size: 12px;
    --spark-delay: 0ms;
    right: 1px;
    top: 3px;
  }

  .streaming-sparkle-star.medium {
    --spark-size: 8px;
    --spark-delay: -600ms;
    left: 3px;
    bottom: 2px;
  }

  .streaming-sparkle-star.small {
    --spark-size: 6px;
    --spark-delay: -300ms;
    left: 6px;
    top: 1px;
  }

  /* 三段式明暗：快速亮到 0.98，再慢一档收回去。
     只动 opacity，不动 scale——缩放属于装饰性运动，会被减少动态效果整条关掉，
     关掉后位置与大小必须与动画中途一致，否则静态终态会「缩一下」。 */
  @keyframes ym-sparkle-breathe {
    0%, 100% {
      opacity: 0.24;
    }
    42% {
      opacity: 0.98;
    }
    68% {
      opacity: 0.5;
    }
  }

  .tree-section[data-stream-entering="true"],
  li[data-stream-entering="true"] {
    opacity: 1;
    transform: translateY(0);
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out);
  }

  @starting-style {
    .tree-section[data-stream-entering="true"],
    li[data-stream-entering="true"] {
      opacity: 0;
      transform: translateY(5px);
    }
  }

  .overview-loading {
    display: grid;
    align-items: start;
    box-sizing: border-box;
    height: 100%;
    max-height: 100%;
    padding: 8px 24px 24px;
    overflow: hidden;
  }

  .summary-skeleton {
    width: 100%;
    height: 100%;
  }

  .summary-skeleton-flow {
    position: relative;
    box-sizing: border-box;
    display: grid;
    gap: 38px;
    width: min(100%, 640px);
    height: clamp(160px, calc(90vh - 237px), 1240px);
    max-height: calc(90vh - 237px);
    margin: 0 auto;
    padding: 20px 14px 26px;
    overflow: hidden;
  }

  .summary-skeleton-bottom-fade {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 20%;
    pointer-events: none;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--bg), transparent 38%) 48%,
      var(--bg) 100%
    );
  }

  .summary-skeleton-surface {
    border-radius: var(--radius-card);
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--text), transparent 98%) 0%,
        color-mix(in srgb, var(--text), transparent 97%) 46%,
        color-mix(in srgb, var(--text), transparent 98%) 78%,
        transparent 100%
      ),
      var(--bg);
  }

  .summary-skeleton-overview {
    display: grid;
    gap: 18px;
    padding: 0;
  }

  .summary-skeleton-outline {
    display: grid;
    grid-template-columns: 1fr;
    gap: 22px;
    padding-top: 4px;
  }

  .summary-skeleton-section {
    position: relative;
    display: grid;
    gap: 11px;
    min-height: 92px;
    padding: 0 0 8px;
  }

  .summary-skeleton-section-heading {
    display: block;
    width: 34%;
    height: 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text), transparent 86%);
  }

  .summary-skeleton-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 20px;
  }

  .summary-skeleton-row::before {
    content: "";
    width: 6px;
    height: 6px;
    justify-self: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text), transparent 84%);
  }

  .summary-skeleton-row.inset {
    padding-left: 28px;
  }

  .summary-skeleton-line {
    position: relative;
    display: block;
    height: 12px;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text), transparent 89%);
  }

  .summary-skeleton-line::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--text), transparent 84%) 42%,
      transparent 78%
    );
    transform: translateX(-120%);
    animation: ym-skeleton-shimmer 1.45s linear infinite;
  }

  .summary-skeleton-line.title {
    width: 48%;
    height: 16px;
    margin-bottom: 4px;
  }

  .summary-skeleton-line.wide {
    width: 92%;
  }

  .summary-skeleton-line.medium {
    width: 68%;
  }

  .summary-skeleton-line.short {
    width: 54%;
  }

  .summary-skeleton-line.compact {
    width: 76%;
  }

  .summary-skeleton-line.section {
    width: 36%;
    height: 14px;
    margin: 0 0 12px;
  }

  @keyframes ym-skeleton-shimmer {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(120%);
    }
  }

  .tree {
    box-sizing: border-box;
    --summary-rail-x: 8px;
    --summary-edge-pad: 12px;
    padding-right: var(--summary-edge-pad);
  }

  .summary-followups {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 26px 0 4px;
    padding: 0 var(--summary-edge-pad, 12px) 0 var(--summary-rail-x, 8px);
  }

  .summary-followup {
    min-height: 30px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 6px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text), transparent 93%);
    color: color-mix(in srgb, var(--muted), var(--text) 18%);
    font-size: var(--fs-xs);
    font-weight: 700;
    line-height: 1.35;
    text-align: left;
    overflow-wrap: anywhere;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .summary-followup:hover {
    background: color-mix(in srgb, var(--text), transparent 88%);
    color: var(--text);
  }

  .summary-followup:active {
    scale: 0.98;
  }

  .tree-section {
    position: relative;
    --rail-x: var(--summary-rail-x);
    --content-x: 28px;
    --line-w: 2px;
    --dot: 7px;
    --branch-y: 13px;
    --branch-radius: var(--radius-card);
    padding: 0 0 0 var(--content-x);
    margin-left: 0;
    --branch: var(--accent);
  }

  .tree-section + .tree-section {
    margin-top: 34px;
  }

  .tree-section::before {
    content: "";
    position: absolute;
    left: var(--rail-x);
    top: 10px;
    bottom: 0;
    width: var(--line-w);
    border-radius: 999px;
    background: var(--branch);
    transform: translateX(-50%);
  }

  .tree-section.section-1 {
    --branch: var(--accent);
  }

  .tree-section.section-2 {
    --branch: var(--accent);
  }

  .tree-section h3 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-l);
    font-weight: 400;
    line-height: 1.4;
    text-wrap: balance;
  }

  .tree-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
  }

  .node {
    position: absolute;
    border-radius: 50%;
    background: var(--branch);
  }

  .section-1 .node {
    background: var(--accent);
  }

  .section-2 .node {
    background: var(--accent);
  }

  .major {
    width: var(--dot);
    height: var(--dot);
    left: calc(var(--rail-x) - var(--dot) / 2);
    top: 7px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    position: relative;
    font-family: var(--ym-font-sans);
    color: var(--text);
    font-size: var(--fs-m);
    font-weight: 400;
    line-height: 1.5;
    margin: 6px 0;
    padding-left: 16px;
    text-wrap: pretty;
  }

  li::before {
    content: "";
    position: absolute;
    left: calc(var(--rail-x) - var(--content-x) - var(--line-w) / 2);
    top: 0;
    width: calc(var(--content-x) - var(--rail-x));
    height: var(--branch-y);
    border-left: var(--line-w) solid var(--branch);
    border-bottom: var(--line-w) solid var(--branch);
    border-bottom-left-radius: var(--branch-radius);
  }

  li:last-child {
    margin-bottom: 0;
  }

  li .minor {
    width: var(--dot);
    height: var(--dot);
    left: calc(var(--dot) / -2);
    top: calc(var(--branch-y) - var(--dot) / 2);
  }

  .children {
    margin-top: 10px;
    padding-left: 0;
    border-left: 0;
  }

  .children li {
    font-family: var(--ym-font-sans);
    color: var(--soft);
    font-size: var(--fs-s);
    font-weight: 400;
    padding-left: 24px;
    margin: 7px 0;
  }

  :host([data-theme="light"]) .children li {
    color: color-mix(in srgb, var(--soft), var(--text) 18%);
  }

  .children li::before,
  .children .minor {
    display: none;
  }

  .children li::after {
    content: "";
    position: absolute;
    left: 1px;
    top: 50%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--soft);
    transform: translateY(-50%);
  }

  :host([data-theme="light"]) .children li::after {
    background: color-mix(in srgb, var(--soft), var(--text) 18%);
  }

  .summary-child-jump {
    display: inline;
    color: inherit;
  }

  .summary-child-jump-text {
    transition: color var(--duration-fast) var(--ym-ease-out), opacity var(--duration-fast) var(--ym-ease-out);
  }

  .summary-child-timestamp {
    margin-left: 5px;
    color: var(--soft);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .summary-child-jump:hover .summary-child-jump-text {
    color: var(--text);
    opacity: 0.9;
    text-decoration: none;
  }

  .summary-child-jump-button {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 2px;
    padding: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text), transparent 88%);
    color: var(--soft);
    vertical-align: middle;
    transition: background var(--duration-fast) var(--ym-ease-out), color var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  .summary-child-jump-button:hover {
    background: color-mix(in srgb, var(--text), transparent 90%);
    color: var(--text);
  }

  .summary-child-jump-button svg {
    width: 10px;
    height: 10px;
    stroke: currentColor;
    stroke-width: 0;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: currentColor;
  }

  .selection-ask-button {
    position: absolute;
    z-index: 8;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 11px;
    border: 1px solid color-mix(in srgb, var(--border), transparent 34%);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-elevated), transparent 24%);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 800;
    line-height: 1;
    box-shadow: 0 6px 18px rgba(40, 36, 32, 0.14);
    backdrop-filter: blur(12px) saturate(1.1);
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
    transform-origin: bottom center;
    transition: opacity var(--duration-fast) var(--ym-ease-out), transform var(--duration-fast) var(--ym-ease-out), background var(--duration-fast) var(--ym-ease-out), scale var(--duration-fast) var(--ym-ease-out);
  }

  @starting-style {
    .selection-ask-button {
      opacity: 0;
      transform: translateX(-50%) translateY(4px) scale(0.96);
    }
  }

  .selection-ask-button:hover {
    background: color-mix(in srgb, var(--bg-elevated), transparent 8%);
  }

  .selection-ask-button:active {
    scale: 0.95;
  }

  .selection-ask-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--text), transparent 36%);
    outline-offset: 2px;
  }

  .selection-ask-button svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }


  textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-s);
  }

  textarea::placeholder {
    color: var(--soft);
  }




  .copy-icon {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }


  .stream-preview {
    padding: 20px;
    font-size: var(--fs-s);
    line-height: 1.6;
    color: var(--muted);
  }

  .stream-preview pre {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  }

  @media (hover: hover) and (pointer: fine) {
    .empty button[data-action="generate"]:hover {
      background: color-mix(in srgb, var(--text), transparent 10%);
      transform: translateY(-1px);
    }

    /* 标签页是低频导航动作，保留轻微放大作为「导航被接收」的反馈 */
    .tab:not(.active):hover {
      opacity: 0.85;
      scale: 1.02;
    }

    .children li:hover {
      color: var(--text);
      font-weight: 400;
    }

    :host([data-theme="light"]) .children li:hover,
    :host([data-theme="light"]) .summary-child-jump:hover .summary-child-jump-text {
      color: #111111;
    }

    .summary-child-jump:hover .summary-child-jump-text {
      opacity: 1;
    }

    .icon-button:hover::after,
    .dock-action:hover::after {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
      transition-delay: var(--duration-tooltip-delay);
    }
  }

  @media (hover: none), (pointer: coarse) {
    .tab:not(.active):hover,
    .subtitle-item:hover,
    .provider-model-candidate:hover {
      scale: 1;
      transform: none;
    }

    .subtitle-item:hover,
    .summary-child-jump:hover .summary-child-jump-text {
      color: inherit;
      opacity: 1;
    }

    .provider-model-head .icon-mini:hover svg,
    .provider-model-head [data-action='fetch-provider-models']:hover svg,
    .provider-model-candidate:hover {
      transform: none;
    }

    .icon-button:hover::after,
    .dock-action:hover::after {
      opacity: 0;
      transform: translateX(-50%) translateY(4px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .empty button[data-action="generate"]:hover {
      transform: none;
    }

    .icon-button.spinning svg,
    .icon-button.source-refresh-loading svg,
    .icon-button.source-refresh-success,
    .icon-button.source-refresh-failure,
    .dock-action.success,
    .dock-action.failure,
    .dock-action.loading svg,
    .settings-save.success,
    .settings-pill-action.success,
    .panel-settings.entering,
    .panel-settings.exiting,
    .icon-mini.loading svg,
    .provider-model-candidates,
    .provider-model-candidate,
    .summary-skeleton-line::after,
    .streaming-sparkle-star,
    .tree-section[data-stream-entering="true"],
    li[data-stream-entering="true"],
    .selection-ask-button,
    .provider-model-row[data-entering="true"],
    .custom-provider-group[data-provider-revealing="true"] .custom-provider-card,
    .model-menu[open] .liquid-menu,
    .model-menu.closing .liquid-menu,
    .thinking-menu[open] .liquid-menu,
    .thinking-menu.closing .liquid-menu,
    .settings-select[open] .liquid-menu,
    .settings-select.closing .liquid-menu {
      animation: none !important;
    }

    .thinking-thumb,
    .thinking-track,
    .thinking-icon,
    .thinking-current {
      transition: none !important;
    }

    .source-text-view-wrapper,
    .source-text-view-header,
    .source-text-view,
    .warning-line,
    .empty-stack,
    .error-box,
    .ocr-ready-card,
    .content-view,
    .content-view.entering,
    .diagnostic-overlay,
    details[open] > *:not(summary):not(.liquid-menu) {
      opacity: 1 !important;
      transform: none !important;
    }

    /* 入场模态框有独立的 scale 基准值（1）与入场值（0.96），需要单独复位；
       其余元素没有独立 scale，scale 也不继承，挂在通用列表上既管不到子按钮也无从表达意图。
       模态框同时需要 opacity / transform 复位（它自身有 200ms 的 opacity 过渡），
       否则减少动态效果下会重新出现淡入。 */
    .diagnostic-modal {
      opacity: 1 !important;
      transform: none !important;
      scale: 1 !important;
    }

    /* 减少动态效果下保留状态反馈、去掉运动：
       颜色/背景/边框/阴影/透明度的过渡照常，位移与缩放不再有过渡。
       整块 transition: none 会把按钮的悬停与按压反馈一起关掉，等于按钮变哑。 */
    .thinking-trigger,
    .thinking-trigger.pressed,
    .thinking-toggle,
    .model-trigger,
    .liquid-option,
    .liquid-option.pressed,
    .icon-button,
    .icon-button.pressed,
    .icon-mini,
    .tab,
    .settings-back,
    .settings-save,
    .settings-pill-action,
    .settings-select-trigger,
    .setup-action,
    .inline-action,
    .ocr-primary-action,
    .summary-followup,
    .summary-child-jump-button,
    .selection-ask-button,
    .subtitle-item,
    .empty button,
    .error-box button,
    .provider-model-candidate,
    .provider-model-candidate .icon-mini,
    .provider-model-head .icon-mini,
    .provider-model-head .icon-mini svg,
    .provider-model-head [data-action='fetch-provider-models'],
    .provider-model-head [data-action='fetch-provider-models'] svg,
    button.page-title-text {
      transition-property: opacity, background, color, border-color, box-shadow !important;
    }

    /* 浮动 dock 的按钮基础过渡是多值且带级联延迟（opacity/transform 各按
       --dock-action-index 错峰）。transition-property 只替换属性名，duration 与 delay
       仍按位置匹配基线的多值列表，于是错峰会落到不相关的属性上。
       这里用完整 transition 简写一次性定死属性、时长、缓动与零延迟，
       避免位置匹配，也不把阴影重新加回过渡（阴影变化不可辨却触发重绘）。 */
    .floating-action-dock .dock-action,
    .floating-action-dock .dock-action.pressed {
      transition:
        background var(--duration-fast) var(--ym-ease-out),
        color var(--duration-fast) var(--ym-ease-out),
        opacity var(--duration-fast) var(--ym-ease-out) !important;
    }

    .content-view,
    .content-view.entering,
    .content-view.exiting,
    .panel-settings.entering,
    .panel-settings.exiting,
    .provider-model-row[data-entering="true"],
    .custom-provider-group[data-provider-revealing="true"] .custom-provider-card,
    .model-menu[open] .liquid-menu,
    .thinking-menu[open] .liquid-menu,
    .settings-select[open] .liquid-menu,
    .summary-stream-overview,
    .tree-section[data-stream-entering="true"],
    li[data-stream-entering="true"] {
      transition: none !important;
    }
  }

  .source-text-view-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    opacity: 1;
    transform: translateX(0);
    transition: opacity ${SOURCE_TEXT_VIEW_ENTER_MS}ms var(--ym-ease-out), transform ${SOURCE_TEXT_VIEW_ENTER_MS}ms var(--ym-ease-out);
  }

  .source-text-view-wrapper.entering {
    transition: opacity ${SOURCE_TEXT_VIEW_ENTER_MS}ms var(--ym-ease-out), transform ${SOURCE_TEXT_VIEW_ENTER_MS}ms var(--ym-ease-out);
  }

  @starting-style {
    .source-text-view-wrapper.entering {
      opacity: 0;
      transform: translateX(18px);
    }
  }


  .source-text-view-wrapper.exiting {
    opacity: 0;
    transform: translateX(8px);
    transition-duration: ${SOURCE_TEXT_VIEW_EXIT_MS}ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .source-text-view-wrapper {
      transition: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }

  .source-text-view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px var(--rail-x) 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border), transparent 20%);
  }

  .source-text-view-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .source-text-view-header h2 {
    margin: 0;
    font-size: var(--fs-s);
    font-weight: 700;
    color: var(--text);
  }

  .source-text-view {
    flex: 1;
    min-height: 0;
    padding: 20px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  /* 隐藏滚动条箭头按钮，避免箭头溢出面板底部圆角 */
  .source-text-view::-webkit-scrollbar-button {
    display: none;
    height: 0;
  }

  /* 轨道底部缩进，避开面板底部圆角 */
  .source-text-view::-webkit-scrollbar-track {
    margin-bottom: 14px;
  }

  .source-text-view .md-body {
    font-family: var(--ym-font-sans);
    font-size: var(--fs-xs);
    line-height: 1.55;
    color: var(--text);
  }
  .source-text-view .md-body h1 {
    font-size: var(--fs-l);
    font-weight: 700;
    color: var(--text);
    margin: 2px 0 10px;
  }
  .source-text-view .md-body h2 {
    font-size: var(--fs-s);
    font-weight: 700;
    color: var(--text);
    margin: 16px 0 6px;
    letter-spacing: -0.005em;
  }
  .source-text-view .md-body h3 {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text);
    margin: 12px 0 4px;
  }
  .source-text-view .md-body h4,
  .source-text-view .md-body h5,
  .source-text-view .md-body h6 {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text);
    margin: 10px 0 4px;
  }
  .source-text-view .md-body p { margin: 0 0 8px; }
  .source-text-view .md-body strong { color: var(--text); font-weight: 700; }
  .source-text-view .md-body a {
    color: var(--accent);
    text-decoration: none;
    transition: text-decoration var(--duration-fast) var(--ym-ease-out);
  }
  .source-text-view .md-body a:hover {
    text-decoration: underline;
  }
  .source-text-view .md-body ul, .source-text-view .md-body ol {
    margin: 0 0 8px;
    padding-left: 18px;
  }
  .source-text-view .md-body li { margin: 1px 0; }
  .source-text-view .md-body li::marker { color: var(--soft); }
  .source-text-view .md-body blockquote {
    margin: 0 0 8px;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    color: var(--muted);
    background: var(--bg-elevated);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
  }
  .source-text-view .md-body pre {
    margin: 0 0 10px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border-radius: var(--radius-control);
    overflow-x: auto;
  }

  /* 三处浮层自己没有浅色规则：投影在浅色下单独覆盖成灰蓝，
     基类连同暖棕留给深色，深色由此逐字不变。
     规则必须写在基类之后：既有断言按首次出现抓 .provider-model-candidates 的规则块。 */
  :host([data-theme="light"]) .provider-model-candidates {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 8px 24px rgba(15, 23, 42, 0.14);
  }

  :host([data-theme="light"]) .selection-ask-button {
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.14);
  }

  :host([data-theme="light"]) .switch-control::after {
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.22);
  }

  /* 连续曲率：squircle 这个关键字在 Chromium 里就是苹果那条连续曲线。
     不能用 superellipse(4)：那比圆弧更方，同半径下 10px 几乎看不出圆、16px 读成矩形。

     写法刻意反过来：面板内**默认全 squircle**，只把胶囊与圆形显式退回圆弧。
     上一版是逐个列举要加 squircle 的元素，结果输入框漏在清单外，
     同样的 18px 有效圆角在输入框（圆弧）和按钮（squircle）上看起来是两种圆度。 */
  @supports (corner-shape: squircle) {
    .panel,
    .panel * {
      corner-shape: squircle;
    }

    .empty-stack::before,
    .empty-stack::after {
      corner-shape: squircle;
    }

    /* 胶囊与圆形保持真圆弧：那是形状语义（开关轨道、dock、骨架条、圆点），
       不是圆角大小问题。伪元素单独列，* 选择器不覆盖它们。 */
    .switch-control,
    .switch-control::after,
    .thinking-track,
    .thinking-thumb,
    .thinking-toggle,
    .floating-action-dock,
    .dock-action,
    .dock-action::after,
    .inline-action,
    .empty button,
    .summary-followup,
    .summary-child-jump-button,
    .selection-ask-button,
    .leaf,
    .node,
    .children li::after,
    .tree-section::before,
    .summary-skeleton-line,
    .summary-skeleton-row::before,
    .summary-skeleton-section-heading,
    .panel::before {
      corner-shape: round;
    }
  }

  .source-text-view .md-body code {
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
    font-size: 0.9em;
  }
  .source-text-view .md-body pre code { font-size: var(--fs-xs); line-height: 1.5; color: var(--text); }

  .source-text-view .md-body :not(pre) > code {
    background: var(--bg-elevated);
    padding: 0 4px;
    border-radius: var(--radius-control);
    color: var(--text);
    font-size: 0.88em;
  }
  .source-text-view .md-body hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 14px 0;
  }

`;

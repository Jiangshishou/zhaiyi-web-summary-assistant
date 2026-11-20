import { extractCurrentSource } from "./source";
import {
  createPanelRequestId,
  elapsedMs,
  fullChainSourceRoute,
  FullChainTracer
} from "./fullChainTrace";
import { PanelGeometryController } from "./panelGeometry";
import { ProviderModelMenuController } from "./providerModelMenu";
import { SubtitleTransformController } from "./subtitleTransform";
import { resolveTheme } from "./theme";
import { setTrustedInnerHTML } from "./trustedHtml";
import { escapeAttribute, escapeHtml } from "./htmlEscape";
import { classifySourcePage } from "./sourcePlatform";
import { attachButtonWithInstantFeedback } from "./buttonFeedback";
import { animatePanelOpen, animatePanelClose, stopPanelAnimation } from "./springAnimations";
import {
  clearPageCache,
  clearPageCaches,
  fetchSourceBinary,
  generateSummary,
  getCommandShortcuts,
  getPageCache,
  getPanelState,
  getProviders,
  getSettings,
  openExtensionShortcuts,
  probeDeepSeekWeb,
  savePanelState,
  saveProviders,
  saveSettings
} from "./runtimeClient";
import {
  buildMarkdownFilename,
  formatSummaryMarkdown,
  stripOverviewLabel
} from "./panelSummary";
import { SummaryStreamAssembler } from "./summaryStreamAssembler";
import {
  buildSrtFilename,
  formatSubtitlePlainText,
  formatSubtitleSrt,
  formatTimestamp,
  isSubtitleTranslationTarget,
  isTranscriptSource
} from "./panelSubtitle";
import { renderMarkdown } from "./markdownRenderer";
import {
  addCustomProviderDraft,
  createDeepSeekWebProviderConfig,
  isProviderId,
  panelVisibleModels,
  providerLabel,
  providerModelListHeight,
  sanitizePanelProviders,
  settingsWithValidDefaultProvider,
  ProviderDraftEdit
} from "./providerSettingsEditor";
import { panelCss, SETTINGS_EXIT_MS, SOURCE_TEXT_VIEW_ENTER_MS, SOURCE_TEXT_VIEW_EXIT_MS, STREAM_NODE_ENTER_MS } from "./panelCss";
import { clamp, clearMotionAttribute, cssEscape, prefersReducedMotion, writeClipboard } from "./panelDom";
import { resolveCoverDataUrl } from "./coverFallback";
import { triggerFileDownload } from "./fileDownload";
import { resolveSourceTextExport } from "./sourceTextExport";
import { readPageMeta } from "./sourcePayload";
import { renderActionIcon, renderLucideIcon, renderStreamingSparkle, renderSummaryStarIcon } from "./panelIcons";
import { mountToaster, showToast } from "./toastHost";
import { applyNoTranslate } from "./noTranslate";
import { renderActiveIndicator, renderPanelSwitch, renderSettingsSelect } from "./panelFormControls";
import { scrollPageTextIntoView } from "./sourceJump";
import { TimelineMatcher } from "./timelineMatcher";
import { buildPanelProviderDiagnostics, formatUserVisibleDiagnosticPackage } from "./panelDiagnostics";
import { defaultThinkingLevelForModel, thinkingOptionsForModel, type ThinkingOption } from "./modelThinkingOptions";
import { sourceDiagnosticsNeedAttention } from "../shared/sourceStatus";
import { formatCharacterCount } from "../shared/numberFormat";
import { hasMeaningfulSummary, mergeSummaryWithMeaningfulFallback } from "../shared/summaryQuality";
import { DEEPSEEK_WEB_MODELS, DEEPSEEK_WEB_PROVIDER_ID, DEEPSEEK_WEB_PROVIDER_LABEL } from "../shared/deepseekWeb";
import type {
  OutputCompressionMode,
  PageCache,
  SourcePayload,
  ModelInfo,
  ModelThinkingLevel,
  ProviderId,
  ProviderSettings,
  Settings,
  SummaryCachePolicy,
  SubtitleTranslationTarget,
  SummaryResult,
  SummaryPoint,
  SummarySection,
  ThemeMode
} from "../shared/types";

export { buildMarkdownFilename, formatSummaryMarkdown } from "./panelSummary";

type PanelStatus = "idle" | "extracting" | "generating" | "ready" | "error";
type PanelView = "content" | "settings";
type ContentView = "summary" | "subtitle";
const SUMMARY_SKELETON_MIN_MS = 500;
const LIQUID_MENU_CLOSE_MS = 160;
// Approximate height freed when scroll chrome (tabs 58px + source-status ~27px) collapses.
// If content overflows by less than this, hiding chrome would eliminate overflow entirely,
// causing the browser to clamp scrollTop to 0 — which reverses the hide — producing a
// flicker feedback loop on every wheel notch.
const CHROME_COLLAPSE_HEIGHT = 90;

type SettingsFeedbackKind = "save" | "current-cache" | "all-cache";
type DataFeedbackKind = Exclude<SettingsFeedbackKind, "save">;
type SummaryWorkKind = "refresh-source";


interface PanelOpenOptions {
  animate?: boolean;
}

interface GenerateSummaryForSourceOptions {
  cachePolicy?: SummaryCachePolicy;
}


export class YouMindSummaryPanel {
  readonly element: HTMLElement;
  private readonly root: ShadowRoot;
  private mounted = false;
  private settings?: Settings;
  private providers?: ProviderSettings;
  private cache?: PageCache;
  private timelineMatcher?: TimelineMatcher;
  private timelineMatcherSource?: PageCache["source"];
  private status: PanelStatus = "idle";
  private error = "";
  private collapsed = false;
  private readonly summaryStream = new SummaryStreamAssembler();
  private summaryRequestId?: string;
  private isStreaming = false;
  private summaryGenerationPromise?: Promise<void>;
  private readonly summaryWorkByKind = new Map<SummaryWorkKind, Promise<void>>();
  private summarySkeletonExpired = false;
  private summarySkeletonTimer: number | undefined;
  private panelView: PanelView = "content";
  private activeView: ContentView = "summary";
  private lastSummaryScrollTop = 0;
  private lastSubtitleScrollTop = 0;
  private summaryChromeHidden = false;
  private trackedVideo?: HTMLVideoElement;
  private activeSubtitleIndex = -1;
  private lastSubtitleManualScrollAt = 0;
  private autoScrollingSubtitle = false;
  private autoScrollingSubtitleTimer: number | undefined;
  private documentResizeEventsBound = false;
  private rootDelegatedEventsBound = false;
  private dockHideTimer: number | undefined;
  private panelCloseTimer: number | undefined;
  private topActionFeedback?: "refresh";
  private topActionFeedbackTimer: number | undefined;
  private settingsSaveFeedback = false;
  /** 清除全部摘要与正文时记录待确认动作，不弹窗、不拦路。 */
  private pendingConfirmAction?: "clear-summary-cache";
  private pendingConfirmTimer: number | undefined;
  private settingsDataFeedback?: DataFeedbackKind;
  private settingsFeedbackTimer: number | undefined;
  private settingsEntering = false;
  private contentViewEntering = false;
  private sourceTextViewEntering = false;
  private settingsExiting = false;
  private settingsExitTimer: number | undefined;
  private visibleProviderKeys = new Set<string>();
  private collapsedProviderGroups = new Set<string>();
  private deepseekWebProbeInFlight = false;
  private commandShortcuts: Record<string, string> = {};
  private shortcutRefreshEventsBound = false;
  private sourceRefreshState?: "loading" | "success" | "failure";
  private sourceRefreshTimer: number | undefined;
  private diagnosticModalOpen = false;
  /* 封面兜底结果按地址缓存：undefined 未尝试 / null 确认失败 / string 内联地址。
     失败过的地址在重新渲染时直接走占位，不再出现一次破图。 */
  private coverFallbackResults = new Map<string, string | null>();

  private diagnosticModalText = "";
  private sourceTextViewOpen = false;
  private readonly fullChain = new FullChainTracer();
  private readonly geometry: PanelGeometryController;
  private readonly providerModelMenu: ProviderModelMenuController;
  private readonly subtitleTransform: SubtitleTransformController;

  constructor(element?: HTMLElement) {
    this.element = element ?? document.createElement("ym-summary-panel");
    this.root = this.element.shadowRoot ?? this.element.attachShadow({ mode: "open" });
    applyNoTranslate(this.element);
    this.geometry = new PanelGeometryController({
      element: this.element,
      root: this.root,
      onPersist: () => void this.persistPanelState()
    });
    this.providerModelMenu = new ProviderModelMenuController({
      root: this.root,
      getProviders: () => this.providers,
      setProviders: (providers) => { this.providers = providers; },
      getSettings: () => this.settings,
      setSettings: (settings) => { this.settings = settings; },
      readPanelProviders: (fallback) => this.readPanelProviders(fallback),
      renderSettingsInPlace: (scrollTop) => this.renderSettingsInPlace(scrollTop),
      draftEdits: new ProviderDraftEdit({
        getProviders: () => this.providers,
        setProviders: (providers) => { this.providers = providers; },
        readPanelProviders: (fallback) => this.readPanelProviders(fallback),
        savePanelSettings: (options) => void this.savePanelSettings(options)
      })
    });
    this.subtitleTransform = new SubtitleTransformController({
      root: this.root,
      getSource: () => this.cache?.source,
      getSettings: () => this.settings,
      renderContentPreservingScroll: (scrollTop) => this.renderContentPreservingScroll(scrollTop),
      flashActionSuccess: (action) => this.flashActionSuccess(action),
      flashActionFailure: (action) => this.flashActionFailure(action)
    });
  }

  appendStreamChunk(chunk: string, requestId?: string): void {
    if (!this.isStreaming) return;
    if (requestId && requestId !== this.summaryRequestId) return;

    const update = this.summaryStream.append(chunk);
    if (update.kind !== "none") {
      console.log("[DeepSeek Stream] chunk:", chunk.slice(0, 100), "update:", update.kind);
    }
    switch (update.kind) {
      case "final":
        this.clearSummarySkeletonTimer();
        if (!this.shouldRenderSummaryStreamPreview()) return;
        if (this.reconcileVisibleSummaryInPlace(update.summary)) return;
        if (this.replaceVisibleSummaryInPlace(update.summary)) return;
        this.renderContentPreservingScroll();
        return;
      case "draft":
        this.clearSummarySkeletonTimer();
        if (!this.shouldRenderSummaryStreamPreview()) return;
        if (this.updateStreamingDraftInPlace(update.draft)) return;
        this.renderContentPreservingScroll();
        return;
      case "event-overview":
        if (update.overview) {
          this.clearSummarySkeletonTimer();
          if (!this.shouldRenderSummaryStreamPreview()) return;
          if (this.updateStreamingOverviewInPlace(update.overview)) return;
        }
        this.renderContentPreservingScroll();
        return;
      case "json-summary":
        this.clearSummarySkeletonTimer();
        if (!this.shouldRenderSummaryStreamPreview()) return;
        // Same in-place path as final/draft: avoid full shadow-root + CSS rewrite per chunk.
        if (this.reconcileVisibleSummaryInPlace(update.summary)) return;
        if (this.replaceVisibleSummaryInPlace(update.summary)) return;
        this.renderContentPreservingScroll();
        return;
      case "partial-overview":
        this.clearSummarySkeletonTimer();
        if (!this.shouldRenderSummaryStreamPreview()) return;
        if (this.updateStreamingOverviewInPlace(update.overview)) return;
        this.renderContentPreservingScroll();
        return;
      case "none":
        return;
    }
  }

  private shouldRenderSummaryStreamPreview(): boolean {
    return this.panelView === "content" && this.activeView === "summary";
  }

  private startSummarySkeletonTimer(): void {
    this.clearSummarySkeletonTimer();
    this.summarySkeletonExpired = false;
    this.summarySkeletonTimer = window.setTimeout(() => {
      this.summarySkeletonTimer = undefined;
      if (!this.isStreaming || this.status !== "generating" || this.summaryStream.hasPreview()) return;
      this.summarySkeletonExpired = true;
      if (this.panelView === "content" && this.activeView === "summary") this.render();
    }, SUMMARY_SKELETON_MIN_MS);
  }

  private clearSummarySkeletonTimer(): void {
    if (this.summarySkeletonTimer !== undefined) {
      window.clearTimeout(this.summarySkeletonTimer);
      this.summarySkeletonTimer = undefined;
    }
  }

  private resetSummaryStreamState(): void {
    this.clearSummarySkeletonTimer();
    this.isStreaming = false;
    this.summarySkeletonExpired = false;
    this.summaryStream.reset();
    this.summaryRequestId = undefined;
  }

  private updateStreamingOverviewInPlace(overview: string): boolean {
    if (this.panelView !== "content" || this.activeView !== "summary") return false;
    // Match both pending and non-pending stream overview to avoid remount on initial chunks
    const overviewText = this.root.querySelector<HTMLElement>(".summary-stream-overview .overview-text");
    if (!overviewText) return false;
    overviewText.textContent = stripOverviewLabel(overview);
    // Upgrade pending skeleton to streaming overview structure on first real content
    const summaryElement = overviewText.closest(".summary");
    if (summaryElement?.classList.contains("summary-stream-pending")) {
      summaryElement.classList.remove("summary-stream-pending");
      summaryElement.removeAttribute("role");
      summaryElement.removeAttribute("aria-label");
      // Insert .summary-tree-loading if not present (pending → overview transition)
      if (!summaryElement.querySelector(".summary-tree-loading")) {
        const treeLoading = document.createElement("div");
        treeLoading.className = "summary-tree-loading";
        treeLoading.innerHTML = renderStreamingSparkle();
        summaryElement.appendChild(treeLoading);
      }
    }
    return true;
  }

  private updateStreamingDraftInPlace(summary: SummaryResult): boolean {
    if (!this.isStreaming || this.panelView !== "content" || this.activeView !== "summary") return false;

    return this.updateVisibleSummaryContent(summary);
  }

  private reconcileVisibleSummaryInPlace(summary: SummaryResult): boolean {
    if (this.panelView !== "content" || this.activeView !== "summary") return false;
    const updated = this.updateVisibleSummaryContent(summary);
    if (!updated) return false;
    this.removeStreamingSummaryChrome();
    return true;
  }

  private completeSummaryGenerationInPlace(cache: PageCache): boolean {
    if (!cache.summary || this.panelView !== "content" || this.activeView !== "summary") return false;
    const updated = this.reconcileVisibleSummaryInPlace(cache.summary) || this.replaceVisibleSummaryInPlace(cache.summary);
    if (!updated) return false;
    this.ensureSummaryActionRailInPlace();
    return true;
  }

  private mergeCacheWithStreamFallback(cache: PageCache): PageCache {
    if (!cache.summary) return cache;
    const summary = this.summaryStream.mergeFinal(cache.summary);
    if (!hasMeaningfulSummary(summary)) {
      throw new Error("模型返回的摘要 JSON 无法解析：模型仅返回占位摘要");
    }
    return { ...cache, summary };
  }

  // 模型可能先把后续 section 标题甩出来再回头填内容。流式期间只渲染已经带 point 的
  // section：空标题不出现，空出来的树区由三星加载占位承接。
  private streamableSections(sections: SummarySection[]): SummarySection[] {
    return sections.filter((section) => section.points.length > 0);
  }

  private updateVisibleSummaryContent(summary: SummaryResult): boolean {
    const summaryElement = this.root.querySelector<HTMLElement>(".summary");
    if (
      !summaryElement ||
      summaryElement.classList.contains("summary-stream-overview") ||
      summaryElement.classList.contains("overview-loading-wrap")
    ) return false;

    const overviewText = summaryElement.querySelector<HTMLElement>(".overview-text");
    const tree = summaryElement.querySelector<HTMLElement>(".tree");
    if (!overviewText || !tree) return false;

    overviewText.textContent = this.streamingOverviewDisplay(summary.overview);
    this.syncStreamingSections(tree, this.streamableSections(summary.sections));
    return true;
  }

  private replaceVisibleSummaryInPlace(summary: SummaryResult): boolean {
    if (this.panelView !== "content" || this.activeView !== "summary") return false;
    const summaryElement = this.root.querySelector<HTMLElement>(".summary");
    if (!summaryElement) return false;

    const scrollTop = summaryElement.scrollTop;
    summaryElement.className = "summary";
    summaryElement.removeAttribute("role");
    summaryElement.removeAttribute("aria-label");
    const sections = this.streamableSections(summary.sections);
    // 还没有任何带内容的 section 时，保留三星占位，不要留一片空白树区。
    const footer = this.isStreaming && sections.length === 0
      ? `<div class="summary-tree-loading">${renderStreamingSparkle()}</div>`
      : "";
    setTrustedInnerHTML(summaryElement, this.renderSummaryShell(summary.overview, sections, footer));
    summaryElement.scrollTop = scrollTop;
    this.updateScrollFadeState(summaryElement);
    return true;
  }

  private removeStreamingSummaryChrome(): void {
    this.root.querySelector(".summary-tree-loading")?.remove();
  }

  private ensureSummaryActionRailInPlace(): void {
    if (this.root.querySelector(".floating-action-dock")) return;
    const panel = this.root.querySelector<HTMLElement>(".panel");
    if (!panel) return;
    const dock = this.createElementFromHtml(this.renderActionRail(true, false));
    panel.appendChild(dock);

    const copyBtn = dock.querySelector<HTMLElement>("[data-action='copy-summary']");
    if (copyBtn) attachButtonWithInstantFeedback(copyBtn, () => void this.copySummary());

    const downloadBtn = dock.querySelector<HTMLElement>("[data-action='download-summary']");
    if (downloadBtn) attachButtonWithInstantFeedback(downloadBtn, () => this.downloadSummary());
  }

  private syncStreamingSections(tree: HTMLElement, sections: SummarySection[]): void {
    sections.forEach((section, index) => {
      const sectionId = String(index);
      let sectionElement = this.findDirectStreamChild(tree, "streamSection", sectionId);

      if (!sectionElement) {
        sectionElement = this.createElementFromHtml(this.renderSection(section, index));
        sectionElement.setAttribute("data-stream-entering", "true");
        clearMotionAttribute(sectionElement, "data-stream-entering", STREAM_NODE_ENTER_MS);
      } else {
        sectionElement.className = `tree-section section-${index % 4}`;
        const heading = sectionElement.querySelector<HTMLElement>("h3");
        if (heading) heading.textContent = section.title;
        const pointList = this.findDirectChildByTag(sectionElement, "UL");
        if (pointList) this.syncStreamingPoints(pointList, section.points, sectionId, 0);
      }

      if (tree.children[index] !== sectionElement) {
        tree.insertBefore(sectionElement, tree.children[index] ?? null);
      }
    });

    Array.from(tree.children).forEach((child) => {
      if (
        child instanceof HTMLElement &&
        child.dataset.streamSection !== undefined &&
        Number(child.dataset.streamSection) >= sections.length
      ) {
        child.remove();
      }
    });
  }

  private syncStreamingPoints(list: HTMLElement, points: SummaryPoint[], pathPrefix: string, depth: number): void {
    points.forEach((point, index) => {
      const pointPath = `${pathPrefix}.${index}`;
      let pointElement = this.findDirectStreamChild(list, "streamPoint", pointPath);

      if (!pointElement) {
        pointElement = this.createElementFromHtml(this.renderPoint(point, depth, pointPath));
        pointElement.setAttribute("data-stream-entering", "true");
        clearMotionAttribute(pointElement, "data-stream-entering", STREAM_NODE_ENTER_MS);
      } else {
        this.updateStreamingPointText(pointElement, point, depth);
        const children = point.children ?? [];
        let childList = this.findDirectChildByTag(pointElement, "UL");
        if (children.length > 0) {
          if (!childList) {
            childList = document.createElement("ul");
            childList.className = "children";
            pointElement.appendChild(childList);
          }
          this.syncStreamingPoints(childList, children, pointPath, depth + 1);
        } else {
          childList?.remove();
        }
      }

      if (list.children[index] !== pointElement) {
        list.insertBefore(pointElement, list.children[index] ?? null);
      }
    });

    Array.from(list.children).forEach((child) => {
      if (
        child instanceof HTMLElement &&
        child.dataset.streamPoint !== undefined &&
        !points.some((_point, index) => child.dataset.streamPoint === `${pathPrefix}.${index}`)
      ) {
        child.remove();
      }
    });
  }

  private updateStreamingPointText(pointElement: HTMLElement, point: SummaryPoint, depth: number): void {
    if (depth >= 1) {
      const jumpText = pointElement.querySelector<HTMLElement>(":scope > .summary-child-jump .summary-child-jump-text");
      const jumpButton = pointElement.querySelector<HTMLElement>(":scope > .summary-child-jump .summary-child-jump-button");
      const timeline = this.resolveSummaryPointTimeline(point.text);
      const sourceText = timeline?.sourceText ?? point.text;
      if (jumpText) jumpText.textContent = sourceText;
      let timestamp = pointElement.querySelector<HTMLElement>(":scope > .summary-child-jump .summary-child-timestamp");
      if (timeline) {
        if (!timestamp) {
          timestamp = document.createElement("span");
          timestamp.className = "summary-child-timestamp";
          jumpButton?.before(timestamp);
        }
        timestamp.textContent = `[${timeline.label}]`;
      } else {
        timestamp?.remove();
      }
      if (jumpButton) {
        jumpButton.dataset.sourceJump = sourceText;
        if (timeline) {
          jumpButton.dataset.sourceJumpStart = String(timeline.start);
          jumpButton.setAttribute("aria-label", `跳转到 ${timeline.label}`);
        } else {
          delete jumpButton.dataset.sourceJumpStart;
          jumpButton.setAttribute("aria-label", "跳转到来源");
        }
      }
      return;
    }

    const textElement = Array.from(pointElement.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement &&
      child.tagName === "SPAN" &&
      !child.classList.contains("node")
    ));
    if (textElement) textElement.textContent = point.text;
  }

  private findDirectStreamChild(parent: HTMLElement, key: "streamSection" | "streamPoint", value: string): HTMLElement | undefined {
    return Array.from(parent.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement &&
      child.dataset[key] === value
    ));
  }

  private findDirectChildByTag(parent: HTMLElement, tagName: string): HTMLElement | undefined {
    return Array.from(parent.children).find((child): child is HTMLElement => (
      child instanceof HTMLElement &&
      child.tagName === tagName
    ));
  }

  private createElementFromHtml(html: string): HTMLElement {
    const template = document.createElement("template");
    setTrustedInnerHTML(template, html.trim());
    return template.content.firstElementChild as HTMLElement;
  }

  async mount(): Promise<boolean> {
    if (this.mounted) return false;
    this.mounted = true;
    this.element.style.position = "fixed";
    this.element.style.zIndex = "2147483647";
    this.element.style.top = "18px";
    this.element.style.right = "18px";
    this.element.style.setProperty("visibility", "visible", "important");
    await Promise.all([this.loadSettings(), this.restorePanelState()]);
    this.render();
    mountToaster(this.root);
    return true;
  }

  async open(autoSummarize: boolean, options: PanelOpenOptions = {}): Promise<void> {
    const trace = this.summaryGenerationPromise ? undefined : this.fullChain.start();
    let settingsLoadedDuringMount = false;
    try {
      settingsLoadedDuringMount = await this.fullChain.timeStage("mount", () => this.mount());
    } catch (error) {
      this.fullChain.finish("error", false, { stage: "mount", error });
      throw error;
    }
    this.clearPanelCloseTimer();
    this.element.removeAttribute("data-closing");
    const shouldAnimateOpen = options.animate !== false && this.element.getAttribute("data-open") !== "true" && !prefersReducedMotion();
    if (!this.geometry.userResizedPanelHeight) {
      this.element.style.height = "calc(100vh - 40px)";
    }
    this.element.style.setProperty("visibility", "visible", "important");
    this.element.setAttribute("data-open", "true");
    if (shouldAnimateOpen) {
      const panel = this.root.querySelector<HTMLElement>(".panel");
      if (panel) animatePanelOpen(panel, false);
    } else if (options.animate !== false) {
      // Reduced motion - cross-fade
      const panel = this.root.querySelector<HTMLElement>(".panel");
      if (panel) animatePanelOpen(panel, true);
    } else {
      // No animation - instant
      const panel = this.root.querySelector<HTMLElement>(".panel");
      if (panel) {
        panel.style.opacity = "1";
        panel.style.transform = "none";
      }
    }
    this.collapsed = false;
    this.panelView = "content";
    this.activeView = "summary";
    this.resetSourceDerivedState();
    if (this.summaryGenerationPromise) {
      this.render();
      return;
    }

    try {
      await this.fullChain.timeStage("settings", () => settingsLoadedDuringMount ? Promise.resolve() : this.loadSettings());
      await this.fullChain.timeStage("cache", () => this.loadCache(), () => ({ hit: Boolean(this.cache?.summary) }));
    } catch (error) {
      this.fullChain.finish("error", false, { stage: this.fullChain.stageFailed("settings") ? "settings" : "cache", error });
      throw error;
    }
    if (this.cache?.summary) {
      this.status = "ready";
      this.fullChain.setSourceKind(this.cache.source.sourceKind);
      this.fullChain.finish("cache-hit", true);
      this.render();
      if (autoSummarize && shouldRevalidateBilibiliFallbackCache(this.cache)) {
        void this.revalidateBilibiliFallbackCache();
      }
      return;
    }

    if (autoSummarize) {
      void this.generateSummary();
      return;
    }

    if (trace) this.fullChain.clear(trace);
    this.render();
  }

  isOpen(): boolean {
    return this.element.isConnected && this.element.getAttribute("data-open") === "true";
  }

  /**
   * 已打开则关闭；未打开则以「不带动画」的既有快捷键语义打开。
   * autoSummarize 只在打开分支被读取——由调用方按既有规则决定，toggle 不读面板设置。
   */
  toggle(autoSummarize = true): void {
    if (this.isOpen()) {
      this.close();
      return;
    }
    void this.open(autoSummarize, { animate: false });
  }

  close(): void {
    this.clearPanelCloseTimer();
    this.element.removeAttribute("data-opening");
    this.trackedVideo?.removeEventListener("timeupdate", this.handleVideoTimeUpdate);
    this.trackedVideo = undefined;
    const shouldAnimateClose = this.element.getAttribute("data-open") === "true" && !prefersReducedMotion();
    const reducedMotion = this.element.getAttribute("data-open") === "true" && prefersReducedMotion();

    if (!shouldAnimateClose && !reducedMotion) {
      this.element.removeAttribute("data-open");
      this.element.removeAttribute("data-closing");
      const panel = this.root.querySelector<HTMLElement>(".panel");
      if (panel) stopPanelAnimation(panel);
      return;
    }

    const panel = this.root.querySelector<HTMLElement>(".panel");
    if (!panel) {
      this.element.removeAttribute("data-open");
      return;
    }

    this.element.setAttribute("data-closing", "true");
    animatePanelClose(panel, () => {
      this.element.removeAttribute("data-open");
      this.element.removeAttribute("data-closing");
    }, reducedMotion);
  }

  private clearPanelCloseTimer(): void {
    if (this.panelCloseTimer === undefined) return;
    window.clearTimeout(this.panelCloseTimer);
    this.panelCloseTimer = undefined;
  }

  private async loadSettings(): Promise<void> {
    const [settings, providers, commandShortcuts] = await Promise.all([
      getSettings(),
      getProviders(),
      this.loadCommandShortcuts()
    ]);
    this.settings = settings;
    this.providers = providers;
    this.commandShortcuts = commandShortcuts;
  }

  private async loadCommandShortcuts(): Promise<Record<string, string>> {
    try {
      const response = await getCommandShortcuts();
      return response.shortcuts && typeof response.shortcuts === "object" ? response.shortcuts : {};
    } catch {
      return {};
    }
  }

  private async refreshCommandShortcutsInSettings(): Promise<void> {
    if (this.panelView !== "settings") return;
    this.commandShortcuts = await this.loadCommandShortcuts();
    if (this.panelView !== "settings") return;
    const shortcutInput = this.root.querySelector<HTMLInputElement>("[data-panel-command-shortcut='_execute_action']");
    if (shortcutInput) {
      shortcutInput.value = this.commandShortcuts["_execute_action"] || "未设置";
      return;
    }
    this.renderSettingsInPlace();
  }

  private async loadCache(): Promise<void> {
    const response = await getPageCache(location.href);
    const rawCache = response.cache?.source.sourceKind === "bilibili-official-summary"
      ? undefined
      : response.cache;
    const storedCache = rawCache?.summary
      ? { ...rawCache, summary: mergeSummaryWithMeaningfulFallback(rawCache.summary) }
      : rawCache;
    const staleSummary = Boolean(storedCache?.summary && !hasMeaningfulSummary(storedCache.summary));
    if (staleSummary) await clearPageCache(location.href);
    const cache = staleSummary && storedCache ? { source: storedCache.source } : storedCache;
    if (cache?.source.url !== this.cache?.source.url) this.resetSourceDerivedState();
    this.cache = cache;
  }

  private async revalidateBilibiliFallbackCache(): Promise<void> {
    if (this.summaryGenerationPromise) return this.summaryGenerationPromise;

    const revalidation = this.runBilibiliFallbackCacheRevalidation();
    this.summaryGenerationPromise = revalidation;
    try {
      await revalidation;
    } finally {
      if (this.summaryGenerationPromise === revalidation) this.summaryGenerationPromise = undefined;
    }
  }

  private async runBilibiliFallbackCacheRevalidation(): Promise<void> {
    const previousCache = this.cache;
    if (!previousCache?.summary) return;

    const trace = this.fullChain.ensure();
    let source: SourcePayload;
    try {
      source = await this.extractCurrentSourceWithTrace();
    } catch (error) {
      this.fullChain.finish("error", false, { stage: "extraction", error });
      this.render();
      console.warn(
        "[YouMind] bilibili fallback cache revalidation failed",
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
    if (source.sourceKind !== "bilibili-transcript") {
      if (source.sourceKind === "fallback") {
        this.cache = {
          ...previousCache,
          source: {
            ...previousCache.source,
            warning: source.warning,
            extractionDiagnostics: source.extractionDiagnostics
          }
        };
        this.status = "ready";
      }
      this.fullChain.clear(trace);
      this.render();
      return;
    }

    try {
      await this.generateSummaryForSource(source);
    } catch (error) {
      this.resetSummaryStreamState();
      this.cache = previousCache;
      this.status = "ready";
      this.error = "";
      this.fullChain.finish("error", false, { stage: "summary", error });
      this.render();
      console.warn(
        "[YouMind] bilibili transcript cache upgrade failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async restorePanelState(): Promise<void> {
    const response = await getPanelState(location.hostname);
    const state = response.state;
    if (!state) return;

    if (typeof state.left === "number" && typeof state.top === "number") {
      // Clamp restored position to viewport bounds to prevent panel from being stuck off-screen
      const panelWidth = this.element.offsetWidth || 400;
      const panelHeight = this.element.offsetHeight || 600;
      const maxLeft = window.innerWidth - panelWidth - 8;
      const maxTop = window.innerHeight - panelHeight - 8;
      const clampedLeft = Math.max(8, Math.min(state.left, maxLeft));
      const clampedTop = Math.max(8, Math.min(state.top, maxTop));

      this.element.style.left = `${clampedLeft}px`;
      this.element.style.top = `${clampedTop}px`;
      this.element.style.right = "auto";
    }
    this.collapsed = false;
  }

  private async persistPanelState(): Promise<void> {
    await savePanelState(location.hostname, {
      left: this.element.offsetLeft,
      top: this.element.offsetTop,
      collapsed: false
    });
  }

  private async extractCurrentSourceWithTrace(): Promise<SourcePayload> {
    this.fullChain.ensure();
    const startedAt = Date.now();
    try {
      const source = await extractCurrentSource();
      this.fullChain.setSourceKind(source.sourceKind);
      this.fullChain.recordStage("extraction", {
        ok: true,
        durationMs: elapsedMs(startedAt),
        route: fullChainSourceRoute(source)
      });
      return source;
    } catch (error) {
      this.fullChain.recordStage("extraction", {
        ok: false,
        durationMs: elapsedMs(startedAt),
        route: "unknown"
      });
      throw error;
    }
  }

  private async generateSummary(): Promise<void> {
    if (this.summaryGenerationPromise) return this.summaryGenerationPromise;

    const generation = this.runGenerateSummary();
    this.summaryGenerationPromise = generation;
    try {
      await generation;
    } finally {
      if (this.summaryGenerationPromise === generation) this.summaryGenerationPromise = undefined;
    }
  }

  private async runSummaryWorkSerially(action: () => Promise<void>, kind?: SummaryWorkKind): Promise<void> {
    const existing = kind ? this.summaryWorkByKind.get(kind) : undefined;
    if (existing) return existing;

    const previous = this.summaryGenerationPromise;
    const generation = (async () => {
      if (previous) {
        try {
          await previous;
        } catch {
          // Explicit work may continue after the previous attempt has rendered its own failure state.
        }
      }
      await action();
    })();
    if (kind) this.summaryWorkByKind.set(kind, generation);
    this.summaryGenerationPromise = generation;
    try {
      await generation;
    } finally {
      if (kind && this.summaryWorkByKind.get(kind) === generation) this.summaryWorkByKind.delete(kind);
      if (this.summaryGenerationPromise === generation) this.summaryGenerationPromise = undefined;
    }
  }

  private async runGenerateSummary(): Promise<void> {
    try {
      this.status = "extracting";
      this.error = "";
      this.panelView = "content";
      this.activeView = "summary";
      this.resetSourceDerivedState();
      this.cache = undefined;
      this.render();

      const source = await this.extractCurrentSourceWithTrace();
      await this.generateSummaryForSource(source);
    } catch (error) {
      this.resetSummaryStreamState();
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      const stage = this.fullChain.resolveErrorStage();
      this.fullChain.finish("error", false, { stage, error });
      this.render();
    }
  }

  private async generateSummaryForSource(source: SourcePayload, options: GenerateSummaryForSourceOptions = {}): Promise<void> {
    this.resetSourceDerivedState();
    this.cache = { source };
    this.status = "generating";
    this.clearSummarySkeletonTimer();
    this.summarySkeletonExpired = false;
    this.summaryStream.reset();
    this.summaryRequestId = createPanelRequestId("summary");
    this.isStreaming = true;
    this.startSummarySkeletonTimer();
    this.render();

    const trace = this.fullChain.ensure();
    trace.sourceKind = source.sourceKind;
    if (!trace.stages.extraction) {
      this.fullChain.recordStage("extraction", { ok: true, durationMs: 0, route: fullChainSourceRoute(source) });
    }
    const summaryStartedAt = Date.now();
    let response: Awaited<ReturnType<typeof generateSummary>>;
    let nextCache: PageCache;
    try {
      response = await generateSummary(source, this.summaryRequestId, trace.traceId, options.cachePolicy);
      nextCache = this.mergeCacheWithStreamFallback(response.cache);
      this.fullChain.recordStage("summary", {
        ok: true,
        durationMs: elapsedMs(summaryStartedAt),
        ...(response.meta?.timing?.providerFirstChunkMs !== undefined ? { providerFirstChunkMs: response.meta.timing.providerFirstChunkMs } : {}),
        ...(response.meta?.timing?.providerDurationMs !== undefined ? { providerDurationMs: response.meta.timing.providerDurationMs } : {}),
        ...(response.meta?.timing?.parseDurationMs !== undefined ? { parseDurationMs: response.meta.timing.parseDurationMs } : {})
      });
    } catch (error) {
      this.fullChain.recordStage("summary", { ok: false, durationMs: elapsedMs(summaryStartedAt) });
      throw error;
    }
    this.resetSummaryStreamState();
    this.cache = nextCache;
    this.status = "ready";
    const renderStartedAt = Date.now();
    const completedInPlace = this.completeSummaryGenerationInPlace(nextCache);
    this.fullChain.recordStage("render", { ok: true, durationMs: elapsedMs(renderStartedAt) });
    this.fullChain.finish("generated", true);
    if (completedInPlace) {
      this.updateSourceChromeInPlace();
      return;
    }
    if (this.panelView === "content" && this.activeView !== "summary") return;
    this.render();
  }

  private async regenerateSummaryWithoutClearing(): Promise<void> {
    if (this.summaryGenerationPromise) return this.summaryGenerationPromise;
    const generation = this.runRegenerateSummaryWithoutClearing();
    this.summaryGenerationPromise = generation;
    try {
      await generation;
    } finally {
      if (this.summaryGenerationPromise === generation) this.summaryGenerationPromise = undefined;
    }
  }

  private async runRegenerateSummaryWithoutClearing(): Promise<void> {
    const scrollTop = this.root.querySelector<HTMLElement>(".summary, .subtitle-view")?.scrollTop ?? 0;
    const chromeHidden = this.summaryChromeHidden;
    const previousCache = this.cache;
    this.sourceTextViewOpen = false;
    try {
      this.error = "";
      this.panelView = "content";
      this.activeView = "summary";
      this.resetSourceDerivedState();
      this.resetSummaryStreamState();
      this.status = "extracting";
      this.renderContentPreservingScroll(scrollTop);
      const source = await this.extractCurrentSourceWithTrace();
      await this.generateSummaryForSource(source);
      this.summaryChromeHidden = chromeHidden;
      this.root.querySelector(".panel")?.classList.toggle("scrolled", chromeHidden);
    } catch (error) {
      this.resetSummaryStreamState();
      const message = error instanceof Error ? error.message : String(error);
      const stage = this.fullChain.resolveErrorStage();
      this.fullChain.finish("error", false, { stage, error });
      if (previousCache?.summary) {
        this.cache = previousCache;
        this.status = "ready";
        this.error = "";
      } else {
        this.status = "error";
        this.error = message;
      }
      this.renderContentPreservingScroll(scrollTop);
    }
  }

  private refreshSource(): Promise<void> {
    return this.runSummaryWorkSerially(() => this.runRefreshSource(), "refresh-source");
  }

  private async runRefreshSource(): Promise<void> {
    if (this.sourceRefreshState === "loading") return;
    const scrollTop = this.root.querySelector<HTMLElement>(".summary, .subtitle-view")?.scrollTop ?? 0;
    if (this.sourceRefreshTimer !== undefined) {
      window.clearTimeout(this.sourceRefreshTimer);
      this.sourceRefreshTimer = undefined;
    }
    this.sourceRefreshState = "loading";
    this.updateSourceRefreshButton();

    try {
      const previousCache = this.cache;
      const previousSource = previousCache?.source;
      const source = await extractCurrentSource({ stabilize: true });
      if (
        previousSource?.sourceKind !== source.sourceKind ||
        JSON.stringify(previousSource?.segments ?? []) !== JSON.stringify(source.segments ?? []) ||
        (previousSource?.sourceMarkdown ?? previousSource?.text ?? "").trim() !== (source?.sourceMarkdown ?? source?.text ?? "").trim()
      ) {
        this.resetSourceDerivedState();
      }
      if (previousCache?.summary && previousSource && !isSameSummarySource(previousSource, source)) {
        this.resetSourceDerivedState();
        await this.generateSummaryForSource(source);
        this.sourceRefreshState = "success";
        this.updateSourceRefreshButton();
        return;
      }
      this.cache = {
        ...(previousCache ?? {}),
        source
      };
      this.status = this.cache.summary ? "ready" : this.status;
      this.sourceRefreshState = "success";
      if (!this.updateSourceChromeInPlace()) {
        this.renderContentPreservingScroll(scrollTop);
      }
      this.updateSourceRefreshButton();
    } catch {
      this.sourceRefreshState = "failure";
      this.updateSourceRefreshButton();
    } finally {
      this.sourceRefreshTimer = window.setTimeout(() => {
        this.sourceRefreshState = undefined;
        this.sourceRefreshTimer = undefined;
        this.updateSourceRefreshButton();
      }, 900);
    }
  }

  private updateSourceChromeInPlace(): boolean {
    const source = this.cache?.source;
    if (!source || this.panelView !== "content") return false;
    const panel = this.root.querySelector<HTMLElement>(".panel");
    const summary = this.root.querySelector<HTMLElement>(".summary");
    if (!panel || !summary || summary.classList.contains("subtitle-view")) return false;

    const titleText = this.root.querySelector<HTMLElement>(".page-title-text");
    if (titleText) titleText.textContent = source.title || document.title || "当前页面";
    const metaRow = this.root.querySelector<HTMLElement>(".page-meta-row");
    if (metaRow) {
      setTrustedInnerHTML(metaRow, this.renderPageMetaRow(source.authorName));
    }
    return true;
  }

  private renderPageMetaRow(authorName: string | undefined): string {
    if (!authorName) return "";
    return `<span class="page-meta-row"><span class="page-author">${escapeHtml(authorName)}</span></span>`;
  }

  private updateSourceRefreshButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-action='refresh-source']");
    if (!button) return;
    const stateClass = this.sourceRefreshState ? ` source-refresh-${this.sourceRefreshState}` : "";
    button.className = `icon-button${stateClass}`;
    setTrustedInnerHTML(
      button,
      this.sourceRefreshState === "success"
        ? renderLucideIcon("check")
        : this.sourceRefreshState === "failure"
          ? renderLucideIcon("x")
          : renderLucideIcon("refresh-cw")
    );
  }


  private render(): void {
    const settings = this.settings;
    const theme = settings ? resolveTheme(settings) : "dark";
    const cache = this.cache;
    const summary = cache?.summary;

    this.element.setAttribute("data-theme", theme);
    this.collapsed = false;
    this.element.toggleAttribute("data-collapsed", this.collapsed);

    const panelContent = this.panelView === "settings"
      ? `${this.renderSettingsPanel()}${this.providerModelMenu.renderCandidates()}`
      : `
        <header class="topbar" data-drag-handle>
          <div class="brand">
            ${this.renderModelSelect()}
          </div>
          <div class="thinking-slot">
            ${this.renderThinkingLevelSelect()}
          </div>
          <div class="top-actions">
            <button class="icon-button" data-action="settings" aria-label="设置">${renderLucideIcon("settings")}</button>
            <button class="icon-button${this.topActionFeedback === "refresh" ? " spinning" : ""}" data-action="refresh" aria-label="重新生成摘要">${renderLucideIcon("refresh-cw")}</button>
            <button class="icon-button" data-action="close" aria-label="关闭">${renderLucideIcon("x")}</button>
          </div>
        </header>
        ${this.renderBody(summary)}
      `;

    const panelHtml = `
      <section class="panel" role="dialog" aria-label="摘意摘要浮窗">
        ${panelContent}
      </section>
      ${this.diagnosticModalOpen ? this.renderDiagnosticModal() : ""}
    `;

    const existingStyle = this.root.querySelector("style");
    if (existingStyle) {
      // Subsequent render: keep the <style> element, only replace the panel section.
      // Avoids re-parsing 3000+ lines of CSS on every state change.
      const existingPanel = this.root.querySelector(".panel");
      if (existingPanel) {
        setTrustedInnerHTML(existingPanel as HTMLElement, panelContent);
      } else {
        existingStyle.insertAdjacentHTML("afterend", panelHtml);
      }
    } else {
      // First render: inject both <style> and <section>.
      setTrustedInnerHTML(this.root, `
        <style>${panelCss}</style>
        ${panelHtml}
      `);
    }

    applyNoTranslate(this.element);
    Array.from(this.root.children).forEach((child) => {
      if (child.tagName !== "STYLE" && child.tagName !== "LINK") applyNoTranslate(child);
    });

    this.bindEmptyCoverFallback();
    this.bindEvents();
    this.settingsEntering = false;
    if (this.panelView === "content") this.resetSummaryScroll();

    // 延迟清除 contentViewEntering,让 @starting-style 有时间触发
    if (this.contentViewEntering) {
      const view = this.root.querySelector(".content-view.entering");
      if (view) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.contentViewEntering = false;
            view.classList.remove("entering");
          });
        });
      } else {
        this.contentViewEntering = false;
      }
    }
  }

  private renderSettingsInPlace(scrollTop = this.root.querySelector<HTMLElement>(".panel-settings")?.scrollTop ?? 0): void {
    if (this.settingsExiting) return;
    this.render();
    if (this.panelView !== "settings") return;
    const settingsPanel = this.root.querySelector<HTMLElement>(".panel-settings");
    if (settingsPanel) settingsPanel.scrollTop = scrollTop;
  }

  private renderContentPreservingScroll(scrollTop = this.root.querySelector<HTMLElement>(".summary, .subtitle-view")?.scrollTop ?? 0): void {
    const chromeHidden = this.summaryChromeHidden;
    this.render();
    if (this.panelView !== "content") return;
    this.summaryChromeHidden = chromeHidden;
    this.root.querySelector(".panel")?.classList.toggle("scrolled", chromeHidden);
    const scrollContainer = this.root.querySelector<HTMLElement>(".summary, .subtitle-view");
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollTop;
    this.lastSummaryScrollTop = scrollTop;
    if (scrollContainer.classList.contains("subtitle-view")) {
      this.lastSubtitleScrollTop = scrollTop;
      this.lastSubtitleManualScrollAt = Date.now();
    }
    this.updateScrollFadeState(scrollContainer);
  }

  private renderBody(summary: PageCache["summary"]): string {
    const cache = this.cache;
    const title = cache?.source.title || document.title || "当前页面";
    const titleVisual = this.resolveTitleVisual(cache?.source);
    const authorName = cache?.source.authorName;
    const showLoading = this.status === "extracting" || this.status === "generating";
    const showSubtitleTab = Boolean(cache?.source && isTranscriptSource(cache.source.sourceKind));
    const activeContentView: ContentView = showSubtitleTab && this.activeView === "subtitle" ? "subtitle" : "summary";
    const showSummaryActions = activeContentView === "summary" && Boolean(summary && !this.isStreaming);
    const showSubtitleActions = Boolean(activeContentView === "subtitle" && cache?.source.segments?.length);
    const contentViewClass = [
      "content-view",
      `content-view-${activeContentView}`,
      this.contentViewEntering ? "entering" : ""
    ].filter(Boolean).join(" ");
    // 标题动作：无来源时纯文本；摘要视图点击打开正文，正文视图点击返回摘要
    const titleAction = !cache?.source
      ? ""
      : this.sourceTextViewOpen
        ? "close-source-text-view"
        : "show-source-text";
    const titleHtml = titleAction
      ? `<button class="page-title-text" data-action="${titleAction}" type="button" aria-label="${titleAction === "close-source-text-view" ? "返回摘要" : "查看正文"}">${escapeHtml(title)}</button>`
      : `<span class="page-title-text">${escapeHtml(title)}</span>`;
    const pageTitleRowHtml = `
      <div class="page-row">
        <div class="page-title">
          ${titleVisual ? `<img src="${escapeAttribute(titleVisual)}" alt="" />` : `<span class="leaf" aria-hidden="true"></span>`}
          <span class="page-title-copy">
            ${titleHtml}
            ${this.renderPageMetaRow(authorName)}
          </span>
        </div>
      </div>`;

    // 如果正文视图打开，直接显示正文
    if (this.sourceTextViewOpen && cache?.source) {
      const sourceViewClasses = [
        "source-text-view-wrapper",
        this.sourceTextViewEntering ? "entering" : ""
      ].filter(Boolean).join(" ");

      return `
        <main class="panel-body">
          ${pageTitleRowHtml}
          <div class="${sourceViewClasses}">
            <div class="source-text-view-header">
              <h2>正文 <span class="source-text-count">${formatCharacterCount(cache.source.text.length)}</span></h2>
              <div class="source-text-view-actions">
                <button class="icon-button${this.sourceRefreshState ? ` source-refresh-${this.sourceRefreshState}` : ""}" data-action="refresh-source" type="button" aria-label="${isTranscriptSource(cache.source.sourceKind) ? "重新读取字幕" : "重新读取正文"}">
                  ${this.sourceRefreshState === "success" ? renderLucideIcon("check") : this.sourceRefreshState === "failure" ? renderLucideIcon("x") : renderLucideIcon("refresh-cw")}
                </button>
                <button class="icon-button" data-action="copy-source-text" type="button" aria-label="复制正文">${renderLucideIcon("copy")}</button>
                <button class="icon-button" data-action="download-source-text" type="button" aria-label="下载正文">${renderLucideIcon("download")}</button>
                <button class="icon-button" data-action="close-source-text-view" type="button" aria-label="返回摘要">${renderLucideIcon("chevron-down")}</button>
              </div>
            </div>
        <div class="source-text-view">
          <div class="md-body">${renderMarkdown((cache.source?.sourceMarkdown ?? cache.source?.text ?? "").trim())}</div>
        </div>
            </div>
          </div>
        </main>
      `;
    }

    return `
      ${pageTitleRowHtml}
      ${cache?.source.warning ? `<div class="warning-line">${escapeHtml(cache.source.warning)}</div>` : ""}
      <nav class="tabs" aria-label="内容视图">
        <button class="tab ${activeContentView === "summary" ? "active" : ""}" data-action="view-summary" type="button">${renderSummaryStarIcon()}摘要</button>
        ${showSubtitleTab ? `<button class="tab ${activeContentView === "subtitle" ? "active" : ""}" data-action="view-subtitle" type="button">${renderLucideIcon("captions")}字幕</button>` : ""}
      </nav>
      ${this.status === "error" && activeContentView === "summary" && this.hasConfiguredProvider() ? this.renderError() : ""}
      <div class="${contentViewClass}">
        ${
        activeContentView === "subtitle"
          ? this.subtitleTransform.renderView(this.findActiveSubtitleIndex(document.querySelector("video")?.currentTime ?? -1), this.cache?.source.text)
          : showLoading
              ? this.renderStreamPreview()
              : summary
                ? this.renderSummaryView(summary)
                : this.hasConfiguredProvider()
                  ? this.renderEmpty()
                  : this.renderSetup()
        }
      </div>
      ${showSummaryActions || showSubtitleActions ? this.renderActionRail(showSummaryActions, showSubtitleActions) : ""}
      ${this.diagnosticModalOpen ? this.renderDiagnosticModal() : ""}
    `;
  }

  private resolveTitleVisual(source: SourcePayload | undefined): string | undefined {
    if (!source) return undefined;
    return source.authorAvatar || source.favicon;
  }

  private resolveHeaderModelContext(): {
    providers: ProviderSettings;
    currentProvider: ProviderId;
    currentConfig?: ProviderSettings[ProviderId];
    currentModels: ModelInfo[];
  } | undefined {
    if (!this.settings || !this.providers) {
      return undefined;
    }

    const providers = sanitizePanelProviders(this.providers);
    const currentProvider = this.resolveModelSelectProviderId(providers);
    const currentConfig = this.resolveWebProviderConfig(currentProvider) ?? providers[currentProvider];
    const currentModels = currentConfig ? panelVisibleModels(currentConfig).filter((model) => model.id.trim()) : [];
    return { providers, currentProvider, currentConfig, currentModels };
  }

  private resolveWebProviderConfig(providerId: ProviderId): ProviderSettings[ProviderId] | undefined {
    if (providerId === DEEPSEEK_WEB_PROVIDER_ID) {
      return createDeepSeekWebProviderConfig(
        this.providers?.[DEEPSEEK_WEB_PROVIDER_ID]?.selectedModel ?? DEEPSEEK_WEB_MODELS[0]?.id ?? "",
        this.settings?.deepseekWebModels
      );
    }
    return undefined;
  }

  private renderModelSelect(): string {
    const context = this.resolveHeaderModelContext();
    if (!context) {
      return `<span class="model-fallback">模型</span>`;
    }

    const { providers, currentProvider, currentConfig, currentModels } = context;
    const providerName = providerLabel(currentProvider, providers);
    const currentModel = currentConfig?.selectedModel ?? "";
    const currentLabel = currentModels.find((model) => model.id === currentModel)?.label || currentModel;
    if (currentModels.length === 0) {
      return `<span class="model-fallback">${escapeHtml(currentModel || "选择模型")}</span>`;
    }

    return `
      <details class="model-select-wrap model-menu">
        <summary class="model-trigger" aria-label="切换模型">
          <span class="model-current"><span class="model-current-text">${escapeHtml(currentLabel)}</span></span>
          <span class="model-chevron">${renderLucideIcon("chevron-down")}</span>
        </summary>
        <div class="liquid-menu" role="listbox" aria-label="切换模型">
          ${currentModels
            .map((model) => {
              const selected = model.id === currentModel;
              const value = `${currentProvider}:${model.id}`;
              // 网页端只有一个可选项，模型名与它同义，拼成「服务商 · 模型」只是把同一句话说两遍，
              // 还会把菜单挤成三行；自定义服务商才需要 model 来区分候选。
              const optionLabel = currentProvider === DEEPSEEK_WEB_PROVIDER_ID
                ? providerName
                : `${providerName} · ${model.label || model.id}`;
              return `<button class="liquid-option ${selected ? "active" : ""}" data-action="model-option" data-value="${escapeAttribute(value)}" type="button" role="option" ${selected ? 'aria-selected="true"' : ""}><span class="liquid-option-label">${escapeHtml(optionLabel)}</span>${renderActiveIndicator(selected)}</button>`;
            })
            .join("")}
        </div>
      </details>
    `;
  }

  private renderThinkingLevelSelect(): string {
    const context = this.resolveHeaderModelContext();
    if (!context?.currentConfig) return "";
    const modelId = context.currentConfig.selectedModel;
    if (!modelId) return "";
    const currentModel = context.currentModels.find((model) => model.id === modelId);
    const options = thinkingOptionsForModel(context.currentProvider, modelId, currentModel?.thinkingLevels);
    if (options.length === 0) return "";
    const selectedValue = this.resolveThinkingLevel(context.currentProvider, modelId, options);
    const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
    if (!selectedOption) return "";

    const isWebProvider = context.currentProvider === DEEPSEEK_WEB_PROVIDER_ID;

    if (isWebProvider && options.length === 2) {
      const isOn = selectedValue !== options[0]?.value;
      return `
      <div class="thinking-toggle${isOn ? " thinking-toggle-on" : ""}" data-action="thinking-toggle" role="switch" aria-checked="${isOn}" aria-label="切换思考等级" tabindex="0">
        <span class="thinking-icon">${renderLucideIcon("sparkles")}</span>
        <span class="thinking-track">
          <span class="thinking-thumb"></span>
        </span>
        <span class="thinking-current">${escapeHtml(selectedOption.label)}</span>
      </div>`;
    }

    return `
      <details class="thinking-menu">
        <summary class="thinking-trigger" data-action="thinking-trigger">
          <span class="thinking-icon">${renderLucideIcon("sparkles")}</span>
          <span class="thinking-current">${escapeHtml(selectedOption.label)}</span>
          <span class="thinking-chevron">${renderLucideIcon("chevron-down")}</span>
        </summary>
        <div class="liquid-menu">
          ${options.map((option) => `
            <button class="liquid-option${option.value === selectedValue ? " active" : ""}" data-action="thinking-option" data-value="${escapeAttribute(option.value)}">
              <span class="liquid-option-label">${escapeHtml(option.label)}</span>
              ${option.value === selectedValue ? `<span class="liquid-option-active-indicator">${renderActiveIndicator(true)}</span>` : ""}
            </button>`).join("")}
        </div>
      </details>`;
  }

  private resolveThinkingLevel(providerId: ProviderId, modelId: string, options: ThinkingOption[]): ModelThinkingLevel {
    const key = modelThinkingKey(providerId, modelId);
    const saved = this.settings?.modelThinkingLevels?.[key];
    if (saved && options.some((option) => option.value === saved)) return saved;
    return defaultThinkingLevelForModel(modelId, options);
  }

  private renderError(): string {
    return `
      <div class="error-box">
        <strong>没能生成摘要</strong>
        <p>${escapeHtml(this.error)}</p>
        <div class="error-actions">
          <button data-action="generate" type="button">重试</button>
          <button class="error-secondary" data-action="settings" type="button">去设置</button>
          ${this.hasDiagnosticPackage() ? `<button class="error-secondary" data-action="open-diagnostic-modal" type="button">诊断信息</button>` : ""}
        </div>
      </div>
    `;
  }

  /**
   * 首次运行：还没选服务商时，正文区只留一张引导卡，不再叠「失败 + 空态」两张卡。
   * 两条路都通向能用的状态：已登录 DeepSeek 的人零配置即可用，其余人填服务地址。
   */
  private renderSetup(): string {
    return `
      <div class="setup-card">
        <h2 class="setup-title">先选一个模型服务</h2>
        <p class="setup-desc">摘要会把这一页的内容交给模型处理，模型服务决定用哪个模型。</p>
        <div class="setup-actions">
          <button class="setup-action setup-action-primary" data-action="setup-deepseek-web" type="button">
            <span class="setup-action-label">用 DeepSeek</span>
            <span class="setup-action-meta">浏览器已登录 DeepSeek 就能直接用，不用另外填密钥</span>
          </button>
          <button class="setup-action" data-action="setup-custom-provider" type="button">
            <span class="setup-action-label">用其它服务商</span>
            <span class="setup-action-meta">需要填服务地址和 API Key</span>
          </button>
        </div>
      </div>
    `;
  }

  private hasConfiguredProvider(): boolean {
    const providerId = this.settings?.defaultProvider ?? "";
    if (!providerId) return false;
    if (providerId === DEEPSEEK_WEB_PROVIDER_ID) return true;
    return Boolean(this.providers?.[providerId]);
  }

  private hasDiagnosticPackage(): boolean {
    const source = this.cache?.source;
    return Boolean(
      this.fullChain.lastDiagnostic ||
      this.cache?.summaryMeta?.timing ||
      (source && sourceDiagnosticsNeedAttention(source.extractionDiagnostics, source.sourceKind))
    );
  }

  private resolveModelSelectProviderId(providers: ProviderSettings): ProviderId {
    if (providers[this.settings?.defaultProvider ?? ""]) return this.settings?.defaultProvider ?? "";
    if (this.settings?.defaultProvider === DEEPSEEK_WEB_PROVIDER_ID) return DEEPSEEK_WEB_PROVIDER_ID;
    return "";
  }


  private renderSettingsPanel(): string {
    if (!this.settings || !this.providers) return "";
    const providers = sanitizePanelProviders(this.providers);
    const defaultProvider = this.settings.defaultProvider;
    const providerEntries = Object.entries(providers).filter(([providerId]) =>
      providerId !== DEEPSEEK_WEB_PROVIDER_ID
    );
    const activeProviderEntries = defaultProvider
      && defaultProvider !== DEEPSEEK_WEB_PROVIDER_ID
      && providers[defaultProvider]
      ? [[defaultProvider, providers[defaultProvider]] as [ProviderId, ProviderSettings[ProviderId]]]
      : [];

    return `
      <section class="panel-settings${this.settingsEntering ? " entering" : ""}${this.settingsExiting ? " exiting" : ""}" aria-label="设置">
        <div class="settings-head" data-drag-handle>
          <button class="settings-back" data-action="close-panel-settings" type="button">${renderLucideIcon("chevron-down")}返回</button>
          <button class="settings-save ${this.settingsSaveFeedback ? "success" : ""}" data-action="save-panel-settings" type="button">${this.settingsSaveFeedback ? "已保存" : "保存"}</button>
        </div>
        <section class="settings-group">
          <h2>通用</h2>
          <div class="settings-card">
            <div class="settings-row">
              <span>外观</span>
              ${renderSettingsSelect("themeMode", this.settings.themeMode, [
                { value: "auto", label: "自动" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" }
              ])}
            </div>
            ${renderPanelSwitch("autoSummarize", "打开时自动生成", this.settings.autoSummarize ?? true)}
          </div>
        </section>

        <section class="settings-group settings-group-provider">
          <h2>AI 服务</h2>
          <div class="settings-card">
            <div class="settings-row">
              <span>默认服务商</span>
              ${renderSettingsSelect("defaultProvider", this.settings.defaultProvider, [
                { value: DEEPSEEK_WEB_PROVIDER_ID, label: DEEPSEEK_WEB_PROVIDER_LABEL },
                ...providerEntries.map(([providerId, config]) => ({
                  value: providerId,
                  label: config.name || providerId
                })),
                { value: "__add_custom_provider__", label: "添加服务商" }
              ], undefined, "settings-provider-control")}
            </div>
          </div>
          ${defaultProvider === DEEPSEEK_WEB_PROVIDER_ID ? this.renderWebProvidersSettingsGroup() : ""}
          <div class="custom-provider-list">
            ${activeProviderEntries.map(([providerId, config]) => this.renderCustomProviderGroup(providerId, config)).join("")}
          </div>
        </section>

        <section class="settings-group">
          <h2>摘要</h2>
          <div class="settings-card">
            <div class="settings-row">
              <span>摘要详细程度</span>
              ${renderSettingsSelect("summaryOutputCompressionMode", this.settings.summaryOutputCompressionMode ?? "off", [
                { value: "off", label: "完整" },
                { value: "lite", label: "标准" },
                { value: "full", label: "精简" },
                { value: "ultra", label: "极简" }
              ])}
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h2>字幕</h2>
          <div class="settings-card">
            <div class="settings-row">
              <span>翻译为</span>
              ${renderSettingsSelect("subtitleTranslationTarget", this.settings.subtitleTranslationTarget ?? "zh-Hans", [
                { value: "zh-Hans", label: "简体中文" },
                { value: "en", label: "英语" }
              ])}
            </div>
          </div>
        </section>

        <section class="settings-group settings-group-shortcut">
          <h2>快捷键</h2>
          <div class="settings-card">
            <div class="settings-row shortcut-row">
              <span>快捷键</span>
              <div class="shortcut-controls">
                <input class="shortcut-display" readonly data-panel-command-shortcut="_execute_action" value="${escapeAttribute(this.commandShortcuts["_execute_action"] || "未设置")}" aria-label="快捷键" />
                <button class="icon-mini shortcut-link" data-action="open-extension-shortcuts" type="button" aria-label="打开浏览器快捷键设置">${renderLucideIcon("external-link")}</button>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h2>数据</h2>
          <div class="settings-card">
            <label class="settings-row">
              <span>保留页数</span>
              <input type="number" min="1" max="500" step="1" data-panel-setting="pageCacheLimit" value="${this.settings.pageCacheLimit ?? 100}" />
            </label>
            <div class="settings-row">
              <span>这一页的摘要</span>
              <button class="settings-pill-action ${this.settingsDataFeedback === "current-cache" ? "success" : ""}" data-action="clear-current-page-cache" type="button">${this.settingsDataFeedback === "current-cache" ? "已清除" : "清除"}</button>
            </div>
            <div class="settings-row">
              <span>全部摘要与正文</span>
              <button class="settings-pill-action ${this.settingsDataFeedback === "all-cache" ? "success" : ""}${this.pendingConfirmAction === "clear-summary-cache" ? " confirming" : ""}" data-action="clear-summary-cache" type="button">${this.settingsDataFeedback === "all-cache" ? "已清除" : this.pendingConfirmAction === "clear-summary-cache" ? "确认清除" : "清除"}</button>
            </div>
          </div>
        </section>
      </section>
    `;
  }

  private renderCustomProviderGroup(providerId: ProviderId, config: ProviderSettings[ProviderId]): string {
    const keyVisible = this.visibleProviderKeys.has(providerId);
    const openAttribute = this.collapsedProviderGroups.has(providerId) ? "" : " open";
    const candidateOpenAttribute = this.providerModelMenu.pickerOpenProviderId === providerId ? ' data-provider-model-candidates-open="true"' : "";
    const visibleModels = panelVisibleModels(config);
    const modelListHeight = providerModelListHeight(visibleModels.length);
    return `
      <details class="custom-provider-group" data-custom-provider="${escapeAttribute(providerId)}"${candidateOpenAttribute}${openAttribute}>
        <summary class="custom-provider-summary">
          <span class="custom-provider-title">${escapeHtml(config.name || "服务商")}</span>
          <span class="custom-provider-actions">
            <button class="icon-mini" data-action="save-custom-provider" data-provider="${escapeAttribute(providerId)}" type="button" aria-label="保存服务商">${renderLucideIcon("save")}</button>
            <button class="icon-mini danger" data-action="delete-custom-provider" data-provider="${escapeAttribute(providerId)}" type="button" aria-label="删除服务商">${renderLucideIcon("trash-2")}</button>
            <span class="custom-provider-chevron">${renderLucideIcon("chevron-down")}</span>
          </span>
        </summary>
        <div class="settings-card custom-provider-card">
          <label class="settings-row">
            <span>名称</span>
            <input data-panel-provider-field="${escapeAttribute(providerId)}.name" value="${escapeAttribute(config.name || "")}" placeholder="例如：DeepSeek" />
          </label>
          <label class="settings-row">
            <span>服务地址</span>
            <input data-panel-provider-field="${escapeAttribute(providerId)}.baseUrl" value="${escapeAttribute(config.baseUrl ?? "")}" placeholder="https://api.example.com/v1" />
          </label>
          <label class="settings-row">
            <span>API Key</span>
            <span class="provider-key-control">
              <input type="${keyVisible ? "text" : "password"}" autocomplete="off" data-panel-provider-field="${escapeAttribute(providerId)}.apiKey" value="${escapeAttribute(config.apiKey)}" placeholder="粘贴服务商提供的 Key" />
              <button class="icon-mini" data-action="toggle-provider-key" data-provider="${escapeAttribute(providerId)}" type="button" aria-label="${keyVisible ? "隐藏 API Key" : "显示 API Key"}">${renderLucideIcon(keyVisible ? "eye-off" : "eye")}</button>
            </span>
          </label>
          <div class="provider-model-config">
            <div class="provider-model-head">
              <span>可用模型</span>
              ${this.providerModelMenu.renderFetchButton(providerId)}
              <button class="icon-mini" data-action="add-provider-model" data-provider="${escapeAttribute(providerId)}" type="button" aria-label="添加模型">${renderLucideIcon("plus")}</button>
            </div>
            <div class="provider-model-list" style="--provider-model-list-height: ${modelListHeight}px;">
              ${visibleModels.map((model, index) => this.providerModelMenu.renderModelRow(providerId, model, index)).join("")}
            </div>
          </div>
        </div>
      </details>
    `;
  }

  private renderWebProvidersSettingsGroup(): string {
    return `
      <section class="settings-group settings-group-web">
        <h2>浏览器登录</h2>
        ${this.renderWebProviderSettingsCard(DEEPSEEK_WEB_PROVIDER_ID, DEEPSEEK_WEB_PROVIDER_LABEL, this.settings?.deepseekWebStatus ?? "unknown", "refresh-deepseek-web", "重新检查登录状态")}
      </section>
    `;
  }

  private renderWebProviderSettingsCard(
    providerId: ProviderId,
    label: string,
    status: Settings["deepseekWebStatus"],
    refreshAction: string,
    refreshAriaLabel: string
  ): string {
    const defaultModels = DEEPSEEK_WEB_MODELS;
    const stored = this.providers?.[providerId];
    const selectedModel = stored?.selectedModel || defaultModels[0]?.id || "";
    const models = stored?.models ?? defaultModels;
    return `
      <div class="settings-card settings-card-${escapeAttribute(providerId)}">
        <div class="settings-row ${escapeAttribute(providerId)}-status-row">
          <span>${escapeHtml(label)} · ${webProviderStatusLabel(status)}</span>
          <button class="icon-mini" data-action="${escapeAttribute(refreshAction)}" type="button" aria-label="${escapeAttribute(refreshAriaLabel)}">${renderLucideIcon("refresh-cw")}</button>
        </div>
        <div class="settings-row">
          <span>模型</span>
          ${renderSettingsSelect(`providerModel:${providerId}`, selectedModel, models.map((model) => ({
            value: model.id,
            label: model.label || model.id
          })), `data-panel-provider-model="${escapeAttribute(providerId)}"`)}
        </div>
      </div>
    `;
  }

  private renderActionRail(showSummaryActions = true, showSubtitleActions = false): string {
    const downloadLabel = showSubtitleActions ? "下载字幕" : "下载摘要";
    const copyLabel = showSubtitleActions ? "复制字幕" : "复制摘要";
    let actionIndex = 0;
    const dockIndexStyle = () => ` style="--dock-action-index: ${actionIndex++};"`;
    return `
      <div class="floating-action-dock" aria-label="浮窗操作">
        ${showSummaryActions ? `
          <button class="dock-action" data-action="copy-summary" type="button" aria-label="${copyLabel}"${dockIndexStyle()}>
            ${renderLucideIcon("copy")}
          </button>
        ` : ""}
        ${showSummaryActions || showSubtitleActions ? `
          <button class="dock-action" data-action="download-summary" type="button" aria-label="${downloadLabel}"${dockIndexStyle()}>
            ${renderLucideIcon("download")}
          </button>
        ` : ""}
        ${showSubtitleActions ? this.subtitleTransform.renderActions(actionIndex) : ""}
      </div>
    `;
  }



  private renderDiagnosticModal(): string {
    const text = this.diagnosticModalText;
    if (!text) return "";
    return `
      <div class="diagnostic-overlay" data-action="close-diagnostic-modal">
        <div class="diagnostic-modal">
          <div class="diagnostic-modal-header">
            <h3>诊断信息</h3>
            <button class="icon-button" data-action="close-diagnostic-modal" type="button" aria-label="关闭">${renderLucideIcon("x")}</button>
          </div>
          <pre class="diagnostic-modal-body">${escapeHtml(text)}</pre>
          <div class="diagnostic-modal-footer">
            <button class="icon-button" data-action="copy-diagnostic-modal" type="button">${renderLucideIcon("copy")}复制</button>
          </div>
        </div>
      </div>
    `;
  }

  private buildDiagnosticText(): string {
    return formatUserVisibleDiagnosticPackage({
      cache: this.cache,
      diagnostic: this.fullChain.lastDiagnostic,
      providerDiagnostics: buildPanelProviderDiagnostics(this.cache?.summaryMeta?.providerId, this.providers, this.settings)
    });
  }

  private async openDiagnosticModal(): Promise<void> {
    this.diagnosticModalOpen = true;
    this.diagnosticModalText = this.buildDiagnosticText();
    this.render();
  }

  private closeDiagnosticModal(): void {
    this.diagnosticModalOpen = false;
    this.diagnosticModalText = "";
    this.render();
  }

  private async copyDiagnosticModalText(): Promise<void> {
    const text = this.diagnosticModalText;
    if (!text) return;
    try {
      await writeClipboard(text);
      this.closeDiagnosticModal();
      this.renderToast("诊断信息已复制", "success");
    } catch {
      this.renderToast("复制失败", "error");
    }
  }


  private renderEmpty(): string {
    const meta = this.resolveEmptyCardMeta();
    const siteIcon = meta.siteIcon
      ? `<img class="empty-site-icon" src="${escapeAttribute(meta.siteIcon)}" alt="" />`
      : `<span class="empty-site-dot" aria-hidden="true"></span>`;
    // 抓不到封面时用固定插画顶替，形状照参考图那张「一张纸压着另一张」
    const coverPlaceholder = renderEmptyCoverArt();
    // 占位始终留在 DOM 里且默认隐藏：真封面加载失败时只需摘掉图片，占位立刻接管。
    // 已确认取不到的封面不再渲染 img，避免每次重渲都闪一次破图。
    const knownCover = meta.cover ? this.coverFallbackResults.get(meta.cover) : undefined;
    const coverSrc = knownCover ?? meta.cover;
    const coverContent = coverSrc && knownCover !== null
      ? `<img class="empty-cover-img" src="${escapeAttribute(coverSrc)}" alt="" draggable="false" /><span class="empty-cover-fallback" data-cover-fallback hidden>${coverPlaceholder}</span>`
      : `<span class="empty-cover-fallback" data-cover-fallback>${coverPlaceholder}</span>`;
    // 元信息拿不到时整条省略，不留占位符：宁缺，不写「未知」
    const metaRow = meta.charCount ? `<span class="empty-site-meta">${escapeHtml(meta.charCount)}</span>` : "";
    return `
      <div class="empty-stack">
        <div class="empty">
          <div class="empty-cover">
            ${coverContent}
          </div>
          <div class="empty-info">
            <div class="empty-site">
              ${siteIcon}
              <span class="empty-site-name">${escapeHtml(meta.siteName)}</span>
              ${metaRow}
            </div>
            <p class="empty-title">${escapeHtml(meta.title)}</p>
          </div>
          <button data-action="generate" type="button">生成摘要</button>
        </div>
      </div>
    `;
  }

  /* 空态卡只填真实拿得到的东西：站点名、站点图标、页面标题、已有缓存时的字数。
     没有缓存时连正文都没抽过，所以不为了这张卡去抽取一次正文。 */
  private resolveEmptyCardMeta(): {
    title: string;
    siteName: string;
    siteIcon?: string;
    cover?: string;
    charCount?: string;
    initial: string;
  } {
    const source = this.cache?.source;
    const pageMeta = readPageMeta(document, location.href);
    const hostname = (location.hostname || "").replace(/^www\./i, "");
    const siteName = source?.site?.trim() || pageMeta.site || hostname || "当前页面";
    const title = (source?.title || document.title || "").trim() || siteName;
    const siteIcon = source?.favicon?.trim() || pageMeta.favicon;
    const cover = source?.cover?.trim() || pageMeta.cover;
    const charCount = source?.text ? formatCharacterCount(source.text.length) : undefined;
    const initial = Array.from(siteName)[0] ?? "页";
    return { title, siteName, siteIcon, cover, charCount, initial };
  }

  /* 直接加载被站点策略拦掉时（error 事件），改从后台取字节转内联地址；
     仍失败就摘掉图片，让已渲染好的占位接管。同一地址只尝试一次，避免错误循环。 */
  private bindEmptyCoverFallback(): void {
    const img = this.root.querySelector<HTMLImageElement>(".empty-cover-img");
    if (!img) return;
    const url = img.getAttribute("src");
    // 内联地址不会再失败，不必再挂兜底
    if (!url || url.startsWith("data:")) return;
    img.addEventListener(
      "error",
      () => {
        void this.swapCoverToDataUrl(img, url);
      },
      { once: true }
    );
  }

  private async swapCoverToDataUrl(img: HTMLImageElement, url: string): Promise<void> {
    if (this.coverFallbackResults.has(url)) {
      const known = this.coverFallbackResults.get(url);
      if (known) img.src = known;
      else this.revealEmptyCoverPlaceholder(img);
      return;
    }
    const dataUrl = await resolveCoverDataUrl(url, fetchSourceBinary);
    this.coverFallbackResults.set(url, dataUrl ?? null);
    if (dataUrl) {
      img.src = dataUrl;
      return;
    }
    this.revealEmptyCoverPlaceholder(img);
  }

  private revealEmptyCoverPlaceholder(img: HTMLImageElement): void {
    const fallback = img.parentElement?.querySelector<HTMLElement>("[data-cover-fallback]");
    img.remove();
    if (fallback) fallback.hidden = false;
  }

  private renderSummaryView(summary: PageCache["summary"]): string {
    if (!summary) return "";
    return this.renderSummary(summary.overview, summary.sections);
  }

  private renderSummary(overview: string, sections: SummarySection[], footer = ""): string {
    return `
      <section class="summary">
        ${this.renderSummaryShell(overview, sections, footer)}
      </section>
    `;
  }

  private renderSummaryShell(overview: string, sections: SummarySection[], footer = ""): string {
    return `
      <div class="summary-shell">
        <div class="overview">
          <div class="overview-text">${escapeHtml(stripOverviewLabel(overview))}</div>
        </div>
        <div class="tree">
          ${sections.map((section, index) => this.renderSection(section, index)).join("")}
        </div>
        ${footer}
      </div>
    `;
  }

  private renderSection(section: SummarySection, index: number): string {
    return `
      <section class="tree-section section-${index % 4}" data-stream-section="${index}">
        <div class="node major"></div>
        <div class="tree-section-title">
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <ul>
          ${section.points.map((point, pointIndex) => this.renderPoint(point, 0, `${index}.${pointIndex}`)).join("")}
        </ul>
      </section>
    `;
  }

  private renderPoint(point: SummaryPoint, depth = 0, streamPath?: string): string {
    const timeline = depth >= 1 ? this.resolveSummaryPointTimeline(point.text) : undefined;
    const sourceText = timeline?.sourceText ?? point.text;
    const text = escapeHtml(sourceText);
    const streamAttribute = streamPath ? ` data-stream-point="${escapeAttribute(streamPath)}"` : "";
    const timestamp = timeline ? `<span class="summary-child-timestamp">[${escapeHtml(timeline.label)}]</span>` : "";
    const startAttribute = timeline ? ` data-source-jump-start="${timeline.start}"` : "";
    const jumpLabel = timeline ? `跳转到 ${timeline.label}` : "跳转到来源";
    const content = depth >= 1
      ? `<span class="summary-child-jump"><span class="summary-child-jump-text">${text}</span>${timestamp}<button class="summary-child-jump-button" data-source-jump="${escapeAttribute(sourceText)}"${startAttribute} type="button" aria-label="${escapeAttribute(jumpLabel)}">${renderLucideIcon("navigation")}</button></span>`
      : `<span>${text}</span>`;
    return `
      <li${streamAttribute}>
        <span class="node minor"></span>
        ${content}
        ${
          point.children?.length
            ? `<ul class="children">${point.children.map((child, childIndex) => this.renderPoint(child, depth + 1, streamPath ? `${streamPath}.${childIndex}` : undefined)).join("")}</ul>`
            : ""
        }
      </li>
    `;
  }

  private getTimelineMatcher(): TimelineMatcher | undefined {
    const source = this.cache?.source;
    if (!source?.segments?.length) return undefined;
    if (this.timelineMatcherSource !== source) {
      this.timelineMatcher = new TimelineMatcher(source.segments);
      this.timelineMatcherSource = source;
    }
    return this.timelineMatcher;
  }

  private resolveSummaryPointTimeline(text: string): { sourceText: string; start: number; label: string } | undefined {
    const source = this.cache?.source;
    if (!source || !isTranscriptSource(source.sourceKind)) return undefined;
    const matcher = this.getTimelineMatcher();
    if (!matcher) return undefined;
    const sourceText = stripTrailingSummaryTimestamp(text);
    const segment = matcher.match(sourceText);
    if (!segment || !Number.isFinite(segment.start) || segment.start < 0) return undefined;
    return { sourceText, start: segment.start, label: formatTimestamp(segment.start) };
  }

  private renderStreamPreview(): string {
    const previewSummary = this.summaryStream.previewSummary;
    if (previewSummary) {
      return this.renderSummary(previewSummary.overview, previewSummary.sections);
    }

    const previewDraft = this.summaryStream.previewDraft;
    if (previewDraft) {
      return this.renderStreamingSummary(previewDraft);
    }

    const previewOverview = this.summaryStream.previewOverview;
    if (previewOverview?.trim()) {
      return this.renderStreamingOverview(previewOverview);
    }

    if (this.summarySkeletonExpired) {
      return this.renderStreamingPending();
    }

    // Keep the summary scroll area stable while the stream is still incomplete.
    return `
      <section class="summary overview-loading-wrap">
        <div class="overview-loading">
          <div class="summary-skeleton" role="status" aria-label="正在生成摘要">
            <div class="summary-skeleton-flow summary-skeleton-surface">
              <div class="summary-skeleton-overview">
                <span class="summary-skeleton-line title"></span>
                <span class="summary-skeleton-line wide"></span>
                <span class="summary-skeleton-line medium"></span>
                <span class="summary-skeleton-line compact"></span>
              </div>
              <div class="summary-skeleton-outline">
                <div class="summary-skeleton-section">
                  <span class="summary-skeleton-section-heading"></span>
                  <span class="summary-skeleton-row"><span class="summary-skeleton-line wide"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line medium"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line short"></span></span>
                </div>
                <div class="summary-skeleton-section">
                  <span class="summary-skeleton-section-heading"></span>
                  <span class="summary-skeleton-row"><span class="summary-skeleton-line wide"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line short"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line medium"></span></span>
                </div>
                <div class="summary-skeleton-section">
                  <span class="summary-skeleton-section-heading"></span>
                  <span class="summary-skeleton-row"><span class="summary-skeleton-line medium"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line wide"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line short"></span></span>
                  <span class="summary-skeleton-row inset"><span class="summary-skeleton-line medium"></span></span>
                </div>
              </div>
              <div class="summary-skeleton-bottom-fade" aria-hidden="true"></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private renderStreamingOverview(overview: string): string {
    return `
      <section class="summary summary-stream-overview">
        <div class="overview">
          <div class="overview-text">${escapeHtml(stripOverviewLabel(overview))}</div>
        </div>
        <div class="summary-tree-loading">${renderStreamingSparkle()}</div>
      </section>
    `;
  }

  private renderStreamingPending(): string {
    return `
      <section class="summary summary-stream-overview summary-stream-pending" role="status" aria-label="正在生成摘要">
        <div class="overview">
          <div class="overview-text">${renderStreamingSparkle()}</div>
        </div>
      </section>
    `;
  }

  private streamingOverviewDisplay(overview: string): string {
    const stripped = stripOverviewLabel(overview);
    return stripped.trim() || "正在生成概览…";
  }

  private renderStreamingSummary(summary: SummaryResult): string {
    return this.renderSummary(
      this.streamingOverviewDisplay(summary.overview),
      this.streamableSections(summary.sections),
      `<div class="summary-tree-loading">${renderStreamingSparkle()}</div>`
    );
  }

  private seekToVideo(start: number): void {
    const video = document.querySelector("video");
    if (!video) return;
    try {
      video.currentTime = start;
      this.syncActiveSubtitleToVideo({ forceScroll: true });
    } catch {
      // Silently fail if currentTime assignment throws
    }
  }

  private locateCurrentSubtitle(): void {
    this.syncActiveSubtitleToVideo({ forceScroll: true });
    this.flashActionSuccess("locate-subtitle");
  }

  private jumpToSource(text: string, matchedStart?: number): void {
    if (!text.trim()) return;
    const segment = matchedStart === undefined ? this.getTimelineMatcher()?.match(text) : undefined;
    const start = matchedStart ?? segment?.start;
    const video = document.querySelector("video");
    if (start !== undefined && video) {
      try {
        video.currentTime = start;
        this.syncActiveSubtitleToVideo({ forceScroll: true });
        return;
      } catch {
        // Continue to page-text fallback.
      }
    }
    scrollPageTextIntoView(text);
  }


  private bindEvents(): void {
    const closeBtn = this.root.querySelector<HTMLElement>("[data-action='close']");
    if (closeBtn) attachButtonWithInstantFeedback(closeBtn, () => this.close());

    this.root.querySelectorAll<HTMLElement>("[data-action='refresh']").forEach((button) => {
      attachButtonWithInstantFeedback(button, () => {
        this.startTopActionFeedback("refresh", button);
        void this.regenerateSummaryWithoutClearing();
      });
    });

    const generateBtn = this.root.querySelector<HTMLElement>("[data-action='generate']");
    if (generateBtn) attachButtonWithInstantFeedback(generateBtn, () => void this.generateSummary());

    const copySummaryBtn = this.root.querySelector<HTMLElement>("[data-action='copy-summary']");
    if (copySummaryBtn) attachButtonWithInstantFeedback(copySummaryBtn, () => void this.copySummary());

    const downloadBtn = this.root.querySelector<HTMLElement>("[data-action='download-summary']");
    if (downloadBtn) attachButtonWithInstantFeedback(downloadBtn, () => this.downloadSummary());

    const openTranslationBtn = this.root.querySelector<HTMLElement>("[data-action='open-translation-targets']");
    if (openTranslationBtn) {
      attachButtonWithInstantFeedback(openTranslationBtn, () => {
        if (!this.subtitleTransform.translation) return;
        const scrollTop = this.root.querySelector<HTMLElement>(".subtitle-view")?.scrollTop ?? this.lastSubtitleScrollTop;
        this.subtitleTransform.reset();
        this.renderContentPreservingScroll(scrollTop);
      });
    }

    this.root.querySelectorAll<HTMLElement>("[data-action='translate-subtitles']").forEach((button) => {
      attachButtonWithInstantFeedback(button, () => {
        if (button.hasAttribute("disabled")) return;
        void this.subtitleTransform.translate();
      });
    });

    const locateBtn = this.root.querySelector<HTMLElement>("[data-action='locate-subtitle']");
    if (locateBtn) attachButtonWithInstantFeedback(locateBtn, () => this.locateCurrentSubtitle());

    const closeSettingsBtn = this.root.querySelector<HTMLElement>("[data-action='close-panel-settings']");
    if (closeSettingsBtn) attachButtonWithInstantFeedback(closeSettingsBtn, () => this.closeSettingsPanel());

    const saveSettingsBtn = this.root.querySelector<HTMLElement>("[data-action='save-panel-settings']");
    if (saveSettingsBtn) attachButtonWithInstantFeedback(saveSettingsBtn, () => void this.savePanelSettings());

    const clearPageBtn = this.root.querySelector<HTMLElement>("[data-action='clear-current-page-cache']");
    if (clearPageBtn) attachButtonWithInstantFeedback(clearPageBtn, () => void this.clearCurrentPageCache());

    const clearSummaryBtn = this.root.querySelector<HTMLElement>("[data-action='clear-summary-cache']");
    if (clearSummaryBtn) attachButtonWithInstantFeedback(clearSummaryBtn, () => void this.clearSummaryCache());

    const shortcutsBtn = this.root.querySelector<HTMLElement>("[data-action='open-extension-shortcuts']");
    if (shortcutsBtn) attachButtonWithInstantFeedback(shortcutsBtn, () => void this.openExtensionShortcuts());

    const refreshDeepSeekBtn = this.root.querySelector<HTMLElement>("[data-action='refresh-deepseek-web']");
    if (refreshDeepSeekBtn) attachButtonWithInstantFeedback(refreshDeepSeekBtn, () => void this.probeDeepSeekWebFromSettings(true));

    this.root.querySelector("[data-action='view-summary']")?.addEventListener("click", () => {
      if (this.activeView === "summary") return;
      this.rememberActiveContentScroll();
      this.activeView = "summary";
      this.contentViewEntering = true;
      this.render();
    });
    this.root.querySelector("[data-action='view-subtitle']")?.addEventListener("click", () => {
      if (this.activeView === "subtitle") return;
      this.rememberActiveContentScroll();
      this.activeView = "subtitle";
      this.contentViewEntering = true;
      this.lastSubtitleManualScrollAt = Date.now();
      this.renderContentPreservingScroll(this.lastSubtitleScrollTop);
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='model-option']").forEach((button) => {
      button.addEventListener("click", () => {
        void this.switchModel(button.dataset.value ?? "");
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='thinking-toggle']").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        void this.toggleThinkingLevel();
      });
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.toggleThinkingLevel();
        }
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='thinking-option']").forEach((button) => {
      button.addEventListener("click", () => {
        void this.switchThinkingLevel(button.dataset.value ?? "");
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='settings']").forEach((button) => {
      button.addEventListener("click", () => {
        this.openSettingsPanel();
      });
    });
    this.root.querySelector("[data-drag-handle]")?.addEventListener("pointerdown", (event) => this.startDrag(event));

    this.bindRootDelegatedEvents();

    const scrollContainer = this.root.querySelector<HTMLElement>(".panel-settings, .summary, .subtitle-view");
    scrollContainer?.addEventListener("scroll", () => this.handleSummaryScroll(scrollContainer));
    scrollContainer?.addEventListener("wheel", (event) => this.containSummaryWheel(event), { passive: false });
    this.root.querySelectorAll<HTMLElement>(".settings-select-menu").forEach((menu) => {
      menu.addEventListener("click", (event) => {
        if (event.target !== menu) return;
        event.preventDefault();
        event.stopPropagation();
      });
    });
    this.root.querySelectorAll<HTMLDetailsElement>(".custom-provider-group").forEach((group) => {
      group.addEventListener("toggle", () => {
        if (!group.open || prefersReducedMotion()) return;
        group.setAttribute("data-provider-revealing", "true");
        clearMotionAttribute(group, "data-provider-revealing", 160);
      });
    });
    if (scrollContainer) this.updateScrollFadeState(scrollContainer);
    this.ensureSubtitlePlaybackTracking();

    this.bindDocumentResizeEvents();
    this.bindShortcutRefreshEvents();
  }

  private bindDocumentResizeEvents(): void {
    if (this.documentResizeEventsBound) return;
    this.documentResizeEventsBound = true;

    // Resize support on document because shadow children can cover host edges.
    document.addEventListener("pointermove", (e) => {
      if (this.element.getAttribute("data-open") === "true") {
        this.updateResizeCursor(e);
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.element.getAttribute("data-open") === "true") {
        this.startResize(e);
      }
    });
  }

  private bindShortcutRefreshEvents(): void {
    if (this.shortcutRefreshEventsBound) return;
    this.shortcutRefreshEventsBound = true;
    window.addEventListener("focus", () => {
      void this.refreshCommandShortcutsInSettings();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.refreshCommandShortcutsInSettings();
      }
    });
  }

  private bindRootDelegatedEvents(): void {
    if (this.rootDelegatedEventsBound) return;
    this.rootDelegatedEventsBound = true;


    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const eventOrigin = event.composedPath()[0];
      const originElement = eventOrigin instanceof Element ? eventOrigin : target;
      const openModelMenu = this.root.querySelector<HTMLDetailsElement>(".model-menu[open]");
      const clickedModelMenu = target.closest(".model-menu");
      if (openModelMenu && clickedModelMenu && target.closest(".model-trigger")) {
        event.preventDefault();
        this.closeModelMenu(openModelMenu);
        return;
      }
      if (openModelMenu && !clickedModelMenu) {
        this.closeModelMenu(openModelMenu);
      }

      const openThinkingMenu = this.root.querySelector<HTMLDetailsElement>(".thinking-menu[open]");
      const clickedThinkingMenu = target.closest(".thinking-menu");
      if (openThinkingMenu && clickedThinkingMenu && target.closest(".thinking-trigger")) {
        event.preventDefault();
        this.closeThinkingMenu(openThinkingMenu);
        return;
      }
      if (openThinkingMenu && !clickedThinkingMenu) {
        this.closeThinkingMenu(openThinkingMenu);
      }

      const clickedSettingsSelect = target.closest(".settings-select") as HTMLDetailsElement | null;
      if (clickedSettingsSelect) {
        this.closeSettingsSelects(clickedSettingsSelect);
        this.closeSettingsSelects(clickedSettingsSelect);
        // 检测菜单是否靠近底部，向上展开避免被 overflow 裁切
        if (!clickedSettingsSelect.open) {
          requestAnimationFrame(() => this.updateSelectDirection(clickedSettingsSelect));
        }
      } else {
        this.closeSettingsSelects();
      }

      if (originElement.classList.contains("settings-select-menu")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        this.providerModelMenu.pickerOpenProviderId &&
        !target.closest(".provider-model-candidates") &&
        !target.closest("[data-action='fetch-provider-models']") &&
        !target.closest("[data-action='delete-provider-model']")
      ) {
        this.providerModelMenu.closeCandidates();
      }

      const panelSelectOption = originElement.closest("[data-action='panel-select-option']") as HTMLElement | null;
      if (panelSelectOption?.dataset.settingKey && panelSelectOption.dataset.value) {
        this.selectPanelOption(panelSelectOption.dataset.settingKey, panelSelectOption.dataset.value, panelSelectOption.textContent?.trim() || panelSelectOption.dataset.value);
        return;
      }

      const addProviderModel = target.closest("[data-action='add-provider-model']") as HTMLElement | null;
      if (addProviderModel?.dataset.provider) {
        this.providerModelMenu.addModel(addProviderModel.dataset.provider);
        return;
      }

      const deleteProviderModel = target.closest("[data-action='delete-provider-model']") as HTMLElement | null;
      if (deleteProviderModel?.dataset.provider && deleteProviderModel.dataset.index) {
        event.preventDefault();
        event.stopPropagation();
        this.providerModelMenu.deleteModel(deleteProviderModel.dataset.provider, Number(deleteProviderModel.dataset.index));
        return;
      }

      const toggleProviderKey = target.closest("[data-action='toggle-provider-key']") as HTMLElement | null;
      if (toggleProviderKey?.dataset.provider) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleProviderKey(toggleProviderKey.dataset.provider);
        return;
      }

      const fetchProviderModels = target.closest("[data-action='fetch-provider-models']") as HTMLElement | null;
      if (fetchProviderModels?.dataset.provider) {
        event.preventDefault();
        event.stopPropagation();
        this.providerModelMenu.onFetchClick(fetchProviderModels, fetchProviderModels.dataset.provider);
        return;
      }

      const addFetchedProviderModel = target.closest("[data-action='add-fetched-provider-model']") as HTMLElement | null;
      if (addFetchedProviderModel?.dataset.provider && addFetchedProviderModel.dataset.modelId) {
        event.preventDefault();
        event.stopPropagation();
        this.providerModelMenu.addFetched(addFetchedProviderModel.dataset.provider, addFetchedProviderModel.dataset.modelId);
        return;
      }

      const saveCustomProvider = target.closest("[data-action='save-custom-provider']") as HTMLElement | null;
      if (saveCustomProvider?.dataset.provider) {
        event.preventDefault();
        event.stopPropagation();
        void this.saveCustomProvider(saveCustomProvider.dataset.provider);
        return;
      }

      const deleteCustomProvider = target.closest("[data-action='delete-custom-provider']") as HTMLElement | null;
      if (deleteCustomProvider?.dataset.provider) {
        event.preventDefault();
        event.stopPropagation();
        void this.deleteCustomProvider(deleteCustomProvider.dataset.provider);
        return;
      }

      const showSourceText = target.closest("[data-action='show-source-text']") as HTMLElement | null;
      if (showSourceText) {
        this.sourceTextViewOpen = true;
        this.sourceTextViewEntering = true;
        this.render();
        const sourceTextView = this.root.querySelector<HTMLElement>(".source-text-view");
        if (sourceTextView) sourceTextView.scrollTop = 0;
        setTimeout(() => {
          this.sourceTextViewEntering = false;
        }, SOURCE_TEXT_VIEW_ENTER_MS);
        return;
      }

      const refreshSource = target.closest("[data-action='refresh-source']") as HTMLElement | null;
      if (refreshSource) {
        void this.refreshSource();
        return;
      }

      const copySourceText = target.closest("[data-action='copy-source-text']") as HTMLElement | null;
      if (copySourceText) {
        void this.copySourceText();
        return;
      }

      const downloadSourceText = target.closest("[data-action='download-source-text']") as HTMLElement | null;
      if (downloadSourceText) {
        this.downloadSourceText();
        return;
      }

      const closeSourceTextView = target.closest("[data-action='close-source-text-view']") as HTMLElement | null;
      if (closeSourceTextView) {
        const wrapper = this.root.querySelector<HTMLElement>(".source-text-view-wrapper");
        if (wrapper) {
          wrapper.classList.add("exiting");
          setTimeout(() => {
            this.sourceTextViewOpen = false;
            this.render();
          }, SOURCE_TEXT_VIEW_EXIT_MS);
        } else {
          this.sourceTextViewOpen = false;
          this.render();
        }
        return;
      }

      const openDiagnosticModal = target.closest("[data-action='open-diagnostic-modal']") as HTMLElement | null;
      if (openDiagnosticModal) {
        void this.openDiagnosticModal();
        return;
      }
      const closeDiagnosticModal = target.closest("[data-action='close-diagnostic-modal']") as HTMLElement | null;
      if (closeDiagnosticModal) {
        const clickedInsideModal = target.closest(".diagnostic-modal") as HTMLElement | null;
        // 点击 overlay 空白区（不在 modal 内）→ 关闭；点击关闭按钮本身 → 关闭
        if (!clickedInsideModal || closeDiagnosticModal.matches("button")) {
          this.closeDiagnosticModal();
          return;
        }
      }

      const copyDiagnosticModal = target.closest("[data-action='copy-diagnostic-modal']") as HTMLElement | null;
      if (copyDiagnosticModal) {
        void this.copyDiagnosticModalText();
        return;
      }

      const setupDeepSeekWeb = target.closest("[data-action='setup-deepseek-web']") as HTMLElement | null;
      if (setupDeepSeekWeb) {
        void this.chooseDeepSeekWebAsProvider();
        return;
      }

      const setupCustomProvider = target.closest("[data-action='setup-custom-provider']") as HTMLElement | null;
      if (setupCustomProvider) {
        this.addCustomProvider();
        this.openSettingsPanel();
        return;
      }

      const sourceJump = target.closest("[data-source-jump]") as HTMLElement | null;
      if (sourceJump?.dataset.sourceJump) {
        const rawStart = sourceJump.dataset.sourceJumpStart;
        const parsedStart = rawStart === undefined ? Number.NaN : Number(rawStart);
        const start = Number.isFinite(parsedStart) && parsedStart >= 0 ? parsedStart : undefined;
        this.jumpToSource(sourceJump.dataset.sourceJump, start);
        return;
      }

      // Subtitle seek delegation lives on the persistent root because subtitle rows are conditionally rendered.
      const item = target.closest("[data-seek]") as HTMLElement;
      if (item?.dataset.seek) {
        this.seekToVideo(Number(item.dataset.seek));
      }
    });


    this.root.addEventListener("toggle", (event) => {
      const group = event.target as HTMLDetailsElement;
      if (!group.matches?.(".custom-provider-group")) return;
      const providerId = group.dataset.customProvider;
      if (!providerId) return;
      if (group.open) {
        this.collapsedProviderGroups.delete(providerId);
      } else {
        this.collapsedProviderGroups.add(providerId);
      }
    }, true);

    this.root.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      if (!target.closest(".panel-settings")) return;
      if (!target.matches("input")) return;
      void this.savePanelSettings({ feedback: false, render: false });
    });

    this.root.addEventListener("input", (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".panel-settings")) return;
      if (!target.matches("input")) return;
      const input = target as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "hidden") return;
      void this.savePanelSettings({ feedback: false, render: false });
    });
  }

  private closeModelMenu(menu = this.root.querySelector<HTMLDetailsElement>(".model-menu[open]")): void {
    if (!menu || !menu.hasAttribute("open") || menu.classList.contains("closing")) return;
    menu.classList.add("closing");
    window.setTimeout(() => {
      menu.removeAttribute("open");
      menu.classList.remove("closing");
    }, 160);
  }

  private closeThinkingMenu(menu = this.root.querySelector<HTMLDetailsElement>(".thinking-menu[open]")): void {
    if (!menu || !menu.hasAttribute("open") || menu.classList.contains("closing")) return;
    menu.classList.add("closing");
    window.setTimeout(() => {
      menu.removeAttribute("open");
      menu.classList.remove("closing");
    }, 160);
  }


  private closeSettingsSelects(except?: HTMLDetailsElement): void {
    this.root.querySelectorAll<HTMLDetailsElement>(".settings-select[open]").forEach((select) => {
      if (select !== except) this.closeSettingsSelect(select);
    });
  }

  private updateSelectDirection(select: HTMLDetailsElement): void {
    if (!select.open) return;
    const rect = select.getBoundingClientRect();
    const menu = select.querySelector(".settings-select-menu");
    if (!menu) return;
    const menuHeight = menu.scrollHeight || 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    select.classList.toggle("settings-select-up", spaceBelow < menuHeight + 12 && rect.top > menuHeight + 12);
  }

  private closeSettingsSelect(select: HTMLDetailsElement): void {
    if (!select.hasAttribute("open") || select.classList.contains("closing")) return;
    if (prefersReducedMotion()) {
      select.removeAttribute("open");
      select.classList.remove("closing");
      return;
    }
    select.classList.add("closing");
    window.setTimeout(() => {
      select.removeAttribute("open");
      select.classList.remove("closing");
    }, LIQUID_MENU_CLOSE_MS);
  }

  private closeSettingsPanel(): void {
    this.providerModelMenu.closeCandidates();
    if (this.settingsExitTimer !== undefined) {
      window.clearTimeout(this.settingsExitTimer);
      this.settingsExitTimer = undefined;
    }
    if (prefersReducedMotion()) {
      this.settingsExiting = false;
      this.panelView = "content";
      this.render();
      return;
    }
    const settingsPanel = this.root.querySelector<HTMLElement>(".panel-settings");
    if (!settingsPanel) {
      this.settingsExiting = false;
      this.panelView = "content";
      this.render();
      return;
    }
    this.settingsEntering = false;
    this.settingsExiting = true;
    settingsPanel.classList.remove("entering");
    settingsPanel.classList.add("exiting");
    this.settingsExitTimer = window.setTimeout(() => {
      this.settingsExiting = false;
      this.panelView = "content";
      this.settingsExitTimer = undefined;
      this.render();
    }, SETTINGS_EXIT_MS);
  }

  private async probeDeepSeekWebFromSettings(force = false): Promise<void> {
    if (!this.settings || (!force && this.settings.deepseekWebStatus === "available") || this.deepseekWebProbeInFlight) return;
    this.deepseekWebProbeInFlight = true;
    try {
      const result = await probeDeepSeekWeb();
      if (!result || typeof result.status !== "string" || typeof result.checkedAt !== "number") return;
      if (!this.settings) return;
      this.settings = {
        ...this.settings,
        deepseekWebStatus: result.status,
        deepseekWebLastCheckedAt: result.checkedAt,
        ...(result.ok && result.models?.length ? { deepseekWebModels: result.models } : {})
      };
      // Refresh providers so the model dropdown picks up dynamic models from storage
      try {
        this.providers = await getProviders();
      } catch {
        // ignore — providers will refresh on next render
      }
    } catch {
      return;
    } finally {
      this.deepseekWebProbeInFlight = false;
    }
    if (this.panelView === "settings") this.renderSettingsInPlace();
  }

  private selectPanelOption(key: string, value: string, label: string): void {
    if (key === "defaultProvider" && value === "__add_custom_provider__") {
      this.addCustomProvider();
      return;
    }
    const details = Array.from(this.root.querySelectorAll<HTMLDetailsElement>(".settings-select")).find((item) => item.dataset.panelSelect === key);
    const input = details?.querySelector<HTMLInputElement>("input[type='hidden']");
    const triggerLabel = details?.querySelector<HTMLElement>(".settings-select-label");
    if (input) input.value = value;
    if (triggerLabel) triggerLabel.textContent = label;
    if (details) {
      const options = details.querySelectorAll<HTMLElement>("[data-action='panel-select-option']");
      options.forEach((opt) => {
        const isActive = opt.dataset.value === value;
        opt.classList.toggle("active", isActive);
        const indicator = opt.querySelector<HTMLElement>(".liquid-option-active-indicator");
        if (isActive && !indicator) opt.insertAdjacentHTML("beforeend", renderActiveIndicator(true));
        else if (!isActive && indicator) indicator.remove();
      });
    }
    if (details) this.closeSettingsSelect(details);
    if (key === "defaultProvider" && isProviderId(value) && this.settings) {
      const scrollTop = this.root.querySelector<HTMLElement>(".panel-settings")?.scrollTop ?? 0;
      this.settings = { ...this.settings, defaultProvider: value };
      this.renderSettingsInPlace(scrollTop);
      void this.savePanelSettings({ feedback: false, render: false });
      return;
    }
    void this.savePanelSettings({ feedback: false, render: false });
  }

  private addCustomProvider(): void {
    if (!this.settings || !this.providers) return;
    const providers = sanitizePanelProviders(this.providers);
    const draft = addCustomProviderDraft(providers);
    const providerId = draft.providerId;
    this.providers = draft.providers;
    this.settings = { ...this.settings, defaultProvider: providerId };
    this.collapsedProviderGroups.delete(providerId);
    this.providerModelMenu.menu = undefined;
    this.renderSettingsInPlace();
    void this.savePanelSettings({ feedback: false, render: false });
  }

  /** 引导卡第一条路：把 DeepSeek 网页版设为默认服务商，立刻回到正文并生成。 */
  private async chooseDeepSeekWebAsProvider(): Promise<void> {
    if (!this.settings || !this.providers) return;
    this.settings = { ...this.settings, defaultProvider: DEEPSEEK_WEB_PROVIDER_ID };
    this.providers = {
      ...this.providers,
      [DEEPSEEK_WEB_PROVIDER_ID]: createDeepSeekWebProviderConfig(
        this.providers[DEEPSEEK_WEB_PROVIDER_ID]?.selectedModel ?? DEEPSEEK_WEB_MODELS[0]?.id ?? "",
        this.settings.deepseekWebModels
      )
    };
    await saveSettings(this.settings);
    await saveProviders(this.providers);
    this.panelView = "content";
    this.render();
    await this.generateSummary();
  }

  private toggleProviderKey(providerId: string): void {
    if (!this.providers?.[providerId]) return;
    this.providers = this.readPanelProviders(sanitizePanelProviders(this.providers));
    if (this.visibleProviderKeys.has(providerId)) {
      this.visibleProviderKeys.delete(providerId);
    } else {
      this.visibleProviderKeys.add(providerId);
    }
    this.updateProviderKeyVisibility(providerId);
  }

  private updateProviderKeyVisibility(providerId: string): void {
    const visible = this.visibleProviderKeys.has(providerId);
    const input = this.root.querySelector<HTMLInputElement>(`[data-panel-provider-field="${cssEscape(providerId)}.apiKey"]`);
    const button = this.root.querySelector<HTMLButtonElement>(`[data-action='toggle-provider-key'][data-provider="${cssEscape(providerId)}"]`);
    if (input) input.type = visible ? "text" : "password";
    if (!button) return;
    button.setAttribute("aria-label", visible ? "隐藏 API Key" : "显示 API Key");
    setTrustedInnerHTML(button, renderLucideIcon(visible ? "eye-off" : "eye"));
  }

  private async saveCustomProvider(providerId: string): Promise<void> {
    if (!this.settings || !this.providers?.[providerId]) return;
    const scrollTop = this.root.querySelector<HTMLElement>(".panel-settings")?.scrollTop ?? 0;
    const nextProviders = this.readPanelProviders(sanitizePanelProviders(this.providers));
    const nextSettings = settingsWithValidDefaultProvider(this.settings, nextProviders);

    this.providers = nextProviders;
    this.settings = nextSettings;
    this.renderSettingsInPlace(scrollTop);
    await saveSettings(nextSettings);
    await saveProviders(nextProviders);
  }

  private async deleteCustomProvider(providerId: string): Promise<void> {
    if (!this.settings || !this.providers?.[providerId]) return;
    const scrollTop = this.root.querySelector<HTMLElement>(".panel-settings")?.scrollTop ?? 0;
    const nextProviders = this.readPanelProviders(sanitizePanelProviders(this.providers));
    delete nextProviders[providerId];
    const nextSettings = { ...this.settings, defaultProvider: DEEPSEEK_WEB_PROVIDER_ID };

    this.providerModelMenu.menu = undefined;
    this.providerModelMenu.pickerOpenProviderId = undefined;
    this.providers = nextProviders;
    this.settings = nextSettings;
    this.renderSettingsInPlace(scrollTop);
    await saveSettings(nextSettings);
    await saveProviders(nextProviders);
  }

  private resetSummaryScroll(): void {
    const scrollContainer = this.root.querySelector<HTMLElement>(".summary, .subtitle-view");
    if (scrollContainer) scrollContainer.scrollTop = 0;
    this.lastSummaryScrollTop = 0;
    this.setSummaryChromeHidden(false);
    if (scrollContainer) this.updateScrollFadeState(scrollContainer);
  }

  private rememberActiveContentScroll(): void {
    const subtitleView = this.root.querySelector<HTMLElement>(".subtitle-view");
    if (this.activeView === "subtitle" && subtitleView) {
      this.lastSubtitleScrollTop = subtitleView.scrollTop;
      this.lastSubtitleManualScrollAt = Date.now();
      return;
    }
    const summary = this.root.querySelector<HTMLElement>(".summary:not(.subtitle-view)");
    if (this.activeView === "summary" && summary) {
      this.lastSummaryScrollTop = summary.scrollTop;
    }
  }

  private handleSummaryScroll(summary: HTMLElement): void {
    const scrollTop = summary.scrollTop;
    const isSubtitleView = summary.classList.contains("subtitle-view");
    const isSummaryView = summary.classList.contains("summary") && !isSubtitleView;
    const previousScrollTop = isSubtitleView ? this.lastSubtitleScrollTop : isSummaryView ? this.lastSummaryScrollTop : scrollTop;
    const delta = scrollTop - previousScrollTop;
    this.updateScrollFadeState(summary);
    if (summary.classList.contains("panel-settings")) {
      this.providerModelMenu.reposition();
    }

    if (this.activeView === "subtitle" && isSubtitleView && !this.autoScrollingSubtitle) {
      this.lastSubtitleManualScrollAt = Date.now();
    }

    if (scrollTop <= 0) {
      this.setSummaryChromeHidden(false);
    } else if (delta > 6 && scrollTop > 50) {
      const maxScrollTop = summary.scrollHeight - summary.clientHeight;
      // Guard: if the content barely overflows (positive but small maxScrollTop),
      // collapsing chrome would eliminate overflow entirely — the browser clamps
      // scrollTop to 0, which reverses the hide and creates a flicker feedback loop
      // on every wheel notch. Skip hiding when 0 < maxScrollTop <= CHROME_COLLAPSE_HEIGHT.
      // (maxScrollTop <= 0 means no overflow or unknown dimensions — preserve original behavior.)
      if (maxScrollTop <= 0 || maxScrollTop > CHROME_COLLAPSE_HEIGHT) {
        this.setSummaryChromeHidden(true);
      }
    } else if (delta < -6) {
      this.setSummaryChromeHidden(false);
    }

    if (isSubtitleView) {
      this.lastSubtitleScrollTop = scrollTop;
    } else if (isSummaryView) {
      this.lastSummaryScrollTop = scrollTop;
    }
  }

  private updateScrollFadeState(summary: HTMLElement): void {
    const maxScrollTop = summary.scrollHeight - summary.clientHeight;
    const hasOverflow = maxScrollTop > 1;
    const atBottom = !hasOverflow || summary.scrollTop >= maxScrollTop - 1;
    const panel = this.root.querySelector(".panel");

    panel?.classList.toggle("scroll-has-overflow", hasOverflow);
    panel?.classList.toggle("scroll-at-bottom", atBottom);
  }

  private containSummaryWheel(event: WheelEvent): void {
    const summary = event.currentTarget;
    if (!(summary instanceof HTMLElement)) return;

    const maxScrollTop = summary.scrollHeight - summary.clientHeight;
    const scrollingUp = event.deltaY < 0;
    const scrollingDown = event.deltaY > 0;
    if (scrollingDown) this.hideActionDockDuringScroll();
    if (scrollingUp) this.showActionDock();
    const atTop = summary.scrollTop <= 0;
    const atBottom = summary.scrollTop >= maxScrollTop - 1;

    if (maxScrollTop <= 0 || (scrollingUp && atTop) || (scrollingDown && atBottom)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private hideActionDockDuringScroll(): void {
    const panel = this.root.querySelector(".panel");
    panel?.classList.add("dock-hidden");
    if (this.dockHideTimer !== undefined) {
      window.clearTimeout(this.dockHideTimer);
    }
    this.dockHideTimer = window.setTimeout(() => {
      panel?.classList.remove("dock-hidden");
      this.dockHideTimer = undefined;
    }, 520);
  }

  private showActionDock(): void {
    const panel = this.root.querySelector(".panel");
    if (this.dockHideTimer !== undefined) {
      window.clearTimeout(this.dockHideTimer);
      this.dockHideTimer = undefined;
    }
    panel?.classList.remove("dock-hidden");
  }

  private setSummaryChromeHidden(hidden: boolean): void {
    if (hidden === this.summaryChromeHidden) return;
    this.summaryChromeHidden = hidden;
    this.root.querySelector(".panel")?.classList.toggle("scrolled", hidden);
  }

  private ensureSubtitlePlaybackTracking(): void {
    const video = document.querySelector("video") ?? undefined;
    if (video === this.trackedVideo) {
      this.syncActiveSubtitleToVideo({ forceScroll: false });
      return;
    }

    this.trackedVideo?.removeEventListener("timeupdate", this.handleVideoTimeUpdate);
    this.trackedVideo = video;
    this.trackedVideo?.addEventListener("timeupdate", this.handleVideoTimeUpdate);
    this.syncActiveSubtitleToVideo({ forceScroll: false });
  }

  private readonly handleVideoTimeUpdate = (): void => {
    this.syncActiveSubtitleToVideo({ forceScroll: false });
  };

  private syncActiveSubtitleToVideo({ forceScroll }: { forceScroll: boolean }): void {
    const video = this.trackedVideo ?? document.querySelector("video");
    if (!video) return;

    const index = this.findActiveSubtitleIndex(video.currentTime);
    if (index < 0) {
      this.activeSubtitleIndex = -1;
      return;
    }

    const previousIndex = this.activeSubtitleIndex;
    this.activeSubtitleIndex = index;
    const items = Array.from(this.root.querySelectorAll<HTMLElement>(".subtitle-item[data-subtitle-index]"));
    for (const item of items) {
      const isActive = item.dataset.subtitleIndex === String(index);
      item.classList.toggle("active", isActive);
      if (isActive) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    }

    if (forceScroll || (index !== previousIndex && this.shouldAutoFollowSubtitle())) {
      this.scrollActiveSubtitleIntoView(index);
    }
  }

  private findActiveSubtitleIndex(currentTime: number): number {
    const segments = this.cache?.source.segments;
    if (!segments?.length || !Number.isFinite(currentTime)) return -1;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) continue;
      const next = segments[index + 1];
      const end = next?.start ?? segment.end;
      if (currentTime >= segment.start && (currentTime < end || index === segments.length - 1)) {
        return index;
      }
    }

    return -1;
  }

  private shouldAutoFollowSubtitle(): boolean {
    return this.activeView === "subtitle" && Date.now() - this.lastSubtitleManualScrollAt > 1800;
  }

  private scrollActiveSubtitleIntoView(index: number): void {
    const item = this.root.querySelector<HTMLElement>(`.subtitle-item[data-subtitle-index="${index}"]`);
    if (!item?.scrollIntoView) return;

    this.autoScrollingSubtitle = true;
    item.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (this.autoScrollingSubtitleTimer !== undefined) {
      window.clearTimeout(this.autoScrollingSubtitleTimer);
    }
    this.autoScrollingSubtitleTimer = window.setTimeout(() => {
      this.autoScrollingSubtitle = false;
      this.autoScrollingSubtitleTimer = undefined;
    }, 250);
  }

  private openSettingsPanel(): void {
    this.settingsExiting = false;
    this.settingsEntering = true;
    this.providerModelMenu.pickerOpenProviderId = undefined;
    this.sourceTextViewOpen = false;
    this.panelView = "settings";
    this.render();
    void this.refreshCommandShortcutsInSettings();
    void this.probeDeepSeekWebFromSettings();
  }

  private startDrag(event: Event): void {
    this.geometry.startDrag(event);
  }

  private updateResizeCursor(event: PointerEvent): void {
    this.geometry.updateResizeCursor(event);
  }

  private startResize(event: PointerEvent): void {
    this.geometry.startResize(event);
  }

  private renderToast(text: string, kind: "info" | "success" | "error" = "info"): void {
    showToast(text, kind);

    // Apple Design § Multimodal feedback — differentiate success/failure with haptics
    if (navigator.vibrate) {
      try {
        if (kind === "success") {
          navigator.vibrate(10);
        } else if (kind === "error") {
          navigator.vibrate([10, 50, 10]);
        }
      } catch {
        // Vibration API may fail silently in some contexts
      }
    }
  }

  private startTopActionFeedback(action: "refresh", button?: HTMLElement): void {
    if (this.topActionFeedbackTimer !== undefined) {
      window.clearTimeout(this.topActionFeedbackTimer);
    }
    this.topActionFeedback = action;
    button?.classList.add("spinning");
    this.topActionFeedbackTimer = window.setTimeout(() => {
      this.topActionFeedback = undefined;
      this.root.querySelector<HTMLElement>(`[data-action='${action}']`)?.classList.remove("spinning");
      this.topActionFeedbackTimer = undefined;
    }, 650);
  }

  private startSettingsFeedback(kind: SettingsFeedbackKind): void {
    if (this.settingsFeedbackTimer !== undefined) {
      window.clearTimeout(this.settingsFeedbackTimer);
    }
    this.settingsSaveFeedback = kind === "save";
    this.settingsDataFeedback = kind === "save" ? undefined : kind;
    this.updateSettingsFeedbackButton(kind, true);
    this.settingsFeedbackTimer = window.setTimeout(() => {
      this.settingsSaveFeedback = false;
      this.settingsDataFeedback = undefined;
      this.settingsFeedbackTimer = undefined;
      this.updateSettingsFeedbackButton(kind, false);
    }, 1200);
  }

  private updateSettingsFeedbackButton(kind: SettingsFeedbackKind, active: boolean): void {
    const selectorByKind: Record<SettingsFeedbackKind, string> = {
      save: "[data-action='save-panel-settings']",
      "current-cache": "[data-action='clear-current-page-cache']",
      "all-cache": "[data-action='clear-summary-cache']"
    };
    const button = this.root.querySelector<HTMLButtonElement>(selectorByKind[kind]);
    if (!button) return;
    button.classList.toggle("success", active);
    button.textContent = active
      ? kind === "save" ? "已保存" : "已清除"
      : kind === "save" ? "保存" : "清除";
  }

  private async openExtensionShortcuts(): Promise<void> {
    await openExtensionShortcuts();
  }


  private async copySourceText(): Promise<void> {
    const sourceExport = resolveSourceTextExport(this.cache?.source, document.title);
    if (!sourceExport) return;
    try {
      await writeClipboard(sourceExport.content);
      this.flashButtonSuccess("copy-source-text");
    } catch {
      this.flashButtonFailure("copy-source-text");
    }
  }

  private downloadSourceText(): void {
    const button = this.root.querySelector<HTMLElement>("[data-action='download-source-text']");
    // 反馈期内不重复触发，避免连点出现两次下载。
    if (button?.dataset.feedbackTimer) return;
    const sourceExport = resolveSourceTextExport(this.cache?.source, document.title);
    if (!sourceExport) return;
    try {
      triggerFileDownload(sourceExport.filename, sourceExport.content, sourceExport.mime);
      this.flashActionSuccess("download-source-text");
    } catch {
      this.flashActionFailure("download-source-text");
    }
  }

  private async copySummary(): Promise<void> {
    const text = this.activeView === "subtitle"
      ? formatSubtitlePlainText(this.subtitleTransform.visibleSourceSegments(), this.subtitleTransform.visibleTranslatedSegments())
      : formatSummaryMarkdown(this.cache, document.title);
    if (!text) return;

    try {
      await writeClipboard(text);
      this.flashActionSuccess("copy-summary");
    } catch {
      // Silent fail
    }
  }



  private downloadSummary(): void {
    const isSubtitle = this.activeView === "subtitle";
    const content = isSubtitle
      ? formatSubtitleSrt(this.subtitleTransform.visibleSourceSegments(), this.subtitleTransform.visibleTranslatedSegments())
      : formatSummaryMarkdown(this.cache, document.title);
    if (!content) return;

    try {
      triggerFileDownload(
        isSubtitle
          ? buildSrtFilename(this.cache?.source.title || document.title)
          : buildMarkdownFilename(this.cache?.summary?.title || this.cache?.source.title || document.title),
        content,
        isSubtitle ? "application/x-subrip;charset=utf-8" : "text/markdown;charset=utf-8"
      );
      this.flashActionSuccess("download-summary");
    } catch {
      // Silent fail; the copy action remains available as a fallback.
    }
  }

  private flashActionSuccess(action: string): void {
    const button = this.root.querySelector<HTMLElement>(`[data-action='${action}']`);
    if (!button) return;
    window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
    button.dataset.feedbackTimer = String(window.setTimeout(() => {
      button.classList.remove("success");
      setTrustedInnerHTML(button, renderActionIcon(action));
      delete button.dataset.feedbackTimer;
    }, 900));
    button.classList.remove("failure");
    button.classList.add("success");
    setTrustedInnerHTML(button, renderLucideIcon("check"));
  }

  private flashActionFailure(action: string): void {
    const button = this.root.querySelector<HTMLElement>(`[data-action='${action}']`);
    if (!button) return;
    window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
    button.dataset.feedbackTimer = String(window.setTimeout(() => {
      button.classList.remove("failure");
      setTrustedInnerHTML(button, renderActionIcon(action));
      delete button.dataset.feedbackTimer;
    }, 900));
    button.classList.remove("success");
    button.classList.add("failure");
    setTrustedInnerHTML(button, renderLucideIcon("x"));
  }


  private flashButtonSuccess(action: string): void {
    const button = this.root.querySelector<HTMLElement>(`[data-action='${action}']`);
    if (!button) return;
    window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
    button.dataset.feedbackTimer = String(window.setTimeout(() => {
      button.classList.remove("success");
      setTrustedInnerHTML(button, renderLucideIcon("copy"));
      delete button.dataset.feedbackTimer;
    }, 900));
    button.classList.add("success");
    setTrustedInnerHTML(button, renderLucideIcon("check"));
  }

  private flashButtonFailure(action: string): void {
    const button = this.root.querySelector<HTMLElement>(`[data-action='${action}']`);
    if (!button) return;
    window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
    button.dataset.feedbackTimer = String(window.setTimeout(() => {
      button.classList.remove("failure");
      setTrustedInnerHTML(button, renderLucideIcon("copy"));
      delete button.dataset.feedbackTimer;
    }, 900));
    button.classList.add("failure");
    setTrustedInnerHTML(button, renderLucideIcon("x"));
  }

  private resetSourceDerivedState(): void {
    this.sourceTextViewOpen = false;
    this.subtitleTransform.reset();
    this.activeSubtitleIndex = -1;
  }

  private async switchModel(value: string): Promise<void> {
    if (!this.settings || !this.providers) return;
    const [providerId, ...modelParts] = value.split(":");
    const modelId = modelParts.join(":");
    if (!isProviderId(providerId) || !modelId) return;

    this.settings = { ...this.settings, defaultProvider: providerId };
    const nextProviderConfig = providerId === DEEPSEEK_WEB_PROVIDER_ID
      ? createDeepSeekWebProviderConfig(modelId, this.settings?.deepseekWebModels)
      : {
          ...this.providers[providerId],
          selectedModel: modelId
        };
    this.providers = {
      ...this.providers,
      [providerId]: nextProviderConfig
    };

    await saveSettings(this.settings);
    await saveProviders(this.providers);
    this.updateHeaderModelSelects();
    this.renderToast("模型已切换", "success");
  }

  private updateHeaderModelSelects(): void {
    const brand = this.root.querySelector<HTMLElement>(".brand");
    if (brand) {
      brand.replaceChildren(this.createElementFromHtml(this.renderModelSelect()));
    }
    const thinkingSlot = this.root.querySelector<HTMLElement>(".thinking-slot");
    if (thinkingSlot) {
      const thinkingHtml = this.renderThinkingLevelSelect();
      if (thinkingHtml) {
        thinkingSlot.replaceChildren(this.createElementFromHtml(thinkingHtml));
      } else {
        thinkingSlot.replaceChildren();
      }
    }
    this.bindHeaderModelEvents();
  }

  private bindHeaderModelEvents(): void {
    this.root.querySelectorAll<HTMLElement>("[data-action='model-option']").forEach((button) => {
      button.addEventListener("click", () => {
        void this.switchModel(button.dataset.value ?? "");
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='thinking-toggle']").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        void this.toggleThinkingLevel();
      });
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.toggleThinkingLevel();
        }
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-action='thinking-option']").forEach((button) => {
      button.addEventListener("click", () => {
        void this.switchThinkingLevel(button.dataset.value ?? "");
      });
    });
  }

  private async switchThinkingLevel(value: string): Promise<void> {
    if (!this.settings) return;
    const context = this.resolveHeaderModelContext();
    if (!context?.currentConfig) return;
    const modelId = context.currentConfig.selectedModel;
    const currentModel = context.currentModels.find((model) => model.id === modelId);
    const options = thinkingOptionsForModel(context.currentProvider, modelId, currentModel?.thinkingLevels);
    if (!options.some((option) => option.value === value)) return;

    const nextSettings: Settings = {
      ...this.settings,
      modelThinkingLevels: {
        ...(this.settings.modelThinkingLevels ?? {}),
        [modelThinkingKey(context.currentProvider, modelId)]: value as ModelThinkingLevel
      }
    };

    this.settings = nextSettings;
    await saveSettings(nextSettings);
    document.dispatchEvent(new CustomEvent("youmind:settings-updated", { detail: nextSettings }));
    this.updateThinkingLevelSelectInPlace();
    this.closeThinkingMenu();
  }

  private async toggleThinkingLevel(): Promise<void> {
    if (!this.settings) return;
    const context = this.resolveHeaderModelContext();
    if (!context?.currentConfig) return;
    const modelId = context.currentConfig.selectedModel;
    const currentModel = context.currentModels.find((model) => model.id === modelId);
    const options = thinkingOptionsForModel(context.currentProvider, modelId, currentModel?.thinkingLevels);
    if (options.length < 2) return;

    const selectedValue = this.resolveThinkingLevel(context.currentProvider, modelId, options);
    const isOn = selectedValue !== options[0]?.value;
    const nextValue = isOn ? options[0].value : options[1].value;
    if (!options.some((option) => option.value === nextValue)) return;

    const nextSettings: Settings = {
      ...this.settings,
      modelThinkingLevels: {
        ...(this.settings.modelThinkingLevels ?? {}),
        [modelThinkingKey(context.currentProvider, modelId)]: nextValue as ModelThinkingLevel
      }
    };

    this.settings = nextSettings;
    await saveSettings(nextSettings);
    document.dispatchEvent(new CustomEvent("youmind:settings-updated", { detail: nextSettings }));
    this.updateThinkingLevelSelectInPlace();
  }

  private updateThinkingLevelSelectInPlace(): void {
    const context = this.resolveHeaderModelContext();
    if (!context?.currentConfig) return;
    const modelId = context.currentConfig.selectedModel;
    const currentModel = context.currentModels.find((model) => model.id === modelId);
    const options = thinkingOptionsForModel(context.currentProvider, modelId, currentModel?.thinkingLevels);
    const selectedValue = this.resolveThinkingLevel(context.currentProvider, modelId, options);
    const selectedOption = options.find((option) => option.value === selectedValue);
    const isOn = selectedValue !== options[0]?.value;
    const toggle = this.root.querySelector<HTMLElement>("[data-action='thinking-toggle']");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(isOn));
      toggle.classList.toggle("thinking-toggle-on", isOn);
    }
    const currentLabel = this.root.querySelector<HTMLElement>(".thinking-current");
    if (currentLabel && selectedOption) currentLabel.textContent = selectedOption.label;
    this.root.querySelectorAll<HTMLElement>("[data-action='thinking-option']").forEach((option) => {
      const active = option.dataset.value === selectedValue;
      option.classList.toggle("active", active);
      if (active) {
        option.setAttribute("aria-selected", "true");
      } else {
        option.removeAttribute("aria-selected");
      }
    });
  }

  private async savePanelSettings(options: { feedback?: boolean; render?: boolean } = {}): Promise<void> {
    if (!this.settings || !this.providers) return;
    const { feedback = true, render = false } = options;
    const scrollTop = this.root.querySelector<HTMLElement>(".panel-settings")?.scrollTop ?? 0;

    const currentProviders = sanitizePanelProviders(this.providers);
    const selectedProvider = this.readPanelSelect<ProviderId>("defaultProvider",
      currentProviders[this.settings.defaultProvider]
      || this.settings.defaultProvider === DEEPSEEK_WEB_PROVIDER_ID
        ? this.settings.defaultProvider : ""
    );
    const defaultProvider = currentProviders[selectedProvider]
      || selectedProvider === DEEPSEEK_WEB_PROVIDER_ID
      ? selectedProvider : "";
    const themeMode = this.readPanelSelect<ThemeMode>("themeMode", this.settings.themeMode);
    const nextProviders = this.readPanelProviders(currentProviders);
    if (defaultProvider === DEEPSEEK_WEB_PROVIDER_ID) {
      nextProviders[DEEPSEEK_WEB_PROVIDER_ID] = createDeepSeekWebProviderConfig(
        this.root.querySelector<HTMLInputElement>(`[data-panel-provider-model="${DEEPSEEK_WEB_PROVIDER_ID}"]`)?.value
          ?? this.providers?.[DEEPSEEK_WEB_PROVIDER_ID]?.selectedModel
          ?? DEEPSEEK_WEB_MODELS[0]?.id
          ?? "",
        this.settings?.deepseekWebModels
      );
    } else if (this.providers?.[DEEPSEEK_WEB_PROVIDER_ID]) {
      nextProviders[DEEPSEEK_WEB_PROVIDER_ID] = this.providers[DEEPSEEK_WEB_PROVIDER_ID];
    }
    const nextSettings: Settings = {
      ...this.settings,
      defaultProvider,
      themeMode,
      autoSummarize: this.readPanelCheckbox("autoSummarize", this.settings.autoSummarize ?? true),
      summaryOutputCompressionMode: this.readOutputCompressionMode("summaryOutputCompressionMode", this.settings.summaryOutputCompressionMode ?? "off"),
      subtitleTranslationTarget: this.readSubtitleTranslationTarget(this.settings.subtitleTranslationTarget ?? "zh-Hans"),
      pageCacheLimit: this.readIntegerSetting("pageCacheLimit", this.settings.pageCacheLimit ?? 100, 1, 500)
    };

    this.settings = nextSettings;
    this.providers = nextProviders;
    this.panelView = "settings";
    this.element.setAttribute("data-theme", resolveTheme(nextSettings));
    if (render) this.renderSettingsInPlace(scrollTop);
    await saveSettings(nextSettings);
    await saveProviders(nextProviders);
    document.dispatchEvent(new CustomEvent("youmind:settings-updated", { detail: nextSettings }));
    if (feedback) this.startSettingsFeedback("save");
  }

  private requestConfirm(action: "clear-summary-cache"): boolean {
    if (this.pendingConfirmAction === action) {
      this.clearPendingConfirm();
      return true;
    }
    this.clearPendingConfirm();
    this.pendingConfirmAction = action;
    this.pendingConfirmTimer = window.setTimeout(() => {
      this.pendingConfirmTimer = undefined;
      this.clearPendingConfirm();
      this.renderSettingsInPlace();
    }, 4000);
    this.renderSettingsInPlace();
    return false;
  }

  private clearPendingConfirm(): void {
    if (this.pendingConfirmTimer !== undefined) {
      window.clearTimeout(this.pendingConfirmTimer);
      this.pendingConfirmTimer = undefined;
    }
    this.pendingConfirmAction = undefined;
  }

  private async clearSummaryCache(): Promise<void> {
    if (!this.requestConfirm("clear-summary-cache")) return;
    await clearPageCaches();
    this.cache = undefined;
    this.startSettingsFeedback("all-cache");
  }

  private async clearCurrentPageCache(): Promise<void> {
    await clearPageCache(this.cache?.source.url ?? location.href);
    this.cache = undefined;
    this.startSettingsFeedback("current-cache");
  }

  private readPanelSelect<T extends string>(key: string, fallback: T): T {
    const value = this.root.querySelector<HTMLInputElement>(`[data-panel-setting="${key}"]`)?.value;
    return (value || fallback) as T;
  }

  private readPanelCheckbox(
    key: keyof Pick<Settings, "autoSummarize">,
    fallback: boolean
  ): boolean {
    return this.root.querySelector<HTMLInputElement>(`[data-panel-setting="${key}"]`)?.checked ?? fallback;
  }

  private readIntegerSetting(key: string, fallback: number, min: number, max: number): number {
    const value = Number(this.root.querySelector<HTMLInputElement>(`[data-panel-setting='${key}']`)?.value);
    if (!Number.isFinite(value)) return clamp(fallback, min, max);
    return clamp(Math.floor(value), min, max);
  }

  private readOutputCompressionMode(
    key: keyof Pick<Settings, "summaryOutputCompressionMode">,
    fallback: OutputCompressionMode
  ): OutputCompressionMode {
    const value = this.root.querySelector<HTMLInputElement>(`[data-panel-setting="${key}"]`)?.value;
    if (value === "off" || value === "lite" || value === "full" || value === "ultra") return value;
    return fallback === "lite" || fallback === "full" || fallback === "ultra" ? fallback : "off";
  }

  private readSubtitleTranslationTarget(fallback: SubtitleTranslationTarget): SubtitleTranslationTarget {
    const value = this.root.querySelector<HTMLInputElement>("[data-panel-setting='subtitleTranslationTarget']")?.value ?? "";
    return isSubtitleTranslationTarget(value) ? value : fallback;
  }

  private readPanelProviders(fallback: ProviderSettings): ProviderSettings {
    const next: ProviderSettings = {};
    Object.keys(fallback).forEach((providerId) => {
      const fallbackConfig = fallback[providerId];
      if (!fallbackConfig) return;
      const name = this.root.querySelector<HTMLInputElement>(`[data-panel-provider-field="${cssEscape(providerId)}.name"]`)?.value.trim();
      const apiKey = this.root.querySelector<HTMLInputElement>(`[data-panel-provider-field="${cssEscape(providerId)}.apiKey"]`)?.value;
      const baseUrl = this.root.querySelector<HTMLInputElement>(`[data-panel-provider-field="${cssEscape(providerId)}.baseUrl"]`)?.value;
      const selectedModelInput = this.root.querySelector<HTMLInputElement>(`[data-panel-provider-model="${cssEscape(providerId)}"]`);
      const rawSelectedModel = selectedModelInput ? selectedModelInput.value : fallbackConfig.selectedModel;
      const modelInputs = Array.from(this.root.querySelectorAll<HTMLInputElement>(`[data-panel-provider-model-id^="${cssEscape(providerId)}."]`))
        .sort((a, b) => readProviderModelInputIndex(a) - readProviderModelInputIndex(b));
      const fallbackModels = panelVisibleModels(fallbackConfig);
      const modelSource = modelInputs.length
        ? modelInputs.map((input, index) => ({ id: input.value.trim(), fallbackModel: fallbackModels[index] }))
        : fallbackModels.map((model) => ({ id: model.id.trim(), fallbackModel: model }));
      const models = modelSource.map(({ id, fallbackModel }) => {
        const matchingModel = fallbackModels.find((model) => model.id === id);
        const sourceModel = matchingModel ?? fallbackModel;
        return { id, label: id || sourceModel?.label || "", enabled: true, ...(sourceModel?.thinkingLevels ? { thinkingLevels: sourceModel.thinkingLevels } : {}) };
      });
      const selectableModels = models.filter((model) => model.id);
      const selectedModel = selectableModels.some((model) => model.id === rawSelectedModel)
        ? rawSelectedModel
        : selectableModels[0]?.id ?? "";
      next[providerId] = {
        name: name || fallbackConfig.name || providerId,
        apiKey: apiKey ?? fallbackConfig.apiKey,
        baseUrl: baseUrl ?? fallbackConfig.baseUrl,
        selectedModel,
        models
      };
    });
    return next;
  }
}

function isSameSummarySource(left: SourcePayload, right: SourcePayload): boolean {
  return (
    left.url === right.url &&
    left.title === right.title &&
    left.sourceKind === right.sourceKind &&
    left.text === right.text &&
    summaryHintFingerprint(left.summaryHint) === summaryHintFingerprint(right.summaryHint)
  );
}

function shouldRevalidateBilibiliFallbackCache(cache: PageCache | undefined): boolean {
  if (!cache?.summary || cache.source.sourceKind !== "fallback") return false;
  const classification = classifySourcePage(cache.source.url);
  return classification.platform === "bilibili" && classification.transcriptCandidate;
}

function summaryHintFingerprint(summary?: SummaryResult): string {
  return summary ? JSON.stringify(summary) : "";
}

function stripTrailingSummaryTimestamp(value: string): string {
  return value
    .replace(/\s*(?:\[(?:\d+:)?\d{1,2}:\d{2}\]|（(?:\d+:)?\d{1,2}:\d{2}）|\((?:\d+:)?\d{1,2}:\d{2}\))\s*$/u, "")
    .trim();
}

function modelThinkingKey(providerId: ProviderId, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function readProviderModelInputIndex(input: HTMLInputElement): number {
  const value = input.getAttribute("data-panel-provider-model-id") ?? "";
  const index = Number(value.slice(value.lastIndexOf(".") + 1));
  return Number.isFinite(index) ? index : 0;
}

/* 固定占位插画：一张纸压着另一张，下面几行字。形状与参考图的占位图同构，
   颜色交给 CSS 变量，浅色是白纸、深色是浅灰纸。 */
function renderEmptyCoverArt(): string {
  return `<svg class="empty-cover-art" viewBox="0 0 200 130" aria-hidden="true" focusable="false">
      <rect class="empty-art-back" x="94" y="18" width="62" height="70" rx="9" />
      <rect class="empty-art-face" x="30" y="6" width="86" height="88" rx="12" />
      <rect class="empty-art-line" x="44" y="104" width="74" height="8" rx="4" />
      <rect class="empty-art-line" x="44" y="118" width="52" height="8" rx="4" />
    </svg>`;
}

function webProviderStatusLabel(status: Settings["deepseekWebStatus"]): string {
  if (status === "available") return "状态：已连接";
  if (status === "unavailable") return "状态：不可用";
  return "状态：未检测";
}

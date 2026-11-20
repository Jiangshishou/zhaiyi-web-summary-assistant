import { escapeHtml } from "./htmlEscape";
import { translateSubtitles } from "./runtimeClient";
import { renderLucideIcon, renderTranslationLoadingIcon } from "./panelIcons";
import { formatTimestamp, getSubtitleSourceLanguage, isSubtitleTranslationTarget } from "./panelSubtitle";
import type {
  Settings,
  SourcePayload,
  SubtitleSegment,
  SubtitleTranslationTarget,
  TranslatedSubtitleSegment
} from "../shared/types";

export interface SubtitleTranslationState {
  targetLanguage: SubtitleTranslationTarget;
  segments: TranslatedSubtitleSegment[];
}


export interface SubtitleTransformOptions {
  root: ShadowRoot;
  getSource: () => SourcePayload | undefined;
  getSettings: () => Settings | undefined;
  renderContentPreservingScroll: (scrollTop: number) => void;
  flashActionSuccess: (action: string) => void;
  flashActionFailure: (action: string) => void;
}

/** Owns subtitle translation/correction state, rendering, and runtime calls. */
export class SubtitleTransformController {
  private readonly opts: SubtitleTransformOptions;
  private translationState?: SubtitleTranslationState;
  private translationLoading = false;

  constructor(options: SubtitleTransformOptions) {
    this.opts = options;
  }

  get translation(): SubtitleTranslationState | undefined {
    return this.translationState;
  }

  set translation(value: SubtitleTranslationState | undefined) {
    this.translationState = value;
  }

  renderActions(startIndex = 0): string {
    const segments = this.opts.getSource()?.segments ?? [];
    const targetLanguage = this.opts.getSettings()?.subtitleTranslationTarget ?? "zh-Hans";
    const sourceLanguage = segments.length ? getSubtitleSourceLanguage(segments) : targetLanguage;
    let actionIndex = startIndex;
    const dockIndexStyle = () => ` style="--dock-action-index: ${actionIndex++};"`;

    if (this.translationState) {
      return `
        <div class="subtitle-actions" aria-label="字幕操作">
          <button class="dock-action" data-action="open-translation-targets" type="button" aria-label="还原原文"${dockIndexStyle()}>
            ${renderLucideIcon("languages")}
          </button>
          <button class="dock-action" data-action="locate-subtitle" type="button" aria-label="跳到当前字幕"${dockIndexStyle()}>
            ${renderLucideIcon("locate-fixed")}
          </button>
        </div>
      `;
    }

    return `
      <div class="subtitle-actions" aria-label="字幕操作">
        ${sourceLanguage === targetLanguage ? "" : `
          <button class="dock-action ${this.translationLoading ? "loading" : ""}" data-action="translate-subtitles" type="button" aria-label="翻译"${dockIndexStyle()} ${this.translationLoading ? "disabled" : ""}>
            ${this.translationLoading ? renderTranslationLoadingIcon() : renderLucideIcon("languages")}
          </button>
        `}
        <button class="dock-action" data-action="locate-subtitle" type="button" aria-label="跳到当前字幕"${dockIndexStyle()}>
          ${renderLucideIcon("locate-fixed")}
        </button>
      </div>
    `;
  }

  renderView(activeIndex: number, fallbackText?: string): string {
    const segments = this.opts.getSource()?.segments;
    const translatedSegments = this.translationState?.segments;

    if (!segments?.length) {
      return `
        <section class="summary subtitle-view">
          <p class="subtitle-fallback">本缓存无时间戳，仅显示纯文本：</p>
          <pre class="subtitle-plain">${escapeHtml(fallbackText || "")}</pre>
        </section>
      `;
    }

    return `
      <section class="summary subtitle-view">
        <ul class="subtitle-track">
          ${segments.map((segment, index) => `
            <li class="subtitle-item ${index === activeIndex ? "active" : ""}" data-seek="${segment.start}" data-subtitle-index="${index}" ${index === activeIndex ? 'aria-current="true"' : ""}>
              <span class="subtitle-time">${formatTimestamp(segment.start)}</span>
              ${this.renderText(segment.text, translatedSegments?.[index]?.translatedText)}
            </li>
          `).join("")}
        </ul>
      </section>
    `;
  }

  async translate(targetLanguage?: SubtitleTranslationTarget): Promise<void> {
    const source = this.opts.getSource();
    const segments = source?.segments;
    if (!segments?.length || this.translationLoading) return;

    const selectedTargetLanguage = targetLanguage ?? this.opts.getSettings()?.subtitleTranslationTarget ?? "zh-Hans";
    if (!isSubtitleTranslationTarget(selectedTargetLanguage) || getSubtitleSourceLanguage(segments) === selectedTargetLanguage) return;
    let failed = false;
    const scrollTop = this.opts.root.querySelector<HTMLElement>(".subtitle-view")?.scrollTop ?? 0;
    this.translationLoading = true;
    this.opts.renderContentPreservingScroll(scrollTop);

    try {
      this.translationState = await translateSubtitles(source?.title || document.title, segments, selectedTargetLanguage);
    } catch (error) {
      console.warn("[YouMind] subtitles: translation failed", error);
      failed = true;
    } finally {
      this.translationLoading = false;
      this.opts.renderContentPreservingScroll(scrollTop);
      if (this.translationState) {
        this.opts.flashActionSuccess("open-translation-targets");
      } else if (failed) {
        this.opts.flashActionFailure("translate-subtitles");
      }
    }
  }



  visibleSourceSegments(): SubtitleSegment[] | undefined {
    return this.opts.getSource()?.segments;
  }

  visibleTranslatedSegments(): TranslatedSubtitleSegment[] | undefined {
    return this.translationState?.segments;
  }

  private resetTranslation(): void {
    this.translationState = undefined;
    this.translationLoading = false;
  }

  reset(): void {
    this.resetTranslation();
  }

  private renderText(originalText: string, translatedText: string | undefined): string {
    if (!translatedText) {
      return `<span class="subtitle-text subtitle-original">${escapeHtml(originalText)}</span>`;
    }
    return `
      <span class="subtitle-text subtitle-bilingual">
        <span class="subtitle-original">${escapeHtml(originalText)}</span>
        <span class="subtitle-translated">${escapeHtml(translatedText)}</span>
      </span>
    `;
  }
}

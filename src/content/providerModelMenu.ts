import { escapeAttribute, escapeHtml } from "./htmlEscape";
import { setTrustedInnerHTML } from "./trustedHtml";
import { listProviderModels, saveProviders, saveSettings } from "./runtimeClient";
import { clearMotionAttribute, cssEscape } from "./panelDom";
import { renderLucideIcon } from "./panelIcons";
import { renderSettingsSelect } from "./panelFormControls";
import {
  addFetchedProviderModelDraft,
  addProviderModelDraft,
  deleteProviderModelDraft,
  panelVisibleModels,
  providerModelListHeight,
  sanitizePanelProviders,
  settingsWithValidDefaultProvider,
  type ProviderDraftEdit
} from "./providerSettingsEditor";
import type { ModelInfo, ProviderId, ProviderSettings, Settings } from "../shared/types";

const PROVIDER_MODEL_CANDIDATE_ROW_HEIGHT = 34;
const PROVIDER_MODEL_CANDIDATE_ROW_GAP = 6;
const PROVIDER_MODEL_CANDIDATE_BLOCK_PADDING = 14;
const PROVIDER_MODEL_CANDIDATE_MAX_VISIBLE_ROWS = 5;
export const PROVIDER_MODEL_ROW_ENTER_MS = 150;

type FetchStatus = "loading" | "success" | "failure";

export interface ProviderModelCandidatesState {
  providerId: string;
  models: ModelInfo[];
}

export interface ProviderModelCandidateMenuState {
  top: number;
  right: number;
  width: number;
  height?: number;
}

export interface ProviderModelMenuOptions {
  root: ShadowRoot;
  getProviders: () => ProviderSettings | undefined;
  setProviders: (providers: ProviderSettings) => void;
  getSettings: () => Settings | undefined;
  setSettings: (settings: Settings) => void;
  /** 仍供 fetch 路径使用（见 ProviderDraftEdit 文档注释里的差异说明）。 */
  readPanelProviders: (fallback: ProviderSettings) => ProviderSettings;
  renderSettingsInPlace: (scrollTop?: number) => void;
  draftEdits: ProviderDraftEdit;
}

/**
 * Imperative controller for the custom-provider model config: fetch models from
 * the provider API, show them in a panel-level candidate overlay rendered outside
 * the settings scroller, and add selected models. Owns all provider-model menu
 * state so the panel keeps a single controller field.
 */
export class ProviderModelMenuController {
  private readonly opts: ProviderModelMenuOptions;
  private fetchState?: { providerId: string; status: FetchStatus };
  private fetchTimer: number | undefined;
  private fetchGen = 0;
  private candidatesState?: ProviderModelCandidatesState;
  private pickerOpenProviderIdState?: string;
  private menuState?: ProviderModelCandidateMenuState;

  constructor(options: ProviderModelMenuOptions) {
    this.opts = options;
  }

  get candidates(): ProviderModelCandidatesState | undefined {
    return this.candidatesState;
  }

  set candidates(value: ProviderModelCandidatesState | undefined) {
    this.candidatesState = value;
  }

  get pickerOpenProviderId(): string | undefined {
    return this.pickerOpenProviderIdState;
  }

  set pickerOpenProviderId(value: string | undefined) {
    this.pickerOpenProviderIdState = value;
  }

  get menu(): ProviderModelCandidateMenuState | undefined {
    return this.menuState;
  }

  set menu(value: ProviderModelCandidateMenuState | undefined) {
    this.menuState = value;
  }

  renderModelRow(providerId: ProviderId, model: ModelInfo, index: number): string {
    const rowKey = model.id.trim() || `blank-${index}`;
    return `
      <div class="provider-model-row" data-provider-model-row-key="${escapeAttribute(rowKey)}">
        <span class="model-name-label">模型名称</span>
        <input data-panel-provider-model-id="${escapeAttribute(providerId)}.${index}" value="${escapeAttribute(model.id)}" placeholder="模型名称" />
        <button class="icon-mini danger" data-action="delete-provider-model" data-provider="${escapeAttribute(providerId)}" data-index="${index}" type="button" aria-label="删除模型">${renderLucideIcon("trash-2")}</button>
      </div>
    `;
  }

  renderFetchButton(providerId: ProviderId): string {
    const status = this.fetchState?.providerId === providerId ? this.fetchState.status : undefined;
    return `<button class="icon-mini${status ? ` ${status}` : ""}" data-action="fetch-provider-models" data-provider="${escapeAttribute(providerId)}" type="button" aria-label="刷新模型列表">${renderProviderFetchIconStack()}</button>`;
  }

  renderCandidates(): string {
    const providerId = this.pickerOpenProviderIdState;
    if (
      !providerId ||
      this.candidatesState?.providerId !== providerId ||
      this.candidatesState.models.length === 0 ||
      !this.menuState ||
      this.visibleCandidateCount(providerId) === 0
    ) return "";
    const style = [
      `top: ${this.menuState.top}px`,
      `right: ${this.menuState.right}px`,
      `width: ${this.menuState.width}px`,
      this.menuState.height ? `height: ${this.menuState.height}px` : undefined
    ].filter(Boolean).join("; ") + ";";
    const configuredModelIds = new Set((this.opts.getProviders()?.[providerId]?.models ?? []).map((model) => model.id).filter(Boolean));
    return `
      <div class="provider-model-candidates" role="list" style="${escapeAttribute(style)}">
        ${this.candidatesState.models.map((model) => this.renderCandidateRow(providerId, model, configuredModelIds.has(model.id))).join("")}
      </div>
    `;
  }

  private renderCandidateRow(providerId: ProviderId, model: ModelInfo, hidden: boolean): string {
    return `
      <div class="provider-model-candidate" role="listitem" data-provider-model-candidate="${escapeAttribute(model.id)}"${hidden ? " hidden" : ""}>
        <span>${escapeHtml(model.label || model.id)}</span>
        <button class="icon-mini" data-action="add-fetched-provider-model" data-provider="${escapeAttribute(providerId)}" data-model-id="${escapeAttribute(model.id)}" type="button" aria-label="添加 ${escapeAttribute(model.label || model.id)}">${renderLucideIcon("plus")}</button>
      </div>
    `;
  }

  addModel(providerId: string): void {
    if (this.focusBlankInput(providerId)) return;
    this.opts.draftEdits.commit(
      providerId,
      (draft) => addProviderModelDraft(draft, providerId),
      () => {
        this.menuState = undefined;
        this.pickerOpenProviderIdState = undefined;
        this.opts.renderSettingsInPlace();
      }
    );
  }

  deleteModel(providerId: string, index: number): void {
    if (!Number.isInteger(index)) return;
    this.opts.draftEdits.commit(
      providerId,
      (draft) => deleteProviderModelDraft(draft, providerId, index),
      () => this.refreshControls(providerId)
    );
  }

  openMenu(trigger: HTMLElement): void {
    const panel = this.opts.root.querySelector<HTMLElement>(".panel");
    if (!panel) {
      this.menuState = undefined;
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(260, Math.max(190, panelRect.width - 40));
    this.menuState = {
      top: Math.round(triggerRect.bottom - panelRect.top + 8),
      right: Math.max(16, Math.round(panelRect.right - triggerRect.right)),
      width
    };
    this.updateCandidateOpenState();
  }

  onFetchClick(trigger: HTMLElement, providerId: string): void {
    if (
      this.pickerOpenProviderIdState === providerId &&
      this.candidatesState?.providerId === providerId &&
      this.candidatesState.models.length > 0
    ) {
      this.closeCandidates();
      return;
    }
    this.openMenu(trigger);
    void this.fetch(providerId);
  }

  async fetch(providerId: string): Promise<void> {
    const gen = ++this.fetchGen;
    const settings = this.opts.getSettings();
    const providers = this.opts.getProviders();
    if (!settings || !providers?.[providerId]) return;
    const nextProviders = this.opts.readPanelProviders(sanitizePanelProviders(providers));
    const nextSettings = settingsWithValidDefaultProvider(settings, nextProviders);
    this.opts.setProviders(nextProviders);
    this.opts.setSettings(nextSettings);
    this.candidatesState = undefined;
    this.pickerOpenProviderIdState = providerId;
    this.updateCandidateOpenState();
    this.setFetchState(providerId, "loading");
    try {
      await saveSettings(nextSettings);
      await saveProviders(nextProviders);
      const response = await listProviderModels(providerId);
      if (gen !== this.fetchGen) return; // 被后续 fetch 取代
      this.candidatesState = { providerId, models: response.models };
      this.setFetchState(providerId, "success");
    } catch {
      if (gen !== this.fetchGen) return;
      this.setFetchState(providerId, "failure");
    }
  }

  addFetched(providerId: string, modelId: string): void {
    this.opts.draftEdits.commit(
      providerId,
      (draft) => addFetchedProviderModelDraft(draft, providerId, modelId, this.candidatesState),
      () => {
        this.pickerOpenProviderIdState = providerId;
        this.updateCandidateOpenState();
        this.refreshControls(providerId);
      }
    );
  }

  closeCandidates(): void {
    if (this.fetchTimer !== undefined) {
      window.clearTimeout(this.fetchTimer);
      this.fetchTimer = undefined;
    }
    this.fetchState = undefined;
    this.pickerOpenProviderIdState = undefined;
    this.menuState = undefined;
    this.updateCandidateOpenState();
    this.updateCandidatesInPlace();
  }

  reposition(): void {
    const providerId = this.pickerOpenProviderIdState;
    if (!providerId) return;
    const trigger = this.opts.root.querySelector<HTMLElement>(`[data-action='fetch-provider-models'][data-provider="${cssEscape(providerId)}"]`);
    if (!trigger) return;
    this.openMenu(trigger);
    this.lockMenuHeight(providerId);
    this.updateCandidatesInPlace();
  }

  private setFetchState(providerId: string, status: FetchStatus): void {
    if (this.fetchTimer !== undefined) {
      window.clearTimeout(this.fetchTimer);
    }
    this.fetchState = { providerId, status };
    this.updateFetchButton(providerId, status);
    if (status === "success") {
      this.lockMenuHeight(providerId);
      this.updateCandidatesInPlace();
    }
    if (status === "loading") return;
    this.fetchTimer = window.setTimeout(() => {
      this.fetchState = undefined;
      this.fetchTimer = undefined;
      this.updateFetchButton(providerId);
    }, 1200);
  }

  private updateFetchButton(providerId: string, status?: FetchStatus): void {
    const button = this.opts.root.querySelector<HTMLButtonElement>(`[data-action='fetch-provider-models'][data-provider="${cssEscape(providerId)}"]`);
    if (!button) return;
    button.classList.remove("loading", "success", "failure");
    if (status) button.classList.add(status);
    if (!button.querySelector(".provider-fetch-icon-stack")) {
      setTrustedInnerHTML(button, renderProviderFetchIconStack());
    }
  }

  private updateCandidatesInPlace(): void {
    const panel = this.opts.root.querySelector<HTMLElement>(".panel");
    if (!panel) return;
    const existing = this.opts.root.querySelector<HTMLElement>(".panel > .provider-model-candidates");
    const html = this.renderCandidates();
    if (!html) {
      existing?.remove();
      this.updateCandidateOpenState();
      return;
    }
    const template = document.createElement("template");
    setTrustedInnerHTML(template, html.trim());
    const candidates = template.content.firstElementChild;
    if (!(candidates instanceof HTMLElement)) return;
    if (existing instanceof HTMLElement) {
      const nextStyle = candidates.getAttribute("style") ?? "";
      if (existing.getAttribute("style") !== nextStyle) existing.setAttribute("style", nextStyle);
      this.updateCandidateRowsInPlace(existing, candidates);
      return;
    }
    panel.append(candidates);
    this.updateCandidateOpenState();
  }

  private updateCandidateOpenState(): void {
    this.opts.root.querySelectorAll<HTMLElement>("[data-custom-provider]").forEach((group) => {
      const isOpen = Boolean(this.pickerOpenProviderIdState && group.dataset.customProvider === this.pickerOpenProviderIdState);
      group.toggleAttribute("data-provider-model-candidates-open", isOpen);
    });
  }

  private visibleCandidateCount(providerId: string): number {
    if (this.candidatesState?.providerId !== providerId) return 0;
    const configuredModelIds = new Set((this.opts.getProviders()?.[providerId]?.models ?? []).map((model) => model.id).filter(Boolean));
    return this.candidatesState.models.filter((model) => model.id && !configuredModelIds.has(model.id)).length;
  }

  private lockMenuHeight(providerId: string): void {
    if (!this.menuState || this.candidatesState?.providerId !== providerId) return;
    const count = this.visibleCandidateCount(providerId);
    if (count === 0) {
      this.menuState = { ...this.menuState, height: undefined };
      return;
    }
    const visibleRows = Math.min(count, PROVIDER_MODEL_CANDIDATE_MAX_VISIBLE_ROWS);
    const height =
      PROVIDER_MODEL_CANDIDATE_BLOCK_PADDING +
      visibleRows * PROVIDER_MODEL_CANDIDATE_ROW_HEIGHT +
      Math.max(0, visibleRows - 1) * PROVIDER_MODEL_CANDIDATE_ROW_GAP;
    this.menuState = { ...this.menuState, height };
  }

  private updateCandidateRowsInPlace(existing: HTMLElement, next: HTMLElement): void {
    const nextRows = Array.from(next.querySelectorAll<HTMLElement>("[data-provider-model-candidate]"));
    const nextIds = new Set(nextRows.map((row) => row.dataset.providerModelCandidate).filter(Boolean));
    for (const currentRow of Array.from(existing.querySelectorAll<HTMLElement>("[data-provider-model-candidate]"))) {
      const id = currentRow.dataset.providerModelCandidate;
      if (!id || !nextIds.has(id)) currentRow.remove();
    }
    for (const nextRow of nextRows) {
      const id = nextRow.dataset.providerModelCandidate;
      if (!id) continue;
      const currentRow = existing.querySelector<HTMLElement>(`[data-provider-model-candidate="${cssEscape(id)}"]`);
      if (!currentRow) {
        existing.append(nextRow);
        continue;
      }
      currentRow.toggleAttribute("hidden", nextRow.hasAttribute("hidden"));
      const currentLabel = currentRow.querySelector("span");
      const nextLabel = nextRow.querySelector("span");
      if (currentLabel && nextLabel) currentLabel.textContent = nextLabel.textContent ?? "";
      const currentButton = currentRow.querySelector<HTMLButtonElement>("[data-action='add-fetched-provider-model']");
      const nextButton = nextRow.querySelector<HTMLButtonElement>("[data-action='add-fetched-provider-model']");
      if (currentButton && nextButton) {
        currentButton.setAttribute("aria-label", nextButton.getAttribute("aria-label") ?? "");
        currentButton.dataset.provider = nextButton.dataset.provider ?? "";
        currentButton.dataset.modelId = nextButton.dataset.modelId ?? "";
      }
    }
  }

  private refreshControls(providerId: string): void {
    this.updateModelListInPlace(providerId);
    this.updateDefaultModelControlInPlace(providerId);
    this.lockMenuHeight(providerId);
    this.updateCandidatesInPlace();
  }

  private updateModelListInPlace(providerId: string): void {
    const provider = this.opts.getProviders()?.[providerId];
    const list = this.opts.root.querySelector<HTMLElement>(`[data-custom-provider="${cssEscape(providerId)}"] .provider-model-list`);
    if (!provider || !list) return;
    const visibleModels = panelVisibleModels(provider);
    list.style.setProperty("--provider-model-list-height", `${providerModelListHeight(visibleModels.length)}px`);
    const template = document.createElement("template");
    setTrustedInnerHTML(template, visibleModels.map((model, index) => this.renderModelRow(providerId, model, index)).join(""));
    const nextRows = Array.from(template.content.querySelectorAll<HTMLElement>("[data-provider-model-row-key]"));
    const nextKeys = new Set(nextRows.map((row) => row.dataset.providerModelRowKey).filter(Boolean));

    for (const currentRow of Array.from(list.querySelectorAll<HTMLElement>("[data-provider-model-row-key]"))) {
      const key = currentRow.dataset.providerModelRowKey;
      if (!key || !nextKeys.has(key)) currentRow.remove();
    }

    nextRows.forEach((nextRow, index) => {
      const key = nextRow.dataset.providerModelRowKey;
      if (!key) return;
      const currentRow = list.querySelector<HTMLElement>(`[data-provider-model-row-key="${cssEscape(key)}"]`);
      if (!currentRow) {
        nextRow.setAttribute("data-entering", "true");
        list.insertBefore(nextRow, list.children[index] ?? null);
        clearMotionAttribute(nextRow, "data-entering", PROVIDER_MODEL_ROW_ENTER_MS);
        return;
      }
      if (currentRow.innerHTML !== nextRow.innerHTML) {
        setTrustedInnerHTML(currentRow, nextRow.innerHTML);
      }
      if (list.children[index] !== currentRow) {
        list.insertBefore(currentRow, list.children[index] ?? null);
      }
    });
  }

  private focusBlankInput(providerId: string): boolean {
    const inputs = Array.from(this.opts.root.querySelectorAll<HTMLInputElement>(`[data-panel-provider-model-id^="${cssEscape(providerId)}."]`));
    const blankInput = inputs.find((input) => input.value.trim() === "");
    if (!blankInput) return false;
    inputs.forEach((input) => input.removeAttribute("data-needs-value"));
    blankInput.setAttribute("data-needs-value", "true");
    blankInput.focus({ preventScroll: true });
    blankInput.select();
    return true;
  }

  private updateDefaultModelControlInPlace(providerId: string): void {
    const provider = this.opts.getProviders()?.[providerId];
    if (!provider) return;
    const existingControl = this.opts.root.querySelector<HTMLElement>(`[data-panel-provider-model="${cssEscape(providerId)}"]`);
    const row = existingControl?.closest(".settings-row");
    if (!(row instanceof HTMLElement)) return;
    const models = panelVisibleModels(provider).filter((model) => model.id.trim());
    const control = models.length
      ? renderSettingsSelect(`providerModel:${providerId}`, provider.selectedModel, models.map((model) => ({
          value: model.id,
          label: model.label || model.id
        })), `data-panel-provider-model="${escapeAttribute(providerId)}"`, "settings-provider-control")
      : `<input class="settings-provider-control" data-panel-provider-model="${escapeAttribute(providerId)}" value="${escapeAttribute(provider.selectedModel)}" placeholder="添加模型后可选择" />`;
    setTrustedInnerHTML(row, `<span>默认模型</span>${control}`);
  }
}

function renderProviderFetchIconStack(): string {
  return `
    <span class="provider-fetch-icon-stack" aria-hidden="true">
      <span class="provider-fetch-icon search">${renderLucideIcon("search")}</span>
      <span class="provider-fetch-icon check">${renderLucideIcon("check")}</span>
      <span class="provider-fetch-icon failure">${renderLucideIcon("x")}</span>
    </span>
  `;
}

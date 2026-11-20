import { renderLucideIcon } from "./panelIcons";
import { escapeAttribute, escapeHtml } from "./htmlEscape";
import type { Settings } from "../shared/types";

export function renderActiveIndicator(isActive: boolean): string {
  return isActive ? `<span class="liquid-option-active-indicator" aria-hidden="true">${renderLucideIcon("check")}</span>` : "";
}

export function renderSettingsSelect(
  key: string,
  selected: string,
  options: Array<{ value: string; label: string }>,
  hiddenAttributes?: string,
  extraClass = ""
): string {
  const matchedOption = options.find((option) => option.value === selected);
  const selectedOption = matchedOption ?? { value: selected, label: "" };
  const summaryLabel = matchedOption ? selectedOption.label : "";
  const inputAttributes = hiddenAttributes ?? `data-panel-setting="${escapeAttribute(key)}"`;
  const className = `settings-select${extraClass ? ` ${extraClass}` : ""}`;
  return `
    <details class="${escapeAttribute(className)}" data-panel-select="${escapeAttribute(key)}">
      <summary class="settings-select-trigger" aria-label="${escapeAttribute(summaryLabel)}">
        <span class="settings-select-label">${escapeHtml(summaryLabel)}</span>
        ${renderLucideIcon("chevron-down")}
      </summary>
      <div class="liquid-menu settings-select-menu" role="menu">
        ${options
          .map((option) => {
            const isActive = option.value === selected;
            return `<button class="liquid-option ${isActive ? "active" : ""}" data-action="panel-select-option" data-setting-key="${escapeAttribute(key)}" data-value="${escapeAttribute(option.value)}" type="button" role="menuitem"><span class="liquid-option-label">${escapeHtml(option.label)}</span>${renderActiveIndicator(isActive)}</button>`;
          })
          .join("")}
      </div>
      <input type="hidden" ${inputAttributes} value="${escapeAttribute(selectedOption.value)}" />
    </details>
  `;
}

export function renderPanelSwitch(
  key: keyof Pick<Settings, "autoSummarize">,
  label: string,
  checked: boolean
): string {
  return `
    <label class="settings-row panel-switch">
      <input type="checkbox" data-panel-setting="${key}" ${checked ? "checked" : ""} />
      <span>${label}</span>
      <span class="switch-control" aria-hidden="true"></span>
    </label>
  `;
}

import { DEEPSEEK_WEB_PROVIDER_ID } from "../shared/deepseekWeb";
import type { ModelThinkingLevel, ProviderId } from "../shared/types";

export interface ThinkingOption {
  value: ModelThinkingLevel;
  label: string;
}

/**
 * 思考等级的界面用词：只描述「要不要先想一遍、想多深」，
 * 不用「开启 / 关闭」这种没有宾语的开关词，也不保留 High / Max 这类英文档名。
 */
const THINKING_OFF_LABEL = "直接回答";
const THINKING_ON_LABEL = "先思考";

export function thinkingOptionsForModel(providerId: ProviderId, modelId: string, thinkingLevels?: ModelThinkingLevel[]): ThinkingOption[] {
  if (providerId === DEEPSEEK_WEB_PROVIDER_ID) {
    return [
      { value: "disabled", label: THINKING_OFF_LABEL },
      { value: "enabled", label: THINKING_ON_LABEL }
    ];
  }

  if (thinkingLevels?.length) {
    return thinkingLevels.map((value) => ({
      value,
      label: thinkingLevelLabel(value)
    }));
  }

  const normalized = modelId.toLowerCase();
  if (normalized === "mimo-v2.5" || normalized === "mimo-v2.5-pro") {
    return [
      { value: "disabled", label: THINKING_OFF_LABEL },
      { value: "enabled", label: THINKING_ON_LABEL }
    ];
  }

  if (normalized === "deepseek-v4-flash" || normalized === "deepseek-v4-pro") {
    return [
      { value: "disabled", label: THINKING_OFF_LABEL },
      { value: "high", label: "深入思考" },
      { value: "max", label: "最深入" }
    ];
  }

  return [];
}

function thinkingLevelLabel(value: ModelThinkingLevel): string {
  if (value === "disabled") return THINKING_OFF_LABEL;
  if (value === "enabled") return THINKING_ON_LABEL;
  if (value === "standard") return "快速思考";
  if (value === "deep") return "深入思考";
  if (value === "extended") return "更深入思考";
  if (value === "high") return "深入思考";
  return "最深入";
}

export function defaultThinkingLevelForModel(modelId: string, options: ThinkingOption[]): ModelThinkingLevel {
  const normalized = modelId.toLowerCase();
  if ((normalized === "mimo-v2.5" || normalized === "mimo-v2.5-pro") && options.some((option) => option.value === "enabled")) {
    return "enabled";
  }
  if ((normalized === "deepseek-v4-flash" || normalized === "deepseek-v4-pro") && options.some((option) => option.value === "high")) {
    return "high";
  }
  return options[0]?.value ?? "standard";
}

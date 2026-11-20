import type { ModelThinkingLevel } from "./types";

const modelThinkingLevelValues = new Set<ModelThinkingLevel>([
  "disabled",
  "enabled",
  "standard",
  "deep",
  "extended",
  "high",
  "max"
]);

export function readModelThinkingLevels(value: unknown): ModelThinkingLevel[] {
  return Array.isArray(value)
    ? value.filter((item): item is ModelThinkingLevel => (
        typeof item === "string" && modelThinkingLevelValues.has(item as ModelThinkingLevel)
      ))
    : [];
}

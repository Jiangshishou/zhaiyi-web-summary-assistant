import type { PageCache } from "../shared/types";
import { prefersReducedMotion } from "./panelDom";

export type SourceSegment = NonNullable<PageCache["source"]["segments"]>[number];
export const MAX_SOURCE_JUMP_SEGMENT_WINDOW = 6;
export const SEGMENT_MATCH_THRESHOLD = 0.28;

export function scrollPageTextIntoView(text: string): void {
  const query = normalizeForMatch(text);
  if (!query || !document.body) return;
  let best: { score: number; element: HTMLElement; weight: number; textLength: number } | undefined;
  for (const candidate of collectSourceJumpCandidates()) {
    const normalizedText = normalizeForMatch(candidate.text);
    const score = matchScore(query, normalizedText);
    if (isBetterSourceJumpCandidate({ score, element: candidate.element, weight: candidate.weight, textLength: normalizedText.length }, best)) {
      best = { score, element: candidate.element, weight: candidate.weight, textLength: normalizedText.length };
    }
  }
  if (best && best.score >= SEGMENT_MATCH_THRESHOLD && typeof best.element.scrollIntoView === "function") {
    best.element.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }
}

function collectSourceJumpCandidates(): Array<{ element: HTMLElement; text: string; weight: number }> {
  const candidates = new Map<HTMLElement, { element: HTMLElement; text: string; weight: number }>();
  const walker = document.createTreeWalker(document.body, 4);
  let node = walker.nextNode();
  while (node) {
    const element = node.parentElement;
    if (element && isSourceJumpCandidateElement(element)) {
      addSourceJumpCandidate(candidates, element, node.textContent ?? "", sourceJumpCandidateWeight(element));
    }
    node = walker.nextNode();
  }

  document.body.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption").forEach((element) => {
    if (isSourceJumpCandidateElement(element)) {
      addSourceJumpCandidate(candidates, element, element.textContent ?? "", sourceJumpCandidateWeight(element));
    }
  });

  document.body.querySelectorAll<HTMLElement>("main, article, section, div").forEach((element) => {
    if (isSourceJumpCandidateElement(element) && !element.querySelector("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption")) {
      addSourceJumpCandidate(candidates, element, element.textContent ?? "", sourceJumpCandidateWeight(element));
    }
  });

  return Array.from(candidates.values());
}

function addSourceJumpCandidate(
  candidates: Map<HTMLElement, { element: HTMLElement; text: string; weight: number }>,
  element: HTMLElement,
  text: string,
  weight: number
): void {
  if (!normalizeForMatch(text)) return;
  const existing = candidates.get(element);
  if (!existing || weight > existing.weight || text.length > existing.text.length) {
    candidates.set(element, { element, text, weight });
  }
}

function isBetterSourceJumpCandidate(
  candidate: { score: number; element: HTMLElement; weight: number; textLength: number },
  best: { score: number; element: HTMLElement; weight: number; textLength: number } | undefined
): boolean {
  if (!best) return true;
  if (candidate.score !== best.score) return candidate.score > best.score;
  if (candidate.weight !== best.weight) return candidate.weight > best.weight;
  return candidate.textLength < best.textLength;
}

export function isBetterSegmentJumpCandidate(
  candidate: { score: number; segment: SourceSegment; textLength: number; windowSize: number },
  best: { score: number; segment: SourceSegment; textLength: number; windowSize: number } | undefined,
  queryLength: number
): boolean {
  if (!best) return true;
  if (candidate.score !== best.score) return candidate.score > best.score;
  const candidateDistance = Math.abs(candidate.textLength - queryLength);
  const bestDistance = Math.abs(best.textLength - queryLength);
  if (candidateDistance !== bestDistance) return candidateDistance < bestDistance;
  if (candidate.windowSize !== best.windowSize) return candidate.windowSize < best.windowSize;
  return candidate.segment.start < best.segment.start;
}

function isSourceJumpCandidateElement(element: HTMLElement): boolean {
  return !element.closest("ym-summary-panel, script, style, noscript") &&
    !element.closest("nav, header, footer, aside, menu, [role='navigation'], [role='menu'], [aria-label*='导航'], [aria-label*='菜单'], [class*='menu'], [id*='menu']") &&
    !isVideoDescriptionCandidate(element) &&
    element !== document.body;
}

function sourceJumpCandidateWeight(element: HTMLElement): number {
  const contentBoost = element.closest("article, main") ? 2 : 0;
  if (element.matches("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption")) return 4 + contentBoost;
  if (element.matches("main, article, section, div")) return 2 + contentBoost;
  return 1;
}

function isVideoDescriptionCandidate(element: HTMLElement): boolean {
  if (!document.querySelector("video")) return false;
  return Boolean(element.closest(
    "#description, [id*='description'], [class*='description'], [id*='desc'], [class*='desc'], ytd-watch-metadata, #meta, .video-desc"
  ));
}

export function matchScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate === query || candidate.includes(query)) return 1;
  if (query.includes(candidate)) return Math.min(0.95, candidate.length / query.length);
  const orderedScore = orderedNGramMatchScore(query, candidate);
  if (orderedScore > 0) return orderedScore;
  const queryUnits = Array.from(new Set(query));
  const candidateSet = new Set(candidate);
  const overlap = queryUnits.filter((char) => candidateSet.has(char)).length;
  return (overlap / queryUnits.length) * 0.25;
}

export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u3400-\u9fff]+/gu, "")
    .trim();
}

export function orderedNGramMatchScore(query: string, candidate: string): number {
  const queryGrams = characterNGrams(query);
  if (queryGrams.length === 0) return 0;
  const candidateGrams = new Set(characterNGrams(candidate));
  const overlap = queryGrams.filter((gram) => candidateGrams.has(gram)).length;
  return overlap / queryGrams.length;
}

function characterNGrams(value: string): string[] {
  if (value.length <= 1) return value ? [value] : [];
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

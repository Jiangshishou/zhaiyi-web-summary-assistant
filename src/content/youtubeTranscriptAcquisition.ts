import { sendRuntimeMessage } from "./sendMessage";
import { findScriptJson } from "./scriptJson";
import { setTrustedInnerHTML } from "./trustedHtml";
import {
  buildTranslatedYouTubeCaptionCandidates,
  buildYouTubeCaptionFetchUrls,
  createYouTubeTranscriptStageDiagnostic,
  extractYouTubeVideoId,
  normalizeYouTubeTranscriptResult,
  parseYouTubeTimedText,
  rankYouTubeCaptionCandidates,
  type YouTubeTranscriptResult,
  type YouTubeTranscriptStageDiagnostic
} from "../shared/youtubeTranscript";
import type { SubtitleSegment } from "../shared/types";

export type YouTubeTranscriptAcquisitionResult = YouTubeTranscriptResult;

type YouTubeAcquisitionStageDiagnostic = YouTubeTranscriptStageDiagnostic;

type YouTubeAcquisitionDiagnostic = {
  pageUrl: string;
  stages: {
    dom_timedtext?: YouTubeAcquisitionStageDiagnostic;
    page_bridge?: YouTubeAcquisitionStageDiagnostic;
    background_fallback?: YouTubeAcquisitionStageDiagnostic;
  };
};

type CachedYouTubeTranscript = {
  expiresAt: number;
  result: YouTubeTranscriptAcquisitionResult;
};

const TRANSCRIPT_CACHE_TTL_MS = 5 * 60 * 1000;
const transcriptCache = new Map<string, CachedYouTubeTranscript>();
const inFlightTranscripts = new Map<string, Promise<YouTubeTranscriptAcquisitionResult | undefined>>();

export async function acquireYouTubeTranscript(
  doc: Document,
  pageUrl: string
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  const videoId = extractYouTubeVideoId(pageUrl);
  if (!videoId) return acquireYouTubeTranscriptUncached(doc, pageUrl);

  const cached = readCachedTranscript(videoId);
  if (cached) return cached;

  const inFlight = inFlightTranscripts.get(videoId);
  if (inFlight) return inFlight;

  const promise = acquireYouTubeTranscriptUncached(doc, pageUrl)
    .then((result) => {
      if (result?.text) cacheTranscript(videoId, result);
      return result;
    })
    .finally(() => {
      inFlightTranscripts.delete(videoId);
    });
  inFlightTranscripts.set(videoId, promise);
  return promise;
}

export function clearYouTubeTranscriptAcquisitionCacheForTests(): void {
  transcriptCache.clear();
  inFlightTranscripts.clear();
}

async function acquireYouTubeTranscriptUncached(
  doc: Document,
  pageUrl: string
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  let pageCaptionTrackFound = false;
  let poTokenCaptionTrackFound = false;
  const diagnostic: YouTubeAcquisitionDiagnostic = { pageUrl, stages: {} };
  const domStartedAt = Date.now();

  try {
    const tracks = await findCaptionTracksFromPage(doc, pageUrl);
    let candidateCount = 0;
    let poTokenSkippedCount = 0;

    for (const track of tracks) {
      pageCaptionTrackFound = true;
      candidateCount += 1;
      if (requiresPoToken(track.baseUrl)) {
        poTokenCaptionTrackFound = true;
        poTokenSkippedCount += 1;
        continue;
      }

      const result = await fetchYouTubeTranscript(track.baseUrl, track.kind === "asr");
      if (result) {
        diagnostic.stages.dom_timedtext = {
          ok: true,
          candidateCount,
          durationMs: elapsedMs(domStartedAt)
        };
        logYouTubeAcquisitionDiagnostic(diagnostic, true);
        return result;
      }
    }

    diagnostic.stages.dom_timedtext = {
      ok: false,
      candidateCount,
      durationMs: elapsedMs(domStartedAt),
      ...(poTokenSkippedCount > 0 && poTokenSkippedCount === candidateCount
        ? { skipped: true, error: "skipped; PoToken-gated caption track" }
        : { error: tracks.length ? "timedtext empty or failed" : "no captionTracks in page scripts" })
    };
  } catch (error) {
    diagnostic.stages.dom_timedtext = {
      ok: false,
      durationMs: elapsedMs(domStartedAt),
      error: error instanceof Error ? error.message : String(error)
    };
    console.warn("[YouMind] youtube: DOM parse threw, falling back to background", error);
  }

  if (pageCaptionTrackFound) {
    if (poTokenCaptionTrackFound) {
      console.warn("[YouMind] youtube: PoToken-gated caption track found, racing background fetch and page bridge");
      return fetchPoTokenGatedFallbackRace(pageUrl, diagnostic);
    }

    console.warn("[YouMind] youtube: page caption track fetch failed, falling back to background fetch");
    const backgroundResult = await fetchBackgroundYouTubeTranscript(pageUrl, diagnostic, false);
    if (backgroundResult) {
      diagnostic.stages.page_bridge = {
        ok: true,
        skipped: true,
        durationMs: 0,
        error: "skipped; background fallback succeeded"
      };
      logYouTubeAcquisitionDiagnostic(diagnostic, true);
      return backgroundResult;
    }

    console.warn("[YouMind] youtube: background fetch failed after page caption track, trying page main-world transcript bridge");
    return fetchPageBridgeYouTubeTranscript(diagnostic);
  }

  console.warn("[YouMind] youtube: DOM parse failed, racing page bridge and background fetch");
  return fetchNoDomCaptionFallbackRace(pageUrl, diagnostic);
}

async function fetchPageBridgeYouTubeTranscript(
  diagnostic: YouTubeAcquisitionDiagnostic,
  logResult = true
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  const pageBridgeStartedAt = Date.now();

  try {
    const { text, segments, isAutoGenerated } = await sendRuntimeMessage({
      type: "YM_FETCH_YOUTUBE_PAGE_TRANSCRIPT"
    });

    const result = normalizeYouTubeTranscriptResult({ text, segments, isAutoGenerated });
    diagnostic.stages.page_bridge = createYouTubeTranscriptStageDiagnostic(pageBridgeStartedAt, {
      ok: Boolean(text),
      ...(text ? {} : { error: "empty page bridge result" })
    });
    if (result) {
      if (logResult) logYouTubeAcquisitionDiagnostic(diagnostic, true);
      return result;
    }
  } catch (error) {
    diagnostic.stages.page_bridge = createYouTubeTranscriptStageDiagnostic(pageBridgeStartedAt, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    console.warn("[YouMind] youtube: main-world bridge failed", error);
  }

  if (logResult) logYouTubeAcquisitionDiagnostic(diagnostic, false);
  return undefined;
}

async function fetchPoTokenGatedFallbackRace(
  pageUrl: string,
  diagnostic: YouTubeAcquisitionDiagnostic
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  const backgroundPromise = fetchBackgroundYouTubeTranscript(pageUrl, diagnostic, false).then((result) => ({
    source: "background" as const,
    result
  }));
  const pageBridgePromise = fetchPageBridgeYouTubeTranscript(diagnostic, false).then((result) => ({
    source: "page_bridge" as const,
    result
  }));

  const first = await Promise.race([backgroundPromise, pageBridgePromise]);
  if (first.result) {
    logYouTubeAcquisitionDiagnostic(diagnostic, true);
    return first.result;
  }

  const second = await (first.source === "background" ? pageBridgePromise : backgroundPromise);
  logYouTubeAcquisitionDiagnostic(diagnostic, Boolean(second.result));
  return second.result;
}

async function fetchNoDomCaptionFallbackRace(
  pageUrl: string,
  diagnostic: YouTubeAcquisitionDiagnostic
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  const pageBridgePromise = fetchPageBridgeYouTubeTranscript(diagnostic, false).then((result) => ({
    source: "page_bridge" as const,
    result
  }));
  const backgroundPromise = fetchBackgroundYouTubeTranscript(pageUrl, diagnostic, false).then((result) => ({
    source: "background" as const,
    result
  }));

  const first = await Promise.race([pageBridgePromise, backgroundPromise]);
  if (first.result) {
    logYouTubeAcquisitionDiagnostic(diagnostic, true);
    return first.result;
  }

  const second = await (first.source === "page_bridge" ? backgroundPromise : pageBridgePromise);
  logYouTubeAcquisitionDiagnostic(diagnostic, Boolean(second.result));
  return second.result;
}

async function fetchBackgroundYouTubeTranscript(
  pageUrl: string,
  diagnostic: YouTubeAcquisitionDiagnostic,
  logResult = true
): Promise<YouTubeTranscriptAcquisitionResult | undefined> {
  const backgroundStartedAt = Date.now();
  try {
    const { text, segments, isAutoGenerated } = await sendRuntimeMessage({
      type: "YM_FETCH_YOUTUBE_SUBTITLE",
      pageUrl
    });

    const result = normalizeYouTubeTranscriptResult({ text, segments, isAutoGenerated });
    diagnostic.stages.background_fallback = createYouTubeTranscriptStageDiagnostic(backgroundStartedAt, {
      ok: Boolean(text),
      ...(text ? {} : { error: "empty background fallback result" })
    });
    if (logResult) logYouTubeAcquisitionDiagnostic(diagnostic, Boolean(text));
    if (result) return result;
  } catch (error) {
    diagnostic.stages.background_fallback = createYouTubeTranscriptStageDiagnostic(backgroundStartedAt, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    console.warn("[YouMind] youtube: background fetch failed", error);
  }

  if (logResult) logYouTubeAcquisitionDiagnostic(diagnostic, false);
  return undefined;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function requiresPoToken(url: string): boolean {
  return /[?&]exp=xp[ev](?:&|$)/u.test(url);
}

function logYouTubeAcquisitionDiagnostic(diagnostic: YouTubeAcquisitionDiagnostic, ok: boolean): void {
  console.info("[YouMind] youtube acquisition diagnostic", { ok, ...diagnostic });
}

function readCachedTranscript(videoId: string): YouTubeTranscriptAcquisitionResult | undefined {
  const cached = transcriptCache.get(videoId);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    transcriptCache.delete(videoId);
    return undefined;
  }
  return cached.result;
}

function cacheTranscript(videoId: string, result: YouTubeTranscriptAcquisitionResult): void {
  transcriptCache.set(videoId, {
    result,
    expiresAt: Date.now() + TRANSCRIPT_CACHE_TTL_MS
  });
}

async function findCaptionTracksFromPage(doc: Document, pageUrl: string): Promise<Array<{ baseUrl: string; kind?: string; languageCode?: string }>> {
  const playerResponse = findScriptJson(doc, "ytInitialPlayerResponse");
  const expectedVideoId = extractYouTubeVideoId(pageUrl);
  const playerVideoId = readPlayerResponseVideoId(playerResponse);
  if (expectedVideoId && playerVideoId && playerVideoId !== expectedVideoId) {
    console.warn("[YouMind] youtube: stale page playerResponse ignored", {
      expectedVideoId,
      playerVideoId
    });
    return [];
  }

  const captions = readRecord(playerResponse)?.captions;
  const renderer = readRecord(readRecord(captions)?.playerCaptionsTracklistRenderer);
  const tracks = readArray(renderer?.captionTracks).map(readRecord).filter(BooleanRecord);

  if (!tracks.length) {
    console.warn("[YouMind] youtube: no captionTracks in page scripts", {
      hasPlayer: Boolean(playerResponse),
      hasCaptions: Boolean(captions)
    });
    return [];
  }

  const nativeTracks = tracks
    .filter((track): track is Record<string, unknown> & { baseUrl: string } => typeof track.baseUrl === "string" && track.baseUrl.trim().length > 0)
    .map((track, index) => ({
      ...track,
      baseUrl: track.baseUrl,
      index,
      kind: typeof track.kind === "string" ? track.kind : undefined,
      languageCode: typeof track.languageCode === "string" ? track.languageCode : undefined,
      isAutoGenerated: track.kind === "asr",
      isTranslatable: track.isTranslatable !== false
    }));
  const translationLanguages = readArray(renderer?.translationLanguages)
    .map(readRecord)
    .filter(BooleanRecord)
    .map((language) => ({
      languageCode: String(language.languageCode ?? ""),
      name: typeof language.name === "string" ? language.name : undefined
    }))
    .filter((language) => language.languageCode);

  return rankYouTubeCaptionCandidates([
    ...nativeTracks,
    ...buildTranslatedYouTubeCaptionCandidates(nativeTracks, translationLanguages)
  ]).map((track) => ({
    baseUrl: track.baseUrl,
    kind: track.kind,
    languageCode: track.languageCode
  }));
}

async function fetchYouTubeTranscript(
  baseUrl: string,
  isAutoGenerated: boolean
): Promise<{ text: string; segments: SubtitleSegment[]; isAutoGenerated: boolean } | undefined> {
  for (const transcriptUrl of buildYouTubeCaptionFetchUrls(baseUrl)) {
    const response = await fetch(transcriptUrl);
    if (!response.ok) {
      console.warn("[YouMind] youtube: transcript fetch failed", response.status, transcriptUrl);
      continue;
    }

    const { text, segments } = parseYouTubeTimedText(await response.text(), decodeHtmlText);
    if (text) return { text, segments, isAutoGenerated };
    console.warn("[YouMind] youtube: transcript parsed empty");
  }

  return undefined;
}

function decodeHtmlText(input: string): string {
  const textarea = document.createElement("textarea");
  setTrustedInnerHTML(textarea, input);
  return textarea.value;
}

function readPlayerResponseVideoId(playerResponse: unknown): string | undefined {
  const root = readRecord(playerResponse);
  const details = readRecord(root?.videoDetails);
  if (typeof details?.videoId === "string") return details.videoId;
  const microformat = readRecord(readRecord(root?.microformat)?.playerMicroformatRenderer);
  if (typeof microformat?.externalVideoId === "string") return microformat.externalVideoId;
  if (typeof microformat?.videoId === "string") return microformat.videoId;
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function BooleanRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

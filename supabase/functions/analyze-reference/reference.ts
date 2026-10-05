export type Level = "low" | "medium" | "high" | "unknown";
export type Analysis = {
  difficulty: "basic" | "medium" | "high";
  summary: string;
  editingSignals: string[];
  confidence: number;
  contentType: "shortform" | "longform" | "unknown";
  estimatedCameraCount: number | null;
  cameraConfidence: number;
  cameraReason: string;
  editingPace: "slow" | "medium" | "fast" | "unknown";
  workFactors: Record<string, Level>;
};

export type VideoInfo = { id: string; title: string; durationSeconds: number | null };
export type ChannelRef = { kind: "handle" | "id" | "custom" | "user"; value: string };
export type Failure = { error: string; status: number; code?: string };

export const SHORTFORM_MAX_SECONDS = 180;
export const CHANNEL_VIDEO_COUNT = 3;
export const CACHE_DAYS = 30;

export function youtubeVideoId(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let id = "";
    if (host === "youtu.be") id = parts[0] || "";
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else if (["shorts", "embed", "live"].includes(parts[0])) id = parts[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

export function youtubeChannelRef(value: unknown): ChannelRef | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts[0]?.startsWith("@") && parts[0].length > 1) {
      return { kind: "handle", value: parts[0] };
    }
    if (parts[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1] || "")) {
      return { kind: "id", value: parts[1] };
    }
    if (parts[0] === "c" && parts[1]) return { kind: "custom", value: parts[1] };
    if (parts[0] === "user" && parts[1]) return { kind: "user", value: parts[1] };
    return null;
  } catch {
    return null;
  }
}

export const factorKeys = [
  "cutDensity", "subtitleDensity", "pointTypography", "inserts", "broll",
  "motionGraphics", "maskingTracking", "zoomReframe", "soundEffects", "musicEditing",
  "color", "research", "multicam",
];
export const levelSchema = { type: "string", enum: ["low", "medium", "high", "unknown"] };

export const structuredSchema = {
  type: "object",
  properties: {
    difficulty: { type: "string", enum: ["basic", "medium", "high"] },
    summary: { type: "string" },
    editingSignals: { type: "array", items: { type: "string" }, maxItems: 8 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    contentType: { type: "string", enum: ["shortform", "longform", "unknown"] },
    estimatedCameraCount: {
      anyOf: [
        { type: "integer", minimum: 1, maximum: 3 },
        { type: "null" },
      ],
    },
    cameraConfidence: { type: "number", minimum: 0, maximum: 1 },
    cameraReason: { type: "string" },
    editingPace: { type: "string", enum: ["slow", "medium", "fast", "unknown"] },
    workFactors: {
      type: "object",
      properties: Object.fromEntries(factorKeys.map((key) => [key, levelSchema])),
      required: factorKeys,
      additionalProperties: false,
    },
  },
  required: [
    "difficulty", "summary", "editingSignals", "confidence", "contentType",
    "estimatedCameraCount", "cameraConfidence", "cameraReason", "editingPace", "workFactors",
  ],
  additionalProperties: false,
};

export function normalizeAnalysis(value: unknown): Analysis | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const pick = <T extends string>(input: unknown, allowed: readonly T[], fallback: T) =>
    allowed.includes(String(input).toLowerCase() as T) ? String(input).toLowerCase() as T : fallback;
  const difficulty = pick(raw.difficulty, ["basic", "medium", "high"] as const, "medium");
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  const camera = Math.round(Number(raw.estimatedCameraCount));
  const clamp = (input: unknown) => Math.min(1, Math.max(0, Number(input) || 0));
  const factors = raw.workFactors && typeof raw.workFactors === "object"
    ? raw.workFactors as Record<string, unknown>
    : {};
  return {
    difficulty,
    summary: raw.summary.trim(),
    editingSignals: Array.isArray(raw.editingSignals)
      ? raw.editingSignals.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    confidence: clamp(raw.confidence),
    contentType: pick(raw.contentType, ["shortform", "longform", "unknown"] as const, "unknown"),
    estimatedCameraCount: camera >= 1 && camera <= 3 ? camera : null,
    cameraConfidence: clamp(raw.cameraConfidence),
    cameraReason: typeof raw.cameraReason === "string" ? raw.cameraReason.trim() : "",
    editingPace: pick(raw.editingPace, ["slow", "medium", "fast", "unknown"] as const, "unknown"),
    workFactors: Object.fromEntries(
      factorKeys.map((key) => [key, pick(factors[key], ["low", "medium", "high", "unknown"] as const, "unknown")]),
    ),
  };
}

// Keeps long references inside the free quota: the opening and a middle sample
// are enough to judge camera setup and editing density. When the length is
// unknown, only the opening five minutes are sent.
export const OPENING_CLIP = { start_offset: "0s", end_offset: "300s" };
export function videoClips(durationSeconds: number | null) {
  if (durationSeconds === null) return [OPENING_CLIP];
  if (durationSeconds <= 360) return [null];
  const middle = Math.floor(durationSeconds / 2);
  return [
    { start_offset: "0s", end_offset: "150s" },
    { start_offset: `${middle - 75}s`, end_offset: `${middle + 75}s` },
  ];
}

export function parseClockDuration(value: string) {
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0) || null;
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

// Reads recent uploads from a public channel tab without an API key.
// Each upload is a lockupViewModel block holding the duration badge, id and title.
export function parseChannelPage(html: string, isShort: boolean): (VideoInfo & { isShort: boolean })[] {
  const videos = new Map<string, VideoInfo & { isShort: boolean }>();
  for (const block of html.split('"lockupViewModel":{').slice(1)) {
    const id = block.match(/"contentId":"([A-Za-z0-9_-]{11})"/)?.[1];
    if (!id || videos.has(id)) continue;
    const clock = block.match(/"text":"(\d{1,2}:\d{2}(?::\d{2})?)"/)?.[1];
    const title = block.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1];
    videos.set(id, {
      id,
      title: title ? decodeJsonString(title) : "",
      durationSeconds: clock ? parseClockDuration(clock) : null,
      isShort,
    });
  }
  if (!videos.size) {
    for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      if (!videos.has(match[1])) videos.set(match[1], { id: match[1], title: "", durationSeconds: null, isShort });
    }
  }
  return [...videos.values()].slice(0, 15);
}

export function parseIsoDuration(value: unknown) {
  const match = String(value || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part) || 0);
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

// Analyze the channel's usual format: the majority type among recent uploads.
export function pickChannelVideos(videos: (VideoInfo & { isShort?: boolean })[], count = CHANNEL_VIDEO_COUNT) {
  const isShort = (video: VideoInfo & { isShort?: boolean }) =>
    video.isShort ?? (video.durationSeconds !== null && video.durationSeconds <= SHORTFORM_MAX_SECONDS);
  const shorts = videos.filter(isShort);
  const longs = videos.filter((video) => !isShort(video));
  const preferred = longs.length >= shorts.length ? longs : shorts;
  return (preferred.length ? preferred : videos).slice(0, count);
}

export const levelRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
export const rankLevel = ["low", "medium", "high"] as const;

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function aggregateAnalyses(results: { video: VideoInfo; analysis: Analysis }[]): Analysis {
  const analyses = results.map((result) => result.analysis);
  const cameraVotes = new Map<number, number>();
  for (const analysis of analyses) {
    if (analysis.estimatedCameraCount) {
      cameraVotes.set(analysis.estimatedCameraCount, (cameraVotes.get(analysis.estimatedCameraCount) || 0) + 1);
    }
  }
  const [camera, votes] = [...cameraVotes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [null, 0];
  const cameraAgreement = analyses.length ? votes / analyses.length : 0;
  const cameraConfidences = analyses
    .filter((analysis) => analysis.estimatedCameraCount === camera)
    .map((analysis) => analysis.cameraConfidence);
  const workFactors = Object.fromEntries(factorKeys.map((key) => {
    const known = analyses.map((analysis) => analysis.workFactors[key]).filter((level) => level in levelRank);
    return [key, known.length ? rankLevel[median(known.map((level) => levelRank[level]))] : "unknown"];
  })) as Record<string, Level>;
  const difficultyRank = { basic: 0, medium: 1, high: 2 } as const;
  const difficulty = (["basic", "medium", "high"] as const)[
    median(analyses.map((analysis) => difficultyRank[analysis.difficulty]))
  ];
  const typeVotes = analyses.map((analysis) => analysis.contentType).filter((type) => type !== "unknown");
  const contentType = typeVotes.length
    ? typeVotes.filter((type) => type === "shortform").length > typeVotes.length / 2 ? "shortform" : "longform"
    : "unknown";
  const paces = analyses.map((analysis) => analysis.editingPace).filter((pace) => pace !== "unknown");
  const paceRank = { slow: 0, medium: 1, fast: 2 } as const;
  const editingPace = paces.length
    ? (["slow", "medium", "fast"] as const)[median(paces.map((pace) => paceRank[pace as keyof typeof paceRank]))]
    : "unknown";
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    difficulty,
    summary: `최근 영상 ${results.length}개 공통 스타일: ` +
      results.map(({ video, analysis }) => `「${video.title.slice(0, 30) || video.id}」 ${analysis.summary}`).join(" / "),
    editingSignals: results.flatMap(({ video, analysis }) =>
      analysis.editingSignals.slice(0, 3).map((signal) => `${video.title.slice(0, 20) || video.id} ${signal}`)
    ).slice(0, 8),
    confidence: Math.round(average(analyses.map((analysis) => analysis.confidence)) * 100) / 100,
    contentType,
    estimatedCameraCount: camera,
    cameraConfidence: camera
      ? Math.round(average(cameraConfidences) * Math.max(0.5, cameraAgreement) * 100) / 100
      : 0,
    cameraReason: camera
      ? `최근 영상 ${analyses.length}개 중 ${votes}개에서 ${camera}캠으로 판단. ` +
        (analyses.find((analysis) => analysis.estimatedCameraCount === camera)?.cameraReason || "")
      : "최근 영상에서 카메라 수를 판단할 근거가 부족합니다.",
    editingPace,
    workFactors,
  };
}

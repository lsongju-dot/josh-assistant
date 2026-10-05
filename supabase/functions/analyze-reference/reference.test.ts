import {
  aggregateAnalyses,
  type Analysis,
  normalizeAnalysis,
  parseChannelPage,
  parseIsoDuration,
  pickChannelVideos,
  videoClips,
  youtubeChannelRef,
  youtubeVideoId,
} from "./reference.ts";

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const factors = (level: string) => Object.fromEntries([
  "cutDensity", "subtitleDensity", "pointTypography", "inserts", "broll",
  "motionGraphics", "maskingTracking", "zoomReframe", "soundEffects", "musicEditing",
  "color", "research", "multicam",
].map((key) => [key, level]));

const analysis = (camera: number | null, level: string, difficulty = "medium") =>
  normalizeAnalysis({
    difficulty,
    summary: "요약",
    editingSignals: ["[00:10] 자막"],
    confidence: 0.8,
    contentType: "longform",
    estimatedCameraCount: camera,
    cameraConfidence: 0.8,
    cameraReason: "정면과 측면 구도",
    editingPace: "medium",
    workFactors: factors(level),
  }) as Analysis;

Deno.test("recognizes video and channel links", () => {
  assertEquals(youtubeVideoId("https://youtu.be/OwwSfFs7E-0"), "OwwSfFs7E-0", "short link");
  assertEquals(youtubeVideoId("https://m.youtube.com/shorts/OwwSfFs7E-0"), "OwwSfFs7E-0", "shorts");
  assertEquals(youtubeVideoId("https://www.youtube.com/@josh"), "", "channel is not a video");
  assertEquals(youtubeChannelRef("https://www.youtube.com/@josh/videos"), { kind: "handle", value: "@josh" }, "handle");
  assertEquals(
    youtubeChannelRef("https://youtube.com/channel/UC1234567890123456789012"),
    { kind: "id", value: "UC1234567890123456789012" },
    "channel id",
  );
  assertEquals(youtubeChannelRef("https://www.youtube.com/c/joshtv"), { kind: "custom", value: "joshtv" }, "custom");
  assertEquals(youtubeChannelRef("https://www.youtube.com/@%EC%A1%B0%EC%89%AC"), { kind: "handle", value: "@조쉬" }, "korean handle");
  assertEquals(youtubeChannelRef("https://www.youtube.com/watch?v=OwwSfFs7E-0"), null, "video is not a channel");
  assertEquals(youtubeChannelRef("https://vimeo.com/@josh"), null, "other host");
});

Deno.test("clips long videos and parses durations", () => {
  assertEquals(parseIsoDuration("PT1H2M3S"), 3723, "iso duration");
  assertEquals(parseIsoDuration("PT45S"), 45, "seconds");
  assertEquals(videoClips(300), [null], "short video is analyzed whole");
  assertEquals(videoClips(null), [{ start_offset: "0s", end_offset: "300s" }], "unknown duration sends the opening");
  assertEquals(videoClips(1200), [
    { start_offset: "0s", end_offset: "150s" },
    { start_offset: "525s", end_offset: "675s" },
  ], "long video clips");
});

Deno.test("picks the channel's majority format", () => {
  const videos = [
    { id: "a", title: "", durationSeconds: 40 },
    { id: "b", title: "", durationSeconds: 900 },
    { id: "c", title: "", durationSeconds: 50 },
    { id: "d", title: "", durationSeconds: 1200 },
    { id: "e", title: "", durationSeconds: 700 },
  ];
  assertEquals(pickChannelVideos(videos).map((video) => video.id), ["b", "d", "e"], "longform channel");
  assertEquals(
    pickChannelVideos(videos.map((video) => ({ ...video, durationSeconds: null, isShort: video.id !== "b" })))
      .map((video) => video.id),
    ["a", "c", "d"],
    "shorts channel from feed",
  );
});

Deno.test("aggregates camera count by vote and factors by median", () => {
  const video = (id: string) => ({ id, title: id, durationSeconds: 600 });
  const result = aggregateAnalyses([
    { video: video("a"), analysis: analysis(2, "high", "high") },
    { video: video("b"), analysis: analysis(2, "medium") },
    { video: video("c"), analysis: analysis(1, "low", "basic") },
  ]);
  assertEquals(result.estimatedCameraCount, 2, "camera vote");
  assertEquals(result.workFactors.motionGraphics, "medium", "median factor");
  assertEquals(result.difficulty, "medium", "median difficulty");
  assertEquals(result.contentType, "longform", "content type");
  assertEquals(result.cameraConfidence, 0.53, "camera confidence scaled by agreement");
});

Deno.test("reads recent uploads from a public channel page", () => {
  const lockup = (id: string, clock: string, title: string) =>
    `"lockupViewModel":{"contentImage":{"overlays":[{"badges":[{"text":"${clock}"}]}]},` +
    `"metadata":{"lockupMetadataViewModel":{"title":{"content":"${title}"}}},"contentId":"${id}"}`;
  const html = `<html>${lockup("pRrmQUm6Zvg", "10:06", "인터뷰 \\\"편집\\\"")}${lockup("wGA27zJEnaU", "1:02:03", "라이브")}</html>`;
  assertEquals(parseChannelPage(html, false), [
    { id: "pRrmQUm6Zvg", title: '인터뷰 "편집"', durationSeconds: 606, isShort: false },
    { id: "wGA27zJEnaU", title: "라이브", durationSeconds: 3723, isShort: false },
  ], "lockups");
  assertEquals(
    parseChannelPage('{"videoId":"OwwSfFs7E-0"}{"videoId":"OwwSfFs7E-0"}', true),
    [{ id: "OwwSfFs7E-0", title: "", durationSeconds: null, isShort: true }],
    "fallback ids",
  );
});

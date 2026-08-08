const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "analyze-reference", "index.ts"),
  "utf8"
);
const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");

function check(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`FAIL ${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`PASS ${label}: ${actual}`);
}

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((source) => source.trim());
scripts.forEach((source) => new Function(source));
check(scripts.length === 1, "single inline app script compiles");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const idSet = new Set(ids);
equal(idSet.size, ids.length, "HTML IDs are unique");

const literalIdReads = [...scripts[0].matchAll(/getElementById\("([^"]+)"\)/g)]
  .map((match) => match[1]);
const missingIdReads = [...new Set(literalIdReads.filter((id) => !idSet.has(id)))];
check(!missingIdReads.length, `all literal DOM IDs exist${missingIdReads.length ? `: ${missingIdReads}` : ""}`);

const labelTargets = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)]
  .map((match) => match[1]);
check(labelTargets.every((id) => idSet.has(id)), "all label targets exist");
const ariaTargets = [...html.matchAll(/\saria-controls="([^"]+)"/g)]
  .map((match) => match[1]);
check(ariaTargets.every((id) => idSet.has(id)), "all aria-controls targets exist");

const appScript = scripts[0].replace(/\n\s*init\(\);[\s\S]*$/, "");
const elements = {
  exchangeRate: { value: "1500" },
  feeRate: { value: "10" },
  longformFinalMinutes: { value: "10" },
  longformCameras: { value: "1" },
  longformScope: { value: "full" },
  hourlyRate: { value: "30000" },
  revisionRounds: { value: "1" },
  shortformFinalSeconds: { value: "60" },
  shortformCount: { value: "1" },
  shortformHours: { value: "1" },
  shortformCameras: { value: "1" },
  referenceFormatMode: { value: "auto" }
};
const documentStub = {
  getElementById(id) {
    return elements[id] || (elements[id] = { value: "", textContent: "" });
  }
};
const localStorageStub = { getItem() { return null; }, setItem() {}, removeItem() {} };
const factory = new Function(
  "window",
  "document",
  "localStorage",
  "navigator",
  `${appScript}\nreturn {
    extractFinalMinutes,
    extractCameraCount,
    extractYouTubeVideoId,
    referenceKeywordAnalysis,
    getLongformQuoteValues,
    adjustedLongformQuote,
    getShortformQuoteValues,
    extractFinalSeconds,
    parseChatgptAnalysisResult,
    countSelectedWorkdays,
    addBusinessDaysAfter,
    toolCostTotal
  };`
);
const app = factory({}, documentStub, localStorageStub, {});

equal(app.extractFinalMinutes("원본 40분 -> 최종본 10분 내외"), 10, "final-minute text parser");
equal(app.extractFinalSeconds("최종본 45초짜리 쇼츠"), 45, "short-form seconds parser");
equal(app.extractCameraCount("두 캠 인터뷰"), 2, "Korean camera text parser");
equal(
  app.extractYouTubeVideoId(new URL("https://youtu.be/K36Et8h552w?si=test")),
  "K36Et8h552w",
  "YouTube short URL parser"
);
equal(
  app.extractYouTubeVideoId(new URL("https://youtu.be/7c1lkYje1f0?si=lJ2h7Q3nbJfwBkze")),
  "7c1lkYje1f0",
  "user YouTube reference URL parser"
);

for (const [camera, expected] of [[1, 180000], [2, 250000], [3, 350000]]) {
  elements.longformCameras.value = String(camera);
  equal(app.getLongformQuoteValues().recommendedQuote, expected, `${camera}cam 10min quote`);
}
elements.longformCameras.value = "3";
equal(
  app.adjustedLongformQuote(app.getLongformQuoteValues(), 1.25, 1, null, 2).recommended,
  438000,
  "second-revision midpoint surcharge"
);
const shortformQuote = app.getShortformQuoteValues(0, 1, 1, 1);
equal(shortformQuote.minimum, 30000, "single short-form minimum quote");
check(shortformQuote.recommended >= 30000, "short-form recommended quote respects minimum");

const chatgptResult = app.parseChatgptAnalysisResult(JSON.stringify({
  difficulty: "medium",
  summary: "전체 자막과 자료 삽입이 확인됨",
  editingSignals: ["전체 자막", "자료 삽입"],
  confidence: 0.8,
  contentType: "shortform",
  estimatedCameraCount: 2,
  cameraConfidence: 0.82,
  cameraReason: "서로 다른 정면과 측면 구도",
  editingPace: "fast",
  needsFrameEvidence: false,
  visualEvidence: {
    camera: ["정면과 측면 구도가 반복됨"],
    broll: ["제품 보조 컷이 삽입됨"],
    graphics: ["자료 화면 캡처가 보임"],
    subtitles: ["전체 말자막과 강조 타이포"],
    motion: ["간단한 줌 리프레임"],
    pacing: ["짧은 컷 전환이 많음"],
    missing: []
  },
  workFactors: {
    cutDensity: "high",
    subtitleDensity: "high",
    pointTypography: "medium",
    inserts: "medium",
    broll: "medium",
    motionGraphics: "low",
    maskingTracking: "unknown",
    zoomReframe: "medium",
    soundEffects: "unknown",
    musicEditing: "unknown",
    color: "medium",
    research: "low",
    multicam: "medium"
  }
}));
equal(chatgptResult.difficultyValue, 1.5, "ChatGPT JSON normalization");
equal(chatgptResult.contentType, "shortform", "ChatGPT content type normalization");
equal(chatgptResult.estimatedCameraCount, 2, "ChatGPT camera estimate normalization");
equal(chatgptResult.needsFrameEvidence, false, "ChatGPT evidence gate normalization");
equal(chatgptResult.visualEvidence.broll[0], "제품 보조 컷이 삽입됨", "ChatGPT visual evidence normalization");
const lowConfidenceResult = app.parseChatgptAnalysisResult(JSON.stringify({
  difficulty: "medium",
  summary: "영상 재생이 불가능해 화면 증거가 필요함",
  editingSignals: ["영상 재생 불가"],
  confidence: 0.12,
  contentType: "unknown",
  estimatedCameraCount: null,
  cameraConfidence: 0.03,
  cameraReason: "프레임을 볼 수 없음",
  editingPace: "unknown",
  needsFrameEvidence: true,
  visualEvidence: {
    camera: [],
    broll: [],
    graphics: [],
    subtitles: [],
    motion: [],
    pacing: [],
    missing: ["대표 프레임 6장 이상 필요", "초반/중반/후반 화면 캡처 필요"]
  },
  workFactors: {
    cutDensity: "unknown",
    subtitleDensity: "unknown",
    pointTypography: "unknown",
    inserts: "unknown",
    broll: "unknown",
    motionGraphics: "unknown",
    maskingTracking: "unknown",
    zoomReframe: "unknown",
    soundEffects: "unknown",
    musicEditing: "unknown",
    color: "unknown",
    research: "unknown",
    multicam: "unknown"
  }
}));
equal(lowConfidenceResult.needsFrameEvidence, true, "low-confidence ChatGPT result requests frame evidence");
equal(lowConfidenceResult.difficultyValue, 1.5, "low-confidence ChatGPT result keeps a provisional price multiplier");
check(lowConfidenceResult.label.includes("보수 추정"), "low-confidence ChatGPT result is labeled provisional");
equal(lowConfidenceResult.visualEvidence.missing.length, 2, "missing evidence is preserved");

const legacyLowConfidenceResult = app.parseChatgptAnalysisResult(JSON.stringify({
  difficulty: "medium",
  summary: "YouTube 영상 페이지와 영상 제목은 확인되지만 실제 영상 재생 및 시간대별 프레임 확인이 불가능해 화면 구성과 편집 스타일을 신뢰성 있게 판정할 수 없습니다.",
  editingSignals: [
    "영상 페이지와 제목 존재는 확인됨",
    "실제 영상 프레임 및 화면 전환 확인 불가",
    "B-roll·그래픽·모션그래픽 사용량 확인 불가"
  ],
  confidence: 0.12,
  contentType: "unknown",
  estimatedCameraCount: null,
  cameraConfidence: 0.03,
  cameraReason: "실제 영상 프레임을 확인할 수 없어 동일 피사체가 서로 다른 촬영 각도나 구도로 등장하는지 비교할 근거가 없습니다.",
  editingPace: "unknown",
  workFactors: {
    cutDensity: "unknown",
    subtitleDensity: "unknown",
    pointTypography: "unknown",
    inserts: "unknown",
    broll: "unknown",
    motionGraphics: "unknown",
    maskingTracking: "unknown",
    zoomReframe: "unknown",
    soundEffects: "unknown",
    musicEditing: "unknown",
    color: "unknown",
    research: "unknown",
    multicam: "unknown"
  }
}));
equal(legacyLowConfidenceResult.needsFrameEvidence, true, "legacy link-only ChatGPT result is evidence-gated");
equal(legacyLowConfidenceResult.difficultyValue, 1.5, "legacy link-only ChatGPT result remains usable as a quote draft");
check(legacyLowConfidenceResult.visualEvidence.missing.length > 0, "legacy link-only result receives missing evidence guidance");
equal(
  app.countSelectedWorkdays(new Date(2026, 7, 3), new Date(2026, 7, 9), "weekdays"),
  5,
  "weekday range calculation"
);
equal(
  (() => {
    const date = app.addBusinessDaysAfter(new Date(2026, 7, 6), 3);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  })(),
  "2026-08-11",
  "business-day deadline calculation"
);
check(Number.isFinite(app.toolCostTotal()) && app.toolCostTotal() > 0, "subscription total is finite");

check(edge.includes('url?: string;'), "Edge Function accepts a public reference URL");
check(edge.includes('Deno.env.get("OPENAI_MODEL")') && edge.includes('"gpt-5.6"'), "public API model fallback is valid");
check(edge.includes("i.ytimg.com") && edge.includes('detail: "high"'), "YouTube representative images use vision input");
check(edge.includes("estimatedCameraCount") && edge.includes("cameraConfidence"), "Edge Function requests camera estimate");
check(edge.includes("contentType") && edge.includes("editingPace"), "Edge Function requests detailed format analysis");
check(!edge.includes("body.frames") && !edge.includes("localMetrics"), "local video frames are not sent by the Edge Function");
check(!scripts[0].includes("requestAiFrameAnalysis"), "client does not send local frames to automatic API analysis");
check(!scripts[0].includes("setTimeout(analyzeReference"), "reference links never auto-trigger API analysis");
check(html.includes('id="subscriptionBudgetLimit"'), "subscription budget control exists");
check(!scripts[0].includes("window.prompt") && !scripts[0].includes("prompt("), "backup and reset do not use prompt dialogs");
check(html.includes('id="backupImportDialog"') && html.includes('id="resetDialog"'), "backup and reset confirmation dialogs exist");
check(html.includes('data-mobile-target="reference"') && html.includes('data-mobile-target="result"'), "mobile quote navigation exists");
check(scripts[0].includes("pendingReferenceSuggestion") && scripts[0].includes("applyPendingReferenceSuggestions"), "reference analysis requires explicit apply");
check(edge.includes("workFactors") && scripts[0].includes("referenceFactorLabels"), "AI work factors are itemized");
check(html.includes('id="referenceEvidenceList"') && scripts[0].includes("renderReferenceEvidence"), "reference visual evidence is displayed");
check(scripts[0].includes("youtubeThumbnailResearchUrls") && scripts[0].includes("maxresdefault.jpg"), "ChatGPT prompt includes public YouTube thumbnail fallback URLs");
check(scripts[0].includes("추천 검색어") && scripts[0].includes("metadata viewer"), "ChatGPT prompt includes public research fallback routes");
check(scripts[0].includes('"needsFrameEvidence"') && scripts[0].includes("보수 추정"), "low-confidence link-only analysis is handled as provisional");
check(edge.includes("visualEvidence") && edge.includes("needsFrameEvidence"), "Edge Function returns visual evidence gate");
check(edge.includes('enum: ["unknown", "basic", "medium", "high"]'), "Edge Function allows unknown only as last-resort difficulty");
check(html.includes("grid-template-columns: repeat(7, minmax(0, 1fr));"), "mobile calendar keeps seven columns");
check(/josh-cache-v\d+/.test(worker), "service worker cache has a version");

console.log("All Josh static regression checks passed.");

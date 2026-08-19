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
    extractDeadlineDate,
    quickReferenceWorkFactors,
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
equal(app.extractCameraCount("3캠 촬영본"), 3, "numeric camera text parser");
equal(
  (() => {
    const date = app.extractDeadlineDate("이번 주 금요일 마감", new Date(2026, 7, 20));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  })(),
  "2026-08-21",
  "relative weekday deadline parser"
);
const quickSignals = app.quickReferenceWorkFactors("유튜브 인터뷰 브이로그", "YouTube", "unknown");
equal(Object.keys(quickSignals.workFactors).length, 13, "quick estimate fills 13 work factors");
equal(quickSignals.contentType, "longform", "YouTube watch defaults to longform estimate");
equal(quickSignals.estimatedCameraCount, 1, "quick estimate uses one-camera assumption");
equal(quickSignals.editingPace, "slow", "quick estimate infers interview pace");
equal(
  app.extractYouTubeVideoId(new URL("https://youtu.be/K36Et8h552w?si=test")),
  "K36Et8h552w",
  "YouTube short URL parser"
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
  editingPace: "fast"
}));
equal(chatgptResult.difficultyValue, 1.5, "ChatGPT JSON normalization");
equal(chatgptResult.contentType, "shortform", "ChatGPT content type normalization");
equal(chatgptResult.estimatedCameraCount, 2, "ChatGPT camera estimate normalization");
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
check(html.includes('id="confirmActionDialog"') && html.includes('id="undoBar"'), "destructive actions support confirmation and undo");
check(html.includes('id="headerAuthButton"'), "authentication state is visible in the header");
check(html.includes('id="baseRatesPanel"') && html.includes('id="shortformMinimumRate"'), "base pricing rules are editable");
check(scripts[0].includes("sourceQuoteId") && scripts[0].includes("quote-period"), "saved quotes connect to calendar periods");
check(scripts[0].includes('confidence: 0.3') && scripts[0].includes('confidence: 0.6'), "reference confidence levels are explicit");
check(html.includes('data-mobile-target="reference"') && html.includes('data-mobile-target="result"'), "mobile quote navigation exists");
check(scripts[0].includes("pendingReferenceSuggestion") && scripts[0].includes("applyPendingReferenceSuggestions"), "reference analysis requires explicit apply");
check(scripts[0].includes("applyReferenceEstimateToControls(analysis, contentType)"), "quick estimate passes keyword analysis to suggestions");
check(scripts[0].includes('analysisMode: "metadata"') && scripts[0].includes("quickReferenceWorkFactors"), "quick estimate metadata mode is labeled and detailed");
check(edge.includes("workFactors") && scripts[0].includes("referenceFactorLabels"), "AI work factors are itemized");
check(html.includes("grid-template-columns: repeat(7, minmax(0, 1fr));"), "mobile calendar keeps seven columns");
check(/josh-cache-v\d+/.test(worker), "service worker cache has a version");

console.log("All Josh static regression checks passed.");

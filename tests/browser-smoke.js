const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const sharp = require(
  "C:/Users/송주/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"
);
const { chromium } = require(
  "C:/Users/송주/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
);

const root = path.resolve(__dirname, "..");
const artifacts = path.join(__dirname, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const ffmpeg = "C:/Users/송주/AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe";

async function createTestVideo(outputPath) {
  const frames = [];
  for (let index = 0; index < 30; index += 1) {
    const background = index % 2 ? "#66734a" : "#f1eee4";
    const foreground = index % 2 ? "#ffffff" : "#28302a";
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
        <rect width="320" height="180" fill="${background}"/>
        <text x="160" y="100" fill="${foreground}" font-size="30" font-family="Arial" font-weight="700" text-anchor="middle">FRAME ${index}</text>
      </svg>`;
    frames.push(await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer());
  }
  const result = spawnSync(ffmpeg, [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "image2pipe",
    "-framerate", "12",
    "-vcodec", "mjpeg",
    "-i", "pipe:0",
    "-an",
    "-c:v", "libvpx",
    "-pix_fmt", "yuv420p",
    "-y",
    outputPath
  ], { input: Buffer.concat(frames), maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`Test video generation failed: ${String(result.stderr)}`);
  }
}

function check(condition, label, detail = "") {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${label}`);
}

let browserInstance;
(async () => {
  const browser = await chromium.launch({ headless: true });
  browserInstance = browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|manifest/i.test(message.text())) {
      pageErrors.push(message.text());
    }
  });

  await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      window.__invokeBodies = [];
      window.supabase = {
        createClient() {
          return {
            auth: {
              getSession: async () => ({ data: { session: null } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signInWithOtp: async () => ({ error: null }),
              signOut: async () => ({ error: null })
            },
            functions: {
              invoke: async (_name, options) => {
                window.__invokeBodies.push(options.body);
                return {
                  data: {
                    analysis: {
                      difficulty: "medium",
                      summary: "큰 자막과 자료 삽입이 확인됩니다.",
                      editingSignals: ["큰 자막", "자료 삽입"],
                      confidence: 0.78,
                      contentType: "shortform",
                      estimatedCameraCount: 2,
                      cameraConfidence: 0.82,
                      cameraReason: "정면과 측면 구도가 반복됩니다.",
                      editingPace: "fast",
                      needsFrameEvidence: false,
                      visualEvidence: {
                        camera: ["정면과 측면 구도가 반복됩니다."],
                        broll: ["제품 보조 컷이 보입니다."],
                        graphics: ["자료 화면이 삽입됩니다."],
                        subtitles: ["큰 자막이 계속 보입니다."],
                        motion: ["간단한 줌 리프레임이 보입니다."],
                        pacing: ["빠른 컷 전환이 보입니다."],
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
                    },
                    frames: [0, 1, 2, 3].map((index) => ({
                      image: "https://i.ytimg.com/vi/7c1lkYje1f0/" + index + ".jpg",
                      label: "대표 장면 " + (index + 1)
                    }))
                  },
                  error: null
                };
              }
            }
          };
        }
      };
    `
  }));
  await page.route("https://www.youtube.com/oembed**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      title: "아직도 영어 학원 찾아다녀? 엄마 맘에 쏙 드는 '캐츠잉글리시!' [리뷰스마][광고]",
      thumbnail_url: "https://i.ytimg.com/vi/7c1lkYje1f0/hqdefault.jpg"
    })
  }));
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  }));
  await page.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>ChatGPT test</title>"
  }));

  await page.goto(pathToFileURL(path.join(root, "index.html")).href, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForSelector("#quickQuotePanel");
  await page.screenshot({ path: path.join(artifacts, "desktop-top.png"), fullPage: false });

  await page.fill(
    "#quickQuoteText",
    "원본 40분을 최종본 10분으로 편집, 3캠, 컷편 포함, 전체 자막, 수정 2회, 예상 작업 10시간, 총 제안 40만원"
  );
  await page.click("#parseQuickQuoteButton");
  check(await page.inputValue("#longformFinalMinutes") === "10", "quick quote final minutes");
  check(await page.inputValue("#longformCameras") === "3", "quick quote camera count");
  check(await page.inputValue("#revisionRounds") === "2", "quick quote revisions");
  check((await page.textContent("#quickQuoteResultTitle")).includes("438,000"), "quick quote result");

  await page.fill(
    "#quickQuoteText",
    "최종본 60초 쇼츠 1편, 1캠, 편당 예상 작업 1시간, 전체 자막"
  );
  await page.click("#parseQuickQuoteButton");
  check(await page.inputValue("#quoteMode") === "shortform", "short-form text selects quote mode");
  check(await page.inputValue("#shortformFinalSeconds") === "60", "short-form seconds applied");
  check((await page.textContent("#shortformMinimumQuote")).includes("30,000"), "short-form minimum quote UI");
  check((await page.textContent("#shortformRecommendedQuote")).includes("30,000") === false, "short-form recommendation uses workload");

  await page.selectOption("#quoteMode", "longform");
  await page.selectOption("#longformCameras", "1");
  await page.fill("#revisionRounds", "1");
  await page.selectOption("#difficulty", "1.25");
  await page.selectOption("#rush", "1");
  await page.evaluate(() => calculate());
  check((await page.textContent("#longformRecommendedQuote")).includes("180,000"), "1cam quote UI");
  await page.selectOption("#longformCameras", "2");
  await page.evaluate(() => calculate());
  check((await page.textContent("#longformRecommendedQuote")).includes("250,000"), "2cam quote UI");
  await page.selectOption("#longformCameras", "3");
  await page.evaluate(() => calculate());
  check((await page.textContent("#longformRecommendedQuote")).includes("350,000"), "3cam quote UI");
  const priceBeforeCondition = await page.textContent("#recommendedQuote");
  await page.selectOption("#condition", "2");
  const priceAfterCondition = await page.textContent("#recommendedQuote");
  check(priceBeforeCondition === priceAfterCondition, "condition changes schedule only, not quote price");
  await page.selectOption("#difficulty", "1.8");
  check((await page.textContent("#recommendedQuote")) !== priceAfterCondition, "difficulty changes quote price");
  await page.selectOption("#rush", "1.2");
  check((await page.textContent("#quoteBasisNote")).includes("납기"), "rush is reflected in quote basis");
  for (const mode of ["longform", "hourly", "highest", "shortform"]) {
    await page.selectOption("#quoteMode", mode);
    check(/\d/.test(await page.textContent("#recommendedQuote")), `${mode} quote mode calculates`);
  }

  check((await page.textContent("#monthlyRevenue")).includes("2,470,000"), "monthly revenue UI");
  await page.click('[data-workspace-tab="manage"]');
  const cashBefore = await page.textContent("#subscriptionCashPreview");
  await page.check('input[aria-label="Envato 사용"]');
  const cashAfter = await page.textContent("#subscriptionCashPreview");
  check(cashBefore !== cashAfter, "subscription checkbox updates cash budget immediately");
  await page.fill("#subscriptionBudgetLimit", "200000");
  check((await page.textContent("#subscriptionBudgetRemaining")) !== "상한 미설정", "subscription budget remaining updates");
  await page.click('[data-workspace-tab="work"]');
  await page.click("#addScheduleButton");
  check((await page.textContent("#scheduleFormStatus")).includes("작업명"), "blank schedule is blocked");
  await page.fill("#scheduleName", "브라우저 테스트 작업");
  await page.fill("#scheduleDeadline", "2026-08-12");
  await page.fill("#scheduleHours", "3");
  await page.click("#addScheduleButton");
  check((await page.textContent("#scheduleList")).includes("브라우저 테스트 작업"), "schedule add UI");

  await page.click('[data-workspace-tab="quote"]');
  await page.fill("#referenceUrl", "");
  await page.click("#analyzeReferenceButton");
  check((await page.textContent("#referenceInputStatus")).includes("먼저 입력"), "blank reference validation");
  await page.fill("#referenceUrl", "not-a-video-link");
  await page.click("#analyzeReferenceButton");
  check((await page.textContent("#referenceInputStatus")).includes("https://"), "invalid reference validation");

  const testVideoPath = path.join(artifacts, "josh-frame-test.webm");
  await createTestVideo(testVideoPath);
  await page.setInputFiles("#referenceVideoFile", testVideoPath);
  try {
    await page.waitForFunction(
      () => document.getElementById("frameAnalysisStatus").textContent.includes("완료"),
      null,
      { timeout: 30_000 }
    );
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      copyState: document.getElementById("copyState").textContent,
      status: document.getElementById("frameAnalysisStatus").textContent,
      progress: document.getElementById("frameAnalysisProgressBar").value
    }));
    throw new Error(`Local video analysis did not finish: ${JSON.stringify(diagnostic)} · ${error.message}`);
  }
  check(await page.locator("#referenceFrameGrid figure").count() >= 2, "local video frame analysis");
  check(
    await page.evaluate(() => referenceAnalysisState?.sourceType === "frame-file"),
    "local video stays on device"
  );

  const referenceUrl = "https://youtu.be/7c1lkYje1f0?si=lJ2h7Q3nbJfwBkze";
  await page.fill("#referenceUrl", referenceUrl);
  await page.evaluate(() => { document.getElementById("useAiFrameAnalysis").checked = false; updateReferenceAnalysisMode(); });
  await page.click("#analyzeReferenceButton");
  await page.waitForFunction(() => !document.getElementById("referenceResult").hidden);
  const generatedPrompt = await page.inputValue("#chatgptPromptText");
  check(generatedPrompt.includes(referenceUrl), "ChatGPT prompt generation", generatedPrompt.slice(0, 240));
  check(generatedPrompt.includes("B-roll") && generatedPrompt.includes('"visualEvidence"'), "ChatGPT prompt asks for detailed visual evidence");
  check(generatedPrompt.includes("7c1lkYje1f0") && generatedPrompt.includes("maxresdefault.jpg"), "ChatGPT prompt includes public YouTube thumbnail fallbacks");
  check(generatedPrompt.includes("needsFrameEvidence") && generatedPrompt.includes("confidence는 0.25~0.45"), "ChatGPT prompt handles inaccessible videos with provisional estimates");
  const popupPromise = page.waitForEvent("popup");
  await page.click("#prepareChatgptAnalysisButton");
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  check(Boolean(popup), "ChatGPT button opens a new tab");
  await popup.close();

  await page.evaluate(() => { authSession = { user: { id: "test-user" } }; });
  await page.evaluate(() => { document.getElementById("useAiFrameAnalysis").checked = true; updateReferenceAnalysisMode(); });
  await page.click("#analyzeReferenceButton");
  await page.waitForFunction(() => document.getElementById("copyState").textContent.includes("AI가 공개 대표 장면"));
  const invokeBodies = await page.evaluate(() => window.__invokeBodies);
  check(invokeBodies.length === 1, "AI link function invoked once");
  check(Object.keys(invokeBodies[0]).sort().join(",") === "title,url", "AI payload contains only public URL and title");
  check(await page.locator("#referenceFrameGrid figure").count() === 4, "AI representative frames rendered");
  check((await page.textContent("#referenceReason")).includes("AI 대표 장면 판독"), "AI analysis rendered");
  check((await page.textContent("#referenceContentType")).includes("숏폼"), "AI content type rendered");
  check((await page.textContent("#referenceCameraCount")).includes("2캠"), "AI camera estimate rendered");
  check((await page.textContent("#referenceEvidenceList")).includes("제품 보조 컷"), "AI visual evidence rendered");
  check(await page.inputValue("#shortformCameras") !== "2", "AI camera estimate does not silently apply");
  check(await page.isVisible("#referenceApplyPanel"), "AI suggestions require confirmation");
  await page.click("#applyReferenceSuggestionsButton");
  check(await page.inputValue("#shortformCameras") === "2", "confirmed AI camera estimate applied");

  await page.selectOption("#difficulty", "1.25");
  await page.fill("#chatgptAnalysisResult", JSON.stringify({
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
  await page.click("#applyChatgptAnalysisButton");
  check(await page.isVisible("#referenceApplyPanel"), "legacy low-confidence ChatGPT result is offered as provisional quote draft");
  check((await page.textContent("#referenceInputStatus")).includes("보수 추정"), "legacy low-confidence ChatGPT result is labeled provisional");
  check((await page.textContent("#referenceEvidenceList")).includes("공개 썸네일"), "legacy low-confidence ChatGPT result asks for thumbnail evidence");
  check(await page.isDisabled("#applyReferenceCamera"), "legacy low-confidence camera estimate cannot be applied");
  check(await page.inputValue("#difficulty") === "1.25", "legacy low-confidence difficulty does not silently apply");
  await page.click("#applyReferenceSuggestionsButton");
  check(await page.inputValue("#difficulty") === "1.5", "confirmed provisional ChatGPT difficulty applies");

  await page.fill("#chatgptAnalysisResult", JSON.stringify({
    difficulty: "high",
    summary: "고급 모션그래픽이 확인됩니다.",
    editingSignals: ["모션그래픽", "B-roll", "포인트 자막"],
    confidence: 0.9,
    contentType: "shortform",
    estimatedCameraCount: 3,
    cameraConfidence: 0.9,
    cameraReason: "세 방향 촬영 구도가 보입니다.",
    editingPace: "fast",
    needsFrameEvidence: false,
    visualEvidence: {
      camera: ["세 방향 촬영 구도가 보입니다."],
      broll: ["제품과 현장 보조 컷이 삽입됩니다."],
      graphics: ["정보 카드와 자료 화면이 보입니다."],
      subtitles: ["포인트 자막과 강조 타이포가 많습니다."],
      motion: ["모션그래픽 전환이 보입니다."],
      pacing: ["짧은 컷 리듬입니다."],
      missing: []
    },
    workFactors: {
      cutDensity: "high",
      subtitleDensity: "high",
      pointTypography: "high",
      inserts: "high",
      broll: "medium",
      motionGraphics: "high",
      maskingTracking: "medium",
      zoomReframe: "medium",
      soundEffects: "unknown",
      musicEditing: "unknown",
      color: "medium",
      research: "medium",
      multicam: "high"
    }
  }));
  await page.click("#applyChatgptAnalysisButton");
  check(await page.inputValue("#difficulty") !== "1.8", "ChatGPT difficulty does not silently apply");
  await page.click("#applyReferenceSuggestionsButton");
  check(await page.inputValue("#difficulty") === "1.8", "confirmed ChatGPT difficulty applies");

  await page.click("#topbarToggleButton");
  await page.click("#exportButton");
  const backupText = await page.evaluate(() => navigator.clipboard?.readText?.().catch(() => ""));
  await page.click("#importButton");
  await page.fill("#backupImportText", "{bad json");
  check((await page.textContent("#backupImportError")).includes("JSON"), "invalid backup shows friendly error");
  await page.fill("#backupImportText", backupText || JSON.stringify({ version: 2, controls: { longformFinalMinutes: "10" }, services: [], schedules: [] }));
  check(!(await page.isDisabled("#applyBackupImportButton")), "backup preview enables apply");
  await page.click("#applyBackupImportButton");
  check(!(await page.isVisible("#backupImportDialog")), "backup applies from modal");
  const scheduleCountBeforeReset = await page.evaluate(() => schedules.length);
  await page.evaluate(() => resetAll());
  check(await page.isVisible("#resetDialog"), "reset opens scope confirmation");
  await page.click("#cancelResetButton");
  check(await page.evaluate(() => schedules.length) === scheduleCountBeforeReset, "cancelled reset preserves schedules");

  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: false });
  await page.locator("#shortformCalculator").screenshot({ path: path.join(artifacts, "desktop-shortform.png") });
  await page.click('[data-workspace-tab="manage"]');
  await page.locator("#servicesPanel").screenshot({ path: path.join(artifacts, "desktop-subscriptions.png") });

  for (const viewport of [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => setWorkspace("quote"));
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobileLayout = await page.evaluate(() => {
      const overflowing = [...document.querySelectorAll(".panel:not([hidden]), button, input, select, textarea")]
        .filter((element) => {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        })
        .map((element) => element.id || element.className)
        .slice(0, 10);
      const touchTargets = [...document.querySelectorAll("button")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return getComputedStyle(element).display !== "none" && rect.width > 0 && rect.height > 0 && rect.height < 44;
        })
        .map((element) => element.id || element.textContent.trim())
        .slice(0, 10);
      return {
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        bottomTabs: [...document.querySelectorAll("[data-mobile-target]")].filter((element) => getComputedStyle(element).display !== "none").length,
        overflowing,
        touchTargets
      };
    });
    check(mobileLayout.width <= mobileLayout.viewport, `${viewport.width}px has no horizontal overflow`, JSON.stringify(mobileLayout));
    check(!mobileLayout.overflowing.length, `${viewport.width}px controls stay inside viewport`, mobileLayout.overflowing.join(", "));
    check(mobileLayout.bottomTabs === 4, `${viewport.width}px mobile tabs visible`);
    check(!mobileLayout.touchTargets.length, `${viewport.width}px touch targets are at least 44px`, mobileLayout.touchTargets.join(", "));
    if (viewport.width === 390) {
      await page.screenshot({ path: path.join(artifacts, "mobile-top.png"), fullPage: false });
    }
  }
  await page.evaluate(() => setWorkspace("work"));
  const calendarLayout = await page.evaluate(() => ({
    columns: getComputedStyle(document.getElementById("calendarGrid")).gridTemplateColumns.split(" ").length,
    headers: [...document.querySelectorAll(".calendar-day-name")].filter((element) => getComputedStyle(element).display !== "none").length
  }));
  check(calendarLayout.columns === 7, "mobile calendar keeps seven columns", JSON.stringify(calendarLayout));
  check(calendarLayout.headers === 7, "mobile calendar keeps weekday headers", JSON.stringify(calendarLayout));
  await page.locator("#calendarPanel").screenshot({ path: path.join(artifacts, "mobile-calendar.png") });

  check(!pageErrors.length, "no browser page errors", pageErrors.join(" | "));
  await browser.close();
  console.log("All Josh browser smoke checks passed.");
})().catch(async (error) => {
  console.error(error);
  if (browserInstance) await browserInstance.close().catch(() => {});
  process.exit(1);
});

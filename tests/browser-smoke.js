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
                      editingPace: "fast"
                    },
                    frames: [0, 1, 2, 3].map((index) => ({
                      image: "https://i.ytimg.com/vi/K36Et8h552w/" + index + ".jpg",
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
      title: "테스트 레퍼런스",
      thumbnail_url: "https://i.ytimg.com/vi/K36Et8h552w/hqdefault.jpg"
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
    "원본 50분을 최종본 12분으로 편집, 3캠, 전체 자막과 기본 색보정, 파생 숏폼 5개 각 50초, 수정은 2회까지, 이번 주 금요일 마감"
  );
  await page.click("#parseQuickQuoteButton");
  check(await page.inputValue("#longformCameras") === "3", "audit parser 3cam");
  check(await page.inputValue("#revisionRounds") === "2", "audit parser revision phrase");
  check(await page.inputValue("#shortformCount") === "5", "audit parser derived short count");
  check(await page.isChecked('[data-task="derivedShorts"]'), "audit parser derived shorts task");
  check(await page.inputValue("#deadline") === "2026-08-21", "audit parser relative Friday deadline");
  check(await page.inputValue("#rush") === "1.5", "audit parser relative deadline rush");
  check((await page.textContent("#quickQuoteChips")).includes("문의에서 읽음"), "parsed and current values are separated");

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
  await page.fill("#longformFinalMinutes", "10");
  await page.selectOption("#longformCameras", "1");
  await page.fill("#revisionRounds", "1");
  await page.selectOption("#difficulty", "1.25");
  await page.selectOption("#rush", "1");
  await page.evaluate(() => calculate());
  check((await page.textContent("#longformRecommendedQuote")).includes("180,000"), "1cam quote UI");
  await page.evaluate(() => {
    document.getElementById("rate1Recommended").value = "20000";
    calculate();
  });
  check((await page.textContent("#longformRecommendedQuote")).includes("200,000"), "editable base rate updates quote immediately");
  await page.evaluate(() => {
    document.getElementById("rate1Recommended").value = "18000";
    calculate();
  });
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
  const breakdown = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#quoteBreakdown .breakdown-row")];
    const amounts = rows.map((row) => {
      const text = row.querySelector("strong").textContent.trim();
      const value = Number(text.replace(/[^0-9]/g, "")) || 0;
      return text.startsWith("-") ? -value : value;
    });
    return { componentTotal: amounts.slice(0, -1).reduce((sum, value) => sum + value, 0), finalTotal: amounts.at(-1) };
  });
  check(breakdown.componentTotal === breakdown.finalTotal, "quote breakdown sums to final recommendation", JSON.stringify(breakdown));
  await page.check('[data-task="derivedShorts"]');
  await page.fill("#shortformCount", "5");
  const customerScope = await page.evaluate(() => buildCustomerQuoteText());
  check(customerScope.includes("파생 숏폼 5편"), "customer quote includes selected derived shorts");
  check(!customerScope.split("\n").find((line) => line.startsWith("제외/별도 협의"))?.includes("파생 숏폼"), "customer quote does not contradict selected tasks");

  await page.selectOption("#quoteMode", "longform");
  await page.fill("#deadline", "2026-08-19");
  await page.click("#copyCustomerQuoteButton");
  check((await page.textContent("#copyState")).includes("차단"), "past deadline blocks customer quote copy");
  check((await page.textContent("#deadlineWarning")).includes("지난 마감일"), "past deadline warning is visible");
  await page.fill("#quoteProjectName", "저장 견적 캘린더 테스트");
  await page.fill("#startDate", "2026-08-20");
  await page.fill("#deadline", "2026-08-25");
  await page.click("#saveQuoteButton");
  check(await page.evaluate(() => schedules.some((item) => item.sourceQuoteId)), "saved quote creates linked schedule");
  check((await page.textContent("#missingInfoList")).includes("일정 겹침"), "overlapping saved quote warns about capacity");
  await page.click('[data-workspace-tab="work"]');
  check((await page.textContent("#calendarGrid")).includes("저장 견적 캘린더 테스트"), "saved quote period appears in calendar");
  await page.click('[data-workspace-tab="quote"]');

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

  const referenceUrl = "https://www.youtube.com/watch?v=K36Et8h552w";
  await page.fill("#referenceUrl", referenceUrl);
  await page.evaluate(() => { document.getElementById("useAiFrameAnalysis").checked = false; updateReferenceAnalysisMode(); });
  await page.click("#analyzeReferenceButton");
  await page.waitForFunction(() => !document.getElementById("referenceResult").hidden);
  check(await page.locator("#referenceFactorList .chip").count() === 13, "quick estimate shows all work factors");
  check(
    (await page.textContent("#referenceFactorList")).includes("빠른 추정"),
    "quick estimate labels factor confidence",
    JSON.stringify(await page.evaluate(() => ({ mode: referenceAnalysisState?.analysisMode, factors: referenceAnalysisState?.workFactors, text: document.getElementById("referenceFactorList").textContent })))
  );
  check((await page.textContent("#referenceCameraCount")).includes("1캠 가정"), "quick estimate exposes one-camera assumption");
  check((await page.textContent("#referencePace")).includes("가정"), "quick estimate exposes pace assumption");
  check(await page.isVisible("#referenceApplyPanel"), "quick estimate suggestions require confirmation");
  check(!(await page.textContent("#referenceDifficultyChange")).includes("유지"), "quick estimate passes difficulty suggestion to apply panel");
  const generatedPrompt = await page.inputValue("#chatgptPromptText");
  check(generatedPrompt.includes(referenceUrl), "ChatGPT prompt generation", generatedPrompt.slice(0, 240));
  const popupPromise = page.waitForEvent("popup");
  await page.click("#prepareChatgptAnalysisButton");
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  check(Boolean(popup), "ChatGPT button opens a new tab");
  await popup.close();

  await page.evaluate(() => { authSession = { user: { id: "test-user", email: "test@example.com" } }; });
  await page.evaluate(() => renderAuthState());
  check((await page.textContent("#headerAuthButton")).includes("연결됨"), "header shows authentication state");
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
  check(await page.inputValue("#shortformCameras") !== "2", "AI camera estimate does not silently apply");
  check(await page.isVisible("#referenceApplyPanel"), "AI suggestions require confirmation");
  await page.click("#applyReferenceSuggestionsButton");
  check(await page.inputValue("#shortformCameras") === "2", "confirmed AI camera estimate applied");

  await page.fill("#chatgptAnalysisResult", JSON.stringify({
    difficulty: "high",
    summary: "고급 모션그래픽이 확인됩니다.",
    editingSignals: ["모션그래픽"],
    confidence: 0.9,
    contentType: "shortform",
    estimatedCameraCount: 3,
    cameraConfidence: 0.9,
    cameraReason: "세 방향 촬영 구도가 보입니다.",
    editingPace: "fast"
  }));
  await page.click("#applyChatgptAnalysisButton");
  check(await page.inputValue("#difficulty") !== "1.8", "ChatGPT difficulty does not silently apply");
  await page.click("#applyReferenceSuggestionsButton");
  check(await page.inputValue("#difficulty") === "1.8", "confirmed ChatGPT difficulty applies");

  await page.click("#topbarToggleButton");
  const presetValueBefore = await page.inputValue("#longformFinalMinutes");
  await page.click("#presetOutsourceButton");
  check(await page.isVisible("#confirmActionDialog"), "preset requires confirmation");
  await page.click("#cancelActionButton");
  check(await page.inputValue("#longformFinalMinutes") === presetValueBefore, "cancelled preset preserves inputs");
  await page.click("#presetOutsourceButton");
  await page.click("#confirmActionButton");
  check(await page.inputValue("#longformFinalMinutes") === "15", "confirmed preset applies");
  await page.click("#undoButton");
  check(await page.inputValue("#longformFinalMinutes") === presetValueBefore, "preset change can be undone");
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

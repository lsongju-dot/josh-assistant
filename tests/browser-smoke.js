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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

  await page.goto(pathToFileURL(path.join(root, "index.html")).href, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForSelector("#quickQuotePanel");

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

  check((await page.textContent("#monthlyRevenue")).includes("2,470,000"), "monthly revenue UI");
  const cashBefore = await page.textContent("#subscriptionCashPreview");
  await page.check('input[aria-label="Envato 사용"]');
  const cashAfter = await page.textContent("#subscriptionCashPreview");
  check(cashBefore !== cashAfter, "subscription checkbox updates cash budget immediately");
  await page.fill("#subscriptionBudgetLimit", "200000");
  check((await page.textContent("#subscriptionBudgetRemaining")) !== "상한 미설정", "subscription budget remaining updates");
  await page.fill("#scheduleName", "브라우저 테스트 작업");
  await page.fill("#scheduleDeadline", "2026-08-12");
  await page.fill("#scheduleHours", "3");
  await page.click("#addScheduleButton");
  check((await page.textContent("#scheduleList")).includes("브라우저 테스트 작업"), "schedule add UI");

  const testVideoPath = path.join(artifacts, "josh-frame-test.webm");
  await createTestVideo(testVideoPath);
  await page.setInputFiles("#referenceVideoFile", testVideoPath);
  try {
    await page.waitForFunction(
      () => document.getElementById("copyState").textContent.includes("프레임을 기기 안에서 판독해 견적에 반영"),
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
  await page.uncheck("#useAiFrameAnalysis");
  await page.click("#analyzeReferenceButton");
  await page.waitForFunction(() => !document.getElementById("referenceResult").hidden);
  const generatedPrompt = await page.inputValue("#chatgptPromptText");
  check(generatedPrompt.includes(referenceUrl), "ChatGPT prompt generation", generatedPrompt.slice(0, 240));

  await page.evaluate(() => { authSession = { user: { id: "test-user" } }; });
  await page.check("#useAiFrameAnalysis");
  await page.click("#analyzeReferenceButton");
  await page.waitForFunction(() => document.getElementById("copyState").textContent.includes("AI가 공개 대표 장면"));
  const invokeBodies = await page.evaluate(() => window.__invokeBodies);
  check(invokeBodies.length === 1, "AI link function invoked once");
  check(Object.keys(invokeBodies[0]).sort().join(",") === "title,url", "AI payload contains only public URL and title");
  check(await page.locator("#referenceFrameGrid figure").count() === 4, "AI representative frames rendered");
  check((await page.textContent("#referenceReason")).includes("AI 대표 장면 판독"), "AI analysis rendered");
  check((await page.textContent("#referenceContentType")).includes("숏폼"), "AI content type rendered");
  check((await page.textContent("#referenceCameraCount")).includes("2캠"), "AI camera estimate rendered");
  check(await page.inputValue("#shortformCameras") === "2", "confident AI camera estimate applied");

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
  check(await page.inputValue("#difficulty") === "1.8", "ChatGPT result applies difficulty");

  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: false });
  await page.locator("#shortformCalculator").screenshot({ path: path.join(artifacts, "desktop-shortform.png") });
  await page.locator("#servicesPanel").screenshot({ path: path.join(artifacts, "desktop-subscriptions.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const mobileLayout = await page.evaluate(() => {
    const y = (id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY;
    const overflowing = [...document.querySelectorAll(".panel, button, input, select, textarea")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .map((element) => element.id || element.className)
      .slice(0, 10);
    return {
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      order: [y("todayPanel"), y("quickQuotePanel"), y("schedulePanel")],
      calendarColumns: getComputedStyle(document.getElementById("calendarGrid")).gridTemplateColumns.split(" ").length,
      visibleDayHeaders: [...document.querySelectorAll(".calendar-day-name")]
        .filter((element) => getComputedStyle(element).display !== "none").length,
      overflowing
    };
  });
  check(mobileLayout.width <= mobileLayout.viewport, "mobile page has no horizontal overflow", JSON.stringify(mobileLayout));
  check(
    mobileLayout.order[0] < mobileLayout.order[1] && mobileLayout.order[1] < mobileLayout.order[2],
    "mobile section order",
    JSON.stringify(mobileLayout.order)
  );
  check(!mobileLayout.overflowing.length, "mobile controls stay inside viewport", mobileLayout.overflowing.join(", "));
  check(mobileLayout.calendarColumns === 7, "mobile calendar keeps seven columns", JSON.stringify(mobileLayout));
  check(mobileLayout.visibleDayHeaders === 7, "mobile calendar keeps weekday headers", JSON.stringify(mobileLayout));
  await page.locator("#quickQuotePanel").screenshot({ path: path.join(artifacts, "mobile-quick-quote.png") });
  await page.locator("#calendarPanel").screenshot({ path: path.join(artifacts, "mobile-calendar.png") });

  check(!pageErrors.length, "no browser page errors", pageErrors.join(" | "));
  await browser.close();
  console.log("All Josh browser smoke checks passed.");
})().catch(async (error) => {
  console.error(error);
  if (browserInstance) await browserInstance.close().catch(() => {});
  process.exit(1);
});

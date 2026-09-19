const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalyzeRequest = {
  title?: string;
  url?: string;
  provider?: "gemini" | "openai";
};

function youtubeVideoId(value: unknown) {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function extractOutputText(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function extractGeminiText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const steps = Array.isArray(response.steps) ? response.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || typeof step !== "object") continue;
    const content = Array.isArray((step as { content?: unknown[] }).content)
      ? (step as { content: unknown[] }).content
      : [];
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const part = content[contentIndex];
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function parseJsonText(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const structuredSchema = {
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
      properties: {
        cutDensity: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        subtitleDensity: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        pointTypography: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        inserts: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        broll: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        motionGraphics: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        maskingTracking: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        zoomReframe: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        soundEffects: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        musicEditing: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        color: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        research: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        multicam: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      },
      required: [
        "cutDensity", "subtitleDensity", "pointTypography", "inserts", "broll",
        "motionGraphics", "maskingTracking", "zoomReframe", "soundEffects", "musicEditing",
        "color", "research", "multicam",
      ],
      additionalProperties: false,
    },
  },
  required: [
    "difficulty", "summary", "editingSignals", "confidence", "contentType",
    "estimatedCameraCount", "cameraConfidence", "cameraReason", "editingPace", "workFactors",
  ],
  additionalProperties: false,
};

const analysisPrompt = (title: string) => [
  "당신은 한국 영상 편집 외주 견적을 산정하는 시니어 포스트프로덕션 디렉터다.",
  "입력 영상의 실제 영상과 오디오를 전체적으로 확인하고, 화면에 보이는 편집 작업량을 평가한다.",
  "썸네일이나 제목만으로 단정하지 말고 영상 속 근거를 우선한다.",
  "판단 요소: 컷 밀도, 자막과 타이포그래피, 자료·사진·B-roll 삽입, 모션그래픽, 마스킹·트래킹, 줌·리프레임, 효과음, 음악 편집, 색보정, 자료조사, 멀티캠 전환.",
  "서로 다른 촬영 구도나 각도가 반복적으로 보이고 같은 장면을 다른 시점에서 촬영한 근거가 있을 때만 1~3캠으로 추정한다. 화면 크롭이나 디지털 줌은 별도 카메라로 세지 않는다.",
  "editingSignals에는 가능하면 [mm:ss] 형식의 영상 시점과 함께 실제로 확인한 편집 근거를 8개 이내로 작성한다.",
  "영상 전체를 확인해도 확정할 수 없는 값은 unknown 또는 null로 두고 confidence를 낮춘다. 원본 촬영 길이와 실제 의뢰 범위는 영상만으로 확정하지 않는다.",
  "difficulty는 basic, medium, high 중 하나다. summary와 editingSignals는 한국어로 작성한다.",
  `영상 제목: ${title.slice(0, 200)}`,
  `반드시 아래 JSON 구조만 반환한다: ${JSON.stringify(structuredSchema)}`,
].join("\n");

async function analyzeWithGemini(key: string, model: string, title: string, url: string) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { type: "video", uri: url, processing: "agentic" },
        { type: "text", text: analysisPrompt(title) },
      ],
    }),
  });
  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    return { error: "Gemini가 읽을 수 없는 응답을 반환했습니다.", status: 502 };
  }
  if (!response.ok) {
    const message = body.error && typeof body.error === "object"
      ? String((body.error as { message?: unknown }).message || "")
      : "";
    return { error: message || "Gemini 영상 분석에 실패했습니다.", status: response.status };
  }
  const outputText = extractGeminiText(body);
  const analysis = parseJsonText(outputText);
  if (!analysis || typeof analysis !== "object") {
    return { error: "Gemini가 구조화된 분석 결과를 반환하지 않았습니다.", status: 502 };
  }
  return { analysis, model, sourceMode: "youtube-public-video-gemini" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!request.headers.get("Authorization")) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const videoId = youtubeVideoId(body.url);
  if (!videoId) {
    return jsonResponse({ error: "A supported public YouTube URL is required" }, 400);
  }

  if (body.provider === "gemini") {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return jsonResponse({
        error: "GEMINI_API_KEY가 설정되지 않았습니다. Supabase 함수 비밀 설정에 추가해주세요.",
        code: "GEMINI_NOT_CONFIGURED",
      }, 503);
    }
    const geminiModel = String(Deno.env.get("GEMINI_MODEL") || "gemini-3.7-flash").trim();
    const result = await analyzeWithGemini(
      geminiKey,
      geminiModel,
      String(body.title || "레퍼런스 영상"),
      body.url as string,
    );
    if (result.error) return jsonResponse(result, result.status || 502);
    return jsonResponse(result);
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 503);
  }

  const publicFrames = ["0", "1", "2", "3"].map((slot) =>
    `https://i.ytimg.com/vi/${videoId}/${slot}.jpg`
  );

  const prompt = [
    "당신은 한국 영상 편집 외주 견적을 산정하는 시니어 포스트프로덕션 디렉터다.",
    "입력 이미지는 공개 YouTube 링크의 서로 다른 대표 장면이다. 영상 전체나 오디오가 아니므로 실제로 보이는 시각 요소만 판단한다.",
    "판단 요소: 모션그래픽, 합성, 마스킹, 화면 분할, 자막·타이포그래피 밀도, 스톡 자료 사용량,",
    "색보정 난도, 전환 빈도, 제품 광고 연출, AI/VFX 흔적, 반복 제작 부담.",
    "세로형 숏폼인지 가로형 롱폼인지 contentType으로 분류한다.",
    "서로 다른 구도와 촬영 각도가 실제로 보일 때만 원본 카메라 수를 1~3캠으로 추정한다.",
    "컷 수, 화면 자료, 크롭 변화는 별도 카메라로 세지 않는다. 근거가 부족하면 estimatedCameraCount는 null로 둔다.",
    "보이지 않는 오디오 상태, 원본 촬영 길이, 정확한 컷 빈도는 추측하지 않는다.",
    "difficulty는 basic, medium, high 중 하나다.",
    `영상 제목: ${String(body.title || "레퍼런스 영상").slice(0, 200)}`,
    "대표 장면만으로 확정할 수 없는 요소가 많으면 confidence를 낮춘다.",
    "summary와 editingSignals는 한국어로 작성한다.",
    "workFactors는 컷 밀도, 자막, 자료 삽입, B-roll, 모션, 마스킹, 리프레임, 효과음, 음악, 색보정, 조사, 멀티캠의 화면상 근거를 low/medium/high/unknown으로 나눠 작성한다.",
  ].join("\n");

  const content = [
    { type: "input_text", text: prompt },
    ...publicFrames.map((imageUrl) => ({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    })),
  ];

  const configuredModel = String(Deno.env.get("OPENAI_MODEL") || "").trim();
  const model = configuredModel === "gpt-5.6-luna"
    ? "gpt-5.6"
    : configuredModel || "gpt-5.6";
  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "video_editing_frame_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              difficulty: {
                type: "string",
                enum: ["basic", "medium", "high"],
              },
              summary: {
                type: "string",
              },
              editingSignals: {
                type: "array",
                items: { type: "string" },
                maxItems: 6,
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              contentType: {
                type: "string",
                enum: ["shortform", "longform", "unknown"],
              },
              estimatedCameraCount: {
                anyOf: [
                  { type: "integer", minimum: 1, maximum: 3 },
                  { type: "null" },
                ],
              },
              cameraConfidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              cameraReason: {
                type: "string",
              },
              editingPace: {
                type: "string",
                enum: ["slow", "medium", "fast", "unknown"],
              },
              workFactors: {
                type: "object",
                properties: {
                  cutDensity: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  subtitleDensity: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  pointTypography: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  inserts: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  broll: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  motionGraphics: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  maskingTracking: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  zoomReframe: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  soundEffects: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  musicEditing: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  color: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  research: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  multicam: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                },
                required: [
                  "cutDensity", "subtitleDensity", "pointTypography", "inserts", "broll",
                  "motionGraphics", "maskingTracking", "zoomReframe", "soundEffects", "musicEditing",
                  "color", "research", "multicam",
                ],
                additionalProperties: false,
              },
            },
            required: [
              "difficulty",
              "summary",
              "editingSignals",
              "confidence",
              "contentType",
              "estimatedCameraCount",
              "cameraConfidence",
              "cameraReason",
              "editingPace",
              "workFactors",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  let openAiBody: Record<string, unknown>;
  try {
    openAiBody = await openAiResponse.json();
  } catch {
    return jsonResponse({ error: "OpenAI returned an unreadable response" }, 502);
  }
  if (!openAiResponse.ok) {
    const apiMessage = openAiBody.error && typeof openAiBody.error === "object"
      ? String((openAiBody.error as { message?: unknown }).message || "")
      : "";
    return jsonResponse({
      error: apiMessage || "OpenAI frame analysis failed",
      status: openAiResponse.status,
    }, 502);
  }

  const outputText = extractOutputText(openAiBody);
  if (!outputText) {
    return jsonResponse({ error: "OpenAI returned no structured output" }, 502);
  }

  try {
    return jsonResponse({
      analysis: JSON.parse(outputText),
      sourceMode: "youtube-public-thumbnails",
      frames: publicFrames.map((image, index) => ({
        image,
        label: `대표 장면 ${index + 1}`,
      })),
      model,
    });
  } catch {
    return jsonResponse({ error: "OpenAI returned invalid structured output" }, 502);
  }
});

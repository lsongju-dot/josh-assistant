const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalyzeRequest = {
  title?: string;
  frames?: string[];
  localMetrics?: {
    sceneChange?: number;
    detailDensity?: number;
    contrast?: number;
    saturation?: number;
  };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function validFrame(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/jpeg;base64,") &&
    value.length <= 500_000
  );
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

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 503);
  }

  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const frames = Array.isArray(body.frames)
    ? body.frames.filter(validFrame).slice(0, 6)
    : [];
  if (frames.length < 2) {
    return jsonResponse({ error: "At least two valid frames are required" }, 400);
  }

  const metrics = body.localMetrics || {};
  const prompt = [
    "당신은 한국 영상 편집 외주 견적을 산정하는 시니어 포스트프로덕션 디렉터다.",
    "시간순으로 추출된 레퍼런스 프레임을 직접 비교해 화면에 실제로 보이는 편집 난도를 판단한다.",
    "판단 요소: 모션그래픽, 합성, 마스킹, 화면 분할, 자막·타이포그래피 밀도, 스톡 자료 사용량,",
    "색보정 난도, 전환 빈도, 제품 광고 연출, AI/VFX 흔적, 반복 제작 부담.",
    "보이지 않는 오디오 상태나 원본 촬영 길이는 추측하지 않는다.",
    "difficulty는 basic, medium, high 중 하나다.",
    `영상 제목: ${String(body.title || "레퍼런스 영상").slice(0, 200)}`,
    `기기 측 수치: 장면 변화 ${Number(metrics.sceneChange || 0).toFixed(3)}, ` +
      `화면 디테일 ${Number(metrics.detailDensity || 0).toFixed(3)}, ` +
      `대비 ${Number(metrics.contrast || 0).toFixed(1)}, ` +
      `색 밀도 ${Number(metrics.saturation || 0).toFixed(3)}`,
    "summary와 editingSignals는 한국어로 작성한다.",
  ].join("\n");

  const content = [
    { type: "input_text", text: prompt },
    ...frames.map((imageUrl) => ({
      type: "input_image",
      image_url: imageUrl,
      detail: "low",
    })),
  ];

  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna",
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
            },
            required: ["difficulty", "summary", "editingSignals", "confidence"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const openAiBody = await openAiResponse.json();
  if (!openAiResponse.ok) {
    return jsonResponse({
      error: "OpenAI frame analysis failed",
      status: openAiResponse.status,
    }, 502);
  }

  const outputText = extractOutputText(openAiBody);
  if (!outputText) {
    return jsonResponse({ error: "OpenAI returned no structured output" }, 502);
  }

  try {
    return jsonResponse({ analysis: JSON.parse(outputText) });
  } catch {
    return jsonResponse({ error: "OpenAI returned invalid structured output" }, 502);
  }
});

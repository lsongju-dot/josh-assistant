import {
  aggregateAnalyses,
  type Analysis,
  CACHE_DAYS,
  type ChannelRef,
  type Failure,
  median,
  normalizeAnalysis,
  parseIsoDuration,
  pickChannelVideos,
  structuredSchema,
  type VideoInfo,
  OPENING_CLIP,
  parseChannelPage,
  videoClips,
  youtubeChannelRef,
  youtubeVideoId,
} from "./reference.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalyzeRequest = {
  title?: string;
  url?: string;
  provider?: "gemini" | "openai";
  query?: string;
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
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const parts = (candidates[0] as { content?: { parts?: unknown[] } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (part && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("");
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

const analysisPrompt = (title: string, clipped: boolean) => [
  "당신은 한국 영상 편집 외주 견적을 산정하는 시니어 포스트프로덕션 디렉터다.",
  clipped
    ? "입력은 영상의 앞부분과 중간 일부 구간이다. 주어진 구간의 실제 영상과 오디오를 확인하고, 화면에 보이는 편집 작업량을 평가한다."
    : "입력 영상의 실제 영상과 오디오를 전체적으로 확인하고, 화면에 보이는 편집 작업량을 평가한다.",
  "썸네일이나 제목만으로 단정하지 말고 영상 속 근거를 우선한다.",
  "판단 요소: 컷 밀도, 자막과 타이포그래피, 자료·사진·B-roll 삽입, 모션그래픽, 마스킹·트래킹, 줌·리프레임, 효과음, 음악 편집, 색보정, 자료조사, 멀티캠 전환.",
  "서로 다른 촬영 구도나 각도가 반복적으로 보이고 같은 장면을 다른 시점에서 촬영한 근거가 있을 때만 1~3캠으로 추정한다. 화면 크롭이나 디지털 줌은 별도 카메라로 세지 않는다.",
  "editingSignals에는 가능하면 [mm:ss] 형식의 영상 시점과 함께 실제로 확인한 편집 근거를 8개 이내로 작성한다.",
  "확정할 수 없는 값은 unknown 또는 null로 두고 confidence를 낮춘다. 원본 촬영 길이와 실제 의뢰 범위는 영상만으로 확정하지 않는다.",
  "difficulty는 basic, medium, high 중 하나다. summary와 editingSignals는 한국어로 작성한다.",
  `영상 제목: ${title.slice(0, 200)}`,
  `반드시 아래 JSON 구조만 반환한다: ${JSON.stringify(structuredSchema)}`,
].join("\n");

function geminiModels() {
  const primary = String(Deno.env.get("GEMINI_MODEL") || "gemini-3.7-flash").trim();
  const fallbacks = String(Deno.env.get("GEMINI_FALLBACK_MODELS") || "gemini-flash-latest,gemini-2.5-flash")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

const retryableStatus = new Set([429, 500, 503, 504]);

async function callGemini(
  key: string,
  model: string,
  video: VideoInfo,
  title: string,
  clips: ({ start_offset: string; end_offset: string } | null)[],
) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const parts: Record<string, unknown>[] = clips.map((clip) =>
    clip
      ? { file_data: { file_uri: watchUrl }, video_metadata: clip }
      : { file_data: { file_uri: watchUrl } }
  );
  parts.push({ text: analysisPrompt(title, clips[0] !== null) });
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          temperature: 0.2,
        },
      }),
    },
  );
  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    return { error: "Gemini가 읽을 수 없는 응답을 반환했습니다.", status: 502 } as Failure;
  }
  if (!response.ok) {
    const message = body.error && typeof body.error === "object"
      ? String((body.error as { message?: unknown }).message || "")
      : "";
    return { error: message || "Gemini 영상 분석에 실패했습니다.", status: response.status } as Failure;
  }
  const analysis = normalizeAnalysis(parseJsonText(extractGeminiText(body)));
  if (!analysis) {
    return { error: "Gemini가 구조화된 분석 결과를 반환하지 않았습니다.", status: 502 } as Failure;
  }
  return { analysis, model };
}

async function analyzeVideoWithGemini(key: string, video: VideoInfo, title: string) {
  let lastFailure: Failure = { error: "Gemini 영상 분석에 실패했습니다.", status: 502 };
  let clips = videoClips(video.durationSeconds);
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let result = await callGemini(key, model, video, title, clips);
      // A short video of unknown length can reject the five-minute opening clip.
      if ("error" in result && result.status === 400 && clips[0] === OPENING_CLIP) {
        clips = [null];
        result = await callGemini(key, model, video, title, clips);
      }
      if (!("error" in result)) return result;
      lastFailure = result;
      if (!retryableStatus.has(result.status)) return result;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }
  return {
    ...lastFailure,
    error: `Gemini 모델이 모두 혼잡합니다. 잠시 후 다시 시도해주세요. (${lastFailure.error})`,
    code: "GEMINI_BUSY",
  } as Failure;
}

async function youtubeApi(path: string, params: Record<string, string>) {
  const key = Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return null;
  const query = new URLSearchParams({ ...params, key });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`);
  if (!response.ok) return null;
  try {
    return await response.json() as { items?: Record<string, unknown>[] };
  } catch {
    return null;
  }
}

async function videoDetails(ids: string[]): Promise<Map<string, VideoInfo>> {
  const details = new Map<string, VideoInfo>();
  if (!ids.length) return details;
  const data = await youtubeApi("videos", { part: "snippet,contentDetails", id: ids.join(",") });
  for (const item of data?.items || []) {
    const id = String(item.id || "");
    const snippet = item.snippet as { title?: string } | undefined;
    const contentDetails = item.contentDetails as { duration?: string } | undefined;
    details.set(id, {
      id,
      title: String(snippet?.title || ""),
      durationSeconds: parseIsoDuration(contentDetails?.duration),
    });
  }
  return details;
}

async function resolveChannelWithApi(ref: ChannelRef) {
  const params: Record<string, string> = { part: "snippet,contentDetails" };
  if (ref.kind === "handle") params.forHandle = ref.value;
  else if (ref.kind === "id") params.id = ref.value;
  else if (ref.kind === "user") params.forUsername = ref.value;
  else return null;
  const data = await youtubeApi("channels", params);
  const item = data?.items?.[0];
  if (!item) return null;
  const uploads = (item.contentDetails as { relatedPlaylists?: { uploads?: string } } | undefined)
    ?.relatedPlaylists?.uploads;
  if (!uploads) return null;
  const playlist = await youtubeApi("playlistItems", {
    part: "contentDetails",
    playlistId: uploads,
    maxResults: "15",
  });
  const ids = (playlist?.items || [])
    .map((entry) => String((entry.contentDetails as { videoId?: string } | undefined)?.videoId || ""))
    .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id));
  const details = await videoDetails(ids);
  return {
    id: String(item.id || ""),
    title: String((item.snippet as { title?: string } | undefined)?.title || ""),
    videos: ids.map((id) => details.get(id) || { id, title: "", durationSeconds: null }),
  };
}

// Without a Data API key: read recent uploads (id, title, length) from the public channel tabs.
async function resolveChannelFromPage(ref: ChannelRef) {
  const base = ref.kind === "handle"
    ? ref.value
    : ref.kind === "id"
    ? `channel/${ref.value}`
    : `${ref.kind === "custom" ? "c" : "user"}/${ref.value}`;
  const read = async (tab: "videos" | "shorts") => {
    const page = await fetch(`https://www.youtube.com/${encodeURI(base)}/${tab}`, {
      headers: { "Accept-Language": "ko,en;q=0.8", "User-Agent": "Mozilla/5.0" },
    });
    return page.ok ? await page.text() : "";
  };
  const videosPage = await read("videos");
  let videos = parseChannelPage(videosPage, false);
  if (!videos.length) videos = parseChannelPage(await read("shorts"), true);
  const channelId = videosPage.match(/"(?:externalId|channelId)":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || "";
  const title = videosPage.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || ref.value;
  return videos.length ? { id: channelId, title, videos } : null;
}

// Finds a channel by the name a client mentioned (e.g. "유튜브 '임대표의 식탁' 검색").
async function searchChannel(query: string): Promise<ChannelRef | null> {
  const search = new URLSearchParams({ search_query: query, sp: "EgIQAg==" });
  const page = await fetch(`https://www.youtube.com/results?${search}`, {
    headers: { "Accept-Language": "ko,en;q=0.8", "User-Agent": "Mozilla/5.0" },
  });
  if (!page.ok) return null;
  const html = await page.text();
  const handle = html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/)?.[1];
  if (handle) {
    try {
      return { kind: "handle", value: decodeURIComponent(handle) };
    } catch {
      return { kind: "handle", value: handle };
    }
  }
  const channelId = html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1];
  return channelId ? { kind: "id", value: channelId } : null;
}

function serviceHeaders() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

async function cachedAnalysis(videoId: string) {
  const service = serviceHeaders();
  if (!service) return null;
  try {
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
    const response = await fetch(
      `${service.url}/rest/v1/reference_analysis_cache?video_id=eq.${videoId}&created_at=gte.${since}&select=analysis,model`,
      { headers: service.headers },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    const analysis = normalizeAnalysis(rows?.[0]?.analysis);
    return analysis ? { analysis, model: String(rows[0].model || "") } : null;
  } catch {
    return null;
  }
}

async function storeAnalysis(videoId: string, analysis: Analysis, model: string) {
  const service = serviceHeaders();
  if (!service) return;
  try {
    await fetch(`${service.url}/rest/v1/reference_analysis_cache`, {
      method: "POST",
      headers: { ...service.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ video_id: videoId, analysis, model, created_at: new Date().toISOString() }),
    });
  } catch {
    // The cache is optional; analysis results are still returned.
  }
}

async function analyzeVideo(geminiKey: string, video: VideoInfo, title: string) {
  const cached = await cachedAnalysis(video.id);
  if (cached) return { ...cached, cached: true };
  const result = await analyzeVideoWithGemini(geminiKey, video, title);
  if ("error" in result) return result;
  await storeAnalysis(video.id, result.analysis, result.model);
  return { ...result, cached: false };
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const apikey = request.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!/^Bearer\s+\S+/.test(authorization) || !supabaseUrl || !apikey) return null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

async function analyzeWithOpenAI(videoId: string, title: string) {
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 503);
  const publicFrames = ["0", "1", "2", "3"].map((slot) => `https://i.ytimg.com/vi/${videoId}/${slot}.jpg`);
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
    `영상 제목: ${title.slice(0, 200)}`,
    "대표 장면만으로 확정할 수 없는 요소가 많으면 confidence를 낮춘다.",
    "summary와 editingSignals는 한국어로 작성한다.",
    "workFactors는 컷 밀도, 자막, 자료 삽입, B-roll, 모션, 마스킹, 리프레임, 효과음, 음악, 색보정, 조사, 멀티캠의 화면상 근거를 low/medium/high/unknown으로 나눠 작성한다.",
  ].join("\n");
  const configuredModel = String(Deno.env.get("OPENAI_MODEL") || "").trim();
  const model = configuredModel === "gpt-5.6-luna" ? "gpt-5.6" : configuredModel || "gpt-5.6";
  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...publicFrames.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" })),
        ],
      }],
      text: {
        format: { type: "json_schema", name: "video_editing_frame_analysis", strict: true, schema: structuredSchema },
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
    return jsonResponse({ error: apiMessage || "OpenAI frame analysis failed", status: openAiResponse.status }, 502);
  }
  const outputText = extractOutputText(openAiBody);
  if (!outputText) return jsonResponse({ error: "OpenAI returned no structured output" }, 502);
  try {
    return jsonResponse({
      analysis: JSON.parse(outputText),
      sourceMode: "youtube-public-thumbnails",
      frames: publicFrames.map((image, index) => ({ image, label: `대표 장면 ${index + 1}` })),
      model,
    });
  } catch {
    return jsonResponse({ error: "OpenAI returned invalid structured output" }, 502);
  }
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!await authenticatedUser(request)) {
    return jsonResponse({ error: "로그인한 사용자만 영상 분석을 사용할 수 있습니다.", code: "AUTH_REQUIRED" }, 401);
  }

  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const videoId = youtubeVideoId(body.url);
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 60) : "";
  const channelRef = videoId
    ? null
    : youtubeChannelRef(body.url) || (query.length >= 2 ? await searchChannel(query) : null);
  if (!videoId && !channelRef) {
    return jsonResponse({ error: "공개 YouTube 영상·채널 링크가 필요하거나, 채널을 찾지 못했습니다." }, 400);
  }
  const title = String(body.title || "레퍼런스 영상");

  if (body.provider === "openai" && videoId) return await analyzeWithOpenAI(videoId, title);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return jsonResponse({
      error: "GEMINI_API_KEY가 설정되지 않았습니다. Supabase 함수 비밀 설정에 추가해주세요.",
      code: "GEMINI_NOT_CONFIGURED",
    }, 503);
  }

  if (videoId) {
    const video = (await videoDetails([videoId])).get(videoId) || { id: videoId, title, durationSeconds: null };
    const result = await analyzeVideo(geminiKey, video, video.title || title);
    if ("error" in result) return jsonResponse(result, result.status || 502);
    return jsonResponse({
      analysis: result.analysis,
      model: result.model,
      cached: result.cached,
      sourceMode: "youtube-public-video-gemini",
      video,
      durationSeconds: video.durationSeconds,
    });
  }

  const channel = (await resolveChannelWithApi(channelRef!)) || (await resolveChannelFromPage(channelRef!));
  if (!channel || !channel.videos.length) {
    return jsonResponse({
      error: Deno.env.get("YOUTUBE_API_KEY")
        ? "채널의 공개 영상을 찾지 못했습니다. 영상 링크를 직접 넣어주세요."
        : "채널 영상을 찾지 못했습니다. YOUTUBE_API_KEY를 설정하거나 영상 링크를 직접 넣어주세요.",
      code: "CHANNEL_NOT_FOUND",
    }, 404);
  }
  const picked = pickChannelVideos(channel.videos);
  const settled = await Promise.all(picked.map(async (video) => ({
    video,
    result: await analyzeVideo(geminiKey, video, video.title || channel.title),
  })));
  const succeeded = settled.flatMap(({ video, result }) =>
    "error" in result ? [] : [{ video, analysis: result.analysis, model: result.model }]
  );
  if (!succeeded.length) {
    const failure = settled.find(({ result }) => "error" in result)?.result as Failure | undefined;
    return jsonResponse(failure || { error: "채널 영상 분석에 실패했습니다." }, failure?.status || 502);
  }
  const durations = succeeded.map(({ video }) => video.durationSeconds).filter((value): value is number => Boolean(value));
  return jsonResponse({
    analysis: aggregateAnalyses(succeeded),
    model: [...new Set(succeeded.map(({ model }) => model))].join(", "),
    sourceMode: "youtube-channel-gemini",
    channel: { id: channel.id, title: channel.title },
    videos: succeeded.map(({ video, analysis }) => ({
      ...video,
      estimatedCameraCount: analysis.estimatedCameraCount,
      difficulty: analysis.difficulty,
    })),
    durationSeconds: durations.length ? median(durations) : null,
  });
}

Deno.serve(handle);

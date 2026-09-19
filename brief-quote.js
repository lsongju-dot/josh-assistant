/* Local-only quote rules. No network requests or model calls. */
(function (root) {
  "use strict";
  const profiles = { general: "일반 롱폼", fashion: "패션·제품 설명", documentary: "현장 다큐", shortform: "숏폼", ad: "광고·AI 숏폼" };
  const money = n => Math.round(n).toLocaleString("ko-KR") + "원";
  const round = n => Math.ceil(n / 10000) * 10000;
  function duration(text, label) {
    const token = "(\\d+(?:\\.\\d+)?)\\s*(시간|분|초)?\\s*(?:[~～–—-]|에서|부터)\\s*(\\d+(?:\\.\\d+)?)\\s*(시간|분|초)";
    const convert = (n, unit) => Number(n) * (unit === "시간" ? 60 : unit === "초" ? 1 / 60 : 1);
    if (label) {
      const candidates = text.matchAll(new RegExp("(?:" + label + ")([^\\d\\n.!?]{0,70})([^\\n.!?]+)", "g"));
      for (const match of candidates) {
        if (label.includes("원본") && /최종|완성|납기|수정/.test(match[1])) continue;
        const value = duration(match[2]);
        if (value) return value;
      }
      return null;
    }
    const source = text;
    if (!source) return null;
    const range = source.match(new RegExp("^\\s*" + token));
    if (range) return { min: convert(range[1], range[2] || range[4]), max: convert(range[3], range[4]), range: true };
    const single = source.match(/^\s*(\d+(?:\.\d+)?)\s*(시간|분|초)(?:\s*(\d+)\s*(분|초))?/);
    if (!single) return null;
    const value = convert(single[1], single[2]) + (single[3] ? convert(single[3], single[4]) : 0);
    return { min: value, max: value, upper: /미만|이내|안\s*(?:나|넘)|넘지/.test(source.slice(0, 38)) };
  }
  function parse(input) {
    const text = String(input).normalize("NFKC").slice(0, 30000);
    const clean = text.replace(/https?:\/\/\S+/g, "");
    const links = text.match(/https?:\/\/[^\s<>"']+/g) || [];
    const bundle = /롱폼/.test(clean) && /숏폼|숏츠|쇼츠|릴스/.test(clean);
    const profile = /다큐|documentary/i.test(clean) ? "documentary" : /AI\s*영상|광고|브랜디드/i.test(clean) ? "ad" : !bundle && /숏폼|숏츠|쇼츠|릴스/i.test(clean) ? "shortform" : /패션|착장|코디|룩북/.test(clean) ? "fashion" : "general";
    const original = duration(clean, "원본|촬영본");
    let final = duration(clean, "최종본|완성본|최종|완성|러닝타임");
    if (!final) {
      const withoutOriginal = clean.replace(/(?:원본|촬영본)[^\n.!?]*(?:\n|[.!?]|$)/g, "");
      const candidate = withoutOriginal.match(/(?:^|\s)(\d+(?:\.\d+)?\s*(?:분|초)?\s*(?:[~～–—-]|에서)?\s*\d*(?:\.\d+)?\s*(?:분|초))\s*(?:전후|내외|짜리|정도|영상|예정|분량|$)/);
      if (candidate) final = duration(candidate[1]);
    }
    const cam = clean.match(/(?:([1-3])\s*캠|(?:캠|카메라)\s*([1-3])\s*(?:개|대)?)/);
    const koreanCam = clean.match(/(원|투|쓰리|한|두|세)\s*(?:캠|대의?\s*카메라)/);
    const cameraCount = Number(cam?.[1] || cam?.[2]) || ({ 원: 1, 한: 1, 투: 2, 두: 2, 쓰리: 3, 세: 3 }[koreanCam?.[1]]) || 0;
    const cutNotReady = /컷(?:\s*편집|편)?[^\n,.]{0,12}(?:안\s*(?:되어|돼|했)|미완료|완료[^\n,.]{0,5}아니)/.test(clean);
    const scope = !cutNotReady && /컷(?:\s*편집|편)?[^\n,.]{0,12}(?:완료|되어|돼\s*있)|종편만/.test(clean) ? "locked" : /축소\s*편집[^\n,.]{0,8}(?:없|않)|원본[^\n,.]{0,30}(?:완성본|최종본)[^\n,.]{0,15}(?:비슷|동일)|각도만\s*다른/.test(clean) ? "light" : /컷\s*(?:편집|편)\s*만/.test(clean) ? "cut" : "full";
    const images = /사진|이미지|자료\s*화면|스톡/.test(clean);
    const photoNone = /(?:사진|이미지|자료\s*화면)[^\n,.]{0,8}(?:없|불필요|제외)/.test(clean);
    const supplied = /(?:사진|이미지|자료)[^\n.!?]{0,25}(?:모두|전부|100%)\s*(?:제공|전달)|(?:모두|전부)\s*(?:제공|전달)/.test(clean);
    const partial = /100%\s*(?:는|가)?\s*아니|일부|대부분|찾아서\s*(?:드|줄|제공)/.test(clean);
    const revisions = clean.match(/수정[^\d\n]{0,8}(\d+)\s*회/);
    const count = clean.match(/월\s*(\d+)\s*(?:편|건|개)/);
    const questions = [];
    const assumptions = [];
    if (bundle) { assumptions.push("롱폼만 계산 · 파생 숏폼과 썸네일 비용 미포함"); questions.push("파생 숏폼과 썸네일 수량·분량은 별도로 확인해 주세요."); }
    if (profile === "ad") questions.push("AI 영상 생성 개수와 재생성 횟수, 소스 제작비 부담 범위는 어떻게 되나요?");
    if (!final) { assumptions.push("최종 길이는 임시값"); questions.push("완성본 길이는 몇 분 또는 몇 초인가요?"); }
    if (final?.range) assumptions.push(`완성본 ${final.min}~${final.max}분 중 긴 분량으로 계산`);
    if (!cameraCount) { assumptions.push("카메라 1대 가정"); questions.push("카메라는 몇 대로 촬영하나요?"); }
    if (!original) { assumptions.push("원본 길이는 임시값"); questions.push("원본의 실제 총 재생시간은 얼마나 되나요?"); }
    if (original?.upper) assumptions.push(`원본 ${original.max}분은 확정 길이가 아닌 상한`);
    if (original?.range) assumptions.push(`원본 ${original.min}~${original.max}분 중 긴 분량으로 계산`);
    if (images && !photoNone && !supplied) questions.push("제공되는 사진 수와 편집자가 찾아야 하는 사진 수는 각각 몇 장인가요?");
    if (!revisions) assumptions.push("수정 1회 포함 가정");
    questions.push("원본·자료 전달일과 희망 1차본 날짜는 언제인가요?");
    if (links.length) assumptions.push("레퍼런스 링크는 보관만 하며 영상 시청·분석은 하지 않음");
    if (/물량|장기|고정|정기|월\s*\d+/.test(clean)) assumptions.push("확정 물량과 실제 공수 확인 전에는 장기 할인 미적용");
    const short = profile === "shortform" || profile === "ad";
    const noCaptions = /자막\s*(?:없|제외|불필요)/.test(clean);
    return { profile, minutes: final?.max || (short ? 1 : 10), raw: original?.max || (short ? 10 : 30),
      cameras: cameraCount || 1, scope,
      photos: photoNone ? "none" : supplied ? "provided" : partial && images ? "partial" : images ? "research" : "none",
      captions: !noCaptions, revisions: Number(revisions?.[1] || 1), monthly: Number(count?.[1] || 1), daily: 3,
      hourly: 20000, urgent: /긴급|급행|당일|내일\s*마감|ASAP/i.test(clean),
      assumptions, questions, links, hasConditions: Boolean(final || original || cam || /다큐|패션|편집|숏폼|숏츠|쇼츠|롱폼|자막/.test(clean)) };
  }
  function estimate(input) {
    const c = { ...input };
    const valid = Object.hasOwn(profiles, c.profile) && ["full", "locked", "light", "cut"].includes(c.scope) && ["none", "provided", "partial", "research"].includes(c.photos) && Number.isFinite(Number(c.minutes)) && c.minutes > 0 && c.minutes <= 180 &&
      Number.isFinite(Number(c.raw)) && c.raw >= 0 && c.raw <= 1440 && [1, 2, 3].includes(Number(c.cameras)) &&
      c.daily >= 0.5 && c.daily <= 12 && c.hourly >= 1000 && c.hourly <= 200000 &&
      Number.isInteger(Number(c.revisions)) && c.revisions >= 0 && c.revisions <= 10 &&
      Number.isInteger(Number(c.monthly)) && c.monthly >= 1 && c.monthly <= 100;
    if (!valid) return { error: "길이·카메라·수정 횟수·작업 가능시간의 입력 범위를 확인해 주세요." };
    const short = c.profile === "shortform" || c.profile === "ad";
    const scope = c.scope;
    const items = [];
    const add = (name, amount) => { if (amount > 0) items.push({ name, amount: round(amount) }); };
    const rates = [0, 18000, 25000, 35000];
    const minimums = [0, 90000, 130000, 180000];
    const scopeScale = scope === "cut" ? 0.45 : scope === "locked" ? 0.75 : scope === "light" ? (c.cameras === 3 ? 2 / 3 : 0.8) : 1;
    const base = short ? Math.max(30000, c.minutes * (c.profile === "ad" ? 120000 : 60000)) : Math.max(minimums[c.cameras], c.minutes * rates[c.cameras] * scopeScale);
    add(short ? "숏폼 기본 작업" : `${c.cameras}캠 · 최종본 ${c.minutes}분 기본 작업`, base);
    const review = scope === "locked" ? 0 : Math.max(0, c.raw - 30) * (c.profile === "documentary" ? 800 : 500);
    add("긴 원본 검수·선별", review);
    const story = c.profile === "documentary" && scope === "full" ? c.minutes * 5000 : 0;
    add("다큐 구성·현장음 정리", story);
    const photo = scope === "cut" || c.photos === "none" ? 0 : Math.max(20000, c.minutes * 4000);
    add("사진 배치·화면 구성", photo);
    add("추가 사진 검색", scope === "cut" ? 0 : c.photos === "partial" ? 20000 : c.photos === "research" ? 50000 : 0);
    if (c.profile === "ad") add("광고·AI 소스 제작 여유분", 80000);
    let baseTotal = items.reduce((sum, item) => sum + item.amount, 0);
    if (!c.captions && scope !== "cut") { const discount = -round(base * 0.1); items.push({ name: "자막 제외", amount: discount }); baseTotal += discount; }
    add(`추가 수정 ${Math.max(0, c.revisions - 1)}회`, baseTotal * Math.max(0, c.revisions - 1) * 0.2);
    if (c.urgent) add("급행 30%", items.reduce((sum, item) => sum + item.amount, 0) * 0.3);
    const rawHours = scope === "locked" ? c.minutes / 60 : c.raw / 60 * (c.profile === "documentary" ? 1.8 : 1.3);
    const hours = (short ? (c.profile === "ad" ? 4 : 1.5) * c.minutes : c.minutes * (c.profile === "documentary" ? 0.65 : 0.42)) * scopeScale;
    const photoHours = photo ? c.minutes * 0.13 + (c.photos === "research" ? 2 : c.photos === "partial" ? 0.75 : 0) : 0;
    const lowHours = Math.ceil((rawHours + hours + photoHours + 0.75 + c.revisions * 0.4) * 2) / 2;
    const highHours = Math.ceil(lowHours * 1.3 * 2) / 2;
    const cost = items.reduce((sum, item) => sum + item.amount, 0);
    const laborFloor = round(lowHours * c.hourly);
    const floor = Math.max(short ? 30000 : minimums[c.cameras], round(cost * 0.85), laborFloor);
    const recommended = Math.max(round(cost), floor);
    if (recommended > cost) items.push({ name: "희망 시급 하한 보정", amount: recommended - cost });
    const high = Math.max(recommended, round(recommended * 1.15));
    return { ...c, items, floor, recommended, high, lowHours, highHours,
      lowDays: Math.ceil(lowHours / c.daily), highDays: Math.ceil(highHours / c.daily), monthlyTotal: recommended * c.monthly,
      effectiveHourly: Math.round(recommended / highHours), unitMinute: Math.round(recommended / c.minutes) };
  }
  function reply(q) {
    if (q.error) return "";
    const scopeText = { full: "컷편집", locked: "확정 컷 기준 종합편집", light: "NG 정리·화면 전환", cut: "컷편집" }[q.scope];
    const included = [scopeText];
    if (q.scope !== "cut") {
      if (q.captions) included.push("기본 자막");
      included.push("기본 색보정·음량 정리·BGM");
      if (q.photos !== "none") included.push("사진 삽입");
    }
    if (q.profile === "documentary" && q.scope === "full") included.push("이야기 흐름 구성");
    return `안녕하세요! 말씀해 주신 작업은 최종본 ${q.minutes}분 이내, ${q.cameras}캠, 원본 ${q.raw}분 이내 기준으로 편당 ${money(q.recommended)}의 가견적을 안내드립니다.\n\n${included.join(", ")}과 수정 ${q.revisions}회가 포함됩니다.${q.photos === "partial" ? " 사진은 제공 자료를 우선 사용하며, 추가 검색 범위는 자료 확인 후 협의드립니다." : q.photos === "research" ? " 사진 검색 수량과 범위는 자료 확인 후 확정하겠습니다." : ""}\n\n${q.monthly > 1 ? `월 ${q.monthly}편 기준 합계는 ${money(q.monthlyTotal)}입니다. 확정 물량과 첫 편 작업량을 확인한 뒤 정기 단가를 협의할 수 있습니다.\n\n` : ""}원본과 자료 전달일, 희망 납기를 알려주시면 현재 작업 일정과 확인 후 1차본 전달일을 확정해 드리겠습니다. 분량이나 작업 범위가 달라지면 착수 전에 금액을 다시 안내드리겠습니다.`;
  }
  const api = { parse, estimate, reply, profiles };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JoshBrief = api;
})(typeof window === "object" ? window : globalThis);

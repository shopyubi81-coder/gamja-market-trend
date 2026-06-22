// ================================================
// 감자마켓 트렌드 API — Supabase Edge Function (Deno)
// ================================================
// 네이버/알리 API를 프록시합니다. 키는 Supabase Secrets에 보관.
//   supabase secrets set NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=...
//   supabase functions deploy market-api --no-verify-jwt
//
// 라우팅: /functions/v1/market-api/api/naver/categories?period=daily ...

import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const NAVER_CLIENT_ID = Deno.env.get("NAVER_CLIENT_ID") ?? "";
const NAVER_CLIENT_SECRET = Deno.env.get("NAVER_CLIENT_SECRET") ?? "";
const ALI_APP_KEY = Deno.env.get("ALI_APP_KEY") ?? "";
const ALI_APP_SECRET = Deno.env.get("ALI_APP_SECRET") ?? "";
const ALI_TRACKING_ID = Deno.env.get("ALI_TRACKING_ID") ?? "";
const COUPANG_ACCESS_KEY = Deno.env.get("COUPANG_ACCESS_KEY") ?? "";
const COUPANG_SECRET_KEY = Deno.env.get("COUPANG_SECRET_KEY") ?? "";
const TAOBAO_APP_KEY = Deno.env.get("TAOBAO_APP_KEY") ?? "";
const TAOBAO_APP_SECRET = Deno.env.get("TAOBAO_APP_SECRET") ?? "";
const TAOBAO_ADZONE_ID = Deno.env.get("TAOBAO_ADZONE_ID") ?? "";
// Supabase가 Edge Function에 자동 주입하는 값 (캐시 테이블 접근용)
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const naverConfigured = () => !!(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
const aliConfigured = () => !!(ALI_APP_KEY && ALI_APP_SECRET);
const coupangConfigured = () => !!(COUPANG_ACCESS_KEY && COUPANG_SECRET_KEY);
const taobaoConfigured = () => !!(TAOBAO_APP_KEY && TAOBAO_APP_SECRET && TAOBAO_ADZONE_ID);

// ===== Supabase 캐시 (api_cache 테이블) — 쿠팡 호출 한도 보호 =====
async function cacheGet(key: string, ttlMs: number) {
  if (!SB_URL || !SB_SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/api_cache?key=eq.${encodeURIComponent(key)}&select=data,updated_at`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) {
      const age = Date.now() - new Date(rows[0].updated_at).getTime();
      if (age < ttlMs) return { data: rows[0].data, ageMs: age };
    }
  } catch (_) { /* 캐시 실패는 무시하고 실시간 호출 */ }
  return null;
}
async function cacheSet(key: string, data: unknown) {
  if (!SB_URL || !SB_SERVICE_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/api_cache?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
    });
  } catch (_) { /* 무시 */ }
}

// ===== 쿠팡 파트너스 HMAC(CEA) 서명 =====
const COUPANG_HOST = "https://api-gateway.coupang.com";
async function coupangAuth(method: string, urlpath: string, query: string) {
  // datetime: yyMMdd'T'HHmmss'Z' (GMT)
  const datetime = new Date().toISOString().slice(2, 19).replace(/[-:]/g, "") + "Z";
  const message = datetime + method + urlpath + query;
  const keyData = new TextEncoder().encode(COUPANG_SECRET_KEY);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  const signature = encodeHex(new Uint8Array(sig));
  return `CEA algorithm=HmacSHA256, access-key=${COUPANG_ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

async function coupangCall(urlpath: string, query = "") {
  const authorization = await coupangAuth("GET", urlpath, query);
  const url = COUPANG_HOST + urlpath + (query ? `?${query}` : "");
  const r = await fetch(url, { method: "GET", headers: { Authorization: authorization, "Content-Type": "application/json" } });
  const data = await r.json();
  if (data.rCode && data.rCode !== "0") throw new Error(`Coupang ${data.rCode}: ${data.rMessage}`);
  return data;
}

// 우리 카테고리 → 쿠팡 카테고리 ID
const COUPANG_CATEGORY: Record<string, { id: string; name: string }> = {
  food:    { id: "1012", name: "식품" },
  beauty:  { id: "1010", name: "뷰티" },
  fashion: { id: "1001", name: "여성패션" },
  home:    { id: "1014", name: "생활용품" },
  kids:    { id: "1011", name: "출산/유아동" },
  pet:     { id: "1029", name: "반려동물용품" },
  digital: { id: "1016", name: "가전디지털" },
};
const CPATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/products";

// ===== 인스타 인기 해시태그 (계절·트렌드 반영, 주기적 업데이트) =====
// tag=화면표시 해시태그, kw=네이버 검색어, cat=우리 카테고리, catName=표시명
const INSTA_HASHTAGS = [
  { tag: "#오운완", kw: "홈트레이닝", cat: "food", catName: "식품/건강" },
  { tag: "#홈카페", kw: "홈카페용품", cat: "food", catName: "식품/건강" },
  { tag: "#다이어트식단", kw: "다이어트식품", cat: "food", catName: "식품/건강" },
  { tag: "#그릭요거트", kw: "그릭요거트", cat: "food", catName: "식품/건강" },
  { tag: "#여름네일", kw: "셀프네일", cat: "beauty", catName: "뷰티/화장품" },
  { tag: "#데일리메이크업", kw: "쿠션팩트", cat: "beauty", catName: "뷰티/화장품" },
  { tag: "#선케어", kw: "선크림", cat: "beauty", catName: "뷰티/화장품" },
  { tag: "#여름코디", kw: "여름원피스", cat: "fashion", catName: "패션/의류" },
  { tag: "#린넨룩", kw: "린넨셔츠", cat: "fashion", catName: "패션/의류" },
  { tag: "#휴가룩", kw: "비치웨어", cat: "fashion", catName: "패션/의류" },
  { tag: "#공간꾸미기", kw: "인테리어소품", cat: "home", catName: "홈/리빙" },
  { tag: "#제로웨이스트", kw: "친환경생활용품", cat: "home", catName: "홈/리빙" },
  { tag: "#캠핑스타그램", kw: "캠핑용품", cat: "home", catName: "홈/리빙" },
  { tag: "#육아템", kw: "유아용품", cat: "kids", catName: "유아동" },
  { tag: "#여름물놀이", kw: "유아 물놀이", cat: "kids", catName: "유아동" },
  { tag: "#댕댕이여름나기", kw: "강아지 쿨매트", cat: "pet", catName: "반려동물" },
  { tag: "#펫스타그램", kw: "반려동물용품", cat: "pet", catName: "반려동물" },
  { tag: "#가성비가전", kw: "미니가전", cat: "digital", catName: "디지털/가전" },
  { tag: "#무선이어폰", kw: "무선이어폰", cat: "digital", catName: "디지털/가전" },
];

function mapCoupangItem(p: any, catName: string) {
  return {
    name: p.productName,
    price: p.productPrice,
    priceText: `${Number(p.productPrice || 0).toLocaleString()}원`,
    image: p.productImage,
    link: p.productUrl,
    category: catName || p.categoryName || "쿠팡",
    isRocket: p.isRocket,
    isFreeShipping: p.isFreeShipping,
    rank: p.rank,
    productId: p.productId,
  };
}

// ===== 네이버 공통 =====
const NAVER_CATEGORIES = [
  { name: "식품", code: "50000006" },
  { name: "화장품/미용", code: "50000003" },
  { name: "패션의류", code: "50000001" },
  { name: "가구/인테리어", code: "50000005" },
  { name: "출산/육아", code: "50000002" },
  { name: "스포츠/레저", code: "50000007" },
  { name: "디지털/가전", code: "50000004" },
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "식품": ["제철과일", "간편식", "건강간식", "밀키트"],
  "화장품/미용": ["선크림", "쿠션", "세럼", "클렌징"],
  "패션의류": ["여름원피스", "린넨셔츠", "와이드팬츠", "샌들"],
  "가구/인테리어": ["수납장", "조명", "러그", "커튼"],
  "출산/육아": ["이유식", "아기띠", "유아간식", "기저귀"],
  "스포츠/레저": ["캠핑의자", "요가매트", "러닝화", "등산용품"],
  "디지털/가전": ["무선이어폰", "선풍기", "보조배터리", "블루투스스피커"],
};

function periodDates(period: string) {
  const end = new Date();
  const start = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "daily") start.setDate(end.getDate() - 30);
  else if (period === "weekly") start.setDate(end.getDate() - 84);
  else if (period === "monthly") start.setMonth(end.getMonth() - 12);
  else start.setFullYear(end.getFullYear() - 3);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const naverHeaders = {
  "X-Naver-Client-Id": NAVER_CLIENT_ID,
  "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
  "Content-Type": "application/json",
};

const stripTags = (s: string) =>
  (s || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

async function naverCategoryTrend(period: string) {
  const { startDate, endDate } = periodDates(period);
  const timeUnit = period === "daily" ? "date" : period === "weekly" ? "week" : "month";
  const chunks: { name: string; code: string }[][] = [];
  for (let i = 0; i < NAVER_CATEGORIES.length; i += 3) chunks.push(NAVER_CATEGORIES.slice(i, i + 3));
  const results: any[] = [];
  for (const chunk of chunks) {
    const body = { startDate, endDate, timeUnit, category: chunk.map((c) => ({ name: c.name, param: [c.code] })) };
    const r = await fetch("https://openapi.naver.com/v1/datalab/shopping/categories", {
      method: "POST", headers: naverHeaders, body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.results) results.push(...data.results);
    else throw new Error(data.errorMessage || JSON.stringify(data));
  }
  return results;
}

async function naverShop(query: string, display = 5, sort = "sim") {
  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", sort);
  const r = await fetch(url, { headers: { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET } });
  if (!r.ok) throw new Error(`Naver shop ${r.status}`);
  return await r.json();
}

function mapShopItem(it: any, catName: string, kw: string) {
  const lo = parseInt(it.lprice) || 0;
  const hi = parseInt(it.hprice) || 0;
  return {
    name: stripTags(it.title), mallName: it.mallName || "네이버쇼핑",
    price: lo, priceLow: lo, priceHigh: hi,
    priceText: lo ? `${lo.toLocaleString()}원` : "가격문의",
    priceRangeText: (hi && hi > lo) ? `${lo.toLocaleString()}~${hi.toLocaleString()}원` : (lo ? `${lo.toLocaleString()}원` : "가격문의"),
    category: catName,
    subCategory: [it.category2, it.category3, it.category4].filter(Boolean).join(" > "),
    brand: it.brand || it.maker || "", keyword: kw,
    image: it.image, link: it.link, productId: it.productId,
  };
}

// ===== 알리 서명 =====
async function md5Upper(s: string) {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(s));
  return encodeHex(new Uint8Array(buf)).toUpperCase();
}
async function aliCall(method: string, biz: Record<string, string>) {
  const sys: Record<string, string> = {
    app_key: ALI_APP_KEY, method, sign_method: "md5",
    timestamp: String(Date.now()), format: "json", v: "2.0",
  };
  const all = { ...sys, ...biz };
  let base = ALI_APP_SECRET;
  for (const k of Object.keys(all).sort()) base += k + all[k];
  base += ALI_APP_SECRET;
  (all as any).sign = await md5Upper(base);
  const url = new URL("https://api-sg.aliexpress.com/sync");
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v as string);
  const r = await fetch(url, { method: "POST" });
  return await r.json();
}

// ===== 타오바오커(淘宝客) TOP API — MD5 서명 =====
// 카테고리 → 타오바오 검색어(중국어)
const TAOBAO_KEYWORDS: Record<string, string> = {
  food: "零食", beauty: "化妆品", fashion: "连衣裙", home: "居家",
  kids: "母婴", pet: "宠物用品", digital: "数码", all: "热销",
};
async function taobaoCall(method: string, biz: Record<string, string>) {
  // TOP 타임스탬프: "yyyy-MM-dd HH:mm:ss" (GMT+8)
  const timestamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const sys: Record<string, string> = {
    method, app_key: TAOBAO_APP_KEY, sign_method: "md5", timestamp, format: "json", v: "2.0",
  };
  const all = { ...sys, ...biz };
  let base = TAOBAO_APP_SECRET;
  for (const k of Object.keys(all).sort()) base += k + all[k];
  base += TAOBAO_APP_SECRET;
  (all as any).sign = await md5Upper(base);
  const url = new URL("https://eco.taobao.com/router/rest");
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v as string);
  const r = await fetch(url, { method: "POST" });
  return await r.json();
}
function mapTaobaoItem(p: any) {
  const fixUrl = (u: string) => !u ? "" : (u.startsWith("//") ? "https:" + u : u);
  const price = p.zk_final_price || p.reserve_price;
  return {
    id: "tb_" + (p.item_id || p.num_iid),
    name: p.title,
    source: "타오바오",
    price,
    priceText: price ? `¥${price}` : "가격문의",
    originalPrice: p.reserve_price ? `¥${p.reserve_price}` : null,
    salesVolume: p.volume || p.tk_total_sales,   // 판매량
    image: fixUrl(p.pict_url),
    link: fixUrl(p.coupon_share_url || p.url || p.item_url),
    category: p.category_name || "타오바오",
    shopName: p.shop_title || p.nick,
  };
}

// ===== 일일 종합 보고서 =====
function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return d.toISOString().slice(0, 10);
}

async function buildReport() {
  const date = todayKST();
  const report: any = { date, generatedAt: new Date().toISOString(), naver: null, coupang: null, insta: null, keywords: [], rising: [], falling: [] };

  // 1) 네이버 카테고리 트렌드 (일간)
  try {
    const cats = await naverCategoryTrend("daily");
    const ranked = cats.map((r: any) => {
      const latest = r.data[r.data.length - 1];
      const prev = r.data[r.data.length - 2];
      const ratio = latest?.ratio || 0;
      const prevRatio = prev?.ratio || ratio;
      const change = prevRatio > 0 ? +((ratio - prevRatio) / prevRatio * 100).toFixed(1) : 0;
      return { name: r.title, ratio: +ratio.toFixed(1), change, trend: change > 3 ? "up" : change < -3 ? "down" : "same" };
    }).sort((a: any, b: any) => b.ratio - a.ratio);
    report.naver = ranked;
    report.rising = ranked.filter((c: any) => c.trend === "up").sort((a: any, b: any) => b.change - a.change).slice(0, 3);
    report.falling = ranked.filter((c: any) => c.trend === "down").sort((a: any, b: any) => a.change - b.change).slice(0, 3);
  } catch (_) { /* skip */ }

  // 2) 쿠팡 골드박스 TOP 5
  if (coupangConfigured()) {
    try {
      const gb = await coupangCall(`${CPATH}/goldbox`);
      report.coupang = (gb.data || []).slice(0, 5).map((p: any) => mapCoupangItem(p, ""));
    } catch (_) { /* skip */ }
  }

  // 3) 인스타 핫 해시태그 TOP 6 (네이버 인기도)
  try {
    const tagRes: any[] = [];
    for (const t of INSTA_HASHTAGS.slice(0, 8)) {
      try { const shop = await naverShop(t.kw, 1, "sim"); tagRes.push({ tag: t.tag, keyword: t.kw, category: t.catName, popularity: shop.total || 0 }); } catch (_) { /* */ }
    }
    report.insta = tagRes.sort((a, b) => b.popularity - a.popularity).slice(0, 6);
    report.keywords = report.insta.map((t: any) => t.tag.replace("#", "")).slice(0, 8);
  } catch (_) { /* skip */ }

  return report;
}

async function saveReport(report: any) {
  if (!SB_URL || !SB_SERVICE_KEY) return;
  await fetch(`${SB_URL}/rest/v1/daily_report?on_conflict=date`, {
    method: "POST",
    headers: {
      apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ date: report.date, data: report, created_at: new Date().toISOString() }),
  });
}

async function getLatestReport() {
  if (!SB_URL || !SB_SERVICE_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/daily_report?select=data&order=date.desc&limit=1`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0].data : null;
}

// ===== 라우터 =====
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // 함수 prefix 이후의 경로만 추출 (.../market-api/api/naver/categories → /api/naver/categories)
  const path = url.pathname.replace(/^.*\/market-api/, "") || "/";
  const q = url.searchParams;

  try {
    if (path === "/api/status") {
      return json({ naverConfigured: naverConfigured(), aliConfigured: aliConfigured(), coupangConfigured: coupangConfigured(), taobaoConfigured: taobaoConfigured(), serverTime: new Date().toISOString() });
    }

    // ===== 타오바오 인기 상품 (타오바오커 물료검색, 60분 캐싱) =====
    if (path === "/api/taobao/hot") {
      if (!taobaoConfigured()) return json({ error: "TAOBAO_API_NOT_CONFIGURED" }, 503);
      const catKey = q.get("category") || "all";
      const kw = TAOBAO_KEYWORDS[catKey] || TAOBAO_KEYWORDS.all;
      const cacheKey = `taobao:hot:${catKey}`;
      const cached = await cacheGet(cacheKey, 60 * 60 * 1000);
      if (cached) return json({ success: true, cached: true, ageMin: Math.round(cached.ageMs / 60000), data: cached.data });
      const biz: Record<string, string> = {
        adzone_id: TAOBAO_ADZONE_ID, q: kw, page_size: "20", page_no: "1",
        sort: "tk_total_sales_des", platform: "2",
      };
      const data = await taobaoCall("taobao.tbk.dg.material.optional", biz);
      const err = data?.error_response;
      if (err) throw new Error(`Taobao ${err.code}: ${err.sub_msg || err.msg}`);
      const list = data?.tbk_dg_material_optional_response?.result_list?.map_data || [];
      const items = list.map(mapTaobaoItem);
      await cacheSet(cacheKey, items);
      return json({ success: true, cached: false, data: items, fetchedAt: new Date().toISOString() });
    }

    // ===== 일일 보고서 생성 (cron 또는 수동) =====
    if (path === "/api/report/generate") {
      if (!naverConfigured()) return json({ error: "NAVER_API_NOT_CONFIGURED" }, 503);
      const report = await buildReport();
      await saveReport(report);
      return json({ success: true, data: report });
    }

    // ===== 최신 보고서 조회 =====
    if (path === "/api/report/latest") {
      const report = await getLatestReport();
      return json({ success: true, data: report });
    }

    // ===== 쿠팡 골드박스 (오늘의 특가/인기) =====
    if (path === "/api/coupang/goldbox") {
      if (!coupangConfigured()) return json({ error: "COUPANG_API_NOT_CONFIGURED" }, 503);
      const cacheKey = "coupang:goldbox";
      const cached = await cacheGet(cacheKey, 30 * 60 * 1000); // 30분 캐시
      if (cached) return json({ success: true, cached: true, ageMin: Math.round(cached.ageMs / 60000), data: cached.data });
      const res = await coupangCall(`${CPATH}/goldbox`);
      const items = (res.data || []).map((p: any) => mapCoupangItem(p, "")).slice(0, 30);
      await cacheSet(cacheKey, items);
      return json({ success: true, cached: false, data: items, fetchedAt: new Date().toISOString() });
    }

    // ===== 쿠팡 베스트 카테고리 (카테고리별 인기상품) =====
    if (path === "/api/coupang/best") {
      if (!coupangConfigured()) return json({ error: "COUPANG_API_NOT_CONFIGURED" }, 503);
      const catKey = q.get("category") || "food";
      const cat = COUPANG_CATEGORY[catKey] || COUPANG_CATEGORY.food;
      const limit = q.get("limit") || "20";
      const cacheKey = `coupang:best:${cat.id}`;
      const cached = await cacheGet(cacheKey, 30 * 60 * 1000); // 30분 캐시
      if (cached) return json({ success: true, cached: true, ageMin: Math.round(cached.ageMs / 60000), category: cat.name, data: cached.data });
      const res = await coupangCall(`${CPATH}/bestcategories/${cat.id}`, `limit=${limit}`);
      const items = (res.data || []).map((p: any) => mapCoupangItem(p, cat.name));
      await cacheSet(cacheKey, items);
      return json({ success: true, cached: false, category: cat.name, data: items, fetchedAt: new Date().toISOString() });
    }

    // 네이버 카테고리 트렌드
    if (path === "/api/naver/categories") {
      if (!naverConfigured()) return json({ error: "NAVER_API_NOT_CONFIGURED" }, 503);
      const period = q.get("period") || "daily";
      const results = await naverCategoryTrend(period);
      const ranked = results.map((r: any) => {
        const latest = r.data[r.data.length - 1];
        const prev = r.data[r.data.length - 2];
        const ratio = latest?.ratio || 0;
        const prevRatio = prev?.ratio || ratio;
        const change = prevRatio > 0 ? +((ratio - prevRatio) / prevRatio * 100).toFixed(1) : 0;
        return {
          name: r.title, ratio: ratio.toFixed(1), change,
          trend: change > 5 ? "up" : change < -5 ? "down" : "same",
          data: r.data.map((d: any) => ({ period: d.period, ratio: d.ratio })),
        };
      }).sort((a, b) => +b.ratio - +a.ratio);
      return json({ success: true, data: ranked, fetchedAt: new Date().toISOString() });
    }

    // 네이버 카테고리별 실제 상품
    if (path === "/api/naver/products") {
      if (!naverConfigured()) return json({ error: "NAVER_API_NOT_CONFIGURED" }, 503);
      const categoryName = q.get("category");
      const perKeyword = parseInt(q.get("perKeyword") || "5");
      let plan: { cat: string; kw: string }[];
      if (categoryName) {
        const kws = CATEGORY_KEYWORDS[categoryName] || [categoryName];
        plan = kws.map((kw) => ({ cat: categoryName, kw }));
      } else {
        const cats = Object.keys(CATEGORY_KEYWORDS).slice(0, 4);
        plan = cats.map((cat) => {
          const kws = CATEGORY_KEYWORDS[cat] || [cat];
          return { cat, kw: kws[Math.floor(Math.random() * kws.length)] };
        });
      }
      const result: any[] = [];
      const seen = new Set<string>();
      for (const { cat, kw } of plan) {
        const shop = await naverShop(kw, perKeyword, "sim");
        const items = (shop.items || []).map((it: any) => mapShopItem(it, cat, kw))
          .filter((it: any) => { const key = it.productId || it.name; if (seen.has(key)) return false; seen.add(key); return true; });
        result.push({ category: cat, searchKeyword: kw, items });
      }
      return json({ success: true, data: result, fetchedAt: new Date().toISOString() });
    }

    // 네이버 키워드 직접 검색
    if (path === "/api/naver/search") {
      if (!naverConfigured()) return json({ error: "NAVER_API_NOT_CONFIGURED" }, 503);
      const query = q.get("q");
      if (!query) return json({ error: "query required" }, 400);
      const shop = await naverShop(query, parseInt(q.get("display") || "10"), q.get("sort") || "sim");
      const items = (shop.items || []).map((it: any) => mapShopItem(it, "", query));
      return json({ success: true, query, total: shop.total, data: items, fetchedAt: new Date().toISOString() });
    }

    // ===== 인스타 트렌드 (해시태그 → 네이버 상품·인기도 기반) =====
    if (path === "/api/insta/trends") {
      if (!naverConfigured()) return json({ error: "NAVER_API_NOT_CONFIGURED" }, 503);
      const catKey = q.get("category") || "all";
      const cacheKey = `insta:trends:${catKey}`;
      const cached = await cacheGet(cacheKey, 60 * 60 * 1000); // 60분 캐시 (호출 절약)
      if (cached) return json({ success: true, cached: true, ageMin: Math.round(cached.ageMs / 60000), data: cached.data });

      // 카테고리별 인기 인스타 해시태그 → 네이버 검색어
      const tags = catKey === "all"
        ? INSTA_HASHTAGS.slice(0, 10)
        : INSTA_HASHTAGS.filter((t) => t.cat === catKey);

      const result: any[] = [];
      for (const t of tags) {
        try {
          const shop = await naverShop(t.kw, 3, "sim");
          const products = (shop.items || []).map((it: any) => mapShopItem(it, t.cat, t.kw));
          result.push({
            tag: t.tag, category: t.catName, cat: t.cat, keyword: t.kw,
            popularity: shop.total || 0,           // 네이버 검색 결과 수 = 관심도 지표
            products,
          });
        } catch (_) { /* 개별 실패 무시 */ }
      }
      result.sort((a, b) => b.popularity - a.popularity);
      await cacheSet(cacheKey, result);
      return json({ success: true, cached: false, data: result, fetchedAt: new Date().toISOString() });
    }

    // 알리 인기 상품
    if (path === "/api/ali/hotproducts") {
      if (!aliConfigured()) return json({ error: "ALI_API_NOT_CONFIGURED" }, 503);
      const biz: Record<string, string> = {
        target_currency: "KRW", target_language: "KO", ship_to_country: "KR",
        page_size: q.get("pageSize") || "20", page_no: q.get("page") || "1",
        sort: q.get("sort") || "LAST_VOLUME_DESC",
      };
      if (q.get("keyword")) biz.keywords = q.get("keyword")!;
      if (ALI_TRACKING_ID) biz.tracking_id = ALI_TRACKING_ID;
      const data = await aliCall("aliexpress.affiliate.hotproduct.query", biz);
      const resp = data?.aliexpress_affiliate_hotproduct_query_response?.resp_result?.result;
      const products = resp?.products?.product || [];
      const items = products.map((p: any) => ({
        name: p.product_title, price: p.target_sale_price || p.sale_price,
        priceText: `${Math.round(p.target_sale_price || p.sale_price || 0).toLocaleString()}원`,
        originalPrice: p.target_original_price || p.original_price, discount: p.discount,
        salesVolume: p.lastest_volume, rating: p.evaluate_rate,
        image: p.product_main_image_url, link: p.promotion_link || p.product_detail_url,
        category: p.first_level_category_name, subCategory: p.second_level_category_name,
        shopName: p.shop_name, commission: p.commission_rate,
      }));
      return json({ success: true, data: items, fetchedAt: new Date().toISOString() });
    }

    return json({ error: "NOT_FOUND", path }, 404);
  } catch (err) {
    return json({ error: "API_ERROR", message: String(err?.message || err) }, 500);
  }
});

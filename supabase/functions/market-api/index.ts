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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const naverConfigured = () => !!(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
const aliConfigured = () => !!(ALI_APP_KEY && ALI_APP_SECRET);

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
  const chunks: typeof NAVER_CATEGORIES[] = [];
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

// ===== 라우터 =====
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // 함수 prefix 이후의 경로만 추출 (.../market-api/api/naver/categories → /api/naver/categories)
  const path = url.pathname.replace(/^.*\/market-api/, "") || "/";
  const q = url.searchParams;

  try {
    if (path === "/api/status") {
      return json({ naverConfigured: naverConfigured(), aliConfigured: aliConfigured(), serverTime: new Date().toISOString() });
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

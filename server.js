require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const GOOGLE_SHEETS_WEBHOOK = process.env.GOOGLE_SHEETS_WEBHOOK;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '30 7 * * *';
const ALI_APP_KEY = process.env.ALI_APP_KEY;
const ALI_APP_SECRET = process.env.ALI_APP_SECRET;
const ALI_TRACKING_ID = process.env.ALI_TRACKING_ID;
const aliConfigured = () => !!(ALI_APP_KEY && ALI_APP_KEY !== '여기에_알리_앱키' && ALI_APP_SECRET && ALI_APP_SECRET !== '여기에_알리_앱시크릿');

// 캐시: 마지막으로 가져온 네이버 데이터 저장
let naverCache = { data: null, fetchedAt: null };

// ===== 네이버 DataLab API =====
const NAVER_CATEGORIES = [
  { name: '식품', code: '50000006' },
  { name: '화장품/미용', code: '50000003' },
  { name: '패션의류', code: '50000001' },
  { name: '가구/인테리어', code: '50000005' },
  { name: '출산/육아', code: '50000002' },
  { name: '스포츠/레저', code: '50000007' },
  { name: '디지털/가전', code: '50000004' },
];

// 기간별 날짜 계산
function getPeriodDates(period) {
  const end = new Date();
  const start = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);

  if (period === 'daily') {
    start.setDate(end.getDate() - 30); // 최근 30일, 일별
  } else if (period === 'weekly') {
    start.setDate(end.getDate() - 84); // 최근 12주
  } else if (period === 'monthly') {
    start.setMonth(end.getMonth() - 12); // 최근 12개월
  } else if (period === 'yearly') {
    start.setFullYear(end.getFullYear() - 3); // 최근 3년
  }
  return { startDate: fmt(start), endDate: fmt(end) };
}

// 네이버 DataLab 카테고리 트렌드 조회 (최대 3개씩 분할 요청)
async function fetchNaverCategoryTrend(period) {
  const { startDate, endDate } = getPeriodDates(period);
  const timeUnit = period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month';
  const headers = {
    'X-Naver-Client-Id': NAVER_CLIENT_ID,
    'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    'Content-Type': 'application/json',
  };

  // API 한 번에 최대 3개 허용 → 배치로 나눠 요청
  const chunkSize = 3;
  const chunks = [];
  for (let i = 0; i < NAVER_CATEGORIES.length; i += chunkSize) {
    chunks.push(NAVER_CATEGORIES.slice(i, i + chunkSize));
  }

  const allResults = [];
  for (const chunk of chunks) {
    const body = {
      startDate, endDate, timeUnit,
      category: chunk.map(c => ({ name: c.name, param: [c.code] })),
    };
    const res = await axios.post(
      'https://openapi.naver.com/v1/datalab/shopping/categories',
      body,
      { headers }
    );
    allResults.push(...res.data.results);
  }

  return { results: allResults };
}

// 네이버 키워드 트렌드 조회
async function fetchNaverKeywords(keywords, period) {
  const { startDate, endDate } = getPeriodDates(period);
  const timeUnit = period === 'daily' ? 'date' : period === 'weekly' ? 'week' : 'month';

  const body = {
    startDate,
    endDate,
    timeUnit,
    keywordGroups: keywords.map(kw => ({ groupName: kw, keywords: [kw] })),
    device: '',
    ages: [],
    gender: ''
  };

  const res = await axios.post(
    'https://openapi.naver.com/v1/datalab/shopping/keywords',
    body,
    {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
        'Content-Type': 'application/json',
      }
    }
  );
  return res.data;
}

// ===== API 라우터 =====

// 네이버 카테고리 트렌드
app.get('/api/naver/categories', async (req, res) => {
  if (!NAVER_CLIENT_ID || NAVER_CLIENT_ID === '여기에_클라이언트_아이디') {
    return res.status(503).json({ error: 'NAVER_API_NOT_CONFIGURED', message: '네이버 API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.' });
  }
  try {
    const period = req.query.period || 'daily';
    const data = await fetchNaverCategoryTrend(period);
    // 각 카테고리의 최근 ratio 값으로 순위 계산
    const ranked = data.results.map(r => {
      const latest = r.data[r.data.length - 1];
      const prev = r.data[r.data.length - 2];
      const ratio = latest?.ratio || 0;
      const prevRatio = prev?.ratio || ratio;
      const change = prevRatio > 0 ? ((ratio - prevRatio) / prevRatio * 100).toFixed(1) : 0;
      return {
        name: r.title,
        ratio: ratio.toFixed(1),
        change: parseFloat(change),
        trend: change > 5 ? 'up' : change < -5 ? 'down' : 'same',
        data: r.data.map(d => ({ period: d.period, ratio: d.ratio }))
      };
    }).sort((a, b) => b.ratio - a.ratio);
    naverCache = { data: ranked, fetchedAt: new Date().toISOString() };
    res.json({ success: true, data: ranked, fetchedAt: naverCache.fetchedAt });
  } catch (err) {
    console.error('Naver API error:', JSON.stringify(err.response?.data), err.message);
    res.status(500).json({ error: 'NAVER_API_ERROR', message: err.response?.data?.errorMessage || err.message });
  }
});

// 네이버 키워드 트렌드
app.post('/api/naver/keywords', async (req, res) => {
  if (!NAVER_CLIENT_ID || NAVER_CLIENT_ID === '여기에_클라이언트_아이디') {
    return res.status(503).json({ error: 'NAVER_API_NOT_CONFIGURED' });
  }
  try {
    const { keywords, period } = req.body;
    if (!keywords || keywords.length === 0) return res.status(400).json({ error: 'keywords required' });
    const data = await fetchNaverKeywords(keywords.slice(0, 5), period || 'daily');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: 'NAVER_API_ERROR', message: err.message });
  }
});

// 카테고리별 대표 검색 키워드 (DataLab 카테고리명 → 쇼핑 검색어)
const CATEGORY_KEYWORDS = {
  '식품': ['제철과일', '간편식', '건강간식', '밀키트'],
  '화장품/미용': ['선크림', '쿠션', '세럼', '클렌징'],
  '패션의류': ['여름원피스', '린넨셔츠', '와이드팬츠', '샌들'],
  '가구/인테리어': ['수납장', '조명', '러그', '커튼'],
  '출산/육아': ['이유식', '아기띠', '유아간식', '기저귀'],
  '스포츠/레저': ['캠핑의자', '요가매트', '러닝화', '등산용품'],
  '디지털/가전': ['무선이어폰', '선풍기', '보조배터리', '블루투스스피커'],
};

// 가격 포맷 (만원 단위)
function formatPrice(lo, hi) {
  const f = n => n >= 10000 ? `${(n/10000).toFixed(n%10000===0?0:1)}만` : `${(n/1000).toFixed(0)}천`;
  if (lo === hi) return `${f(lo)}원`;
  return `${f(lo)}~${f(hi)}원`;
}

// 네이버 쇼핑 검색 - 키워드로 실제 상품 조회
async function fetchNaverShopItems(query, display = 5, sort = 'sim') {
  const res = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
    params: { query, display, sort } // sort: sim(정확도), date, asc, dsc(가격)
  });
  return res.data;
}

const stripTags = s => (s || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// 카테고리 → 실제 상품 목록 (DataLab 트렌드 카테고리 기반)
app.get('/api/naver/products', async (req, res) => {
  if (!NAVER_CLIENT_ID || NAVER_CLIENT_ID === '여기에_클라이언트_아이디') {
    return res.status(503).json({ error: 'NAVER_API_NOT_CONFIGURED' });
  }
  try {
    const categoryName = req.query.category; // 특정 카테고리 지정 시 해당 분야 TOP 20
    const perKeyword = parseInt(req.query.perKeyword) || 5;

    // 조회 계획 수립
    let plan; // [{ cat, kw }]
    if (categoryName) {
      // 특정 카테고리: 대표 검색어 전부 사용 → 합산 TOP 20
      const kws = CATEGORY_KEYWORDS[categoryName] || [categoryName];
      plan = kws.map(kw => ({ cat: categoryName, kw }));
    } else {
      // 전체: 트렌드 상위 4개 카테고리 각 1개 검색어
      const cats = naverCache.data ? naverCache.data.slice(0, 4).map(c => c.name) : Object.keys(CATEGORY_KEYWORDS).slice(0, 4);
      plan = cats.map(cat => {
        const kws = CATEGORY_KEYWORDS[cat] || [cat];
        return { cat, kw: kws[Math.floor(Math.random() * kws.length)] };
      });
    }

    const mapItem = (it, catName, kw) => {
      const lo = parseInt(it.lprice) || 0;
      const hi = parseInt(it.hprice) || 0;
      return {
        name: stripTags(it.title),
        mallName: it.mallName || '네이버쇼핑',
        price: lo,
        priceLow: lo,
        priceHigh: hi,
        priceText: lo ? `${lo.toLocaleString()}원` : '가격문의',
        priceRangeText: (hi && hi > lo) ? `${lo.toLocaleString()}~${hi.toLocaleString()}원` : (lo ? `${lo.toLocaleString()}원` : '가격문의'),
        category: catName,
        subCategory: [it.category2, it.category3, it.category4].filter(Boolean).join(' > '),
        brand: it.brand || it.maker || '',
        keyword: kw,
        image: it.image,
        link: it.link,
        productId: it.productId,
      };
    };

    const result = [];
    const seen = new Set();
    for (const { cat, kw } of plan) {
      const shop = await fetchNaverShopItems(kw, perKeyword, 'sim');
      const items = (shop.items || [])
        .map(it => mapItem(it, cat, kw))
        .filter(it => { // 카테고리 내 중복 상품 제거
          const key = it.productId || it.name;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
      result.push({ category: cat, searchKeyword: kw, items });
    }
    res.json({ success: true, data: result, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Naver Shop API error:', JSON.stringify(err.response?.data), err.message);
    res.status(500).json({ error: 'NAVER_SHOP_ERROR', message: err.response?.data?.errorMessage || err.message });
  }
});

// 키워드로 직접 상품 검색
app.get('/api/naver/search', async (req, res) => {
  if (!NAVER_CLIENT_ID || NAVER_CLIENT_ID === '여기에_클라이언트_아이디') {
    return res.status(503).json({ error: 'NAVER_API_NOT_CONFIGURED' });
  }
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'query required' });
    const sort = req.query.sort || 'sim';
    const shop = await fetchNaverShopItems(query, parseInt(req.query.display) || 10, sort);
    const items = (shop.items || []).map(it => {
      const lo = parseInt(it.lprice) || 0;
      const hi = parseInt(it.hprice) || 0;
      return {
        name: stripTags(it.title),
        mallName: it.mallName || '네이버쇼핑',
        price: lo,
        priceLow: lo,
        priceHigh: hi,
        priceText: lo ? `${lo.toLocaleString()}원` : '가격문의',
        priceRangeText: (hi && hi > lo) ? `${lo.toLocaleString()}~${hi.toLocaleString()}원` : (lo ? `${lo.toLocaleString()}원` : '가격문의'),
        subCategory: [it.category2, it.category3, it.category4].filter(Boolean).join(' > '),
        brand: it.brand || it.maker || '',
        image: it.image,
        link: it.link,
        productId: it.productId,
      };
    });
    res.json({ success: true, query, total: shop.total, data: items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Naver Search API error:', JSON.stringify(err.response?.data), err.message);
    res.status(500).json({ error: 'NAVER_SHOP_ERROR', message: err.response?.data?.errorMessage || err.message });
  }
});

// ===== 알리익스프레스 어필리에이트 API =====
// TOP API 방식 서명 (sign_method=md5)
const ALI_GATEWAY = 'https://api-sg.aliexpress.com/sync';

function aliSign(params, secret) {
  const sorted = Object.keys(params).sort();
  let base = secret;
  for (const k of sorted) base += k + params[k];
  base += secret;
  return crypto.createHash('md5').update(base, 'utf8').digest('hex').toUpperCase();
}

async function aliCall(method, bizParams) {
  const sys = {
    app_key: ALI_APP_KEY,
    method,
    sign_method: 'md5',
    timestamp: String(Date.now()),
    format: 'json',
    v: '2.0',
  };
  const all = { ...sys, ...bizParams };
  all.sign = aliSign(all, ALI_APP_SECRET);
  const res = await axios.post(ALI_GATEWAY, null, { params: all, timeout: 15000 });
  return res.data;
}

// 알리 인기 상품 (카테고리/키워드별)
app.get('/api/ali/hotproducts', async (req, res) => {
  if (!aliConfigured()) {
    return res.status(503).json({ error: 'ALI_API_NOT_CONFIGURED', message: '알리 App Key/Secret이 설정되지 않았습니다. .env 파일을 확인해주세요.' });
  }
  try {
    const biz = {
      target_currency: 'KRW',
      target_language: 'KO',
      ship_to_country: 'KR',
      page_size: String(req.query.pageSize || 20),
      page_no: String(req.query.page || 1),
      sort: req.query.sort || 'LAST_VOLUME_DESC', // 판매량순
    };
    if (req.query.keyword) biz.keywords = req.query.keyword;
    if (req.query.categoryId) biz.category_ids = req.query.categoryId;
    if (ALI_TRACKING_ID && ALI_TRACKING_ID !== '여기에_트래킹_ID') biz.tracking_id = ALI_TRACKING_ID;

    const data = await aliCall('aliexpress.affiliate.hotproduct.query', biz);

    // 응답 정규화 (알리 응답 구조 깊음)
    const resp = data?.aliexpress_affiliate_hotproduct_query_response?.resp_result?.result;
    const products = resp?.products?.product || [];
    const items = products.map(p => ({
      name: p.product_title,
      price: p.target_sale_price || p.sale_price,
      priceText: `${Math.round(p.target_sale_price || p.sale_price || 0).toLocaleString()}원`,
      originalPrice: p.target_original_price || p.original_price,
      discount: p.discount,
      salesVolume: p.lastest_volume,      // 최근 판매량 (리뷰 대체 지표!)
      rating: p.evaluate_rate,            // 평점
      image: p.product_main_image_url,
      link: p.promotion_link || p.product_detail_url,
      category: p.first_level_category_name,
      subCategory: p.second_level_category_name,
      shopName: p.shop_name,
      commission: p.commission_rate,
    }));
    res.json({ success: true, data: items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Ali API error:', JSON.stringify(err.response?.data), err.message);
    res.status(500).json({ error: 'ALI_API_ERROR', message: err.response?.data?.error_response?.msg || err.message });
  }
});

// 서버 상태 / API 설정 여부
app.get('/api/status', (req, res) => {
  res.json({
    naverConfigured: !!(NAVER_CLIENT_ID && NAVER_CLIENT_ID !== '여기에_클라이언트_아이디'),
    sheetsConfigured: !!(GOOGLE_SHEETS_WEBHOOK && GOOGLE_SHEETS_WEBHOOK !== '여기에_앱스크립트_웹앱_URL'),
    aliConfigured: aliConfigured(),
    lastFetch: naverCache.fetchedAt,
    cronSchedule: CRON_SCHEDULE,
    serverTime: new Date().toISOString()
  });
});

// Google Sheets 저장
app.post('/api/sheets/save', async (req, res) => {
  if (!GOOGLE_SHEETS_WEBHOOK || GOOGLE_SHEETS_WEBHOOK === '여기에_앱스크립트_웹앱_URL') {
    return res.status(503).json({ error: 'SHEETS_NOT_CONFIGURED', message: 'Google Sheets 웹훅이 설정되지 않았습니다.' });
  }
  try {
    const payload = req.body;
    const response = await axios.post(GOOGLE_SHEETS_WEBHOOK, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.json({ success: true, sheetsResponse: response.data });
  } catch (err) {
    res.status(500).json({ error: 'SHEETS_ERROR', message: err.message });
  }
});

// ===== 자동 스케줄러 =====
cron.schedule(CRON_SCHEDULE, async () => {
  console.log(`[스케줄러] ${new Date().toLocaleString('ko-KR')} - 네이버 트렌드 자동 수집 시작`);
  try {
    if (NAVER_CLIENT_ID && NAVER_CLIENT_ID !== '여기에_클라이언트_아이디') {
      const data = await fetchNaverCategoryTrend('daily');
      naverCache = { data, fetchedAt: new Date().toISOString() };
      console.log('[스케줄러] 데이터 수집 완료');
    } else {
      console.log('[스케줄러] 네이버 API 미설정 - 목업 데이터 유지');
    }
  } catch (err) {
    console.error('[스케줄러] 오류:', err.message);
  }
}, { timezone: 'Asia/Seoul' });

// ===== SPA 폴백 =====
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🥔 감자마켓 트렌드 대시보드`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   자동 수집: ${CRON_SCHEDULE} (Asia/Seoul)\n`);
});

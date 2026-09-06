const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnv();

const PORT = Number(process.env.PORT || 5177);
const API_KEY = process.env.PUBLIC_DATA_API_KEY || "";
const VWORLD_API_KEY = process.env.VWORLD_API_KEY || "";
const LAWD_CD = "51150";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const endpoints = {
  sale: [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  ],
  rent: [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  ],
};

const transactionCache = new Map();
const monthCache = new Map();
const geocodeCache = new Map();
const CACHE_MS = 1000 * 60 * 20;
const FETCH_TIMEOUT_MS = 9000;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/transactions") {
      await handleTransactions(url, res);
      return;
    }
    if (url.pathname === "/api/geocode") {
      await handleGeocode(url, res);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, () => {
  console.log(`Gangneung dashboard running at http://localhost:${PORT}`);
});

async function handleTransactions(url, res) {
  if (!API_KEY) {
    sendJson(res, 500, { error: ".env 파일에 PUBLIC_DATA_API_KEY를 설정해 주세요." });
    return;
  }

  const months = clamp(Number(url.searchParams.get("months") || 12), 1, 72);
  const cacheKey = String(months);
  const cached = getFreshCache(transactionCache, cacheKey);
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const dealMonths = lastMonths(months);
  const tasks = dealMonths.flatMap((month) => ["sale", "rent"].map((type) => ({ month, type })));
  const errors = [];

  const chunks = await runWithConcurrency(tasks, 6, async ({ month, type }) => {
      try {
        return await fetchMonth(type, month);
      } catch (error) {
        errors.push(`${type}:${month}:${error.message}`);
        return [];
      }
  });
  const all = chunks.flat();

  const payload = {
    generatedAt: new Date().toISOString(),
    region: { name: "강릉시", lawdCd: LAWD_CD },
    months: dealMonths,
    rows: all,
    warnings: errors.slice(0, 8),
    cached: false,
  };
  transactionCache.set(cacheKey, { time: Date.now(), data: payload });
  sendJson(res, 200, payload);
}

async function fetchMonth(type, dealMonth) {
  const cacheKey = `${type}:${dealMonth}`;
  const cached = getFreshCache(monthCache, cacheKey);
  if (cached) return cached;

  const candidates = Array.isArray(endpoints[type]) ? endpoints[type] : [endpoints[type]];
  const errors = [];
  for (const endpoint of candidates) {
    try {
      const rows = await fetchMonthFromEndpoint(type, dealMonth, endpoint);
      monthCache.set(cacheKey, { time: Date.now(), data: rows });
      return rows;
    } catch (error) {
      errors.push(`${endpointLabel(endpoint)} ${error.message}`);
    }
  }

  throw new Error(errors.join(" / ").slice(0, 180));
}

async function fetchMonthFromEndpoint(type, dealMonth, endpoint) {
  const rows = [];
  let pageNo = 1;
  let totalCount = 0;

  do {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", API_KEY);
    url.searchParams.set("LAWD_CD", LAWD_CD);
    url.searchParams.set("DEAL_YMD", dealMonth);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", "1000");

    const { response, text } = await fetchTextWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|INVALID_REQUEST_PARAMETER_ERROR|SERVICE ERROR/i.test(text)) {
      throw new Error(stripTags(text).slice(0, 120));
    }

    const parsed = parseRtmsXml(text);
    totalCount = parsed.totalCount || rows.length;
    rows.push(...parsed.items.map((item) => normalizeItem(item, type, dealMonth)));
    pageNo += 1;
  } while ((pageNo - 1) * 1000 < totalCount && pageNo < 20);

  return rows;
}

function normalizeItem(item, type, dealMonth) {
  const rentType = Number(cleanNumber(get(item, ["월세금액", "월세액", "monthlyRent"]))) > 0 ? "월세" : "전세";
  const amount = type === "sale"
    ? cleanNumber(get(item, ["거래금액", "dealAmount"]))
    : cleanNumber(get(item, ["보증금액", "deposit"]));
  const monthlyRent = cleanNumber(get(item, ["월세금액", "월세액", "monthlyRent"]));
  const day = String(get(item, ["거래일", "dealDay"]) || "01").padStart(2, "0");
  const dong = tidy(get(item, ["법정동", "umdNm"]) || "강릉시");
  const jibun = tidy(get(item, ["지번", "jibun"]) || "");
  const roadNm = tidy(get(item, ["도로명", "roadNm"]) || "");
  const roadMain = trimRoadNumber(get(item, ["roadNmBonbun"]));
  const roadSub = trimRoadNumber(get(item, ["roadNmBubun"]));
  const roadAddress = roadNm ? `강원특별자치도 강릉시 ${roadNm}${roadMain ? ` ${roadMain}${roadSub ? `-${roadSub}` : ""}` : ""}` : "";
  const lotAddress = `강원특별자치도 강릉시 ${dong}${jibun ? ` ${jibun}` : ""}`;

  return {
    tradeType: type === "sale" ? "매매" : rentType,
    apartment: tidy(get(item, ["아파트", "aptNm", "단지명"]) || "단지명 미공개"),
    dong,
    date: `${dealMonth.slice(0, 4)}-${dealMonth.slice(4, 6)}-${day}`,
    dealMonth,
    day: Number(day),
    area: Number(cleanNumber(get(item, ["전용면적", "excluUseAr"]))) || null,
    floor: Number(cleanNumber(get(item, ["층", "floor"]))) || null,
    amount,
    monthlyRent,
    buildYear: Number(cleanNumber(get(item, ["건축년도", "buildYear"]))) || null,
    jibun,
    roadNm,
    roadAddress,
    lotAddress,
    address: roadAddress || lotAddress,
  };
}

async function handleGeocode(url, res) {
  if (!VWORLD_API_KEY) {
    sendJson(res, 500, { error: ".env 파일에 VWORLD_API_KEY를 설정해 주세요." });
    return;
  }

  const roadAddress = tidy(url.searchParams.get("roadAddress") || "");
  const lotAddress = tidy(url.searchParams.get("lotAddress") || "");
  const address = tidy(url.searchParams.get("address") || "");
  const cacheKey = [roadAddress, lotAddress, address].filter(Boolean).join("|");
  const cached = getFreshCache(geocodeCache, cacheKey);
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const candidates = [];

  if (roadAddress) candidates.push({ address: roadAddress, type: "road" });
  if (lotAddress && lotAddress !== roadAddress) candidates.push({ address: lotAddress, type: "parcel" });
  if (address && !candidates.some((item) => item.address === address)) {
    candidates.push({ address, type: /로|길/.test(address) ? "road" : "parcel" });
  }

  if (!candidates.length) {
    sendJson(res, 400, { error: "좌표로 변환할 주소가 없습니다." });
    return;
  }

  const warnings = [];
  for (const candidate of candidates) {
    try {
      const result = await fetchVworldCoord(candidate.address, candidate.type);
      geocodeCache.set(cacheKey, { time: Date.now(), data: result });
      sendJson(res, 200, result);
      return;
    } catch (error) {
      warnings.push(`${candidate.type}:${error.message}`);
    }
  }

  sendJson(res, 404, { error: "브이월드에서 주소 좌표를 찾지 못했습니다.", tried: candidates, warnings });
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

function getFreshCache(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

async function fetchVworldCoord(address, type) {
  const url = new URL("https://api.vworld.kr/req/address");
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getcoord");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("address", address);
  url.searchParams.set("refine", "true");
  url.searchParams.set("simple", "false");
  url.searchParams.set("format", "json");
  url.searchParams.set("type", type);
  url.searchParams.set("key", VWORLD_API_KEY);

  const { response, text } = await fetchTextWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(stripTags(text).slice(0, 120) || "JSON 파싱 실패");
  }

  const body = data.response || {};
  if (body.status !== "OK") {
    const detail = body.error?.text || body.status || "NOT_FOUND";
    throw new Error(String(detail).slice(0, 120));
  }

  const point = body.result?.point || {};
  const lng = Number(point.x);
  const lat = Number(point.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("좌표 없음");

  return {
    provider: "VWorld",
    address,
    refinedAddress: body.refined?.text || address,
    type,
    lat,
    lng,
  };
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`응답 지연 ${Math.round(timeoutMs / 1000)}초 초과`);
    }
    throw new Error(error.message || "fetch failed");
  } finally {
    clearTimeout(timer);
  }
}

function endpointLabel(endpoint) {
  if (/AptTradeDev/i.test(endpoint)) return "매매신규";
  if (/AptTrade/i.test(endpoint)) return "매매기본";
  if (/AptRent/i.test(endpoint)) return "전월세";
  return "API";
}

function parseRtmsXml(xml) {
  const totalCount = Number(xml.match(/<totalCount>(.*?)<\/totalCount>/)?.[1] || 0);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const obj = {};
    for (const tag of match[1].matchAll(/<([^/>]+)>([\s\S]*?)<\/\1>/g)) {
      obj[decodeXml(tag[1]).trim()] = decodeXml(tag[2]).trim();
    }
    return obj;
  });
  return { totalCount, items };
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function lastMonths(count) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function get(item, keys) {
  for (const key of keys) if (item[key] != null && item[key] !== "") return item[key];
  return "";
}

function cleanNumber(value) {
  return Number(String(value || "0").replace(/[,\s]/g, ""));
}

function tidy(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function trimRoadNumber(value) {
  const number = String(value || "").trim();
  if (!number || /^0+$/.test(number)) return "";
  return String(Number(number));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

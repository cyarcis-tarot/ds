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
const facilityCache = new Map();
const externalCache = new Map();
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
    if (url.pathname === "/api/health") {
      await handleHealth(url, res);
      return;
    }
    if (url.pathname === "/api/transactions") {
      await handleTransactions(url, res);
      return;
    }
    if (url.pathname === "/api/geocode") {
      await handleGeocode(url, res);
      return;
    }
    if (url.pathname === "/api/facilities") {
      await handleFacilities(url, res);
      return;
    }
    if (url.pathname === "/api/external-indicators") {
      await handleExternalIndicators(res);
      return;
    }
    if (url.pathname === "/api/map-tile") {
      await handleMapTile(url, res);
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

async function handleHealth(url, res) {
  const probe = url.searchParams.get("probe") === "1";
  const payload = {
    generatedAt: new Date().toISOString(),
    region: { name: "강릉시", lawdCd: LAWD_CD },
    providers: {
      transactions: {
        name: "국토교통부 아파트 실거래가",
        configured: Boolean(API_KEY),
        endpoints: {
          sale: endpoints.sale.map(endpointLabel),
          rent: endpoints.rent.map(endpointLabel),
        },
      },
      geocode: {
        name: "VWorld 주소 좌표 변환",
        configured: Boolean(VWORLD_API_KEY),
      },
    },
  };

  if (probe && API_KEY) {
    payload.providers.transactions.probe = await probeTransactions();
  }

  if (probe && VWORLD_API_KEY) {
    payload.providers.geocode.probe = await probeGeocode();
  }

  sendJson(res, 200, payload);
}

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

async function handleFacilities(url, res) {
  if (!VWORLD_API_KEY) {
    sendJson(res, 500, { error: ".env.local 파일에 VWORLD_API_KEY를 설정해 주세요." });
    return;
  }

  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const radius = clamp(Number(url.searchParams.get("radius") || 2500), 500, 5000);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJson(res, 400, { error: "시설 검색 기준 좌표가 필요합니다." });
    return;
  }

  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)},${radius}`;
  const cached = getFreshCache(facilityCache, cacheKey);
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const categories = [
    { key: "school", label: "학교", queries: ["초등학교", "중학교", "고등학교", "학교"] },
    { key: "transport", label: "교통", queries: ["강릉역", "강릉고속버스터미널", "강릉시외버스터미널"] },
    { key: "commerce", label: "상권", queries: ["시장", "마트", "편의점"] },
    { key: "medical", label: "의료", queries: ["병원", "의원"] },
    { key: "park", label: "공원", queries: ["공원"] },
  ];

  const results = [];
  const warnings = [];
  for (const category of categories) {
    const places = [];
    for (const query of category.queries) {
      try {
        places.push(...await fetchVworldPlaces(query, lat, lng, radius));
      } catch (error) {
        warnings.push(`${category.label}:${query}:${error.message}`);
      }
    }

    const nearest = uniquePlaces(places)
      .map((place) => ({ ...place, distanceM: Math.round(haversineMeters(lat, lng, place.lat, place.lng)) }))
      .filter((place) => place.distanceM <= radius)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 3);

    if (nearest.length) {
      results.push({ key: category.key, label: category.label, places: nearest });
    }
  }

  const payload = {
    provider: "VWorld",
    generatedAt: new Date().toISOString(),
    center: { lat, lng },
    radiusM: radius,
    categories: results,
    warnings: warnings.slice(0, 8),
  };
  facilityCache.set(cacheKey, { time: Date.now(), data: payload });
  sendJson(res, 200, payload);
}

async function handleExternalIndicators(res) {
  const cached = getFreshCache(externalCache, "market");
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const csvPath = path.join(ROOT, "data", "market-indicators.csv");
  if (!fs.existsSync(csvPath)) {
    const payload = {
      configured: false,
      generatedAt: new Date().toISOString(),
      rows: [],
      latest: null,
      todo: [
        "프로젝트 루트의 data 폴더에 market-indicators.csv를 추가하세요.",
        "필수 열: year, unsoldUnits, moveInUnits, householdIncome",
        "선택 열: mortgageRate, source",
      ],
    };
    externalCache.set("market", { time: Date.now(), data: payload });
    sendJson(res, 200, payload);
    return;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8")).map((row) => ({
    year: Number(row.year),
    unsoldUnits: Number(cleanNumber(row.unsoldUnits)),
    moveInUnits: Number(cleanNumber(row.moveInUnits)),
    householdIncome: Number(cleanNumber(row.householdIncome)),
    mortgageRate: Number(cleanNumber(row.mortgageRate)),
    source: tidy(row.source),
  })).filter((row) => Number.isFinite(row.year));

  const economicPath = path.join(ROOT, "data", "economic-indicators.csv");
  const economicRows = fs.existsSync(economicPath)
    ? parseCsv(fs.readFileSync(economicPath, "utf8")).map(normalizeEconomicIndicator)
    : [];
  const currentYear = new Date().getFullYear();
  const latestPool = rows.filter((row) => row.year <= currentYear);
  const latest = (latestPool.length ? latestPool : rows).slice().sort((a, b) => b.year - a.year)[0] || null;
  const payload = {
    configured: true,
    generatedAt: new Date().toISOString(),
    rows,
    latest,
    economic: {
      configured: economicRows.length > 0,
      latest: economicRows[0] || null,
      rows: economicRows,
      source: economicRows[0]?.source || "",
    },
    todo: rows.length ? [] : ["market-indicators.csv에 최소 1개 연도 데이터를 입력하세요."],
  };
  externalCache.set("market", { time: Date.now(), data: payload });
  sendJson(res, 200, payload);
}

function normalizeEconomicIndicator(row) {
  return {
    period: tidy(row.period),
    industrialTenants: Number(cleanNumber(row.industrialTenants)),
    operatingCompanies: Number(cleanNumber(row.operatingCompanies)),
    industrialEmployment: Number(cleanNumber(row.industrialEmployment)),
    industrialEmploymentChange6m: Number(cleanNumber(row.industrialEmploymentChange6m)),
    completedUnsold: Number(cleanNumber(row.completedUnsold)),
    completedUnsoldChange6m: Number(cleanNumber(row.completedUnsoldChange6m)),
    apartmentTransactions: Number(cleanNumber(row.apartmentTransactions)),
    apartmentTransactionsHalfChangePct: Number(cleanNumber(row.apartmentTransactionsHalfChangePct)),
    apartmentTransactionsYoyPct: Number(cleanNumber(row.apartmentTransactionsYoyPct)),
    exportsHalfMillionUsd: Number(cleanNumber(row.exportsHalfMillionUsd)),
    exportsHalfChangePct: Number(cleanNumber(row.exportsHalfChangePct)),
    importsHalfMillionUsd: Number(cleanNumber(row.importsHalfMillionUsd)),
    importsHalfChangePct: Number(cleanNumber(row.importsHalfChangePct)),
    depositsEok: Number(cleanNumber(row.depositsEok)),
    depositsYoyPct: Number(cleanNumber(row.depositsYoyPct)),
    loansEok: Number(cleanNumber(row.loansEok)),
    loansYoyPct: Number(cleanNumber(row.loansYoyPct)),
    populationTotal: Number(cleanNumber(row.populationTotal)),
    populationChange6m: Number(cleanNumber(row.populationChange6m)),
    youthPopulation: Number(cleanNumber(row.youthPopulation)),
    youthPopulationChange6m: Number(cleanNumber(row.youthPopulationChange6m)),
    laborParticipationPct: Number(cleanNumber(row.laborParticipationPct)),
    employmentPct: Number(cleanNumber(row.employmentPct)),
    unemploymentPct: Number(cleanNumber(row.unemploymentPct)),
    visitorsH2: Number(cleanNumber(row.visitorsH2)),
    visitorsYoyPct: Number(cleanNumber(row.visitorsYoyPct)),
    foreignVisitorsH2: Number(cleanNumber(row.foreignVisitorsH2)),
    stationRidersH2: Number(cleanNumber(row.stationRidersH2)),
    stationRidersYoyPct: Number(cleanNumber(row.stationRidersYoyPct)),
    source: tidy(row.source),
  };
}

async function handleMapTile(url, res) {
  if (!VWORLD_API_KEY) {
    sendJson(res, 500, { error: ".env 파일에 VWORLD_API_KEY를 설정해 주세요." });
    return;
  }

  const z = clamp(Number(url.searchParams.get("z")), 6, 19);
  const x = Number(url.searchParams.get("x"));
  const y = Number(url.searchParams.get("y"));
  if (![z, x, y].every(Number.isInteger)) {
    sendJson(res, 400, { error: "지도 타일 좌표가 올바르지 않습니다." });
    return;
  }

  const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(VWORLD_API_KEY)}/Base/${z}/${y}/${x}.png`;
  const response = await fetch(tileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    sendJson(res, response.status, { error: `VWorld 지도 타일 응답 오류 ${response.status}` });
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    ...corsHeaders(),
    "content-type": response.headers.get("content-type") || "image/png",
    "cache-control": "public, max-age=86400",
  });
  res.end(buffer);
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

async function fetchVworldPlaces(query, lat, lng, radiusM) {
  const delta = radiusM / 111320;
  const lngDelta = radiusM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const url = new URL("https://api.vworld.kr/req/search");
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("query", query);
  url.searchParams.set("type", "place");
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("bbox", [
    lng - lngDelta,
    lat - delta,
    lng + lngDelta,
    lat + delta,
  ].map((value) => value.toFixed(7)).join(","));
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
    if (body.status === "NOT_FOUND") return [];
    const detail = body.error?.text || body.status || "NOT_FOUND";
    throw new Error(String(detail).slice(0, 120));
  }

  const items = Array.isArray(body.result?.items) ? body.result.items : [];
  return items.map((item) => {
    const point = item.point || {};
    const placeLat = Number(point.y);
    const placeLng = Number(point.x);
    if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return null;
    return {
      name: tidy(stripTags(item.title || item.name || query)),
      address: tidy(stripTags(item.address?.road || item.address?.parcel || item.address || "")),
      lat: placeLat,
      lng: placeLng,
      sourceQuery: query,
    };
  }).filter(Boolean);
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
    throw new Error(summarizeFetchError(error));
  } finally {
    clearTimeout(timer);
  }
}

async function probeTransactions() {
  const month = lastMonths(1)[0];
  try {
    await fetchMonthFromEndpoint("sale", month, endpoints.sale[0]);
    return { ok: true, checkedMonth: month };
  } catch (error) {
    return { ok: false, checkedMonth: month, error: error.message };
  }
}

async function probeGeocode() {
  try {
    const result = await fetchVworldCoord("강원특별자치도 강릉시청", "road");
    return { ok: true, lat: result.lat, lng: result.lng };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function summarizeFetchError(error) {
  const parts = [error.message || "fetch failed"];
  const cause = error.cause || {};
  if (cause.code) parts.push(cause.code);
  if (cause.reason) parts.push(cause.reason);
  if (cause.message && cause.message !== error.message) parts.push(cause.message);
  return [...new Set(parts.filter(Boolean))].join(" · ").slice(0, 160);
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

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function serveStatic(requestPath, res) {
  let safePath = requestPath === "/" ? "/dashboard.html" : decodeURIComponent(requestPath);
  if (safePath === "/public") safePath = "/index.html";
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
  for (const fileName of [".env.local", ".env"]) {
    const envPath = path.join(__dirname, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
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

function uniquePlaces(places) {
  const seen = new Set();
  return places.filter((place) => {
    const key = `${place.name}|${place.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trimRoadNumber(value) {
  const number = String(value || "").trim();
  if (!number || /^0+$/.test(number)) return "";
  return String(Number(number));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

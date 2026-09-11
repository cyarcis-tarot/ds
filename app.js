const state = {
  rows: [],
  baseRows: [],
  periodRows: [],
  filtered: [],
  trendRows: [],
  top10: [],
  isSample: false,
  activeMetric: "demand",
  calendarMonth: "",
  dealType: "all",
  geocodeCache: new Map(),
  mapRequestId: 0,
  loadRequestId: 0,
  dataCache: new Map(),
  apiHealth: null,
  facilityCache: new Map(),
  externalData: null,
  mapState: null,
  sourceStatus: {
    transactions: { state: "checking", lastChecked: "", detail: "확인 중" },
    geocode: { state: "checking", lastChecked: "", detail: "확인 중" },
  },
};

const el = {
  refreshBtn: document.querySelector("#refreshBtn"),
  printBtn: document.querySelector("#printBtn"),
  periodSelect: document.querySelector("#periodSelect"),
  dongSelect: document.querySelector("#dongSelect"),
  aptSelect: document.querySelector("#aptSelect"),
  calendarMonthSelect: document.querySelector("#calendarMonthSelect"),
  calendarTitle: document.querySelector("#calendarTitle"),
  dealTypeSelect: document.querySelector("#dealTypeSelect"),
  filterMeta: document.querySelector("#filterMeta"),
  totalDeals: document.querySelector("#totalDeals"),
  saleDeals: document.querySelector("#saleDeals"),
  jeonseDeals: document.querySelector("#jeonseDeals"),
  rentDeals: document.querySelector("#rentDeals"),
  additionalAnalysis: document.querySelector("#additionalAnalysis"),
  sourceStatus: document.querySelector("#sourceStatus"),
  forecastBadge: document.querySelector("#forecastBadge"),
  marketScore: document.querySelector("#marketScore"),
  forecastTitle: document.querySelector("#forecastTitle"),
  forecastSummary: document.querySelector("#forecastSummary"),
  signalPills: document.querySelector("#signalPills"),
  profitCards: document.querySelector("#profitCards"),
  metricTabs: document.querySelector("#metricTabs"),
  metricInsight: document.querySelector("#metricInsight"),
  externalDataStatus: document.querySelector("#externalDataStatus"),
  rankMeta: document.querySelector("#rankMeta"),
  topList: document.querySelector("#topList"),
  calendar: document.querySelector("#calendar"),
  status: document.querySelector("#status"),
  locationScore: document.querySelector("#locationScore"),
  mapAptName: document.querySelector("#mapAptName"),
  mapAddress: document.querySelector("#mapAddress"),
  mapLinks: document.querySelector("#mapLinks"),
  mapFrame: document.querySelector("#mapFrame"),
  mapRadiusOverlay: document.querySelector("#mapRadiusOverlay"),
  dealTableMeta: document.querySelector("#dealTableMeta"),
  dealTable: document.querySelector("#dealTable"),
  typeChart: document.querySelector("#typeChart"),
  compareChart: document.querySelector("#compareChart"),
  trendTypeSelect: document.querySelector("#trendTypeSelect"),
  trendMonthsSelect: document.querySelector("#trendMonthsSelect"),
  trendChart: document.querySelector("#trendChart"),
  projectionYearsSelect: document.querySelector("#projectionYearsSelect"),
  projectionContent: document.querySelector("#projectionContent"),
};

const colors = {
  cyan: "#5bc8c2",
  sale: "#68cfc8",
  jeonse: "#f07f7f",
  rent: "#f1c76d",
  violet: "#7b8fe8",
  grid: "rgba(47, 56, 66, .12)",
  text: "#333333",
};

const API_ORIGIN = window.location.protocol === "file:" ? "http://localhost:5177" : "";
const FETCH_MONTHS = 24;
const ANALYSIS_MONTHS = 12;
const PERIOD_LABELS = {
  daily: "일간",
  weekly: "주간",
  monthly: "월간",
  yearly: "년간",
};

el.refreshBtn.addEventListener("click", loadData);
el.printBtn.addEventListener("click", () => window.print());
el.periodSelect.addEventListener("change", () => {
  render();
  const periodLabel = getPeriodLabel(el.periodSelect.value);
  setStatus(`${periodLabel} 기준으로 화면 전체 지표를 다시 계산했습니다.`);
});
el.dongSelect.addEventListener("change", () => {
  hydrateFilters();
  render();
});
el.aptSelect.addEventListener("change", render);
el.calendarMonthSelect.addEventListener("change", () => {
  state.calendarMonth = el.calendarMonthSelect.value;
  renderCalendar();
});
el.dealTypeSelect.addEventListener("change", () => {
  state.dealType = el.dealTypeSelect.value;
  renderCalendar();
  renderDealTable();
});
el.trendTypeSelect.addEventListener("change", drawTrendChart);
el.trendMonthsSelect.addEventListener("change", drawTrendChart);
el.projectionYearsSelect?.addEventListener("change", renderProjection);
el.topList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-apt]");
  if (!row) return;
  el.aptSelect.value = row.dataset.apt;
  render();
});
el.metricTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-metric]");
  if (!tab) return;
  state.activeMetric = tab.dataset.metric;
  renderFramework();
});
window.addEventListener("resize", debounce(renderCharts, 120));
window.addEventListener("resize", debounce(renderMapTiles, 120));

loadData();

async function loadData() {
  const requestId = ++state.loadRequestId;
  const requestedMonths = String(getFetchMonths());
  const cached = state.dataCache.get(requestedMonths);
  if (cached) {
    useTransactionData(cached, true);
    return;
  }

  setStatus("공공데이터포털에서 강릉시 실거래가를 불러오는 중입니다.");
  try {
    const health = await getApiHealth();
    if (requestId !== state.loadRequestId) return;
    const missing = getMissingProviders(health);
    if (missing.length) {
      throw new Error(`${missing.join(", ")} API 키가 설정되지 않았습니다.`);
    }
    await loadExternalData();
    setStatus(`${providerSummary(health)} 연결 확인. 강릉시 실거래가를 불러오는 중입니다.`);

    const response = await fetch(`${API_ORIGIN}/api/transactions?months=${requestedMonths}`);
    const data = await response.json();
    if (requestId !== state.loadRequestId) return;
    if (!response.ok) throw new Error(data.error || "데이터 호출 실패");
    if (!data.rows?.length && data.warnings?.length) {
      throw new Error(`API 응답 경고: ${data.warnings.join(", ")}`);
    }
    state.dataCache.set(requestedMonths, data);
    updateSourceStatus("transactions", "ok", data.generatedAt, `${data.region.name} 실거래 ${format(data.rows?.length || 0)}건`);
    useTransactionData(data, false);
  } catch (error) {
    if (requestId !== state.loadRequestId) return;
    state.isSample = false;
    state.rows = [];
    hydrateFilters();
    render();
    const runHint = window.location.protocol === "file:" ? " run-dashboard.bat으로 실행하면 실제 공공데이터가 표시됩니다." : "";
    setStatus(`실제 데이터를 불러오지 못했습니다: ${error.message}.${runHint}`);
    updateSourceStatus("transactions", "error", new Date().toISOString(), error.message);
  }
}

function useTransactionData(data, fromCache) {
  state.isSample = false;
  state.rows = data.rows.map((row) => ({ ...row, dateObj: row.dateObj instanceof Date ? row.dateObj : new Date(`${row.date}T00:00:00`) }));
  hydrateFilters();
  render();
  const warningText = data.warnings?.length ? ` 일부 월 데이터 경고 ${data.warnings.length}건.` : "";
  const cacheText = fromCache ? " 캐시 사용." : "";
  setStatus(`${data.region.name} ${getPeriodScopeLabel()} 표시 ${format(state.periodRows.length)}건, 분석용 ${format(state.rows.length)}건 로드.${cacheText}${warningText}`);
}

async function loadExternalData() {
  if (state.externalData) return state.externalData;
  try {
    const response = await fetch(`${API_ORIGIN}/api/external-indicators`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "외부지표 로드 실패");
    state.externalData = data;
  } catch (error) {
    state.externalData = {
      configured: false,
      rows: [],
      latest: null,
      todo: ["data/market-indicators.csv 파일을 추가하세요.", "필수 열: year, unsoldUnits, moveInUnits, householdIncome"],
      error: error.message,
    };
  }
  return state.externalData;
}

async function getApiHealth() {
  if (state.apiHealth) return state.apiHealth;
  const response = await fetch(`${API_ORIGIN}/api/health`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "API 상태 확인 실패");
  state.apiHealth = data;
  updateSourceStatus("transactions", data.providers?.transactions?.configured ? "ready" : "error", data.generatedAt, data.providers?.transactions?.configured ? "키 설정 완료" : "키 미설정");
  updateSourceStatus("geocode", data.providers?.geocode?.configured ? "ready" : "error", data.generatedAt, data.providers?.geocode?.configured ? "키 설정 완료" : "키 미설정");
  return data;
}

function updateSourceStatus(key, sourceState, lastChecked, detail) {
  state.sourceStatus[key] = { state: sourceState, lastChecked, detail };
  renderSourceStatus();
}

function renderSourceStatus() {
  if (!el.sourceStatus) return;
  const items = [
    { key: "transactions", title: "국토교통부 실거래가 / 공공데이터포털" },
    { key: "geocode", title: "VWorld 공간정보" },
  ];
  el.sourceStatus.innerHTML = items.map((item) => {
    const current = state.sourceStatus[item.key] || {};
    const ok = current.state === "ok" || current.state === "ready";
    const label = current.state === "error" ? "연결 오류" : (current.state === "checking" ? "확인 중" : "연결 정상");
    return `
      <article class="source-card ${ok ? "ok" : current.state === "error" ? "error" : ""}">
        <span class="source-dot"></span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(label)}</p>
          <small>마지막 조회: ${escapeHtml(formatDateTime(current.lastChecked))}</small>
          <small>${escapeHtml(current.detail || "")}</small>
        </div>
      </article>
    `;
  }).join("");
}

function getMissingProviders(health) {
  const providers = health?.providers || {};
  return Object.values(providers)
    .filter((provider) => !provider.configured)
    .map((provider) => provider.name || "외부");
}

function providerSummary(health) {
  const providers = health?.providers || {};
  const ready = Object.values(providers)
    .filter((provider) => provider.configured)
    .map((provider) => provider.name);
  return ready.length ? ready.join(", ") : "외부 API";
}

function hydrateFilters() {
  const selectedDong = el.dongSelect.value;
  const selectedApt = el.aptSelect.value;
  const dongs = unique(state.rows.map((row) => row.dong)).sort((a, b) => a.localeCompare(b, "ko"));
  const aptSource = selectedDong && selectedDong !== "all"
    ? state.rows.filter((row) => row.dong === selectedDong)
    : state.rows;
  const apartments = unique(aptSource.map((row) => row.apartment)).sort((a, b) => a.localeCompare(b, "ko"));

  el.dongSelect.innerHTML = `<option value="all">강릉시 전체</option>${dongs.map((dong) => `<option>${escapeHtml(dong)}</option>`).join("")}`;
  el.aptSelect.innerHTML = `<option value="">단지 선택</option>${apartments.map((apt) => `<option>${escapeHtml(apt)}</option>`).join("")}`;
  if (dongs.includes(selectedDong)) el.dongSelect.value = selectedDong;
  if (apartments.includes(selectedApt)) {
    el.aptSelect.value = selectedApt;
  } else {
    el.aptSelect.value = "";
  }
}

function hydrateCalendarMonths() {
  const months = unique(state.trendRows.map((row) => row.dealMonth)).sort().reverse();
  const selected = state.calendarMonth || months[0] || "";
  el.calendarMonthSelect.innerHTML = months.map((month) => {
    const label = `${month.slice(0, 4)}년 ${month.slice(4, 6)}월`;
    return `<option value="${month}">${label}</option>`;
  }).join("");
  state.calendarMonth = months.includes(selected) ? selected : (months[0] || "");
  if (state.calendarMonth) el.calendarMonthSelect.value = state.calendarMonth;
}

function render() {
  const dong = el.dongSelect.value;
  const apt = el.aptSelect.value;
  state.baseRows = dong === "all" ? [...state.rows] : state.rows.filter((row) => row.dong === dong);
  const analysisRows = applyAnalysisRangeFilter(state.baseRows);
  state.periodRows = applyPeriodFilter(analysisRows);
  state.filtered = apt ? state.periodRows.filter((row) => row.apartment === apt) : state.periodRows;
  state.trendRows = apt ? analysisRows.filter((row) => row.apartment === apt) : analysisRows;
  state.top10 = rankApartments(state.periodRows);
  hydrateCalendarMonths();
  renderFilterMeta();
  renderKpis();
  renderAdditionalAnalysis();
  renderForecast();
  renderProfitDecision();
  renderFramework();
  renderTopList();
  renderCalendar();
  renderLocationScore();
  renderMap();
  renderDealTable();
  renderCharts();
  renderProjection();
}

function renderFilterMeta() {
  const periodLabel = getPeriodLabel(el.periodSelect.value);
  const dongLabel = el.dongSelect.value === "all" ? "강릉시 전체" : el.dongSelect.value;
  const aptLabel = el.aptSelect.value || "전체 단지";
  el.filterMeta.innerHTML = [
    `지역 ${dongLabel}`,
    `기간 ${periodLabel}`,
    `기준 ${getPeriodScopeLabel()}`,
    `단지 ${aptLabel}`,
    `조회범위 ${format(state.filtered.length)}건`,
    `Top10 기준 ${format(state.periodRows.length)}건`,
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function renderAdditionalAnalysis() {
  const rows = state.filtered;
  const sales = rows.filter((row) => row.tradeType === "매매" && row.amount > 0);
  const jeonse = rows.filter((row) => row.tradeType === "전세" && row.amount > 0);
  const rent = rows.filter((row) => row.tradeType === "월세" && row.monthlyRent > 0);
  const salePerSqm = avg(sales.filter((row) => row.area > 0).map((row) => row.amount / row.area));
  const activeApts = unique(rows.map((row) => row.apartment)).length;
  const rentShare = rows.length ? (jeonse.length + rent.length) / rows.length * 100 : 0;
  const cards = [
    { label: "평균 매매가", value: formatMoney(avg(sales.map((row) => row.amount))), note: "매매 실거래 평균" },
    { label: "㎡당 매매가", value: salePerSqm ? `${formatNumber(salePerSqm, 0)}만원/㎡` : "데이터 부족", note: "면적 확인 가능한 매매 기준" },
    { label: "임대 거래 비중", value: `${formatNumber(rentShare, 1)}%`, note: `전세 ${format(jeonse.length)}건 · 월세 ${format(rent.length)}건` },
    { label: "활동 단지 수", value: `${format(activeApts)}개`, note: "현재 선택 기간 거래가 있는 단지" },
  ];
  el.additionalAnalysis.innerHTML = cards.map((card) => `
    <article class="analysis-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </article>
  `).join("");
}

function renderKpis() {
  el.totalDeals.textContent = format(state.filtered.length);
  el.saleDeals.textContent = format(countType("매매"));
  el.jeonseDeals.textContent = format(countType("전세"));
  el.rentDeals.textContent = format(countType("월세"));
  document.body.classList.toggle("sample-mode", state.isSample);
}

function renderTopList() {
  const label = getPeriodLabel(el.periodSelect.value);
  const aptText = el.aptSelect.value ? ` · 선택 ${el.aptSelect.value}` : "";
  el.rankMeta.textContent = `${label} · ${el.dongSelect.value === "all" ? "강릉시 전체" : el.dongSelect.value}${aptText}`;
  el.topList.innerHTML = state.top10.map((item, index) => `
    <button class="rank-row" type="button" data-apt="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">
      <div class="rank-num">${index + 1}</div>
      <div>
        <div class="rank-name">${escapeHtml(item.name)}</div>
        <div class="rank-sub">${escapeHtml(item.dong)} · 매매 ${item.sale} · 전세 ${item.jeonse} · 월세 ${item.rent}</div>
      </div>
      <div class="rank-count">${item.count}</div>
    </button>
  `).join("") || `<div class="rank-row"><div class="rank-num">-</div><div class="rank-name">데이터 없음</div><div class="rank-count">0</div></div>`;
}

function renderForecast() {
  const stats = computeMarketStats(state.filtered);
  const score = stats.score;
  const tone = score >= 72 ? "상승 우위" : score >= 55 ? "선별 진입" : score >= 42 ? "관망 우세" : "리스크 관리";
  const periodLabel = getPeriodLabel(el.periodSelect.value);
  el.forecastBadge.textContent = state.isSample ? "샘플 데이터" : "실거래 기반";
  el.marketScore.textContent = Number.isFinite(score) ? `${score}` : "-";
  el.marketScore.style.setProperty("--score", `${Math.max(0, Math.min(100, score || 0))}%`);
  el.forecastTitle.textContent = `${tone} · ${stats.regionLabel} ${periodLabel}`;
  el.forecastSummary.textContent = stats.summary;
  el.signalPills.innerHTML = stats.signals.map((signal) => `<span class="${signal.level}">${escapeHtml(signal.label)} ${escapeHtml(signal.value)}</span>`).join("");
}

function renderProfitDecision() {
  const apt = el.aptSelect.value || state.top10[0]?.name || "";
  const aptRows = state.filtered.filter((row) => row.apartment === apt);
  const scopeRows = state.filtered.length ? state.filtered : state.baseRows;
  const stats = computeApartmentStats(aptRows, scopeRows);
  const current = latestExternalIndicator();
  el.profitCards.innerHTML = [
    { label: "선택 단지", value: apt || "단지 선택", note: stats.address || "Top10 또는 드롭다운에서 선택" },
    { label: "유동성 점수", value: `${stats.liquidityScore}점`, note: stats.liquidityNote },
    { label: "전세가율 추정", value: stats.jeonseRatioText, note: "실거래 평균 매매가 대비 전세 보증금" },
    { label: "월세 수익률 추정", value: stats.rentYieldText, note: "월세 실거래가 있을 때 연 환산" },
    { label: "평균 매매가", value: stats.avgSaleText, note: "선택 기간 단지 매매 실거래 평균" },
    { label: "수익판단 보강", value: current ? "외부지표 반영" : "CSV 필요", note: current ? `가구소득 ${formatMoney(current.householdIncome)} 기준` : "가구소득/입주량 CSV를 넣으면 부담률과 공급 리스크를 반영" },
  ].map((card) => `
    <div class="profit-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderFramework() {
  const stats = computeMarketStats(state.filtered);
  const current = latestExternalIndicator();
  const externalNeeded = current ? "외부지표 반영" : "CSV 필요";
  const items = {
    demand: {
      title: "수요/거래량",
      score: `${stats.volumeScore}점`,
      text: `현재 선택 기간과 이전 같은 기간의 거래량을 비교해 수요 강도를 판단합니다. ${stats.volumeText}`,
      data: ["현재 기간 거래", `${format(state.filtered.length)}건`, "이전 기간 대비", stats.volumeChangeText, "판단", stats.volumeDecision],
    },
    supply: {
      title: "공급/미분양",
      score: externalNeeded,
      text: current ? `외부 CSV 기준 미분양 ${format(current.unsoldUnits)}호, 입주량 ${format(current.moveInUnits)}호를 시장 점수에 참고합니다.` : "미분양/입주량 CSV가 들어오면 공급 리스크를 함께 판단합니다.",
      data: ["미분양", current ? `${format(current.unsoldUnits)}호` : "CSV 필요", "입주량", current ? `${format(current.moveInUnits)}호` : "CSV 필요", "해야 할 일", "data/market-indicators.csv 추가"],
    },
    price: {
      title: "가격지수/가격흐름",
      score: `${stats.priceScore}점`,
      text: `KB 가격지수처럼 기준시점 대비 흐름을 보는 대신, 강릉시 실거래 평균 매매가를 현재 선택 기간과 이전 같은 기간으로 비교합니다. ${stats.priceText}`,
      data: ["평균 매매가", stats.avgSaleText, "3개월 모멘텀", stats.priceChangeText, "판단", stats.priceDecision],
    },
    sentiment: {
      title: "매수우위/매매심리",
      score: `${stats.sentimentScore}점`,
      text: "매수우위지수 원자료가 없을 때는 매매 비중, 최근 거래량 증가, 가격 모멘텀을 합쳐 심리 대체지표로 봅니다.",
      data: ["매매 비중", stats.saleShareText, "임대 비중", stats.rentShareText, "판단", stats.sentimentDecision],
    },
    pir: {
      title: "PIR/주택구입부담",
      score: externalNeeded,
      text: current ? `강릉시 가구소득 ${formatMoney(current.householdIncome)}을 기준으로 선택 단지 구매부담을 보강합니다.` : "강릉시 가구소득 CSV가 들어오면 PIR/구매부담 판단이 활성화됩니다.",
      data: ["가구소득", current ? formatMoney(current.householdIncome) : "CSV 필요", "현재 계산", "매매가/전세가율", "해야 할 일", "강릉시 가구소득 입력"],
    },
    risk: {
      title: "신용/리스크",
      score: `${stats.riskScore}점`,
      text: "GDP 대비 신용갭, 통화량 대비 시가총액은 전국 거시지표입니다. 대시보드에서는 실거래 변동성, 거래절벽, 가격 급등락을 지역 리스크로 표시합니다.",
      data: ["변동성", stats.volatilityText, "거래 리스크", stats.riskText, "판단", stats.riskDecision],
    },
  };
  const active = items[state.activeMetric] || items.demand;
  el.metricTabs.querySelectorAll(".metric-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.metric === state.activeMetric));
  el.metricInsight.innerHTML = `
    <div>
      <span class="insight-score">${escapeHtml(active.score)}</span>
      <h3>${escapeHtml(active.title)}</h3>
      <p>${escapeHtml(active.text)}</p>
    </div>
    <dl>
      ${active.data.map((value, index) => index % 2 === 0 ? `<dt>${escapeHtml(value)}</dt>` : `<dd>${escapeHtml(value)}</dd>`).join("")}
    </dl>
  `;
  renderExternalDataStatus();
}

function renderCalendar() {
  const selectedMonth = state.calendarMonth || latestDealMonth(state.trendRows) || toMonthKey(new Date());
  const year = Number(selectedMonth.slice(0, 4));
  const month = Number(selectedMonth.slice(4, 6)) - 1;
  const dealType = state.dealType;
  const monthRows = state.trendRows.filter((row) => row.dealMonth === selectedMonth && (dealType === "all" || row.tradeType === dealType));
  const counts = groupCount(monthRows, (row) => row.day);
  const maxCount = Math.max(1, ...Object.values(counts));
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  el.calendarTitle.textContent = `${year}.${String(month + 1).padStart(2, "0")}`;
  const names = ["일", "월", "화", "수", "목", "금", "토"].map((name) => `<div class="day-name">${name}</div>`);
  const blanks = Array.from({ length: firstDay }, () => `<div></div>`);
  const cells = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const count = counts[day] || 0;
    const alpha = 0.12 + (count / maxCount) * 0.88;
    return `<div class="day ${count ? "hot" : ""}" style="${count ? `opacity:${alpha}` : ""}"><strong>${day}</strong><small>${count}건</small></div>`;
  });
  el.calendar.innerHTML = [...names, ...blanks, ...cells].join("");
}

function renderDealTable() {
  const apt = el.aptSelect.value;
  const dealType = state.dealType;
  const rows = state.filtered
    .filter((row) => dealType === "all" || row.tradeType === dealType)
    .slice()
    .sort((a, b) => b.dateObj - a.dateObj)
    .slice(0, 12);
  const periodLabel = getPeriodLabel(el.periodSelect.value);
  const typeLabel = dealType === "all" ? "전체" : dealType;
  el.dealTableMeta.textContent = `${apt || (el.dongSelect.value === "all" ? "강릉시 전체" : el.dongSelect.value)} · ${periodLabel} · ${typeLabel}`;
  el.dealTable.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td><span class="deal-type ${tradeTypeClass(row.tradeType)}">${escapeHtml(row.tradeType)}</span></td>
      <td>${escapeHtml(row.apartment)}</td>
      <td>${row.area ? `${formatNumber(row.area, 2)}㎡` : "-"}</td>
      <td>${row.floor ?? "-"}</td>
      <td>${escapeHtml(formatDealAmount(row))}</td>
      <td>${escapeHtml(row.address || buildAddress(row))}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">표시할 실거래 데이터가 없습니다.</td></tr>`;
}

function renderLocationScore() {
  const apt = el.aptSelect.value || state.top10[0]?.name || "";
  if (!apt) {
    renderFacilityScores([]);
    return;
  }
  renderFacilityScores([], "VWorld 좌표 확인 후 실제 주변시설 거리를 계산합니다.");
}

function renderMap() {
  const requestId = ++state.mapRequestId;
  const apt = el.aptSelect.value;
  const rows = state.baseRows.filter((row) => row.apartment === apt);
  const row = rows[0];
  if (!apt || !row) {
    el.mapAptName.textContent = "단지 선택";
    el.mapAddress.innerHTML = `강원특별자치도 강릉시<small>단지를 선택하면 해당 주소와 반경 정보가 표시됩니다.</small>`;
    el.mapLinks.innerHTML = mapLinks("강원특별자치도 강릉시");
    initMap(37.7519, 128.8761, []);
    renderMapRadiusOverlay([]);
    return;
  }

  const address = row.address || buildAddress(row);
  const query = `${address} ${apt}`;
  el.mapAptName.textContent = apt;
  el.mapAddress.innerHTML = `${escapeHtml(address)}<small>${escapeHtml(apt)} · ${escapeHtml(row.dong)} · 브이월드 좌표 확인 중</small>`;
  initMap(37.7519, 128.8761, []);
  el.mapLinks.innerHTML = mapLinks(query);
  renderMapRadiusOverlay([]);

  getVworldCoord(row, address)
    .then(async (geo) => {
      if (requestId !== state.mapRequestId) return;
      const coordText = `${formatNumber(geo.lat, 6)}, ${formatNumber(geo.lng, 6)}`;
      const refined = geo.refinedAddress || geo.address || address;
      updateSourceStatus("geocode", "ok", new Date().toISOString(), `좌표 ${coordText}`);
      el.mapAddress.innerHTML = `
        ${escapeHtml(refined)}
        <small>${escapeHtml(apt)} · ${escapeHtml(row.dong)} · 브이월드 ${escapeHtml(geo.type)} 좌표 ${escapeHtml(coordText)}</small>
      `;
      el.mapLinks.innerHTML = mapLinks(query, geo);
      renderFacilityScores([], "VWorld 주변시설 검색 중");
      const facilities = await getVworldFacilities(geo);
      if (requestId !== state.mapRequestId) return;
      updateSourceStatus("geocode", "ok", facilities.generatedAt, `좌표 및 주변시설 ${countFacilities(facilities)}건`);
      const profile = flattenFacilities(facilities).slice(0, 6);
      renderFacilityScores(profile);
      initMap(geo.lat, geo.lng, profile);
      renderMapRadiusOverlay(profile);
      el.mapAddress.innerHTML = `
        ${escapeHtml(refined)}
        <small>${escapeHtml(apt)} · ${escapeHtml(row.dong)} · 브이월드 좌표와 실제 주변시설 거리 계산 완료</small>
        ${radiusLegend(profile)}
      `;
    })
    .catch((error) => {
      if (requestId !== state.mapRequestId) return;
      updateSourceStatus("geocode", "error", new Date().toISOString(), error.message);
      el.mapAddress.innerHTML = `
        ${escapeHtml(address)}
        <small>${escapeHtml(apt)} · ${escapeHtml(row.dong)} · 브이월드 좌표 확인 실패: ${escapeHtml(error.message)}</small>
      `;
    });
}

async function getVworldCoord(row, address) {
  const cacheKey = [row.roadAddress, row.lotAddress, address].filter(Boolean).join("|");
  if (state.geocodeCache.has(cacheKey)) return state.geocodeCache.get(cacheKey);

  const params = new URLSearchParams();
  if (row.roadAddress) params.set("roadAddress", row.roadAddress);
  if (row.lotAddress) params.set("lotAddress", row.lotAddress);
  params.set("address", address);

  const response = await fetch(`${API_ORIGIN}/api/geocode?${params}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "좌표 변환 실패");
  state.geocodeCache.set(cacheKey, data);
  return data;
}

async function getVworldFacilities(geo) {
  const cacheKey = `${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}`;
  if (state.facilityCache.has(cacheKey)) return state.facilityCache.get(cacheKey);
  const params = new URLSearchParams({ lat: String(geo.lat), lng: String(geo.lng), radius: "2500" });
  const response = await fetch(`${API_ORIGIN}/api/facilities?${params}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "주변시설 검색 실패");
  state.facilityCache.set(cacheKey, data);
  return data;
}

function mapLinks(query, geo) {
  const googleQuery = geo ? `${geo.lat},${geo.lng}` : query;
  return `
    <a href="https://map.naver.com/p/search/${encodeURIComponent(query)}" target="_blank" rel="noreferrer">네이버 지도</a>
    <a href="https://map.kakao.com/link/search/${encodeURIComponent(query)}" target="_blank" rel="noreferrer">카카오맵</a>
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery)}" target="_blank" rel="noreferrer">구글 지도</a>
  `;
}

function osmEmbedSrc(lat, lng, span = 0.01) {
  const south = Number(lat) - span;
  const west = Number(lng) - span;
  const north = Number(lat) + span;
  const east = Number(lng) + span;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function initMap(lat, lng, profile) {
  state.mapState = {
    lat: Number(lat),
    lng: Number(lng),
    zoom: 16,
    profile: profile || [],
    drag: null,
  };
  renderMapTiles();
}

function renderMapTiles() {
  const map = state.mapState;
  if (!map || !el.mapFrame) return;
  const width = Math.max(320, el.mapFrame.clientWidth || 640);
  const height = Math.max(260, el.mapFrame.clientHeight || 320);
  const center = latLngToPixel(map.lat, map.lng, map.zoom);
  const startX = center.x - width / 2;
  const startY = center.y - height / 2;
  const tileSize = 256;
  const minTileX = Math.floor(startX / tileSize);
  const maxTileX = Math.floor((startX + width) / tileSize);
  const minTileY = Math.floor(startY / tileSize);
  const maxTileY = Math.floor((startY + height) / tileSize);
  const tiles = [];
  const maxTile = 2 ** map.zoom;

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      tiles.push(`<img class="map-tile" src="${API_ORIGIN}/api/map-tile?z=${map.zoom}&x=${wrappedX}&y=${y}" style="left:${Math.round(x * tileSize - startX)}px;top:${Math.round(y * tileSize - startY)}px" alt="">`);
    }
  }

  el.mapFrame.innerHTML = `
    <div class="map-tile-layer">${tiles.join("")}</div>
    <div class="map-center-pin"><span aria-hidden="true">🏢</span><strong>선택 아파트</strong></div>
    <div class="map-attribution">VWorld 공간정보</div>
    <div class="map-zoom">
      <button type="button" data-map-zoom="1">+</button>
      <button type="button" data-map-zoom="-1">-</button>
    </div>
  `;

  el.mapFrame.onpointerdown = (event) => {
    if (event.target.closest("button")) return;
    el.mapFrame.setPointerCapture(event.pointerId);
    map.drag = { x: event.clientX, y: event.clientY, lat: map.lat, lng: map.lng };
  };
  el.mapFrame.onpointermove = (event) => {
    if (!map.drag) return;
    const base = latLngToPixel(map.drag.lat, map.drag.lng, map.zoom);
    const next = pixelToLatLng(base.x - (event.clientX - map.drag.x), base.y - (event.clientY - map.drag.y), map.zoom);
    map.lat = next.lat;
    map.lng = next.lng;
    renderMapTiles();
  };
  el.mapFrame.onpointerup = () => { map.drag = null; };
  el.mapFrame.onclick = (event) => {
    const button = event.target.closest("[data-map-zoom]");
    if (!button) return;
    map.zoom = clamp(map.zoom + Number(button.dataset.mapZoom), 12, 18);
    renderMapTiles();
  };
}

function latLngToPixel(lat, lng, zoom) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function pixelToLatLng(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lng = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function renderCharts() {
  drawTypeChart();
  drawCompareChart();
  drawTrendChart();
}

function drawTypeChart() {
  const values = [
    { label: "매매", value: countType("매매"), color: colors.sale },
    { label: "전세", value: countType("전세"), color: colors.jeonse },
    { label: "월세", value: countType("월세"), color: colors.rent },
  ];
  pieChart(el.typeChart, values, "거래유형");
}

function drawCompareChart() {
  const apt = el.aptSelect.value;
  const topAvg = state.top10.length ? Math.round(state.top10.reduce((sum, item) => sum + item.count, 0) / state.top10.length) : 0;
  const top1 = state.top10[0]?.count || 0;
  const selected = apt ? state.periodRows.filter((row) => row.apartment === apt).length : 0;
  barChart(el.compareChart, [
    { label: "Top1", value: top1, color: colors.cyan },
    { label: "Top10 평균", value: topAvg, color: colors.violet },
    { label: "선택 단지", value: selected, color: colors.jeonse },
  ], "비교 거래량");
}

function drawTrendChart() {
  const trendRows = applyTrendRangeFilter(state.trendRows);
  const buckets = buildTrendBuckets(trendRows, "monthly");
  const selectedType = el.trendTypeSelect.value;
  const types = selectedType === "all" ? ["매매", "전세", "월세"] : [selectedType];
  const series = types.map((type) => ({
    label: type,
    color: type === "매매" ? colors.sale : type === "전세" ? colors.jeonse : colors.rent,
    values: buckets.map((bucket) => bucket.rows.filter((row) => row.tradeType === type).length),
  }));
  lineChart(el.trendChart, buckets.map((bucket) => bucket.label), series);
}

function applyAnalysisRangeFilter(rows) {
  if (!rows.length) return [];
  const latest = latestDate(rows);
  const months = getRangeMonths();
  const from = new Date(latest);
  from.setMonth(from.getMonth() - months);
  return rows.filter((row) => row.dateObj >= from && row.dateObj <= latest);
}

function applyPeriodFilter(rows) {
  if (!rows.length) return [];
  const bounds = getCurrentPeriodBounds(rows);
  return rows.filter((row) => row.dateObj >= bounds.start && row.dateObj <= bounds.end);
}

function applyPreviousPeriodFilter(rows) {
  if (!rows.length) return [];
  const bounds = getCurrentPeriodBounds(rows);
  const spanMs = bounds.end.getTime() - bounds.start.getTime() + 1;
  const previousEnd = new Date(bounds.start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - spanMs + 1);
  return rows.filter((row) => {
    return row.dateObj >= previousStart && row.dateObj <= previousEnd;
  });
}

function applyTrendRangeFilter(rows) {
  if (!rows.length) return [];
  const latest = latestDate(rows);
  const months = Number(el.trendMonthsSelect?.value || 12);
  const from = new Date(latest);
  from.setMonth(from.getMonth() - Math.max(1, months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  return rows.filter((row) => row.dateObj >= from && row.dateObj <= latest);
}

function getCurrentPeriodBounds(rows) {
  const latest = latestDate(rows);
  const start = new Date(latest);
  const end = new Date(latest);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (el.periodSelect.value === "weekly") {
    start.setDate(start.getDate() - 6);
  }

  if (el.periodSelect.value === "monthly") {
    start.setDate(start.getDate() - 29);
  }

  if (el.periodSelect.value === "yearly") {
    start.setDate(start.getDate() - 364);
  }

  return { start, end };
}

function computeMarketStats(rows) {
  const regionLabel = el.dongSelect.value === "all" ? "강릉시 전체" : el.dongSelect.value;
  const periodLabel = getPeriodLabel(el.periodSelect.value);
  const apt = el.aptSelect.value;
  const analysisSource = applyAnalysisRangeFilter(state.baseRows);
  const sourceRows = apt ? analysisSource.filter((row) => row.apartment === apt) : analysisSource;
  const currentRows = rows;
  const prevRows = applyPreviousPeriodFilter(sourceRows);
  const saleRows = currentRows.filter((row) => row.tradeType === "매매" && row.amount > 0);
  const prevSales = prevRows.filter((row) => row.tradeType === "매매" && row.amount > 0);
  const sourceSales = sourceRows.filter((row) => row.tradeType === "매매" && row.amount > 0);
  const volumeChange = prevRows.length ? percentChange(currentRows.length, prevRows.length) : (currentRows.length ? 100 : 0);
  const avgCurrentSale = avg(saleRows.map((row) => row.amount));
  const avgPreviousSale = avg(prevSales.map((row) => row.amount));
  const hasPriceComparison = avgCurrentSale > 0 && avgPreviousSale > 0;
  const priceChange = hasPriceComparison ? percentChange(avgCurrentSale, avgPreviousSale) : 0;
  const saleShare = currentRows.length ? saleRows.length / currentRows.length : 0;
  const rentShare = currentRows.length ? currentRows.filter((row) => row.tradeType !== "매매").length / currentRows.length : 0;
  const volatility = coefficientOfVariation(sourceSales.map((row) => row.amount / (row.area || 1)));

  const volumeScore = clamp(scoreFromChange(volumeChange, -25, 60), currentRows.length ? 35 : 0, 100);
  const priceScore = hasPriceComparison ? clamp(scoreFromChange(priceChange, -20, 20), 5, 100) : 0;
  const sentimentScore = clamp(Math.round(volumeScore * 0.38 + priceScore * 0.38 + saleShare * 100 * 0.24), 0, 100);
  const riskScore = clamp(Math.round(100 - volatility * 140 - (currentRows.length === 0 ? 28 : 0)), 0, 100);
  const score = clamp(Math.round(volumeScore * 0.3 + priceScore * 0.28 + sentimentScore * 0.24 + riskScore * 0.18), 0, 100);
  const volumeDecision = volumeChange >= 12 ? "수요 회복" : volumeChange <= -12 ? "거래 위축" : "중립";
  const priceDecision = hasPriceComparison ? (priceChange >= 4 ? "가격 상승 압력" : priceChange <= -4 ? "가격 조정" : "보합") : "데이터 부족";
  const sentimentDecision = sentimentScore >= 65 ? "매수심리 개선" : sentimentScore <= 42 ? "매수심리 약함" : "선별 심리";
  const riskDecision = riskScore >= 70 ? "리스크 낮음" : riskScore <= 45 ? "리스크 높음" : "주의";
  const signals = [
    { label: "거래", value: formatPercent(volumeChange), level: volumeChange >= 0 ? "good" : "warn" },
    { label: "가격", value: hasPriceComparison ? formatPercent(priceChange) : "비교 부족", level: priceChange >= 0 ? "good" : "warn" },
    { label: "매매비중", value: `${Math.round(saleShare * 100)}%`, level: saleShare >= 0.35 ? "good" : "neutral" },
    { label: "리스크", value: riskDecision, level: riskScore >= 60 ? "good" : "danger" },
  ];
  const priceSummary = hasPriceComparison ? `가격 흐름은 이전 같은 기간 대비 ${formatPercent(priceChange)}입니다.` : "가격 흐름은 같은 기간 매매 비교 데이터가 부족합니다.";
  const summary = `${getPeriodScopeLabel()} ${periodLabel} 집계 기준 ${format(currentRows.length)}건, 이전 같은 기간 ${format(prevRows.length)}건을 비교했습니다. ${priceSummary} 현재 판단은 '${volumeDecision} / ${priceDecision}'입니다.`;

  return {
    score,
    regionLabel,
    summary,
    signals,
    volumeScore,
    priceScore,
    sentimentScore,
    riskScore,
    volumeText: `현재 ${getPeriodScopeLabel()} ${format(currentRows.length)}건, 이전 같은 기간 ${format(prevRows.length)}건으로 ${formatPercent(volumeChange)}입니다.`,
    priceText: hasPriceComparison ? `현재 ${getPeriodScopeLabel()} 평균 ${formatMoney(avgCurrentSale)}, 이전 같은 기간 평균 ${formatMoney(avgPreviousSale)}입니다.` : `현재 ${getPeriodScopeLabel()} 또는 이전 같은 기간에 매매 거래가 부족해 가격지수 비교가 제한됩니다.`,
    avgSaleText: formatMoney(avgCurrentSale),
    priceChangeText: hasPriceComparison ? formatPercent(priceChange) : "비교 부족",
    volumeChangeText: formatPercent(volumeChange),
    saleShareText: `${Math.round(saleShare * 100)}%`,
    rentShareText: `${Math.round(rentShare * 100)}%`,
    volatilityText: volatility ? `${Math.round(volatility * 100)}%` : "데이터 부족",
    riskText: currentRows.length ? "정상 거래 관측" : "선택 기간 거래 없음",
    volumeDecision,
    priceDecision,
    sentimentDecision,
    riskDecision,
  };
}

function computeApartmentStats(aptRows, scopeRows) {
  const saleRows = aptRows.filter((row) => row.tradeType === "매매" && row.amount > 0);
  const jeonseRows = aptRows.filter((row) => row.tradeType === "전세" && row.amount > 0);
  const wolseRows = aptRows.filter((row) => row.tradeType === "월세" && row.monthlyRent > 0);
  const avgSale = avg(saleRows.map((row) => row.amount));
  const avgJeonse = avg(jeonseRows.map((row) => row.amount));
  const avgMonthlyRent = avg(wolseRows.map((row) => row.monthlyRent));
  const topVolume = Math.max(1, ...rankApartments(scopeRows).map((item) => item.count));
  const liquidityScore = clamp(Math.round((aptRows.length / topVolume) * 100), 0, 100);
  const jeonseRatio = avgSale && avgJeonse ? avgJeonse / avgSale * 100 : null;
  const rentYield = avgSale && avgMonthlyRent ? avgMonthlyRent * 12 / avgSale * 100 : null;
  const address = aptRows[0]?.address || (aptRows[0] ? buildAddress(aptRows[0]) : "");
  return {
    address,
    liquidityScore,
    liquidityNote: aptRows.length ? `선택 기간 ${format(aptRows.length)}건 거래` : "선택 단지 거래 없음",
    avgSale,
    avgSaleText: formatMoney(avgSale),
    jeonseRatioText: jeonseRatio ? `${formatNumber(jeonseRatio, 1)}%` : "데이터 부족",
    rentYieldText: rentYield ? `${formatNumber(rentYield, 2)}%` : "데이터 부족",
  };
}

function renderExternalDataStatus() {
  if (!el.externalDataStatus) return;
  const data = state.externalData;
  const latest = latestExternalIndicator();
  if (latest) {
    el.externalDataStatus.innerHTML = `
      <div class="external-ready">
        <strong>외부지표 연결</strong>
        <span>${latest.year}년 · 미분양 ${format(latest.unsoldUnits)}호 · 입주량 ${format(latest.moveInUnits)}호 · 가구소득 ${formatMoney(latest.householdIncome)}</span>
      </div>
    `;
    return;
  }

  const todo = data?.todo?.length ? data.todo : ["data/market-indicators.csv 파일을 추가하세요.", "필수 열: year, unsoldUnits, moveInUnits, householdIncome"];
  el.externalDataStatus.innerHTML = `
    <div class="external-todo">
      <strong>내가 해야 할 일</strong>
      ${todo.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function latestExternalIndicator() {
  const rows = state.externalData?.rows || [];
  const currentYear = new Date().getFullYear();
  const candidates = rows.filter((row) => Number(row.year || 0) <= currentYear);
  return (candidates.length ? candidates : rows).slice().sort((a, b) => Number(b.year || 0) - Number(a.year || 0))[0] || null;
}

function renderProjection() {
  if (!el.projectionContent) return;
  const apt = el.aptSelect.value || state.top10[0]?.name || "";
  if (!apt) {
    el.projectionContent.innerHTML = `<div class="projection-empty">단지를 선택하면 1~5년 전망이 표시됩니다.</div>`;
    return;
  }

  const years = clamp(Number(el.projectionYearsSelect?.value || 3), 1, 5);
  const sourceRows = applyAnalysisRangeFilter(state.baseRows).filter((row) => row.apartment === apt);
  const stats = computeMarketStats(state.filtered.filter((row) => row.apartment === apt));
  const sales = sourceRows.filter((row) => row.tradeType === "매매" && row.amount > 0).sort((a, b) => a.dateObj - b.dateObj);
  const latestSale = avg(sales.slice(-5).map((row) => row.amount));
  const firstSale = avg(sales.slice(0, 5).map((row) => row.amount));
  const annualMomentum = firstSale && latestSale ? clamp(percentChange(latestSale, firstSale) / Math.max(1, ANALYSIS_MONTHS / 12), -12, 12) : 0;
  const external = latestExternalIndicator();
  const supplyPressure = external ? clamp((external.unsoldUnits + external.moveInUnits * 0.35) / 1200 * 100, 0, 100) : 35;
  const baseChange = clamp(annualMomentum * 0.45 + (stats.score - 50) * 0.08 - supplyPressure * 0.035, -7, 8);

  const rows = Array.from({ length: years }, (_, index) => {
    const year = new Date().getFullYear() + index + 1;
    const change = baseChange * (1 - index * 0.08);
    const amount = latestSale ? latestSale * Math.pow(1 + change / 100, index + 1) : 0;
    const tone = change >= 3 ? "상승 우위" : change <= -2 ? "조정 가능" : "보합권";
    return { year, change, amount, tone };
  });

  el.projectionContent.innerHTML = `
    <div class="projection-summary">
      <strong>${escapeHtml(apt)}</strong>
      <span>${years}년 전망 · 기준 ${latestSale ? formatMoney(latestSale) : "매매 데이터 부족"} · ${external ? "외부 CSV 반영" : "외부 CSV 미반영"}</span>
    </div>
    <div class="projection-rows">
      ${rows.map((row) => `
        <div class="projection-row">
          <span>${row.year}년</span>
          <strong>${escapeHtml(row.tone)}</strong>
          <em>${formatPercent(row.change)}</em>
          <small>${row.amount ? formatMoney(row.amount) : "가격 추정 제한"}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return (current - previous) / previous * 100;
}

function scoreFromChange(change, low, high) {
  const normalized = (change - low) / (high - low);
  return clamp(Math.round(normalized * 100), 0, 100);
}

function coefficientOfVariation(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length < 3) return 0;
  const mean = avg(clean);
  const variance = avg(clean.map((value) => Math.pow(value - mean, 2)));
  return mean ? Math.sqrt(variance) / mean : 0;
}

function avg(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function rankApartments(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const prev = grouped.get(row.apartment) || { name: row.apartment, dong: row.dong, count: 0, sale: 0, jeonse: 0, rent: 0 };
    prev.count += 1;
    if (row.tradeType === "매매") prev.sale += 1;
    if (row.tradeType === "전세") prev.jeonse += 1;
    if (row.tradeType === "월세") prev.rent += 1;
    grouped.set(row.apartment, prev);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")).slice(0, 10);
}

function buildTrendBuckets(rows, period) {
  const grouped = new Map();
  const sorted = [...rows].sort((a, b) => a.dateObj - b.dateObj);
  for (const row of sorted) {
    const key = getTrendKey(row.dateObj, period);
    if (!grouped.has(key.value)) grouped.set(key.value, { label: key.label, rows: [] });
    grouped.get(key.value).rows.push(row);
  }
  return [...grouped.values()];
}

function getTrendKey(date, period) {
  if (period === "daily") {
    const value = toDateKey(date);
    return { value, label: `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}` };
  }
  if (period === "weekly") {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    const value = toDateKey(start);
    return { value, label: `${String(start.getMonth() + 1).padStart(2, "0")}.${String(start.getDate()).padStart(2, "0")}주` };
  }
  if (period === "yearly") {
    const value = String(date.getFullYear());
    return { value, label: `${value}년` };
  }
  const value = toMonthKey(date);
  return { value, label: `${value.slice(2, 4)}.${value.slice(4)}` };
}

function barChart(canvas, values, unit) {
  const ctx = readyCanvas(canvas);
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const pad = 38;
  const max = Math.max(1, ...values.map((v) => v.value));
  drawGrid(ctx, width, height, pad);
  const barW = (width - pad * 2) / values.length * 0.46;
  values.forEach((item, index) => {
    const x = pad + index * ((width - pad * 2) / values.length) + barW * 0.58;
    const barH = (height - pad * 2) * (item.value / max);
    const y = height - pad - barH;
    ctx.fillStyle = item.color;
    roundRect(ctx, x, y, barW, barH, 3);
    ctx.fill();
    drawText(ctx, item.label, x + barW / 2, height - 12, 12, "#555", "center");
    drawText(ctx, `${format(item.value)}건`, x + barW / 2, y - 9, 14, item.color, "center", true);
  });
  drawText(ctx, unit, pad, 22, 12, "#666", "left");
}

function pieChart(canvas, values, title) {
  const ctx = readyCanvas(canvas);
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const cx = Math.min(width * 0.34, 230);
  const cy = height / 2 + 4;
  const radius = Math.min(height * 0.42, width * 0.28, 142);
  let start = -Math.PI / 2;

  if (!total) {
    drawText(ctx, "표시할 거래유형 데이터가 없습니다.", width / 2, height / 2, 16, "#777", "center", true);
    return;
  }

  values.forEach((item) => {
    const angle = Math.PI * 2 * (item.value / total);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    start += angle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  drawText(ctx, title, cx, cy - 10, 16, "#666", "center", true);
  drawText(ctx, `${format(total)}건`, cx, cy + 18, 26, "#222", "center", true);

  values.forEach((item, index) => {
    const y = 64 + index * 56;
    const percent = total ? item.value / total * 100 : 0;
    ctx.fillStyle = item.color;
    roundRect(ctx, width * 0.60, y - 16, 22, 22, 5);
    ctx.fill();
    drawText(ctx, item.label, width * 0.60 + 34, y, 18, "#333", "left", true);
    drawText(ctx, `${format(item.value)}건 · ${formatNumber(percent, 1)}%`, width * 0.60 + 34, y + 26, 16, "#666", "left");
  });
}

function lineChart(canvas, labels, series) {
  const ctx = readyCanvas(canvas);
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const pad = 42;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  drawGrid(ctx, width, height, pad);
  if (!labels.length || series.every((s) => s.values.every((value) => value === 0))) {
    drawText(ctx, "선택 범위에 월별 거래 데이터가 없습니다.", width / 2, height / 2, 14, "#777", "center", true);
    series.forEach((s, i) => drawText(ctx, s.label, pad + i * 64, 22, 13, s.color, "left", true));
    return;
  }
  series.forEach((s) => {
    ctx.beginPath();
    s.values.forEach((value, index) => {
      const x = pad + (labels.length === 1 ? 0 : index * ((width - pad * 2) / (labels.length - 1)));
      const y = height - pad - (height - pad * 2) * (value / max);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    s.values.forEach((value, index) => {
      const x = pad + (labels.length === 1 ? 0 : index * ((width - pad * 2) / (labels.length - 1)));
      const y = height - pad - (height - pad * 2) * (value / max);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (value > 0) {
        drawText(ctx, `${format(value)}`, x, y - 9, 11, s.color, "center", true);
      }
    });
  });
  labels.forEach((label, index) => {
    if (index % Math.ceil(labels.length / 8) === 0) {
      const x = pad + (labels.length === 1 ? 0 : index * ((width - pad * 2) / (labels.length - 1)));
      drawText(ctx, label, x, height - 14, 12, "#777", "center");
    }
  });
  series.forEach((s, i) => drawText(ctx, s.label, pad + i * 64, 22, 13, s.color, "left", true));
}

function readyCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const height = Number(canvas.dataset.chartHeight || canvas.getAttribute("height") || 240);
  canvas.dataset.chartHeight = String(height);
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(320, Math.floor(rect.width));
  canvas.height = height;
  return canvas.getContext("2d");
}

function drawGrid(ctx, width, height, pad) {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + i * ((height - pad * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, size, color, align = "left", bold = false) {
  ctx.fillStyle = color;
  ctx.font = `${bold ? 800 : 600} ${size}px Pretendard, Segoe UI, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function radiusLegend(profile) {
  if (!profile.length) return "";
  return `<div class="radius-legend">${profile.slice(0, 4).map((item) => `<span>${escapeHtml(item.label)} ${formatDistance(item.meters)}</span>`).join("")}</div>`;
}

function renderMapRadiusOverlay(profile) {
  el.mapRadiusOverlay.innerHTML = "";
}

function renderFacilityScores(profile, message = "") {
  if (!profile.length) {
    el.locationScore.innerHTML = `
      <div class="score empty-score">
        <span>입지분석</span>
        <strong>${escapeHtml(message || "단지 선택")}</strong>
        <small>임의 거리값을 표시하지 않습니다.</small>
      </div>
    `;
    return;
  }

  el.locationScore.innerHTML = profile.map((item) => `
    <div class="score">
      <span>${escapeHtml(item.category)}</span>
      <strong>${escapeHtml(formatDistance(item.meters))}</strong>
      <small>${escapeHtml(item.label)}</small>
    </div>
  `).join("");
}

function flattenFacilities(facilities) {
  return (facilities.categories || []).flatMap((category) => {
    return (category.places || []).map((place) => ({
      category: category.label,
      label: place.name,
      meters: place.distanceM,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
    }));
  }).sort((a, b) => a.meters - b.meters);
}

function countFacilities(facilities) {
  return (facilities.categories || []).reduce((sum, category) => sum + (category.places || []).length, 0);
}

function buildAddress(row) {
  if (!row) return "강원특별자치도 강릉시";
  return `강원특별자치도 강릉시 ${row.dong || ""}${row.jibun ? ` ${row.jibun}` : ""}`.trim();
}

function countType(type) {
  return state.filtered.filter((row) => row.tradeType === type).length;
}

function groupCount(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function format(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function getPeriodLabel(period) {
  return PERIOD_LABELS[period] || PERIOD_LABELS.monthly;
}

function getRangeMonths() {
  return ANALYSIS_MONTHS;
}

function getFetchMonths() {
  return FETCH_MONTHS;
}

function getRangeLabel() {
  return `최근 ${ANALYSIS_MONTHS}개월`;
}

function getPeriodScopeLabel() {
  if (el.periodSelect.value === "daily") return "최근 거래일";
  if (el.periodSelect.value === "weekly") return "최근 7일";
  if (el.periodSelect.value === "yearly") return "최근 365일";
  return "최근 30일";
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 1)}%`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDistance(meters) {
  const value = Number(meters || 0);
  if (value >= 1000) return `${formatNumber(value / 1000, 1)}km`;
  return `${format(value)}m`;
}

function formatMoney(value) {
  if (!value) return "데이터 부족";
  if (value >= 10000) return `${formatNumber(value / 10000, 2)}억원`;
  return `${formatNumber(value)}만원`;
}

function formatDealAmount(row) {
  if (row.tradeType === "매매") return formatMoney(row.amount);
  if (row.tradeType === "전세") return `보증금 ${formatMoney(row.amount)}`;
  return `보증금 ${formatMoney(row.amount)} / 월 ${formatNumber(row.monthlyRent)}만원`;
}

function tradeTypeClass(type) {
  if (type === "매매") return "deal-type-sale";
  if (type === "전세") return "deal-type-jeonse";
  if (type === "월세") return "deal-type-rent";
  return "";
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toMonthKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function latestDate(rows) {
  return rows.reduce((max, row) => row.dateObj > max ? row.dateObj : max, new Date(0));
}

function latestDealMonth(rows) {
  return unique(rows.map((row) => row.dealMonth)).sort().at(-1) || "";
}

function daysBetween(a, b) {
  return Math.abs(b - a) / 86400000;
}

function setStatus(message) {
  el.status.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function debounce(fn, delay) {
  let id;
  return () => {
    clearTimeout(id);
    id = setTimeout(fn, delay);
  };
}

function demoRows() {
  const apts = ["입암동 금호어울림", "교동 롯데캐슬", "유천 더샵", "홍제 힐스테이트", "포남 e편한세상", "송정 한신", "회산 아이파크", "내곡 현대", "초당 센트럴", "강문 오션뷰"];
  const dongs = ["입암동", "교동", "유천동", "홍제동", "포남동", "송정동", "회산동", "내곡동", "초당동", "강문동"];
  const rows = [];
  for (let m = 0; m < 12; m += 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - m);
    const dealMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    for (let i = 0; i < 53; i += 1) {
      const aptIndex = (i + m) % apts.length;
      const day = 1 + ((i * 3 + m) % 28);
      const type = i % 10 < 5 ? "매매" : i % 10 < 8 ? "전세" : "월세";
      rows.push({
        tradeType: type,
        apartment: apts[aptIndex],
        dong: dongs[aptIndex],
        jibun: String(100 + aptIndex),
        address: `강원특별자치도 강릉시 ${dongs[aptIndex]} ${100 + aptIndex}`,
        date: `${dealMonth.slice(0, 4)}-${dealMonth.slice(4)}-${String(day).padStart(2, "0")}`,
        dateObj: new Date(`${dealMonth.slice(0, 4)}-${dealMonth.slice(4)}-${String(day).padStart(2, "0")}T00:00:00`),
        dealMonth,
        day,
        area: 59 + (aptIndex % 4) * 10,
        floor: 2 + (i % 24),
        amount: type === "매매" ? 21000 + aptIndex * 2400 + m * 120 : 12000 + aptIndex * 1100 + m * 80,
        monthlyRent: type === "월세" ? 35 + (aptIndex % 6) * 5 : 0,
      });
    }
  }
  return rows;
}

# Gangneung PropTech Dashboard Project Context

## Project Name

Gangneung PropTech Real Estate Big Data Market Analysis Dashboard

## Purpose

This project is a Seoul Cyber University real estate big data market analysis dashboard prepared for a lecture and competition context. The dashboard focuses on Gangneung-si apartment market analysis using public real transaction data, location display, market outlook indicators, and decision-oriented investment / rental signals.

## Working Root Before Migration

The project was recovered from the active Codex workspace available at migration time. Runtime files must not depend on that previous workspace path.

## New Permanent Folder

`C:\Users\왕자\Desktop\1.서울사이버대\1.CODEX\26.9.6-PropTech Dashboard`

## Important Security Rule

The project uses a public data portal API key through `.env`.

Do not print, commit, or paste actual API keys, secrets, tokens, or passwords into reports or source control. `.gitignore` excludes `.env` and `.env.*`.

## Main Files

- `index.html`: Main dashboard UI.
- `styles.css`: Report-style real estate market dashboard styling.
- `app.js`: Dashboard state, filtering, charts, market forecast scoring, apartment comparison, map display, and recent deal table.
- `server.js`: Local Node.js HTTP server, static file server, and public data API proxy.
- `run-dashboard.bat`: Simple local launcher for a developer machine with Node installed.
- `packaging/launch-dashboard.bat`: Portable package batch launcher.
- `packaging/DashboardLauncher.cs`: Windows GUI launcher used in the portable distribution.
- `build-distribution.ps1`: Builds portable launcher and distribution package.
- `README.md`: Basic user-facing run instructions.
- `.env`: Local runtime environment file. Contains sensitive values and must not be exposed.
- `.env.example`: Safe template for environment variables.
- `.gitignore`: Protects secrets and generated / cache files.

## Distribution Outputs

- `강릉시_아파트_대시보드_배포용.exe`: Single external distribution executable.
- `dist/Gangneung_Apartment_Dashboard_Distribution.exe`: English-named distribution executable.
- `dist/Gangneung_Dashboard_Portable/Gangneung_Apartment_Dashboard.exe`: Recommended portable launcher.
- `dist/Gangneung_Dashboard_Portable/node.exe`: Included Node runtime.
- `dist/Gangneung_Dashboard_Portable.zip`: Portable ZIP output, if present.

## Data Sources

### Live API Data

The dashboard uses Gangneung-si apartment real transaction APIs from the Korean public data portal / Ministry of Land, Infrastructure and Transport.

API endpoints:

- Apartment sale transactions: `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`
- Apartment rent / jeonse transactions: `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`

Local API endpoint:

- `GET /api/transactions?months=12`

Fixed region code:

- Gangneung-si lawd code: `51150`

Main request parameters:

- `serviceKey`: Loaded from `PUBLIC_DATA_API_KEY`.
- `LAWD_CD`: `51150`.
- `DEAL_YMD`: `YYYYMM`.
- `pageNo`: API pagination.
- `numOfRows`: `1000`.

### Market Analysis Materials

Real estate big data market analysis PDF files and example screenshots are preserved under `source_docs/` in the migrated project.

Lecture analysis concepts incorporated into the dashboard:

- Demand / transaction volume.
- Supply / move-in volume / unsold inventory framework.
- KB-style price index interpretation.
- Buyer sentiment / purchase superiority style signal.
- PIR / JPIR / HAI housing burden framework.
- Credit gap / macro risk framework.
- Jeonse ratio / gap price.
- School, population, job, and location factor framework.

The dashboard distinguishes between:

- Metrics that can be calculated directly from the current real transaction API.
- Metrics that require additional external source data such as income, unsold inventory, move-in volume, macro credit indicators, or official KB / Richgo index values.

## Current Implemented Features

- Gangneung-si apartment sale / jeonse / monthly rent transaction loading.
- Recent 6 / 12 / 24 month selection.
- City-wide default view.
- Dong-level dropdown filter.
- Apartment dropdown comparison filter.
- Daily / weekly / monthly Top 10 apartment transaction ranking.
- Transaction type KPI cards: total, sale, jeonse, monthly rent.
- Transaction type bar chart.
- Monthly transaction trend line chart.
- Calendar transaction heatmap.
- Top 1 / Top 10 average / selected apartment comparison chart.
- Selected apartment address display.
- Google Maps embed by selected apartment address.
- Naver Map / Kakao Map / Google Maps search links.
- Location score cards for transit, school, Samsung service / business point, and commerce access.
- Market outlook score based on transaction volume, price momentum, sentiment proxy, and risk proxy.
- Profit decision cards for selected apartment: liquidity score, jeonse ratio estimate, monthly rent yield estimate.
- Market analysis framework metric tabs:
  - Demand / transaction.
  - Supply / unsold inventory.
  - Price index / price flow.
  - Buyer sentiment.
  - PIR / affordability.
  - Credit / risk.
- Recent selected apartment transaction table.
- Print button.
- Sample-data warning when the live API cannot be reached.

## Chart Structure

Charts are drawn directly with Canvas in `app.js` without external frontend libraries.

Chart functions:

- `barChart()`
- `lineChart()`
- `drawTypeChart()`
- `drawCompareChart()`
- `drawTrendChart()`

## Map Structure

The app does not require a separate map API key. It builds an address query from API fields and uses:

- Google Maps iframe embed search URL.
- Naver Map search link.
- Kakao Map search link.
- Google Maps external search link.

Address fields are generated in `server.js`:

- `roadAddress`
- `lotAddress`
- `address`

## KPI / Forecast Structure

Main real transaction KPIs:

- Total transaction count.
- Sale count.
- Jeonse count.
- Monthly rent count.

Market forecast engine:

- `computeMarketStats()`
- `renderForecast()`
- `renderFramework()`

Apartment decision engine:

- `computeApartmentStats()`
- `renderProfitDecision()`

Important note: these are analytical indicators based on observed public data and should be treated as decision support, not guaranteed investment advice.

## Environment Variables

- `PUBLIC_DATA_API_KEY`: Public data portal service key.
- `PORT`: Local server port. Default: `5177`.

## Run Commands

Developer run:

```powershell
node server.js
```

If Node certificate validation fails on Windows, use:

```powershell
$env:NODE_OPTIONS='--use-system-ca'; node server.js
```

Portable launcher:

```powershell
.\dist\Gangneung_Dashboard_Portable\Gangneung_Apartment_Dashboard.exe
```

Distribution build:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-distribution.ps1
```

## Dependency Information

Runtime:

- Node.js. The portable package includes `node.exe`.

No `package.json` or `node_modules` are required for the current app because it uses:

- Node.js built-in modules: `http`, `fs`, `path`.
- Browser-native JavaScript / Canvas / Fetch APIs.

Build-time optional:

- Windows .NET Framework C# compiler for `DashboardLauncher.cs`.
- Windows IExpress for the self-extracting distribution executable.

## Known External Data Gaps

The following indicators are part of the professor's analytical framework but require additional source datasets for exact official values:

- Unsold inventory.
- Move-in / supply volume.
- Official KB price index.
- Official buyer superiority index.
- PIR / JPIR / HAI with local income.
- GDP credit gap.
- M2 / apartment market capitalization ratio.
- Foreign investor ratio.
- Official school / job / population datasets.

The current dashboard clearly separates these as external-data-needed items rather than fabricating values.

## Migration Notes

This migration should preserve all currently available project files by copying, not moving or deleting.

The project is not currently a Git repository in the working root. There is no `.git` history to preserve from the current available folder.

Do not delete the original working root until the migrated folder is independently verified.

## Final Validation Checklist

When verifying after migration, confirm:

- `node --check server.js`
- `node --check app.js`
- Local server starts from the new folder.
- `GET http://localhost:5177/api/transactions?months=1` returns rows or a clear API warning.
- `GET http://localhost:5177/` returns status 200.
- No hard-coded references to the old project root remain in runtime files.
- `.env` exists locally but is excluded by `.gitignore`.

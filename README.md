# 강릉시 PropTech 부동산 데이터 분석 대시보드

## 실행

가장 안정적인 실행 방법은 `강릉시_대시보드_실행.bat`을 더블클릭하는 것입니다.

실행 후 `http://localhost:5177`에서 대시보드가 열립니다.

문제가 생기면 같은 폴더의 `dashboard.log`를 확인합니다.
서버 내부 출력은 `dashboard-server.log`, 서버 오류는 `dashboard-server-error.log`에 기록됩니다.

기존 단순 실행은 `run-dashboard.bat`을 사용할 수 있습니다.

공공데이터포털 HTTPS 인증서 검증을 위해 실행 파일은 Node.js의 `--use-system-ca` 옵션을 자동 적용합니다.
직접 서버를 실행할 때는 같은 이유로 `node --use-system-ca server.js`를 권장합니다.

배포용 포터블 실행은 `dist/Gangneung_Dashboard_Portable/Gangneung_Apartment_Dashboard.exe`를 사용합니다.

## 구성

- `server.js`: 공공데이터포털 API 프록시와 정적 파일 서버
- `index.html`: 대시보드 화면
- `styles.css`: 네온 청록/보색 대비 UI
- `app.js`: 필터, Top 10, 달력, 비교 그래프, 막대/추세 그래프, 시장전망/수익판단 지표
- `.env`: 공공데이터포털 API 키와 포트 설정
- `PROJECT_CONTEXT.md`: 프로젝트 인수인계 문서

## 데이터

강릉시 법정 시군구 코드 `51150`으로 국토교통부 아파트 매매 및 전월세 실거래가 API를 조회합니다.
연결 상태는 `http://localhost:5177/api/health`에서 확인할 수 있고, 실제 외부 호출까지 점검하려면 `http://localhost:5177/api/health?probe=1`을 사용합니다.

입지 거리 항목은 실제 좌표 API가 연결되기 전까지 단지명 기반 추정값으로 표시됩니다. 시장분석 지표 중 미분양, 입주량, PIR, 신용갭처럼 외부 원자료가 필요한 항목은 대시보드에서 별도 표시합니다.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5177
$logFile = Join-Path $root "dashboard.log"
$bundledNodeCandidates = @(
  (Join-Path $root "node.exe"),
  (Join-Path $root "dist\Gangneung_Dashboard_Portable\node.exe")
)
$server = Join-Path $root "server.js"

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Gangneung PropTech Dashboard" | Set-Content -LiteralPath $logFile -Encoding UTF8

if (-not (Test-Path -LiteralPath $server)) {
  "server.js not found: $server" | Add-Content -LiteralPath $logFile -Encoding UTF8
  throw "server.js 파일을 찾을 수 없습니다."
}

$bundledNode = $bundledNodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($bundledNode) {
  $node = $bundledNode
} else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    "Node runtime not found." | Add-Content -LiteralPath $logFile -Encoding UTF8
    throw "Node.js 실행 파일을 찾을 수 없습니다."
  }
  $node = $cmd.Source
}

$existing = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($existing) {
  "Port $port is already in use. Opening existing dashboard." | Add-Content -LiteralPath $logFile -Encoding UTF8
  Start-Process "http://localhost:$port/"
  exit 0
}

$env:NODE_OPTIONS = "--use-system-ca"
$env:PORT = "$port"

$serverLog = Join-Path $root "dashboard-server.log"
$serverErrorLog = Join-Path $root "dashboard-server-error.log"
$process = Start-Process -FilePath $node -ArgumentList "`"$server`"" -WorkingDirectory $root -WindowStyle Minimized -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog
"Started server process id $($process.Id)" | Add-Content -LiteralPath $logFile -Encoding UTF8

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$port/" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $ok = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $ok) {
  "Dashboard server did not become ready." | Add-Content -LiteralPath $logFile -Encoding UTF8
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  throw "대시보드 서버가 시작되지 않았습니다. dashboard.log와 dashboard-server.log를 확인하세요."
}

Start-Process "http://localhost:$port/"
"Dashboard opened at http://localhost:$port/" | Add-Content -LiteralPath $logFile -Encoding UTF8

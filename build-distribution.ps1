$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$workspacePackage = Join-Path $dist "package"
$portable = Join-Path $dist "Gangneung_Dashboard_Portable"
$exePath = Join-Path $dist "Gangneung_Apartment_Dashboard_Distribution.exe"
$koreanExeName = -join ([int[]](44053,47497,49884,95,50500,54028,53944,95,45824,49884,48372,46300,95,48176,54252,50857,46,101,120,101) | ForEach-Object { [char]$_ })
$koreanExePath = Join-Path $root $koreanExeName
$zipPath = Join-Path $dist "Gangneung_Dashboard_Portable.zip"
$buildBase = Join-Path $env:PUBLIC "Documents\ESTsoft\CreatorTemp\gangneung-dashboard-build"
$package = Join-Path $buildBase "package"
$asciiExePath = Join-Path $buildBase "GangneungApartmentDashboard.exe"
$sedPath = Join-Path $buildBase "dashboard-package.sed"
$nodePath = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $nodePath)) {
  throw "Node.js runtime not found at $nodePath"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Force -Path $package | Out-Null
New-Item -ItemType Directory -Force -Path $workspacePackage | Out-Null
New-Item -ItemType Directory -Force -Path $portable | Out-Null

$files = @(
  "server.js",
  "dashboard.html",
  "index.html",
  "styles.css",
  "app.js",
  ".env",
  ".env.example",
  ".gitignore",
  "PROJECT_CONTEXT.md",
  "launch-dashboard.ps1",
  "README.md"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $package $file) -Force
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $workspacePackage $file) -Force
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $portable $file) -Force
}

$dataSource = Join-Path $root "data"
if (Test-Path -LiteralPath $dataSource) {
  foreach ($target in @($package, $workspacePackage, $portable)) {
    $dataTarget = Join-Path $target "data"
    if (Test-Path -LiteralPath $dataTarget) {
      Remove-Item -LiteralPath $dataTarget -Recurse -Force
    }
    Copy-Item -LiteralPath $dataSource -Destination $dataTarget -Recurse -Force
  }
  foreach ($indicatorFile in @("market-indicators.csv", "economic-indicators.csv")) {
    $indicatorPath = Join-Path $dataSource $indicatorFile
    if (Test-Path -LiteralPath $indicatorPath) {
      Copy-Item -LiteralPath $indicatorPath -Destination (Join-Path $package $indicatorFile) -Force
    }
  }
}

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $package "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $root "packaging\launch-dashboard.bat") -Destination (Join-Path $package "launch-dashboard.bat") -Force
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $workspacePackage "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $root "packaging\launch-dashboard.bat") -Destination (Join-Path $workspacePackage "launch-dashboard.bat") -Force
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $portable "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $root "packaging\launch-dashboard.bat") -Destination (Join-Path $portable "launch-dashboard.bat") -Force

$cscCandidates = @(
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  throw "C# compiler not found."
}

$launcherPath = Join-Path $portable "Gangneung_Apartment_Dashboard.exe"
$launcherBuildPath = Join-Path $buildBase ("Gangneung_Apartment_Dashboard_" + [Guid]::NewGuid().ToString("N") + ".exe")
& $csc /nologo /target:winexe /codepage:65001 /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$launcherBuildPath" (Join-Path $root "packaging\DashboardLauncher.cs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $launcherBuildPath)) {
  throw "Dashboard launcher executable was not created."
}
try {
  Copy-Item -LiteralPath $launcherBuildPath -Destination $launcherPath -Force
} catch {
  if (-not (Test-Path $launcherPath)) {
    throw
  }
  Write-Warning "Portable launcher is in use; preserved the existing launcher."
}
Copy-Item -LiteralPath $launcherBuildPath -Destination (Join-Path $package "Gangneung_Apartment_Dashboard.exe") -Force
Copy-Item -LiteralPath $launcherBuildPath -Destination (Join-Path $workspacePackage "Gangneung_Apartment_Dashboard.exe") -Force

if (Test-Path $asciiExePath) {
  Remove-Item -LiteralPath $asciiExePath -Force
}

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$asciiExePath
FriendlyName=Gangneung Apartment Dashboard
AppLaunched=Gangneung_Apartment_Dashboard.exe
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$package
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
%FILE4%=
%FILE5%=
%FILE6%=
%FILE7%=
%FILE8%=
%FILE9%=
%FILE10%=
%FILE11%=
%FILE12%=
%FILE13%=
%FILE14%=
%FILE15%=
[Strings]
FILE0="server.js"
FILE1="dashboard.html"
FILE2="index.html"
FILE3="styles.css"
FILE4="app.js"
FILE5=".env"
FILE6=".env.example"
FILE7=".gitignore"
FILE8="PROJECT_CONTEXT.md"
FILE9="launch-dashboard.ps1"
FILE10="README.md"
FILE11="node.exe"
FILE12="launch-dashboard.bat"
FILE13="Gangneung_Apartment_Dashboard.exe"
FILE14="market-indicators.csv"
FILE15="economic-indicators.csv"
"@

Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

$iexpress = Join-Path $env:WINDIR "system32\iexpress.exe"
if (-not (Test-Path $iexpress)) {
  throw "IExpress not found at $iexpress"
}

& $iexpress /N /Q $sedPath

if (-not (Test-Path $asciiExePath)) {
  for ($i = 0; $i -lt 180 -and -not (Test-Path $asciiExePath); $i++) {
    Start-Sleep -Seconds 1
  }
}

$stableTicks = 0
$lastSize = -1
for ($i = 0; $i -lt 180 -and $stableTicks -lt 5; $i++) {
  if (Test-Path $asciiExePath) {
    $size = (Get-Item $asciiExePath).Length
    if ($size -eq $lastSize -and $size -gt 1048576) {
      $stableTicks++
    } else {
      $stableTicks = 0
      $lastSize = $size
    }
  }
  Start-Sleep -Seconds 1
}

if (-not (Test-Path $asciiExePath) -or (Get-Item $asciiExePath).Length -le 1048576) {
  throw "Distribution executable was not created correctly."
}

Copy-Item -LiteralPath $asciiExePath -Destination $exePath -Force
Copy-Item -LiteralPath $asciiExePath -Destination $koreanExePath -Force

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $portable -DestinationPath $zipPath -Force

Write-Host "Created: $exePath"
Write-Host "Created: $koreanExePath"
Write-Host "Portable zip: $zipPath"
Write-Host "Portable launcher: $launcherPath"
Write-Host "Portable package folder: $workspacePackage"

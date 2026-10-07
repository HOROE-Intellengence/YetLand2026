$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $root '.server'
$webUrl = 'http://localhost:5173'
$webProbeUrls = @('http://localhost:5173', 'http://127.0.0.1:5173')
$apiHealthUrl = 'http://127.0.0.1:8787/health'
$fullLog = Join-Path $serverDir 'quick-start-full.log'
$webLog = Join-Path $serverDir 'quick-start-web.log'
$mockLog = Join-Path $serverDir 'quick-start-mock.log'
$pidPath = Join-Path $serverDir 'quick-start-real-frontend.pid'

function Show-PortOwners {
  param([Parameter(Mandatory = $true)][int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "       port ${Port}: no listening process"
    return
  }

  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host "       port ${Port}: PID $($connection.OwningProcess)"
    if ($process -and $process.CommandLine) {
      Write-Host "       command: $($process.CommandLine)"
    }
  }
}

function Test-UrlReady {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-PortListening {
  param([Parameter(Mandatory = $true)][int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$connections
}

function Get-WebFrontendState {
  $sawRealWeb = $false

  foreach ($url in $webProbeUrls) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 500) {
        continue
      }

      $content = [string]$response.Content
      $isRealWeb = $content -match 'theme-color' -and $content -match 'viewport-fit=cover' -and $content -notmatch 'JetBrains\+Mono'
      if ($isRealWeb) {
        $sawRealWeb = $true
        continue
      }

      return 'wrong-service'
    } catch {
      continue
    }
  }

  if ($sawRealWeb) { return 'ready' }
  return 'not-ready'
}

function Stop-IfWrongFrontend {
  param([Parameter(Mandatory = $true)][string]$State)

  if ($State -ne 'wrong-service') {
    return
  }

  Write-Host ""
  Write-Host "[FAIL] frontend 5173 is occupied by a non-web app. Refusing to open the wrong page." -ForegroundColor Red
  Write-Host "       expected markers: theme-color + viewport-fit=cover"
  Write-Host "       rejected markers: admin/other page"
  Show-PortOwners 5173
  Write-Host ""
  Write-Host "       Close that process, then run this script again."
  exit 1
}

function Start-PnpmBackground {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if ($Arguments -eq 'dev') {
    Start-PnpmBackground -Name 'backend' -Arguments 'dev:mock' -LogPath $mockLog
    Start-PnpmBackground -Name 'frontend' -Arguments 'dev:web' -LogPath $webLog
    return
  }
  $appDir = if ($Arguments -eq 'dev:web') { 'apps/web' } else { 'apps/api' }
  $entryArgs = if ($Arguments -eq 'dev:web') {
    @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort')
  } else {
    @('node_modules/tsx/dist/cli.mjs', 'src/index.ts')
  }
  $env:DEPLOY_MODE = 'local'
  $env:VITE_API_BASE = 'http://127.0.0.1:8787'
  Write-Host "[START] $Name"
  $process = Start-Process -FilePath $nodePath -ArgumentList $entryArgs `
    -WorkingDirectory (Join-Path $root $appDir) -WindowStyle Hidden `
    -RedirectStandardOutput $LogPath -RedirectStandardError "$LogPath.stderr" -PassThru
  Set-Content -Encoding UTF8 -Path $pidPath -Value $process.Id
}

function Show-LogTail {
  param([Parameter(Mandatory = $true)][string[]]$Paths)

  foreach ($path in $Paths) {
    if (Test-Path $path) {
      Write-Host ""
      Write-Host "----- $path -----"
      Get-Content -Encoding UTF8 -Path $path -Tail 40
    }
  }
}

function Test-WorkspaceDepsReady {
  $requiredFiles = @(
    'apps/api/node_modules/tsx/dist/cli.mjs',
    'apps/web/node_modules/vite/bin/vite.js'
  )

  foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $root $file))) {
      return $false
    }
  }

  return $true
}

Set-Location $root
New-Item -ItemType Directory -Force -Path $serverDir | Out-Null

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js not found. Install Node.js 20 or newer.' }
$env:Path = (Split-Path $nodePath) + ';' + $env:Path
if (-not (Test-Path (Join-Path $root 'node_modules')) -or -not (Test-WorkspaceDepsReady)) {
  Write-Host "[SETUP] workspace dependencies missing or stale; rebuilding pnpm links..." -ForegroundColor Yellow
  pnpm.cmd install --frozen-lockfile --force
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$apiReady = Test-UrlReady $apiHealthUrl
$webState = Get-WebFrontendState
Stop-IfWrongFrontend $webState
if ($webState -eq 'not-ready' -and (Test-PortListening 5173)) {
  Stop-IfWrongFrontend 'wrong-service'
}
$webReady = $webState -eq 'ready'

Write-Host ""
Write-Host "[CHECK] backend 8787: $(if ($apiReady) { 'ready' } else { 'not ready' })"
Write-Host "[CHECK] frontend 5173: $(if ($webReady) { 'ready' } else { 'not ready' })"

if (-not $apiReady -and -not $webReady) {
  Start-PnpmBackground -Name 'real frontend + backend' -Arguments 'dev' -LogPath $fullLog
} elseif (-not $apiReady) {
  Start-PnpmBackground -Name 'backend mock-server' -Arguments 'dev:mock' -LogPath $mockLog
} elseif (-not $webReady) {
  Start-PnpmBackground -Name 'real frontend' -Arguments 'dev:web' -LogPath $webLog
}

Write-Host ""
Write-Host "[WAIT] waiting for backend + real frontend..."

for ($i = 0; $i -lt 90; $i++) {
  $apiReady = Test-UrlReady $apiHealthUrl
  $webState = Get-WebFrontendState
  Stop-IfWrongFrontend $webState
  $webReady = $webState -eq 'ready'

  if ($apiReady -and $webReady) {
    Write-Host "[OK] backend:  $apiHealthUrl" -ForegroundColor Green
    Write-Host "[OK] frontend: $webUrl" -ForegroundColor Green
    Start-Process $webUrl
    exit 0
  }

  Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "[FAIL] services did not become ready in time." -ForegroundColor Red
Write-Host "       backend:  $apiHealthUrl"
Write-Host "       frontend: $webUrl"
Show-LogTail @($fullLog, $mockLog, $webLog)
Write-Host ""
exit 1

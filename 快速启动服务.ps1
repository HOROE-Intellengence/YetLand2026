param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$baseUrl = 'http://127.0.0.1:8787'
$logDir = Join-Path $root '.server'

function Test-Ready {
  try {
    $health = Invoke-RestMethod "$baseUrl/health" -TimeoutSec 2
    $admin = Invoke-WebRequest "$baseUrl/admin" -UseBasicParsing -TimeoutSec 2
    return $health.ok -eq $true -and $admin.StatusCode -eq 200 -and $admin.Content.Contains('/admin/assets/')
  } catch { return $false }
}

try {
  Set-Location -LiteralPath $root
  if (-not (Test-Ready)) {
    $listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      throw "Port 8787 is occupied, but the API/admin is not ready. Check the existing service (PID: $($listener.OwningProcess -join ', '))."
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
      Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js not found. Install Node.js 20 or newer.' }
    foreach ($required in @('apps/api/node_modules/tsx/dist/cli.mjs', 'apps/admin/dist/index.html')) {
      if (-not (Test-Path -LiteralPath (Join-Path $root $required))) {
        throw "Missing $required. Run pnpm install --frozen-lockfile and pnpm build first."
      }
    }

    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $env:DEPLOY_MODE = 'local'
    $env:MOCK_HOST = '127.0.0.1'
    $env:MOCK_PORT = '8787'
    $env:ENABLE_ADMIN_CONSOLE = 'true'
    $process = Start-Process -FilePath $nodePath `
      -ArgumentList @('node_modules/tsx/dist/cli.mjs', 'src/index.ts') `
      -WorkingDirectory (Join-Path $root 'apps/api') -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir 'api.stdout.log') `
      -RedirectStandardError (Join-Path $logDir 'api.stderr.log') -PassThru
    Set-Content -LiteralPath (Join-Path $logDir 'api.pid') -Value $process.Id
    Write-Host "Starting API (PID $($process.Id))..."
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if (Test-Ready) { $ready = $true; break }
      $process.Refresh()
      if ($process.HasExited) { break }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "API did not become ready. See $logDir\api.stderr.log and api.stdout.log." }
  }
  Write-Host "Ready: $baseUrl/admin"
  Write-Host "Health: $baseUrl/health"
  Write-Host "Logs: $logDir"
  if (-not $NoBrowser) { Start-Process "$baseUrl/admin" }
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

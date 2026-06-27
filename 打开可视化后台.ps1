$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8787
$baseUrl = "http://127.0.0.1:$port"
$healthUrl = "$baseUrl/health"
$adminUrl = "$baseUrl/admin"
$serverDir = Join-Path $root '.server'
$logPath = Join-Path $serverDir 'mock-server.log'
$pidPath = Join-Path $serverDir 'mock-server.pid'

function Test-ServerReady {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

Set-Location $root
New-Item -ItemType Directory -Force -Path $serverDir | Out-Null

if (Test-ServerReady) {
  Write-Host "mock-server already running: $healthUrl"
} else {
  Write-Host "Starting mock-server..."
  Write-Host "Log: $logPath"

  $escapedRoot = $root.Replace("'", "''")
  $escapedLog = $logPath.Replace("'", "''")
  $command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); `$OutputEncoding = [System.Text.UTF8Encoding]::new(); Set-Location -LiteralPath '$escapedRoot'; `$env:DEPLOY_MODE='local'; pnpm.cmd dev:mock 2>&1 | Out-File -FilePath '$escapedLog' -Encoding utf8"
  $process = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -Encoding UTF8 -Path $pidPath -Value $process.Id
  Start-Sleep -Seconds 3
}

for ($i = 0; $i -lt 45; $i++) {
  if (Test-ServerReady) {
    Write-Host "Opening admin console: $adminUrl"
    Start-Process $adminUrl
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "mock-server did not become ready on $healthUrl"
Write-Host "Last log lines:"
if (Test-Path $logPath) {
  Get-Content -Encoding UTF8 -Path $logPath -Tail 40
} else {
  Write-Host "No log file found."
}
Write-Host ""
Read-Host "Press Enter to exit"
exit 1

param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path $nodePath)) { throw 'Node.js is required.' }
if (-not (Test-Path 'node_modules/next')) { throw 'Install dependencies first.' }
$url = 'http://localhost:3001'
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  try { $config = Invoke-RestMethod "$url/api/managed-status" -TimeoutSec 10 } catch { throw 'Port 3001 is occupied by another service.' }
  if ($config.app -ne 'yelan-phone') { throw 'Port 3001 is occupied by another service.' }
  if (-not $config.managed) { throw 'The running phone uses legacy debug mode. Stop that process before starting managed mode.' }
} else {
  $env:NEXT_PUBLIC_SELF_HOSTED_MODE = 'true'
  $env:NEXT_PUBLIC_YELAN_PHONE_LOCAL = 'true'
  $env:YELAN_PHONE_LOCAL = 'true'
  $env:NEXT_PUBLIC_YELAN_PHONE_MANAGED = 'true'
  $env:YELAN_PHONE_MANAGED = 'true'
  New-Item -ItemType Directory -Force '.local' | Out-Null
  $process = Start-Process -FilePath $nodePath -WindowStyle Hidden -WorkingDirectory $PSScriptRoot `
    -ArgumentList @('--max-old-space-size=6144', 'scripts/local-next-server.mjs', '--dev', '--host', '127.0.0.1', '--port', '3001') `
    -RedirectStandardOutput '.local/server.stdout.log' -RedirectStandardError '.local/server.stderr.log' -PassThru
  Set-Content '.local/server.pid' $process.Id
  Write-Host "Starting local phone (PID $($process.Id)). Logs: .local/"
}
Write-Host "Phone: $url"
if (-not $NoBrowser) { Start-Process 'http://localhost:5173' }

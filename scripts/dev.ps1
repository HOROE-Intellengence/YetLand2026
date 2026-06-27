# ============================================================================
#  夜阑 · 一键开发脚本（PowerShell / Windows）
#  ----------------------------------------------------------------------------
#  流程：
#    1. 检查 pnpm + node_modules，缺失则跑 pnpm setup
#    2. pnpm doctor（fail 阻断；warn 继续）
#    3. pnpm dev（同时起 apps/api + web）
#
#  用法：
#    pwsh ./scripts/dev.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/.."
try {
  Write-Host ""
  Write-Host "  夜阑 · 一键开发流程" -ForegroundColor Cyan
  Write-Host "  ──────────────────────" -ForegroundColor DarkGray

  # ── 1. 前置检查 ────────────────────────────────────────────────────────
  $pnpmOk = $null
  try { $pnpmOk = Get-Command pnpm -ErrorAction Stop } catch { $pnpmOk = $null }
  if ($null -eq $pnpmOk) {
    Write-Host "  [!] 未找到 pnpm — 先装:" -ForegroundColor Red
    Write-Host "      npm i -g pnpm"
    exit 1
  }

  if (-not (Test-Path "node_modules")) {
    Write-Host "  [!] 未发现 node_modules — 先跑 pnpm setup" -ForegroundColor Yellow
    $ans = Read-Host "    现在自动跑 pnpm setup 吗? [Y/n]"
    if ($ans -ne "n" -and $ans -ne "N") {
      pnpm setup
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } else {
      exit 1
    }
  }

  # ── 2. 体检 ────────────────────────────────────────────────────────────
  Write-Host ""
  pnpm doctor
  if ($LASTEXITCODE -eq 2) {
    Write-Host ""
    Write-Host "  [!] 体检有 fail 项 — 修完再跑" -ForegroundColor Red
    exit 2
  }

  # ── 3. 启动 ────────────────────────────────────────────────────────────
  Write-Host ""
  Write-Host "  启动 apps/api + web..." -ForegroundColor Cyan
  Write-Host "  - 前端     http://localhost:5173"
  Write-Host "  - 控制台   http://localhost:8787/admin"
  Write-Host ""

  pnpm dev
} finally {
  Pop-Location
}

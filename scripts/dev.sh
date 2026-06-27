#!/usr/bin/env bash
# ============================================================================
#  夜阑 · 一键开发脚本（macOS / Linux）
#  ----------------------------------------------------------------------------
#  流程：检查 pnpm + node_modules → pnpm doctor → pnpm dev
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo
echo -e "\033[36m  夜阑 · 一键开发流程\033[0m"
echo -e "\033[2m  ──────────────────────\033[0m"

# ── 1. 前置检查 ────────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "\033[31m  [!] 未找到 pnpm — 先装：npm i -g pnpm\033[0m"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo -e "\033[33m  [!] 未发现 node_modules — 先跑 pnpm setup\033[0m"
  read -rp "    现在自动跑 pnpm setup 吗？[Y/n] " ans
  if [[ "$ans" != "n" && "$ans" != "N" ]]; then
    pnpm setup
  else
    exit 1
  fi
fi

# ── 2. 体检 ────────────────────────────────────────────────────────────────
echo
set +e
pnpm doctor
doctor_exit=$?
set -e
if [ $doctor_exit -eq 2 ]; then
  echo
  echo -e "\033[31m  [!] 体检有 fail 项 — 修完再跑\033[0m"
  exit 2
fi

# ── 3. 启动 ────────────────────────────────────────────────────────────────
echo
echo -e "\033[36m  启动 apps/api + web...\033[0m"
echo "  - 前端     http://localhost:5173"
echo "  - 控制台   http://localhost:8787/admin"
echo

pnpm dev

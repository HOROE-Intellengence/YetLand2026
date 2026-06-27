#!/usr/bin/env sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR" || exit 2

ENV_FILE="${1:-.env}"
FAIL=0
WARN=0

pass() { printf "PASS  %s\n" "$1"; }
warn() { WARN=$((WARN + 1)); printf "WARN  %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "FAIL  %s\n" "$1"; }

value_of() {
  key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub(/^[^=]*=/, "")
      gsub(/\r$/, "")
      print
    }
  ' "$ENV_FILE" 2>/dev/null | tail -n 1
}

is_placeholder() {
  value="$1"
  case "$value" in
    ""|api.example.com|app.example.com|your-domain.com|your-domain|REPLACE_*|CHANGE_ME*|*REPLACE_WITH*|*example.com*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

len() {
  printf "%s" "$1" | wc -c | tr -d " "
}

printf "\nYelan deploy preflight: %s\n\n" "$ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
  fail "$ENV_FILE not found. Run: cp .env.example .env"
  printf "\nResult: %s failed, %s warnings\n" "$FAIL" "$WARN"
  exit 2
fi

DOMAIN=$(value_of DOMAIN)
if is_placeholder "$DOMAIN"; then
  fail "DOMAIN is empty or still a placeholder: set it to your real API domain"
else
  pass "DOMAIN is set"
fi

CORS_ORIGINS=$(value_of CORS_ORIGINS)
if is_placeholder "$CORS_ORIGINS"; then
  fail "CORS_ORIGINS is empty or still a placeholder: set your real frontend origin"
elif printf "%s" "$CORS_ORIGINS" | grep -q "\*"; then
  warn "CORS_ORIGINS contains '*'. This works, but is not recommended for production"
else
  pass "CORS_ORIGINS is set"
fi

ADMIN_TOKEN=$(value_of ADMIN_TOKEN)
ADMIN_TOKEN_LEN=$(len "$ADMIN_TOKEN")
case "$ADMIN_TOKEN" in
  ""|admin-dev-token|*admin*|*password*|*123456*|*5201314*)
    fail "ADMIN_TOKEN is missing, default, or too guessable"
    ;;
  *)
    if [ "$ADMIN_TOKEN_LEN" -lt 32 ]; then
      fail "ADMIN_TOKEN is too short: use at least 32 characters"
    else
      pass "ADMIN_TOKEN looks strong enough"
    fi
    ;;
esac

ADMIN_PATH=$(value_of ADMIN_PATH)
case "$ADMIN_PATH" in
  ""|/__console_change_me__)
    warn "ADMIN_PATH still the default placeholder. Set a random secret path (e.g. /x7Kq9-ops) to reduce console scanning"
    ;;
  /admin|/admin/)
    fail "ADMIN_PATH must not be /admin: it defeats the disguise and collides with Caddy's block rule"
    ;;
  /*)
    if [ "$(len "$ADMIN_PATH")" -lt 6 ]; then
      warn "ADMIN_PATH is very short and easy to guess: use a longer random path"
    else
      pass "ADMIN_PATH is set to a custom secret path"
    fi
    ;;
  *)
    fail "ADMIN_PATH must start with '/' (e.g. /x7Kq9-ops)"
    ;;
esac

READY_KEYS=""
for key in ANTHROPIC_API_KEY OPENAI_API_KEY DEEPSEEK_API_KEY NVIDIA_API_KEY; do
  value=$(value_of "$key")
  if [ "$(len "$value")" -gt 10 ]; then
    READY_KEYS="$READY_KEYS $key"
  fi
done

if [ -z "$READY_KEYS" ]; then
  fail "No LLM API key configured. Set at least one of ANTHROPIC/OPENAI/DEEPSEEK/NVIDIA"
else
  pass "LLM key configured:$READY_KEYS"
fi

INTERNAL_TOKEN_REQUIRED=$(value_of INTERNAL_TOKEN_REQUIRED)
INTERNAL_TOKEN=$(value_of INTERNAL_TOKEN)
case "$INTERNAL_TOKEN_REQUIRED" in
  true)
    if [ "$(len "$INTERNAL_TOKEN")" -lt 32 ]; then
      fail "INTERNAL_TOKEN_REQUIRED=true but INTERNAL_TOKEN is missing or too short"
    else
      warn "INTERNAL_TOKEN_REQUIRED=true. Only use this behind the Worker edge path, not plain Caddy direct"
    fi
    ;;
  false|"")
    pass "INTERNAL_TOKEN_REQUIRED is false for Caddy direct deployment"
    ;;
  *)
    fail "INTERNAL_TOKEN_REQUIRED must be true or false"
    ;;
esac

printf "\nNext ECS commands after this is clean:\n"
printf "  cd ~/yelan/infra/deploy\n"
printf "  sh check.sh\n"
printf "  docker compose up -d --build\n"
printf "  docker compose ps\n"
if ! is_placeholder "$DOMAIN"; then
  printf "  curl -fsS https://%s/health\n" "$DOMAIN"
else
  printf "  curl -fsS https://<your-domain>/health\n"
fi

printf "\nResult: %s failed, %s warnings\n" "$FAIL" "$WARN"
if [ "$FAIL" -gt 0 ]; then
  exit 2
fi
if [ "$WARN" -gt 0 ]; then
  exit 1
fi
exit 0

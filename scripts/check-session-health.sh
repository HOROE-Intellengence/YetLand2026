#!/bin/bash
# 夜阑项目 - 会话健康检查脚本
# 用途：监控token使用、检测截断问题、验证配置
# 日期：2026-08-18

set -e

cd "$(dirname "$0")/.."

echo "=========================================="
echo "夜阑项目 - 会话健康检查"
echo "=========================================="
echo ""

# 1. 检查服务状态
echo "📊 [1/6] Docker 容器状态"
echo "----------------------------------------"
cd infra/deploy
docker compose ps
echo ""

# 2. 检查环境变量配置
echo "📋 [2/6] 环境变量配置"
echo "----------------------------------------"
if [ -f .env ]; then
    echo "✅ .env 文件存在"
    echo ""
    echo "Token 相关配置："
    grep -E "TOKEN_GUARD_ENABLED|SESSION_TOKEN_LIMIT|GLOBAL_DAILY_TOKEN_LIMIT|CONTEXT_COMPRESS" .env || echo "  (未设置)"
    echo ""
    echo "超时相关配置："
    grep -E "SIDECAR.*TIMEOUT" .env || echo "  (未设置)"
else
    echo "❌ .env 文件不存在"
fi
echo ""

# 3. 检查代码修复
echo "🔧 [3/6] 代码修复验证"
echo "----------------------------------------"
cd ../..
echo "前端修复 (useChat.ts)："
if grep -q "wasAborted" apps/web/src/hooks/useChat.ts; then
    echo "  ✅ wasAborted 逻辑已应用"
else
    echo "  ❌ wasAborted 逻辑缺失"
fi

if grep -q "streamStarted" apps/web/src/hooks/useChat.ts; then
    echo "  ✅ streamStarted 逻辑已应用"
else
    echo "  ❌ streamStarted 逻辑缺失"
fi

echo ""
echo "后端修复 (index.ts)："
if grep -q "headersTimeout = 0" apps/api/src/index.ts; then
    echo "  ✅ headersTimeout=0 已设置"
else
    echo "  ❌ headersTimeout=0 缺失"
fi

if grep -q "requestTimeout = 0" apps/api/src/index.ts; then
    echo "  ✅ requestTimeout=0 已设置"
else
    echo "  ❌ requestTimeout=0 缺失"
fi
echo ""

# 4. 分析错误日志
echo "📝 [4/6] 错误日志分析"
echo "----------------------------------------"
ERROR_LOG="infra/deploy/_data/logs/error.log"

if [ -f "$ERROR_LOG" ]; then
    # TOKEN_GUARD_TRIPPED 错误统计
    TOKEN_ERRORS=$(grep -c "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" 2>/dev/null || echo "0")
    echo "Token限制触发次数（总计）: $TOKEN_ERRORS"

    if [ "$TOKEN_ERRORS" -gt 0 ]; then
        echo ""
        echo "最后一次Token限制触发："
        grep "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" | tail -1 | jq -r '"\(.ts) - 会话:\(.userId) - \(.message)"' 2>/dev/null || grep "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" | tail -1

        echo ""
        echo "最近24小时Token限制统计（按用户）："
        YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null || echo "2026-08-17")
        grep "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" | grep -E "$YESTERDAY|$(date +%Y-%m-%d)" | \
            grep -o '"userId":"[^"]*"' | sort | uniq -c | sort -rn || echo "  无最近记录"
    fi

    echo ""

    # JSON 解析错误
    JSON_ERRORS=$(grep -c "Malformed JSON" "$ERROR_LOG" 2>/dev/null || echo "0")
    echo "JSON 解析错误次数: $JSON_ERRORS"

    echo ""

    # 侧袋超时
    SIDECAR_TIMEOUTS=$(grep -c "sidecar timeout" "$ERROR_LOG" 2>/dev/null || echo "0")
    echo "侧袋AI超时次数: $SIDECAR_TIMEOUTS"
else
    echo "⚠️  错误日志文件不存在: $ERROR_LOG"
fi
echo ""

# 5. 检查最近的会话
echo "💬 [5/6] 最近的会话活动"
echo "----------------------------------------"
cd infra/deploy
docker compose logs api --tail 50 | grep -E "\[memory-gate\]|\[cost\]" | tail -10 || echo "  无最近会话记录"
echo ""

# 6. 给出建议
echo "💡 [6/6] 建议"
echo "----------------------------------------"

if [ "$TOKEN_ERRORS" -gt 0 ]; then
    LAST_ERROR_DATE=$(grep "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" | tail -1 | grep -o '"ts":"[^"]*"' | cut -d'"' -f4 | cut -dT -f1)
    TODAY=$(date +%Y-%m-%d)

    if [ "$LAST_ERROR_DATE" == "$TODAY" ]; then
        echo "⚠️  今天仍有Token限制错误，建议："
        echo "   1. 检查 TOKEN_GUARD_ENABLED 是否已设置为 off"
        echo "   2. 提高 SESSION_TOKEN_LIMIT 到 500000"
        echo "   3. 降低 CONTEXT_COMPRESS_TOKEN_LIMIT 到 6000"
    else
        echo "✅ 最近没有新的Token限制错误"
        echo "   上次触发时间: $LAST_ERROR_DATE"
    fi
else
    echo "✅ 没有Token限制错误记录"
fi

if [ "$SIDECAR_TIMEOUTS" -gt 10 ]; then
    echo ""
    echo "⚠️  侧袋AI超时较多，建议："
    echo "   增加 SIDECAR_STRUCTURER_TIMEOUT_MS 到 15000"
fi

echo ""
echo "=========================================="
echo "检查完成 - $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

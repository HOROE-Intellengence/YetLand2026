#!/bin/bash
# 夜阑项目 - 会话超时问题快速修复脚本
# 用途：提高token限制，解决长对话中的TOKEN_GUARD_TRIPPED错误

set -e

echo "=========================================="
echo "  夜阑 - 会话超时问题修复工具"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否在项目根目录
if [ ! -f "package.json" ] || [ ! -d "apps/api" ]; then
    echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
    exit 1
fi

echo "📊 当前配置检查..."
echo ""

# 检查当前的token限制设置
if [ -f ".env" ]; then
    CURRENT_SESSION_LIMIT=$(grep "^SESSION_TOKEN_LIMIT=" .env 2>/dev/null | cut -d'=' -f2 || echo "未设置")
    CURRENT_COMPRESS_LIMIT=$(grep "^CONTEXT_COMPRESS_TOKEN_LIMIT=" .env 2>/dev/null | cut -d'=' -f2 || echo "未设置")
    echo "当前 SESSION_TOKEN_LIMIT: ${CURRENT_SESSION_LIMIT:-200000(默认)}"
    echo "当前 CONTEXT_COMPRESS_TOKEN_LIMIT: ${CURRENT_COMPRESS_LIMIT:-8000(默认)}"
else
    echo -e "${YELLOW}警告: 未找到 .env 文件${NC}"
    CURRENT_SESSION_LIMIT="未设置"
fi

echo ""
echo "🔍 检查最近的TOKEN_GUARD错误..."

# 检查错误日志
ERROR_LOG="infra/deploy/_data/logs/error.log"
if [ -f "$ERROR_LOG" ]; then
    ERROR_COUNT=$(grep -c "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" 2>/dev/null || echo "0")
    echo "发现 ${ERROR_COUNT} 次TOKEN_GUARD_TRIPPED错误"

    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo ""
        echo "最近的3条错误："
        grep "TOKEN_GUARD_TRIPPED" "$ERROR_LOG" | tail -3 | while read line; do
            echo "  - $(echo $line | grep -o 'session_token_limit: [0-9]*/[0-9]*' || echo $line)"
        done
    fi
else
    echo -e "${YELLOW}未找到错误日志文件${NC}"
fi

echo ""
echo "=========================================="
echo "  推荐修复方案"
echo "=========================================="
echo ""
echo "基于您的使用场景，选择合适的配置："
echo ""
echo "1. ${GREEN}角色扮演/长对话场景${NC} (推荐)"
echo "   SESSION_TOKEN_LIMIT=500000"
echo "   CONTEXT_COMPRESS_TOKEN_LIMIT=10000"
echo ""
echo "2. ${YELLOW}中等对话场景${NC}"
echo "   SESSION_TOKEN_LIMIT=300000"
echo "   CONTEXT_COMPRESS_TOKEN_LIMIT=8000"
echo ""
echo "3. ${YELLOW}测试/无限制${NC}"
echo "   SESSION_TOKEN_LIMIT=2000000"
echo "   CONTEXT_COMPRESS_TOKEN_LIMIT=50000"
echo ""
echo "4. 取消token限制 (仅测试用)"
echo "   TOKEN_GUARD_ENABLED=off"
echo ""

read -p "请选择方案 (1-4) 或按 Enter 取消: " choice

case $choice in
    1)
        SESSION_LIMIT=500000
        COMPRESS_LIMIT=10000
        SCENARIO="角色扮演/长对话"
        ;;
    2)
        SESSION_LIMIT=300000
        COMPRESS_LIMIT=8000
        SCENARIO="中等对话"
        ;;
    3)
        SESSION_LIMIT=2000000
        COMPRESS_LIMIT=50000
        SCENARIO="测试/无限制"
        ;;
    4)
        echo ""
        echo -e "${YELLOW}警告: 这将完全关闭token限制，可能导致成本失控${NC}"
        read -p "确定要继续吗? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo "操作已取消"
            exit 0
        fi
        DISABLE_GUARD=true
        SCENARIO="关闭限制(测试)"
        ;;
    *)
        echo "操作已取消"
        exit 0
        ;;
esac

echo ""
echo "=========================================="
echo "  开始应用配置"
echo "=========================================="
echo ""

# 备份现有.env文件
if [ -f ".env" ]; then
    BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
    cp .env "$BACKUP_FILE"
    echo -e "${GREEN}✓${NC} 已备份当前 .env 到 $BACKUP_FILE"
fi

# 创建或更新.env文件
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} 从 .env.example 创建了 .env"
fi

# 应用配置
if [ "$DISABLE_GUARD" = true ]; then
    # 关闭token guard
    if grep -q "^TOKEN_GUARD_ENABLED=" .env; then
        sed -i "s/^TOKEN_GUARD_ENABLED=.*/TOKEN_GUARD_ENABLED=off/" .env
    else
        echo "" >> .env
        echo "# Token限制 - 由 fix-session-timeout.sh 添加" >> .env
        echo "TOKEN_GUARD_ENABLED=off" >> .env
    fi
    echo -e "${GREEN}✓${NC} 已关闭TOKEN_GUARD"
else
    # 更新或添加SESSION_TOKEN_LIMIT
    if grep -q "^SESSION_TOKEN_LIMIT=" .env; then
        sed -i "s/^SESSION_TOKEN_LIMIT=.*/SESSION_TOKEN_LIMIT=$SESSION_LIMIT/" .env
    else
        echo "" >> .env
        echo "# Token限制 - 由 fix-session-timeout.sh 添加 ($(date +%Y-%m-%d))" >> .env
        echo "SESSION_TOKEN_LIMIT=$SESSION_LIMIT" >> .env
    fi
    echo -e "${GREEN}✓${NC} 已设置 SESSION_TOKEN_LIMIT=$SESSION_LIMIT"

    # 更新或添加CONTEXT_COMPRESS_TOKEN_LIMIT
    if grep -q "^CONTEXT_COMPRESS_TOKEN_LIMIT=" .env; then
        sed -i "s/^CONTEXT_COMPRESS_TOKEN_LIMIT=.*/CONTEXT_COMPRESS_TOKEN_LIMIT=$COMPRESS_LIMIT/" .env
    else
        echo "CONTEXT_COMPRESS_TOKEN_LIMIT=$COMPRESS_LIMIT" >> .env
    fi
    echo -e "${GREEN}✓${NC} 已设置 CONTEXT_COMPRESS_TOKEN_LIMIT=$COMPRESS_LIMIT"

    # 延长侧袋超时
    if grep -q "^SIDECAR_STRUCTURER_TIMEOUT_MS=" .env; then
        sed -i "s/^SIDECAR_STRUCTURER_TIMEOUT_MS=.*/SIDECAR_STRUCTURER_TIMEOUT_MS=15000/" .env
    else
        echo "SIDECAR_STRUCTURER_TIMEOUT_MS=15000" >> .env
    fi
    echo -e "${GREEN}✓${NC} 已设置 SIDECAR_STRUCTURER_TIMEOUT_MS=15000"
fi

echo ""
echo -e "${GREEN}=========================================="
echo "  配置已成功应用！"
echo "==========================================${NC}"
echo ""
echo "应用场景: $SCENARIO"
echo ""
echo "下一步操作："
echo ""
echo "1. 重启服务使配置生效："
echo "   ${YELLOW}本地开发:${NC}    pnpm dev"
echo "   ${YELLOW}Docker部署:${NC}  cd infra/deploy && docker compose restart"
echo ""
echo "2. 测试验证："
echo "   - 进行长对话测试"
echo "   - 观察是否还有TOKEN_GUARD_TRIPPED错误"
echo ""
echo "3. 监控日志："
echo "   tail -f infra/deploy/_data/logs/error.log"
echo ""
echo "4. 如需回滚配置："
if [ -f "$BACKUP_FILE" ]; then
    echo "   cp $BACKUP_FILE .env"
fi
echo ""
echo "详细文档: docs/troubleshooting/session-timeout-fix.md"
echo ""

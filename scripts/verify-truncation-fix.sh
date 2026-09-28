#!/bin/bash
# 夜阑 - 输出截断修复验证脚本

echo "=========================================="
echo "  修复验证测试"
echo "=========================================="
echo ""

# 检查修复是否已应用
echo "✓ 检查服务端修复..."
if grep -q "headersTimeout = 0" apps/api/src/index.ts; then
    echo "  ✅ 服务端超时配置已应用"
else
    echo "  ❌ 服务端超时配置未找到"
    exit 1
fi

echo ""
echo "✓ 检查前端修复..."
if grep -q "streamStarted" apps/web/src/hooks/useChat.ts; then
    echo "  ✅ 前端延迟保存逻辑已应用"
else
    echo "  ❌ 前端延迟保存逻辑未找到"
    exit 1
fi

if grep -q "wasAborted" apps/web/src/hooks/useChat.ts; then
    echo "  ✅ 前端中止检测逻辑已应用"
else
    echo "  ❌ 前端中止检测逻辑未找到"
    exit 1
fi

echo ""
echo "=========================================="
echo "  修复已成功应用！"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 重启服务:"
echo "   cd infra/deploy && docker compose restart"
echo ""
echo "2. 测试验证:"
echo "   - 发送长对话消息（预计生成 > 60秒）"
echo "   - 观察是否还有截断"
echo "   - 检查浏览器 Console 日志"
echo ""
echo "3. 监控日志:"
echo "   docker compose logs -f api"
echo ""

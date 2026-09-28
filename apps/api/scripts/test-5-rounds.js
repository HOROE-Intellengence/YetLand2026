#!/usr/bin/env node
/**
 * 夜阑 - 5轮对话真实测试
 * 测试修复后的系统是否能正常处理多轮对话，无截断、无重复
 */

const http = require('http');

const API_BASE = 'http://localhost:8787';
const CHARACTER_ID = 'shen-yan-zhi';
const USER_ID = 'test_user_' + Date.now();
const SESSION_ID = 'local_test_session_' + Date.now();

// 测试对话
const TEST_MESSAGES = [
  '你好，沈砚之。今天天气不错。',
  '你最近在忙什么？',
  '能跟我说说你的工作吗？',
  '你觉得设计最重要的是什么？',
  '有空一起出去走走吗？'
];

let round = 0;
let prevStage = 'daily';
const conversationHistory = [];

console.log('========================================');
console.log('  夜阑 - 5轮对话实测');
console.log('========================================');
console.log(`Session ID: ${SESSION_ID}`);
console.log(`User ID: ${USER_ID}`);
console.log('');

function parseSSE(data) {
  const lines = data.split('\n');
  const events = [];

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const json = JSON.parse(line.slice(6));
        events.push(json);
      } catch (e) {
        // ignore parse errors
      }
    }
  }

  return events;
}

function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      characterId: CHARACTER_ID,
      sessionId: SESSION_ID,
      round: round,
      prevStage: prevStage,
      userBoundary: 3,
      text: text,
      history: conversationHistory.slice(-10), // 最近10轮
      recall: {
        preferences: [],
        events: []
      }
    });

    const options = {
      hostname: 'localhost',
      port: 8787,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-user-id': USER_ID
      },
      timeout: 120000 // 120秒超时
    };

    console.log(`\n[Round ${round + 1}] 用户: ${text}`);
    console.log('AI: ', { newline: false });
    process.stdout.write('');

    const req = http.request(options, (res) => {
      let buffer = '';
      let assistantText = '';
      let stage = prevStage;
      let hasError = false;
      let streamStarted = false;

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        // 标记流已开始
        if (!streamStarted) {
          streamStarted = true;
        }

        const events = parseSSE(buffer);

        for (const event of events) {
          if (event.kind === 'chunk') {
            process.stdout.write(event.text || '');
            assistantText += event.text || '';
          } else if (event.kind === 'meta') {
            stage = event.stage || stage;
          } else if (event.kind === 'error') {
            hasError = true;
            console.error(`\n❌ 错误: ${event.message}`);
          } else if (event.kind === 'done') {
            console.log('');
          }
        }

        // 清空已处理的buffer
        const lastNewline = buffer.lastIndexOf('\n\n');
        if (lastNewline !== -1) {
          buffer = buffer.slice(lastNewline + 2);
        }
      });

      res.on('end', () => {
        if (!streamStarted) {
          console.error('\n❌ 流未开始，请求可能失败');
          reject(new Error('Stream did not start'));
          return;
        }

        if (hasError) {
          reject(new Error('Stream error occurred'));
          return;
        }

        if (!assistantText.trim()) {
          console.error('\n⚠️  警告: AI回复为空');
        }

        // 更新对话历史
        conversationHistory.push(
          { role: 'user', content: text },
          { role: 'assistant', content: assistantText }
        );

        prevStage = stage;
        round++;

        resolve({
          text: assistantText,
          stage: stage,
          length: assistantText.length,
          streamStarted: streamStarted
        });
      });
    });

    req.on('error', (e) => {
      console.error(`\n❌ 请求错误: ${e.message}`);
      reject(e);
    });

    req.on('timeout', () => {
      console.error('\n❌ 请求超时（120秒）');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(payload);
    req.end();
  });
}

async function runTest() {
  const results = [];
  let totalLength = 0;
  let hasErrors = false;

  try {
    for (let i = 0; i < TEST_MESSAGES.length; i++) {
      const message = TEST_MESSAGES[i];

      try {
        const result = await sendMessage(message);
        results.push(result);
        totalLength += result.length;

        // 检查是否有截断（非常短的回复可能是截断）
        if (result.length < 20) {
          console.log(`⚠️  警告: 回复过短 (${result.length}字)，可能被截断`);
        }

        // 短暂延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`\n❌ Round ${i + 1} 失败: ${error.message}`);
        hasErrors = true;
        break;
      }
    }

    // 测试总结
    console.log('\n========================================');
    console.log('  测试总结');
    console.log('========================================');
    console.log(`总轮数: ${results.length}/${TEST_MESSAGES.length}`);
    console.log(`平均回复长度: ${Math.round(totalLength / results.length)} 字`);
    console.log(`对话历史条目: ${conversationHistory.length}`);
    console.log('');

    // 检查对话历史完整性
    console.log('对话历史检查:');
    if (conversationHistory.length === results.length * 2) {
      console.log('✅ 对话历史完整（每轮都有 user + assistant）');
    } else {
      console.log(`❌ 对话历史不完整 (期望 ${results.length * 2} 条，实际 ${conversationHistory.length} 条)`);
      hasErrors = true;
    }

    // 检查是否有重复消息
    const userMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.content);
    const uniqueUserMessages = new Set(userMessages);
    if (userMessages.length === uniqueUserMessages.size) {
      console.log('✅ 无重复的用户消息');
    } else {
      console.log(`❌ 发现重复消息 (${userMessages.length - uniqueUserMessages.size} 条)`);
      hasErrors = true;
    }

    // 检查是否有截断
    const shortReplies = results.filter(r => r.length < 30);
    if (shortReplies.length === 0) {
      console.log('✅ 无明显截断（所有回复 > 30字）');
    } else {
      console.log(`⚠️  有 ${shortReplies.length} 条可能被截断的回复`);
    }

    // 检查流是否正常启动
    const allStarted = results.every(r => r.streamStarted);
    if (allStarted) {
      console.log('✅ 所有请求的流都成功启动');
    } else {
      console.log('❌ 有请求的流未成功启动');
      hasErrors = true;
    }

    console.log('');
    if (hasErrors) {
      console.log('❌ 测试失败 - 发现问题');
      process.exit(1);
    } else {
      console.log('✅ 测试通过 - 5轮对话正常');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ 测试异常:', error);
    process.exit(1);
  }
}

// 先检查服务是否可用
http.get('http://localhost:8787/health', (res) => {
  if (res.statusCode === 200) {
    console.log('✅ 服务健康检查通过\n');
    runTest();
  } else {
    console.error('❌ 服务健康检查失败');
    process.exit(1);
  }
}).on('error', (e) => {
  console.error('❌ 无法连接到服务:', e.message);
  console.log('\n提示: 服务可能在容器内，端口未暴露到宿主机');
  console.log('      需要在容器内部运行测试，或通过 Caddy 代理访问');
  process.exit(1);
});

import { memoryDb } from '../memory/db';

const CHAT_SESSION_PREFIX = 'yelan.chatSession.';
const MEMORY_SINCE_KEY = 'yelan.memory.since';

interface ClearLocalUserDataOptions {
  /** 登录到目标用户时保留该用户自己的新版本地会话，其它账号/旧格式会话全部清掉。 */
  keepChatUserId?: string;
}

/**
 * 清理当前浏览器的所有用户本地数据（对话、记忆、同步游标）。
 * 在所有身份切换入口调用：登出、换号登录、删号、撤销全部会话。
 */
export async function clearLocalUserData(options: ClearLocalUserDataOptions = {}): Promise<void> {
  // 1. 清理 yelan.chatSession.* 键；换号登录时可保留目标用户自己的新版 key。
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CHAT_SESSION_PREFIX)) continue;
      if (options.keepChatUserId && key.startsWith(`${CHAT_SESSION_PREFIX}${options.keepChatUserId}.`)) {
        continue;
      }
      keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* noop */
  }

  // 2. 清理 yelan.memory.since 同步游标
  try {
    localStorage.removeItem(MEMORY_SINCE_KEY);
  } catch {
    /* noop */
  }

  // 3. 清理 Dexie 记忆库
  try {
    await memoryDb.preferences.clear();
    await memoryDb.events.clear();
  } catch {
    /* noop */
  }
}

import { Hono } from 'hono';
import { PhoneChatLogsQuerySchema } from '@yelan/shared';
import { requireAdmin } from '../../middleware/auth';
import { phoneChatLogs, type PhoneChatLogs } from '../../phone/chat-logs';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';

export function createAdminPhoneChatLogsRoute(getLogs: () => PhoneChatLogs = phoneChatLogs) {
  const app = new Hono();
  app.use('*', requireAdmin());
  app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  function names<T extends { userId: string; characterId: string }>(row: T) {
    const user = store.state().users[row.userId];
    return { ...row, userName: user?.nickname?.trim() || user?.name?.trim() || (user ? '未命名用户' : '未知用户'),
      characterName: charactersService.get(row.characterId)?.name || row.characterId };
  }
  app.get('/', c => {
    const parsed = PhoneChatLogsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ code: 'INVALID_FILTER', message: '筛选条件无效' }, 400);
    const { page, userId, ...filters } = parsed.data;
    const userSearch = filters.user?.toLocaleLowerCase(), characterSearch = filters.character?.toLocaleLowerCase();
    const matchingUserIds = userSearch ? Object.values(store.state().users)
      .filter(user => [user.nickname, user.name].some(name => name?.toLocaleLowerCase().includes(userSearch)))
      .map(user => user.id) : [];
    const matchingCharacterIds = characterSearch ? charactersService.listAll()
      .filter(character => character.name.toLocaleLowerCase().includes(characterSearch)).map(character => character.id) : [];
    const result = getLogs().list(page, userId, { ...filters, matchingUserIds, matchingCharacterIds });
    return c.json({ ...result, items: result.items.map(names) });
  });
  app.get('/:id', c => {
    const row = getLogs().get(c.req.param('id'));
    return row ? c.json(names(row)) : c.json({ code: 'NOT_FOUND' }, 404);
  });
  app.get('/:id/thread', c => {
    const page=Number(c.req.query('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)return c.json({code:'INVALID_FILTER'},400);
    const thread=getLogs().thread(c.req.param('id'),page);
    return thread?c.json({...thread,items:thread.items.map(names)}):c.json({code:'NOT_FOUND'},404);
  });
  return app;
}
export const adminPhoneChatLogsRoute = createAdminPhoneChatLogsRoute();

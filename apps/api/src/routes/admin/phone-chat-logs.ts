import {Hono} from 'hono';
import {requireAdmin} from '../../middleware/auth';
import {phoneChatLogs} from '../../phone/chat-logs';
export const adminPhoneChatLogsRoute=new Hono();
adminPhoneChatLogsRoute.use('*',requireAdmin());
adminPhoneChatLogsRoute.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
adminPhoneChatLogsRoute.get('/',c=>{
  const page=Number(c.req.query('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)return c.json({code:'INVALID_PAGE'},400);
  return c.json(phoneChatLogs().list(page,c.req.query('userId')||undefined));
});
adminPhoneChatLogsRoute.get('/:id',c=>{const row=phoneChatLogs().get(c.req.param('id'));return row?c.json(row):c.json({code:'NOT_FOUND'},404);});

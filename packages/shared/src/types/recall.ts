// 前端从本地记忆库召回后，传给 server 注入 system prompt 的载荷
export interface RecallPayload {
  preferences: string[];
  events: { date: string; text: string; emotion?: string }[];
}

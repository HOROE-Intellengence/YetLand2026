// 仓储缝 barrel —— 业务层从这里取 repo，不直接 import 具体文件。
// Phase A 逐步把 17 个 repo 接进来，详见 docs/sprint/phase-a-repository-seam.md。
export { conversationLogRepo, type AppendConversationLogInput } from './conversation-log.repo';
export { adminAuditRepo, type AppendAuditInput, type QueryAuditInput } from './admin-audit.repo';
export { achievementRepo, type AchievementUnlockRow } from './achievement.repo';
export { uiPreferenceRepo, type UiPreferencePatch } from './ui-preference.repo';
export { surveyRepo, type SurveySubmissionRow } from './survey.repo';

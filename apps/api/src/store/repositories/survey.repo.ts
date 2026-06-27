// 问卷仓储 —— 定义 CRUD + 提交追加/查询。
// 缝约定见 docs/sprint/phase-a-repository-seam.md。
// 注：admin 端「提交带 userName」的用户名富集仍直接读 users（属 userRepo/hub，
// 待 hub 批次再收口），本仓储只负责 surveys 集合本身。
import { store, type SurveyDefinitionRow } from '../persistence';

export interface SurveySubmissionRow {
  userId: string;
  surveyId: string;
  rewarded: number;
  ts: string;
  answers?: { questionId: string; answer: unknown; dwellMs: number }[];
  source?: string;
}

export const surveyRepo = {
  // —— 定义 ——
  async listDefinitions(): Promise<SurveyDefinitionRow[]> {
    return Object.values(store.state().surveys.definitions);
  },

  async getDefinition(id: string): Promise<SurveyDefinitionRow | undefined> {
    return store.state().surveys.definitions[id];
  },

  /** 第一个 status==='active' 的定义；无则 null。 */
  async findActiveDefinition(): Promise<SurveyDefinitionRow | null> {
    return Object.values(store.state().surveys.definitions).find((s) => s.status === 'active') ?? null;
  },

  /** upsert 一条定义并落库。 */
  async setDefinition(row: SurveyDefinitionRow): Promise<SurveyDefinitionRow> {
    store.state().surveys.definitions[row.id] = row;
    store.save();
    return row;
  },

  /** 删除定义；返回删除前是否存在（不存在不落库）。 */
  async deleteDefinition(id: string): Promise<boolean> {
    const defs = store.state().surveys.definitions;
    if (!defs[id]) return false;
    delete defs[id];
    store.save();
    return true;
  },

  // —— 提交 ——
  async listSubmissions(): Promise<SurveySubmissionRow[]> {
    return store.state().surveys.submissions;
  },

  async listSubmissionsBySurvey(surveyId: string): Promise<SurveySubmissionRow[]> {
    return store.state().surveys.submissions.filter((s) => s.surveyId === surveyId);
  },

  async findSubmission(userId: string, surveyId: string): Promise<SurveySubmissionRow | undefined> {
    return store.state().surveys.submissions.find((s) => s.userId === userId && s.surveyId === surveyId);
  },

  async addSubmission(row: SurveySubmissionRow): Promise<SurveySubmissionRow> {
    store.state().surveys.submissions.push(row);
    store.save();
    return row;
  },
};

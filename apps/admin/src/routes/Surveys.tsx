import { useEffect, useState } from 'react';
import { FileText, Plus, Circle } from 'lucide-react';
import { api, getAuthHeaders, getBase } from '../api/client';
import { useToast } from '../components/Toast';
import { useUserNameMap } from '../hooks/useUserNameMap';

type QuestionType = 'single' | 'multi' | 'text' | 'scale';

interface SurveyQuestion {
  id: string;
  type: QuestionType;
  title: string;
  minSeconds: number;
  options?: { value: string; label: string }[];
}

interface SurveyRow {
  id: string;
  title: string;
  rewardCandle: number;
  status: 'active' | 'inactive';
  questions: SurveyQuestion[];
  updatedAt?: string;
}

interface SurveySubmission {
  userId: string;
  userName?: string | null;
  surveyId: string;
  rewarded: number;
  ts: string;
  source?: string;
  answers?: { questionId: string; answer: unknown; dwellMs: number }[];
}

function renderAnswers(row: SurveySubmission): string {
  if (!row.answers?.length) return '';
  return row.answers.map((answer) => {
    const raw = answer.answer;
    const value = typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'text' in raw
        ? String((raw as { text?: unknown }).text ?? '')
        : JSON.stringify(raw);
    return `${answer.questionId}: ${value}`;
  }).join('\n');
}

function renderUser(row: SurveySubmission, names: Record<string, string>): string {
  const name = row.userName || names[row.userId];
  return name ? `${name}\n${row.userId}` : row.userId;
}

export function Surveys() {
  const { success, error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [submissions, setSubmissions] = useState<SurveySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<SurveyRow | null>(null);
  const [form, setForm] = useState({
    id: '',
    title: '',
    rewardCandle: 30,
    status: 'inactive' as 'active' | 'inactive',
    questionTitle: '',
    questionType: 'text' as QuestionType,
    optionsText: '',
    minSeconds: 5,
    reason: '',
  });

  const load = async () => {
    try {
      const data = await api.get<{ surveys: SurveyRow[]; submissions: SurveySubmission[] }>('/api/admin/surveys');
      setSurveys(data.surveys);
      setSubmissions(data.submissions);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载问卷失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(row: SurveyRow) {
    setEditing(row);
    setForm({
      id: row.id,
      title: row.title,
      rewardCandle: row.rewardCandle,
      status: row.status,
      questionTitle: row.questions[0]?.title ?? row.title,
      questionType: row.questions[0]?.type ?? 'text',
      optionsText: row.questions[0]?.options?.map((o) => `${o.value}:${o.label}`).join('\n') ?? '',
      minSeconds: row.questions[0]?.minSeconds ?? 5,
      reason: '',
    });
  }

  function resetForm() {
    setEditing(null);
    setForm({ id: '', title: '', rewardCandle: 30, status: 'inactive', questionTitle: '', questionType: 'text', optionsText: '', minSeconds: 5, reason: '' });
  }

  async function saveSurvey(e: React.FormEvent) {
    e.preventDefault();
    const options = form.optionsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const parts = line.split(':');
        const value = parts.shift()?.trim() || String(index + 1);
        const label = (parts.join(':') || value).trim();
        return { value, label };
      });
    const body = {
      ...(!editing && form.id ? { id: form.id } : {}),
      title: form.title,
      rewardCandle: Number(form.rewardCandle),
      status: form.status,
      questions: [{
        id: 'q1',
        type: form.questionType,
        title: form.questionTitle || form.title,
        ...(['single', 'multi'].includes(form.questionType) && options.length ? { options } : {}),
        minSeconds: Number(form.minSeconds),
      }],
      reason: form.reason,
    };
    try {
      if (editing) await api.patch(`/api/admin/surveys/${encodeURIComponent(editing.id)}`, body);
      else await api.post('/api/admin/surveys', body);
      success(editing ? '问卷已保存' : '问卷已创建');
      resetForm();
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function toggleSurvey(row: SurveyRow) {
    try {
      await api.post(`/api/admin/surveys/${encodeURIComponent(row.id)}/toggle`, { reason: 'admin toggle' });
      success(row.status === 'active' ? '问卷已下线' : '问卷已上线');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function deleteSurvey(row: SurveyRow) {
    if (!window.confirm(`删除问卷 ${row.id}？`)) return;
    try {
      await api.delete(`/api/admin/surveys/${encodeURIComponent(row.id)}?reason=${encodeURIComponent('admin delete')}`);
      success('问卷已删除');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function exportSurvey(row: SurveyRow) {
    try {
      const text = await fetch(`${getBase()}/api/admin/surveys/${encodeURIComponent(row.id)}/export`, {
        headers: getAuthHeaders(),
      }).then((r) => r.text());
      const blob = new Blob([text], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `survey-${row.id}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  if (loading) return <div className="state-placeholder"><FileText size={32} /><span>加载问卷...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <h2>问卷</h2>
      <div className="card">
        <h3>{editing ? `编辑 ${editing.id}` : '新建问卷'}</h3>
        <form onSubmit={saveSurvey} className="metrics" style={{ alignItems: 'end', marginBottom: 0 }}>
          {!editing && (
            <div className="field">
              <label>ID</label>
              <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="可留空自动生成" />
            </div>
          )}
          <div className="field">
            <label>标题</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="field">
            <label>奖励烛</label>
            <input type="number" min={0} value={form.rewardCandle} onChange={(e) => setForm({ ...form, rewardCandle: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
              <option value="inactive">inactive</option>
              <option value="active">active</option>
            </select>
          </div>
          <div className="field">
            <label>题型</label>
            <select value={form.questionType} onChange={(e) => setForm({ ...form, questionType: e.target.value as QuestionType })}>
              <option value="text">text</option>
              <option value="single">single</option>
              <option value="multi">multi</option>
              <option value="scale">scale</option>
            </select>
          </div>
          <div className="field">
            <label>题目</label>
            <input value={form.questionTitle} onChange={(e) => setForm({ ...form, questionTitle: e.target.value })} placeholder="默认使用问卷标题" />
          </div>
          {['single', 'multi'].includes(form.questionType) && (
            <div className="field">
              <label>选项，每行 value:label</label>
              <textarea value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} placeholder={'a:选项 A\nb:选项 B'} />
            </div>
          )}
          <div className="field">
            <label>最短停留秒数</label>
            <input type="number" min={0} value={form.minSeconds} onChange={(e) => setForm({ ...form, minSeconds: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit"><Plus size={14} />{editing ? '保存' : '创建'}</button>
          {editing && <button className="btn" type="button" onClick={resetForm}>取消</button>}
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>ID</th><th>标题</th><th>奖励</th><th>题数</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {surveys.map((row) => (
              <tr key={row.id}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.id}</td>
                <td>{row.title}</td>
                <td>{row.rewardCandle}</td>
                <td>{row.questions.length}</td>
                <td><span className={`badge ${row.status === 'active' ? 'badge-ok' : 'badge-danger'}`}>{row.status}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => startEdit(row)}>编辑</button>
                  <button className="btn btn-sm" onClick={() => toggleSurvey(row)} style={{ marginLeft: 8 }}>{row.status === 'active' ? '下线' : '上线'}</button>
                  <button className="btn btn-sm" onClick={() => exportSurvey(row)} style={{ marginLeft: 8 }}>导出</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteSurvey(row)} style={{ marginLeft: 8 }}>删除</button>
                </td>
              </tr>
            ))}
            {surveys.length === 0 && <tr><td colSpan={6}>暂无自定义问卷，前台仍使用内置 srv_1。</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>用户</th><th>问卷</th><th>奖励</th><th>答案</th><th>时间</th></tr></thead>
          <tbody>
            {submissions.slice(-50).reverse().map((row) => (
              <tr key={`${row.userId}-${row.surveyId}-${row.ts}`}>
                <td style={{ whiteSpace: 'pre-wrap', fontFamily: (row.userName || userNames[row.userId]) ? undefined : 'var(--font-mono)' }}>{renderUser(row, userNames)}</td>
                <td>{row.surveyId}</td>
                <td>{row.rewarded}</td>
                <td style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>{renderAnswers(row) || '-'}</td>
                <td>{row.ts}</td>
              </tr>
            ))}
            {submissions.length === 0 && <tr><td colSpan={5}>暂无提交</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 一问 — 问卷面板 + 反馈入口
// 反馈优先走 POST /api/events type:user_feedback
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackNow } from '../../../api/events';
import { getActiveSurvey, submitFeedback, submitSurvey } from '../../../api/surveys';
import { useSessionStore } from '../../../stores/sessionStore';
import s from './panel.module.css';

type AnswerMap = Record<string, unknown>;

export function SurveyPanel() {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [openedAt, setOpenedAt] = useState<Record<string, number>>({});
  const [submittedReward, setSubmittedReward] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const character = useSessionStore((state) => state.character);
  const queryClient = useQueryClient();
  const surveyQuery = useQuery({ queryKey: ['survey', 'active'], queryFn: getActiveSurvey });
  const survey = surveyQuery.data;

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!survey) return Promise.resolve({ rewarded: 0 });
      return submitSurvey(survey.id, {
        answers: survey.questions.map((question) => ({
          questionId: question.id,
          answer: answers[question.id],
          dwellMs: Date.now() - (openedAt[question.id] ?? Date.now()),
        })),
      });
    },
    onSuccess: async (result) => {
      setSubmittedReward(result.rewarded);
      setAnswers({});
      await queryClient.invalidateQueries({ queryKey: ['survey', 'active'] });
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!survey) return;
    const startedAt = Date.now();
    setOpenedAt(Object.fromEntries(survey.questions.map((question) => [question.id, startedAt])));
    setAnswers({});
    setSubmittedReward(null);
  }, [survey?.id, survey]);

  const canSubmitSurvey = useMemo(() => {
    if (!survey) return false;
    return survey.questions.every((question) => {
      const answer = answers[question.id];
      const dwellReady = now - (openedAt[question.id] ?? now) >= question.minSeconds * 1000;
      if (!dwellReady) return false;
      if (question.type === 'text') return typeof answer === 'string' && answer.trim().length > 0;
      if (question.type === 'multi') return Array.isArray(answer) && answer.length > 0;
      return answer !== undefined && answer !== null && answer !== '';
    });
  }, [answers, now, openedAt, survey]);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setFeedbackError(null);
    setSending(true);
    try {
      await submitFeedback({
        text: trimmed,
        characterId: character?.id,
        source: 'survey-panel',
      });
      try {
        await trackNow({
          name: 'user_feedback',
          ts: Date.now(),
          payload: {
            text: trimmed,
            characterId: character?.id,
            mode: 'main',
            source: 'survey',
          },
        });
      } catch {
        // 反馈已入库；埋点队列会在下次 flush 时重试。
      }
      setSent(true);
      setText('');
    } catch (error) {
      setFeedbackError((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const setAnswer = (questionId: string, answer: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  return (
    <div className={s.panel}>
      <h2 className={s.title}>一问</h2>
      <p className={s.dim}>你的每一条反馈，都在让夜阑变得更好。</p>

      {surveyQuery.isLoading ? (
        <div className={s.placeholder}><p>正在取今晚的问题...</p></div>
      ) : surveyQuery.isError ? (
        <div className={s.placeholder}><p>问卷暂时取不到。</p></div>
      ) : survey ? (
        <div className={s.section}>
          <div className={s.itemHeader}>
            <div>
              <h3 className={s.itemName}>{survey.title}</h3>
              <p className={s.rowMeta}>完成后点亮 {survey.rewardCandle} 烛</p>
            </div>
            <span className={s.badge}>进行中</span>
          </div>

          {survey.questions.map((question, index) => {
            const answer = answers[question.id];
            const elapsed = now - (openedAt[question.id] ?? now);
            const waitSeconds = Math.max(0, question.minSeconds - Math.floor(elapsed / 1000));
            const selected = Array.isArray(answer) ? answer : [];

            return (
              <fieldset className={s.question} key={question.id}>
                <legend className={s.questionTitle}>{index + 1}. {question.title}</legend>

                {question.type === 'text' && (
                  <textarea
                    className={s.textarea}
                    onChange={(event) => setAnswer(question.id, event.target.value)}
                    rows={3}
                    value={typeof answer === 'string' ? answer : ''}
                  />
                )}

                {question.type === 'single' && question.options?.map((option) => (
                  <label className={s.optionRow} key={option.value}>
                    <input
                      checked={answer === option.value}
                      name={question.id}
                      onChange={() => setAnswer(question.id, option.value)}
                      type="radio"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}

                {question.type === 'multi' && question.options?.map((option) => (
                  <label className={s.optionRow} key={option.value}>
                    <input
                      checked={selected.includes(option.value)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selected, option.value]
                          : selected.filter((value) => value !== option.value);
                        setAnswer(question.id, next);
                      }}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}

                {question.type === 'scale' && (
                  <div className={s.scaleRow}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        className={`${s.scaleBtn} ${answer === value ? s.scaleBtnActive : ''}`}
                        key={value}
                        onClick={() => setAnswer(question.id, value)}
                        type="button"
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}

                {waitSeconds > 0 && <p className={s.mute}>还需停留 {waitSeconds} 秒</p>}
              </fieldset>
            );
          })}

          {submitMutation.isError && <p className={s.error}>{(submitMutation.error as Error).message}</p>}
          {submittedReward !== null && (
            <p className={s.success}>已提交，获得 {submittedReward} 烛。</p>
          )}

          <button
            className={s.submitBtn}
            disabled={!canSubmitSurvey || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
            type="button"
          >
            {submitMutation.isPending ? '提交中...' : '提交问卷'}
          </button>
        </div>
      ) : submittedReward !== null ? (
        <div className={s.placeholder}><p>已提交，获得 {submittedReward} 烛。</p></div>
      ) : (
        <div className={s.placeholder}><p>今晚暂无问卷。</p></div>
      )}

      <p className={s.mute}>
        有什么想说的，可以直接写在这里：
      </p>

      <textarea
        className={s.textarea}
        placeholder="写下你的感受或建议..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      {sent && <p className={s.success}>已收到你的反馈，谢谢。</p>}
      {feedbackError && <p className={s.error}>{feedbackError}</p>}

      <button
        className={s.submitBtn}
        onClick={handleSubmit}
        disabled={sending || !text.trim()}
      >
        {sending ? '发送中...' : '提交反馈'}
      </button>
    </div>
  );
}

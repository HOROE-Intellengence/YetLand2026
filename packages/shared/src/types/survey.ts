export type SurveyQuestionType = 'single' | 'multi' | 'text' | 'scale';

export interface SurveyQuestionOption {
  value: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  options?: SurveyQuestionOption[];
  minSeconds: number;
}

export interface Survey {
  id: string;
  title: string;
  rewardCandle: number;
  status: 'active' | 'inactive';
  questions: SurveyQuestion[];
}

export interface SurveyAnswer {
  questionId: string;
  answer: unknown;
  dwellMs: number;
}

export interface SurveySubmission {
  answers: SurveyAnswer[];
}

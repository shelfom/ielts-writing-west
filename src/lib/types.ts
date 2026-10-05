import type { CoachingCorrection } from './coaching-types';
import type { ExaminerStage } from './examiner-validation';
export type TaskType = 'academic1' | 'general1' | 'task2';

export interface ContentPart {
  type: 'text' | 'image_url' | 'video_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface Paragraph {
  id: string;
  text: string;
}

export interface CriterionScore {
  score: number;
  labelZh: string;
  labelEn: string;
}

export interface Assessment {
  scores: {
    ta_tr: CriterionScore;
    cc: CriterionScore;
    lr: CriterionScore;
    gra: CriterionScore;
  };
  overall: number;
  diagnosisZh: string;
  diagnosisEn: string;
  provider_model: string;
  duration_ms: number;
}

export interface CorrectionReason {
  criterion: string;
  quote: string;
  explanationZh: string;
  explanationEn: string;
}

export interface CorrectedParagraph {
  paragraphId: string;
  correctedText: string;
  reasons: CorrectionReason[];
}

export interface Correction {
  paragraphs: CorrectedParagraph[];
  provider_model: string;
  duration_ms: number;
}

export interface PlaybackEvent {
  paragraphId: string;
  type: 'highlight' | 'strikethrough' | 'replace' | 'complete';
  order: number;
}

export interface SubmissionData {
  id: string;
  task_type: TaskType;
  task_image_url?: string | null;
  prompt_text: string;
  original_text: string;
  paragraphs: Paragraph[];
  assessment: Assessment | null;
  correction: Correction | { stages: ExaminerStage[] } | CoachingCorrection | null;
  playback: { events: PlaybackEvent[] } | null;
  stage: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadRecord {
  id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  role: string;
  size_bytes: number;
}

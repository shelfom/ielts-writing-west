import type { Assessment, Paragraph } from './types';
import type { Criterion, ExaminerStage } from './examiner-validation';
export type { Criterion, ExaminerStage } from './examiner-validation';

export type GateEvidence = { paragraphId: string; quote: string };
export type GateCheck = {
  id: string; passed: boolean; evidence: GateEvidence[];
  reasonZh: string; reasonEn: string; actionZh: string; actionEn: string;
};
export type GateReview = {
  id: string; revision: number; criterion: Criterion; passed: boolean; checks: GateCheck[];
  summaryZh: string; summaryEn: string; createdAt: string; duration_ms: number; provider_model: string;
  /** Immutable snapshot of the exact draft this verdict reviewed. */
  draftText: string; inputParagraphs: Paragraph[];
};
export type CoachingRound = {
  criterion: Criterion; reviews: GateReview[]; inputParagraphs?: Paragraph[]; correction?: ExaminerStage;
};
export type DraftRevision = { revision: number; text: string; paragraphs: Paragraph[]; source: 'original' | 'student' | Criterion; createdAt: string };
export type CoachingState = {
  version: 1; targetBand: 7 | 8 | 9; revision: number; currentCriterion: Criterion;
  phase: 'needs_review' | 'rewrite_required' | 'ready_to_correct' | 'stage_complete' | 'completed' | 'practice_paused';
  draftText: string; paragraphs: Paragraph[]; rounds: CoachingRound[]; history: DraftRevision[];
  correctionHistory?: { criterion: Criterion; revision: number; inputParagraphs: Paragraph[]; correction: ExaminerStage }[];
  final?: {
    modelText: string; assessment: Assessment; targetMet: boolean; refinementCount?: number; noteZh: string; noteEn: string;
    provider_model: string; duration_ms: number;
  };
};
export type CoachingCorrection = { stages: ExaminerStage[]; coaching: CoachingState };
export type CoachingAction =
  | { action: 'review' | 'correct' | 'advance' | 'finalise'; revision: number }
  | { action: 'rewrite'; revision: number; text: string };

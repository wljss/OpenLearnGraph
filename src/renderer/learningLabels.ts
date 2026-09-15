import type { NodeStatus, SelfAssessmentRating } from '../shared/contracts';

export const STATUS_LABELS: Record<NodeStatus, string> = {
  LOCKED: '已锁定',
  AVAILABLE: '可学习',
  LEARNING: '学习中',
  MASTERED: '已掌握',
  REVIEW_DUE: '待复习',
};

export const SELF_ASSESSMENT_RATING_LABELS: Record<SelfAssessmentRating, string> = {
  1: '完全陌生',
  2: '了解一点',
  3: '能跟着完成',
  4: '能独立完成',
  5: '能解释并应用',
};

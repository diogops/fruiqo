import type { CandidateDecision, PipelineStep, Recommendation, Share } from '@fruiqo/contracts';
import type { RecommendationRow, ShareRow, candidateDecisions, pipelineStepLogs } from '../db/schema.js';

export function toShare(row: ShareRow, recs: RecommendationRow[]): Share {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: {
      platform: row.platform,
      origin: row.origin,
      ...(row.pageCount != null ? { pageCount: row.pageCount } : {}),
      ...(row.sourceUrl ? { url: row.sourceUrl } : {}),
      ...(row.sourceTitle ? { title: row.sourceTitle } : {}),
      ...(row.sourceAuthor ? { author: row.sourceAuthor } : {}),
      ...(row.sourceThumbnailUrl ? { thumbnailUrl: row.sourceThumbnailUrl } : {}),
    },
    ...(row.error ? { error: row.error } : {}),
    recommendations: recs.map(toRecommendation),
    dedup: { pagesIgnored: row.pagesIgnored, itemsAlreadyInList: row.itemsAlreadyInList },
  };
}

function toRecommendation(r: RecommendationRow): Recommendation {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    ...(r.creator ? { creator: r.creator } : {}),
    ...(r.year != null ? { year: r.year } : {}),
    confidence: r.confidence,
    extractor: r.extractor,
    ...(r.resolution ? { resolution: r.resolution } : {}),
    decision: r.decision,
    ...(r.suggestedDecision ? { suggestedDecision: r.suggestedDecision } : {}),
    ...(r.matchScore != null ? { matchScore: r.matchScore } : {}),
  };
}

export function toStep(s: typeof pipelineStepLogs.$inferSelect): PipelineStep {
  return {
    seq: s.seq,
    step: s.step as PipelineStep['step'],
    mode: s.mode,
    startedAt: s.startedAt.toISOString(),
    durationMs: s.durationMs,
    inputSummary: s.inputSummary,
    outputSummary: s.outputSummary,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    costEstimateUsd: s.costEstimateUsd,
    ...(s.error ? { error: s.error } : {}),
  };
}

export function toDecision(d: typeof candidateDecisions.$inferSelect): CandidateDecision {
  return {
    rawTitle: d.rawTitle,
    kind: d.kind,
    confidenceScore: d.confidenceScore,
    decision: d.decision,
    reason: d.reason,
    ...(d.recommendationId ? { recommendationId: d.recommendationId } : {}),
  };
}

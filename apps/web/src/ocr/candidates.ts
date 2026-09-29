// Heurísticas de candidatos a título: compartilhadas com o app, em
// packages/contracts/src/import-candidates.ts (este módulo só reexporta).
export {
  UNCERTAIN_BELOW,
  candidateKey,
  extractCandidates,
  isGarbled,
  isUiNoise,
  newCandidateId,
  normalizeSpaces,
  repeatedPrefixes,
  stripListMarker,
  stripWatchSuffix,
  type Candidate,
  type CandidateKind,
} from '@fruiqo/contracts';

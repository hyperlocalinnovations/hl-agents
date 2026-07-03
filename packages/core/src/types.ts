export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  file: string;
  line?: number;
  endLine?: number;
  severity: Severity;
  rule?: string;
  message: string;
  raw?: unknown;
}

export interface FixPlan {
  findings: Finding[];
  description: string;
  files: string[];
}

export interface ReviewResult {
  findings: Finding[];
  rawOutput: string;
}

export interface DroppedFinding {
  finding: Finding;
  reason: string;
}

export interface ValidationOutcome {
  valid: Finding[];
  dropped: DroppedFinding[];
}

export interface ApplyResult {
  filesChanged: string[];
}

export interface CommitResult {
  sha: string;
  message: string;
}

export interface IterationResult {
  iteration: number;
  findings: Finding[];
  valid: Finding[];
  dropped: DroppedFinding[];
  plans: FixPlan[];
  commit?: CommitResult;
}

export interface LoopResult {
  iterations: IterationResult[];
  cleanPass: boolean;
  stoppedReason: 'clean' | 'no-valid' | 'max-iterations' | 'stuck' | 'dry-run';
  summary: {
    totalFindings: number;
    totalValid: number;
    totalDropped: number;
    totalCommits: number;
    stuckFindings: StuckFinding[];
  };
}

export interface StuckFinding {
  finding: Finding;
  attempts: number;
}
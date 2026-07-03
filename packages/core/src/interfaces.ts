import type {
  Finding,
  FixPlan,
  ReviewResult,
  ValidationOutcome,
  ApplyResult,
  CommitResult,
} from './types.js';

export interface ReviewAdapter {
  run(): Promise<ReviewResult>;
}

export interface Validator {
  validate(findings: Finding[]): Promise<ValidationOutcome>;
}

export interface FixPlanner {
  plan(valid: Finding[]): Promise<FixPlan[]>;
}

export interface FixApplier {
  apply(plan: FixPlan): Promise<ApplyResult>;
}

export interface Committer {
  commit(plans: FixPlan[], filesChanged: string[]): Promise<CommitResult>;
}

export interface Logger {
  info?(msg: string): void;
  warn?(msg: string): void;
  error?(msg: string): void;
  debug?(msg: string): void;
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
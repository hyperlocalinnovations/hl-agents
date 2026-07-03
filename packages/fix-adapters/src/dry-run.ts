import type { ApplyResult, Finding, FixPlan } from '@hl-agents/core';
import type { FixApplier, FixPlanner } from '@hl-agents/core';

export class DryRunApplier implements FixApplier {
  async apply(plan: FixPlan): Promise<ApplyResult> {
    return { filesChanged: plan.files };
  }
}

export class DryRunPlanner implements FixPlanner {
  async plan(valid: Finding[]): Promise<FixPlan[]> {
    return [
      {
        findings: valid,
        description: `[dry-run] would plan fixes for ${valid.length} findings`,
        files: [...new Set(valid.map((f) => f.file))],
      },
    ];
  }
}
export type ProfileName = 'claude-large' | 'generic-large' | 'generic-medium';

export const PROFILES: Record<ProfileName, { tokenBudget: number }> = {
  'claude-large': { tokenBudget: 150_000 },
  'generic-large': { tokenBudget: 100_000 },
  'generic-medium': { tokenBudget: 30_000 },
};

// Resolution order: CLI flag, then .aidiff.json, then the built-in default.
export function resolveProfile(flag: string | undefined, configProfile?: string): ProfileName {
  const name = flag ?? configProfile ?? 'generic-medium';
  if (!(name in PROFILES)) {
    throw new Error(
      `Unknown profile "${name}". Valid profiles: ${Object.keys(PROFILES).join(', ')}`,
    );
  }
  return name as ProfileName;
}

export type BudgetSettings = {
  cliBudget?: number;
  cliProfile?: string;
  configBudget?: number;
  configProfile?: string;
};

// A raw token budget beats a profile at the same level, and CLI flags beat
// config: --budget, --profile, config budget, config profile, default.
export function resolveBudget(s: BudgetSettings): { budget: number; label: string } {
  if (s.cliBudget !== undefined) return { budget: s.cliBudget, label: `${s.cliBudget}-token` };
  if (s.cliProfile !== undefined) {
    const profile = resolveProfile(s.cliProfile);
    return { budget: PROFILES[profile].tokenBudget, label: profile };
  }
  if (s.configBudget !== undefined) {
    return { budget: s.configBudget, label: `${s.configBudget}-token` };
  }
  const profile = resolveProfile(undefined, s.configProfile);
  return { budget: PROFILES[profile].tokenBudget, label: profile };
}

export function parseBudget(value: string): number {
  const n = Number.parseInt(value.replace(/[_,]/g, '').replace(/k$/i, '000'), 10);
  if (!Number.isInteger(n) || n < 1000) {
    throw new Error(
      `Invalid token budget "${value}": use an integer >= 1000 (e.g. 200000 or 200k).`,
    );
  }
  return n;
}

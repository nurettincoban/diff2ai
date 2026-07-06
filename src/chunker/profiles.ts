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

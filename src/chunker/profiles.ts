export type ProfileName = 'claude-large' | 'generic-large' | 'generic-medium';

export const PROFILES: Record<ProfileName, { tokenBudget: number }> = {
  'claude-large': { tokenBudget: 150_000 },
  'generic-large': { tokenBudget: 100_000 },
  'generic-medium': { tokenBudget: 30_000 },
};

import prompts, { type PromptObject } from 'prompts';

export type PromptOptions = {
  interactive?: boolean;
  yes?: boolean;
};

export async function confirm(
  message: string,
  opts: PromptOptions & { initial?: boolean } = {},
): Promise<boolean> {
  if (opts.yes) return true;
  if (opts.interactive === false) return false;
  const res = await prompts({
    type: 'confirm',
    name: 'ok',
    message,
    initial: opts.initial ?? false,
  } as PromptObject);
  return Boolean(res.ok);
}

// Multi-selection has no safe auto-answer; non-interactive callers get null
// and should fall back to their default.
export async function multiselect<T extends string>(
  message: string,
  choices: { title: string; value: T; selected?: boolean }[],
  opts: Pick<PromptOptions, 'interactive'> = {},
): Promise<T[] | null> {
  if (opts.interactive === false) return null;
  const res = await prompts({
    type: 'multiselect',
    name: 'vals',
    message,
    choices,
    instructions: false,
    hint: 'space toggles, enter confirms',
  } as unknown as PromptObject);
  return Array.isArray(res.vals) ? (res.vals as T[]) : null;
}

// Selection has no safe auto-answer, so unlike confirm() there is no `yes` shortcut:
// non-interactive callers get null and should fall back to their default.
export async function select<T extends string>(
  message: string,
  choices: { title: string; value: T }[],
  opts: Pick<PromptOptions, 'interactive'> = {},
): Promise<T | null> {
  if (opts.interactive === false) return null;
  const res = await prompts({ type: 'select', name: 'val', message, choices });
  return (res.val as T) ?? null;
}

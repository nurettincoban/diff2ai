import prompts, { type PromptObject } from 'prompts';

export type PromptOptions = {
  interactive?: boolean;
  yes?: boolean;
};

export async function confirm(message: string, opts: PromptOptions = {}): Promise<boolean> {
  if (opts.yes) return true;
  if (opts.interactive === false) return false;
  const res = await prompts({
    type: 'confirm',
    name: 'ok',
    message,
    initial: false,
  } as PromptObject);
  return Boolean(res.ok);
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

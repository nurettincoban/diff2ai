import {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  select as inquirerSelect,
} from '@inquirer/prompts';

export type PromptOptions = {
  interactive?: boolean;
  yes?: boolean;
};

// Optional stream overrides, used by unit tests to drive prompts without a TTY.
export type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

// Ctrl+C / closed stdin makes inquirer reject with ExitPromptError (or
// AbortPromptError); callers treat that as "no answer" instead of a crash.
function isCancel(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'ExitPromptError' || name === 'AbortPromptError';
}

export async function confirm(
  message: string,
  opts: PromptOptions & { initial?: boolean } = {},
  context?: PromptContext,
): Promise<boolean> {
  if (opts.yes) return true;
  if (opts.interactive === false) return false;
  try {
    return await inquirerConfirm({ message, default: opts.initial ?? false }, context);
  } catch (error) {
    if (isCancel(error)) return false;
    throw error;
  }
}

// Multi-selection has no safe auto-answer; non-interactive callers get null
// and should fall back to their default.
export async function multiselect<T extends string>(
  message: string,
  choices: { title: string; value: T; selected?: boolean }[],
  opts: Pick<PromptOptions, 'interactive'> & { min?: number } = {},
  context?: PromptContext,
): Promise<T[] | null> {
  if (opts.interactive === false) return null;
  const min = opts.min ?? 0;
  try {
    return await inquirerCheckbox<T>(
      {
        message,
        choices: choices.map((c) => ({ name: c.title, value: c.value, checked: c.selected })),
        validate: (picked) => picked.length >= min || `Pick at least ${min}.`,
      },
      context,
    );
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

// Selection has no safe auto-answer, so unlike confirm() there is no `yes` shortcut:
// non-interactive callers get null and should fall back to their default.
export async function select<T extends string>(
  message: string,
  choices: { title: string; value: T }[],
  opts: Pick<PromptOptions, 'interactive'> = {},
  context?: PromptContext,
): Promise<T | null> {
  if (opts.interactive === false) return null;
  if (choices.length === 0) return null;
  try {
    return await inquirerSelect<T>(
      { message, choices: choices.map((c) => ({ name: c.title, value: c.value })) },
      context,
    );
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

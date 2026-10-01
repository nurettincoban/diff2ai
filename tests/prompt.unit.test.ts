import { PassThrough } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { confirm, multiselect, select } from '../src/ux/prompt.js';

// Drives the inquirer-backed prompts through in-memory streams.
function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume(); // discard rendered frames
  return { input, output };
}

function typeKeys(input: PassThrough, keys: string[]): void {
  let i = 0;
  const next = () => {
    if (i >= keys.length) return;
    input.write(keys[i++]);
    setTimeout(next, 20);
  };
  setTimeout(next, 50);
}

const DOWN = '\x1b[B';
const SPACE = ' ';
const ENTER = '\r';

describe('prompt wrappers', () => {
  it('confirm short-circuits on --yes and non-interactive mode', async () => {
    expect(await confirm('ok?', { yes: true })).toBe(true);
    expect(await confirm('ok?', { interactive: false })).toBe(false);
  });

  it('confirm returns the typed answer', async () => {
    const ctx = streams();
    typeKeys(ctx.input, ['y', ENTER]);
    expect(await confirm('Proceed?', {}, ctx)).toBe(true);
  });

  it('select returns the highlighted choice', async () => {
    const ctx = streams();
    typeKeys(ctx.input, [DOWN, ENTER]);
    const picked = await select(
      'Pick one',
      [
        { title: 'First', value: 'a' },
        { title: 'Second', value: 'b' },
      ],
      {},
      ctx,
    );
    expect(picked).toBe('b');
  });

  it('multiselect keeps preselected values and toggles with space', async () => {
    const ctx = streams();
    typeKeys(ctx.input, [DOWN, SPACE, ENTER]);
    const picked = await multiselect(
      'Pick some',
      [
        { title: 'A', value: 'a', selected: true },
        { title: 'B', value: 'b' },
        { title: 'C', value: 'c' },
      ],
      { min: 2 },
      ctx,
    );
    expect(picked).toEqual(['a', 'b']);
  });

  it('non-interactive select/multiselect return null', async () => {
    expect(await select('x', [{ title: 'A', value: 'a' }], { interactive: false })).toBeNull();
    expect(await multiselect('x', [{ title: 'A', value: 'a' }], { interactive: false })).toBeNull();
  });
});

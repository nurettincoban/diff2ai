import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTemplate } from '../src/formatters/markdown.js';

// Each test works in its own temp dir so nothing is written into the repo.
function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-templates-'));
}

describe('prompt templates', () => {
  it('renders default and basic templates differently', () => {
    const cwd = workspace();
    const diff = 'diff --git a/a.txt b/a.txt\n+added line\n';
    const mdDefault = renderTemplate('default', diff, { cwd });
    const mdBasic = renderTemplate('basic', diff, { cwd });
    expect(mdDefault).not.toEqual(mdBasic);
    expect(mdDefault).toMatch(/Code Review Instructions/);
    expect(mdBasic).toMatch(/Review this diff/);
    expect(mdDefault).toContain(diff);
    expect(mdBasic).toContain(diff);
  });

  it('ships an agent template that keeps the issue-block schema', () => {
    const md = renderTemplate('agent', '+x\n', { cwd: workspace() });
    expect(md).toMatch(/agent mode/);
    expect(md).toMatch(/## <n>\) Severity:/);
  });

  it('loads a project-local named template from ./templates', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'templates'));
    fs.writeFileSync(path.join(cwd, 'templates', 'my-review.md'), '# Custom\n\n{diff_content}\n');
    const diff = 'diff --git a/x b/x\n+1\n';
    const out = renderTemplate('my-review', diff, { cwd });
    expect(out).toContain('# Custom');
    expect(out).toContain(diff);
  });

  it('accepts an explicit file path to a template', () => {
    const cwd = workspace();
    const abs = path.join(cwd, 'custom.md');
    fs.writeFileSync(abs, 'Custom File\n\n{diff_content}\n');
    const diff = 'diff --git a/y b/y\n+2\n';
    const out = renderTemplate(abs, diff, { cwd });
    expect(out).toContain('Custom File');
    expect(out).toContain(diff);
  });

  it('preserves $-sequences in diff content verbatim', () => {
    const diff = 'diff --git a/s.sh b/s.sh\n+echo "$& $` $\' $1 $$"\n';
    const out = renderTemplate('default', diff, { cwd: workspace() });
    expect(out).toContain(diff);
    expect(out).not.toContain('{diff_content}');
  });

  it('errors if placeholder is missing', () => {
    const cwd = workspace();
    const abs = path.join(cwd, 'bad.md');
    fs.writeFileSync(abs, 'No placeholder here');
    expect(() => renderTemplate(abs, 'diff', { cwd })).toThrow(/missing required placeholder/);
  });

  it('errors when an explicit templates directory does not exist', () => {
    const cwd = workspace();
    expect(() => renderTemplate('x', 'diff', { cwd, templatesDir: 'nope' })).toThrow(
      /Templates directory not found/,
    );
  });
});

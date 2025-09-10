// imports removed as they were unused
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/formatters/markdown.js';
import fs from 'fs';
import path from 'path';

describe('prompt templates', () => {
  it('renders default and basic templates differently', () => {
    const diff = 'diff --git a/a.txt b/a.txt\n+added line\n';
    const mdDefault = renderTemplate('default', diff);
    const mdBasic = renderTemplate('basic', diff);
    expect(mdDefault).not.toEqual(mdBasic);
    expect(mdDefault).toMatch(/Issue block schema|Code Review Request|Review/);
    expect(mdBasic).toMatch(/Review this diff/);
    expect(mdDefault).toContain(diff);
    expect(mdBasic).toContain(diff);
  });

  it('loads a project-local named template from ./templates', () => {
    const cwd = process.cwd();
    const projTemplates = path.join(cwd, 'templates');
    if (!fs.existsSync(projTemplates)) fs.mkdirSync(projTemplates, { recursive: true });
    const customPath = path.join(projTemplates, 'my-review.md');
    fs.writeFileSync(customPath, '# Custom\n\n{diff_content}\n', 'utf-8');
    const diff = 'diff --git a/x b/x\n+1\n';
    const out = renderTemplate('my-review', diff, { cwd });
    expect(out).toContain('# Custom');
    expect(out).toContain(diff);
    fs.unlinkSync(customPath);
  });

  it('accepts an explicit file path to a template', () => {
    const cwd = process.cwd();
    const abs = path.join(cwd, 'custom.md');
    fs.writeFileSync(abs, 'Custom File\n\n{diff_content}\n', 'utf-8');
    const diff = 'diff --git a/y b/y\n+2\n';
    const out = renderTemplate(abs, diff, { cwd });
    expect(out).toContain('Custom File');
    expect(out).toContain(diff);
    fs.unlinkSync(abs);
  });

  it('errors if placeholder is missing', () => {
    const cwd = process.cwd();
    const abs = path.join(cwd, 'bad.md');
    fs.writeFileSync(abs, 'No placeholder here', 'utf-8');
    expect(() => renderTemplate(abs, 'diff', { cwd })).toThrow(/missing required placeholder/);
    fs.unlinkSync(abs);
  });
});

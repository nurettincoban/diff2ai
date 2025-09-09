import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/formatters/markdown.js';

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
});



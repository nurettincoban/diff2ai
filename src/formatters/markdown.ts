import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Optional context placeholders. Missing values render as "(not available)",
// so templates can use them unconditionally.
export type TemplateVars = {
  commits?: string; // {commits}: commit subjects/bodies in the reviewed range
  file_stats?: string; // {file_stats}: changed files with +/- counts
  branch?: string; // {branch}: the ref under review
  target?: string; // {target}: the branch it is compared against
};

export const TEMPLATE_PLACEHOLDERS = ['diff_content', 'commits', 'file_stats', 'branch', 'target'];

type RenderOptions = {
  cwd?: string;
  templatesDir?: string;
  vars?: TemplateVars;
};

export function resolveBuiltInTemplatesDir(): string | null {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(moduleDir, './templates'), // dist/cli.js → dist/templates
      path.resolve(moduleDir, '../templates'),
      path.resolve(moduleDir, '../../templates'), // running from source: src/formatters
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
  } catch {
    // ignore
  }
  return null;
}

export function resolveProjectTemplatesDir(cwd: string, override?: string): string | null {
  if (override) {
    const abs = path.isAbsolute(override) ? override : path.resolve(cwd, override);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
    throw new Error(`Templates directory not found: ${abs}`);
  }
  const localTemplates = path.join(cwd, 'templates');
  if (fs.existsSync(localTemplates) && fs.statSync(localTemplates).isDirectory())
    return localTemplates;
  return null;
}

export function isPathLike(input: string): boolean {
  return input.endsWith('.md') || input.includes('/') || input.includes('\\');
}

// One pass over the template with a replacer function: `$&`, `$'` etc. in the
// diff are inserted verbatim, and placeholder-like text inside the diff or
// commit messages is never substituted a second time.
function substitute(raw: string, diffContent: string, vars: TemplateVars = {}): string {
  return raw.replace(/\{(diff_content|commits|file_stats|branch|target)\}/g, (_m, key: string) => {
    if (key === 'diff_content') return diffContent;
    const value = vars[key as keyof TemplateVars];
    return value && value.trim() ? value : '(not available)';
  });
}

function readTemplateFileOrThrow(templatePath: string): string {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }
  const raw = fs.readFileSync(templatePath, 'utf-8');
  if (!raw.includes('{diff_content}')) {
    throw new Error(
      `Invalid template (${templatePath}): missing required placeholder {diff_content}`,
    );
  }
  return raw;
}

export function renderTemplate(
  templateSpec: string,
  diffContent: string,
  opts: RenderOptions = {},
): string {
  const cwd = opts.cwd ?? process.cwd();
  const projectDir = resolveProjectTemplatesDir(cwd, opts.templatesDir ?? undefined);
  const builtInDir = resolveBuiltInTemplatesDir();

  // 1) Path-like input: load directly
  if (isPathLike(templateSpec)) {
    const abs = path.isAbsolute(templateSpec) ? templateSpec : path.resolve(cwd, templateSpec);
    const raw = readTemplateFileOrThrow(abs);
    return substitute(raw, diffContent, opts.vars);
  }

  // 2) Name-based input
  const name = templateSpec as string;
  const candidateFile = `${name}.md`;

  // Project templates take precedence
  if (projectDir) {
    const candidate = path.join(projectDir, candidateFile);
    if (fs.existsSync(candidate)) {
      const raw = readTemplateFileOrThrow(candidate);
      return substitute(raw, diffContent, opts.vars);
    }
  }

  // Packaged templates: <name>.md
  if (builtInDir) {
    const generic = path.join(builtInDir, `${name}.md`);
    if (fs.existsSync(generic)) {
      const raw = readTemplateFileOrThrow(generic);
      return substitute(raw, diffContent, opts.vars);
    }
  }

  // If a templatesDir was explicitly provided but not found
  const checked: string[] = [];
  if (projectDir) checked.push(path.join(projectDir, candidateFile));
  if (builtInDir) checked.push(path.join(builtInDir, candidateFile));

  throw new Error(
    `Template "${name}" not found. Checked: ${checked.length ? checked.join(', ') : 'no candidate locations'}.
If you intended a file path, pass a relative/absolute path ending with .md, or place ${candidateFile} under ./templates/.`,
  );
}

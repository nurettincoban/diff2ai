import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type BuiltInTemplateName = 'basic' | 'default';

type RenderOptions = {
  cwd?: string;
  templatesDir?: string;
};

export function resolveBuiltInTemplatesDir(): string | null {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(moduleDir, './templates'),
      path.resolve(moduleDir, '../templates'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveProjectTemplatesDir(cwd: string, override?: string): string | null {
  if (override) {
    const abs = path.isAbsolute(override) ? override : path.resolve(cwd, override);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  }
  const localTemplates = path.join(cwd, 'templates');
  if (fs.existsSync(localTemplates) && fs.statSync(localTemplates).isDirectory())
    return localTemplates;
  return null;
}

function isPathLike(input: string): boolean {
  return input.endsWith('.md') || input.includes('/') || input.includes('\\');
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
    return raw.replace('{diff_content}', diffContent);
  }

  // 2) Name-based input
  const name = templateSpec as string;
  const candidateFile = `${name}.md`;

  // Project templates take precedence
  if (projectDir) {
    const candidate = path.join(projectDir, candidateFile);
    if (fs.existsSync(candidate)) {
      const raw = readTemplateFileOrThrow(candidate);
      return raw.replace('{diff_content}', diffContent);
    }
  }

  // Built-ins (generic lookup by name, then fallback map for legacy names)
  const builtInMap: Record<BuiltInTemplateName, string> = {
    basic: 'basic.md',
    default: 'default.md',
  };
  if (builtInDir) {
    // First try generic <name>.md in packaged templates
    const generic = path.join(builtInDir, `${name}.md`);
    if (fs.existsSync(generic)) {
      const raw = readTemplateFileOrThrow(generic);
      return raw.replace('{diff_content}', diffContent);
    }
    // Then fallback to legacy name map
    const isBuiltInName = Object.prototype.hasOwnProperty.call(builtInMap, name);
    if (isBuiltInName) {
      const candidate = path.join(builtInDir, builtInMap[name as BuiltInTemplateName]);
      const raw = readTemplateFileOrThrow(candidate);
      return raw.replace('{diff_content}', diffContent);
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

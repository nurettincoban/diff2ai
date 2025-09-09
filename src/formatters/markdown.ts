import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type TemplateName = 'basic' | 'default';

function resolveTemplatesDir(cwd: string): string | null {
  // 1) Next to this module: dist/formatters/markdown.js → dist/templates
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgTemplates = path.resolve(moduleDir, '../templates');
    if (fs.existsSync(pkgTemplates)) return pkgTemplates;
  } catch {
    // ignore
  }

  // 2) Project-local templates in current working directory (useful for dev)
  const localTemplates = path.join(cwd, 'templates');
  if (fs.existsSync(localTemplates)) return localTemplates;

  return null;
}

export function renderTemplate(
  template: TemplateName,
  diffContent: string,
  cwd: string = process.cwd(),
): string {
  const templatesDir = resolveTemplatesDir(cwd);
  if (!templatesDir) {
    let expected = 'dist/templates (beside installed CLI)';
    try {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      expected = path.resolve(moduleDir, '../templates');
    } catch {
      // ignore path resolution errors
    }
    throw new Error(
      `Templates directory not found. Expected templates at: ${expected} or ${path.join(cwd, 'templates')}`,
    );
  }

  const fileMap: Record<TemplateName, string> = {
    basic: 'basic.md',
    default: 'default.md',
  };

  const templatePath = path.join(templatesDir, fileMap[template]);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file missing: ${templatePath}`);
  }

  const raw = fs.readFileSync(templatePath, 'utf-8');
  return raw.replace('{diff_content}', diffContent);
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type TemplateName = 'basic' | 'default';

function resolveTemplatesDir(cwd: string): string | null {
  // 1) Resolve relative to built module location
  //    - Bundled single-file (moduleDir = dist): check ./templates
  //    - Separate dirs (moduleDir = dist/formatters): check ../templates
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
    let expectedA = 'dist/templates (alongside installed CLI)';
    let expectedB = path.join(cwd, 'templates');
    try {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      expectedA = `${path.resolve(moduleDir, './templates')} or ${path.resolve(moduleDir, '../templates')}`;
    } catch {
      // ignore path resolution errors
    }
    throw new Error(`Templates directory not found. Expected templates at: ${expectedA} or ${expectedB}`);
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

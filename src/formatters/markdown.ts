import fs from 'node:fs';
import path from 'node:path';

export type TemplateName = 'basic' | 'comprehensive' | 'security';

const DEFAULT_COMPREHENSIVE = `# Code Review Request

Review the following diff and add comments directly above problematic lines.
Format: // REVIEW: [ERROR|WARNING|INFO] Your comment here

Check for:
- Bugs and logic errors
- Missing tests or test coverage gaps
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Breaking changes to APIs

--- START DIFF ---
{diff_content}
--- END DIFF ---
`;

export function renderTemplate(template: TemplateName, diffContent: string, cwd: string = process.cwd()): string {
  const templatesDir = path.join(cwd, 'templates');
  const fileMap: Record<TemplateName, string> = {
    basic: 'basic.md',
    comprehensive: 'comprehensive.md',
    security: 'security.md',
  };

  const templatePath = path.join(templatesDir, fileMap[template]);
  if (fs.existsSync(templatePath)) {
    const raw = fs.readFileSync(templatePath, 'utf-8');
    return raw.replace('{diff_content}', diffContent);
  }

  // Fallback to built-in comprehensive if files are missing
  return DEFAULT_COMPREHENSIVE.replace('{diff_content}', diffContent);
}

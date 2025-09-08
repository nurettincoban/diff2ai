import fs from 'fs';
import path from 'path';

export type TemplateName = 'basic' | 'default';

const DEFAULT_TEMPLATE = `# Enforced Code Review Instructions\n\nYou are an AI code reviewer. Follow these rules strictly and keep feedback concise and actionable.\n\nGuidelines\n- Comment ONLY on lines present in the diff.\n- Place feedback immediately ABOVE the relevant added/changed lines.\n- Prefer concrete fixes over generic advice.\n- If proposing code, keep snippets minimal and focused.\n\nIssue Block (use this exact structure per issue)\n\n⚠️ Potential issue [<TYPE>]\n<Short, imperative title (max 1 line)>\n<Clear explanation: what is wrong, why it matters, how to fix>\n\n🤖 Prompt for AI Agents\n<One-paragraph, precise instruction with exact file paths and line ranges>\n\n--- START DIFF ---\n{diff_content}\n--- END DIFF ---\n`;

export function renderTemplate(template: TemplateName, diffContent: string, cwd: string = process.cwd()): string {
  const templatesDir = path.join(cwd, 'templates');
  const fileMap: Record<TemplateName, string> = {
    basic: 'basic.md',
    default: 'default.md',
  };

  const templatePath = path.join(templatesDir, fileMap[template]);
  if (fs.existsSync(templatePath)) {
    const raw = fs.readFileSync(templatePath, 'utf-8');
    return raw.replace('{diff_content}', diffContent);
  }

  // Fallback to built-in default template if files are missing
  return DEFAULT_TEMPLATE.replace('{diff_content}', diffContent);
}

import { Command } from 'commander';
import { loadConfig } from '../config/loadConfig.js';
import { loadIgnore } from '../config/ignore.js';
import { assertGitRepo, listRemoteBranches } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile } from '../formatters/diff.js';
import { renderTemplate, type TemplateName } from '../formatters/markdown.js';
import fs from 'node:fs';
import path from 'node:path';
import { chunkDiff } from '../chunker/chunk.js';
import type { ProfileName } from '../chunker/profiles.js';
import { fetchGithubPr, fetchGitlabMr } from '../git/fetch.js';

export function registerCommands(program: Command): void {
  program
    .command('mr')
    .description('Fetch and diff MR/PR by ID against target branch')
    .requiredOption('--id <number>', 'MR/PR ID')
    .option('--target <branch>', 'Target branch (default: main)')
    .option('--platform <name>', 'Platform: github|gitlab', 'github')
    .action(async (opts: { id: string; target?: string; platform: 'github' | 'gitlab' }) => {
      try {
        assertGitRepo();
        const idNum = Number(opts.id);
        if (!Number.isFinite(idNum)) {
          console.error('Invalid ID');
          process.exitCode = 1;
          return;
        }
        const { config, warnings } = loadConfig();
        for (const w of warnings) console.warn(w);

        const platform = opts.platform;
        const result = platform === 'gitlab' ? await fetchGitlabMr(idNum) : await fetchGithubPr(idNum);

        const targetBranch = opts.target ?? config.target;
        const targetRef = `origin/${targetBranch}`;
        const diff = await generateUnifiedDiff({ targetRef });
        if (!diff || diff.trim().length === 0) {
          console.log('No changes detected.');
          return;
        }
        const filePath = writeDiffFile(`${platform}_${idNum}`, diff);
        console.log(`Wrote diff: ${filePath}`);
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('diff')
    .description('Generate diff for working tree vs target or staged changes')
    .option('--staged', 'Use staged changes')
    .action(async (opts: { staged?: boolean }) => {
      try {
        assertGitRepo();
        const { config, warnings } = loadConfig();
        const ignore = loadIgnore();
        for (const w of warnings) console.warn(w);

        const targetRef = `origin/${config.target}`;
        let diff = await generateUnifiedDiff({
          staged: Boolean(opts.staged),
          targetRef,
          ignore,
        });

        if (!diff || diff.trim().length === 0) {
          console.log('No changes detected.');
          return;
        }

        const filePath = writeDiffFile(opts.staged ? 'staged' : 'diff', diff);
        console.log(`Wrote diff: ${filePath}`);
      } catch (error: unknown) {
        const message = (error as Error)?.message ?? String(error);
        if (/Not a git repository/i.test(message)) {
          console.error('Error: Missing Git repo. Ensure a .git directory exists.');
          return;
        }
        if (/ambiguous argument|unknown revision|bad revision/i.test(message)) {
          console.error('Error: Invalid diff target. Available remote branches:');
          try {
            const branches = await listRemoteBranches();
            for (const b of branches) console.error(`  ${b}`);
          } catch {
            // ignore follow-up errors
          }
          return;
        }
        console.error(message);
        process.exitCode = 1;
      }
    });

  program
    .command('show <sha>')
    .description('Show commit diff for a specific SHA')
    .action(async (sha: string) => {
      try {
        assertGitRepo();
        const diff = await generateUnifiedDiff({ commitSha: sha });
        if (!diff || diff.trim().length === 0) {
          console.log('No changes detected.');
          return;
        }
        const filePath = writeDiffFile(`commit_${sha}`, diff);
        console.log(`Wrote diff: ${filePath}`);
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('prompt <diffFile>')
    .description('Generate AI-ready markdown prompt from a diff file')
    .option('--template <name>', 'Template: basic|comprehensive|security', 'comprehensive')
    .action((diffFile: string, opts: { template: TemplateName }) => {
      try {
        const abs = diffFile;
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const md = renderTemplate(opts.template ?? 'comprehensive', diffContent);
        const out = abs.replace(/\.diff$/i, '.md');
        fs.writeFileSync(out, md, 'utf-8');
        console.log(`Wrote prompt: ${out}`);
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('chunk <diffFile>')
    .description('Chunk large diff into batches using a token budget profile')
    .option(
      '--profile <name>',
      'Profile: claude-large|generic-large|generic-medium',
      'generic-medium',
    )
    .action((diffFile: string, opts: { profile: ProfileName }) => {
      try {
        const abs = diffFile;
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const { chunks } = chunkDiff(diffContent, opts.profile ?? 'generic-medium');
        const indexLines: string[] = ['# Review Batches', ''];
        for (const c of chunks) {
          const out = path.join(process.cwd(), c.filename);
          fs.writeFileSync(out, c.content, 'utf-8');
          indexLines.push(`- ${c.filename}`);
        }
        fs.writeFileSync(path.join(process.cwd(), 'review_index.md'), indexLines.join('\n') + '\n', 'utf-8');
        console.log(`Wrote ${chunks.length} batch file(s) and review_index.md`);
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });
}

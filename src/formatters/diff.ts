import fs from 'node:fs';
import path from 'node:path';
import type { Chunk } from '../chunker/chunk.js';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeDiffFile(
  prefix: string,
  contents: string,
  outDir: string = path.join(process.cwd(), 'reviews'),
): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const filename = `${prefix}_${timestamp}.diff`;
  ensureDir(outDir);
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

export function writeBatchFiles(
  chunks: Chunk[],
  outDir: string,
): { batchPaths: string[]; indexPath: string } {
  ensureDir(outDir);
  const indexLines: string[] = [
    '# Review Batches',
    '',
    'Process each batch with your AI reviewer using the same default template.',
    'Then merge all issue blocks into a single review.md without duplication.',
    '',
  ];
  const batchPaths: string[] = [];
  for (const c of chunks) {
    const out = path.join(outDir, c.filename);
    fs.writeFileSync(out, c.content, 'utf-8');
    batchPaths.push(out);
    indexLines.push(`- ${path.basename(out)}`);
  }
  const indexPath = path.join(outDir, 'review_index.md');
  fs.writeFileSync(indexPath, indexLines.join('\n') + '\n', 'utf-8');
  return { batchPaths, indexPath };
}

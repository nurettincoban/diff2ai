import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeDiffFile(prefix: string, contents: string, outDir: string = path.join(process.cwd(), 'reviews')): string {
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

import fs from 'node:fs';
import path from 'node:path';

export function writeDiffFile(prefix: string, contents: string, cwd: string = process.cwd()): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const filename = `${prefix}_${timestamp}.diff`;
  const filePath = path.join(cwd, filename);
  fs.writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

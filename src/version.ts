import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

// Version from the installed package.json (dist/cli.js → ../package.json).
export function packageVersion(): string {
  if (cached) return cached;
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    for (const candidate of ['../package.json', '../../package.json']) {
      const pkgPath = path.resolve(moduleDir, candidate);
      if (!fs.existsSync(pkgPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === 'diff2ai' && parsed.version) return (cached = parsed.version);
    }
  } catch {
    // ignore
  }
  return (cached = '0.0.0');
}

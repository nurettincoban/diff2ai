// clipboardy is ESM-only and optional at runtime (headless machines have no
// clipboard); import lazily and report success instead of throwing.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const mod = (await import('clipboardy')) as unknown as {
      default?: { write?: (s: string) => Promise<void> };
      write?: (s: string) => Promise<void>;
    };
    const clip = mod?.default ?? mod;
    if (clip && typeof clip.write === 'function') {
      await clip.write(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

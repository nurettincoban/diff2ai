export type Persona = {
  slug: string;
  name: string;
  instructions: string;
};

export const BUILTIN_PERSONAS: Persona[] = [
  {
    slug: 'correctness',
    name: 'Bug Hunter',
    instructions:
      'You are a correctness-focused reviewer. Prioritize: logic errors, off-by-one mistakes, null/undefined handling, broken error handling, race conditions, incorrect API usage, and edge cases in control flow.',
  },
  {
    slug: 'security',
    name: 'Security Auditor',
    instructions:
      'You are a security-focused reviewer. Prioritize: injection flaws, authentication/authorization gaps, secrets or credentials in code, unsafe deserialization, path traversal, SSRF, cryptographic misuse, and missing input validation.',
  },
  {
    slug: 'performance',
    name: 'Performance Engineer',
    instructions:
      'You are a performance-focused reviewer. Prioritize: algorithmic complexity regressions, N+1 query patterns, memory leaks, blocking I/O on hot paths, unnecessary allocations or copies, and missing caching opportunities.',
  },
  {
    slug: 'api-maintainability',
    name: 'API & Maintainability Reviewer',
    instructions:
      'You are an API-design and maintainability reviewer. Prioritize: confusing or leaky interfaces, breaking changes to public contracts, naming problems, tight coupling, dead or duplicated code, and documentation that no longer matches behavior.',
  },
  {
    slug: 'testing-edge-cases',
    name: 'Test Engineer',
    instructions:
      'You are a testing-focused reviewer. Prioritize: changed behavior without test coverage, brittle or tautological tests, unhandled boundary conditions, missing failure-path and concurrency tests, and fixtures that mask bugs.',
  },
];

function slugify(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Built-ins first, then user-defined personas from .aidiff.json `personas`
// (which can also override a built-in slug).
export function personaPool(configPersonas?: Record<string, string>): Persona[] {
  const pool: Persona[] = [...BUILTIN_PERSONAS];
  for (const [key, instructions] of Object.entries(configPersonas ?? {})) {
    if (typeof instructions !== 'string' || instructions.trim().length === 0) continue;
    const slug = slugify(key);
    const existing = pool.findIndex((p) => p.slug === slug);
    const persona: Persona = { slug, name: key, instructions };
    if (existing >= 0) pool[existing] = persona;
    else pool.push(persona);
  }
  return pool;
}

// Returns the first `n` personas from the pool.
export function selectPersonas(n: number, configPersonas?: Record<string, string>): Persona[] {
  const pool = personaPool(configPersonas);
  if (n > pool.length) {
    throw new Error(
      `--iterations ${n} exceeds the available reviewer personas (${pool.length}). Add more under "personas" in .aidiff.json.`,
    );
  }
  return pool.slice(0, n);
}

// Resolves an explicit persona selection (e.g. from --personas or the
// interactive picker) against the pool, preserving the given order.
export function personasBySlugs(
  slugs: string[],
  configPersonas?: Record<string, string>,
): Persona[] {
  const pool = personaPool(configPersonas);
  const seen = new Set<string>();
  return slugs.map((raw) => {
    const slug = raw.trim();
    if (seen.has(slug)) {
      throw new Error(`Duplicate persona "${slug}" in selection.`);
    }
    seen.add(slug);
    const persona = pool.find((p) => p.slug === slug);
    if (!persona) {
      throw new Error(
        `Unknown persona "${slug}". Available: ${pool.map((p) => p.slug).join(', ')}. Add custom ones under "personas" in .aidiff.json.`,
      );
    }
    return persona;
  });
}

// Prepends a persona header to the fully rendered prompt. The rendered prompt
// (including the embedded diff) is preserved verbatim below the divider.
export function wrapWithPersona(renderedPrompt: string, persona: Persona): string {
  return [
    `# Reviewer Persona: ${persona.name}`,
    '',
    persona.instructions,
    '',
    'Report issues outside your focus area only if they are CRITICAL. The severity, type, and output format rules in the base instructions below are unchanged and mandatory.',
    '',
    '---',
    '',
    renderedPrompt,
  ].join('\n');
}

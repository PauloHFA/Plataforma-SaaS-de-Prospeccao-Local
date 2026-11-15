export interface MessageVariables {
  nome_empresa?: string;
  categoria?: string;
  bairro?: string;
  cidade?: string;
  link_preview?: string;
  link_optout?: string;
  nota_google?: string;
  telefone?: string;
  [key: string]: string | undefined;
}

function resolveSpintaxRecursive(input: string, rng: () => number): string {
  let result = input;
  // Iteratively resolve innermost {a|b|c} blocks without nested braces
  const pattern = /\{([^{}]+)\}/g;
  let guard = 0;
  while (pattern.test(result) && guard < 20) {
    guard += 1;
    result = result.replace(/\{([^{}]+)\}/g, (full, inner: string) => {
      // Ignore accidental single variable without pipe unless it has options
      if (!inner.includes('|')) {
        return full;
      }
      const options = inner.split('|');
      const idx = Math.floor(rng() * options.length);
      return options[idx] ?? options[0] ?? '';
    });
  }
  return result;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
  const names = new Set<string>();
  for (const m of matches) {
    const key = m.replace(/^\{\{\s*|\s*\}\}$/g, '');
    if (key) names.add(key);
  }
  return Array.from(names);
}

export function findUnresolvedVariables(rendered: string): string[] {
  return extractTemplateVariables(rendered);
}

/**
 * RF-14 + CA-08: Resolve spintax {a|b} e substitui variáveis dinâmicas {{chave}},
 * garantindo ausência de chaves literais residuais.
 */
export function renderMessageTemplate(
  template: string,
  variables: MessageVariables,
  seed?: number,
): { rendered: string; unresolved: string[] } {
  const rng = typeof seed === 'number' ? seededRandom(seed) : Math.random;

  // Step 1: Substitute {{variables}} BEFORE spintax so {{var}} braces aren't confused with spintax
  const withVars = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    const val = variables[key];
    if (val === undefined || val === null) {
      return full;
    }
    return String(val);
  });

  // Step 2: Resolve spintax {Olá|Oi}
  const resolved = resolveSpintaxRecursive(withVars, rng).replace(/[ \t]{2,}/g, ' ').trim();
  const unresolved = findUnresolvedVariables(resolved);
  return { rendered: resolved, unresolved };
}

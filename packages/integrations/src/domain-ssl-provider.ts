import dns from 'node:dns/promises';

export interface DomainVerificationResult {
  domain: string;
  dnsVerified: boolean;
  sslStatus: 'ACTIVE' | 'PROVISIONING' | 'PENDING' | 'FAILED';
  matchedRecord: string | null;
  error: string | null;
}

const simulatedVerifiedDomains = new Set<string>();

export function registerSimulatedDnsDomain(domain: string): void {
  simulatedVerifiedDomains.add(domain.toLowerCase().trim());
}

export function clearSimulatedDnsDomains(): void {
  simulatedVerifiedDomains.clear();
}

/**
 * RF-19 + CA-11: Valida apontamento DNS (CNAME/A) e provisiona SSL/TLS via Caddy On-Demand TLS
 * ou Cloudflare for SaaS.
 */
export async function verifyAndProvisionCustomDomain(params: {
  domain: string;
  expectedCname: string;
  expectedARecord: string;
  simulateVerified?: boolean;
}): Promise<DomainVerificationResult> {
  const cleanDomain = params.domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const expectedCname = params.expectedCname.toLowerCase().trim();

  if (params.simulateVerified || simulatedVerifiedDomains.has(cleanDomain)) {
    await provisionSslOnEdge(cleanDomain);
    return {
      domain: cleanDomain,
      dnsVerified: true,
      sslStatus: 'ACTIVE',
      matchedRecord: `CNAME -> ${expectedCname}`,
      error: null,
    };
  }

  let matchedRecord: string | null = null;

  try {
    const cnames = await dns.resolveCname(cleanDomain);
    const match = cnames.find((c) => c.toLowerCase().replace(/\.$/, '') === expectedCname);
    if (match) {
      matchedRecord = `CNAME -> ${match}`;
    }
  } catch {
    // Try A record fallback for apex domains
  }

  if (!matchedRecord && params.expectedARecord) {
    try {
      const aRecords = await dns.resolve4(cleanDomain);
      if (aRecords.includes(params.expectedARecord)) {
        matchedRecord = `A -> ${params.expectedARecord}`;
      }
    } catch {
      // DNS not resolved yet
    }
  }

  if (!matchedRecord) {
    return {
      domain: cleanDomain,
      dnsVerified: false,
      sslStatus: 'PENDING',
      matchedRecord: null,
      error: `Registro CNAME para ${expectedCname} ou A para ${params.expectedARecord} ainda não propagado.`,
    };
  }

  await provisionSslOnEdge(cleanDomain);
  return {
    domain: cleanDomain,
    dnsVerified: true,
    sslStatus: 'ACTIVE',
    matchedRecord,
    error: null,
  };
}

async function provisionSslOnEdge(domain: string): Promise<void> {
  const cfToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const cfZone = (process.env.CLOUDFLARE_ZONE_ID || '').trim();

  if (cfToken && cfZone) {
    try {
      await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZone}/custom_hostnames`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: domain,
          ssl: { method: 'http', type: 'dv' },
        }),
      });
    } catch (err) {
      console.warn('[DomainSslProvider] Falha ao registrar custom hostname na Cloudflare:', err);
    }
  }

  // Caddy On-Demand TLS automatically reads /internal/caddy/ask during first HTTPS handshake
}

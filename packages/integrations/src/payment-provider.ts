import { generateSecureToken, signHmacSha256 } from '@plataforma/shared/crypto';

export interface CreateCheckoutSessionParams {
  gateway: 'STRIPE' | 'ASAAS' | 'SANDBOX';
  offerToken: string;
  title: string;
  description: string;
  billingModel: 'ONE_TIME' | 'SUBSCRIPTION' | 'HYBRID';
  setupAmountCents: number;
  monthlyAmountCents: number;
  appBaseUrl: string;
  customerEmail?: string;
  stripeSecretKey?: string;
  asaasApiKey?: string;
}

export interface CheckoutSessionResult {
  externalCheckoutId: string;
  checkoutUrl: string;
}

export async function createGatewayCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<CheckoutSessionResult> {
  const localCheckoutUrl = `${params.appBaseUrl.replace(/\/$/, '')}/checkout/${params.offerToken}`;

  if (params.gateway === 'STRIPE') {
    const stripeKey = (params.stripeSecretKey || process.env.STRIPE_SECRET_KEY || '').trim();
    if (stripeKey) {
      const form = new URLSearchParams();
      form.append('mode', params.billingModel === 'ONE_TIME' ? 'payment' : 'subscription');
      form.append('success_url', `${localCheckoutUrl}?status=success`);
      form.append('cancel_url', `${localCheckoutUrl}?status=canceled`);
      form.append('metadata[offer_token]', params.offerToken);

      let idx = 0;
      if (params.setupAmountCents > 0) {
        form.append(`line_items[${idx}][price_data][currency]`, 'brl');
        form.append(`line_items[${idx}][price_data][product_data][name]`, `${params.title} (Implantação)`);
        form.append(`line_items[${idx}][price_data][unit_amount]`, String(params.setupAmountCents));
        form.append(`line_items[${idx}][quantity]`, '1');
        idx += 1;
      }
      if (params.monthlyAmountCents > 0) {
        form.append(`line_items[${idx}][price_data][currency]`, 'brl');
        form.append(`line_items[${idx}][price_data][product_data][name]`, `${params.title} (Hospedagem Mensal)`);
        form.append(`line_items[${idx}][price_data][unit_amount]`, String(params.monthlyAmountCents));
        if (params.billingModel !== 'ONE_TIME') {
          form.append(`line_items[${idx}][price_data][recurring][interval]`, 'month');
        }
        form.append(`line_items[${idx}][quantity]`, '1');
      }

      const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      if (resp.ok) {
        const session = (await resp.json()) as { id: string; url: string };
        return {
          externalCheckoutId: session.id,
          checkoutUrl: session.url || localCheckoutUrl,
        };
      }
    }
  }

  if (params.gateway === 'ASAAS') {
    const asaasKey = (params.asaasApiKey || process.env.ASAAS_API_KEY || '').trim();
    if (asaasKey) {
      const resp = await fetch('https://api.asaas.com/v3/paymentLinks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: asaasKey,
        },
        body: JSON.stringify({
          name: params.title,
          description: params.description,
          value: ((params.setupAmountCents || params.monthlyAmountCents) / 100).toFixed(2),
          billingType: 'UNDEFINED',
          chargeType: params.billingModel === 'ONE_TIME' ? 'DETACHED' : 'RECURRENT',
          subscriptionCycle: params.billingModel === 'ONE_TIME' ? undefined : 'MONTHLY',
          externalReference: params.offerToken,
        }),
      });
      if (resp.ok) {
        const link = (await resp.json()) as { id: string; url: string };
        return {
          externalCheckoutId: link.id,
          checkoutUrl: link.url || localCheckoutUrl,
        };
      }
    }
  }

  return {
    externalCheckoutId: `chk_sbx_${generateSecureToken(8)}`,
    checkoutUrl: localCheckoutUrl,
  };
}

export function buildSignedSandboxWebhook(params: {
  eventId: string;
  eventType: 'payment.succeeded' | 'invoice.payment_failed' | 'subscription.reactivated';
  offerToken: string;
  amountCents: number;
  subscriptionId?: string;
  secret?: string;
}): { rawBody: string; signatureHeader: string } {
  const secret = params.secret || process.env.SANDBOX_WEBHOOK_SECRET || 'sandbox-hmac-secret-dev-key';
  const rawBody = JSON.stringify({
    event_id: params.eventId,
    type: params.eventType,
    data: {
      offer_token: params.offerToken,
      amount_cents: params.amountCents,
      subscription_id: params.subscriptionId || `sub_sbx_${generateSecureToken(6)}`,
      occurred_at: new Date().toISOString(),
    },
  });
  const signatureHeader = `sha256=${signHmacSha256(rawBody, secret)}`;
  return { rawBody, signatureHeader };
}

'use client';

import { useEffect } from 'react';

export interface TelemetryBeaconProps {
  siteId: string;
  apiBaseUrl?: string;
  disabled?: boolean;
}

export function trackSiteEvent(
  siteId: string,
  eventType: 'PAGE_VIEW' | 'WHATSAPP_CLICK' | 'CTA_CLICK' | 'PHONE_CLICK',
  apiBaseUrl = '',
): void {
  if (typeof window === 'undefined' || !siteId) return;
  const search = new URLSearchParams(window.location.search);
  if (search.get('preview_admin') === '1') return;

  const base = (apiBaseUrl || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  const endpoint = `${base}/api/public/telemetry`;
  const payload = JSON.stringify({
    siteId,
    eventType,
    referrer: document.referrer || undefined,
    viewportWidth: window.innerWidth,
  });

  try {
    if (navigator.sendBeacon && eventType !== 'PAGE_VIEW') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
  } catch {
    // Non-blocking telemetry
  }
}

export function TelemetryBeacon({ siteId, apiBaseUrl, disabled }: TelemetryBeaconProps) {
  useEffect(() => {
    if (disabled) return;
    trackSiteEvent(siteId, 'PAGE_VIEW', apiBaseUrl);
  }, [siteId, apiBaseUrl, disabled]);

  return null;
}

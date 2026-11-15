import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      subdomainSlug?: string;
      customDomain?: string | null;
    };

    if (body.subdomainSlug) {
      revalidatePath(`/preview/${body.subdomainSlug}`);
      const base = process.env.PREVIEW_BASE_DOMAIN || 'preview.localhost';
      revalidatePath(`/_sites/${body.subdomainSlug}.${base}`);
    }
    if (body.customDomain) {
      revalidatePath(`/_sites/${body.customDomain}`);
    }

    return NextResponse.json({ revalidated: true });
  } catch {
    return NextResponse.json({ revalidated: false }, { status: 400 });
  }
}

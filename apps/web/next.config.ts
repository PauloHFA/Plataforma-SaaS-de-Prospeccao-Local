import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@plataforma/shared', '@plataforma/templates'],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

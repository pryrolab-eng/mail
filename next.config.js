/** @type {import('next').NextConfig} */

const nextConfig = {
  // Keep Node-only deps out of Turbopack bundle (imapflow → pino → thread-stream test files break build)
  serverExternalPackages: [
    'imapflow',
    'pino',
    'thread-stream',
    'sonic-boom',
    'puppeteer',
    'puppeteer-core',
    '@puppeteer/browsers',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

module.exports = nextConfig;

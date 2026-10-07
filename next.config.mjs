/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pino", "bullmq", "ioredis", "cheerio", "@prisma/client"],
  },
};

export default nextConfig;

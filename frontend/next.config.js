/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Node.js-only modules used by @stacks/connect transitive deps
      // (ws, pino, viem/WalletConnect) — not needed in browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        bufferutil: false,
        "utf-8-validate": false,
        "pino-pretty": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;

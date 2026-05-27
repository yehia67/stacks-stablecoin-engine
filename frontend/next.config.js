/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, webpack }) => {
    // Optional native deps pulled in by @stacks/connect / WalletConnect / viem
    // transitive chains. We don't ship them in the browser bundle and we
    // don't need them on the server either. Setting fallback=false maps the
    // import to an empty module so webpack stops emitting "Module not found"
    // warnings on every compile.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      bufferutil: false,
      "utf-8-validate": false,
      "pino-pretty": false,
    };

    // The "Critical dependency: the request of a dependency is an expression"
    // warnings come from dynamic-require shapes inside ox/viem/@stacks/connect-ui.
    // Filter them out of the dev log so real errors stay visible.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/ox\// },
      { module: /node_modules\/@stacks\/connect-ui\// },
      { module: /node_modules\/viem\// },
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];

    return config;
  },
};

module.exports = nextConfig;

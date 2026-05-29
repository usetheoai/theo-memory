/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 15: renamed from experimental.serverComponentsExternalPackages.
  serverExternalPackages: ["pg", "@usetheo/sdk", "openai"],
  // Transpile @usetheo/memory + @usetheo/ui from source on the fly.
  transpilePackages: ["@usetheo/memory", "@usetheo/ui"],
  // theo-memory ships TS source with NodeNext-style `.js` imports.
  // Webpack must resolve those to `.ts` files when consumed via file: link.
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;

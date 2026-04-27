// Next.js config for production frontend with remote asset support.
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.coingecko.com"
      },
      {
        protocol: "https",
        hostname: "coin-images.coingecko.com"
      }
    ]
  }
};

export default nextConfig;

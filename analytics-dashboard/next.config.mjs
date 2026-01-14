/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false, // Set to false for production to catch type errors
  },
  images: {
    unoptimized: true,
  },
  // Ensure API routes work properly
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a check build run alongside `next dev` without fighting over .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

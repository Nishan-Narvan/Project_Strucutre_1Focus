import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a check build run alongside `next dev` without fighting over .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Entering the app lands on Goals; Today lives at /today
  redirects: async () => [
    // If Supabase sends a sign-in code to the Site URL instead of /auth/callback (it does when the
    // callback is missing from its Redirect URLs list), hand the code to the callback anyway
    { source: "/", has: [{ type: "query", key: "code" }], destination: "/auth/callback", permanent: false },
    { source: "/goals", has: [{ type: "query", key: "code" }], destination: "/auth/callback", permanent: false },
    { source: "/", destination: "/goals", permanent: false },
  ],
};

export default nextConfig;

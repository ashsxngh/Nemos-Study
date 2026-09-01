import type { NextConfig } from "next";

// GitHub Pages serves this app from a subpath (…github.io/Nemos-Study/), not a
// domain root. The base path is supplied by CI (see .github/workflows/nextjs.yml)
// rather than hardcoded so that `next dev` / `next build` stay at "/" locally.
//
// It is a NEXT_PUBLIC_ var deliberately: client code needs the same value to
// build absolute URLs that Next doesn't rewrite for us (e.g. the Supabase
// password-reset redirectTo).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // GitHub Pages is static hosting — there is no Node server, so the whole app
  // must be pre-rendered to plain HTML/JS. This also means no middleware/proxy,
  // no route handlers, and no server components that read cookies at runtime.
  output: "export",

  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,

  // Emit `library/index.html` instead of `library.html`, so a hard navigation or
  // refresh on a nested route resolves on GitHub Pages instead of 404ing.
  trailingSlash: true,

  // next/image's optimizer needs a server; static export has none.
  images: { unoptimized: true },
};

export default nextConfig;

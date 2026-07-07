
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public", // Service worker basne thau
  cacheOnFrontEndNav: true, // Internal navigation fast garauna
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development", // Dev mode ma error naaos bhannalai
  workboxOptions: {
  },
});

export default withPWA({
  // Tapaiko aru normal Next.js configs yaha hunchhan
  reactStrictMode: true,
  turbopack: {},
});


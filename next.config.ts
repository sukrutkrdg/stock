import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next blocks dev-resource requests from hosts it does not recognise, which
  // silently breaks HMR and hydration when the app is opened on a loopback IP
  // or a tunnel host instead of `localhost`. Mini App development always
  // involves at least one of those, since Base App has to reach the dev server
  // over a public URL.
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.trycloudflare.com"],
};

export default nextConfig;

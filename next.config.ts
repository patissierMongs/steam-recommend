import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 캐싱 모델: 'use cache' + cacheLife/cacheTag (appid 단위 데이터 캐시에 사용)
  cacheComponents: true,
  images: {
    remotePatterns: [
      // 아바타/헤더/캡슐 이미지: avatars.steamstatic.com, shared.akamai.steamstatic.com 등
      { protocol: "https", hostname: "**.steamstatic.com" },
      { protocol: "https", hostname: "media.steampowered.com" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
    ],
  },
};

export default nextConfig;

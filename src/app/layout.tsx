import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Steam Recommend",
    template: "%s · Steam Recommend",
  },
  description:
    "스팀 누적 플레이 기록, 태그, 리뷰, 리뷰어 공개 라이브러리 동시출현을 사용하는 검증 전 추천 기준선입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-edge bg-surface/60">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight text-foreground">
              <span className="text-accent">Steam</span> Recommend
            </Link>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-edge px-4 py-6 text-center text-xs text-muted">
          Valve와 무관한 팬 프로젝트입니다. 데이터: Steam Web API · Steam Store · SteamSpy
        </footer>
      </body>
    </html>
  );
}

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
    "스팀 라이브러리와 플레이타임, 태그, 리뷰, 동시보유 데이터를 통계적으로 결합해 다음에 할 게임을 추천합니다.",
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

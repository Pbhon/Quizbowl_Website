import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { Navigation } from "@/components/navigation";
import "./globals.css";
import { teamName } from "@/lib/team";

export const metadata: Metadata = {
  title: { default: "QuizBowl | Team workspace", template: "%s | QuizBowl" },
  description: "A team workspace for quizbowl practice and study.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4"
          >
            Skip to content
          </a>
          <Navigation />
          <main
            id="main-content"
            className="mx-auto min-h-[75vh] max-w-7xl px-5 py-8 sm:px-8 sm:py-12"
          >
            {children}
          </main>
          <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 border-t px-5 py-6 text-sm text-muted-foreground sm:px-8">
            <span>QuizBowl · Learn a little more, every day.</span>
            <a href="https://www.qbreader.org/" className="underline">
              Questions via QBReader
            </a>
            <span>{teamName}</span>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { Navigation } from "@/components/navigation";
import "./globals.css";

export const metadata: Metadata = { title: { default: "QuizBowl | Team workspace", template: "%s | QuizBowl" }, description: "A team workspace for quizbowl practice and study." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AuthProvider><a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4">Skip to content</a><Navigation /><main id="main-content" className="mx-auto min-h-[75vh] max-w-7xl px-5 py-10 sm:px-8 sm:py-14">{children}</main><footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 border-t px-5 py-6 text-sm text-muted-foreground sm:px-8"><span>QuizBowl · Learn a little more, every day.</span><span>Team workspace</span></footer></AuthProvider></body></html>;
}

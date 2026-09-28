import type { Metadata } from "next";
import "./globals.css";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_BOOTSTRAP } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Palang AI",
  description: "LLM security gateway dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script sets the theme class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}

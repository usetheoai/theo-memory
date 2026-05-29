import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeBootstrap } from "@/components/theme-bootstrap";

export const metadata: Metadata = {
  title: "TheMemory — Chat that remembers",
  description:
    "Professional demo of @usetheo/memory wired into a @usetheo/sdk agent surface, with @usetheo/ui primitives.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeBootstrap>{children}</ThemeBootstrap>
      </body>
    </html>
  );
}

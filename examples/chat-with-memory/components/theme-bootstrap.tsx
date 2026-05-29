"use client";

import { ThemeProvider, builtinThemes } from "@usetheo/ui";
import type { ReactNode } from "react";

export function ThemeBootstrap({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider themes={builtinThemes} defaultTheme="violet-forge" defaultMode="dark">
      {children}
    </ThemeProvider>
  );
}

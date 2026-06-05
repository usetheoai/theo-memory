import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import HomePage from "./page";
import "./globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeBootstrap>
      <HomePage />
    </ThemeBootstrap>
  </StrictMode>,
);

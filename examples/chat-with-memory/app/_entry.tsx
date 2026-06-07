import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TheoUIProvider, Toaster } from "@theokit/ui";
import HomePage from "./page";
import "./globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <TheoUIProvider>
      <Toaster>
        <HomePage />
      </Toaster>
    </TheoUIProvider>
  </StrictMode>,
);

// Entry point for esbuild bundling — exports exportToSvg for browser use
import { exportToSvg } from "@excalidraw/utils";
window.exportToSvg = exportToSvg;
window.__moduleReady = true;

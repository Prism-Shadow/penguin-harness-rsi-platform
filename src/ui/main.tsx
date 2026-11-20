/**
 * The iframe app's entry: the UI package's stylesheet first (the build links it with
 * `data-penguin-ui`, see vite-penguin-ui-link.ts), the page's own utilities after it, then the app.
 */
import "@prismshadow/penguin-ui/styles.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

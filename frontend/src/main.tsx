import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { FavoriteProvider } from "./favorites/FavoriteProvider";
import { logError } from "./logger";
import { ThemeProvider } from "./theme/ThemeProvider";

declare global {
  interface Window {
    __liveSetListGlobalErrorLoggingAttached?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__liveSetListGlobalErrorLoggingAttached) {
  window.addEventListener("error", (event) => {
    logError("window_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack ?? null : null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logError("window_unhandledrejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack ?? null : null,
    });
  });

  window.__liveSetListGlobalErrorLoggingAttached = true;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <FavoriteProvider>
          <App />
        </FavoriteProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

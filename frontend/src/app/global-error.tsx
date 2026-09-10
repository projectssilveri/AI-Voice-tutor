"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for a failure in the ROOT layout itself.
 *
 * `error.tsx` sits inside the root layout, so it cannot catch an error thrown
 * by that layout — the providers, the font loader, the theme setup. When that
 * happens there is no layout left to render into, which is why this file has
 * to supply its own `<html>` and `<body>`.
 *
 * It should essentially never be seen. That is the point: the alternative is a
 * blank document with no styles, no markup, and no way out.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root layout failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* Inline styles on purpose: if the root layout failed, the stylesheet
            it imports may never have loaded. */}
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "32rem" }}>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
              Voice Tutor LMS is temporarily unavailable
            </h1>
            <p style={{ color: "#667085", marginBottom: "1.5rem" }}>
              Something failed while starting the application. Please try again
              shortly.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#465FFF",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {error.digest ? (
              <p
                style={{
                  marginTop: "1.5rem",
                  fontSize: "0.75rem",
                  color: "#98A2B3",
                  fontFamily: "monospace",
                }}
              >
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}

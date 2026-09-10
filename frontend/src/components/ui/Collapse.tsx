"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * An accordion panel that opens and closes at a real height.
 *
 * Both accordions in the app (`CurriculumAccordion`, `ModuleAccordion`) simply
 * mounted and unmounted their body, so a module snapped open and everything
 * below it jumped down the page by however tall the panel happened to be. On a
 * curriculum list that is the whole page moving under the cursor you were
 * about to click with.
 *
 * `height: auto` is the reason this uses framer-motion rather than a CSS
 * transition: CSS cannot interpolate to `auto`, and the usual workaround —
 * animating `max-height` to a guessed value — either clips a long panel or
 * makes a short one appear to pause before it finishes.
 *
 * `overflow-hidden` only while animating: leaving it on permanently would clip
 * anything the panel legitimately overflows with, such as a focus ring on its
 * last row.
 */
export default function Collapse({
  open,
  children,
  id,
}: {
  open: boolean;
  children: ReactNode;
  id?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          id={id}
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.26, ease: [0.22, 1, 0.36, 1] },
            // Opacity trails the height slightly on the way in, so the content
            // appears in a box that already exists rather than growing with it.
            opacity: { duration: 0.2, delay: open ? 0.06 : 0 },
          }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

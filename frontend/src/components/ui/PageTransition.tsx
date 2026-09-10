"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

import type { ReactNode } from "react";

/**
 * A short slide between routes.
 *
 * Navigation was a hard cut: the old page vanished and the new one appeared in
 * the same frame, which at a glance is indistinguishable from the page having
 * reloaded. A ~180ms move is enough to read as "this changed" rather than
 * "this restarted", and short enough that nobody waits for it.
 *
 * IT DELIBERATELY DOES NOT ANIMATE OPACITY.
 *
 * The first version faded from `opacity: 0`, and that was a blank-page bug.
 * Browsers suspend animation frames in a hidden tab, so an animation that
 * starts at zero opacity never progresses and the element stays invisible —
 * and this component wraps *every page in the app*. This product opens things
 * in background tabs on purpose (voice sessions, exams and certificate PDFs
 * all use target="_blank"), so a whole page rendering blank until focused was
 * not a hypothetical. Caught by walking the opacity of a real page's ancestor
 * chain, not by looking at it.
 *
 * Animating transform only means the page is fully readable at every point of
 * the animation, and completely readable if the animation never runs at all.
 * No decorative effect gets to decide whether content is visible.
 *
 * Keyed on the pathname so React remounts on navigation — that is what makes
 * it re-run. No exit animation and no `AnimatePresence`: an exit has to finish
 * before the next route mounts, which would add its duration to every
 * navigation for very little in return.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ y: 6 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

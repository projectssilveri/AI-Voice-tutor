import { cn } from "@/lib/cn";

import Container from "./Container";

import type { ReactNode } from "react";

/**
 * A page section, and the only place vertical rhythm is decided.
 *
 * Measured on the old home page, section padding was `py-16 md:py-20 lg:py-28`
 * on some sections, `pb-16 pt-[120px] md:pb-[120px] md:pt-[150px]` on others,
 * and 112px computed on three that were meant to match. Every new section
 * picked its own numbers, so the page had no rhythm to read.
 *
 * `tight` and `loose` exist because a run of short sections needs less air
 * than a hero does, not because a caller wants a different number.
 */
export default function Section({
  children,
  className,
  containerClassName,
  size = "default",
  container = "default",
  id,
  bare = false,
}: {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  size?: "tight" | "default" | "loose";
  container?: "narrow" | "default" | "wide";
  id?: string;
  /** Skip the container. For sections that bleed to the viewport edge. */
  bare?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative",
        size === "tight" && "py-14 md:py-20",
        size === "default" && "py-20 md:py-28 lg:py-32",
        size === "loose" && "py-24 md:py-36 lg:py-44",
        className,
      )}
    >
      {bare ? (
        children
      ) : (
        <Container size={container} className={containerClassName}>
          {children}
        </Container>
      )}
    </section>
  );
}

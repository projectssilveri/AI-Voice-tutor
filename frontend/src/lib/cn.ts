import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes, letting the caller's win.
 *
 * `clsx` flattens conditionals; `twMerge` resolves conflicts by specificity of
 * *intent* rather than source order — so a component's own `px-5` is dropped
 * when a caller passes `px-8`, instead of both landing in the class list and
 * the outcome depending on which one Tailwind happened to emit first.
 *
 * Both packages were already installed and effectively unused (one import in
 * `components/form/Label.tsx`). This is the seam the Button and Card variants
 * are built on.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

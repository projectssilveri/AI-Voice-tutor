"use client";

import { useEffect } from "react";

/**
 * Gives every `.table-wide` cell the name of its column, so phones can stack.
 *
 * WHY THIS EXISTS. Below 768px the CSS in `globals.css` turns these tables into
 * one card per row: the header is hidden, and each cell draws its own label
 * from `content: attr(data-label)`. Something has to put that attribute there,
 * and the honest options were to hand-write it onto roughly sixty cells across
 * six files — where the next column somebody adds silently ships unlabelled —
 * or to read it off the `<thead>` that already says it. This reads it.
 *
 * WHAT IT SKIPS, and why each one:
 *
 *   * a cell that already has `data-label` — somebody wrote a better one;
 *   * a cell spanning the row, which is an inline editor rather than a column
 *     and has no header to borrow from;
 *   * a cell holding only controls, where "Actions: [Edit] [Delete]" is worse
 *     than the buttons on their own.
 *
 * It re-stamps on DOM changes because these tables filter, sort and paginate,
 * and a row that arrives after the first pass would otherwise be a card of
 * unlabelled values. The observer watches for added nodes only, and setting an
 * attribute does not itself trigger one, so it cannot feed itself.
 */
export default function StackedTableLabels() {
  useEffect(() => {
    const stamp = () => {
      document.querySelectorAll<HTMLTableElement>("table.table-wide").forEach(
        (table) => {
          const headers = Array.from(table.querySelectorAll("thead th")).map(
            (th) => th.textContent?.trim() ?? "",
          );
          if (headers.length === 0) return;

          table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
            Array.from(row.cells).forEach((cell, index) => {
              if (cell.hasAttribute("data-label")) return;
              if (cell.colSpan > 1) return;

              // Controls only: no text of its own worth labelling.
              const text = cell.textContent?.trim() ?? "";
              const onlyControls =
                text.length === 0 ||
                cell.querySelector(".cell-actions") !== null;
              if (onlyControls) {
                cell.setAttribute("data-label", "");
                return;
              }

              const label = headers[index];
              if (label) cell.setAttribute("data-label", label);
            });
          });
        },
      );
    };

    stamp();

    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.addedNodes.length > 0)) stamp();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

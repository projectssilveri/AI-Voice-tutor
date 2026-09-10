/**
 * One item in the marketing nav.
 *
 * `path` was optional and there was a `submenu` array, both from the template's
 * dropdown support: a parent item with children had no destination of its own.
 * Nothing on this site has ever used a dropdown, so the optionality bought
 * nothing and cost three `string | undefined` errors the moment the header was
 * rewritten without the template's non-null assertions.
 */
export type Menu = {
  id: number;
  title: string;
  path: string;
  newTab: boolean;
};

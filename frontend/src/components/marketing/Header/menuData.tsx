import { Menu } from "@/types/menu";

/**
 * The top-level nav.
 *
 * Two changes from the template's list. "Home" is gone, because the logo to
 * its left already goes there and a nav that spends its first slot on the page
 * you can always reach is wasting it. And `/how-it-works` and `/business` are
 * in, because both pages existed with no link to them anywhere in the header —
 * `/business` in particular is the page that sells to companies.
 *
 * Contact moved to the footer. It is the last thing someone looks for, not the
 * fifth thing.
 */
const menuData: Menu[] = [
  {
    id: 1,
    title: "Courses",
    path: "/courses",
    newTab: false,
  },
  {
    id: 2,
    title: "Bundles",
    path: "/bundles",
    newTab: false,
  },
  {
    id: 3,
    title: "Pricing",
    path: "/pricing",
    newTab: false,
  },
  {
    id: 4,
    title: "How it works",
    path: "/how-it-works",
    newTab: false,
  },
  {
    id: 5,
    title: "For teams",
    path: "/business",
    newTab: false,
  },
];

export default menuData;

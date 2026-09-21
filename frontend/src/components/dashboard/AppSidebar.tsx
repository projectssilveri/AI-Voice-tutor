"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo, { LogoMark } from "@/components/marketing/ui/Logo";
import { useAuth } from "@/context/AuthContext";
import { getMyOrganizationSlug } from "@/lib/orgPortal";
import { listMyCourses } from "@/lib/student";
import { useSidebar } from "@/context/SidebarContext";
import {
  BoxCubeIcon,
  ChevronDownIcon,
  FolderIcon,
  GridIcon,
  GroupIcon,
  HorizontaLDots,
  ListIcon,
  MailIcon,
  PageIcon,
  PieChartIcon,
  TableIcon,
  TaskIcon,
} from "@/icons";

export type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

// Student navigation. Routes marked as build-order steps do not exist yet;
// they are added as each step lands so the shell doesn't have to be rewired.
export const navItems: NavItem[] = [
  {
    icon: <GridIcon />,
    name: "Dashboard",
    path: "/dashboard",
  },
  {
    icon: <BoxCubeIcon />,
    name: "Courses",
    path: "/learn",
  },
  {
    icon: <ListIcon />,
    name: "Assignments",
    path: "/assignments",
  },
  {
    icon: <PageIcon />,
    name: "Certificates",
    path: "/certification",
  },
];

// Admin navigation. Hidden from non-admins below, but hiding is presentation,
// not authorisation — every route behind these is gated server-side by
// `require_role("admin")` in the FastAPI backend, and a student who types the
// URL still gets a 403.
export const othersItems: NavItem[] = [
  { icon: <GridIcon />, name: "Overview", path: "/admin" },
  { icon: <TaskIcon />, name: "Submissions", path: "/admin/assignments" },
  // Two inboxes, two entries. They are genuinely different things — one is
  // strangers with no account writing in from the public form, the other is
  // people who are signed in — and folding them into one "Messages" link meant
  // half the mail arrived somewhere nobody looked.
  { icon: <MailIcon />, name: "Private messages", path: "/admin/messages" },
  { icon: <MailIcon />, name: "Contact messages", path: "/admin/contact" },
  { icon: <GroupIcon />, name: "Users", path: "/admin/users" },
  { icon: <PieChartIcon />, name: "AI usage", path: "/admin/usage" },
  { icon: <TableIcon />, name: "Refunds", path: "/admin/refunds" },
  {
    icon: <TableIcon />,
    name: "Attempt grants",
    path: "/admin/attempt-grants",
  },
  { icon: <TableIcon />, name: "Training report", path: "/admin/reports" },
  { icon: <ListIcon />, name: "Audit trail", path: "/admin/audit" },
];

// Super-admin only. Creating tenants sits with revenue and role management
// (decision 50), so an ordinary admin cannot use this — and showing them a
// nav item that always lands on "not available to your account" is a menu
// entry that exists only to be refused.
export const superAdminItems: NavItem[] = [
  // APPROVALS FIRST, because it is the only item here that represents somebody
  // else being blocked. It had no menu entry at all — the queue was embedded on
  // the Website screen and rendered nothing when empty, so the feature was
  // invisible unless work happened to be waiting. Issues 34 and 35.
  {
    icon: <TaskIcon />,
    name: "Course approvals",
    path: "/admin/reviews",
  },
  // MOVED UP FROM THE ADMIN MENU (issue 11). Writing the catalogue is a super
  // admin job now, and a platform admin who could still see this link would
  // find out by pressing it and being refused.
  {
    icon: <FolderIcon />,
    name: "Add or modify courses",
    path: "/admin/courses",
  },
  // Bundles: the money screen, sitting with the rest of the owner-only things
  // rather than beside "Add or modify courses" — authoring a course and pricing
  // a package are different jobs.
  {
    icon: <TableIcon />,
    name: "Bundles and packages",
    path: "/admin/bundles",
  },
  {
    icon: <BoxCubeIcon />,
    name: "Organizations",
    path: "/admin/organizations",
  },
  // Customer training, kept apart from "Add or modify courses" above. The two
  // are genuinely different things — one is the catalogue we sell, the other is
  // a customer's private material that we can see for support and do not own —
  // and one menu called "Courses" holding both invited the mistake decision 170
  // records, where an admin renamed and then deleted a customer's course.
  {
    icon: <FolderIcon />,
    name: "Customer training",
    path: "/admin/customer-training",
  },
  { icon: <PageIcon />, name: "Website", path: "/admin/website" },
];

const AppSidebar: React.FC = () => {
  // An organization member sees no marketplace. Their employer bought the
  // training; there is nothing here for them to buy, and a Pricing link would
  // lead to a page whose every course the API refuses them.
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const { user } = useAuth();
  // Super admin is above admin, so it sees the admin section too.
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";
  // "Overview" is the platform KPI page, and a super admin has a wider one of
  // their own on every screen below. Dropped from their menu on request — an
  // ordinary admin still gets it, because for them it is the only summary
  // there is.
  const adminItems = isSuperAdmin
    ? othersItems.filter((item) => item.path !== "/admin")
    : othersItems;
  // DOES THIS PERSON ACTUALLY LEARN HERE?
  //
  // Courses, Assignments and Certificates were shown to everybody, so a
  // super admin whose job is running the business opened the app to a menu
  // offering them their own coursework — three links to screens that, for them,
  // are permanently empty. Issue 9.
  //
  // NOT decided by role. A super admin may genuinely be enrolled in something,
  // and hiding a course somebody is actually taking because of their job title
  // would be the same mistake pointed the other way. So it is decided by
  // whether they have any enrolments: staff who learn keep the menu, staff who
  // do not lose it, and every student has at least the free course.
  //
  // Dashboard always stays. It is the page they land on.
  const [enrolments, setEnrolments] = useState<number | null>(null);
  const isStaff = user?.role === "admin" || user?.role === "super_admin";

  useEffect(() => {
    if (!user || !isStaff) {
      // A student is a student. No request, no flicker.
      setEnrolments(null);
      return;
    }
    let cancelled = false;
    listMyCourses()
      .then((courses) => {
        if (!cancelled) setEnrolments(courses.length);
      })
      .catch(() => {
        // Show the menu rather than hide it on a failed request. Hiding
        // navigation because one call failed is worse than an extra link.
        if (!cancelled) setEnrolments(1);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isStaff]);

  // `null` means "not staff, so not in question". `0` means staff with nothing
  // enrolled, which is the only case that hides anything.
  const learnerItems =
    isStaff && enrolments === 0
      ? navItems.filter((item) => item.path === "/dashboard")
      : navItems;

  const inOrganization = user?.organization_id != null;
  // The slug is not on the session — it is the organization's, not the
  // person's — so it is fetched once when there is an organization to fetch
  // it for. A public user costs no request.
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  useEffect(() => {
    if (!inOrganization) {
      setOrgSlug(null);
      return;
    }
    let cancelled = false;
    getMyOrganizationSlug()
      .then((slug) => {
        if (!cancelled) setOrgSlug(slug);
      })
      .catch(() => {
        // No link rather than a broken one.
      });
    return () => {
      cancelled = true;
    };
  }, [inOrganization]);

  const renderMenuItems = (
    navItems: NavItem[],
    menuType: "main" | "others",
  ) => (
    <ul className="flex flex-col gap-4">
      {navItems.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              aria-label={nav.name}
              aria-expanded={
                openSubmenu?.type === menuType && openSubmenu?.index === index
              }
              className={`menu-item group  ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={` ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200  ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500 dark:text-brand-400"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                // THE NAME, ALWAYS. The label span below is only RENDERED when
                // the sidebar is open, so in the collapsed state — which is
                // the normal one on a narrow window — every item was a link
                // containing nothing but an icon, and a screen reader
                // announced eleven links called "link". The label is the same
                // string the span shows, so nothing changes when it is
                // visible.
                aria-label={nav.name}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-[height] duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {},
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => path === pathname;
  const isActive = useCallback((path: string) => path === pathname, [pathname]);

  useEffect(() => {
    // Check if the current path matches any submenu item
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    // If no submenu item matches, close the open submenu
    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [pathname, isActive]);

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-[width,transform] duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
              ? "w-[290px]"
              : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`py-8 flex  ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/dashboard">
          {isExpanded || isHovered || isMobileOpen ? (
            // Same as the header beside it: `Logo` inherits now.
            <Logo className="text-gray-900 dark:text-white" />
          ) : (
            <LogoMark className="size-8" />
          )}
        </Link>
      </div>
      <div className="flex flex-col overflow-y-auto no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div role="group" aria-label="Main menu">
              {/* A LABEL, NOT A HEADING.
                  These two 12px grey words sit before the page's own <h1> in
                  the DOM, so as <h2> they made every dashboard page's outline
                  read "Menu, Admin, Platform overview" — the sidebar's
                  categories announced as sections of the page, outranking its
                  title. And when the sidebar is collapsed the label is a dots
                  icon, so it was a heading with no words in it at all.

                  A div for the eye, `aria-label` on the group for everything
                  else: the links are still grouped and still named, and the
                  page's real headings are its own again. */}
              <div
                aria-hidden="true"
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-500 dark:text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  "Menu"
                ) : (
                  <HorizontaLDots />
                )}
              </div>
              {renderMenuItems(learnerItems, "main")}

              {/* A way back to the organization portal. An org member arrives
                  here from /org/{slug} and would otherwise have no route
                  home — the marketing header is not part of this shell. */}
              {inOrganization && orgSlug ? (
                <div className="mt-6">
                  <Link
                    href={`/org/${orgSlug}`}
                    // Same reason as the nav items above: the label below is
                    // not rendered while the sidebar is collapsed.
                    aria-label="My organization"
                    className="menu-item menu-item-inactive"
                  >
                    <BoxCubeIcon />
                    {isExpanded || isHovered || isMobileOpen ? (
                      <span className="menu-item-text">My organization</span>
                    ) : null}
                  </Link>
                </div>
              ) : null}
            </div>

            {isAdmin ? (
              <div role="group" aria-label="Platform admin menu">
                {/* Same as above: a category label for the eye, named for
                    assistive tech by the group rather than by a heading. */}
                <div
                  aria-hidden="true"
                  className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-500 dark:text-gray-400 ${
                    !isExpanded && !isHovered
                      ? "lg:justify-center"
                      : "justify-start"
                  }`}
                >
                  {isExpanded || isHovered || isMobileOpen ? (
                    "Platform"
                  ) : (
                    <HorizontaLDots />
                  )}
                </div>
                {renderMenuItems(
                  isSuperAdmin
                    ? [...adminItems, ...superAdminItems]
                    : adminItems,
                  "others",
                )}
              </div>
            ) : null}
          </div>
        </nav>
        {/* {isExpanded || isHovered || isMobileOpen ? <SidebarWidget /> : null} */}
      </div>
    </aside>
  );
};

export default AppSidebar;

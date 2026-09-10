import Footer from "@/components/marketing/Footer";
import Header from "@/components/marketing/Header";
import ScrollToTop from "@/components/marketing/common/ScrollToTop";
import PageTransition from "@/components/ui/PageTransition";

/**
 * `data-surface="marketing"` is what makes the public site dark.
 *
 * It pins the `--mk-*` tokens defined in globals.css, independently of the
 * `.dark` class the dashboard toggle drives. The two must not be the same
 * switch: the shop window should not change colour because a student prefers
 * a light dashboard, and the dashboard should not go dark because someone
 * visited the pricing page.
 *
 * `min-h-screen` so a short page (privacy, a 404) still paints the dark
 * canvas all the way down instead of leaving a lighter band below the footer.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-surface="marketing"
      className="flex min-h-screen flex-col bg-[var(--mk-canvas)] text-[var(--mk-text)]"
    >
      <Header />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer />
      <ScrollToTop />
    </div>
  );
}

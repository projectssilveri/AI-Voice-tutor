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
      className="relative flex min-h-screen flex-col overflow-x-hidden bg-[var(--mk-canvas)] text-[var(--mk-text)]"
    >
      {/* Background ambient lighting and grid pattern across all marketing pages */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* Subtle mesh grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        
        {/* Floating gradient orbs */}
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] h-[450px] w-[450px] rounded-full bg-purple-600/10 blur-[140px]" />
        <div className="absolute top-[60%] left-[5%] h-[500px] w-[500px] rounded-full bg-cyan-600/8 blur-[150px]" />
      </div>

      <Header />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <Footer />
      <ScrollToTop />
    </div>
  );
}

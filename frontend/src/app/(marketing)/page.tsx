import type { Metadata } from "next";

import ClosingCta from "@/components/marketing/ClosingCta";
import CourseGrid from "@/components/marketing/Courses/CourseGrid";
import Features from "@/components/marketing/Features";
import Hero from "@/components/marketing/Hero";
import HowItWorks from "@/components/marketing/HowItWorks";
import InterruptMoment from "@/components/marketing/InterruptMoment";
import ProofStrip from "@/components/marketing/ProofStrip";
import ScrollUp from "@/components/marketing/common/ScrollUp";

export const metadata: Metadata = {
  title: "Learn by talking to an AI tutor",
  description:
    "Spoken micro-lectures per module, interruptible mid-sentence, grounded " +
    "in the material you are actually studying.",
};

/**
 * The order here is the argument the page makes.
 *
 * Show the product, prove it is real, explain the one thing it does that
 * nothing else does, then how, then what else is in the box, then what you can
 * buy, then ask.
 *
 * `WhatMakesItDifferent` used to sit at the bottom repeating four of the six
 * points `Features` had already made. It is gone; `InterruptMoment` makes its
 * one genuinely different claim properly, and the rest folded into the feature
 * grid.
 *
 * `CourseGrid` is capped at 6. It rendered all 11 before, in a section 2,797px
 * tall — over half the page, spent on a list that has its own page.
 */
export default function HomePage() {
  return (
    <>
      <ScrollUp />
      <Hero />
      <ProofStrip />
      <InterruptMoment />
      <HowItWorks />
      <Features />
      <CourseGrid limit={6} />
      <ClosingCta />
    </>
  );
}

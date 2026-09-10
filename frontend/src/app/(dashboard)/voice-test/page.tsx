import type { Metadata } from "next";

import RequireAuth from "@/components/auth/RequireAuth";
import VoiceTestHarness from "@/components/voice-session/VoiceTestHarness";

export const metadata: Metadata = {
  title: "Voice test",
};

/**
 * The voice loop, proved in isolation against a hardcoded lesson.
 *
 * ADMIN ONLY, matching `/voice/ws/test` on the backend, which additionally
 * refuses to run in production at all. The socket is what actually enforces
 * this — a client guard is presentation — but without the guard here any
 * signed-in student could open the screen, press start, and watch it fail for
 * reasons they cannot act on.
 *
 * THE DOCSTRING THAT USED TO BE HERE SAID "no auth", AND THAT STOPPED BEING
 * TRUE. The socket was open to anyone once, which made it a way for a stranger
 * to open paid Gemini sessions on our key without an account; `voice.py` now
 * records that and gates it. A comment describing the old behaviour is worse
 * than none, because it is the thing somebody reads before deciding whether
 * this screen is safe to leave in.
 *
 * It also said "deleted once step 6 wires the real session". Step 6 shipped
 * and this stayed, because proving the voice loop against a known lesson with
 * no module or enrolment in the way is genuinely useful when something breaks.
 */
export default function VoiceTestPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <VoiceTestHarness />
    </RequireAuth>
  );
}

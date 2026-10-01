/**
 * Time spent with the tutor, said the same way on every screen.
 *
 * Each screen used to floor seconds to whole minutes on its own, so a
 * 40-second session read "0 min" in the Users table while the audit trail
 * recorded 40 seconds and the dashboard total counted them. One format, from
 * seconds, so the numbers agree wherever they appear.
 */
export function tutorTime(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  if (total === 0) return "0 min";
  if (total < 60) return `${total} sec`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return rest > 0 ? `${minutes} min ${rest} sec` : `${minutes} min`;
}

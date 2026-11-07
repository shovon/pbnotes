import type { LucideIcon } from "lucide-react";

/**
 * A Lucide icon at the app's one size and weight (#313): 16px, with a stroke
 * that matches the hand-drawn sidebar toggle's (Lucide's own default, 2 on a
 * 24px grid, reads heavy at 16px). It takes the colour of the text around it,
 * and it is decoration: the control it sits in carries the name.
 */
export default function Icon({
  of: Glyph,
  className,
}: {
  of: LucideIcon;
  className?: string;
}) {
  return (
    <Glyph
      size={16}
      strokeWidth={1.5}
      aria-hidden
      className={`shrink-0 ${className ?? ""}`}
    />
  );
}

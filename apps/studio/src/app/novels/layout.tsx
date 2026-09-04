import { requireSession } from "@/lib/session";

/**
 * Nothing but the gate. A manuscript is the most private thing on the
 * platform, and `/novels` holds both the workspace and the wizard — a layout
 * here means a route added under either is signed-in by default rather than by
 * whoever remembers to check.
 */
export default async function NovelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return children;
}

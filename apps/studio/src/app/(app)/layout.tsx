import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/session";

/**
 * The signed-in shell, applied to everything except `/novels/*` and
 * `/sign-in`. A route group rather than a path segment, so adding the chrome
 * changed no URL.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Before the chrome, not after: a shell drawn around a dead session is the
  // "Unauthorized" panel this used to show.
  await requireSession();
  return <AppShell>{children}</AppShell>;
}

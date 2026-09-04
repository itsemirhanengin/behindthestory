import { AppShell } from "@/components/app-shell";

/**
 * The signed-in shell, applied to everything except `/novels/*` and
 * `/sign-in`. A route group rather than a path segment, so adding the chrome
 * changed no URL.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

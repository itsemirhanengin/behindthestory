import { NovelSidebar } from "@/components/novel-sidebar";
import { NovelWorkspaceProvider } from "@/components/novel-workspace";

export default async function NovelLayout({
  children,
  params,
}: LayoutProps<"/novels/[novelId]">) {
  const { novelId } = await params;
  return (
    <NovelWorkspaceProvider>
      <div className="isolate flex h-dvh w-full overflow-hidden">
        <NovelSidebar novelId={novelId} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </NovelWorkspaceProvider>
  );
}

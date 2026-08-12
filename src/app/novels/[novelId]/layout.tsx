import { NovelSidebar } from "@/components/novel-sidebar";

export default async function NovelLayout({
  children,
  params,
}: LayoutProps<"/novels/[novelId]">) {
  const { novelId } = await params;
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <NovelSidebar novelId={novelId} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type NovelWorkspaceValue = {
  sidebarOpen: boolean;
  mobileNavigationOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setMobileNavigationOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const NovelWorkspaceContext = createContext<NovelWorkspaceValue | null>(null);

export function NovelWorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("storyforge:sidebar-open");
      if (saved !== null) setSidebarOpen(saved === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const value = useMemo<NovelWorkspaceValue>(
    () => ({
      sidebarOpen,
      mobileNavigationOpen,
      setSidebarOpen: (open) => {
        setSidebarOpen(open);
        window.localStorage.setItem("storyforge:sidebar-open", String(open));
      },
      setMobileNavigationOpen,
      toggleSidebar: () => {
        setSidebarOpen((open) => {
          window.localStorage.setItem("storyforge:sidebar-open", String(!open));
          return !open;
        });
      },
    }),
    [mobileNavigationOpen, sidebarOpen],
  );

  return (
    <NovelWorkspaceContext.Provider value={value}>
      {children}
    </NovelWorkspaceContext.Provider>
  );
}

export function useNovelWorkspace() {
  const context = useContext(NovelWorkspaceContext);
  if (!context) {
    throw new Error("useNovelWorkspace must be used inside NovelWorkspaceProvider");
  }
  return context;
}

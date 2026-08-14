"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Paper by day, ink by night. Rendered as a placeholder until mounted, because
 * the resolved theme is only known on the client and a guessed icon would flip
 * in front of the reader.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const night = resolvedTheme === "dark";

  if (!mounted) {
    return <div aria-hidden className={`size-8 ${className ?? ""}`} />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={night ? "Switch to paper" : "Switch to ink"}
          onClick={() => setTheme(night ? "light" : "dark")}
        >
          {night ? <RiMoonLine className="size-4" /> : <RiSunLine className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{night ? "Ink" : "Paper"}</TooltipContent>
    </Tooltip>
  );
}

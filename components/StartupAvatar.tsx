"use client";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { companyInitials } from "@/lib/logos/initials";

const SIZES = { sm: "size-6 text-xs rounded-md", md: "size-11 text-base", lg: "size-14 text-xl" };

/** Company mark: verified logo when `src` loads, otherwise initials. A broken remote image never stays on screen. */
export function StartupAvatar({ name, size = "md", className, src }: { name: string; size?: keyof typeof SIZES; src?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const showImg = !!src && !broken;
  return (
    <Avatar className={cn(SIZES[size], className)}>
      {showImg && (
        // Server-proxied logos stay on 'self' (CSP). onError falls back to initials, never another company's mark.
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      )}
      <AvatarFallback className={showImg ? "hidden" : undefined}>{companyInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

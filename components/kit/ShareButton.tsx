"use client";
import { ShareIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/kit/Toast";
import { shareLink } from "@/lib/client-download";

/** Shares the current page: the device share sheet where available, otherwise copies the link. */
export function ShareButton({ title, label = "Share", variant = "outline" }: { title: string; label?: string; variant?: "outline" | "ghost" }) {
  const { toast } = useToast();
  async function go() {
    const r = await shareLink(title, window.location.href);
    if (r === "copied") toast("Link copied");
    else if (r === "failed") toast("Couldn't share. Copy the address from your browser.", "error");
  }
  return <Button type="button" variant={variant} onClick={go}><ShareIcon />{label}</Button>;
}

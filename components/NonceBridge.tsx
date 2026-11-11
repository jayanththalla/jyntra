"use client";
// Radix (Select, Dialog, Sheet) lock page scroll through react-remove-scroll, which injects a <style> element at runtime. Under our
// nonce-based CSP that element is blocked unless it carries the per-request nonce. The library reads the nonce through get-nonce,
// which Next never fills in, so it is handed over here. Without this, open selects/dialogs log CSP violations in production.
import { setNonce } from "get-nonce";

export function NonceBridge({ nonce }: { nonce?: string }) {
  if (nonce) setNonce(nonce); // runs during hydration, before any control can be opened
  return null;
}

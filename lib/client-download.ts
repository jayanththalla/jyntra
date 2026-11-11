/** Save text as a file in the browser (no server round trip). */
export function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Share a link with the device share sheet when there is one, otherwise copy it. Returns what happened. */
export async function shareLink(title: string, url: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) { await navigator.share({ title, url }); return "shared"; }
    await navigator.clipboard.writeText(url); return "copied";
  } catch (e) { return (e as Error)?.name === "AbortError" ? "shared" : "failed"; }
}

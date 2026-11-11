import { cn } from "@/lib/utils"

/** The bone: one soft purple-grey block with the shared shimmer (see .sk-shimmer in globals.css). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("sk-shimmer rounded-md", className)} {...props} />
}

export { Skeleton }

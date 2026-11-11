import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h2 className="text-3xl font-bold tracking-tight">404 - Page Not Found</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The page or startup you are looking for does not exist or has been removed.
      </p>
      <Button asChild className="mt-6 bg-brand-gradient text-white hover:opacity-90">
        <Link href="/dashboard">Return to Dashboard</Link>
      </Button>
    </div>
  );
}

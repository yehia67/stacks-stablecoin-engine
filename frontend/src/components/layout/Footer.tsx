import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="container flex flex-col items-center justify-between gap-4 py-6 md:h-16 md:flex-row md:py-0">
        <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built on{" "}
            <Link
              href="https://stacks.co"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4 hover:text-primary"
            >
              Stacks
            </Link>
            . Powered by Bitcoin.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <Link
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-5 w-5" />
            <span className="sr-only">GitHub</span>
          </Link>
          <Link
            href="/docs"
            className="text-muted-foreground hover:text-primary"
          >
            <FileText className="h-5 w-5" />
            <span className="sr-only">Documentation</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}

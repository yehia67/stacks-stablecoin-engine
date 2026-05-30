"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus, X, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Bump this key to re-show the banner to users who previously dismissed it
// (e.g. for a new launch phase / announcement).
const BANNER_DISMISS_KEY = "sse-soft-launch-banner-v1";
const FEEDBACK_EMAIL = "hello@stablecoin-engine.com";

type FeedbackType = "Bug" | "Feature request" | "Enhancement" | "Other";
type SubmitState = "idle" | "loading" | "success" | "error";

export function SoftLaunchFeedback() {
  const [bannerOpen, setBannerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Read dismissal only on the client to avoid hydration mismatch.
  useEffect(() => {
    try {
      setBannerOpen(localStorage.getItem(BANNER_DISMISS_KEY) !== "1");
    } catch {
      setBannerOpen(true);
    }
  }, []);

  const dismissBanner = () => {
    setBannerOpen(false);
    try {
      localStorage.setItem(BANNER_DISMISS_KEY, "1");
    } catch {
      /* ignore storage failure */
    }
  };

  return (
    <>
      {bannerOpen && (
        <div className="border-b border-yellow-500/40 bg-yellow-500/10">
          <div className="container flex items-center justify-between gap-3 px-4 py-2">
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              <span className="font-semibold">Soft mainnet launch.</span>{" "}
              Expect occasional errors. Hit a bug or have an idea? Please send us feedback.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Send feedback
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Dismiss"
                onClick={dismissBanner}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent floating entry point, available even after the banner is dismissed. */}
      <Button
        onClick={() => setDialogOpen(true)}
        className="fixed bottom-4 right-4 z-40 shadow-lg"
        size="sm"
      >
        <MessageSquarePlus className="mr-1 h-4 w-4" /> Feedback
      </Button>

      <FeedbackDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [type, setType] = useState<FeedbackType>("Bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");

  // Reset the form whenever the dialog is freshly opened.
  useEffect(() => {
    if (open) {
      setState("idle");
      setError("");
    }
  }, [open]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault?.();

    if (message.trim().length < 3) {
      setError("Please describe your feedback.");
      setState("error");
      return;
    }
    // Email is optional, but if provided it must be valid (so we can reply).
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email, or leave it blank.");
      setState("error");
      return;
    }

    const url = process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL;
    if (!url) {
      setError("Feedback endpoint not configured. Please email us instead.");
      setState("error");
      return;
    }

    setError("");
    setState("loading");
    try {
      // Google Apps Script web apps don't answer CORS preflight; send a simple
      // request (no custom headers, string body => text/plain) with no-cors.
      // The response is opaque, so a resolved fetch is treated as success.
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        body: JSON.stringify({
          type,
          message,
          email,
          source: "sse-web",
          page: typeof window !== "undefined" ? window.location.pathname : "",
          ts: new Date().toISOString(),
        }),
      });
      setState("success");
      setMessage("");
    } catch {
      setError("Something went wrong. Please try again, or email us directly.");
      setState("error");
    }
  };

  const mailtoHref = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
    `[SSE ${type}] feedback`
  )}&body=${encodeURIComponent(message)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            We&apos;re on a soft mainnet launch — your reports help. Bugs, feature
            requests, and ideas all welcome.
          </DialogDescription>
        </DialogHeader>

        {state === "success" ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-5 w-5" />
              Thanks! Your feedback was sent.
            </div>
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as FeedbackType)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Bug">Bug</option>
                <option value="Feature request">Feature request</option>
                <option value="Enhancement">Enhancement</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened, or what would you like to see?"
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Email <span className="text-muted-foreground">(optional, for follow-up)</span>
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {state === "error" && (
              <p className="flex items-center gap-1.5 text-sm text-red-500">
                <AlertTriangle className="h-4 w-4" /> {error}
              </p>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button type="submit" className="w-full" disabled={state === "loading"}>
                {state === "loading" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  "Send feedback"
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Prefer email?{" "}
                <a href={mailtoHref} className="text-primary hover:underline">
                  {FEEDBACK_EMAIL}
                </a>
              </p>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted">
        The page hit an unexpected error. Try again, or reload the page.
      </p>
      <button type="button" className="btn btn-primary mt-6" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}

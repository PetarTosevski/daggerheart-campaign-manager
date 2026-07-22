/**
 * Global header region that hosts the persistent campaign timeline. It is a
 * thin presentational wrapper; the timeline itself is passed as children so the
 * shell can fetch canonical state and stream it in behind a Suspense boundary.
 */
export function GlobalHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-stone-900/8 bg-white/45 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}

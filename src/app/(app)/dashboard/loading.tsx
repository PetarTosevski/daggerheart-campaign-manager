export default function DashboardLoading() {
  return (
    <main
      aria-label="Loading campaign dashboard"
      aria-busy="true"
      className="min-h-screen flex-1 bg-[#f4f0e8] px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-5 w-28 rounded-full bg-stone-300/70" />
        <div className="mt-4 h-10 w-72 max-w-full rounded-lg bg-stone-300/70" />
        <div className="mt-3 h-5 w-96 max-w-full rounded bg-stone-200" />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="h-[32rem] rounded-xl bg-stone-300/70" />
          <div className="h-[28rem] rounded-xl bg-white/80" />
        </div>
      </div>
      <span className="sr-only">Loading campaign Fear and history…</span>
    </main>
  );
}
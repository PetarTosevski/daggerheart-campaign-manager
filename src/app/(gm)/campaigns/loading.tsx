import { PageHeader } from "@/components/brand/brand";

/**
 * Instant feedback on the way to Load Campaign (PF1): the Chronicle board's header and three dim campaign bands,
 * announced politely, until the page's server payload arrives.
 */
export default function LoadCampaignLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-2 text-parchment">
      <PageHeader backHref="/" backLabel="Back to main menu" title="Load Campaign" />
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        data-testid="campaigns-loading"
        className="flex flex-col gap-4 px-4 pt-8 pb-10 sm:px-12"
      >
        <span className="sr-only">Loading campaigns…</span>
        {[0, 1, 2].map((band) => (
          <div
            key={band}
            aria-hidden="true"
            className="flex min-h-[150px] items-center gap-9 rounded-2xl border border-[#272434] bg-[#15141d] px-6 motion-safe:animate-pulse sm:px-10"
          >
            <div className="h-16 w-[100px] rounded-lg bg-[#1f1d2a] sm:w-[140px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="h-3 w-56 max-w-full rounded bg-[#1f1d2a]" />
              <div className="h-8 w-80 max-w-full rounded bg-[#1f1d2a]" />
              <div className="h-3 w-64 max-w-full rounded bg-[#1f1d2a]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

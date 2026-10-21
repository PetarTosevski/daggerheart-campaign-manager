/** The board's sigil: an open book with a quill (Lorekeeper.dc.html). Decorative; the heading names the Lorekeeper. */
export function SigilIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="#e3b45a" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9c4-2 8-2 12 1v15c-4-3-8-3-12-1Z" fill="rgba(227,180,90,.15)" />
      <path d="M28 9c-4-2-8-2-12 1v15c4-3 8-3 12-1Z" fill="rgba(227,180,90,.08)" />
      <path d="M19 5l7-3-4 8-4 2Z" fill="#e3b45a" stroke="none" />
      <path d="M18 12l-1 2" />
    </svg>
  );
}

/** The 52 px ringed sigil of the chat header (`lk-sigil`). */
export function Sigil() {
  return (
    <span className="lk-sigil">
      <SigilIcon size={30} />
    </span>
  );
}

/** The 36 px avatar beside an answer or the thinking row, and inside the drawer pill (`lk-mini`). */
export function MiniSigil() {
  return (
    <span className="lk-mini">
      <SigilIcon size={20} />
    </span>
  );
}

/**
 * Cast (plan combat-hud H3.4, answer 3b): "raises the hand". The HUD hand (H2.3 / H3.1, `hud/hand`) hangs its fan below
 * the screen's edge and raises a card while it has focus (hand.css `.hud-hc:focus-within`); "Hide cards" folds it. Cast
 * unfolds a folded hand (the same "Show cards" button the player would press) and moves focus to the first card whose
 * Use is enabled (else the first card), which raises it; Tab / Shift+Tab walk the fan from there. The hand is another
 * tracer's file, so this reaches it through its DOM contract (`data-testid` hooks it already ships), not an import.
 * Follow-up dcm-bxp.99.32.20: a `raiseHand()` export from hud/hand replaces this.
 *
 * Returns false when there is no hand of yours to raise (nothing happens then).
 */
export function raiseHand(root: ParentNode = document, frames = 6): boolean {
  const hand = root.querySelector<HTMLElement>('[data-testid="combat-hud"] [data-testid="hud-hand"][data-mode="own"]');
  if (!hand) return false;
  if (hand.dataset.folded === "true") {
    hand.querySelector<HTMLButtonElement>('[data-testid="hud-hand-hide"]')?.click();
  }
  focusCard(hand, frames);
  return true;
}

/** Focuses the first playable card once the fan is drawn (unfolding re-renders it: wait a few frames at most). */
function focusCard(hand: HTMLElement, frames: number) {
  const use = hand.querySelector<HTMLButtonElement>('[data-testid="hud-hand-card"] button.cmh-use:not(:disabled)');
  const card = use ?? hand.querySelector<HTMLElement>('[data-testid="hud-hand-card"]');
  if (card) {
    card.focus({ preventScroll: true });
    return;
  }
  if (frames > 0) requestAnimationFrame(() => focusCard(hand, frames - 1));
}

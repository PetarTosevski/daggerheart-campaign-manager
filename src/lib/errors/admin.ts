/**
 * Errors of Part B of the config plan (App admin, `.omc/plans/config.yaml` AD0-AD14). Contract: see `actionLog.ts`;
 * add this domain's codes here only. Tests and the UI key on the code, never the text.
 *
 * A non-owner calling an owner function gets the common `FORBIDDEN` (signed out: `UNAUTHENTICATED`); there is no
 * separate "admin only" code.
 */
export const adminMessages = {
  /** Any write while the owner has turned on read-only mode (AD10, Q31). */
  READ_ONLY_MODE: "The app is read-only for maintenance right now. Try again later.",
  /** A new account while sign-up is closed, or in read-only mode (AD4). */
  SIGN_UP_CLOSED: "New accounts are closed right now.",
  /** A new account in invite-only mode without a pending invite or a join link (AD4, Q18 a). */
  SIGN_UP_INVITE_ONLY: "New accounts need an invite. Ask your GM for an invite or a join link.",
  /** A GM at the campaigns-per-GM cap (AD5a, Q19). */
  CAP_CAMPAIGNS_PER_GM: "You've reached the number of campaigns one GM can run.",
  /** The app at its campaign cap (AD5a, Q19). */
  CAP_CAMPAIGNS_APP: "The app has reached its number of campaigns.",
  /** A campaign at its players cap (AD5b, Q19; co-GMs count, the creator doesn't). */
  CAP_PLAYERS: "This campaign has reached its number of players.",
  /** A player at the characters-per-campaign cap (AD5b, Q19; retired characters count). */
  CAP_CHARACTERS_PER_PLAYER: "You've reached the number of characters one player can have in this campaign.",
  /** The Lorekeeper at its spend limit with `atLimit: "pause"`, or past the 120% ceiling (AD6, Q20). */
  LOREKEEPER_PAUSED: "The Lorekeeper is paused until next month.",
  /** The caller's internet searches for today are used up (AD6). */
  LOREKEEPER_WEB_CAP: "You've used today's internet searches. The books still answer.",
  /** A feature the owner switched off for the caller (AF1, Q25). */
  FEATURE_OFF: "That feature is switched off right now.",
  /** A second limit request while one is open for the campaign (AD12, N10). */
  LIMIT_REQUEST_PENDING: "This campaign already has a request waiting for an answer.",
  /** A limit request while the owner doesn't take them (AD12; `allowGmRequests` off). */
  LIMIT_REQUESTS_OFF: "Requests for higher limits are switched off.",
  /** A campaign book over the campaign's book allowance (LB1). */
  BOOK_ALLOWANCE: "This campaign has no room for another book.",
  /** A PDF over 20 MB or 300 pages (PDF0). */
  BOOK_TOO_LARGE: "That book is too large. Books can be up to 20 MB and 300 pages.",
  /** A file that is not a PDF (type or magic bytes, PDF0). */
  BOOK_NOT_PDF: "Books must be PDF files.",
  /** A PDF whose text couldn't be read (scanned pages, damaged file; PDF0). */
  BOOK_PARSE_FAILED: "The text of that PDF couldn't be read.",
  /** A second upload of a book while its last one is still being read (AD8). */
  BOOK_INGEST_RUNNING: "That book is still being read. Wait for it to finish.",
  /** A write that met the owner's read-only view of a campaign (AD13, defence in depth). */
  OWNER_VIEW_READ_ONLY: "You're viewing this campaign read-only.",
  /** A suspended account (AD14, N11). */
  ACCOUNT_SUSPENDED: "This account is suspended.",
  /** The app owner asked to delete their own account (DEL1): the app would be left without an owner. */
  OWNER_ACCOUNT_UNDELETABLE: "The app owner's account can't be deleted.",
} as const satisfies Record<string, string>;

export type AdminErrorCode = keyof typeof adminMessages;

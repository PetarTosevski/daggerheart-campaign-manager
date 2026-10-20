/**
 * Sessions domain (D10 S1): status, list order and dates; the header line, next / last session and the dashboard's
 * texts; the spotlight's due characters; the session tally from Fear history and rests; the Combat Map's session
 * encounter title. Pure TypeScript with structural input types, shared by Convex and the browser.
 *
 * Server (S2, S3, S5, S6, S8):
 *   headerLine(sessions); lastSessionText(sessions); dashboardNumber(sessions); nextSessionLine(sessions);
 *   addTally(session.tally, windowTally(fearRows, restRows, { from: session.startedAt! }));
 *   sessionEncounterTitle({ n: session.n, instances });
 * Client (S2, S5): newestFirst, statusLabel, formatSessionDate, spotlight(activeIds, rows), TALLY_ROWS.
 */

export * from "./status";
export * from "./summary";
export * from "./spotlight";
export * from "./tally";
export * from "./encounter-title";

import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * Retrieval over the campaign's enabled books (Q1, analysis 3a): the search index `search_text` per book, the top
 * chunks plus same-page neighbours, at most about 8k tokens. L0 stub with the final signature (`Retrieve`): L2
 * replaces the body.
 */

/** A chunk sent to the model as one cited document titled '<bookTitle> · p.<page> · <section>'. */
export type RetrievedChunk = {
  chunkId: Id<"lorekeeperChunks">;
  bookId: Id<"lorekeeperBooks">;
  bookKey: string;
  bookTitle: string;
  /** The printed page. */
  page: number;
  section: string;
  text: string;
};

/** The chunks for `question` in `campaign`'s enabled books, best first. */
export type Retrieve = (ctx: QueryCtx, campaign: Doc<"campaigns">, question: string) => Promise<RetrievedChunk[]>;

/** Stub: none (every answer is 'Not in your books'). */
export const retrieve: Retrieve = async () => [];

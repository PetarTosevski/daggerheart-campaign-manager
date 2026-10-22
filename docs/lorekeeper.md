# The Lorekeeper: running it on your server

The Lorekeeper is the campaign's rules assistant (D13). Members ask a rules question on the Lorekeeper page, or in
the drawer that opens from the pill on every campaign page. It answers from your own rulebooks with quotes and page
numbers. When the books don't settle a question, it checks again with a stronger model and, if the asker allows it,
searches the internet.

This page is for whoever runs the deployment. How the code works is in `docs/tasks/TASK-D13-L0.md` to
`TASK-D13-L12.md`; the tables are in `docs/data-model.md`.

## What you need

1. The D13 functions deployed (`npx convex dev` for the dev deployment, `npx convex deploy` for production).
2. `ANTHROPIC_API_KEY` set on the deployment (below). Without it, the page says "The Lorekeeper isn't set up on
   this server." and the drawer pill is hidden.
3. At least one book ingested. Without books, every question ends as "Not in your books".

## Books: once per deployment, shared by every campaign

- A book is stored **once per Convex deployment**, not per campaign. Every campaign on that deployment sees every
  book you ingest. Only the frame books are limited: a campaign sees its own frame's book and no other frame's.
- GMs don't add books. In the Library card on the Lorekeeper page, a GM only switches a book **on or off for
  their campaign**. The defaults are:
  - on: the Core Rulebook, Hope & Fear, and the campaign's own frame book;
  - off: 'House rules (notes)'. When a GM turns it on, the GM's journal pages shared with everyone become extra
    reading for the Lorekeeper.
- The '＋ Add PDF' button only explains the ingest command below. A book is added by you, on your machine.

### Book keys

| Key | Library name | What it holds |
|---|---|---|
| `core` | Daggerheart Core Rulebook | the whole core book |
| `hopeFear` | Hope & Fear | the whole expansion |
| `frame:<frameId>` | the frame's name | a page range of the core book, e.g. `frame:witherwild` (defaults to core pp. 254-261) |
| `houseRules` | House rules (notes) | no text: registers the switch only (needs no file) |

## Ingesting a book

The text never goes into git and never leaves your machine except into your own deployment.

### 1. Extract the text, outside the repository

The ingest reads a plain text file with one block per PDF page:

```text
===== PAGE 93 =====
STRESS  Stress represents the mental ...  92   Chapter 2: Core Mechanics
```

With poppler's `pdftotext`, one page at a time:

```bash
mkdir -p ~/books
pages=$(pdfinfo ~/books/core.pdf | awk '/^Pages:/ {print $2}')
for i in $(seq 1 "$pages"); do
  echo "===== PAGE $i ====="
  pdftotext -f "$i" -l "$i" -layout ~/books/core.pdf - | tr '\n' ' '
  echo
done > ~/books/core.txt
```

Keep the PDF and the text file **outside the project folder** (here `~/books/`). The ingest script refuses any file
inside the repository (only `tests/fixtures/` is allowed, for the invented test book), so book text can't be
committed by mistake. It never prints the text.

### 2. Make the page numbers the printed ones

Quote chips and 'Open in the book' show the **printed** page number ('📖 Daggerheart Core Rulebook · p.92'), so
the numbers must match the paper book:

- The chunker reads the printed number from each page's footer ('92   Chapter 2: Core Mechanics'), when it is
  within 3 of the expected number, and takes the chapter name from it.
- On a page without a footer number, block N counts as printed page N-1 (it assumes the PDF's first page is the
  cover and printed page 1 comes next).
- If your PDF has more front matter than one cover page, renumber the blocks before you ingest so that block N holds
  printed page N-1. With `k` pages before printed page 1, write `echo "===== PAGE $((i - k + 1)) ====="` in the
  loop above and start it at `i = k` (the page just before printed page 1 becomes block 1).
- Check the result with a dry run (no data is sent): `pnpm lorekeeper:ingest core ~/books/core.txt --dry-run`
  prints the chunk and page counts. Then ask a question and compare a quote's page with the book.

### 3. Run the ingest

```bash
# The dev deployment (CONVEX_DEPLOYMENT in .env.local, your Convex login)
pnpm lorekeeper:ingest core ~/books/core.txt
pnpm lorekeeper:ingest hopeFear ~/books/hopefear.txt
pnpm lorekeeper:ingest frame:witherwild ~/books/core.txt      # core pp. 254-261
pnpm lorekeeper:ingest houseRules                             # the switch only

# Production
pnpm lorekeeper:ingest core ~/books/core.txt --prod
```

- Other targets: `--deployment <name>`, `--env-file <file>`, or `CONVEX_DEPLOY_KEY` in the environment (for
  example a production deploy key on another machine).
- Options: `--pages a-b` (only these printed pages; for frame books cut from the core book), `--title`,
  `--subtitle`, `--cover`, `--dry-run`. `pnpm lorekeeper:ingest --help` lists them.
- Re-running replaces that book's text; campaigns keep their switches. Run it again after you fix page numbers or
  get a corrected PDF.
- The script splits the text into page-tagged chunks of at most 4,000 characters and sends them through internal
  mutations (`npx convex run`, with your admin rights). No public function can write books.
- There is no remove command yet. Re-ingest to replace a book.
- The e2e backend gets an invented 13-page test book instead (`pnpm e2e:setup`), never real book text.

## Environment variables

Set them on the deployment, not in a `.env` file: `npx convex env set <NAME> <value>` (add `--prod` for
production). A change takes effect on the next question, without a deploy.

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required. Your Claude API key. Read only on the server, in `convex/lib/claude.ts`. |
| `LOREKEEPER_MODEL` | `claude-sonnet-5-5` | The model of the first pass and the internet pass. If unset, `ANTHROPIC_MODEL` is used (it also sets the photo import's model), then Sonnet 5.5. The stronger-model retry is always Opus 5.5. |
| `LOREKEEPER_DAILY_QUESTIONS` | `40` | Questions per person per UTC day. |
| `LOREKEEPER_CAMPAIGN_MONTHLY_USD` | `50` | Dollars per campaign per calendar month (UTC). |
| `LOREKEEPER_MONTHLY_USD` | `150` | Dollars for the whole deployment per calendar month (UTC). |
| `LOREKEEPER_FAKE_MODEL` | unset | Tests only: canned answers instead of the API. Honoured only on the local e2e backend; ignored everywhere else. |

The server-wide default of $150 leaves $50 of a $200 monthly Anthropic limit for map generation and photo import.
Set your Anthropic console limit as the last line of defence.

## Costs and caps

Prices per million tokens (`src/lib/lorekeeper/pricing.ts`, as of 2026-10-06):

| Model | Input | Output | Cache read |
|---|---|---|---|
| Sonnet 5.5 | $2 | $10 | $0.20 |
| Opus 5.5 | $4 | $20 | $0.20 |

Web search costs $10 per 1,000 searches; a cache write costs 1.25 × the input price.

What one question costs (estimates from the design; measured numbers are still to be recorded):

| Pass | When | About |
|---|---|---|
| First pass, Sonnet 5.5 | every question (about 11k tokens in, up to 2k out) | $0.04 |
| Retry, Opus 5.5 | the first pass says 'Rules unclear' or 'Not in your books' | $0.08 more |
| Internet pass, Sonnet 5.5 + up to 3 searches | still unclear or not found, and the asker left 'Search the internet too' on | $0.06 to $0.08 more |

A weekly table asking 30 questions a session spends a few dollars a month.

How the caps work:

- Before each pass the server books that pass's worst case (Sonnet $0.07, Opus $0.14, internet pass $0.10) against
  the person's day and the campaign's and the server's month. After the pass it replaces the booking with the real
  cost from the API's usage numbers. A stopped or failed pass is charged for what it used.
- Past the daily question cap or a money cap, the composer turns off for the people concerned and says why. A retry
  or internet pass that no longer fits the budget is skipped, and the answer found so far stands.
- Other limits: 30 questions an hour per person (bursts of 10), one answer on its way per person per campaign,
  1,000 characters per question, 200 messages per conversation (then 'Start a new conversation').

## Retention

- **Conversations are kept** until their asker deletes them. Nothing expires them; an answer is a few kilobytes.
  The asker deletes a conversation from the Conversations menu. Deleting a campaign removes all its
  conversations, rulings, Ask-the-GM requests, library switches and usage counters.
- **Usage counters** are deleted after 13 months (daily job).
- **Stuck answers**: an answer that has made no progress for 3 minutes ends as 'took too long', and an hourly job
  catches any still running after 10 minutes. Either way the booked cost is released.
- **Books** stay until you re-ingest them. They don't belong to a campaign, so deleting a campaign keeps them.

## Privacy

- **The API key never reaches a browser.** It lives in the deployment's environment and is read only on the server,
  in `convex/lib/claude.ts`. It is never returned, logged or put in an error, and there is no `NEXT_PUBLIC_`
  variable for it. Browsers only learn whether the Lorekeeper is available (true or false). The e2e privacy spec
  checks that no page, HTTP response or WebSocket message contains 'ANTHROPIC' or 'sk-ant'.
- **What goes to Anthropic with a question:**
  - the question and the last turns of that conversation;
  - the matching book excerpts (about 8k tokens);
  - the table rulings;
  - the campaign's frame;
  - the asker's own characters (class, subclass, level, heritage, domain cards, features) and the party's
    classes;
  - the GM's journal pages shared with everyone, only when a GM turned 'House rules (notes)' on.
- **Never sent, for anyone (the GM included):** codex entries and GM notes, other journal pages, adversaries,
  encounters, countdowns, session prep, Fear and other players' sheets. No code path that builds a prompt reads
  them. The tests plant canary text in a hidden codex entry and GM notes and check that it never reaches a prompt
  or a player's browser.
- **The internet pass** sends only the question and the table rulings, not your books or campaign data. Anthropic's
  search provider sees the search queries. Results are shown as 'From the internet · unofficial.', as plain text with
  links that open in a new tab (`rel="noopener nofollow"`).
- **Conversations are public to the campaign by default** (every member can read them). The asker can make one
  private; then only the asker can open it, not other players and not the GM. Public conversations hold nothing
  secret, because no GM-only data is in any prompt.
- **Book text** stays in your deployment and is read only by server functions. Players see short quotes (up to 300
  characters each, at most 3 per answer). 'Open in the book' shows them the text of one cited page of a book that is
  switched on for their campaign. The book text is copyrighted: keep the deployment private to your table.
- Under Anthropic's commercial API terms, inputs are not used for training by default and are kept only under
  Anthropic's standard API retention.

# The Lorekeeper: running it on your server

The Lorekeeper is the campaign's rules assistant (D13). Members ask a rules question on the Lorekeeper page, or in
the drawer that opens from the pill on every campaign page. It answers from your own rulebooks with quotes and page
numbers. When the books don't settle a question, it checks again with a stronger model and, if the asker allows it,
searches the internet.

This page is for whoever runs the deployment: the **app owner**, who sets the Lorekeeper's limits and the shared
books in **App admin** (`/admin`, see `docs/deploy.md` "App admin" for naming the owner). How the code works is in
`docs/tasks/TASK-D13-L0.md` to `TASK-D13-L12.md` and the config tracers (`docs/tasks/TASK-CONFIG-AD6.md`, `AD7`,
`AD8`, `AD12`, `LB1`, `PDF0`, `AU3`, `AU8`); the tables are in `docs/data-model.md`.

## What you need

1. The D13 functions deployed (`npx convex dev` for the dev deployment, `npx convex deploy` for production).
2. `ANTHROPIC_API_KEY` set on the deployment (below). Without it, the composer's notice says "The Lorekeeper isn't
   set up on this server." (once, above the conversation) and the drawer pill is hidden. App admin › Overview shows
   an alert and Maintenance › Keys and connections shows "Missing".
3. At least one book: uploaded as a PDF in App admin › Lorekeeper › Book library, or ingested from a text file with
   the script (below). Without books, every question ends as "Not in your books".
4. The app owner named once (`npx convex run adminSetup:setOwner`, `docs/deploy.md`), so someone can open App admin.
   Without an owner the Lorekeeper still runs on the defaults and env values below.

## Books: shared books and campaign books

There are two kinds of book.

**Shared books** are stored **once per Convex deployment**. Every campaign on that deployment sees every shared book.
Only the frame books are limited: a campaign sees its own frame's book and no other frame's. The app owner adds or
replaces them, either as a PDF in App admin (below) or as a text file with the ingest script.

**Campaign books** belong to one campaign. Its GM and co-GMs upload them (N7 a) in Campaign settings › Lorekeeper ›
'Upload a book'. Only that campaign's Library card lists them and only that campaign's Lorekeeper searches them; no
other campaign and not the owner's shared library ever sees them. Questions answered from them count like any other
question. They go away when the GM removes them (Remove, with a confirm) or when the campaign is purged.

In the Library card on the Lorekeeper page (and in Campaign settings › Lorekeeper), a GM switches each book **on or
off for their campaign**. The defaults are:

- on: the Core Rulebook, Hope & Fear, the campaign's own frame book and the campaign's own books;
- off: 'House rules (notes)'. When a GM turns it on, the GM's journal pages shared with everyone become extra
  reading for the Lorekeeper.

GMs see an 'About books' button with a plain note: "Your server's admin adds rulebooks once for everyone; switch
books on/off for this campaign here; use House rules (notes) for table rules."

### PDF uploads (owner and GM)

Both uploads go through one server pipeline (`convex/pdfIngest.ts`, the `unpdf` reader; N5 a, N8 a):

| | Owner: App admin › Lorekeeper › Book library | GM / co-GM: Campaign settings › Lorekeeper |
|---|---|---|
| What | a shared book: 'Upload a book' for a key with no book yet (`core`, `hopeFear`, `frame:<id>`), or Replace | a book for this campaign only |
| Form | the PDF, an optional title, the printed page number of the PDF's first page | the PDF, a title (1-120 characters), the printed page number of the PDF's first page |
| Limits | 20 MB and 300 pages per file | 20 MB and 300 pages per file; **no limit on the number of books** (N6 b) |
| Upload URLs | 20 per hour per person | 20 per hour per person |

- The file must be exactly `application/pdf` and start with `%PDF-`. A damaged or password-protected PDF, or one where
  fewer than half the pages have text (a scan), is refused as "couldn't be read". The uploaded file is always deleted
  after the read; only the page-tagged text chunks stay.
- **Page numbers:** the uploader types the printed page number of the PDF's first page. PDF page *i* is then printed
  page `first + i`, so quote chips and 'Open in the book' show the paper book's numbers. A footer page number within
  3 of that still wins and names the chapter, as for text files.
- While the server reads the PDF the row says 'Reading the PDF…' / 'Reading the book…'. One upload per book runs at a
  time. A replaced shared book keeps its old text until the new PDF has been read; a failed replace keeps it.
- Owner uploads are logged in Recent changes (`library.upload` / `library.replace`). GM uploads are not.
- The text-file ingest script below still works for shared books and is the way to cut a frame book out of the core
  book (`--pages`).

### Book keys

| Key | Library name | What it holds |
|---|---|---|
| `core` | Daggerheart Core Rulebook | the whole core book |
| `hopeFear` | Hope & Fear | the whole expansion |
| `frame:<frameId>` | the frame's name | a page range of the core book, e.g. `frame:witherwild` (defaults to core pp. 254-261) |
| `houseRules` | House rules (notes) | no text: registers the switch only (needs no file) |
| `campaign:<campaignId>:<n>` | the GM's title | a campaign book (GM upload only; never ingested by the script or the owner's upload) |

## Ingesting a book from a text file (script)

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
- To replace a book, re-ingest it. To take it away, remove it (below).
- The e2e backend gets an invented 13-page test book instead (`pnpm e2e:setup`), never real book text.

## Removing a book

A campaign book is removed by its GM or a co-GM (Campaign settings › Lorekeeper › Remove). App admin has no Remove
for shared books; use the script:

```bash
pnpm lorekeeper:ingest hopeFear --remove           # the dev deployment
pnpm lorekeeper:ingest hopeFear --remove --prod    # production
```

- The script finds the book on the target deployment, names it with its chunk count and the target, and asks you to
  type the book key to confirm. Anything else cancels and removes nothing.
- Then it deletes, in this order: the book's text (its chunks, in batches), every campaign's on/off switch for it, and
  the book's library row. Every campaign's Library card drops it at once.
- `--yes` skips the question (for scripts). Without a terminal and without `--yes` the script refuses.
- The same targets as an ingest: `--prod`, `--deployment <name>`, `--env-file <file>`, `CONVEX_DEPLOY_KEY`, `--e2e`.
- Old answers that quoted the book keep their text; their 'Open in the book' says "That book isn't in this campaign's library."
- Ingesting the book again later adds it back with the default switches (on for core, Hope & Fear and the campaign's
  own frame book).
- `houseRules` can be removed the same way, but any later ingest of another book adds its switch back.
- It runs through internal functions (`lorekeeperLibrary:findBook`, `:clearChunks`, `:clearSwitches`,
  `:deleteBook`) with your admin rights. No public function can remove books.

## Limits: App admin first, env as the fallback

The Lorekeeper's limits are set by the app owner in **App admin › Lorekeeper** and take effect on the next question,
without a deploy. Each number is read in this order: the owner's saved value, then the env var, then the code default
(`convex/lib/appConfig.ts` `readAppConfig`). A malformed env value or a negative saved number falls back to the next
step, so a typo never opens or closes a gate. The env vars stay as the fallback for a deployment with no owner or
where the owner never saved a value.

| Setting (App admin › Lorekeeper) | Env fallback | Default | What it does |
|---|---|---|---|
| Budget › Monthly spend limit | `LOREKEEPER_MONTHLY_USD` | `150` | Dollars for the whole deployment per calendar month (UTC). |
| Budget › When the limit is reached | none | Pause the Lorekeeper | `pause`, `gmOnly` or `short` (below). |
| Budget › Email me at 80% | none | on | One email to the owner's verified address per month when spend crosses 80% (Q32 a). |
| Limits per person › Questions per day | `LOREKEEPER_DAILY_QUESTIONS` | `40` | Questions per person per UTC day. The owner has no limit. |
| Limits per person › Internet searches per day | none | `20` | Internet searches per person per UTC day; past it the internet pass is skipped and the answer stands. |
| Limits per person › Let GMs ask for higher limits | none | off | Opens limit requests (below). |
| (no control; `adminLorekeeper.setLimit` `campaignMonthlyUsd`) | `LOREKEEPER_CAMPAIGN_MONTHLY_USD` | `50` | Dollars per campaign per calendar month (UTC); a hard stop in every mode. |
| Use by campaign › Limits | none | the app's numbers | One campaign's own questions / internet searches per day (and stored book numbers, not enforced: N6 b). Empty = the app's number. |

Feature switches › 'Lorekeeper internet search' (Off / Only me / Testers / Everyone) hides the composer's internet
toggle and skips the internet pass for the people it is off for. Every change in App admin is logged in Overview ›
Recent changes (kept 1 year).

Settings that stay in the deployment's environment (`npx convex env set <NAME> <value>`, add `--prod` for
production; a change takes effect on the next question):

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required. Your Claude API key. Read only on the server: its value only in `convex/lib/claude.ts` (every Claude call goes through it); App admin's checks (`convex/adminMaintenance.ts`, `convex/adminOverview.ts`) only test whether it is set and show Set / Missing. |
| `LOREKEEPER_MODEL` | `claude-sonnet-5-5` | The model of the first pass and the internet pass. If unset, `ANTHROPIC_MODEL` is used (it also sets the photo import's model), then Sonnet 5.5. The stronger-model retry is always Opus 5.5. |
| `LOREKEEPER_DAILY_QUESTIONS`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_MONTHLY_USD` | see above | Fallbacks only (table above). |
| `AUTH_RESEND_KEY`, `MAIL_FROM`, `SITE_URL` | none | The 80% email and the limit-request emails send through these, linking to `<SITE_URL>/admin`. Without them nothing is sent (logged, never retried). |
| `LOREKEEPER_FAKE_MODEL` | unset | Tests only: canned answers instead of the API. Honoured only on the local e2e backend; ignored everywhere else. |

The server-wide default of $150 leaves $50 of a $200 monthly Anthropic limit for map generation and photo import.
Set your Anthropic console limit as the last line of defence.

### At the monthly limit (Q20 a)

| When the limit is reached | Past the limit | Past 120% of the limit |
|---|---|---|
| Pause the Lorekeeper (default) | everyone is refused | same |
| GMs only | GMs and co-GMs ask normally; players are refused | GMs and co-GMs are refused ('paused'); players keep the monthly-limit refusal they got past the limit |
| Shorter answers | everyone gets a shorter answer: one Sonnet pass, at most 1,000 tokens, no retry, no internet | everyone is refused ('paused') |

The campaign's monthly budget is a hard stop in every mode. The **app owner is never capped**: their questions are
still counted and cost money, but no daily, campaign or deployment limit refuses them.

### Limit requests (Q21 changed, N10 b)

GMs never raise their own limits. While 'Let GMs ask for higher limits' is on, a GM or co-GM sees 'Lorekeeper limits'
in Campaign settings › Lorekeeper with 'Ask for higher limits': more questions per day, more internet searches per
day or more book room (0-1000 each) and a short reason (up to 300 characters). One request can be open per campaign;
a GM can send 5 a day; the GM can withdraw it. The owner gets an email for every request and an alert on the Overview,
and in App admin › Lorekeeper › Requests approves with the numbers they choose (prefilled with the asked ones) or
declines. The approved numbers become the campaign's own limits (Use by campaign › Limits) from the next question. The
GM sees the answer ('Last request approved / declined <date>'), never the owner's name. While the switch is off the GM
side is hidden. Decided requests are deleted after 1 year.

## Costs and caps

Prices per million tokens (`src/lib/lorekeeper/pricing.ts`, as of 2026-10-06):

| Model | Input | Output | Cache read |
|---|---|---|---|
| Sonnet 5.5 | $2 | $10 | $0.20 |
| Opus 5.5 | $4 | $20 | $0.20 |

Web search costs $10 per 1,000 searches; a cache write costs 1.25 × the input price.

What one question costs. Measured 2026-10-23 to 10-29 on the dev deployment (real books, real API; 31 passes,
$3.20 in all; from `lorekeeperMessages.usage`). Medians, with the highest in brackets; no pass used thinking tokens:

| Pass | When | Tokens in (uncached / cache read / cache write) | Out | Cost |
|---|---|---|---|---|
| First pass, Sonnet 5.5 (9 runs) | every question | 15k / 1.7k / 0 (max 18k uncached) | 0.4k (0.6k) | $0.035 ($0.041) |
| Retry, Opus 5.5 (8 runs) | the first pass says 'Rules unclear' or 'Not in your books' | 28k / 2.5k / 2.4k (max 32k / 8.5k write) | 1k (1.6k) | $0.105 ($0.130) more |
| Internet pass, Sonnet 5.5 (14 runs, 1 search each) | still unclear or not found, and 'Search the internet too' is on | 30k / 24k / 11k (max 34k / 34k / 13k) | 1.5k (2.2k) | $0.149 ($0.168) more |

The design estimates were $0.04, $0.08 and $0.06-0.08. The first pass matches; the Opus retry and the internet pass cost
more because their prompts carry 28-34k uncached input tokens (the same book prompt counts about twice as many tokens
on Opus as on Sonnet), and the internet pass gets its search results back as input. The internet pass makes one request
and the API reports that request's usage summed over the model's turns around each search, which would explain how
its output passes max_tokens (2.2k against 2,000).

The bookings below are set above these measurements (dcm-5n07; `src/lib/lorekeeper/pricing.ts`): a book pass books
45k input tokens (`RESERVE_INPUT_TOKENS`) and its max_tokens; the internet pass books 120k input tokens
(`WEB_RESERVE_INPUT_TOKENS`, about 1.5 × the 81k measured with one search), 4k output tokens and all 3 searches. Every
input token is booked at the cache-write price, so a booking is never below a measured pass.

A weekly table asking 30 questions a session spends a few dollars a month.

How the caps work:

- Before each pass the server books that pass's worst case (Sonnet $0.13, Opus $0.27, internet pass $0.37; a shorter answer $0.12) against
  the person's day and the campaign's and the server's month. After the pass it replaces the booking with the real
  cost from the API's usage numbers. A stopped or failed pass is charged for what it used.
- Past the daily question cap or a money cap, the composer turns off for the people concerned and says why. The
  notice comes first in the composer, which then moves above the conversation, so it is on the first screen on a
  laptop and a phone.
- A retry or internet pass that no longer fits the budget is skipped, and the answer found so far stands. When the
  books had nothing and the internet pass couldn't run (no budget left, an HTTP error, a timeout), the answer says
  "I couldn’t find this in your books, and couldn’t search the internet just now. Try again later or ask your GM."
  A search that ran and found nothing says "I couldn’t find this in your books or online. Ask your GM."
- Other limits: 30 questions an hour per person (bursts of 10), one answer on its way per person per campaign,
  1,000 characters per question, 200 messages per conversation (then 'Start a new conversation').

## Retention

- **Conversations are kept** until their asker deletes them. Nothing expires them; an answer is a few kilobytes.
  The asker deletes a conversation from the Conversations menu. Deleting a campaign removes all its
  conversations, rulings, Ask-the-GM requests, library switches and usage counters.
- **Usage counters** are deleted after 13 months (daily job).
- **Stuck answers**: an answer that has made no progress for 3 minutes ends as 'took too long', and an hourly job
  catches any still running after 10 minutes. Either way the booked cost is released.
- **Shared books** stay until you replace or remove them. They don't belong to a campaign, so deleting a campaign
  keeps them.
- **Campaign books** stay until the GM removes them or the campaign is purged (their text chunks are deleted in
  batches). An uploaded PDF file is deleted as soon as it has been read, whatever the result.
- **Limit requests**: decided ones are deleted 1 year after the decision; open ones wait for an answer.

## Privacy

- **The API key never reaches a browser.** It lives in the deployment's environment and is read only on the server:
  its value only in `convex/lib/claude.ts`, and App admin's checks only test whether it is set. It is never returned, logged or put in an error, and there is no `NEXT_PUBLIC_`
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
  private; then only the asker can open it, not other players and not the GM. The one exception is the **app
  owner's read-only view** (App admin › Overview › Open, N1 changed): it shows everything in the campaign, private
  conversations and players' private notes included, can change nothing, and every visit is logged
  (`campaign.view` in Recent changes, once per campaign per day). Public conversations hold nothing secret, because
  no GM-only data is in any prompt.
- **Book text** stays in your deployment and is read only by server functions. Players see short quotes (up to 300
  characters each, at most 3 per answer). 'Open in the book' shows them the text of one cited page of a book that is
  switched on for their campaign. A campaign book is readable only inside its own campaign. The book text is
  copyrighted: keep the deployment private to your table. The App admin export never contains book text.
- Under Anthropic's commercial API terms, inputs are not used for training by default and are kept only under
  Anthropic's standard API retention.

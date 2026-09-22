# FoodLens — updated build

## Pushing to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`backend/.env` is git-ignored on purpose — it holds your real database
credentials and should never be committed. Copy `backend/.env.example` to
`backend/.env` locally and fill in your own values.

## Deploying on Render

1. On [render.com](https://render.com), click **New → Blueprint** and point
   it at this GitHub repo. It picks up `render.yaml` and `Dockerfile`
   automatically (the Dockerfile installs `tesseract-ocr`, which the OCR
   step needs and Render's plain Python runtime doesn't include).
2. In the service's **Environment** tab, set:
   - `MONGODB_URI` — your MongoDB Atlas connection string ([Atlas](https://www.mongodb.com/cloud/atlas) → Connect → Drivers)
   - `ANTHROPIC_API_KEY` — optional; leave blank to run in offline mode
3. Deploy. Render builds the Docker image and starts the app with gunicorn.

If you'd rather not use the Docker path, Render's native Python runtime
also works via the included `Procfile` — but you'll need to add tesseract
another way (e.g. a build-command apt install, where your Render plan
allows it), or OCR scans will fail.

**Before pushing:** the MongoDB credentials that were in this project's
`backend/.env.example` have already been shared in this chat, so they
should be treated as exposed — rotate/reset that Atlas user's password
before relying on this database for anything real.

## Latest pass: streaks, badges, and a "vs your last scan" delta

Three additions, all derived client-side from data the app already saves —
no backend or database schema changes.

### 1. Daily streak

`dashboard.js` now computes a day streak from each history entry's `ts`
(consecutive calendar days with at least one scan; a day not yet scanned
doesn't break today's streak). Shown as a fourth stat card with a flame
icon that flickers (`flame-flicker` keyframe) while the streak is live.

### 2. Badge shelf

Seven badges (`BADGES` in `dashboard.js`) unlock from scan count, streak
length, "Good"-scored scans, and flags caught — e.g. First Scan, Week
Streak, Clean Streak, Flag Finder. Unlocked state is remembered per user
in `localStorage` (`foodlens_badges_<user id>`), so a badge only
celebrates — confetti + a toast — the first time it's actually earned; a
brand-new user's first load never gets confetti-bombed for badges they
happened to start with.

### 3. "vs your last scan" delta chip

`scan.js` stashes the previous top score right before saving a new entry;
`results.js` reads it once and renders a small chip in the hero
("+8 vs your last scan"). A meaningful improvement (+5 or more) also
triggers a confetti burst once the score gauge finishes filling.
Reopening an old scan from history clears this key first, so it never
shows a stale comparison.

### New shared helpers (`common.js`)

`fireConfetti(originEl)` and `showToast({emoji, title, sub})` — small,
dependency-free, DOM-based, and no-ops (or non-animated) under
`prefers-reduced-motion`, consistent with the rest of the app.

## From the round before: technical explanations, vitamins, and no more raw OCR panel

Three changes in this round.

### 1. The "Scan details" panel is gone

`renderScanDetails()` is deleted from `frontend/results.js`, its call is
removed from the Summary page, and the now-dead `.scan-details` / `.raw-text`
rules are stripped out of `style.css`. Summary ends at "Worth knowing".

Nothing else read `raw_text` on the front end, so the API still returns it —
it just isn't printed at the reader any more.

### 2. New technical layer — `backend/technical.py`

Every ingredient card gains a collapsible **🔬 Technical detail** block that
sits under the plain-English answer rather than replacing it:

    Chemical identity · Code · Functional class · Derived from
    2-3 sentences of real mechanism
    regulatory / allergen / intake note

Backed by two tables in `technical.py`:

- **~95 INS / E number entries** — colours, preservatives, antioxidants,
  gums, emulsifiers, raising agents, phosphates, flavour enhancers,
  sweeteners and modified starches. Sub-forms are looked up whole first
  (`307b`, `472e`, `150d`, `500(ii)`) and fall back to the parent number.
- **~45 ingredient-type rules** — flours, oils, cocoa, dairy, gluten, malt,
  caffeine, spices, compound fillings, plus generic function words
  (`humectant`, `acidity regulator`, `stabiliser`) so an additive whose code
  isn't in the table still gets a real description of what it does.

Lookup order per ingredient: stated INS code → named vitamin/mineral →
ingredient-type rule → category fallback. All of it is offline data, so the
technical layer works identically with or without `ANTHROPIC_API_KEY`.

`enrich.py` also asks the model for a `technical` block now, with explicit
instructions that it is *not* a longer rewrite of `what`. Anything the model
leaves blank is filled from the same tables by `attach_technical()`, which
runs in `app.py` on whichever set of cards came back — so the AI path and the
offline path hand the front end an identical shape.

### 3. New Vitamins tab

A fourth tab, hidden unless the label actually declares fortification. One
card per nutrient:

- the chemical form manufacturers really fortify with — thiamine
  mononitrate, ferrous fumarate, potassium iodate, cholecalciferol
- what it does in the body, and what a shortfall looks like
- a rounded adult reference intake, so a "% RDA" printed on the pack means
  something

`extract_micronutrients()` reads nutrients from the ingredient list, from
bracketed blends like `VITAMINS (B1, B2, B3, D)`, and from the nutrition
panel, keeping any stated amount it finds adjacent to the name. When a pack
declares a blanket "VITAMINS" without naming them, the tab says so instead of
implying the list is complete.

Minerals named as part of an additive ("calcium carbonate", "potassium
sorbate") are *not* counted as fortification — `_mineral_is_additive_use()`
checks the following word before accepting a match.

### Bugs found and fixed in this pass

- **`\bvitamin\b` never matched "VITAMINS".** The word boundary fails on the
  plural, so a card reading `VITAMINS` fell through every rule to the generic
  "Listed by weight" filler. Fixed in `knowledge.py` and `technical.py`.
- **Compound ingredients were described by their own sub-list.** A card named
  `Choco Cream (Sugar, ..., Emulsifier (INS 322(i)), ...)` was picking up
  lecithin's chemistry from the code buried inside it, and showing 5.3% —
  the cocoa solids' percentage, not its own. `declaration_scope()` in
  `simplifier.py` now cuts the declaration at the first bracket group
  containing a comma, so a stated percentage stays with the name it belongs
  to while a sub-list is held back. A bracket holding only a percentage or an
  additive code is left attached, so `Antioxidant (INS 307b)` still resolves
  by its code. Same label, before and after: first ingredient was
  `Whole Oats Flour` at 54.1%, now `Multigrain Flour Mix` at 54.1%.
- **Nutrient amounts were read across declaration boundaries.** The window
  after a nutrient name ran on into the next one, so calcium inherited the
  figure printed against whatever followed it. The window now stops at the
  first `, ; : ) ] }` or sentence break, and every mention of a nutrient is
  checked rather than only the first — the ingredient list names it without a
  figure, the nutrition panel names it with one.

### New API fields

    "vitamins":         [ {name, group, chemical, role, deficiency,
                           reference, detail, amount, emoji, key} ],
    "vitamins_unnamed": bool,
    "ingredients": [ { ..., "technical": {chemical, ins, family,
                                          source, detail, notes} } ]

## From the round before: real explanations on every ingredient card

Cards were opening to a generic filler ("Listed by weight...") for anything
outside the original 34-entry database. Two changes fix that:

1. **`backend/data/ingredients_db.json` expanded from 34 → 88 entries** —
   common packaged-food ingredients (gums, sweeteners, preservatives,
   vitamins, spices, oils, etc.) now have real, specific write-ups.

2. **New `backend/knowledge.py`** — a ~35-rule pattern layer that sits
   between the exact database and the last-resort filler. It recognises
   the *kind* of ingredient from its name (a raising agent, an emulsifier,
   a named spice, a grain, a dairy ingredient...) even when there's no
   exact database entry, and writes a real explanation instead of a
   non-answer. Lookup order per ingredient:

       1. exact database match       (most specific)
       2. INS / E-number pattern     (with the stated function enriched
                                       via the same knowledge rules)
       3. knowledge.py pattern rules (recognised ingredient type)
       4. generic filler             (only for genuinely unclassifiable names)

3. **AI prompt tightened** (`backend/enrich.py`) to require 1–2 real
   sentences that name the specific compound or source rather than a
   vague category restatement, with a fallback to the same knowledge
   rules if the model still comes back thin.

Also fixed in this pass: DB-matched ingredients were briefly getting
over-flagged as "worth a look" because their neutral background health
note was being used as the flag trigger — salt, corn meal and black
pepper were showing the amber chip. That's corrected: the flag only
fires for genuine allergens, added sugar, additives and colours, while
the health note now enriches the "what it is" text for every ingredient
instead.

## From the round before: garbled ingredient cards

`backend/quality.py` recovers missed commas, cuts fragments off at
nutrition-table bleed, strips OCR symbol noise, and drops fragments that
are still unreadable after cleanup — applied identically to the offline
parser and the AI path.

## The dynamic pipeline

    OCR text ──▶ AI pass (repairs + explains) ──▶ cards
                    └─ unavailable ──▶ ingredients_db.json + knowledge.py rules

Results cache in `enrich_cache.db`, keyed by the label text.

## Setup

    pip install -r backend/requirements.txt

    export ANTHROPIC_API_KEY=sk-ant-...        # Windows: set ANTHROPIC_API_KEY=...
    export FOODLENS_MODEL=claude-haiku-4-5-20251001   # optional
    export TESSERACT_CMD=/path/to/tesseract           # optional

    python backend/app.py

Without the key the app still runs — `/api/status` reports `ai_enabled: false`
and the cards come from the offline table + knowledge rules.

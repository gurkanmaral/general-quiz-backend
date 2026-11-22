# KNO. content

Everything players read — Quizzes, Questions and the Daily schedule — lives in this folder as JSON.
The database is only a read model: `npm run kno -- import` copies **published** items into Postgres
(AD-9). Nothing is ever edited in the database or through an admin screen.

```
content/
  quizzes/<slug>.json      one file per Quiz (the file name is the quiz slug)
  daily/schedule.json      which Question is the Daily on which date
  fixtures/                test data shared by the web app and the API
```

## Review flow (pending → published)

1. **Author.** A Claude session writes a Content Batch: new quiz files or new/edited Questions,
   all with `"status": "pending"` (FR-35).
2. **Review.** Gurkan reads every pending item against its `source` link and approves, edits or
   rejects it (FR-36):
   - approve → change `"status"` to `"published"`;
   - edit → fix the text, keep the `slug`;
   - reject → delete the item from the file (or leave it `pending`).
3. **Import.** Run the import (below). Only `published` items reach players; pending items are
   skipped and listed in the output so nothing is forgotten.

Rules the import enforces:

- Slugs are stable ids (kebab-case, unique across all files). Never rename the slug of a published
  item: players' answers and records point at it.
- A published Question that disappears from the files (deleted, or set back to `pending`) is marked
  **unpublished** in the database, never deleted — players may have answered it.
- Invalid files fail the whole import before anything is written, with the file, the field and the
  Question slug, e.g. `lord-of-the-rings.json: questions.3.source (question "lotr-gandalf-actor"): …`.

## Import command

```bash
npm run kno -- import              # apply migrations, then import content/ (or CONTENT_DIR)
npm run kno -- import --dir path   # import another content folder
```

The import runs in one transaction and is idempotent: a second run with unchanged files prints
`No changes.`

## Quiz file format — `quizzes/<slug>.json`

```jsonc
{
  "slug": "lord-of-the-rings",          // must equal the file name
  "status": "published",                // pending | published
  "kind": "quiz",                       // quiz (listed on Quizzes) | dailyPool (Daily-only Questions)
  "title": { "en": "The Lord of the Rings", "tr": "Yüzüklerin Efendisi" },
  "description": { "en": "Peter Jackson's trilogy, from the Shire to Mount Doom." },
  "category": "Movies",                 // Movies | Books | Science | History | Music | Technology | World
  "theme": "emerald",                   // violet | crimson | cyan | amber | coral | blue | emerald
  "expertShare": 0.3,                   // optional: share of Expert Questions in a Solo Game (default 0.3)
  "questions": [ /* see below */ ]
}
```

`category`, `theme` and `description` are required for `"kind": "quiz"`. A `dailyPool` file (such as
`daily-originals.json`) is never listed on the Quizzes page; its Questions set their own `category`
and `theme`.

Every text field is localized: `{ "en": "…", "tr": "…" }`. English is required; Turkish is optional
until translated (the app falls back to English).

### Question

```jsonc
{
  "slug": "lotr-balrog",
  "status": "published",
  "difficulty": "standard",             // standard | expert
  "eyebrow": { "en": "The Bridge of Khazad-dûm" },   // short teaser above the Question
  "text": { "en": "What creature does Gandalf face on the bridge in Moria?" },
  "options": [{ "en": "A dragon" }, { "en": "A Balrog" }, { "en": "A cave troll" }, { "en": "A Nazgûl" }],
  "correctIndex": 1,                    // 0–3; exactly four options
  "answerTitle": { "en": "Gandalf faces a Balrog." },          // the story: headline…
  "summary": { "en": "The Balrog, a demon of fire and shadow, …" }, // …and body
  "facts": [                            // at least one
    { "label": { "en": "Where" }, "value": { "en": "Moria" }, "detail": { "en": "The ancient Dwarf city." } }
  ],
  "source": { "label": { "en": "Wikipedia — Balrog" }, "url": "https://en.wikipedia.org/wiki/Balrog" },
  "video": { "title": { "en": "…" }, "creator": "…", "url": "https://…" },   // optional
  "category": "Movies", "theme": "emerald"                                   // optional overrides
}
```

Every Question needs four options, one correct answer, a story, at least one fact and a reputable
source link. Players never see `correctIndex`, the story or the facts of a Quiz Question before they
answer it (AD-7).

### Badges and Titles

A listed quiz can award **Badges** (achievements) and **Titles** (characters a player can equip,
shown as "Mert · Gandalf"). Both live in the quiz file and use the same shape:

```jsonc
"badges": [
  { "slug": "lotr-middle-earth-fan", "status": "published", "icon": "🏅",
    "name": { "en": "Middle-earth Fan" },
    "description": { "en": "Answered 80% of The Lord of the Rings quiz correctly." },
    "unlock": { "type": "correctShare", "min": 0.8 } }
],
"titles": [
  { "slug": "lotr-gandalf", "status": "published", "icon": "🧙",
    "name": { "en": "Gandalf" }, "description": { "en": "…" },
    "unlock": { "type": "allCorrect", "difficulty": "expert" } }
]
```

`unlock` is an **Unlock Rule** from a closed set (AD-10). Any other `type` fails the import.

| Rule | Met when |
| --- | --- |
| `{ "type": "correctShare", "min": 0.8 }` | at least 80% of the quiz's published questions have ever been answered correctly |
| `{ "type": "correctShare", "min": 0.5, "difficulty": "expert" }` | the same, counting only Expert (or Standard) questions |
| `{ "type": "allCorrect", "difficulty": "expert" }` | every published Expert (or Standard) question has been answered correctly at least once |
| `{ "type": "gamesWon", "min": 3 }` | at least 3 games of the quiz won (a Solo Game is won with 70% or more correct) |

Rules read the player's **Quiz Record**: every distinct question they have ever answered correctly
in the quiz, across all games (abandoned games count their answered questions), and games won.
They are evaluated after every finished game; earned items are kept forever, even if the item or a
question is later unpublished. Badge and Title slugs are unique across all files.

## Daily schedule — `daily/schedule.json`

```jsonc
{
  "rotation": { "anchor": "1970-01-01", "questions": ["earth-atmosphere", "…"] },
  "entries": [{ "dailyDate": "2026-12-01", "question": "largest-desert", "status": "published" }]
}
```

An entry pins a published Question to one Daily Date; other dates follow the rotation. Every slug
named here must be a published Question, or the import fails.

A Daily Date with neither an entry nor a rotation Question (for example an empty rotation) gets a
**fallback**: the server picks a published `dailyPool` Question that no entry, rotation slot or
earlier fallback uses (the same pick for the same state), stores it, and keeps it for that date.
`kno import` prints a `WARNING` when fewer than 14 of the next Daily Dates are covered by entries or
the rotation.

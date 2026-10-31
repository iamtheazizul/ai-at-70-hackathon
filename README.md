# Shoptimal

Phone-side shopping help for one store trip. The MVP uses **no language model**. Item matching is exact product names and a synonyms table. Substitutes come from database rules. Caregiver summaries use fixed templates.

This repository is public. Keys live only in `.env`, which is gitignored. `.env.example` has the project URL and empty placeholders.

## Language model

None in the MVP.

Speech recognition, when the browser provides it, only turns speech into text. That text is passed to a keyword matcher. The matcher accepts six phrases, on word boundaries: Next, Repeat, Where am I, Skip, Pause, Done. It does not guess paraphrases.

**Risk:** those fixed commands may not match how Ross actually talks. "Move on" does not match Next. Bench tests run recorded transcripts through the matcher (`npm test`).

## Run the demo

```bash
cp .env.example .env
# fill the publishable key; the secret is only for schema apply
npm install
npm test
npm run dev
```

Open the printed local URL. The catalog is **demonstration data, not a surveyed store map**. Search `OJ`, `the green yogurt`, or `garbanzo beans`. `My usual` is built from three sample past trips. Unknown text stays on the list with no aisle.

On the trip screen the two primary actions are **Got it** and **Can't find it**. The transcript box is the bench-test input for voice commands. `Done` opens the caregiver summary.

If Supabase is reachable and the migration has been applied, the page reads the catalog from there. Otherwise it uses the same sample rows bundled in `src/mvp/demo.ts`.

## Database

Project: `https://gflmdpdcairhkewtdzqs.supabase.co`

Schema: `supabase/migrations/0001_mvp.sql`

Tables: `stores`, `products`, `synonyms`, `locations`, `substitute_rules`, `lists`, `list_items`, `trips`, `trip_items`.

`list_items` holds the lines of a `lists` row. Anonymous clients can read the demonstration rows. They cannot write them.

Apply the file in the Supabase SQL editor, or run `npm run apply-schema` when `.env` contains the secret key. That script calls the management SQL API. A publishable key cannot create tables. Do not commit the secret.

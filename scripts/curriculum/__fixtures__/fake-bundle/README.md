# FAKE FIXTURE: not real curriculum

Everything in this folder is invented for testing the importer. Names, keys, sections, chapters, weightages,
resources and exam years are all fake (keys start with `fake-`, names start with `FAKE`, years are 2090+,
URLs use the reserved `.invalid` domain).

It must never be copied into `supabase/migrations`, `supabase/seed.sql` or any student-facing dataset.
The CLI refuses to emit SQL for a `fake-` bundle unless `--allow-fake` is given, and a test fails if a
`fake-` string appears in the migrations or seed file.

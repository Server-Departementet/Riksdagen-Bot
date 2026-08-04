# Score bot — implementation timeline

- [x] set up web server for relaying image attachments

## 1. Quick wins (no structural changes)

- [x] bot reacts to course message with :white_check_mark: or :question: depending on if it's in the course catalog
  - reacts on both new and edited messages, and swaps the reaction if an edit changes the verdict
- [x] /hjälp command, documenting all syntax and features
  - course name as first line of the first score message, `hål poäng` lines, dnf notation (par + 4),
    Saknad pings, records/flags, and that partial rounds never count toward banrekord
    (answers Winroth's request from the feature channel — it already works this way)
- [x] cooldown/debounce on /räkna so multiple calls don't trigger multiple messages from the bot
  - in-flight lock (blocks the concurrent race) + 10 s cooldown with an ephemeral "vänta X s" reply

## 2. Looser parsing (behavior change — safest once the ack from step 1 is live)

- [x] looser course message requirements: basically if it is `\d+\s+.+` it's a score message, else it's a course
  - implemented as: score-line *shaped* first line (valid or not, so a typo like `5 45` can't split a round) → score message, anything else within 3-30 chars → course name
  - the ✅/❓ reaction is the safety net for misdetections
  - /hjälp updated

## 3. Record board restructure

- [x] split courses into separate messages (one bot message per course in the record channel)
  - kills the 2000-char ceiling on the single board message
  - [x] include link to the /räkna message on record entries — the date is now a masked link to the round's board
  - the old message is the index: title + "senast uppdaterad" + signature reactions (env var unchanged)
  - pool flow: parse everything → memory → edit N messages (skipping unchanged ones); the played
    course is deleted + resent to sink to the bottom, with `allowedMentions: { parse: [] }` so the
    resend renders mentions without pinging anyone
  - [x] one-time migration script from the current single message (run 2026-08-04, deleted)
  - [x] /hjälp updated

## 4. Co-op support (depends on 2 for course-line syntax and 3 for board layout)

- [ ] co-op support
  - [ ] have a syntax for coop course messages. Like `<course> coop|co-op [<@user> <@user> ...] vs [<@user> <@user> ...]`
  - [ ] separate scoring from regular games (own records, doesn't touch personal ones)
  - [ ] shown on leaderboard
  - update /hjälp

## On hold

- whispered (DM) confirmations, running total + par per hole (feature channel, Vena/Liz) —
  parked in favor of the reaction acknowledgement

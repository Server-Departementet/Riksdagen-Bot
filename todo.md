# Score bot — implementation timeline

- [x] set up web server for relaying image attachments

## 1. Quick wins (no structural changes)

- [x] bot reacts to course message with :white_check_mark: or :question: depending on if it's in the course catalog
  - reacts on both new and edited messages, and swaps the reaction if an edit changes the verdict
- [x] /hjälp command, documenting all syntax and features
  - course name as first line of the first score message, `hål poäng` lines, dnf notation (par + 4),
    Saknad pings, records/flags, and that partial rounds never count toward banrekord
    (answers Winroth's request from the feature channel — it already works this way)
- [ ] cooldown/debounce on /räkna so multiple calls don't trigger multiple messages from the bot

## 2. Looser parsing (behavior change — safest once the ack from step 1 is live)

- [x] looser course message requirements: basically if it is `\d+\s+.+` it's a score message, else it's a course
  - implemented as: score-line *shaped* first line (valid or not, so a typo like `5 45` can't split a round) → score message, anything else within 3-30 chars → course name
  - the ✅/❓ reaction is the safety net for misdetections
  - /hjälp updated

## 3. Record board restructure

- [ ] split courses into separate messages (one bot message per course in the record channel)
  - kills the 2000-char ceiling on the single board message
  - [ ] include link to the /räkna message on record entries — was blocked by message length before,
    per-course messages make it fit
  <!-- - decide where signature reactions live once there are several messages (index/header message?) -->
  - the bot will have a pool of messages, one for each course (and their played coop variants) and will edit this pool freely to avoid state management. This will lead to a parse or the entire things, keep it in memory, then edit N messages. Alternatively it could just delete the old message and resend, which would auto fix the "last updated" ordering but will also spam mentions.
  - one-time migration script from the current single message
  - update /hjälp

## 4. Co-op support (depends on 2 for course-line syntax and 3 for board layout)

- [ ] co-op support
  - [ ] have a syntax for coop course messages. Like `<course> coop|co-op [<@user> <@user> ...] vs [<@user> <@user> ...]`
  - [ ] separate scoring from regular games (own records, doesn't touch personal ones)
  - [ ] shown on leaderboard
  - update /hjälp

## On hold

- whispered (DM) confirmations, running total + par per hole (feature channel, Vena/Liz) —
  parked in favor of the reaction acknowledgement

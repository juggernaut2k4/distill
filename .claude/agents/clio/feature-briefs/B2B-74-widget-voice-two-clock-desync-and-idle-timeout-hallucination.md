# Feature Brief: B2B-74 — Live Voice Session Two-Clock Desync (Idle-Timeout Hallucination, Barge-In Content Loss, Recovery Race)

From: CEO (Arun)
To: Business Analyst Agent — **full BA Requirement Document required before any code**
Priority: P0 — live, currently broken, affecting every OpenAI Realtime widget session today
Date: 2026-08-06
Channel: widget voice channel (`widget-render`), with confirmed blast radius into the shared adapter

---

## Governance Call — why this needs the full gate (and B2B-58 did not)

B2B-58 was fast-tracked past the BA because it was a one-line handler scoping fix with no product
decision in it. **This one is the opposite** and gets the full CEO → BA → Dev chain, per Arun's own
direct instruction ("write the spec and proceed, address the root cause properly"):

- It changes **when Clio speaks and how fast she gets through material** — a product-visible pacing
  change, not an invisible correctness fix.
- It requires a real product decision about **what should happen when a participant interrupts** —
  there is no technically-correct default; it depends on what we want the experience to be.
- It touches `lib/voice/openai-realtime-adapter.ts`, which the **meeting-bot channel also uses**.
  Cross-channel blast radius needs to be scoped deliberately, not assumed.
- It reverses a decision Arun personally made twice (v14's adoption of `idle_timeout_ms`, v16's
  deferral of the playback-backlog fix). Reversing an owner decision goes through the chain.

**ID allocation:** a formal `B2B-NN` slot, not an ad-hoc tracked item. B2B-74 is the next free
number (B2B-73 is the highest allocated anywhere in repo). It needs a Live Status row in
`docs/b2b-pivot-status.md` because it will produce real shipped code in an already-live channel,
matching how B2B-58/59 (the previous live-session reliability bugs) were tracked.

---

## What Arun Said

> "this is worst than before. topic 1 ok. but it asked question 1 repeated the filler and compared
> the answer against question 2 and mentioned wrong then went to topic 3 without going through
> topic 2."

Then, after reviewing the root-cause analysis:

> "yes write the spec and proceed. address the root cause properly."

The trigger was session `444b3ae9-cace-43e3-b5b0-205775e75acc`, the first live test after the v18
prompt round shipped. The participant ended the call themselves, saying Clio had skipped an entire
subtopic.

---

## The Problem Being Solved

**There is one root cause, and it presents as three separate bugs.**

The live voice session runs on **two different clocks that have been silently allowed to drift
apart**:

- **Server clock** — where OpenAI is in generating speech. Runs 3-5x faster than real speech.
- **Participant clock** — what the person has actually heard. Runs at real speaking speed.

Every safety and recovery mechanism we have built into this channel is anchored to the **server
clock**. The participant lives on the **participant clock**. In the tested session that gap grew to
roughly **90-100 seconds — about one full topic.**

That is not a rounding error. It means Clio and the participant were, for most of the session,
having two different conversations.

### How the drift is created

The model generated topic 1 as **245 words in 21.24 seconds**. At real teaching pace that is
**~100 seconds of audio**. So the instant the server considered that turn finished, **~80 seconds of
speech the participant had not yet heard was sitting in a local queue.** Nothing in the system waits
for that queue. The model immediately moves on, generates the next turn, and the gap compounds.

The decisive piece of evidence: when the participant finally gave a real spoken answer, **they
answered topic 1's question** — while the model had topic 2's question pending. They weren't
confused. They were answering the last thing they had actually heard. The model marked them wrong
and moved on to topic 3. Both parties behaved correctly on their own clock.

### Finding 1 — `idle_timeout_ms` invents a participant answer that was never given

Confirmed against OpenAI's own documentation, not inference. When the idle timeout fires, the server
**commits an empty audio segment to conversation history and triggers a model response**, explicitly
to "give the model a chance to check whether VAD failed and there was a user utterance during the
relevant period."

**We are paying OpenAI to invite the model to guess that the participant spoke.** In the tested
session it took that invitation: with topic 1's verification question pending and total silence, it
produced "Yes, that's right. It uses a written set of principles to critique and improve its own
responses…" — confirming and grading an answer that does not exist.

No prompt wording can prevent this. G3 was never consulted; the server generated that turn on its
own. This is the documented behaviour of the mechanism v14 adopted, and the v14 code comment itself
records that its behaviour was never confirmed against a live connection.

### Finding 2 — interrupting Clio destroys everything she hasn't said yet

`openai-realtime-adapter.ts` clears the **entire** queued playback buffer on every
`input_audio_buffer.speech_started`.

With no backlog that is correct and standard barge-in behaviour. **With an 80-second backlog it
silently deletes over a minute of teaching the participant was about to hear.** In the tested
session the participant said "Yeah," then "oh yeah" — each one wiped the queue.

This is why they reported a skipped subtopic. **Clio did teach it. The audio was thrown away before
it reached them.** This is genuine content loss, not a perception or timing complaint, and it has
never been tracked as a bug because `speech_started` is not logged to diagnostics at all.

### Finding 3 — two recovery mechanisms race each other, non-deterministically

On the same idle-timeout trigger, **two independent things now try to make Clio speak**: OpenAI's own
server-side auto-response (Finding 1), and our client's `triggerRecoveryNudge()`.

Whichever lands first wins, and it is a coin flip. In the same session, minutes apart:

- **Server won** → the self-answer above, with zero check-in language.
- **Client won** → the check-in fired correctly, but produced **two utterances back to back** — "Take
  your time — whenever you're ready" immediately followed by a verbatim repeat of the question.

Same trigger, opposite outcomes. **Every past attempt to fix this by rewording the prompt was
debugging a coin flip.** That is worth stating plainly: several rounds of prompt work were spent
chasing symptoms of a race no wording could reach.

### Why these are one piece of work, not three

Fix the clock drift and the other two largely dissolve:

- The idle timeout stops firing while the participant is still listening.
- Barge-in becomes correct again, because there is no longer a large backlog to destroy — clearing
  the queue goes back to meaning "stop talking now," which is what it was always supposed to mean.
- The race becomes rare and low-stakes, because genuine silence becomes genuine.

**Fixing any one of them alone leaves the other two live.** Fixing Finding 2 without the clock fix
would be actively wrong — it would make Clio ignore interruptions while an enormous backlog plays
out, which is worse than today.

---

## What Success Looks Like

Expressed as participant-observable outcomes, not implementation:

1. **What Clio says and what the participant hears stay in step for the whole session.** The gap
   never grows to the point where a question is answered a topic late.
2. **Clio never grades an answer that wasn't given.** If there is silence, she treats it as silence.
3. **Interrupting Clio doesn't delete the lesson.** A participant saying "yeah" mid-explanation loses
   at most the sentence in progress, never the rest of the topic.
4. **Silence produces one predictable reaction, every time** — not a coin flip between a warm
   check-in and a fabricated answer.
5. **A check-in is one utterance**, not a check-in followed by a separate re-ask of the question.
6. **A participant can still interrupt and be heard promptly.** Whatever is done about barge-in must
   not make Clio feel unresponsive or talk over people — that would trade a real bug for a worse one.
7. **The session still completes in a reasonable wall-clock time.** Reconverging the clocks
   necessarily changes pacing; the BA must confirm the resulting session length is acceptable, and
   flag it to the CEO if it is not.

---

## Known Constraints

**From Arun, explicit:**
- Address the root cause properly. Do not ship another prompt-wording round as the primary fix.
- No code until Arun has had **the approach explained to him in plain language** (see Handoff below).

**From the CEO review:**
- **Do not revert v18.** It is not a cause of any of these three findings; reverting it reinstates the
  crammed-opening bug it fixed. If the BA finds a reason to disagree, escalate rather than assume.
- **`lib/voice/openai-realtime-adapter.ts` is shared with the meeting-bot channel.** The spec must
  state explicitly, per change, whether it applies to both channels or widget-only, and justify it.
  The meeting-bot path is not in scope to fix or to break.
- **`lib/voice/hume-adapter.ts` is out of scope entirely** — Hume is a different provider with
  different playback mechanics and remains the default provider. Do not touch it.
- **`speech_started` / `speech_stopped` / `committed` must be added to diagnostics regardless of which
  fix shape is chosen.** This is zero-risk, and without it none of this is verifiable — the entire
  input side of every timeline we have ever pulled has been invisible.
- Diagnostic timestamps are currently assigned **server-side at the capture route**, so they are
  arrival times subject to network jitter. Sub-10-second timing claims cannot be trusted from the
  current instrumentation. If the spec depends on fine-grained timing, it must fix this first.
- **This is a `docs/specs/B2B-74-requirement-document.md` deliverable**, matching the convention used
  by B2B-57b/B2B-61/B2B-63.

---

## Questions for BA

Section 11 must be empty before this is approved. These are the real forks — I do not want them
resolved by picking the first workable option.

**Q1 — Reconverging the clocks: what is the mechanism, and what does it cost?**
v16 already identified a native in-repo option (gating the tool-dispatch `response.create` on
`waitForPlaybackCaughtUp()`, the same wait `advance_tab` already uses) and deferred it because it
changes pacing. That deferral is now the thing to undo. Confirm whether that mechanism actually
closes the gap **at every point where a new turn is created** — not just tool dispatch — and quantify
what it does to total session length. If it introduces dead air between turns, say so and propose how
that is handled.

**Q2 — `idle_timeout_ms`: remove it, or keep it and stand down our own nudge?**
Removing it eliminates the fabricated-answer path entirely but loses a platform-native silence signal
and puts us back on a client-side timer — which v14 was explicitly moving away from. Keeping it and
removing the client nudge is a smaller change but **leaves the model free to guess an answer**, which
is the actual Finding 1 bug. My lean is removal, but I want the BA to test that against what Arun
originally wanted from v14 ("wait, check again, then end gracefully") and confirm we can still deliver
that behaviour. **If the answer is that we cannot, escalate to me before specifying either option.**

**Q3 — Barge-in: what should actually happen when a participant speaks over Clio?**
This is a genuine product decision with no correct default. At minimum consider: clear everything
(today's behaviour); clear nothing; clear only past the current sentence/utterance boundary; or rely
on Q1 making the backlog small enough that today's behaviour becomes correct again. Whichever you
pick, specify what the participant experiences in the two cases that matter — a deliberate interrupt,
and an incidental "mm-hmm" while listening. **Note that with far-field noise reduction and the current
VAD threshold, incidental sounds do trip this.** Do not treat those two as the same event without
saying why.

**Q4 — What is the one, predictable thing that happens on genuine silence?**
Today it is a coin flip. Specify the single behaviour, and confirm it survives whichever answer Q2
lands on. This must also resolve the two-utterance check-in problem: the current instruction names two
speech acts ("check in… then wait for their answer again"), which is the same `A then B` structure
identified in the v12 history as reliably collapsing or doubling. **This one is a prompt fix and is
legitimately in scope** — but as a supporting change, not the primary one.

**Q5 — How do we know it worked?**
Specify acceptance in terms that can be read off a live session's own captured data — the measured gap
between what Clio has said and what the participant has heard, count of fabricated-answer events,
count of discarded audio events. Anecdote ("it felt better") is not acceptance for this one. Given
that several past rounds shipped on a clean build and a good-feeling test, the spec needs a real
measurable bar.

**Q6 — Sequencing.**
These are causally linked but not equally risky. Is this one shipped change, or a staged sequence with
a live test between stages? State a recommendation. Note the standing practice in this file's own
history of not bundling independent interventions into one round — but note also that Q1 and Q3 are
**not** independent, and shipping Q3 without Q1 is actively harmful.

---

## Handoff — CEO instruction on sequencing

1. BA writes `docs/specs/B2B-74-requirement-document.md`, all 12 sections, Section 11 empty.
2. **CEO reviews and approves** — no developer agent starts before that.
3. **The approved approach is explained to Arun directly, in plain language, before any code is
   written.** This is his explicit instruction and it is a hard gate, not a courtesy. Approval of the
   spec is not authorization to build.
4. Only then does implementation begin.

Standing rule reminder for whoever builds this: any screen touched comes up to the responsive/
mobile-friendly bar in the same change. Likely not applicable here (this is voice/adapter work), but
`WidgetRenderClient.tsx` does render UI — if its rendered output changes at all, the rule applies.

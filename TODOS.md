# TODOS — Deal Finder

---

## TODO-1: Define entity resolution confidence threshold

**What:** Validate the fuzzy-matching confidence threshold (currently a guess at 70%) against real data.
**Why:** If threshold is wrong, wholesalers get mismatched leads → lose trust before you have a case study.
**Pros:** Prevents garbage leads at the worst possible time (early beta).
**Cons:** Requires curating ~100 test records — a few hours of manual work.
**Context:** During Gate 0, pull real CAD + court records and manually verify 100 name-to-property matches. Use this to calibrate the Jaro-Winkler threshold. Anything below the calibrated line goes to the review queue.
**Depends on:** Gate 0 data access (week 1–2)

---

## ~~TODO-2: Model skip-trace unit economics~~ — RESOLVED

**Resolution:** DCAD mailing address eliminates skip tracing for Gates 1–2. Owner contact info is free via the appraisal roll. Revisit skip tracing only if DCAD mailing addresses prove insufficient for reaching owners (e.g., mail goes unanswered and phone is needed).

---

## TODO-2 (original, superseded): Model skip-trace unit economics

**What:** Get real per-lookup pricing from BatchSkipTracing, IDI, and TLO. Model cost vs. revenue at $1k–2k/month.
**Why:** At $0.10–$0.50/lookup, a heavy user unlocking 50 contacts/week = $20–100/month in COGS. At $1k MRR that's fine; at $2k with a heavy user it could be tight.
**Pros:** Avoids discovering negative margin after signing up first paying customer.
**Cons:** 30 minutes — just pull vendor pricing pages.
**Context:** The design doc flags this as a Reviewer Concern. Resolve it before Gate 2. Add a simple margin model: revenue − hosting − skip-trace − data vendor = gross margin.
**Depends on:** Nothing — can be done this week.

---

## TODO-4: Run /design-consultation to produce DESIGN.md

**What:** Create a full design system (typography scale, color system, component library, spacing) as DESIGN.md.
**Why:** The minimal design system in the design doc is sufficient for MVP, but a full DESIGN.md makes design decisions explicit and prevents drift as the team grows.
**Pros:** Ensures consistent UI across all future screens. Eliminates "what font size for this?" decisions during implementation.
**Cons:** Takes 30-45 minutes. Not blocking for Gate 1 or Gate 2.
**Context:** Run `/design-consultation` after first beta wholesaler validates the product direction. IBM Plex Sans + Mono and the warm neutral color system are the seed.
**Depends on:** Gate 1 beta validation

---

## TODO-5: Add credit/usage display before paid launch

**What:** Show wholesalers how many skip-trace credits they have and what each unlock costs.
**Why:** Surprise billing destroys trust. Credits UI is a trust feature.
**Pros:** Transparent pricing → fewer support tickets, lower churn from bill shock.
**Cons:** Requires billing infrastructure to be built first.
**Context:** During beta, all unlocks are free (no UI needed). Before first paid subscription, add credit balance to header and cost-per-unlock on the button.
**Depends on:** Gate 3 (first paid customer)

---

## TODO-3: Validate bulk list vs. pre-qualified lead preference during wholesaler observation

**What:** During the wholesaler observation session, answer: do they want 10 properties to cold-call, or 1 pre-vetted seller who's already shown willingness?
**Why:** Deal Finder is designed for bulk lists. If wholesalers actually want pre-qualified leads (owner has responded), the product is wrong.
**Pros:** 30 seconds to add to the observation checklist. Could save months of building the wrong thing.
**Cons:** None.
**Context:** When sitting with the wholesaler, watch specifically: when an owner doesn't answer, do they skip immediately or keep calling? How many calls does it take to reach a "real" lead? Do they buy lists and call everyone, or do they filter hard before calling?
**Depends on:** Wholesaler observation session (The Assignment)

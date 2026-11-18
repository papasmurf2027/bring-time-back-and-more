# Bring Time Back and More — Railway-ready rebuild

A fresh rebuild of Kevin's auction site, built from the settled spec — **not** a copy of the Muse artifact source. Node.js + Express + Postgres on Railway, with a local SQLite fallback for testing.

**Test mode only:** no real payment processor is connected. Payment checks are simulated with test details, escrow is tracked state in the database (not a real bank account), and Label Pass is a test-only label record. Do not take real money until an LLC + a real processor (e.g. Stripe Connect) are in place.

## What is in here

- `server.js` — Express API + timer sweep (auto-ends auctions, draws Free Drops)
- `schema.sql` — Postgres schema (also builds the SQLite fallback)
- `public/` — the site: `index.html`, `app.js`, `styles.css`, `logo.jpg` (Kevin's uploaded logo, copied unchanged — not redrawn)
- `Dockerfile`, `railway.json` — Railway deploy config (`PORT` + `DATABASE_URL` env vars)
- `package.json` — only deps: `express`, `pg`

## Settled rules kept

- Name **Bring Time Back and More**, tagline "Buy it. Sell it. That's it.", gold + dark navy, simple: Sell Something / Buy Something, 3-step How It Works.
- Commission **10%** normal on item price only (not shipping). Founding sellers: **first 10, 0% until it goes live, then 5% forever** — counter shown, 10-spot cap enforced.
- Auction: timer presets 10s / 30s / 2 min / custom 5s–60min; **Sudden Death** (outbid does NOT reset timer) and **Regular** (outbid adds 10s). Bid slider / +$1/+$5/+$10 / custom bid, total bid+shipping shown before confirming.
- Store / Buy Now Only: fixed price, no bidding, no timer, separate section. **No automatic Buy It Now in auctions** — the seller *may* post a Buy It Now offer in auction chat.
- Buyers pay shipping — the price is set by **package size** the seller picks when listing: Small (under 4 oz) $4.47, Medium (4–8 oz) $4.85, Large (8–12 oz) $5.25, XL (12 oz–1 lb) $6.75, Box (1–5 lb) $7.75, Big box (over 5 lb) $9.69+, Flat Rate box $12.99, Card envelope $0.99. Insured shipping required. Refunds only within **12 hours of receipt**, legit reason only, owner not responsible. Winner receipt + video receipt; refund form locked until **both a photo and a video** are attached.
- **Carrier rule:** shipping carrier is automatic from package size — **everything ships via USPS, except Big box over 5 lb, which ships via UPS. No FedEx.** The seller never picks a carrier. Shown as "Ships via USPS" / "Ships via UPS (over 5 lbs)" on listings, the sold item page, and under the QR code.
- **Ship QR code:** when an item is won/bought and payment validates, the sold item page and the owner dashboard show a big QR code for that exact sale (URL with item id + receipt + tracking code + carrier, e.g. `?i=<id>&r=<receipt>&t=<tracking>&c=USPS` or `&c=UPS`, drawn by a small vendored QR generator in `app.js` — no dependency, no external QR service). The seller scans it with their phone — it opens that exact sale — then taps **Mark as shipped** (seller-only, once). Tracking formats (test records): USPS `BTB<9 digits>US`, UPS `BTB<9 digits>UPS`. The QR is a shipment record / scan-to-identify code, **not real postage yet** — no real carrier is connected.
- Escrow (simulated): payment validated first, held in escrow, seller paid only after delivery + 12h, $0 until payment validates. Statuses: "Payment went through — in escrow hold" / "Payment declined — buyer needs to fix payment" / "Waiting for winner payment". Big red **"PAYMENT DIDN'T GO THROUGH! Don't lose this sale"** panel with Fix Payment + Rerun Auction (seller-only, relists same price/timer/mode, clears winner/bids/declined payment).
- Banned items, Report a listing, Seller Agreement required. Authenticity required (Authentic / Replica / Unbranded) — replica/unbranded must be disclosed, claiming a replica is real is blocked.
- **LIVE NOW** (never "on camera"): Live Now section, Browse by Type tiles, auction chat (seller tagged "(seller)"), seller Go Live — live video + audio (WebRTC peer-to-peer, buyers hear the seller talk) plus chat.
- Seven features, own wording: Keep Track, Free Drops, My Top Limit, Seller Scorecard, Coming Up, One Box Deal (biggest shipping once + $2 per extra item), Label Pass (test only).
- Owner dashboard: fees earned, tax set aside (default **25%**, changeable 20/25/30/custom), available to use / owner draw, kept separate from escrow.
- Pre-launch/test banner + waitlist. Footer: "© 2026 Bring Time Back and More. All rights reserved." + no-copying note. **No "Whatnot" name anywhere, no "simpler than Whatnot".**
- Owner dashboard: "Tell the waitlist we're live" — shows the waitlist count, the ready-to-send message, a copyable email list and a BCC mailto link. With `RESEND_API_KEY` set (free Resend account, https://resend.com — create an API key, add it as a Railway Variable; optional `FROM_EMAIL` / `OWNER_EMAIL`), it sends the email automatically via Resend (one call, everyone in BCC). Without a key nothing is sent automatically — Kevin sends it from his own email via the mailto link and taps "I sent it" to mark it sent. A `live_notice` row records a completed send, so the list is never emailed twice by accident (a second send needs the explicit "Send again" button). It does **not** flip `PRELAUNCH` off — that is still a separate decision.
- **No advertising other auction sites on this site (server-side):** chat, listing titles/descriptions (including Random Item base names and Time Wheel item names), revealed items, reviews, Free Drop titles and show titles are all rejected server-side if they contain a link to another site or a named competitor domain (`whatnot.com`, `ebay.com`, `mercari.com`, `poshmark.com`, `offerup.com`, `craigslist.org`, `facebook.com`, `etsy.com`, `amazon.com`, `tiktok.com`, `shop.app`, or any generic `http://` / `https://` / `www.` / `.com` / `.net` / `.shop` link) or a competitor name + an advertising phrase ("check out my whatnot show", "follow me on ebay"). Error: "No advertising other auction sites or marketplaces here — links to other sites are not allowed." This site's own links (`bringtimebackandmore.com`, the Railway domain) are allowed, and a plain question mentioning a site ("did you buy this on ebay?") is allowed. Buy It Now chat offers carry no user text (amount only). Existing posts are not retroactively deleted. Rules + footer add: the name/logo **™ Bring Time Back and More** may not be used by any other site/seller to advertise their own auction page or business. **Honest limit:** this only blocks advertising ON this site. It cannot stop another site using the name elsewhere — that needs a USPTO trademark filing (not done yet — ™ only, no ® claimed) plus takedown letters.
- **Automatic welcome email:** joining the waitlist (`POST /api/waitlist`) automatically tries to email the new joiner right away — subject "You're on the list — Bring Time Back and More", saying they're on the list and will be emailed when it goes live (founding deal + site link included). Same Resend pattern as the launch email. Response field `welcomeEmail` is `'sent' | 'manual' | 'failed' | 'already'`; the join message says "Check your email" only when it actually sent. If no key is set, the signup still succeeds and the joiner is recorded `welcome_email_status='pending'` (a failed Resend attempt records `'failed'`); the owner dashboard shows how many welcomes were sent / are still to send / failed, with the pending names and emails, and the launch email still covers everyone. A duplicate email joining twice is not a new join and gets no second welcome. **Kevin still needs a real Resend API key for any email to actually send automatically.**

## Run locally (no Postgres needed)

```bash
cd railway-rebuild
npm install
npm start
# open http://localhost:3000
```

Local runs use a SQLite file `data.db` (created on first start). Delete it to reset test data.

Test payment details (simulated only):
- `4242424242424242` — passes
- `4000000000000002` — declines (card_declined)
- `4000000000009995` — declines (insufficient_funds)

Quick API smoke test:

```bash
curl localhost:3000/api/health
curl -X POST localhost:3000/api/listings -H 'Content-Type: application/json' -d '{"seller":"TestSeller","title":"Test Watch","category":"Watches","type":"auction","startPrice":10,"shipping":5,"shippingInsured":true,"carrier":"USPS","authenticity":"Authentic","timerSeconds":30,"mode":"Regular","agreement":true}'
# then bid on the returned id:
curl -X POST localhost:3000/api/listings/<ID>/bid -H 'Content-Type: application/json' -d '{"bidder":"Buyer1","amount":15}'
```

## Deploy to Railway (Kevin's trial account is already set up — ballingboy82@gmail.com, 30 days / $5 credits, $0 so far)

**Do this from a computer / the Railway dashboard — nothing here deploys itself.**

1. **Put this code on GitHub** (Railway deploys from a repo):
   ```bash
   cd railway-rebuild
   git init && git add -A && git commit -m "Bring Time Back and More — Railway rebuild"
   # create an empty repo on github.com (e.g. bring-time-back-and-more) and:
   git remote add origin https://github.com/<your-username>/bring-time-back-and-more.git
   git push -u origin main
   ```
   Do NOT commit `.env` or `data.db` (already in `.gitignore`).
2. **Railway → New Project → Deploy from GitHub repo** → pick the repo. Railway detects the Dockerfile and builds it.
3. **Add Postgres:** in the project, **New → Database → Postgres**. Railway sets `DATABASE_URL` on the web service automatically (if it doesn't, link it: service → Variables → add reference `${{Postgres.DATABASE_URL}}`).
4. **Variables on the web service:** `PRELAUNCH=true` (keep test mode on). `PORT` is set by Railway automatically — do not hard-code it.
5. **Deploy** and open the Railway domain it gives you (e.g. `https://bring-time-back-and-more.up.railway.app`). Check `/api/health` returns `ok: true`, then list a test item, bid, and buy a Store item with test card `4242…4242`.
6. **Custom domain — bringtimebackandmore.com** (already bought on Namecheap, 1 year, auto-renew OFF):
   - Railway service → Settings → Networking → **Custom Domain** → enter `bringtimebackandmore.com` (and `www.bringtimebackandmore.com` if wanted). Railway shows a CNAME target.
   - Namecheap → Domain List → bringtimebackandmore.com → Advanced DNS → add a **CNAME** for `@` / `www` pointing at the Railway target Railway shows (Namecheap may need an ALIAS/URL redirect for the bare `@` — follow what Railway's domain page says).
   - DNS takes minutes to a few hours. Then `https://bringtimebackandmore.com` opens the site.
   - After it's live, submit it to Google Search Console to be found faster (Google crawling takes days–weeks on its own).
7. **When the trial runs out** (30 days or $5 credits): upgrade to keep services online — Railway Hobby is $5/month, or the Free plan is $1/month after trial per Railway's pricing page. That step charges money — only do it when Kevin says so.
8. **Before real money:** form the LLC (Jan 2027 in RI — do not file in 2026), connect a real payment processor, connect a real streaming service and a real shipping carrier. Until then, keep `PRELAUNCH=true`.

## Known differences / gaps vs the Muse v21 site

- No photo uploads are stored: listings have no stored photos (same as Muse v21), and the refund photo/video are recorded by file *name* — the API requires both names, but does not store the file bytes. A real file store (e.g. Railway volume / S3) is needed before live refunds.
- Chat polls on page load, not live-push; the front end refreshes listings every 15s.
- Camera Go Live sets the LIVE NOW status only — no video is streamed (same honest limit as v21).
- Test listings in the local `data.db` are throwaway; Railway Postgres starts empty.

## Random Items (numbered, no picture needed)
- In a live auction, a seller who doesn't want to put a picture up can create numbered random items — Random Item 1, 2, 3, up to 100 in one tap (sell form, "Random items — no picture needed"; base name optional, e.g. "Random Watch 1"). Each is a normal auction (bidding, slider/custom bid, My Top Limit, timers, Sudden Death/Regular, chat, Go Live with video+sound, payment check, escrow, shipping by size, carrier USPS / UPS over 5 lbs, QR per sale) with no photo and a "RANDOM ITEM — no picture, seller shows it live on camera" badge.
- After a random item is won and paid, the seller types what the winner actually won — the item they held up live on camera — in the "What they won" box on the sold item page (`POST /api/listings/:id/reveal`, seller-only, saved as `revealed_item`). It is then shown on the winner receipt, on the video receipt record (`GET /api/receipt/:id` returns `revealedItem` and a `videoReceipt` object: item as listed, revealed item, bid history, whether the seller was live, room chat), on the sold item page, and in the ship-QR section as the item to ship. Until the seller fills it in, the receipt says "Random Item — revealed live on camera, seller to confirm what it was". Rerunning an auction clears the revealed item.

## Time Wheel
- A third listing type alongside Auction and Store. The seller loads the wheel with 1–100 items (one per line in the sell form); buyers see every item on the clock-face wheel (gold + dark navy, gold hand) before bidding.
- Bidding works like a normal auction (timer, Sudden Death / Regular, shipping by package size, buyer pays shipping, insured required). The winner pays the winning bid + shipping; on payment validation the wheel spins (server picks one item at random with `crypto.randomInt`) and lands on ONE item — that item is what the winner gets. No extra prize, no extra charge. Nobody buys a spot and nobody pays to spin.
- The landed item is recorded on the listing (`wheel_landed_item`), announced in the room chat, named on the receipt (`GET /api/receipt/:id` returns `landedItem`), and named in the ship-QR section so the seller ships the right item. `POST /api/listings/:id/spin` is a seller/winner-only fallback that returns the already-landed item if the wheel has spun. Rerunning clears the spin; the wheel items stay.

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
- **Ship QR code:** when an item is won/bought and payment validates, the sold item page and the owner dashboard show a big QR code for that exact sale (URL with item id + receipt + tracking code, drawn by a small vendored QR generator in `app.js` — no dependency, no external QR service). The seller scans it with their phone — it opens that exact sale — then taps **Mark as shipped** (seller-only, once). The QR is a shipment record / scan-to-identify code, **not real USPS postage yet** — no real carrier is connected.
- Escrow (simulated): payment validated first, held in escrow, seller paid only after delivery + 12h, $0 until payment validates. Statuses: "Payment went through — in escrow hold" / "Payment declined — buyer needs to fix payment" / "Waiting for winner payment". Big red **"PAYMENT DIDN'T GO THROUGH! Don't lose this sale"** panel with Fix Payment + Rerun Auction (seller-only, relists same price/timer/mode, clears winner/bids/declined payment).
- Banned items, Report a listing, Seller Agreement required. Authenticity required (Authentic / Replica / Unbranded) — replica/unbranded must be disclosed, claiming a replica is real is blocked.
- **LIVE NOW** (never "on camera"): Live Now section, Browse by Type tiles, auction chat (seller tagged "(seller)"), seller Go Live — live video + audio (WebRTC peer-to-peer, buyers hear the seller talk) plus chat.
- Seven features, own wording: Keep Track, Free Drops, My Top Limit, Seller Scorecard, Coming Up, One Box Deal (biggest shipping once + $2 per extra item), Label Pass (test only).
- Owner dashboard: fees earned, tax set aside (default **25%**, changeable 20/25/30/custom), available to use / owner draw, kept separate from escrow.
- Pre-launch/test banner + waitlist. Footer: "© 2026 Bring Time Back and More. All rights reserved." + no-copying note. **No "Whatnot" name anywhere, no "simpler than Whatnot".**
- Owner dashboard: "Tell the waitlist we're live" — shows the waitlist count, the ready-to-send message, a copyable email list and a BCC mailto link. With `RESEND_API_KEY` set (free Resend account, https://resend.com — create an API key, add it as a Railway Variable; optional `FROM_EMAIL` / `OWNER_EMAIL`), it sends the email automatically via Resend (one call, everyone in BCC). Without a key nothing is sent automatically — Kevin sends it from his own email via the mailto link and taps "I sent it" to mark it sent. A `live_notice` row records a completed send, so the list is never emailed twice by accident (a second send needs the explicit "Send again" button). It does **not** flip `PRELAUNCH` off — that is still a separate decision.

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

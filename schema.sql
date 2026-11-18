-- Bring Time Back and More — Postgres schema (also used to build the SQLite fallback).
-- Run automatically on server start. No real payment processor is connected:
-- payment validation is a SIMULATED test check only, and escrow is tracked state, not a bank account.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY, tax_percent REAL DEFAULT 25, prelaunch INTEGER DEFAULT 1, founding_total INTEGER DEFAULT 10
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, seller TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT DEFAULT 'Other', type TEXT DEFAULT 'auction',
  start_price REAL DEFAULT 0, current_bid REAL DEFAULT 0, fixed_price REAL,
  shipping REAL DEFAULT 0, shipping_insured INTEGER DEFAULT 0, carrier TEXT DEFAULT '',
  authenticity TEXT DEFAULT 'Authentic', timer_seconds INTEGER DEFAULT 30, mode TEXT DEFAULT 'Regular',
  status TEXT DEFAULT 'live', created_at TEXT NOT NULL, ends_at TEXT,
  winner TEXT, payment_status TEXT DEFAULT 'none', payment_method TEXT, payment_last4 TEXT, payment_reason TEXT,
  escrow_status TEXT DEFAULT 'not_started', escrow_amount REAL DEFAULT 0,
  tracking TEXT, delivered INTEGER DEFAULT 0, delivered_at TEXT, seller_live INTEGER DEFAULT 0, seller_live_at TEXT,
  buy_now_offer REAL, buy_now_offer_by TEXT, image_url TEXT DEFAULT '',
  package_size TEXT DEFAULT '', shipped_at TEXT,
  wheel_landed_item TEXT DEFAULT '', wheel_landed_at TEXT, wheel_spun INTEGER DEFAULT 0,
  is_random INTEGER DEFAULT 0, revealed_item TEXT DEFAULT '', revealed_at TEXT
);
CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, bidder TEXT NOT NULL, amount REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, name TEXT NOT NULL, message TEXT NOT NULL, is_seller INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS follows (id TEXT PRIMARY KEY, buyer TEXT NOT NULL, seller TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY, seller TEXT NOT NULL, title TEXT NOT NULL, ends_at TEXT NOT NULL, winner TEXT, status TEXT DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drop_entries (id TEXT PRIMARY KEY, drop_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS top_limits (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, buyer TEXT NOT NULL, max_amount REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, seller TEXT NOT NULL, reviewer TEXT NOT NULL, stars INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shows (id TEXT PRIMARY KEY, seller TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, created_at TEXT NOT NULL);
-- welcome_email_status: 'sent' (welcome email sent via Resend), 'pending' (no
-- Resend key set yet so the joiner is stored and still to be welcomed, and the
-- launch email still covers them), or 'failed' (Resend was tried and refused it).
-- welcome_sent_at records when a welcome email actually went out.
CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT DEFAULT 'buyer', founding INTEGER DEFAULT 0, created_at TEXT NOT NULL, welcome_email_status TEXT DEFAULT 'pending', welcome_sent_at TEXT);
CREATE TABLE IF NOT EXISTS founding (id TEXT PRIMARY KEY, seller TEXT NOT NULL, claimed_at TEXT NOT NULL);
-- Refund return rule (Kevin, 2026-11-18): when a refund is asked, it is UP TO
-- THE SELLER what happens next. return_choice is '' until the seller decides,
-- then 'no_return' (refund without the item back) or 'want_back' (seller wants
-- the item back first - no refund until the seller receives it). If the seller
-- wants it back, a tracked return label is sent to the buyer (return_label_*
-- fields, Label Pass-style record in the labels table - the return label cost
-- (return_cost) is paid by the seller, ONLY when the seller asked for the item
-- back - taken from the seller's money, not the buyer's and not the owner's
-- fees. If the buyer never ships the return back before the refund window
-- (payout date) closes, the refund expires (status 'expired') and no refund
-- is given. Once the return IS shipped, it is never expired at the payout
-- date - the buyer did their part. Delivery fix (Kevin, 2026-11-18): when the
-- carrier scans the return as DELIVERED, the refund releases at once - no
-- seller tap needed (return_delivered_at, POST /api/refunds/:id/
-- return-delivered - in test mode delivery is recorded from the tracking /
-- mark-as-delivered step, no live carrier feed yet - at go-live a real
-- carrier delivery scan does it automatically). Safety net: if the seller
-- never confirms receipt, the refund auto-releases 48 hours after the return
-- was shipped. return_due_at is the date the buyer must have shipped the
-- return by (the payout date, or 7 days after the owner rules a wrong-item
-- dispute in the seller's favour). Buyer return proof (Kevin, 2026-11-18):
-- before the buyer can mark a return shipped they must attach a photo and a
-- video of the item going into the box + a picture of the return label on
-- the same box when it is sent out (return_video_name is the video,
-- return_photo_name is the label picture) - that stops a seller claiming
-- the wrong item came back when it did not. Wrong-item dispute (Kevin,
-- 2026-11-18): after the return is shipped, the seller has 48 hours to flag
-- "wrong item sent back" with a photo and a video of what actually arrived
-- (dispute_photo_name, dispute_video_name, dispute_at) - that pauses the
-- refund at once, the 48-hour auto-release stops, and the owner decides.
-- dispute_status is 'correct' (the item was right - the claim was not
-- upheld after review, recorded in incorrect_claims) or 'wrong' (the buyer
-- did send the wrong item - refund denied until the right item is sent back). status
-- values: 'pending' (seller deciding), 'awaiting_return', 'disputed'
-- (wrong-item dispute open, refund paused), 'approved' (refund released from
-- the seller's escrow money), 'expired'.
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, requester TEXT NOT NULL, reason TEXT NOT NULL,
  photo_name TEXT, video_name TEXT, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL,
  return_choice TEXT DEFAULT '', return_label_carrier TEXT DEFAULT '', return_label_tracking TEXT DEFAULT '',
  return_label_code TEXT DEFAULT '', return_cost REAL DEFAULT 0,
  return_shipped_at TEXT, return_tracking TEXT DEFAULT '', return_received_at TEXT, return_delivered_at TEXT, decided_at TEXT,
  dispute_photo_name TEXT DEFAULT '', dispute_video_name TEXT DEFAULT '', dispute_at TEXT, dispute_status TEXT DEFAULT '', dispute_decided_at TEXT, return_due_at TEXT,
  return_photo_name TEXT DEFAULT '', return_video_name TEXT DEFAULT ''
);
-- Incorrect return claims (Kevin, 2026-11-18): if the owner rules a
-- wrong-item dispute "item is correct", the claim was not upheld after
-- review - one row is recorded here, the sale does not count as a clean
-- sale, the seller drops a tier, and it is recorded on their Seller
-- Scorecard as a 1-star owner review - selling privileges are suspended for
-- 7 days for a first incorrect claim, 30 days for a second, and removed for
-- good after a third
CREATE TABLE IF NOT EXISTS incorrect_claims (
  id TEXT PRIMARY KEY, seller TEXT NOT NULL, listing_id TEXT NOT NULL, refund_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, carrier TEXT NOT NULL, tracking TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, receipt_no TEXT NOT NULL, amount REAL NOT NULL, shipping REAL NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL);
-- "We're live" notice to the waitlist: one row (id=1) records that it was sent,
-- so the same list is never emailed twice by accident. mode is 'resend' or 'manual'.
CREATE TABLE IF NOT EXISTS live_notice (
  id INTEGER PRIMARY KEY, sent_at TEXT NOT NULL, mode TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0, subject TEXT DEFAULT ''
);
-- Time Wheel: items loaded on a wheel listing (up to 100). The winner pays the
-- winning bid + shipping, the wheel spins and lands on ONE item — that item is
-- what they get. No spots to buy, no paying to spin, no extra prize or charge.
CREATE TABLE IF NOT EXISTS wheel_items (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, name TEXT NOT NULL,
  photo_url TEXT DEFAULT '', position INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_signals (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, payload TEXT DEFAULT '', created_at TEXT NOT NULL
);

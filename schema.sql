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
  condition TEXT DEFAULT '',
  no_change_of_mind INTEGER DEFAULT 0,
  status TEXT DEFAULT 'live', created_at TEXT NOT NULL, ends_at TEXT,
  winner TEXT, winner_address TEXT DEFAULT '', payment_status TEXT DEFAULT 'none', payment_method TEXT, payment_last4 TEXT, payment_reason TEXT,
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
CREATE TABLE IF NOT EXISTS saved_shows (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, show_id TEXT NOT NULL, created_at TEXT NOT NULL);
-- welcome_email_status: 'sent' (welcome email sent via Resend), 'pending' (no
-- Resend key set yet so the joiner is stored and still to be welcomed, and the
-- launch email still covers them), or 'failed' (Resend was tried and refused it).
-- welcome_sent_at records when a welcome email actually went out.
-- Waitlist confirmation (2026-11-19 fix): a welcome email is only sent
-- to an address the joiner confirmed. confirmed is 0 until they confirm
-- with the code emailed to them, or the owner confirms them
CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT DEFAULT 'buyer', founding INTEGER DEFAULT 0, created_at TEXT NOT NULL, welcome_email_status TEXT DEFAULT 'pending', welcome_sent_at TEXT, confirmed INTEGER DEFAULT 0, confirm_token_hash TEXT DEFAULT '');
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
-- carrier scans the return as DELIVERED, the delivery is recorded
-- (return_delivered_at, POST /api/refunds/:id/return-delivered - in test
-- mode delivery is recorded from the tracking / mark-as-delivered step, no
-- live carrier feed yet - at go-live a real carrier delivery scan does it
-- automatically). It does NOT release the refund at once. Safety net: if
-- the seller never confirms receipt, the refund auto-releases 48 hours
-- AFTER DELIVERY with no seller response (Kevin's rule). return_due_at is the date the buyer must have shipped the
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
-- KEPT for old listings only. Since 2026-11-19 the wheel is a FREE giveaway:
-- people's names go on the wheel (wheel_entries below), nobody pays, and the
-- winner gets the listed item free.
CREATE TABLE IF NOT EXISTS wheel_items (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, name TEXT NOT NULL,
  photo_url TEXT DEFAULT '', position INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
-- Time Wheel giveaway entries (Kevin, 2026-11-19): one row per person who
-- enters free. Their account name goes on the wheel. One entry per person
-- per wheel (enforced by the enter endpoint, by account id).
CREATE TABLE IF NOT EXISTS wheel_entries (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, name TEXT NOT NULL,
  user_id TEXT DEFAULT '', created_at TEXT NOT NULL
);
-- Confirmed bad listings (Kevin, 2026-11-19): one row each time the OWNER
-- confirms a listing is fake, stolen or a banned item and removes it. Same
-- ladder as incorrect return claims: 1st = selling suspended 7 days, 2nd =
-- 30 days, 3rd = selling privileges removed for good. One strike per
-- listing — a report alone never counts, only the owner's confirmation.
CREATE TABLE IF NOT EXISTS bad_listing_strikes (
  id TEXT PRIMARY KEY, seller TEXT NOT NULL, seller_user_id TEXT DEFAULT '',
  listing_id TEXT NOT NULL, reason TEXT DEFAULT '', created_at TEXT NOT NULL
);
-- Seller tokens (2026-11-19): one row per seller, SHA-256 hash only — the
-- plain token is never stored. Issued the first time a seller lists or
-- claims a founding spot, and returned to them once. Sellers who listed
-- before tokens existed have no row and are grandfathered once (see server).
-- Real accounts (Kevin, 2026-11-19): buyers MUST have an account to bid
-- or buy, sellers MUST have one to list. Passwords are scrypt hashes with
-- a random salt — never stored plain, never returned. Sessions and reset
-- tokens are stored as SHA-256 hashes only. Sessions expire after 30 days
-- and reset tokens after 1 hour. email_verified starts at 0. In test mode
-- bidding is allowed anyway (pre-launch, no real money).
-- Security question (Kevin, 2026-11-19): every account sets a question
-- only they know the answer to, and the answer is required to reset the
-- password. The answer is stored as a scrypt hash with its own salt, the
-- same way as passwords. It is never stored plain and never returned
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT DEFAULT 'buyer',
  email_verified INTEGER DEFAULT 0, shipping_address TEXT DEFAULT '', created_at TEXT NOT NULL,
  security_question TEXT DEFAULT '', security_answer_hash TEXT DEFAULT '', security_answer_salt TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, used INTEGER DEFAULT 0
);
-- Role-switch codes (Kevin, 2026-11-20): switching roles needs a code
-- emailed to the account's email. The code is one-time, expires in 1 hour.
CREATE TABLE IF NOT EXISTS role_switches (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, requested_role TEXT NOT NULL,
  code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Private messages (Kevin, 2026-11-20): a buyer can message a seller
-- about a listing, and only those two see it — never anyone else, never
-- the public chat. One thread per listing per buyer.
CREATE TABLE IF NOT EXISTS private_messages (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, sender TEXT NOT NULL,
  recipient TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seller_tokens (
  id TEXT PRIMARY KEY, seller TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
-- One open refund per sale (2026-11-19 fix): the database itself refuses
-- a second open refund for the same sale, so two requests at the same
-- moment cannot both get through
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_one_open ON refunds(listing_id) WHERE status IN ('pending','awaiting_return','disputed');
CREATE TABLE IF NOT EXISTS live_signals (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, payload TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_presence (
  listing_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, last_seen TEXT NOT NULL,
  UNIQUE(listing_id, user_id)
);

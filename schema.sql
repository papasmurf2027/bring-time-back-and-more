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
  buy_now_offer REAL, buy_now_offer_by TEXT, image_url TEXT DEFAULT ''
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
CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT DEFAULT 'buyer', founding INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS founding (id TEXT PRIMARY KEY, seller TEXT NOT NULL, claimed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, requester TEXT NOT NULL, reason TEXT NOT NULL,
  photo_name TEXT, video_name TEXT, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, carrier TEXT NOT NULL, tracking TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, receipt_no TEXT NOT NULL, amount REAL NOT NULL, shipping REAL NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL);

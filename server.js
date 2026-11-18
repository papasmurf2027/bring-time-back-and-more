// Bring Time Back and More — Railway-ready rebuild (fresh code, not a copy of the Muse artifact).
// Node + Express + Postgres (DATABASE_URL on Railway). Local fallback: SQLite file data.db.
// TEST MODE ONLY: no real payment processor is connected. Payment checks are simulated
// with test details, and escrow is tracked state in the database, not a real bank account.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const PRELAUNCH = process.env.PRELAUNCH !== 'false';
const isPg = !!DATABASE_URL;
let pool = null; let sqlite = null;
if (isPg) { const { Pool } = require('pg'); pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }); }
else { const { DatabaseSync } = require('node:sqlite'); sqlite = new DatabaseSync(path.join(__dirname, 'data.db')); }

async function query(text, params = []) {
  if (isPg) { const r = await pool.query(text, params); return r.rows; }
  const sql = text.replace(/\$\d+/g, '?');
  const stmt = sqlite.prepare(sql);
  try { return stmt.all(...params); } catch (e) { stmt.run(...params); return []; }
}
async function queryOne(text, params = []) { const rows = await query(text, params); return rows[0] || null; }
const uid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
// Shipping by package size (US shipping rates, buyer pays). The seller picks
// a size when listing; the buyer is charged that tier — no more guessing a $ amount.
const SHIP_SIZES = {
  small: { label: 'Small — under 4 oz', price: 4.47 },
  medium: { label: 'Medium — 4–8 oz', price: 4.85 },
  large: { label: 'Large — 8–12 oz', price: 5.25 },
  xl: { label: 'XL — 12 oz–1 lb', price: 6.75 },
  box: { label: 'Box — 1–5 lb', price: 7.75 },
  bigbox: { label: 'Big box — over 5 lb', price: 9.69, note: '$9.69+ — varies by zone' },
  flat: { label: 'Flat Rate box', price: 12.99 },
  envelope: { label: 'Card envelope', price: 0.99 },
};
function shipPrice(size) { const s = SHIP_SIZES[size]; return s ? s.price : null; }
function shipLabel(size) { const s = SHIP_SIZES[size]; return s ? s.label : ''; }
// Shipping carrier rule (Kevin, 2026-11-18): ALL shipments go USPS, EXCEPT
// Big box over 5 lb, which goes UPS. No FedEx. The carrier is automatic from
// package size — the seller never picks it, and the QR code must match it.
function carrierFor(size) { return size === 'bigbox' ? 'UPS' : 'USPS'; }
// Tracking formats (test records, not real carrier postage):
//   USPS: BTB + 9 digits + US   (e.g. BTB123456789US)
//   UPS:  BTB + 9 digits + UPS  (e.g. BTB123456789UPS)
function makeTracking(carrier) {
  const c = carrier === 'UPS' ? 'UPS' : 'USPS';
  return 'BTB' + String(Math.floor(Math.random() * 900000000) + 100000000) + (c === 'UPS' ? 'UPS' : 'US');
}
// QR code text for a won/sold item: the exact sale, so scanning it opens that
// sold item page (the app opens ?item= on load). Short param names keep the QR small.
// &c= is the carrier (USPS or UPS) so the scan shows the correct carrier.
function qrTextFor(l, receiptNo, tracking, carrier) {
  return 'https://bringtimebackandmore.com/?i=' + l.id + '&r=' + (receiptNo || '') + '&t=' + (tracking || '') + '&c=' + (carrier || carrierFor(l.package_size));
}
async function qrForListing(l) {
  if (!l || l.status !== 'sold' || l.payment_status !== 'validated') return null;
  const receipt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  if (!receipt) return null;
  const carrier = l.carrier || carrierFor(l.package_size);
  return { qrText: qrTextFor(l, receipt.receipt_no, l.tracking || '', carrier), receiptNo: receipt.receipt_no, tracking: l.tracking || '', carrier };
}
const BANNED = ['stolen','counterfeit','fake id','illegal drugs','weapon','firearm','explosives','human trafficking','stolen goods'];
const CATEGORIES = ['Watches','Clothes','Shoes','Electronics','Collectibles','Home','Fashion','Art','Sports','Toys','Other'];
function bannedHit(s) { const t = (s || '').toLowerCase(); return BANNED.find(b => t.includes(b)); }
// ---------- No advertising other auction sites / marketplaces on this site ----------
// Rule (Kevin, 2026-11-18): nobody may advertise another auction site or
// marketplace on Bring Time Back and More - in chat, listings, reviews, Free
// Drops or show titles. Enforced server-side, not just in the browser, so it
// cannot be skipped by calling the API directly. Existing posts are NOT
// retroactively deleted; the block applies to new posts/listings only.
// Allowed: this site's own links and plain text with no links.
// How it blocks, without naming any other site anywhere in the code:
// any link to anywhere else is blocked, and so is advertising language
// ("check out my show", "follow me", "click the link") - no other site's
// name is written down anywhere, on the site or in the code.
// What code CANNOT do: stop another site using Kevin's name elsewhere on the
// internet. That needs a USPTO trademark filing (not done yet - TM only, no R)
// plus takedown letters. This code only stops the advertising on THIS site.
const AD_ERROR = 'No advertising other auction sites or marketplaces here - links to other sites are not allowed.';
const OWN_DOMAINS = ['bringtimebackandmore.com', 'bring-time-back-and-more-production.up.railway.app'];
const AD_PHRASES = ['check out', 'checkout', 'follow me', 'follow my', 'my show', 'my live', 'my page', 'my shop', 'my store', 'join me', 'come to', 'visit my', 'find me', 'see me on', 'watch me', 'my link', 'click the link'];
function adHit(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  let stripped = t;
  for (const d of OWN_DOMAINS) stripped = stripped.split(d).join('');
  if (/https?:\/\//.test(stripped) || /www\./.test(stripped)) return true;
  if (/\b[a-z0-9][a-z0-9-]*\.(com|net|shop|org|io|co|app|store|site)\b/.test(stripped)) return true;
  if (/\bdot\s+com\b/.test(stripped)) return true;
  for (const phrase of AD_PHRASES) if (t.includes(phrase)) return true;
  return false;
}
function feePercent(seller, founding) { return founding ? 5 : 10; } // founding forever rate 5%, normal 10%

// ---- simulated payment check (TEST ONLY) ----
function validatePayment(method, detail) {
  const d = String(detail || '').toLowerCase();
  if (d.includes('nofunds') || d.includes('insufficient') || d.includes('9995')) return { ok: false, reason: 'insufficient_funds' };
  if (d.includes('0002') || d.includes('declined')) return { ok: false, reason: 'card_declined' };
  if (!method) return { ok: false, reason: 'no payment method given' };
  return { ok: true, reason: '' };
}
async function isFounding(seller) {
  const r = await queryOne('SELECT id FROM founding WHERE seller=$1', [seller]); return !!r;
}
async function foundingStatus() {
  const rows = await query('SELECT seller FROM founding ORDER BY claimed_at ASC');
  return { totalSpots: 10, taken: rows.length, remaining: Math.max(0, 10 - rows.length), feeNow: 0, feeForever: 5, normalFeePercent: 10, sellers: rows.map(r => r.seller) };
}
async function getSettings() {
  let s = await queryOne('SELECT * FROM settings WHERE id=1');
  if (!s) { await query('INSERT INTO settings(id, tax_percent, prelaunch, founding_total) VALUES(1,25,$1,10)', [PRELAUNCH ? 1 : 0]); s = await queryOne('SELECT * FROM settings WHERE id=1'); }
  return s;
}
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const st of schema.split(';')) { const t = st.trim(); if (t) { try { await query(t); } catch (e) { /* table may exist */ } } }
  try { await query('ALTER TABLE listings ADD COLUMN image_url TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN package_size TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN shipped_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN wheel_landed_item TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN wheel_landed_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN wheel_spun INTEGER DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN is_random INTEGER DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN revealed_item TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN revealed_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query("ALTER TABLE waitlist ADD COLUMN welcome_email_status TEXT DEFAULT 'pending'"); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE waitlist ADD COLUMN welcome_sent_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query("ALTER TABLE refunds ADD COLUMN return_choice TEXT DEFAULT ''"); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_label_carrier TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_label_tracking TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_label_code TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_cost REAL DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_shipped_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_tracking TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_received_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_delivered_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN decided_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_photo_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_video_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_status TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_decided_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_due_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_photo_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_video_name TEXT'); } catch (e) { /* column already exists */ }
  await getSettings();
}
// ---------- Time Wheel ----------
// A Time Wheel listing is an auction whose prize is picked by the wheel: the
// seller loads up to 100 items, buyers see them all before bidding, the winner
// pays the winning bid + shipping, and the wheel lands on ONE item — that item
// is what they get. No spots to buy, no paying to spin, no extra prize/charge.
function parseWheelItems(b) {
  let raw = b.wheelItems;
  if (typeof raw === 'string') raw = raw.split(/\n/);
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const it of raw) {
    const name = typeof it === 'string' ? it.trim() : String((it && it.name) || '').trim();
    const photo = typeof it === 'object' && it ? String(it.photoUrl || it.photo_url || '').slice(0, 500) : '';
    if (name) items.push({ name: name.slice(0, 120), photoUrl: photo });
  }
  return items;
}
async function wheelItemsFor(listingId) {
  return query('SELECT * FROM wheel_items WHERE listing_id=$1 ORDER BY position ASC', [listingId]);
}
async function spinWheelFor(l) {
  const items = await wheelItemsFor(l.id);
  if (!items.length) return null;
  const idx = crypto.randomInt(0, items.length);
  const landed = items[idx];
  await query('UPDATE listings SET wheel_landed_item=$1, wheel_landed_at=$2, wheel_spun=1 WHERE id=$3', [landed.name, nowISO(), l.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `⏰ Time Wheel landed on: ${landed.name} — that is the item ${l.winner} gets. No extra prize, no extra charge.`, nowISO()]);
  return { landedItem: landed.name, landedIndex: idx, totalItems: items.length };
}
// ---------- Seller-choice return rule (Kevin, 2026-11-18) ----------
// When a buyer asks for a refund, it is UP TO THE SELLER what happens next:
// (1) refund without the item back, or (2) seller wants the item back - then
// NO refund until the seller receives it back. If the seller wants it back,
// a tracked return label is sent to the buyer (Label Pass-style record, same
// automatic carrier rule: USPS, except Big box over 5 lb = UPS - test record
// only, no real carrier connected yet). The return label cost is paid by the
// SELLER, but ONLY when the seller asked for the item back - from the seller's
// money, not the buyer's and not the owner's fees. If the buyer never ships
// the return back before the refund window (payout date) closes, the refund
// EXPIRES and no refund is given - the seller keeps the sale.
// HOLE FIXED (Kevin, 2026-11-18): the buyer must NOT lose out if the seller
// never taps "I got it back" after the return was actually delivered. When
// the carrier scans the return as DELIVERED, the system records it as
// delivered on its own and releases the refund - no seller tap needed. In
// test mode there is no live carrier feed yet, so delivery is recorded from
// the tracking / "Mark return as delivered" step (POST /api/refunds/:id/
// return-delivered, usable by the buyer or the owner); at go-live a real
// carrier delivery scan will do this automatically. Safety net: once the
// return is shipped, the refund auto-releases 48 hours after the return was
// shipped if the seller still has not confirmed receipt - the seller cannot
// stall it forever by just not tapping. A return that has been shipped is
// never expired at the payout date - it waits for that 48-hour release.
const RETURN_AUTO_RELEASE_HOURS = 48;
function returnAutoReleaseAt(rf) {
  if (!rf || !rf.return_shipped_at) return null;
  return new Date(new Date(rf.return_shipped_at).getTime() + RETURN_AUTO_RELEASE_HOURS * 3600 * 1000).toISOString();
}
function withReturnDates(rf) {
  if (!rf) return rf;
  return { ...rf, returnAutoReleaseAt: returnAutoReleaseAt(rf) };
}
// Release an approved refund from the seller's escrow money. `how` says why
// the item is counted as back: 'seller_confirmed' (seller tapped),
// 'delivered' (carrier scan / mark-as-delivered), or 'auto' (48 hours passed
// since the return was shipped with no seller confirm).
async function releaseRefund(rf, l, how) {
  const now = nowISO();
  await query("UPDATE refunds SET return_received_at=$1, return_delivered_at=$2, status='approved' WHERE id=$3",
    [rf.return_received_at || now, how === 'seller_confirmed' ? (rf.return_delivered_at || null) : (rf.return_delivered_at || now), rf.id]);
  await query("UPDATE listings SET escrow_status='refunded' WHERE id=$1", [l.id]);
  const note = how === 'delivered'
    ? 'The return was scanned as DELIVERED (tracking ' + (rf.return_tracking || rf.return_label_tracking || '') + ') — the refund is released from the seller\'s escrow money. No seller tap was needed.'
    : how === 'auto'
      ? 'The return was shipped 48 hours ago and the seller never confirmed receipt, so the refund released on its own from the seller\'s escrow money — the seller cannot stall it by not tapping.'
      : how === 'dispute_correct'
        ? 'The owner reviewed the seller\'s photo and video of what came back against the receipt and video receipt — the item sent back is the correct item, so the claim was not upheld, the dispute is closed, and the refund is released from the seller\'s escrow money.'
        : 'Seller confirmed they received the item back — the refund is now released from the seller\'s escrow money.';
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, note, now]);
  return { ok: true, status: 'approved' };
}
// Auto-release: a shipped return the seller never confirms. Runs in the sweep
// (every second) and before refund reads / escrow release, so a stalled
// refund never blocks the seller's payout forever and the buyer never loses
// out because the seller did not tap.
async function autoReleaseReturns() {
  const shipped = await query("SELECT * FROM refunds WHERE status='awaiting_return' AND return_shipped_at IS NOT NULL AND return_shipped_at <> ''");
  for (const rf of shipped) {
    const at = returnAutoReleaseAt(rf);
    if (at && new Date() >= new Date(at)) {
      const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
      if (l) await releaseRefund(rf, l, 'auto');
    }
  }
}
async function expireRefundIfPast(l, rf) {
  if (!rf || !['pending', 'awaiting_return'].includes(rf.status)) return rf;
  // A return already shipped back is never expired at the payout date - the
  // buyer did their part, so it waits for the 48-hour auto-release instead.
  if (rf.status === 'awaiting_return' && rf.return_shipped_at) return rf;
  const payout = await payoutFor(l);
  // Deadline is the payout date, unless the owner gave the buyer a new
  // return deadline after a wrong-item decision - then that date is used.
  const deadline = rf.return_due_at ? new Date(rf.return_due_at) : (payout.payoutAt ? new Date(payout.payoutAt) : null);
  if (deadline && new Date() >= deadline) {
    await query("UPDATE refunds SET status='expired' WHERE id=$1", [rf.id]);
    if (l.escrow_status === 'held_refund_pending') await query("UPDATE listings SET escrow_status='held_refund_window' WHERE id=$1", [l.id]);
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Refund request expired — the refund window closed and the item was not sent back, so no refund is given.', nowISO()]);
    return { ...rf, status: 'expired' };
  }
  return rf;
}
async function expireRefunds() {
  await autoReleaseReturns();
  const open = await query("SELECT * FROM refunds WHERE status IN ('pending','awaiting_return')");
  for (const rf of open) {
    const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
    if (l) await expireRefundIfPast(l, rf);
  }
}
// Auto-end timers + draw free drops, every second.
async function sweep() {
  try {
    await expireRefunds();
    const live = await query("SELECT * FROM listings WHERE status='live' AND type IN ('auction','wheel')");
    for (const l of live) {
      if (l.ends_at && new Date(l.ends_at) <= new Date()) {
        const top = await queryOne('SELECT * FROM bids WHERE listing_id=$1 ORDER BY amount DESC LIMIT 1', [l.id]);
        if (top) await query("UPDATE listings SET status='ended', winner=$1, payment_status='awaiting_payment', escrow_status='not_started', escrow_amount=0 WHERE id=$2", [top.bidder, l.id]);
        else await query("UPDATE listings SET status='ended' WHERE id=$1", [l.id]);
      }
    }
    const drops = await query("SELECT * FROM drops WHERE status='open' AND ends_at <= $1", [nowISO()]);
    for (const d of drops) {
      const entries = await query('SELECT * FROM drop_entries WHERE drop_id=$1', [d.id]);
      const winner = entries.length ? entries[Math.floor(Math.random() * entries.length)].name : null;
      await query('UPDATE drops SET status=$1, winner=$2 WHERE id=$3', [winner ? 'drawn' : 'closed', winner, d.id]);
    }
  } catch (e) { console.error('sweep', e.message); }
}
setInterval(sweep, 1000);

// ---------- Overview / listings ----------
// While a seller's selling privileges are suspended (or removed), their
// LIVE listings are hidden / paused: they do not show in browse or Live Now.
// Sold / ended listings are not hidden - receipts, refunds and disputes
// still need to be visible.
async function hideSuspended(rows) {
  const cache = {};
  const out = [];
  for (const l of rows) {
    if (l.status !== 'live') { out.push(l); continue; }
    if (!(l.seller in cache)) cache[l.seller] = await sellerStatus(l.seller);
    if (cache[l.seller].canSell) out.push(l);
  }
  return out;
}
async function attachWheelCounts(rows) {
  if (!rows.length) return rows;
  const counts = await query('SELECT listing_id, COUNT(*) AS n FROM wheel_items GROUP BY listing_id');
  const map = {};
  for (const c of counts) map[c.listing_id] = Number(c.n);
  return rows.map(l => ({ ...l, wheel_count: map[l.id] || 0 }));
}
app.get('/api/overview', async (req, res) => {
  const settings = await getSettings();
  const listings = await attachWheelCounts(await hideSuspended(await query('SELECT * FROM listings ORDER BY created_at DESC')));
  const founding = await foundingStatus();
  const liveNow = listings.filter(l => l.seller_live && l.status === 'live');
  res.json({ name: 'Bring Time Back and More', prelaunch: !!settings.prelaunch, founding, taxPercent: settings.tax_percent, liveNowCount: liveNow.length, listings, categories: CATEGORIES });
});
app.get('/api/listings', async (req, res) => {
  let rows = await query('SELECT * FROM listings ORDER BY created_at DESC');
  if (req.query.type) rows = rows.filter(l => l.type === req.query.type);
  if (req.query.category && req.query.category !== 'All') rows = rows.filter(l => l.category === req.query.category);
  if (req.query.status) rows = rows.filter(l => l.status === req.query.status);
  rows = await hideSuspended(rows);
  res.json(await attachWheelCounts(rows));
});
app.get('/api/listings/:id', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.status(404).json({ ok: false, error: 'not found' });
  const bids = await query('SELECT * FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const reviews = await query('SELECT * FROM reviews WHERE listing_id=$1 ORDER BY created_at DESC', [l.id]);
  const receipt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  const qr = await qrForListing(l);
  const wheelItems = l.type === 'wheel' ? await wheelItemsFor(l.id) : [];
  const payout = await payoutFor(l);
  const refundRow = await queryOne('SELECT * FROM refunds WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1', [l.id]);
  const refund = withReturnDates(refundRow);
  res.json({ ...l, refund: refund || null, carrier: l.carrier || carrierFor(l.package_size), bids, chats, reviews, receipt, wheel_items: wheelItems, wheel_count: wheelItems.length, qr_text: qr ? qr.qrText : null, qr_receipt: qr ? qr.receiptNo : null, qr_tracking: qr ? qr.tracking : null, qr_carrier: qr ? qr.carrier : null, package_label: shipLabel(l.package_size), payout });
});
// QR code for one won/sold item (after payment validates). Not a real postage label.
app.get('/api/listings/:id/qr', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const qr = await qrForListing(l);
  if (!qr) return res.json({ ok: false, error: 'no QR code yet — the item has not been won and paid for' });
  res.json({ ok: true, listingId: l.id, title: l.title, seller: l.seller, winner: l.winner, isRandom: !!l.is_random, revealedItem: l.revealed_item || null, itemToShip: l.revealed_item || l.title, packageSize: l.package_size || '', packageLabel: shipLabel(l.package_size), shipping: l.shipping, carrier: qr.carrier, tracking: qr.tracking, receiptNo: qr.receiptNo, qrText: qr.qrText, note: 'Shipment record / scan-to-identify code — not real ' + qr.carrier + ' postage yet. Scan it to open this exact sale, then tap Mark as shipped.' });
});
// ---------- Random Items (numbered, no picture needed) ----------
// A seller who does not want to put a picture up can auction numbered random
// items — Random Item 1, Random Item 2, Random Item 3, up to however many they
// want (1–100). Each is a normal auction with no photo; the seller holds the
// item up live on camera, and what the winner gets is what was shown live.
// The seller then types the actual item ("What they won") on the sold item
// page — that revealed item is saved on the listing and shown on the winner
// receipt, the video receipt record and the ship-QR section.
async function insertListing(b, title, description, type, wheelItems, shipAmt, sizePrice, auth, timer, isRandom) {
  const created = new Date(); const ends = new Date(created.getTime() + timer * 1000);
  const id = uid();
  const img = isRandom ? '' : (typeof b.imageUrl === 'string' ? b.imageUrl.slice(0, 1500000) : '');
  await query(`INSERT INTO listings(id,seller,title,description,category,type,start_price,current_bid,fixed_price,shipping,shipping_insured,carrier,authenticity,timer_seconds,mode,status,created_at,ends_at,image_url,package_size,is_random)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,'live',$15,$16,$17,$18,$19)`,
    [id, b.seller, title, description || '', b.category || 'Other', type, Number(b.startPrice || 0), Number(b.startPrice || 0), b.fixedPrice ? Number(b.fixedPrice) : null, shipAmt, b.shippingInsured ? 1 : 0, carrierFor(sizePrice !== null ? b.packageSize : ''), auth, timer, b.mode || 'Regular', created.toISOString(), type === 'buy_now' ? null : ends.toISOString(), img, sizePrice !== null ? b.packageSize : '', isRandom ? 1 : 0]);
  for (let i = 0; i < wheelItems.length; i++) {
    await query('INSERT INTO wheel_items(id,listing_id,name,photo_url,position,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [uid(), id, wheelItems[i].name, wheelItems[i].photoUrl || '', i, nowISO()]);
  }
  return id;
}
app.post('/api/listings', async (req, res) => {
  const b = req.body || {};
  const isRandom = !!(b.isRandom || b.random || b.randomCount);
  if (!b.seller) return res.json({ ok: false, error: 'seller name is required' });
  // INCORRECT-CLAIM LADDER (Kevin, 2026-11-18): 1st incorrect return claim
  // = selling privileges suspended for 7 days, 2nd = 30 days, 3rd = selling
  // privileges removed for good. While suspended the seller cannot list.
  const st = await sellerStatus(b.seller);
  if (st.banned) return res.json({ ok: false, error: 'this seller cannot sell on the site again — selling privileges were removed after a third incorrect return claim' });
  if (!st.canSell) return res.json({ ok: false, error: 'selling is suspended for this seller until ' + st.suspendedUntil + ' — selling privileges suspended after an incorrect return claim that was not upheld after review' });
  if (!isRandom && !b.title) return res.json({ ok: false, error: 'seller and title are required' });
  if (!b.agreement) return res.json({ ok: false, error: 'Seller Agreement must be accepted' });
  // No advertising another auction site / marketplace in a listing.
  if (adHit((b.title || '') + ' ' + (b.description || '') + ' ' + (b.randomBase || ''))) return res.json({ ok: false, error: AD_ERROR });
  // Shipping is set by package size; a plain $ amount is still accepted for
  // backwards compatibility (older clients / API callers without a size).
  const sizePrice = shipPrice(b.packageSize);
  const shipAmt = sizePrice !== null ? sizePrice : Number(b.shipping);
  if (!shipAmt && shipAmt !== 0) return res.json({ ok: false, error: 'pick a package size — buyers pay shipping by size' });
  if (!b.shippingInsured) return res.json({ ok: false, error: 'insured shipping is required' });
  const auth = b.authenticity || 'Authentic';
  const timer = Math.min(3600, Math.max(5, parseInt(b.timerSeconds || 30, 10) || 30));
  if (isRandom) {
    // One tap creates N separate auctions: "Random Item 1", "Random Item 2", …
    // (or "<base> 1", "<base> 2", … if the seller typed a base name, e.g. "Random Watch").
    const count = Math.floor(Number(b.randomCount || b.count || 0));
    if (!count || count < 1 || count > 100) return res.json({ ok: false, error: 'pick how many random items — 1 to 100' });
    const base = String(b.randomBase || b.title || 'Random Item').trim().replace(/\s+\d+$/, '').slice(0, 100) || 'Random Item';
    const badBase = bannedHit(base);
    if (badBase) return res.json({ ok: false, error: 'banned item: ' + badBase });
    const desc = 'Random item — no picture. The seller holds it up live on camera. What you win is what they show live.' + (auth !== 'Authentic' ? ' (' + auth + ')' : '');
    const ids = [], titles = [];
    for (let i = 1; i <= count; i++) {
      const title = base + ' ' + i;
      const id = await insertListing(b, title, desc, 'auction', [], shipAmt, sizePrice, auth, timer, true);
      ids.push(id); titles.push(title);
    }
    return res.json({ ok: true, ids, titles, count, isRandom: true });
  }
  const bad = bannedHit(b.title + ' ' + (b.description || ''));
  if (bad) return res.json({ ok: false, error: 'banned item: ' + bad });
  const text = (b.title + ' ' + (b.description || '')).toLowerCase();
  if (auth === 'Replica' && /100% authentic|genuine real|authentic genuine/.test(text)) return res.json({ ok: false, error: 'a replica cannot be claimed as real/authentic' });
  if (auth === 'Authentic' && /replica|not real|fake/.test(text)) return res.json({ ok: false, error: 'an Authentic listing cannot describe itself as a replica' });
  if ((auth === 'Replica' || auth === 'Unbranded') && !/replica|unbranded|no-name|no name|inspired/.test(text)) return res.json({ ok: false, error: 'replica / unbranded items must say so in the title or description' });
  const type = b.type === 'buy_now' ? 'buy_now' : (b.type === 'wheel' ? 'wheel' : 'auction');
  // A Time Wheel needs the items loaded on it: 1 to 100, each a short name.
  const wheelItems = type === 'wheel' ? parseWheelItems(b) : [];
  if (wheelItems.some(w => adHit(w.name))) return res.json({ ok: false, error: AD_ERROR });
  if (type === 'wheel' && !wheelItems.length) return res.json({ ok: false, error: 'a Time Wheel needs at least 1 item on it (up to 100) — one per line' });
  if (wheelItems.length > 100) return res.json({ ok: false, error: 'a Time Wheel holds at most 100 items' });
  const id = await insertListing(b, b.title, b.description || '', type, wheelItems, shipAmt, sizePrice, auth, timer, false);
  res.json({ ok: true, id, wheelCount: wheelItems.length });
});
// Seller records what the winner actually won on a random item — the item
// they held up live on camera. Seller-only, only after the item is won and
// paid for. Shown on the receipt, the video receipt and the ship-QR section.
app.post('/api/listings/:id/reveal', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!l.is_random) return res.json({ ok: false, error: 'this is not a Random Item' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can say what the winner won' });
  if (l.status !== 'sold' || l.payment_status !== 'validated') return res.json({ ok: false, error: 'the winner has to win and pay first — then say what they won' });
  const revealed = String(req.body.revealedItem || req.body.revealed || '').trim().slice(0, 120);
  if (!revealed) return res.json({ ok: false, error: 'type what they won — e.g. Invicta Lupah watch' });
  if (adHit(revealed)) return res.json({ ok: false, error: AD_ERROR });
  await query('UPDATE listings SET revealed_item=$1, revealed_at=$2 WHERE id=$3', [revealed, nowISO(), l.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `🎲 Revealed live on camera: ${revealed} — that is what ${l.winner} won.`, nowISO()]);
  res.json({ ok: true, revealedItem: revealed });
});
// ---------- Bidding ----------
app.post('/api/listings/:id/bid', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (l.type !== 'auction' && l.type !== 'wheel') return res.json({ ok: false, error: 'this is a Store listing — Buy Now only, no bidding' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'auction is not live' });
  if (l.ends_at && new Date(l.ends_at) <= new Date()) { await sweep(); return res.json({ ok: false, error: 'auction has ended' }); }
  const amount = Number(req.body.amount);
  if (!amount || amount <= l.current_bid) return res.json({ ok: false, error: 'bid must beat the current bid of $' + l.current_bid });
  await query('INSERT INTO bids(id,listing_id,bidder,amount,created_at) VALUES($1,$2,$3,$4,$5)', [uid(), l.id, req.body.bidder || 'Buyer', amount, nowISO()]);
  let endsAt = l.ends_at;
  if (l.mode === 'Regular' && endsAt) endsAt = new Date(new Date(endsAt).getTime() + 10000).toISOString();
  // Sudden Death: endsAt unchanged.
  await query('UPDATE listings SET current_bid=$1, ends_at=$2 WHERE id=$3', [amount, endsAt, l.id]);
  // My Top Limit: auto-bid the smallest step (2%, min $1) up to a rival's max, never past it.
  let addedSeconds = l.mode === 'Regular' ? 10 : 0;
  for (let i = 0; i < 20; i++) {
    const cur = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
    const limits = await query('SELECT * FROM top_limits WHERE listing_id=$1 AND max_amount > $2', [l.id, cur.current_bid]);
    const topBidder = await queryOne('SELECT bidder FROM bids WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1', [l.id]);
    const other = limits.find(x => x.buyer !== (topBidder && topBidder.bidder));
    if (!other) break;
    const step = Math.max(1, Math.round(cur.current_bid * 0.02 * 100) / 100);
    const next = Math.min(other.max_amount, Math.round((cur.current_bid + step) * 100) / 100);
    if (next <= cur.current_bid) break;
    await query('INSERT INTO bids(id,listing_id,bidder,amount,created_at) VALUES($1,$2,$3,$4,$5)', [uid(), l.id, other.buyer, next, nowISO()]);
    await query('UPDATE listings SET current_bid=$1 WHERE id=$2', [next, l.id]);
  }
  const updated = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
  res.json({ ok: true, currentBid: updated.current_bid, endsAt: updated.ends_at, addedSeconds, total: updated.current_bid + updated.shipping });
});
// ---------- Store Buy Now / winner payment (SIMULATED test check) ----------
async function completeSale(l, buyer, method, detail) {
  const check = validatePayment(method, detail);
  if (!check.ok) {
    await query("UPDATE listings SET payment_status='declined', payment_reason=$1, escrow_status='not_started', escrow_amount=0 WHERE id=$2", [check.reason, l.id]);
    return { ok: false, error: 'Payment declined — buyer needs to fix payment', reason: check.reason };
  }
  const total = (l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0)) + (l.shipping || 0);
  const receiptNo = 'BTB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
  // Every paid sale gets a tracking code right away, so its QR code (and Label Pass)
  // identify that exact sale — the seller scans the QR to find this order, not another.
  // Carrier is automatic from package size: USPS, except Big box over 5 lb = UPS.
  const carrier = carrierFor(l.package_size);
  const tracking = l.tracking || makeTracking(carrier);
  await query("UPDATE listings SET status='sold', winner=$1, payment_status='validated', payment_method=$2, payment_last4=$3, payment_reason='', escrow_status='held_waiting_shipment', escrow_amount=$4, tracking=$5, carrier=$6 WHERE id=$7",
    [buyer, method, String(detail || '').replace(/\D/g, '').slice(-4) || '', total, tracking, carrier, l.id]);
  const exLabel = await queryOne('SELECT * FROM labels WHERE listing_id=$1', [l.id]);
  if (!exLabel) await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, carrier, tracking, 'LBL-' + uid().slice(0, 8).toUpperCase(), nowISO()]);
  await query('INSERT INTO receipts(id,listing_id,receipt_no,amount,shipping,total,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, receiptNo, l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0), l.shipping || 0, total, nowISO()]);
  // Time Wheel: payment validated → the wheel spins now and lands on ONE item.
  // That landed item is what the winner gets — no extra prize, no extra charge.
  let landed = null;
  if (l.type === 'wheel') landed = await spinWheelFor({ ...l, winner: buyer });
  return { ok: true, total, receiptNo, landedItem: landed ? landed.landedItem : null };
}
// Spin the Time Wheel (fallback if payment validated but the wheel has not
// spun yet — completeSale spins it automatically). Only the seller or the
// winner can spin it, and it can only land once: a second spin returns the
// item it already landed on.
app.post('/api/listings/:id/spin', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (l.type !== 'wheel') return res.json({ ok: false, error: 'this is not a Time Wheel listing' });
  if (l.status !== 'sold' || l.payment_status !== 'validated') return res.json({ ok: false, error: 'the wheel spins only after the winner pays' });
  if (l.wheel_spun && l.wheel_landed_item) return res.json({ ok: true, alreadySpun: true, landedItem: l.wheel_landed_item, landedAt: l.wheel_landed_at });
  const who = req.body && req.body.name;
  if (who && who !== l.seller && who !== l.winner) return res.json({ ok: false, error: 'only the seller or the winner can spin the Time Wheel' });
  const landed = await spinWheelFor(l);
  if (!landed) return res.json({ ok: false, error: 'no items on the wheel' });
  res.json({ ok: true, ...landed });
});
app.post('/api/listings/:id/buy-now', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.type !== 'buy_now') return res.json({ ok: false, error: 'not a Store listing' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'already sold' });
  const r = await completeSale(l, req.body.buyer || 'Buyer', req.body.method, req.body.detail);
  res.json(r);
});
app.post('/api/listings/:id/pay', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.status !== 'ended') return res.json({ ok: false, error: 'auction has not ended / no winner to pay' });
  const r = await completeSale(l, l.winner, req.body.method, req.body.detail);
  res.json(r);
});
app.post('/api/listings/:id/notify-fix', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `Payment fix needed: $${(l.current_bid || 0) + (l.shipping || 0)} is owed for "${l.title}". Please fix your payment and try again.`, nowISO()]);
  res.json({ ok: true });
});
app.post('/api/listings/:id/rerun', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (req.body.seller && req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can rerun this auction' });
  if (l.payment_status === 'validated') return res.json({ ok: false, error: 'payment went through — cannot rerun' });
  if (l.type !== 'auction' && l.type !== 'wheel') return res.json({ ok: false, error: 'Store items cannot be rerun' });
  if (l.status === 'live') return res.json({ ok: false, error: 'auction is already live' });
  const created = new Date(); const ends = new Date(created.getTime() + (l.timer_seconds || 30) * 1000);
  await query('DELETE FROM bids WHERE listing_id=$1', [l.id]);
  await query(`UPDATE listings SET status='live', winner=NULL, payment_status='none', payment_reason='', escrow_status='not_started', escrow_amount=0,
    current_bid=start_price, created_at=$1, ends_at=$2, delivered=0, delivered_at=NULL, tracking=NULL, shipped_at=NULL, wheel_landed_item='', wheel_landed_at=NULL, wheel_spun=0, revealed_item='', revealed_at=NULL WHERE id=$3`, [created.toISOString(), ends.toISOString(), l.id]);
  res.json({ ok: true, endsAt: ends.toISOString() });
});
// ---------- Shipping / escrow release ----------
// Mark as shipped: the seller scans the sale's QR code, lands on this exact
// sold item, and taps this — no more boxing up the wrong order. Only the seller,
// only after payment validated. Keeps the sale's tracking code if one is already set.
app.post('/api/listings/:id/mark-shipped', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can mark this shipped' });
  if (l.status !== 'sold' || l.payment_status !== 'validated') return res.json({ ok: false, error: 'cannot ship until the item is sold and payment validates' });
  if (l.shipped_at) return res.json({ ok: false, error: 'already marked as shipped' });
  const carrier = l.carrier || carrierFor(l.package_size);
  const tracking = l.tracking || makeTracking(carrier);
  await query('UPDATE listings SET tracking=$1, carrier=$2, shipped_at=$3, escrow_status=$4 WHERE id=$5', [tracking, carrier, nowISO(), 'held_waiting_delivery', l.id]);
  res.json({ ok: true, tracking, carrier, shippedAt: nowISO() });
});
app.post('/api/listings/:id/ship', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.payment_status !== 'validated') return res.json({ ok: false, error: 'cannot ship until payment validates' });
  await query('UPDATE listings SET tracking=$1, escrow_status=$2 WHERE id=$3', [req.body.tracking || l.tracking || '', 'held_waiting_delivery', l.id]);
  res.json({ ok: true });
});
// ---------- Tiered seller payout timing (Kevin, 2026-11-18) ----------
// A seller's tier is earned by CLEAN completed sales: a sale that completed,
// was paid, delivered and had its escrow released, with no pending or approved
// refund and no dispute flag on it. The refund window for buyers runs
// until the seller's payout date for that sale (Kevin, 2026-11-18: the SAME
// rule as the old 12-hour rule, applied to the longer hold) — a payout must
// never release before that window closes, and is blocked while a refund is
// pending. After the payout date, no refund.
//   New seller:    0-2 clean sales.
//   Trusted seller: 3-9 clean sales.
//   Top seller:    10+ clean sales AND a good score (Seller Scorecard average
//                  4.0 or more, if they have any scores at all; with no scores
//                  yet, clean sales alone count).
// Payout time after delivery confirmation:
//   New:     under $100 = 3 days; $100 and up = 7 days.
//   Trusted: under $100 = 12 hours; $100-$500 = 3 days; over $500 = 7 days.
//   Top:     everything = 12 hours.
// TEST MODE ONLY: these are tracked payout dates, not real bank transfers —
// no real payment processor is connected yet.
function saleAmount(l) { return l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0); }
async function cleanSalesCount(seller) {
  const rows = await query("SELECT * FROM listings WHERE seller=$1 AND status='sold' AND escrow_status='released'", [seller]);
  let n = 0;
  for (const r of rows) {
    const bad = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','approved')", [r.id]);
    // A sale with an incorrect return claim that was not upheld after review
    // never counts as a clean sale, even if it was otherwise released.
    const badClaim = await queryOne("SELECT * FROM incorrect_claims WHERE listing_id=$1", [r.id]);
    if (!bad && !badClaim) n++;
  }
  return n;
}
async function incorrectClaimsCount(seller) {
  const rows = await query('SELECT * FROM incorrect_claims WHERE seller=$1', [seller]);
  return rows.length;
}
// Incorrect return claim ladder (Kevin, 2026-11-18): 1st incorrect claim
// (a wrong-item claim not upheld after review) = selling privileges
// suspended for 7 days, 2nd = 30 days, 3rd = selling privileges removed for
// good. While suspended the seller's live listings are hidden and they
// cannot list new items. Strikes are counted in total, not per period.
async function sellerStatus(seller) {
  const rows = await query('SELECT * FROM incorrect_claims WHERE seller=$1 ORDER BY created_at ASC', [seller]);
  const strikes = rows.length;
  if (strikes >= 3) return { strikes, banned: true, suspendedUntil: null, suspensionDays: 0, canSell: false };
  if (strikes >= 1) {
    const days = strikes === 1 ? 7 : 30;
    const latest = rows[rows.length - 1].created_at;
    const suspendedUntil = new Date(new Date(latest).getTime() + days * 24 * 3600 * 1000).toISOString();
    return { strikes, banned: false, suspendedUntil, suspensionDays: days, canSell: new Date() >= new Date(suspendedUntil) };
  }
  return { strikes: 0, banned: false, suspendedUntil: null, suspensionDays: 0, canSell: true };
}
async function sellerTier(seller) {
  const clean = await cleanSalesCount(seller);
  const sc = await queryOne('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE seller=$1', [seller]);
  const score = sc && sc.avg !== null && sc.avg !== undefined ? Number(sc.avg) : null;
  const scoreCount = sc ? Number(sc.n || 0) : 0;
  let tier = 'New';
  if (clean >= 10 && (score === null || score >= 4.0)) tier = 'Top';
  else if (clean >= 3) tier = 'Trusted';
  // INCORRECT-CLAIM PENALTY: a seller with an incorrect return claim that
  // was not upheld after review drops a tier (Top becomes Trusted, Trusted
  // becomes New). Recorded in incorrect_claims and on their Seller
  // Scorecard (a 1-star owner review). The suspension ladder is separate
  // (see sellerStatus): 7 days, 30 days, then selling privileges removed.
  const incorrectClaims = await incorrectClaimsCount(seller);
  if (incorrectClaims >= 1) tier = tier === 'Top' ? 'Trusted' : 'New';
  const nextTier = tier === 'New' ? 'Trusted' : tier === 'Trusted' ? 'Top' : null;
  const salesToNext = tier === 'New' ? Math.max(0, 3 - clean) : tier === 'Trusted' ? Math.max(0, 10 - clean) : 0;
  const status = await sellerStatus(seller);
  return { tier, cleanSales: clean, score: score === null ? null : Math.round(score * 10) / 10, scoreCount, nextTier, salesToNext, incorrectClaims, strikes: status.strikes, suspendedUntil: status.suspendedUntil, suspensionDays: status.suspensionDays, banned: status.banned, canSell: status.canSell };
}
function payoutHoursFor(tier, amount) {
  if (tier === 'Top') return 12;
  if (tier === 'Trusted') return amount < 100 ? 12 : amount <= 500 ? 72 : 168;
  return amount < 100 ? 72 : 168; // New
}
function payoutLabelFor(hours) { return hours === 12 ? '12 hours' : hours === 72 ? '3 days' : '7 days'; }
async function payoutFor(l) {
  const t = await sellerTier(l.seller);
  const amount = saleAmount(l);
  const hours = payoutHoursFor(t.tier, amount);
  const payoutAt = l.delivered_at ? new Date(new Date(l.delivered_at).getTime() + hours * 3600 * 1000).toISOString() : null;
  // Refund window closes at the payout date: same rule as the old 12-hour
  // rule (legit reason + photo + video), applied to the longer hold.
  return { ...t, amount, payoutHours: hours, payoutLabel: payoutLabelFor(hours), payoutAt, refundDeadline: payoutAt, refundLabel: payoutLabelFor(hours), incorrectClaims: t.incorrectClaims, strikes: t.strikes, suspendedUntil: t.suspendedUntil, suspensionDays: t.suspensionDays, banned: t.banned, canSell: t.canSell };
}
app.post('/api/listings/:id/deliver', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || !l.tracking) return res.json({ ok: false, error: 'tracking must be on file first' });
  await query('UPDATE listings SET delivered=1, delivered_at=$1, escrow_status=$2 WHERE id=$3', [nowISO(), 'held_refund_window', l.id]);
  const updated = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
  const payout = await payoutFor(updated);
  res.json({ ok: true, releaseAt: payout.payoutAt, payout });
});
app.post('/api/listings/:id/release-escrow', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!l.delivered_at) return res.json({ ok: false, error: 'not delivered yet' });
  if (l.escrow_status === 'refunded') return res.json({ ok: false, error: 'a refund was already given on this sale' });
  const payout = await payoutFor(l);
  await autoReleaseReturns();
  const openRefund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [l.id]);
  if (openRefund) await expireRefundIfPast(l, openRefund);
  if (new Date() < new Date(payout.payoutAt)) return res.json({ ok: false, error: 'refund window is still open — refunds close on the payout date (' + payout.payoutLabel + ' after delivery). Payout date: ' + payout.payoutAt, payout });
  const refund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [l.id]);
  if (refund) return res.json({ ok: false, error: 'a refund request is pending', payout });
  await query("UPDATE listings SET escrow_status='released' WHERE id=$1", [l.id]);
  res.json({ ok: true });
});

// ---------- Chat / live ----------
app.get('/api/listings/:id/chat', async (req, res) => res.json(await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [req.params.id])));
app.post('/api/listings/:id/chat', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (adHit(req.body.message || '')) return res.json({ ok: false, error: AD_ERROR });
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, req.body.name || 'Buyer', req.body.message || '', req.body.name === l.seller ? 1 : 0, nowISO()]);
  res.json({ ok: true });
});
app.post('/api/listings/:id/go-live', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can go live' });
  await query('UPDATE listings SET seller_live=1, seller_live_at=$1 WHERE id=$2', [nowISO(), l.id]);
  res.json({ ok: true });
});
app.post('/api/listings/:id/end-live', async (req, res) => {
  await query('UPDATE listings SET seller_live=0 WHERE id=$1', [req.params.id]); res.json({ ok: true });
});
// ---------- Live video signalling (WebRTC, peer-to-peer, no paid service) ----------
// Signals carry SDP offers/answers and ICE candidates between the seller and each
// viewer in one auction room. Payloads are opaque JSON strings; nothing is recorded.
app.post('/api/listings/:id/signal', async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  if (!['join', 'offer', 'answer', 'ice', 'leave'].includes(kind)) return res.json({ ok: false, error: 'bad signal kind' });
  if (!b.sender) return res.json({ ok: false, error: 'sender is required' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  await query('INSERT INTO live_signals(id,listing_id,sender,recipient,kind,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, String(b.sender).slice(0, 100), String(b.recipient || '').slice(0, 100), kind, String(b.payload || '').slice(0, 20000), nowISO()]);
  res.json({ ok: true });
});
app.get('/api/listings/:id/signal', async (req, res) => {
  const since = req.query.since ? String(req.query.since) : '1970-01-01T00:00:00.000Z';
  const rows = await query('SELECT * FROM live_signals WHERE listing_id=$1 AND created_at > $2 ORDER BY created_at ASC', [req.params.id, since]);
  res.json(rows);
});
app.post('/api/listings/:id/buy-now-offer', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || (l.type !== 'auction' && l.type !== 'wheel')) return res.json({ ok: false, error: 'offers in chat are for auctions only' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can post a Buy It Now offer' });
  await query('UPDATE listings SET buy_now_offer=$1, buy_now_offer_by=$2 WHERE id=$3', [Number(req.body.amount), l.seller, l.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `Buy It Now offer: $${req.body.amount} — accept it in chat and the auction ends at that price.`, nowISO()]);
  res.json({ ok: true });
});
app.post('/api/listings/:id/accept-offer', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || !l.buy_now_offer) return res.json({ ok: false, error: 'no Buy It Now offer in chat' });
  await query("UPDATE listings SET status='ended', winner=$1, current_bid=$2, payment_status='awaiting_payment', escrow_status='not_started', escrow_amount=0 WHERE id=$3",
    [req.body.buyer || 'Buyer', l.buy_now_offer, l.id]);
  res.json({ ok: true, amount: l.buy_now_offer });
});
// ---------- Keep Track / Free Drops / Top Limit / Scorecard / Coming Up ----------
app.post('/api/follow', async (req, res) => {
  await query('INSERT INTO follows(id,buyer,seller,created_at) VALUES($1,$2,$3,$4)', [uid(), req.body.buyer, req.body.seller, nowISO()]);
  res.json({ ok: true, message: 'Now keeping track of ' + req.body.seller });
});
app.get('/api/following/:buyer', async (req, res) => {
  const rows = await query('SELECT * FROM follows WHERE buyer=$1', [req.params.buyer]);
  const out = [];
  for (const f of rows) {
    const live = await queryOne("SELECT * FROM listings WHERE seller=$1 AND status='live' LIMIT 1", [f.seller]);
    const score = await queryOne('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE seller=$1', [f.seller]);
    const show = await queryOne('SELECT * FROM shows WHERE seller=$1 AND starts_at > $2 ORDER BY starts_at ASC LIMIT 1', [f.seller, nowISO()]);
    out.push({ seller: f.seller, liveNow: !!live, liveItem: live ? live.title : null, score: score && score.avg ? Number(score.avg).toFixed(1) : null, nextShow: show ? show.starts_at : null });
  }
  res.json(out);
});
app.post('/api/drops', async (req, res) => {
  if (adHit(req.body.title || '')) return res.json({ ok: false, error: AD_ERROR });
  const id = uid();
  await query('INSERT INTO drops(id,seller,title,ends_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id, req.body.seller, req.body.title, req.body.endsAt || new Date(Date.now() + 60000).toISOString(), 'open', nowISO()]);
  res.json({ ok: true, id });
});
app.get('/api/drops', async (req, res) => res.json(await query('SELECT * FROM drops ORDER BY created_at DESC')));
app.post('/api/drops/:id/enter', async (req, res) => {
  const d = await queryOne('SELECT * FROM drops WHERE id=$1', [req.params.id]);
  if (!d || d.status !== 'open') return res.json({ ok: false, error: 'drop is closed' });
  const ex = await queryOne('SELECT * FROM drop_entries WHERE drop_id=$1 AND name=$2', [d.id, req.body.name]);
  if (ex) return res.json({ ok: false, error: 'one entry per person' });
  await query('INSERT INTO drop_entries(id,drop_id,name,created_at) VALUES($1,$2,$3,$4)', [uid(), d.id, req.body.name, nowISO()]);
  res.json({ ok: true });
});
app.post('/api/top-limit', async (req, res) => {
  await query('INSERT INTO top_limits(id,listing_id,buyer,max_amount,created_at) VALUES($1,$2,$3,$4,$5)', [uid(), req.body.listingId, req.body.buyer, Number(req.body.maxAmount), nowISO()]);
  res.json({ ok: true });
});
app.post('/api/reviews', async (req, res) => {
  // listingId comes in the body (the route has no :listingId param) — the old
  // code read req.params.listingId, which is undefined and crashed the server.
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]);
  if (!l || l.winner !== req.body.reviewer) return res.json({ ok: false, error: 'only the winner can leave a score' });
  if (adHit(req.body.comment || '')) return res.json({ ok: false, error: AD_ERROR });
  await query('INSERT INTO reviews(id,listing_id,seller,reviewer,stars,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, l.seller, req.body.reviewer, Number(req.body.stars), req.body.comment || '', nowISO()]);
  res.json({ ok: true });
});
app.get('/api/scorecard/:seller', async (req, res) => {
  const r = await queryOne('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE seller=$1', [req.params.seller]);
  const rows = await query('SELECT * FROM reviews WHERE seller=$1 ORDER BY created_at DESC', [req.params.seller]);
  res.json({ seller: req.params.seller, average: r && r.avg ? Number(r.avg).toFixed(1) : null, count: Number((r && r.n) || 0), reviews: rows });
});
app.post('/api/shows', async (req, res) => {
  if (adHit(req.body.title || '')) return res.json({ ok: false, error: AD_ERROR });
  const id = uid();
  await query('INSERT INTO shows(id,seller,title,starts_at,created_at) VALUES($1,$2,$3,$4,$5)', [id, req.body.seller, req.body.title, req.body.startsAt, nowISO()]);
  res.json({ ok: true, id });
});
app.get('/api/coming-up', async (req, res) => res.json(await query('SELECT * FROM shows WHERE starts_at > $1 ORDER BY starts_at ASC', [nowISO()])));
// One Box Deal: biggest shipping once + $2 per extra item, paid once into escrow.
app.post('/api/one-box', async (req, res) => {
  const ids = req.body.listingIds || [];
  const items = [];
  for (const id of ids) { const l = await queryOne('SELECT * FROM listings WHERE id=$1', [id]); if (l) items.push(l); }
  if (!items.length) return res.json({ ok: false, error: 'no items' });
  const seller = items[0].seller;
  if (!items.every(l => l.seller === seller)) return res.json({ ok: false, error: 'One Box is for wins from one seller only' });
  const itemTotal = items.reduce((s, l) => s + (l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0)), 0);
  const combinedShipping = Math.max(...items.map(l => l.shipping || 0)) + 2 * (items.length - 1);
  res.json({ ok: true, seller, items: items.length, itemTotal, combinedShipping, total: itemTotal + combinedShipping, saved: items.reduce((s, l) => s + (l.shipping || 0), 0) - combinedShipping });
});
// Label Pass: test-only label record, no real carrier connected.
// Carrier is automatic from the listing's package size: USPS, except Big box
// over 5 lb = UPS. A carrier sent in the request is ignored.
app.post('/api/labels', async (req, res) => {
  const l = req.body.listingId ? await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]) : null;
  const carrier = l ? carrierFor(l.package_size) : 'USPS';
  const tracking = makeTracking(carrier);
  const code = 'LBL-' + uid().slice(0, 8).toUpperCase();
  await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), req.body.listingId, carrier, tracking, code, nowISO()]);
  res.json({ ok: true, carrier, tracking, code, note: 'Test version only — no real carrier connected yet.' });
});
// ---------- Receipts / refunds (photo + video required) ----------
// Receipt + video receipt for one listing, for comparing against a dispute:
// item as listed, what was won, full bid history, whether the seller was
// live, and the room chat. Returns null when there is no receipt yet.
async function receiptFor(l) {
  const r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  if (!r) return null;
  const landed = l.type === 'wheel' && l.wheel_landed_item ? l.wheel_landed_item : null;
  const revealed = l.is_random && l.revealed_item ? l.revealed_item : null;
  const item = revealed ? revealed + ' (Random Item: ' + l.title + ')' : landed ? landed + ' (from Time Wheel: ' + l.title + ')' : l.title;
  const bids = await query('SELECT bidder, amount, created_at FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT name, message, is_seller, created_at FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  return { receiptNo: r.receipt_no, item, landedItem: landed, isRandom: !!l.is_random, revealedItem: revealed, revealedAt: l.revealed_at || null, winningBid: r.amount, shipping: r.shipping, total: r.total, seller: l.seller, winner: l.winner, dateWon: r.created_at, paymentStatus: l.payment_status, escrowStatus: l.escrow_status, sellerLive: !!l.seller_live, bidCount: bids.length,
    videoReceipt: { listedTitle: l.title, isRandom: !!l.is_random, revealedItem: revealed, revealedNote: revealed ? 'Revealed live: ' + revealed : 'Random Item — revealed live on camera, seller to confirm what it was', sellerWasLive: !!l.seller_live, bids, chats } };
}
app.get('/api/receipt/:listingId', async (req, res) => {
  const r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [req.params.listingId]);
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!r || !l) return res.json({ ok: false, error: 'no receipt yet — sale has not completed' });
  // A Time Wheel receipt names the item the wheel landed on — that is what
  // the winner gets — not just the wheel's title.
  const landed = l.type === 'wheel' && l.wheel_landed_item ? l.wheel_landed_item : null;
  // A Random Item receipt names what the seller revealed live on camera —
  // that is what the winner actually won. Until the seller types it in, the
  // receipt says so plainly instead of guessing.
  const revealed = l.is_random && l.revealed_item ? l.revealed_item : null;
  const item = revealed ? revealed + ' (Random Item: ' + l.title + ')' : landed ? landed + ' (from Time Wheel: ' + l.title + ')' : l.title;
  const bids = await query('SELECT bidder, amount, created_at FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT name, message, is_seller, created_at FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  res.json({ ok: true, receiptNo: r.receipt_no, item, landedItem: landed, isRandom: !!l.is_random, revealedItem: revealed, revealedAt: l.revealed_at || null, winningBid: r.amount, shipping: r.shipping, total: r.total, seller: l.seller, winner: l.winner, dateWon: r.created_at, paymentStatus: l.payment_status, escrowStatus: l.escrow_status, sellerLive: !!l.seller_live, bidCount: bids.length,
    // Video receipt: the live-room record of what was won — item as listed,
    // what was revealed live, full bid history, whether the seller was live,
    // and the room chat.
    videoReceipt: { listedTitle: l.title, isRandom: !!l.is_random, revealedItem: revealed, revealedNote: revealed ? 'Revealed live: ' + revealed : 'Random Item — revealed live on camera, seller to confirm what it was', sellerWasLive: !!l.seller_live, bids, chats } });
});
app.post('/api/refunds', async (req, res) => {
  const b = req.body || {};
  if (!b.photoName) return res.json({ ok: false, error: 'a photo of the item is required' });
  if (!b.videoName) return res.json({ ok: false, error: 'a video of the item is required' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [b.listingId]);
  if (!l || !l.delivered_at) return res.json({ ok: false, error: 'refunds open only after delivery' });
  // Refund window runs until the seller's payout date for this sale — the
  // same rule as the old 12-hour rule, applied to the longer hold. After the
  // payout date (money released to the seller) there is no refund.
  const payout = await payoutFor(l);
  if (l.escrow_status === 'released' || (payout.payoutAt && new Date() >= new Date(payout.payoutAt))) return res.json({ ok: false, error: 'the refund window has closed — refunds close on the payout date (' + payout.payoutLabel + ' after delivery, ' + (payout.payoutAt || 'not set yet') + '), and no refund is possible after the seller is paid out', payout });
  if (!['not as described', 'damaged in transit', 'wrong item', 'defective', 'never arrived'].includes((b.reason || '').toLowerCase())) return res.json({ ok: false, error: 'a legit reason is required — "changed my mind" is not accepted' });
  const open = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [b.listingId]);
  if (open) return res.json({ ok: false, error: 'a refund request is already open for this sale — the seller is deciding' });
  await query('INSERT INTO refunds(id,listing_id,requester,reason,photo_name,video_name,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [uid(), b.listingId, b.requester || 'Buyer', b.reason, b.photoName, b.videoName, 'pending', nowISO()]);
  await query("UPDATE listings SET escrow_status='held_refund_pending' WHERE id=$1", [b.listingId]);
  res.json({ ok: true });
});
app.get('/api/refunds/:id', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  await autoReleaseReturns();
  if (l) await expireRefundIfPast(l, rf);
  const fresh = withReturnDates(await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]));
  // Owner comparison pack: the original receipt + video receipt, so the
  // dispute can be checked against what was actually won and listed.
  res.json({ ...fresh, receipt: l ? await receiptFor(l) : null });
});
// Seller decides what happens with a refund request. Seller-only, only while
// the request is still pending (before the seller has decided).
// choice 'no_return': refund without the item back - released at once from
//   the seller's escrow money. No return label, no return cost.
// choice 'want_back': seller wants the item back - a tracked return label is
//   sent to the buyer and NO refund until the seller receives the item back.
//   The return label cost is the seller's cost (same package size as the
//   sale, same automatic carrier rule), taken from the seller's money - not
//   the buyer's, not the owner's fees.
app.post('/api/refunds/:id/choose', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can decide on this refund' });
  if (rf.status !== 'pending') return res.json({ ok: false, error: 'this refund has already been decided' });
  await expireRefundIfPast(l, rf);
  const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
  if (fresh.status === 'expired') return res.json({ ok: false, error: 'the refund window has closed — this refund request has expired' });
  const choice = String(req.body.choice || '');
  if (choice === 'no_return') {
    await query("UPDATE refunds SET return_choice='no_return', decided_at=$1, status='approved' WHERE id=$2", [nowISO(), rf.id]);
    await query("UPDATE listings SET escrow_status='refunded' WHERE id=$1", [l.id]);
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Seller agreed to the refund without the item back — the refund is released from the seller\'s escrow money. The buyer keeps the item.', nowISO()]);
    return res.json({ ok: true, choice: 'no_return', status: 'approved' });
  }
  if (choice === 'want_back') {
    const carrier = carrierFor(l.package_size);
    const tracking = makeTracking(carrier);
    const code = 'RBL-' + uid().slice(0, 8).toUpperCase();
    const cost = Math.round((shipPrice(l.package_size) !== null ? shipPrice(l.package_size) : (l.shipping || 0)) * 100) / 100;
    const payout = await payoutFor(l);
    await query("UPDATE refunds SET return_choice='want_back', decided_at=$1, status='awaiting_return', return_label_carrier=$2, return_label_tracking=$3, return_label_code=$4, return_cost=$5, return_due_at=$6 WHERE id=$7",
      [nowISO(), carrier, tracking, code, cost, payout.payoutAt || null, rf.id]);
    await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [uid(), l.id, carrier, tracking, code, nowISO()]);
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Seller wants the item back first — a tracked return label (' + carrier + ' ' + tracking + ') was sent to the buyer. No refund until the seller receives the item back. The return label cost ($' + cost.toFixed(2) + ') is the seller\'s cost, not the buyer\'s and not the owner\'s fees. Test label only — no real carrier connected yet.', nowISO()]);
    return res.json({ ok: true, choice: 'want_back', status: 'awaiting_return', carrier, tracking, code, returnCost: cost });
  }
  return res.json({ ok: false, error: 'choice must be no_return or want_back' });
});
// Buyer ships the item back using the return label. Only while the seller is
// waiting for the item back. BUYER RETURN PROOF (Kevin, 2026-11-18): before
// the buyer can mark the return shipped, they must attach a VIDEO of the
// item going into the box AND a PICTURE of the return label on that same box
// when it is sent out. The video proves what went in, the label picture
// proves that same box with that label is the one that was sent. That proof
// is stored on the refund record, so the owner can compare it against what
// the seller says arrived. Both are required — no video or no label picture,
// no shipped mark.
app.post('/api/refunds/:id/return-shipped', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'the seller has not asked for the item back' });
  if (!req.body.videoName) return res.json({ ok: false, error: 'a video of the item going into the box is required before the return can be marked shipped' });
  if (!req.body.photoName) return res.json({ ok: false, error: 'a picture of the return label on the same box, when it is sent out, is required before the return can be marked shipped' });
  await expireRefundIfPast(l, rf);
  const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
  if (fresh.status === 'expired') return res.json({ ok: false, error: 'the refund window has closed — this refund request has expired' });
  const tracking = String(req.body.tracking || rf.return_label_tracking || '').trim().slice(0, 100);
  await query('UPDATE refunds SET return_tracking=$1, return_shipped_at=$2, return_photo_name=$3, return_video_name=$4 WHERE id=$5', [tracking, nowISO(), String(req.body.photoName).slice(0, 200), String(req.body.videoName).slice(0, 200), rf.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,0,$5)',
    [uid(), l.id, rf.requester || 'Buyer', 'Return shipped back — tracking ' + (tracking || 'on the return label') + '. The seller will confirm when they receive it.', nowISO()]);
  res.json({ ok: true, tracking });
});
// Seller confirms they received the returned item back. Seller-only, only
// after the buyer shipped it back. ONLY then is the refund released from the
// seller's escrow money.
app.post('/api/refunds/:id/confirm-receipt', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can confirm they got the item back' });
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the buyer has not shipped the item back yet' });
  await releaseRefund(rf, l, 'seller_confirmed');
  res.json({ ok: true, status: 'approved' });
});
// Return scanned as DELIVERED - the buyer must not lose out if the seller
// never taps "I got it back". The buyer or the owner can record it from the
// return tracking (the carrier scan). It releases the refund at once from
// the seller's escrow money, exactly like a seller confirm - no seller tap
// needed. TEST MODE: no live carrier feed is connected yet, so delivery is
// recorded from this tracking / mark-as-delivered step; at go-live a real
// carrier delivery scan will do this automatically.
app.post('/api/refunds/:id/return-delivered', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the return has not been shipped back yet' });
  const tracking = String(req.body.tracking || rf.return_tracking || rf.return_label_tracking || '').trim().slice(0, 100);
  await query('UPDATE refunds SET return_tracking=$1, return_delivered_at=$2 WHERE id=$3', [tracking, nowISO(), rf.id]);
  const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
  await releaseRefund(fresh, l, 'delivered');
  res.json({ ok: true, status: 'approved', tracking, deliveredAt: fresh.return_delivered_at });
});
// ---------- Wrong-item dispute (Kevin, 2026-11-18) ----------
// When a return is delivered / shipped back, the seller has 48 hours to
// check what arrived. If it is the WRONG item (wrong item, empty box, a
// different item than the receipt and video receipt show), the seller taps
// "Wrong item sent back" and must attach a photo AND a video of what
// actually arrived - same proof rule as refunds. No photo + video, the flag
// is refused. Tapping it PAUSES the refund at once: status becomes
// 'disputed', the 48-hour auto-release stops (it only runs on
// 'awaiting_return'), the money stays in escrow, and no refund goes out
// while the dispute is open. The owner decides in the dashboard, comparing
// three things side by side: the buyer's return proof (a video of the item
// going into the box + a picture of the return label on the same box when it
// was sent out), the seller's arrival photo and video, and the original
// receipt + video receipt.
// INCORRECT-CLAIM LADDER (Kevin, 2026-11-18): if the owner rules "item is
// correct", the claim was not upheld after review. That sale does NOT count
// as a clean sale, the seller drops a tier, and it is recorded against
// their Seller Scorecard. Selling privileges are suspended for 7 days for a
// first incorrect claim, 30 days for a second, and removed for good after a
// third. While suspended the seller's live listings are hidden and they
// cannot list new items.
app.post('/api/refunds/:id/wrong-item', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (req.body.seller !== l.seller) return res.json({ ok: false, error: 'only the seller can flag a wrong item' });
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the buyer has not shipped the item back yet' });
  if (!req.body.photoName) return res.json({ ok: false, error: 'a photo of what actually arrived is required — the flag is refused without both a photo and a video' });
  if (!req.body.videoName) return res.json({ ok: false, error: 'a video of what actually arrived is required — the flag is refused without both a photo and a video' });
  await query("UPDATE refunds SET status='disputed', dispute_photo_name=$1, dispute_video_name=$2, dispute_at=$3 WHERE id=$4",
    [String(req.body.photoName).slice(0, 200), String(req.body.videoName).slice(0, 200), nowISO(), rf.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, 'Seller flagged a wrong item sent back — the refund is PAUSED, the 48-hour auto-release is stopped, and the owner will decide. Seller proof of what arrived: photo ' + String(req.body.photoName).slice(0, 200) + ', video ' + String(req.body.videoName).slice(0, 200) + '.', nowISO()]);
  res.json({ ok: true, status: 'disputed' });
});
// Owner decides a wrong-item dispute. decision 'correct' = the item sent
// back IS the right item, so the claim was not upheld after review: the
// dispute is closed, the refund releases at once, and the incorrect claim
// is recorded (see the ladder above).
// decision 'wrong' = the buyer DID send the wrong item: refund DENIED, the
// buyer must send back the right item on a new tracked return label (seller
// pays only because they asked for the item back - same rule) within 7 days,
// or they get no refund.
app.post('/api/refunds/:id/dispute-decide', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (rf.status !== 'disputed') return res.json({ ok: false, error: 'this refund has no open wrong-item dispute' });
  const decision = String(req.body.decision || '');
  if (decision !== 'correct' && decision !== 'wrong') return res.json({ ok: false, error: 'decision must be correct or wrong' });
  if (decision === 'correct') {
    await query("INSERT INTO incorrect_claims(id,seller,listing_id,refund_id,created_at) VALUES($1,$2,$3,$4,$5)",
      [uid(), l.seller, l.id, rf.id, nowISO()]);
    await query('INSERT INTO reviews(id,listing_id,seller,reviewer,stars,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid(), l.id, l.seller, 'Bring Time Back and More', 1, 'Incorrect return claim — the owner reviewed the proof and the item sent back was the correct item.', nowISO()]);
    await query("UPDATE refunds SET dispute_status='correct', dispute_decided_at=$1 WHERE id=$2", [nowISO(), rf.id]);
    const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
    await releaseRefund(fresh, l, 'dispute_correct');
    const st = await sellerStatus(l.seller);
    const penalty = st.banned
      ? ' This is a third incorrect claim — selling privileges are removed and this seller cannot sell on the site again.'
      : ' This is incorrect claim ' + st.strikes + ' for this seller — selling privileges are suspended for ' + st.suspensionDays + ' days, until ' + st.suspendedUntil + '.';
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Owner reviewed the proof and the item sent back IS the correct item — the claim was not upheld, so the dispute is closed and the refund is released. Incorrect claim recorded against the seller: this sale does not count as a clean sale, the seller drops a tier, and it is recorded on their Seller Scorecard.' + penalty, nowISO()]);
    return res.json({ ok: true, decision: 'correct', status: 'approved', incorrectClaims: st.strikes, strikes: st.strikes, suspendedUntil: st.suspendedUntil, suspensionDays: st.suspensionDays, banned: st.banned });
  }
  // Buyer DID send the wrong item: refund denied, new tracked return label
  // for the RIGHT item, buyer has 7 days to send it back or no refund.
  const carrier = carrierFor(l.package_size);
  const tracking = makeTracking(carrier);
  const code = 'RBL-' + uid().slice(0, 8).toUpperCase();
  const cost = Math.round((shipPrice(l.package_size) !== null ? shipPrice(l.package_size) : (l.shipping || 0)) * 100) / 100;
  const dueAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  await query("UPDATE refunds SET dispute_status='wrong', dispute_decided_at=$1, status='awaiting_return', return_choice='want_back', return_label_carrier=$2, return_label_tracking=$3, return_label_code=$4, return_cost=$5, return_shipped_at=NULL, return_tracking='', return_received_at=NULL, return_delivered_at=NULL, return_photo_name='', return_video_name='', return_due_at=$6 WHERE id=$7",
    [nowISO(), carrier, tracking, code, cost, dueAt, rf.id]);
  await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, carrier, tracking, code, nowISO()]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, 'Owner ruled the buyer DID send the wrong item — refund DENIED. A new tracked return label (' + carrier + ' ' + tracking + ') was sent so the buyer can send back the RIGHT item. The buyer has 7 days to send it back (by ' + dueAt + '), or no refund. The return label cost ($' + cost.toFixed(2) + ') is the seller\'s cost, only because the seller asked for the item back.', nowISO()]);
  res.json({ ok: true, decision: 'wrong', status: 'awaiting_return', carrier, tracking, code, returnCost: cost, returnDueAt: dueAt });
});
// ---------- Founding / waitlist / dashboard / tax / report ----------
app.post('/api/founding/claim', async (req, res) => {
  const f = await foundingStatus();
  if (f.remaining <= 0) return res.json({ ok: false, error: 'founding spots are closed — 10/10 taken' });
  const ex = await queryOne('SELECT * FROM founding WHERE seller=$1', [req.body.seller]);
  if (ex) return res.json({ ok: false, error: 'already a founding seller' });
  await query('INSERT INTO founding(id,seller,claimed_at) VALUES($1,$2,$3)', [uid(), req.body.seller, nowISO()]);
  res.json({ ok: true, ...(await foundingStatus()) });
});
// ---------- Automatic welcome email when someone joins the waitlist ----------
// Joining the waitlist automatically puts them on the list AND tries to email
// them right away: "you're on the list, we'll email you when it goes live".
// Same Resend pattern as the "we're live" email (no new dependency, plain
// fetch). If no RESEND_API_KEY is set, the signup still succeeds — the joiner
// is stored with welcome_email_status='pending' and the owner dashboard shows
// who still needs a welcome; the launch email still covers them at launch.
// A duplicate email joining twice is not a new join and gets no second welcome.
const WELCOME_SUBJECT = "You're on the list — Bring Time Back and More";
function welcomeEmailBody(name) {
  const first = String(name || '').trim();
  return 'Hi' + (first ? ' ' + first : '') + ',\n\nThanks for joining Bring Time Back and More — you\'re on the waitlist.\n\nWe\'ll email you when the site goes live, so you don\'t miss launch day.\n\nFounding sellers: first 10 get 0% until it goes live, then 5% forever. Everyone else pays 10%.\n\nList in 3 steps, bid in 1 tap: ' + LIVE_SITE + '\n\nSee you there,\nBring Time Back and More';
}
async function sendWelcomeEmail(name, email) {
  // No key: nothing to send through — caller records 'pending', never fails the signup.
  if (!process.env.RESEND_API_KEY) return { sent: false, mode: 'manual', error: 'no Resend key set' };
  try {
    const fromEmail = process.env.FROM_EMAIL || 'Bring Time Back and More <onboarding@resend.dev>';
    // 10s timeout: a slow Resend must never hang the signup — it fails fast
    // and the joiner is recorded 'failed' instead of waiting forever.
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromEmail, to: [email], subject: WELCOME_SUBJECT, text: welcomeEmailBody(name) }), signal: AbortSignal.timeout(10000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, mode: 'resend', error: 'Resend failed (' + r.status + '): ' + (data.message || JSON.stringify(data)) };
    return { sent: true, mode: 'resend', resendId: data.id || null };
  } catch (e) {
    return { sent: false, mode: 'resend', error: 'Resend request failed: ' + e.message };
  }
}
app.post('/api/waitlist', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.json({ ok: false, error: 'a valid email is required to join the waitlist' });
  // Duplicate guard (case-insensitive): already on the list — no second row, no second welcome.
  const existing = await queryOne('SELECT * FROM waitlist WHERE LOWER(email)=$1', [email]);
  if (existing) return res.json({ ok: true, alreadyJoined: true, welcomeEmail: 'already', message: "You're already on the list — we'll email you when it goes live." });
  const id = uid();
  await query('INSERT INTO waitlist(id,name,email,role,founding,created_at,welcome_email_status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, name, email, b.role || 'buyer', b.founding ? 1 : 0, nowISO(), 'pending']);
  const attempt = await sendWelcomeEmail(name, email);
  if (attempt.sent) {
    await query("UPDATE waitlist SET welcome_email_status='sent', welcome_sent_at=$1 WHERE id=$2", [nowISO(), id]);
    return res.json({ ok: true, welcomeEmail: 'sent', resendId: attempt.resendId || null, message: "You're on the list! Check your email for a welcome note — we'll email you when it goes live." });
  }
  if (attempt.mode === 'resend') {
    // Resend was tried and refused it (e.g. bad key) — record 'failed', signup still stands.
    await query("UPDATE waitlist SET welcome_email_status='failed' WHERE id=$1", [id]);
    return res.json({ ok: true, welcomeEmail: 'failed', error: attempt.error, message: "You're on the list — we'll email you when it goes live." });
  }
  // No key: stored as 'pending' — the owner dashboard shows who still needs a welcome.
  return res.json({ ok: true, welcomeEmail: 'manual', message: "You're on the list — we'll email you when it goes live." });
});
// ---------- "We're live" email to the waitlist (owner dashboard only) ----------
// Automatic sending uses Resend (https://api.resend.com/emails) when RESEND_API_KEY
// is set — no new npm dependency, plain fetch. From defaults to Resend's test sender
// unless FROM_EMAIL is set. If no key is set, nothing is sent: the dashboard gets
// the full ready-to-send message, a copyable email list and a BCC mailto link, so
// Kevin can send it from his own email in one tap, then mark it sent.
// A live_notice row (id=1) records a completed send, so the same list is never
// emailed twice by accident — a second send needs an explicit force ("Send again").
const LIVE_SITE = 'https://bringtimebackandmore.com';
const LIVE_SUBJECT = 'Bring Time Back and More is LIVE now';
function liveEmailBody() {
  return 'Hi,\n\nBring Time Back and More is LIVE now at ' + LIVE_SITE + '\n\nWe\'re no longer in test mode — you can list, bid and buy now.\n\nFounding sellers: first 10 get 0% until live, then 5% forever. Everyone else pays 10%.\n\nList in 3 steps, bid in 1 tap.\n\nSee you there,\nBring Time Back and More';
}
function liveMailto(emails) {
  return 'mailto:?bcc=' + encodeURIComponent(emails.join(',')) + '&subject=' + encodeURIComponent(LIVE_SUBJECT) + '&body=' + encodeURIComponent(liveEmailBody());
}
async function getLiveNoticePreview() {
  const rows = await query('SELECT * FROM waitlist WHERE email IS NOT NULL AND email <> \'\' ORDER BY created_at ASC');
  const seen = new Set(); const emails = [];
  for (const r of rows) { const e = String(r.email).trim().toLowerCase(); if (e.includes('@') && !seen.has(e)) { seen.add(e); emails.push(e); } }
  const sent = await queryOne('SELECT * FROM live_notice WHERE id=1');
  // Welcome-email status for the owner dashboard: who got a welcome email
  // when they joined, and who is still waiting (no Resend key / send failed).
  // Rows created before this column existed have a NULL status — count them as pending.
  const welcomeRows = await query('SELECT name, email, welcome_email_status, welcome_sent_at FROM waitlist ORDER BY created_at ASC');
  const welcomeSent = welcomeRows.filter(r => r.welcome_email_status === 'sent');
  const welcomeFailed = welcomeRows.filter(r => r.welcome_email_status === 'failed');
  const welcomePending = welcomeRows.filter(r => !r.welcome_email_status || r.welcome_email_status === 'pending');
  return { count: emails.length, emails, subject: LIVE_SUBJECT, body: liveEmailBody(), mailto: emails.length ? liveMailto(emails) : '', resendConfigured: !!process.env.RESEND_API_KEY, sentAt: sent ? sent.sent_at : null, sentMode: sent ? sent.mode : null, sentCount: sent ? sent.recipient_count : null,
    welcomeSent: welcomeSent.length, welcomePending: welcomePending.length, welcomeFailed: welcomeFailed.length,
    welcomePendingEmails: welcomePending.map(r => ({ name: r.name || '', email: r.email })),
    welcomeFailedEmails: welcomeFailed.map(r => ({ name: r.name || '', email: r.email })) };
}
app.get('/api/waitlist/live-notice', async (req, res) => res.json({ ok: true, ...(await getLiveNoticePreview()) }));
app.post('/api/waitlist/live-notice', async (req, res) => {
  const b = req.body || {};
  const preview = await getLiveNoticePreview();
  const already = !!preview.sentAt;
  // Owner sent it from his own email (copy / mailto mode) — record that, don't re-send.
  if (b.markManualSent) {
    if (already) return res.json({ ok: false, alreadySent: true, error: 'already sent on ' + preview.sentAt + ' (' + preview.sentMode + ') — use "Send again" to email everyone again', ...preview });
    if (!preview.count) return res.json({ ok: false, error: 'no one on the waitlist yet', ...preview });
    await query('INSERT INTO live_notice(id,sent_at,mode,recipient_count,subject) VALUES(1,$1,$2,$3,$4)', [nowISO(), 'manual', preview.count, LIVE_SUBJECT]);
    return res.json({ ...(await getLiveNoticePreview()), ok: true, sent: true, mode: 'manual', sentCount: preview.count });
  }
  if (already && !b.force) return res.json({ ok: false, alreadySent: true, error: 'already sent on ' + preview.sentAt + ' (' + preview.sentMode + ') — use "Send again" to email everyone again', ...preview });
  if (!preview.count) return res.json({ ok: false, error: 'no one on the waitlist yet', ...preview });
  // No email key: do NOT claim anything was sent — return the ready-to-send pack.
  if (!process.env.RESEND_API_KEY) {
    return res.json({ ...preview, ok: true, sent: false, mode: 'manual', message: 'No email key set — nothing was sent. Copy the email list or use the mailto link to send it from your own email, then tap "I sent it from my own email" to mark it sent.' });
  }
  try {
    const fromEmail = process.env.FROM_EMAIL || 'Bring Time Back and More <onboarding@resend.dev>';
    const toAddr = process.env.OWNER_EMAIL || preview.emails[0];
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromEmail, to: [toAddr], bcc: preview.emails.filter(e => e !== toAddr), subject: LIVE_SUBJECT, text: preview.body }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.json({ ...preview, ok: false, sent: false, mode: 'resend', error: 'Resend failed (' + r.status + '): ' + (data.message || JSON.stringify(data)) });
    if (already) await query('UPDATE live_notice SET sent_at=$1, mode=$2, recipient_count=$3, subject=$4 WHERE id=1', [nowISO(), 'resend', preview.count, LIVE_SUBJECT]);
    else await query('INSERT INTO live_notice(id,sent_at,mode,recipient_count,subject) VALUES(1,$1,$2,$3,$4)', [nowISO(), 'resend', preview.count, LIVE_SUBJECT]);
    return res.json({ ...(await getLiveNoticePreview()), ok: true, sent: true, mode: 'resend', sentCount: preview.count, resendId: data.id || null });
  } catch (e) {
    return res.json({ ...preview, ok: false, sent: false, mode: 'resend', error: 'Resend request failed: ' + e.message });
  }
});
app.get('/api/payout-tier/:seller', async (req, res) => {
  const t = await sellerTier(req.params.seller);
  res.json({ seller: req.params.seller, ...t, note: 'Test mode — payout dates are tracked dates, not real bank transfers. No real payment processor is connected yet.' });
});
app.get('/api/dashboard', async (req, res) => {
  const settings = await getSettings();
  const sold = await query("SELECT * FROM listings WHERE status='sold' AND escrow_status='released'");
  let fees = 0;
  // ---------- Safe to take out (owner draw) ----------
  // Only Kevin's FEES ever count here — seller escrow money is never his
  // money and is never counted. A fee is SAFE to draw only when its sale is
  // past delivery + the refund window (which closes at the seller's payout
  // date for that sale), the seller has been paid, there
  // is no refund or dispute on it, AND it is older than 30 days. 30 days is
  // the practical safe point used here — the full bank chargeback window is
  // 60-120 days, so a chargeback can still come in after 30 days, just far
  // less often. Fees from sales in the last 30 days are NOT safe yet, and the
  // date each batch becomes safe is shown. Recommended reserve to leave in the
  // business: 1 to 2 months of fees, or at minimum all not-yet-safe fees,
  // whichever is larger. "Months of fees" here means 2 x the fees from sales
  // delivered in the last 30 days.
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  let safeFees = 0, notSafeFees = 0, last30Fees = 0;
  const notSafe = [];
  for (const l of sold) {
    const pct = (await isFounding(l.seller)) ? 5 : 10;
    const fee = Math.round(saleAmount(l) * pct) / 100;
    fees += fee;
    const delivered = l.delivered_at ? new Date(l.delivered_at).getTime() : null;
    const badRefund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','approved','disputed')", [l.id]);
    if (!delivered || badRefund || now - delivered < 12 * 3600 * 1000) continue;
    const safeDate = new Date(delivered + 30 * DAY).toISOString();
    if (now - delivered < 30 * DAY) last30Fees += fee;
    if (now >= delivered + 30 * DAY) safeFees += fee;
    else { notSafeFees += fee; notSafe.push({ id: l.id, title: l.title, seller: l.seller, fee: Math.round(fee * 100) / 100, safeDate }); }
  }
  const reserve = Math.round(Math.max(notSafeFees, 2 * last30Fees) * 100) / 100;
  const safeAfterTax = Math.round(safeFees * (1 - settings.tax_percent / 100) * 100) / 100;
  const safeDraw = {
    totalFeesEarned: Math.round(fees * 100) / 100,
    safeFees: Math.round(safeFees * 100) / 100,
    safeToDraw: safeAfterTax,
    notSafeFees: Math.round(notSafeFees * 100) / 100,
    notSafe,
    monthlyFees: Math.round(last30Fees * 100) / 100,
    reserve,
    alert: safeAfterTax > 0 ? 'Safe to take out: $' + safeAfterTax.toFixed(2) + ' — leave $' + reserve.toFixed(2) + ' in the business to cover chargebacks.' : null,
    note: 'Safe = fee from a sale delivered over 30 days ago, past the refund window (which closes on the payout date for that sale), seller paid, no refund or dispute. The full bank chargeback window is 60-120 days — 30 days is the practical safe point, not a guarantee. Only your fees count here, never seller escrow money.'
  };
  const tax = fees * (settings.tax_percent / 100);
  const unpaid = await query("SELECT * FROM listings WHERE status='ended' AND payment_status IN ('awaiting_payment','declined')");
  const refunds = await query("SELECT * FROM refunds WHERE status IN ('pending','awaiting_return','disputed')");
  for (const rf of refunds) { const rl = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]); if (rl) { const rp = await payoutFor(rl); rf.refundDeadline = rp.payoutAt; rf.refundLabel = rp.payoutLabel; rf.title = rl.title; rf.seller = rl.seller; rf.returnAutoReleaseAt = returnAutoReleaseAt(rf); rf.receipt = await receiptFor(rl); } }
  const escrowHeld = await query("SELECT * FROM listings WHERE escrow_status LIKE 'held%'");
  const held = [];
  for (const l of escrowHeld) { const payout = await payoutFor(l); held.push({ id: l.id, title: l.title, seller: l.seller, amount: l.escrow_amount, saleAmount: saleAmount(l), payout }); }
  // Incorrect return claims, for the owner dashboard: every seller with a
  // claim not upheld after review, with their strike count and when their
  // selling privileges are suspended until (or removed for good).
  const claimRows = await query('SELECT * FROM incorrect_claims ORDER BY created_at ASC');
  const strikeMap = {};
  for (const c of claimRows) { (strikeMap[c.seller] = strikeMap[c.seller] || []).push(c); }
  const incorrectClaimStrikes = [];
  for (const seller of Object.keys(strikeMap)) {
    const st = await sellerStatus(seller);
    incorrectClaimStrikes.push({ seller, strikes: st.strikes, suspendedUntil: st.suspendedUntil, suspensionDays: st.suspensionDays, banned: st.banned, canSell: st.canSell });
  }
  res.json({ totalFeesEarned: Math.round(fees * 100) / 100, taxPercent: settings.tax_percent, taxSetAside: Math.round(tax * 100) / 100, availableToUse: Math.round((fees - tax) * 100) / 100, unpaidWins: unpaid, refundsPending: refunds, escrowHeld: held, safeDraw, incorrectClaimStrikes });
});
app.post('/api/settings/tax', async (req, res) => {
  const p = Number(req.body.percent);
  if (!p || p < 0 || p > 100) return res.json({ ok: false, error: 'percent must be 0–100' });
  await query('UPDATE settings SET tax_percent=$1 WHERE id=1', [p]);
  res.json({ ok: true, taxPercent: p });
});
app.post('/api/report', async (req, res) => {
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,0,$5)',
    [uid(), req.body.listingId || 'site', req.body.name || 'Buyer', 'REPORT: ' + (req.body.reason || ''), nowISO()]);
  res.json({ ok: true, message: 'report received — the owner will review it' });
});
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Bring Time Back and More', prelaunch: PRELAUNCH, db: isPg ? 'postgres' : 'sqlite-local', time: nowISO() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init().then(() => { app.listen(PORT, () => console.log(`Bring Time Back and More on :${PORT} db=${isPg ? 'postgres' : 'sqlite-local'} prelaunch=${PRELAUNCH}`)); });

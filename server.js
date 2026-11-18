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
const BANNED = ['stolen','counterfeit','fake id','illegal drugs','weapon','firearm','explosives','human trafficking','stolen goods'];
const CATEGORIES = ['Watches','Clothes','Shoes','Electronics','Collectibles','Vehicles','Home','Fashion','Art','Sports','Toys','Other'];
function bannedHit(s) { const t = (s || '').toLowerCase(); return BANNED.find(b => t.includes(b)); }
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
  await getSettings();
}
// Auto-end timers + draw free drops, every second.
async function sweep() {
  try {
    const live = await query("SELECT * FROM listings WHERE status='live' AND type='auction'");
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
app.get('/api/overview', async (req, res) => {
  const settings = await getSettings();
  const listings = await query('SELECT * FROM listings ORDER BY created_at DESC');
  const founding = await foundingStatus();
  const liveNow = listings.filter(l => l.seller_live && l.status === 'live');
  res.json({ name: 'Bring Time Back and More', prelaunch: !!settings.prelaunch, founding, taxPercent: settings.tax_percent, liveNowCount: liveNow.length, listings, categories: CATEGORIES });
});
app.get('/api/listings', async (req, res) => {
  let rows = await query('SELECT * FROM listings ORDER BY created_at DESC');
  if (req.query.type) rows = rows.filter(l => l.type === req.query.type);
  if (req.query.category && req.query.category !== 'All') rows = rows.filter(l => l.category === req.query.category);
  if (req.query.status) rows = rows.filter(l => l.status === req.query.status);
  res.json(rows);
});
app.get('/api/listings/:id', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.status(404).json({ ok: false, error: 'not found' });
  const bids = await query('SELECT * FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const reviews = await query('SELECT * FROM reviews WHERE listing_id=$1 ORDER BY created_at DESC', [l.id]);
  const receipt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  res.json({ ...l, bids, chats, reviews, receipt });
});
app.post('/api/listings', async (req, res) => {
  const b = req.body || {};
  if (!b.seller || !b.title) return res.json({ ok: false, error: 'seller and title are required' });
  if (!b.agreement) return res.json({ ok: false, error: 'Seller Agreement must be accepted' });
  if (b.shipping === undefined || b.shipping === null || b.shipping === '') return res.json({ ok: false, error: 'shipping cost is required — buyers pay shipping' });
  if (!b.shippingInsured) return res.json({ ok: false, error: 'insured shipping is required' });
  const bad = bannedHit(b.title + ' ' + (b.description || ''));
  if (bad) return res.json({ ok: false, error: 'banned item: ' + bad });
  const auth = b.authenticity || 'Authentic';
  const text = (b.title + ' ' + (b.description || '')).toLowerCase();
  if (auth === 'Replica' && /100% authentic|genuine real|authentic genuine/.test(text)) return res.json({ ok: false, error: 'a replica cannot be claimed as real/authentic' });
  if (auth === 'Authentic' && /replica|not real|fake/.test(text)) return res.json({ ok: false, error: 'an Authentic listing cannot describe itself as a replica' });
  if ((auth === 'Replica' || auth === 'Unbranded') && !/replica|unbranded|no-name|no name|inspired/.test(text)) return res.json({ ok: false, error: 'replica / unbranded items must say so in the title or description' });
  const type = b.type === 'buy_now' ? 'buy_now' : 'auction';
  const timer = Math.min(3600, Math.max(5, parseInt(b.timerSeconds || 30, 10) || 30));
  const created = new Date(); const ends = new Date(created.getTime() + timer * 1000);
  const id = uid();
  const img = typeof b.imageUrl === 'string' ? b.imageUrl.slice(0, 1500000) : '';
  await query(`INSERT INTO listings(id,seller,title,description,category,type,start_price,current_bid,fixed_price,shipping,shipping_insured,carrier,authenticity,timer_seconds,mode,status,created_at,ends_at,image_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,'live',$15,$16,$17)`,
    [id, b.seller, b.title, b.description || '', b.category || 'Other', type, Number(b.startPrice || 0), Number(b.startPrice || 0), b.fixedPrice ? Number(b.fixedPrice) : null, Number(b.shipping), b.shippingInsured ? 1 : 0, b.carrier || '', auth, timer, b.mode || 'Regular', created.toISOString(), type === 'auction' ? ends.toISOString() : null, img]);
  res.json({ ok: true, id });
});
// ---------- Bidding ----------
app.post('/api/listings/:id/bid', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (l.type !== 'auction') return res.json({ ok: false, error: 'this is a Store listing — Buy Now only, no bidding' });
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
  await query("UPDATE listings SET status='sold', winner=$1, payment_status='validated', payment_method=$2, payment_last4=$3, payment_reason='', escrow_status='held_waiting_shipment', escrow_amount=$4 WHERE id=$5",
    [buyer, method, String(detail || '').replace(/\D/g, '').slice(-4) || '', total, l.id]);
  await query('INSERT INTO receipts(id,listing_id,receipt_no,amount,shipping,total,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, receiptNo, l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0), l.shipping || 0, total, nowISO()]);
  return { ok: true, total, receiptNo };
}
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
  if (l.type !== 'auction') return res.json({ ok: false, error: 'Store items cannot be rerun' });
  if (l.status === 'live') return res.json({ ok: false, error: 'auction is already live' });
  const created = new Date(); const ends = new Date(created.getTime() + (l.timer_seconds || 30) * 1000);
  await query('DELETE FROM bids WHERE listing_id=$1', [l.id]);
  await query(`UPDATE listings SET status='live', winner=NULL, payment_status='none', payment_reason='', escrow_status='not_started', escrow_amount=0,
    current_bid=start_price, created_at=$1, ends_at=$2, delivered=0, delivered_at=NULL, tracking=NULL WHERE id=$3`, [created.toISOString(), ends.toISOString(), l.id]);
  res.json({ ok: true, endsAt: ends.toISOString() });
});
// ---------- Shipping / escrow release ----------
app.post('/api/listings/:id/ship', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.payment_status !== 'validated') return res.json({ ok: false, error: 'cannot ship until payment validates' });
  await query('UPDATE listings SET tracking=$1, escrow_status=$2 WHERE id=$3', [req.body.tracking || '', 'held_waiting_delivery', l.id]);
  res.json({ ok: true });
});
app.post('/api/listings/:id/deliver', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || !l.tracking) return res.json({ ok: false, error: 'tracking must be on file first' });
  await query('UPDATE listings SET delivered=1, delivered_at=$1, escrow_status=$2 WHERE id=$3', [nowISO(), 'held_refund_window', l.id]);
  res.json({ ok: true, releaseAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString() });
});
app.post('/api/listings/:id/release-escrow', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!l.delivered_at || Date.now() - new Date(l.delivered_at).getTime() < 12 * 3600 * 1000) return res.json({ ok: false, error: '12-hour refund window is still open' });
  const refund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status='pending'", [l.id]);
  if (refund) return res.json({ ok: false, error: 'a refund request is pending' });
  await query("UPDATE listings SET escrow_status='released' WHERE id=$1", [l.id]);
  res.json({ ok: true });
});

// ---------- Chat / live ----------
app.get('/api/listings/:id/chat', async (req, res) => res.json(await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [req.params.id])));
app.post('/api/listings/:id/chat', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
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
app.post('/api/listings/:id/buy-now-offer', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.type !== 'auction') return res.json({ ok: false, error: 'offers in chat are for auctions only' });
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
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!l || l.winner !== req.body.reviewer) return res.json({ ok: false, error: 'only the winner can leave a score' });
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
app.post('/api/labels', async (req, res) => {
  const tracking = 'BTB' + String(Math.floor(Math.random() * 900000000) + 100000000) + 'US';
  const code = 'LBL-' + uid().slice(0, 8).toUpperCase();
  await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), req.body.listingId, req.body.carrier || 'USPS', tracking, code, nowISO()]);
  res.json({ ok: true, carrier: req.body.carrier || 'USPS', tracking, code, note: 'Test version only — no real carrier connected yet.' });
});
// ---------- Receipts / refunds (photo + video required) ----------
app.get('/api/receipt/:listingId', async (req, res) => {
  const r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [req.params.listingId]);
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!r || !l) return res.json({ ok: false, error: 'no receipt yet — sale has not completed' });
  res.json({ ok: true, receiptNo: r.receipt_no, item: l.title, winningBid: r.amount, shipping: r.shipping, total: r.total, seller: l.seller, winner: l.winner, dateWon: r.created_at, paymentStatus: l.payment_status, escrowStatus: l.escrow_status, sellerLive: !!l.seller_live, bidCount: (await query('SELECT COUNT(*) AS n FROM bids WHERE listing_id=$1', [l.id]))[0].n });
});
app.post('/api/refunds', async (req, res) => {
  const b = req.body || {};
  if (!b.photoName) return res.json({ ok: false, error: 'a photo of the item is required' });
  if (!b.videoName) return res.json({ ok: false, error: 'a video of the item is required' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [b.listingId]);
  if (!l || !l.delivered_at) return res.json({ ok: false, error: 'refunds open only after delivery' });
  if (Date.now() - new Date(l.delivered_at).getTime() > 12 * 3600 * 1000) return res.json({ ok: false, error: 'the 12-hour refund window has closed' });
  if (!['not as described', 'damaged in transit', 'wrong item', 'defective', 'never arrived'].includes((b.reason || '').toLowerCase())) return res.json({ ok: false, error: 'a legit reason is required — "changed my mind" is not accepted' });
  await query('INSERT INTO refunds(id,listing_id,requester,reason,photo_name,video_name,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [uid(), b.listingId, b.requester || 'Buyer', b.reason, b.photoName, b.videoName, 'pending', nowISO()]);
  await query("UPDATE listings SET escrow_status='held_refund_pending' WHERE id=$1", [b.listingId]);
  res.json({ ok: true });
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
app.post('/api/waitlist', async (req, res) => {
  await query('INSERT INTO waitlist(id,name,email,role,founding,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), req.body.name || '', req.body.email || '', req.body.role || 'buyer', req.body.founding ? 1 : 0, nowISO()]);
  res.json({ ok: true });
});
app.get('/api/dashboard', async (req, res) => {
  const settings = await getSettings();
  const sold = await query("SELECT * FROM listings WHERE status='sold' AND escrow_status='released'");
  let fees = 0;
  for (const l of sold) { const pct = (await isFounding(l.seller)) ? 5 : 10; fees += ((l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0)) * pct) / 100; }
  const tax = fees * (settings.tax_percent / 100);
  const unpaid = await query("SELECT * FROM listings WHERE status='ended' AND payment_status IN ('awaiting_payment','declined')");
  const refunds = await query("SELECT * FROM refunds WHERE status='pending'");
  const escrowHeld = await query("SELECT * FROM listings WHERE escrow_status LIKE 'held%'");
  res.json({ totalFeesEarned: Math.round(fees * 100) / 100, taxPercent: settings.tax_percent, taxSetAside: Math.round(tax * 100) / 100, availableToUse: Math.round((fees - tax) * 100) / 100, unpaidWins: unpaid, refundsPending: refunds, escrowHeld: escrowHeld.map(l => ({ id: l.id, title: l.title, amount: l.escrow_amount })) });
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

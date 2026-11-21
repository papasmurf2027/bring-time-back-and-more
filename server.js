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
// Always fetch the page and the script fresh (Kevin, 2026-11-20): his
// phone kept showing a saved old copy of the site after a deploy, so a
// new fix did not show up and the same old error kept coming back.
// No-cache on the page and the script forces a fresh copy every time.
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js')) res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// ---------- Rate limiting (in-memory, no new dependencies) ----------
// 60 POST /api/* per minute per IP; stricter for chat/bid (20/min) and
// waitlist / founding-claim (10/min). GETs are never limited. Exceeding
// any bucket returns HTTP 429 with ok:false.
const _rateBuckets = new Map();
function _rateCheck(key, limit) {
  const now = Date.now();
  let b = _rateBuckets.get(key);
  if (!b || now - b.start > 60000) { b = { start: now, count: 0 }; _rateBuckets.set(key, b); }
  b.count++;
  return b.count <= limit;
}
app.use((req, res, next) => {
  if (req.method !== 'POST' || !req.path.startsWith('/api/')) return next();
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!_rateCheck('all:' + ip, 60)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  if (/^\/api\/listings\/[^/]+\/(chat|bid)$/.test(req.path)) {
    if (!_rateCheck('cb:' + ip + ':' + req.path, 20)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  if (req.path === '/api/waitlist' || req.path === '/api/founding/claim') {
    if (!_rateCheck('wl:' + ip, 10)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  // M5 fix (2026-11-19): buckets that were missing — report, live-video
  // signal, labels, and listing creation each get their own per-IP bucket.
  if (req.path === '/api/report') {
    if (!_rateCheck('rep:' + ip, 10)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  if (/^\/api\/listings\/[^/]+\/signal$/.test(req.path)) {
    if (!_rateCheck('sig:' + ip + ':' + req.path, 20)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  if (req.path === '/api/labels') {
    if (!_rateCheck('lab:' + ip, 10)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  if (req.path === '/api/listings') {
    if (!_rateCheck('lst:' + ip, 10)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  if (/^\/api\/auth\/(login|signup|forgot|forgot-answer|reset|security-question)$/.test(req.path)) {
    // Per-endpoint bucket (not one shared bucket): a few logins must not
    // lock a user out of forgot/reset, and vice versa. 10/min each.
    if (!_rateCheck('auth:' + ip + ':' + req.path, 10)) return res.status(429).json({ ok: false, error: 'too many requests, slow down' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const PRELAUNCH = process.env.PRELAUNCH !== 'false';
const isPg = !!DATABASE_URL;
let pool = null; let sqlite = null;
if (isPg) { const { Pool } = require('pg'); pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }); }
else { const { DatabaseSync } = require('node:sqlite'); sqlite = new DatabaseSync(path.join(__dirname, 'data.db')); }

async function query(text, params = []) {
  params = (params || []).map(v => v === undefined ? null : v);
  if (isPg) { const r = await pool.query(text, params); return r.rows; }
  const sql = text.replace(/\$\d+/g, '?');
  const stmt = sqlite.prepare(sql);
  try { return stmt.all(...params); } catch (e) { stmt.run(...params); return []; }
}
async function queryOne(text, params = []) { const rows = await query(text, params); return rows[0] || null; }
// M3 fix (2026-11-19): runQuery returns how many rows an UPDATE/DELETE
// actually changed, so a sale can be completed atomically — the UPDATE
// itself checks the listing is still in the expected state, and a second
// simultaneous request changes 0 rows instead of creating a second winner.
async function runQuery(text, params = []) {
  params = (params || []).map(v => v === undefined ? null : v);
  if (isPg) { const r = await pool.query(text, params); return r.rowCount || 0; }
  const sql = text.replace(/\$\d+/g, '?');
  const stmt = sqlite.prepare(sql);
  const info = stmt.run(...params);
  return (info && info.changes) || 0;
}
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
  if (/\b[a-z0-9][a-z0-9-]*\.(com|net|shop|org|io|co|app|store|site|me|ly|tv|gg|cc|to|fm|xyz|online|live|click|link|stream|watch|video|news|media)\b/.test(stripped)) return true;
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
// ---------- Owner lock ----------
// OWNER_PASSWORD env var. If it is not set, the owner endpoints below are
// NEVER open — they return ok:false "owner password not set". The password
// is accepted as header x-owner-password or body ownerPassword only —
// never in the URL (2026-11-19 fix): a password in a URL ends up in server
// logs, browser history and shared links.
function _ownerSupplied(req) {
  const h = req.headers && req.headers['x-owner-password'];
  if (h) return String(h);
  if (req.body && (req.body.ownerPassword || req.body.owner_password)) return String(req.body.ownerPassword || req.body.owner_password);
  return '';
}
function _ownerOk(req) {
  if (!OWNER_PASSWORD) return false;
  const sup = _ownerSupplied(req);
  if (!sup) return false;
  const a = Buffer.from(sup), b = Buffer.from(OWNER_PASSWORD);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}
function requireOwner(req, res) {
  if (!OWNER_PASSWORD) { res.status(403).json({ ok: false, error: 'owner password not set' }); return false; }
  if (!_ownerOk(req)) { res.status(403).json({ ok: false, error: 'owner password required' }); return false; }
  return true;
}
// ---------- Seller identity (no passwords for sellers, test-friendly) ----------
// First time a seller name is used to create a listing or claim a founding
// spot, the server issues a random token, stores only its SHA-256 hash in
// seller_tokens, and returns the plain token ONCE. The client keeps it in
// localStorage keyed by seller name and sends it as x-seller-token (or body
// sellerToken) on seller-only actions. The plain token is never stored.
// GRANDFATHERING: listings made before tokens existed have no token row for
// that seller. In that case the action is allowed once AND a token is issued
// in the response, so the seller gets one going forward.
function _hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
// Listing photo URLs (2026-11-19 fix): only an uploaded data:image (not SVG,
// which can carry script) or a plain https link may be stored. Anything else
// (javascript:, quotes breaking out of the src attribute, onerror payloads,
// http, bare text) is invalid and the listing is refused.
function _safeImageUrl(u) {
  if (u === undefined || u === null) return '';
  const v = String(u).trim();
  if (!v) return '';
  if (/["'<>\s]/.test(v)) return null;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return v.slice(0, 1500000);
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s]*)?$/.test(v)) return v.slice(0, 1500000);
  return null;
}
async function _issueSellerToken(seller, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await query('INSERT INTO seller_tokens(id,seller,token_hash,created_at,user_id) VALUES($1,$2,$3,$4,$5)', [uid(), seller, _hashToken(token), nowISO(), userId || null]);
  return token;
}
async function ensureSellerToken(seller, userId) {
  if (!seller) return null;
  if (userId) {
    const rows = await query('SELECT id FROM seller_tokens WHERE user_id=$1', [userId]);
    if (rows.length) return null;
    return _issueSellerToken(seller, userId);
  }
  const rows = await query('SELECT id FROM seller_tokens WHERE seller=$1', [seller]);
  if (rows.length) return null;
  return _issueSellerToken(seller, null);
}
async function checkSellerToken(req, res, seller) {
  // Returns { newToken? } on success, or sends a 403 and returns null.
  // Tokens are keyed by the signed-in account id, never by display name, so
  // a second account with the same name cannot use or steal the first
  // seller's token. A legacy name-only token row is used only when the
  // signed-in seller has no id-keyed token AND the sale predates user ids.
  if (!seller) { res.status(403).json({ ok: false, error: 'seller name is required' }); return null; }
  const uid2 = req.user && req.user.id;
  if (uid2) {
    const rows = await query('SELECT token_hash FROM seller_tokens WHERE user_id=$1', [uid2]);
    if (rows.length) {
      const supplied = (req.headers && req.headers['x-seller-token']) || (req.body && (req.body.sellerToken || req.body.token)) || '';
      if (!supplied) { res.status(403).json({ ok: false, error: 'seller token required — use the token given when this seller first listed or claimed a founding spot' }); return null; }
      if (!rows.some(r => r.token_hash === _hashToken(supplied))) { res.status(403).json({ ok: false, error: 'seller token does not match this seller' }); return null; }
      return {};
    }
    return { newToken: await _issueSellerToken(seller, uid2) };
  }
  const rows = await query('SELECT token_hash FROM seller_tokens WHERE seller=$1', [seller]);
  if (!rows.length) {
    // Grandfathered seller (listed before tokens existed): allow once and
    // issue a token in the response so they have one going forward.
    return { newToken: await _issueSellerToken(seller, null) };
  }
  const supplied = (req.headers && req.headers['x-seller-token']) || (req.body && (req.body.sellerToken || req.body.token)) || '';
  if (!supplied) { res.status(403).json({ ok: false, error: 'seller token required — use the token given when this seller first listed or claimed a founding spot' }); return null; }
  if (!rows.some(r => r.token_hash === _hashToken(supplied))) { res.status(403).json({ ok: false, error: 'seller token does not match this seller' }); return null; }
  return {};
}
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const st of schema.split(';')) { const t = st.trim(); if (t) { try { await query(t); } catch (e) { /* table may exist */ } } }
  try { await query('ALTER TABLE listings ADD COLUMN image_url TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN condition TEXT'); } catch (e) { /* column already exists */ }
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
  try { await query('ALTER TABLE users ADD COLUMN rules_agreed INTEGER DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN photo TEXT DEFAULT \'\''); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN payment_method TEXT DEFAULT \'\''); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN payment_detail TEXT DEFAULT \'\''); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_photo_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_video_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_status TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN dispute_decided_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_due_at TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_photo_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN return_video_name TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN seller_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE bids ADD COLUMN bidder_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN shipping_address TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN winner_address TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN no_change_of_mind INTEGER DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE listings ADD COLUMN winner_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE top_limits ADD COLUMN buyer_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE reviews ADD COLUMN reviewer_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE founding ADD COLUMN seller_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE refunds ADD COLUMN requester_user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE seller_tokens ADD COLUMN user_id TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN security_question TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN security_answer_hash TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE users ADD COLUMN security_answer_salt TEXT'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE waitlist ADD COLUMN confirmed INTEGER DEFAULT 0'); } catch (e) { /* column already exists */ }
  try { await query('ALTER TABLE waitlist ADD COLUMN confirm_token_hash TEXT'); } catch (e) { /* column already exists */ }
  try { await query("CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_one_open ON refunds(listing_id) WHERE status IN ('pending','awaiting_return','disputed')"); } catch (e) { /* index may exist */ }
  await getSettings();
}
// ---------- Real accounts (Kevin, 2026-11-19) ----------
// Buyers MUST have an account to bid or buy, and sellers MUST have an
// account to list. Before this, anyone could type any name and the site
// believed them. Now every bid, buy, listing, chat message and refund
// comes from the signed-in account — a name typed in a form is IGNORED
// server-side. Passwords are scrypt hashes with a random salt (never
// stored plain, never returned). Sessions are random tokens, only the
// SHA-256 hash is stored, and they expire after 30 days.
// Email verification: email_verified starts at 0. In TEST MODE bidding
// is allowed anyway (the site is still pre-launch, no real money). When
// a Resend key is set, signup tries to send a verification note but
// never blocks signup on it — verification becomes a go-live step.
// The old seller-token check stays as a SECOND layer on seller actions;
// the session is now the primary identity.
function _hashPassword(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString('hex'); }
function _passwordOk(password, salt, hash) {
  try {
    const a = Buffer.from(_hashPassword(password, salt), 'hex');
    const b = Buffer.from(String(hash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}
function _publicUser(u) { return u ? { id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: !!u.email_verified, shippingAddress: u.shipping_address || '', hasSecurityQuestion: !!(u.security_question || '').trim(), photo: u.photo || '', paymentMethod: u.payment_method || '', hasPaymentDetail: !!(u.payment_detail || '').trim() } : null; }
// Security question (Kevin, 2026-11-19): the answer is hashed with scrypt
// and its own salt, exactly like a password. It is never stored plain and
// never returned by any endpoint. Answers are compared case-insensitively
// and trimmed, so answers that differ only by case or spaces still match.
function _normAnswer(a) { return String(a || '').trim().toLowerCase(); }
function _hashAnswer(answer, salt) { return crypto.scryptSync(_normAnswer(answer), salt, 64).toString('hex'); }
function _answerOk(answer, salt, hash) {
  try {
    if (!salt || !hash) return false;
    const a = Buffer.from(_hashAnswer(answer, salt), 'hex');
    const b = Buffer.from(String(hash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}
const SECURITY_QUESTIONS = ["What was the name of your first pet?", "What is your mother's maiden name?", "What town did you grow up in?", "Who was your favourite teacher?", "What was your first car?"];
// Wrong security answers: max 5 per email per hour, then locked out for an
// hour. In-memory, like the other rate limits — it resets if the server
// restarts, which is fine for a single-instance test site.
const _secWrong = new Map();
function _secLocked(email) {
  const b = _secWrong.get(email);
  if (!b) return false;
  if (Date.now() - b.start > 3600 * 1000) { _secWrong.delete(email); return false; }
  return b.count >= 5;
}
function _secRecordWrong(email) {
  const now = Date.now();
  let b = _secWrong.get(email);
  if (!b || now - b.start > 3600 * 1000) { b = { start: now, count: 0 }; _secWrong.set(email, b); }
  b.count++;
}
// Shipping address (Kevin, 2026-11-19): every account has ONE default shipping
// address, changeable by that signed-in user at any time. It is used for
// future bids and buys. A sale already won is locked to the address snapshot
// taken when it was won, stored on the listing as winner_address, and a later
// change to the default never changes a won sale. The address is private:
// it is never in public listings or overview, and is shown only to the buyer
// themself, the seller of that won listing, and the owner dashboard.
function _needsAddress(u) { return !u || !(u.shipping_address || '').trim(); }
const ADDRESS_REQUIRED_ERROR = 'add your default shipping address in Your account first — you need an address on file to bid or buy';
// Identity by account id, not display name (2026-11-19 fix): two accounts
// may never share a display name at signup, and every check below uses the
// signed-in user's id when the row has one. Name fallback is ONLY for rows
// made before user ids existed (no winner_user_id / requester_user_id /
// seller_user_id stored) and never overrides an id match.
function _winnerIsUser(u, l) {
  if (!u || !l) return false;
  if (l.winner_user_id) return u.id === l.winner_user_id;
  return u.name === l.winner;
}
function _requesterIsUser(u, rf) {
  if (!u || !rf) return false;
  if (rf.requester_user_id) return u.id === rf.requester_user_id;
  return u.name === rf.requester;
}
function _canSeeWinnerAddress(req, l, u) {
  if (!l || !l.winner_address) return false;
  if (_ownerOk(req)) return true;
  if (u && _winnerIsUser(u, l)) return true;
  if (u && (l.seller_user_id ? u.id === l.seller_user_id : u.name === l.seller)) return true;
  return false;
}
function _stripWinnerAddress(l, req, u) { if (!l) return l; const out = { ...l }; if (!_canSeeWinnerAddress(req, l, u)) delete out.winner_address; return out; }
async function _createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await query('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)', [uid(), userId, _hashToken(token), nowISO(), expiresAt]);
  return token;
}
async function _userFromSession(req) {
  const token = (req.headers && req.headers['x-session-token']) || (req.body && req.body.sessionToken) || '';
  if (!token) return null;
  const row = await queryOne('SELECT * FROM sessions WHERE token_hash=$1', [_hashToken(token)]);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) { await query('DELETE FROM sessions WHERE id=$1', [row.id]); return null; }
  return queryOne('SELECT * FROM users WHERE id=$1', [row.user_id]);
}
async function requireAuth(req, res) {
  const u = await _userFromSession(req);
  if (!u) { res.status(401).json({ ok: false, error: 'sign in to do that — buyers and sellers need an account to bid, buy, list or chat' }); return null; }
  req.user = u;
  return u;
}
// Seller-only gate: signed in, account is seller/both (not buyer-only),
// and the session user IS that seller. New listings store seller_user_id,
// so two accounts with the same display name cannot act as each other;
// older listings with no seller_user_id fall back to a name match.
function _sellerMatches(req, l) {
  if (!l) return false;
  if (l.seller_user_id) return l.seller_user_id === req.user.id;
  return req.user.name === l.seller;
}
async function requireSellerFor(req, res, l) {
  const u = await requireAuth(req, res); if (!u) return null;
  if (u.role === 'buyer') { res.json({ ok: false, error: 'sign up as a seller to do that — your account is a buyer account' }); return null; }
  if (!_sellerMatches(req, l)) { res.json({ ok: false, error: 'only the seller can do that' }); return null; }
  return u;
}
async function _issueResetToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour
  await query('INSERT INTO password_resets(id,user_id,token_hash,expires_at,used) VALUES($1,$2,$3,$4,0)', [uid(), userId, _hashToken(token), expiresAt]);
  return token;
}
async function _sendAccountEmail(email, subject, text) {
  if (!process.env.RESEND_API_KEY) return { sent: false, mode: 'manual' };
  try {
    const fromEmail = process.env.FROM_EMAIL || 'Bring Time Back and More <onboarding@resend.dev>';
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromEmail, to: [email], subject, text }), signal: AbortSignal.timeout(10000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, mode: 'resend', error: 'Resend failed (' + r.status + ')' };
    return { sent: true, mode: 'resend', resendId: data.id || null };
  } catch (e) { return { sent: false, mode: 'resend', error: 'Resend request failed: ' + e.message }; }
}
// A reset token is NEVER returned by /api/auth/forgot (2026-11-19 fix):
// with no Resend key set, anyone who knew a user's email could ask for a
// reset and take over the account. The token is emailed when a key is set;
// in test mode the ONLY way to hand one out is POST /api/auth/owner-reset,
// which requires the owner password. _resetTokenForResponse is used only
// there, never on the public forgot endpoint.
function _resetTokenForResponse(token) {
  return { resetToken: token, testOnly: 'owner only — this reset code is shown to Kevin so he can pass it on. It expires in 1 hour.' };
}
// ---------- No fake / bot accounts (Kevin, 2026-11-19) ----------
// Free checks, no paid service. A script making fake accounts in bulk hits
// all three: (1) a honeypot field real people never fill, (2) throwaway
// email addresses are refused, (3) a simple sum only a person reading the
// page can answer. One determined person making one account by hand can
// still get through — nothing free stops that — but mass fake accounts do
// not. Sellers face the real gate at go-live: Stripe ID verification
// before any payout.
const DISPOSABLE_EMAIL_DOMAINS = ['mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'sharklasers.com', 'yopmail.com', 'temp-mail.org', 'maildrop.cc', 'getnada.com', 'mohmal.com', 'throwawaymail.com', 'fakeinbox.com', 'trashmail.com', 'dispostable.com', 'mailnesia.com', 'mintemail.com', 'spamgourmet.com', 'mytemp.email', 'tempail.com', 'emailondeck.com', 'harakirimail.com', 'inboxbear.com', 'tmail.com', 'tempinbox.com', 'mailcatch.com'];
const _signupRate = new Map(); // ip -> {start, count}; 5 sign-ups per hour
function _signupRateOk(ip) {
  const now = Date.now();
  let b = _signupRate.get(ip);
  if (!b || now - b.start > 3600000) { b = { start: now, count: 0 }; _signupRate.set(ip, b); }
  b.count++;
  return b.count <= 5;
}
app.post('/api/auth/signup', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const email = String(b.email || '').trim().toLowerCase();
  // Bulk fake accounts: at most 5 sign-ups per hour from one connection.
  if (!_signupRateOk(req.ip || '')) return res.json({ ok: false, error: 'too many sign-ups from this connection — try again later' });
  // Honeypot: a hidden field real people never fill. A bot filling every
  // field trips it. The error stays vague on purpose.
  if (String(b.website || b.url || '').trim()) return res.json({ ok: false, error: 'sign up failed — please try again' });
  // Human check at first sign-up only (Kevin, 2026-11-20): the sign-up
  // form has an "I'm a real person" checkbox. The server refuses a
  // signup without it, so a bot can't skip it by calling this endpoint
  // directly. It is only for sign-up — sign-in and signed-in users
  // never see it.
  if (b.human !== true && b.human !== 'true') return res.json({ ok: false, error: 'tap the box to show you are a real person, then try again' });
  // Rules agreement at sign-up (Kevin, 2026-11-20): everyone agrees to
  // the Rules once, when they join — buyers and sellers alike. It is no
  // longer asked every time someone lists, because that was a pain.
  // Existing accounts are grandfathered — they already joined under the
  // Rules, and the per-listing agreement is gone, so they are never
  // asked again.
  if (b.rulesAgreed !== true && b.rulesAgreed !== 'true' && b.rulesAgreed !== 1) return res.json({ ok: false, error: 'read the Rules and agree to them to join — tap "Read the Rules" then "I agree to the Rules"' });
  const _domain = (email.split('@')[1] || '').toLowerCase();
  if (DISPOSABLE_EMAIL_DOMAINS.includes(_domain)) return res.json({ ok: false, error: 'use a real email address — temporary email addresses cannot sign up' });
  const password = String(b.password || '');
  // Everyone can buy and sell (Kevin, 2026-11-20): no role choice at
  // sign-up, so nobody can pick the wrong one and get stuck as a buyer.
  // New accounts are always buy-and-sell.
  const role = ['buyer', 'seller', 'both'].includes(b.role) ? b.role : 'both';
  const shippingAddress = String(b.shippingAddress || b.address || '').trim().slice(0, 500);
  // Security question (Kevin, 2026-11-20): NOT asked at sign-up any more —
  // it only comes up when you forget your password. A user can set one
  // later (signed in, "Change security question") if they want to reset
  // their own password; without one, a forgotten password is owner-reset
  // only. Kept optional here so an old client that still sends one works.
  const secQ = String(b.securityQuestion || b.question || '').trim().slice(0, 200);
  const secA = String(b.securityAnswer || b.answer || '').trim();
  if (!name) return res.json({ ok: false, error: 'your name is required' });
  if (adHit(name) || bannedHit(name)) return res.json({ ok: false, error: 'that name cannot be used — no links, advertising or banned items in a display name' });
  if (!email || !email.includes('@')) return res.json({ ok: false, error: 'a valid email is required' });
  if (password.length < 8) return res.json({ ok: false, error: 'password must be at least 8 characters' });
  const ex = await queryOne('SELECT id FROM users WHERE email=$1', [email]);
  if (ex) return res.json({ ok: false, error: 'an account with that email already exists — sign in instead' });
  // Display names are unique (2026-11-19 fix): two accounts with the same
  // name could act as each other in name-checked flows. Existing accounts
  // are not locked out — this only refuses a NEW signup that copies a name
  // already in use.
  const exName = await queryOne('SELECT id FROM users WHERE LOWER(name)=LOWER($1)', [name]);
  if (exName) return res.json({ ok: false, error: 'that display name is already taken — pick a different name' });
  const salt = crypto.randomBytes(16).toString('hex');
  const secSalt = crypto.randomBytes(16).toString('hex');
  const id = uid();
  await query('INSERT INTO users(id,name,email,password_hash,salt,role,email_verified,shipping_address,created_at,security_question,security_answer_hash,security_answer_salt,rules_agreed) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,1)',
    [id, name, email, _hashPassword(password, salt), salt, role, shippingAddress, nowISO(), secQ, _hashAnswer(secA, secSalt), secSalt]);
  const user = await queryOne('SELECT * FROM users WHERE id=$1', [id]);
  const token = await _createSession(id);
  // Verification note in test mode: best effort only, never blocks signup.
  _sendAccountEmail(email, 'Your Bring Time Back and More account',
    'Hi ' + name + ',\n\nYour Bring Time Back and More account is ready — you can bid, buy and sell.\n\nYou signed up as: ' + role + '.\n\nSee you there,\nBring Time Back and More').catch(() => {});
  res.json({ ok: true, user: _publicUser(user), sessionToken: token });
});
app.post('/api/auth/login', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const user = await queryOne('SELECT * FROM users WHERE email=$1', [email]);
  // Generic error either way — never reveal whether the email exists.
  if (!user || !_passwordOk(password, user.salt, user.password_hash)) return res.json({ ok: false, error: 'email or password is wrong' });
  // Session rotation (2026-11-19 fix): a fresh sign-in replaces every older
  // session for this user, so a stolen old token stops working on next login.
  await query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
  const token = await _createSession(user.id);
  res.json({ ok: true, user: _publicUser(user), sessionToken: token });
});
app.get('/api/auth/me', async (req, res) => {
  const u = await _userFromSession(req);
  if (!u) return res.status(401).json({ ok: false, error: 'not signed in' });
  res.json({ ok: true, user: _publicUser(u) });
});
app.post('/api/auth/address', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const address = String((req.body && (req.body.address || req.body.shippingAddress)) || '').trim().slice(0, 500);
  await query('UPDATE users SET shipping_address=$1 WHERE id=$2', [address, u.id]);
  const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ ok: true, shippingAddress: fresh.shipping_address || '', user: _publicUser(fresh) });
});
// Change username (Kevin, 2026-11-20): change your display name from My
// Profile. The new name must be free (names are unique) and must pass the
// same checks as sign-up (no links, advertising or banned items). The name
// is stored as plain text in many places — listings, bids, chats, follows,
// reviews, private messages, shows, giveaways — so changing it updates
// every one of those rows to the new name, so nothing still shows the old
// one. The account itself is by user id, so the session and the seller
// token keep working.
app.post('/api/auth/username', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const oldName = u.name;
  const name = String((req.body && req.body.name) || '').trim().slice(0, 100);
  if (!name) return res.json({ ok: false, error: 'type a new username' });
  if (name === oldName) return res.json({ ok: false, error: 'that is already your username' });
  if (adHit(name) || bannedHit(name)) return res.json({ ok: false, error: 'that name cannot be used — no links, advertising or banned items in a display name' });
  const taken = await queryOne('SELECT id FROM users WHERE LOWER(name)=LOWER($1) AND id<>$2', [name, u.id]);
  if (taken) return res.json({ ok: false, error: 'that username is already taken — pick a different one' });
  await query('UPDATE users SET name=$1 WHERE id=$2', [name, u.id]);
  await query('UPDATE listings SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE listings SET winner=$1 WHERE winner=$2', [name, oldName]);
  await query('UPDATE listings SET buy_now_offer_by=$1 WHERE buy_now_offer_by=$2', [name, oldName]);
  await query('UPDATE bids SET bidder=$1 WHERE bidder=$2', [name, oldName]);
  await query('UPDATE chats SET name=$1 WHERE name=$2', [name, oldName]);
  await query('UPDATE follows SET buyer=$1 WHERE buyer=$2', [name, oldName]);
  await query('UPDATE follows SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE drops SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE drops SET winner=$1 WHERE winner=$2', [name, oldName]);
  await query('UPDATE drop_entries SET name=$1 WHERE name=$2', [name, oldName]);
  await query('UPDATE top_limits SET buyer=$1 WHERE buyer=$2', [name, oldName]);
  await query('UPDATE reviews SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE reviews SET reviewer=$1 WHERE reviewer=$2', [name, oldName]);
  await query('UPDATE shows SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE waitlist SET name=$1 WHERE email=$2', [name, u.email]);
  await query('UPDATE founding SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE refunds SET requester=$1 WHERE requester=$2', [name, oldName]);
  await query('UPDATE incorrect_claims SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE bad_listing_strikes SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE private_messages SET sender=$1 WHERE sender=$2', [name, oldName]);
  await query('UPDATE private_messages SET recipient=$1 WHERE recipient=$2', [name, oldName]);
  await query('UPDATE seller_tokens SET seller=$1 WHERE seller=$2', [name, oldName]);
  await query('UPDATE wheel_entries SET name=$1 WHERE name=$2', [name, oldName]);
  const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ ok: true, user: _publicUser(fresh) });
});
// Profile picture (Kevin, 2026-11-20): put your own picture next to your
// name. Send a data:image (the profile page resizes it small first) or an
// empty photo to remove it. Only an uploaded image or a https link is
// stored — the same check as listing photos.
app.post('/api/auth/photo', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const photo = String((req.body && req.body.photo) || '').trim();
  if (!photo) { await query('UPDATE users SET photo=$1 WHERE id=$2', ['', u.id]); const f = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]); return res.json({ ok: true, user: _publicUser(f) }); }
  const safe = _safeImageUrl(photo);
  if (safe === null) return res.json({ ok: false, error: 'that picture was not saved — pick an image from your phone or a https image link' });
  await query('UPDATE users SET photo=$1 WHERE id=$2', [safe, u.id]);
  const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ ok: true, user: _publicUser(fresh) });
});
// Payment method saved in the profile (Kevin, 2026-11-20): a buyer sets
// their payment method once in My Profile, and the room never asks for it
// again — Buy Now and Pay now just use what is saved here. TEST MODE ONLY:
// the detail is a test value (never a real card number); at go-live Stripe
// replaces this whole flow and no card data is stored on the site.
const PAYMENT_METHODS = ['card', 'PayPal', 'Apple Pay', 'Google Pay', 'Cash App', 'Venmo', 'bank'];
app.post('/api/auth/payment', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const method = String((req.body && req.body.method) || '').trim();
  const detail = String((req.body && req.body.detail) || '').trim();
  if (!PAYMENT_METHODS.includes(method)) return res.json({ ok: false, error: 'pick a payment method' });
  if (!detail) return res.json({ ok: false, error: 'type your payment detail' });
  await query('UPDATE users SET payment_method=$1, payment_detail=$2 WHERE id=$3', [method, detail.slice(0, 200), u.id]);
  const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ ok: true, user: _publicUser(fresh) });
});
// Role switch needs an email code (Kevin, 2026-11-20): you can switch
// roles, but only after a code is emailed to your account's email.
// Step 1 — ask for the code. A 6-digit code is emailed to the account's
// email (Resend when a key is set). If no email key is set yet, the code
// comes back in the response instead (manual mode) so the switch still
// works until the site's email is set up — once a key is set, the code
// only ever goes by email and is never shown on screen.
app.post('/api/auth/role-request', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const role = String((req.body && req.body.role) || '').trim();
  if (!['buyer', 'seller', 'both'].includes(role)) return res.json({ ok: false, error: 'pick a role — buyer, seller, or buy and sell' });
  if (role === u.role) return res.json({ ok: false, error: 'your account is already ' + (role === 'both' ? 'buy and sell' : role) });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  await query('UPDATE role_switches SET used=1 WHERE user_id=$1 AND used=0', [u.id]);
  await query('INSERT INTO role_switches(id,user_id,requested_role,code_hash,expires_at,used,created_at) VALUES($1,$2,$3,$4,$5,0,$6)', [uid(), u.id, role, _hashToken(code), expiresAt, nowISO()]);
  const roleName = role === 'both' ? 'Buy and sell' : (role === 'seller' ? 'Sell' : 'Buy');
  const sent = await _sendAccountEmail(u.email, 'Your Bring Time Back and More switch code', 'Hi ' + u.name + ',\n\nYou asked to switch your account to ' + roleName + '. Type this code on the site to switch:\n\n' + code + '\n\nThe code works for 1 hour. If you did not ask to switch, ignore this email — your account stays as it is.\n\nBring Time Back and More');
  if (sent.sent) return res.json({ ok: true, sent: true, email: u.email, role });
  return res.json({ ok: true, sent: false, mode: 'manual', code, role });
});
// Step 2 — type the emailed code to switch. One-time, 1 hour, then it is used up.
app.post('/api/auth/role-confirm', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const code = String((req.body && req.body.code) || '').trim();
  if (!code) return res.json({ ok: false, error: 'type the code from the email' });
  const row = await queryOne('SELECT * FROM role_switches WHERE user_id=$1 AND code_hash=$2 AND used=0 ORDER BY created_at DESC LIMIT 1', [u.id, _hashToken(code)]);
  if (!row) return res.json({ ok: false, error: 'that code is not right — check the email and try again' });
  if (new Date(row.expires_at).getTime() < Date.now()) return res.json({ ok: false, error: 'that code expired — ask for a new one' });
  await query('UPDATE role_switches SET used=1 WHERE id=$1', [row.id]);
  await query('UPDATE users SET role=$1 WHERE id=$2', [row.requested_role, u.id]);
  const fresh = await queryOne('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ ok: true, user: _publicUser(fresh) });
});
app.post('/api/auth/logout', async (req, res) => {
  const token = (req.headers && req.headers['x-session-token']) || (req.body && req.body.sessionToken) || '';
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [_hashToken(token)]);
  res.json({ ok: true });
});
app.post('/api/auth/logout-everywhere', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  await query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
  res.json({ ok: true, message: 'signed out on every device — sign in again to continue' });
});
// Change the security question/answer. Only the signed-in user, and only
// after typing their current password — a stolen session alone is not
// enough to swap the question and lock the real owner out.
app.post('/api/auth/security-question', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const b = req.body || {};
  const currentPassword = String(b.currentPassword || b.password || '');
  const secQ = String(b.securityQuestion || b.question || '').trim().slice(0, 200);
  const secA = String(b.securityAnswer || b.answer || '').trim();
  if (!_passwordOk(currentPassword, u.salt, u.password_hash)) return res.json({ ok: false, error: 'current password is wrong' });
  if (!secQ) return res.json({ ok: false, error: 'pick a security question' });
  if (secA.length < 2) return res.json({ ok: false, error: 'answer your security question — at least 2 characters' });
  const secSalt = crypto.randomBytes(16).toString('hex');
  await query('UPDATE users SET security_question=$1, security_answer_hash=$2, security_answer_salt=$3 WHERE id=$4',
    [secQ, _hashAnswer(secA, secSalt), secSalt, u.id]);
  res.json({ ok: true, message: 'security question changed — only you know the answer' });
});
// Forgot password, step 1 (Kevin, 2026-11-19): the site shows THAT
// account's security question — only the question text, never the answer.
// No reset token is issued here, and no token is ever returned by this
// endpoint. An account with no security question on file cannot reset by
// email at all — only Kevin can reset it via owner-reset.
app.post('/api/auth/forgot', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const user = email ? await queryOne('SELECT * FROM users WHERE email=$1', [email]) : null;
  if (!user || !(user.security_question || '').trim()) return res.json({ ok: true, hasQuestion: false, message: 'if that email has an account, check it for the next step — accounts with no security question on file can only be reset by the owner' });
  return res.json({ ok: true, hasQuestion: true, question: user.security_question, message: 'answer your security question to get a reset code' });
});
// Forgot password, step 2: answer the security question. A wrong answer
// is refused with the same generic message, and after 5 wrong answers for
// one email in an hour that email is locked out for an hour. A right answer
// issues a reset token — emailed when a Resend key is set, and NEVER
// returned in the response (test mode: ask Kevin, who uses owner-reset).
app.post('/api/auth/forgot-answer', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const answer = String((req.body && (req.body.answer || req.body.securityAnswer)) || '');
  const user = email ? await queryOne('SELECT * FROM users WHERE email=$1', [email]) : null;
  if (_secLocked(email)) return res.json({ ok: false, error: 'too many wrong answers for this email — try again in an hour, or ask the owner for a reset' });
  if (!user || !(user.security_question || '').trim()) return res.json({ ok: false, error: 'that answer is not right — no reset code was sent' });
  if (!_answerOk(answer, user.security_answer_salt, user.security_answer_hash)) {
    _secRecordWrong(email);
    if (_secLocked(email)) return res.json({ ok: false, error: 'too many wrong answers for this email — try again in an hour, or ask the owner for a reset' });
    return res.json({ ok: false, error: 'that answer is not right — no reset code was sent' });
  }
  _secWrong.delete(email);
  if (!process.env.RESEND_API_KEY) return res.json({ ok: true, message: 'answer is right — no email key is set yet, so ask Kevin (the owner) for a reset code' });
  const token = await _issueResetToken(user.id);
  const sent = await _sendAccountEmail(email, 'Reset your password — Bring Time Back and More',
    'Hi ' + user.name + ',\n\nYour password reset code is:\n\n' + token + '\n\nIt expires in 1 hour. Paste it into the Forgot password box on the site with your new password.\n\nIf you did not ask for this, ignore this email — your password has not changed.\n\nBring Time Back and More');
  if (sent.sent) return res.json({ ok: true, message: 'reset code sent to your email — it expires in 1 hour' });
  return res.json({ ok: true, message: 'if that email has an account, a reset code was sent' });
});
app.post('/api/auth/reset', async (req, res) => {
  const b = req.body || {};
  const token = String(b.token || b.resetToken || '');
  const newPassword = String(b.newPassword || b.password || '');
  if (!token) return res.json({ ok: false, error: 'a reset code is required' });
  if (newPassword.length < 8) return res.json({ ok: false, error: 'new password must be at least 8 characters' });
  const row = await queryOne('SELECT * FROM password_resets WHERE token_hash=$1', [_hashToken(token)]);
  if (!row || row.used) return res.json({ ok: false, error: 'reset code is wrong or already used' });
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return res.json({ ok: false, error: 'reset code has expired — ask for a new one' });
  const salt = crypto.randomBytes(16).toString('hex');
  await query('UPDATE users SET password_hash=$1, salt=$2 WHERE id=$3', [_hashPassword(newPassword, salt), salt, row.user_id]);
  await query('UPDATE password_resets SET used=1 WHERE id=$1', [row.id]);
  await query('DELETE FROM sessions WHERE user_id=$1', [row.user_id]); // all devices signed out
  res.json({ ok: true, message: 'password changed — sign in with your new password' });
});
// Seller-token recovery, tied to the account: a signed-in seller whose
// browser lost its seller token (new device, cleared site data) can get a
// fresh one — the session proves who they are, so this does not weaken
// the token check. Old tokens for that seller are replaced. The client
// calls this on sign-in for seller accounts, so the token is always in
// sync after a sign-in.
app.post('/api/auth/seller-token', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (u.role === 'buyer') return res.json({ ok: false, error: 'sign up as a seller to get a seller token — your account is a buyer account' });
  await query('DELETE FROM seller_tokens WHERE user_id=$1', [u.id]);
  const token = await _issueSellerToken(u.name, u.id);
  res.json({ ok: true, sellerToken: token });
});
app.post('/api/auth/owner-reset', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const email = String((req.body && (req.body.userEmail || req.body.email)) || '').trim().toLowerCase();
  const user = email ? await queryOne('SELECT * FROM users WHERE email=$1', [email]) : null;
  if (!user) return res.json({ ok: false, error: 'no account with that email' });
  const token = await _issueResetToken(user.id);
  const sent = await _sendAccountEmail(email, 'Reset your password — Bring Time Back and More',
    'Hi ' + user.name + ',\n\nKevin (the owner) reset your password for you. Your reset code is:\n\n' + token + '\n\nIt expires in 1 hour. Paste it into the Forgot password box on the site with your new password.\n\nBring Time Back and More');
  if (sent.sent) return res.json({ ok: true, message: 'reset code sent to ' + email });
  return res.json({ ok: true, message: 'reset code ready for Kevin to pass on', ..._resetTokenForResponse(token) });
});

// ---------- Time Wheel — FREE giveaway (Kevin, 2026-11-19) ----------
// The wheel is for FREE giveaways only. People enter free and their NAMES go
// on the wheel — nobody pays, nobody buys a spot, nobody pays to spin. The
// seller sets how long entries stay open (the listing timer). The wheel spins
// automatically when entries close, or when the seller spins it by hand. The
// winner gets the listed item FREE, is told they won, and the seller gets
// their shipping address and a shipping label, same as a win.
async function wheelEntriesFor(listingId) {
  return query('SELECT * FROM wheel_entries WHERE listing_id=$1 ORDER BY created_at ASC', [listingId]);
}
// Spin the wheel: pick ONE entrant at random. The winner gets the item free.
// Sets the winner + their shipping address (snapshot, same lock as a win),
// a shipping label record, and announces it in chat. Lands only once.
async function spinWheelFor(l) {
  const entries = await wheelEntriesFor(l.id);
  if (!entries.length) return null;
  const idx = crypto.randomInt(0, entries.length);
  const landed = entries[idx];
  const winnerUser = landed.user_id ? await queryOne('SELECT * FROM users WHERE id=$1', [landed.user_id]) : null;
  const winnerAddress = winnerUser ? (winnerUser.shipping_address || '') : '';
  const carrier = l.carrier || carrierFor(l.package_size);
  const tracking = l.tracking || makeTracking(carrier);
  await query('UPDATE listings SET wheel_landed_item=$1, wheel_landed_at=$2, wheel_spun=1, status=$3, winner=$4, winner_user_id=$5, winner_address=$6, payment_status=$7, tracking=$8, carrier=$9 WHERE id=$10',
    [landed.name, nowISO(), 'sold', landed.name, landed.user_id || null, winnerAddress, 'free', tracking, carrier, l.id]);
  // A free win gets a receipt too (total $0 — winner pays nothing, seller
  // covers shipping), so it shows on the winner's and seller's profile.
  const receiptNo = 'BTB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
  await query('INSERT INTO receipts(id,listing_id,receipt_no,amount,shipping,total,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, receiptNo, 0, 0, 0, nowISO()]);
  const exLabel = await queryOne('SELECT * FROM labels WHERE listing_id=$1', [l.id]);
  if (!exLabel) await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, carrier, tracking, 'LBL-' + uid().slice(0, 8).toUpperCase(), nowISO()]);
  // Email the winner what they won + the shipping (Kevin, 2026-11-20).
  // Free win — winner pays nothing, seller covers shipping. Never blocks.
  await sendWinnerEmail(l, landed.name, landed.user_id || null, 0, receiptNo, carrier, tracking, winnerAddress);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `⏰ Time Wheel landed on: ${landed.name} — they win ${l.title} FREE. No payment, no extra charge — the seller covers the shipping.`, nowISO()]);
  return { landedName: landed.name, landedIndex: idx, totalEntries: entries.length, winnerAddress, tracking, carrier };
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
// 48-HOUR RULE (Kevin, 2026-11-18, fixed 2026-11-19): NO auto-release until
// 48 hours AFTER DELIVERY pass with no seller response. Marking a return as
// delivered only records return_delivered_at and starts the 48-hour clock —
// it does NOT release the refund. The sweep releases it only when
// now >= delivered_at + 48h. A shipped return is never expired at the payout
// date - it waits for delivery, then for that 48-hour window. A wrong-item
// dispute (status 'disputed') pauses the auto-release entirely, because the
// sweep only runs on 'awaiting_return'. In test mode delivery is recorded
// from the tracking / "Mark return as delivered" step (POST
// /api/refunds/:id/return-delivered, usable by the buyer or the owner); at
// go-live a real carrier delivery scan will do this automatically.
const RETURN_AUTO_RELEASE_HOURS = 48;
function returnAutoReleaseAt(rf) {
  if (!rf || !rf.return_delivered_at) return null;
  return new Date(new Date(rf.return_delivered_at).getTime() + RETURN_AUTO_RELEASE_HOURS * 3600 * 1000).toISOString();
}
function withReturnDates(rf) {
  if (!rf) return rf;
  return { ...rf, returnAutoReleaseAt: returnAutoReleaseAt(rf) };
}
// Release an approved refund from the seller's escrow money. `how` says why
// the item is counted as back: 'seller_confirmed' (seller tapped),
// 'delivered' (kept for compatibility — a delivery record on its own no
// longer releases a refund; see the 48-hour rule above), or 'auto' (48 hours
// passed since the return was DELIVERED with no seller confirm).
async function releaseRefund(rf, l, how) {
  const now = nowISO();
  await query("UPDATE refunds SET return_received_at=$1, return_delivered_at=$2, status='approved' WHERE id=$3",
    [rf.return_received_at || now, how === 'seller_confirmed' ? (rf.return_delivered_at || null) : (rf.return_delivered_at || now), rf.id]);
  await query("UPDATE listings SET escrow_status='refunded' WHERE id=$1", [l.id]);
  const note = how === 'owner_never_arrived'
    ? 'Owner reviewed the never-arrived claim — the item never arrived, so the refund is released from the seller\'s escrow money.'
    : how === 'delivered'
    ? 'The return was scanned as DELIVERED (tracking ' + (rf.return_tracking || rf.return_label_tracking || '') + ') — the refund is released from the seller\'s escrow money. No seller tap was needed.'
    : how === 'auto'
      ? 'The return was delivered 48 hours ago and the seller never confirmed receipt, so the refund released on its own from the seller\'s escrow money — the seller cannot stall it by not tapping.'
      : how === 'dispute_correct'
        ? 'The owner reviewed the seller\'s photo and video of what came back against the receipt and video receipt — the item sent back is the correct item, so the claim was not upheld, the dispute is closed, and the refund is released from the seller\'s escrow money.'
        : 'Seller confirmed they received the item back — the refund is now released from the seller\'s escrow money.';
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, note, now]);
  return { ok: true, status: 'approved' };
}
// Auto-release: a DELIVERED return the seller never confirms. Runs in the
// sweep (every second) and before refund reads / escrow release, so a stalled
// refund never blocks the seller's payout forever and the buyer never loses
// out because the seller did not tap. Only fires 48 hours after delivery.
async function autoReleaseReturns() {
  const shipped = await query("SELECT * FROM refunds WHERE status='awaiting_return' AND return_delivered_at IS NOT NULL AND return_delivered_at <> ''");
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
  // buyer did their part, so it waits for delivery, then the 48-hour
  // auto-release after delivery, instead.
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
let _lastAutoRelease = 0; // auto escrow release runs once a minute, not every sweep tick
let _lastPresenceCleanup = 0; // stale room-presence rows are cleared once a minute
let _lastShowAlert = 0; // saved-show start alerts are checked once a minute
async function sweep() {
  try {
    await expireRefunds();
    const live = await query("SELECT * FROM listings WHERE status='live' AND type IN ('auction','wheel')");
    for (const l of live) {
      if (l.ends_at && new Date(l.ends_at) <= new Date()) {
        if (l.type === 'wheel') {
          // Time Wheel (free giveaway): entries close when the timer ends and
          // the wheel spins itself. No entries = it just ends, no winner.
          if (!l.wheel_spun) {
            const spun = await spinWheelFor(l);
            if (!spun) await query("UPDATE listings SET status='ended' WHERE id=$1", [l.id]);
          }
          continue;
        }
        const top = await queryOne('SELECT * FROM bids WHERE listing_id=$1 ORDER BY amount DESC, created_at ASC LIMIT 1', [l.id]);
        if (top) await query("UPDATE listings SET status='ended', winner=$1, winner_user_id=$2, payment_status='awaiting_payment', escrow_status='not_started', escrow_amount=0 WHERE id=$3", [top.bidder, top.bidder_user_id || null, l.id]);
        else await query("UPDATE listings SET status='ended' WHERE id=$1", [l.id]);
      }
    }
    const drops = await query("SELECT * FROM drops WHERE status='open' AND ends_at <= $1", [nowISO()]);
    for (const d of drops) {
      const entries = await query('SELECT * FROM drop_entries WHERE drop_id=$1', [d.id]);
      const winner = entries.length ? entries[Math.floor(Math.random() * entries.length)].name : null;
      await query('UPDATE drops SET status=$1, winner=$2 WHERE id=$3', [winner ? 'drawn' : 'closed', winner, d.id]);
    }
    // Auto-release escrow (Kevin, 2026-11-19): once a minute, release
    // any delivered sale whose payout date has passed with no open
    // refund — the same checks as the manual release button. Without
    // this a seller who never taps the button never gets paid.
    if (Date.now() - _lastAutoRelease > 60000) {
      _lastAutoRelease = Date.now();
      const due = await query("SELECT * FROM listings WHERE escrow_status IN ('held_waiting_delivery','held_refund_window') AND delivered_at IS NOT NULL");
      for (const l of due) await tryReleaseEscrow(l);
    }
    // Watching count: drop room-presence rows nobody has refreshed in
    // 5 minutes, so a closed tab stops counting without a goodbye.
    if (Date.now() - _lastPresenceCleanup > 60000) {
      _lastPresenceCleanup = Date.now();
      await runQuery('DELETE FROM room_presence WHERE last_seen < $1', [new Date(Date.now() - 5 * 60000).toISOString()]);
    }
    // Saved-show alert (Kevin, 2026-11-20): when a show someone saved
    // starts, email everyone who saved it. Once a minute, look for shows
    // whose start time just passed (within the last 10 minutes) that
    // have not been alerted yet. show_alerts makes sure each show is
    // emailed once. The email only sends once a Resend key is set — until
    // then it is manual mode, like the winner email.
    if (Date.now() - _lastShowAlert > 60000) {
      _lastShowAlert = Date.now();
      const now = new Date();
      const due = await query("SELECT * FROM shows WHERE starts_at <= $1 AND starts_at >= $2", [now.toISOString(), new Date(now.getTime() - 10 * 60000).toISOString()]);
      for (const s of due) {
        const already = await queryOne('SELECT * FROM show_alerts WHERE show_id=$1', [s.id]);
        if (already) continue;
        const savers = await query('SELECT u.email FROM saved_shows ss JOIN users u ON u.id=ss.user_id WHERE ss.show_id=$1', [s.id]);
        for (const sv of savers) {
          if (sv.email) await _sendAccountEmail(sv.email, 'Your saved show is starting — Bring Time Back and More', 'Hi,\n\nYour saved show "' + s.title + '" by ' + s.seller + ' is starting now.\n\nJoin it here: https://bringtimebackandmore.com\n\nBring Time Back and More');
        }
        await query('INSERT INTO show_alerts(show_id,alerted_at) VALUES($1,$2)', [s.id, nowISO()]);
      }
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
    if (l.status !== 'live' && l.status !== 'queued') { out.push(l); continue; }
    if (!(l.seller in cache)) cache[l.seller] = await sellerStatus(l.seller);
    if (cache[l.seller].canSell) out.push(l);
  }
  return out;
}
async function attachWheelCounts(rows) {
  if (!rows.length) return rows;
  const counts = await query('SELECT listing_id, COUNT(*) AS n FROM wheel_entries GROUP BY listing_id');
  const map = {};
  for (const c of counts) map[c.listing_id] = Number(c.n);
  return rows.map(l => ({ ...l, wheel_count: map[l.id] || 0 }));
}
// ---------- Live Now stays up while the seller is still live (Kevin, 2026-11-19) ----------
// The show never ends until the seller ends it: an item's timer ending only
// ends that item, not the show. So a room stays in Live Now while the seller
// is still there — checked by their 15-second presence check-in, not by the
// listing still being open. If they close the page, the check-in goes stale
// within a minute and the room drops out on its own.
async function sellerPresent(l) {
  const since = new Date(Date.now() - 60000).toISOString();
  const row = await queryOne('SELECT 1 AS x FROM room_presence WHERE listing_id=$1 AND last_seen>=$2 AND (user_id=$3 OR name=$4) LIMIT 1',
    [l.id, since, l.seller_user_id || '', l.seller]);
  return !!row;
}
async function attachSellerPresence(rows) {
  const out = [];
  for (const l of rows) {
    out.push(l.seller_live ? { ...l, seller_present: (await sellerPresent(l)) ? 1 : 0 } : l);
  }
  return out;
}
app.get('/api/overview', async (req, res) => {
  const settings = await getSettings();
  const listings = await attachSellerPhotos(await attachSellerPresence(await attachWheelCounts(await hideSuspended(await query('SELECT * FROM listings ORDER BY created_at DESC')))));
  const founding = await foundingStatus();
  const liveNow = listings.filter(l => l.seller_live && l.seller_present);
  res.json({ name: 'Bring Time Back and More', prelaunch: !!settings.prelaunch, founding, taxPercent: settings.tax_percent, liveNowCount: liveNow.length, listings: listings.map(l => _stripWinnerAddress(l, req, null)), categories: CATEGORIES });
});
// My profile (Kevin, 2026-11-20): what I bought and what I sold, each
// with its stage — processing, sent, delivered, finalized. Signed in only;
// a buyer never sees another buyer's purchases.
app.get('/api/my-activity', async (req, res) => {
  const u = await _userFromSession(req);
  if (!u) return res.status(401).json({ ok: false, error: 'not signed in' });
  const bought = await query("SELECT * FROM listings WHERE (winner_user_id=$1 OR winner=$2) AND status='sold' ORDER BY created_at DESC", [u.id, u.name]);
  const sold = await query("SELECT * FROM listings WHERE seller=$1 AND status='sold' ORDER BY created_at DESC", [u.name]);
  // Which of these sold items have been rated (a Scorecard review left for
  // the sale) — so the profile can show the Rated step in the process.
  // (Kevin, 2026-11-20: the inbox shows Won → Shipped → Tracking → Rated → Final.)
  const _ids = [...bought, ...sold].map(x => x.id);
  const _rated = new Set();
  if (_ids.length) {
    const _ph = _ids.map((_, i) => '$' + (i + 1)).join(',');
    const _rv = await query('SELECT listing_id FROM reviews WHERE listing_id IN (' + _ph + ')', _ids);
    _rv.forEach(x => _rated.add(x.listing_id));
  }
  const stageOf = (l) => {
    if (l.escrow_status === 'released') return 'finalized';
    if (l.escrow_status === 'refunded') return 'refunded';
    if (l.payment_status === 'free' && l.delivered) return 'finalized';
    if (l.delivered) return 'delivered';
    if (l.shipped_at) return 'sent';
    return 'processing';
  };
  const clean = (l) => ({
    id: l.id, title: l.title, type: l.type,
    price: l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0),
    shipping: l.shipping || 0,
    seller: l.seller, winner: l.winner,
    stage: stageOf(l), tracking: l.tracking || '', carrier: l.carrier || '',
    delivered: !!l.delivered, shipped: !!l.shipped_at, rated: _rated.has(l.id),
    created_at: l.created_at, image_url: l.image_url || ''
  });
  res.json({ ok: true, bought: bought.map(clean), sold: sold.map(clean) });
});
// Profile picture next to a seller's name (Kevin, 2026-11-20): look up
// each listing's seller in users by name and attach their photo as
// seller_photo, so cards and the item page can show it. One query for
// all the sellers in the list, not one per listing.
async function attachSellerPhotos(rows) {
  if (!rows || !rows.length) return rows;
  const sellers = [...new Set(rows.map(l => l.seller).filter(Boolean))];
  if (!sellers.length) return rows;
  const placeholders = sellers.map((_, i) => '$' + (i + 1)).join(',');
  const photoRows = await query('SELECT name, photo FROM users WHERE name IN (' + placeholders + ')', sellers);
  const byName = {};
  for (const r of photoRows) byName[r.name] = r.photo || '';
  return rows.map(l => ({ ...l, seller_photo: byName[l.seller] || '' }));
}
app.get('/api/listings', async (req, res) => {
  let rows = await query('SELECT * FROM listings ORDER BY created_at DESC');
  if (req.query.type) rows = rows.filter(l => l.type === req.query.type);
  if (req.query.category && req.query.category !== 'All') rows = rows.filter(l => l.category === req.query.category);
  if (req.query.status) rows = rows.filter(l => l.status === req.query.status);
  rows = await hideSuspended(rows);
  res.json((await attachSellerPhotos(await attachWheelCounts(rows))).map(l => _stripWinnerAddress(l, req, null)));
});
app.get('/api/listings/:id', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.status(404).json({ ok: false, error: 'not found' });
  const bids = await query('SELECT * FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const reviews = await query('SELECT * FROM reviews WHERE listing_id=$1 ORDER BY created_at DESC', [l.id]);
  const receipt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  const qr = await qrForListing(l);
  const wheelEntries = l.type === 'wheel' ? await wheelEntriesFor(l.id) : [];
  const payout = await payoutFor(l);
  const refundRow = await queryOne('SELECT * FROM refunds WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1', [l.id]);
  const refund = withReturnDates(refundRow);
  const _viewer = await _userFromSession(req);
  const _entered = _viewer && l.type === 'wheel' ? !!(await queryOne('SELECT * FROM wheel_entries WHERE listing_id=$1 AND user_id=$2', [l.id, _viewer.id])) : false;
  const watching = await watchingCount(l);
  const _withPhoto = (await attachSellerPhotos([l]))[0] || l;
  res.json({ ..._stripWinnerAddress(_withPhoto, req, _viewer), refund: refund || null, carrier: l.carrier || carrierFor(l.package_size), bids, chats, reviews, receipt, wheel_entries: wheelEntries.map(e => ({ name: e.name })), wheel_count: wheelEntries.length, wheel_entered: _entered, watching, qr_text: qr ? qr.qrText : null, qr_receipt: qr ? qr.receiptNo : null, qr_tracking: qr ? qr.tracking : null, qr_carrier: qr ? qr.carrier : null, package_label: shipLabel(l.package_size), payout });
});
// QR code for one won/sold item (after payment validates). Not a real postage label.
app.get('/api/listings/:id/qr', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const qr = await qrForListing(l);
  if (!qr) return res.json({ ok: false, error: 'no QR code yet — the item has not been won and paid for' });
  const _qrViewer = await _userFromSession(req);
  res.json({ ok: true, listingId: l.id, title: l.title, seller: l.seller, winner: l.winner, winnerAddress: _canSeeWinnerAddress(req, l, _qrViewer) ? (l.winner_address || '') : undefined, isRandom: !!l.is_random, revealedItem: l.revealed_item || null, itemToShip: l.revealed_item || l.title, packageSize: l.package_size || '', packageLabel: shipLabel(l.package_size), shipping: l.shipping, carrier: qr.carrier, tracking: qr.tracking, receiptNo: qr.receiptNo, qrText: qr.qrText, note: 'Shipment record / scan-to-identify code — not real ' + qr.carrier + ' postage yet. Scan it to open this exact sale, then tap Mark as shipped.' });
});
// ---------- Random Items (numbered, no picture needed) ----------
// A seller who does not want to put a picture up can auction numbered random
// items — Random Item 1, Random Item 2, Random Item 3, up to however many they
// want (1–100). Each is a normal auction with no photo; the seller holds the
// item up live on camera, and what the winner gets is what was shown live.
// The seller then types the actual item ("What they won") on the sold item
// page — that revealed item is saved on the listing and shown on the winner
// receipt, the video receipt record and the ship-QR section.
async function insertListing(b, title, description, type, wheelItems, shipAmt, sizePrice, auth, timer, isRandom, cond) {
  const created = new Date();
  const id = uid();
  // Listing photo (2026-11-19 fix): only an uploaded data:image or a plain
  // https link is stored. A bad photo link is refused, never rendered raw.
  const _img = isRandom ? '' : (typeof b.imageUrl === 'string' ? b.imageUrl : '');
  const img = _safeImageUrl(_img);
  const imgSafe = img === null ? '' : img;
  // No cancellation / no refund for change of mind (Kevin, 2026-11-19):
  // the seller can mark a listing that way when they list it. It is stored
  // per listing and shown before anyone bids. Legit reasons still get a
  // refund — this flag never blocks those.
  const noCom = (b.noChangeOfMind || b.no_change_of_mind) ? 1 : 0;
  // Start-auction flow (Kevin, 2026-11-20): an auction or wheel listing is
  // created QUEUED — its timer does NOT start on listing. The seller taps
  // "Start auction" in the room to start one item's timer; when it ends
  // they start the next one. Only the started item has a running timer, so
  // there is one timer per item, not several running at once. A Store
  // (buy_now) item has no timer and is live to buy right away.
  const startStatus = type === 'buy_now' ? 'live' : 'queued';
  await query(`INSERT INTO listings(id,seller,title,description,category,type,start_price,current_bid,fixed_price,shipping,shipping_insured,carrier,authenticity,condition,timer_seconds,mode,status,created_at,ends_at,image_url,package_size,is_random,seller_user_id,no_change_of_mind)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [id, b.seller, title, description || '', b.category || 'Other', type, Number(b.startPrice || 0), Number(b.startPrice || 0), (type === 'buy_now' && b.fixedPrice) ? Number(b.fixedPrice) : null, shipAmt, b.shippingInsured ? 1 : 0, carrierFor(sizePrice !== null ? b.packageSize : ''), auth, cond, timer, b.mode || 'Regular', startStatus, created.toISOString(), null, imgSafe, sizePrice !== null ? b.packageSize : '', isRandom ? 1 : 0, b.sellerUserId || null, noCom]);
  return id;
}
app.post('/api/listings', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (u.role === 'buyer') return res.json({ ok: false, error: 'your account is a buyer account — go to My Profile and tap "I want to sell too", then you can list' });
  const b = req.body || {};
  // The seller is the signed-in account — a seller name typed in the form is ignored.
  b.seller = u.name; b.sellerUserId = u.id;
  const isRandom = !!(b.isRandom || b.random || b.randomCount);
  if (!isRandom) {
    const _iv = _safeImageUrl(b.imageUrl || '');
    if (_iv === null) return res.json({ ok: false, error: 'photo link must be an uploaded image or a https link — that photo was not saved' });
    b.imageUrl = _iv;
  }
  // INCORRECT-CLAIM LADDER (Kevin, 2026-11-18): 1st incorrect return claim
  // = selling privileges suspended for 7 days, 2nd = 30 days, 3rd = selling
  // privileges removed for good. While suspended the seller cannot list.
  const st = await sellerStatus(b.seller);
  if (st.banned) return res.json({ ok: false, error: 'this seller cannot sell on the site again — selling privileges were removed after a third incorrect return claim' });
  if (!st.canSell) return res.json({ ok: false, error: 'selling is suspended for this seller until ' + st.suspendedUntil + ' — selling privileges suspended after an incorrect return claim that was not upheld after review' });
  if (!isRandom && !b.title) return res.json({ ok: false, error: 'seller and title are required' });
  // Rules agreement is at sign-up now (Kevin, 2026-11-20), not every
  // time someone lists — the old per-listing check is gone.
  // No advertising another auction site / marketplace in a listing.
  if (adHit((b.title || '') + ' ' + (b.description || '') + ' ' + (b.randomBase || ''))) return res.json({ ok: false, error: AD_ERROR });
  // Shipping is set by package size; a plain $ amount is still accepted for
  // backwards compatibility (older clients / API callers without a size).
  const sizePrice = shipPrice(b.packageSize);
  const shipAmt = sizePrice !== null ? sizePrice : Number(b.shipping);
  if (!shipAmt && shipAmt !== 0) return res.json({ ok: false, error: 'pick a package size — buyers pay shipping by size' });
  if (!b.shippingInsured) return res.json({ ok: false, error: 'insured shipping is required' });
  const auth = b.authenticity || 'Authentic';
  // Condition (Kevin, 2026-11-18): required on every listing — auctions,
  // Store and Random Items. No valid condition = no listing.
  // Random Items (Kevin, 2026-11-20): the seller does not know what each
  // random item is until they hold it up live, so they may pick "Say it live
  // in chat" instead of a condition — they say the condition in the chat
  // when they show the item live, and the chat is saved in the video
  // receipt. That option is only for Random Items, never for a regular
  // auction or a Store item.
  const CONDITIONS = ['New', 'Used – Working', 'Used – Working Project', 'Used – Not Working / Project / For Parts'];
  const cond = b.condition;
  const condOk = CONDITIONS.includes(cond) || (isRandom && cond === 'Say it live in chat');
  if (!condOk) return res.json({ ok: false, error: 'pick a condition — New, Used – Working, Used – Working Project, or Used – Not Working / Project / For Parts' + (isRandom ? ' — or "Say it live in chat" for Random Items' : '') });
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
      const id = await insertListing(b, title, desc, 'auction', [], shipAmt, sizePrice, auth, timer, true, cond);
      ids.push(id); titles.push(title);
    }
    const _st = await ensureSellerToken(b.seller, b.sellerUserId);
    return res.json({ ok: true, ids, titles, count, isRandom: true, ...(_st ? { sellerToken: _st } : {}) });
  }
  const bad = bannedHit(b.title + ' ' + (b.description || ''));
  if (bad) return res.json({ ok: false, error: 'banned item: ' + bad });
  const text = (b.title + ' ' + (b.description || '')).toLowerCase();
  if (auth === 'Replica' && /100% authentic|genuine real|authentic genuine/.test(text)) return res.json({ ok: false, error: 'a replica cannot be claimed as real/authentic' });
  if (auth === 'Authentic' && /replica|not real|fake/.test(text)) return res.json({ ok: false, error: 'an Authentic listing cannot describe itself as a replica' });
  if ((auth === 'Replica' || auth === 'Unbranded') && !/replica|unbranded|no-name|no name|inspired/.test(text)) return res.json({ ok: false, error: 'replica / unbranded items must say so in the title or description' });
  const type = b.type === 'buy_now' ? 'buy_now' : (b.type === 'wheel' ? 'wheel' : 'auction');
  // A Time Wheel is a FREE giveaway — no items to load, no bidding, no price.
  // People enter free and their names go on the wheel. The timer is how long
  // entries stay open. Starting bid is always $0 on a wheel.
  if (type === 'wheel') b.startPrice = 0;
  const id = await insertListing(b, b.title, b.description || '', type, [], shipAmt, sizePrice, auth, timer, false, cond);
  const _st = await ensureSellerToken(b.seller, b.sellerUserId);
  res.json({ ok: true, id, ...(_st ? { sellerToken: _st } : {}) });
});
// Seller records what the winner actually won on a random item — the item
// they held up live on camera. Seller-only, only after the item is won and
// paid for. Shown on the receipt, the video receipt and the ship-QR section.
app.post('/api/listings/:id/reveal', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!l.is_random) return res.json({ ok: false, error: 'this is not a Random Item' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  // Reveal when you show it live (Kevin, 2026-11-20): the seller says what
  // the Random Item is while holding it up on camera — during the auction,
  // not only after the winner pays. The reveal is saved on the listing and
  // shown on the receipt, the video receipt and the ship-QR section.
  const revealed = String(req.body.revealedItem || req.body.revealed || '').trim().slice(0, 120);
  if (!revealed) return res.json({ ok: false, error: 'type what they won — e.g. Invicta Lupah watch' });
  if (adHit(revealed)) return res.json({ ok: false, error: AD_ERROR });
  // The seller can also set the real condition here — Random Items may be
  // listed as "Say it live in chat", and this is where the real condition
  // gets recorded once the item is shown.
  const CONDITIONS = ['New', 'Used – Working', 'Used – Working Project', 'Used – Not Working / Project / For Parts'];
  const newCond = String(req.body.condition || '').trim();
  const condOk = newCond && CONDITIONS.includes(newCond);
  await query('UPDATE listings SET revealed_item=$1, revealed_at=$2' + (condOk ? ', condition=$3' : '') + ' WHERE id=$' + (condOk ? '4' : '3'), condOk ? [revealed, nowISO(), newCond, l.id] : [revealed, nowISO(), l.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `🎲 Revealed live on camera: ${revealed}${l.winner ? ' — that is what ' + l.winner + ' won.' : ' — this is the item up for auction.'}`, nowISO()]);
  res.json({ ok: true, revealedItem: revealed, ...(condOk ? { condition: newCond } : {}), ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// ---------- Bidding ----------
app.post('/api/listings/:id/bid', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (_needsAddress(u)) return res.json({ ok: false, error: ADDRESS_REQUIRED_ERROR });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  // Time Wheel is a FREE giveaway — no bidding. Enter free instead.
  if (l.type === 'wheel') return res.json({ ok: false, error: 'this is a free Time Wheel giveaway — enter free, no bidding' });
  // Sellers cannot bid on their own auctions (2026-11-19 fix): no shill bidding.
  if (_sellerMatches(req, l)) return res.json({ ok: false, error: 'you cannot bid on your own listing' });
  if (l.type !== 'auction' && l.type !== 'wheel') return res.json({ ok: false, error: 'this is a Store listing — Buy Now only, no bidding' });
  if (l.status === 'queued') return res.json({ ok: false, error: 'this auction has not started yet — the seller taps Start auction when they are ready' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'auction is not live' });
  if (l.ends_at && new Date(l.ends_at) <= new Date()) { await sweep(); return res.json({ ok: false, error: 'auction has ended' }); }
  const amount = Number(req.body.amount);
  if (!amount || amount <= l.current_bid) return res.json({ ok: false, error: 'bid must beat the current bid of $' + l.current_bid });
  // The bidder is the signed-in account — a bidder name typed in the form is ignored.
  await query('INSERT INTO bids(id,listing_id,bidder,amount,created_at,bidder_user_id) VALUES($1,$2,$3,$4,$5,$6)', [uid(), l.id, u.name, amount, nowISO(), u.id]);
  let endsAt = l.ends_at;
  if (l.mode === 'Regular' && endsAt) endsAt = new Date(new Date(endsAt).getTime() + 10000).toISOString();
  // Sudden Death: endsAt unchanged.
  await query('UPDATE listings SET current_bid=$1, ends_at=$2 WHERE id=$3', [amount, endsAt, l.id]);
  // My Top Limit: auto-bid the smallest step (2%, min $1) up to a rival's max, never past it.
  let addedSeconds = l.mode === 'Regular' ? 10 : 0;
  for (let i = 0; i < 20; i++) {
    const cur = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
    const limits = await query('SELECT * FROM top_limits WHERE listing_id=$1 AND max_amount > $2 ORDER BY created_at ASC', [l.id, cur.current_bid]);
    const topBidder = await queryOne('SELECT bidder, bidder_user_id FROM bids WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 1', [l.id]);
    const _isTop = x => x.buyer_user_id ? (topBidder && topBidder.bidder_user_id ? x.buyer_user_id === topBidder.bidder_user_id : x.buyer === topBidder.bidder) : x.buyer === (topBidder && topBidder.bidder);
    const _isSeller = x => l.seller_user_id ? x.buyer_user_id === l.seller_user_id : x.buyer === l.seller;
    const other = limits.find(x => !_isTop(x) && !_isSeller(x));
    if (!other) break;
    const step = Math.max(1, Math.round(cur.current_bid * 0.02 * 100) / 100);
    const next = Math.min(other.max_amount, Math.round((cur.current_bid + step) * 100) / 100);
    if (next <= cur.current_bid) break;
    await query('INSERT INTO bids(id,listing_id,bidder,amount,created_at,bidder_user_id) VALUES($1,$2,$3,$4,$5,$6)', [uid(), l.id, other.buyer, next, nowISO(), other.buyer_user_id || null]);
    await query('UPDATE listings SET current_bid=$1 WHERE id=$2', [next, l.id]);
  }
  const updated = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
  res.json({ ok: true, currentBid: updated.current_bid, endsAt: updated.ends_at, addedSeconds, total: updated.current_bid + updated.shipping });
});
// ---------- Store Buy Now / winner payment (SIMULATED test check) ----------
// Winner email (Kevin, 2026-11-20): when someone wins an auction or
// buys from the Store, email them what they won and the shipping. It
// goes to the buyer's account email. It never blocks the sale — if the
// email cannot send, the sale still completes and the receipt stays on
// their profile. With no Resend key set it does not send (manual mode),
// the same as every other email on the site.
async function sendWinnerEmail(l, buyer, winnerUserId, total, receiptNo, carrier, tracking, winnerAddress) {
  try {
    let email = null;
    if (winnerUserId) { const u = await queryOne('SELECT email FROM users WHERE id=$1', [winnerUserId]); if (u) email = u.email; }
    if (!email) { const u = await queryOne('SELECT email FROM users WHERE name=$1', [buyer]); if (u) email = u.email; }
    if (!email) return;
    const item = l.revealed_item || l.wheel_landed_item || l.title;
    const price = l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0);
    const isFree = l.type === 'wheel' && Number(total) === 0;
    const text = 'Hi ' + buyer + ',\n\n' + (isFree ? 'You won a FREE giveaway on Bring Time Back and More — you pay nothing, the seller covers the shipping!\n\nWhat you won: ' + item + '\nSeller: ' + l.seller + '\nShipping: covered by the seller (' + carrier + ', tracking ' + tracking + ')\nTotal paid: $0.00\nReceipt: ' + receiptNo + '\n\nShip to (locked for this win): ' + (winnerAddress || '—') : 'You won on Bring Time Back and More!\n\nWhat you won: ' + item + '\nSeller: ' + l.seller + '\nPrice: $' + Number(price).toFixed(2) + '\nShipping: $' + Number(l.shipping || 0).toFixed(2) + ' (' + carrier + ', tracking ' + tracking + ')\nTotal paid: $' + Number(total).toFixed(2) + '\nReceipt: ' + receiptNo + '\n\nShip to (locked for this sale): ' + (winnerAddress || '—')) + '\n\nThe seller will mark it shipped once it goes out — you can follow it on your profile (My Profile > What I bought) and on the item page. Your receipt and video receipt are there too.\n\nBring Time Back and More';
    await _sendAccountEmail(email, 'You won: ' + item + ' — Bring Time Back and More', text);
  } catch (e) { /* winner email never blocks the sale */ }
}
async function completeSale(l, buyer, method, detail, winnerAddress, winnerUserId) {
  const check = validatePayment(method, detail);
  if (!check.ok) {
    await runQuery("UPDATE listings SET payment_status='declined', payment_reason=$1, escrow_status='not_started', escrow_amount=0 WHERE id=$2 AND status IN ('live','ended')", [check.reason, l.id]);
    return { ok: false, error: 'Payment declined — buyer needs to fix payment', reason: check.reason };
  }
  const total = (l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0)) + (l.shipping || 0);
  const receiptNo = 'BTB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
  // Every paid sale gets a tracking code right away, so its QR code (and Label Pass)
  // identify that exact sale — the seller scans the QR to find this order, not another.
  // Carrier is automatic from package size: USPS, except Big box over 5 lb = UPS.
  const carrier = carrierFor(l.package_size);
  const tracking = l.tracking || makeTracking(carrier);
  // Only the last 4 digits of the payment detail are ever stored (2026-11-19
  // check): the full detail is used for the simulated test check only, then
  // dropped. At go-live Stripe replaces this whole flow.
  // Atomic claim (M3 fix): the UPDATE only succeeds while the listing is
  // still live (Store) or ended (auction winner paying). A second request
  // at the same moment changes 0 rows and gets 'already sold' instead of
  // a second winner, second receipt and second escrow hold.
  const _expected = l.type === 'buy_now' ? 'live' : 'ended';
  const _claimed = await runQuery("UPDATE listings SET status='sold', winner=$1, payment_status='validated', payment_method=$2, payment_last4=$3, payment_reason='', escrow_status='held_waiting_shipment', escrow_amount=$4, tracking=$5, carrier=$6, winner_address=$7, winner_user_id=$8 WHERE id=$9 AND status=$10",
    [buyer, method, String(detail || '').replace(/\D/g, '').slice(-4) || '', total, tracking, carrier, String(winnerAddress || '').slice(0, 500), winnerUserId || null, l.id, _expected]);
  if (!_claimed) return { ok: false, error: 'already sold — someone else completed this sale first' };
  const exLabel = await queryOne('SELECT * FROM labels WHERE listing_id=$1', [l.id]);
  if (!exLabel) await query('INSERT INTO labels(id,listing_id,carrier,tracking,code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, carrier, tracking, 'LBL-' + uid().slice(0, 8).toUpperCase(), nowISO()]);
  const exRcpt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  if (!exRcpt) await query('INSERT INTO receipts(id,listing_id,receipt_no,amount,shipping,total,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, receiptNo, l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0), l.shipping || 0, total, nowISO()]);
  // Email the winner what they won + the shipping (Kevin, 2026-11-20).
  // It never blocks the sale — if email is not set up yet, the receipt
  // on their profile is still there.
  await sendWinnerEmail(l, buyer, winnerUserId, total, receiptNo, carrier, tracking, winnerAddress);
  return { ok: true, total, receiptNo };
}
// Enter the Time Wheel giveaway — FREE. One entry per person, by account.
// Entries are open while the wheel is live and its timer has not run out.
// The person's account name is what goes on the wheel.
app.post('/api/listings/:id/enter', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.type !== 'wheel') return res.json({ ok: false, error: 'not a Time Wheel giveaway' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'entries are closed — this giveaway is over' });
  if (l.ends_at && new Date(l.ends_at) <= new Date()) return res.json({ ok: false, error: 'entries are closed — the timer ran out' });
  if (l.wheel_spun) return res.json({ ok: false, error: 'the wheel has already spun' });
  // You have to be in the room to get in the giveaway (Kevin, 2026-11-19):
  // entry needs a fresh presence check-in for this room — the same 15-second
  // check-in that keeps a room in Live Now. Opening the room starts it, so
  // anyone actually watching can enter; nobody can enter from the main page.
  const _inRoom = await queryOne('SELECT 1 AS x FROM room_presence WHERE listing_id=$1 AND last_seen>=$2 AND (user_id=$3 OR name=$4) LIMIT 1',
    [l.id, new Date(Date.now() - 60000).toISOString(), u.id, u.name]);
  if (!_inRoom) return res.json({ ok: false, error: 'you have to be in the room to get in the giveaway — open the room first, then enter' });
  if (_needsAddress(u)) return res.json({ ok: false, error: ADDRESS_REQUIRED_ERROR });
  const ex = await queryOne('SELECT * FROM wheel_entries WHERE listing_id=$1 AND user_id=$2', [l.id, u.id]);
  if (ex) return res.json({ ok: false, error: 'you are already on the wheel — one entry per person' });
  await query('INSERT INTO wheel_entries(id,listing_id,name,user_id,created_at) VALUES($1,$2,$3,$4,$5)', [uid(), l.id, u.name, u.id, nowISO()]);
  const count = (await query('SELECT COUNT(*) AS n FROM wheel_entries WHERE listing_id=$1', [l.id]))[0];
  res.json({ ok: true, entries: Number(count ? count.n : 1) });
});
// Spin the Time Wheel by hand — seller only. Entries must still be open or
// just closed, and it can only land once: a second spin returns the name it
// already landed on. If the timer runs out first, the sweep spins it.
app.post('/api/listings/:id/spin', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (l.type !== 'wheel') return res.json({ ok: false, error: 'this is not a Time Wheel listing' });
  if (l.wheel_spun && l.wheel_landed_item) return res.json({ ok: true, alreadySpun: true, landedName: l.wheel_landed_item, landedAt: l.wheel_landed_at });
  if (l.status !== 'live' && l.status !== 'ended') return res.json({ ok: false, error: 'this giveaway is over' });
  const u = await requireAuth(req, res); if (!u) return;
  if (!_sellerMatches(req, l)) return res.json({ ok: false, error: 'only the seller can spin the Time Wheel' });
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  const landed = await spinWheelFor(l);
  if (!landed) return res.json({ ok: false, error: 'no names on the wheel yet — nobody has entered' });
  res.json({ ok: true, ...landed, ...(_tok && _tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
app.post('/api/listings/:id/buy-now', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.type !== 'buy_now') return res.json({ ok: false, error: 'not a Store listing' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'already sold' });
  if (_needsAddress(u)) return res.json({ ok: false, error: ADDRESS_REQUIRED_ERROR });
  // Payment comes from the profile (Kevin, 2026-11-20) — the room never asks
  // for it. If the buyer has not set one, they set it in My Profile first.
  if (!u.payment_method || !(u.payment_detail || '').trim()) return res.json({ ok: false, error: 'Set up your payment method in My Profile first — tap My Profile, then Payment method.' });
  const r = await completeSale(l, u.name, u.payment_method, u.payment_detail, u.shipping_address, u.id);
  res.json(r);
});
app.post('/api/listings/:id/pay', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.status !== 'ended') return res.json({ ok: false, error: 'auction has not ended / no winner to pay' });
  if (!_winnerIsUser(u, l)) return res.json({ ok: false, error: 'only the winner can pay for this item' });
  if (_needsAddress(u)) return res.json({ ok: false, error: ADDRESS_REQUIRED_ERROR });
  // Payment comes from the profile (Kevin, 2026-11-20) — the room never asks
  // for it. If the winner has not set one, they set it in My Profile first.
  if (!u.payment_method || !(u.payment_detail || '').trim()) return res.json({ ok: false, error: 'Set up your payment method in My Profile first — tap My Profile, then Payment method.' });
  const r = await completeSale(l, l.winner, u.payment_method, u.payment_detail, u.shipping_address, u.id);
  res.json(r);
});
app.post('/api/listings/:id/notify-fix', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, `Payment fix needed: $${(l.current_bid || 0) + (l.shipping || 0)} is owed for "${l.title}". Please fix your payment and try again.`, nowISO()]);
  res.json({ ok: true });
});
// ---------- Start auction (Kevin, 2026-11-20) ----------
// The seller taps "Start auction" in the room to start one queued item's
// timer. When it ends they start the next one — the room moves to the next
// item on its own, no scrolling. Only one item runs at a time per seller,
// so there is one timer per item. The show itself only ends when the seller
// taps End Live, never when an item ends.
app.post('/api/listings/:id/start', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (l.type !== 'auction' && l.type !== 'wheel') return res.json({ ok: false, error: 'Store items have no timer — they are live to buy right away' });
  if (l.status === 'live') return res.json({ ok: false, error: 'this auction is already running' });
  if (l.status !== 'queued') return res.json({ ok: false, error: 'this auction already ended — use Rerun to run it again' });
  // Start settings (Kevin, 2026-11-20): when the room switches to the next
  // item, the seller sets what to start it at right there — starting bid
  // ($1 or $100 or anything), how long the timer runs, and Regular or
  // Sudden Death — before tapping Start. These override what was set when
  // the item was listed, only for this run. Validated first, so a bad value
  // gets a clear error even when another item is still running.
  let startPrice = Number(l.start_price || l.current_bid || 0);
  let timerSeconds = Number(l.timer_seconds || 30);
  let mode = l.mode || 'Sudden Death';
  if (req.body && req.body.startPrice !== undefined && req.body.startPrice !== '') {
    const p = Number(req.body.startPrice);
    if (!Number.isFinite(p) || p < 0 || p > 1000000) return res.json({ ok: false, error: 'starting bid must be $0 to $1,000,000' });
    startPrice = p;
  }
  if (req.body && req.body.timerSeconds !== undefined && req.body.timerSeconds !== '') {
    const t = Number(req.body.timerSeconds);
    if (!Number.isFinite(t) || t < 5 || t > 3600) return res.json({ ok: false, error: 'timer must be 5 seconds to 60 minutes' });
    timerSeconds = Math.round(t);
  }
  if (req.body && req.body.mode) {
    if (req.body.mode !== 'Regular' && req.body.mode !== 'Sudden Death') return res.json({ ok: false, error: 'pick Regular or Sudden Death' });
    mode = req.body.mode;
  }
  const running = await queryOne("SELECT id FROM listings WHERE seller=$1 AND status='live' AND type IN ('auction','wheel') AND id<>$2 LIMIT 1", [l.seller, l.id]);
  if (running) return res.json({ ok: false, error: 'finish the current item first — only one auction runs at a time' });
  const created = new Date(); const ends = new Date(created.getTime() + timerSeconds * 1000);
  await query('UPDATE listings SET status=$1, created_at=$2, ends_at=$3, start_price=$4, current_bid=$5, timer_seconds=$6, mode=$7 WHERE id=$8', ['live', created.toISOString(), ends.toISOString(), startPrice, startPrice, timerSeconds, mode, l.id]);
  res.json({ ok: true, endsAt: ends.toISOString(), ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// Next queued item for the auto-advance (Kevin, 2026-11-20): when the
// current item ends, the room moves to the seller's next queued item on its
// own — no scrolling. Returns the seller's oldest queued auction/wheel, or
// null when there is no next item.
app.get('/api/listings/:id/next', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const n = await queryOne("SELECT * FROM listings WHERE seller=$1 AND status='queued' AND type IN ('auction','wheel') AND id<>$2 ORDER BY created_at ASC LIMIT 1", [l.seller, l.id]);
  res.json({ ok: true, next: n ? _stripWinnerAddress(n, req, null) : null });
});
app.post('/api/listings/:id/rerun', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (l.payment_status === 'validated') return res.json({ ok: false, error: 'payment went through — cannot rerun' });
  if (l.type !== 'auction' && l.type !== 'wheel') return res.json({ ok: false, error: 'Store items cannot be rerun' });
  if (l.status === 'live') return res.json({ ok: false, error: 'auction is already live' });
  const created = new Date(); const ends = new Date(created.getTime() + (l.timer_seconds || 30) * 1000);
  await query('DELETE FROM bids WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM top_limits WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM wheel_entries WHERE listing_id=$1', [l.id]);
  await query(`UPDATE listings SET status='live', winner=NULL, winner_user_id=NULL, payment_status='none', payment_reason='', escrow_status='not_started', escrow_amount=0,
    current_bid=start_price, created_at=$1, ends_at=$2, delivered=0, delivered_at=NULL, tracking=NULL, shipped_at=NULL, wheel_landed_item='', wheel_landed_at=NULL, wheel_spun=0, revealed_item='', revealed_at=NULL WHERE id=$3`, [created.toISOString(), ends.toISOString(), l.id]);
  res.json({ ok: true, endsAt: ends.toISOString(), ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// ---------- Shipping / escrow release ----------
// Mark as shipped: the seller scans the sale's QR code, lands on this exact
// sold item, and taps this — no more boxing up the wrong order. Only the seller,
// only after payment validated. Keeps the sale's tracking code if one is already set.
app.post('/api/listings/:id/mark-shipped', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (l.status !== 'sold' || (l.payment_status !== 'validated' && l.payment_status !== 'free')) return res.json({ ok: false, error: 'cannot ship until the item is sold' });
  if (l.shipped_at) return res.json({ ok: false, error: 'already marked as shipped' });
  const carrier = l.carrier || carrierFor(l.package_size);
  const tracking = l.tracking || makeTracking(carrier);
  await query('UPDATE listings SET tracking=$1, carrier=$2, shipped_at=$3, escrow_status=$4 WHERE id=$5', [tracking, carrier, nowISO(), 'held_waiting_delivery', l.id]);
  res.json({ ok: true, tracking, carrier, shippedAt: nowISO(), ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
app.post('/api/listings/:id/ship', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l || l.payment_status !== 'validated') return res.json({ ok: false, error: 'cannot ship until payment validates' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  await query('UPDATE listings SET tracking=$1, escrow_status=$2 WHERE id=$3', [req.body.tracking || l.tracking || '', 'held_waiting_delivery', l.id]);
  res.json({ ok: true, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
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
// One ladder: 1 strike = selling suspended 7 days, 2 = 30 days, 3 or more =
// selling privileges removed for good. Used for incorrect return claims AND
// for confirmed bad listings (each ladder is counted separately — a strike
// on one ladder does not count toward the other).
function _ladder(rows) {
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
async function sellerStatus(seller) {
  const claimRows = await query('SELECT * FROM incorrect_claims WHERE seller=$1 ORDER BY created_at ASC', [seller]);
  const badRows = await query('SELECT * FROM bad_listing_strikes WHERE seller=$1 ORDER BY created_at ASC', [seller]);
  const a = _ladder(claimRows), b = _ladder(badRows);
  const banned = a.banned || b.banned;
  // Suspended until the later of the two active suspensions, if either.
  let suspendedUntil = null, suspensionDays = 0;
  for (const x of [a, b]) if (x.suspendedUntil && !x.banned) {
    if (!suspendedUntil || new Date(x.suspendedUntil) > new Date(suspendedUntil)) { suspendedUntil = x.suspendedUntil; suspensionDays = x.suspensionDays; }
  }
  return { strikes: a.strikes, banned, suspendedUntil, suspensionDays, canSell: !banned && a.canSell && b.canSell,
    claimSuspensionDays: a.suspensionDays, badListingStrikes: b.strikes, badListingBanned: b.banned,
    badListingSuspendedUntil: b.suspendedUntil, badListingSuspensionDays: b.suspensionDays };
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
  return { tier, cleanSales: clean, score: score === null ? null : Math.round(score * 10) / 10, scoreCount, nextTier, salesToNext, incorrectClaims, badListingStrikes: status.badListingStrikes, strikes: status.strikes, suspendedUntil: status.suspendedUntil, suspensionDays: status.suspensionDays, banned: status.banned, canSell: status.canSell };
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
  // M2 fix (2026-11-19): a seller cannot mark delivered before shipping —
  // the 48-hour clock and payout date only start from a real delivery.
  if (!l.shipped_at) return res.json({ ok: false, error: 'mark it shipped first — delivery can only be recorded after shipping' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  await query('UPDATE listings SET delivered=1, delivered_at=$1, escrow_status=$2 WHERE id=$3', [nowISO(), 'held_refund_window', l.id]);
  const updated = await queryOne('SELECT * FROM listings WHERE id=$1', [l.id]);
  const payout = await payoutFor(updated);
  res.json({ ok: true, releaseAt: payout.payoutAt, payout, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// Auto-release escrow (Kevin, 2026-11-19): the same checks as the manual
// release-escrow button, shared by the button and the sweep. A sale is
// released only when it was delivered, the payout date (refund window
// close) has passed, and no refund is open. A seller who never taps the
// button still gets paid — without this the money would sit in escrow
// forever if the seller forgets.
async function tryReleaseEscrow(l) {
  if (!l.delivered_at) return { ok: false, error: 'not delivered yet' };
  if (l.escrow_status === 'released') return { ok: false, error: 'already released' };
  if (l.escrow_status === 'refunded') return { ok: false, error: 'a refund was already given on this sale' };
  const payout = await payoutFor(l);
  await autoReleaseReturns();
  const openRefund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [l.id]);
  if (openRefund) await expireRefundIfPast(l, openRefund);
  if (new Date() < new Date(payout.payoutAt)) return { ok: false, error: 'refund window is still open — refunds close on the payout date (' + payout.payoutLabel + ' after delivery). Payout date: ' + payout.payoutAt, payout };
  const refund = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [l.id]);
  if (refund) return { ok: false, error: 'a refund request is pending', payout };
  await query("UPDATE listings SET escrow_status='released' WHERE id=$1", [l.id]);
  return { ok: true, payout };
}
app.post('/api/listings/:id/release-escrow', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  const r = await tryReleaseEscrow(l);
  if (!r.ok) return res.json({ ok: false, error: r.error, payout: r.payout });
  res.json({ ok: true, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});

// ---------- Chat / live ----------
app.get('/api/listings/:id/chat', async (req, res) => res.json(await query('SELECT * FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [req.params.id])));
app.post('/api/listings/:id/chat', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (adHit(req.body.message || '')) return res.json({ ok: false, error: AD_ERROR });
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, u.name, req.body.message || '', u.name === l.seller ? 1 : 0, nowISO()]);
  res.json({ ok: true });
});
// Private messages (Kevin, 2026-11-20): a buyer can message a seller
// about a listing, and only those two ever see it — never the public
// chat, never anyone else. A buyer messages the seller; the seller
// replies to that buyer (send `to` with the buyer's name). Advertising
// other sites is blocked here just like in the public chat.
app.post('/api/listings/:id/message', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const msg = String(req.body.message || '').trim().slice(0, 1000);
  if (!msg) return res.json({ ok: false, error: 'type a message first' });
  if (adHit(msg)) return res.json({ ok: false, error: AD_ERROR });
  const isSeller = u.name === l.seller;
  let to;
  if (isSeller) {
    to = String(req.body.to || '').trim();
    if (!to) return res.json({ ok: false, error: 'pick who to reply to' });
    if (to === u.name) return res.json({ ok: false, error: 'you cannot message yourself' });
  } else {
    to = l.seller;
  }
  await query('INSERT INTO private_messages(id,listing_id,sender,recipient,message,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(), l.id, u.name, to, msg, nowISO()]);
  res.json({ ok: true });
});
app.get('/api/listings/:id/messages', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (u.name === l.seller) return res.json(await query('SELECT * FROM private_messages WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]));
  // NOTE: pass u.name twice as $2 and $3 — do NOT reuse $2. The SQLite
  // fallback replaces every $N with ?, so a reused $2 would leave the
  // second ? unbound and the recipient half would never match.
  return res.json(await query('SELECT * FROM private_messages WHERE listing_id=$1 AND (sender=$2 OR recipient=$3) ORDER BY created_at ASC', [l.id, u.name, u.name]));
});
// My private message threads (for My Profile): one row per listing the
// user has messages on, with the other person and the latest message.
app.get('/api/my-messages', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  // NOTE: pass u.name twice as $1 and $2 — do NOT reuse $1 (see the
  // same note on GET /api/listings/:id/messages).
  const rows = await query('SELECT pm.listing_id, l.title, l.seller, pm.sender, pm.recipient, pm.message, pm.created_at FROM private_messages pm JOIN listings l ON l.id=pm.listing_id WHERE pm.sender=$1 OR pm.recipient=$2 ORDER BY pm.created_at DESC', [u.name, u.name]);
  const threads = {};
  for (const r of rows) {
    const other = r.sender === u.name ? r.recipient : r.sender;
    const k = r.listing_id + '|' + other;
    if (!threads[k]) threads[k] = { listingId: r.listing_id, title: r.title, seller: r.seller, other, lastMessage: r.message, lastAt: r.created_at, count: 0 };
    threads[k].count++;
  }
  res.json({ ok: true, threads: Object.values(threads) });
});
app.post('/api/listings/:id/go-live', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  await query('UPDATE listings SET seller_live=1, seller_live_at=$1 WHERE id=$2', [nowISO(), l.id]);
  // The Time Wheel is the seller's own FREE giveaway — the site has nothing
  // to do with it. When the seller goes live on a wheel listing that is
  // still open, offer it in that room's chat, from the seller, once.
  if (l.type === 'wheel' && l.status === 'live') {
    const already = await queryOne('SELECT id FROM chats WHERE listing_id=$1 AND message LIKE $2', [l.id, '⏰ FREE giveaway —%']);
    if (!already) {
      await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
        [uid(), l.id, l.seller, `⏰ FREE giveaway — ${l.title}! Enter free and your name goes on the Time Wheel. No payment, no bidding. The winner gets this item free.`, nowISO()]);
    }
  }
  res.json({ ok: true, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
app.post('/api/listings/:id/end-live', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  await query('UPDATE listings SET seller_live=0 WHERE id=$1', [req.params.id]);
  res.json({ ok: true, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// ---------- Watching count (Kevin, 2026-11-19) ----------
// The seller sees how many people are in their room right now, in the
// site's own gold + dark navy design — not a copy of any other site.
// Every signed-in person with the room open checks in every 15 seconds;
// anyone not seen for 60 seconds drops off the count, and the seller
// themself is never counted.
app.post('/api/listings/:id/presence', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  await runQuery('DELETE FROM room_presence WHERE listing_id=$1 AND user_id=$2', [l.id, u.id]);
  if (!((req.body || {}).leave)) {
    await query('INSERT INTO room_presence(listing_id,user_id,name,last_seen) VALUES($1,$2,$3,$4)',
      [l.id, u.id, u.name.slice(0, 100), nowISO()]);
  }
  res.json({ ok: true });
});
async function watchingCount(l) {
  const since = new Date(Date.now() - 60000).toISOString();
  const row = await queryOne('SELECT COUNT(*) AS c FROM room_presence WHERE listing_id=$1 AND last_seen>=$2 AND user_id<>$3 AND name<>$4',
    [l.id, since, l.seller_user_id || '', l.seller]);
  return row ? Number(row.c || 0) : 0;
}
// ---------- Live video signalling (WebRTC, peer-to-peer, no paid service) ----------
// Signals carry SDP offers/answers and ICE candidates between the seller and each
// viewer in one auction room. Payloads are opaque JSON strings; nothing is recorded.
app.post('/api/listings/:id/signal', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const b = req.body || {};
  const kind = String(b.kind || '');
  if (!['join', 'offer', 'answer', 'ice', 'leave'].includes(kind)) return res.json({ ok: false, error: 'bad signal kind' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  // The sender is the signed-in account, never a name from the body.
  await query('INSERT INTO live_signals(id,listing_id,sender,recipient,kind,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(), l.id, u.name.slice(0, 100), String(b.recipient || '').slice(0, 100), kind, String(b.payload || '').slice(0, 20000), nowISO()]);
  res.json({ ok: true });
});
app.get('/api/listings/:id/signal', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const since = req.query.since ? String(req.query.since) : '1970-01-01T00:00:00.000Z';
  const rows = await query('SELECT * FROM live_signals WHERE listing_id=$1 AND created_at > $2 ORDER BY created_at ASC', [req.params.id, since]);
  // M1 fix (2026-11-19): a viewer only sees signals to or from themself.
  // The room's seller sees them all. No stranger can watch the room's
  // signalling traffic.
  if (_sellerMatches(req, l)) return res.json(rows);
  res.json(rows.filter(r => r.sender === u.name || r.recipient === u.name));
});
app.post('/api/listings/:id/buy-now-offer', async (req, res) => {
  // Buy It Now offers on auctions are gone (Kevin, 2026-11-20): an auction
  // must run to the end — nobody can buy it outright before the auction is
  // done, because that is not fair to the bidders. A fixed price only
  // lives in the Store — a buyer who wants a fixed price goes to the
  // seller's Store instead.
  return res.json({ ok: false, error: 'Buy It Now offers are not used on auctions — a fixed price only lives in the Store. Visit the seller\'s Store for fixed-price items.' });
});
app.post('/api/listings/:id/accept-offer', async (req, res) => {
  // No Buy It Now offers exist any more (Kevin, 2026-11-20) — see above.
  return res.json({ ok: false, error: 'Buy It Now offers are not used on auctions — a fixed price only lives in the Store.' });
});
// ---------- Keep Track / Free Drops / Top Limit / Scorecard / Coming Up ----------
// ---------- Keep Track — followers and following, both ways (Kevin, 2026-11-19) ----------
// Anyone can keep track of anyone — buyer or seller, either way round. The
// follows table stores it as follower name -> followed name. A seller's
// followers see them marked live in Live Now, so it's easy for a seller to
// let people know they're live.
app.post('/api/follow', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const name = String(req.body.seller || '').trim();
  if (!name) return res.json({ ok: false, error: 'who do you want to keep track of?' });
  if (name === u.name) return res.json({ ok: false, error: 'you cannot keep track of yourself' });
  const target = await queryOne('SELECT * FROM users WHERE name=$1', [name]);
  if (!target) return res.json({ ok: false, error: 'no account with that name' });
  const ex = await queryOne('SELECT * FROM follows WHERE buyer=$1 AND seller=$2', [u.name, name]);
  if (ex) return res.json({ ok: true, message: 'Already keeping track of ' + name });
  await query('INSERT INTO follows(id,buyer,seller,created_at) VALUES($1,$2,$3,$4)', [uid(), u.name, name, nowISO()]);
  res.json({ ok: true, message: 'Now keeping track of ' + name });
});
app.post('/api/unfollow', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const name = String(req.body.seller || '').trim();
  await query('DELETE FROM follows WHERE buyer=$1 AND seller=$2', [u.name, name]);
  res.json({ ok: true, message: 'Stopped keeping track of ' + name });
});
app.get('/api/followers/:name', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const rows = await query('SELECT * FROM follows WHERE seller=$1', [req.params.name]);
  // The count is public — it shows in the room. The names are only for the
  // person being followed (and the owner).
  const mine = _ownerOk(req) || u.name === req.params.name;
  res.json({ ok: true, name: req.params.name, count: rows.length, followers: mine ? rows.map(r => r.buyer) : [] });
});
app.get('/api/following/:buyer', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (!_ownerOk(req) && u.name !== req.params.buyer) return res.status(403).json({ ok: false, error: 'you can only see your own Keep Track list' });
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
  const u = await requireAuth(req, res); if (!u) return;
  if (u.role === 'buyer') return res.json({ ok: false, error: 'sign up as a seller to start a Free Drop — your account is a buyer account' });
  if (adHit(req.body.title || '')) return res.json({ ok: false, error: AD_ERROR });
  const id = uid();
  await query('INSERT INTO drops(id,seller,title,ends_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id, u.name, req.body.title, req.body.endsAt || new Date(Date.now() + 60000).toISOString(), 'open', nowISO()]);
  res.json({ ok: true, id });
});
app.get('/api/drops', async (req, res) => res.json(await query('SELECT * FROM drops ORDER BY created_at DESC')));
app.post('/api/drops/:id/enter', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const d = await queryOne('SELECT * FROM drops WHERE id=$1', [req.params.id]);
  if (!d || d.status !== 'open') return res.json({ ok: false, error: 'drop is closed' });
  const ex = await queryOne('SELECT * FROM drop_entries WHERE drop_id=$1 AND name=$2', [d.id, u.name]);
  if (ex) return res.json({ ok: false, error: 'one entry per person' });
  await query('INSERT INTO drop_entries(id,drop_id,name,created_at) VALUES($1,$2,$3,$4)', [uid(), d.id, u.name, nowISO()]);
  res.json({ ok: true });
});
app.post('/api/top-limit', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (_needsAddress(u)) return res.json({ ok: false, error: ADDRESS_REQUIRED_ERROR });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]);
  if (!l) return res.json({ ok: false, error: 'listing not found' });
  if (l.status !== 'live') return res.json({ ok: false, error: 'this auction is not live any more' });
  if (l.type !== 'auction') return res.json({ ok: false, error: 'My Top Limit is for auctions only' });
  if (_sellerMatches(req, l)) return res.json({ ok: false, error: 'you cannot set a Top Limit on your own listing' });
  const max = Number(req.body.maxAmount);
  if (!max || !isFinite(max) || max <= 0) return res.json({ ok: false, error: 'pick a top limit above $0' });
  if (max <= l.current_bid) return res.json({ ok: false, error: 'your top limit must beat the current bid of $' + l.current_bid });
  await query('DELETE FROM top_limits WHERE listing_id=$1 AND (buyer_user_id=$2 OR (buyer_user_id IS NULL AND buyer=$3))', [l.id, u.id, u.name]);
  await query('INSERT INTO top_limits(id,listing_id,buyer,max_amount,created_at,buyer_user_id) VALUES($1,$2,$3,$4,$5,$6)', [uid(), l.id, u.name, max, nowISO(), u.id]);
  res.json({ ok: true });
});
app.post('/api/reviews', async (req, res) => {
  // listingId comes in the body (the route has no :listingId param) — the old
  // code read req.params.listingId, which is undefined and crashed the server.
  const u = await requireAuth(req, res); if (!u) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]);
  if (!l || !_winnerIsUser(u, l)) return res.json({ ok: false, error: 'only the winner can leave a score' });
  if (adHit(req.body.comment || '')) return res.json({ ok: false, error: AD_ERROR });
  await query('INSERT INTO reviews(id,listing_id,seller,reviewer,stars,comment,created_at,reviewer_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [uid(), l.id, l.seller, u.name, Number(req.body.stars), req.body.comment || '', nowISO(), u.id]);
  res.json({ ok: true });
});
app.get('/api/scorecard/:seller', async (req, res) => {
  const r = await queryOne('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM reviews WHERE seller=$1', [req.params.seller]);
  const rows = await query('SELECT * FROM reviews WHERE seller=$1 ORDER BY created_at DESC', [req.params.seller]);
  res.json({ seller: req.params.seller, average: r && r.avg ? Number(r.avg).toFixed(1) : null, count: Number((r && r.n) || 0), reviews: rows });
});
app.post('/api/shows', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (u.role === 'buyer') return res.json({ ok: false, error: 'sign up as a seller to schedule a show — your account is a buyer account' });
  if (adHit(req.body.title || '')) return res.json({ ok: false, error: AD_ERROR });
  const id = uid();
  await query('INSERT INTO shows(id,seller,title,starts_at,created_at) VALUES($1,$2,$3,$4,$5)', [id, u.name, req.body.title, req.body.startsAt, nowISO()]);
  res.json({ ok: true, id });
});
app.get('/api/coming-up', async (req, res) => res.json(await query('SELECT * FROM shows WHERE starts_at > $1 ORDER BY starts_at ASC', [nowISO()])));
app.post('/api/shows/:id/save', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const s = await queryOne('SELECT * FROM shows WHERE id=$1', [req.params.id]);
  if (!s) return res.json({ ok: false, error: 'no such show' });
  const ex = await queryOne('SELECT * FROM saved_shows WHERE user_id=$1 AND show_id=$2', [u.id, s.id]);
  if (ex) { await query('DELETE FROM saved_shows WHERE user_id=$1 AND show_id=$2', [u.id, s.id]); return res.json({ ok: true, saved: false }); }
  await query('INSERT INTO saved_shows(id,user_id,show_id,created_at) VALUES($1,$2,$3,$4)', [uid(), u.id, s.id, nowISO()]);
  res.json({ ok: true, saved: true });
});
app.get('/api/saved-shows', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const rows = await query('SELECT * FROM saved_shows WHERE user_id=$1 ORDER BY created_at ASC', [u.id]);
  const out = [];
  for (const r of rows) {
    const s = await queryOne('SELECT * FROM shows WHERE id=$1', [r.show_id]);
    if (s && s.starts_at > nowISO()) out.push(s);
  }
  res.json(out);
});
// One Box Deal: biggest shipping once + $2 per extra item, paid once into escrow.
app.post('/api/one-box', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const ids = req.body.listingIds || [];
  const items = [];
  for (const id of ids) { const l = await queryOne('SELECT * FROM listings WHERE id=$1', [id]); if (l) items.push(l); }
  if (!items.length) return res.json({ ok: false, error: 'no items' });
  if (!items.every(l => l.winner === u.name)) return res.json({ ok: false, error: 'One Box is for your own wins only' });
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
  const u = await requireAuth(req, res); if (!u) return;
  if (!req.body.listingId) return res.json({ ok: false, error: 'a listing is required for a label' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]);
  if (!l) return res.json({ ok: false, error: 'listing not found' });
  if (l && !_sellerMatches(req, l)) return res.json({ ok: false, error: 'only the seller can get a label for this sale' });
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
// H1 fix (2026-11-19): the locked shipping address is shown only to the
// winner, the seller of that listing, or the owner — same gate as the
// receipt and QR endpoints. Everyone else gets the receipt without it.
async function receiptFor(l, req) {
  const r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  if (!r) return null;
  const _viewer = req ? await _userFromSession(req) : null;
  const landed = l.type === 'wheel' && l.wheel_landed_item ? l.wheel_landed_item : null;
  const revealed = l.is_random && l.revealed_item ? l.revealed_item : null;
  const item = revealed ? revealed + ' (Random Item: ' + l.title + ')' : landed ? landed + ' (from Time Wheel: ' + l.title + ')' : l.title;
  const bids = await query('SELECT bidder, amount, created_at FROM bids WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  const chats = await query('SELECT name, message, is_seller, created_at FROM chats WHERE listing_id=$1 ORDER BY created_at ASC', [l.id]);
  return { receiptNo: r.receipt_no, item, landedItem: landed, isRandom: !!l.is_random, revealedItem: revealed, revealedAt: l.revealed_at || null, winningBid: r.amount, shipping: r.shipping, total: r.total, seller: l.seller, winner: l.winner, winnerAddress: _canSeeWinnerAddress(req || {}, l, _viewer) ? (l.winner_address || '') : undefined, dateWon: r.created_at, paymentStatus: l.payment_status, escrowStatus: l.escrow_status, sellerLive: !!l.seller_live, bidCount: bids.length,
    videoReceipt: { listedTitle: l.title, isRandom: !!l.is_random, revealedItem: revealed, revealedNote: revealed ? 'Revealed live: ' + revealed : 'Random Item — revealed live on camera, seller to confirm what it was', sellerWasLive: !!l.seller_live, bids, chats } };
}
app.get('/api/receipt/:listingId', async (req, res) => {
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  // A receipt is private — only the buyer (winner), the seller, or the
  // owner can see it. Nobody else. The owner sees it for every sale on
  // the site, and for anything they buy themself. (Kevin, 2026-11-20.)
  const _u = await _userFromSession(req);
  const _isSeller = _u && (l.seller_user_id ? _u.id === l.seller_user_id : _u.name === l.seller);
  if (!_ownerOk(req) && !_winnerIsUser(_u, l) && !_isSeller) return res.status(403).json({ ok: false, error: 'only the buyer, the seller or the owner can see the receipt' });
  let r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [req.params.listingId]);
  if (!r) {
    if (l.status !== 'sold') return res.json({ ok: false, error: 'no receipt yet — sale has not completed' });
    // Sold but no receipt row (a free giveaway won before free wins got
    // receipts) — make one from the listing so the receipt still shows.
    const receiptNo = 'BTB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    const amount = l.type === 'buy_now' ? (l.fixed_price || 0) : (l.current_bid || 0);
    const ship = l.payment_status === 'free' ? 0 : (l.shipping || 0);
    await query('INSERT INTO receipts(id,listing_id,receipt_no,amount,shipping,total,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uid(), l.id, receiptNo, amount, ship, amount + ship, nowISO()]);
    r = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
  }
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
  res.json({ ok: true, receiptNo: r.receipt_no, item, landedItem: landed, isRandom: !!l.is_random, revealedItem: revealed, revealedAt: l.revealed_at || null, winningBid: r.amount, shipping: r.shipping, total: r.total, seller: l.seller, winner: l.winner, winnerAddress: _canSeeWinnerAddress(req, l, await _userFromSession(req)) ? (l.winner_address || '') : undefined, dateWon: r.created_at, paymentStatus: l.payment_status, escrowStatus: l.escrow_status, sellerLive: !!l.seller_live, bidCount: bids.length,
    // Video receipt: the live-room record of what was won — item as listed,
    // what was revealed live, full bid history, whether the seller was live,
    // and the room chat.
    videoReceipt: { listedTitle: l.title, isRandom: !!l.is_random, revealedItem: revealed, revealedNote: revealed ? 'Revealed live: ' + revealed : 'Random Item — revealed live on camera, seller to confirm what it was', sellerWasLive: !!l.seller_live, bids, chats } });
});
app.post('/api/refunds', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const b = req.body || {};
  const _reason0 = String(b.reason || '').toLowerCase();
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [b.listingId]);
  if (!l || l.status !== 'sold' || l.payment_status !== 'validated') return res.json({ ok: false, error: 'refunds open only after the item is sold and paid for' });
  if (!_winnerIsUser(u, l)) return res.json({ ok: false, error: 'only the winner can ask for a refund on this sale' });
  // "Never arrived" (2026-11-19 fix): a buyer who never received the item
  // cannot photo it, and the old delivered_at gate made this reason
  // impossible to file. It opens 7 days after the item was shipped with no
  // delivery, or 7 days after the sale if it was never shipped at all. No
  // photo or video is required for this reason — the owner reviews it (see
  // the owner dashboard stuck-sales section and owner-decide below).
  if (_reason0 === 'never arrived') {
    if (l.escrow_status === 'released') return res.json({ ok: false, error: 'the refund window has closed — the seller has already been paid out' });
    const _rcpt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
    const _saleAt = _rcpt && _rcpt.created_at ? new Date(_rcpt.created_at).getTime() : (l.created_at ? new Date(l.created_at).getTime() : null);
    const _sevenDays = 7 * 24 * 3600 * 1000;
    if (l.shipped_at) {
      if (l.delivered_at) return res.json({ ok: false, error: 'this item was marked delivered — use a different legit reason if it arrived damaged or wrong' });
      if (!_saleAt || Date.now() - new Date(l.shipped_at).getTime() < _sevenDays) return res.json({ ok: false, error: 'a never-arrived refund opens 7 days after the item was shipped with no delivery yet' });
    } else if (!_saleAt || Date.now() - _saleAt < _sevenDays) {
      return res.json({ ok: false, error: 'a never-arrived refund opens 7 days after the sale if the item was never shipped' });
    }
    const _openNA = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [b.listingId]);
    if (_openNA) return res.json({ ok: false, error: 'a refund request is already open for this sale — the seller is deciding' });
    try {
      await query('INSERT INTO refunds(id,listing_id,requester,reason,photo_name,video_name,status,created_at,requester_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [uid(), b.listingId, u.name, b.reason, '', '', 'pending', nowISO(), u.id]);
    } catch (e) { return res.json({ ok: false, error: 'a refund request is already open for this sale — the seller is deciding' }); }
    await query("UPDATE listings SET escrow_status='held_refund_pending' WHERE id=$1", [b.listingId]);
    return res.json({ ok: true, neverArrived: true, message: 'Never-arrived refund filed — the owner will review it. No photo or video is needed because you never received the item.' });
  }
  if (!b.photoName) return res.json({ ok: false, error: 'a photo of the item is required' });
  if (!b.videoName) return res.json({ ok: false, error: 'a video of the item is required' });
  if (!l.delivered_at) return res.json({ ok: false, error: 'refunds open only after delivery' });
  // Refund window runs until the seller's payout date for this sale — the
  // same rule as the old 12-hour rule, applied to the longer hold. After the
  // payout date (money released to the seller) there is no refund.
  const payout = await payoutFor(l);
  if (l.escrow_status === 'released' || (payout.payoutAt && new Date() >= new Date(payout.payoutAt))) return res.json({ ok: false, error: 'the refund window has closed — refunds close on the payout date (' + payout.payoutLabel + ' after delivery, ' + (payout.payoutAt || 'not set yet') + '), and no refund is possible after the seller is paid out', payout });
  // No refund for change of mind — on every listing, and doubly so on a
  // listing the seller marked no cancellation / no refund for change of
  // mind. The form only offers legit reasons, and this is the server-side
  // backstop: any change-of-mind or cancellation reason is refused here.
  // Legit reasons still work exactly as before, flag or no flag.
  const _reason = String(b.reason || '').toLowerCase();
  if (_reason.includes('change') || _reason.includes('mind') || _reason.includes('cancel')) return res.json({ ok: false, error: 'no refund for change of mind — "changed my mind" is not accepted' + (l && Number(l.no_change_of_mind) ? ' — this sale is no cancellation for change of mind, and you bid knowing that' : '') + '. A refund is only for a legit reason (not as described, damaged, wrong item, defective, never arrived)' });
  if (!['not as described', 'damaged in transit', 'wrong item', 'defective', 'never arrived'].includes(_reason)) return res.json({ ok: false, error: 'a legit reason is required — "changed my mind" is not accepted' });
  const open = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND status IN ('pending','awaiting_return','disputed')", [b.listingId]);
  if (open) return res.json({ ok: false, error: 'a refund request is already open for this sale — the seller is deciding' });
  try {
    await query('INSERT INTO refunds(id,listing_id,requester,reason,photo_name,video_name,status,created_at,requester_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uid(), b.listingId, u.name, b.reason, b.photoName, b.videoName, 'pending', nowISO(), u.id]);
  } catch (e) { return res.json({ ok: false, error: 'a refund request is already open for this sale — the seller is deciding' }); }
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
  res.json({ ...fresh, receipt: l ? await receiptFor(l, req) : null });
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
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (rf.status !== 'pending') return res.json({ ok: false, error: 'this refund has already been decided' });
  if (rf.reason === 'never arrived' && String(req.body.choice || '') === 'want_back') return res.json({ ok: false, error: 'the buyer never received the item — there is nothing to send back. Refund without the item back, or let the owner review it.' });
  await expireRefundIfPast(l, rf);
  const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
  if (fresh.status === 'expired') return res.json({ ok: false, error: 'the refund window has closed — this refund request has expired' });
  const choice = String(req.body.choice || '');
  if (choice === 'no_return') {
    await query("UPDATE refunds SET return_choice='no_return', decided_at=$1, status='approved' WHERE id=$2", [nowISO(), rf.id]);
    await query("UPDATE listings SET escrow_status='refunded' WHERE id=$1", [l.id]);
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Seller agreed to the refund without the item back — the refund is released from the seller\'s escrow money. The buyer keeps the item.', nowISO()]);
    return res.json({ ok: true, choice: 'no_return', status: 'approved', ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
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
    return res.json({ ok: true, choice: 'want_back', status: 'awaiting_return', carrier, tracking, code, returnCost: cost, ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
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
  const u = await requireAuth(req, res); if (!u) return;
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  if (!_requesterIsUser(u, rf)) return res.json({ ok: false, error: 'only the buyer who asked for this refund can mark the return shipped' });
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
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the buyer has not shipped the item back yet' });
  await releaseRefund(rf, l, 'seller_confirmed');
  res.json({ ok: true, status: 'approved', ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
});
// Return scanned as DELIVERED — 48-HOUR RULE (Kevin, 2026-11-18): recording
// delivery only STARTS the 48-hour clock. It does NOT release the refund.
// The refund releases only when the seller confirms receipt, the owner
// rules a dispute in the buyer's favour, or the sweep auto-releases it 48
// hours AFTER DELIVERY with no seller response. TEST MODE: no live carrier
// feed is connected yet, so delivery is recorded from this tracking /
// mark-as-delivered step; at go-live a real carrier delivery scan does this
// automatically. H2 fix (2026-11-19): only the buyer who asked for the
// refund, or the owner, may record a delivery — anyone else is refused.
app.post('/api/refunds/:id/return-delivered', async (req, res) => {
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (!_ownerOk(req)) {
    const u = await requireAuth(req, res); if (!u) return;
    if (!_requesterIsUser(u, rf)) return res.json({ ok: false, error: 'only the buyer who asked for this refund, or the owner, can mark the return delivered' });
  }
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the return has not been shipped back yet' });
  if (rf.return_delivered_at) return res.json({ ok: false, error: 'this return was already marked delivered' });
  const tracking = String(req.body.tracking || rf.return_tracking || rf.return_label_tracking || '').trim().slice(0, 100);
  await query('UPDATE refunds SET return_tracking=$1, return_delivered_at=$2 WHERE id=$3', [tracking, nowISO(), rf.id]);
  const fresh = await queryOne('SELECT * FROM refunds WHERE id=$1', [rf.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,0,$5)',
    [uid(), l.id, rf.requester || 'Buyer', 'Return scanned as DELIVERED (tracking ' + tracking + ') — the refund releases 48 hours after delivery if the seller does not confirm receipt first.', nowISO()]);
  res.json({ ok: true, status: 'awaiting_return', tracking, deliveredAt: fresh.return_delivered_at, returnAutoReleaseAt: returnAutoReleaseAt(fresh), message: 'Return marked as delivered — the refund releases 48 hours after delivery if the seller does not confirm receipt first.' });
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
  if (!await requireSellerFor(req, res, l)) return;
  const _tok = await checkSellerToken(req, res, l.seller); if (!_tok) return;
  if (rf.status !== 'awaiting_return') return res.json({ ok: false, error: 'this refund is not waiting for the item back' });
  if (!rf.return_shipped_at) return res.json({ ok: false, error: 'the buyer has not shipped the item back yet' });
  if (rf.return_delivered_at && Date.now() - new Date(rf.return_delivered_at).getTime() > 48 * 3600 * 1000) return res.json({ ok: false, error: 'the 48-hour window to flag a wrong item has passed — flags must come within 48 hours of the return being delivered' });
  if (!req.body.photoName) return res.json({ ok: false, error: 'a photo of what actually arrived is required — the flag is refused without both a photo and a video' });
  if (!req.body.videoName) return res.json({ ok: false, error: 'a video of what actually arrived is required — the flag is refused without both a photo and a video' });
  await query("UPDATE refunds SET status='disputed', dispute_photo_name=$1, dispute_video_name=$2, dispute_at=$3 WHERE id=$4",
    [String(req.body.photoName).slice(0, 200), String(req.body.videoName).slice(0, 200), nowISO(), rf.id]);
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
    [uid(), l.id, l.seller, 'Seller flagged a wrong item sent back — the refund is PAUSED, the 48-hour auto-release is stopped, and the owner will decide. Seller proof of what arrived: photo ' + String(req.body.photoName).slice(0, 200) + ', video ' + String(req.body.videoName).slice(0, 200) + '.', nowISO()]);
  res.json({ ok: true, status: 'disputed', ...(_tok.newToken ? { sellerToken: _tok.newToken } : {}) });
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
  if (!requireOwner(req, res)) return;
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
// Owner decides a never-arrived refund (2026-11-19 fix): the buyer has no
// item to send back, so the seller's want-back path makes no sense and the
// owner reviews it instead. Approve releases the refund at once from the
// seller's escrow money; deny closes it with no refund, so the escrow can
// then be released to the seller on the normal payout path.
app.post('/api/refunds/:id/owner-decide', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const rf = await queryOne('SELECT * FROM refunds WHERE id=$1', [req.params.id]);
  if (!rf) return res.json({ ok: false, error: 'not found' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (rf.reason !== 'never arrived') return res.json({ ok: false, error: 'owner review is for never-arrived refunds only' });
  if (rf.status !== 'pending') return res.json({ ok: false, error: 'this refund has already been decided' });
  const decision = String(req.body.decision || '');
  if (decision === 'approve') {
    await releaseRefund(rf, l, 'owner_never_arrived');
    return res.json({ ok: true, decision: 'approve', status: 'approved' });
  }
  if (decision === 'deny') {
    await query("UPDATE refunds SET status='denied' WHERE id=$1", [rf.id]);
    await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,1,$5)',
      [uid(), l.id, l.seller, 'Owner reviewed the never-arrived claim and did not uphold it — no refund.', nowISO()]);
    return res.json({ ok: true, decision: 'deny', status: 'denied' });
  }
  return res.json({ ok: false, error: 'decision must be approve or deny' });
});
// ---------- Founding / waitlist / dashboard / tax / report ----------
app.post('/api/founding/claim', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  if (u.role === 'buyer') return res.json({ ok: false, error: 'sign up as a seller to claim a founding spot — your account is a buyer account' });
  const f = await foundingStatus();
  if (f.remaining <= 0) return res.json({ ok: false, error: 'founding spots are closed — 10/10 taken' });
  const ex = await queryOne('SELECT * FROM founding WHERE seller_user_id=$1 OR (seller=$2 AND seller_user_id IS NULL)', [u.id, u.name]);
  if (ex) return res.json({ ok: false, error: 'already a founding seller' });
  await query('INSERT INTO founding(id,seller,claimed_at,seller_user_id) VALUES($1,$2,$3,$4)', [uid(), u.name, nowISO(), u.id]);
  const _st = await ensureSellerToken(u.name, u.id);
  res.json({ ok: true, ...(await foundingStatus()), ...(_st ? { sellerToken: _st } : {}) });
});
// ---------- Waitlist, with email confirmation before any welcome ----------
// M7 fix (2026-11-19): no welcome email goes to an unverified address.
// Joining puts them on the list and emails them a CONFIRMATION code first
// (only when a Resend key is set — with no key, no email is sent at all).
// The welcome note is sent only after they confirm, or after the owner
// confirms them. The launch email still covers everyone at launch.
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
  if (existing) {
    if (existing.confirmed) return res.json({ ok: true, alreadyJoined: true, welcomeEmail: 'already', message: "You're already on the list — we'll email you when it goes live." });
    return res.json({ ok: true, alreadyJoined: true, needsConfirmation: true, welcomeEmail: 'confirm', message: "You're already on the list — confirm your email with the code we sent (or ask the owner to confirm it) and your welcome note will follow." });
  }
  const id = uid();
  const confirmToken = crypto.randomBytes(24).toString('hex');
  await query('INSERT INTO waitlist(id,name,email,role,founding,created_at,welcome_email_status,confirmed,confirm_token_hash) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8)',
    [id, name, email, b.role || 'buyer', b.founding ? 1 : 0, nowISO(), 'pending', _hashToken(confirmToken)]);
  // Confirmation first: with a Resend key, email the code. With no key,
  // no email is sent at all — the owner can confirm them from the dashboard.
  if (process.env.RESEND_API_KEY) {
    const sent = await _sendAccountEmail(email, 'Confirm your email — Bring Time Back and More',
      'Hi' + (name ? ' ' + name : '') + ',\n\nThanks for joining the Bring Time Back and More waitlist. Confirm this email address with this code on the site:\n\n' + confirmToken + '\n\nOnce you confirm, we will send your welcome note, and email you again when the site goes live.\n\nIf you did not join the waitlist, ignore this email.\n\nBring Time Back and More');
    if (sent.sent) return res.json({ ok: true, welcomeEmail: 'confirm', needsConfirmation: true, message: "You're on the list! Check your email for a confirmation code, then enter it on the site — your welcome note comes after you confirm." });
    return res.json({ ok: true, welcomeEmail: 'failed', needsConfirmation: true, error: sent.error || 'confirmation email failed', message: "You're on the list — the confirmation email could not be sent. Ask the owner to confirm your email." });
  }
  return res.json({ ok: true, welcomeEmail: 'confirm', needsConfirmation: true, message: "You're on the list — no email key is set yet, so no email was sent. The owner can confirm your email from the dashboard, and your welcome note will follow once email is set up." });
});
// Confirm a waitlist email with the code. The welcome note is sent only now.
app.post('/api/waitlist/confirm', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && (req.body.code || req.body.token)) || '');
  const row = email ? await queryOne('SELECT * FROM waitlist WHERE LOWER(email)=$1', [email]) : null;
  if (!row || !row.confirm_token_hash || _hashToken(code) !== row.confirm_token_hash) return res.json({ ok: false, error: 'that confirmation code is not right' });
  await query('UPDATE waitlist SET confirmed=1 WHERE id=$1', [row.id]);
  const attempt = await sendWelcomeEmail(row.name, row.email);
  if (attempt.sent) {
    await query("UPDATE waitlist SET welcome_email_status='sent', welcome_sent_at=$1 WHERE id=$2", [nowISO(), row.id]);
    return res.json({ ok: true, message: "Email confirmed — welcome note sent! We'll email you when it goes live." });
  }
  if (attempt.mode === 'resend') {
    await query("UPDATE waitlist SET welcome_email_status='failed' WHERE id=$1", [row.id]);
    return res.json({ ok: true, message: 'Email confirmed — the welcome note could not be sent yet, but you are on the list and the launch email will cover you.' });
  }
  return res.json({ ok: true, message: 'Email confirmed — no email key is set yet, so no welcome note was sent. You are on the list and the launch email will cover you.' });
});
// Owner confirms a waitlist email (test mode, when no email key is set).
app.post('/api/waitlist/confirm-owner', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const row = email ? await queryOne('SELECT * FROM waitlist WHERE LOWER(email)=$1', [email]) : null;
  if (!row) return res.json({ ok: false, error: 'no one on the waitlist with that email' });
  await query('UPDATE waitlist SET confirmed=1 WHERE id=$1', [row.id]);
  res.json({ ok: true, message: 'confirmed ' + email });
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
  const confirmedCount = rows.filter(r => r.confirmed).length;
  return { count: emails.length, confirmedCount, emails, subject: LIVE_SUBJECT, body: liveEmailBody(), mailto: emails.length ? liveMailto(emails) : '', resendConfigured: !!process.env.RESEND_API_KEY, sentAt: sent ? sent.sent_at : null, sentMode: sent ? sent.mode : null, sentCount: sent ? sent.recipient_count : null,
    welcomeSent: welcomeSent.length, welcomePending: welcomePending.length, welcomeFailed: welcomeFailed.length,
    welcomePendingEmails: welcomePending.map(r => ({ name: r.name || '', email: r.email })),
    welcomeFailedEmails: welcomeFailed.map(r => ({ name: r.name || '', email: r.email })) };
}
app.get('/api/waitlist/live-notice', async (req, res) => {
  // Without owner auth: count only — NEVER the emails list, mailto link,
  // or the welcome pending/failed email lists.
  if (!OWNER_PASSWORD) return res.status(403).json({ ok: false, error: 'owner password not set' });
  if (!_ownerOk(req)) {
    const p = await getLiveNoticePreview();
    return res.json({ ok: true, count: p.count, welcomeSent: p.welcomeSent, welcomePending: p.welcomePending, welcomeFailed: p.welcomeFailed, resendConfigured: p.resendConfigured, sentAt: p.sentAt, sentMode: p.sentMode, sentCount: p.sentCount });
  }
  res.json({ ok: true, ...(await getLiveNoticePreview()) });
});
app.post('/api/waitlist/live-notice', async (req, res) => {
  if (!requireOwner(req, res)) return;
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
  // L4 fix (2026-11-19): a session OR the owner password is required — a
  // stranger with neither gets nothing. Strike/suspension details are
  // private: only the owner or the seller themself sees them. Everyone
  // else gets the tier, clean sales and score only.
  let u = null;
  if (!_ownerOk(req)) { u = await requireAuth(req, res); if (!u) return; }
  const t = await sellerTier(req.params.seller);
  const mine = _ownerOk(req) || (u && u.name === req.params.seller);
  const pub = { tier: t.tier, cleanSales: t.cleanSales, score: t.score, scoreCount: t.scoreCount, nextTier: t.nextTier, salesToNext: t.salesToNext };
  res.json({ seller: req.params.seller, ...(mine ? t : pub), note: 'Test mode — payout dates are tracked dates, not real bank transfers. No real payment processor is connected yet.' });
});
app.get('/api/dashboard', async (req, res) => {
  if (!requireOwner(req, res)) return;
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
  // ---------- Year to date (owner only, from this dashboard response) ----------
  // Same released-sales basis as totalFeesEarned, same fee formula (5% founding
  // seller, 10% everyone else, on the item price only). Site sales = receipt
  // total (item price + shipping) for each completed sale. The sale date is
  // the receipt created_at (when the sale completed), falling back to the
  // listing created_at if there is no receipt yet.
  const ytdYear = new Date().getFullYear();
  // Year start in Kevin's time (America/New_York, EST in January): Jan 1 00:00 EST = 05:00 UTC, so a Dec 31 evening sale in RI still counts in that year.
  const ytdStart = Date.UTC(ytdYear, 0, 1, 5, 0, 0);
  let ytdFees = 0, ytdSiteSales = 0, ytdSalesCount = 0;
  let allTimeSiteSales = 0, allTimeSalesCount = 0;
  let safeFees = 0, notSafeFees = 0, last30Fees = 0;
  const notSafe = [];
  for (const l of sold) {
    const pct = (await isFounding(l.seller)) ? 5 : 10;
    const fee = Math.round(saleAmount(l) * pct) / 100;
    fees += fee;
    const _rcpt = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [l.id]);
    const _saleTotal = _rcpt ? Number(_rcpt.total || 0) : saleAmount(l) + Number(l.shipping || 0);
    const _saleDate = _rcpt && _rcpt.created_at ? new Date(_rcpt.created_at).getTime() : (l.created_at ? new Date(l.created_at).getTime() : null);
    allTimeSiteSales += _saleTotal; allTimeSalesCount++;
    if (_saleDate !== null && !isNaN(_saleDate) && _saleDate >= ytdStart) { ytdFees += fee; ytdSiteSales += _saleTotal; ytdSalesCount++; }
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
  for (const rf of refunds) { const rl = await queryOne('SELECT * FROM listings WHERE id=$1', [rf.listing_id]); if (rl) { const rp = await payoutFor(rl); rf.refundDeadline = rp.payoutAt; rf.refundLabel = rp.payoutLabel; rf.title = rl.title; rf.seller = rl.seller; rf.returnAutoReleaseAt = returnAutoReleaseAt(rf); rf.receipt = await receiptFor(rl, req); } }
  const escrowHeld = await query("SELECT * FROM listings WHERE escrow_status LIKE 'held%'");
  const held = [];
  for (const l of escrowHeld) { const payout = await payoutFor(l); held.push({ id: l.id, title: l.title, seller: l.seller, winner: l.winner, winnerAddress: l.winner_address || '', amount: l.escrow_amount, saleAmount: saleAmount(l), payout }); }
  // Incorrect return claims, for the owner dashboard: every seller with a
  // claim not upheld after review, with their strike count and when their
  // selling privileges are suspended until (or removed for good).
  const claimRows = await query('SELECT * FROM incorrect_claims ORDER BY created_at ASC');
  const strikeMap = {};
  for (const c of claimRows) { (strikeMap[c.seller] = strikeMap[c.seller] || []).push(c); }
  const incorrectClaimStrikes = [];
  for (const seller of Object.keys(strikeMap)) {
    const st = await sellerStatus(seller);
    incorrectClaimStrikes.push({ seller, strikes: st.strikes, suspendedUntil: st.suspendedUntil, suspensionDays: st.claimSuspensionDays, banned: st.banned, canSell: st.canSell });
  }
  // Confirmed bad listings (Kevin, 2026-11-19): every seller with a
  // listing the owner confirmed fake, stolen or banned, with their strike
  // count — 1st = 7 days suspended, 2nd = 30 days, 3rd = removed for good.
  const badRows = await query('SELECT * FROM bad_listing_strikes ORDER BY created_at ASC');
  const badMap = {};
  for (const c of badRows) { (badMap[c.seller] = badMap[c.seller] || []).push(c); }
  const badListingStrikes = [];
  for (const seller of Object.keys(badMap)) {
    const st = await sellerStatus(seller);
    badListingStrikes.push({ seller, strikes: st.badListingStrikes, suspendedUntil: st.badListingSuspendedUntil, suspensionDays: st.badListingSuspensionDays, banned: st.badListingBanned, canSell: st.canSell });
  }
  // Never-arrived / never-shipped sales (2026-11-19 fix): a sale that was
  // paid for but never delivered, 7+ days after the sale, can no longer sit
  // frozen with no path out — the owner sees it here and can review the
  // buyer's never-arrived refund (or see that none was filed yet).
  const _stuckRows = await query("SELECT * FROM listings WHERE status='sold' AND payment_status='validated' AND (delivered_at IS NULL OR delivered_at='')");
  const stuckSales = [];
  for (const _sl of _stuckRows) {
    const _sr = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [_sl.id]);
    const _sd = _sr && _sr.created_at ? new Date(_sr.created_at).getTime() : (_sl.created_at ? new Date(_sl.created_at).getTime() : null);
    if (_sd === null || isNaN(_sd) || Date.now() - _sd < 7 * 24 * 3600 * 1000) continue;
    const _nr = await queryOne("SELECT * FROM refunds WHERE listing_id=$1 AND reason='never arrived' AND status IN ('pending','awaiting_return','disputed')", [_sl.id]);
    stuckSales.push({ id: _sl.id, title: _sl.title, seller: _sl.seller, winner: _sl.winner, shippedAt: _sl.shipped_at || null, saleDate: new Date(_sd).toISOString(), daysSinceSale: Math.floor((Date.now() - _sd) / (24 * 3600 * 1000)), neverArrivedRefundId: _nr ? _nr.id : null });
  }
  const neverArrivedRefunds = refunds.filter(rf => rf.reason === 'never arrived').map(rf => ({ id: rf.id, listingId: rf.listing_id, title: rf.title, requester: rf.requester, createdAt: rf.created_at, status: rf.status }));
  // Owner inbox (Kevin, 2026-11-21): every sale on the site, all sellers —
  // separate from "What I sold" on My Profile, which is only the items the
  // owner themself sold as a seller. Each row has a Receipt button so the
  // owner can click one to see its receipt.
  const _allSold = await query("SELECT * FROM listings WHERE status='sold' ORDER BY created_at DESC");
  const ownerInbox = [];
  for (const _sl of _allSold) {
    const _sr = await queryOne('SELECT * FROM receipts WHERE listing_id=$1', [_sl.id]);
    const _amt = _sl.type === 'buy_now' ? (_sl.fixed_price || 0) : (_sl.current_bid || 0);
    ownerInbox.push({ id: _sl.id, title: _sl.title, type: _sl.type, seller: _sl.seller, winner: _sl.winner || '', price: _amt, shipping: _sl.shipping || 0, total: _sr ? _sr.total : (_amt + (_sl.shipping || 0)), receiptNo: _sr ? _sr.receipt_no : '', date: _sr ? _sr.created_at : _sl.created_at, escrow: _sl.escrow_status || '', delivered: !!_sl.delivered });
  }
  const ytd = { year: ytdYear, fees: Math.round(ytdFees * 100) / 100, siteSales: Math.round(ytdSiteSales * 100) / 100, salesCount: ytdSalesCount, taxSetAside: Math.round(ytdFees * (settings.tax_percent / 100) * 100) / 100 };  const allTime = { fees: Math.round(fees * 100) / 100, siteSales: Math.round(allTimeSiteSales * 100) / 100, salesCount: allTimeSalesCount };  res.json({ totalFeesEarned: Math.round(fees * 100) / 100, taxPercent: settings.tax_percent, taxSetAside: Math.round(tax * 100) / 100, availableToUse: Math.round((fees - tax) * 100) / 100, unpaidWins: unpaid, refundsPending: refunds, escrowHeld: held, safeDraw, incorrectClaimStrikes, badListingStrikes, stuckSales, neverArrivedRefunds, ownerInbox, ytd, allTime, ytdFees: ytd.fees, ytdSiteSales: ytd.siteSales, ytdSalesCount: ytd.salesCount, ytdTaxSetAside: ytd.taxSetAside, allTimeFees: allTime.fees, allTimeSiteSales: allTime.siteSales, allTimeSalesCount: allTime.salesCount });
});
app.post('/api/settings/tax', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const p = Number(req.body.percent);
  if (!p || p < 0 || p > 100) return res.json({ ok: false, error: 'percent must be 0–100' });
  await query('UPDATE settings SET tax_percent=$1 WHERE id=1', [p]);
  res.json({ ok: true, taxPercent: p });
});
// Owner-only delete (2026-11-19 fix): the owner can remove a chat message
// or a listing that breaks the rules. A sold listing with money still held
// in escrow cannot be deleted — the sale has to be settled first.
app.delete('/api/chats/:id', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const row = await queryOne('SELECT * FROM chats WHERE id=$1', [req.params.id]);
  if (!row) return res.json({ ok: false, error: 'not found' });
  await query('DELETE FROM chats WHERE id=$1', [req.params.id]);
  res.json({ ok: true, message: 'chat message removed' });
});
app.delete('/api/listings/:id', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  if (l.status === 'sold' && l.escrow_status !== 'released' && l.escrow_status !== 'refunded') return res.json({ ok: false, error: 'this sale still has money held — settle the escrow first, then delete' });
  await query('DELETE FROM bids WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM chats WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM top_limits WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM wheel_items WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM wheel_entries WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM listings WHERE id=$1', [l.id]);
  res.json({ ok: true, message: 'listing removed' });
});
// Owner confirms a listing is fake, stolen or a banned item (Kevin,
// 2026-11-19): the listing is removed and it counts as a strike against
// the seller — 1st confirmed bad listing = selling suspended 7 days, 2nd =
// 30 days, 3rd = selling privileges removed for good. A report alone never
// counts — only the owner's confirmation, one strike per listing.
app.post('/api/listings/:id/confirm-bad', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.params.id]);
  if (!l) return res.json({ ok: false, error: 'not found' });
  const reason = String((req.body && req.body.reason) || 'fake, stolen or banned item').trim().slice(0, 200);
  const ex = await queryOne('SELECT * FROM bad_listing_strikes WHERE listing_id=$1', [l.id]);
  if (ex) return res.json({ ok: false, error: 'this listing already counted — one strike per listing' });
  if (l.status === 'sold' && l.escrow_status !== 'released' && l.escrow_status !== 'refunded') return res.json({ ok: false, error: 'this sale still has money held — settle the escrow first, then confirm' });
  await query('INSERT INTO bad_listing_strikes(id,seller,seller_user_id,listing_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)', [uid(), l.seller, l.seller_user_id || '', l.id, reason, nowISO()]);
  await query('DELETE FROM bids WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM chats WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM top_limits WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM wheel_items WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM wheel_entries WHERE listing_id=$1', [l.id]);
  await query('DELETE FROM listings WHERE id=$1', [l.id]);
  const st = await sellerStatus(l.seller);
  res.json({ ok: true, seller: l.seller, badListingStrikes: st.badListingStrikes, banned: st.banned, suspendedUntil: st.suspendedUntil, suspensionDays: st.suspensionDays, canSell: st.canSell });
});
app.post('/api/report', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const reason = String((req.body && req.body.reason) || '').trim().slice(0, 500);
  if (!reason) return res.json({ ok: false, error: 'say what is wrong with this listing' });
  const l = await queryOne('SELECT * FROM listings WHERE id=$1', [req.body.listingId]);
  if (!l) return res.json({ ok: false, error: 'listing not found — reports need a real listing' });
  if (adHit(reason) || bannedHit(reason)) return res.json({ ok: false, error: 'that report cannot be used — no links, advertising or banned items in a report' });
  await query('INSERT INTO chats(id,listing_id,name,message,is_seller,created_at) VALUES($1,$2,$3,$4,0,$5)',
    [uid(), l.id, u.name, 'REPORT: ' + reason, nowISO()]);
  res.json({ ok: true, message: 'report received — the owner will review it' });
});
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Bring Time Back and More', prelaunch: PRELAUNCH, db: isPg ? 'postgres' : 'sqlite-local', time: nowISO() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init().then(() => { app.listen(PORT, () => console.log(`Bring Time Back and More on :${PORT} db=${isPg ? 'postgres' : 'sqlite-local'} prelaunch=${PRELAUNCH}`)); });

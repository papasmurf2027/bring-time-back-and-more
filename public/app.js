function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// For names inside a single-quoted onclick JS string: escape backslash and quote (HTML escaping alone is not enough there).
function escJs(s){return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\"');}
// Profile picture next to a name (Kevin, 2026-11-20): a small round
// picture. Returns nothing when the user has no picture set.
function sellerPhotoImg(photo,size){return photo?`<img src="${escHtml(photo)}" alt="" style="width:${size||28}px;height:${size||28}px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px">`:'';}
// Seller token: issued once by the server when a seller first lists or
// claims a founding spot, kept in localStorage keyed by seller name, and
// sent as x-seller-token on seller-only actions. Owner password: kept in
// sessionStorage only (never in localStorage), sent as x-owner-password.
function sellerTokenFor(name){try{return localStorage.getItem('btb_seller_'+name)||'';}catch(e){return '';}}
function saveSellerToken(name,token){if(name&&token){try{localStorage.setItem('btb_seller_'+name,token);}catch(e){}}}
function sellerHeaders(name){const t=sellerTokenFor(name);return t?{'x-seller-token':t}:{};}
function noteSellerToken(name,r){if(r&&r.sellerToken)saveSellerToken(name,r.sellerToken);}
function ownerPw(){try{return sessionStorage.getItem('btb_owner_pw')||'';}catch(e){return '';}}
function ownerHeaders(){const p=ownerPw();return p?{'x-owner-password':p}:{};}
// ---------- Real accounts (Kevin, 2026-11-19) ----------
// Buyers MUST have an account to bid or buy, sellers MUST have one to
// list. The session token lives in localStorage; it is sent on every
// call to the site (see j() below). The server ignores any name typed
// in a form and uses the signed-in account instead — so nobody can bid,
// buy, list or chat as someone else.
let currentUser=null;
function sessionToken(){try{return localStorage.getItem('btb_session')||'';}catch(e){return '';}}
function sessionHeaders(){const t=sessionToken();return t?{'x-session-token':t}:{};}
function authName(){return currentUser?currentUser.name:'';}
function setSession(user,token){
  currentUser=user||null;
  try{
    if(token)localStorage.setItem('btb_session',token);
    if(user){localStorage.setItem('btb_user',JSON.stringify(user));if(user.email)localStorage.setItem('btb_last_email',user.email);}
    else{localStorage.removeItem('btb_session');localStorage.removeItem('btb_user');}
  }catch(e){}
  renderAuth();
  syncSellerToken();
}
async function syncSellerToken(){
  // Seller accounts: make sure this browser has the seller token for
  // the signed-in seller, so a new device or cleared site data does not
  // lock a seller out of shipping, going live or deciding refunds.
  if(!currentUser||currentUser.role==='buyer')return;
  try{const r=await j('/api/auth/seller-token',{});if(r&&r.sellerToken)saveSellerToken(currentUser.name,r.sellerToken);}catch(e){}
}
function renderAuth(){
  const el=document.getElementById('authStatus');
  // Signed-in state is shown big and clear, not small — Kevin, 2026-11-20:
  // the small "Signed in as" line made it look like you weren't signed in.
  if(el)el.innerHTML=currentUser?('<b>You are signed in as '+escHtml(currentUser.name)+'</b> ('+escHtml(currentUser.role)+')'):'Not signed in — sign up or sign in to bid, buy, list or chat.';
  const pb=document.getElementById('profileBtn'); if(pb)pb.style.display=currentUser?'':'none';
  const apb=document.getElementById('authProfileBtn'); if(apb)apb.style.display=currentUser?'':'none';
  // Email and shipping address save to the profile so they don't have to
  // be filled out every time (Kevin, 2026-11-20). Signed in: both fill in
  // from the profile. Signed out: the email fills in from the last
  // sign-in, so you only type the password to sign back in.
  const ae=document.getElementById('aEmail'); if(ae){if(currentUser)ae.value=currentUser.email;else{try{const le=localStorage.getItem('btb_last_email');if(le&&!ae.value)ae.value=le;}catch(e){}}}
  const ss=document.getElementById('sSeller'); if(ss&&currentUser)ss.value=currentUser.name;
  const ad=document.getElementById('aAddr'); if(ad)ad.value=currentUser?(currentUser.shippingAddress||''):''; 
  // Human check at first sign-up only (Kevin, 2026-11-20): the "I'm a
  // real person" box only shows when you're not signed in. Once you're
  // signed up you never see it again — sign-in never asks for it.
  const hr=document.getElementById('humanCheckRow'); if(hr)hr.style.display=currentUser?'none':'';
  const hc=document.getElementById('aHuman'); if(hc&&!currentUser)hc.checked=false;
  if(!currentUser){const ps=document.getElementById('profileSec'); if(ps)ps.style.display='none';}
}
function loadSession(){try{const u=localStorage.getItem('btb_user');if(u)currentUser=JSON.parse(u);}catch(e){}}
async function authMe(){
  if(!sessionToken()){loadSession();renderAuth();return;}
  const r=await j('/api/auth/me');
  if(r&&r.ok&&r.user){currentUser=r.user;try{localStorage.setItem('btb_user',JSON.stringify(r.user));}catch(e){}}
  else{currentUser=null;try{localStorage.removeItem('btb_session');localStorage.removeItem('btb_user');}catch(e){}}
  renderAuth();
  syncSellerToken();
}
function authMsg(t){const m=document.getElementById('authMsg');if(m)m.textContent=t||'';}
// Role bar at sign-up (Kevin, 2026-11-20): you have to join one — Buy,
// Sell, or Buy and sell — picked from an open bar, not a hidden dropdown.
// The tapped one turns gold. "Buy and sell" is picked to start.
function pickRole(r){const h=document.getElementById('aRole');if(h)h.value=r;document.querySelectorAll('#aRoleBar .tile').forEach(t=>t.classList.toggle('active',t.getAttribute('data-role')===r));}
async function signUp(){
  // Human check at first sign-up only (Kevin, 2026-11-20): a checkbox to
  // show you're a real person. It only shows when you're not signed in —
  // once you're signed up you never see it again, and sign-in never
  // asks for it. If you're already signed in, sign out first to make a
  // new account.
  if(currentUser){authMsg('You are already signed in — sign out first if you want to make a new account.');return;}
  const hc=document.getElementById('aHuman');
  if(!hc||!hc.checked){
    authMsg('Tap the box to show you are a real person, then tap Sign up again.');
    const h=document.getElementById('humanCheckRow'); if(h&&h.scrollIntoView)h.scrollIntoView({block:'nearest'});
    return;
  }
  // Rules agreement at sign-up (Kevin, 2026-11-20): everyone agrees to
  // the Rules once, when they join — buyers and sellers alike. No more
  // agreeing every time someone lists.
  const ag=document.getElementById('aAgree');
  if(!ag||!ag.checked){
    authMsg('Read the Rules and agree to them to join — tap "Read the Rules", then "I agree to the Rules".');
    openRulesModal();
    return;
  }
  // No security question at sign-up (Kevin, 2026-11-20): it only comes
  // up when you forget your password. A signed-in user can set one
  // later with "Change security question" if they want to reset their
  // own password; without one, a forgotten password is owner-reset only.
  const r=await j('/api/auth/signup',{name:document.getElementById('aName').value,email:document.getElementById('aEmail').value,password:document.getElementById('aPass').value,role:document.getElementById('aRole').value,shippingAddress:document.getElementById('aAddr').value,website:document.getElementById('aWebsite')?document.getElementById('aWebsite').value:'',human:true,rulesAgreed:true});
  if(!r.ok){
    authMsg('Error: '+r.error);
    const m=document.getElementById('authMsg'); if(m&&m.scrollIntoView)m.scrollIntoView({block:'nearest'});
    return;
  }
  setSession(r.user,r.sessionToken);authMsg('Signed up — welcome, '+r.user.name+'.');show('profile');
}
async function signIn(){
  const r=await j('/api/auth/login',{email:document.getElementById('aEmail').value,password:document.getElementById('aPass').value});
  if(!r.ok){authMsg('Error: '+r.error);return;}
  setSession(r.user,r.sessionToken);authMsg('Signed in as '+r.user.name+'.');show('profile');
}
async function signOut(){try{await j('/api/auth/logout');}catch(e){}setSession(null);authMsg('Signed out.');const a=document.getElementById('authSec');if(a)a.scrollIntoView({behavior:'smooth',block:'start'});}
async function saveAddress(){if(needSignIn())return;const r=await j('/api/auth/address',{address:document.getElementById('aAddr').value});if(!r.ok){authMsg('Error: '+r.error);return;}if(currentUser)currentUser.shippingAddress=r.shippingAddress;try{localStorage.setItem('btb_user',JSON.stringify(currentUser));}catch(e){}authMsg(r.shippingAddress?('Default shipping address saved — this is your main address now, and it counts for future buys. Items you already won still ship to the address on file when you won them.'):'Default shipping address cleared — add one before you bid or buy.');}
// Switch a buyer account to buy-and-sell (Kevin, 2026-11-20): one tap on
// My Profile, no second account, no waitlist — but it needs a code emailed
// to your account's email first. Ask for the code, type it in, then you
// can sell. Until the site's email is set up, the code shows on screen
// instead (manual mode); once email is set up it only comes by email.
async function switchToSeller(){if(needSignIn())return;const r=await j('/api/auth/role-request',{role:'both'});if(!r.ok){alert('Error: '+(r.error||'could not ask for a switch code'));return;}const code=r.sent?prompt('We emailed a switch code to '+r.email+'. Type it here to switch to Buy and sell:'):prompt('Email is not set up on the site yet, so here is your switch code: '+r.code+'. Type it below to switch to Buy and sell:');if(!code)return;const r2=await j('/api/auth/role-confirm',{code});if(!r2.ok){alert('Error: '+(r2.error||'could not switch'));return;}currentUser=r2.user;try{localStorage.setItem('btb_user',JSON.stringify(currentUser));}catch(e){}renderAuth();loadProfile();alert('You can sell now — your account is Buyer and seller.');}
async function forgotPw(){
  const email=document.getElementById('aEmail').value||prompt('Email for your account?');
  if(!email){authMsg('Type your email first, then tap Forgot password.');return;}
  const r=await j('/api/auth/forgot',{email});
  if(!r.hasQuestion){authMsg(r.message||'If that email has an account, check it for the next step.');return;}
  const answer=prompt('Security question: '+r.question+'\n\nYour answer?');
  if(!answer){authMsg('Answer your security question to get a reset code.');return;}
  const r2=await j('/api/auth/forgot-answer',{email,answer});
  if(!r2.ok){authMsg('Error: '+r2.error);return;}
  authMsg(r2.message||'Answer is right.');
  const resetCode=prompt('Reset code (from your email, or from the owner if no email key is set)?');
  if(!token)return;
  const np=prompt('New password (at least 8 characters)?');
  if(!np)return;
  const r3=await j('/api/auth/reset',{token:resetCode,newPassword:np});
  authMsg(r3.ok?r3.message:('Error: '+r3.error));
}
async function changeSecQ(){
  if(needSignIn())return;
  const cur=prompt('Current password?');
  if(!cur)return;
  const q=prompt('New security question (pick one, or write your own)?\n1. What was the name of your first pet?\n2. What is your mother\'s maiden name?\n3. What town did you grow up in?\n4. Who was your favourite teacher?\n5. What was your first car?\n\nType the question:');
  if(!q)return;
  const a=prompt('Answer to that question? (only you will know it — it is never shown to anyone)');
  if(!a)return;
  const r=await j('/api/auth/security-question',{currentPassword:cur,securityQuestion:q,securityAnswer:a});
  authMsg(r.ok?r.message:('Error: '+r.error));
}
async function signOutEverywhere(){if(needSignIn())return;const r=await j('/api/auth/logout-everywhere',{});setSession(null);authMsg(r.ok?r.message:('Error: '+r.error));}
function needSignIn(){if(!currentUser){alert('Sign in first — buyers and sellers need an account to bid, buy, list or chat.');return true;}return false;}
async function oj(u,o){let r=await j(u,o,ownerHeaders());if(r&&!r.ok&&(r.error==='owner password required'||r.error==='owner password not set')){const p=prompt('Owner password? (the OWNER_PASSWORD you set in Railway — it stays on this device only)');if(p){try{sessionStorage.setItem('btb_owner_pw',p);}catch(e){}r=await j(u,o,ownerHeaders());}}return r;}
let cats=['All','Watches','Clothes','Shoes','Electronics','Collectibles','Home','Fashion','Art','Sports','Toys','Other'];
let curCat='All', curType='', curSeller='';
// Fixed price is only for the Store (Kevin, 2026-11-20): an auction never
// has a fixed price, so nobody can buy it outright before the auction is
// done. The "Store fixed price" field only shows when the listing type
// is "List in Store (Buy Now Only)".
function toggleFixedPrice(){const t=document.getElementById('sType');const isStore=t&&t.value==='buy_now';const r=document.getElementById('sFixedRow');if(r)r.style.display=isStore?'':'none';const n=document.getElementById('sFixedNote');if(n)n.style.display=isStore?'':'none';}
// A seller's Store: show only that seller's fixed-price (Store) listings.
function showSellerStore(seller){curType='buy_now';curSeller=seller||'';curCat='All';load();const t=document.getElementById('list');if(t)t.scrollIntoView({behavior:'smooth',block:'start'});}
function clearSellerStore(){curSeller='';load();}
// j() never leaves the user staring at "Error: undefined" (Kevin,
// 2026-11-20: Go Live showed that when it failed). If the request
// itself fails, or the server answers ok:false with no error message,
// it comes back as a clear sentence instead.
async function j(u,o,headers){let r;try{r=await fetch(u,o?{method:'POST',headers:Object.assign({'Content-Type':'application/json'},sessionHeaders(),headers||{}),body:JSON.stringify(o)}:{headers:Object.assign({},sessionHeaders(),headers||{})});}catch(e){return{ok:false,error:'could not reach the site — check your connection and try again'};}let d;try{d=await r.json();}catch(e){return{ok:false,error:'the site answered in a way this page could not read — try again'};}if(d&&d.ok===false&&!d.error)d.error='something went wrong — try again';return d;}
function show(w){document.getElementById('sellSec').style.display=w==='sell'?'block':'none';document.getElementById('dashSec').style.display=w==='dash'?'block':'none';document.getElementById('profileSec').style.display=w==='profile'?'block':'none';if(w==='buy'){curType='';curSeller='';load();}if(w==='store'){curType='buy_now';curSeller='';load();}if(w==='dash')loadDash();if(w==='profile')loadProfile();const target=w==='sell'?document.getElementById('sellSec'):w==='dash'?document.getElementById('dashSec'):w==='profile'?document.getElementById('profileSec'):document.getElementById('list');if(target){target.scrollIntoView({behavior:'smooth',block:'start'});}if(w==='sell'){const f=document.getElementById('sSeller');if(f){if(currentUser)f.value=currentUser.name;setTimeout(()=>f.focus(),400);}}}
// My Profile (Kevin, 2026-11-20): one page that shows you're signed in,
// who you are, what you bought and what you sold — each with its stage:
// processing, sent, delivered, finalized.
function stageLabel(s){return s==='processing'?'Processing':s==='sent'?'Sent':s==='delivered'?'Delivered':s==='finalized'?'Finalized':s==='refunded'?'Refunded':s;}
// The process for one sold item, in plain words (Kevin, 2026-11-20): Won →
// Shipped → Tracking → Rated → Final. Shown on every item in both the buyer
// and seller inbox (What I bought / What I sold), so you can see right where
// it is. Rated means the buyer left a star rating for the seller.
function processLine(l){
  const won='Won ✓';
  const shipped=l.shipped?'Shipped ✓':'Shipped — not yet';
  const tracking=l.tracking?('Tracking '+l.tracking):'Tracking — not yet';
  const rated=l.rated?'Rated ✓':'Rated — not yet';
  const final=l.stage==='refunded'?'Refunded':l.stage==='finalized'?'Final ✓':'Final — not yet';
  return `<span class="small">${won} → ${shipped} → ${escHtml(tracking)} → ${rated} → ${final}</span>`;
}
async function loadProfile(){
  const box=document.getElementById('profileBody'); if(!box)return;
  if(!currentUser){box.innerHTML='<p><b>You are not signed in.</b></p><p>Sign up or sign in in Your account below to see your profile.</p>';return;}
  const u=currentUser;
  let act={bought:[],sold:[]};
  try{const r=await j('/api/my-activity'); if(r&&r.ok)act=r;}catch(e){}
  // Private message threads (Kevin, 2026-11-20): only the buyer and the
  // seller see each thread — nobody else.
  let threads=[];
  try{const r=await j('/api/my-messages'); if(r&&r.ok&&Array.isArray(r.threads))threads=r.threads;}catch(e){}
  const roleName=u.role==='both'?'Buyer and seller':u.role==='seller'?'Seller':'Buyer';
  const itemRow=(l,other)=>{
    const price=l.price?('$'+l.price):'FREE';
    return `<p><b>${escHtml(l.title)}</b> — ${price}${l.shipping?(' + $'+l.shipping+' shipping'):''} • ${escHtml(other)} • <span class="badge ${l.stage==='finalized'?'green':l.stage==='delivered'?'gold':''}">${stageLabel(l.stage)}</span><br>${processLine(l)}<br><button class="btn ghost" onclick="openItem('${l.id}')">Open</button> <button class="btn ghost" onclick="showReceipt('${l.id}')">Receipt</button></p>`;
  };
// Receipt + video receipt for one sale, shown on My Profile (Kevin,
// 2026-11-20). The video receipt is the written record of the live show —
// item as listed, every bid, the room chat, whether the seller was live —
// because the live video itself is not recorded.
async function showReceipt(id, boxId){
  const _boxId=boxId||'receiptBox';
  const box=document.getElementById(_boxId); if(!box)return;
  box.innerHTML='<p>Loading receipt…</p>';
  const r=await oj('/api/receipt/'+id);
  if(!r.ok){box.innerHTML='<p>Error: '+escHtml(r.error||'no receipt yet')+'</p>';return;}
  const vr=r.videoReceipt||{};
  box.innerHTML=`
    <div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:12px">
      <h3 style="margin-top:0">Receipt ${escHtml(r.receiptNo)}</h3>
      <p><b>${escHtml(r.item)}</b><br>
      Seller: ${escHtml(r.seller)} • Buyer: ${escHtml(r.winner)}<br>
      Winning bid: $${r.winningBid} • Shipping: $${r.shipping} • Total: <b>$${r.total}</b><br>
      Date won: ${new Date(r.dateWon).toLocaleString()} • Seller was live: ${r.sellerLive?'Yes':'No'} • Bids: ${r.bidCount}</p>
      <h3>Video receipt — the live-room record</h3>
      <p class="small">This is the written record of the live show — the item as listed, every bid, and the room chat. The live video itself is not recorded.</p>
      <p><b>Listed as:</b> ${escHtml(vr.listedTitle||'')}</p>
      ${vr.revealedItem?`<p><b>Revealed live:</b> ${escHtml(vr.revealedItem)}</p>`:''}
      ${vr.bids&&vr.bids.length?`<p><b>Bid history</b><br>${vr.bids.map(b=>escHtml(b.bidder)+' — $'+b.amount+' — '+new Date(b.created_at).toLocaleString()).join('<br>')}</p>`:'<p>No bids recorded.</p>'}
      ${vr.chats&&vr.chats.length?`<p><b>Room chat</b><br>${vr.chats.map(c=>escHtml(c.name)+(c.is_seller?' (seller)':'')+': '+escHtml(c.message)).join('<br>')}</p>`:'<p>No chat messages.</p>'}
      <button class="btn ghost" onclick="document.getElementById('${_boxId}').innerHTML=''">Close receipt</button>
    </div>`;
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
  box.innerHTML=`
    <p style="font-size:20px;margin:0 0 4px">${sellerPhotoImg(u.photo,72)}<b>You're signed in as ${escHtml(u.name)}</b></p>
    <p>${roleName} • ${escHtml(u.email)}</p>
    <h3>Your name and picture</h3>
    <p class="small">Your username is what people see next to your listings, bids and messages. Your picture shows next to your name. Changing your username changes it everywhere — your old listings, bids and messages show the new name too.</p>
    <label>Username <input id="newName" value="${escHtml(u.name)}" maxlength="100"></label>
    <button class="btn" onclick="changeUsername()">Change username</button>
    <span id="nameMsg" class="small"></span>
    <p><label>Picture <input id="photoFile" type="file" accept="image/*" onchange="pickProfilePhoto(this)"></label>
    <button class="btn" onclick="changePhoto()">Change picture</button>
    ${u.photo?`<button class="btn ghost" onclick="removePhoto()">Remove picture</button>`:''}
    <span id="photoMsg" class="small"></span></p>
    <h3>Payment method</h3>
    <p class="small">Set your payment method once here — the room never asks for it. When you win an auction or buy from the Store, it uses this saved method. ${u.paymentMethod?`Saved: <b>${escHtml(u.paymentMethod)}</b>${u.hasPaymentDetail?' — detail saved':''}.`:''}</p>
    <p class="small"><b>TEST MODE — do not type a real card number here. No real payment is taken.</b> Type any test detail to pass, or type 'declined' to test a failed payment.</p>
    <label>Method <select id="payMethod"><option value="">Pick one</option>${['card','PayPal','Apple Pay','Google Pay','Cash App','Venmo','bank'].map(m=>`<option value="${m}"${u.paymentMethod===m?' selected':''}>${m}</option>`).join('')}</select></label>
    <label>Detail <input id="payDetail" placeholder="Test detail only — never a real card number"></label>
    <button class="btn" onclick="savePayment()">Save payment method</button>
    <span id="payMsg" class="small"></span>
    ${u.role==='buyer'?`<p><b>You signed up as a buyer, so you can't list yet.</b> <button class="btn" onclick="switchToSeller()">I want to sell too</button></p>`:''}
    <p><b>Real name and shipping address:</b> ${u.shippingAddress?escHtml(u.shippingAddress):'— not set yet. Add it in Your account below.'}</p>
    <h3>What I bought (${act.bought.length})</h3>
    ${act.bought.length?act.bought.map(l=>itemRow(l,'from '+l.seller)).join(''):'<p class="small">Nothing bought yet.</p>'}
    <h3>What I sold (${act.sold.length})</h3>
    ${act.sold.length?act.sold.map(l=>itemRow(l,'to '+(l.winner||'—'))).join(''):'<p class="small">Nothing sold yet.</p>'}
    <h3>My private messages (${threads.length})</h3>
    ${threads.length?threads.map(t=>`<p><b>${escHtml(t.title)}</b> — with ${escHtml(t.other)} • ${t.count} message${t.count===1?'':'s'}<br><span class="small">Latest: ${escHtml(t.lastMessage)}</span> <button class="btn ghost" onclick="openItem('${t.listingId}')">Open messages</button></p>`).join(''):'<p class="small">No private messages yet — message a seller from their item page.</p>'}`;
}
async function load(){
  const o=await j('/api/overview');
  document.getElementById('founding').textContent=`Founding sellers: ${o.founding.taken}/10 taken — ${o.founding.remaining} spots left. 0% until it goes live, then 5% forever. Normal fee 10%.`;
  let followed=new Set(); if(currentUser){try{const f=await j('/api/following/'+encodeURIComponent(currentUser.name)); if(Array.isArray(f))f.forEach(x=>followed.add(x.seller));}catch(e){}}
  document.getElementById('liveNow').innerHTML=o.listings.filter(l=>l.seller_live&&l.seller_present).map(l=>`<p><span class="badge">🔴 LIVE NOW</span> ${sellerPhotoImg(l.seller_photo,28)}<b>${escHtml(l.seller)}</b>${followed.has(l.seller)?' <span class="badge gold">Keeping track</span>':''} — ${escHtml(l.title)} — ${l.type==='wheel'?'FREE giveaway':`$${l.current_bid}`} <button class="btn ghost" onclick="openItem('${l.id}')">Join room</button></p>`).join('')||'<p class="small">No sellers live now.</p>';
  document.getElementById('tiles').innerHTML=cats.map(c=>`<span class="tile ${c===curCat?'active':''}" onclick="setCat('${c}')">${c}</span>`).join('');
  // Giveaways (wheel) live only in the seller's room, never as cards on the
  // main page — the main grid shows auctions and Store items only.
  // Main grid shows only items you can still bid on or buy — queued (waiting
  // to start) and live. Ended and sold items are done; they live on My
  // Profile (What I bought / What I sold), not in the browse list. Otherwise
  // every Random Item ever tried piles up as a list of cards (Kevin, 2026-11-20).
  // A seller's Store (curSeller) shows only that seller's fixed-price items.
  let rows=o.listings.filter(l=>l.type!=='wheel'&&(!curType||l.type===curType)&&(l.status==='queued'||l.status==='live')); if(curCat!=='All')rows=rows.filter(l=>l.category===curCat); if(curSeller)rows=rows.filter(l=>l.seller===curSeller);
  // Random Items in one batch (Kevin, 2026-11-21): 59 random items made at
  // once must not show as 59 separate cards — the list gets too long for
  // the screen. Group queued Random Items made together (same seller, same
  // base name, same settings) into ONE card for the whole batch, showing
  // how many are in it. The room runs them in order from the first one.
  const batchSeen={};
  rows=rows.filter(l=>{
    if(!(l.is_random&&l.status==='queued'))return true;
    const base=l.title.replace(/\s+\d+$/,'');
    const key=[l.seller,base,l.category,l.start_price,l.timer_seconds,l.mode,l.package_size,l.condition].join('|');
    if(!batchSeen[key])batchSeen[key]={count:0,first:l};
    batchSeen[key].count++;
    if(batchSeen[key].first===l){l.randomBatchCount=batchSeen[key].count;return true;}
    batchSeen[key].first.randomBatchCount=batchSeen[key].count;
    return false;
  });
  document.getElementById('list').innerHTML=(curSeller?`<p><b>Showing ${escHtml(curSeller)}'s Store</b> — fixed-price items only. <button class="btn ghost" onclick="clearSellerStore()">Show all stores</button></p>`:'')+rows.map(l=>`<div class="card">${l.image_url?`<img src="${escHtml(l.image_url)}" style="max-width:100%;border-radius:10px" alt="${escHtml(l.title)}">`:''}<h3>${escHtml(l.title)} ${noComBadge(l)} ${l.is_random?`<span class="badge gold">🎲 RANDOM ITEM</span>`:''} ${l.authenticity!=='Authentic'?`<span class="badge gold">${escHtml(l.authenticity.toUpperCase())}</span>`:''}</h3>${(l.type==='auction'||l.type==='wheel')&&l.ends_at?`<div class="hg-mini-wrap">${hourglassSVG('card-'+l.id,l.ends_at,l.created_at,'hg-mini')}</div>`:''}${(l.type==='auction'||l.type==='wheel')&&l.status==='queued'?`<p class="small"><b>⏳ Waiting to start</b> — the seller taps Start auction when they're ready.</p>`:''}
  ${l.is_random?`<p class="small">🎲 RANDOM ITEM — no picture, seller shows it live on camera.</p>`:''}
  ${l.is_random&&l.randomBatchCount>1?`<p class="small"><b>🎲 ${l.randomBatchCount} random items in this batch</b> — tap Open to join the room, they run one after another.</p>`:''}
  <p>${escHtml(l.category)} • ${l.type==='buy_now'?'Store — Buy Now Only':l.type==='wheel'?'⏰ Time Wheel — FREE giveaway':'Auction • '+escHtml(l.mode)} • ${sellerPhotoImg(l.seller_photo,28)}${escHtml(l.seller)}${l.type==='wheel'?` • ${l.wheel_count||0} name${(l.wheel_count||0)===1?'':'s'} on the wheel`:''}</p>
  <p class="small"><b>Condition: ${escHtml(conditionOf(l))}</b></p>
  ${noComNote(l)}
  <p>${l.type==='buy_now'?`Price $${l.fixed_price}`:l.type==='wheel'?`FREE giveaway — enter free, no bidding`:`Current bid $${l.current_bid} • Starting $${l.start_price}`}<br>Shipping $${l.shipping} (buyer pays)${l.package_size?` • ${shipLabelOf(l.package_size)}`:''} • ${shipViaText(l)} • Insured shipping ✓</p>
  <p class="small">Status: ${escHtml(l.status)} ${l.payment_status==='declined'?'<span class="badge">PAYMENT DECLINED</span>':''} ${l.payment_status==='validated'?'<span class="badge green">Payment went through — in escrow hold</span>':''}</p>
  <button class="btn" onclick="openItem('${l.id}')">Open</button> <button class="btn ghost" onclick="showSellerStore('${escJs(l.seller)}')">Visit ${escHtml(l.seller)}'s Store</button></div>`).join('')||'<p>No listings yet — be the first to sell something.</p>';
  const s=await j('/api/coming-up');
  let savedShows=[]; if(currentUser){try{const sv=await j('/api/saved-shows'); if(Array.isArray(sv))savedShows=sv;}catch(e){}}
  const saved=new Set(savedShows.map(x=>x.id));
  document.getElementById('shows').innerHTML=s.map(x=>`<p>Coming Up: ${escHtml(x.title)} by ${escHtml(x.seller)} — ${escHtml(x.starts_at)} ${currentUser?`<button class="btn ghost" onclick="saveShow('${x.id}')">${saved.has(x.id)?'Saved ✓ — tap to unsave':'Save this show'}</button>`:''}</p>`).join('');
  document.getElementById('savedShows').innerHTML=savedShows.length?`<p><b>My saved shows</b></p>`+savedShows.map(x=>`<p>${escHtml(x.title)} by ${escHtml(x.seller)} — ${escHtml(x.starts_at)} <button class="btn ghost" onclick="saveShow('${x.id}')">Unsave</button></p>`).join(''):'';
  // Saved-show alert (Kevin, 2026-11-20): when a show you saved is
  // starting now (started within the last 2 hours) or starts in the
  // next 15 minutes, show a gold banner at the top so you see it right
  // away. Dismissed shows stay dismissed (kept in localStorage by id).
  let dismissed=[]; try{dismissed=JSON.parse(localStorage.getItem('btb_show_alert_dismissed')||'[]');}catch(e){}
  const dis=new Set(dismissed);
  const nowMs=new Date();
  const alertShows=savedShows.filter(x=>!dis.has(x.id)).filter(x=>{
    const st=new Date(x.starts_at); if(isNaN(st))return false;
    const mins=(st-nowMs)/60000; return mins>=-120&&mins<=15;
  });
  document.getElementById('showAlert').innerHTML=alertShows.map(x=>{
    const st=new Date(x.starts_at); const mins=Math.round((st-nowMs)/60000);
    const txt=mins<=0?'is starting now!':'starts in '+mins+' minute'+(mins===1?'':'s');
    return `<div class="card" style="border:2px solid #d4af37;padding:14px;margin:10px 0"><p style="margin:0"><b>🔔 Your saved show "${escHtml(x.title)}" by ${escHtml(x.seller)} ${txt}</b></p><p class="small" style="margin:6px 0">Check Live Now — the seller should be going live.</p><button class="btn" onclick="document.getElementById('liveNow').scrollIntoView({behavior:'smooth',block:'start'})">See live shows</button> <button class="btn ghost" onclick="dismissShowAlert('${x.id}')">Dismiss</button></div>`;
  }).join('');
  loadKeepTrack();
}
function setCat(c){curCat=c;load();}
// Condition (Kevin, 2026-11-18): the seller must state it — New, Used –
// Working, Used – Working Project, or Used – Not Working / Project / For
// Parts. Old listings made before this rule have no condition stored; the
// display fallback below ('Used – Working') is display-only and never
// changes a seller's stated condition in the database.
const CONDITIONS=['New','Used – Working','Used – Working Project','Used – Not Working / Project / For Parts','Say it live in chat'];
function conditionOf(l){if(l&&l.condition==='Say it live in chat')return 'Say it live in chat';return CONDITIONS.includes(l&&l.condition)?l.condition:'Used – Working';}
// No cancellation / no refund for change of mind (Kevin, 2026-11-19):
// the seller can mark a listing that way. It is shown on the card and the
// item page before anyone bids. Legit reasons still get a refund.
function noComOf(l){return !!(l&&Number(l.no_change_of_mind));}
function noComBadge(l){return noComOf(l)?`<span class="badge gold">NO CANCELLATION — NO REFUND FOR CHANGE OF MIND</span>`:'';}
function noComNote(l){return noComOf(l)?`<p class="small"><b>No cancellation — no refund for change of mind.</b> Legit reasons only (not as described, damaged, wrong item, defective, never arrived).</p>`:'';}
// Shipping by package size (same tiers as the server — US shipping rates).
const SHIP_SIZES={small:{label:'Small — under 4 oz',price:4.47},medium:{label:'Medium — 4–8 oz',price:4.85},large:{label:'Large — 8–12 oz',price:5.25},xl:{label:'XL — 12 oz–1 lb',price:6.75},box:{label:'Box — 1–5 lb',price:7.75},bigbox:{label:'Big box — over 5 lb',price:9.69},flat:{label:'Flat Rate box',price:12.99},envelope:{label:'Card envelope',price:0.99}};
function shipLabelOf(s){return (SHIP_SIZES[s]||{}).label||'';}
// Carrier rule: USPS for everything, UPS for Big box over 5 lb. No FedEx.
// The carrier is automatic from package size — the seller never picks it.
function carrierOf(l){return l.carrier||(l.package_size==='bigbox'?'UPS':'USPS');}
function shipViaText(l){const c=carrierOf(l);return c==='UPS'?'Ships via UPS (over 5 lbs)':'Ships via USPS';}
// ---------- Hourglass timer (gold + dark navy, like the hourglass in the logo) ----------
// The timer is an hourglass: gold sand runs from the top bulb to the bottom
// bulb as time runs out, and the digital time sits in the middle on a gold
// plaque. The sand level and the digits are driven by the same real
// countdown (ends_at) the server already sends — timer rules are unchanged:
// Regular adds 10s per outbid (ends_at moves, so the sand refills by that
// amount), Sudden Death does not reset it. Total time is ends_at minus
// created_at, so a Regular extension grows the total and the sand refills.
function hgFmt(ms){
  if(ms<=0)return '00:00';
  const s=Math.ceil(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  const p=n=>String(n).padStart(2,'0');
  return h>0?p(h)+':'+p(m)+':'+p(sec):p(m)+':'+p(sec);
}
function hourglassSVG(uid,endsAt,createdAt,cls){
  const safe=String(uid).replace(/[^a-zA-Z0-9_-]/g,'');
  const glass='M32 22 L88 22 C92 42 84 62 62 78 C84 94 92 116 88 138 L32 138 C28 116 36 94 58 78 C36 62 28 42 32 22 Z';
  return '<svg class="hg '+(cls||'')+'" data-hg-ends="'+escHtml(endsAt||'')+'" data-hg-created="'+escHtml(createdAt||'')+'" viewBox="0 0 120 168" role="timer" aria-label="Auction timer">'
  +'<defs><clipPath id="hgClip-'+safe+'"><path d="'+glass+'"/></clipPath>'
  +'<linearGradient id="hgSand-'+safe+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5d76e"/><stop offset="0.6" stop-color="#d4a017"/><stop offset="1" stop-color="#a67c00"/></linearGradient></defs>'
  +'<rect x="16" y="14" width="6" height="140" rx="3" fill="#c9a227"/><rect x="98" y="14" width="6" height="140" rx="3" fill="#c9a227"/>'
  +'<rect x="22" y="6" width="76" height="8" rx="3" fill="#c9a227"/><rect x="22" y="154" width="76" height="8" rx="3" fill="#c9a227"/>'
  +'<path d="'+glass+'" fill="#dfeaf5" fill-opacity="0.12" stroke="#c9a227" stroke-width="2.5"/>'
  +'<rect class="hg-topSand" x="28" y="22" width="64" height="56" fill="url(#hgSand-'+safe+')" clip-path="url(#hgClip-'+safe+')"/>'
  +'<rect class="hg-botSand" x="28" y="138" width="64" height="0" fill="url(#hgSand-'+safe+')" clip-path="url(#hgClip-'+safe+')"/>'
  +'<rect class="hg-stream" x="58.5" y="76" width="3" height="12" fill="#e8b64c"/>'
  +'<rect class="hg-plaque" x="10" y="70" width="100" height="28" rx="7" fill="#c9a227" stroke="#f5d76e" stroke-width="1.5"/>'
  +'<text class="hg-digits" x="60" y="89" text-anchor="middle" font-size="19" font-weight="800" fill="#081426" font-family="system-ui,-apple-system,Segoe UI,Arial,sans-serif">--:--</text>'
  +'</svg>';
}
function updateHourglasses(){
  document.querySelectorAll('svg.hg[data-hg-ends]').forEach(svg=>{
    const ends=new Date(svg.dataset.hgEnds).getTime();
    if(!ends)return;
    const created=new Date(svg.dataset.hgCreated||'').getTime();
    const total=(created&&ends>created)?(ends-created):0;
    const ms=ends-Date.now();
    const frac=total>0?Math.max(0,Math.min(1,ms/total)):(ms>0?1:0);
    const digits=svg.querySelector('.hg-digits');
    if(digits)digits.textContent=hgFmt(ms);
    const top=svg.querySelector('.hg-topSand');
    if(top){const h=56*frac;top.setAttribute('y',String(78-h));top.setAttribute('height',String(h));}
    const bot=svg.querySelector('.hg-botSand');
    if(bot){const h=56*(1-frac);bot.setAttribute('y',String(138-h));bot.setAttribute('height',String(h));}
    const stream=svg.querySelector('.hg-stream');
    if(stream)stream.style.display=(ms>0&&frac>0)?'':'none';
    const ended=ms<=0;
    const plaque=svg.querySelector('.hg-plaque');
    if(plaque)plaque.setAttribute('fill',ended?'#c62828':'#c9a227');
    if(digits)digits.setAttribute('fill',ended?'#ffffff':'#081426');
    svg.classList.toggle('hg-ended',ended);
  });
  const room=document.querySelector('svg.hg-room');
  const st=document.getElementById('cdState');
  if(room&&st){const ms=new Date(room.dataset.hgEnds).getTime()-Date.now();st.textContent=ms>0?'Gold sand running down — time left in this auction.':'Auction ended.';}
  maybeAutoAdvance();
}
// Auto-advance (Kevin, 2026-11-20): when the item in the room ends, move
// to the seller's next queued item on its own — no scrolling down to find
// it. Only once per item, so it never loops.
let lastAutoAdvanceId=null;
let lastOpenedItemId=null; // openItem scrolls to the room only when a NEW item is opened, not on re-renders (bid, chat, etc.)
async function maybeAutoAdvance(){
  const room=document.querySelector('svg.hg-room');
  if(!room)return;
  const id=liveListingId; if(!id)return;
  if(lastAutoAdvanceId===id)return;
  const ms=new Date(room.dataset.hgEnds).getTime()-Date.now();
  if(ms>0)return;
  lastAutoAdvanceId=id;
  try{
    const r=await j('/api/listings/'+id+'/next');
    if(r.ok&&r.next){openItem(r.next.id);}
  }catch(e){}
}
if(!window._hgTick){window._hgTick=setInterval(updateHourglasses,250);}


// ---------- QR codes (vendored, no dependency, no external QR API) ----------
// Small QR Code generator: byte mode, error-correction level M, versions 1–9.
// The QR encodes the sale URL, so a phone camera opens that exact sold item.
// Tables are the standard ISO 18004 values for level M (total codewords,
// EC codewords per block, data codewords per block group, alignment positions).
const QR_VERSIONS=[null,
 {total:26,ec:10,align:[],groups:[{n:1,data:16}]},
 {total:44,ec:16,align:[6,18],groups:[{n:1,data:28}]},
 {total:70,ec:26,align:[6,22],groups:[{n:1,data:44}]},
 {total:100,ec:18,align:[6,26],groups:[{n:2,data:32}]},
 {total:134,ec:24,align:[6,30],groups:[{n:2,data:43}]},
 {total:172,ec:16,align:[6,34],groups:[{n:4,data:27}]},
 {total:196,ec:18,align:[6,22,38],groups:[{n:4,data:31}]},
 {total:242,ec:22,align:[6,24,42],groups:[{n:2,data:38},{n:2,data:39}]},
 {total:292,ec:22,align:[6,26,46],groups:[{n:3,data:36},{n:2,data:37}]}];
const QR_EXP=new Array(512), QR_LOG=new Array(256);
(function(){let x=1;for(let i=0;i<255;i++){QR_EXP[i]=x;QR_LOG[x]=i;x<<=1;if(x&0x100)x^=0x11D;}for(let i=255;i<512;i++)QR_EXP[i]=QR_EXP[i-255];})();
function qrGfMul(a,b){return (a===0||b===0)?0:QR_EXP[QR_LOG[a]+QR_LOG[b]];}
function qrRsDivisor(degree){const r=new Array(degree).fill(0);r[r.length-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<r.length;j++){r[j]=qrGfMul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}root=qrGfMul(root,0x02);}return r;}
function qrRsRemainder(data,divisor){const r=divisor.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);for(let i=0;i<divisor.length;i++)r[i]^=qrGfMul(divisor[i],f);}return r;}
function qrFormatBits(mask){const data=mask;let rem=data;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>9)*0x537);return((data<<10)|rem)^0x5412;}
function qrVersionBits(v){let rem=v;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>11)*0x1F25);return(v<<12)|rem;}
function qrBit(x,i){return ((x>>>i)&1)!==0;}
function qrEncode(text){
  const bytes=[];const enc=(typeof TextEncoder!=='undefined')?new TextEncoder().encode(text):null;
  if(enc){for(const b of enc)bytes.push(b);}else{for(let i=0;i<text.length;i++)bytes.push(text.charCodeAt(i)&0xFF);}
  const bitsNeeded=4+8+8*bytes.length, bytesNeeded=Math.ceil((bitsNeeded+4)/8);
  let version=0, spec=null;
  for(let v=1;v<=9;v++){const cap=QR_VERSIONS[v].groups.reduce((s,g)=>s+g.n*g.data,0);if(cap>=bytesNeeded){version=v;spec=QR_VERSIONS[v];break;}}
  if(!version)return null;
  const dataCap=spec.groups.reduce((s,g)=>s+g.n*g.data,0);
  // Build the data bit stream, then pad to fill the data codewords.
  const bb=[];const pushBits=(val,len)=>{for(let i=len-1;i>=0;i--)bb.push((val>>>i)&1);};
  pushBits(0x4,4);pushBits(bytes.length,8);for(const b of bytes)pushBits(b,8);
  const capBits=dataCap*8;pushBits(0,Math.min(4,capBits-bb.length));
  while(bb.length%8!==0)bb.push(0);
  const padBytes=[0xEC,0x11];let pi=0;
  while(bb.length<capBits){pushBits(padBytes[pi%2],8);pi++;}
  const data=[];for(let i=0;i<bb.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bb[i+j];data.push(b);}
  // Split into blocks, compute ECC per block, interleave data then ECC.
  const blocks=[];let off=0;
  for(const g of spec.groups)for(let k=0;k<g.n;k++){const chunk=data.slice(off,off+g.data);off+=g.data;blocks.push({data:chunk,ecc:qrRsRemainder(chunk,qrRsDivisor(spec.ec))});}
  const out=[];const maxData=Math.max(...blocks.map(b=>b.data.length));
  for(let i=0;i<maxData;i++)for(const b of blocks)if(i<b.data.length)out.push(b.data[i]);
  for(let i=0;i<spec.ec;i++)for(const b of blocks)out.push(b.ecc[i]);
  // Matrix: -1 = not set yet.
  const size=17+4*version;
  const modules=[], isFunc=[];
  for(let y=0;y<size;y++){modules.push(new Array(size).fill(-1));isFunc.push(new Array(size).fill(false));}
  const setF=(x,y,v)=>{modules[y][x]=v?1:0;isFunc[y][x]=true;};
  const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=size||y>=size)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));setF(x,y,d!==2&&d!==4);}};
  finder(3,3);finder(size-4,3);finder(3,size-4);
  for(let i=8;i<size-8;i++){setF(i,6,i%2===0);setF(6,i,i%2===0);}
  for(const ax of spec.align)for(const ay of spec.align){
    if((ax===6&&ay===6)||(ax===6&&ay===size-7)||(ax===size-7&&ay===6))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)setF(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  // Reserve format + version info areas (all 15 bits of each copy).
  for(let i=0;i<6;i++){setF(8,i,0);setF(i,8,0);}
  setF(8,7,0);setF(8,8,0);setF(7,8,0);
  for(let i=0;i<8;i++)setF(size-1-i,8,0); // row 8, cols size-1..size-8
  for(let i=0;i<7;i++)setF(8,size-7+i,0); // col 8, rows size-7..size-1
  setF(8,size-8,1); // dark module: column 8, row size-8
  if(version>=7)for(let i=0;i<18;i++){const a=size-11+(i%3),b=Math.floor(i/3);setF(a,b,0);setF(b,a,0);}
  // Place data bits, zig-zag from bottom right, skipping column 6.
  let bi=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
      const x=right-j, up=((right+1)&2)===0, y=up?size-1-vert:vert;
      if(!isFunc[y][x]&&bi<out.length*8){modules[y][x]=(out[bi>>>3]>>>(7-(bi&7)))&1;bi++;}
    }
  }
  // Try every mask, keep the one with the lowest penalty score.
  const maskBit=(m,x,y)=>{switch(m){case 0:return(x+y)%2===0;case 1:return y%2===0;case 2:return x%3===0;case 3:return(x+y)%3===0;case 4:return(Math.floor(y/2)+Math.floor(x/3))%2===0;case 5:return((x*y)%2+(x*y)%3)===0;case 6:return(((x*y)%2+(x*y)%3)%2)===0;default:return(((x+y)%2+(x*y)%3)%2)===0;}};
  function penalty(ms){
    let p=0;
    const runs=(line)=>{let c=line[0],n=1;for(let i=1;i<line.length;i++){if(line[i]===c){n++;}else{if(n>=5)p+=3+(n-5);c=line[i];n=1;}}if(n>=5)p+=3+(n-5);};
    for(let y=0;y<size;y++)runs(ms[y]);
    for(let x=0;x<size;x++){const col=[];for(let y=0;y<size;y++)col.push(ms[y][x]);runs(col);}
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++)if(ms[y][x]===ms[y][x+1]&&ms[y][x]===ms[y+1][x]&&ms[y][x]===ms[y+1][x+1])p+=3;
    const finderLike=(line)=>{for(let i=0;i+10<line.length;i++){let v=0;for(let k=0;k<11;k++)v=(v<<1)|line[i+k];if(v===0x5D0||v===0x05D)p+=40;}};
    for(let y=0;y<size;y++)finderLike(ms[y]);
    for(let x=0;x<size;x++){const col=[];for(let y=0;y<size;y++)col.push(ms[y][x]);finderLike(col);}
    let dark=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(ms[y][x])dark++;
    const total=size*size, k=Math.ceil(Math.abs(dark*20-total*10)/total)-1;
    return p+Math.max(0,k)*10;
  }
  let best=null,bestMask=0,bestScore=Infinity;
  for(let m=0;m<8;m++){
    const ms=modules.map(r=>r.slice());
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!isFunc[y][x]&&maskBit(m,x,y))ms[y][x]^=1;
    const fb=qrFormatBits(m);
    // First copy: bits 0–5 down column 8 (rows 0–5), bit 6 at (row 8, col 7),
    // bit 7 at (8,8), bit 8 at (row 7, col 8), bits 9–14 along row 8 (cols 5–0).
    for(let i=0;i<=5;i++)ms[i][8]=qrBit(fb,i)?1:0;
    ms[7][8]=qrBit(fb,6)?1:0;ms[8][8]=qrBit(fb,7)?1:0;ms[8][7]=qrBit(fb,8)?1:0;
    for(let i=9;i<15;i++)ms[8][14-i]=qrBit(fb,i)?1:0;
    for(let i=0;i<8;i++)ms[8][size-1-i]=qrBit(fb,i)?1:0;
    for(let i=8;i<15;i++)ms[size-15+i][8]=qrBit(fb,i)?1:0;
    ms[size-8][8]=1;
    if(version>=7){const vb=qrVersionBits(version);for(let i=0;i<18;i++){const bit=qrBit(vb,i)?1:0;const a=size-11+(i%3),b=Math.floor(i/3);ms[b][a]=bit;ms[a][b]=bit;}}
    const s=penalty(ms);
    if(s<bestScore){bestScore=s;best=ms;bestMask=m;}
  }
  return {version,size,modules:best,mask:bestMask};
}
function drawQR(text,canvas){
  if(!canvas)return false;
  const qr=qrEncode(text);if(!qr)return false;
  const quiet=4,n=qr.size+quiet*2,scale=Math.max(2,Math.floor(320/n));
  canvas.width=n*scale;canvas.height=n*scale;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#000';
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.modules[y][x])ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
  return true;
}
window._photoData='';
function pickPhoto(input){const f=input.files&&input.files[0];if(!f)return;const img=new Image();const rd=new FileReader();rd.onload=e=>{img.onload=()=>{const max=800;const sc=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);window._photoData=c.toDataURL('image/jpeg',0.8);const p=document.getElementById('sPhotoPrev');p.src=window._photoData;p.style.display='block';};img.src=e.target.result;};rd.readAsDataURL(f);}
// Change username + profile picture (Kevin, 2026-11-20): from My Profile.
// The username change updates the name everywhere it appears. The picture
// is resized small (200px) before upload so it stays light.
async function changeUsername(){
  const m=document.getElementById('nameMsg'); if(m)m.textContent='';
  const name=(document.getElementById('newName')||{}).value||'';
  const r=await j('/api/auth/username',{name});
  if(!r.ok){if(m)m.textContent='Error: '+(r.error||'could not change it');return;}
  currentUser=r.user; try{localStorage.setItem('btb_user',JSON.stringify(r.user));}catch(e){}
  if(m)m.textContent='Username changed to '+r.user.name+'.';
  renderAuth(); syncSellerToken(); loadProfile(); load();
}
function pickProfilePhoto(input){const f=input.files&&input.files[0];if(!f)return;const img=new Image();const rd=new FileReader();rd.onload=e=>{img.onload=()=>{const max=200;const sc=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);window._profilePhotoData=c.toDataURL('image/jpeg',0.8);const m=document.getElementById('photoMsg');if(m)m.textContent='Picture picked — tap Change picture to save it.';};img.src=e.target.result;};rd.readAsDataURL(f);}
async function changePhoto(){
  const m=document.getElementById('photoMsg'); if(m)m.textContent='';
  const photo=window._profilePhotoData||'';
  if(!photo){if(m)m.textContent='Pick a picture first.';return;}
  const r=await j('/api/auth/photo',{photo});
  if(!r.ok){if(m)m.textContent='Error: '+(r.error||'could not save it');return;}
  currentUser=r.user; try{localStorage.setItem('btb_user',JSON.stringify(r.user));}catch(e){}
  window._profilePhotoData='';
  if(m)m.textContent='Picture saved.';
  renderAuth(); loadProfile(); load();
}
async function removePhoto(){
  const m=document.getElementById('photoMsg'); if(m)m.textContent='';
  const r=await j('/api/auth/photo',{photo:''});
  if(!r.ok){if(m)m.textContent='Error: '+(r.error||'could not remove it');return;}
  currentUser=r.user; try{localStorage.setItem('btb_user',JSON.stringify(r.user));}catch(e){}
  window._profilePhotoData='';
  if(m)m.textContent='Picture removed.';
  renderAuth(); loadProfile(); load();
}
// Payment method saved in the profile (Kevin, 2026-11-20): set it once
// here, and the room never asks for it — Buy Now and Pay now use this.
async function savePayment(){
  const m=document.getElementById('payMsg'); if(m)m.textContent='';
  const method=document.getElementById('payMethod').value;
  const detail=document.getElementById('payDetail').value.trim();
  if(!method){if(m)m.textContent='Pick a payment method first.';return;}
  if(!detail){if(m)m.textContent='Type your payment detail first.';return;}
  const r=await j('/api/auth/payment',{method,detail});
  if(!r.ok){if(m)m.textContent='Error: '+(r.error||'could not save it');return;}
  currentUser=r.user; try{localStorage.setItem('btb_user',JSON.stringify(r.user));}catch(e){}
  if(m)m.textContent='Payment method saved — the room will use this from now on.';
  renderAuth(); loadProfile();
}
function timerSecondsValue(){const s=document.getElementById('sTimer');if(!s)return 30;if(s.value==='custom'){const c=document.getElementById('sTimerCustom');const n=c?Number(c.value):0;return n>=5&&n<=3600?n:30;}return Number(s.value)||30;}
function randomTimerSecondsValue(){const s=document.getElementById('sRandomTimer');if(!s)return 30;if(s.value==='custom'){const c=document.getElementById('sRandomTimerCustom');const n=c?Number(c.value):0;return n>=5&&n<=3600?n:30;}return Number(s.value)||30;}
function toggleRules(){var d=document.getElementById('rulesList');if(!d)return;var open=d.style.display!=='none';d.style.display=open?'none':'block';var b=document.getElementById('rulesToggleBtn');if(b)b.textContent=open?'Read the Rules':'Hide the Rules';}
function toggleStartMenu(){var d=document.getElementById('startMenu');if(!d)return;var open=d.style.display!=='none';d.style.display=open?'none':'block';}
// Start menu options are tap buttons in Kevin's own style — dark navy tiles
// with a gold border, the picked one turns gold (same .tile style as the
// Buy / Sell / Buy and sell bar). No dropdowns: tap $1 / $5 / $10 / $25 /
// $50 / $100 / Custom for the start bid, tap 10s / 30s / 2min / Custom for
// the time, tap Sudden Death / Regular for the mode. The picked value goes
// into the hidden #startBid / #startTimer / #startMode fields, which
// startAuction() reads — so the menu works whether it was opened or not.
function pickStart(group,value,el){
  if(group==='bid'){
    const h=document.getElementById('startBid');
    const w=document.getElementById('startBidCustomWrap');
    if(value==='custom'){if(w)w.style.display='block';const c=document.getElementById('startBidCustom');if(c&&h&&c.value!=='')h.value=c.value;}
    else{if(h)h.value=value;if(w)w.style.display='none';}
  }
  if(group==='time'){
    const h=document.getElementById('startTimer');
    if(h)h.value=value;
    const c=document.getElementById('startTimerCustom');
    if(c)c.style.display=value==='custom'?'block':'none';
  }
  if(group==='mode'){
    const h=document.getElementById('startMode');
    if(h)h.value=value;
  }
  const wrap=el.parentElement;
  if(wrap)wrap.querySelectorAll('.tile').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}
function openRulesModal(){var b=document.getElementById('rulesModalBody');if(b&&!b.hasChildNodes()){var s=document.getElementById('rulesSec');if(s){var c=s.querySelector('ol');if(c)b.appendChild(c.cloneNode(true));}}document.getElementById('rulesModal').style.display='block';}
function closeRulesModal(){document.getElementById('rulesModal').style.display='none';}
function agreeRules(){var a=document.getElementById('aAgree');if(a)a.checked=true;var sa=document.getElementById('sAgree');if(sa)sa.checked=true;var s=document.getElementById('agreeStatusSignup');if(s)s.textContent='✓ You agreed to the Rules.';var s2=document.getElementById('agreeStatus');if(s2)s2.textContent='✓ You agreed to the Rules.';var s3=document.getElementById('rulesAgreeStatus');if(s3)s3.textContent='✓ You agreed to the Rules.';closeRulesModal();}
async function createListing(){
  if(needSignIn())return;
  // Rules agreement is at sign-up now (Kevin, 2026-11-20) — no more
  // agreeing every time someone lists.
  const size=document.getElementById('sSize').value;
  const _sw=document.getElementById('sWheel');
  const wheelItems=_sw?(_sw.value||'').split('\n').map(s=>s.trim()).filter(Boolean):[];
  // Fixed price is only for the Store (Kevin, 2026-11-20): an auction never
  // has one, so nobody can buy it outright before the auction is done.
  const _isStore=document.getElementById('sType').value==='buy_now';
  const b={seller:document.getElementById('sSeller').value,title:document.getElementById('sTitle').value,description:document.getElementById('sDesc').value,category:document.getElementById('sCat').value,type:document.getElementById('sType').value,startPrice:document.getElementById('sStart').value,fixedPrice:_isStore?document.getElementById('sFixed').value:null,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sAuth').value,condition:document.getElementById('sCond').value,timerSeconds:timerSecondsValue(),mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,noChangeOfMind:document.getElementById('sNoCom').checked,imageUrl:window._photoData||'',wheelItems};
  const r=await j('/api/listings',b); noteSellerToken(b.seller,r); document.getElementById('sellMsg').textContent=r.ok?'Listed!':('Error: '+r.error); if(r.ok)load();
}
// Random Items: one tap creates N numbered auctions (Random Item 1, 2, 3…),
// no picture needed — the seller shows each one live on camera. Uses the
// same seller name, category, starting bid, timer, mode, package size,
// insured shipping and Seller Agreement as the sell form above.
async function createRandomItems(){
  if(needSignIn())return;
  // Rules agreement is at sign-up now (Kevin, 2026-11-20) — no more
  // agreeing every time someone lists.
  // Shipping, condition, category, starting bid, timer, mode and
  // authenticity are all right here in the Random section now (Kevin,
  // 2026-11-21) — everything to start the random, all in one spot, no
  // scrolling up. They no longer read the main form's #sSize/#sInsured/
  // #sCond/#sCat/#sStart/#sTimer/#sMode/#sAuth. Condition defaults to
  // "Say it live in chat" (the Random way) — the seller can pick a real
  // condition instead. Seller name still comes from the account.
  const size=document.getElementById('sRandomSize').value;
  const b={isRandom:true,randomBase:document.getElementById('sRandomBase').value,randomCount:Number(document.getElementById('sRandomCount').value),seller:document.getElementById('sSeller').value,category:document.getElementById('sRandomCat').value,startPrice:document.getElementById('sRandomStart').value,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sRandomAuth').value,condition:document.getElementById('sRandomCond').value,timerSeconds:randomTimerSecondsValue(),mode:document.getElementById('sRandomMode').value,shippingInsured:document.getElementById('sRandomInsured').checked,noChangeOfMind:document.getElementById('sNoCom').checked};
  const r=await j('/api/listings',b); noteSellerToken(b.seller,r);
  document.getElementById('randomMsg').textContent=r.ok?`Created ${r.count} random items: ${escHtml(r.titles.join(', '))} — no picture, show each one live on camera.` : ('Error: '+r.error);
  if(r.ok)load();
}
// Seller says what the winner actually won on a Random Item — the item they
// held up live on camera. Saved on the listing, then shown on the receipt,
// the video receipt and the ship-QR section.
async function revealItem(id){
  if(needSignIn())return;
  const seller=authName();
  const revealed=document.getElementById('revealedInput').value;
  const condEl=document.getElementById('revealedCond');
  const condition=condEl?condEl.value:'';
  const r=await j('/api/listings/'+id+'/reveal',{seller,revealedItem:revealed,condition},sellerHeaders(seller)); noteSellerToken(seller,r);
  if(!r.ok){alert('Error: '+r.error);return;}
  openItem(id);
}
// ---------- Live video (WebRTC peer-to-peer, no paid service) ----------
// Seller broadcasts their camera to each viewer in the room via RTCPeerConnection;
// the server only relays small signalling messages (join / offer / answer / ICE).
// STUN only (stun.l.google.com) — no TURN server, so a few strict networks may fail.
let liveListingId=null, liveRole=null, liveViewerId=null, liveStream=null, liveRemoteStream=null;
let livePCs={}, livePoll=null, liveSince=null, liveSeen=new Set();
let liveFacingMode='environment'; // back camera first (best for showing items); flip swaps to front
function liveVideoEl(){return document.getElementById('liveVideo');}
function liveStatusEl(){return document.getElementById('liveStatus');}
function setLiveStatus(t){const e=liveStatusEl();if(e)e.textContent=t;}
async function sendSignal(id,sender,recipient,kind,payload){try{await j('/api/listings/'+id+'/signal',{sender,recipient,kind,payload:typeof payload==='string'?payload:JSON.stringify(payload)});}catch(e){}}
function makePC(){return new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});}
function wirePC(pc,id,peerId){
  pc.onicecandidate=e=>{if(e.candidate)sendSignal(id,liveRole==='seller'?'seller':liveViewerId,peerId,'ice',e.candidate);};
}
function stopLivePoll(){if(livePoll){clearInterval(livePoll);livePoll=null;}}
function stopLiveFull(){
  stopLivePoll(); stopPresence();
  for(const k of Object.keys(livePCs)){try{livePCs[k].close();}catch(e){}}
  livePCs={};
  if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null;}
  liveRemoteStream=null; liveListingId=null; liveRole=null; liveViewerId=null; liveSince=null; liveSeen=new Set();
  liveFacingMode='environment';
  const f=document.getElementById('flipCamBtn'); if(f)f.style.display='none';
  const b=document.getElementById('endLiveBtn'); if(b)b.style.display='none';
}
async function pollSignals(id){
  let rows=[]; try{rows=await j('/api/listings/'+id+'/signal?since='+encodeURIComponent(liveSince||new Date(0).toISOString()));}catch(e){return;}
  if(!Array.isArray(rows))return;
  for(const s of rows){
    if(liveSeen.has(s.id))continue; liveSeen.add(s.id);
    if(liveRole==='seller'){
      if(s.recipient!=='seller')continue;
      if(s.kind==='join'&&s.sender){ // a viewer wants to watch — offer them the stream
        const pc=makePC(); livePCs[s.sender]=pc; wirePC(pc,id,s.sender);
        if(liveStream)liveStream.getTracks().forEach(t=>pc.addTrack(t,liveStream));
        try{const offer=await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal(id,'seller',s.sender,'offer',offer);}catch(e){}
      } else if(s.kind==='answer'&&livePCs[s.sender]){
        try{await livePCs[s.sender].setRemoteDescription(new RTCSessionDescription(JSON.parse(s.payload)));}catch(e){}
      } else if(s.kind==='ice'&&livePCs[s.sender]){
        try{await livePCs[s.sender].addIceCandidate(new RTCIceCandidate(JSON.parse(s.payload)));}catch(e){}
      } else if(s.kind==='leave'&&livePCs[s.sender]){try{livePCs[s.sender].close();}catch(e){} delete livePCs[s.sender];}
    } else if(liveRole==='viewer'){
      if(s.recipient!==liveViewerId)continue;
      if(s.kind==='offer'){
        try{
          const pc=makePC(); livePCs.seller=pc; wirePC(pc,id,'seller');
          pc.ontrack=e=>{liveRemoteStream=e.streams[0]; const v=liveVideoEl(); if(v){v.srcObject=liveRemoteStream; v.muted=false; v.style.display='block'; v.play().catch(()=>{const b=document.getElementById('unmuteBtn'); if(b)b.style.display='inline-block';});} setLiveStatus('🔴 LIVE — watching the seller now. You can hear them talking. Type in chat what you want to see.');};
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(s.payload)));
          const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
          sendSignal(id,liveViewerId,'seller','answer',answer);
        }catch(e){}
      } else if(s.kind==='ice'&&livePCs.seller){
        try{await livePCs.seller.addIceCandidate(new RTCIceCandidate(JSON.parse(s.payload)));}catch(e){}
      }
    }
  }
}
async function startViewer(id){
  liveRole='viewer'; liveViewerId='v-'+Math.random().toString(36).slice(2,10); liveSince=new Date().toISOString();
  setLiveStatus('Connecting to the seller\'s live video…');
  await sendSignal(id,liveViewerId,'seller','join',{});
  stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
}
async function startSellerPoll(id){
  liveSince=new Date().toISOString();
  stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
}
// ---------- Watching count (Kevin, 2026-11-19) ----------
// The seller sees how many people are in their room, in the site's own
// gold + dark navy design. Everyone with the room open checks in every 15
// seconds; the count line refreshes on the same beat, seller only.
let presenceTimer=null, presenceId=null;
async function presencePing(id,leave){
  if(!currentUser)return;
  try{await j('/api/listings/'+id+'/presence',leave?{leave:true}:{});}catch(e){}
  if(!leave)refreshWatching(id);
}
async function refreshWatching(id){
  const el=document.getElementById('watchingLine'); if(!el)return;
  try{const l=await j('/api/listings/'+id); if(l&&typeof l.watching==='number')el.textContent=`👥 ${l.watching} watching now`;}catch(e){}
}
function startPresence(id){
  if(presenceId===id&&presenceTimer)return;
  stopPresence();
  presenceId=id; presencePing(id);
  presenceTimer=setInterval(()=>presencePing(id),15000);
}
function stopPresence(){
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
  if(presenceId){const id=presenceId; presenceId=null; presencePing(id,true);}
}
// ---------- Time Wheel (Kevin's own design — a clock-face wheel, gold + dark navy) ----------
// Items sit around the wheel like numbers on a clock; a gold hand at the top
// points at the landed item. Nobody buys a spot, nobody pays to spin — the
// winner pays the winning bid + shipping, the wheel lands on ONE item, and
// that item is what they get. No extra prize, no extra charge.
// Styled like the clock in the site logo (ornate gold pocket watch on dark
// navy): a winder crown + bow on top, 12 gold hour ticks and minute dots
// around the dial, and two gold clock hands at 10:10 in the middle.
function wheelAngle(i,n){return n?i*360/n:0;}
function wheelSVG(l,rotDeg,hideNames,sizePx){
  const items=l.wheel_items||[];
  if(!items.length&&!hideNames)return '<p class="small">No items on this wheel yet.</p>';
  const n=items.length, cx=160, cy=160, r=118;
  const font=n<=12?13:n<=24?11:n<=48?9:7;
  let texts='';
  // Kevin 2026-11-19: names stay hidden on the wheel until it spins.
  if(!hideNames)items.forEach((it,i)=>{
    const a=wheelAngle(i,n)*Math.PI/180;
    const x=cx+r*Math.sin(a), y=cy-r*Math.cos(a);
    const label=String(it.name||'').slice(0,18);
    texts+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#f5d76e" font-size="${font}" font-weight="700" transform="rotate(${wheelAngle(i,n)} ${x.toFixed(1)} ${y.toFixed(1)})">${escHtml(label)}</text>`;
  });
  // Fancy spade hands, like the pocket-watch picture: narrow at the base,
  // a wide diamond near the tip, then a point. 10:10, as in the picture.
  function fancyHand(deg,len,w){
    const a=deg*Math.PI/180, dx=Math.sin(a), dy=-Math.cos(a), px=Math.cos(a), py=Math.sin(a);
    const p=(d,off)=>`${(cx+dx*d+px*off).toFixed(1)},${(cy+dy*d+py*off).toFixed(1)}`;
    return `<polygon points="${p(0,-w*0.55)} ${p(len*0.55,-w*0.8)} ${p(len*0.72,-w*1.7)} ${p(len,0)} ${p(len*0.72,w*1.7)} ${p(len*0.55,w*0.8)} ${p(0,w*0.55)}" fill="#0b1f3a"/>`;
  }
  // A small gold gear, like the ones either side of the watch in the picture.
  function gear(gx,gy,gr){
    let teeth='';
    for(let k=0;k<8;k++){
      const a=k*45*Math.PI/180;
      teeth+=`<line x1="${(gx+gr*Math.sin(a)).toFixed(1)}" y1="${(gy-gr*Math.cos(a)).toFixed(1)}" x2="${(gx+(gr+3)*Math.sin(a)).toFixed(1)}" y2="${(gy-(gr+3)*Math.cos(a)).toFixed(1)}" stroke="#c9a227" stroke-width="2.5" stroke-linecap="round"/>`;
    }
    return `${teeth}<circle cx="${gx}" cy="${gy}" r="${gr}" fill="none" stroke="#c9a227" stroke-width="2.5"/><circle cx="${gx}" cy="${gy}" r="2.5" fill="#c9a227"/>`;
  }
  // A gold filigree curl, like the scrolls around the watch in the picture.
  function scroll(sx,sy,rot){
    return `<g transform="translate(${sx} ${sy}) rotate(${rot})"><path d="M 8 2 A 8 8 0 1 1 -6 -6 A 4.5 4.5 0 1 0 2 -2" fill="none" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/><circle cx="2" cy="-2" r="1.6" fill="#c9a227"/></g>`;
  }
  // The clock face, like the pocket-watch picture: cream face, ornate gold
  // bezel, minute track, Roman numerals.
  const numerals=['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
  let face='';
  for(let m=0;m<60;m++){
    const a=m*6*Math.PI/180, q=m%5===0;
    face+=`<line x1="${(cx+68*Math.sin(a)).toFixed(1)}" y1="${(cy-68*Math.cos(a)).toFixed(1)}" x2="${(cx+(q?73:71)*Math.sin(a)).toFixed(1)}" y2="${(cy-(q?73:71)*Math.cos(a)).toFixed(1)}" stroke="#0b1f3a" stroke-width="${q?2:1.2}" stroke-linecap="round"/>`;
  }
  numerals.forEach((num,h)=>{
    const a=h*30*Math.PI/180;
    face+=`<text x="${(cx+58*Math.sin(a)).toFixed(1)}" y="${(cy-58*Math.cos(a)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#0b1f3a" font-size="15" font-weight="700" font-family="Georgia,'Times New Roman',serif">${num}</text>`;
  });
  return `<svg viewBox="0 -32 320 388" style="width:100%;max-width:${sizePx||340}px;display:block;margin:0 auto">
  <circle cx="160" cy="160" r="152" fill="#0b1f3a" stroke="#c9a227" stroke-width="5"/>
  <circle cx="160" cy="160" r="146" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.5"/>
  <path d="M279.5,229 A138,138 0 1 1 62.4,62.4" fill="none" stroke="#c9a227" stroke-width="12" stroke-linecap="round"/>
  <path d="M270.8,224 A128,128 0 1 1 69.5,69.5" fill="none" stroke="#c9a227" stroke-width="2" opacity="0.55"/>
  <polygon points="47.4,53.8 79.5,55.6 65.1,80.6" fill="#c9a227"/>
  <g id="wheelDial" style="transform-origin:160px 160px;transform:rotate(${rotDeg||0}deg)">${texts}</g>
  ${gear(70,160,9)}${gear(250,160,9)}
  ${scroll(90,90,45)}${scroll(230,90,-45)}${scroll(90,230,135)}${scroll(230,230,-135)}
  <circle cx="160" cy="160" r="85" fill="none" stroke="#c9a227" stroke-width="1.5"/>
  <circle cx="160" cy="160" r="80" fill="#f7ead0" stroke="#c9a227" stroke-width="6"/>
  <circle cx="160" cy="160" r="74" fill="none" stroke="#0b1f3a" stroke-width="1"/>
  ${face}
  ${fancyHand(305,40,4.5)}${fancyHand(60,54,4)}
  <circle cx="160" cy="160" r="5.5" fill="#c9a227"/>
  <circle cx="160" cy="160" r="2" fill="#0b1f3a"/>
  <path d="M118,208 C128,224 138,232 148,228 C152,238 156,246 160,250 C164,240 168,232 176,228 C188,232 198,222 202,208 C192,220 176,224 160,224 C144,224 128,220 118,208 Z" fill="#c9a227"/>
  <path d="M140,246 C138,254 142,258 140,263" fill="none" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <circle cx="140" cy="266" r="3" fill="#c9a227"/>
  <path d="M160,250 C158,256 162,259 160,262" fill="none" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <circle cx="160" cy="265" r="3" fill="#c9a227"/>
  <path d="M180,246 C182,252 178,256 180,261" fill="none" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <circle cx="180" cy="264" r="3" fill="#c9a227"/>
  <circle cx="120" cy="258" r="2.5" fill="#c9a227"/>
  <circle cx="205" cy="252" r="2" fill="#c9a227"/>
  <g><line x1="112" y1="300" x2="132" y2="292" stroke="#c9a227" stroke-width="1.5"/><ellipse cx="116" cy="296" rx="7" ry="3" fill="#c9a227" transform="rotate(-30 116 296)"/><ellipse cx="124" cy="293" rx="7" ry="3" fill="#c9a227" transform="rotate(-15 124 293)"/><ellipse cx="130" cy="290" rx="6" ry="2.6" fill="#c9a227" transform="rotate(0 130 290)"/></g>
  <g><line x1="208" y1="300" x2="188" y2="292" stroke="#c9a227" stroke-width="1.5"/><ellipse cx="204" cy="296" rx="7" ry="3" fill="#c9a227" transform="rotate(30 204 296)"/><ellipse cx="196" cy="293" rx="7" ry="3" fill="#c9a227" transform="rotate(15 196 293)"/><ellipse cx="190" cy="290" rx="6" ry="2.6" fill="#c9a227" transform="rotate(0 190 290)"/></g>
  <path d="M160,295 L162.5,300.5 L168,303 L162.5,305.5 L160,311 L157.5,305.5 L152,303 L157.5,300.5 Z" fill="#f5d76e"/>
  <line x1="132" y1="318" x2="132" y2="350" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <line x1="188" y1="318" x2="188" y2="350" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <circle cx="132" cy="318" r="3" fill="#c9a227"/><circle cx="132" cy="350" r="3" fill="#c9a227"/><circle cx="188" cy="318" r="3" fill="#c9a227"/><circle cx="188" cy="350" r="3" fill="#c9a227"/>
  <path d="M142,316 L178,316 L166,334 L178,352 L142,352 L154,334 Z" fill="none" stroke="#c9a227" stroke-width="3"/>
  <path d="M146,318 L174,318 L160,330 Z" fill="#c9a227" opacity="0.45"/>
  <path d="M146,350 L174,350 L160,338 Z" fill="#c9a227" opacity="0.9"/>
  <line x1="138" y1="316" x2="182" y2="316" stroke="#c9a227" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="138" y1="352" x2="182" y2="352" stroke="#c9a227" stroke-width="3.5" stroke-linecap="round"/>
  <ellipse cx="160" cy="353" rx="26" ry="2.5" fill="none" stroke="#c9a227" stroke-width="2"/>
  <polygon points="160,2 148,26 172,26" fill="#f5d76e" stroke="#c9a227" stroke-width="1"/></svg>`;
}
// Kevin 2026-11-19: the giveaway entry sits in the corner of the live show,
// not in the chat they type in — tap the small wheel and you're in. It only
// shows while the seller is live (the giveaway is only offered when live),
// while entries are still open, and never to the seller — they run it, they
// don't enter it.
function cornerWheelHTML(l){
  const isSeller=currentUser&&l.seller_user_id?currentUser.id===l.seller_user_id:currentUser&&currentUser.name===l.seller;
  if(l.type!=='wheel'||isSeller||!l.seller_live||l.wheel_spun||l.status==='ended')return '';
  const n=(l.wheel_entries||[]).length;
  const entered=!!l.wheel_entered;
  const names=(l.wheel_entries||[]).map(x=>({name:x.name}));
  return `<div id="cornerWheel"${entered?'':` onclick="enterWheel('${l.id}')"`} style="position:absolute;top:8px;right:8px;width:84px;text-align:center;${entered?'':'cursor:pointer;'}z-index:5">
  ${wheelSVG({...l,wheel_items:names},0,true,80)}
  <span style="display:inline-block;background:${entered?'#2e7d32':'#c9a227'};color:${entered?'#fff':'#0b1f3a'};border-radius:20px;padding:2px 8px;font-size:11px;font-weight:800;margin-top:2px">${entered?'✓ You are in — '+n+' in':'⏰ '+n+' in — tap to enter'}</span>
  </div>`;
}
function wheelPanel(l){
  // FREE giveaway: the wheel holds the NAMES of the people who entered free.
  // Kevin 2026-11-19: names stay hidden until the wheel spins; entry is the
  // small wheel in the corner of the live show (see cornerWheelHTML), not a
  // button in the panel; the wheel pops up big on the screen only when it
  // spins to pick the winner (see spinWheel / wheelOverlayHTML).
  const names=(l.wheel_entries||[]).map(x=>({name:x.name}));
  const showNames=!!l.wheel_spun;
  const landedIdx=names.findIndex(x=>x.name===l.wheel_landed_item);
  const rot=l.wheel_spun&&landedIdx>=0?-wheelAngle(landedIdx,names.length):0;
  const isSeller=currentUser&&l.seller_user_id?currentUser.id===l.seller_user_id:currentUser&&currentUser.name===l.seller;
  const isWinner=currentUser&&l.winner&&currentUser.name===l.winner;
  let status='';
  if(l.wheel_spun&&l.wheel_landed_item){
    status=`<p><b>⏰ The wheel landed on: ${escHtml(l.wheel_landed_item)}</b> — they win <b>${escHtml(l.title)}</b> FREE!</p>`
      +(isWinner?`<p><b>You won!</b> The seller will ship it to the address on your account — no payment, nothing to pay.</p>`:'')
      +(isSeller?`<p><b>Seller — ship it to (locked at win): ${escHtml(l.winner_address||'—')}</b><br>Carrier: <b>${escHtml(l.carrier||'')}</b> • Tracking: <b>${escHtml(l.tracking||'—')}</b> (test label only, no real carrier connected yet).<br>${l.shipped_at?`<span class="badge green">Marked as shipped ${escHtml(l.shipped_at)}</span>`:`<button class="btn" onclick="markShipped('${l.id}')">Mark as shipped</button>`}</p>`:'');
  } else if(l.status==='ended'){
    status=`<p class="small">Entries closed — nobody entered, so the wheel had no names to land on.</p>`;
  } else {
    status=`<p class="small">FREE giveaway — enter free and your name goes on the wheel. Entries stay open until the timer runs out, then the wheel spins itself — or the seller spins it by hand. The winner gets this item free.</p>`
      +(l.wheel_entered?`<p><b>You are on the wheel!</b> One entry per person.</p>`:(l.seller_live?`<p class="small">Tap the ⏰ wheel in the corner of the live show to enter free.</p>`:`<p class="small">The giveaway opens when the seller goes live — the wheel will sit in the corner of the live show.</p>`))
      +(isSeller&&names.length?` <button class="btn ghost" onclick="spinWheel('${l.id}')">Spin the Time Wheel</button>`:'');
  }
  return `<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px;background:#0b1f3a">
  <h3 style="color:#f5d76e;margin-top:0">⏰ Time Wheel — ${names.length} name${names.length===1?'':'s'} on the wheel</h3>
  <p class="small" style="color:#f5d76e">Free giveaway — nobody pays, nobody buys a spot. The winner gets this item free.</p>
  ${wheelSVG({...l,wheel_items:names},rot,!showNames,220)}
  ${status}
  <p id="wheelMsg" class="small"></p>
  ${showNames?`<details><summary class="small">See all ${names.length} names on the wheel</summary><ol class="small">${names.map(x=>`<li>${escHtml(x.name)}</li>`).join('')}</ol></details>`:''}
  </div>`;
}
// Kevin 2026-11-19: when the wheel spins to pick the winner it pops up big
// on the screen. Big overlay with the names on it, spins ~4s, then the winner
// pops up. Closing it shows the room again with the landed wheel.
function wheelOverlayHTML(l){
  const names=(l.wheel_entries||[]).map(x=>({name:x.name}));
  return `<div id="wheelOverlay" style="position:fixed;inset:0;background:rgba(4,12,26,.97);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;overflow:auto">
  <h2 style="color:#f5d76e;margin:0 0 8px">⏰ Time Wheel</h2>
  <div style="width:100%;max-width:560px">${wheelSVG({...l,wheel_items:names},0,false,560)}</div>
  <p id="wheelOverlayMsg" class="small" style="color:#f5d76e">Spinning…</p>
  <p id="wheelOverlayLanded" style="display:none;background:rgba(201,162,39,.2);border:1px solid #c9a227;border-radius:8px;padding:10px"><b>⏰ The wheel landed on: ${escHtml(l.wheel_landed_item||'')}</b> — they win <b>${escHtml(l.title)}</b> FREE!</p>
  <button class="btn" id="wheelOverlayClose" style="display:none" onclick="closeWheelOverlay('${l.id}')">Close</button>
  </div>`;
}
function closeWheelOverlay(id){
  const ov=document.getElementById('wheelOverlay');
  if(ov)ov.remove();
  openItem(id);
}
async function enterWheel(id){
  if(needSignIn())return;
  await presencePing(id); // make sure this room-open check-in has landed first
  const r=await j('/api/listings/'+id+'/enter',{});
  if(!r.ok){alert('Error: '+r.error);return;}
  alert('You are in! Your name is on the wheel.');
  openItem(id);
}
async function spinWheel(id){
  if(needSignIn())return;
  const name=authName();
  const r=await j('/api/listings/'+id+'/spin',{},sellerHeaders(name)); noteSellerToken(name,r);
  if(!r.ok){alert('Error: '+r.error);return;}
  const l=await j('/api/listings/'+id);
  const names=l.wheel_entries||[];
  const idx=Math.max(0,names.findIndex(x=>x.name===r.landedName));
  const target=360*6-wheelAngle(idx,names.length||1);
  // Kevin 2026-11-19: names were hidden until now, and the wheel was small in
  // the room — pop it up big on the screen to spin and pick the winner.
  const old=document.getElementById('wheelOverlay');
  if(old)old.remove();
  const wrap=document.createElement('div');
  wrap.innerHTML=wheelOverlayHTML(l);
  document.body.appendChild(wrap.firstChild);
  const ov=document.getElementById('wheelOverlay');
  const dial=ov?ov.querySelector('#wheelDial'):null;
  if(dial){dial.style.transition='transform 4s cubic-bezier(.15,.8,.25,1)';dial.style.transform=`rotate(${target}deg)`;}
  setTimeout(()=>{
    const m=document.getElementById('wheelOverlayMsg'); if(m)m.textContent='';
    const landed=document.getElementById('wheelOverlayLanded'); if(landed)landed.style.display='block';
    const close=document.getElementById('wheelOverlayClose'); if(close)close.style.display='block';
  },4300);
}
// Start settings memory (Kevin, 2026-11-21): when the room switches to the
// next Random Item, the Start panel shows what was used LAST time — so if
// the seller runs them all the same, they just hit "Start auction" and it
// goes with the same start bid, time and mode, no re-typing it 59 times.
// Saved in localStorage so it survives a page reload. If nothing was ever
// set, the panel falls back to what the item was listed with.
function lastStartFor(l){
  let s=null; try{s=JSON.parse(localStorage.getItem('btb_last_start')||'null');}catch(e){}
  const sp=(s&&typeof s.startPrice==='number')?s.startPrice:(l.current_bid||l.start_price||0);
  const ts=(s&&typeof s.timerSeconds==='number')?s.timerSeconds:(l.timer_seconds||30);
  const md=(s&&s.mode)?s.mode:(l.mode||'Sudden Death');
  return {startPrice:sp,timerSeconds:ts,mode:md};
}
function saveLastStart(b){
  try{
    let cur={}; try{cur=JSON.parse(localStorage.getItem('btb_last_start')||'{}');}catch(e){}
    const next={startPrice:(typeof b.startPrice==='number')?b.startPrice:cur.startPrice,timerSeconds:(typeof b.timerSeconds==='number')?b.timerSeconds:cur.timerSeconds,mode:b.mode||cur.mode};
    localStorage.setItem('btb_last_start',JSON.stringify(next));
  }catch(e){}
}
async function openItem(id){
  // Fetch first so we know whose item this is. When the live seller moves
  // to their own next item (auto-advance: Random Item 1 ends, the room goes
  // to Random Item 2), the camera KEEPS running — the show goes on, it does
  // not cut out. Only stop the stream when leaving the show entirely.
  const l=await j('/api/listings/'+id);
  const isSellerRoom=currentUser&&(l.seller_user_id?currentUser.id===l.seller_user_id:currentUser.name===l.seller);
  const sameShow=liveRole==='seller'&&liveStream&&isSellerRoom;
  const wasLive=(liveListingId===id||sameShow)&&(liveRole==='seller'||liveRole==='viewer');
  if(!wasLive)stopLiveFull(); else stopLivePoll(); // re-render keeps the stream/PCs, restarts polling below
  if(sameShow){ // moving to your own next item: close the old viewer
    // connections (viewers re-join on the new item), but the camera stream
    // itself keeps running — it is not stopped.
    for(const k of Object.keys(livePCs)){try{livePCs[k].close();}catch(e){}}
    livePCs={};
  }
  liveListingId=id; lastAutoAdvanceId=null;
  // The Start panel (queued item, seller view) shows the start settings
  // used last time, so running them all the same is one tap on Start.
  const st=lastStartFor(l);
  // Private messages about this item (Kevin, 2026-11-20): only the buyer
  // and the seller ever see them. The seller sees every buyer's thread;
  // a buyer only sees their own thread with this seller.
  let pms=[]; if(currentUser){try{const pr=await j('/api/listings/'+id+'/messages'); if(Array.isArray(pr))pms=pr;}catch(e){}}
  startPresence(id);
  // The timer, the clock bid button and the custom bid sit INSIDE the Live
  // room, right under the video and above the chat — one screen, video +
  // timer + bid + chat, no scrolling to find them (Kevin, 2026-11-21: the
  // room was all over the place). This reverses the 2026-11-20 bottom
  // placement. Same ids (cdWrap, cdState, bAmt, tlAmt) so the hourglass
  // tick and the bid buttons keep working.
  const bidBox=(l.type==='auction'&&l.status!=='queued')?`<div style="border:2px solid #c9a227;border-radius:12px;padding:12px;margin-top:10px"><div class="hg-room-wrap" id="cdWrap">${hourglassSVG('room-'+l.id,l.ends_at,l.created_at,'hg-room')}</div><p class="small hg-state" id="cdState"></p><p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>
  <button onclick="bid('${l.id}',1)" title="Tap to bid $1 more" style="width:104px;height:104px;border-radius:50%;border:4px solid #c9a227;background:#0a1628;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px"><svg width="52" height="52" viewBox="0 0 100 100" style="display:block"><circle cx="50" cy="50" r="44" fill="none" stroke="#c9a227" stroke-width="4"/><line x1="50" y1="50" x2="50" y2="24" stroke="#f5d76e" stroke-width="5" stroke-linecap="round"/><line x1="50" y1="50" x2="70" y2="50" stroke="#f5d76e" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="5" fill="#f5d76e"/></svg><span style="color:#f5d76e;font-weight:bold;font-size:16px">+$1</span></button>
  <p class="small">Tap the clock to bid $1 more.</p>
  <button class="btn" onclick="toggleCustomBid()">Custom bid</button>
  <div id="customBidBox" style="display:none;margin-top:8px"><label>Your bid $ <input id="bAmt" type="number" value="${l.current_bid+1}" onkeydown="if(event.key==='Enter')bidCustom('${l.id}',${l.current_bid})"></label>
  <button class="btn" onclick="bidCustom('${l.id}',${l.current_bid})">Bid</button>
  <p class="small" id="customBidMsg"></p></div>
  <p class="small">My Top Limit: set a max and the system bids the smallest step for you.</p>
  <label>My Top Limit $ <input id="tlAmt" type="number"></label><button class="btn ghost" onclick="setTop('${l.id}')">Set My Top Limit</button></div>`:'';
  const el=document.getElementById('detail'); el.scrollIntoView();
  el.innerHTML=`<div class="card">${l.image_url?`<img src="${escHtml(l.image_url)}" style="max-width:100%;border-radius:10px" alt="${escHtml(l.title)}">`:''}<h2>${escHtml(l.title)}</h2>${noComBadge(l)}${noComNote(l)}${l.is_random?`<p><span class="badge gold">🎲 RANDOM ITEM — no picture, seller shows it live on camera</span></p>`:''}<p>${escHtml(l.description||'')} • ${escHtml(l.category)} • ${escHtml(l.authenticity)} • <b>Condition: ${escHtml(conditionOf(l))}</b> • Seller: ${sellerPhotoImg(l.seller_photo,28)}${escHtml(l.seller)}</p><span id="keepTrackBox"></span>
  ${l.is_random&&l.revealed_item?`<p><b>🎲 Revealed live on camera: ${escHtml(l.revealed_item)}</b>${l.winner?` — that is what ${escHtml(l.winner)} won.`:''}</p>`:''}
  ${l.type==='wheel'?wheelPanel(l):''}
  ${l.type==='wheel'?(l.status==='queued'
  ?`<p><b>⏳ Waiting to start — no timer running yet.</b></p>${isSellerRoom?`<button class="btn green" style="font-size:18px;padding:14px 22px" onclick="startAuction('${l.id}')">▶ Start giveaway — ${l.timer_seconds||30} seconds</button><p class="small">Tap Start when you're ready. The timer starts then, and only this giveaway runs.</p>`:`<p class="small">The seller starts this giveaway when they're ready — stay in the room.</p>`}<p><b>FREE giveaway — no bidding.</b> Shipping $${l.shipping} is covered by the seller — the winner pays nothing.</p>`
  :`<div class="hg-room-wrap" id="cdWrap">${hourglassSVG('room-'+l.id,l.ends_at,l.created_at,'hg-room')}</div><p class="small hg-state" id="cdState"></p><p><b>FREE giveaway — no bidding.</b> Entries stay open until the timer runs out. Shipping $${l.shipping} is covered by the seller — the winner pays nothing.</p>`)
  :l.type==='auction'?(l.status==='queued'
  ?`<p><b>⏳ Waiting to start — no timer running yet.</b></p>${isSellerRoom?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin:8px 0"><h3 style="margin-top:0">▶ Start this item</h3><p><b>${escHtml(l.title)}</b> — runs the same as the last one: Start at $${st.startPrice} • ${st.timerSeconds} seconds • ${st.mode}.</p><button class="btn green" style="font-size:18px;padding:14px 22px" onclick="startAuction('${l.id}')">▶ Start auction</button> <button class="btn ghost" id="startMenuBtn" style="padding:14px 14px;font-size:20px;line-height:1" onclick="toggleStartMenu()" title="Change start settings">⋯</button><div id="startMenu" style="display:none;margin-top:10px"><p class="small">Tap to change it — start bid, time, Regular or Sudden Death. The timer starts when you tap Start auction.</p><p class="small"><b>Start at</b></p><div class="tiles"><input type="hidden" id="startBid" value="${st.startPrice}">${[1,5,10,25,50,100].map(v=>`<span class="tile${st.startPrice===v?' active':''}" onclick="pickStart('bid',${v},this)">$${v}</span>`).join('')}<span class="tile${![1,5,10,25,50,100].includes(st.startPrice)?' active':''}" onclick="pickStart('bid','custom',this)">Custom</span></div><div id="startBidCustomWrap" style="display:${![1,5,10,25,50,100].includes(st.startPrice)?'block':'none'};margin-top:8px"><label>Custom start $ <input id="startBidCustom" type="number" min="0" value="${st.startPrice}" oninput="document.getElementById('startBid').value=this.value"></label></div><p class="small"><b>How long</b></p><div class="tiles"><input type="hidden" id="startTimer" value="${[10,30,120].includes(st.timerSeconds)?st.timerSeconds:'custom'}"><span class="tile${st.timerSeconds===10?' active':''}" onclick="pickStart('time',10,this)">10 seconds</span><span class="tile${st.timerSeconds===30?' active':''}" onclick="pickStart('time',30,this)">30 seconds</span><span class="tile${st.timerSeconds===120?' active':''}" onclick="pickStart('time',120,this)">2 minutes</span><span class="tile${![10,30,120].includes(st.timerSeconds)?' active':''}" onclick="pickStart('time','custom',this)">Custom</span></div><div id="startTimerCustom" style="display:${![10,30,120].includes(st.timerSeconds)?'block':'none'};margin-top:8px"><label>Seconds (5–3600) <input id="startTimerSecs" type="number" min="5" max="3600" value="${st.timerSeconds}"></label></div><p class="small"><b>Mode</b></p><div class="tiles"><input type="hidden" id="startMode" value="${st.mode}"><span class="tile${st.mode==='Sudden Death'?' active':''}" onclick="pickStart('mode','Sudden Death',this)">Sudden Death</span><span class="tile${st.mode==='Regular'?' active':''}" onclick="pickStart('mode','Regular',this)">Regular</span></div><p class="small">Sudden Death — an outbid does not reset the timer. Regular — an outbid adds 10 seconds.</p></div></div>`:`<p class="small">The seller starts this auction when they're ready — stay in the room.</p>`}<p>Starting bid $${l.current_bid} • Shipping $${l.shipping}</p>`
  :`<p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>`)
  :`<p>Store price $${l.fixed_price} + $${l.shipping} shipping = $${l.fixed_price+l.shipping} total</p>
  <p class="small">Pays with your saved payment method from My Profile — no payment details in the room. ${currentUser&&currentUser.paymentMethod?`Saved: <b>${escHtml(currentUser.paymentMethod)}</b>.`:'<b>Set it in My Profile first</b> — tap My Profile, then Payment method.'}</p>
  <button class="btn green" onclick="buyNow('${l.id}')">Buy Now — check my payment first</button>`}
  ${l.status==='ended'&&l.type!=='wheel'?`<p><b>Winner: ${escHtml(l.winner||'—')}</b> — ${l.payment_status==='validated'?'Payment went through — in escrow hold':l.payment_status==='declined'?'Payment declined — buyer needs to fix payment':'Waiting for winner payment'}</p>
  ${l.payment_status==='declined'?`<div style="background:#c62828;padding:14px;border-radius:10px"><h3>PAYMENT DIDN'T GO THROUGH! Don't lose this sale — pick one</h3><button class="btn" onclick="fixPay('${l.id}')">Fix Payment</button><button class="btn" onclick="rerun('${l.id}','${escJs(l.seller)}')">Rerun Auction</button></div>`:''}
  <p class="small">Pays with your saved payment method from My Profile — no payment details in the room. ${currentUser&&currentUser.paymentMethod?`Saved: <b>${escHtml(currentUser.paymentMethod)}</b>.`:'<b>Set it in My Profile first</b> — tap My Profile, then Payment method.'}</p><button class="btn" onclick="payWinner('${l.id}')">Pay now</button>`:''}
  ${l.payout?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>💰 Seller payout — ${escHtml(l.payout.tier)} seller</h3>${l.payout.incorrectClaims?`<p><b>Incorrect return claims: ${l.payout.incorrectClaims}</b> — ${l.payout.banned?'selling privileges removed — this seller cannot sell on the site again.':l.payout.canSell?'suspension ended — selling is open again.':'selling privileges suspended until <b>'+new Date(l.payout.suspendedUntil).toLocaleString()+'</b> — listings are hidden and no new items can be listed until then.'}</p>`:''}${l.payout.badListingStrikes?`<p><b>Confirmed bad listings: ${l.payout.badListingStrikes}</b> — listings the owner confirmed were fake, stolen or banned items.</p>`:''}<p><b>${escHtml(l.seller)}</b> has <b>${l.payout.cleanSales} clean sale${l.payout.cleanSales===1?'':'s'}</b>${l.payout.score!==null?` • Seller Scorecard: ${l.payout.score}/5`:''}${l.payout.nextTier?` • <b>${l.payout.salesToNext} more clean sale${l.payout.salesToNext===1?'':'s'}</b> to ${escHtml(l.payout.nextTier)}`:' • top tier — fastest payout on everything'}.<br>Sale amount $${l.payout.amount} — payout <b>${l.payout.payoutLabel} after delivery</b>${l.payout.payoutAt?` — <b>payout date: ${new Date(l.payout.payoutAt).toLocaleString()}</b>`:' (payout date is set once delivery is confirmed)'}${l.escrow_status==='released'?` — <b>paid out</b>`:''}.</p><p class="small">The refund window runs until this payout date — legit reason + photo + video only, and no refund after that date. A payout never comes out while a refund is pending. Test mode: this is a tracked payout date, not a real bank transfer — no real payment processor is connected yet.</p></div>`:''}
  ${l.status==='sold'&&l.delivered_at&&l.payment_status==='validated'?(()=>{const dl=l.payout&&l.payout.payoutAt?new Date(l.payout.payoutAt):null;const closed=l.escrow_status==='released'||(dl&&new Date()>=dl);const rf=l.refund;if(rf&&rf.status!=='expired'){return `<div style="border:3px solid #c62828;border-radius:10px;padding:12px;margin-top:10px"><h3>↩️ Refund request — ${escHtml(rf.requester||'Buyer')} • ${escHtml(rf.reason||'')}</h3>${rf.status==='approved'?`<p><b>Refund given.</b> ${rf.return_choice==='want_back'?(rf.return_delivered_at?`The seller asked for the item back, the buyer shipped it back, and the return was scanned as DELIVERED on ${new Date(rf.return_delivered_at).toLocaleString()} — the refund released 48 hours after delivery (or after the seller confirmed), no seller tap needed for the delivery record.`:(rf.dispute_status==='correct'?'The owner reviewed the proof and the item sent back is the correct item — the claim was not upheld, so the refund was released.':'The seller asked for the item back, the buyer shipped it back, and the seller confirmed they received it — then the refund was released.')):'The seller agreed to refund without the item back — the buyer keeps the item.'} The refund came out of the seller's escrow money, not the owner's fees.</p>`:rf.status==='awaiting_return'?`<p><b>The seller wants the item back first — no refund until they receive it. Marking it delivered starts the 48-hour clock — the refund releases 48 hours after delivery if the seller does not confirm.</b><br>Return label: <b>${escHtml(rf.return_label_carrier||'')} ${escHtml(rf.return_label_tracking||'')}</b> (code ${escHtml(rf.return_label_code||'')}) — test label only, no real carrier connected yet.<br>Return label cost: <b>$${Number(rf.return_cost||0).toFixed(2)}</b> — paid by the seller, because the seller asked for the item back. Not the buyer's cost, not the owner's fees.<br>${rf.return_shipped_at?`Return shipped ${new Date(rf.return_shipped_at).toLocaleString()} — tracking ${escHtml(rf.return_tracking||rf.return_label_tracking||'')} — waiting for the seller to confirm they got it back.<br><b>If the seller does not confirm, the refund releases on its own ${rf.returnAutoReleaseAt?new Date(rf.returnAutoReleaseAt).toLocaleString():'48 hours after delivery'}</b> — the seller cannot stall it by not tapping. In test mode delivery is recorded from the tracking / mark-as-delivered step below — no live carrier feed yet; at go-live a real carrier delivery scan does this automatically.`:`The buyer has not shipped the return back yet. If it is not shipped back before the refund window closes (${dl?dl.toLocaleString():'the payout date'}), the refund expires and no refund is given.`}</p><label>Return tracking (the return label tracking is already filled in) <input id="retTrack" value="${escHtml(rf.return_label_tracking||'')}"></label><p class="small"><b>Before you mark it shipped:</b> send a video of the item going into the box + a picture of the label on the same box when sent out. The video proves what went in; the label picture proves that same box with that label is the one that was sent. The return cannot be marked shipped without both.</p><label>Video — item going into the box <input id="retVideo" type="file" accept="video/*" onchange="returnPick()"></label><label>Picture — the return label on the same box when sent out <input id="retPhoto" type="file" accept="image/*" onchange="returnPick()"></label><p class="small" id="retProofMsg">Attach BOTH the video and the label picture — the button stays locked until both are attached.</p><button class="btn" id="retBtn" disabled onclick="returnShipped('${rf.id}')">I shipped the return back</button>${rf.return_shipped_at?` <button class=\"btn ghost\" onclick=\"returnDelivered('${rf.id}')\">Mark return as delivered (carrier scan)</button><div style="border:2px dashed #c62828;border-radius:10px;padding:10px;margin-top:8px"><b>Seller — did the wrong item come back?</b><p class="small">If the wrong item, an empty box, or a different item arrived, tap "Wrong item sent back" and attach BOTH a photo AND a video of what actually arrived. That pauses the refund right away — the 48-hour auto-release stops and the owner decides. No photo + video, no flag. If the claim is not upheld after review, it counts against you: that sale is not a clean sale, you drop a tier, it is recorded on your Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.</p><label>Photo of what arrived <input id="dspPhoto" type="file" accept="image/*" onchange="disputePick()"></label><label>Video of what arrived <input id="dspVideo" type="file" accept="video/*" onchange="disputePick()"></label><p class="small" id="dspProofMsg">Attach BOTH a photo and a video — the button stays locked until both are attached.</p><button class="btn" id="dspBtn" disabled onclick="flagWrongItem('${rf.id}','${escJs(l.seller)}')">Wrong item sent back</button><p id="dspMsg" class="small"></p></div>`:''}<p id="retMsg" class="small"></p>`:rf.status==='disputed'?`<p><b>⚠️ Wrong-item dispute open— refund paused.</b><br>The seller says the wrong item came back — photo: ${escHtml(rf.dispute_photo_name||'—')} • video: ${escHtml(rf.dispute_video_name||'—')}. The 48-hour auto-release is stopped and no refund goes out while the owner decides. The owner compares three things: the buyer's video of the item going into the box + picture of the label on the same box when sent out, the seller's photo + video of what arrived, and the original receipt + video receipt.</p>`:`<p><b>The seller is deciding.</b> It is up to the seller: refund without the item back, or ask for the item back first — then no refund until they receive it. The refund window closes ${dl?dl.toLocaleString():'on the payout date'}.</p>`}</div>`;}return `<div style="border:3px solid #c62828;border-radius:10px;padding:12px;margin-top:10px"><h3>↩️ Ask for a refund</h3>${closed?`<p><b>Refund window closed.</b> Refunds close on the payout date${dl?` (${dl.toLocaleString()})`:''} — after the seller is paid out, no refund. Same rule as always: legit reason only, and a photo + video were required while the window was open.</p>`:`<p style="color:#c62828"><b>Refund window closes ${dl?dl.toLocaleString():'on the payout date'}</b> (${l.payout?l.payout.payoutLabel:''} after delivery) — legit reason only, and you must send BOTH a photo AND a video of the item, or no refund. After that date, no refund.</p><p class="small">It's up to the seller what happens next: they can refund without the item back, or ask for the item back first — then no refund until they receive it. If they ask for it back, a tracked return label is sent to you, paid for by the seller.</p><label>Legit reason <select id="rfReason" onchange="refundPick()"><option value="not as described">Not as described</option><option value="damaged in transit">Damaged in transit</option><option value="wrong item">Wrong item</option><option value="defective">Defective</option><option value="never arrived">Never arrived</option></select></label><p class="small">"Changed my mind" is not accepted — the form only offers legit reasons.</p>${l.no_change_of_mind?`<p><b>This sale is no cancellation — no refund for change of mind.</b> You bid knowing that — bidding is your responsibility. A refund is only for a legit reason (not as described, damaged, wrong item, defective, never arrived), with a photo and video, before the refund window closes.</p>`:''}<label>Photo of the item <input id="rfPhoto" type="file" accept="image/*" onchange="refundPick()"></label><label>Video of the item <input id="rfVideo" type="file" accept="video/*" onchange="refundPick()"></label><p class="small" id="rfProofMsg">Attach BOTH a photo and a video — the button stays locked until both are attached.</p><button class="btn" id="rfBtn" disabled onclick="submitRefund('${l.id}')">Ask for a refund</button><p id="rfMsg" class="small"></p>`}</div>`;})():''}
  <p class="small">Package size: ${l.package_size?shipLabelOf(l.package_size)+' — $'+l.shipping+' shipping (buyer pays)':'Shipping $'+l.shipping+' (buyer pays)'} • <b>${shipViaText(l)}</b></p>
  ${l.qr_text?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>📦 Ship this order — scan the QR code</h3>
  <canvas id="shipQR" style="max-width:100%;background:#fff;border-radius:8px"></canvas>
  <p><b>${escHtml(l.title)}</b>${l.wheel_landed_item?`<br>Item to ship: <b>${escHtml(l.wheel_landed_item)}</b> (what the Time Wheel landed on)`:''}${l.revealed_item?`<br>Item to ship: <b>${escHtml(l.revealed_item)}</b> (revealed live on camera)`:l.is_random?`<br>Item to ship: random item — seller to confirm what it was`:''}<br>Winner: ${escHtml(l.winner)}${l.winner_address?`<br>Ship to (locked at win): <b>${escHtml(l.winner_address)}</b> — this address cannot be changed for this sale`:''}<br>Package: ${l.package_size?shipLabelOf(l.package_size):'—'} • Shipping $${l.shipping}<br><b>Carrier: ${carrierOf(l)}</b> — ${carrierOf(l)==='UPS'?'drop it off at UPS (over 5 lbs)':'drop it off at the post office (USPS)'}<br>Tracking: ${escHtml(l.qr_tracking||l.tracking||'—')}<br>Receipt: ${escHtml(l.qr_receipt||'')}</p>
  <p class="small">Scan this code with your phone — it opens this exact sale, so you ship the right item and don't box up the wrong order. This QR is a shipment record, not real ${carrierOf(l)} postage yet.</p>
  ${l.shipped_at?`<p><span class="badge green">Marked as shipped ${l.shipped_at}</span></p>`:`<button class="btn" onclick="markShipped('${l.id}')">Mark as shipped</button>`}
  <p id="shipMsg" class="small"></p></div>`:''}
  <div id="liveRoomBox" style="border:2px solid #c9a227;border-radius:12px;padding:10px;margin-top:10px">
  <h3 style="margin-top:0">🔴 Live room ${l.seller_live?'<span class="badge">LIVE NOW</span>':''}</h3>
  ${isSellerRoom&&l.seller_live?`<p id="watchingLine" style="color:#f5c542;font-weight:800;margin:6px 0">👥 ${l.watching||0} watching now</p>`:''}
  <div style="position:relative;background:#000;border-radius:10px;min-height:160px">
  <video id="liveVideo" playsinline autoplay style="width:100%;max-height:240px;background:#000;border-radius:10px;display:none"></video>
  ${cornerWheelHTML(l)}
  </div>
  <p id="liveStatus" class="small">${l.seller_live?'Seller is live — connecting to live video…':'Seller is not live yet. When they go live, their camera shows here.'}</p>
  ${isSellerRoom&&!l.seller_live?`<button class="btn green" style="font-size:18px;padding:14px 22px" onclick="goLive('${l.id}')">▶ Go Live — Turn Camera On</button>`:''}
  <button class="btn" id="unmuteBtn" style="display:none" onclick="const v=document.getElementById('liveVideo');v.muted=false;v.play();this.style.display='none'">Tap for sound — hear the seller</button>
  <button class="btn ghost" id="flipCamBtn" style="display:none" onclick="flipCamera()">🔄 Flip camera — front / back</button>
  <button class="btn ghost" id="endLiveBtn" style="display:none" onclick="endLive('${l.id}')">End Live</button>
  ${bidBox}
  <h3 style="margin-bottom:4px">Chat</h3><p class="small">Type in chat what you want the seller to show you. No advertising other auction sites or marketplaces here — links to other sites are not allowed and will be blocked.</p>
  <div class="chat">${l.chats.map(c=>`<p><b>${escHtml(c.name)}${c.is_seller?' (seller)':''}:</b> ${escHtml(c.message)}</p>`).join('')}</div>
  <label>Message <input id="cMsg"></label><button class="btn" onclick="chat('${l.id}')">Post</button>
  ${l.is_random&&isSellerRoom?`<div style="border:2px solid #c9a227;border-radius:10px;padding:10px;margin-top:10px"><h3 style="margin-top:0">🎲 What is this Random Item?</h3>${l.revealed_item?`<p><b>Revealed live on camera: ${escHtml(l.revealed_item)}</b>${l.winner?` — that is what ${escHtml(l.winner)} won.`:''}</p>`:''}<p class="small">Type what you're holding up live, so buyers know what they're bidding on — no scrolling up. This is saved on the receipt.</p><label>What it is <input id="revealedInput" placeholder="e.g. Invicta Lupah watch" value="${escHtml(l.revealed_item||'')}"></label><label>Condition <select id="revealedCond"><option value="">— Pick a condition —</option>${['New','Used – Working','Used – Working Project','Used – Not Working / Project / For Parts'].map(c=>`<option${l.condition===c?' selected':''}>${c}</option>`).join('')}</select></label><button class="btn" onclick="revealItem('${l.id}')">Save what it is</button></div>`:''}
  </div>
  ${pmSection(l,pms)}
  <button class="btn ghost" onclick="showSellerStore('${escJs(l.seller)}')">Visit ${escHtml(l.seller)}'s Store — fixed-price items</button>
  <p><button class="btn ghost" onclick="report('${l.id}')">Report this listing</button> <button class="btn ghost" onclick="score('${escJs(l.seller)}')">Seller Scorecard</button>${ownerPw()?` <button class="btn ghost" onclick="confirmBad('${l.id}')">Confirm bad listing — fake / stolen / banned (owner)</button>`:''}</p>
  <div id="itemMsg"></div></div>`;
  if(l.qr_text)drawQR(l.qr_text,document.getElementById('shipQR'));
  if(l.ends_at){updateHourglasses();}
  // Live video: re-attach after a re-render, or join as a viewer if the seller is live.
  if(wasLive&&liveRole==='seller'&&liveStream){
    const v=liveVideoEl(); if(v){v.srcObject=liveStream; v.style.display='block'; v.play().catch(()=>{});}
    const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
    const f=document.getElementById('flipCamBtn'); if(f)f.style.display='inline-block';
    setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
    startSellerPoll(id);
  } else if(wasLive&&liveRole==='viewer'){
    const v=liveVideoEl(); if(v&&liveRemoteStream){v.srcObject=liveRemoteStream; v.muted=false; v.style.display='block'; v.play().catch(()=>{const b=document.getElementById('unmuteBtn'); if(b)b.style.display='inline-block';});}
    stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
  } else if(l.seller_live&&(l.type==='auction'||l.type==='wheel')){
    startViewer(id);
  }
  refreshKeepTrack(l.seller);
  // Opening an item should land you right in the room — not at the bottom
  // of the page (Kevin, 2026-11-21: it went to the bottom of the Rules and
  // he had to scroll up). The browser keeps the scroll position from the
  // main page, which is often at the bottom. Only scroll when a NEW item is
  // opened; re-renders of the same item (bid, chat, timer) must not move
  // the page.
  if(id!==lastOpenedItemId){lastOpenedItemId=id;const rb=document.getElementById('liveRoomBox');if(rb)rb.scrollIntoView({behavior:'auto',block:'start'});}
}
async function bid(id,add){if(needSignIn())return;const l=await j('/api/listings/'+id);const r=await j('/api/listings/'+id+'/bid',{amount:l.current_bid+add});alert(r.ok?`Bid placed: $${r.currentBid} (total $${r.total})`:'Error: '+r.error);openItem(id);}
// Custom bid is its own button, separate from the clock (Kevin, 2026-11-20):
// tap Custom bid and the box pops up. Type a bid and hit enter. If it is
// not higher than the current bid, the box turns red and you have to set it
// higher — or just tap the clock to bid normal (+$1).
function toggleCustomBid(){const b=document.getElementById('customBidBox'); if(!b)return; b.style.display=b.style.display==='none'?'block':'none'; if(b.style.display==='block'){const i=document.getElementById('bAmt'); if(i)i.focus();}}
async function bidCustom(id,currentBid){if(needSignIn())return;const inp=document.getElementById('bAmt'); const msg=document.getElementById('customBidMsg'); const amount=Number(inp?inp.value:0); const cur=Number(currentBid); const tooLow=(cur||cur===0)&&(!amount||amount<=cur); if(tooLow){ if(inp){inp.style.border='3px solid #c62828'; inp.style.background='#fde8e8';} if(msg)msg.innerHTML='<b style="color:#c62828">Set it higher than the current bid of $'+cur+'.</b>'; return;} if(inp){inp.style.border=''; inp.style.background='';} if(msg)msg.textContent=''; const r=await j('/api/listings/'+id+'/bid',{amount}); if(!r.ok){ if(inp){inp.style.border='3px solid #c62828'; inp.style.background='#fde8e8';} if(msg)msg.innerHTML='<b style="color:#c62828">'+escHtml(r.error||'Bid did not go through.')+'</b>'; return;} alert(`Bid placed: $${r.currentBid}`); openItem(id);}
async function setTop(id){if(needSignIn())return;const r=await j('/api/top-limit',{listingId:id,maxAmount:Number(document.getElementById('tlAmt').value)});alert(r.ok?'My Top Limit set':'Error: '+r.error);}
async function buyNow(id){if(needSignIn())return;const r=await j('/api/listings/'+id+'/buy-now',{});alert(r.ok?`Sale complete — $${r.total} in escrow. Receipt ${r.receiptNo}`:'Error: '+r.error);openItem(id);}
// Start auction (Kevin, 2026-11-20): the seller taps this in the room to
// start one queued item's timer. When it ends, the room moves to the next
// item on its own — no scrolling — and the seller taps Start again.
async function startAuction(id){
  if(needSignIn())return;
  const seller=authName();
  // Start settings (Kevin, 2026-11-20): the seller sets the starting bid,
  // how long, and Regular or Sudden Death when the item comes up — only
  // when switching to it. Read from the Start panel if it is on the page
  // (queued auction, seller view); otherwise the server uses what was set
  // when the item was listed.
  const body={};
  const bidEl=document.getElementById('startBid');
  if(bidEl&&bidEl.value!=='')body.startPrice=Number(bidEl.value);
  const tEl=document.getElementById('startTimer');
  if(tEl){
    if(tEl.value==='custom'){
      const sEl=document.getElementById('startTimerSecs');
      if(sEl&&sEl.value!=='')body.timerSeconds=Number(sEl.value);
    } else body.timerSeconds=Number(tEl.value);
  }
  const mEl=document.getElementById('startMode');
  if(mEl&&mEl.value)body.mode=mEl.value;
  // Remember what was used, so the next item's Start panel comes up with
  // the same start bid, time and mode — run them all the same with one tap
  // on Start auction (Kevin, 2026-11-21). If the panel is not on the page,
  // there is nothing new to remember.
  if(body.startPrice!==undefined||body.timerSeconds!==undefined||body.mode!==undefined)saveLastStart({startPrice:body.startPrice,timerSeconds:body.timerSeconds,mode:body.mode});
  const r=await j('/api/listings/'+id+'/start',body,sellerHeaders(seller));
  noteSellerToken(seller,r);
  if(!r.ok){alert('Error: '+r.error);return;}
  openItem(id);
}
async function payWinner(id){if(needSignIn())return;const r=await j('/api/listings/'+id+'/pay',{});alert(r.ok?(`Payment went through — $${r.total} in escrow`+(r.landedItem?` — the Time Wheel landed on: ${r.landedItem}`:'')):'Error: '+r.error);openItem(id);}
async function markShipped(id){if(needSignIn())return;const seller=authName();const r=await j('/api/listings/'+id+'/mark-shipped',{seller},sellerHeaders(seller));noteSellerToken(seller,r);const m=document.getElementById('shipMsg');if(m)m.textContent=r.ok?('Marked as shipped — tracking '+r.tracking):('Error: '+r.error);if(r.ok)openItem(id);}
window._rfPhoto='';window._rfVideo='';
function refundPick(){const rs=document.getElementById('rfReason');const neverArrived=rs&&rs.value==='never arrived';const ph=document.getElementById('rfPhoto');const vd=document.getElementById('rfVideo');window._rfPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._rfVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('rfBtn');const m=document.getElementById('rfProofMsg');if(neverArrived){if(b)b.disabled=false;if(m)m.textContent='Never arrived: no photo or video is needed — you never received the item. The owner will review it (opens 7 days after the sale if never shipped, or 7 days after shipping with no delivery).';return;}if(b)b.disabled=!(window._rfPhoto&&window._rfVideo);if(m)m.textContent=(window._rfPhoto&&window._rfVideo)?'Photo + video attached — you can send the refund request.':'Attach BOTH a photo and a video — the button stays locked until both are attached.';}
async function submitRefund(id){if(needSignIn())return;const r=await j('/api/refunds',{listingId:id,reason:document.getElementById('rfReason').value,photoName:window._rfPhoto,videoName:window._rfVideo});const m=document.getElementById('rfMsg');if(m)m.textContent=r.ok?'Refund request sent — it comes out of the seller\'s escrow money, not the owner\'s fees.':'Error: '+r.error;if(r.ok)openItem(id);}
async function refundChoose(rfId,seller,choice){const r=await j('/api/refunds/'+rfId+'/choose',{seller,choice},sellerHeaders(seller));noteSellerToken(seller,r);alert(r.ok?(choice==='no_return'?'Refund released without the item back — buyer keeps the item.':'Return label sent to the buyer — no refund until you confirm you got the item back. The return label cost ($'+(r.returnCost||0).toFixed(2)+') is your cost, not the buyer\'s and not the owner\'s fees.'):'Error: '+r.error);loadDash();}
async function returnShipped(rfId){const t=document.getElementById('retTrack');const r=await j('/api/refunds/'+rfId+'/return-shipped',{tracking:t?t.value:'',photoName:window._retPhoto,videoName:window._retVideo});const m=document.getElementById('retMsg');if(m)m.textContent=r.ok?('Return shipped — tracking '+(r.tracking||'')+'. The seller will confirm when they receive it.'):'Error: '+r.error;if(r.ok)openItem(curItemId());}
async function returnDelivered(rfId){const r=await j('/api/refunds/'+rfId+'/return-delivered',{});const m=document.getElementById('retMsg');if(m)m.textContent=r.ok?('Return marked as delivered — refund releases 48 hours after delivery'+(r.returnAutoReleaseAt?(' ('+new Date(r.returnAutoReleaseAt).toLocaleString()+')'):'')+' if the seller does not confirm receipt first.'):'Error: '+r.error;if(r.ok){if(curItemId())openItem(curItemId());else loadDash();}else alert('Error: '+r.error);}
function curItemId(){const q=new URLSearchParams(location.search);return q.get('i')||liveListingId;}
async function confirmReceipt(rfId,seller){const r=await j('/api/refunds/'+rfId+'/confirm-receipt',{seller},sellerHeaders(seller));noteSellerToken(seller,r);alert(r.ok?'You confirmed you got the item back — the refund is now released from your escrow money.':'Error: '+r.error);loadDash();}
async function fixPay(id){const r=await j('/api/listings/'+id+'/notify-fix',{});alert(r.ok?'Fix-payment notice sent to the winner':'Error: '+r.error);}
async function rerun(id,seller){const r=await j('/api/listings/'+id+'/rerun',{seller},sellerHeaders(seller));noteSellerToken(seller,r);alert(r.ok?'Auction rerun — live again at the same price/timer':'Error: '+r.error);openItem(id);}
function returnPick(){const ph=document.getElementById('retPhoto');const vd=document.getElementById('retVideo');window._retPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._retVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('retBtn');if(b)b.disabled=!(window._retPhoto&&window._retVideo);const m=document.getElementById('retProofMsg');if(m)m.textContent=(window._retPhoto&&window._retVideo)?'Video + label picture attached — you can mark the return shipped.':'Attach BOTH the video and the label picture — the button stays locked until both are attached.';}
function disputePick(){const ph=document.getElementById('dspPhoto');const vd=document.getElementById('dspVideo');window._dspPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._dspVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('dspBtn');if(b)b.disabled=!(window._dspPhoto&&window._dspVideo);const m=document.getElementById('dspProofMsg');if(m)m.textContent=(window._dspPhoto&&window._dspVideo)?'Photo + video attached — you can flag the wrong item.':'Attach BOTH a photo and a video — the button stays locked until both are attached.';}
async function flagWrongItem(rfId,seller){const r=await j('/api/refunds/'+rfId+'/wrong-item',{seller,photoName:window._dspPhoto,videoName:window._dspVideo},sellerHeaders(seller));noteSellerToken(seller,r);const m=document.getElementById('dspMsg');if(m)m.textContent=r.ok?'Wrong item flagged — the refund is paused and the owner will decide. The 48-hour auto-release is stopped.':'Error: '+r.error;if(r.ok){if(curItemId())openItem(curItemId());else loadDash();}else alert('Error: '+r.error);}
async function ojDel(u){let r;try{const res=await fetch(u,{method:'DELETE',headers:Object.assign({},sessionHeaders(),ownerHeaders())});r=await res.json();}catch(e){r={ok:false,error:'request failed'};}if(r&&r.ok===false&&!r.error)r.error='something went wrong — try again';if(r&&!r.ok&&(r.error==='owner password required'||r.error==='owner password not set')){const p=prompt('Owner password? (the OWNER_PASSWORD you set in Railway — it stays on this device only)');if(p){try{sessionStorage.setItem('btb_owner_pw',p);}catch(e){}try{const res=await fetch(u,{method:'DELETE',headers:Object.assign({},sessionHeaders(),ownerHeaders())});r=await res.json();if(r&&r.ok===false&&!r.error)r.error='something went wrong — try again';}catch(e){}}}return r;}
async function ownerDeleteListing(){const id=document.getElementById('delListingId').value.trim();if(!id){alert('Type a listing id first.');return;}if(!confirm('Remove this listing? This cannot be undone.'))return;const r=await ojDel('/api/listings/'+encodeURIComponent(id));alert(r.ok?r.message:('Error: '+r.error));loadDash();}
async function ownerDeleteChat(){const id=document.getElementById('delChatId').value.trim();if(!id){alert('Type a chat message id first.');return;}const r=await ojDel('/api/chats/'+encodeURIComponent(id));alert(r.ok?r.message:('Error: '+r.error));}
async function ownerDecideRefund(rfId,decision){const r=await oj('/api/refunds/'+rfId+'/owner-decide',{decision});alert(r.ok?(decision==='approve'?'Never-arrived refund approved — released from the seller\'s escrow money.':'Never-arrived refund denied — no refund.'):'Error: '+r.error);loadDash();}
async function decideDispute(rfId,decision){const r=await oj('/api/refunds/'+rfId+'/dispute-decide',{decision});alert(r.ok?(decision==='wrong'?'Refund denied — the buyer sent the wrong item. A new return label was sent and the buyer must send the right item back within 7 days, or no refund.':'Item is correct — claim not upheld, refund released. Recorded against the seller: that sale is not a clean sale, the seller drops a tier, it is on their Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.'):'Error: '+r.error);loadDash();}
async function chat(id){if(needSignIn())return;const r=await j('/api/listings/'+id+'/chat',{message:document.getElementById('cMsg').value});if(!r.ok){alert('Error: '+r.error);return;}openItem(id);}
// Private messages on the item page (Kevin, 2026-11-20): only the buyer
// and the seller ever see them. A buyer messages the seller; the seller
// sees each buyer's thread and replies to that buyer.
function pmSection(l,pms){
  if(!currentUser) return `<h3>Message seller (private)</h3><p class="small">Sign in to message ${escHtml(l.seller)} privately — only you and the seller see it.</p>`;
  const isSeller=currentUser.name===l.seller;
  if(isSeller){
    if(!pms.length) return `<h3>Private messages about this item</h3><p class="small">No private messages yet — when a buyer messages you about this item, it shows here. Only you and that buyer see it.</p>`;
    const byBuyer={};
    for(const m of pms){const b=m.sender===l.seller?m.recipient:m.sender;(byBuyer[b]=byBuyer[b]||[]).push(m);}
    const buyers=Object.keys(byBuyer);
    return `<h3>Private messages about this item</h3><p class="small">Only you and each buyer see their own messages — nobody else.</p>`+buyers.map((b,i)=>`<div style="border:1px solid #c9a227;border-radius:10px;padding:10px;margin-top:8px"><b>${escHtml(b)}</b>${byBuyer[b].map(m=>`<p><b>${escHtml(m.sender)}${m.sender===l.seller?' (you)':''}:</b> ${escHtml(m.message)}</p>`).join('')}<label>Reply to ${escHtml(b)} <input id="pmMsg_s${i}" placeholder="Type a private reply"></label><button class="btn" onclick="sendPrivateMessage('${l.id}','${escJs(b)}','pmMsg_s${i}')">Send private reply</button></div>`).join('');
  }
  return `<h3>Message ${escHtml(l.seller)} (private)</h3><p class="small">Only you and the seller see this — nobody else, not even in the public chat.</p><div class="chat">${pms.map(m=>`<p><b>${escHtml(m.sender)}${m.sender===l.seller?' (seller)':''}:</b> ${escHtml(m.message)}</p>`).join('')||'<p class="small">No messages yet.</p>'}</div><label>Message <input id="pmMsg" placeholder="Ask about the item, shipping, anything"></label><button class="btn" onclick="sendPrivateMessage('${l.id}','','pmMsg')">Send private message</button>`;
}
async function sendPrivateMessage(id,to,inputId){
  if(needSignIn())return;
  const el=document.getElementById(inputId);
  const msg=el?el.value:'';
  if(!msg.trim()){alert('Type a message first.');return;}
  const r=await j('/api/listings/'+id+'/message',{message:msg,to:to||undefined});
  if(!r.ok){alert('Error: '+r.error);return;}
  openItem(id);
}
async function goLive(id){
  if(needSignIn())return;
  const seller=authName();
  // Make sure this browser has a fresh seller token before going live,
  // so a stale or missing token does not block the show (Kevin, 2026-11-20:
  // he listed something and Go Live did not work).
  await syncSellerToken();
  // Camera first: if the seller blocks it, do not mark the room live.
  // Try the back camera first (best for showing items), then fall back
  // to any camera — a strict back-camera request fails on some phones.
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true}); liveFacingMode='environment';}
  catch(e1){
    try{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); liveFacingMode='user';}
    catch(e2){alert('Camera / mic blocked — this site needs camera and microphone access to go live. Allow it for this site in your browser settings, then tap Go Live again.');return;}
  }
  const r=await j('/api/listings/'+id+'/go-live',{seller},sellerHeaders(seller));noteSellerToken(seller,r);
  if(!r.ok){stream.getTracks().forEach(t=>t.stop());alert('Error: '+r.error);return;}
  // Stop any viewer connection from this browser, then broadcast.
  if(liveRole==='viewer'){stopLiveFull(); liveListingId=id;}
  liveRole='seller'; liveStream=stream; liveSince=new Date().toISOString(); liveSeen=new Set(); livePCs={};
  const v=liveVideoEl(); if(v){v.srcObject=stream; v.muted=true; v.style.display='block'; v.play().catch(()=>{});}
  const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
  const f=document.getElementById('flipCamBtn'); if(f)f.style.display='inline-block';
  setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
  startSellerPoll(id);
  startPresence(id);
  // When you go live, the screen should just show the room — no scrolling
  // to find it (Kevin, 2026-11-21). The Go Live button is right under the
  // video in the room, so the camera comes on where you are looking. The
  // scroll is instant (not smooth) and there is no pop-up alert — a pop-up
  // blocks the scroll and hides the camera, so the status line above is
  // the only confirmation. The camera is already on in the video above.
  const rb=document.getElementById('liveRoomBox'); if(rb)rb.scrollIntoView({behavior:'auto',block:'start'});
}
// Flip the camera while live (Kevin, 2026-11-20): front (face) or back
// (item). Swaps the video track in the local preview AND in every viewer
// connection, so the room sees the new camera without dropping the show.
async function flipCamera(){
  if(liveRole!=='seller'||!liveStream)return;
  const next=liveFacingMode==='environment'?'user':'environment';
  let ns;
  try{ns=await navigator.mediaDevices.getUserMedia({video:{facingMode:next},audio:false});}
  catch(e){try{ns=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}catch(e2){alert('Could not switch camera — your phone may only have one camera.');return;}}
  const newVideo=ns.getVideoTracks()[0];
  if(!newVideo){ns.getTracks().forEach(t=>t.stop());return;}
  const oldVideo=liveStream.getVideoTracks()[0];
  const oldAudio=liveStream.getAudioTracks()[0];
  const combined=new MediaStream([newVideo].concat(oldAudio?[oldAudio]:[]));
  const v=liveVideoEl(); if(v){v.srcObject=combined; v.style.display='block'; v.play().catch(()=>{});}
  for(const k of Object.keys(livePCs)){
    const pc=livePCs[k];
    const sender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
    if(sender){try{await sender.replaceTrack(newVideo);}catch(e){}}
  }
  if(oldVideo)oldVideo.stop();
  liveStream=combined; liveFacingMode=next;
  setLiveStatus('🔴 LIVE — camera flipped to '+(next==='user'?'front (face)':'back (item)')+' camera. Buyers can see your camera now.');
}
async function endLive(id){
  if(liveRole==='viewer')sendSignal(id,liveViewerId,'seller','leave',{});
  const seller=authName();
  stopLiveFull();
  const r=await j('/api/listings/'+id+'/end-live',{seller},sellerHeaders(seller));noteSellerToken(seller,r);
  openItem(id);
}
async function report(id){if(needSignIn())return;const r=await j('/api/report',{listingId:id,reason:prompt('What is wrong with this listing?')||''});alert(r.ok?r.message:('Error: '+r.error));}
async function confirmBad(id){
  const reason=prompt('What is wrong with this listing? (fake, stolen, or banned item)');
  if(!reason)return;
  if(!confirm('This removes the listing for good and counts as a strike against the seller. 1st confirmed bad listing = selling suspended 7 days, 2nd = 30 days, 3rd = selling privileges removed for good. Continue?'))return;
  const r=await oj('/api/listings/'+id+'/confirm-bad',{reason});
  if(!r.ok){alert('Error: '+r.error);return;}
  alert('Listing removed. '+r.seller+' now has '+r.badListingStrikes+' confirmed bad listing'+(r.badListingStrikes===1?'':'s')+(r.banned?' — selling privileges removed for good.':r.suspendedUntil?(' — selling suspended until '+new Date(r.suspendedUntil).toLocaleString()+'.'):'.'));
  load();
}
async function score(s){const r=await j('/api/scorecard/'+encodeURIComponent(s));alert(`Seller Scorecard for ${s}: ${r.average||'no scores yet'} / 5 from ${r.count} score(s)`);}
async function follow(){if(needSignIn())return;const r=await j('/api/follow',{seller:document.getElementById('fSeller').value});document.getElementById('followMsg').textContent=r.message||r.error;loadKeepTrack();load();}
async function followSeller(name){if(needSignIn())return;const r=await j('/api/follow',{seller:name});alert(r.message||r.error);refreshKeepTrack(name);loadKeepTrack();}
async function unfollowSeller(name){if(needSignIn())return;const r=await j('/api/unfollow',{seller:name});alert(r.message||r.error);refreshKeepTrack(name);loadKeepTrack();}
async function refreshKeepTrack(seller){
  const box=document.getElementById('keepTrackBox'); if(!box)return;
  if(!currentUser){box.innerHTML='<p class="small">Sign in to keep track of this seller.</p>';return;}
  let isF=false, count=0;
  try{const f=await j('/api/following/'+encodeURIComponent(currentUser.name)); isF=Array.isArray(f)&&f.some(x=>x.seller===seller);}catch(e){}
  try{const fc=await j('/api/followers/'+encodeURIComponent(seller)); if(fc&&typeof fc.count==='number')count=fc.count;}catch(e){}
  const self=currentUser.name===seller;
  box.innerHTML=`<p class="small"><b>${count} ${count===1?'person':'people'} keeping track of ${escHtml(seller)}</b></p>`+(self?'':(isF?`<button class="btn ghost" onclick="unfollowSeller('${escJs(seller)}')">Keeping track ✓ — stop</button>`:`<button class="btn" onclick="followSeller('${escJs(seller)}')">Keep Track — follow ${escHtml(seller)}</button>`));
}
async function loadKeepTrack(){
  const box=document.getElementById('keepTrackLists'); if(!box)return;
  if(!currentUser){box.innerHTML='<p class="small">Sign in to see who you keep track of and who keeps track of you.</p>';return;}
  let mine=[]; try{const f=await j('/api/following/'+encodeURIComponent(currentUser.name)); if(Array.isArray(f))mine=f;}catch(e){}
  let fr={count:0,followers:[]}; try{const r=await j('/api/followers/'+encodeURIComponent(currentUser.name)); if(r&&r.ok)fr=r;}catch(e){}
  box.innerHTML=`<p><b>People you're keeping track of (${mine.length})</b>${mine.length?'<br>'+mine.map(x=>`${escHtml(x.seller)}${x.liveNow?' — <span class="badge">🔴 LIVE NOW</span>':''}${x.nextShow?' — next show '+escHtml(x.nextShow):''} <button class="btn ghost" onclick="unfollowSeller('${escJs(x.seller)}')">Stop</button>`).join('<br>'):' — nobody yet.'}</p><p><b>People keeping track of you (${fr.count})</b>${fr.followers.length?': '+fr.followers.map(escHtml).join(', '):' — nobody yet.'}</p>`;
}
async function saveShow(id){if(needSignIn())return;const r=await j('/api/shows/'+id+'/save',{});if(!r.ok){alert('Error: '+r.error);return;}load();}
function dismissShowAlert(id){let d=[];try{d=JSON.parse(localStorage.getItem('btb_show_alert_dismissed')||'[]');}catch(e){}if(!d.includes(id))d.push(id);try{localStorage.setItem('btb_show_alert_dismissed',JSON.stringify(d));}catch(e){}load();}
async function makeShow(){
  if(needSignIn())return;
  // Schedule a show (Kevin, 2026-11-20): a missing title or date used to
  // fail silently — new Date('').toISOString() throws and nothing
  // happened, no message at all. Now it says what is missing first.
  const title=document.getElementById('cTitle').value.trim();
  const when=document.getElementById('cWhen').value;
  if(!title){alert('Give your show a title first.');return;}
  if(!when){alert('Pick a date and time for your show first.');return;}
  const r=await j('/api/shows',{title,startsAt:new Date(when).toISOString()});
  alert(r.ok?'Show scheduled — it shows under Coming Up.':'Error: '+(r.error||''));
  load();
}
async function joinWaitlist(){const r=await j('/api/waitlist',{name:document.getElementById('wName').value,email:document.getElementById('wEmail').value,founding:document.getElementById('wFound').checked});
  if(!r.ok){document.getElementById('waitMsg').textContent=r.error;return;}
  document.getElementById('waitMsg').textContent=r.message||"You're on the list!";
}
async function confirmWaitlist(){const email=document.getElementById('wEmail').value;const code=document.getElementById('wConfirm').value;if(!email||!code){document.getElementById('waitMsg').textContent='Type your email and the confirmation code from your email first.';return;}const r=await j('/api/waitlist/confirm',{email,code});document.getElementById('waitMsg').textContent=r.ok?r.message:('Error: '+r.error);}
async function claimFounding(){if(needSignIn())return;const seller=authName()||document.getElementById('wName').value||'Seller';const r=await j('/api/founding/claim',{});noteSellerToken(seller,r);document.getElementById('waitMsg').textContent=r.ok?`Founding spot claimed! ${r.taken}/10 taken`:'Error: '+r.error;load();}
async function checkTier(){const name=document.getElementById('tierSeller').value.trim();if(!name){document.getElementById('tierMsg').textContent='Type a seller name first.';return;}const t=await j('/api/payout-tier/'+encodeURIComponent(name));if(!t||t.ok===false){document.getElementById('tierMsg').textContent='Error: '+(t&&t.error?t.error:'sign in to check a payout tier.');return;}document.getElementById('tierMsg').textContent=`${t.seller} — ${t.tier} seller • ${t.cleanSales} clean sales${t.incorrectClaims?` • Incorrect return claims: ${t.incorrectClaims} — `+(t.banned?'selling privileges removed.':t.canSell?'suspension ended.':`selling privileges suspended until ${new Date(t.suspendedUntil).toLocaleString()}.`):''}${t.score!==null?` • Score ${t.score}/5 (${t.scoreCount} scores)`:''}${t.nextTier?` • ${t.salesToNext} more clean sales to ${t.nextTier}`:' • top tier — fastest payout on everything'}.`;}
async function loadDash(){const ds=document.getElementById('dashSec');if(!ds||ds.style.display!=='block')return;const d=await oj('/api/dashboard');if(!d.ok){document.getElementById('dash').innerHTML='<p>Owner dashboard is locked — enter the owner password to see fees, refunds and payouts.</p>';return;}const sd=d.safeDraw;document.getElementById('dash').innerHTML=`${d.ytd?`<div style=\"border:3px solid #c9a227;border-radius:14px;padding:12px;margin-bottom:10px\"><h3 style=\"margin-top:0\">📅 ${d.ytd.year} year to date</h3><p>Total site sales year to date: <b>$${Number(d.ytd.siteSales||0).toFixed(2)}</b> (${d.ytd.salesCount} sale${d.ytd.salesCount===1?'':'s'} — item price + shipping, receipt totals)</p><p>Fees you made year to date: <b>$${Number(d.ytd.fees||0).toFixed(2)}</b></p><p>Tax set aside year to date (${d.taxPercent}%): <b>$${Number(d.ytd.taxSetAside||0).toFixed(2)}</b></p><p class=\"small\">All time: total site sales $${Number(d.allTime?d.allTime.siteSales:0).toFixed(2)} (${d.allTime?d.allTime.salesCount:0} sales) • fees you made $${Number(d.allTime?d.allTime.fees:0).toFixed(2)}</p></div>`:''}<p>Total fees earned: $${d.totalFeesEarned}</p><p>Tax set aside (${d.taxPercent}%): $${d.taxSetAside}</p><p>Available to use / owner draw: $${d.availableToUse}</p><p>Unpaid wins: ${d.unpaidWins.length} • Refunds pending: ${d.refundsPending.length} • Escrow held: ${d.escrowHeld.length}</p>${d.ownerInbox?`<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px"><h3 style="margin-top:0">📥 Owner inbox — every sale on the site</h3><p class="small">All sales, all sellers — separate from What I sold on My Profile, which is only the items you sold yourself. Click a sale to see its receipt.</p>${d.ownerInbox.length?d.ownerInbox.map(s=>`<p><b>${escHtml(s.title)}</b> — ${escHtml(s.seller)} → ${escHtml(s.winner||'—')} • $${s.total}${s.receiptNo?` • Receipt ${escHtml(s.receiptNo)}`:''} • ${s.date?new Date(s.date).toLocaleDateString():''} <button class="btn ghost" onclick="showReceipt('${s.id}','ownerReceiptBox')">Receipt</button> <button class="btn ghost" onclick="openItem('${s.id}')">Open</button></p>`).join(''):'<p class="small">No sales yet.</p>'}<div id="ownerReceiptBox"></div></div>`:''}${d.refundsPending.length?`<h3>Refund requests — seller decides</h3><p class="small">Legit reason + photo + video only. It's up to the seller: refund without the item back, or ask for the item back first — then no refund until they receive it. A refund comes out of the seller's escrow money, not the owner's fees.</p>`+d.refundsPending.map(rf=>`<div style="border:2px solid #c62828;border-radius:10px;padding:10px;margin-top:8px"><p class="small"><b>${escHtml(rf.title||rf.listing_id)}</b> — ${escHtml(rf.requester||'Buyer')} • ${escHtml(rf.reason||'')} • photo: ${escHtml(rf.photo_name||'—')} • video: ${escHtml(rf.video_name||'—')}${rf.refundDeadline?` • refund window closes ${new Date(rf.refundDeadline).toLocaleString()} (${escHtml(rf.refundLabel||'')})`:''}</p>${rf.status==='awaiting_return'?`<p class="small"><b>Waiting for the item back.</b>${rf.dispute_status==='wrong'?` <b>Owner ruled the buyer sent the wrong item before — this is a new label for the RIGHT item. Buyer has until ${rf.return_due_at?new Date(rf.return_due_at).toLocaleString():'7 days from the decision'} to send it back, or no refund.</b>`:''} Return label: ${escHtml(rf.return_label_carrier||'')} ${escHtml(rf.return_label_tracking||'')} (code ${escHtml(rf.return_label_code||'')}) — test label only, no real carrier connected yet. Return label cost $${Number(rf.return_cost||0).toFixed(2)} — paid by the seller, because the seller asked for the item back. ${rf.return_shipped_at?`Return shipped ${new Date(rf.return_shipped_at).toLocaleString()} — tracking ${escHtml(rf.return_tracking||rf.return_label_tracking||'')}. ${rf.returnAutoReleaseAt?`If you do not confirm, the refund releases on its own <b>${new Date(rf.returnAutoReleaseAt).toLocaleString()}</b> — the seller cannot stall it by not tapping.`:''}`:'Buyer has not shipped it back yet — if it is not shipped back before the refund window closes, the refund expires and no refund is given.'}</p>${rf.return_shipped_at?`<button class="btn" onclick="confirmReceipt('${rf.id}','${escJs(rf.seller||'')}')">Confirm I got the item back — release the refund</button> <button class=\"btn ghost\" onclick=\"returnDelivered('${rf.id}')\">Mark return as delivered (carrier scan)</button>`:''}`:rf.status==='disputed'?`<p><b>⚠️ DISPUTE OPEN — refund paused.</b> The seller says the wrong item came back. The 48-hour auto-release is stopped — no refund goes out while the owner decides.</p><p class="small"><b>1 — Buyer's return proof</b> (video of the item going into the box + picture of the label on the same box when sent out) — video: ${escHtml(rf.return_video_name||'—')} • picture: ${escHtml(rf.return_photo_name||'—')}<br><b>2 — Seller's arrival proof</b> (what actually arrived) — photo: ${escHtml(rf.dispute_photo_name||'—')} • video: ${escHtml(rf.dispute_video_name||'—')}<br><b>3 — Original receipt + video receipt</b> — ${rf.receipt ? escHtml(rf.receipt.receiptNo||'') + ' — ' + escHtml(rf.receipt.item||'') + ' — total $' + rf.receipt.total + ' — seller was live: ' + (rf.receipt.videoReceipt&&rf.receipt.videoReceipt.sellerWasLive?'yes':'no') + ' — bids: ' + (rf.receipt.videoReceipt?rf.receipt.videoReceipt.bids.length:0) + ' — chat messages: ' + (rf.receipt.videoReceipt?rf.receipt.videoReceipt.chats.length:0) : 'no receipt yet'}</p><p class="small">Compare all three before you decide. <b>If the claim is not upheld after review:</b> that sale is not a clean sale, the seller drops a tier, it is recorded on their Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.</p><button class="btn" onclick="decideDispute('${rf.id}','wrong')">Buyer sent the wrong item — deny refund</button> <button class="btn ghost" onclick="decideDispute('${rf.id}','correct')">Item is correct — release refund</button><p class="small">Wrong item: refund denied — the buyer must send back the right item on a new tracked return label (seller pays, only because they asked for the item back) within 7 days, or no refund. Correct: claim not upheld, refund releases at once.</p>`:`<p class="small"><b>Seller — your choice:</b></p><button class="btn" onclick="refundChoose('${rf.id}','${escJs(rf.seller||'')}','no_return')">Refund without return — buyer keeps the item</button> <button class="btn ghost" onclick="refundChoose('${rf.id}','${escJs(rf.seller||'')}','want_back')">I want the item back first</button><p class="small">If you ask for the item back, a tracked return label is sent to the buyer and no refund goes out until you confirm you got it back. The return label is your cost — only because you asked for it back.</p>${rf.reason==='never arrived'?`<p class=\"small\"><b>Never arrived — owner review:</b> the buyer never received the item, so there is nothing to send back. You decide.</p><button class=\"btn\" onclick=\"ownerDecideRefund('${rf.id}','approve')\">Approve — release refund</button> <button class=\"btn ghost\" onclick=\"ownerDecideRefund('${rf.id}','deny')\">Deny — no refund</button>`:''}`}</div>`).join(''):''}${d.incorrectClaimStrikes&&d.incorrectClaimStrikes.length?`<h3>Incorrect return claims</h3><p class="small">Selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third. While suspended, a seller's listings are hidden and they cannot list new items.</p>`+d.incorrectClaimStrikes.map(x=>`<p class="small"><b>${escHtml(x.seller)}</b> — ${x.strikes} incorrect claim${x.strikes===1?'':'s'} — ${x.banned?'selling privileges removed — cannot sell on the site again.':x.canSell?'suspension ended — selling is open again.':`selling privileges suspended until <b>${new Date(x.suspendedUntil).toLocaleString()}</b> (${x.suspensionDays} days).`}</p>`).join(''):''}${d.badListingStrikes&&d.badListingStrikes.length?`<h3>Bad listings — confirmed by owner</h3><p class="small">A report alone never counts — only a listing you confirmed is fake, stolen or a banned item. 1st = selling suspended 7 days, 2nd = 30 days, 3rd = selling privileges removed for good.</p>`+d.badListingStrikes.map(x=>`<p class="small"><b>${escHtml(x.seller)}</b> — ${x.strikes} confirmed bad listing${x.strikes===1?'':'s'} — ${x.banned?'selling privileges removed — cannot sell on the site again.':x.canSell?'suspension ended — selling is open again.':`selling privileges suspended until <b>${new Date(x.suspendedUntil).toLocaleString()}</b> (${x.suspensionDays} days).`}</p>`).join(''):''}${sd?`<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px"><h3 style="margin-top:0">💰 Safe to take out</h3>${sd.alert?`<p><b>${sd.alert}</b></p>`:`<p><b>Nothing safe to take out yet.</b></p>`}<p>Total fees earned: $${sd.totalFeesEarned} • Safe fees (over 30 days old, seller paid, no refund/dispute): $${sd.safeFees} • Safe to take out after tax set aside: <b>$${sd.safeToDraw.toFixed(2)}</b></p><p>Not safe yet: <b>$${sd.notSafeFees.toFixed(2)}</b>${sd.notSafe.length?` — ${sd.notSafe.map(n=>`${escHtml(n.title)} ($${n.fee.toFixed(2)}) — safe ${new Date(n.safeDate).toLocaleDateString()}`).join('; ')}`:''}</p><p>Recommended reserve to leave in the business: <b>$${sd.reserve.toFixed(2)}</b> — the larger of all not-yet-safe fees ($${sd.notSafeFees.toFixed(2)}) and 2 months of fees at the last 30 days' rate ($${sd.monthlyFees.toFixed(2)}/month).</p><p class="small">${sd.note} Seller escrow money is never counted here — only your fees.</p></div>`:''}${d.escrowHeld.length?`<h3>Payouts waiting</h3>`+d.escrowHeld.map(h=>`<p class="small"><b>${escHtml(h.title)}</b> — ${escHtml(h.seller)} • ${escHtml(h.payout.tier)} seller (${h.payout.cleanSales} clean sales) • $${h.amount} held • Ship to (locked at win): <b>${escHtml(h.winnerAddress||'—')}</b> • payout <b>${escHtml(h.payout.payoutLabel)} after delivery</b>${h.payout.payoutAt?` — <b>${new Date(h.payout.payoutAt).toLocaleString()}</b>`:''}</p>`).join('')+`<p class="small">Test mode: these are tracked payout dates, not real bank transfers.</p>`:''}`;loadLiveNotice();loadSoldQRs();}
async function loadSoldQRs(){
  const el=document.getElementById('soldQRs');if(!el)return;
  const rows=await j('/api/listings');
  const sold=rows.filter(l=>l.status==='sold'&&l.payment_status==='validated');
  if(!sold.length){el.innerHTML='<p class="small">No sold items yet — when someone buys or wins and pays, the QR code to ship it shows here.</p>';return;}
  el.innerHTML=sold.map(l=>`<div class="card"><h3>${escHtml(l.title)}${l.revealed_item?` — won: ${escHtml(l.revealed_item)}`:''}</h3><p>Winner: ${escHtml(l.winner)} • ${l.package_size?shipLabelOf(l.package_size):''} • <b>${shipViaText(l)}</b> • Tracking: ${escHtml(l.tracking||'—')}</p><canvas id="dashQR-${l.id}" style="max-width:100%;background:#fff;border-radius:8px"></canvas><p class="small">Scan to open this exact sale, then tap Mark as shipped. Shipment record — not real ${carrierOf(l)} postage yet.</p><button class="btn ghost" onclick="openItem('${l.id}')">Open this sale</button></div>`).join('');
  for(const l of sold){const det=await j('/api/listings/'+l.id);if(det.qr_text)drawQR(det.qr_text,document.getElementById('dashQR-'+l.id));}
}
// ---------- "We're live" email to the waitlist (owner dashboard) ----------
async function loadLiveNotice(){
  const d=await oj('/api/waitlist/live-notice'); const el=document.getElementById('liveNotice'); if(!el)return;
  if(!d.ok){el.innerHTML='<p>Waitlist emails are locked — enter the owner password to see them.</p>';return;}
  if(!d.emails){el.innerHTML=`<p><b>${d.count} people</b> on the waitlist.</p><p class="small">Enter the owner password to see the email list.</p>`;return;}
  let h=`<p><b>${d.count} people</b> on the waitlist.</p>`;
  // Welcome emails: who got one when they joined, and who is still waiting.
  if(d.count){
    const ws=(d.welcomeSent||0), wp=(d.welcomePending||0), wf=(d.welcomeFailed||0);
    h+=`<p class="small">Welcome emails: <b>${ws} sent</b>${wp?` • <b>${wp} still to send</b>`:''}${wf?` • <b>${wf} failed to send</b>`:''}.</p>`;
    if(wp&&d.welcomePendingEmails)h+=`<p class="small">Still to welcome: ${d.welcomePendingEmails.map(x=>escHtml((x.name?x.name+' — ':'')+x.email)).join('; ')}</p>`;
    if(wf&&d.welcomeFailedEmails)h+=`<p class="small">Welcome failed for: ${d.welcomeFailedEmails.map(x=>escHtml((x.name?x.name+' — ':'')+x.email)).join('; ')}</p>`;
    if(wp&&!d.resendConfigured)h+=`<p class="small">No Resend key set yet, so welcome emails can't send automatically — set RESEND_API_KEY in Railway and new joiners will get one right away. The launch email still covers everyone on the list.</p>`;
  }
  if(d.sentAt)h+=`<p><span class="badge green">Sent ${escHtml(d.sentAt)} via ${escHtml(d.sentMode)} to ${d.sentCount} people.</span></p>`;
  else if(d.count)h+=`<p class="small">Not sent yet.</p>`;
  if(!d.resendConfigured)h+=`<p class="small">No automatic email key set — use copy / mailto below, or set RESEND_API_KEY in Railway to send automatically.</p>`;
  if(d.count){
    h+=`<p class="small">Subject: ${escHtml(d.subject)}</p><pre style="white-space:pre-wrap">${escHtml(d.body)}</pre>
    <label>Emails (copy them) <textarea id="liveEmails" readonly rows="3">${escHtml(d.emails.join(', '))}</textarea></label>
    <button class="btn ghost" onclick="copyLiveEmails()">Copy emails</button>
    <a class="btn ghost" href="${escHtml(d.mailto)}">Open in my email (everyone in BCC)</a>`;
  }
  el.innerHTML=h;
  const rb=document.getElementById('resendLiveBtn'); if(rb)rb.style.display=d.sentAt?'inline-block':'none';
  const mb=document.getElementById('markSentBtn'); if(mb)mb.style.display=(!d.resendConfigured&&d.count&&!d.sentAt)?'inline-block':'none';
}
async function sendLiveNotice(force){
  const r=await oj('/api/waitlist/live-notice',{force:!!force}); const m=document.getElementById('liveNoticeMsg');
  if(r.ok&&r.sent)m.textContent=`Sent! ${r.sentCount} people emailed via ${r.mode}.`;
  else if(r.ok&&!r.sent)m.textContent=r.message||'Nothing was sent automatically — use copy / mailto below.';
  else m.textContent='Error: '+(r.error||'could not send');
  loadLiveNotice();
}
async function markLiveSent(){
  const r=await oj('/api/waitlist/live-notice',{markManualSent:true}); const m=document.getElementById('liveNoticeMsg');
  m.textContent=r.ok?'Marked as sent.':('Error: '+(r.error||'could not mark sent')); loadLiveNotice();
}
function copyLiveEmails(){
  const t=document.getElementById('liveEmails'); if(!t)return; t.select();
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t.value); else document.execCommand('copy');
  document.getElementById('liveNoticeMsg').textContent='Emails copied.';
}
async function setTax(){const r=await oj('/api/settings/tax',{percent:Number(document.getElementById('taxPct').value)});alert(r.ok?'Tax % set to '+r.taxPercent:'Error: '+r.error);loadDash();}
document.getElementById('sCat').innerHTML=cats.slice(1).map(c=>`<option>${c}</option>`).join('');
document.getElementById('sRandomCat').innerHTML=cats.slice(1).map(c=>`<option>${c}</option>`).join('');
load(); loadSession(); renderAuth(); authMe(); toggleFixedPrice(); setInterval(load,15000);
// Owner dashboard is NOT listed on the site — only the owner opens it, by adding ?owner to the site address, then entering the owner password. Buyers and sellers never see it.
(function(){const q=new URLSearchParams(location.search);if(q.has('owner'))setTimeout(()=>show('dash'),600);})();
// A scanned QR code opens this exact sold item: ?i=<listing id>&r=<receipt>&t=<tracking>
(function(){const q=new URLSearchParams(location.search);const item=q.get('i');if(item)setTimeout(()=>openItem(item),600);})();

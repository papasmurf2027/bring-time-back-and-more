let cats=['All','Watches','Clothes','Shoes','Electronics','Collectibles','Vehicles','Home','Fashion','Art','Sports','Toys','Other'];
let curCat='All', curType='';
async function j(u,o){const r=await fetch(u,o?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}:undefined);return r.json();}
function show(w){document.getElementById('sellSec').style.display=w==='sell'?'block':'none';document.getElementById('dashSec').style.display=w==='dash'?'block':'none';if(w==='buy'){curType='';load();}if(w==='store'){curType='buy_now';load();}if(w==='dash')loadDash();}
async function load(){
  const o=await j('/api/overview');
  document.getElementById('founding').textContent=`Founding sellers: ${o.founding.taken}/10 taken — ${o.founding.remaining} spots left. 0% until it goes live, then 5% forever. Normal fee 10%.`;
  document.getElementById('liveNow').innerHTML=o.listings.filter(l=>l.seller_live&&l.status==='live').map(l=>`<p><span class="badge">🔴 LIVE NOW</span> <b>${l.seller}</b> — ${l.title} — $${l.current_bid} <button class="btn ghost" onclick="openItem('${l.id}')">Join room</button></p>`).join('')||'<p class="small">No sellers live now.</p>';
  document.getElementById('tiles').innerHTML=cats.map(c=>`<span class="tile ${c===curCat?'active':''}" onclick="setCat('${c}')">${c}</span>`).join('');
  let rows=o.listings.filter(l=>!curType||l.type===curType); if(curCat!=='All')rows=rows.filter(l=>l.category===curCat);
  document.getElementById('list').innerHTML=rows.map(l=>`<div class="card"><h3>${l.title} ${l.authenticity!=='Authentic'?`<span class="badge gold">${l.authenticity.toUpperCase()}</span>`:''}</h3>
  <p>${l.category} • ${l.type==='buy_now'?'Store — Buy Now Only':'Auction • '+l.mode} • ${l.seller}</p>
  <p>${l.type==='buy_now'?`Price $${l.fixed_price}`:`Current bid $${l.current_bid} • Starting $${l.start_price}`}<br>Shipping $${l.shipping} (buyer pays) • Insured shipping ✓</p>
  <p class="small">Status: ${l.status} ${l.payment_status==='declined'?'<span class="badge">PAYMENT DECLINED</span>':''} ${l.payment_status==='validated'?'<span class="badge green">Payment went through — in escrow hold</span>':''}</p>
  <button class="btn" onclick="openItem('${l.id}')">Open</button></div>`).join('')||'<p>No listings yet — be the first to sell something.</p>';
  const d=await j('/api/drops'); document.getElementById('drops').innerHTML=d.map(x=>`<p>Free Drop: ${x.title} by ${x.seller} — ${x.status} ${x.winner?'winner: '+x.winner:''}</p>`).join('');
  const s=await j('/api/coming-up'); document.getElementById('shows').innerHTML=s.map(x=>`<p>Coming Up: ${x.title} by ${x.seller} — ${x.starts_at}</p>`).join('');
}
function setCat(c){curCat=c;load();}
async function createListing(){
  const b={seller:document.getElementById('sSeller').value,title:document.getElementById('sTitle').value,description:document.getElementById('sDesc').value,category:document.getElementById('sCat').value,type:document.getElementById('sType').value,startPrice:document.getElementById('sStart').value,fixedPrice:document.getElementById('sFixed').value,shipping:document.getElementById('sShip').value,carrier:document.getElementById('sCarrier').value,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked};
  const r=await j('/api/listings',b); document.getElementById('sellMsg').textContent=r.ok?'Listed!':('Error: '+r.error); if(r.ok)load();
}
async function openItem(id){
  const l=await j('/api/listings/'+id);
  const el=document.getElementById('detail'); el.scrollIntoView();
  el.innerHTML=`<div class="card"><h2>${l.title}</h2><p>${l.description||''} • ${l.category} • ${l.authenticity} • Seller: ${l.seller}</p>
  ${l.type==='auction'?`<p class="timer" id="cd"></p><p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>
  <label>Your name <input id="bName"></label><label>Bid $ <input id="bAmt" type="number" value="${l.current_bid+1}"></label>
  <button class="btn" onclick="bid('${l.id}',1)">+$1</button><button class="btn" onclick="bid('${l.id}',5)">+$5</button><button class="btn" onclick="bid('${l.id}',10)">+$10</button>
  <button class="btn" onclick="bidCustom('${l.id}')">Place custom bid</button>
  <p class="small">Bid slider: use the amount box above. My Top Limit: set a max and the system bids the smallest step for you.</p>
  <label>My Top Limit $ <input id="tlAmt" type="number"></label><button class="btn ghost" onclick="setTop('${l.id}')">Set My Top Limit</button>`
  :`<p>Store price $${l.fixed_price} + $${l.shipping} shipping = $${l.fixed_price+l.shipping} total</p>
  <label>Your name <input id="bName"></label><label>Payment method <select id="pMethod"><option>card</option><option>PayPal</option><option>Apple Pay</option><option>Google Pay</option><option>Cash App</option><option>Venmo</option><option>bank</option></select></label>
  <label>Payment detail (test: use 4242…4242 to pass, 4000…0002 to decline) <input id="pDetail" value="4242424242424242"></label>
  <button class="btn green" onclick="buyNow('${l.id}')">Buy Now — check my payment first</button>`}
  ${l.status==='ended'?`<p><b>Winner: ${l.winner||'—'}</b> — ${l.payment_status==='validated'?'Payment went through — in escrow hold':l.payment_status==='declined'?'Payment declined — buyer needs to fix payment':'Waiting for winner payment'}</p>
  ${l.payment_status==='declined'?`<div style="background:#c62828;padding:14px;border-radius:10px"><h3>PAYMENT DIDN'T GO THROUGH! Don't lose this sale — pick one</h3><button class="btn" onclick="fixPay('${l.id}')">Fix Payment</button><button class="btn" onclick="rerun('${l.id}','${l.seller}')">Rerun Auction</button></div>`:''}
  <label>Winner payment method <select id="pMethod"><option>card</option><option>PayPal</option><option>Venmo</option></select></label><label>Detail <input id="pDetail" value="4242424242424242"></label><button class="btn" onclick="payWinner('${l.id}')">Pay now</button>`:''}
  ${l.receipt?`<p>Receipt ${l.receipt.receipt_no} — total $${l.receipt.total} — <a href="#" onclick="alert('Receipt ${l.receipt.receipt_no}: ${l.title}, $${l.receipt.total} paid, seller ${l.seller}, winner ${l.winner}');return false">Download receipt</a></p>`:''}
  <h3>Chat room ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3><p class="small">Live in chat — no video yet. Buyers see live status + chat only.</p>
  <div class="chat">${l.chats.map(c=>`<p><b>${c.name}${c.is_seller?' (seller)':''}:</b> ${c.message}</p>`).join('')}</div>
  <label>Your name <input id="cName"></label><label>Message <input id="cMsg"></label><button class="btn" onclick="chat('${l.id}')">Post</button>
  <button class="btn ghost" onclick="goLive('${l.id}')">Go Live — Turn Camera On (seller only)</button>
  <button class="btn ghost" onclick="offer('${l.id}')">Post Buy It Now offer in chat (seller)</button>
  <p><button class="btn ghost" onclick="report('${l.id}')">Report this listing</button> <button class="btn ghost" onclick="score('${l.seller}')">Seller Scorecard</button></p>
  <div id="itemMsg"></div></div>`;
  if(l.ends_at){const t=setInterval(()=>{const ms=new Date(l.ends_at)-new Date();const e=document.getElementById('cd');if(!e){clearInterval(t);return;}e.textContent=ms>0?('⏱ '+Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')):'Auction ended';},250);}
}
async function bid(id,add){const l=await j('/api/listings/'+id);const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:l.current_bid+add});alert(r.ok?`Bid placed: $${r.currentBid} (total $${r.total})`:'Error: '+r.error);openItem(id);}
async function bidCustom(id){const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:Number(document.getElementById('bAmt').value)});alert(r.ok?`Bid placed: $${r.currentBid}`:'Error: '+r.error);openItem(id);}
async function setTop(id){const r=await j('/api/top-limit',{listingId:id,buyer:document.getElementById('bName').value||'Buyer',maxAmount:Number(document.getElementById('tlAmt').value)});alert(r.ok?'My Top Limit set':'Error: '+r.error);}
async function buyNow(id){const r=await j('/api/listings/'+id+'/buy-now',{buyer:document.getElementById('bName').value||'Buyer',method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Sale complete — $${r.total} in escrow. Receipt ${r.receiptNo}`:'Error: '+r.error);openItem(id);}
async function payWinner(id){const r=await j('/api/listings/'+id+'/pay',{method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Payment went through — $${r.total} in escrow`:'Error: '+r.error);openItem(id);}
async function fixPay(id){const r=await j('/api/listings/'+id+'/notify-fix',{});alert(r.ok?'Fix-payment notice sent to the winner':'Error: '+r.error);}
async function rerun(id,seller){const r=await j('/api/listings/'+id+'/rerun',{seller});alert(r.ok?'Auction rerun — live again at the same price/timer':'Error: '+r.error);openItem(id);}
async function chat(id){await j('/api/listings/'+id+'/chat',{name:document.getElementById('cName').value||'Buyer',message:document.getElementById('cMsg').value});openItem(id);}
async function goLive(id){const r=await j('/api/listings/'+id+'/go-live',{seller:document.getElementById('cName').value});alert(r.ok?'You are LIVE NOW in chat':'Error: '+r.error);openItem(id);}
async function offer(id){const amt=prompt('Buy It Now offer $ ?');if(!amt)return;const r=await j('/api/listings/'+id+'/buy-now-offer',{seller:document.getElementById('cName').value,amount:Number(amt)});alert(r.ok?'Offer posted in chat':'Error: '+r.error);openItem(id);}
async function report(id){const r=await j('/api/report',{listingId:id,reason:prompt('What is wrong with this listing?')||''});alert(r.message||'Reported');}
async function score(s){const r=await j('/api/scorecard/'+encodeURIComponent(s));alert(`Seller Scorecard for ${s}: ${r.average||'no scores yet'} / 5 from ${r.count} score(s)`);}
async function follow(){const r=await j('/api/follow',{buyer:document.getElementById('fBuyer').value,seller:document.getElementById('fSeller').value});document.getElementById('followMsg').textContent=r.message||r.error;}
async function makeDrop(){const r=await j('/api/drops',{seller:document.getElementById('dSeller').value,title:document.getElementById('dTitle').value});alert(r.ok?'Free Drop started — one entry per person, seller covers shipping':'Error');load();}
async function makeShow(){const r=await j('/api/shows',{seller:document.getElementById('cSeller').value,title:document.getElementById('cTitle').value,startsAt:new Date(document.getElementById('cWhen').value).toISOString()});alert(r.ok?'Show scheduled':'Error');load();}
async function joinWaitlist(){const r=await j('/api/waitlist',{name:document.getElementById('wName').value,email:document.getElementById('wEmail').value,founding:document.getElementById('wFound').checked});document.getElementById('waitMsg').textContent=r.ok?'You are on the waitlist!':r.error;}
async function claimFounding(){const r=await j('/api/founding/claim',{seller:document.getElementById('wName').value||'Seller'});document.getElementById('waitMsg').textContent=r.ok?`Founding spot claimed! ${r.taken}/10 taken`:'Error: '+r.error;load();}
async function loadDash(){const d=await j('/api/dashboard');document.getElementById('dash').innerHTML=`<p>Total fees earned: $${d.totalFeesEarned}</p><p>Tax set aside (${d.taxPercent}%): $${d.taxSetAside}</p><p>Available to use / owner draw: $${d.availableToUse}</p><p>Unpaid wins: ${d.unpaidWins.length} • Refunds pending: ${d.refundsPending.length} • Escrow held: ${d.escrowHeld.length}</p>`;}
async function setTax(){const r=await j('/api/settings/tax',{percent:Number(document.getElementById('taxPct').value)});alert(r.ok?'Tax % set to '+r.taxPercent:'Error: '+r.error);loadDash();}
document.getElementById('sCat').innerHTML=cats.slice(1).map(c=>`<option>${c}</option>`).join('');
load(); setInterval(load,15000);

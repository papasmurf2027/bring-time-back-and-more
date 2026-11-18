let cats=['All','Watches','Clothes','Shoes','Electronics','Collectibles','Home','Fashion','Art','Sports','Toys','Other'];
let curCat='All', curType='';
async function j(u,o){const r=await fetch(u,o?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}:undefined);return r.json();}
function show(w){document.getElementById('sellSec').style.display=w==='sell'?'block':'none';document.getElementById('dashSec').style.display=w==='dash'?'block':'none';if(w==='buy'){curType='';load();}if(w==='store'){curType='buy_now';load();}if(w==='dash')loadDash();const target=w==='sell'?document.getElementById('sellSec'):w==='dash'?document.getElementById('dashSec'):document.getElementById('list');if(target){target.scrollIntoView({behavior:'smooth',block:'start'});}if(w==='sell'){const f=document.getElementById('sSeller');if(f)setTimeout(()=>f.focus(),400);}}
async function load(){
  const o=await j('/api/overview');
  document.getElementById('founding').textContent=`Founding sellers: ${o.founding.taken}/10 taken — ${o.founding.remaining} spots left. 0% until it goes live, then 5% forever. Normal fee 10%.`;
  document.getElementById('liveNow').innerHTML=o.listings.filter(l=>l.seller_live&&l.status==='live').map(l=>`<p><span class="badge">🔴 LIVE NOW</span> <b>${l.seller}</b> — ${l.title} — $${l.current_bid} <button class="btn ghost" onclick="openItem('${l.id}')">Join room</button></p>`).join('')||'<p class="small">No sellers live now.</p>';
  document.getElementById('tiles').innerHTML=cats.map(c=>`<span class="tile ${c===curCat?'active':''}" onclick="setCat('${c}')">${c}</span>`).join('');
  let rows=o.listings.filter(l=>!curType||l.type===curType); if(curCat!=='All')rows=rows.filter(l=>l.category===curCat);
  document.getElementById('list').innerHTML=rows.map(l=>`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h3>${l.title} ${l.is_random?`<span class="badge gold">🎲 RANDOM ITEM</span>`:''} ${l.authenticity!=='Authentic'?`<span class="badge gold">${l.authenticity.toUpperCase()}</span>`:''}</h3>
  ${l.is_random?`<p class="small">🎲 RANDOM ITEM — no picture, seller shows it live on camera.</p>`:''}
  <p>${l.category} • ${l.type==='buy_now'?'Store — Buy Now Only':l.type==='wheel'?'⏰ Time Wheel • '+l.mode:'Auction • '+l.mode} • ${l.seller}${l.type==='wheel'?` • ${l.wheel_count||0} items on the wheel`:''}</p>
  <p>${l.type==='buy_now'?`Price $${l.fixed_price}`:`Current bid $${l.current_bid} • Starting $${l.start_price}`}<br>Shipping $${l.shipping} (buyer pays)${l.package_size?` • ${shipLabelOf(l.package_size)}`:''} • ${shipViaText(l)} • Insured shipping ✓</p>
  <p class="small">Status: ${l.status} ${l.payment_status==='declined'?'<span class="badge">PAYMENT DECLINED</span>':''} ${l.payment_status==='validated'?'<span class="badge green">Payment went through — in escrow hold</span>':''}</p>
  <button class="btn" onclick="openItem('${l.id}')">Open</button></div>`).join('')||'<p>No listings yet — be the first to sell something.</p>';
  const d=await j('/api/drops'); document.getElementById('drops').innerHTML=d.map(x=>`<p>Free Drop: ${x.title} by ${x.seller} — ${x.status} ${x.winner?'winner: '+x.winner:''}</p>`).join('');
  const s=await j('/api/coming-up'); document.getElementById('shows').innerHTML=s.map(x=>`<p>Coming Up: ${x.title} by ${x.seller} — ${x.starts_at}</p>`).join('');
}
function setCat(c){curCat=c;load();}
// Shipping by package size (same tiers as the server — Whatnot-style US rates).
const SHIP_SIZES={small:{label:'Small — under 4 oz',price:4.47},medium:{label:'Medium — 4–8 oz',price:4.85},large:{label:'Large — 8–12 oz',price:5.25},xl:{label:'XL — 12 oz–1 lb',price:6.75},box:{label:'Box — 1–5 lb',price:7.75},bigbox:{label:'Big box — over 5 lb',price:9.69},flat:{label:'Flat Rate box',price:12.99},envelope:{label:'Card envelope',price:0.99}};
function shipLabelOf(s){return (SHIP_SIZES[s]||{}).label||'';}
// Carrier rule: USPS for everything, UPS for Big box over 5 lb. No FedEx.
// The carrier is automatic from package size — the seller never picks it.
function carrierOf(l){return l.carrier||(l.package_size==='bigbox'?'UPS':'USPS');}
function shipViaText(l){const c=carrierOf(l);return c==='UPS'?'Ships via UPS (over 5 lbs)':'Ships via USPS';}

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
async function createListing(){
  const size=document.getElementById('sSize').value;
  const wheelItems=(document.getElementById('sWheel').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const b={seller:document.getElementById('sSeller').value,title:document.getElementById('sTitle').value,description:document.getElementById('sDesc').value,category:document.getElementById('sCat').value,type:document.getElementById('sType').value,startPrice:document.getElementById('sStart').value,fixedPrice:document.getElementById('sFixed').value,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked,imageUrl:window._photoData||'',wheelItems};
  const r=await j('/api/listings',b); document.getElementById('sellMsg').textContent=r.ok?'Listed!':('Error: '+r.error); if(r.ok)load();
}
// Random Items: one tap creates N numbered auctions (Random Item 1, 2, 3…),
// no picture needed — the seller shows each one live on camera. Uses the
// same seller name, category, starting bid, timer, mode, package size,
// insured shipping and Seller Agreement as the sell form above.
async function createRandomItems(){
  const size=document.getElementById('sSize').value;
  const b={isRandom:true,randomBase:document.getElementById('sRandomBase').value,randomCount:Number(document.getElementById('sRandomCount').value),seller:document.getElementById('sSeller').value,category:document.getElementById('sCat').value,startPrice:document.getElementById('sStart').value,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked};
  const r=await j('/api/listings',b);
  document.getElementById('randomMsg').textContent=r.ok?`Created ${r.count} random items: ${r.titles.join(', ')} — no picture, show each one live on camera.` : ('Error: '+r.error);
  if(r.ok)load();
}
// Seller says what the winner actually won on a Random Item — the item they
// held up live on camera. Saved on the listing, then shown on the receipt,
// the video receipt and the ship-QR section.
async function revealItem(id){
  const seller=document.getElementById('cName').value;
  const revealed=document.getElementById('revealedInput').value;
  const r=await j('/api/listings/'+id+'/reveal',{seller,revealedItem:revealed});
  if(!r.ok){alert('Error: '+r.error);return;}
  openItem(id);
}
// ---------- Live video (WebRTC peer-to-peer, no paid service) ----------
// Seller broadcasts their camera to each viewer in the room via RTCPeerConnection;
// the server only relays small signalling messages (join / offer / answer / ICE).
// STUN only (stun.l.google.com) — no TURN server, so a few strict networks may fail.
let liveListingId=null, liveRole=null, liveViewerId=null, liveStream=null, liveRemoteStream=null;
let livePCs={}, livePoll=null, liveSince=null, liveSeen=new Set();
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
  stopLivePoll();
  for(const k of Object.keys(livePCs)){try{livePCs[k].close();}catch(e){}}
  livePCs={};
  if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null;}
  liveRemoteStream=null; liveListingId=null; liveRole=null; liveViewerId=null; liveSince=null; liveSeen=new Set();
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
// ---------- Time Wheel (Kevin's own design — a clock-face wheel, gold + dark navy) ----------
// Items sit around the wheel like numbers on a clock; a gold hand at the top
// points at the landed item. Nobody buys a spot, nobody pays to spin — the
// winner pays the winning bid + shipping, the wheel lands on ONE item, and
// that item is what they get. No extra prize, no extra charge.
function wheelAngle(i,n){return n?i*360/n:0;}
function wheelSVG(l,rotDeg){
  const items=l.wheel_items||[];
  if(!items.length)return '<p class="small">No items on this wheel yet.</p>';
  const n=items.length, cx=160, cy=160, r=118;
  const font=n<=12?13:n<=24?11:n<=48?9:7;
  let texts='';
  items.forEach((it,i)=>{
    const a=wheelAngle(i,n)*Math.PI/180;
    const x=cx+r*Math.sin(a), y=cy-r*Math.cos(a);
    const label=String(it.name||'').slice(0,18);
    texts+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#f5d76e" font-size="${font}" font-weight="600" transform="rotate(${wheelAngle(i,n)} ${x.toFixed(1)} ${y.toFixed(1)})">${escHtml(label)}</text>`;
  });
  return `<svg viewBox="0 0 320 320" style="width:100%;max-width:340px;display:block;margin:0 auto">
  <circle cx="160" cy="160" r="152" fill="#0b1f3a" stroke="#c9a227" stroke-width="4"/>
  <circle cx="160" cy="160" r="138" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.5"/>
  <g id="wheelDial" style="transform-origin:160px 160px;transform:rotate(${rotDeg||0}deg)">${texts}</g>
  <circle cx="160" cy="160" r="34" fill="#c9a227"/><text x="160" y="157" text-anchor="middle" fill="#0b1f3a" font-size="11" font-weight="700">TIME</text><text x="160" y="171" text-anchor="middle" fill="#0b1f3a" font-size="11" font-weight="700">WHEEL</text>
  <polygon points="160,2 148,26 172,26" fill="#f5d76e" stroke="#c9a227" stroke-width="1"/></svg>`;
}
function wheelPanel(l){
  const items=l.wheel_items||[];
  const landedIdx=items.findIndex(x=>x.name===l.wheel_landed_item);
  const rot=l.wheel_spun&&landedIdx>=0?-wheelAngle(landedIdx,items.length):0;
  let status='';
  if(l.wheel_spun&&l.wheel_landed_item)status=`<p><b>⏰ The wheel landed on: ${escHtml(l.wheel_landed_item)}</b> — that is the item ${escHtml(l.winner||'the winner')} gets. No extra prize, no extra charge.</p>`;
  else if(l.status==='sold'&&l.payment_status==='validated')status=`<p>The winner has paid — spin the wheel to see what they get.</p><button class="btn" onclick="spinWheel('${l.id}')">Spin the Time Wheel</button>`;
  else if(l.status==='ended')status=`<p class="small">The wheel spins once the winner pays.</p>`;
  else status=`<p class="small">Bidding is for the wheel — the winner pays the winning bid + shipping, then the wheel spins and lands on one item. That item is what they get.</p>`;
  return `<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px;background:#0b1f3a">
  <h3 style="color:#f5d76e;margin-top:0">⏰ Time Wheel — ${items.length} item${items.length===1?'':'s'}</h3>
  <p class="small" style="color:#f5d76e">You win the item the wheel lands on — no extra prize, no extra charge. Nobody buys a spot, nobody pays to spin.</p>
  ${wheelSVG(l,rot)}
  ${status}
  <p id="wheelMsg" class="small"></p>
  <details><summary class="small">See all ${items.length} items on the wheel</summary><ol class="small">${items.map(x=>`<li>${escHtml(x.name)}</li>`).join('')}</ol></details>
  </div>`;
}
async function spinWheel(id){
  const name=(document.getElementById('cName')&&document.getElementById('cName').value)||(document.getElementById('bName')&&document.getElementById('bName').value)||'';
  const r=await j('/api/listings/'+id+'/spin',{name});
  if(!r.ok){alert('Error: '+r.error);return;}
  const l=await j('/api/listings/'+id);
  const items=l.wheel_items||[];
  const idx=Math.max(0,items.findIndex(x=>x.name===r.landedItem));
  const target=360*6-wheelAngle(idx,items.length||1);
  const dial=document.getElementById('wheelDial');
  if(dial){dial.style.transition='transform 4s cubic-bezier(.15,.8,.25,1)';dial.style.transform=`rotate(${target}deg)`;}
  const msg=document.getElementById('wheelMsg'); if(msg)msg.textContent='⏰ Spinning…';
  setTimeout(()=>openItem(id),4300);
}
async function openItem(id){
  const wasLive=liveListingId===id&&(liveRole==='seller'||liveRole==='viewer');
  if(!wasLive)stopLiveFull(); else stopLivePoll(); // re-render keeps the stream/PCs, restarts polling below
  liveListingId=id;
  const l=await j('/api/listings/'+id);
  const el=document.getElementById('detail'); el.scrollIntoView();
  el.innerHTML=`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h2>${l.title}</h2>${l.is_random?`<p><span class="badge gold">🎲 RANDOM ITEM — no picture, seller shows it live on camera</span></p>`:''}<p>${l.description||''} • ${l.category} • ${l.authenticity} • Seller: ${l.seller}</p>
  ${l.is_random&&l.status==='sold'&&l.payment_status==='validated'?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>🎲 What they won</h3>${l.revealed_item?`<p><b>Revealed live on camera: ${escHtml(l.revealed_item)}</b> — that is what ${escHtml(l.winner)} won.</p>`:`<p>Random Item — revealed live on camera, seller to confirm what it was.</p><label>What they won (seller only — type the item you held up live) <input id="revealedInput" placeholder="e.g. Invicta Lupah watch"></label><button class="btn" onclick="revealItem('${l.id}')">Save what they won</button>`}</div>`:''}
  ${l.type==='wheel'?wheelPanel(l):''}
  ${(l.type==='auction'||l.type==='wheel')?`<p class="timer" id="cd"></p><p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>
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
  ${l.receipt?`<p>Receipt ${l.receipt.receipt_no} — total $${l.receipt.total} — <a href="#" onclick="alert('Receipt ${l.receipt.receipt_no}: ${l.title}, $${l.receipt.total} paid, seller ${l.seller}, winner ${l.winner}');return false">Download receipt</a></p>${l.wheel_landed_item?`<p><b>You won: ${escHtml(l.wheel_landed_item)}</b> — the item the Time Wheel landed on. No extra prize, no extra charge.</p>`:''}${l.revealed_item?`<p><b>You won: ${escHtml(l.revealed_item)}</b> — revealed live on camera (Random Item: ${escHtml(l.title)}).</p>`:l.is_random&&l.status==='sold'?`<p class="small">🎲 Video receipt: Random Item — revealed live on camera, seller to confirm what it was.</p>`:''}`:''}
  <p class="small">Package size: ${l.package_size?shipLabelOf(l.package_size)+' — $'+l.shipping+' shipping (buyer pays)':'Shipping $'+l.shipping+' (buyer pays)'} • <b>${shipViaText(l)}</b></p>
  ${l.qr_text?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>📦 Ship this order — scan the QR code</h3>
  <canvas id="shipQR" style="max-width:100%;background:#fff;border-radius:8px"></canvas>
  <p><b>${l.title}</b>${l.wheel_landed_item?`<br>Item to ship: <b>${escHtml(l.wheel_landed_item)}</b> (what the Time Wheel landed on)`:''}${l.revealed_item?`<br>Item to ship: <b>${escHtml(l.revealed_item)}</b> (revealed live on camera)`:l.is_random?`<br>Item to ship: random item — seller to confirm what it was`:''}<br>Winner: ${l.winner}<br>Winner address: address on file<br>Package: ${l.package_size?shipLabelOf(l.package_size):'—'} • Shipping $${l.shipping}<br><b>Carrier: ${carrierOf(l)}</b> — ${carrierOf(l)==='UPS'?'drop it off at UPS (over 5 lbs)':'drop it off at the post office (USPS)'}<br>Tracking: ${l.qr_tracking||l.tracking||'—'}<br>Receipt: ${l.qr_receipt||''}</p>
  <p class="small">Scan this code with your phone — it opens this exact sale, so you ship the right item and don't box up the wrong order. This QR is a shipment record, not real ${carrierOf(l)} postage yet.</p>
  ${l.shipped_at?`<p><span class="badge green">Marked as shipped ${l.shipped_at}</span></p>`:`<button class="btn" onclick="markShipped('${l.id}')">Mark as shipped</button>`}
  <p id="shipMsg" class="small"></p></div>`:''}
  <h3>Live video ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3>
  <video id="liveVideo" playsinline autoplay style="width:100%;max-height:420px;background:#000;border-radius:10px;display:none"></video>
  <button class="btn" id="unmuteBtn" style="display:none" onclick="const v=document.getElementById('liveVideo');v.muted=false;v.play();this.style.display='none'">Tap for sound — hear the seller</button>
  <p id="liveStatus" class="small">${l.seller_live?'Seller is live — connecting to live video…':'Seller is not live yet. When they go live, their camera shows here.'}</p>
  <button class="btn ghost" id="endLiveBtn" style="display:none" onclick="endLive('${l.id}')">End Live</button>
  <h3>Chat room ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3><p class="small">Live video + live chat — type in chat what you want the seller to show you.</p>
  <div class="chat">${l.chats.map(c=>`<p><b>${c.name}${c.is_seller?' (seller)':''}:</b> ${c.message}</p>`).join('')}</div>
  <label>Your name <input id="cName"></label><label>Message <input id="cMsg"></label><button class="btn" onclick="chat('${l.id}')">Post</button>
  <button class="btn ghost" onclick="goLive('${l.id}')">Go Live — Turn Camera On (seller only)</button>
  <button class="btn ghost" onclick="offer('${l.id}')">Post Buy It Now offer in chat (seller)</button>
  <p><button class="btn ghost" onclick="report('${l.id}')">Report this listing</button> <button class="btn ghost" onclick="score('${l.seller}')">Seller Scorecard</button></p>
  <div id="itemMsg"></div></div>`;
  if(l.qr_text)drawQR(l.qr_text,document.getElementById('shipQR'));
  if(l.ends_at){const t=setInterval(()=>{const ms=new Date(l.ends_at)-new Date();const e=document.getElementById('cd');if(!e){clearInterval(t);return;}e.textContent=ms>0?('⏱ '+Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')):'Auction ended';},250);}
  // Live video: re-attach after a re-render, or join as a viewer if the seller is live.
  if(wasLive&&liveRole==='seller'&&liveStream){
    const v=liveVideoEl(); if(v){v.srcObject=liveStream; v.style.display='block'; v.play().catch(()=>{});}
    const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
    setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
    startSellerPoll(id);
  } else if(wasLive&&liveRole==='viewer'){
    const v=liveVideoEl(); if(v&&liveRemoteStream){v.srcObject=liveRemoteStream; v.muted=false; v.style.display='block'; v.play().catch(()=>{const b=document.getElementById('unmuteBtn'); if(b)b.style.display='inline-block';});}
    stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
  } else if(l.seller_live&&(l.type==='auction'||l.type==='wheel')){
    startViewer(id);
  }
}
async function bid(id,add){const l=await j('/api/listings/'+id);const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:l.current_bid+add});alert(r.ok?`Bid placed: $${r.currentBid} (total $${r.total})`:'Error: '+r.error);openItem(id);}
async function bidCustom(id){const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:Number(document.getElementById('bAmt').value)});alert(r.ok?`Bid placed: $${r.currentBid}`:'Error: '+r.error);openItem(id);}
async function setTop(id){const r=await j('/api/top-limit',{listingId:id,buyer:document.getElementById('bName').value||'Buyer',maxAmount:Number(document.getElementById('tlAmt').value)});alert(r.ok?'My Top Limit set':'Error: '+r.error);}
async function buyNow(id){const r=await j('/api/listings/'+id+'/buy-now',{buyer:document.getElementById('bName').value||'Buyer',method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Sale complete — $${r.total} in escrow. Receipt ${r.receiptNo}`:'Error: '+r.error);openItem(id);}
async function payWinner(id){const r=await j('/api/listings/'+id+'/pay',{method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?(`Payment went through — $${r.total} in escrow`+(r.landedItem?` — the Time Wheel landed on: ${r.landedItem}`:'')):'Error: '+r.error);openItem(id);}
async function markShipped(id){const seller=document.getElementById('cName').value;const r=await j('/api/listings/'+id+'/mark-shipped',{seller});const m=document.getElementById('shipMsg');if(m)m.textContent=r.ok?('Marked as shipped — tracking '+r.tracking):('Error: '+r.error);if(r.ok)openItem(id);}
async function fixPay(id){const r=await j('/api/listings/'+id+'/notify-fix',{});alert(r.ok?'Fix-payment notice sent to the winner':'Error: '+r.error);}
async function rerun(id,seller){const r=await j('/api/listings/'+id+'/rerun',{seller});alert(r.ok?'Auction rerun — live again at the same price/timer':'Error: '+r.error);openItem(id);}
async function chat(id){await j('/api/listings/'+id+'/chat',{name:document.getElementById('cName').value||'Buyer',message:document.getElementById('cMsg').value});openItem(id);}
async function goLive(id){
  const seller=document.getElementById('cName').value;
  // Camera first: if the seller blocks it, do not mark the room live.
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});}
  catch(e){alert('Camera / mic blocked — allow camera access in your browser settings and try again.');return;}
  const r=await j('/api/listings/'+id+'/go-live',{seller});
  if(!r.ok){stream.getTracks().forEach(t=>t.stop());alert('Error: '+r.error);return;}
  // Stop any viewer connection from this browser, then broadcast.
  if(liveRole==='viewer'){stopLiveFull(); liveListingId=id;}
  liveRole='seller'; liveStream=stream; liveSince=new Date().toISOString(); liveSeen=new Set(); livePCs={};
  const v=liveVideoEl(); if(v){v.srcObject=stream; v.muted=true; v.style.display='block'; v.play().catch(()=>{});}
  const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
  setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
  startSellerPoll(id);
  alert('You are LIVE NOW — buyers can see your camera.');
}
async function endLive(id){
  if(liveRole==='viewer')sendSignal(id,liveViewerId,'seller','leave',{});
  stopLiveFull();
  await j('/api/listings/'+id+'/end-live',{});
  openItem(id);
}
async function offer(id){const amt=prompt('Buy It Now offer $ ?');if(!amt)return;const r=await j('/api/listings/'+id+'/buy-now-offer',{seller:document.getElementById('cName').value,amount:Number(amt)});alert(r.ok?'Offer posted in chat':'Error: '+r.error);openItem(id);}
async function report(id){const r=await j('/api/report',{listingId:id,reason:prompt('What is wrong with this listing?')||''});alert(r.message||'Reported');}
async function score(s){const r=await j('/api/scorecard/'+encodeURIComponent(s));alert(`Seller Scorecard for ${s}: ${r.average||'no scores yet'} / 5 from ${r.count} score(s)`);}
async function follow(){const r=await j('/api/follow',{buyer:document.getElementById('fBuyer').value,seller:document.getElementById('fSeller').value});document.getElementById('followMsg').textContent=r.message||r.error;}
async function makeDrop(){const r=await j('/api/drops',{seller:document.getElementById('dSeller').value,title:document.getElementById('dTitle').value});alert(r.ok?'Free Drop started — one entry per person, seller covers shipping':'Error');load();}
async function makeShow(){const r=await j('/api/shows',{seller:document.getElementById('cSeller').value,title:document.getElementById('cTitle').value,startsAt:new Date(document.getElementById('cWhen').value).toISOString()});alert(r.ok?'Show scheduled':'Error');load();}
async function joinWaitlist(){const r=await j('/api/waitlist',{name:document.getElementById('wName').value,email:document.getElementById('wEmail').value,founding:document.getElementById('wFound').checked});document.getElementById('waitMsg').textContent=r.ok?'You are on the waitlist!':r.error;}
async function claimFounding(){const r=await j('/api/founding/claim',{seller:document.getElementById('wName').value||'Seller'});document.getElementById('waitMsg').textContent=r.ok?`Founding spot claimed! ${r.taken}/10 taken`:'Error: '+r.error;load();}
async function loadDash(){const d=await j('/api/dashboard');document.getElementById('dash').innerHTML=`<p>Total fees earned: $${d.totalFeesEarned}</p><p>Tax set aside (${d.taxPercent}%): $${d.taxSetAside}</p><p>Available to use / owner draw: $${d.availableToUse}</p><p>Unpaid wins: ${d.unpaidWins.length} • Refunds pending: ${d.refundsPending.length} • Escrow held: ${d.escrowHeld.length}</p>`;loadLiveNotice();loadSoldQRs();}
async function loadSoldQRs(){
  const el=document.getElementById('soldQRs');if(!el)return;
  const rows=await j('/api/listings');
  const sold=rows.filter(l=>l.status==='sold'&&l.payment_status==='validated');
  if(!sold.length){el.innerHTML='<p class="small">No sold items yet — when someone buys or wins and pays, the QR code to ship it shows here.</p>';return;}
  el.innerHTML=sold.map(l=>`<div class="card"><h3>${l.title}${l.revealed_item?` — won: ${escHtml(l.revealed_item)}`:''}</h3><p>Winner: ${l.winner} • ${l.package_size?shipLabelOf(l.package_size):''} • <b>${shipViaText(l)}</b> • Tracking: ${l.tracking||'—'}</p><canvas id="dashQR-${l.id}" style="max-width:100%;background:#fff;border-radius:8px"></canvas><p class="small">Scan to open this exact sale, then tap Mark as shipped. Shipment record — not real ${carrierOf(l)} postage yet.</p><button class="btn ghost" onclick="openItem('${l.id}')">Open this sale</button></div>`).join('');
  for(const l of sold){const det=await j('/api/listings/'+l.id);if(det.qr_text)drawQR(det.qr_text,document.getElementById('dashQR-'+l.id));}
}
// ---------- "We're live" email to the waitlist (owner dashboard) ----------
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function loadLiveNotice(){
  const d=await j('/api/waitlist/live-notice'); const el=document.getElementById('liveNotice'); if(!el)return;
  let h=`<p><b>${d.count} people</b> on the waitlist.</p>`;
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
  const r=await j('/api/waitlist/live-notice',{force:!!force}); const m=document.getElementById('liveNoticeMsg');
  if(r.ok&&r.sent)m.textContent=`Sent! ${r.sentCount} people emailed via ${r.mode}.`;
  else if(r.ok&&!r.sent)m.textContent=r.message||'Nothing was sent automatically — use copy / mailto below.';
  else m.textContent='Error: '+(r.error||'could not send');
  loadLiveNotice();
}
async function markLiveSent(){
  const r=await j('/api/waitlist/live-notice',{markManualSent:true}); const m=document.getElementById('liveNoticeMsg');
  m.textContent=r.ok?'Marked as sent.':('Error: '+(r.error||'could not mark sent')); loadLiveNotice();
}
function copyLiveEmails(){
  const t=document.getElementById('liveEmails'); if(!t)return; t.select();
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t.value); else document.execCommand('copy');
  document.getElementById('liveNoticeMsg').textContent='Emails copied.';
}
async function setTax(){const r=await j('/api/settings/tax',{percent:Number(document.getElementById('taxPct').value)});alert(r.ok?'Tax % set to '+r.taxPercent:'Error: '+r.error);loadDash();}
document.getElementById('sCat').innerHTML=cats.slice(1).map(c=>`<option>${c}</option>`).join('');
load(); setInterval(load,15000);
// A scanned QR code opens this exact sold item: ?i=<listing id>&r=<receipt>&t=<tracking>
(function(){const q=new URLSearchParams(location.search);const item=q.get('i');if(item)setTimeout(()=>openItem(item),600);})();

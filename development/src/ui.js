'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baht = cents => new Intl.NumberFormat('th-TH', {style:'currency', currency:'THB'}).format(cents/100);
const prefix = '';
let page = location.hash.slice(1) || 'home';
let auth, db, fn, user, products = [], admin = {}, currentTab = 'products', cartQuote = null, quoteVersion = 0;
let profileTab='overview', paymentSettings={}, paymentOrder=null;
const readLocal = (key, fallback) => {try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}};
const PRODUCT_CACHE='inongshop-products-v1', PRODUCT_CACHE_MS=120000;
const cachedProducts=readLocal(PRODUCT_CACHE,null);
let productLoadedAt=0;
if(cachedProducts&&Array.isArray(cachedProducts.items)&&Date.now()-cachedProducts.savedAt<PRODUCT_CACHE_MS){products=cachedProducts.items;productLoadedAt=cachedProducts.savedAt;}
const cartKey = () => `inongshop-cart-v2-${auth?.currentUser?.uid || 'guest'}`;
function cart() {
  const raw = readLocal(cartKey(), []);
  return Array.isArray(raw) ? raw.filter(i => i && typeof i.gameId === 'string' && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 10).slice(0,20) : [];
}
function saveCart(items) {localStorage.setItem(cartKey(), JSON.stringify(items)); $('#cart-count').textContent = items.reduce((n,i)=>n+i.qty,0);}
function flash(message) {$('#flash').textContent = message; clearTimeout(flash.timer); flash.timer = setTimeout(()=>$('#flash').textContent='',6000);}
const errorText = error => ({'auth/invalid-login-credentials':'อีเมลหรือรหัสผ่านไม่ถูกต้อง','auth/invalid-credential':'อีเมลหรือรหัสผ่านไม่ถูกต้อง','auth/wrong-password':'อีเมลหรือรหัสผ่านไม่ถูกต้อง','auth/user-not-found':'อีเมลหรือรหัสผ่านไม่ถูกต้อง','auth/email-already-in-use':'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ','auth/weak-password':'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร','auth/network-request-failed':'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต','auth/user-disabled':'บัญชีนี้ถูกระงับ','auth/too-many-requests':'ลองบ่อยเกินไป กรุณารอสักครู่','permission-denied':'Firebase ยังไม่อนุญาตการทำรายการนี้ กรุณาตรวจสิทธิ์และกฎฐานข้อมูล','auth/operation-not-allowed':'ต้องเปิด Email/Password ใน Firebase Authentication ก่อน','functions/unavailable':'Backend ยังไม่พร้อมใช้งาน'}[error.code] || error.message || 'เกิดข้อผิดพลาด');
async function api(name, data = {}) {return (await fn.httpsCallable(name)(data)).data;}
const button = (label, action, id='', extra='') => `<button class="btn btn-outline" type="button" data-action="${action}" data-id="${escape(id)}" ${extra}>${label}</button>`;
const field = (label, name, value='', type='text', extra='') => `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const select = (label, name, options, value) => `<label class="field">${label}<select name="${name}">${options.map(([v,t])=>`<option value="${escape(v)}" ${String(v)===String(value)?'selected':''}>${escape(t)}</option>`).join('')}</select></label>`;
const textarea = (label, name, value='', extra='') => `<label class="field">${label}<textarea name="${name}" ${extra}>${escape(value)}</textarea></label>`;
const check = (label, name, value) => `<label class="inline-check"><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;
const submit = label => `<button class="btn btn-primary" type="submit">${label}</button>`;
const table = (heads, rows) => `<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div>`;
const status = order => {const key = order.status==='pending_payment' && order.expiresAt<Date.now() ? 'expired' : order.status; return `<span class="status-pill status-${escape(key)}">${({awaiting_review:'รอผู้ดูแลอนุมัติ',pending_payment:'รอยืนยันคำขอ',paid:'ชำระแล้ว',cancelled:'ยกเลิก',expired:'หมดอายุ'})[key] || escape(key)}</span>`;};
const date = stamp => stamp ? new Date(stamp).toLocaleString('th-TH') : '—';
function showDialog(content) {const d=$('#dialog');d.innerHTML=`${button('ปิด','close-dialog')}<div class="panel">${content}</div>`;if(!d.open)d.showModal();}
function profileFields(p={}) {return field('ชื่อ','firstName',p.firstName,'text','required maxlength="80"')+field('นามสกุล','lastName',p.lastName,'text','required maxlength="80"')+field('เบอร์โทร','phone',p.phone,'tel','pattern="0[0-9]{9}" maxlength="10"');}
async function loadProducts(force=false) {
  if(!force&&products.length&&Date.now()-productLoadedAt<PRODUCT_CACHE_MS)return;
  const fresh=(await db.collection('products').where('active','==',true).get()).docs.map(d=>({id:d.id,...d.data()}));
  products=fresh;productLoadedAt=Date.now();
  try{localStorage.setItem(PRODUCT_CACHE,JSON.stringify({savedAt:productLoadedAt,items:fresh}));}catch{}
}
/* STOREFRONT_FUNCTIONS */
async function detail(id) {
  const p=products.find(p=>p.id===id);if(!p)return;
  const reviews=(await db.collection('reviews').where('gameId','==',id).get()).docs.map(d=>d.data());
  showDialog(`<h2>${escape(p.name)}</h2><img src="${escape(imageUrl(p))}" alt="${escape(p.name)}"><p>${escape(p.desc)}</p><p class="price">${baht(Math.round((p.salePrice??p.price)*100))}</p>${button('ใส่ตะกร้า','add-cart',id,p.stock<1?'disabled':'')}<h3>รีวิวจากผู้ซื้อ</h3>${reviews.map(r=>`<div class="order-box"><strong>${escape(r.author)} · ${r.rating}/5</strong><p>${escape(r.comment)}</p></div>`).join('')||'<p class="muted">ยังไม่มีรีวิว</p>'}`);
}
function renderAuth() {
  if(auth.currentUser&&user?.firstName){$('#main').innerHTML=`<section class="panel"><h1>เข้าสู่ระบบแล้ว</h1><p>${escape(user.email)}</p><div class="actions"><a class="btn btn-primary" href="#user">บัญชีของฉัน</a>${button('ออกจากระบบ','logout')}</div></section>`;return;}
  if(auth.currentUser){$('#main').innerHTML=`<section class="panel"><h2>กรอกข้อมูลสมาชิกให้ครบ</h2><p class="muted">บัญชีถูกสร้างแล้ว บันทึกข้อมูลด้านล่างเพื่อเริ่มใช้งาน</p><form data-form="profile">${profileFields(user)}${submit('บันทึกข้อมูล')}</form>${button('ออกจากระบบ','logout')}</section>`;return;}
  $('#main').innerHTML=`<div class="grid-two"><section class="panel"><h1>ยินดีต้อนรับกลับ</h1><form data-form="login">${field('อีเมล','email','','email','required autocomplete="email"')}${field('รหัสผ่าน','password','','password','required autocomplete="current-password"')}${submit('เข้าสู่ระบบ')}</form><details><summary>ลืมรหัสผ่าน</summary><form data-form="reset">${field('อีเมล','email','','email','required')}${submit('ส่งลิงก์รีเซ็ตรหัสผ่าน')}</form></details></section><section class="panel"><h2>สมัครสมาชิก</h2><form data-form="register">${profileFields()}${field('อีเมล','email','','email','required autocomplete="email"')}${field('รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)','password','','password','required minlength="8" autocomplete="new-password"')}${field('ยืนยันรหัสผ่าน','confirm','','password','required minlength="8" autocomplete="new-password"')}${submit('สมัครสมาชิก')}</form></section></div>`;
  const layout=$('.grid-two');
  if(layout){
    layout.classList.add('auth-layout');
    layout.insertAdjacentHTML('afterbegin','<div class="auth-tabs" role="tablist" aria-label="สมาชิก"><button type="button" class="auth-tab active" role="tab" aria-selected="true" data-auth-tab="0">เข้าสู่ระบบ</button><button type="button" class="auth-tab" role="tab" aria-selected="false" data-auth-tab="1">สมัครสมาชิก</button></div>');
    const panels=[...layout.querySelectorAll('section.panel')];panels[1].hidden=true;
    layout.querySelectorAll('[data-auth-tab]').forEach(tab=>tab.addEventListener('click',()=>{const selected=Number(tab.dataset.authTab);panels.forEach((p,i)=>p.hidden=i!==selected);layout.querySelectorAll('[data-auth-tab]').forEach((t,i)=>{t.classList.toggle('active',i===selected);t.setAttribute('aria-selected',String(i===selected));});}));
  }
}
async function renderCart() {
  cartQuote=null;quoteVersion++;
  const items=cart();
  $('#main').innerHTML=`<h1>ตะกร้าสินค้า</h1><div class="panel">${table(['สินค้า','จำนวน','ราคาปัจจุบัน',''],items.map(i=>{const p=products.find(p=>p.id===i.gameId);return [escape(p?.name||'สินค้าปิดจำหน่าย'),`<input class="quantity" type="number" min="1" max="10" value="${i.qty}" data-qty="${escape(i.gameId)}" aria-label="จำนวน ${escape(p?.name)}">`,p?baht(Math.round((p.salePrice??p.price)*100)*i.qty):'—',button('ลบ','remove-cart',i.gameId)];}))}</div>${items.length?`<div class="grid-two"><section class="panel"><h2>ข้อมูลผู้ซื้อ</h2>${!user?'<p>กรุณาเข้าสู่ระบบก่อนสั่งซื้อ</p><a class="btn btn-primary" href="#auth">เข้าสู่ระบบ</a>':`<form id="checkout" data-form="checkout">${profileFields(user)}<label class="field">อีเมล<input value="${escape(user.email)}" disabled></label><p class="muted">ใช้ชำระเงินจำลอง ไม่มีการโอนเงินจริง</p>${submit('สร้างคำสั่งซื้อ')}</form>`}</section><section class="panel"><h2>สรุปรายการ</h2><form data-form="coupon">${field('รหัสคูปอง (เว้นว่างถ้าไม่ใช้)','couponCode',sessionStorage.getItem('couponCode')||'')}${submit('คำนวณยอด')}</form><div id="quote"></div></section></div>`:'<p class="empty">ตะกร้าว่าง <a href="#store">เลือกซื้อเกม</a></p>'}`;
  if(items.length&&user)await refreshQuote();
}
async function refreshQuote() {
  cartQuote=null;const version=++quoteVersion;const checkout=$('#checkout button[type=submit]');if(checkout)checkout.disabled=true;
  const el=$('#quote');if(!el)return;
  el.textContent='กำลังตรวจราคาและสต็อก…';
  try {
    const result=await api('quoteOrder',{items:cart(),couponCode:sessionStorage.getItem('couponCode')||''});
    if(version!==quoteVersion)return;
    cartQuote=result;el.innerHTML=`<div class="summary-line"><span>ราคาสินค้า</span><span>${baht(result.subtotalCents)}</span></div><div class="summary-line"><span>ส่วนลด</span><span>−${baht(result.discountCents)}</span></div><div class="summary-line price"><span>ยอดรวม</span><span>${baht(result.totalCents)}</span></div><p class="muted">ตรวจสต็อกอีกครั้งเมื่อยืนยันชำระเงิน</p>`;
    if(checkout)checkout.disabled=false;
  }catch(e){if(version===quoteVersion)el.innerHTML=`<p class="error-box">${escape(errorText(e))}</p>`;}
}
function orderMarkup(o, allowPay=true) {
  const pending=o.status==='pending_payment'&&o.expiresAt>Date.now();
  return `<article class="order-box"><h3>#${escape(o.id.slice(-8))} ${status(o)}</h3><p class="muted">${date(o.createdAt)} · ${escape(o.email)}</p>${o.items.map(i=>`<p>${escape(i.name)} × ${i.qty}</p>`).join('')}<p class="price">${baht(o.totalCents)}</p>${o.paymentDetails?`<p>ช่องทาง: ${o.paymentDetails.method==='qr'?'สแกน QR จำลอง':'โอนเงินจำลอง'} · ส่งเมื่อ ${date(o.paymentDetails.submittedAt)}</p>`:''}<div class="actions">${o.paymentDetails||o.status==='paid'?button(o.status==='paid'?'ใบเสร็จจำลอง':'ดูหลักฐานจำลอง','payment-proof',o.id):''}${!allowPay&&o.status==='awaiting_review'?button('อนุมัติและส่งคีย์ DEMO','approve',o.id):''}${pending&&allowPay?button('ไปชำระเงินจำลอง','pay',o.id):''}${['pending_payment','awaiting_review'].includes(o.status)?button(!allowPay&&o.status==='awaiting_review'?'ไม่อนุมัติ / ยกเลิก':'ยกเลิกคำสั่งซื้อ','cancel-order',o.id):''}</div></article>`;
}
async function renderUser() {
  const data=await api('myData');
  $('#main').innerHTML=`<h1>บัญชีของฉัน</h1>${button('โหลดคำสั่งซื้อ / คีย์ล่าสุด','refresh-user')}<p>${escape(user?.firstName||'สมาชิก')} · ${escape(user?.email)}</p><div class="actions">${user.role==='admin'?'<a class="btn btn-primary" href="#admin">จัดการหลังบ้าน</a>':''}${button('ออกจากระบบ','logout')}</div><div class="grid-two"><section class="panel"><h2>ข้อมูลส่วนตัว</h2><form data-form="profile">${profileFields(user)}${submit('บันทึกข้อมูล')}</form></section><section class="panel"><h2>เปลี่ยนรหัสผ่าน</h2><form data-form="password">${field('รหัสผ่านเดิม','old','','password','required autocomplete="current-password"')}${field('รหัสผ่านใหม่','password','','password','required minlength="8" autocomplete="new-password"')}${field('ยืนยันรหัสผ่านใหม่','confirm','','password','required minlength="8" autocomplete="new-password"')}${submit('เปลี่ยนรหัสผ่าน')}</form></section></div><section class="panel" id="orders"><h2>คำสั่งซื้อ</h2>${data.orders.map(o=>orderMarkup(o)).join('')||'<p class="muted">ยังไม่มีคำสั่งซื้อ</p>'}</section><section class="panel" id="library"><h2>คลังเกมของฉัน</h2><p class="muted">คีย์ตัวอย่างสำหรับสาธิต ใช้เปิดเกมจริงไม่ได้</p>${data.keys.map(k=>`<div class="order-box"><h3>${escape(k.gameName)}</h3><code class="key-code">${escape(k.key)}</code><div class="actions">${button('คัดลอก','copy',k.key)}${button('เขียนรีวิว','review',k.gameId)}</div></div>`).join('')||'<p>ยังไม่มีคีย์</p>'}</section><section class="panel"><h2>รายการโปรด</h2>${cards(products.filter(p=>(user.wishlist||[]).includes(p.id)))}</section>`;
}
function renderAdminTab() {
  $('#admin-tabs').innerHTML=[['products','สินค้า'],['key_inventory','คีย์เกม'],['orders','คำสั่งซื้อ / ตรวจชำระ'],['users','สมาชิก'],['coupons','คูปอง'],['reviews','รีวิว'],['payment','ตั้งค่าชำระเงิน']].map(([id,label])=>button(label,'admin-tab',id,`aria-pressed="${id===currentTab}"`)).join('');
  const content=$('#admin-content');
  if(currentTab==='products') content.innerHTML=button('เพิ่มสินค้า','edit-product')+button('เพิ่มชุดสินค้าสาธิต','seed-demo')+table(['สินค้า','ราคา','คีย์พร้อมขาย','สถานะ','จัดการ'],admin.products.map(p=>[escape(p.name),baht(Math.round((p.salePrice??p.price)*100)),p.stock,p.active?'เปิดขาย':'ปิดขาย',button('แก้ไข / ปิดขาย','edit-product',p.id)]));
  if(currentTab==='key_inventory') content.innerHTML=button('นำเข้าคีย์ตัวอย่าง','import-keys')+table(['เกม','คีย์','สถานะ'],admin.key_inventory.map(k=>[escape(admin.products.find(p=>p.id===k.gameId)?.name||k.gameId),`<code>${escape(k.key)}</code>`,k.status==='sold'?'ขายแล้ว':'พร้อมขาย']));
  if(currentTab==='orders') content.innerHTML=admin.orders.sort((a,b)=>b.createdAt-a.createdAt).map(o=>orderMarkup(o,false)).join('')||'<p>ยังไม่มีคำสั่งซื้อ</p>';
  if(currentTab==='users') content.innerHTML=table(['ชื่อ','อีเมล','สถานะ','จัดการ'],admin.users.map(u=>[escape((u.firstName||'')+' '+(u.lastName||'')),escape(u.email),u.suspended?'ระงับ':'ใช้งาน',button(u.suspended?'เปิดใช้งาน':'ระงับบัญชี','suspend',u.id)]));
  if(currentTab==='coupons') content.innerHTML=button('เพิ่มคูปอง','edit-coupon')+table(['รหัส','ส่วนลด','ใช้ไป/สูงสุด','สถานะ',''],admin.coupons.map(c=>[escape(c.id),c.type==='percent'?`${c.value}%`:baht(c.value*100),`${c.usedCount}/${c.maxUses}`,c.active?'เปิด':'ปิด',button('แก้ไข','edit-coupon',c.id)]));
  if(currentTab==='reviews') content.innerHTML=table(['ผู้รีวิว','เกม','คะแนน','ข้อความ',''],admin.reviews.map(r=>[escape(r.author),escape(admin.products.find(p=>p.id===r.gameId)?.name||r.gameId),r.rating,escape(r.comment),button('ลบรีวิว','delete-review',r.id)]));
  if(currentTab==='payment') content.innerHTML=`<h2>ช่องทางชำระเงินจำลอง</h2><p class="demo-banner">ไม่มีการรับเงินจริง ไม่มีบัตร และไม่มี QR สำหรับโอนเงินจริง</p><form data-form="payment-settings">${field('ชื่อธนาคารตัวอย่าง','bank',paymentSettings.bank,'text','required maxlength="80"')}${field('ชื่อผู้รับตัวอย่าง','recipient',paymentSettings.recipient,'text','required maxlength="80"')}${field('รหัสบัญชีตัวอย่าง (DEMO- และตัวอักษรเท่านั้น)','account',paymentSettings.account,'text','required pattern="DEMO-[A-Z-]+" maxlength="60"')}${textarea('คำแนะนำ','instructions',paymentSettings.instructions,'required maxlength="500"')}${check('เปิดโอนเงินจำลอง','transfer',paymentSettings.transfer)}${check('เปิดสแกน QR จำลอง','qr',paymentSettings.qr)}${submit('บันทึกช่องทางชำระเงิน')}</form>`;
  else content.insertAdjacentHTML('afterbegin',`<label class="field">ค้นหาในหน้านี้<input type="search" data-panel-search placeholder="ชื่อ รหัส อีเมล หรือสถานะ" aria-label="ค้นหาในหลังบ้าน"></label>`);
}
async function renderAdmin() {
  admin=await api('adminData');
  paymentSettings=await api('paymentSettings');
  const revenue=admin.orders.filter(o=>o.status==='paid').reduce((s,o)=>s+o.totalCents,0);
  $('#main').innerHTML=`<h1>จัดการหลังบ้าน</h1><p class="muted">ยอดขายและสต็อกมาจากฐานข้อมูล · ยอดเงินทั้งหมดเป็นยอดสาธิต</p><div class="actions">${button('โหลดข้อมูลใหม่','refresh-admin')}${button('ออกจากระบบ','logout')}</div><div class="stat-grid">${[['ยอดขายจำลอง',baht(revenue)],['คำสั่งซื้อ',admin.orders.length],['สมาชิก',admin.users.length],['คีย์พร้อมขาย',admin.key_inventory.filter(k=>k.status==='available').length]].map(([l,n])=>`<div class="panel"><p class="muted">${l}</p><p class="stat-value">${n}</p></div>`).join('')}</div><div class="tabs" id="admin-tabs"></div><section class="panel" id="admin-content"></section>`;renderAdminTab();
}
function productEditor(id) {
  const p=admin.products.find(p=>p.id===id)||{};
  showDialog(`<h2>${id?'แก้ไข':'เพิ่ม'}สินค้า</h2><form data-form="product" data-id="${escape(id)}">${field('ชื่อเกม','name',p.name,'text','required maxlength="120"')}${field('หมวดหมู่','genre',p.genre,'text','required')}${field('แพลตฟอร์ม','platform',p.platform,'text','required')}${field('ผู้พัฒนา','developer',p.developer)}${field('ลิงก์รูปปก (HTTPS)','imageUrl',p.images?.[0]||'','url','placeholder="https://…"')}${field('ราคาปกติ (บาท)','price',p.price??0,'number','required min="0" max="1000000" step="0.01"')}${field('ราคาลด (เว้นว่างถ้าไม่ลด)','salePrice',p.salePrice??'','number','min="0" step="0.01"')}${textarea('รายละเอียด','desc',p.desc,'maxlength="3000"')}${check('เปิดจำหน่าย','active',p.active??true)}<p class="muted">จำนวนสต็อกเพิ่มจากเมนูนำเข้าคีย์ การปิดจำหน่ายยังเก็บประวัติคำสั่งซื้อไว้</p>${submit('บันทึกสินค้า')}</form>`);
}
function couponEditor(id) {
  const c=admin.coupons.find(c=>c.id===id)||{};
  showDialog(`<h2>จัดการคูปอง</h2><form data-form="coupon-admin">${field('รหัสคูปอง','code',id,'text',`required pattern="[A-Za-z0-9_-]+" ${id?'readonly':''}`)}${select('ประเภท','type',[['flat','ลดเป็นบาท'],['percent','ลดเป็นเปอร์เซ็นต์']],c.type||'flat')}${field('ส่วนลด','value',c.value??50,'number','required min="0" step="0.01"')}${field('ยอดซื้อขั้นต่ำ','minPurchase',c.minPurchase??0,'number','required min="0" step="0.01"')}${field('จำนวนใช้สูงสุด','maxUses',c.maxUses??100,'number','required min="1"')}${field('หมดอายุ (เว้นว่างถ้าไม่กำหนด)','expiresAt',c.expiresAt?new Date(c.expiresAt-new Date(c.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local')}${check('เปิดใช้งาน','active',c.active??true)}${submit('บันทึกคูปอง')}</form>`);
}
async function render() {
  $('#main').dataset.view=page;$('#main').classList.toggle('auth-view',page==='auth');
  document.querySelectorAll('.nav-links a').forEach(a=>{if(a.getAttribute('href')==='#'+page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('.nav-links')?.classList.remove('open');$('#mobile-menu')?.setAttribute('aria-expanded','false');
  $('#account-link').textContent=user?'บัญชีของฉัน':'เข้าสู่ระบบ';$('#account-link').href=prefix+(user?'#user':'#auth');saveCart(cart());
  if(['user','admin'].includes(page)&&!user){await navigate(prefix+'#auth');return;}
  if(page==='admin'&&user.role!=='admin'){$('#main').innerHTML='<p class="error-box">หน้านี้สำหรับผู้ดูแลระบบ</p>';return;}
  if(page==='home'||page==='store')renderStore();
  if(page==='auth')renderAuth();
  if(page==='cart')await renderCart();
  if(page==='user'){await renderUser();decorateProfile();}
  if(page==='admin'){await renderAdmin();decorateAdmin();}
}
function decorateProfile(){
  const main=$('#main');if($('.portal-layout',main))return;
  const sections=[...main.querySelectorAll('section.panel')];
  const names=[['profile','ข้อมูลส่วนตัว'],['security','ความปลอดภัย'],['orders','คำสั่งซื้อ'],['library','คลังเกม / คีย์'],['wishlist','รายการโปรด']];
  const layout=document.createElement('div');layout.className='portal-layout';
  layout.innerHTML=`<aside class="portal-nav" aria-label="เมนูบัญชี">${[['overview','ภาพรวม'],...names].map(([id,label])=>button(label,'profile-tab',id,`aria-pressed="${profileTab===id}"`)).join('')}</aside><div class="portal-content"></div>`;
  const area=$('.portal-content',layout), overview=document.createElement('section');overview.className='panel';overview.dataset.profilePanel='overview';
  overview.innerHTML=`<p class="eyebrow">MY ACCOUNT</p><h2>สวัสดี ${escape(user.firstName)}</h2><p>เลือกเมนูเพื่อดูคำสั่งซื้อ รับคีย์เกม หรือแก้ข้อมูลส่วนตัว</p><div class="actions">${button('ดูคำสั่งซื้อ','profile-tab','orders')}${button('เปิดคลังเกม','profile-tab','library')}</div><p class="demo-banner">สั่งซื้อ → โอน / สแกนจำลอง → ส่งหลักฐาน → ผู้ดูแลตรวจ → รับคีย์ DEMO</p>`;
  area.append(overview);sections.forEach((section,i)=>{section.dataset.profilePanel=names[i][0];area.append(section);});main.querySelector('.grid-two')?.remove();main.append(layout);showProfileTab();
}
function showProfileTab(){document.querySelectorAll('[data-profile-panel]').forEach(p=>p.hidden=p.dataset.profilePanel!==profileTab);document.querySelectorAll('.portal-nav [data-action="profile-tab"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===profileTab)));}
function decorateAdmin(){
  const tabs=$('#admin-tabs'),content=$('#admin-content');if(!tabs||tabs.parentElement.classList.contains('portal-layout'))return;
  const layout=document.createElement('div');layout.className='portal-layout';tabs.before(layout);tabs.className='portal-nav';tabs.setAttribute('aria-label','เมนูหลังบ้าน');layout.append(tabs,content);
}
function demoQR(){
  // Decorative placeholder, deliberately NOT a payment QR or a valid QR payload.
  let cells='';for(let y=0;y<21;y++)for(let x=0;x<21;x++)if((x*17+y*11+x*y)%7<3)cells+=`<rect x="${x*8+16}" y="${y*8+16}" width="8" height="8"/>`;
  return `<svg class="demo-qr" viewBox="0 0 200 200" role="img" aria-label="ภาพ QR จำลอง สแกนชำระเงินจริงไม่ได้"><rect width="200" height="200" fill="white"/><g fill="#26213d">${cells}</g><rect x="15" y="72" width="170" height="56" fill="white"/><text x="100" y="106" text-anchor="middle" fill="#6d28d9" font-size="30" font-weight="bold">DEMO</text></svg>`;
}
async function openPayment(id){
  paymentOrder=(await api('myData')).orders.find(o=>o.id===id);if(!paymentOrder)throw Error('ไม่พบคำสั่งซื้อ');
  paymentSettings=await api('paymentSettings');const s=paymentSettings,o=paymentOrder;
  showDialog(`<div class="payment-header"><p class="eyebrow">DEMO CHECKOUT</p><h2>ชำระเงินจำลอง</h2><p>#${escape(o.id.slice(-8))}</p><p class="price">${baht(o.totalCents)}</p></div><p class="demo-banner">ระบบสาธิตเท่านั้น ห้ามโอนเงินจริงและห้ามแนบสลิปจริง</p><ol class="payment-steps"><li>เลือกช่องทาง</li><li>แนบหลักฐานจำลอง</li><li>รอผู้ดูแลตรวจ</li></ol><form data-form="payment-submit" data-id="${escape(id)}">${select('ช่องทาง','method',[...(s.transfer?[['transfer','โอนเงินจำลอง']]:[]),...(s.qr?[['qr','สแกน QR จำลอง']]:[])],s.transfer?'transfer':'qr')}<div class="payment-destination"><div><h3>${escape(s.bank)} <small>DEMO</small></h3><p>${escape(s.recipient)}</p><code>${escape(s.account)}</code><p>${escape(s.instructions)}</p></div><div data-qr-preview ${s.transfer?'hidden':''}>${demoQR()}<p>ภาพตัวอย่าง สแกนจ่ายไม่ได้</p></div></div><label class="field">แนบภาพสลิปจำลอง (PNG/JPEG ไม่เกิน 200 KB)<input name="slip" type="file" accept="image/png,image/jpeg"></label><p class="muted">ไม่เลือกไฟล์: ระบบสร้างหลักฐาน DEMO ให้ ไม่มีการตรวจธนาคารจริง</p><label class="inline-check"><input type="checkbox" required> เข้าใจว่าเป็นการจำลอง ไม่มีการจ่ายเงินจริง</label>${submit('ส่งหลักฐานให้ผู้ดูแลตรวจ')}</form>`);
}
async function slipData(file){
  if(!file||file.size===0)return 'DEMO-GENERATED';
  if(!['image/png','image/jpeg'].includes(file.type)||file.size>200*1024)throw Error('ใช้ภาพ PNG/JPEG ไม่เกิน 200 KB');
  const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
  if(!(file.type==='image/png'&&bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')&&!(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('ไฟล์ไม่ใช่ภาพ PNG/JPEG ที่ถูกต้อง');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('อ่านภาพไม่ได้'));reader.readAsDataURL(file);});
}
async function showPaymentProof(id){
  const o=(page==='admin'?admin.orders:(await api('myData')).orders).find(o=>o.id===id);if(!o)throw Error('ไม่พบคำสั่งซื้อ');
  const p=o.paymentDetails;
  showDialog(`<h2>${o.status==='paid'?'ใบเสร็จจำลอง':'หลักฐานชำระเงินจำลอง'}</h2><p class="demo-banner">DEMO · ไม่ใช่เอกสารทางการเงิน ไม่ใช่หลักฐานการโอนเงินจริง</p><div class="demo-receipt"><h3>INONGSHOP / DEMO</h3><p>รายการ #${escape(o.id.slice(-8))}</p><p>${escape(o.firstName)} ${escape(o.lastName)}</p>${o.items.map(i=>`<p>${escape(i.name)} × ${i.qty}</p>`).join('')}<p class="price">${baht(o.totalCents)}</p>${status(o)}<p>${p?`${p.method==='qr'?'สแกน QR จำลอง':'โอนเงินจำลอง'} · ${date(p.submittedAt)}`:'รายการเดิม ไม่มีไฟล์แนบ'}</p>${p?`<p>${escape(p.bank)} · ${escape(p.recipient)}<br>${escape(p.account)}</p>`:''}${o.paidAt?`<p>อนุมัติ ${date(o.paidAt)}</p>`:''}</div>${p?.slip&&p.slip!=='DEMO-GENERATED'?`<img class="slip-preview" src="${escape(p.slip)}" alt="ภาพหลักฐานจำลองที่ลูกค้าแนบ">`:'<p class="muted">หลักฐานตัวอย่างที่ระบบสร้าง (DEMO)</p>'}${page==='admin'&&o.status==='awaiting_review'?`<div class="actions">${button('อนุมัติและส่งคีย์ DEMO','approve',o.id)}${button('ไม่อนุมัติ / ยกเลิก','cancel-order',o.id)}</div>`:''}`);
}
async function mergeGuestCart() {
  const guest=readLocal('inongshop-cart-v2-guest',[]);if(!Array.isArray(guest)||!guest.length)return;
  const own=cart();for(const i of guest){if(i&&typeof i.gameId==='string'&&Number.isInteger(i.qty)&&i.qty>=1&&i.qty<=10&&!own.some(x=>x.gameId===i.gameId)&&own.length<20)own.push(i);}
  saveCart(own);localStorage.removeItem('inongshop-cart-v2-guest');
}
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
  const b=$('button[type=submit]',form);if(b.disabled)return;b.disabled=true;
  const data=Object.fromEntries(new FormData(form));
  try {
    switch(form.dataset.form){
      case 'payment-settings':await api('savePaymentSettings',{...data,transfer:form.elements.transfer.checked,qr:form.elements.qr.checked});paymentSettings=await api('paymentSettings');flash('บันทึกช่องทางจำลองแล้ว');break;
      case 'payment-submit':await api('confirmMockPayment',{orderId:form.dataset.id,method:data.method,slip:await slipData(data.slip)});$('#dialog').close();profileTab='orders';await navigate('#user');flash('ส่งหลักฐานแล้ว รอผู้ดูแลตรวจและส่งคีย์ DEMO');break;
      case 'login': await auth.signInWithEmailAndPassword(data.email,data.password);user=await api('me');await mergeGuestCart();await navigate(prefix+(user.firstName?'#user':'#auth'));break;
      case 'register':
        if(data.password!==data.confirm)throw Error('รหัสผ่านไม่ตรงกัน');
        await auth.createUserWithEmailAndPassword(data.email,data.password);
        try{user=await api('saveProfile',data);}catch(e){renderAuth();throw e;}
        await mergeGuestCart();await navigate(prefix+'#user');break;
      case 'reset': await auth.sendPasswordResetEmail(data.email);flash('หากอีเมลมีบัญชีในระบบ จะได้รับลิงก์รีเซ็ตรหัสผ่าน');form.reset();break;
      case 'profile':user={...user,...await api('saveProfile',data)};flash('บันทึกข้อมูลแล้ว');if(page==='auth')await navigate(prefix+'#user');break;
      case 'password':
        if(data.password!==data.confirm)throw Error('รหัสผ่านใหม่ไม่ตรงกัน');
        await auth.currentUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(auth.currentUser.email,data.old));
        await auth.currentUser.updatePassword(data.password);form.reset();flash('เปลี่ยนรหัสผ่านแล้ว');break;
      case 'coupon':sessionStorage.setItem('couponCode',data.couponCode.trim().toUpperCase());await refreshQuote();break;
      case 'checkout':{
        if(!cartQuote)throw Error('กรุณาคำนวณยอดก่อนสั่งซื้อ');
        const payload={items:cart(),couponCode:sessionStorage.getItem('couponCode')||'',buyer:data};
        const fingerprint=JSON.stringify(payload), key=`order-request-${user.id}`;
        let saved=readLocal(key,null);if(saved?.fingerprint!==fingerprint){saved={fingerprint,id:crypto.randomUUID()};localStorage.setItem(key,JSON.stringify(saved));}
        const order=await api('createOrder',{...payload,requestId:saved.id});
        saveCart([]);sessionStorage.removeItem('couponCode');localStorage.removeItem(key);
        $('#main').innerHTML=`<section class="panel"><h1>บันทึกคำสั่งซื้อแล้ว</h1><p>ส่งคำขอด้านล่าง แล้วรอผู้ดูแลอนุมัติและส่งคีย์ตัวอย่าง</p>${orderMarkup(order)}<a href="#user">ดูคำสั่งซื้อทั้งหมด</a></section>`;break;
      }
      case 'product':await api('saveProduct',{...data,id:form.dataset.id||undefined,price:Number(data.price),salePrice:data.salePrice===''?null:Number(data.salePrice),active:form.elements.active.checked});$('#dialog').close();await renderAdmin();flash('บันทึกสินค้าแล้ว');break;
      case 'import':await api('importKeys',{gameId:data.gameId,keys:data.keys.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});$('#dialog').close();await renderAdmin();flash('นำเข้าคีย์และเพิ่มสต็อกแล้ว');break;
      case 'coupon-admin':await api('saveCoupon',{...data,value:Number(data.value),minPurchase:Number(data.minPurchase),maxUses:Number(data.maxUses),expiresAt:data.expiresAt?new Date(data.expiresAt).getTime():null,active:form.elements.active.checked});$('#dialog').close();await renderAdmin();flash('บันทึกคูปองแล้ว');break;
      case 'review':await api('saveReview',{gameId:form.dataset.id,rating:Number(data.rating),comment:data.comment});$('#dialog').close();flash('บันทึกรีวิวแล้ว');break;
    }
  }catch(e){flash(errorText(e));}finally{b.disabled=false;if(page==='user')decorateProfile();if(page==='admin')decorateAdmin();}
});
document.addEventListener('click',async event=>{
  const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
  const id=b.dataset.id;b.disabled=true;
  try {
    switch(b.dataset.action){
      case 'close-dialog':$('#dialog').close();break;
      case 'logout':await auth.signOut();user=null;localStorage.removeItem('currentUser');await navigate(prefix+'#auth');break;
      case 'detail':await detail(id);break;
      case 'add-cart':{const items=cart();if(items.some(i=>i.gameId===id))throw Error('สินค้านี้อยู่ในตะกร้าแล้ว');if(items.length>=20)throw Error('ตะกร้าใส่ได้สูงสุด 20 รายการ');saveCart([...items,{gameId:id,qty:1}]);flash('เพิ่มลงตะกร้าแล้ว');break;}
      case 'remove-cart':saveCart(cart().filter(i=>i.gameId!==id));await renderCart();break;
      case 'wishlist':{if(!user)throw Error('กรุณาเข้าสู่ระบบเพื่อบันทึกรายการโปรด');const ids=user.wishlist||[], next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];await api('saveWishlist',{ids:next});user.wishlist=next;flash('บันทึกรายการโปรดแล้ว');await render();break;}
      case 'pay':await openPayment(id);break;
      case 'payment-proof':await showPaymentProof(id);break;
      case 'profile-tab':profileTab=id;showProfileTab();break;
      case 'cancel-order':if(confirm('ยืนยันยกเลิกคำสั่งซื้อนี้?')){await api('cancelOrder',{orderId:id});$('#dialog').close();if(page==='admin')await renderAdmin();else if(page==='cart')await navigate(prefix+'#user');else await renderUser();}break;
      case 'copy':await navigator.clipboard.writeText(id);flash('คัดลอกคีย์แล้ว');break;
      case 'review':showDialog(`<h2>รีวิวเกมที่ซื้อ</h2><form data-form="review" data-id="${escape(id)}">${select('คะแนน','rating',[[5,'5 ดีมาก'],[4,'4 ดี'],[3,'3 ปานกลาง'],[2,'2'],[1,'1']],5)}${textarea('ความคิดเห็น','comment','','required maxlength="1000"')}${submit('บันทึกรีวิว')}</form>`);break;
      case 'approve':if(confirm('อนุมัติรายการสาธิตและส่งคีย์ DEMO? ไม่มีการรับเงินจริง')){await api('approveOrder',{orderId:id});$('#dialog').close();await renderAdmin();flash('ส่งคีย์แล้ว');}break;
      case 'seed-demo':await api('seedDemo');await loadProducts(true);await renderAdmin();flash('เพิ่มสินค้าและคีย์ตัวอย่างแล้ว');break;
      case 'refresh-user':await renderUser();break;
      case 'refresh-admin':await renderAdmin();break;
      case 'admin-tab':currentTab=id;renderAdminTab();break;
      case 'edit-product':productEditor(id);break;
      case 'edit-coupon':couponEditor(id);break;
      case 'import-keys':showDialog(`<h2>นำเข้าคีย์ตัวอย่าง</h2><form data-form="import">${select('สินค้า','gameId',admin.products.map(p=>[p.id,p.name]),admin.products[0]?.id)}${textarea('คีย์ DEMO- หนึ่งคีย์ต่อบรรทัด (ไม่เกิน 100)','keys','','required')}<p class="muted">ตัวอย่าง DEMO-CLASSROOM-0001 คีย์ห้ามซ้ำกันทั้งระบบ</p>${submit('นำเข้าและเพิ่มสต็อก')}</form>`);break;
      case 'suspend':{const target=admin.users.find(u=>u.id===id);if(confirm(`ยืนยัน${target.suspended?'เปิดใช้งาน':'ระงับ'}บัญชี ${target.email}?`)){await api('suspendUser',{userId:id,suspended:!target.suspended});await renderAdmin();}break;}
      case 'delete-review':if(confirm('ลบรีวิวนี้?')){await api('deleteReview',{id});await renderAdmin();}break;
    }
  }catch(e){flash(errorText(e));}finally{b.disabled=false;if(page==='user')decorateProfile();if(page==='admin')decorateAdmin();}
});
document.addEventListener('input',event=>{if(!event.target.matches('[data-panel-search]'))return;const q=event.target.value.toLocaleLowerCase();document.querySelectorAll('#admin-content tbody tr,#admin-content .order-box').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(q));});
document.addEventListener('change',event=>{if(event.target.matches('form[data-form="payment-submit"] select[name="method"]'))$('[data-qr-preview]').hidden=event.target.value!=='qr';});
document.addEventListener('change',async event=>{
  const input=event.target.closest('[data-qty]');if(!input)return;
  const n=Number(input.value);if(!Number.isInteger(n)||n<1||n>10){flash('จำนวนต้องเป็นเลขเต็ม 1–10');input.value=cart().find(i=>i.gameId===input.dataset.qty)?.qty||1;return;}
  saveCart(cart().map(i=>i.gameId===input.dataset.qty?{...i,qty:n}:i));await renderCart();
});
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'&&!e.target.dataset.fallback){e.target.dataset.fallback='true';e.target.src=prefix+'assets/placeholder.svg';}},true);
$('#theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme);});
document.documentElement.dataset.theme=localStorage.getItem('theme')==='light'?'light':'dark';

let routing = Promise.resolve();
async function navigate(target) {
  const next=String(target).replace(/^#/, '').split('#')[0] || 'home';
  if(location.hash !== '#'+next) location.hash=next;
  else await refreshPage(next);
}
async function refreshPage(next) {
  next=(next||'home').split('?')[0];
  page=['home','store','auth','cart','user','admin'].includes(next)?next:'home';
  const signedIn=auth.currentUser;
  const needsUser=signedIn&&(!user||user.id!==signedIn.uid||page==='user'||page==='admin');
  const userRequest=needsUser?api('me'):Promise.resolve(signedIn?user:null);
  const productRequest=page==='admin'&&products.length?Promise.resolve():loadProducts();
  [user]=await Promise.all([userRequest,productRequest]);
  await render(); window.scrollTo(0,0);
}
window.addEventListener('hashchange',()=>{
  routing=routing.then(()=>refreshPage(location.hash.slice(1))).catch(e=>flash(errorText(e)));
});
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(!link)return;
  event.preventDefault();navigate(link.getAttribute('href')).catch(e=>flash(errorText(e)));
});
$('#mobile-menu').addEventListener('click',()=>{const open=$('.nav-links').classList.toggle('open');$('#mobile-menu').setAttribute('aria-expanded',String(open));});
async function init() {
  const services=await FirebaseShop.init(window.SHOP_CONFIG);
  auth=services.auth;db=services.db;fn=services.fn;
  await refreshPage(location.hash.slice(1)||page);
}
// Paint the catalog immediately from the bundled snapshot. Stock buttons stay
// disabled until Firebase returns authoritative values.
const previewCatalog=productLoadedAt===0;
if(previewCatalog)products=window.SHOP_PRODUCTS.map(p=>({...p,active:true,stock:0}));
if(['home','store'].includes(page)){
  renderStore();
  if(previewCatalog){document.querySelectorAll('.stock-label').forEach(el=>el.textContent='กำลังตรวจสต็อก…');document.querySelectorAll('[data-action="add-cart"]').forEach(el=>{el.disabled=true;el.textContent='กำลังโหลด';});}
}
init().catch(e=>{if(['home','store'].includes(page)&&products.length)flash('แสดงรายการตัวอย่างอยู่ · '+errorText(e));else $('#main').innerHTML='<div class="error-box"><h2>เชื่อมต่อ Firebase ไม่สำเร็จ</h2><p>'+escape(errorText(e))+'</p><p>ตรวจอินเทอร์เน็ตและกฎ Firestore ของโปรเจกต์ inong-56c0f แล้วเปิดใหม่ ข้อมูลสมาชิกเก็บบน Firebase ไม่ใช่ในไฟล์นี้</p></div>';});

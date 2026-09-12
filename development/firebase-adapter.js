/* Firebase is the backend. Members submit requests; only an administrator can
   approve demo fulfilment. No client-side payment claim is trusted. */
(function(){
  'use strict';
  const v=window.ShopBusiness, assert=v.assert;
  let auth,db;
  const ref=(c,id)=>db.collection(c).doc(id);
  const rows=s=>s.docs.map(d=>({...d.data(),id:d.id}));
  const data=s=>s.exists?{...s.data(),id:s.id}:null;
  const all=async c=>rows(await db.collection(c).get());
  const own=async c=>rows(await db.collection(c).where('userId','==',auth.currentUser.uid).get());
  const requireUser=()=>{assert(auth.currentUser,'กรุณาเข้าสู่ระบบ');return auth.currentUser;};
  const paymentDefaults={bank:'ธนาคารตัวอย่าง DEMO',recipient:'INONGSHOP DEMO',account:'DEMO-ACCOUNT',instructions:'ใช้สำหรับสาธิตเท่านั้น ห้ามโอนเงินจริง',transfer:true,qr:true};
  async function me(){
    const u=requireUser(),[profile,role]=await Promise.all([ref('users',u.uid).get(),ref('admins',u.uid).get()]);
    const p=profile.exists?profile.data():{firstName:'',lastName:'',phone:'',wishlist:[],suspended:false};
    assert(!p.suspended,'บัญชีถูกระงับ กรุณาติดต่อผู้ดูแล');
    return {...p,id:u.uid,email:u.email,role:role.exists?'admin':'member'};
  }
  async function pricing(p){
    const items=v.cartItems(p.items),code=v.text(p.couponCode||'','คูปอง',30,true).toUpperCase();
    const products=await Promise.all(items.map(async i=>data(await ref('products',i.gameId).get())));
    const coupon=code?data(await ref('coupons',code).get()):null;
    assert(!code||coupon,'ไม่พบคูปอง');
    return {...v.quote(items,products.filter(Boolean),coupon),couponCode:code};
  }
  async function approve(orderId){
    // Queries only choose candidates. Every selected key and product is read
    // again inside the transaction before stock and ownership are written.
    const snapshot=data(await ref('orders',orderId).get());assert(snapshot,'ไม่พบคำสั่งซื้อ');
    const inventory=await all('key_inventory');
    return db.runTransaction(async tx=>{
      const o=data(await tx.get(ref('orders',orderId)));assert(o,'ไม่พบคำสั่งซื้อ');
      if(o.status==='paid')return o;
      assert(o.status==='awaiting_review','ลูกค้ายังไม่ได้ส่งคำขอยืนยัน');
      const buyer=data(await tx.get(ref('users',o.userId)));assert(buyer&&!buyer.suspended,'บัญชีผู้ซื้อถูกระงับ');
      const products=await Promise.all(o.items.map(i=>tx.get(ref('products',i.gameId)).then(data)));
      const coupon=o.couponCode?data(await tx.get(ref('coupons',o.couponCode))):null;
      assert(!o.couponCode||coupon,'ไม่พบคูปอง');
      const quote=v.quote(v.cartItems(o.items),products.filter(Boolean),coupon);
      assert(quote.totalCents===o.totalCents&&quote.subtotalCents===o.subtotalCents&&quote.discountCents===o.discountCents,'ราคา/ส่วนลดเปลี่ยนหรือยอดไม่ถูกต้อง กรุณายกเลิกและให้ลูกค้าสั่งใหม่');
      const selected=[];
      for(const i of quote.items){
        const candidates=inventory.filter(k=>k.gameId===i.gameId&&k.status==='available').slice(0,i.qty);
        assert(candidates.length===i.qty,'คีย์ไม่พอ กรุณาเติมสต็อก');
        for(const k of candidates){const fresh=data(await tx.get(ref('key_inventory',k.id)));assert(fresh?.status==='available'&&fresh.gameId===i.gameId,'คีย์ถูกใช้ไปแล้ว กรุณากดอนุมัติอีกครั้ง');selected.push({...fresh,gameName:i.name,platform:i.platform});}
      }
      const now=Date.now();
      for(const i of quote.items){
        tx.update(ref('products',i.gameId),{stock:products.find(p=>p.id===i.gameId).stock-i.qty});
        tx.set(ref('ownership',o.userId+'_'+i.gameId),{userId:o.userId,gameId:i.gameId,orderId,createdAt:now});
      }
      for(const k of selected){const sold={...k,userId:o.userId,orderId,status:'sold',soldAt:now};tx.set(ref('key_inventory',k.id),sold);tx.set(ref('user_keys',k.id),sold);}
      if(coupon)tx.update(ref('coupons',coupon.id),{usedCount:coupon.usedCount+1});
      const final={...quote,status:'paid',paidAt:now,approvedBy:auth.currentUser.uid};
      tx.update(ref('orders',orderId),final);return {...o,...final};
    });
  }
  const handlers={
    me:()=>me(),
    saveProfile:async p=>{
      const u=await me(),profile=v.profile(p),r=ref('users',u.id);
      await db.runTransaction(async tx=>{const s=await tx.get(r);if(s.exists)tx.update(r,profile);else tx.set(r,{...profile,email:u.email,wishlist:[],suspended:false,createdAt:Date.now()});});
      return {...u,...profile};
    },
    quoteOrder:p=>pricing(p),
    paymentSettings:async()=>({...paymentDefaults,...data(await ref('payment_settings','demo').get())}),
    savePaymentSettings:async p=>{const s={bank:v.text(p.bank,'ธนาคาร',80),recipient:v.text(p.recipient,'ผู้รับ',80),account:v.text(p.account,'บัญชีตัวอย่าง',60),instructions:v.text(p.instructions,'คำแนะนำ',500),transfer:p.transfer===true,qr:p.qr===true};assert(/^DEMO-[A-Z-]+$/.test(s.account),'ใช้รหัส DEMO- ตัวอักษรภาษาอังกฤษเท่านั้น ไม่ใช้เลขบัญชีจริง');assert(s.transfer||s.qr,'เปิดอย่างน้อยหนึ่งช่องทาง');await ref('payment_settings','demo').set(s);},
    createOrder:async p=>{
      const u=await me();assert(u.firstName,'กรุณาบันทึกข้อมูลสมาชิก');
      assert(/^[a-zA-Z0-9-]{1,100}$/.test(p.requestId),'รหัสคำขอไม่ถูกต้อง');
      const r=ref('orders',u.id+'_'+p.requestId),existing=await r.get();if(existing.exists)return data(existing);
      const quote=await pricing(p),now=Date.now();
      const o={...quote,...v.profile(p.buyer),userId:u.id,email:u.email,requestId:p.requestId,payment:'mock',status:'pending_payment',createdAt:now,expiresAt:now+1800000};
      return db.runTransaction(async tx=>{const old=await tx.get(r);if(old.exists)return data(old);tx.set(r,o);return {...o,id:r.id};});
    },
    confirmMockPayment:async p=>{
      const u=await me();return db.runTransaction(async tx=>{
        const r=ref('orders',p.orderId),o=data(await tx.get(r));assert(o&&o.userId===u.id,'ไม่พบคำสั่งซื้อของคุณ');
        if(['awaiting_review','paid'].includes(o.status))return o;
        assert(o.status==='pending_payment'&&o.expiresAt>Date.now(),'คำสั่งซื้อหมดอายุหรือถูกยกเลิก');
        const settings={...paymentDefaults,...data(await tx.get(ref('payment_settings','demo')))};
        assert(['transfer','qr'].includes(p.method)&&settings[p.method]===true,'กรุณาเลือกช่องทางที่เปิดใช้งาน');
        assert(p.slip==='DEMO-GENERATED'||(typeof p.slip==='string'&&p.slip.length<=280000&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.slip)),'แนบภาพ PNG/JPEG ไม่เกิน 200 KB หรือใช้สลิปตัวอย่าง');
        const paymentDetails={method:p.method,slip:p.slip,submittedAt:Date.now(),bank:settings.bank,recipient:settings.recipient,account:settings.account};
        tx.update(r,{status:'awaiting_review',paymentDetails});return {...o,status:'awaiting_review',paymentDetails};
      });
    },
    approveOrder:p=>approve(p.orderId),
    cancelOrder:async p=>{const u=await me();await db.runTransaction(async tx=>{const r=ref('orders',p.orderId),o=data(await tx.get(r));assert(o&&(o.userId===u.id||u.role==='admin')&&['pending_payment','awaiting_review'].includes(o.status),'ยกเลิกรายการนี้ไม่ได้');tx.update(r,{status:'cancelled'});});},
    myData:async()=>{const [orders,keys,reviews]=await Promise.all(['orders','user_keys','reviews'].map(own));return {orders:orders.sort((a,b)=>b.createdAt-a.createdAt),keys,reviews};},
    saveWishlist:async p=>{const u=await me();assert(Array.isArray(p.ids)&&p.ids.length<=100&&p.ids.every(x=>typeof x==='string'&&/^[\w-]{1,80}$/.test(x)),'รายการโปรดไม่ถูกต้อง');await ref('users',u.id).update({wishlist:[...new Set(p.ids)]});},
    saveReview:async p=>{const u=await me();assert(/^[\w-]{1,80}$/.test(p.gameId),'รหัสสินค้าไม่ถูกต้อง');await ref('reviews',u.id+'_'+p.gameId).set({userId:u.id,gameId:p.gameId,author:u.firstName,rating:v.integer(p.rating,'คะแนน',1,5),comment:v.text(p.comment,'รีวิว',1000),createdAt:Date.now()});},
    adminData:async()=>{const names=['products','key_inventory','orders','users','coupons','reviews'];const result=await Promise.all(names.map(all));return Object.fromEntries(names.map((n,i)=>[n,result[i]]));},
    saveProduct:async p=>{
      const r=p.id?ref('products',p.id):db.collection('products').doc();
      const price=v.money(p.price)/100,salePrice=p.salePrice==null?null:v.money(p.salePrice)/100;assert(salePrice===null||salePrice<=price,'ราคาลดต้องไม่เกินราคาปกติ');
      const product={name:v.text(p.name,'ชื่อเกม',120),genre:v.text(p.genre,'หมวดหมู่',80),platform:v.text(p.platform,'แพลตฟอร์ม',80),developer:v.text(p.developer||'','ผู้พัฒนา',100,true),desc:v.text(p.desc||'','รายละเอียด',3000,true),price,salePrice,images:[],active:p.active===true,updatedAt:Date.now()};
      const image=p.imageUrl===undefined?undefined:v.text(p.imageUrl,'ลิงก์รูป',2000,true);
      assert(image===undefined||image===''||/^https:\/\//i.test(image),'รูปปกต้องเป็นลิงก์ HTTPS');
      await db.runTransaction(async tx=>{const old=await tx.get(r);tx.set(r,{...product,images:image===undefined?(old.exists?old.data().images||[]:[]):image?[image]:[],stock:old.exists?old.data().stock:0,createdAt:old.exists?old.data().createdAt||Date.now():Date.now()},{merge:true});});return {id:r.id};
    },
    importKeys:async p=>{
      assert(Array.isArray(p.keys)&&p.keys.length>0&&p.keys.length<=100,'นำเข้าได้ 1–100 คีย์');
      const keys=p.keys.map(k=>v.text(k,'คีย์',120));assert(keys.every(k=>/^DEMO-[A-Z0-9-]+$/.test(k))&&new Set(keys).size===keys.length,'ต้องเป็นคีย์ DEMO- และไม่ซ้ำ');
      await db.runTransaction(async tx=>{const product=data(await tx.get(ref('products',p.gameId)));assert(product,'ไม่พบสินค้า');const old=await Promise.all(keys.map(k=>tx.get(ref('key_inventory',k))));assert(old.every(s=>!s.exists),'มีคีย์ซ้ำในระบบ');keys.forEach(key=>tx.set(ref('key_inventory',key),{key,gameId:p.gameId,status:'available',createdAt:Date.now()}));tx.update(ref('products',p.gameId),{stock:product.stock+keys.length});});
    },
    saveCoupon:async p=>{
      const code=v.text(p.code,'คูปอง',30).toUpperCase();assert(/^[A-Z0-9_-]+$/.test(code)&&['flat','percent'].includes(p.type),'คูปองไม่ถูกต้อง');
      const c={type:p.type,value:p.type==='percent'?v.integer(p.value,'ส่วนลด',1,100):v.money(p.value)/100,minPurchase:v.money(p.minPurchase)/100,maxUses:v.integer(p.maxUses,'จำนวนใช้',1,100000),active:p.active===true,expiresAt:p.expiresAt==null?null:v.integer(p.expiresAt,'วันหมดอายุ',1,8640000000000000)};
      await db.runTransaction(async tx=>{const r=ref('coupons',code),old=await tx.get(r),usedCount=old.exists?old.data().usedCount:0;assert(c.maxUses>=usedCount,'จำนวนสูงสุดต่ำกว่าที่ใช้ไปแล้ว');tx.set(r,{...c,usedCount});});
    },
    suspendUser:async p=>{assert(p.userId!==auth.currentUser.uid,'ระงับตัวเองไม่ได้');assert(!(await ref('admins',p.userId).get()).exists,'ระงับผู้ดูแลไม่ได้');await ref('users',p.userId).update({suspended:p.suspended===true});},
    deleteReview:p=>ref('reviews',p.id).delete(),
    seedDemo:async()=>{
      // Only add missing products. Existing stock, sales and keys are untouched.
      for(const p of window.SHOP_PRODUCTS){await db.runTransaction(async tx=>{const r=ref('products',p.id);if((await tx.get(r)).exists)return;tx.set(r,{...p,stock:5,active:true,createdAt:Date.now()});for(let n=1;n<=5;n++){const key=`DEMO-${p.id.toUpperCase()}-${String(n).padStart(4,'0')}`;tx.set(ref('key_inventory',key),{gameId:p.id,key,status:'available',createdAt:Date.now()});}});}
      for(const c of [{id:'SAVE10',type:'percent',value:10,minPurchase:500},{id:'KEYH50',type:'flat',value:50,minPurchase:0}])await db.runTransaction(async tx=>{const r=ref('coupons',c.id);if(!(await tx.get(r)).exists)tx.set(r,{...c,active:true,usedCount:0,maxUses:100,expiresAt:null});});
    }
  };
  const admins=new Set(['savePaymentSettings','approveOrder','adminData','saveProduct','importKeys','saveCoupon','suspendUser','deleteReview','seedDemo']);
  async function call(name,p={}){requireUser();assert(handlers[name],'ไม่พบคำสั่ง');if(admins.has(name))assert((await me()).role==='admin','เฉพาะผู้ดูแล');return await handlers[name](p)??{ok:true};}
  async function init(config){
    assert(window.firebase,'โหลด Firebase ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดใหม่');
    firebase.initializeApp(config);auth=firebase.auth();db=window.ShopFirestore('default');
    if(window.SHOP_EMULATOR){auth.useEmulator('http://127.0.0.1:9099',{disableWarnings:true});db.useEmulator('127.0.0.1',8080);}
    await new Promise(resolve=>{const off=auth.onAuthStateChanged(()=>{off();resolve();});});
    return {auth,db,fn:{httpsCallable:name=>async p=>({data:await call(name,p)})}};
  }
  window.FirebaseShop={init,call};
}());

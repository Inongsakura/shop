const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const firebase=require('firebase/compat/app');require('firebase/compat/auth');require('firebase/compat/firestore');
const project='demo-inong-static',base=`http://127.0.0.1:8080/v1/projects/${project}/databases/default/documents`;
const business=require('./src/business.js');
let service,api,member,other,administrator,order,initialStock;
function encode(v){if(v===null)return {nullValue:null};if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};return {stringValue:v};}
async function trusted(path,value){const r=await fetch(base+'/'+path,{method:'PATCH',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify(encode(value).mapValue)});assert.equal(r.status,200,await r.text());}
const password='Only-Emulator-Test-4829';
async function login(u){await service.auth.signInWithEmailAndPassword(u.email,password);}
before(async()=>{
  const context={window:{ShopFirestore:require('./src/db.cjs').databaseFactory(require('firebase/firestore'),require('firebase/app').getApp),ShopBusiness:business,SHOP_EMULATOR:true,SHOP_PRODUCTS:JSON.parse(fs.readFileSync(__dirname+'/src/products.json','utf8')),firebase},firebase,Date,Promise,Set,Error};
  new Function('window','firebase',fs.readFileSync(__dirname+'/firebase-adapter.js','utf8'))(context.window,firebase);
  service=await context.window.FirebaseShop.init({projectId:project,apiKey:'demo-key',authDomain:project+'.firebaseapp.com'});api=context.window.FirebaseShop.call;
  for(const name of ['member','other','administrator']){
    const email=`${name}-${Date.now()}@test.invalid`,credential=await service.auth.createUserWithEmailAndPassword(email,password);
    const u={email,id:credential.user.uid};await api('saveProfile',{firstName:name,lastName:'Test',phone:''});
    if(name==='member')member=u;if(name==='other')other=u;if(name==='administrator')administrator=u;
  }
  await trusted('admins/'+administrator.id,{enabled:true});
});
after(async()=>{await service.auth.signOut();await service.db.terminate();await firebase.app().delete();});
test('administrator seeds catalog; members cannot access inventory or grant roles',async()=>{
  await api('seedDemo');const catalog=(await api('adminData')).products;assert.ok(JSON.parse(fs.readFileSync(__dirname+'/src/products.json','utf8')).every(p=>catalog.some(x=>x.id===p.id)));
  await login(member);await assert.rejects(api('adminData'));
  await assert.rejects(service.db.collection('admins').doc(member.id).set({enabled:true}));
  await assert.rejects(service.db.collection('key_inventory').get());
  await assert.rejects(service.db.collection('users').doc(member.id).update({role:'admin'}));
  await assert.rejects(service.db.collection('users').doc(other.id).get());
});
test('profile, wishlist and quote persist; order creation is idempotent',async()=>{
  const products=(await service.db.collection('products').where('active','==',true).get()).docs;
  const product=products.find(p=>p.data().stock>0);initialStock=product.data().stock;const payload={requestId:crypto.randomUUID(),items:[{gameId:product.id,qty:1}],buyer:{firstName:'Buyer',lastName:'Test',phone:''}};
  await api('saveWishlist',{ids:[product.id]});assert.equal((await api('me')).wishlist[0],product.id);
  order=await api('createOrder',payload);assert.equal(order.status,'pending_payment');assert.equal((await api('createOrder',payload)).id,order.id);
  assert.equal((await api('myData')).orders.length,1);
});
test('members cannot self-fulfil, change amounts, or access another order',async()=>{
  await assert.rejects(service.db.collection('orders').doc(order.id).update({status:'paid'}));
  await assert.rejects(service.db.collection('orders').doc(order.id).update({totalCents:0}));
  await assert.rejects(api('approveOrder',{orderId:order.id}));
  await login(other);await assert.rejects(service.db.collection('orders').doc(order.id).get());
  await assert.rejects(api('confirmMockPayment',{orderId:order.id}));await login(member);
  await assert.rejects(api('confirmMockPayment',{orderId:order.id}));
  await assert.rejects(service.db.collection('orders').doc(order.id).update({status:'awaiting_review'}));
  await api('confirmMockPayment',{orderId:order.id,method:'transfer',slip:'DEMO-GENERATED'});assert.equal((await api('myData')).orders[0].status,'awaiting_review');
  await assert.rejects(service.db.collection('orders').doc(order.id).update({paymentDetails:{method:'qr',slip:'DEMO-GENERATED'}}));
  assert.equal((await api('myData')).keys.length,0);
});
test('approval allocates keys once; only buyer can review and read keys',async()=>{
  await login(administrator);await api('approveOrder',{orderId:order.id});await api('approveOrder',{orderId:order.id});
  await login(member);const d=await api('myData');assert.equal(d.keys.length,1);assert.equal(d.orders[0].status,'paid');
  assert.equal((await service.db.collection('products').doc(order.items[0].gameId).get()).data().stock,initialStock-1);
  await api('saveReview',{gameId:order.items[0].gameId,rating:5,comment:'Test review'});
  await login(other);await assert.rejects(api('saveReview',{gameId:order.items[0].gameId,rating:5,comment:'Not bought'}));
  await assert.rejects(service.db.collection('user_keys').doc(d.keys[0].id).get());
});
test('suspended user cannot create orders or restore own access',async()=>{
  await login(administrator);await api('suspendUser',{userId:other.id,suspended:true});await login(other);
  await assert.rejects(api('me'));await assert.rejects(service.db.collection('users').doc(other.id).update({suspended:false}));
});
test('tampered request totals cannot be approved',async()=>{
  await login(member);const p=(await service.db.collection('products').where('active','==',true).get()).docs.find(p=>p.data().stock>0);
  const requestId=crypto.randomUUID(),now=Date.now(),id=member.id+'_'+requestId;
  await service.db.collection('orders').doc(id).set({requestId,userId:member.id,email:member.email,firstName:'Test',lastName:'Buyer',phone:'',payment:'mock',status:'pending_payment',createdAt:now,expiresAt:now+1800000,couponCode:'',items:[{gameId:p.id,qty:1,name:p.data().name,platform:p.data().platform,unitCents:0}],subtotalCents:0,discountCents:0,totalCents:0});
  await api('confirmMockPayment',{orderId:id,method:'qr',slip:'DEMO-GENERATED'});await login(administrator);await assert.rejects(api('approveOrder',{orderId:id}));
});
test('concurrent approvals cannot sell the last key twice',async()=>{
  await login(administrator);const {id}=await api('saveProduct',{name:'Concurrency Test',genre:'Test',platform:'PC',price:100,active:true});
  await api('importKeys',{gameId:id,keys:['DEMO-RACE-'+crypto.randomUUID().toUpperCase()]});
  await login(member);const orders=[];
  for(let n=0;n<2;n++){const o=await api('createOrder',{requestId:crypto.randomUUID(),items:[{gameId:id,qty:1}],buyer:{firstName:'Test',lastName:'Buyer',phone:''}});await api('confirmMockPayment',{orderId:o.id,method:'qr',slip:'DEMO-GENERATED'});orders.push(o);}
  await login(administrator);const result=await Promise.allSettled(orders.map(o=>api('approveOrder',{orderId:o.id})));
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await service.db.collection('products').doc(id).get()).data().stock,0);
});
test('payment settings are admin-only and reject real account numbers',async()=>{
  await login(administrator);const settings=await api('paymentSettings');
  await assert.rejects(api('savePaymentSettings',{...settings,account:'1234567890'}));
  await api('savePaymentSettings',{...settings,account:'DEMO-CLASSROOM',transfer:true,qr:false});
  await login(member);assert.equal((await api('paymentSettings')).account,'DEMO-CLASSROOM');
  await assert.rejects(api('savePaymentSettings',{...settings}));
  await assert.rejects(service.db.collection('payment_settings').doc('demo').set(settings));
  const p=(await service.db.collection('products').where('active','==',true).get()).docs.find(p=>p.data().stock>0);
  const o=await api('createOrder',{requestId:crypto.randomUUID(),items:[{gameId:p.id,qty:1}],buyer:{firstName:'Test',lastName:'Buyer',phone:''}});
  await assert.rejects(api('confirmMockPayment',{orderId:o.id,method:'qr',slip:'DEMO-GENERATED'}));
  await assert.rejects(api('confirmMockPayment',{orderId:o.id,method:'card',slip:'DEMO-GENERATED'}));
  await assert.rejects(api('confirmMockPayment',{orderId:o.id,method:'transfer',slip:'data:text/html;base64,AAAA'}));
  await api('confirmMockPayment',{orderId:o.id,method:'transfer',slip:'DEMO-GENERATED'});
  await login(administrator);const {id,...clean}=settings;await api('savePaymentSettings',clean);
});

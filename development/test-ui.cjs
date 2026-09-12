const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,innerHTML:'',textContent:'',classList:{toggle(){}},addEventListener(){},setAttribute(){}});return nodes.get(id);};
  const products=JSON.parse(fs.readFileSync(__dirname+'/src/products.json','utf8')).map(p=>({...p,active:true,stock:5}));
  const c={products,user:null,page:'home',window:{SHOP_PRODUCTS:products},location:{hash:''},URLSearchParams,Set,Math,document:{querySelectorAll:()=>[]},$:node,escape:s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'),baht:n=>'฿'+n/100,button:(name,action,id)=>`<button data-action="${action}" data-id="${id}">${name}</button>`,field:()=>'',navigate:async()=>{},flash:()=>{},errorText:e=>e.message};
  vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/src/storefront.js','utf8'),c);return {c,node};
}
test('uses real cover URL and falls back to seed/local placeholder',()=>{
  const {c}=setup();assert.equal(c.imageUrl(c.products[0]),c.products[0].images[0]);assert.equal(c.imageUrl({...c.products[0],images:[]}),c.products[0].images[0]);assert.equal(c.imageUrl({id:'custom',images:['javascript:alert(1)']}),'assets/placeholder.svg');
});
test('home restores hero, recommended/sale/new sections, images and category links',()=>{
  const {c,node}=setup();c.renderHome();const h=node('#main').innerHTML;assert.equal((h.match(/class="hero-slide /g)||[]).length,3);assert.ok(h.includes('เกมเด่นที่คัดสรรมาเพื่อคุณ'));assert.ok(h.includes('เกมลดราคาสุดคุ้ม'));assert.ok(h.includes('category-grid'));assert.ok(h.includes(c.products[0].images[0]));assert.ok(!h.includes('50,000+'));
});
test('store search, price, platform and sale filters produce matching cards',()=>{
  const {c,node}=setup();c.page='store';c.location.hash='#store?search=Cyberpunk';c.renderStore();assert.ok(node('#catalog').innerHTML.includes('Cyberpunk'));assert.ok(!node('#catalog').innerHTML.includes('Red Dead'));node('#search').value='';node('#max-price').value='1';c.catalog();assert.equal(node('#result-count').textContent,'พบ 0 เกม');
});
test('card text and attributes escape untrusted product content',()=>{
  const {c}=setup();const h=c.cards([{id:'x',name:'<img src=x onerror=alert(1)>',platform:'PC',genre:'RPG',price:100,stock:0,images:[]}]);assert.ok(!h.includes('<img src=x'));assert.ok(h.includes('&lt;img'));assert.ok(h.includes('disabled'));
});
test('demo checkout has only transfer and QR, escaped settings, and required consent',async()=>{
  const {c}=setup();const source=fs.readFileSync(__dirname+'/src/ui.js','utf8');
  c.paymentOrder=null;c.paymentSettings={};c.showDialog=h=>c.html=h;
  c.select=(label,name,options)=>options.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');
  c.submit=label=>`<button>${label}</button>`;
  c.api=async name=>name==='myData'?{orders:[{id:'order-demo',totalCents:15000}]}:{bank:'<script>bad</script>',recipient:'Demo',account:'DEMO-ACCOUNT',instructions:'test',transfer:true,qr:true};
  vm.runInContext(source.slice(source.indexOf('function demoQR()'),source.indexOf('async function mergeGuestCart()')),c);
  await c.openPayment('order-demo');assert.ok(c.html.includes('value="transfer"'));assert.ok(c.html.includes('value="qr"'));assert.ok(!c.html.includes('value="card"'));assert.ok(c.html.includes('type="checkbox" required'));assert.ok(!c.html.includes('<script>bad'));assert.ok(c.html.includes('สแกนจ่ายไม่ได้'));
  assert.equal(await c.slipData(null),'DEMO-GENERATED');
  await assert.rejects(c.slipData({size:300000,type:'image/png'}));
  await assert.rejects(c.slipData({size:100,type:'image/svg+xml'}));
  await assert.rejects(c.slipData({size:4,type:'image/png',slice:()=>({arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer})}));
});

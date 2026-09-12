const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,read=p=>fs.readFileSync(path.join(root,p),'utf8');
const outputRoot=path.resolve(root,'..');
const write=(p,text)=>{fs.mkdirSync(path.dirname(path.join(outputRoot,p)),{recursive:true});fs.writeFileSync(path.join(outputRoot,p),text);};
function reuseSdk(){const old=fs.readFileSync(path.join(outputRoot,'assets/js/app.js'),'utf8'),marker="(function(){'use strict';\nclass ValidationError";const at=old.indexOf(marker);if(at<0)throw Error('Existing verified Firebase bundle not found');return old.slice(0,at);}
const sdk=process.env.SHOP_REUSE_SDK==='1'?reuseSdk():require('esbuild').buildSync({entryPoints:[path.join(root,'src/sdk-entry.js')],nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),bundle:true,format:'iife',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
const ui=read('src/ui.js').replace('/* STOREFRONT_FUNCTIONS */',read('src/storefront.js'));
const business='(function(){'+read('src/business.js').replace('module.exports =','window.ShopBusiness =')+'})();';
const config=read('src/config.js').match(/firebaseConfig = ([\s\S]*?);/)[1];
const script=[sdk,business,'window.SHOP_CONFIG='+config+';','window.SHOP_PRODUCTS='+JSON.stringify(JSON.parse(read('src/products.json')))+';',read('firebase-adapter.js'),ui].join('\n').replace(/\r\n?/g,'\n');
const hash=crypto.createHash('sha256').update(script).digest('hex');
write('assets/js/app.js',script);
write('assets/css/main.css',read('src/main.css')+'\n'+read('src/shop.css').replace(/@import[^;]+;/g,'')+'\n'+read('src/restored.css'));
write('index.html',read('src/page.html').replace('{{BUILD_HASH}}',hash));
console.log('Built local website with separate classic JS and CSS assets');

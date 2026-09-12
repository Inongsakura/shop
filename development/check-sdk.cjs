// Exercise the actual browser bundle in an isolated JS context (no UI/network).
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function reuseSdk(){const old=fs.readFileSync(path.join(__dirname,'../assets/js/app.js'),'utf8'),marker="(function(){'use strict';\nclass ValidationError";const at=old.indexOf(marker);if(at<0)throw Error('Existing verified Firebase bundle not found');return old.slice(0,at);}
const sdk=process.env.SHOP_REUSE_SDK==='1'?reuseSdk():require('esbuild').buildSync({entryPoints:[path.join(__dirname,'src/sdk-entry.js')],nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),bundle:true,format:'iife',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
const context={console,setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,crypto,AbortController,Headers,Response,Request};
vm.createContext(context);
try {
  vm.runInContext('window=globalThis;self=globalThis;'+sdk,context);
  vm.runInContext("firebase.initializeApp({projectId:'demo-bundle',apiKey:'demo-key'});ShopFirestore('default');",context);
  console.log('PASS: bundled Firebase initialization and named database');
} catch(e) {console.error(e.code||'',e.message);process.exitCode=1;}

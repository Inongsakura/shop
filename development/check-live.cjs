// Read-only production smoke check; never creates accounts or writes orders.
const fs=require('node:fs');
const {initializeApp,deleteApp}=require('firebase/app'),{getFirestore,collection,query,where,getDocs,terminate}=require('firebase/firestore');
async function main(){const config=new Function(fs.readFileSync(__dirname+'/src/config.js','utf8').replaceAll('export ','')+';return firebaseConfig;')();
  const app=initializeApp(config),db=getFirestore(app,'default');
  try{const p=await getDocs(query(collection(db,'products'),where('active','==',true)));console.log('Public active products:',p.size);
  const r=await getDocs(collection(db,'reviews'));console.log('Public reviews accessible:',r.size);
  for(const name of ['users','orders','key_inventory','user_keys','admins']){let denied=false;try{await getDocs(collection(db,name));}catch(e){if(e.code==='permission-denied')denied=true;else throw e;}if(!denied)throw Error('Private collection unexpectedly public: '+name);console.log('Anonymous read denied:',name);}
  }finally{await terminate(db);await deleteApp(app);}}
main().catch(e=>{console.error(e.code||'',e.message);process.exitCode=1;});

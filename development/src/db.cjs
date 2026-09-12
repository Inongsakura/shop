// Small compatibility facade over the supported modular named-database API.
// Inject SDK modules from one entry point so import/require cannot create two
// separate Firebase app registries in the browser bundle.
function databaseFactory(f,getApp){
function createDb(databaseId='default'){
  const native=f.getFirestore(getApp(),databaseId);
  const snapshot=s=>({id:s.id,exists:s.exists(),data:()=>s.data()});
  const doc=r=>({native:r,id:r.id,get:async()=>snapshot(await f.getDoc(r)),set:(d,o)=>o?f.setDoc(r,d,o):f.setDoc(r,d),update:d=>f.updateDoc(r,d),delete:()=>f.deleteDoc(r)});
  const query=q=>({get:async()=>({docs:(await f.getDocs(q)).docs.map(snapshot)}),where:(...args)=>query(f.query(q,f.where(...args)))});
  return {
    collection:name=>{const r=f.collection(native,name);return {...query(r),doc:id=>doc(id?f.doc(r,id):f.doc(r))};},
    runTransaction:handler=>f.runTransaction(native,t=>handler({get:async r=>snapshot(await t.get(r.native)),set:(r,d,o)=>o?t.set(r.native,d,o):t.set(r.native,d),update:(r,d)=>t.update(r.native,d)})),
    useEmulator:(host,port)=>f.connectFirestoreEmulator(native,host,port),terminate:()=>f.terminate(native)
  };
}
return createDb;
}
module.exports={databaseFactory};

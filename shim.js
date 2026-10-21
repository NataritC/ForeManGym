/* Boy's Duty — standalone data layer (Supabase). Replaces the claude.ai runtime with the same small API the app uses. */
(function(){
const CFG=window.BD_CONFIG||{};
const configured=CFG.url&&!/PASTE/.test(CFG.url)&&CFG.anonKey&&!/PASTE/.test(CFG.anonKey)&&window.supabase;
const sb=configured?window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null;
const EMAIL=n=>String(n).toLowerCase()+"@"+(CFG.emailDomain||"boys-duty.app");
const PW=p=>"bd:"+p+":duty";           // lets short passwords like 0000 pass Supabase's 6-character minimum
let session=null,loaded=false,channel=null;
const cache={},listeners=new Set();
const col=c=>cache[c]||(cache[c]=new Map());
const emit=()=>listeners.forEach(fn=>{try{fn()}catch(e){console.error(e)}});
const snap=(id,d)=>({id,exists:d!==undefined,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}});
const toErr=e=>({code:(e&&(e.code==="42501"||/row-level security|permission/i.test(e.message||"")))?"invalid_argument":"unavailable",message:(e&&e.message)||"error"});
function deepMerge(a,b){if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(a)&&!Array.isArray(b)){const o={...a};for(const k in b)o[k]=deepMerge(a[k],b[k]);return o}return b}
async function loadAll(){
  if(!sb||!session){Object.values(cache).forEach(m=>m.clear());loaded=true;emit();return}
  const {data,error}=await sb.from("docs").select("collection,id,data");if(error)throw toErr(error);
  Object.values(cache).forEach(m=>m.clear());data.forEach(r=>col(r.collection).set(r.id,r.data));loaded=true;emit();
}
function startRealtime(){
  if(!sb||channel)return;
  channel=sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
    if(p.eventType==="DELETE"){if(p.old&&p.old.collection)col(p.old.collection).delete(p.old.id)}
    else if(p.new&&p.new.collection)col(p.new.collection).set(p.new.id,p.new.data);
    emit()}).subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&session)loadAll().catch(()=>{})});
setInterval(()=>{if(!document.hidden&&session)loadAll().catch(()=>{})},90000);
const only=(o,k)=>o&&Object.keys(o).length===1&&o[k]&&typeof o[k]==="object"&&Object.keys(o[k]).length===1;
function makeDoc(c,id){return{id,path:c+"/"+id,
  async get(){if(!loaded)await loadAll();return snap(id,col(c).get(id))},
  async set(data){const {error}=await sb.from("docs").upsert({collection:c,id,data,updated_at:new Date().toISOString()},{onConflict:"collection,id"});if(error)throw toErr(error);col(c).set(id,data);emit()},
  async update(patch){
    if((c==="checkins"&&only(patch,"reactions"))||(c==="pauses"&&only(patch,"votes"))){
      const k=c==="checkins"?"reactions":"votes",val=Object.values(patch[k])[0];
      const {error}=await sb.rpc("vote",{p_col:c,p_id:id,p_value:val});if(error)throw toErr(error);
    }else{const {error}=await sb.rpc("doc_merge",{p_col:c,p_id:id,p_patch:patch});if(error)throw toErr(error)}
    const cur=col(c).get(id);if(cur)col(c).set(id,deepMerge(cur,patch));emit()},
  async delete(){const {error}=await sb.from("docs").delete().match({collection:c,id});if(error)throw toErr(error);col(c).delete(id);emit()},
  onSnapshot(next){const fn=()=>next(snap(id,col(c).get(id)));listeners.add(fn);if(loaded)setTimeout(fn);return()=>listeners.delete(fn)},
  collection(){throw new TypeError("nested collections are not used")}}}
function makeQuery(c,ord,lim){
  const run=()=>{let a=[...col(c).entries()].map(([id,d])=>snap(id,d));
    if(ord){const [f,dir]=ord;a.sort((x,y)=>{const p=x.data()[f],q=y.data()[f];return (p>q?1:p<q?-1:0)*(dir==="desc"?-1:1)})}
    if(lim)a=a.slice(0,lim);return{docs:a,size:a.length,empty:!a.length,docChanges:()=>[],metadata:{}}};
  return{path:c,orderBy:(f,d="asc")=>makeQuery(c,[f,d],lim),limit:n=>makeQuery(c,ord,n),where(){return this},
    doc:id=>makeDoc(c,id||(crypto.randomUUID?crypto.randomUUID():String(Date.now()))),
    async add(d){const r=makeDoc(c,crypto.randomUUID?crypto.randomUUID():String(Date.now()));await r.set(d);return r},
    async get(){if(!loaded)await loadAll();return run()},
    onSnapshot(next){const fn=()=>next(run());listeners.add(fn);if(loaded)setTimeout(fn);return()=>listeners.delete(fn)}}}
const db={doc(p){const [c,i]=p.split("/");return makeDoc(c,i)},collection:c=>makeQuery(c)};
const assets={
  async upload(blob){if(!session)throw {code:"upstream_auth",message:"Not signed in"};
    const path=`${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
    const {error}=await sb.storage.from("proofs").upload(path,blob,{contentType:"image/jpeg",upsert:false});
    if(error)throw {code:"upstream_error",message:error.message};
    const url=sb.storage.from("proofs").getPublicUrl(path).data.publicUrl;return{id:url,url,sizeBytes:blob.size,contentType:"image/jpeg"}},
  async delete(ref){const m=String(ref).split("/proofs/")[1];if(m&&sb)await sb.storage.from("proofs").remove([decodeURIComponent(m)]);return{deleted:true}},
  async list(){return{assets:[],usage:{}}}};
const user={isOwner:()=>!!(window.__bdMe&&window.__bdMe().toLowerCase()===String(CFG.owner||"Ice").toLowerCase()),canEdit(){return this.isOwner()},can:()=>null,id:async()=>null,me:async()=>({})};
window.claude={use:async n=>{if(!sb)return null;if(n==="db")return db;if(n==="assets")return assets;if(n==="user")return user;return null}};

/* auth helpers the app calls: each phone gets a private session, the name + password are checked by the database */
const msg=e=>String((e&&e.message)||e||"");
async function ensureSession(){if(session)return null;const r=await sb.auth.signInAnonymously();
  if(r.error)return /anonymous/i.test(msg(r.error))?"Sign-in is switched off. In Supabase turn ON: Authentication → Sign In / Providers → Allow anonymous sign-ins.":"Couldn't reach the server: "+msg(r.error);
  session=r.data.session;return null}
async function whoAmI(){if(!session)return "";const r=await sb.rpc("my_name");return r.error?"":(r.data||"")}
window.BD={
  configured:!!sb,
  async restore(names){if(!sb)return null;const {data}=await sb.auth.getSession();session=data.session;
    sb.auth.onAuthStateChange((ev,s)=>{session=s;if(ev==="SIGNED_OUT"){Object.values(cache).forEach(m=>m.clear());emit()}});
    startRealtime();const n=await whoAmI();await loadAll().catch(()=>{});
    return names.find(p=>p.toLowerCase()===n)||null},
  async signIn(name,pw){
    const e=await ensureSession();if(e)return{err:e};
    const r=await sb.rpc("login",{p_name:name,p_pw:pw});
    if(r.error)return{err:/function .*login|does not exist|schema cache/i.test(msg(r.error))?"The database update isn't installed yet. Run the new SQL in Supabase first.":"Couldn't sign in: "+msg(r.error)};
    if(!r.data||!r.data.ok)return{err:"Wrong password. Try again."};
    await loadAll();return{ok:true,changed:!!r.data.changed}},
  async verify(name,pw){const r=await sb.rpc("verify_password",{p_pw:pw});return !r.error&&r.data===true},
  async setPassword(pw){const r=await sb.rpc("set_password",{p_new:pw});return r.error?msg(r.error):null},
  async resetMember(name){const r=await sb.rpc("reset_member",{p_name:name});return r.error?msg(r.error):null},
  signOut(){if(!sb)return;sb.rpc("logout").then(()=>sb.auth.signOut(),()=>sb.auth.signOut())},
  async ai(type,b64){if(!sb||CFG.ai===false)return{unavailable:true};
    const {data,error}=await sb.functions.invoke("check-photo",{body:{type,image:b64}});
    if(error){const st=error.context&&error.context.status;
      if(error.name==="FunctionsFetchError"||error.name==="FunctionsRelayError"||st===404||st===500)return{unavailable:true};   // AI not set up yet / key missing
      return{error:"The AI check didn't finish. Try again."}}
    if(!data||data.error)return{error:"The AI check couldn't read that. Try again or retake the photo."};return data}
};
})();

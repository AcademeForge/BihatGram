/* ═══════════════════════════════════════════════════
   BIHATGRAM — CORE
   Shared constants, in-memory cache, persistence helpers,
   Supabase edge-call wrapper, and avatar/render helpers
   used across home.html, search.html, chat.html,
   profile.html and settings.html.
═══════════════════════════════════════════════════ */

/* ── CONSTANTS & CONFIG ── */
const STUDENT_URL    = "https://afooyyydhlwngzssgqih.supabase.co";
const STUDENT_KEY_SB  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmb295eXlkaGx3bmd6c3NncWloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NDQxMjgsImV4cCI6MjA5NDIyMDEyOH0.KG0XO0oP_2MpewHoIwTtbrKg5FkyOYRUtVzLH1MSJiE";
const ADMIN_KEYS = ['admin@academeforge.in'];

/* ═══════════════════════════════════════════════════
   IN-MEMORY CACHE
   Only identity keys (email/name/emoji/avatar/dark)
   come from localStorage — everything else lives here.
═══════════════════════════════════════════════════ */
const _cache = {
  /* Feed */
  posts: [],
  seenPostIds: new Map(),
  feedScrollTop: 0,
  feedLastRefresh: 0,
  feedMode: 'relevant',

  /* Connections */
  myFollowers: [],
  myFollowing: [],
  followingKeys: new Set(),

  /* Chats */
  chatList: [],
  chatReadTs: new Map(),

  /* Profile thumbnails keyed by student_key */
  profiles: new Map(),

  /* Liked post IDs this session */
  likedPostIds: new Set(),
  blockedKeys: new Set(),

  /* Misc */
  myVerified: false,
};

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */
const $    = id => document.getElementById(id);
const show = id => $(id) && $(id).classList.remove('hidden');
const hide = id => $(id) && $(id).classList.add('hidden');

const isLoggedIn = () => !!(localStorage.getItem('af_student_email') || localStorage.getItem('af_student_mobile'));
const sKey  = () => localStorage.getItem('af_student_email') || localStorage.getItem('af_student_mobile') || '';
const sName = () => localStorage.getItem('af_student_name') || 'Student';
const isAdmin = () => ADMIN_KEYS.includes(sKey());

function wordCount(t){ const s = String(t||'').trim(); return s ? s.split(/\s+/).filter(Boolean).length : 0; }
function initials(n){ return String(n||'BG').trim().split(/\s+/).slice(0,2).map(v=>v.charAt(0).toUpperCase()).join(''); }
function esc(t){ return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function timeAgo(v){
  if(!v) return '';
  try{
    const d = Math.floor((Date.now()-new Date(v).getTime())/1000);
    if(d<60) return 'just now';
    if(d<3600) return Math.floor(d/60)+'m';
    if(d<86400) return Math.floor(d/3600)+'h';
    if(d<604800) return Math.floor(d/86400)+'d';
    return new Date(v).toLocaleDateString();
  }catch(e){ return ''; }
}
function getMyEmoji(){ return localStorage.getItem('af_avatar_emoji')||''; }
function getMyUsername(){ return localStorage.getItem('af_username')||''; }
function getMyAvatarUrl(){ return localStorage.getItem('af_avatar_url')||''; }

/* ═══════════════════════════════════════════════════
   CHAT READ-STATE PERSISTENCE
═══════════════════════════════════════════════════ */
function chatReadTsStorageKey(){
  const key = sKey();
  return key ? 'af_chat_read_ts:'+key : null;
}
function loadChatReadTs(){
  const storageKey = chatReadTsStorageKey();
  if(!storageKey) return new Map();
  try{
    const raw = localStorage.getItem(storageKey);
    if(!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj).map(([k,v])=>[k,Number(v)||0]));
  }catch(e){ return new Map(); }
}
function saveChatReadTs(){
  const storageKey = chatReadTsStorageKey();
  if(!storageKey) return;
  try{
    const obj = {};
    _cache.chatReadTs.forEach((v,k)=>{ obj[k]=v; });
    localStorage.setItem(storageKey, JSON.stringify(obj));
  }catch(e){ /* storage full or unavailable — read-state just won't persist this time */ }
}

/* ═══════════════════════════════════════════════════
   POST LIKE-STATE PERSISTENCE
═══════════════════════════════════════════════════ */
function likedPostIdsStorageKey(){
  const key = sKey();
  return key ? 'af_liked_posts:'+key : null;
}
function loadLikedPostIds(){
  const storageKey = likedPostIdsStorageKey();
  if(!storageKey) return new Set();
  try{
    const raw = localStorage.getItem(storageKey);
    if(!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr)?arr:[]);
  }catch(e){ return new Set(); }
}
function saveLikedPostIds(){
  const storageKey = likedPostIdsStorageKey();
  if(!storageKey) return;
  try{
    localStorage.setItem(storageKey, JSON.stringify([..._cache.likedPostIds]));
  }catch(e){ /* storage full or unavailable — liked-state just won't persist this time */ }
}

/* ═══════════════════════════════════════════════════
   GENERIC "STALE-WHILE-REVALIDATE" SNAPSHOT CACHE
═══════════════════════════════════════════════════ */
function snapshotStorageKey(name){
  const key = sKey();
  return key ? 'af_snap_'+name+':'+key : null;
}
function loadSnapshot(name){
  const storageKey = snapshotStorageKey(name);
  if(!storageKey) return null;
  try{
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function saveSnapshot(name, data){
  const storageKey = snapshotStorageKey(name);
  if(!storageKey) return;
  try{
    localStorage.setItem(storageKey, JSON.stringify(data));
  }catch(e){ /* storage full or unavailable — just skip caching this time */ }
}

/* ═══════════════════════════════════════════════════
   SUPABASE BOOTSTRAP
═══════════════════════════════════════════════════ */
let _sb = null;
function loadSupabaseSDK(){
  return new Promise((res,rej)=>{
    if(typeof supabase!=='undefined'){ res(); return; }
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload=res; s.onerror=()=>rej(new Error('Supabase SDK failed.'));
    document.head.appendChild(s);
  });
}
function getSb(){
  if(_sb) return _sb;
  if(typeof supabase!=='undefined') _sb = supabase.createClient(STUDENT_URL, STUDENT_KEY_SB);
  return _sb;
}

/* ═══════════════════════════════════════════════════
   STACKING MANAGER
═══════════════════════════════════════════════════ */
const STACK_BASE_Z = 1100;
let _stackCounter = 0;
function nxBringToFront(id){
  const el=$(id); if(!el) return;
  _stackCounter+=1;
  el.style.zIndex = String(STACK_BASE_Z + _stackCounter);
}

/* ═══════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════ */
function syncTheme(){
  const dark = localStorage.getItem('af_dark_mode')==='1';
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
}
syncTheme();
window.addEventListener('storage', e=>{
  if(e.key==='af_dark_mode') syncTheme();
  if(['af_student_email','af_student_mobile','af_student_name'].includes(e.key)){
    const stillLoggedIn = !!(localStorage.getItem('af_student_email')||localStorage.getItem('af_student_mobile'));
    if(!stillLoggedIn) nxClearAllCaches();
    if(typeof init==='function') init();
  }
});
function nxToggleDarkMode(){
  const isDark = localStorage.getItem('af_dark_mode')==='1';
  localStorage.setItem('af_dark_mode', isDark?'0':'1');
  syncTheme();
  if(typeof nxSyncDarkToggleUI==='function') nxSyncDarkToggleUI();
}
window.nxToggleDarkMode = nxToggleDarkMode;
function goToLogin(){ sessionStorage.setItem('af_last_tab','student'); window.location.href='../'; }
window.goToLogin = goToLogin;

/**
 * Fully logs the student out of BihatGram and wipes every trace of their
 * session from this page before redirecting:
 * 1. Removes every af_* identity/profile key from localStorage
 *    (theme/dark-mode is kept since it's a device preference, not account data).
 * 2. Clears sessionStorage entries set by this page.
 * 3. Empties the entire in-memory _cache object.
 * 4. Resets module-level UI state variables (if defined on this page).
 * 5. Unsubscribes the realtime DM channel tied to this account.
 * 6. Closes every open screen/modal so the next init() starts clean.
 */
const AF_KEEP_ON_LOGOUT = new Set(['af_dark_mode']);
function nxClearAllCaches(){
  Object.keys(localStorage)
    .filter(k=>k.startsWith('af_') && !AF_KEEP_ON_LOGOUT.has(k))
    .forEach(k=>localStorage.removeItem(k));

  sessionStorage.removeItem('af_last_tab');

  _cache.posts = [];
  _cache.seenPostIds = new Map();
  _cache.feedScrollTop = 0;
  _cache.feedLastRefresh = 0;
  _cache.feedMode = 'relevant';
  _cache.myFollowers = [];
  _cache.myFollowing = [];
  _cache.followingKeys = new Set();
  _cache.chatList = [];
  _cache.chatReadTs = new Map();
  _cache.profiles = new Map();
  _cache.likedPostIds = new Set();
  _cache.blockedKeys = new Set();
  _cache.myVerified = false;
  _stackCounter = 0;

  if(typeof teardownRealtime==='function') teardownRealtime();
  if(typeof nxResetPageState==='function') nxResetPageState();

  document.querySelectorAll('.modal-ov,.full-screen-view,.profile-screen,.dm-screen,.my-profile-screen')
    .forEach(el=>{ el.style.display='none'; });
}
function nxLogout(){
  nxClearAllCaches();
  goToLogin();
}
window.nxLogout = nxLogout;
window.nxClearAllCaches = nxClearAllCaches;

/* ═══════════════════════════════════════════════════
   EDGE CALL
   NOTE: User-facing messages are intentionally generic.
   Raw SDK / transport / edge-function error text must
   NEVER reach the UI.
═══════════════════════════════════════════════════ */
const EDGE_ERR_OFFLINE = "You're offline right now. Please check your internet connection and try again.";
const EDGE_ERR_NETWORK = "We couldn't reach the server. Please check your connection and try again.";
const EDGE_ERR_SERVER  = "Something went wrong on our end. It's not you — we're already looking into it. Please try again shortly.";

function _isLikelyNetworkError(e){
  if(!e) return false;
  const name = e.name || '';
  const msg = (e.message || '').toLowerCase();
  if(name === 'TypeError' && msg.includes('fetch')) return true;
  if(msg.includes('networkerror')) return true;
  if(msg.includes('load failed')) return true;
  if(msg.includes('network request failed')) return true;
  if(name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) return true;
  return false;
}

async function edgeCall(payload){
  try{
    if(!navigator.onLine) return {ok:false,message:EDGE_ERR_OFFLINE};
    await loadSupabaseSDK();
    const sb=getSb();
    if(!sb) return {ok:false,message:EDGE_ERR_SERVER};
    const fp={...payload,student_key:sKey(),student_name:sName(),student_emoji:getMyEmoji(),student_avatar_url:getMyAvatarUrl()};
    let data, error;
    try{
      const res = await sb.functions.invoke('af-nexus-community-v2',{body:fp});
      data = res.data; error = res.error;
    }catch(invokeErr){
      if(!navigator.onLine) return {ok:false,message:EDGE_ERR_OFFLINE};
      if(_isLikelyNetworkError(invokeErr)) return {ok:false,message:EDGE_ERR_NETWORK};
      return {ok:false,message:EDGE_ERR_SERVER};
    }
    if(error){
      if(_isLikelyNetworkError(error)) return {ok:false,message:EDGE_ERR_NETWORK};
      return {ok:false,message:EDGE_ERR_SERVER};
    }
    if(!data) return {ok:false,message:EDGE_ERR_SERVER};
    if(data.ok === false && !data.message){
      return {ok:false,message:EDGE_ERR_SERVER};
    }
    return data;
  }catch(e){
    if(!navigator.onLine) return {ok:false,message:EDGE_ERR_OFFLINE};
    if(_isLikelyNetworkError(e)) return {ok:false,message:EDGE_ERR_NETWORK};
    return {ok:false,message:EDGE_ERR_SERVER};
  }
}

/* ═══════════════════════════════════════════════════
   AVATAR HTML — gold vs standard verified
═══════════════════════════════════════════════════ */
function avatarHTML(name, emoji, avatarUrl, extraClass='', onClick='', isVer=false){
  const action = onClick ? ` onclick="${onClick}"` : '';
  const verClass = isVer ? ' gold-avatar-frame' : '';
  if(avatarUrl){
    return `<div class="avatar${extraClass}${verClass}"${action}><img src="${esc(avatarUrl)}" alt="${esc(name)}" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML='${esc(initials(name))}'"/></div>`;
  }
  if(emoji){
    return `<div class="avatar${extraClass}${verClass}"${action}>${emoji}</div>`;
  }
  return `<div class="avatar initials${extraClass}${verClass}"${action}>${esc(initials(name))}</div>`;
}

/* verified badge HTML — gold badge for verified users */
function verBadgeHTML(isVer){
  if(!isVer) return '';
  return '<span class="gold-badge">★</span>';
}

/* ═══════════════════════════════════════════════════
   MY AVATAR BUTTON SYNC
═══════════════════════════════════════════════════ */
function syncAvatarBtn(){
  const btn=$('btnMyAvatar');
  if(!btn) return;
  const avatarUrl = getMyAvatarUrl();
  const emoji = getMyEmoji();
  const name = sName();
  if(avatarUrl){
    btn.innerHTML=`<img src="${esc(avatarUrl)}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${esc(initials(name))}'"/>`;
    btn.style.background='transparent';
  } else if(emoji){
    btn.innerHTML=emoji;
    btn.style.background='var(--p)';
    btn.style.fontSize='18px';
  } else {
    btn.innerHTML=`<span style="font-size:12px;font-weight:800;">${esc(initials(name))}</span>`;
    btn.style.background='var(--p)';
  }
}

/* ═══════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════ */
function showToast(msg, type='ok', title=''){
  const w=$('toastWrap'); if(!w) return;
  w.innerHTML='';
  const d=document.createElement('div');
  const isErr = type==='err';
  d.className = 'af-toast af-toast-' + (isErr ? 'err' : 'ok');
  d.setAttribute('role','alert');
  d.setAttribute('aria-live','assertive');
  const icon = isErr ? '⚠️' : '✓';
  d.innerHTML=`<span class="af-toast-ic">${icon}</span><div><p class="af-toast-title">${title||(isErr?'Error':'Done')}</p><p class="af-toast-msg">${esc(msg)}</p></div>`;
  w.appendChild(d);
  requestAnimationFrame(()=>d.classList.add('show'));
  setTimeout(()=>{d.classList.remove('show');setTimeout(()=>d.remove(),220);},2800);
}
window.showToast = showToast;

/* ═══════════════════════════════════════════════════
   FORCE REPAINT
═══════════════════════════════════════════════════ */
function nxForceRepaint(){
  const shell=$('shell');
  if(!shell) return;
  requestAnimationFrame(()=>{
    shell.style.transform='translateZ(0)';
    requestAnimationFrame(()=>{ shell.style.transform=''; });
  });
}
window.nxForceRepaint = nxForceRepaint;

/* ═══════════════════════════════════════════════════
   REALTIME (DMs) — shared subscription helpers
═══════════════════════════════════════════════════ */
let _realtimeChannel=null;
function setupRealtime(onMessage){
  const sb=getSb();
  if(!sb) return;
  _realtimeChannel=sb.channel('realtime_dms')
    .on('postgres_changes',{event:'*',schema:'public',table:'af_nexus_dms_v2'},payload=>{
      const msg=payload.new;
      if(msg&&(msg.receiver_key===sKey()||msg.sender_key===sKey())){
        const peerKey=msg.sender_key===sKey()?msg.receiver_key:msg.sender_key;
        if(typeof onMessage==='function') onMessage(peerKey);
      }
    }).subscribe();
}
function teardownRealtime(){
  const sb=getSb();
  if(sb&&_realtimeChannel){
    try{ sb.removeChannel(_realtimeChannel); }catch(e){ /* channel already gone */ }
  }
  _realtimeChannel=null;
}

/* ═══════════════════════════════════════════════════
   SEEN POST TRACKING (in-memory only)
═══════════════════════════════════════════════════ */
const _seenObserver = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(!entry.isIntersecting) return;
    const el = entry.target;
    const pid = el.dataset.postId;
    if(!pid) return;
    const existing = _cache.seenPostIds.get(pid);
    const startTs = existing?._visibleSince || Date.now();
    if(!existing || !existing._visibleSince){
      const rec = existing || {count:0,ts:Date.now(),duration:0};
      rec._visibleSince = startTs;
      _cache.seenPostIds.set(pid, rec);
      setTimeout(()=>{
        if(_cache.seenPostIds.get(pid)?._visibleSince === startTs){
          const r = _cache.seenPostIds.get(pid) || {count:0,ts:Date.now(),duration:0};
          r.count = (r.count||0) + 1;
          r.ts = Date.now();
          delete r._visibleSince;
          _cache.seenPostIds.set(pid, r);
        }
      }, 2500);
    }
  });
},{threshold:0.5});

function observePostCards(){
  document.querySelectorAll('.post-card[data-post-id]').forEach(el=>{
    _seenObserver.observe(el);
  });
}

function getSeenPenalty(pid){
  const r = _cache.seenPostIds.get(String(pid));
  if(!r || !r.count) return 1.0;
  if(r.count === 1) return 0.5;
  if(r.count === 2) return 0.2;
  return 0.05;
}

/* ═══════════════════════════════════════════════════
   SMART FEED RANKING ENGINE
   Score = 40% following + 25% interest + 15% freshness
           + 10% trending + 10% diversity
   With seen penalty and creator diversity cap
═══════════════════════════════════════════════════ */
function scorePost(p, followingKeys, recentCreators){
  const now = Date.now();
  const postAge = (now - new Date(p.created_at||now).getTime()) / 1000;

  const isFollowed = followingKeys.has(String(p.student_key||''));
  const followScore = isFollowed ? 1.0 : 0.2;

  const ageHours = Math.max(1, postAge / 3600);
  const engagementRate = ((p.likes_count||0) + (p.comments_count||0)*2) / ageHours;
  const interestScore = Math.min(1.0, engagementRate / 20);

  const freshnessScore = Math.exp(-postAge / 21600);

  const trendScore = Math.min(1.0, ((p.likes_count||0) + (p.comments_count||0)) / 50);

  const creatorRecentCount = recentCreators.filter(k=>k===String(p.student_key||'')).length;
  const diversityScore = creatorRecentCount >= 2 ? 0.0 : creatorRecentCount === 1 ? 0.4 : 1.0;

  const verBoost = p.is_verified ? 0.10 : 0.0;

  const raw = (
    followScore    * 0.40 +
    interestScore  * 0.25 +
    freshnessScore * 0.15 +
    trendScore     * 0.10 +
    diversityScore * 0.10 +
    verBoost
  );

  return raw * getSeenPenalty(p.id);
}

function rankFeed(posts, followingKeys){
  const scored = posts.map((p, idx)=>({p, idx, rawScore: scorePost(p, followingKeys, [])}));
  scored.sort((a,b)=>b.rawScore - a.rawScore);

  const result = [];
  const remaining = [...scored];
  const recentCreators = [];

  while(remaining.length > 0){
    let chosenIdx = -1;
    for(let i=0;i<remaining.length;i++){
      const ck = String(remaining[i].p.student_key||'');
      const recentWindow = recentCreators.slice(-5);
      const countInWindow = recentWindow.filter(k=>k===ck).length;
      if(countInWindow < 1){ chosenIdx=i; break; }
    }
    if(chosenIdx === -1) chosenIdx = 0;
    const chosen = remaining.splice(chosenIdx,1)[0];
    result.push(chosen.p);
    recentCreators.push(String(chosen.p.student_key||''));
    if(recentCreators.length>12) recentCreators.shift();
  }

  return result;
}

function mergeFeedOnRefresh(existingPosts, freshPosts, followingKeys){
  const existingIds = new Set(existingPosts.map(p=>String(p.id)));
  const freshIds    = new Set(freshPosts.map(p=>String(p.id)));

  const newPosts    = freshPosts.filter(p=>!existingIds.has(String(p.id)));
  const updatedMap  = new Map(freshPosts.map(p=>[String(p.id),p]));

  const allPosts = [
    ...newPosts,
    ...existingPosts.map(p=>updatedMap.get(String(p.id))||p)
  ];

  const filtered = allPosts.filter(p=>freshIds.has(String(p.id))||existingIds.has(String(p.id)));
  return rankFeed(filtered, followingKeys);
}

/* ═══════════════════════════════════════════════════
   POST CARD RENDER
═══════════════════════════════════════════════════ */
function renderPostHtml(p, mk, admin, showPinned){
  const mine=String(p.student_key||'')===String(mk||'');
  const peerEmoji=p.emoji||'';
  const peerAvatarUrl=p.avatar_url||'';
  const isVer=!!p.is_verified;
  const av=avatarHTML(p.student_name,peerEmoji,peerAvatarUrl,'',`nxOpenProfile('${esc(p.student_key)}','${esc(p.student_name).replace(/'/g,"&#39;")}')`,isVer);
  const pinBar=(showPinned&&p.is_pinned)?`<div class="pin-badge">📌 Pinned</div>`:'';
  const prev=esc((p.content||'').replace(/[\n\r]/g,' ').slice(0,55)).replace(/'/g,'&#39;');

  const cardClass = isVer ? ' gold-post-card' : (p.is_pinned?' pinned':'');
  const likedClass=_cache.likedPostIds.has(p.id)?' liked':'';

  const nameHtml = isVer
    ? `<span class="gold-name">${esc(p.student_name||'Student')}</span>${verBadgeHTML(true)}`
    : esc(p.student_name||'Student');

  const rawContent = p.content||'';
  const lineBreakCount = (rawContent.match(/\n/g)||[]).length;
  const isLong = lineBreakCount >= 4 || rawContent.length > 220;
  const postTextHtml = isLong
    ? `<p class="post-text clamped" id="post-text-${p.id}">${esc(rawContent)}</p>
       <button class="read-more-btn" id="read-more-${p.id}" onclick="event.stopPropagation();nxToggleReadMore(${p.id})">Read More</button>`
    : `<p class="post-text" onclick="nxOpenComments(${p.id},'${prev}')" style="cursor:pointer;">${esc(rawContent)}</p>`;

  return `<div class="post-card${cardClass}" data-post-id="${p.id}">
    ${pinBar}
    <div class="post-top">
      <div class="post-author">
        ${av}
        <div class="post-meta">
          <strong onclick="nxOpenProfile('${esc(p.student_key)}','${esc(p.student_name).replace(/'/g,"&#39;")}')" style="display:flex;align-items:center;gap:0;">
            ${nameHtml}
          </strong>
          <small onclick="nxOpenProfile('${esc(p.student_key)}','${esc(p.student_name).replace(/'/g,"&#39;")}')">${p.username?'@'+esc(p.username)+' · ':''}${esc(timeAgo(p.created_at))}</small>
        </div>
      </div>
      <button class="menu-dot" onclick="nxOpenMenu('post',${p.id},${mine},${!!p.is_pinned})">⋯</button>
    </div>
    ${postTextHtml}
    <div class="post-actions">
      <button class="action-btn${likedClass}" id="like-btn-${p.id}" onclick="nxLikePost(${p.id},this)">
        <span class="heart-ic" id="like-icon-${p.id}"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.8-10.2-9.6C.2 8.4 1.4 4.8 4.8 3.6c2.1-.7 4.3 0 5.6 1.7l1.6 2 1.6-2c1.3-1.7 3.5-2.4 5.6-1.7 3.4 1.2 4.6 4.8 3 7.8C19.5 16.2 12 21 12 21z"/></svg></span>
        <span class="cnt" id="like-cnt-${p.id}">${p.likes_count>0?p.likes_count:''}</span>
      </button>
      <button class="action-btn" onclick="nxOpenComments(${p.id},'${prev}')">💬 <span class="cnt">${p.comments_count||0}</span></button>
    </div>
  </div>`;
}

function nxToggleReadMore(pid){
  const textEl=$('post-text-'+pid);
  const btnEl=$('read-more-'+pid);
  if(!textEl||!btnEl) return;
  const isClamped=textEl.classList.contains('clamped');
  if(isClamped){
    textEl.classList.remove('clamped');
    textEl.style.marginBottom='6px';
    btnEl.textContent='Read Less';
  } else {
    textEl.classList.add('clamped');
    textEl.style.marginBottom='';
    btnEl.textContent='Read More';
  }
}
window.nxToggleReadMore=nxToggleReadMore;

function renderListToContainer(posts, containerId, checkPinned){
  const box=$(containerId); if(!box) return;
  if(!posts||!posts.length){
    box.innerHTML='<div class="state-msg"><span>✨</span><span>No posts to show.</span></div>';
    return;
  }
  const mk=sKey(), admin=isAdmin();
  let ordered=posts;
  if(checkPinned){
    const pinned=posts.filter(p=>p.is_pinned);
    const normal=posts.filter(p=>!p.is_pinned);
    ordered=[...pinned,...normal];
  }
  box.innerHTML=ordered.map(p=>renderPostHtml(p,mk,admin,checkPinned)).join('');
  if(containerId==='postsList' && posts.length > 0){
    box.innerHTML += '<div class="feed-end-msg">🎉 Take a break. You\'re all caught up.</div>';
  }
  requestAnimationFrame(observePostCards);
}
window.renderListToContainer = renderListToContainer;

/* ═══════════════════════════════════════════════════
   CHAT UNREAD (in-memory read timestamps)
═══════════════════════════════════════════════════ */
function getChatUnreadCount(messages){
  if(!messages||!messages.length) return 0;
  const peerKey=messages.find(m=>m.sender!==sKey())?.sender;
  if(!peerKey) return 0;
  const lastRead=_cache.chatReadTs.get(peerKey)||0;
  return messages.filter(m=>m.sender===peerKey&&new Date(m.ts).getTime()>lastRead).length;
}
function markChatRead(peerKey){
  _cache.chatReadTs.set(peerKey, Date.now());
  saveChatReadTs();
  if(typeof nxUpdateUnreadBadge==='function') nxUpdateUnreadBadge();
  if(typeof nxRenderChatList==='function') nxRenderChatList();
}

/* ═══════════════════════════════════════════════════
   IMAGE LIGHTBOX — pinch/wheel zoom + drag pan
   (shared across any page that renders images: home,
   profile, chat)
═══════════════════════════════════════════════════ */
(function(){
  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const ZOOM_STEP = 0.25;

  let _scale = 1;
  let _tx = 0, _ty = 0;
  let _dragging = false;
  let _dragStartX = 0, _dragStartY = 0;
  let _dragOriginTx = 0, _dragOriginTy = 0;

  let _pinchActive = false;
  let _pinchStartDist = 0;
  let _pinchStartScale = 1;

  function _lbEl(){ return document.getElementById('imgLightbox'); }
  function _wrap(){ return document.getElementById('lbImgWrap'); }
  function _img(){ return document.getElementById('lbImg'); }
  function _pct(){ return document.getElementById('lbZoomPct'); }

  function _applyTransform(){
    const wrap = _wrap();
    if(!wrap) return;
    const img = _img();
    const iw = img.offsetWidth * _scale;
    const ih = img.offsetHeight * _scale;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxTx = _scale > 1 ? Math.max(0,(iw - vw)/2) : 0;
    const maxTy = _scale > 1 ? Math.max(0,(ih - vh)/2) : 0;
    _tx = Math.max(-maxTx, Math.min(maxTx, _tx));
    _ty = Math.max(-maxTy, Math.min(maxTy, _ty));
    wrap.style.transform = `translate(${_tx}px,${_ty}px) scale(${_scale})`;
    wrap.style.transition = _dragging || _pinchActive ? 'none' : 'transform .18s ease';
    const p = _pct();
    if(p) p.textContent = Math.round(_scale * 100) + '%';
  }

  function _resetTransform(){
    _scale = 1; _tx = 0; _ty = 0;
    _applyTransform();
  }

  window.nxOpenLightbox = function(src){
    const lb = _lbEl();
    const img = _img();
    if(!lb || !img) return;
    _resetTransform();
    img.src = src;
    lb.classList.add('open');
    document.addEventListener('keydown', _onKey);
  };

  window.nxCloseLightbox = function(){
    const lb = _lbEl();
    if(!lb) return;
    lb.classList.remove('open');
    document.removeEventListener('keydown', _onKey);
    setTimeout(()=>{
      const img = _img();
      if(img) img.src='';
      _resetTransform();
    }, 260);
  };

  window.nxLbZoom = function(delta){
    _scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, _scale + delta));
    if(_scale === MIN_SCALE){ _tx = 0; _ty = 0; }
    _applyTransform();
  };

  function _onKey(e){
    if(e.key === 'Escape'){ window.nxCloseLightbox(); return; }
    if(e.key === '+' || e.key === '='){ window.nxLbZoom(ZOOM_STEP); return; }
    if(e.key === '-'){ window.nxLbZoom(-ZOOM_STEP); return; }
    if(e.key === '0'){ _resetTransform(); return; }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const lb = _lbEl();
    if(!lb) return;

    lb.addEventListener('click', e=>{
      if(e.target === lb) window.nxCloseLightbox();
    });

    lb.addEventListener('wheel', e=>{
      if(!lb.classList.contains('open')) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      _scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, _scale + delta));
      if(_scale === MIN_SCALE){ _tx = 0; _ty = 0; }
      _applyTransform();
    }, { passive: false });

    const wrap = _wrap();
    if(wrap){
      wrap.addEventListener('mousedown', e=>{
        if(_scale <= 1) return;
        e.preventDefault();
        _dragging = true;
        _dragStartX = e.clientX;
        _dragStartY = e.clientY;
        _dragOriginTx = _tx;
        _dragOriginTy = _ty;
      });
      document.addEventListener('mousemove', e=>{
        if(!_dragging) return;
        _tx = _dragOriginTx + (e.clientX - _dragStartX);
        _ty = _dragOriginTy + (e.clientY - _dragStartY);
        _applyTransform();
      });
      document.addEventListener('mouseup', ()=>{ _dragging = false; });

      wrap.addEventListener('dblclick', e=>{
        e.stopPropagation();
        if(_scale > 1){
          _resetTransform();
        } else {
          _scale = 2.5;
          _applyTransform();
        }
      });
    }

    lb.addEventListener('touchstart', e=>{
      if(!lb.classList.contains('open')) return;
      if(e.touches.length === 2){
        _pinchActive = true;
        _dragging = false;
        const t0 = e.touches[0], t1 = e.touches[1];
        _pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        _pinchStartScale = _scale;
      } else if(e.touches.length === 1 && _scale > 1){
        _dragging = true;
        _dragStartX = e.touches[0].clientX;
        _dragStartY = e.touches[0].clientY;
        _dragOriginTx = _tx;
        _dragOriginTy = _ty;
      }
    }, { passive: true });

    lb.addEventListener('touchmove', e=>{
      if(!lb.classList.contains('open')) return;
      if(_pinchActive && e.touches.length === 2){
        e.preventDefault();
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        _scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, _pinchStartScale * (dist / _pinchStartDist)));
        if(_scale === MIN_SCALE){ _tx = 0; _ty = 0; }
        _applyTransform();
      } else if(_dragging && e.touches.length === 1){
        e.preventDefault();
        _tx = _dragOriginTx + (e.touches[0].clientX - _dragStartX);
        _ty = _dragOriginTy + (e.touches[0].clientY - _dragStartY);
        _applyTransform();
      }
    }, { passive: false });

    lb.addEventListener('touchend', e=>{
      if(e.touches.length < 2) _pinchActive = false;
      if(e.touches.length === 0) _dragging = false;
      if(_scale < MIN_SCALE + 0.05){
        _scale = MIN_SCALE; _tx = 0; _ty = 0;
        _applyTransform();
      }
    }, { passive: true });
  });
})();

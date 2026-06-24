/* ═══════════════════════════════════════════════════
   BIHATGRAM — HOME (Feed) PAGE LOGIC
   Depends on shared/core.js and shared/nav.js being
   loaded first.
═══════════════════════════════════════════════════ */

let _mode='relevant';
let _curPostId=null, _replyParentId=null, _menuTarget=null;
let _profileData=null, _profileIsFollowing=false;
let _dmPeer=null, _dmEditingId=null, _dmPendingImage=null;
let _reportPostId=null, _reportReason=null;
let _pendingAvatarDataUrl=null;

function nxResetPageState(){
  _mode='relevant';
  _curPostId=null; _replyParentId=null; _menuTarget=null;
  _profileData=null; _profileIsFollowing=false;
  _dmPeer=null; _dmEditingId=null; _dmPendingImage=null;
  _reportPostId=null; _reportReason=null;
  _pendingAvatarDataUrl=null;
}

/* ═══════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════ */
function nxRenderHomeHeader(){
  const rightSlot = `
    <button class="af-hdr-icon-btn" onclick="window.location.href='search.html'" aria-label="Search">🔍</button>
    <button class="my-avatar-btn" id="btnMyAvatar" onclick="window.location.href='profile.html'" aria-label="My profile"></button>
  `;
  nxRenderHeader('hdr', rightSlot);
  syncAvatarBtn();
}

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
async function init(){
  nxRenderHomeHeader();
  nxRenderNav('home');
  syncTheme();
  if(!isLoggedIn()){
    document.getElementById('mainView').style.display='none';
    $('lockedBox').style.display='flex';
    return;
  }
  document.getElementById('mainView').style.display='flex';
  $('lockedBox').style.display='none';
  _cache.likedPostIds = loadLikedPostIds();
  nxLoadMyProfile();
  await Promise.all([nxLoadPosts(), nxPreloadConnections(), nxLoadBlockedUsers()]);
  setupRealtime(nxRefreshPeerChat);
}

/* ═══════════════════════════════════════════════════
   CONNECTIONS (followers/following — needed for ranking
   and for follow/unfollow buttons on viewed profiles)
═══════════════════════════════════════════════════ */
async function nxPreloadConnections(){
  const cachedFollowers=loadSnapshot('followers_me');
  const cachedFollowing=loadSnapshot('following_me');
  if(Array.isArray(cachedFollowers)) _cache.myFollowers=cachedFollowers;
  if(Array.isArray(cachedFollowing)){
    _cache.myFollowing=cachedFollowing;
    _cache.followingKeys=new Set(_cache.myFollowing.map(u=>String(u.student_key||'')));
  }

  const [folRes, figRes] = await Promise.all([
    edgeCall({action:'get_followers',target_key:sKey()}),
    edgeCall({action:'get_following',target_key:sKey()}),
  ]);
  if(folRes&&folRes.ok){
    _cache.myFollowers = folRes.users||[];
    saveSnapshot('followers_me', _cache.myFollowers);
  }
  if(figRes&&figRes.ok){
    _cache.myFollowing = figRes.users||[];
    _cache.followingKeys = new Set(_cache.myFollowing.map(u=>String(u.student_key||'')));
    saveSnapshot('following_me', _cache.myFollowing);
  }
}

/* ═══════════════════════════════════════════════════
   REALTIME callback — refresh a single peer's thread
   in the in-memory cache so unread badges / DM screens
   referenced from this page stay current.
═══════════════════════════════════════════════════ */
async function nxRefreshPeerChat(peerKey){
  const res=await edgeCall({action:'fetch_dms',peer_key:peerKey});
  if(res&&res.ok&&res.messages){
    let chatIdx=_cache.chatList.findIndex(c=>c.peer.student_key===peerKey);
    if(chatIdx>=0){
      _cache.chatList[chatIdx].messages=res.messages;
      _cache.chatList[chatIdx].latest=res.messages[res.messages.length-1];
    } else {
      const profRes=await edgeCall({action:'get_profile',target_key:peerKey});
      if(profRes&&profRes.ok&&profRes.profile&&res.messages.length>0){
        _cache.chatList.push({peer:profRes.profile,messages:res.messages,latest:res.messages[res.messages.length-1]});
        _cache.profiles.set(peerKey, profRes.profile);
      }
    }
    _cache.chatList.sort((a,b)=>new Date(b.latest.ts)-new Date(a.latest.ts));
    if($('dmScreen').style.display==='flex'&&_dmPeer&&_dmPeer.key===peerKey){
      nxRenderDMMessages(res.messages);
      markChatRead(peerKey);
    }
  }
}

/* ═══════════════════════════════════════════════════
   MY PROFILE (lightweight — reads from localStorage)
═══════════════════════════════════════════════════ */
async function nxLoadMyProfile(){
  const res=await edgeCall({action:'get_my_profile'});
  if(res&&res.ok&&res.profile){
    if(res.profile.username) localStorage.setItem('af_username',res.profile.username);
    if(res.profile.emoji)    localStorage.setItem('af_avatar_emoji',res.profile.emoji);
    if(res.profile.avatar_url) localStorage.setItem('af_avatar_url',res.profile.avatar_url);
    _cache.myVerified = !!res.profile.is_verified;
    syncAvatarBtn();
  }
  const hasUsername=!!(res&&res.ok&&res.profile&&res.profile.username);
  $('usernameBanner').classList.toggle('hidden',hasUsername);
}

/* ═══════════════════════════════════════════════════
   FEED LOAD & RANKING
═══════════════════════════════════════════════════ */
async function nxLoadPosts(isRefresh=false){
  if(!isLoggedIn()){ init(); return; }

  if(!isRefresh && !_cache.posts.length){
    const cachedFeed=loadSnapshot('feed_'+_mode);
    if(Array.isArray(cachedFeed) && cachedFeed.length){
      _cache.posts=cachedFeed;
      renderListToContainer(_cache.posts, 'postsList', true);
    } else {
      $('postsList').innerHTML=`
        <div class="post-card af-skel" style="height:120px;"></div>
        <div class="post-card af-skel" style="height:100px;"></div>
        <div class="post-card af-skel" style="height:130px;"></div>`;
    }
  }

  const res=await edgeCall({action:'fetch_posts',mode:_mode});
  if(!res||!res.ok){
    if(!_cache.posts.length){
      $('postsList').innerHTML='<div class="state-msg"><span>😕</span><span>Could not load posts.</span></div>';
    }
    return;
  }

  const freshPosts=Array.isArray(res.posts)?res.posts:[];

  if(Array.isArray(res.liked_post_ids)){
    _cache.likedPostIds = new Set(res.liked_post_ids);
    saveLikedPostIds();
  } else if(freshPosts.some(p=>p.is_liked)){
    _cache.likedPostIds = new Set(freshPosts.filter(p=>p.is_liked).map(p=>p.id));
    saveLikedPostIds();
  }

  if(isRefresh && _cache.posts.length > 0){
    _cache.posts = mergeFeedOnRefresh(_cache.posts, freshPosts, _cache.followingKeys);
  } else {
    _cache.posts = rankFeed(freshPosts, _cache.followingKeys);
  }

  _cache.feedLastRefresh = Date.now();
  saveSnapshot('feed_'+_mode, _cache.posts);
  renderListToContainer(_cache.posts, 'postsList', true);
}

async function nxRefreshGlobal(){
  _cache.feedScrollTop = $('feed').scrollTop;
  await nxLoadPosts(true);
  requestAnimationFrame(()=>{ $('feed').scrollTop = _cache.feedScrollTop; });
  if($('profileScreen').style.display==='flex'&&_profileData){
    nxLoadProfileMeta(_profileData.key);
    nxLoadProfilePosts(_profileData.key);
  }
}

function nxSetMode(m){
  _mode=m==='recent'?'recent':'relevant';
  _cache.posts=[];
  $('pillRelevant').classList.toggle('active',_mode==='relevant');
  $('pillRecent').classList.toggle('active',_mode==='recent');
  nxLoadPosts(false);
}

/* ═══════════════════════════════════════════════════
   COMPOSER
═══════════════════════════════════════════════════ */
function nxOpenComposer(){
  if(!isLoggedIn()){ goToLogin(); return; }
  const inp=$('postInput');
  if(inp){ inp.value=''; nxPostTyping(); setTimeout(()=>inp.focus(),10); }
  nxBringToFront('composerModal');
  $('composerModal').style.display='flex';
}
function nxCloseComposer(){
  $('composerModal').style.display='none';
  nxForceRepaint();
}
function nxPostTyping(){
  const v=$('postInput').value,w=wordCount(v),ex=w>80;
  $('postCount').textContent=w+' / 80 words';
  $('postCount').classList.toggle('warn',ex);
  $('postSubmitBtn').disabled=ex||w===0;
  $('postInput').classList.toggle('over',ex);
}
async function nxCreatePost(){
  const inp=$('postInput'),content=inp.value.trim();
  if(!content||wordCount(content)>80) return;
  $('postSubmitBtn').disabled=true;
  const res=await edgeCall({action:'create_post',content});
  if(!res||!res.ok){ showToast(res?.message||'Could not post.','err'); $('postSubmitBtn').disabled=false; return; }
  inp.value=''; nxCloseComposer();
  await nxLoadPosts(true);
  showToast('Posted successfully!');
}

/* ═══════════════════════════════════════════════════
   LIKE (optimistic, prevents double count)
═══════════════════════════════════════════════════ */
async function nxLikePost(pid, btnEl){
  if(!sKey()) return;
  const wasLiked = _cache.likedPostIds.has(pid);
  const cntEl = $('like-cnt-'+pid);
  const iconEl = $('like-icon-'+pid);

  if(wasLiked){
    _cache.likedPostIds.delete(pid);
    const newCount = Math.max(0, (parseInt(cntEl?.textContent,10)||0) - 1);
    if(cntEl) cntEl.textContent = newCount>0 ? newCount : '';
    if(btnEl) btnEl.classList.remove('liked');
    const pIdx = _cache.posts.findIndex(p=>p.id===pid);
    if(pIdx>=0) _cache.posts[pIdx].likes_count = newCount;
  } else {
    _cache.likedPostIds.add(pid);
    const newCount = (parseInt(cntEl?.textContent,10)||0) + 1;
    if(cntEl) cntEl.textContent = newCount;
    if(btnEl) btnEl.classList.add('liked');
    if(iconEl){
      iconEl.classList.remove('pop');
      void iconEl.offsetWidth;
      iconEl.classList.add('pop');
    }
    const pIdx = _cache.posts.findIndex(p=>p.id===pid);
    if(pIdx>=0) _cache.posts[pIdx].likes_count = newCount;
  }

  saveLikedPostIds();
  edgeCall({action:'toggle_post_like',post_id:pid}).catch(()=>{ /* silent fail */ });
}

/* ═══════════════════════════════════════════════════
   COMMENTS (optimistic, prevents double count)
═══════════════════════════════════════════════════ */
function nxOpenComments(pid,preview){
  _curPostId=pid;
  const inp=$('commentInput');
  if(inp){ inp.value=''; nxCommentTyping(); }
  $('commentsPreview').textContent=preview?preview+'…':'Join the discussion';
  nxBringToFront('commentsModal');
  $('commentsModal').style.display='flex';
  nxLoadComments(pid);
}
function nxCloseComments(){
  $('commentsModal').style.display='none';
  _curPostId=null;
  nxForceRepaint();
}
async function nxLoadComments(pid){
  const box=$('commentsList'); if(!box) return;
  box.innerHTML='<div class="state-msg">Loading…</div>';
  const res=await edgeCall({action:'fetch_comments',post_id:pid});
  if(!res||!res.ok){ box.innerHTML='<div class="state-msg"><span>Could not load.</span></div>'; return; }
  renderComments(Array.isArray(res.comments)?res.comments:[]);
}
function renderComments(list){
  const box=$('commentsList'); if(!box) return;
  if(!list||!list.length){ box.innerHTML='<div class="state-msg"><span>💬</span><span>No comments yet.</span></div>'; return; }
  const byP={};
  list.forEach(c=>{ const k=c.parent_comment_id?String(c.parent_comment_id):'root'; if(!byP[k]) byP[k]=[]; byP[k].push(c); });

  const root=byP.root||[];
  root.sort((a,b)=>{
    if(!!b.is_verified!==!!a.is_verified) return b.is_verified?1:-1;
    return 0;
  });

  const mk=sKey();
  box.innerHTML=root.map(c=>{
    const mine=String(c.student_key||'')===String(mk||'');
    const replies=byP[String(c.id)]||[];
    const prev=esc((c.content||'').slice(0,45)).replace(/'/g,'&#39;');
    const isVer=!!c.is_verified;
    const cAvatarUrl=c.avatar_url||'';
    const nameHtml = isVer
      ? `<span class="gold-name">${esc(c.student_name||'Student')}</span>${verBadgeHTML(true)}`
      : esc(c.student_name||'Student');
    return `<div class="cmt-card${isVer?' gold-post-card':''}">
      <div class="cmt-top">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;" onclick="nxOpenProfile('${esc(c.student_key)}','${esc(c.student_name).replace(/'/g,"&#39;")}')">
          ${avatarHTML(c.student_name,c.emoji||'',cAvatarUrl,' avatar-sm','',isVer)}
          <div class="cmt-info"><strong style="display:flex;align-items:center;gap:0;">${nameHtml}</strong><small>${esc(timeAgo(c.created_at))}</small></div>
        </div>
        <button class="menu-dot" style="width:24px;height:24px;font-size:13px;" onclick="nxOpenMenu('comment',${c.id},${mine},false)">⋯</button>
      </div>
      <p class="cmt-text">${esc(c.content||'')}</p>
      <div class="cmt-actions">
        <button class="cmt-btn${c.is_liked?' liked':''}" id="cmt-like-btn-${c.id}" onclick="nxLikeComment(${c.id},this)">
          <span class="heart-ic heart-ic-sm" id="cmt-like-icon-${c.id}"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.8-10.2-9.6C.2 8.4 1.4 4.8 4.8 3.6c2.1-.7 4.3 0 5.6 1.7l1.6 2 1.6-2c1.3-1.7 3.5-2.4 5.6-1.7 3.4 1.2 4.6 4.8 3 7.8C19.5 16.2 12 21 12 21z"/></svg></span>
          <span class="cnt" id="cmt-like-cnt-${c.id}">${c.likes_count>0?c.likes_count:''}</span>
        </button>
        <button class="cmt-btn" onclick="nxOpenReply(${c.id},'${prev}')">Reply</button>
      </div>
      ${replies.length?`
        <button class="view-replies-btn" onclick="nxToggleReplies(${c.id})">▸ ${replies.length} repl${replies.length===1?'y':'ies'}</button>
        <div id="rep-${c.id}" class="replies-wrap hidden">
          ${replies.map(r=>{
            const rm=String(r.student_key||'')===String(mk||'');
            const rp=esc((r.content||'').slice(0,45)).replace(/'/g,'&#39;');
            const rVer=!!r.is_verified;
            const rAvatarUrl=r.avatar_url||'';
            const rNameHtml = rVer
              ? `<span class="gold-name">${esc(r.student_name||'Student')}</span>${verBadgeHTML(true)}`
              : esc(r.student_name||'Student');
            return `<div>
              <div class="cmt-top">
                <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;" onclick="nxOpenProfile('${esc(r.student_key)}','${esc(r.student_name).replace(/'/g,"&#39;")}')">
                  ${avatarHTML(r.student_name,r.emoji||'',rAvatarUrl,' avatar-sm','',rVer)}
                  <div class="cmt-info"><strong style="display:flex;align-items:center;gap:0;">${rNameHtml}</strong><small>${esc(timeAgo(r.created_at))}</small></div>
                </div>
                <button class="menu-dot" style="width:24px;height:24px;font-size:13px;" onclick="nxOpenMenu('comment',${r.id},${rm},false)">⋯</button>
              </div>
              <p class="cmt-text">${esc(r.content||'')}</p>
              <div class="cmt-actions">
                <button class="cmt-btn${r.is_liked?' liked':''}" id="cmt-like-btn-${r.id}" onclick="nxLikeComment(${r.id},this)">
                  <span class="heart-ic heart-ic-sm" id="cmt-like-icon-${r.id}"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.8-10.2-9.6C.2 8.4 1.4 4.8 4.8 3.6c2.1-.7 4.3 0 5.6 1.7l1.6 2 1.6-2c1.3-1.7 3.5-2.4 5.6-1.7 3.4 1.2 4.6 4.8 3 7.8C19.5 16.2 12 21 12 21z"/></svg></span>
                  <span class="cnt" id="cmt-like-cnt-${r.id}">${r.likes_count>0?r.likes_count:''}</span>
                </button>
                <button class="cmt-btn" onclick="nxOpenReply(${r.id},'${rp}')">Reply</button>
              </div>
            </div>`;
          }).join('')}
        </div>`:''
      }
    </div>`;
  }).join('');
}
function nxToggleReplies(cId){
  const b=$('rep-'+cId); if(!b) return;
  b.classList.toggle('hidden');
  const btn=b.previousElementSibling;
  if(btn){ const h=b.classList.contains('hidden'),m=btn.textContent.match(/\d+/),n=m?m[0]:''; btn.textContent=(h?'▸ ':'▾ ')+n+' repl'+(Number(n)===1?'y':'ies'); }
}
function nxCommentTyping(){
  const v=$('commentInput').value,w=wordCount(v),ex=w>80;
  $('commentCount').textContent=w+' / 80 words';
  $('commentSubmitBtn').disabled=ex||w===0;
  $('commentInput').classList.toggle('over',ex);
}
async function nxCreateComment(){
  const inp=$('commentInput'),content=inp.value.trim();
  if(!content||wordCount(content)>80||!_curPostId) return;
  $('commentSubmitBtn').disabled=true;

  const res=await edgeCall({action:'create_comment',post_id:_curPostId,parent_comment_id:null,content});
  if(!res||!res.ok){ showToast(res?.message||'Could not comment.','err'); $('commentSubmitBtn').disabled=false; return; }

  inp.value=''; nxCommentTyping();

  const pIdx = _cache.posts.findIndex(p=>p.id===_curPostId);
  if(pIdx>=0) _cache.posts[pIdx].comments_count = (_cache.posts[pIdx].comments_count||0) + 1;
  const pc = document.querySelector(`.post-card[data-post-id="${_curPostId}"]`);
  if(pc){
    const btns = pc.querySelectorAll('.action-btn');
    if(btns && btns.length > 1){
      const cc = btns[1].querySelector('.cnt');
      if(cc) cc.textContent = parseInt(cc.textContent||0) + 1;
    }
  }

  await nxLoadComments(_curPostId);
}

async function nxLikeComment(cId, btnEl){
  if(!sKey()) return;
  const cntEl = $('cmt-like-cnt-'+cId);
  const iconEl = $('cmt-like-icon-'+cId);
  const wasLiked = btnEl && btnEl.classList.contains('liked');

  if(wasLiked){
    const newCount = Math.max(0, (parseInt(cntEl?.textContent,10)||0) - 1);
    if(cntEl) cntEl.textContent = newCount>0 ? newCount : '';
    if(btnEl) btnEl.classList.remove('liked');
  } else {
    const newCount = (parseInt(cntEl?.textContent,10)||0) + 1;
    if(cntEl) cntEl.textContent = newCount;
    if(btnEl) btnEl.classList.add('liked');
    if(iconEl){
      iconEl.classList.remove('pop');
      void iconEl.offsetWidth;
      iconEl.classList.add('pop');
    }
  }

  edgeCall({action:'toggle_comment_like',comment_id:cId}).catch(()=>{});
}

function nxOpenReply(pid,preview){
  _replyParentId=pid;
  $('replyTarget').textContent=preview?'Replying to: '+preview:'Reply to comment';
  const inp=$('replyInput'); if(inp){ inp.value=''; nxReplyTyping(); setTimeout(()=>inp.focus(),10); }
  nxBringToFront('replyModal');
  $('replyModal').style.display='flex';
}
function nxCloseReply(){
  $('replyModal').style.display='none';
  _replyParentId=null;
  nxForceRepaint();
}
function nxReplyTyping(){
  const v=$('replyInput').value,w=wordCount(v),ex=w>80;
  $('replyCount').textContent=w+' / 80 words';
  $('replySubmitBtn').disabled=ex||w===0;
  $('replyInput').classList.toggle('over',ex);
}
async function nxCreateReply(){
  const inp=$('replyInput'),content=inp.value.trim();
  if(!content||wordCount(content)>80||!_curPostId||!_replyParentId) return;
  $('replySubmitBtn').disabled=true;
  const res=await edgeCall({action:'create_comment',post_id:_curPostId,parent_comment_id:_replyParentId,content});
  if(!res||!res.ok){ showToast(res?.message||'Could not reply.','err'); $('replySubmitBtn').disabled=false; return; }
  nxCloseReply();

  const pIdx = _cache.posts.findIndex(p=>p.id===_curPostId);
  if(pIdx>=0) _cache.posts[pIdx].comments_count = (_cache.posts[pIdx].comments_count||0) + 1;
  const pc = document.querySelector(`.post-card[data-post-id="${_curPostId}"]`);
  if(pc){
    const btns = pc.querySelectorAll('.action-btn');
    if(btns && btns.length > 1){
      const cc = btns[1].querySelector('.cnt');
      if(cc) cc.textContent = parseInt(cc.textContent||0) + 1;
    }
  }

  await nxLoadComments(_curPostId);
}

/* ═══════════════════════════════════════════════════
   MENU / PIN / DELETE / EDIT
═══════════════════════════════════════════════════ */
function nxOpenMenu(type,id,mine,isPinned){
  _menuTarget={type,id,isMine:!!mine,isPinned:!!isPinned};
  $('menuDeleteBtn').style.display=mine?'flex':'none';
  $('menuEditBtn').style.display=(type==='dm'&&mine)?'flex':'none';
  const rBtn=$('menuReportBtn');
  rBtn.style.display=mine?'none':'flex';
  const pinBtn=$('menuPinBtn'), unpinBtn=$('menuUnpinBtn');
  if(type==='post'&&isAdmin()){
    pinBtn.classList.toggle('hidden',!!isPinned);
    unpinBtn.classList.toggle('hidden',!isPinned);
  } else {
    pinBtn.classList.add('hidden'); unpinBtn.classList.add('hidden');
  }
  nxBringToFront('menuModal');
  $('menuModal').style.display='flex';
}
function nxCloseMenu(){
  $('menuModal').style.display='none';
  _menuTarget=null;
  nxForceRepaint();
}

async function nxTogglePin(){
  if(!_menuTarget||_menuTarget.type!=='post'||!isAdmin()){ nxCloseMenu(); return; }
  const pin=!_menuTarget.isPinned;
  const res=await edgeCall({action:'pin_post',post_id:_menuTarget.id,pin});
  if(!res||!res.ok){ showToast(res?.message||'Could not update pin.','err'); nxCloseMenu(); return; }
  nxCloseMenu();
  await nxLoadPosts(true);
  showToast(pin?'Post pinned':'Post unpinned');
}

async function nxDeleteTarget(){
  if(!_menuTarget||!_menuTarget.isMine){ nxCloseMenu(); return; }
  const t=_menuTarget; let res=null;
  if(t.type==='post')    res=await edgeCall({action:'delete_post',post_id:t.id});
  if(t.type==='comment') res=await edgeCall({action:'delete_comment',comment_id:t.id});
  if(t.type==='dm')      res=await edgeCall({action:'delete_dm',message_id:t.id});

  if(!res||!res.ok){ showToast(res?.message||'Could not delete.','err'); return; }
  nxCloseMenu();

  if(t.type==='post'){
    _cache.posts = _cache.posts.filter(p => p.id !== t.id);
    const el = document.querySelector(`.post-card[data-post-id="${t.id}"]`);
    if(el) el.remove();
  }
  if(t.type==='comment'&&_curPostId){
    const pIdx = _cache.posts.findIndex(p=>p.id===_curPostId);
    if(pIdx>=0 && _cache.posts[pIdx].comments_count > 0) _cache.posts[pIdx].comments_count--;
    const pc = document.querySelector(`.post-card[data-post-id="${_curPostId}"]`);
    if(pc){
      const btns = pc.querySelectorAll('.action-btn');
      if(btns && btns.length > 1){
        const cc = btns[1].querySelector('.cnt');
        if(cc) cc.textContent = Math.max(0, parseInt(cc.textContent||0) - 1);
      }
    }
    await nxLoadComments(_curPostId);
  }
  showToast('Deleted successfully.');
}

function nxEditTarget(){
  const t=_menuTarget; nxCloseMenu();
  if(!t||t.type!=='dm') return;
  nxStartEditDM(t.id);
}

/* ═══════════════════════════════════════════════════
   REPORT
═══════════════════════════════════════════════════ */
function nxOpenReportForPost(pid){
  _reportPostId=pid; _reportReason=null;
  document.querySelectorAll('.af-btn-secondary-outline').forEach(b=>b.style.borderColor='var(--bc)');
  hide('reportOtherInp'); $('reportSubmitBtn').disabled=true;
  if($('reportOtherInp')) $('reportOtherInp').value='';
  nxBringToFront('reportModal');
  $('reportModal').style.display='flex';
}
function nxOpenReport(){
  const t=_menuTarget; nxCloseMenu();
  if(t&&!t.isMine) nxOpenReportForPost(t.id);
}
function nxCloseReport(){
  $('reportModal').style.display='none';
  _reportPostId=null;
  _reportReason=null;
  nxForceRepaint();
}
function nxSelectReport(btn){
  document.querySelectorAll('#reportOptions button').forEach(b=>{ b.style.borderColor='var(--bc)'; b.style.background='transparent'; });
  btn.style.borderColor='var(--p)'; btn.style.background='var(--p-soft)';
  _reportReason=btn.getAttribute('data-reason');
  if(_reportReason==='Other'){ show('reportOtherInp'); setTimeout(()=>$('reportOtherInp')&&$('reportOtherInp').focus(),10); }
  else hide('reportOtherInp');
  $('reportSubmitBtn').disabled=!_reportReason;
}
async function nxSubmitReport(){
  if(!_reportPostId||!_reportReason) return;
  const other=($('reportOtherInp').value||'').trim();
  const reason=_reportReason==='Other'?(other||'Other'):_reportReason;
  $('reportSubmitBtn').disabled=true;
  const res=await edgeCall({action:'report_post',post_id:_reportPostId,reason});
  nxCloseReport();
  if(!res||!res.ok){ showToast(res?.message||'Could not submit report.','err'); return; }
  showToast('Report submitted. Thank you.');
}

/* ═══════════════════════════════════════════════════
   BLOCK / UNBLOCK
═══════════════════════════════════════════════════ */
async function nxLoadBlockedUsers(){
  const res = await edgeCall({action:'get_blocked'});
  if(res && res.ok && res.users){
    _cache.blockedKeys = new Set(res.users.map(u => u.student_key));
  }
}

/* ═══════════════════════════════════════════════════
   PROFILE (viewing someone else's profile from the feed)
═══════════════════════════════════════════════════ */
async function nxOpenProfile(key,name){
  if(!key) return;
  _profileData={key,name};
  $('profileHdrName').textContent=name;
  $('profileName').textContent=name;
  $('profileAvatar').className='avatar avatar-lg initials';
  $('profileAvatar').innerHTML=esc(initials(name));
  $('profileTopCard').className='';
  $('profileTopCard').setAttribute('style','padding:24px 20px;background:var(--card-s);border-bottom:1px solid var(--b1);');
  $('profileUsername').textContent='';
  $('profileBio').textContent='';
  $('profileFollowersCount').textContent='0';
  $('profileFollowingCount').textContent='0';
  $('profileFollowBtn').textContent='Follow';
  $('profileFollowBtn').className='af-btn-primary';
  $('profileFollowBtn').style.display=key===sKey()?'none':'flex';
  $('profileMessageBtn').style.display=key===sKey()?'none':'flex';
  $('profilePostsList').innerHTML='<div class="state-msg">Loading…</div>';
  $('profilePageScroll').scrollTop=0;

  const cached = _cache.profiles.get(key);
  if(cached){
    _applyProfileUI(cached, false);
  }

  nxBringToFront('profileScreen');
  $('profileScreen').style.display='flex';
  nxLoadProfileMeta(key);
  nxLoadProfilePosts(key);
}
function nxCloseProfile(){
  $('profileScreen').style.display='none';
  _profileData=null;
  nxForceRepaint();
}

function _applyProfileUI(p, isFull){
  const isVer=!!p.is_verified;
  const avatarEl=$('profileAvatar');
  if(p.avatar_url){
    avatarEl.className='avatar avatar-lg'+(isVer?' gold-avatar-frame':'');
    avatarEl.innerHTML=`<img src="${esc(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:18px;" onerror="this.parentElement.className='avatar avatar-lg initials';this.parentElement.innerHTML='${esc(initials(p.student_name||'BG'))}'"/>`;
  } else if(p.emoji){
    avatarEl.className='avatar avatar-lg'+(isVer?' gold-avatar-frame':'');
    avatarEl.innerHTML=p.emoji;
  }
  if(isVer){
    $('profileName').innerHTML=`<span class="gold-name">${esc(p.student_name)}</span> ${verBadgeHTML(true)}`;
    $('profileTopCard').setAttribute('style','padding:24px 20px;background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(251,191,36,.06));border-bottom:1px solid rgba(245,158,11,.3);position:relative;overflow:hidden;');
    const existingBar = $('profileTopCard').querySelector('.gold-topbar');
    if(!existingBar){
      const bar=document.createElement('div');
      bar.className='gold-topbar';
      bar.style.cssText='position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#f59e0b,#fbbf24,#d97706);';
      $('profileTopCard').prepend(bar);
    }
  } else {
    $('profileName').innerHTML=esc(p.student_name||'Student');
    $('profileTopCard').setAttribute('style','padding:24px 20px;background:var(--card-s);border-bottom:1px solid var(--b1);');
  }
  if(p.username) $('profileUsername').textContent='@'+p.username;
  if(p.bio) $('profileBio').textContent=p.bio;
}

async function nxLoadProfileMeta(key){
  const res=await edgeCall({action:'get_profile',target_key:key});
  if(!res||!res.ok) return;
  if(res.profile){
    _cache.profiles.set(key, res.profile);
    _applyProfileUI(res.profile, true);
  }
  $('profileFollowersCount').textContent=res.followers_count||0;
  $('profileFollowingCount').textContent=res.following_count||0;
  _profileIsFollowing=!!res.is_following;
  if(key!==sKey()){
    $('profileFollowBtn').textContent=_profileIsFollowing?'Following':'Follow';
    $('profileFollowBtn').className=_profileIsFollowing?'af-btn-secondary-outline':'af-btn-primary';
  }
}
async function nxToggleFollow(){
  if(!_profileData) return;
  const res=await edgeCall({action:'toggle_follow',target_key:_profileData.key});
  if(!res||!res.ok){ showToast(res?.message||'Could not update follow.','err'); return; }
  _profileIsFollowing=!!res.following;
  $('profileFollowBtn').textContent=_profileIsFollowing?'Following':'Follow';
  $('profileFollowBtn').className=_profileIsFollowing?'af-btn-secondary-outline':'af-btn-primary';
  const c=$('profileFollowersCount');
  c.textContent=Math.max(0,Number(c.textContent||0)+(_profileIsFollowing?1:-1));
  if(_profileIsFollowing) _cache.followingKeys.add(String(_profileData.key));
  else _cache.followingKeys.delete(String(_profileData.key));
}
async function nxLoadProfilePosts(key){
  const res=await edgeCall({action:'student_posts',target_key:key});
  const box=$('profilePostsList'); if(!box) return;
  if(!res||!res.ok){ box.innerHTML='<div class="state-msg"><span>Could not load.</span></div>'; return; }
  renderListToContainer(res.posts,'profilePostsList',false);
}

function nxMessageFromProfile(){
  if(!_profileData||_profileData.key===sKey()) return;
  nxOpenDM(_profileData.key, _profileData.name);
}

/* ═══════════════════════════════════════════════════
   FOLLOW LIST (viewed from someone else's profile here)
═══════════════════════════════════════════════════ */
async function nxOpenFollowersFor(){ if(_profileData) await loadFollowList('followers',_profileData.key); }
async function nxOpenFollowingFor(){ if(_profileData) await loadFollowList('following',_profileData.key); }

function _renderFollowListBox(list){
  const box=$('followListBody');
  if(!list.length){ box.innerHTML='<div class="state-msg"><span>No users here yet.</span></div>'; return; }
  box.innerHTML=list.map(u=>{
    const key=u.student_key||u.key||u.follower_key||u.following_key||'';
    const name=u.student_name||u.name||'Student';
    const username=u.username||'';
    const emoji=u.emoji||'';
    const avatarUrl=u.avatar_url||'';
    const isVer=!!u.is_verified;
    const nameHtml = isVer
      ? `<span class="gold-name">${esc(name)}</span>${verBadgeHTML(true)}`
      : esc(name);
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;cursor:pointer;border-bottom:1px solid var(--b1);" onclick="nxCloseFollowList();nxOpenProfile('${esc(key)}','${esc(name).replace(/'/g,"&#39;")}')">
      ${avatarHTML(name,emoji,avatarUrl,' avatar-sm','',isVer)}
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--fd);font-size:14px;font-weight:800;color:var(--t1);display:flex;align-items:center;gap:0;">
          ${nameHtml}
        </div>
        ${username?`<div style="font-size:12px;color:var(--tm);font-weight:600;margin-top:2px;">@${esc(username)}</div>`:'<div style="font-size:12px;color:var(--tm);margin-top:2px;">No username set</div>'}
      </div>
    </div>`;
  }).join('');
}

async function loadFollowList(type,targetKey){
  $('followListTitle').textContent=type==='followers'?'Followers':'Following';
  nxBringToFront('followListModal');
  $('followListModal').style.display='flex';

  const isOwnList = targetKey===sKey();
  const cachedList = isOwnList ? (type==='followers'?_cache.myFollowers:_cache.myFollowing) : null;
  if(Array.isArray(cachedList) && cachedList.length){
    _renderFollowListBox(cachedList);
  } else {
    $('followListBody').innerHTML='<div class="state-msg">Loading…</div>';
  }

  const action=type==='followers'?'get_followers':'get_following';
  const res=await edgeCall({action,target_key:targetKey});
  if($('followListModal').style.display!=='flex' || $('followListTitle').textContent!==(type==='followers'?'Followers':'Following')) return;
  const list=res&&res.ok&&Array.isArray(res.users)?res.users:null;
  if(list===null){
    if(!cachedList || !cachedList.length){
      $('followListBody').innerHTML='<div class="state-msg"><span>No users here yet.</span></div>';
    }
    return;
  }
  if(isOwnList){
    if(type==='followers') _cache.myFollowers=list;
    else {
      _cache.myFollowing=list;
      _cache.followingKeys=new Set(list.map(u=>String(u.student_key||'')));
    }
    saveSnapshot(type==='followers'?'followers_me':'following_me', list);
  }
  _renderFollowListBox(list);
}
function nxCloseFollowList(){
  $('followListModal').style.display='none';
  nxForceRepaint();
}

/* ═══════════════════════════════════════════════════
   EDIT PROFILE (shortcut from username banner)
═══════════════════════════════════════════════════ */
function nxHandleAvatarUpload(input){
  const file=input.files&&input.files[0];
  if(!file) return;
  if(file.size>2*1024*1024){ showToast('Please reduce the image size to less than 2 MB and try again.','err'); return; }
  const reader=new FileReader();
  reader.onload=e=>{
    _pendingAvatarDataUrl=e.target.result;
    nxRenderEditAvatarPreview();
    $('removeAvatarBtn').style.display='block';
  };
  reader.readAsDataURL(file);
}
function nxRemoveAvatar(){
  _pendingAvatarDataUrl=null;
  localStorage.removeItem('af_avatar_url');
  $('removeAvatarBtn').style.display='none';
  nxRenderEditAvatarPreview();
}
function nxRenderEditAvatarPreview(){
  const el=$('editProfileAvatarPreview');
  if(!el) return;
  const avatarUrl=_pendingAvatarDataUrl||getMyAvatarUrl();
  const name=sName();
  if(avatarUrl){
    el.className='avatar avatar-lg';
    el.innerHTML=`<img src="${esc(avatarUrl)}" style="width:64px;height:64px;object-fit:cover;border-radius:16px;" onerror="this.parentElement.innerHTML='${esc(initials(name))}'"/>`;
  } else {
    el.className='avatar avatar-lg initials';
    el.textContent=initials(name);
  }
}

function nxOpenEditProfile(){
  _pendingAvatarDataUrl=null;
  nxRenderEditAvatarPreview();
  $('displayNameInput').value=sName();
  $('displayNameHint').textContent='2-40 characters. This is shown on your posts, comments and messages.';
  $('displayNameHint').style.color='var(--tm)';
  $('usernameInput').value=getMyUsername();
  $('bioInput').value=localStorage.getItem('af_bio')||'';
  $('usernameHint').textContent='3-24 chars: lowercase letters, numbers, underscore.';
  $('usernameHint').style.color='var(--tm)';
  const existingUrl=getMyAvatarUrl();
  $('removeAvatarBtn').style.display=existingUrl?'block':'none';
  nxBringToFront('editProfileModal');
  $('editProfileModal').style.display='flex';
}
function nxCloseEditProfile(){
  $('editProfileModal').style.display='none';
  nxForceRepaint();
}
function nxDisplayNameTyping(){
  const hint=$('displayNameHint');
  const v=($('displayNameInput').value||'').trim();
  if(!v){ hint.textContent='Display name cannot be empty.'; hint.style.color='var(--err)'; return; }
  if(v.length<2){ hint.textContent='Too short.'; hint.style.color='var(--err)'; return; }
  if(v.length>40){ hint.textContent='Too long.'; hint.style.color='var(--err)'; return; }
  hint.textContent='2-40 characters. This is shown on your posts, comments and messages.';
  hint.style.color='var(--tm)';
}

let _usernameCheckTimer=null;
function nxUsernameTyping(){
  const v=($('usernameInput').value||'').toLowerCase().replace(/[^a-z0-9_]/g,'');
  $('usernameInput').value=v;
  clearTimeout(_usernameCheckTimer);
  const hint=$('usernameHint');
  if(!v){ hint.textContent='3-24 chars: lowercase letters, numbers, underscore.'; hint.style.color='var(--tm)'; return; }
  if(v.length<3){ hint.textContent='Too short.'; hint.style.color='var(--err)'; return; }
  _usernameCheckTimer=setTimeout(async()=>{
    const res=await edgeCall({action:'check_username',username:v});
    if(res&&res.ok){
      hint.textContent=res.available?'Available ✓':'Already taken.';
      hint.style.color=res.available?'var(--ok)':'var(--err)';
    }
  },350);
}

async function nxSaveProfile(){
  const displayName=($('displayNameInput').value||'').trim();
  const username=($('usernameInput').value||'').toLowerCase().trim();
  const bio=($('bioInput').value||'').trim();
  if(!displayName||displayName.length<2||displayName.length>40){ showToast('Display name must be 2-40 characters.','err'); return; }
  if(username&&!/^[a-z0-9_]{3,24}$/.test(username)){ showToast('Username must be 3-24 chars.','err'); return; }
  $('saveProfileBtn').disabled=true;
  let finalAvatarUrl = getMyAvatarUrl();
  if(_pendingAvatarDataUrl){
    const uploadRes = await edgeCall({action:'upload_avatar',avatar_data_url:_pendingAvatarDataUrl});
    if(uploadRes&&uploadRes.ok&&uploadRes.avatar_url){
      finalAvatarUrl=uploadRes.avatar_url;
    } else {
      finalAvatarUrl=_pendingAvatarDataUrl;
    }
  } else if(!_pendingAvatarDataUrl && !getMyAvatarUrl() && $('removeAvatarBtn').style.display==='none'){
    finalAvatarUrl='';
  }
  const res=await edgeCall({
    action:'save_username',
    name:displayName,
    username:username||getMyUsername()||('student'+Math.floor(Math.random()*99999)),
    bio,
    avatar_url:finalAvatarUrl
  });
  $('saveProfileBtn').disabled=false;
  if(!res||!res.ok){ showToast(res?.message||'Could not save profile.','err'); return; }
  const nameChanged = displayName !== sName();
  if(finalAvatarUrl) localStorage.setItem('af_avatar_url',finalAvatarUrl);
  else localStorage.removeItem('af_avatar_url');
  localStorage.setItem('af_student_name', displayName);
  if(res.profile&&res.profile.username) localStorage.setItem('af_username',res.profile.username);
  else if(username) localStorage.setItem('af_username',username);
  localStorage.setItem('af_bio',bio);
  _pendingAvatarDataUrl=null;
  syncAvatarBtn();
  nxCloseEditProfile();
  $('usernameBanner').classList.add('hidden');
  showToast(nameChanged?'Profile updated! Your new name is now live.':'Profile updated!');
  _cache.profiles.delete(sKey());
  await Promise.all([
    nxLoadPosts(true),
    nxPreloadConnections()
  ]);
}

/* ═══════════════════════════════════════════════════
   DM SCREEN (reachable via "Message" on a viewed profile)
═══════════════════════════════════════════════════ */
async function nxOpenDM(peerKey,peerName){
  if(peerKey===sKey()) return;
  _dmPeer={key:peerKey,name:peerName};
  _dmEditingId=null; hide('dmEditBanner');
  $('dmPeerName').textContent=peerName;
  $('dmInput').value='';
  nxRemoveDMImage();
  nxDMTyping();
  nxBringToFront('dmScreen');
  $('dmScreen').style.display='flex';

  const goldBadgeEl=$('dmPeerGoldBadge');
  if(goldBadgeEl) goldBadgeEl.style.display='none';

  const cachedChat=_cache.chatList.find(c=>c.peer.student_key===peerKey);
  if(cachedChat && cachedChat.messages && cachedChat.messages.length){
    nxRenderDMMessages(cachedChat.messages);
  } else {
    $('dmMessages').innerHTML='<div class="state-msg">Loading…</div>';
  }

  const cachedProf = _cache.profiles.get(peerKey);
  if(cachedProf) _applyDMHeaderProfile(cachedProf);

  const [res, profRes] = await Promise.all([
    edgeCall({action:'fetch_dms',peer_key:peerKey}),
    edgeCall({action:'get_profile',target_key:peerKey}),
  ]);
  const msgs=res&&res.ok&&res.messages?res.messages:[];

  const amIBlocked = !!(res && res.am_i_blocked);
  const iBlockedThem = _cache.blockedKeys.has(peerKey);

  if (iBlockedThem) {
    show('dmBlockedBanner');
    $('dmBlockedBanner').textContent = 'You have blocked this user.';
    $('dmInput').disabled = true;
    $('dmSendBtn').disabled = true;
    $('dmImageInput').disabled = true;
  } else if (amIBlocked) {
    show('dmBlockedBanner');
    $('dmBlockedBanner').textContent = 'You cannot send messages to this user.';
    $('dmInput').disabled = true;
    $('dmSendBtn').disabled = true;
    $('dmImageInput').disabled = true;
  } else {
    hide('dmBlockedBanner');
    $('dmInput').disabled = false;
    $('dmImageInput').disabled = false;
  }

  if(profRes&&profRes.ok&&profRes.profile){
    const p=profRes.profile;
    _cache.profiles.set(peerKey, p);
    _applyDMHeaderProfile(p);
  }

  if(_dmPeer && _dmPeer.key===peerKey && res && res.ok){
    nxRenderDMMessages(msgs);
  }
  markChatRead(peerKey);
}

function _applyDMHeaderProfile(p){
  const isVer=!!p.is_verified;
  const av=$('dmPeerAvatar');
  if(p.avatar_url){
    av.className='avatar avatar-sm'+(isVer?' gold-avatar-frame':'');
    av.innerHTML=`<img src="${esc(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:9px;" loading="lazy"/>`;
  } else {
    av.className='avatar avatar-sm'+(p.emoji?'':' initials')+(isVer?' gold-avatar-frame':'');
    av.textContent=p.emoji||initials(p.student_name);
  }

  const goldBadgeEl=$('dmPeerGoldBadge');
  if(goldBadgeEl) goldBadgeEl.style.display=isVer?'inline-flex':'none';

  let roleStr='Community Member';
  if(isVer) roleStr='Premium Verified Member';
  else if(p.username) roleStr='@'+p.username;
  $('dmHdrStatus').textContent=roleStr;
  $('dmHdrStatus').style.color=isVer?'var(--gold)':'var(--tm)';
  $('dmHdr').className='dm-hdr '+(isVer?'gold-chat-hdr':'');
  if(_dmPeer) _dmPeer.isVerified=isVer;
}

function nxOpenProfileFromDM(){
  if(!_dmPeer) return;
  nxOpenProfile(_dmPeer.key,_dmPeer.name);
}
function nxCloseDM(){
  $('dmScreen').style.display='none';
  _dmPeer=null; _dmEditingId=null;
  nxRemoveDMImage();
  nxForceRepaint();
}

function nxOpenDMOptions(){
  if(!_dmPeer) return;
  const isBlocked = _cache.blockedKeys.has(_dmPeer.key);
  $('dmBlockBtn').style.display = isBlocked ? 'none' : 'flex';
  $('dmUnblockBtn').style.display = isBlocked ? 'flex' : 'none';
  nxBringToFront('dmOptionsModal');
  $('dmOptionsModal').style.display='flex';
}
function nxCloseDMOptions(){
  $('dmOptionsModal').style.display='none';
  nxForceRepaint();
}
function nxOpenClearChatConfirm(){
  if(!_dmPeer) return;
  nxCloseDMOptions();
  $('clearChatPeerName').textContent=_dmPeer.name||'this user';
  $('clearChatConfirmBtn').disabled=false;
  $('clearChatConfirmBtn').textContent='Clear for me';
  nxBringToFront('clearChatModal');
  $('clearChatModal').style.display='flex';
}
function nxCloseClearChatConfirm(){
  $('clearChatModal').style.display='none';
  nxForceRepaint();
}

async function nxConfirmClearChat(){
  if(!_dmPeer) return;
  const peerKey=_dmPeer.key;
  $('clearChatConfirmBtn').disabled=true;
  $('clearChatConfirmBtn').textContent='Clearing…';
  const res=await edgeCall({action:'clear_chat_history',peer_key:peerKey});
  if(!res||!res.ok){
    $('clearChatConfirmBtn').disabled=false;
    $('clearChatConfirmBtn').textContent='Clear for me';
    showToast(res?.message||'Could not clear chat history. The server may not support this yet.','err');
    return;
  }
  const chatIdx=_cache.chatList.findIndex(c=>c.peer.student_key===peerKey);
  if(chatIdx>=0) _cache.chatList.splice(chatIdx,1);
  _cache.chatReadTs.delete(peerKey);
  saveChatReadTs();
  nxCloseClearChatConfirm();
  nxCloseDM();
  showToast('Chat history cleared.');
}

function nxRenderDMMessages(msgs){
  const box=$('dmMessages'); if(!box) return;
  if(!_dmPeer) return;
  if(!msgs||!msgs.length){
    box.innerHTML='<div class="state-msg"><span>💬</span><span>Say hello!</span></div>';
    return;
  }
  const chatObj=_cache.chatList.find(c=>c.peer.student_key===_dmPeer.key);
  const cachedP = _cache.profiles.get(_dmPeer.key);
  const peerVer=chatObj?!!chatObj.peer.is_verified:(cachedP?!!cachedP.is_verified:false);
  const peerEmoji=chatObj?chatObj.peer.emoji:'';
  const peerAvatarUrl=chatObj?chatObj.peer.avatar_url||'':'';

  box.innerHTML=msgs.map((m,i)=>{
    const me = (m.sender === sKey());
    const deleted=!!m.is_deleted;
    const isConsecutive=(i>0&&msgs[i-1].sender===m.sender&&!msgs[i-1].is_deleted);
    const clickAction=(me&&!deleted&&m.id)?` onclick="nxOpenMenu('dm',${m.id},true,false)"`:'';
    const bubbleExtraClass=(!me&&peerVer)?' gold-bubble':'';

    const isValidImg = m.image_url && m.image_url !== 'null' && m.image_url !== 'undefined';
    const imgHtml = (!deleted && isValidImg)
      ? `<img src="${esc(m.image_url)}" onclick="nxOpenLightbox(this.src)" style="max-width:220px; border-radius:${m.text?'10px 10px 4px 4px':'10px'}; margin-bottom:${m.text?'6px':'0'}; display:block; max-height:220px; object-fit:cover; cursor:zoom-in;"/>`
      : '';

    const textHtml = deleted ? 'Message deleted' : esc(m.text || '');

    return `<div class="bubble-wrap${me?' me':''}${isConsecutive?' consecutive':''}"${clickAction}>
      ${!me?(isConsecutive?'<div class="bubble-avatar-slot"></div>':avatarHTML(_dmPeer.name,peerEmoji,peerAvatarUrl,' bubble-avatar-slot',`nxOpenProfile('${esc(_dmPeer.key)}','${esc(_dmPeer.name).replace(/'/g,"&#39;")}')`,peerVer)):''}
      <div style="display:flex;flex-direction:column;align-items:${me?'flex-end':'flex-start'};max-width:72%;min-width:0;">
        <div class="bubble${deleted?' deleted':''}${bubbleExtraClass}" style="${(!deleted && !m.text && isValidImg) ? 'padding:4px;' : ''}">${imgHtml}${textHtml}</div>
        <div class="bubble-time">${esc(timeAgo(m.ts))}</div>
      </div>
    </div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
}

function nxHandleDMImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2*1024*1024) { showToast('Please reduce the image size to less than 2 MB and try again.','err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    _dmPendingImage = e.target.result;
    $('dmImagePreview').src = _dmPendingImage;
    show('dmImagePreviewWrap');
    nxDMTyping();
  };
  reader.readAsDataURL(file);
}

function nxRemoveDMImage() {
  _dmPendingImage = null;
  const input = $('dmImageInput');
  if(input) input.value = '';
  hide('dmImagePreviewWrap');
  nxDMTyping();
}

function nxDMTyping(){
  const v=($('dmInput').value||'').trim();
  $('dmSendBtn').disabled = !(v || _dmPendingImage);
}

async function nxSendDM(){
  const inp=$('dmInput'),text=inp.value.trim();
  if(!text && !_dmPendingImage) return;

  if(_dmPendingImage && !_dmEditingId && !text){
    showToast('Please add a message to send with your photo.','err');
    return;
  }

  if(_dmEditingId){
    if(_dmPendingImage) {
      showToast('Cannot add image to edited message.', 'err');
      return;
    }
    $('dmSendBtn').disabled=true;
    const res=await edgeCall({action:'edit_dm',message_id:_dmEditingId,text});
    if(!res||!res.ok){ showToast(res?.message||'Could not edit.','err'); $('dmSendBtn').disabled=false; return; }
    nxCancelEditDM();
    inp.value=''; nxDMTyping();
    const chatObjEdit=_cache.chatList.find(c=>c.peer.student_key===_dmPeer.key);
    if(chatObjEdit){
      const m=chatObjEdit.messages.find(x=>String(x.id)===String(_dmEditingId));
      if(m) m.text=text;
      nxRenderDMMessages(chatObjEdit.messages);
    }
    return;
  }

  $('dmSendBtn').disabled=true;
  inp.value='';
  const imgData = _dmPendingImage;
  nxRemoveDMImage();

  const payload = {action:'send_dm', to_key:_dmPeer.key, to_name:_dmPeer.name, text};
  if(imgData) payload.image_data_url = imgData;

  const res=await edgeCall(payload);
  if(res&&res.ok&&res.message){
    nxDMTyping();
    nxAppendSentMessage(_dmPeer.key, res.message);
  } else {
    $('dmSendBtn').disabled=false;
    inp.value = text;
    if(imgData) {
       _dmPendingImage = imgData;
       $('dmImagePreview').src = _dmPendingImage;
       show('dmImagePreviewWrap');
    }
    showToast(res?.message||'Could not send DM','err');
  }
}

function nxAppendSentMessage(peerKey, message){
  let chatObj=_cache.chatList.find(c=>c.peer.student_key===peerKey);
  if(!chatObj){
    const peerProfile=_cache.profiles.get(peerKey)||{student_key:peerKey,student_name:_dmPeer?_dmPeer.name:'Student'};
    chatObj={peer:peerProfile,messages:[],latest:null};
    _cache.chatList.unshift(chatObj);
  }

  const formattedMsg = {
    id: message.id,
    sender: message.sender_key || message.sender,
    receiver: message.receiver_key || message.receiver,
    text: message.is_deleted ? "" : (message.text || ""),
    image_url: message.image_url || null,
    ts: message.created_at || message.ts || new Date().toISOString(),
    is_edited: !!message.is_edited,
    is_deleted: !!message.is_deleted
  };

  const alreadyPresent = formattedMsg.id!=null && chatObj.messages.some(m=>String(m.id)===String(formattedMsg.id));
  if(!alreadyPresent){
    chatObj.messages.push(formattedMsg);
    chatObj.latest=formattedMsg;
    _cache.chatList.sort((a,b)=>new Date(b.latest?.ts||0)-new Date(a.latest?.ts||0));
  }

  if($('dmScreen').style.display==='flex' && _dmPeer && _dmPeer.key===peerKey){
    nxRenderDMMessages(chatObj.messages);
  }
}

function nxStartEditDM(msgId){
  const chatObj=_cache.chatList.find(c=>c.peer.student_key===_dmPeer.key);
  if(!chatObj) return;
  const m=chatObj.messages.find(x=>String(x.id)===String(msgId));
  if(!m) return;
  _dmEditingId=msgId;
  $('dmInput').value=m.text;
  nxRemoveDMImage();
  nxDMTyping();
  show('dmEditBanner');
  $('dmInput').focus();
}

function nxCancelEditDM(){
  _dmEditingId=null; hide('dmEditBanner'); $('dmInput').value=''; nxDMTyping();
}

async function nxBlockCurrentPeer(){
  if(!_dmPeer) return;
  const key = _dmPeer.key;
  nxCloseDMOptions();
  const res = await edgeCall({action:'block_user', target_key:key});
  if(res && res.ok){
    _cache.blockedKeys.add(key);
    showToast('User blocked.');
    if($('dmScreen').style.display==='flex' && _dmPeer.key === key){
      show('dmBlockedBanner');
      $('dmBlockedBanner').textContent = 'You have blocked this user.';
      $('dmInput').disabled = true;
      $('dmSendBtn').disabled = true;
    }
  } else {
    showToast(res?.message||'Could not block user.','err');
  }
}

async function nxUnblockCurrentPeer(){
  if(!_dmPeer) return;
  const key = _dmPeer.key;
  nxCloseDMOptions();
  const res = await edgeCall({action:'unblock_user', target_key:key});
  if(res && res.ok){
    _cache.blockedKeys.delete(key);
    showToast('User unblocked.');
    if($('dmScreen').style.display==='flex' && _dmPeer.key === key){
      hide('dmBlockedBanner');
      $('dmInput').disabled = false;
      nxDMTyping();
    }
  } else {
    showToast(res?.message||'Could not unblock user.','err');
  }
}

/* ═══════════════════════════════════════════════════
   KEYBOARD / ESC
═══════════════════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if($('followListModal').style.display==='flex'){ nxCloseFollowList(); return; }
  if($('editProfileModal').style.display==='flex'){ nxCloseEditProfile(); return; }
  if($('reportModal').style.display==='flex'){ nxCloseReport(); return; }
  if($('menuModal').style.display==='flex'){ nxCloseMenu(); return; }
  if($('clearChatModal').style.display==='flex'){ nxCloseClearChatConfirm(); return; }
  if($('dmOptionsModal').style.display==='flex'){ nxCloseDMOptions(); return; }
  if($('replyModal').style.display==='flex'){ nxCloseReply(); return; }
  if($('commentsModal').style.display==='flex'){ nxCloseComments(); return; }
  if($('composerModal').style.display==='flex'){ nxCloseComposer(); return; }
  if($('profileScreen').style.display==='flex'){ nxCloseProfile(); return; }
  if($('dmScreen').style.display==='flex'){ nxCloseDM(); return; }
});

/* ═══════════════════════════════════════════════════
   PULL TO REFRESH
═══════════════════════════════════════════════════ */
(function(){
  const shell=document.getElementById('shell')||document.body;
  let pulling=false,pullStartY=0;
  function getScrollTop(){
    if($('profileScreen').style.display==='flex') return $('profilePageScroll').scrollTop;
    return $('feed') ? $('feed').scrollTop : 0;
  }
  shell.addEventListener('touchstart',e=>{
    if(getScrollTop()>0) return;
    pullStartY=e.touches[0].clientY; pulling=true;
  },{passive:true});
  shell.addEventListener('touchend',async e=>{
    if(!pulling) return;
    const distance=e.changedTouches[0].clientY-pullStartY;
    if(distance>90){
      $('pullIndicator').style.display='block';
      await nxRefreshGlobal();
      $('pullIndicator').style.display='none';
    }
    pulling=false;
  });
})();

/* ═══════════════════════════════════════════════════
   EXPOSE GLOBALS (for inline onclick handlers)
═══════════════════════════════════════════════════ */
window.nxOpenProfile=nxOpenProfile;
window.nxCloseProfile=nxCloseProfile;
window.nxOpenComments=nxOpenComments;
window.nxCloseComments=nxCloseComments;
window.nxLikePost=nxLikePost;
window.nxLikeComment=nxLikeComment;
window.nxOpenDM=nxOpenDM;
window.nxCloseDM=nxCloseDM;
window.nxMessageFromProfile=nxMessageFromProfile;
window.nxOpenEditProfile=nxOpenEditProfile;
window.nxCloseEditProfile=nxCloseEditProfile;
window.nxOpenComposer=nxOpenComposer;
window.nxCloseComposer=nxCloseComposer;
window.nxCreatePost=nxCreatePost;
window.nxCreateComment=nxCreateComment;
window.nxCreateReply=nxCreateReply;
window.nxOpenReply=nxOpenReply;
window.nxCloseReply=nxCloseReply;
window.nxOpenMenu=nxOpenMenu;
window.nxCloseMenu=nxCloseMenu;
window.nxTogglePin=nxTogglePin;
window.nxDeleteTarget=nxDeleteTarget;
window.nxEditTarget=nxEditTarget;
window.nxOpenReport=nxOpenReport;
window.nxCloseReport=nxCloseReport;
window.nxSelectReport=nxSelectReport;
window.nxSubmitReport=nxSubmitReport;
window.nxToggleFollow=nxToggleFollow;
window.nxOpenFollowersFor=nxOpenFollowersFor;
window.nxOpenFollowingFor=nxOpenFollowingFor;
window.nxCloseFollowList=nxCloseFollowList;
window.nxSendDM=nxSendDM;
window.nxDMTyping=nxDMTyping;
window.nxHandleDMImage=nxHandleDMImage;
window.nxRemoveDMImage=nxRemoveDMImage;
window.nxCancelEditDM=nxCancelEditDM;
window.nxSaveProfile=nxSaveProfile;
window.nxDisplayNameTyping=nxDisplayNameTyping;
window.nxUsernameTyping=nxUsernameTyping;
window.nxCommentTyping=nxCommentTyping;
window.nxPostTyping=nxPostTyping;
window.nxReplyTyping=nxReplyTyping;
window.nxToggleReplies=nxToggleReplies;
window.nxHandleAvatarUpload=nxHandleAvatarUpload;
window.nxRemoveAvatar=nxRemoveAvatar;
window.nxOpenProfileFromDM=nxOpenProfileFromDM;
window.nxOpenDMOptions=nxOpenDMOptions;
window.nxCloseDMOptions=nxCloseDMOptions;
window.nxOpenClearChatConfirm=nxOpenClearChatConfirm;
window.nxCloseClearChatConfirm=nxCloseClearChatConfirm;
window.nxConfirmClearChat=nxConfirmClearChat;
window.nxBlockCurrentPeer=nxBlockCurrentPeer;
window.nxUnblockCurrentPeer=nxUnblockCurrentPeer;
window.nxSetMode=nxSetMode;

document.addEventListener('DOMContentLoaded',init);

'use strict';
/* ============================================================
   COSTANTI
============================================================ */
const COLORS=['#FF6B6B','#4ECDC4','#FFE66D','#A29BFE','#6BCB77','#FF9F43','#FD79A8','#74B9FF'];
const BADGES_DEF=[{e:'⭐',n:'Stella'},{e:'🎯',n:'Obiettivo'},{e:'🎓',n:'Scholar'},{e:'🔥',n:'Streak'},{e:'💎',n:'Gemma'},{e:'🏆',n:'Campione'},{e:'👑',n:'Re'},{e:'🚀',n:'Rocket'}];
const LEVELS=['A1','A2','B1','B2','C1','C2'];
const XP_LEVELS=[0,200,500,1000,2000,4000,99999];

/* ── Platform Detection ── */
const IS_NATIVE_APK = /GiadaCourses-Android/i.test(navigator.userAgent) || !!window.Capacitor;
const IS_PWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_APP = IS_NATIVE_APK || IS_PWA; // Either native or PWA = "app mode"

function pickColor(str){let h=0;for(const c of(str||'?'))h=(h<<5)-h+c.charCodeAt(0);return COLORS[Math.abs(h)%COLORS.length];}
function initials(name){return(name||'?').split(/[\s_]+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';}
function timeAgo(ts){const d=Date.now()-ts;if(d<60e3)return 'adesso';if(d<3600e3)return Math.floor(d/60e3)+'m fa';if(d<86400e3)return Math.floor(d/3600e3)+'h fa';return Math.floor(d/86400e3)+'g fa';}
function fmtDate(ts){return new Date(ts).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'});}

/* ============================================================
   API HELPER
============================================================ */
async function apicall(method,path,body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  const tok=localStorage.getItem('gc_token');
  if(tok)opts.headers['Authorization']='Bearer '+tok;
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(path,opts);
  const ct=res.headers.get('content-type')||'';
  const data=ct.includes('application/json')?await res.json().catch(()=>({})):{};
  if(!res.ok)throw new Error(data.error||'Errore HTTP '+res.status);
  return data;
}
const GET=(p)=>apicall('GET',p);
const POST=(p,b)=>apicall('POST',p,b);
const PUT=(p,b)=>apicall('PUT',p,b);
const DEL=(p)=>apicall('DELETE',p);

function togglePwdEye(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

/* ============================================================
   STATE
============================================================ */
let ME=null;        // utente loggato
let currentPage='home';
let currentLevel='Tutti';
let currentExercise=null;
let quizState={qi:0,score:0,answered:false,sharing:true};
let adminTab='exercises';
let editingEx=null;
let qBlocks=[];     // domande in costruzione
let ioSocket=null;  // Socket.IO connection

/* ============================================================
   TOAST
============================================================ */
function toast(msg,type='success',dur=2800){
  const t=document.createElement('div');
  t.className='toast '+type;t.textContent=msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),400);},dur);
}

/* ============================================================
   NAVIGAZIONE
============================================================ */
function showPage(p){
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(el=>el.classList.remove('active'));
  const pg=document.getElementById('page-'+p);
  if(!pg)return;
  pg.classList.add('active');
  pg.scrollTop=0;
  window.scrollTo(0,0);
  currentPage=p;
  const bn=document.querySelector(`.bnav-item[data-p="${p}"]`);
  if(bn){bn.classList.add('active');bn.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});}
  const R={home:renderHome,exercises:renderExercises,games:renderGames,social:renderSocial,news:renderNews,profile:renderProfile,leaderboard:renderLeaderboard,admin:renderAdmin,superadmin:renderSuperadmin,support:renderSupport};
  if(R[p]){
    const maybePromise=R[p]();
    if(maybePromise&&maybePromise.catch) maybePromise.catch(err=>console.warn('[showPage]',p,err.message));
  }
  // Mission tracking per visite pagina
  if(ME){
    if(p==='exercises') checkDailyMission('explore');
    if(p==='leaderboard') checkDailyMission('leaderboard');
    if(p==='support') checkDailyMission('support');
    if(p==='games') checkDailyMission('games');
  }
}

function renderNavUser(){
  const btn=document.getElementById('nav-user-btn');
  const sc=document.getElementById('streak-chip');
  const sn=document.getElementById('streak-n');
  const dmBtn=document.getElementById('dm-nav-btn');
  if(!ME){
    btn.className='nav-btn';
    btn.innerHTML='🚀 Accedi';
    btn.onclick=openAuth;
    sc.classList.add('hidden');
    if(dmBtn)dmBtn.style.display='none';
    const supportBtn=document.getElementById('support-nav-btn');
    if(supportBtn)supportBtn.style.display='none';
    removeExtraBtns();
    return;
  }
  sc.classList.remove('hidden');
  sn.textContent=ME.streak||0;
  btn.className='nav-avatar';
  btn.style.background=pickColor(ME.username);
  // Mostra foto profilo se disponibile
  if(ME.avatarUrl){
    btn.innerHTML=`<img src="${ME.avatarUrl}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" onerror="this.style.display='none';this.parentElement.textContent='${(ME.avatar||initials(ME.username)).replace(/'/g,'')}'">`;    btn.style.overflow='hidden';
    btn.style.padding='0';
  } else {
    btn.innerHTML=ME.avatar||initials(ME.username);
    btn.style.overflow='';
  }
  btn.onclick=()=>showPage('profile');
  if(dmBtn)dmBtn.style.display='flex';
  const supportBtn=document.getElementById('support-nav-btn');
  if(supportBtn)supportBtn.style.display='flex';
  removeExtraBtns();
  if(ME.role==='admin'||ME.role==='superadmin'){
    addExtraBtn('admin','🎨','CMS');
  }
  if(ME.role==='superadmin'){
    addExtraBtn('superadmin','📊','Analytics');
  }
  updateDMBadge();
}
function removeExtraBtns(){
  document.querySelectorAll('.extra-bnav').forEach(el=>el.remove());
}
function addExtraBtn(page,icon,label){
  const b=document.createElement('button');
  b.className='bnav-item extra-bnav';
  b.setAttribute('data-p',page);
  b.innerHTML=`<span class="bnav-icon">${icon}</span><span class="bnav-label">${label}</span>`;
  b.onclick=()=>showPage(page);
  document.getElementById('bottomnav').appendChild(b);
}

/* ============================================================
   AUTH
============================================================ */
function openAuth(){document.getElementById('auth-overlay').classList.add('open');}
function closeAuth(){document.getElementById('auth-overlay').classList.remove('open');}
function switchTab(t){
  document.getElementById('login-form').classList.toggle('hidden',t!=='login');
  document.getElementById('register-form').classList.toggle('hidden',t!=='register');
  document.getElementById('tab-login-btn').classList.toggle('active',t==='login');
  document.getElementById('tab-reg-btn').classList.toggle('active',t==='register');
}
function toggleOptional(){document.getElementById('opt-fields').classList.toggle('open');}

function clearAuthErr(form){
  const box=document.getElementById(form+'-err');
  if(box){box.textContent='';box.classList.remove('visible');}
  document.querySelectorAll(`#${form}-form .auth-field input`).forEach(el=>el.classList.remove('err'));
}
function showAuthErr(form,msg,fieldIds=[]){
  const box=document.getElementById(form+'-err');
  if(box){box.textContent=msg;box.classList.add('visible');}
  fieldIds.forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('err');});
  // scroll to error
  box?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function doLogin(){
  const emailEl=document.getElementById('l-email');
  const pwdEl=document.getElementById('l-pwd');
  const email=emailEl.value.trim();
  const password=pwdEl.value;
  clearAuthErr('login');
  if(!email&&!password){showAuthErr('login','Inserisci la tua email e password per accedere.',['l-email','l-pwd']);return;}
  if(!email){showAuthErr('login','Inserisci la tua email.','l-email');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showAuthErr('login','Email non valida. Controlla il formato (es. nome@email.com).',['l-email']);return;}
  if(!password){showAuthErr('login','Inserisci la password.','l-pwd');return;}
  const btn=document.getElementById('login-submit-btn');
  if(btn){btn.disabled=true;btn.textContent='Accesso...';}
  try{
    const r=await POST('/api/auth/login',{email,password});
    localStorage.setItem('gc_token',r.token);
    ME=r.user;
    closeAuth();
    // Se deve cambiare password, mostra il modal
    if(r.mustChangePassword){
      showForcePasswordChange();
    } else {
      toast('Bentornato '+ME.username+'!');
    }
    renderNavUser();
    startSSE();
    renderHome();
    // Reminder gentile verifica email (non bloccante)
    if(ME.emailVerified === false && !localStorage.getItem('gc_email_reminded_'+ME._id)){
      setTimeout(()=>{ toast('Verifica la tua email dal profilo per poter reimpostare la password in futuro','info',6000); localStorage.setItem('gc_email_reminded_'+ME._id,'1'); },3000);
    }
    if(IS_NATIVE_APK) setTimeout(initPushNotifications, 2000);
  }catch(e){
    const msg=e.message||'Errore di connessione';
    if(msg.toLowerCase().includes('password')||msg.toLowerCase().includes('email')){
      showAuthErr('login','Email o password errata. Controlla le credenziali e riprova.',['l-email','l-pwd']);
    } else if(msg.toLowerCase().includes('sospeso')||msg.toLowerCase().includes('ban')){
      showAuthErr('login',msg,[]);
    } else {
      showAuthErr('login','Errore di connessione. Riprova tra un momento.',[]);
    }
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Accedi';}
  }
}

function showForcePasswordChange(){
  var overlay = document.createElement('div');
  overlay.id = 'force-pwd-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,26,.95);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:var(--card-bg);border-radius:24px;width:100%;max-width:380px;padding:28px 24px;box-shadow:0 16px 48px rgba(0,0,0,.3)">'
    + '<h2 style="font-family:var(--fh);font-size:1.4rem;margin-bottom:8px;color:var(--dark)">Cambia password</h2>'
    + '<p style="font-size:.85rem;color:var(--muted);margin-bottom:20px;line-height:1.5">La tua password e stata reimpostata dall\'amministratore. Scegli una nuova password per continuare.</p>'
    + '<div class="field" style="margin-bottom:12px"><label style="font-weight:700;font-size:.85rem;margin-bottom:4px;display:block">Nuova password</label><input type="password" id="force-new-pwd" placeholder="Min. 6 caratteri" style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:12px;padding:12px 14px;font-family:var(--fb);font-size:.92rem;outline:none;background:var(--bg);color:var(--text)"></div>'
    + '<div class="field" style="margin-bottom:20px"><label style="font-weight:700;font-size:.85rem;margin-bottom:4px;display:block">Conferma password</label><input type="password" id="force-confirm-pwd" placeholder="Ripeti la password" style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:12px;padding:12px 14px;font-family:var(--fb);font-size:.92rem;outline:none;background:var(--bg);color:var(--text)"></div>'
    + '<div id="force-pwd-err" style="display:none;color:#FF3B30;font-size:.82rem;font-weight:700;margin-bottom:12px"></div>'
    + '<button onclick="submitForcePassword()" class="btn-primary" style="border-radius:14px;padding:14px">Salva nuova password</button>'
    + '</div>';
  document.body.appendChild(overlay);
}

async function submitForcePassword(){
  var pwd = document.getElementById('force-new-pwd')?.value;
  var confirm = document.getElementById('force-confirm-pwd')?.value;
  var errEl = document.getElementById('force-pwd-err');
  if(!pwd || pwd.length < 6){
    if(errEl){errEl.style.display='block';errEl.textContent='La password deve avere almeno 6 caratteri.';}
    return;
  }
  if(pwd !== confirm){
    if(errEl){errEl.style.display='block';errEl.textContent='Le password non coincidono.';}
    return;
  }
  try{
    await POST('/api/auth/force-change-password',{newPassword:pwd});
    document.getElementById('force-pwd-overlay')?.remove();
    toast('Password cambiata con successo!');
  }catch(e){
    if(errEl){errEl.style.display='block';errEl.textContent=e.message||'Errore';}
  }
}

// ── PASSWORD DIMENTICATA ──
function showForgotPassword(){
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  if(loginForm) loginForm.classList.add('hidden');
  if(regForm) regForm.classList.add('hidden');
  let fpForm = document.getElementById('forgot-form');
  if(!fpForm){
    fpForm = document.createElement('div');
    fpForm.id = 'forgot-form';
    fpForm.className = 'auth-form pw-reset-wrap';
    fpForm.innerHTML = `
      <h3>Password dimenticata?</h3>
      <p>Inserisci l'email del tuo account e ti invieremo un link per reimpostare la password.</p>
      <div class="auth-error-box" id="forgot-err"></div>
      <div class="field"><label>Email</label><input type="email" id="fp-email" placeholder="la-tua@email.com"></div>
      <button class="btn-primary" id="fp-submit-btn" onclick="doForgotPassword()" style="margin-top:8px">Invia link di reset</button>
      <div id="fp-success" style="display:none;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:14px;margin-top:14px;font-size:.85rem;color:#22C55E;font-weight:600;line-height:1.5"></div>
      <div class="forgot-pw" onclick="backToLogin()" style="margin-top:16px">← Torna al login</div>
    `;
    loginForm.parentElement.appendChild(fpForm);
  } else {
    fpForm.classList.remove('hidden');
  }
}
function backToLogin(){
  const fpForm = document.getElementById('forgot-form');
  if(fpForm) fpForm.classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('tab-login-btn')?.classList.add('active');
  document.getElementById('tab-reg-btn')?.classList.remove('active');
}
async function doForgotPassword(){
  const email = document.getElementById('fp-email')?.value?.trim();
  const errBox = document.getElementById('forgot-err');
  const successBox = document.getElementById('fp-success');
  const btn = document.getElementById('fp-submit-btn');
  if(errBox){errBox.textContent='';errBox.classList.remove('visible');}
  if(successBox) successBox.style.display='none';
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(errBox){errBox.textContent='Inserisci un\'email valida';errBox.classList.add('visible');}
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='Invio in corso...';}
  try{
    const r = await POST('/api/auth/forgot-password',{email});
    if(successBox){
      successBox.style.display='block';
      successBox.textContent='Se l\'email e associata a un account, riceverai un link per reimpostare la password. Controlla anche la cartella spam.';
    }
  }catch(e){
    if(errBox){errBox.textContent=e.message||'Errore di connessione';errBox.classList.add('visible');}
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Invia link di reset';}
  }
}


// ── ONBOARDING GUIDATO ──
function showOnboarding(){
  if(localStorage.getItem('gc_onboarded'))return;
  const steps=[
    {icon:'&#x1F3E0;',title:'Benvenuto su GiadaCourses!',text:'Questa e la tua Home. Qui trovi le missioni giornaliere, il feed della community e i tuoi progressi.',page:'home'},
    {icon:'&#x1F4DA;',title:'Esercizi',text:'Pratica l\'inglese con quiz interattivi per ogni livello (A1-C2). Guadagna XP completandoli!',page:'exercises'},
    {icon:'&#x1F3AE;',title:'Giochi',text:'Divertiti con giochi educativi per imparare vocaboli e grammatica in modo divertente.',page:'games'},
    {icon:'&#x1F4AC;',title:'Social',text:'Condividi i tuoi progressi, pubblica post e reel, commenta e interagisci con la community!',page:'social'},
    {icon:'&#x2764;&#xFE0F;',title:'Supporto',text:'Hai problemi? Segnala un bug o supporta il progetto con una donazione su Ko-fi!',page:'support'},
    {icon:'&#x1F3C6;',title:'Sei pronto!',text:'Completa esercizi, mantieni il tuo streak quotidiano e scala la classifica. Buon divertimento!',page:null},
  ];
  let idx=0;
  const ov=document.createElement('div');
  ov.id='onboarding-overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(15,13,46,.92);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;text-align:center';
  function renderStep(){
    const s=steps[idx];
    const isLast=idx===steps.length-1;
    ov.innerHTML=`<div style="max-width:380px;width:100%;animation:popIn .4s ease">
      <div style="font-size:3.5rem;margin-bottom:16px">${s.icon}</div>
      <h2 style="font-family:Poppins,sans-serif;font-size:1.3rem;margin-bottom:10px">${s.title}</h2>
      <p style="opacity:.75;line-height:1.6;margin-bottom:24px;font-size:.9rem">${s.text}</p>
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:20px">${steps.map((_,i)=>'<div style="width:'+(i===idx?'20px':'8px')+';height:8px;border-radius:4px;background:'+(i===idx?'#8B5CF6':'rgba(255,255,255,.2)')+';transition:all .3s"></div>').join('')}</div>
      <div style="display:flex;gap:10px">
        ${!isLast?'<button onclick="skipOnboarding()" style="flex:1;background:rgba(255,255,255,.08);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:13px;font-weight:600;font-size:.88rem;cursor:pointer">Salta</button>':''}
        <button onclick="${isLast?'finishOnboarding()':'nextOnboardingStep()'}" style="flex:2;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;border:none;border-radius:14px;padding:13px;font-weight:700;font-size:.95rem;cursor:pointer;box-shadow:0 4px 16px rgba(139,92,246,.3)">${isLast?'Inizia!':'Avanti'}</button>
      </div>
    </div>`;
  }
  window.nextOnboardingStep=function(){
    idx++;
    if(idx>=steps.length){finishOnboarding();return;}
    if(steps[idx].page) showPage(steps[idx].page);
    renderStep();
  };
  window.skipOnboarding=function(){finishOnboarding();};
  window.finishOnboarding=function(){
    localStorage.setItem('gc_onboarded','1');
    ov.remove();
    showPage('home');
    toast('Buon divertimento su GiadaCourses!');
  };
  document.body.appendChild(ov);
  renderStep();
}

// ── EMAIL VERIFICATION SCREEN ──
function showEmailVerificationScreen(email){
  var overlay = document.createElement('div');
  overlay.id = 'email-verify-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:linear-gradient(160deg,#0F0D2E 0%,#1E1B4B 40%,#312E81 100%);display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;text-align:center';
  overlay.innerHTML = '<div style="max-width:400px;width:100%">'
    + '<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#8B5CF6,#EC4899);margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:2.5rem">\u2709\uFE0F</div>'
    + '<h2 style="font-family:Poppins,sans-serif;font-size:1.5rem;margin-bottom:10px">Controlla la tua email!</h2>'
    + '<p style="opacity:.75;line-height:1.6;margin-bottom:24px;font-size:.9rem">Abbiamo inviato un link di verifica a:<br><strong style="color:#A78BFA">'+escHTML(email)+'</strong></p>'
    + '<div style="background:rgba(255,255,255,.06);border-radius:14px;padding:16px;text-align:left;margin-bottom:20px">'
    + '<div style="font-weight:700;font-size:.85rem;margin-bottom:10px">Come fare:</div>'
    + '<div style="font-size:.82rem;opacity:.8;line-height:1.6">1. Apri la tua email<br>2. Cerca il messaggio da <strong>GiadaCourses</strong><br>3. Clicca il bottone <strong>Verifica Email</strong><br>4. Torna qui e premi il bottone sotto</div>'
    + '</div>'
    + '<div style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);border-radius:12px;padding:12px;margin-bottom:20px;font-size:.8rem;color:#FBBF24">Controlla anche la cartella <strong>Spam</strong> o <strong>Promozioni</strong></div>'
    + '<button onclick="checkEmailVerified()" style="width:100%;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;border:none;border-radius:14px;padding:14px;font-weight:700;font-size:1rem;cursor:pointer;margin-bottom:10px">Ho verificato, entra!</button>'
    + '<button onclick="resendVerificationEmail()" id="resend-verify-btn" style="width:100%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;font-weight:600;font-size:.85rem;cursor:pointer">Reinvia email di verifica</button>'
    + '</div>';
  document.body.appendChild(overlay);
}
async function checkEmailVerified(){
  try{
    const me = await GET('/api/auth/me');
    if(me && me.emailVerified){
      ME = me;
      document.getElementById('email-verify-overlay')?.remove();
      toast('Email verificata! Benvenuto '+ME.username+'!');
      renderNavUser(); startSSE(); renderHome();
    } else { toast('Email non ancora verificata. Controlla la tua casella!','error'); }
  }catch(e){ toast('Errore di connessione','error'); }
}
async function resendVerificationEmail(){
  const btn = document.getElementById('resend-verify-btn');
  if(btn){btn.disabled=true;btn.textContent='Invio in corso...';}
  try{ await POST('/api/auth/resend-verification'); toast('Email di verifica reinviata!'); }
  catch(e){ toast(e.message||'Errore','error'); }
  finally{ if(btn){btn.disabled=false;btn.textContent='Reinvia email di verifica';} }
}

// ── PUSH NOTIFICATIONS ──
async function initPushNotifications(){
  if(!IS_NATIVE_APK) return; // Solo APK Android
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try{
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if(existing) return; // Already subscribed
    // Get VAPID key from server
    const keyRes = await GET('/api/push/vapid-key');
    if(!keyRes?.publicKey) return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey)
    });
    await POST('/api/push/subscribe', { subscription: sub.toJSON() });
    console.log('[PUSH] Subscribed successfully');
  }catch(e){ console.warn('[PUSH] Failed:', e.message); }
}
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/\-/g,'+').replace(/_/g,'/');
  const raw=window.atob(base64);
  const arr=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;++i) arr[i]=raw.charCodeAt(i);
  return arr;
}

async function doRegister(){
  const usernameEl=document.getElementById('r-username');
  const emailEl=document.getElementById('r-email');
  const pwdEl=document.getElementById('r-pwd');
  const username=usernameEl.value.trim();
  const email=emailEl.value.trim();
  const password=pwdEl.value;
  clearAuthErr('register');
  // Validazione campo per campo
  if(!username){showAuthErr('register','Scegli un username per il tuo account.',['r-username']);return;}
  if(username.length<3){showAuthErr('register','Lo username deve avere almeno 3 caratteri.',['r-username']);return;}
  if(!email){showAuthErr('register','Inserisci la tua email.',['r-email']);return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showAuthErr('register','Email non valida. Usa il formato nome@email.com.',['r-email']);return;}
  if(!password){showAuthErr('register','Scegli una password.',['r-pwd']);return;}
  if(password.length<6){showAuthErr('register','La password deve avere almeno 6 caratteri.',['r-pwd']);return;}
  const regBtn=document.querySelector('#register-form .auth-submit');
  if(regBtn){regBtn.disabled=true;regBtn.textContent='⏳ Creazione...';}
  try{
    const r=await POST('/api/auth/register',{
      username,email,password,
      level:document.getElementById('r-level').value,
      nativeLang:document.getElementById('r-native').value,
      goal:document.getElementById('r-goal').value,
      city:document.getElementById('r-city').value,
      bio:document.getElementById('r-bio').value,
    });
    localStorage.setItem('gc_token',r.token);
    ME=r.user;
    closeAuth();
    toast(`Benvenuto ${ME.username}! 🎉 Account creato!`);
    renderNavUser();
    startSSE();
    renderHome();
    // Onboarding per nuovi utenti
    setTimeout(()=>showOnboarding(), 1500);
    // Reminder gentile per verifica email (non bloccante)
    if(!ME.emailVerified){
      setTimeout(()=>{ toast('Puoi verificare la tua email dal profilo per reimpostare la password in futuro','info',6000); },8000);
    }
  }catch(e){
    const msg=e.message||'Errore';
    if(msg.toLowerCase().includes('email')){
      showAuthErr('register',msg+' Usa un\'altra email.',['r-email']);
    } else if(msg.toLowerCase().includes('username')){
      showAuthErr('register',msg+' Scegli un altro username.',['r-username']);
    } else if(msg.toLowerCase().includes('password')){
      showAuthErr('register',msg,['r-pwd']);
    } else {
      showAuthErr('register',msg,[]);
    }
  }finally{
    if(regBtn){regBtn.disabled=false;regBtn.textContent='✨ Crea Account';}
  }
}

async function doLogout(){
  try{await POST('/api/auth/logout');}catch{}
  localStorage.removeItem('gc_token');
  stopSSE();
  window._saTab=null;
  ME=null;
  renderNavUser();
  toast('Disconnesso 👋','info');
  showPage('home');
}

/* ============================================================
   HOME
============================================================ */
async function renderHome(){
  const c=document.getElementById('home-content');
  if(!ME){renderGuestHome(c);return;}
  const li=Math.max(0,LEVELS.indexOf(ME.level||'A1'));
  const xpP=XP_LEVELS[li]||0;
  const xpN=li>=LEVELS.length-1?99999:(XP_LEVELS[li+1]||99999);
  const xpCur=ME.xp||0;
  const pct=li>=LEVELS.length-1?100:Math.max(0,Math.min(100,Math.round((xpCur-xpP)/(xpN-xpP)*100)));
  const nextLvl=li>=LEVELS.length-1?'Livello Massimo!':LEVELS[li+1];
  const done=Object.keys(ME.progress||{}).length;
  c.innerHTML=`
    <div class="hero-banner" style="background:linear-gradient(135deg,var(--coral),var(--orange))" data-emoji="🌟">
      <h2>Ciao, ${ME.username}! ${ME.avatar||'👋'}</h2>
      <p>Livello <strong>${ME.level||'A1'}</strong> · ${xpCur} XP · 🔥 ${ME.streak||0} giorni</p>
      <div class="xp-bar-wrap"><div class="xp-bar" style="width:${pct}%"></div></div>
      <small style="opacity:.85">${pct}% verso ${nextLvl}</small>
    </div>
    <div class="stats-row">
      <div class="stat-card c1"><div class="stat-val">${done}</div><div class="stat-lbl">Esercizi</div></div>
      <div class="stat-card c2"><div class="stat-val">${ME.streak||0}</div><div class="stat-lbl">Streak</div></div>
      <div class="stat-card c3" onclick="showFollowList(ME._id,'followers')" style="cursor:pointer"><div class="stat-val">${(ME.followers||[]).length}</div><div class="stat-lbl">Follower</div></div>
    </div>
    <div id="daily-rewards-card"></div>
    <div class="flex-row mb16">
      <button class="btn-primary btn-sm" onclick="showPage('exercises')" style="flex:1">Studia</button>
      <button class="btn-primary btn-sm" onclick="showPage('social')" style="flex:1;background:linear-gradient(135deg,var(--teal),var(--blue))">Social</button>
    </div>
    <div class="section-title">🌊 Ultime attività</div>
    <div id="home-feed"><div class="spinner"></div></div>
    <div class="section-title mt16">🏅 I tuoi badge</div>
    <div class="badges-grid">
      ${BADGES_DEF.map(b=>`<div class="badge-item${(ME.badges||[]).includes(b.e)?'':' locked'}"><div class="be">${b.e}</div><div class="bn">${b.n}</div></div>`).join('')}
    </div>
    ${ME.role==='admin'||ME.role==='superadmin'?`
    <div class="separator"></div>
    <div class="section-title">⚡ Admin</div>
    <div class="flex-row">
      <button class="btn-primary btn-sm" onclick="showPage('admin')" style="background:linear-gradient(135deg,var(--purple),#6c63ff)">🎨 CMS</button>
      ${ME.role==='superadmin'?`<button class="btn-primary btn-sm" onclick="showPage('superadmin')" style="background:linear-gradient(135deg,var(--navy),var(--dark))">📊 Analytics</button>`:''}
    </div>`:''}
  `;
  // Load feed
  try{
    const _pr=await fetch('/api/posts',{headers:{...(localStorage.getItem('gc_token')?{'Authorization':'Bearer '+localStorage.getItem('gc_token')}:{})},cache:'no-store'});
    const posts=_pr.ok?await _pr.json():[];
    const feedEl=document.getElementById('home-feed');
    if(feedEl){
      if(!posts.length){feedEl.innerHTML=`<div class="empty-state"><div class="ei">💬</div><h3>Nessuna attività ancora</h3><p>Completa esercizi e condividili!</p></div>`;}
      else feedEl.innerHTML=posts.slice(0,3).map(p=>renderPostHTML(p,true)).join('');
    }
  }catch{}
  // Load daily rewards
  loadDailyRewards();
}

async function loadDailyRewards(){
  const card=document.getElementById('daily-rewards-card');
  if(!card||!ME)return;
  try{
    const d=await GET('/api/daily/status');
    const missionsHTML=d.missions.map(m=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${m.completed?'opacity:.5':''}">
        <span style="font-size:1.2rem">${m.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.84rem;font-weight:600;${m.completed?'text-decoration:line-through':''}">${escHTML(m.title)}</div>
        </div>
        <span style="font-size:.75rem;font-weight:700;color:${m.completed?'var(--green)':'var(--coral)'}">${m.completed?'Fatto!':'+'+m.xp+' XP'}</span>
      </div>
    `).join('');
    card.innerHTML=`
      <div class="card" style="border:1.5px solid rgba(139,92,246,.12);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="font-family:var(--fh);font-size:1rem;margin:0">Missioni del giorno</h3>
          ${!d.loginClaimed?`<button onclick="claimDailyLogin()" class="btn-primary btn-sm" style="width:auto;padding:7px 16px;font-size:.78rem;box-shadow:0 2px 8px rgba(139,92,246,.2)">Riscuoti +${d.loginXP} XP</button>`
          :`<span style="font-size:.72rem;font-weight:700;color:var(--green);background:rgba(34,197,94,.08);padding:3px 10px;border-radius:10px">+${d.loginXP} XP riscosso</span>`}
        </div>
        <div style="border-top:1px solid rgba(139,92,246,.06);padding-top:8px">
          ${missionsHTML}
        </div>
        ${d.allCompleted?`<div style="text-align:center;margin-top:10px;padding:8px;background:rgba(34,197,94,.06);border-radius:10px;font-size:.82rem;font-weight:700;color:var(--green)">Tutte le missioni completate! +25 XP bonus</div>`:''}
      </div>
    `;
  }catch(e){card.innerHTML='';}
}

async function claimDailyLogin(){
  try{
    const r=await POST('/api/daily/claim-login');
    if(r.alreadyClaimed){toast('Già riscosso oggi!','info');return;}
    ME.xp=(ME.xp||0)+r.xp;
    ME.streak=r.streak;
    toast('Login giornaliero! +'+r.xp+' XP | Streak: '+r.streak+' giorni');
    renderHome();
  }catch(e){toast(e.message,'error');}
}

// Auto-complete missions when user performs actions
async function checkDailyMission(type){
  if(!ME)return;
  try{await POST('/api/daily/mission/'+type+'/complete');}catch{}
}

function renderGuestHome(c){
  c.innerHTML=`
    <div class="hero-banner" style="background:linear-gradient(135deg,var(--teal),var(--blue))" data-emoji="🇬🇧">
      <h2>Impara l'inglese!</h2>
      <p>Esercitati, guadagna badge e connettiti con la community</p>
    </div>
    <div class="guest-bar">
      <p>🔒 Registrati per salvare i progressi, ottenere badge e interagire con tutti!</p>
      <button onclick="openAuth()">Entra gratis →</button>
    </div>
    <div class="flex-row mb16">
      <button class="btn-primary btn-sm" onclick="showPage('exercises')">📚 Prova gratis</button>
      <button class="btn-primary btn-sm" onclick="openAuth()" style="background:linear-gradient(135deg,var(--teal),var(--blue))">✨ Registrati</button>
    </div>
    <div class="section-title">💬 Community</div>
    <div id="guest-feed"><div class="spinner"></div></div>
  `;
  GET('/api/posts').then(posts=>{
    const f=document.getElementById('guest-feed');
    if(!f)return;
    if(!posts.length){f.innerHTML=`<div class="empty-state"><div class="ei">💬</div><h3>Nessun post ancora</h3><p>Sii il primo a condividere qualcosa!</p></div>`;}
    else f.innerHTML=posts.slice(0,3).map(p=>renderPostHTML(p,true)).join('');
  }).catch(()=>{});
}

/* ============================================================
   SOCIAL FEED
============================================================ */
let _socialTab = sessionStorage.getItem('gc_social_tab') || 'thread';
async function renderSocial(){
  const c=document.getElementById('social-content');
  const canLive=ME&&(ME.username?.toLowerCase()==='giada'||ME.role==='superadmin');
  const tab = _socialTab;
  c.innerHTML=`
    <div class="section-title">Storie</div>
    <div class="stories-bar" id="stories-bar"><div class="spinner" style="width:24px;height:24px;margin:auto"></div></div>

    <div id="live-strip" style="display:none;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(255,59,48,.12),rgba(255,107,107,.06));border:1px solid rgba(255,59,48,.2);border-radius:var(--rs);padding:12px 14px;margin-bottom:16px;cursor:pointer"></div>

    ${canLive?`<div style="background:linear-gradient(135deg,rgba(255,59,48,.1),rgba(255,107,107,.06));border:1px solid rgba(255,59,48,.25);border-radius:var(--rs);padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <div style="font-weight:800;font-size:.9rem;color:#FF3B30;margin-bottom:2px">LIVE <span style="background:rgba(255,59,48,.15);color:#FF3B30;padding:2px 8px;border-radius:10px;font-size:.65rem;font-weight:700;margin-left:4px">SPERIMENTALE</span></div>
        <div style="font-size:.74rem;color:var(--muted)">Vai in diretta per i tuoi studenti</div>
      </div>
      <button onclick="startLive()" style="background:linear-gradient(135deg,#FF3B30,#FF6B6B);color:#fff;border:none;border-radius:14px;padding:10px 18px;font-family:var(--fb);font-weight:700;font-size:.82rem;cursor:pointer;flex-shrink:0">Inizia</button>
    </div>`:''}

    ${IS_NATIVE_APK&&ME?`<div class="card" style="display:flex;align-items:center;gap:14px;padding:14px;border:1.5px solid rgba(34,197,94,.15);background:rgba(34,197,94,.03)">
      <div style="font-size:1.8rem">🌍</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.88rem">Language Partner</div>
        <div style="font-size:.74rem;color:var(--muted)">Trova qualcuno con cui praticare inglese</div>
      </div>
      <button id="partner-find-btn" onclick="findLanguagePartner()" style="background:linear-gradient(135deg,#22C55E,#16A34A);color:#fff;border:none;border-radius:12px;padding:10px 16px;font-family:var(--fb);font-weight:700;font-size:.8rem;cursor:pointer;flex-shrink:0">Trova Partner</button>
    </div>`:''}

    <!-- ── SOCIAL TABS ── -->
    <div class="social-tabs" id="social-tabs">
      <button class="social-tab${tab==='thread'?' active':''}" data-tab="thread" onclick="switchSocialTab('thread')">Thread</button>
      <button class="social-tab${tab==='reel'?' active':''}" data-tab="reel" onclick="switchSocialTab('reel')">Reels</button>
      <button class="social-tab${tab==='exercise'?' active':''}" data-tab="exercise" onclick="switchSocialTab('exercise')">Esercizi</button>
    </div>

    ${ME?`<div id="suggestions-bar" style="margin-bottom:16px"></div>`:''}

    <!-- ── POST CREATOR (cambia in base al tab) ── -->
    <div id="social-creator"></div>

    <!-- ── FEED (cambia in base al tab) ── -->
    <div id="feed-list"><div class="spinner"></div></div>
  `;
  loadStories();
  renderSocialCreator();
  await loadFeedByType(tab);
  checkActiveLives();
  if(ME) loadSuggestions();
}

function switchSocialTab(tab){
  _socialTab = tab;
  sessionStorage.setItem('gc_social_tab', tab);
  document.querySelectorAll('.social-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderSocialCreator();
  loadFeedByType(tab);
}

function renderSocialCreator(){
  const box = document.getElementById('social-creator');
  if(!box) return;
  if(!ME){
    box.innerHTML = `<div class="guest-bar"><p>Accedi per partecipare alla community!</p><button onclick="openAuth()">Accedi</button></div>`;
    return;
  }
  if(_socialTab === 'thread'){
    box.innerHTML = `<div class="create-post-box">
      <textarea class="post-textarea" id="new-post-text" rows="2" placeholder="Apri una discussione, condividi un consiglio..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-primary btn-sm" onclick="createThreadPost()" style="width:auto;padding:9px 22px;margin-left:auto">Pubblica</button>
      </div>
    </div>`;
  } else if(_socialTab === 'reel'){
    box.innerHTML = '<div class="create-post-box">'
      + '<div style="font-weight:700;font-size:.88rem;margin-bottom:10px;color:var(--dark)">Crea un Reel</div>'
      + '<textarea class="post-textarea" id="new-reel-caption" rows="1" placeholder="Didascalia (opzionale)..."></textarea>'
      + '<div id="reel-media-preview" style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;scrollbar-width:none"></div>'
      + '<div class="upload-btn-row">'
      + '<label class="upload-btn" for="reel-img-input">Foto</label>'
      + '<input type="file" id="reel-img-input" accept="image/*" multiple style="display:none" onchange="handleReelMediaMulti(this,\'image\')">'
      + '<label class="upload-btn" for="reel-vid-input">Video</label>'
      + '<input type="file" id="reel-vid-input" accept="video/*" multiple style="display:none" onchange="handleReelMediaMulti(this,\'video\')">'
      + '<label class="upload-btn" for="reel-cam-input">Scatta</label>'
      + '<input type="file" id="reel-cam-input" accept="image/*" capture="environment" style="display:none" onchange="handleReelMediaMulti(this,\'image\')">'
      + '<button class="btn-primary btn-sm" onclick="createReelPost()" style="width:auto;padding:9px 22px;margin-left:auto">Pubblica Reel</button>'
      + '</div></div>';
  } else {
    box.innerHTML = `<div style="background:rgba(156,124,255,.06);border:2px solid rgba(156,124,255,.15);border-radius:var(--rs);padding:14px 16px;margin-bottom:14px">
      <div style="font-weight:700;font-size:.88rem;color:var(--purple);margin-bottom:4px">Risultati Esercizi</div>
      <div style="font-size:.78rem;color:var(--muted)">I risultati condivisi dagli utenti al termine degli esercizi. Vota e recensisci!</div>
    </div>`;
  }
}

let pendingReelMedia = []; // Array of {file, type, url}

function handleReelMediaMulti(input, type){
  var files = input.files;
  if(!files||!files.length) return;
  for(var fi=0; fi<files.length; fi++){
    var file = files[fi];
    var url = URL.createObjectURL(file);
    pendingReelMedia.push({ file: file, type: type, url: url });
  }
  input.value = '';
  renderReelPreviews();
}

function renderReelPreviews(){
  var preview = document.getElementById('reel-media-preview');
  if(!preview) return;
  var html = '';
  for(var i=0; i<pendingReelMedia.length; i++){
    var m = pendingReelMedia[i];
    html += '<div style="position:relative;flex-shrink:0;width:90px;height:90px;border-radius:10px;overflow:hidden;background:#000">';
    if(m.type === 'image'){
      html += '<img src="'+m.url+'" style="width:100%;height:100%;object-fit:cover">';
    } else {
      html += '<video src="'+m.url+'" style="width:100%;height:100%;object-fit:cover" muted></video>';
      html += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.8);font-size:1.2rem;background:rgba(0,0,0,.2)">&#9654;</div>';
    }
    html += '<button onclick="removeReelItem('+i+')" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center">x</button>';
    html += '<div style="position:absolute;bottom:3px;left:3px;background:rgba(0,0,0,.6);color:#fff;border-radius:8px;padding:1px 6px;font-size:.6rem;font-weight:700">'+(i+1)+'/'+pendingReelMedia.length+'</div>';
    html += '</div>';
  }
  preview.innerHTML = html;
}

function removeReelItem(idx){
  if(pendingReelMedia[idx] && pendingReelMedia[idx].url) URL.revokeObjectURL(pendingReelMedia[idx].url);
  pendingReelMedia.splice(idx, 1);
  renderReelPreviews();
}

function removeReelMedia(){ 
  for(var i=0;i<pendingReelMedia.length;i++){if(pendingReelMedia[i] && pendingReelMedia[i].url)URL.revokeObjectURL(pendingReelMedia[i].url);}
  pendingReelMedia=[]; 
  var p=document.getElementById('reel-media-preview'); if(p)p.innerHTML=''; 
}

async function createThreadPost(){
  if(!ME){openAuth();return;}
  const text=document.getElementById('new-post-text')?.value?.trim();
  if(!text){toast('Scrivi qualcosa per aprire un thread!','error');return;}
  try{
    await POST('/api/posts',{text, postType:'thread'});
    document.getElementById('new-post-text').value='';
    toast('Thread pubblicato!');
    await loadFeedByType('thread');
  }catch(e){toast(e.message,'error');}
}

async function createReelPost(){
  if(!ME){openAuth();return;}
  if(!pendingReelMedia.length){toast('Aggiungi almeno una foto o un video!','error');return;}
  var btn = document.querySelector('[onclick="createReelPost()"]');
  if(btn){btn.disabled=true;btn.textContent='Caricamento...';}
  try{
    var uploadedMedia = [];
    var tok = localStorage.getItem('gc_token');
    for(var i=0; i<pendingReelMedia.length; i++){
      var m = pendingReelMedia[i];
      try{
        var prepared = await prepareMediaForUpload(m.file, 1600, 0.85);
        var fd = new FormData();
        fd.append('file', prepared.file, prepared.name);
        toast('Caricamento '+(i+1)+'/'+pendingReelMedia.length+'...','info',4000);
        var d = await uploadWithProgress('/api/media/upload', fd, {'Authorization':'Bearer '+tok});
        if(d && d.url) uploadedMedia.push({url: d.url, type: d.type || m.type});
        else throw new Error('Risposta upload incompleta');
      }catch(fileErr){
        console.error('[REEL] Upload file '+(i+1)+' failed:', fileErr);
        toast('Errore caricamento file '+(i+1)+': '+fileErr.message,'error',4000);
        // Continue with other files if this one failed
      }
    }
    if(!uploadedMedia.length){throw new Error('Nessun file caricato. Riprova.');}
    var caption = document.getElementById('new-reel-caption')?.value?.trim()||'';
    if(uploadedMedia.length === 1){
      await POST('/api/posts',{text:caption, mediaUrl:uploadedMedia[0].url, mediaType:uploadedMedia[0].type, postType:'reel'});
    } else {
      await POST('/api/posts',{text:caption, mediaUrl:uploadedMedia[0].url, mediaType:uploadedMedia[0].type, mediaUrls:uploadedMedia, postType:'reel'});
    }
    removeReelMedia();
    if(document.getElementById('new-reel-caption')) document.getElementById('new-reel-caption').value='';
    toast('Reel pubblicato!');checkDailyMission('post');
    await loadFeedByType('reel');
  }catch(e){toast(e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='Pubblica Reel';}}
}

async function loadFeedByType(type){
  const fl=document.getElementById('feed-list');
  if(!fl)return;
  fl.innerHTML='<div class="spinner"></div>';
  try{
    const _pr=await fetch('/api/posts?type='+(type||''),{headers:{...(localStorage.getItem('gc_token')?{'Authorization':'Bearer '+localStorage.getItem('gc_token')}:{})},cache:'no-store'});
    const posts=_pr.ok?await _pr.json():[];
    if(!Array.isArray(posts)||!posts.length){
      const emptyMsg = type==='thread' ? 'Nessun thread ancora. Inizia una discussione!' : type==='reel' ? 'Nessun reel ancora. Condividi una foto o un video!' : 'Nessun risultato condiviso ancora.';
      fl.innerHTML=`<div class="empty-state"><div class="ei">${type==='reel'?'🎬':type==='exercise'?'📝':'💬'}</div><h3>${emptyMsg}</h3></div>`;
      return;
    }
    if(type === 'reel'){
      fl.innerHTML = posts.map(p => renderReelCard(p)).join('');
    } else if(type === 'exercise'){
      fl.innerHTML = posts.map(p => renderExerciseCard(p)).join('');
    } else {
      fl.innerHTML = posts.map(p => renderPostHTML(p)).join('');
    }
    posts.forEach(p=>loadPostComments(p._id));
  }catch(e){
    fl.innerHTML=`<div class="empty-state"><div class="ei">⚠️</div><h3>Errore</h3><p>${escHTML(e.message)}</p><button onclick="loadFeedByType('${type}')" class="btn-primary btn-sm" style="width:auto;margin-top:8px">Riprova</button></div>`;
  }
}

function renderReelCard(p){
  if(!p||!p._id)return '';
  var a=p.author||{username:'Utente',avatar:'\u{1F464}',_id:'',avatarUrl:''};
  var liked=ME&&(p.likes||[]).includes(ME._id);
  var lcount=(p.likes||[]).length;
  var canDel=ME&&(ME._id===p.userId||ME.role==='admin'||ME.role==='superadmin');
  var allMedia = [];
  if(p.mediaUrls && p.mediaUrls.length > 1){
    for(var mi=0;mi<p.mediaUrls.length;mi++) allMedia.push(p.mediaUrls[mi]);
  } else if(p.mediaUrl && p.mediaUrl.startsWith('/')){
    allMedia.push({url:p.mediaUrl, type:p.mediaType||'image'});
  }
  var mediaHtml = '';
  if(allMedia.length > 1){
    var slides = '';
    for(var si=0;si<allMedia.length;si++){
      var mm = allMedia[si];
      if(mm.type==='video'){
        slides += '<div class="reel-slide"><video src="'+mm.url+'" playsinline preload="metadata" muted loop style="width:100%;height:100%;object-fit:cover" onclick="toggleReelVideo(this.closest(\'.reel-media-box\'))"></video><div class="reel-play-icon">\u25b6</div></div>';
      } else {
        slides += '<div class="reel-slide"><img src="'+mm.url+'" style="width:100%;height:100%;object-fit:cover" loading="lazy" onclick="openLightbox(\''+mm.url+'\')"></div>';
      }
    }
    mediaHtml = '<div class="reel-media-box"><div class="reel-carousel" id="rc-'+p._id+'" data-idx="0" style="display:flex;width:100%;height:100%;transition:transform .3s ease">'+slides+'</div>';
    mediaHtml += '<div class="reel-counter" id="rcn-'+p._id+'">1/'+allMedia.length+'</div>';
    mediaHtml += '<div class="reel-dots" id="rcd-'+p._id+'">';
    for(var di=0;di<allMedia.length;di++) mediaHtml += '<span class="reel-dot'+(di===0?' active':'')+'"></span>';
    mediaHtml += '</div></div>';
  } else if(allMedia.length === 1){
    var sm = allMedia[0];
    if(sm.type==='video'){
      mediaHtml = '<div class="reel-media-box" onclick="toggleReelVideo(this)"><video src="'+sm.url+'" playsinline preload="metadata" muted loop style="width:100%;height:100%;object-fit:cover"></video><div class="reel-play-icon">\u25b6</div></div>';
    } else {
      mediaHtml = '<div class="reel-media-box" onclick="openLightbox(\''+sm.url+'\')"><img src="'+sm.url+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'"></div>';
    }
  }
  return '<div class="feed-post reel-card" id="post-'+p._id+'">'
    + '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px 8px">'
    + '<div class="avatar-circle" style="width:34px;height:34px;background:'+pickColor(a.username)+';cursor:pointer;font-size:.85rem;overflow:hidden;flex-shrink:0" onclick="viewUser(\''+a._id+'\')">'+( a.avatarUrl?'<img src="'+a.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':a.avatar||initials(a.username))+'</div>'
    + '<div style="flex:1;min-width:0"><strong style="font-size:.85rem;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHTML(a.username)+'</strong><span style="font-size:.68rem;color:var(--muted)">'+timeAgo(p.timestamp)+'</span></div>'
    + (canDel?'<button onclick="deletePost(\''+p._id+'\') " style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;padding:6px">\u{1f5d1}\ufe0f</button>':'')
    + '</div>'
    + mediaHtml
    + '<div style="padding:10px 14px 14px">'
    + '<div class="post-actions" style="padding:0;margin-bottom:6px">'
    + '<button class="action-btn'+(liked?' liked':'')+'" id="like-btn-'+p._id+'" onclick="likePost(\''+p._id+'\',this)"><span class="like-icon">'+(liked?'\u2764\ufe0f':'\u{1f90d}')+'</span> '+lcount+'</button>'
    + '<button class="action-btn" onclick="toggleComments(\''+p._id+'\')">\u{1f4ac} <span id="ccount-'+p._id+'">0</span></button>'
    + '</div>'
    + (p.text?'<div class="post-body" style="font-size:.86rem">'+renderMentions(escHTML(p.text))+'</div>':'')
    + '<div class="comments-box" id="cmts-'+p._id+'"><div id="cmts-list-'+p._id+'"></div>'
    + (ME?'<div class="comment-input-row"><input class="comment-input" id="ci-'+p._id+'" data-pid="'+p._id+'" placeholder="Commenta..." onkeydown="handleCommentKey(event,this)"><button class="comment-send" onclick="addComment(\''+p._id+'\')">\u27a4</button></div>':'')
    + '</div></div></div>';
}

function toggleReelVideo(box){
  var vid = box.querySelector('video');
  var icon = box.querySelector('.reel-play-icon');
  if(!vid) return;
  if(vid.paused){ vid.muted=false; vid.play().catch(function(){}); if(icon)icon.style.display='none'; }
  else { vid.pause(); if(icon)icon.style.display='flex'; }
}

// Reel carousel swipe
(function(){
  var _startX=0,_isDrag=false,_carousel=null;
  document.addEventListener('touchstart',function(e){
    var t=e.target.closest('.reel-carousel');
    if(!t)return;_carousel=t;_startX=e.touches[0].clientX;_isDrag=false;
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!_carousel)return;
    var dx=e.touches[0].clientX-_startX;
    if(Math.abs(dx)>15)_isDrag=true;
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!_carousel||!_isDrag){_carousel=null;return;}
    var dx=e.changedTouches[0].clientX-_startX;
    var idx=parseInt(_carousel.dataset.idx)||0;
    var total=_carousel.querySelectorAll('.reel-slide').length;
    if(dx<-40&&idx<total-1)idx++;
    else if(dx>40&&idx>0)idx--;
    _carousel.dataset.idx=idx;
    _carousel.style.transform='translateX(-'+(idx*100)+'%)';
    var pid=_carousel.id.replace('rc-','');
    var counter=document.getElementById('rcn-'+pid);
    if(counter)counter.textContent=(idx+1)+'/'+total;
    var dotsWrap=document.getElementById('rcd-'+pid);
    if(dotsWrap){var dots=dotsWrap.querySelectorAll('.reel-dot');for(var d=0;d<dots.length;d++)dots[d].className='reel-dot'+(d===idx?' active':'');}
    _carousel=null;_isDrag=false;
  },{passive:true});
})();


function renderExerciseCard(p){
  if(!p||!p._id)return '';
  const a=p.author||{username:'Utente',avatar:'👤',_id:'',avatarUrl:''};
  const score=p.score||0;
  const scoreColor=score>=80?'#4ADE80':score>=50?'#FF9F43':'#FF6B6B';
  const stars=p.rating||0;
  var starsHtml='';
  if(stars){starsHtml='<div style="margin-top:6px;display:flex;gap:2px">';for(var si=1;si<=5;si++){starsHtml+='<span style="color:'+(si<=stars?'#FFD700':'rgba(0,0,0,.15)')+';font-size:.95rem">★</span>';}starsHtml+='</div>';}
  // Solo l'autore dell'esercizio puo recensire il proprio risultato
  const isMyExercise = ME && ME._id === p.userId;
  const canRate = isMyExercise && !p.rating;
  const canDel = ME && (ME._id === p.userId || (ME.role === 'admin' || ME.role === 'superadmin'));
  var starPickerHtml = '';
  if(canRate){
    starPickerHtml = '<div id="rate-box-'+p._id+'" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:8px 0;border-top:1px solid rgba(0,0,0,.06)">';
    starPickerHtml += '<span style="font-size:.78rem;font-weight:700;color:var(--muted)">Valuta:</span>';
    starPickerHtml += '<div class="star-picker" id="star-pick-'+p._id+'">';
    for(var ri=1;ri<=5;ri++){
      starPickerHtml += '<span class="star-pick-btn" data-val="'+ri+'" onclick="pickExStar(\''+p._id+'\','+ri+')" style="cursor:pointer;font-size:1.2rem;color:rgba(0,0,0,.15);transition:color .15s">★</span>';
    }
    starPickerHtml += '</div>';
    starPickerHtml += '<input type="text" id="rev-text-'+p._id+'" placeholder="Breve recensione..." maxlength="200" style="flex:1;min-width:120px;border:1.5px solid rgba(0,0,0,.08);border-radius:10px;padding:6px 10px;font-family:var(--fb);font-size:.78rem;outline:none;background:var(--card-bg);color:var(--text)">';
    starPickerHtml += '<button onclick="submitExReview(\''+p._id+'\')" style="background:var(--coral);color:#fff;border:none;border-radius:10px;padding:6px 14px;font-weight:700;font-size:.78rem;cursor:pointer">Invia</button>';
    starPickerHtml += '</div>';
  }
  return '<div class="feed-post exercise-card" id="post-'+p._id+'">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<div class="avatar-circle" style="width:38px;height:38px;background:'+pickColor(a.username)+';cursor:pointer;font-size:.9rem;overflow:hidden;flex-shrink:0" onclick="viewUser(\''+a._id+'\')">'+(a.avatarUrl?'<img src="'+a.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':a.avatar||initials(a.username))+'</div>'
    + '<div style="flex:1;min-width:0"><strong style="font-size:.85rem;display:block">'+escHTML(a.username)+'</strong><span style="font-size:.7rem;color:var(--muted)">'+timeAgo(p.timestamp)+'</span></div>'
    + '<div style="font-family:var(--fh);font-size:1.5rem;font-weight:800;color:'+scoreColor+'">'+score+'%</div>'
    + (canDel?'<button onclick="deletePost(\''+p._id+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;padding:4px;margin-left:4px">🗑️</button>':'')
    + '</div>'
    + '<div style="background:rgba(156,124,255,.06);border-radius:12px;padding:12px 14px;margin-bottom:8px">'
    + '<div style="font-weight:700;font-size:.88rem;color:var(--purple)">'+escHTML(p.exerciseTitle||'Esercizio')+'</div>'
    + (p.exerciseLevel?'<div style="font-size:.72rem;color:var(--muted);margin-top:2px">'+p.exerciseLevel+'</div>':'')
    + starsHtml
    + (p.review?'<div style="font-size:.82rem;color:var(--text);margin-top:6px">"'+escHTML(p.review)+'"</div>':'')
    + '</div>'
    + starPickerHtml
    + '<div class="post-actions" style="padding-top:4px">'
    + '<button class="action-btn'+(ME&&(p.likes||[]).includes(ME._id)?' liked':'')+'" id="like-btn-'+p._id+'" onclick="likePost(\''+p._id+'\',this)"><span class="like-icon">'+(ME&&(p.likes||[]).includes(ME._id)?'❤️':'🤍')+'</span> '+(p.likes||[]).length+'</button>'
    + '<button class="action-btn" onclick="toggleComments(\''+p._id+'\')">💬 <span id="ccount-'+p._id+'">0</span></button>'
    + '</div>'
    + '<div class="comments-box" id="cmts-'+p._id+'"><div id="cmts-list-'+p._id+'"></div>'
    + (ME?'<div class="comment-input-row"><input class="comment-input" id="ci-'+p._id+'" data-pid="'+p._id+'" placeholder="Commenta..." onkeydown="handleCommentKey(event,this)"><button class="comment-send" onclick="addComment(\''+p._id+'\')">➤</button></div>':'')
    + '</div></div>';
}

let _pickedExStars = {};
function pickExStar(pid, val){
  _pickedExStars[pid] = val;
  const picker = document.getElementById('star-pick-'+pid);
  if(!picker) return;
  picker.querySelectorAll('.star-pick-btn').forEach(s => {
    s.style.color = parseInt(s.dataset.val) <= val ? '#FFD700' : 'rgba(0,0,0,.15)';
  });
}
async function submitExReview(pid){
  const rating = _pickedExStars[pid];
  if(!rating){toast('Seleziona le stelle!','error');return;}
  const review = document.getElementById('rev-text-'+pid)?.value?.trim()||'';
  try{
    await POST('/api/posts/'+pid+'/review',{rating,review});
    toast('Recensione inviata!');
    // Aggiorna la card in-place senza ricaricare tutto il feed
    var rateBox = document.getElementById('rate-box-'+pid);
    if(rateBox){
      // Crea il blocco stelle + recensione
      var starsOut = '<div style="margin-top:6px;display:flex;gap:2px">';
      for(var si=1;si<=5;si++){starsOut+='<span style="color:'+(si<=rating?'#FFD700':'rgba(0,0,0,.15)')+';font-size:.95rem">★</span>';}
      starsOut+='</div>';
      if(review) starsOut += '<div style="font-size:.82rem;color:var(--text);margin-top:6px">"'+escHTML(review)+'"</div>';
      // Inserisci le stelle nel box esercizio e rimuovi il form
      var exBox = rateBox.previousElementSibling;
      if(exBox) exBox.insertAdjacentHTML('beforeend', starsOut);
      rateBox.remove();
    }
  }catch(e){toast(e.message,'error');}
}

async function loadSuggestions(){
  try{
    const users=await GET('/api/users/suggestions');
    const bar=document.getElementById('suggestions-bar');
    if(!bar||!users.length)return;
    bar.innerHTML=`<div style="font-weight:700;font-size:.82rem;color:var(--muted);margin-bottom:8px">👥 Persone che potresti conoscere</div>
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none">
        ${users.map(u=>`<div class="sug-card">
          <div class="avatar-circle" style="width:48px;height:48px;background:${pickColor(u.username)};font-size:1.2rem;margin:0 auto 8px;cursor:pointer" onclick="viewUser('${u._id}')">${u.avatarUrl?`<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:u.avatar||initials(u.username)}</div>
          <div style="font-weight:700;font-size:.8rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(u.username)}</div>
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:8px">${u.level||'A1'} · ${u.xp||0} XP</div>
          <button onclick="quickFollow('${u._id}',this)" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:10px;padding:6px 12px;font-family:var(--fb);font-weight:700;font-size:.72rem;cursor:pointer;width:100%">Segui</button>
        </div>`).join('')}
      </div>`;
  }catch{}
}

async function quickFollow(uid,btn){
  try{
    const r=await POST('/api/users/'+uid+'/follow');
    btn.textContent=r.following?'Seguendo ✓':'Segui';
    btn.style.background=r.following?'rgba(0,0,0,.06)':'linear-gradient(135deg,var(--coral),var(--orange))';
    btn.style.color=r.following?'var(--muted)':'#fff';
    if(r.following) toast('Utente seguito! 👥');
    try{ME=await GET('/api/auth/me');}catch{}
  }catch(e){toast(e.message,'error');}
}

async function showFollowList(userId,type){
  try{
    const users=await GET('/api/users/'+userId+'/'+type);
    const title=type==='followers'?'Follower':'Seguiti';
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;z-index:9600;background:rgba(30,30,63,.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    modal.innerHTML=`<div style="background:var(--bg);border-radius:var(--r);width:100%;max-width:400px;max-height:70vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
      <div style="padding:18px 18px 12px;border-bottom:1px solid rgba(0,0,0,.06);display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-family:var(--fh);font-size:1.1rem">${title} (${users.length})</h3>
        <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)">✕</button>
      </div>
      <div style="padding:12px 18px">
        ${users.length?users.map(u=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.04);cursor:pointer" onclick="this.closest('div[style*=fixed]').remove();viewUser('${u._id}')">
          <div class="avatar-circle" style="width:38px;height:38px;background:${pickColor(u.username)};font-size:.9rem">${u.avatarUrl?`<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:u.avatar||initials(u.username)}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(u.username)}</div><div style="font-size:.72rem;color:var(--muted)">${u.level||'A1'} · ${u.xp||0} XP</div></div>
        </div>`).join(''):`<div style="text-align:center;padding:20px;color:var(--muted)">Nessun utente</div>`}
      </div>
    </div>`;
    document.body.appendChild(modal);
  }catch(e){toast(e.message,'error');}
}

async function loadFeed(){ return loadFeedByType(_socialTab); }

function renderPostHTML(p,compact=false){
  if(!p||!p._id)return '';
  const a=p.author||{};
  a.username=a.username||'Utente';
  a.avatar=a.avatar||'👤';
  a.role=a.role||'user';
  a._id=a._id||'';
  a.avatarUrl=a.avatarUrl||'';
  const liked=ME&&(p.likes||[]).includes(ME._id);
  const lcount=(p.likes||[]).length;
  const canDel=!compact&&ME&&(ME._id===p.userId||['admin','superadmin'].includes(ME.role));
  return `<div class="feed-post" id="post-${p._id}">
    <div class="post-header">
      <div class="avatar-circle" style="width:44px;height:44px;background:${pickColor(a.username)};cursor:pointer;font-size:1.1rem;overflow:hidden;flex-shrink:0" onclick="viewUser('${a._id}')">${a.avatarUrl?`<img src="${a.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:a.avatar||initials(a.username)}</div>
      <div class="post-meta" style="flex:1;min-width:0">
        <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(a.username)}${a.role==='admin'?'<span class="role-badge">👩‍🏫</span>':a.role==='superadmin'?'<span class="role-badge">👑</span>':''}${supporterBadge(a)}</strong>
        <span>${timeAgo(p.timestamp)}</span>
      </div>
      ${canDel?`<button onclick="deletePost('${p._id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;padding:4px;flex-shrink:0">🗑️</button>`:''}
    </div>
    ${p.text?`<div class="post-body">${renderMentions(escHTML(p.text))}</div>`:''}
    ${(p.mediaUrl&&typeof p.mediaUrl==='string'&&p.mediaUrl.startsWith('/'))?`<div class="media-in-post">${p.mediaType==='video'
      ?`<video src="${p.mediaUrl}" controls playsinline preload="none" onclick="event.stopPropagation()" style="width:100%;max-height:480px;display:block;background:#000;border-radius:var(--rs)"></video>`
      :`<img src="${p.mediaUrl}" alt="" onclick="openLightbox('${p.mediaUrl}')" loading="lazy" onerror="this.style.display='none'">`
    }</div>`:''}
    ${p.exerciseId?`<div class="ex-result-card"><div class="ex-icon">📝</div><div style="flex:1"><div class="ex-result-title">${escHTML(p.exerciseTitle||'Esercizio')}</div><div style="font-size:.75rem;color:var(--muted)">${p.exerciseLevel||''}</div></div><div class="ex-result-score" style="color:${(p.score||0)>=80?'var(--green)':(p.score||0)>=50?'var(--orange)':'var(--coral)'}">${p.score||0}%</div></div>`:''}
    ${!compact?`<div class="post-actions">
      <button class="action-btn${liked?' liked':''}" id="like-btn-${p._id}" onclick="likePost('${p._id}',this)"><span class="like-icon">${liked?'❤️':'🤍'}</span> ${lcount}</button>
      <button class="action-btn" onclick="toggleComments('${p._id}')">💬 <span id="ccount-${p._id}">0</span></button>
    </div>
    <div class="comments-box" id="cmts-${p._id}">
      <div id="cmts-list-${p._id}"></div>
      ${ME?`<div class="comment-input-row"><input class="comment-input" id="ci-${p._id}" data-pid="${p._id}" placeholder="Scrivi un commento..." onkeydown="handleCommentKey(event,this)"><button class="comment-send" onclick="addComment('${p._id}')">➤</button></div>`:''}
    </div>`:''}
  </div>`;
}

async function loadPostComments(pid){
  try{
    const comments=await GET('/api/posts/'+pid+'/comments');
    const el=document.getElementById('cmts-list-'+pid);
    const cnt=document.getElementById('ccount-'+pid);
    if(cnt)cnt.textContent=comments.length;
    if(el)el.innerHTML=comments.map(c=>{
      const ca=c.author||{username:'?',avatar:'👤'};
      return `<div class="comment-item">
        <div class="avatar-circle" style="width:30px;height:30px;background:${pickColor(ca.username)};font-size:.75rem;cursor:pointer" onclick="viewUser('${ca._id}')">${ca.avatar||initials(ca.username)}</div>
        <div class="comment-bubble"><strong>${escHTML(ca.username)}</strong>${renderMentions(escHTML(c.text))}</div>
      </div>`;
    }).join('');
  }catch{}
}

function handleCommentKey(e,inp){
  if(e.key==='Enter'||e.keyCode===13){
    e.preventDefault();
    const pid=inp.dataset.pid||inp.id.replace('ci-','');
    addComment(pid);
  }
}

function toggleComments(pid){
  const el=document.getElementById('cmts-'+pid);
  if(el)el.classList.toggle('open');
}

async function likePost(pid,btn){
  if(!ME){openAuth();return;}
  try{
    const r=await POST('/api/posts/'+pid+'/like');
    const liked=r.liked;
    btn.className='action-btn'+(liked?' liked':'');
    btn.innerHTML=`<span class="like-icon">${liked?'❤️':'🤍'}</span> ${r.likes}`;
    if(liked){
      checkDailyMission('like3');checkDailyMission('like5');
      // Floating heart animation
      const rect=btn.getBoundingClientRect();
      const h=document.createElement('div');
      h.className='float-heart';
      h.textContent='❤️';
      h.style.left=(rect.left+rect.width/2-12)+'px';
      h.style.top=(rect.top-10)+'px';
      document.body.appendChild(h);
      setTimeout(()=>h.remove(),1000);
    }
  }catch(e){toast(e.message,'error');}
}

async function addComment(pid){
  if(!ME){openAuth();return;}
  const inp=document.getElementById('ci-'+pid);
  const text=inp?.value?.trim();
  if(!text)return;
  try{
    const c=await POST('/api/posts/'+pid+'/comments',{text});
    inp.value='';
    await loadPostComments(pid);
    toast('Commento aggiunto! 💬');checkDailyMission('comment');
  }catch(e){toast(e.message,'error');}
}

// Media pendente per il post
let pendingPostMedia = null; // { url, type }

function handlePostMedia(input, type) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // reset so same file can be re-selected
  if (file.size > 100 * 1024 * 1024) { toast('File troppo grande (max 100MB)','error'); return; }
  if (type === 'image') {
    if (!file.type.startsWith('image/')) { toast('Seleziona un file immagine valido','error'); return; }
    compressImage(file, 1200, 0.85).then(blob => {
      const url = URL.createObjectURL(blob);
      pendingPostMedia = { blob, type: 'image', localUrl: url };
      showPostMediaPreview(url, 'image');
    }).catch(err => {
      console.error('compressImage error:', err);
      // Fallback: use file directly without compression
      const url = URL.createObjectURL(file);
      pendingPostMedia = { file, type: 'image', localUrl: url };
      showPostMediaPreview(url, 'image');
    });
  } else {
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|mov|avi|webm|3gp|mkv)$/i)) {
      toast('Seleziona un file video valido','error'); return;
    }
    const url = URL.createObjectURL(file);
    pendingPostMedia = { file, type: 'video', localUrl: url };
    showPostMediaPreview(url, 'video');
  }
}

function showPostMediaPreview(url, type) {
  const preview = document.getElementById('post-media-preview');
  if (!preview) return;
  preview.innerHTML = `<div class="media-preview-wrap">
    ${type==='video'?`<video src="${url}" controls playsinline style="max-height:180px;border-radius:var(--rs)"></video>`:`<img src="${url}" style="max-height:180px;border-radius:var(--rs);object-fit:cover">`}
    <button class="media-remove-btn" onclick="removePostMedia()">✕</button>
  </div>`;
}

function removePostMedia() {
  pendingPostMedia = null;
  const preview = document.getElementById('post-media-preview');
  if (preview) preview.innerHTML = '';
}

async function createPost(){
  if(!ME){openAuth();return;}
  const text=document.getElementById('new-post-text')?.value?.trim();
  if(!text&&!pendingPostMedia){toast('Scrivi qualcosa o aggiungi una foto!','error');return;}
  const btn=document.querySelector('[onclick="createPost()"]');
  if(btn){btn.disabled=true;btn.textContent='Caricamento...';}
  try{
    let mediaUrl=null, mediaType=null;
    if(pendingPostMedia){
      const fd=new FormData();
      const tok=localStorage.getItem('gc_token');
      if(pendingPostMedia.blob){
        fd.append('file', pendingPostMedia.blob, pendingPostMedia.type==='image'?'photo.jpg':'media.bin');
      } else {
        // Compress image before upload
        const prepared = await prepareMediaForUpload(pendingPostMedia.file, 1200, 0.82);
        fd.append('file', prepared.file, prepared.name);
      }
      const d = await uploadWithProgress('/api/media/upload', fd, {'Authorization':'Bearer '+tok});
      mediaUrl=d.url; mediaType=d.type;
    }
    await POST('/api/posts',{text:text||'',visibility:'public',mediaUrl,mediaType});
    const ta=document.getElementById('new-post-text');
    if(ta) ta.value='';
    removePostMedia();
    toast('Post pubblicato!');checkDailyMission('post');
    await loadFeed();
  }catch(e){
    console.error('createPost error:',e);
    toast(e.message||'Errore pubblicazione','error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Pubblica ✨';}
  }
}

async function deletePost(pid){
  if(!confirm('Eliminare questo post?'))return;
  try{
    const el=document.getElementById('post-'+pid);
    if(el){el.style.opacity='0';el.style.transform='scale(.97)';el.style.transition='all .25s ease';}
    await DEL('/api/posts/'+pid);
    setTimeout(()=>el?.remove(),250);
    toast('Post eliminato','info',1500);
  }catch(e){toast(e.message||'Errore','error');}
}

/* ============================================================
   EXERCISES
============================================================ */
async function renderExercises(){
  const c=document.getElementById('exercises-content');
  if(currentExercise){renderQuiz(c);return;}
  if(window._showLessons){renderLessonsPage(c);return;}
  c.innerHTML=`<div class="section-title">📚 Esercizi</div>
    ${!ME?`<div class="guest-bar"><p>Registrati per salvare i progressi e guadagnare XP!</p><button onclick="openAuth()">Registrati</button></div>`:''}
    ${ME?`<div class="card" onclick="window._showLessons=true;renderExercises()" style="cursor:pointer;display:flex;align-items:center;gap:14px;border-left:3px solid var(--green);padding:16px">
      <div style="font-size:2rem">🎓</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.95rem">Lezioni Strutturate</div>
        <div style="font-size:.78rem;color:var(--muted)">Percorsi step-by-step per ogni livello (A1-C2)</div>
      </div>
      <div style="color:var(--coral);font-size:1.2rem">→</div>
    </div>`:''}
    <div class="level-tabs" id="ltabs"></div>
    <div id="ex-list"><div class="spinner"></div></div>`;
  const levels=['Tutti',...LEVELS];
  const ltabs=document.getElementById('ltabs');
  ltabs.innerHTML=levels.map(l=>`<button class="level-tab${l===currentLevel?' active':''}" onclick="filterLevel('${l}')">${l}</button>`).join('');
  try{
    const exercises=await GET('/api/exercises');
    const exEl=document.getElementById('ex-list');
    if(!exEl)return;
    const filtered=currentLevel==='Tutti'?exercises:exercises.filter(e=>e.level===currentLevel);
    if(!filtered.length){
      exEl.innerHTML=`<div class="empty-state"><div class="ei">📚</div><h3>${ME&&(ME.role==='admin'||ME.role==='superadmin')?'Nessun esercizio ancora':'Nessun esercizio disponibile'}</h3><p>${ME&&(ME.role==='admin'||ME.role==='superadmin')?'Crea il primo esercizio dal pannello CMS!':'Torna presto!'}</p></div>`;
      return;
    }
    exEl.innerHTML=filtered.map(ex=>{
      const done=ME&&(ME.progress||{})[ex._id];
      return `<div class="ex-item${done?' done':''}" onclick="startExercise('${ex._id}')">
        <div class="ex-icon-big">📝</div>
        <div class="ex-info">
          <div class="ex-title">${escHTML(ex.title)}</div>
          <div class="ex-desc">${escHTML(ex.desc||'')}</div>
          <div class="ex-chips">
            <span class="chip">${ex.level}</span>
            <span class="chip teal">${ex.category}</span>
            ${done?`<span class="chip green">✅ ${done.score}%</span>`:''}
            ${ex.pdfUrl?`<span class="chip" style="background:rgba(162,155,254,.15);color:var(--purple)">📄 PDF</span>`:''}
          </div>
        </div>
        ${done?'<span style="font-size:1.3rem">✅</span>':`<span class="ex-pts">+${ex.points}XP</span>`}
      </div>`;
    }).join('');
    window._exercises=exercises;
  }catch(e){
    const exEl=document.getElementById('ex-list');
    if(exEl)exEl.innerHTML=`<div class="empty-state"><div class="ei">⚠️</div><h3>Errore</h3><p>${e.message}</p></div>`;
  }
}

function filterLevel(l){currentLevel=l;renderExercises();}

// ── LEZIONI STRUTTURATE ──
let _lessonLevel = null;
async function renderLessonsPage(c){
  _lessonLevel = _lessonLevel || (ME?.level || 'A1');
  c.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button onclick="window._showLessons=false;renderExercises()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text)">←</button>
      <div class="section-title" style="margin:0;flex:1">Lezioni Strutturate</div>
    </div>
    <div class="level-tabs" id="lesson-ltabs"></div>
    <div id="lessons-list"><div class="spinner"></div></div>`;
  const ltabs=document.getElementById('lesson-ltabs');
  ltabs.innerHTML=LEVELS.map(l=>`<button class="level-tab${l===_lessonLevel?' active':''}" onclick="_lessonLevel='${l}';renderLessonsPage(document.getElementById('exercises-content'))">${l}</button>`).join('');
  try{
    const d=await GET('/api/lessons?level='+_lessonLevel);
    const list=document.getElementById('lessons-list');
    if(!list)return;
    if(!d.lessons.length){list.innerHTML='<div class="empty-state"><div class="ei">📖</div><h3>Nessuna lezione per '+_lessonLevel+' ancora</h3></div>';return;}
    list.innerHTML=`
      <div style="margin-bottom:14px;font-size:.85rem;color:var(--muted)">Progresso: ${d.completedCount}/${d.totalLessons} lezioni completate</div>
      <div class="xp-bar-wrap" style="background:rgba(139,92,246,.1);height:8px;margin-bottom:18px"><div class="xp-bar" style="width:${d.totalLessons?Math.round(d.completedCount/d.totalLessons*100):0}%;background:linear-gradient(90deg,#8B5CF6,#EC4899)"></div></div>
      ${d.lessons.map((l,i)=>`
        <div class="ex-item${l.completed?' done':''}" onclick="openLesson('${l.id}')" style="border-left-color:${l.completed?'var(--green)':'var(--coral)'}">
          <div style="width:36px;height:36px;border-radius:50%;background:${l.completed?'var(--green)':'var(--coral)'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;flex-shrink:0">${i+1}</div>
          <div class="ex-info">
            <div class="ex-title">${escHTML(l.title)}</div>
            <div class="ex-desc">${escHTML(l.desc)}</div>
            ${l.completed?`<span class="chip green" style="margin-top:4px">Completato ${l.score}%</span>`:''}
          </div>
          ${l.completed?'<span style="font-size:1.3rem">✅</span>':`<span class="ex-pts">+${l.xp}XP</span>`}
        </div>
      `).join('')}
    `;
  }catch(e){document.getElementById('lessons-list').innerHTML='<div class="empty-state"><div class="ei">&#x26A0;</div><h3>'+escHTML(e.message)+'</h3></div>';}
}

async function openLesson(lessonId){
  const c=document.getElementById('exercises-content');
  c.innerHTML='<div class="spinner" style="padding:40px 0"></div>';
  try{
    const lesson=await GET('/api/lessons/'+lessonId);
    c.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button onclick="renderLessonsPage(document.getElementById('exercises-content'))" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text)">←</button>
        <div style="flex:1"><div class="section-title" style="margin:0;font-size:1.1rem">${escHTML(lesson.title)}</div><span class="chip" style="margin-top:4px">${lesson.level}</span></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3 style="font-family:var(--fh);font-size:1rem;margin-bottom:10px">📖 Lezione</h3>
        <div style="font-size:.88rem;line-height:1.65;color:var(--text)">${escHTML(lesson.content)}</div>
      </div>
      <div class="card">
        <h3 style="font-family:var(--fh);font-size:1rem;margin-bottom:14px">Quiz (${lesson.quiz.length} domande)</h3>
        <div id="lesson-quiz">
          ${lesson.quiz.map((q,i)=>`
            <div style="margin-bottom:18px;padding-bottom:14px;${i<lesson.quiz.length-1?'border-bottom:1px solid rgba(139,92,246,.06)':''}">
              <div style="font-weight:700;font-size:.88rem;margin-bottom:10px">${i+1}. ${escHTML(q.q)}</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                ${q.opts.map((opt,oi)=>`<button class="quiz-opt lesson-opt" data-q="${i}" data-o="${oi}" onclick="selectLessonOpt(this,${i},${oi})">${escHTML(opt)}</button>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <button onclick="submitLesson('${lessonId}',${lesson.quiz.length})" class="btn-primary" style="margin-top:8px">Verifica risposte</button>
        <div id="lesson-result"></div>
      </div>`;
    window._lessonAnswers=new Array(lesson.quiz.length).fill(-1);
  }catch(e){c.innerHTML='<div class="empty-state"><div class="ei">&#x26A0;</div><h3>'+escHTML(e.message)+'</h3></div>';}
}

function selectLessonOpt(btn,qIdx,optIdx){
  window._lessonAnswers[qIdx]=optIdx;
  document.querySelectorAll(`.lesson-opt[data-q="${qIdx}"]`).forEach(b=>{b.style.borderColor='rgba(139,92,246,.1)';b.style.background='#fff';});
  btn.style.borderColor='var(--coral)';
  btn.style.background='rgba(139,92,246,.06)';
}

async function submitLesson(lessonId,total){
  const answers=window._lessonAnswers||[];
  if(answers.some(a=>a===-1)){toast('Rispondi a tutte le domande!','error');return;}
  try{
    const r=await POST('/api/lessons/'+lessonId+'/submit',{answers});
    const el=document.getElementById('lesson-result');
    // Highlight correct/wrong
    r.results.forEach((res,i)=>{
      document.querySelectorAll(`.lesson-opt[data-q="${i}"]`).forEach(b=>{
        const oi=parseInt(b.dataset.o);
        if(oi===res.correctAnswer) b.classList.add('correct');
        else if(oi===res.userAnswer && !res.correct) b.classList.add('wrong');
        b.disabled=true;b.style.pointerEvents='none';
      });
    });
    el.innerHTML=`
      <div style="text-align:center;margin-top:20px;padding:20px;background:${r.passed?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)'};border-radius:var(--rs)">
        <div style="font-size:2.5rem;margin-bottom:8px">${r.passed?'🎉':'😔'}</div>
        <div style="font-family:var(--fh);font-size:1.3rem;margin-bottom:4px">${r.score}%</div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:10px">${r.correct}/${r.total} corrette${r.xpGained?' — +'+r.xpGained+' XP!':''}</div>
        <div style="font-size:.88rem;font-weight:700;color:${r.passed?'var(--green)':'#EF4444'}">${r.passed?'Lezione superata!':'Devi ottenere almeno 60% per superare'}</div>
        <button onclick="renderLessonsPage(document.getElementById('exercises-content'))" class="btn-primary btn-sm" style="width:auto;padding:10px 24px;margin-top:14px">${r.passed?'Prossima lezione':'Riprova'}</button>
      </div>`;
    if(r.passed&&r.xpGained){ME.xp=(ME.xp||0)+r.xpGained;checkDailyMission('exercise');}
  }catch(e){toast(e.message,'error');}
}

// ── RANDOM LANGUAGE PARTNER (solo APK Android) ──
let _partnerSearching=false;
let _partnerPollInterval=null;

async function findLanguagePartner(){
  if(!IS_NATIVE_APK){toast('Disponibile solo nell\'app Android','info');return;}
  if(_partnerSearching){cancelPartnerSearch();return;}
  _partnerSearching=true;
  const btn=document.getElementById('partner-find-btn');
  if(btn){btn.textContent='Ricerca in corso...';btn.style.background='rgba(139,92,246,.15)';}
  try{
    const r=await POST('/api/partner/find');
    if(r.matched){
      _partnerSearching=false;
      if(btn){btn.textContent='Trova Partner';btn.style.background='';}
      toast('Partner trovato: '+r.partnerName+'! Apro la chat...','success',3000);
      setTimeout(()=>openDMWith(r.partnerId),1000);
    } else {
      // In coda — poll ogni 5s per max 60s
      toast('Sei in coda! Cerco un partner del tuo livello...','info',4000);
      let polls=0;
      _partnerPollInterval=setInterval(async()=>{
        polls++;
        if(polls>12||!_partnerSearching){cancelPartnerSearch();return;}
        try{
          const r2=await POST('/api/partner/find');
          if(r2.matched){
            cancelPartnerSearch();
            toast('Partner trovato: '+r2.partnerName+'!','success',3000);
            setTimeout(()=>openDMWith(r2.partnerId),1000);
          }
        }catch{}
      },5000);
    }
  }catch(e){_partnerSearching=false;toast(e.message,'error');if(btn){btn.textContent='Trova Partner';btn.style.background='';}}
}

function cancelPartnerSearch(){
  _partnerSearching=false;
  clearInterval(_partnerPollInterval);
  POST('/api/partner/cancel').catch(()=>{});
  const btn=document.getElementById('partner-find-btn');
  if(btn){btn.textContent='Trova Partner';btn.style.background='';}
}

function startExercise(exId){
  const exercises=window._exercises||[];
  const ex=exercises.find(e=>e._id===exId);
  if(!ex){toast('Esercizio non trovato','error');return;}
  const qs=ex.questions||[];
  if(!qs.length){toast('Questo esercizio non ha domande ancora','info');return;}
  // Normalizza le domande per assicurare compatibilità
  ex.questions=qs.map(q=>({
    ...q,
    q: q.q||q.question||'',
    opts: q.opts||q.options||[],
    correct: parseInt(q.correct!==undefined?q.correct:(q.correctIndex!==undefined?q.correctIndex:0))||0,
  }));
  currentExercise=ex;
  quizState={qi:0,score:0,answered:false,sharing:true};
  renderExercises();
}

function renderQuiz(c){
  const ex=currentExercise;
  const qs=ex.questions||[];
  if(quizState.qi>=qs.length){renderQuizResult(c);return;}
  const q=qs[quizState.qi];
  const pct=Math.round((quizState.qi/qs.length)*100);
  c.innerHTML=`
    <div class="quiz-wrap">
      <div class="quiz-top">
        <button class="btn-secondary btn-sm" onclick="exitQuiz()" style="width:auto">← Esci</button>
        <div style="flex:1">
          <div style="font-size:.78rem;color:var(--muted);font-weight:700;margin-bottom:4px">Domanda ${quizState.qi+1} / ${qs.length}</div>
          <div class="quiz-progress"><div class="quiz-progress-bar" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="quiz-card">
        <div style="display:flex;gap:7px;margin-bottom:14px;flex-wrap:wrap">
          <span class="chip">${ex.level}</span>
          <span class="chip teal">${ex.category}</span>
          <span class="chip purple">+${ex.points}XP</span>
        </div>
        <div class="quiz-q">${escHTML(q.q||q.question||'')}</div>
        <div class="quiz-opts" id="quiz-opts">
          ${(q.opts||q.options||[]).map((o,i)=>`<button class="quiz-opt" id="qo-${i}" onclick="answerQuiz(${i})">${escHTML(o)}</button>`).join('')}
        </div>
        <div id="quiz-fb"></div>
        <div id="quiz-nav" class="quiz-nav-row hidden">
          <button class="btn-primary" onclick="nextQ()">${quizState.qi+1<qs.length?'Prossima →':'Vedi risultato 🎯'}</button>
        </div>
      </div>
    </div>
  `;
}

function answerQuiz(chosen){
  if(quizState.answered)return;
  quizState.answered=true;
  const q=currentExercise.questions[quizState.qi];
  const correctIdx = parseInt(q.correct !== undefined ? q.correct : (q.correctIndex !== undefined ? q.correctIndex : 0)) || 0;
  const ok=correctIdx===chosen;
  if(ok)quizState.score++;
  document.querySelectorAll('.quiz-opt').forEach((btn,i)=>{
    btn.disabled=true;
    if(i===correctIdx)btn.classList.add('correct');
    else if(i===chosen&&!ok)btn.classList.add('wrong');
  });
  const fb=document.getElementById('quiz-fb');
  if(fb)fb.innerHTML=`<div class="quiz-feedback ${ok?'ok':'no'}">${ok?'✅ Corretto!':'❌ Non corretto!'} ${q.expl?escHTML(q.expl):''}</div>`;
  document.getElementById('quiz-nav')?.classList.remove('hidden');
}

function nextQ(){quizState.qi++;quizState.answered=false;renderExercises();}

function renderQuizResult(c){
  const ex=currentExercise;
  const total=ex.questions.length;
  const pct=Math.round((quizState.score/total)*100);
  const xp=Math.round(ex.points*(pct/100));
  const emoji=pct>=90?'🏆':pct>=70?'🌟':pct>=50?'👍':'💪';
  c.innerHTML=`
    <div class="quiz-wrap">
      <div class="quiz-card">
        <div class="quiz-result">
          <div class="score-circle">${emoji}</div>
          <h2>${pct}%</h2>
          <p>${quizState.score} su ${total} corrette${ME?' · +'+xp+' XP':''}</p>
          ${pct>=90?'<p style="color:var(--green);font-weight:700;font-size:.9rem">🏆 Eccellente!</p>':pct>=70?'<p style="color:var(--teal);font-weight:700;font-size:.9rem">🌟 Ottimo lavoro!</p>':'<p style="color:var(--orange);font-weight:700;font-size:.9rem">💪 Riprova per migliorare!</p>'}
          ${ME?`<div class="share-toggle" onclick="toggleShare(this)">
            <div class="toggle-sw${quizState.sharing?' on':''}"></div>
            <span style="font-size:.88rem;font-weight:700">📢 Condividi nel feed social</span>
          </div>
          ${quizState.sharing?`<textarea id="share-custom-text" class="post-textarea" rows="2" style="margin-bottom:10px" placeholder="Aggiungi un commento (opzionale)..."></textarea>`:''}`:``}
          <div class="form-col" style="gap:8px">
            <button class="btn-primary" onclick="finishExercise()">✅ ${ME&&quizState.sharing?'Condividi & Finisci':'Finisci'}</button>
            <button class="btn-secondary" onclick="restartQuiz()">🔄 Riprova</button>
            <button class="btn-secondary" onclick="exitQuiz()">← Tutti gli esercizi</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleShare(el){
  quizState.sharing=!quizState.sharing;
  el.querySelector('.toggle-sw').classList.toggle('on',quizState.sharing);
  renderQuizResult(document.getElementById('exercises-content'));
}

function restartQuiz(){quizState={qi:0,score:0,answered:false,sharing:true};renderExercises();}
function exitQuiz(){currentExercise=null;renderExercises();}

async function finishExercise(){
  if(!ME){currentExercise=null;renderExercises();return;}
  const ex=currentExercise;
  const total=ex.questions.length;
  const pct=Math.round((quizState.score/total)*100);
  const customText=document.getElementById('share-custom-text')?.value?.trim();
  const shareText=customText||(pct>=90?`Completato "${ex.title}" con ${pct}%! 🏆`:`Completato "${ex.title}" con ${pct}%! ${pct>=70?'🌟':'💪'}`);
  try{
    const r=await POST('/api/exercises/'+ex._id+'/complete',{
      score:pct,
      shareToFeed:quizState.sharing,
      shareText: quizState.sharing?shareText:undefined,
    });
    if(r.user){ME=r.user;renderNavUser();}
    if(r.xpEarned>0){
      toast(`+${r.xpEarned} XP guadagnati! ⚡`,'success',3000);
      const xpEl=document.createElement('div');
      xpEl.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:var(--fh);font-size:2.5rem;color:var(--coral);z-index:9999;pointer-events:none;animation:xpPop 1.2s ease-out forwards;text-shadow:0 4px 20px rgba(255,107,107,.5)';
      xpEl.textContent='+'+r.xpEarned+' XP';
      document.body.appendChild(xpEl);
      setTimeout(()=>xpEl.remove(),1300);
    }
    if(r.leveledUp) setTimeout(()=>toast(`🎉 Level UP! Sei al livello ${r.leveledUp}!`,'success',5000),800);
    if(quizState.sharing&&!r.xpEarned) toast('Risultato condiviso! 🎉');
  }catch(e){toast(e.message,'error');}
  currentExercise=null;
  renderExercises();
}

/* ============================================================
   PROFILE
============================================================ */
async function renderProfile(){
  const c=document.getElementById('profile-content');
  if(!ME){
    c.innerHTML=`<div class="empty-state"><div class="ei">🔒</div><h3>Accedi per vedere il profilo</h3><button class="btn-primary" onclick="openAuth()" style="margin-top:16px;width:auto;padding:12px 28px">Accedi / Registrati</button></div>`;
    return;
  }
  try{ME=await GET('/api/auth/me');}catch{}
  const li=Math.max(0,LEVELS.indexOf(ME.level||'A1'));
  const xpP=XP_LEVELS[li]||0;
  const xpN=li>=LEVELS.length-1?99999:(XP_LEVELS[li+1]||99999);
  const pct=li>=LEVELS.length-1?100:Math.max(0,Math.min(100,Math.round(((ME.xp||0)-xpP)/(xpN-xpP)*100)));
  const avatarHtml=ME.avatarUrl
    ?`<img src="${ME.avatarUrl}?t=${Date.now()}" alt="foto profilo">`
    :(ME.avatar||initials(ME.username));
  c.innerHTML=`
    <div class="profile-hero">
      <div class="profile-avatar-wrap">
        <div class="avatar-circle" style="width:90px;height:90px;background:${pickColor(ME.username)};font-size:2.2rem;overflow:hidden">${avatarHtml}</div>
        <button class="avatar-edit-btn" onclick="openAvatarPicker()" title="Cambia foto profilo">📷</button>
        <input type="file" id="avatar-file-input" accept="image/*" capture="environment" style="display:none" onchange="uploadAvatarPhoto(this)">
      </div>
      <div class="profile-name">${escHTML(ME.username)}</div>
      <div style="opacity:.9;font-size:.9rem">${ME.level} · ${ME.xp||0} XP${ME.role==='admin'?' · 👩‍🏫 Teacher':''}</div>
      <div class="xp-bar-wrap"><div class="xp-bar" style="width:${pct}%"></div></div>
      <small style="opacity:.85">${li>=LEVELS.length-1?"Livello Massimo! 🏆":pct+"% verso "+LEVELS[li+1]}</small>
    </div>
    <div class="follow-row">
      <div class="follow-stat"><div class="fnum">${Object.keys(ME.progress||{}).length}</div><div class="flbl">Esercizi</div></div>
      <div class="follow-stat" onclick="showFollowList('${ME._id}','following')"><div class="fnum">${(ME.following||[]).length}</div><div class="flbl">Seguiti</div></div>
      <div class="follow-stat" onclick="showFollowList('${ME._id}','followers')"><div class="fnum">${(ME.followers||[]).length}</div><div class="flbl">Follower</div></div>
    </div>
    <div class="section-title">🏅 Badge</div>
    <div class="badges-grid">
      ${BADGES_DEF.map(b=>`<div class="badge-item${(ME.badges||[]).includes(b.e)?'':' locked'}"><div class="be">${b.e}</div><div class="bn">${b.n}</div></div>`).join('')}
    </div>
    <div class="settings-card">
      <h3>🎨 Aspetto</h3>
      <div class="dark-toggle-wrap">
        <span class="dark-toggle-label">🌙 Modalita scura</span>
        <button class="dark-toggle${document.documentElement.getAttribute('data-theme')==='dark'?' on':''}" id="dark-mode-toggle" onclick="toggleDarkMode();this.classList.toggle('on')"></button>
      </div>
    </div>
    <div class="settings-card">
      <h3>⚙️ Modifica Profilo</h3>
      <div class="field"><label>Username</label><input type="text" id="s-uname" value="${escAttr(ME.username)}"></div>
      <div class="field"><label>📝 Bio</label><textarea id="s-bio">${escHTML(ME.bio||'')}</textarea></div>
      <div class="field"><label>📍 Città</label><input type="text" id="s-city" value="${escAttr(ME.city||'')}"></div>
      <div class="field"><label>📊 Livello</label>
        <select id="s-level">${LEVELS.map(l=>`<option${l===ME.level?' selected':''}>${l}</option>`).join('')}</select>
      </div>
      <div class="field"><label>🎭 Avatar Emoji (se non hai una foto)</label>
        <div class="avatar-picker">${['😊','🧑','👩','🦊','🐱','🦁','🦋','🌺','🎭','🦄','🧙','🎸'].map(a=>`<span class="av-opt${a===ME.avatar?' sel':''}" onclick="pickAvatar('${a}')">${a}</span>`).join('')}</div>
      </div>
      <button class="btn-primary btn-sm" onclick="saveProfile()" style="width:auto;padding:11px 24px">💾 Salva</button>
    </div>
    <div class="settings-card">
      <h3>📧 Verifica Email</h3>
      ${ME.emailVerified ? '<div class="email-badge verified" style="margin-bottom:8px">✓ Email verificata</div><p style="font-size:.82rem;color:var(--muted)">La tua email e verificata. Puoi usarla per reimpostare la password.</p>'
        : '<div class="email-badge unverified" style="margin-bottom:8px">✗ Email non verificata</div><p style="font-size:.82rem;color:var(--muted);margin-bottom:12px">Verifica la tua email per poter reimpostare la password in futuro o contatta Adri.</p><button class="btn-primary btn-sm" onclick="sendVerifyEmail()" id="verify-email-btn" style="width:auto;padding:11px 24px">📧 Invia email di verifica</button>'}
    </div>
    <div class="settings-card">
      <h3>🔒 Cambia Password</h3>
      <div class="field"><label>Password attuale</label><input type="password" id="s-oldpwd" placeholder="••••••••"></div>
      <div class="field"><label>Nuova password</label><input type="password" id="s-newpwd" placeholder="Min. 6 caratteri"></div>
      <button class="btn-primary btn-sm" onclick="changePwd()" style="width:auto;padding:11px 24px">🔒 Aggiorna</button>
    </div>
    <div class="settings-card" style="background:rgba(255,107,107,.04);border:2px solid rgba(255,107,107,.18)">
      <h3>⚠️ Zona Pericolosa</h3>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:12px">L'eliminazione è definitiva (GDPR). Tutti i tuoi dati verranno rimossi.</p>
      <button onclick="doLogout()" style="background:rgba(0,0,0,.06);border:none;border-radius:var(--rs);padding:10px 20px;font-family:var(--fb);font-weight:700;cursor:pointer;width:100%;margin-bottom:8px">🚪 Disconnetti</button>
      <button onclick="deleteAccount()" style="background:rgba(255,107,107,.12);color:var(--coral);border:2px solid var(--coral);border-radius:var(--rs);padding:10px 20px;font-family:var(--fb);font-weight:700;cursor:pointer;width:100%">🗑️ Elimina Account</button>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Supporto</h3>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:12px">Hai bisogno di aiuto o vuoi sostenere il progetto?</p>
      <button onclick="showPage('support')" style="background:linear-gradient(135deg,var(--coral),var(--pink));color:#fff;border:none;border-radius:var(--rs);padding:10px 20px;font-family:var(--fb);font-weight:700;cursor:pointer;width:100%">Vai a Supporto</button>
    </div>
    <div id="profile-highlights"></div>
  `;
  // Load highlights after profile renders
  loadHighlights(ME._id, document.getElementById('profile-highlights'));
}

let pickedAvatar=null;
function pickAvatar(a){
  pickedAvatar=a;
  document.querySelectorAll('.av-opt').forEach(el=>el.classList.toggle('sel',el.textContent===a));
}

// ── Foto profilo ──────────────────────────────────────────
function openAvatarPicker(){
  // Mostra modal: scegli tra galleria, scatto al momento, o emoji
  const modal=document.createElement('div');
  modal.id='avatar-picker-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:700;background:rgba(30,30,63,.55);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML=`<div style="background:var(--bg);border-radius:28px 28px 0 0;width:100%;max-width:480px;padding:24px 20px 40px;animation:slideSheet .3s cubic-bezier(.34,1.2,.64,1)">
    <div style="width:40px;height:4px;background:rgba(0,0,0,.12);border-radius:4px;margin:0 auto 20px"></div>
    <h3 style="font-family:var(--fh);font-size:1.2rem;margin-bottom:20px;text-align:center">📷 Foto Profilo</h3>
    <div style="display:flex;flex-direction:column;gap:12px">
      <label style="display:flex;align-items:center;gap:14px;background:rgba(78,205,196,.08);border:2px solid rgba(78,205,196,.2);border-radius:16px;padding:16px 18px;cursor:pointer;font-weight:700" for="avatar-cam-input">
        <span style="font-size:1.8rem">📷</span>
        <div><div style="font-size:.95rem">Scatta una foto</div><div style="font-size:.75rem;opacity:.65;font-weight:400">Usa la fotocamera adesso</div></div>
      </label>
      <input type="file" id="avatar-cam-input" accept="image/*" capture="user" style="display:none" onchange="uploadAvatarPhoto(this)">
      
      <label style="display:flex;align-items:center;gap:14px;background:rgba(255,159,67,.08);border:2px solid rgba(255,159,67,.2);border-radius:16px;padding:16px 18px;cursor:pointer;font-weight:700" for="avatar-gal-input">
        <span style="font-size:1.8rem">🖼️</span>
        <div><div style="font-size:.95rem">Scegli dalla galleria</div><div style="font-size:.75rem;opacity:.65;font-weight:400">Carica una foto esistente</div></div>
      </label>
      <input type="file" id="avatar-gal-input" accept="image/*" style="display:none" onchange="uploadAvatarPhoto(this)">
      
      <button onclick="document.getElementById('avatar-picker-modal').remove()" style="background:rgba(0,0,0,.05);border:none;border-radius:14px;padding:14px;font-family:var(--fb);font-weight:700;font-size:.9rem;cursor:pointer;margin-top:4px">✕ Annulla</button>
    </div>
  </div>`;
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function uploadAvatarPhoto(input){
  document.getElementById('avatar-picker-modal')?.remove();
  const file=input.files?.[0];
  if(!file)return;
  try{
    toast('Caricamento foto profilo... 📤','info');
    // Comprimi immagine prima dell'upload
    const blob = await compressImage(file, 400, 0.85);
    const fd=new FormData();
    fd.append('file', blob, 'avatar.jpg');
    const tok=localStorage.getItem('gc_token');
    const r=await fetch('/api/users/me/avatar',{method:'POST',headers:{'Authorization':'Bearer '+tok},body:fd});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Upload fallito');
    ME=d;
    renderNavUser();
    renderProfile();
    toast('Foto profilo aggiornata! 🎉');
  }catch(e){ toast(e.message,'error'); }
  input.value='';
}



async function saveProfile(){
  const updates={
    username:document.getElementById('s-uname')?.value?.trim()||ME.username,
    bio:document.getElementById('s-bio')?.value||'',
    city:document.getElementById('s-city')?.value||'',
    level:document.getElementById('s-level')?.value||ME.level,
  };
  if(pickedAvatar)updates.avatar=pickedAvatar;
  try{
    ME=await PUT('/api/users/me',updates);
    pickedAvatar=null;
    toast('Profilo aggiornato! ✅');
    renderNavUser();
    renderProfile();
  }catch(e){toast(e.message,'error');}
}

async function sendVerifyEmail(){
  const btn=document.getElementById('verify-email-btn');
  if(btn){btn.disabled=true;btn.textContent='Invio in corso...';}
  try{
    await POST('/api/auth/resend-verification');
    toast('Email di verifica inviata! Controlla la tua casella (anche spam)','success',5000);
  }catch(e){toast(e.message||'Errore invio email','error');}
  finally{if(btn){btn.disabled=false;btn.textContent='📧 Invia email di verifica';}}
}

async function changePwd(){
  const cur=document.getElementById('s-oldpwd')?.value;
  const nw=document.getElementById('s-newpwd')?.value;
  if(!cur||!nw){toast('Compila entrambi i campi','error');return;}
  try{
    await PUT('/api/users/me/password',{currentPassword:cur,newPassword:nw});
    document.getElementById('s-oldpwd').value='';
    document.getElementById('s-newpwd').value='';
    toast('Password aggiornata! 🔒');
  }catch(e){toast(e.message,'error');}
}

async function deleteAccount(){
  if(!confirm('Sei sicuro? Questa azione elimina DEFINITIVAMENTE il tuo account e tutti i tuoi dati.'))return;
  try{
    await DEL('/api/users/me');
    localStorage.removeItem('gc_token');
    ME=null;
    renderNavUser();
    toast('Account eliminato. Arrivederci! 👋','info');
    showPage('home');
  }catch(e){toast(e.message,'error');}
}

/* ============================================================
   PROFILO UTENTE (MODALE)
============================================================ */
async function viewUser(uid){
  if(!uid)return;
  const overlay=document.getElementById('user-overlay');
  const inner=document.getElementById('user-modal-inner');
  inner.innerHTML='<div class="spinner" style="padding:30px 0"></div>';
  overlay.classList.add('open');
  try{
    const u=await GET('/api/users/'+uid);
    const isMe=ME&&ME._id===uid;
    const isFollowing=ME&&(ME.following||[]).includes(uid);
    // Controlla stato campanellina
    let bellActive = false;
    if(ME && isFollowing) {
      try { const bs = await GET('/api/users/'+uid+'/notify-status'); bellActive = bs.notify; } catch {}
    }
    inner.innerHTML=`
      <div class="user-modal-hero">
        <button class="user-modal-close" onclick="closeUserModal()">&#x2715;</button>
        <div class="um-avatar-wrap">${u.avatarUrl ? `<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:2.1rem">${u.avatar||initials(u.username)}</span>` : `<span style="font-size:2.1rem">${u.avatar||initials(u.username)}</span>`}</div>
        <div style="font-family:var(--fh);font-size:1.5rem">${escHTML(u.username)}</div>
        <div style="font-size:.85rem;opacity:.85;margin-top:3px">${u.level} &middot; ${u.xp||0} XP</div>
        ${u.bio?`<div style="font-size:.8rem;margin-top:8px;opacity:.85">${escHTML(u.bio)}</div>`:''}
      </div>
      <div class="user-modal-body">
        <div class="user-modal-stats">
          <div class="um-stat"><div class="um-val">${Object.keys(u.progress||{}).length}</div><div class="um-lbl">Esercizi</div></div>
          <div class="um-stat" onclick="showFollowList('${uid}','followers')" style="cursor:pointer"><div class="um-val">${(u.followers||[]).length}</div><div class="um-lbl">Follower</div></div>
          <div class="um-stat" onclick="showFollowList('${uid}','following')" style="cursor:pointer"><div class="um-val">${(u.following||[]).length}</div><div class="um-lbl">Seguiti</div></div>
        </div>
        ${u.badges?.length?`<div style="font-size:1.4rem;margin-bottom:14px">${u.badges.join(' ')}</div>`:''}
        ${!isMe&&ME?`
          <div class="um-action-row">
            <button class="follow-btn${isFollowing?' following':''}" onclick="toggleFollow('${uid}',this)" style="flex:1">${isFollowing?'Seguendo':'Segui'}</button>
            ${isFollowing?`<button class="bell-btn${bellActive?' active':''}" id="bell-btn-${uid}" data-bell-uid="${uid}" title="${bellActive?'Disattiva notifiche':'Attiva notifiche per questo utente'}"><span class="bell-icon">${bellActive?'&#x1F514;':'&#x1F515;'}</span></button>`:''}
          </div>
          <button class="follow-btn" onclick="closeUserModal();openDMWith('${uid}')" style="background:linear-gradient(135deg,var(--teal),var(--blue));margin-top:8px">Invia messaggio</button>
          ${IS_NATIVE_APK?`<div style="display:flex;gap:8px;margin-top:8px">
            <button class="follow-btn" data-call-uid="${uid}" data-call-un="${escAttr(u.username)}" data-call-av="${escAttr(u.avatar||'')}" style="flex:1;background:linear-gradient(135deg,#34C759,#30B350)">Chiama</button>
            <button class="follow-btn" data-ch-uid="${uid}" data-ch-un="${escAttr(u.username)}" data-ch-av="${escAttr(u.avatar||'')}" style="flex:1;background:linear-gradient(135deg,var(--coral),var(--orange))">Sfida 1v1</button>
          </div>`:''}
        `:''}
        ${!ME?`<button class="follow-btn" onclick="closeUserModal();openAuth()">Accedi per seguire</button>`:''}
      </div>
    `;
  }catch(e){
    inner.innerHTML=`<div class="user-modal-body"><div class="empty-state"><div class="ei">&#x26A0;&#xFE0F;</div><h3>Utente non trovato</h3></div></div>`;
  }
  // Bind bell button
  inner.querySelectorAll('[data-bell-uid]').forEach(btn => {
    btn.onclick = () => toggleBell(btn.dataset.bellUid, btn);
  });
  // Bind call/challenge buttons safely (no inline onclick with data)
  inner.querySelectorAll('[data-call-uid]').forEach(btn => {
    btn.onclick = () => { closeUserModal(); callUser(btn.dataset.callUid, btn.dataset.callUn, btn.dataset.callAv, false); };
  });
  inner.querySelectorAll('[data-vid-uid]').forEach(btn => {
    btn.onclick = () => { closeUserModal(); callUser(btn.dataset.vidUid, btn.dataset.vidUn, btn.dataset.vidAv, true); };
  });
  inner.querySelectorAll('[data-ch-uid]').forEach(btn => {
    btn.onclick = () => { closeUserModal(); challengeUser(btn.dataset.chUid, btn.dataset.chUn, btn.dataset.chAv || ''); };
  });
}
function closeUserModal(){document.getElementById('user-overlay').classList.remove('open');}

async function toggleFollow(uid,btn){
  if(!ME)return;
  try{
    const r=await POST('/api/users/'+uid+'/follow');
    btn.textContent=r.following?'Seguendo':'Segui';
    btn.className='follow-btn'+(r.following?' following':'');
    if(r.following){ME.following=[...(ME.following||[]),uid];}
    else {
      ME.following=(ME.following||[]).filter(id=>id!==uid);
      // Rimuovi campanellina se unfollowed
      if(ME.notifyUsers) ME.notifyUsers=ME.notifyUsers.filter(id=>id!==uid);
    }
    toast(r.following?'Ora segui questo utente':'Non segui piu');
    if(r.following) checkDailyMission('follow');
    // Riapri profilo per aggiornare stato campanellina
    if(r.following || !r.following) { closeUserModal(); setTimeout(()=>openUserProfile(uid), 200); }
  }catch(e){toast(e.message,'error');}
}

async function toggleBell(uid, btn){
  if(!ME) return;
  try{
    const r = await POST('/api/users/'+uid+'/notify-toggle');
    const icon = btn.querySelector('.bell-icon');
    if(r.notify){
      btn.classList.add('active');
      if(icon) icon.innerHTML = '&#x1F514;';
      btn.title = 'Disattiva notifiche';
      if(!ME.notifyUsers) ME.notifyUsers = [];
      if(!ME.notifyUsers.includes(uid)) ME.notifyUsers.push(uid);
      toast('Notifiche attivate! Riceverai un avviso quando questo utente pubblica.','success',3000);
    } else {
      btn.classList.remove('active');
      if(icon) icon.innerHTML = '&#x1F515;';
      btn.title = 'Attiva notifiche per questo utente';
      if(ME.notifyUsers) ME.notifyUsers = ME.notifyUsers.filter(id=>id!==uid);
      toast('Notifiche disattivate','info',2000);
    }
  }catch(e){ toast(e.message||'Errore','error'); }
}

/* ============================================================
   NOVITA — Changelog + Consigli + Bug Report (spostato qui)
============================================================ */
async function renderNews(){
  const c=document.getElementById('news-content');
  c.innerHTML='<div class="spinner" style="padding:30px 0"></div>';
  try{
    const [changelog, tip] = await Promise.all([GET('/api/changelog'), GET('/api/tips/random')]);
    c.innerHTML=`
      <div class="section-title" style="margin-bottom:16px">Novita</div>
      
      <div class="tip-card" id="tip-card">
        <div class="tip-cat">${escHTML(tip.cat)} &middot; ${escHTML(tip.level)}</div>
        <div class="tip-text">${escHTML(tip.tip)}</div>
        <button class="tip-refresh" onclick="refreshTip()">Altro consiglio</button>
      </div>

      ${ME?`<div style="margin:16px 0">
        <button class="btn-primary" onclick="showPage('support')" style="width:100%;background:linear-gradient(135deg,var(--coral),var(--pink))">Supporto e Segnalazioni</button>
      </div>`:''}

      ${ME&&(ME.role==='admin'||ME.role==='superadmin'||ME.username?.toLowerCase()==='giada')?`
        <button class="btn-primary" onclick="openGiadaSuggestions()" style="width:100%;background:linear-gradient(135deg,var(--purple),#6c63ff);margin-bottom:16px">Suggerimenti Esercizi per Giada</button>
      `:''}

      <div class="section-title" style="margin-top:20px;margin-bottom:12px">Changelog</div>
      ${changelog.map(v=>`
        <div class="changelog-card">
          <div class="cl-header">
            <span class="cl-version">v${escHTML(v.version)}</span>
            <span class="cl-date">${escHTML(v.date)}</span>
          </div>
          <div class="cl-title">${escHTML(v.title)}</div>
          <div class="cl-changes">${v.changes.map(ch=>`<div class="cl-change">${escHTML(ch)}</div>`).join('')}</div>
        </div>
      `).join('')}
    `;
  }catch(e){
    c.innerHTML=`<div class="empty-state"><div class="ei">&#x26A0;&#xFE0F;</div><h3>Errore caricamento</h3><p>${escHTML(e.message)}</p></div>`;
  }
}

async function refreshTip(){
  try{
    const tip=await GET('/api/tips/random'+(ME?'?level='+ME.level:''));
    const card=document.getElementById('tip-card');
    if(card){
      card.querySelector('.tip-cat').textContent=tip.cat+' \u00B7 '+tip.level;
      card.querySelector('.tip-text').textContent=tip.tip;
      card.style.animation='none'; card.offsetHeight; card.style.animation='tipFadeIn .4s ease';
    }
  }catch{}
}

// ── SUPPORTER MEDAL BADGE HELPER ──
function supporterBadge(user){
  if(!user?.supporterMedal) return '';
  const m = user.supporterMedal;
  if(m.expiresAt && m.expiresAt < Date.now()) return '';
  const months = m.months || 1;
  const color = months >= 6 ? '#FFD700' : months >= 3 ? '#C0C0C0' : '#CD7F32';
  const label = months >= 12 ? 'Supporter VIP' : 'Supporter '+months+'m';
  return `<span style="display:inline-flex;align-items:center;gap:2px;background:linear-gradient(135deg,${color}20,${color}10);border:1px solid ${color}40;color:${color};border-radius:10px;padding:1px 6px;font-size:.6rem;font-weight:800;margin-left:4px;vertical-align:middle;white-space:nowrap" title="${label}">&#x2B50; ${label}</span>`;
}

// ── SUPPORT PAGE ──
async function renderSupport(){
  const c=document.getElementById('support-content');
  if(!c)return;
  const isAdri = ME?.username?.toLowerCase()==='adri' || ME?.role==='superadmin';

  c.innerHTML=`
    <div class="section-title" style="margin-bottom:16px">Supporto</div>

    <div class="card" style="text-align:center;background:linear-gradient(135deg,rgba(139,92,246,.06),rgba(236,72,153,.04));border:1.5px solid rgba(139,92,246,.12)">
      <div style="font-size:2.5rem;margin-bottom:10px">&#x2615;</div>
      <h3 style="font-family:var(--fh);font-size:1.2rem;margin-bottom:6px;color:var(--dark)">Supporta GiadaCourses</h3>
      <p style="font-size:.84rem;color:var(--muted);margin-bottom:16px;line-height:1.5">Ti piace GiadaCourses? Aiutaci a crescere con una donazione! Riceverai una medaglia Supporter visibile a tutti.</p>
      <a href="https://ko-fi.com/m4ct0n1ght" target="_blank" rel="noopener" style="display:block;width:100%;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;border:none;border-radius:var(--rs);padding:14px;font-family:var(--fb);font-weight:700;font-size:1rem;text-decoration:none;text-align:center;box-shadow:0 4px 16px rgba(139,92,246,.25)">&#x2615; Dona su Ko-fi</a>
      <p style="font-size:.72rem;color:var(--muted);margin-top:10px">Dopo la donazione, contatta Adri per ricevere la tua medaglia!</p>
    </div>

    <div class="card">
      <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:12px">&#x1F41B; Segnala un problema</h3>
      <p style="font-size:.82rem;color:var(--muted);margin-bottom:12px;line-height:1.5">Qualcosa non funziona? Descrivi il problema e il team lo risolverà.</p>
      <textarea id="support-bug-text" placeholder="Descrivi il problema..." style="width:100%;border:1.5px solid rgba(139,92,246,.12);border-radius:var(--rs);padding:12px;font-family:var(--fb);font-size:.88rem;resize:none;height:80px;outline:none;background:var(--bg);color:var(--text)"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <label style="flex-shrink:0;background:rgba(139,92,246,.08);border:1.5px solid rgba(139,92,246,.15);border-radius:var(--rs);padding:9px 14px;cursor:pointer;font-size:.82rem;font-weight:600;color:var(--coral)">
          &#x1F4F7; Screenshot
          <input type="file" id="support-bug-file" accept="image/*" style="display:none">
        </label>
        <span id="support-file-name" style="flex:1;font-size:.75rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        <button onclick="submitSupportTicket()" class="btn-primary btn-sm" style="width:auto;flex-shrink:0;padding:9px 18px">Invia</button>
      </div>
    </div>

    <div id="my-tickets-section"></div>

    ${isAdri?`
    <div class="section-title" style="margin-top:24px;margin-bottom:12px">&#x1F6E0;&#xFE0F; Gestione Ticket (Admin)</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button onclick="loadAdminTickets('open')" id="tk-filter-open" class="btn-primary btn-sm" style="flex:1;padding:9px;font-size:.82rem">Aperti</button>
      <button onclick="loadAdminTickets('resolved')" id="tk-filter-resolved" class="btn-secondary btn-sm" style="flex:1;padding:9px;font-size:.82rem">Risolti</button>
      <button onclick="loadAdminTickets('all')" id="tk-filter-all" class="btn-secondary btn-sm" style="flex:1;padding:9px;font-size:.82rem">Tutti</button>
    </div>
    <div id="admin-tickets-list"><div class="spinner"></div></div>

    <div class="section-title" style="margin-top:24px;margin-bottom:12px">&#x2B50; Assegna Medaglia Supporter</div>
    <div class="card">
      <div class="field"><label>Username utente</label><input type="text" id="medal-username" placeholder="username"></div>
      <div class="field"><label>Durata (mesi)</label>
        <select id="medal-months" style="width:100%;border:1.5px solid rgba(139,92,246,.12);border-radius:var(--rs);padding:10px;font-family:var(--fb);outline:none;background:#fff">
          <option value="1">1 mese</option>
          <option value="2">2 mesi</option>
          <option value="3">3 mesi</option>
          <option value="6">6 mesi</option>
          <option value="12">12 mesi (VIP)</option>
        </select>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="assignSupporterMedal()" class="btn-primary btn-sm" style="flex:1;padding:10px">Assegna</button>
        <button onclick="removeSupporterMedal()" class="btn-secondary btn-sm" style="flex-shrink:0;padding:10px;color:#EF4444">Rimuovi</button>
      </div>
    </div>
    `:''}
  `;

  // File name display
  const fileInput=document.getElementById('support-bug-file');
  if(fileInput) fileInput.onchange=()=>{
    const nameEl=document.getElementById('support-file-name');
    if(nameEl) nameEl.textContent=fileInput.files[0]?.name||'';
  };

  // Load user's own tickets
  loadMyTickets();
  // Load admin tickets if Adri
  if(isAdri) loadAdminTickets('open');
}

async function submitSupportTicket(){
  const text=document.getElementById('support-bug-text')?.value?.trim();
  if(!text){toast('Descrivi il problema','error');return;}
  try{
    const fd=new FormData();
    fd.append('text',text);
    fd.append('page',currentPage||'unknown');
    const file=document.getElementById('support-bug-file')?.files[0];
    if(file) fd.append('file',file);
    const tok=localStorage.getItem('gc_token');
    const r=await fetch('/api/bug-report',{method:'POST',headers:{'Authorization':'Bearer '+tok},body:fd});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Errore');
    document.getElementById('support-bug-text').value='';
    document.getElementById('support-file-name').textContent='';
    toast('Segnalazione inviata! Ti risponderemo presto.');
    loadMyTickets();
  }catch(e){toast(e.message,'error');}
}

async function loadMyTickets(){
  const section=document.getElementById('my-tickets-section');
  if(!section)return;
  try{
    const tickets=await GET('/api/bug-reports?status=all');
    const mine=tickets.filter(t=>t.userId===ME?._id);
    if(!mine.length){section.innerHTML='';return;}
    section.innerHTML=`
      <div class="section-title" style="margin-top:16px;margin-bottom:10px;font-size:1rem">Le mie segnalazioni</div>
      ${mine.slice(0,10).map(t=>`
        <div class="card" style="padding:14px;border-left:3px solid ${t.status==='resolved'?'var(--green)':'var(--coral)'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:.72rem;font-weight:700;color:${t.status==='resolved'?'var(--green)':'var(--coral)'};text-transform:uppercase">${t.status==='resolved'?'Risolto':'Aperto'}</span>
            <span style="font-size:.7rem;color:var(--muted)">${timeAgo(t.timestamp)}</span>
          </div>
          <div style="font-size:.85rem;line-height:1.4">${escHTML(t.text).substring(0,150)}${t.text.length>150?'...':''}</div>
          ${t.resolvedBy?`<div style="font-size:.7rem;color:var(--green);margin-top:4px">Risolto da ${escHTML(t.resolvedBy)}</div>`:''}
        </div>
      `).join('')}
    `;
  }catch{}
}

async function loadAdminTickets(status){
  const list=document.getElementById('admin-tickets-list');
  if(!list)return;
  // Update filter buttons
  ['open','resolved','all'].forEach(s=>{
    const btn=document.getElementById('tk-filter-'+s);
    if(btn){btn.className=s===status?'btn-primary btn-sm':'btn-secondary btn-sm';btn.style.flex='1';btn.style.padding='9px';btn.style.fontSize='.82rem';}
  });
  list.innerHTML='<div class="spinner"></div>';
  try{
    const tickets=await GET('/api/bug-reports?status='+status);
    if(!tickets.length){list.innerHTML='<div class="empty-state" style="padding:20px"><div class="ei">&#x2705;</div><h3>Nessun ticket '+(status==='open'?'aperto':status==='resolved'?'risolto':'')+'</h3></div>';return;}
    list.innerHTML=tickets.map(t=>`
      <div class="card" style="padding:14px;margin-bottom:10px;border-left:3px solid ${t.status==='resolved'?'var(--green)':'var(--coral)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <strong style="font-size:.88rem;cursor:pointer;color:var(--coral)" onclick="viewUser('${t.userId}')">${escHTML(t.username)}</strong>
            <span style="font-size:.68rem;font-weight:700;padding:2px 6px;border-radius:8px;background:${t.status==='resolved'?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};color:${t.status==='resolved'?'var(--green)':'#EF4444'}">${t.status==='resolved'?'RISOLTO':'APERTO'}</span>
          </div>
          <span style="font-size:.7rem;color:var(--muted)">${timeAgo(t.timestamp)}</span>
        </div>
        <div style="font-size:.84rem;line-height:1.5;margin-bottom:8px">${escHTML(t.text)}</div>
        ${t.screenshotUrl?`<img src="${t.screenshotUrl}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px;cursor:pointer" onclick="openLightbox('${t.screenshotUrl}')">`:''}
        <div style="font-size:.7rem;color:var(--muted);margin-bottom:8px">Dispositivo: ${escHTML((t.device||'').substring(0,60))} | Pagina: ${escHTML(t.page||'?')}</div>
        <div style="display:flex;gap:6px">
          ${t.status==='open'?`
            <button onclick="resolveTicket('${t._id}')" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:10px;padding:8px;font-size:.78rem;font-weight:700;cursor:pointer">Risolto</button>
            <button onclick="openDMWith('${t.userId}')" style="flex:1;background:rgba(139,92,246,.1);color:var(--coral);border:1.5px solid rgba(139,92,246,.15);border-radius:10px;padding:8px;font-size:.78rem;font-weight:700;cursor:pointer">Rispondi in DM</button>
          `:`
            <button onclick="reopenTicket('${t._id}')" style="flex:1;background:rgba(251,191,36,.1);color:#D97706;border:1.5px solid rgba(251,191,36,.2);border-radius:10px;padding:8px;font-size:.78rem;font-weight:700;cursor:pointer">Riapri</button>
          `}
        </div>
      </div>
    `).join('');
  }catch(e){list.innerHTML='<div class="empty-state"><div class="ei">&#x26A0;&#xFE0F;</div><h3>Errore</h3><p>'+escHTML(e.message)+'</p></div>';}
}

async function resolveTicket(id){
  try{
    await POST('/api/bug-reports/'+id+'/resolve');
    toast('Ticket chiuso!');
    loadAdminTickets('open');
  }catch(e){toast(e.message,'error');}
}
async function reopenTicket(id){
  try{
    await POST('/api/bug-reports/'+id+'/reopen');
    toast('Ticket riaperto');
    loadAdminTickets('resolved');
  }catch(e){toast(e.message,'error');}
}

async function assignSupporterMedal(){
  const username=document.getElementById('medal-username')?.value?.trim();
  const months=document.getElementById('medal-months')?.value;
  if(!username){toast('Inserisci lo username','error');return;}
  try{
    // Find user by username
    const users=await GET('/api/users/search?q='+encodeURIComponent(username));
    const user=users?.find(u=>u.username.toLowerCase()===username.toLowerCase());
    if(!user){toast('Utente non trovato','error');return;}
    await POST('/api/supporter/'+user._id,{months:parseInt(months)||1});
    toast('Medaglia Supporter '+months+' mese/i assegnata a '+username+'!');
    document.getElementById('medal-username').value='';
  }catch(e){toast(e.message,'error');}
}
async function removeSupporterMedal(){
  const username=document.getElementById('medal-username')?.value?.trim();
  if(!username){toast('Inserisci lo username','error');return;}
  try{
    const users=await GET('/api/users/search?q='+encodeURIComponent(username));
    const user=users?.find(u=>u.username.toLowerCase()===username.toLowerCase());
    if(!user){toast('Utente non trovato','error');return;}
    await DEL('/api/supporter/'+user._id);
    toast('Medaglia rimossa da '+username);
    document.getElementById('medal-username').value='';
  }catch(e){toast(e.message,'error');}
}

async function openGiadaSuggestions(){
  try{
    const d=await GET('/api/giada/suggestions');
    const ov=document.getElementById('user-overlay');
    const inner=document.getElementById('user-modal-inner');
    inner.innerHTML=`
      <div class="user-modal-hero" style="background:linear-gradient(135deg,var(--purple),#6c63ff)">
        <button class="user-modal-close" onclick="closeUserModal()">&#x2715;</button>
        <div style="font-size:2.5rem;margin-bottom:8px">&#x1F4A1;</div>
        <div style="font-family:var(--fh);font-size:1.3rem">Suggerimenti Esercizi</div>
        <div style="font-size:.82rem;opacity:.8;margin-top:4px">${d.stats.totalExercises} esercizi &middot; ${d.stats.totalUsers} utenti</div>
      </div>
      <div class="user-modal-body" style="max-height:60vh;overflow-y:auto">
        <div style="font-weight:700;margin-bottom:10px;font-size:.9rem">Tipi di esercizio disponibili:</div>
        ${d.stats.exerciseTypes.map(t=>`<div style="padding:6px 0;font-size:.82rem"><strong>${escHTML(t.name)}</strong>: ${escHTML(t.desc)}</div>`).join('')}
        <div style="font-weight:700;margin:16px 0 10px;font-size:.9rem">Suggerimenti (${d.suggestions.length}):</div>
        ${d.suggestions.map(s=>`
          <div style="background:rgba(0,0,0,.04);border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:.82rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:700">${escHTML(s.level||'')} ${escHTML(s.category||s.typeName||'')}</span>
              <span style="background:${s.priority==='alta'?'var(--coral)':'var(--orange)'};color:#fff;border-radius:8px;padding:2px 8px;font-size:.7rem;font-weight:700">${escHTML(s.priority)}</span>
            </div>
            <div style="color:var(--muted)">${escHTML(s.reason)}</div>
          </div>
        `).join('')}
      </div>`;
    ov.classList.add('open');
  }catch(e){toast(e.message||'Errore','error');}
}

/* ============================================================
   GIOCHI — Minigiochi educativi
============================================================ */
let currentGame=null;

async function renderGames(){
  const c=document.getElementById('games-content');
  const lvl=ME?ME.level:'A1';
  c.innerHTML=`
    <div class="section-title" style="margin-bottom:16px">Giochi</div>
    <div class="games-level-select">
      <span style="font-size:.82rem;font-weight:700;color:var(--muted)">Livello:</span>
      <select id="game-level" style="border:2px solid rgba(0,0,0,.08);border-radius:12px;padding:6px 12px;font-family:var(--fb);font-weight:700;font-size:.85rem;background:#fff;cursor:pointer">
        <option value="A1" ${lvl==='A1'?'selected':''}>A1</option>
        <option value="A2" ${lvl==='A2'?'selected':''}>A2</option>
        <option value="B1" ${lvl==='B1'?'selected':''}>B1</option>
        <option value="B2" ${lvl==='B2'?'selected':''}>B2</option>
      </select>
    </div>

    <div class="games-grid">
      <div class="game-card" onclick="startWordScramble()">
        <div class="game-icon">&#x1F500;</div>
        <div class="game-title">Word Scramble</div>
        <div class="game-desc">Riordina le lettere per formare la parola corretta</div>
        <div class="game-xp">+10 XP / parola</div>
      </div>
      <div class="game-card" onclick="startSpeedMatch()">
        <div class="game-icon">&#x26A1;</div>
        <div class="game-title">Speed Match</div>
        <div class="game-desc">Abbina le parole inglesi alla traduzione il piu velocemente possibile</div>
        <div class="game-xp">+5 XP / coppia</div>
      </div>
      <div class="game-card" onclick="startFillGap()">
        <div class="game-icon">&#x270D;&#xFE0F;</div>
        <div class="game-title">Fill the Gap</div>
        <div class="game-desc">Completa le frasi scegliendo la parola giusta</div>
        <div class="game-xp">+15 XP / frase</div>
      </div>
      <div class="game-card" style="opacity:.4;pointer-events:none">
        <div class="game-icon">&#x1F3A4;</div>
        <div class="game-title">Listening Quiz</div>
        <div class="game-desc">Ascolta e rispondi — Prossimamente!</div>
        <div class="game-xp">In arrivo</div>
      </div>
    </div>

    <div id="game-arena" style="display:none"></div>
  `;
}

function getGameLevel(){ return document.getElementById('game-level')?.value || 'A1'; }

// ── WORD SCRAMBLE ──
async function startWordScramble(){
  const level=getGameLevel();
  try{
    const d=await GET('/api/games/word-scramble?level='+level);
    currentGame={type:'scramble',gameId:d.gameId,words:d.words,current:0,answers:[],startTime:Date.now()};
    renderScrambleQuestion();
  }catch(e){toast('Errore: '+e.message,'error');}
}

function renderScrambleQuestion(){
  const g=currentGame; if(!g||g.type!=='scramble')return;
  const arena=document.getElementById('game-arena');
  const gamesGrid=document.querySelector('.games-grid');
  const lvlSelect=document.querySelector('.games-level-select');
  if(gamesGrid)gamesGrid.style.display='none';
  if(lvlSelect)lvlSelect.style.display='none';
  arena.style.display='block';
  
  if(g.current>=g.words.length){ submitScrambleAnswers(); return; }
  const w=g.words[g.current];
  arena.innerHTML=`
    <div class="game-header">
      <span class="game-progress">${g.current+1}/${g.words.length}</span>
      <button class="game-quit" onclick="quitGame()">&#x2715; Esci</button>
    </div>
    <div class="game-play-card">
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">Riordina le lettere:</div>
      <div class="scramble-letters">${w.scrambled.split('').map(l=>`<span class="scramble-letter">${l}</span>`).join('')}</div>
      <div style="font-size:.82rem;margin:12px 0 4px;color:var(--muted)">${escHTML(w.hint)}</div>
      <div style="font-size:.75rem;color:var(--purple);font-weight:700">${escHTML(w.it)} &middot; ${w.length} lettere</div>
      <input type="text" class="game-input" id="scramble-input" placeholder="Scrivi la parola..." maxlength="${w.length+2}" autocomplete="off" autocapitalize="characters">
      <button class="btn-primary" onclick="nextScramble()" style="width:100%;margin-top:12px">Avanti</button>
    </div>`;
  setTimeout(()=>document.getElementById('scramble-input')?.focus(),100);
  document.getElementById('scramble-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')nextScramble();});
}

function nextScramble(){
  const val=document.getElementById('scramble-input')?.value||'';
  currentGame.answers.push(val.trim());
  currentGame.current++;
  renderScrambleQuestion();
}

async function submitScrambleAnswers(){
  const g=currentGame;
  try{
    const d=await POST('/api/games/word-scramble/check',{gameId:g.gameId,answers:g.answers});
    const elapsed=Math.round((Date.now()-g.startTime)/1000);
    document.getElementById('game-arena').innerHTML=`
      <div class="game-result-card">
        <div style="font-size:2.5rem;margin-bottom:8px">${d.score>=4?'&#x1F3C6;':d.score>=2?'&#x2B50;':'&#x1F4AA;'}</div>
        <div class="game-result-title">${d.score}/${d.total} corrette!</div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Tempo: ${elapsed}s &middot; +${d.xpEarned} XP</div>
        ${d.results.map((r,i)=>`
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.85rem;border-bottom:1px solid rgba(0,0,0,.04)">
            <span>${r.correct?'&#x2705;':'&#x274C;'}</span>
            <span style="flex:1;font-weight:${r.correct?'400':'700'};color:${r.correct?'var(--text)':'var(--coral)'}">${escHTML(r.answer)}</span>
            <span style="color:var(--muted);font-size:.75rem">${escHTML(g.answers[i]||'-')}</span>
          </div>
        `).join('')}
        <button class="btn-primary" onclick="quitGame();startWordScramble()" style="width:100%;margin-top:16px">Gioca ancora</button>
        <button class="btn-secondary" onclick="quitGame()" style="width:100%;margin-top:8px">Torna ai giochi</button>
      </div>`;
    if(ME&&d.xpEarned) ME.xp=(ME.xp||0)+d.xpEarned;
  }catch(e){toast('Errore: '+e.message,'error');quitGame();}
}

// ── SPEED MATCH ──
async function startSpeedMatch(){
  const level=getGameLevel();
  try{
    const d=await GET('/api/games/speed-match?level='+level);
    const pairs=d.pairs;
    const arena=document.getElementById('game-arena');
    const gamesGrid=document.querySelector('.games-grid');
    const lvlSelect=document.querySelector('.games-level-select');
    if(gamesGrid)gamesGrid.style.display='none';
    if(lvlSelect)lvlSelect.style.display='none';
    arena.style.display='block';
    
    // Shuffle both columns independently
    const leftItems=pairs.map((p,i)=>({text:p.en,idx:i,type:'en'})).sort(()=>Math.random()-.5);
    const rightItems=pairs.map((p,i)=>({text:p.it,idx:i,type:'it'})).sort(()=>Math.random()-.5);
    
    currentGame={type:'match',pairs,matched:new Set(),selected:null,startTime:Date.now(),errors:0};
    
    arena.innerHTML=`
      <div class="game-header">
        <span class="game-progress" id="match-progress">0/${pairs.length}</span>
        <span class="game-timer" id="match-timer">0s</span>
        <button class="game-quit" onclick="quitGame()">&#x2715;</button>
      </div>
      <div style="font-size:.85rem;text-align:center;color:var(--muted);margin-bottom:12px">Tocca una parola inglese, poi la sua traduzione</div>
      <div class="match-grid">
        <div class="match-col" id="match-left">${leftItems.map(it=>`<button class="match-item" data-idx="${it.idx}" data-type="en" onclick="matchSelect(this)">${escHTML(it.text)}</button>`).join('')}</div>
        <div class="match-col" id="match-right">${rightItems.map(it=>`<button class="match-item" data-idx="${it.idx}" data-type="it" onclick="matchSelect(this)">${escHTML(it.text)}</button>`).join('')}</div>
      </div>`;
    
    const timerInt=setInterval(()=>{
      if(!currentGame||currentGame.type!=='match'){clearInterval(timerInt);return;}
      const el=document.getElementById('match-timer');
      if(el)el.textContent=Math.round((Date.now()-currentGame.startTime)/1000)+'s';
    },500);
    currentGame._timerInt=timerInt;
  }catch(e){toast('Errore: '+e.message,'error');}
}

function matchSelect(btn){
  const g=currentGame; if(!g||g.type!=='match')return;
  const idx=parseInt(btn.dataset.idx);
  const type=btn.dataset.type;
  
  if(g.matched.has(idx))return;
  
  if(!g.selected){
    g.selected={idx,type,btn};
    btn.classList.add('selected');
    return;
  }
  
  // Second selection
  if(g.selected.type===type){
    // Same column - deselect first, select new
    g.selected.btn.classList.remove('selected');
    g.selected={idx,type,btn};
    btn.classList.add('selected');
    return;
  }
  
  // Different columns - check match
  if(g.selected.idx===idx){
    // Correct match!
    g.matched.add(idx);
    g.selected.btn.classList.remove('selected');
    g.selected.btn.classList.add('matched');
    btn.classList.add('matched');
    g.selected=null;
    document.getElementById('match-progress').textContent=g.matched.size+'/'+g.pairs.length;
    
    if(g.matched.size===g.pairs.length){
      clearInterval(g._timerInt);
      const elapsed=Math.round((Date.now()-g.startTime)/1000);
      const xp=g.pairs.length*5;
      if(ME){ME.xp=(ME.xp||0)+xp; db_users_update_xp(xp);}
      setTimeout(()=>{
        document.getElementById('game-arena').innerHTML=`
          <div class="game-result-card">
            <div style="font-size:2.5rem;margin-bottom:8px">&#x1F3C6;</div>
            <div class="game-result-title">Completato!</div>
            <div style="font-size:.85rem;color:var(--muted);margin-bottom:8px">Tempo: ${elapsed}s &middot; Errori: ${g.errors} &middot; +${xp} XP</div>
            <button class="btn-primary" onclick="quitGame();startSpeedMatch()" style="width:100%;margin-top:16px">Gioca ancora</button>
            <button class="btn-secondary" onclick="quitGame()" style="width:100%;margin-top:8px">Torna ai giochi</button>
          </div>`;
      },400);
    }
  } else {
    // Wrong match
    g.errors++;
    g.selected.btn.classList.remove('selected');
    g.selected.btn.classList.add('wrong');
    btn.classList.add('wrong');
    setTimeout(()=>{
      g.selected?.btn?.classList.remove('wrong');
      btn.classList.remove('wrong');
    },500);
    g.selected=null;
  }
}

async function db_users_update_xp(xp){
  try{await POST('/api/exercises/xp-only',{xp});}catch{}
}

// ── FILL THE GAP ──
async function startFillGap(){
  const level=getGameLevel();
  try{
    const d=await GET('/api/games/fill-gap?level='+level);
    currentGame={type:'fill',gameId:d.gameId,questions:d.questions,current:0,answers:[],startTime:Date.now()};
    renderFillQuestion();
  }catch(e){toast('Errore: '+e.message,'error');}
}

function renderFillQuestion(){
  const g=currentGame; if(!g||g.type!=='fill')return;
  const arena=document.getElementById('game-arena');
  const gamesGrid=document.querySelector('.games-grid');
  const lvlSelect=document.querySelector('.games-level-select');
  if(gamesGrid)gamesGrid.style.display='none';
  if(lvlSelect)lvlSelect.style.display='none';
  arena.style.display='block';
  
  if(g.current>=g.questions.length){ submitFillAnswers(); return; }
  const q=g.questions[g.current];
  arena.innerHTML=`
    <div class="game-header">
      <span class="game-progress">${g.current+1}/${g.questions.length}</span>
      <button class="game-quit" onclick="quitGame()">&#x2715; Esci</button>
    </div>
    <div class="game-play-card">
      <div style="font-size:1rem;font-weight:700;line-height:1.6;margin-bottom:20px;text-align:center">${escHTML(q.sentence)}</div>
      <div class="fill-options">${q.options.map((opt,i)=>`<button class="fill-option" onclick="selectFillOption('${escAttr(opt)}',this)">${escHTML(opt)}</button>`).join('')}</div>
    </div>`;
}

function selectFillOption(val,btn){
  document.querySelectorAll('.fill-option').forEach(b=>{b.classList.remove('selected');b.disabled=true;});
  btn.classList.add('selected');
  currentGame.answers.push(val);
  setTimeout(()=>{currentGame.current++;renderFillQuestion();},600);
}

async function submitFillAnswers(){
  const g=currentGame;
  try{
    const d=await POST('/api/games/fill-gap/check',{gameId:g.gameId,answers:g.answers});
    const elapsed=Math.round((Date.now()-g.startTime)/1000);
    document.getElementById('game-arena').innerHTML=`
      <div class="game-result-card">
        <div style="font-size:2.5rem;margin-bottom:8px">${d.score>=4?'&#x1F3C6;':d.score>=2?'&#x2B50;':'&#x1F4AA;'}</div>
        <div class="game-result-title">${d.score}/${d.total} corrette!</div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:16px">Tempo: ${elapsed}s &middot; +${d.xpEarned} XP</div>
        ${d.results.map((r,i)=>`
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:.85rem;border-bottom:1px solid rgba(0,0,0,.04)">
            <span>${r.correct?'&#x2705;':'&#x274C;'}</span>
            <span style="flex:1"><strong>${escHTML(r.answer)}</strong></span>
            ${!r.correct?`<span style="color:var(--coral);font-size:.78rem;text-decoration:line-through">${escHTML(g.answers[i]||'')}</span>`:''}
          </div>
        `).join('')}
        <button class="btn-primary" onclick="quitGame();startFillGap()" style="width:100%;margin-top:16px">Gioca ancora</button>
        <button class="btn-secondary" onclick="quitGame()" style="width:100%;margin-top:8px">Torna ai giochi</button>
      </div>`;
    if(ME&&d.xpEarned) ME.xp=(ME.xp||0)+d.xpEarned;
  }catch(e){toast('Errore: '+e.message,'error');quitGame();}
}

function quitGame(){
  if(currentGame?._timerInt)clearInterval(currentGame._timerInt);
  currentGame=null;
  const arena=document.getElementById('game-arena');
  if(arena)arena.style.display='none';
  const gamesGrid=document.querySelector('.games-grid');
  const lvlSelect=document.querySelector('.games-level-select');
  if(gamesGrid)gamesGrid.style.display='';
  if(lvlSelect)lvlSelect.style.display='';
}

// ── LISTENING QUIZ (Web Speech API) ──
var _listeningQuestions = {
  A1:[
    {audio:'Hello, how are you?',opts:['Come stai?','Dove sei?','Chi sei?','Cosa fai?'],correct:0},
    {audio:'I have a red car.',opts:['Ho una macchina rossa','Ho un gatto rosso','Ho una casa rossa','Ho un libro rosso'],correct:0},
    {audio:'The cat is on the table.',opts:['Il gatto e sul tavolo','Il gatto e sotto il tavolo','Il cane e sul tavolo','Il gatto e nella stanza'],correct:0},
    {audio:'What is your name?',opts:['Come ti chiami?','Dove abiti?','Quanti anni hai?','Cosa mangi?'],correct:0},
    {audio:'I like pizza and pasta.',opts:['Mi piacciono pizza e pasta','Mi piace il pesce','Non mi piace la pizza','Mangio sempre riso'],correct:0}
  ],
  A2:[
    {audio:'She goes to school every morning.',opts:['Va a scuola ogni mattina','Va al lavoro ogni sera','Va al parco ogni mattina','Resta a casa ogni mattina'],correct:0},
    {audio:'Can you help me find the station?',opts:['Puoi aiutarmi a trovare la stazione?','Puoi portarmi a casa?','Sai dove e il ristorante?','Puoi chiamare un taxi?'],correct:0},
    {audio:'The weather is beautiful today.',opts:['Il tempo e bello oggi','Piove molto oggi','Fa freddo oggi','Nevica oggi'],correct:0},
    {audio:'I would like a cup of tea, please.',opts:['Vorrei una tazza di te, per favore','Vorrei un caffe, per favore','Vorrei un bicchiere di acqua','Vorrei un panino, per favore'],correct:0},
    {audio:'They are playing football in the park.',opts:['Stanno giocando a calcio nel parco','Stanno correndo nel parco','Stanno nuotando in piscina','Stanno studiando a casa'],correct:0}
  ],
  B1:[
    {audio:'If I had more time, I would travel around the world.',opts:['Se avessi piu tempo, viaggerei per il mondo','Se avessi soldi, comprerei una casa','Se potessi, andrei al cinema','Se fossi ricco, non lavorerei'],correct:0},
    {audio:'The meeting has been postponed until next Friday.',opts:['La riunione e stata rimandata a venerdi prossimo','La riunione e stata cancellata','La riunione e oggi pomeriggio','La riunione inizia subito'],correct:0},
    {audio:'Despite the rain, we decided to go for a walk.',opts:['Nonostante la pioggia, abbiamo deciso di fare una passeggiata','A causa della pioggia siamo rimasti a casa','Abbiamo aspettato che smettesse di piovere','La pioggia ci ha impedito di uscire'],correct:0}
  ],
  B2:[
    {audio:'Had I known about the delay, I would have taken an earlier flight.',opts:['Se avessi saputo del ritardo, avrei preso un volo precedente','Ho preso il volo in ritardo','Non sapevo del ritardo','Il volo e stato cancellato'],correct:0},
    {audio:'The company is committed to reducing its carbon footprint by thirty percent.',opts:['L\'azienda si impegna a ridurre le emissioni del trenta per cento','L\'azienda ha aumentato la produzione','L\'azienda chiudera il prossimo anno','L\'azienda ha assunto trenta persone'],correct:0}
  ]
};

async function startListeningQuiz(){
  var level = getGameLevel();
  var questions = _listeningQuestions[level] || _listeningQuestions.A1;
  // Shuffle and take 5
  var shuffled = questions.slice().sort(function(){return Math.random()-.5}).slice(0,5);
  currentGame = {type:'listening', questions:shuffled, current:0, score:0, total:shuffled.length};
  renderListeningQuestion();
}

function renderListeningQuestion(){
  var g = currentGame;
  if(!g || g.type !== 'listening') return;
  if(g.current >= g.total){
    finishListeningQuiz();
    return;
  }
  var q = g.questions[g.current];
  var arena = document.getElementById('game-arena');
  document.querySelector('.games-grid').style.display='none';
  document.querySelector('.games-level-select').style.display='none';
  arena.style.display='block';
  var optsH = '';
  for(var i=0; i<q.opts.length; i++){
    optsH += '<button class="quiz-opt" onclick="answerListening('+i+')" style="width:100%;text-align:left;padding:14px 18px;margin-bottom:8px;border:2px solid rgba(0,0,0,.08);border-radius:14px;background:#fff;font-family:var(--fb);font-size:.88rem;cursor:pointer;transition:all .2s">'+escHTML(q.opts[i])+'</button>';
  }
  arena.innerHTML = '<div class="game-active-card">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<span style="font-weight:700;font-size:.82rem;color:var(--muted)">Domanda '+(g.current+1)+'/'+g.total+'</span>'
    + '<button onclick="quitGame()" style="background:none;border:none;font-size:.9rem;cursor:pointer;color:var(--muted)">x</button></div>'
    + '<div style="text-align:center;margin-bottom:20px">'
    + '<button onclick="speakListening()" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--teal),var(--blue));border:none;cursor:pointer;font-size:2rem;color:#fff;box-shadow:0 8px 20px rgba(78,205,196,.3);display:flex;align-items:center;justify-content:center;margin:0 auto">&#x1F50A;</button>'
    + '<div style="font-size:.78rem;color:var(--muted);margin-top:8px">Tocca per ascoltare</div></div>'
    + '<div style="font-weight:700;font-size:.88rem;margin-bottom:12px;color:var(--dark)">Cosa significa?</div>'
    + optsH + '</div>';
  // Auto-play
  setTimeout(function(){speakListening();},400);
}

function speakListening(){
  var g = currentGame;
  if(!g || g.type !== 'listening') return;
  var q = g.questions[g.current];
  if('speechSynthesis' in window){
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(q.audio);
    u.lang = 'en-US'; u.rate = 0.85; u.pitch = 1;
    // Try to get a good English voice
    var voices = window.speechSynthesis.getVoices();
    var enVoice = voices.find(function(v){return v.lang.startsWith('en') && v.name.includes('Female');}) || voices.find(function(v){return v.lang.startsWith('en');});
    if(enVoice) u.voice = enVoice;
    window.speechSynthesis.speak(u);
  } else {
    toast('Il tuo browser non supporta la sintesi vocale','error');
  }
}

function answerListening(idx){
  var g = currentGame;
  if(!g || g.type !== 'listening') return;
  var q = g.questions[g.current];
  var btns = document.querySelectorAll('.quiz-opt');
  btns.forEach(function(b,i){
    b.disabled = true;
    if(i === q.correct) b.style.borderColor = '#34C759';
    if(i === idx && idx !== q.correct) b.style.borderColor = '#FF3B30';
  });
  if(idx === q.correct) g.score++;
  g.current++;
  setTimeout(function(){renderListeningQuestion();},1200);
}

function finishListeningQuiz(){
  var g = currentGame;
  var pct = Math.round(g.score/g.total*100);
  var xp = g.score * 15;
  var arena = document.getElementById('game-arena');
  arena.innerHTML = '<div class="game-active-card" style="text-align:center">'
    + '<div style="font-size:3rem;margin-bottom:12px">'+(pct>=80?'&#x1F3C6;':pct>=50?'&#x1F44D;':'&#x1F4AA;')+'</div>'
    + '<div style="font-family:var(--fh);font-size:1.3rem;margin-bottom:6px">'+g.score+'/'+g.total+' corrette!</div>'
    + '<div style="font-size:.88rem;color:var(--muted);margin-bottom:16px">Hai guadagnato +'+xp+' XP</div>'
    + '<button class="btn-primary" onclick="quitGame();startListeningQuiz()" style="width:100%">Gioca ancora</button>'
    + '<button class="btn-secondary" onclick="quitGame()" style="width:100%;margin-top:8px">Torna ai giochi</button></div>';
  if(ME && xp > 0){
    ME.xp = (ME.xp||0) + xp;
    POST('/api/games/word-scramble/check',{gameId:'listen',answers:[]}).catch(function(){});
  }
}

// ── SONDAGGI / POLL ──
async function showPollSection(){
  var arena = document.getElementById('game-arena');
  document.querySelector('.games-grid').style.display='none';
  document.querySelector('.games-level-select').style.display='none';
  arena.style.display='block';
  arena.innerHTML = '<div class="spinner"></div>';
  try{
    var polls = await GET('/api/polls');
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    h += '<div style="font-family:var(--fh);font-size:1.1rem">Sondaggi</div>';
    h += '<div style="display:flex;gap:8px">';
    h += '<button onclick="quitGame()" class="btn-secondary" style="padding:8px 14px;font-size:.78rem;border-radius:10px">Indietro</button>';
    if(ME&&(ME.role==='admin'||ME.role==='superadmin')) h += '<button onclick="showCreatePoll()" class="btn-primary" style="padding:8px 14px;font-size:.78rem;border-radius:10px">+ Crea</button>';
    h += '</div></div>';
    if(!polls.length){
      h += '<div class="empty-state"><h3>Nessun sondaggio</h3><p>Crea il primo sondaggio per la community!</p></div>';
    }
    for(var pi=0; pi<polls.length; pi++){
      h += renderPollCard(polls[pi]);
    }
    arena.innerHTML = h;
  }catch(e){toast(e.message,'error');quitGame();}
}

function renderPollCard(p){
  var myVote = -1;
  var totalV = 0;
  for(var oi=0; oi<p.options.length; oi++){
    totalV += p.options[oi].votes.length;
    if(ME && p.options[oi].votes.indexOf(ME._id) !== -1) myVote = oi;
  }
  var h = '<div class="feed-post" style="margin-bottom:14px;padding:16px">';
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
  h += '<div class="avatar-circle" style="width:32px;height:32px;background:'+pickColor(p.author?.username||'')+';font-size:.75rem">'+(p.author?.avatarUrl?'<img src="'+p.author.avatarUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':initials(p.author?.username||''))+'</div>';
  h += '<div style="flex:1"><strong style="font-size:.82rem">'+escHTML(p.author?.username||'')+'</strong><span style="font-size:.7rem;color:var(--muted);margin-left:6px">'+timeAgo(p.createdAt)+'</span></div>';
  if(ME && (p.authorId===ME._id || ME.role==='superadmin')) h += '<button onclick="deletePoll(\''+p._id+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem">&#x1F5D1;</button>';
  h += '</div>';
  h += '<div style="font-weight:700;font-size:.92rem;margin-bottom:12px;color:var(--dark)">'+escHTML(p.question)+'</div>';
  for(var i=0; i<p.options.length; i++){
    var pct = totalV > 0 ? Math.round(p.options[i].votes.length / totalV * 100) : 0;
    var isMyVote = (i === myVote);
    if(myVote >= 0){
      // Show results
      h += '<div style="position:relative;margin-bottom:6px;border-radius:10px;overflow:hidden;background:rgba(0,0,0,.04);padding:11px 14px">';
      h += '<div style="position:absolute;top:0;left:0;height:100%;width:'+pct+'%;background:'+(isMyVote?'rgba(156,124,255,.2)':'rgba(0,0,0,.04)')+';border-radius:10px;transition:width .5s"></div>';
      h += '<div style="position:relative;display:flex;justify-content:space-between;align-items:center">';
      h += '<span style="font-size:.84rem;font-weight:'+(isMyVote?'700':'400')+'">'+(isMyVote?'&#x2713; ':'')+escHTML(p.options[i].text)+'</span>';
      h += '<span style="font-size:.78rem;font-weight:700;color:var(--muted)">'+pct+'%</span>';
      h += '</div></div>';
    } else {
      h += '<button onclick="votePoll(\''+p._id+'\','+i+')" style="width:100%;text-align:left;padding:11px 14px;margin-bottom:6px;border:2px solid rgba(0,0,0,.08);border-radius:10px;background:#fff;font-family:var(--fb);font-size:.84rem;cursor:pointer;transition:all .15s">';
      h += escHTML(p.options[i].text)+'</button>';
    }
  }
  h += '<div style="font-size:.72rem;color:var(--muted);margin-top:6px">'+totalV+' vot'+(totalV===1?'o':'i')+'</div>';
  h += '</div>';
  return h;
}

function showCreatePoll(){
  var arena = document.getElementById('game-arena');
  arena.innerHTML = '<div class="game-active-card">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<div style="font-family:var(--fh);font-size:1.05rem">Crea sondaggio</div>'
    + '<button onclick="showPollSection()" style="background:none;border:none;font-size:.9rem;cursor:pointer;color:var(--muted)">x</button></div>'
    + '<input type="text" id="poll-question" placeholder="La tua domanda..." style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:12px;padding:12px 14px;font-family:var(--fb);font-size:.9rem;margin-bottom:12px;outline:none">'
    + '<div id="poll-options">'
    + '<input type="text" class="poll-opt-input" placeholder="Opzione 1" style="width:100%;border:2px solid rgba(0,0,0,.06);border-radius:10px;padding:10px 14px;font-family:var(--fb);font-size:.85rem;margin-bottom:6px;outline:none">'
    + '<input type="text" class="poll-opt-input" placeholder="Opzione 2" style="width:100%;border:2px solid rgba(0,0,0,.06);border-radius:10px;padding:10px 14px;font-family:var(--fb);font-size:.85rem;margin-bottom:6px;outline:none">'
    + '</div>'
    + '<button onclick="addPollOption()" style="background:none;border:1px dashed rgba(0,0,0,.15);border-radius:10px;padding:8px;width:100%;font-size:.8rem;color:var(--muted);cursor:pointer;margin-bottom:14px">+ Aggiungi opzione</button>'
    + '<button onclick="submitPoll()" class="btn-primary" style="width:100%;border-radius:12px;padding:13px">Pubblica sondaggio</button>'
    + '</div>';
}

function addPollOption(){
  var container = document.getElementById('poll-options');
  if(!container) return;
  var count = container.querySelectorAll('.poll-opt-input').length;
  if(count >= 6){toast('Massimo 6 opzioni','error');return;}
  var inp = document.createElement('input');
  inp.type='text'; inp.className='poll-opt-input'; inp.placeholder='Opzione '+(count+1);
  inp.style.cssText='width:100%;border:2px solid rgba(0,0,0,.06);border-radius:10px;padding:10px 14px;font-family:var(--fb);font-size:.85rem;margin-bottom:6px;outline:none';
  container.appendChild(inp);
}

async function submitPoll(){
  var q = document.getElementById('poll-question')?.value?.trim();
  if(!q){toast('Scrivi una domanda','error');return;}
  var inputs = document.querySelectorAll('.poll-opt-input');
  var opts = [];
  inputs.forEach(function(inp){var v=inp.value.trim();if(v)opts.push(v);});
  if(opts.length < 2){toast('Servono almeno 2 opzioni','error');return;}
  try{
    await POST('/api/polls',{question:q,options:opts});
    toast('Sondaggio pubblicato!');
    showPollSection();
  }catch(e){toast(e.message,'error');}
}

async function votePoll(pollId,optIdx){
  try{
    await POST('/api/polls/'+pollId+'/vote',{optionIndex:optIdx});
    toast('Voto registrato!');
    showPollSection();
  }catch(e){toast(e.message,'error');}
}

async function deletePoll(pollId){
  if(!confirm('Eliminare questo sondaggio?'))return;
  try{
    await DEL('/api/polls/'+pollId);
    toast('Sondaggio eliminato');
    showPollSection();
  }catch(e){toast(e.message,'error');}
}

// ── HIGHLIGHTS STORIE ──
async function loadHighlights(userId,container){
  try{
    var hls = await GET('/api/highlights/'+userId);
    if(!hls.length) return;
    var h = '<div style="margin-bottom:16px"><div style="font-weight:700;font-size:.88rem;margin-bottom:10px;display:flex;align-items:center;gap:6px"><span style="font-size:1rem">&#x2B50;</span> In evidenza</div>';
    h += '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none">';
    for(var i=0; i<hls.length; i++){
      var hl = hls[i];
      var cover = hl.coverUrl || '';
      h += '<div onclick="viewHighlight(\''+hl._id+'\')" style="flex-shrink:0;text-align:center;cursor:pointer">';
      h += '<div style="width:64px;height:64px;border-radius:50%;border:2px solid var(--purple);padding:2px;margin-bottom:4px">';
      if(cover) h += '<img src="'+cover+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
      else h += '<div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--coral));display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.2rem">&#x2B50;</div>';
      h += '</div>';
      h += '<div style="font-size:.68rem;font-weight:600;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHTML(hl.name)+'</div>';
      h += '</div>';
    }
    // Add button if own profile
    if(ME && userId === ME._id){
      h += '<div onclick="createHighlight()" style="flex-shrink:0;text-align:center;cursor:pointer">';
      h += '<div style="width:64px;height:64px;border-radius:50%;border:2px dashed rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--muted);margin-bottom:4px">+</div>';
      h += '<div style="font-size:.68rem;color:var(--muted)">Nuovo</div></div>';
    }
    h += '</div></div>';
    if(container){
      container.insertAdjacentHTML('afterbegin', h);
    }
  }catch(e){}
}

async function viewHighlight(hlId){
  try{
    var userId = ME?._id;
    // Find the highlight among all loaded
    var hls = await GET('/api/highlights/'+(userId||''));
    var hl = hls.find(function(h){return h._id === hlId;});
    if(!hl || !hl.stories?.length){toast('Nessun contenuto','error');return;}
    // Show as story viewer
    window._storyGroups = [{user:{username:ME?.username||'',avatar:ME?.avatar||'',avatarUrl:ME?.avatarUrl||''},items:hl.stories.map(function(s){return {_id:s._id||hlId,mediaUrl:s.mediaUrl||'',mediaType:s.mediaType||'image',bgTemplate:s.bgTemplate||'',caption:s.caption||'',userId:userId,duration:15,timestamp:Date.now()};})}];
    window.currentStoryGroup = 0;
    window.currentStoryIdx = 0;
    if(typeof showStory === 'function') showStory();
  }catch(e){toast(e.message,'error');}
}

async function createHighlight(){
  // Load user's recent stories
  try{
    var stories = await GET('/api/stories');
    var myStories = stories.filter(function(s){return s.userId === ME._id;});
    if(!myStories.length){toast('Non hai storie da aggiungere. Crea prima una storia!','error');return;}
    var name = prompt('Nome per la raccolta in evidenza:');
    if(!name) return;
    var storyIds = myStories.map(function(s){return s._id;});
    await POST('/api/highlights',{name:name,storyIds:storyIds,coverUrl:myStories[0]?.mediaUrl||''});
    toast('Raccolta creata!');
    renderProfile();
  }catch(e){toast(e.message,'error');}
}

/* ============================================================
   LEADERBOARD
============================================================ */
let lbFilter='total';
async function renderLeaderboard(){
  const c=document.getElementById('lb-content');
  c.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="section-title" style="margin:0">🏆 Classifica</div>
      <button onclick="loadLeaderboard()" style="background:var(--grad);color:#fff;border:none;border-radius:20px;padding:6px 14px;font-family:var(--fb);font-weight:700;font-size:.78rem;cursor:pointer">Aggiorna</button>
    </div>
    <div class="lb-filters">
      <button class="lb-filter-btn${lbFilter==='total'?' active':''}" onclick="lbFilter='total';renderLeaderboard()">Totale</button>
      <button class="lb-filter-btn${lbFilter==='week'?' active':''}" onclick="lbFilter='week';renderLeaderboard()">Settimana</button>
      <button class="lb-filter-btn${lbFilter==='streak'?' active':''}" onclick="lbFilter='streak';renderLeaderboard()">Streak</button>
      <button class="lb-filter-btn${lbFilter==='A1'?' active':''}" onclick="lbFilter='A1';renderLeaderboard()">A1</button>
      <button class="lb-filter-btn${lbFilter==='A2'?' active':''}" onclick="lbFilter='A2';renderLeaderboard()">A2</button>
      <button class="lb-filter-btn${lbFilter==='B1'?' active':''}" onclick="lbFilter='B1';renderLeaderboard()">B1+</button>
    </div>
    <div id="lb-list"><div class="spinner"></div></div>`;
  await loadLeaderboard();
}

async function loadLeaderboard(){
  const lb=document.getElementById('lb-list');
  if(!lb)return;
  try{
    let users=await GET('/api/leaderboard');
    // Apply filter
    if(lbFilter==='streak') users=users.slice().sort((a,b)=>(b.streak||0)-(a.streak||0));
    else if(lbFilter==='week') users=users.slice().sort((a,b)=>{
      const aW=Object.values(a.progress||{}).filter(p=>p.completedAt>Date.now()-604800000).length;
      const bW=Object.values(b.progress||{}).filter(p=>p.completedAt>Date.now()-604800000).length;
      return bW-aW;
    });
    else if(['A1','A2','B1','B2','C1','C2'].includes(lbFilter)){
      const lvlOrder=['A1','A2','B1','B2','C1','C2'];
      const minIdx=lvlOrder.indexOf(lbFilter);
      users=users.filter(u=>lvlOrder.indexOf(u.level||'A1')>=minIdx);
    }
    if(!users.length){lb.innerHTML=`<div class="empty-state"><div class="ei">🏆</div><h3>Nessun risultato</h3><p>Completa esercizi per entrare in classifica!</p></div>`;return;}
    // Build podium for top 3
    const top3=users.slice(0,3);
    const rest=users.slice(3);
    const podiumOrder=[top3[1],top3[0],top3[2]].filter(Boolean); // 2nd,1st,3rd visually
    const podiumClasses=['p2','p1','p3'];
    const podiumMedals=['🥈','🥇','🥉'];
    const podiumHeights=['','',''];
    const podiumHTML=top3.length>=1?`
      <div class="lb-podium">
        ${podiumOrder.map((u,pi)=>{
          const realRank=users.indexOf(u);
          const cls=podiumClasses[pi];
          const medal=podiumMedals[pi];
          const scoreVal=lbFilter==='streak'?(u.streak||0):(u.xp||0);
          const scoreLabel=lbFilter==='streak'?'giorni':'XP';
          const avatarContent=u.avatarUrl?`<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover">`:(u.avatar||initials(u.username));
          return `<div class="podium-slot ${cls}" onclick="viewUser('${u._id}')">
            <div class="podium-medal">${medal}</div>
            <div class="podium-avatar" style="background:${pickColor(u.username)}">${avatarContent}</div>
            <div class="podium-name">${escHTML(u.username)}${ME&&ME._id===u._id?' (Tu)':''}</div>
            <div class="podium-xp">${scoreVal}<small style="font-size:.65rem"> ${scoreLabel}</small></div>
            <div class="podium-base">${cls==='p1'?'1°':cls==='p2'?'2°':'3°'}</div>
          </div>`;
        }).join('')}
      </div>`:'' ;
    const listHTML=rest.map((u,i)=>{
      const rank=i+4;
      const scoreVal=lbFilter==='streak'?(u.streak||0):(u.xp||0);
      const scoreLabel=lbFilter==='streak'?'gg':'XP';
      const avatarContent=u.avatarUrl?`<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(u.avatar||initials(u.username));
      const streakBadge=(u.streak||0)>=7?` <span style="font-size:.85rem" title="${u.streak} giorni di streak">🔥</span>`:'';
      return `<div class="lb-item${ME&&ME._id===u._id?' me':''}" onclick="viewUser('${u._id}')" style="cursor:pointer">
        <div class="lb-rank">${rank}</div>
        <div class="avatar-circle" style="width:42px;height:42px;background:${pickColor(u.username)};font-size:1rem;overflow:hidden;flex-shrink:0">${avatarContent}</div>
        <div class="lb-info">
          <strong>${escHTML(u.username)}${ME&&ME._id===u._id?' <span style="color:var(--coral)">(Tu)</span>':''}${streakBadge}${supporterBadge(u)}</strong>
          <span>${u.level||'A1'} · streak ${u.streak||0} · ${(u.badges||[]).slice(0,3).join(' ')}</span>
        </div>
        <div class="lb-xp">${scoreVal}<small style="font-size:.68rem;color:var(--muted);display:block">${scoreLabel}</small></div>
      </div>`;
    }).join('');
    lb.innerHTML=podiumHTML+listHTML;
  }catch(e){
    lb.innerHTML=`<div class="empty-state"><div class="ei">⚠️</div><h3>${e.message}</h3></div>`;
  }
}

/* ============================================================
   ADMIN CMS (GIADA)
============================================================ */
async function renderAdmin(){
  const c=document.getElementById('admin-content');
  if(!ME||!(ME.role==='admin'||ME.role==='superadmin')){
    c.innerHTML=`<div class="empty-state"><div class="ei">🔒</div><h3>Accesso Negato</h3></div>`;
    return;
  }
  const TABS=[{id:'exercises',label:'📚 Esercizi'},{id:'newex',label:editingEx?'✏️ Modifica':'➕ Nuovo'},{id:'blog',label:'📰 Blog'},{id:'newpost',label:'✏️ Articolo'}];
  c.innerHTML=`
    <div class="section-title">🎨 Pannello CMS – ${escHTML(ME.username)}</div>
    <div class="admin-tabs">${TABS.map(t=>`<button class="admin-tab${t.id===adminTab?' active':''}" onclick="adminTab='${t.id}';renderAdmin()">${t.label}</button>`).join('')}</div>
    <div id="admin-tab-body"></div>
  `;
  const body=document.getElementById('admin-tab-body');
  if(adminTab==='exercises')    await renderAdminExList(body);
  else if(adminTab==='newex')   renderAdminExForm(body);
  else if(adminTab==='blog')    await renderAdminBlogList(body);
  else if(adminTab==='newpost') renderAdminBlogForm(body);
}

async function renderAdminExList(c){
  c.innerHTML='<div class="spinner"></div>';
  try{
    const exercises=await GET('/api/exercises');
    if(!exercises.length){
      c.innerHTML=`<div class="card"><div class="empty-state"><div class="ei">📚</div><h3>Nessun esercizio</h3><p>Crea il primo esercizio!</p></div><button class="btn-primary" onclick="adminTab='newex';renderAdmin()">➕ Crea Esercizio</button></div>`;
      return;
    }
    c.innerHTML=`<div class="card">
      <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:14px">📚 Esercizi Pubblicati (${exercises.length})</h3>
      ${exercises.map(ex=>`<div class="admin-ex-item">
        <div class="info"><div class="title">${escHTML(ex.title)}</div><div class="meta">${ex.type} · ${ex.level} · ${ex.category} · ${ex.points}XP · ${(ex.questions||[]).length} domande</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn-edit" onclick="editExercise('${ex._id}')">✏️</button>
          <button class="btn-del" onclick="deleteExercise('${ex._id}')">🗑️</button>
        </div>
      </div>`).join('')}
      <button class="btn-primary btn-sm" onclick="adminTab='newex';editingEx=null;qBlocks=[];renderAdmin()" style="margin-top:12px;width:auto;padding:10px 22px">➕ Nuovo Esercizio</button>
    </div>`;
    window._exercises=exercises;
  }catch(e){c.innerHTML=`<p style="color:var(--coral)">${e.message}</p>`;}
}

function renderAdminExForm(c){
  const ex=editingEx;
  if(!qBlocks.length){
    qBlocks=ex?.questions?.length?ex.questions.map((q,i)=>({id:i,...q})):[{id:0,q:'',opts:['','','',''],correct:0,expl:''}];
  }
  c.innerHTML=`<div class="card">
    <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:14px">${ex?'✏️ Modifica Esercizio':'➕ Nuovo Esercizio'}</h3>
    <div class="form-col">
      <input type="text" id="ex-title" placeholder="Titolo dell'esercizio *" value="${escAttr(ex?.title||'')}">
      <div class="form-row-2">
        <select id="ex-level">${LEVELS.map(l=>`<option${ex?.level===l?' selected':''}>${l}</option>`).join('')}</select>
        <select id="ex-category">${['Grammatica','Vocabolario','Business','Lettura','Ascolto','Conversazione'].map(cat=>`<option${ex?.category===cat?' selected':''}>${cat}</option>`).join('')}</select>
      </div>
      <div class="form-row-2">
        <select id="ex-type"><option value="quiz"${ex?.type==='quiz'?' selected':''}>📝 Quiz</option><option value="fill"${ex?.type==='fill'?' selected':''}>✏️ Fill-in</option><option value="read"${ex?.type==='read'?' selected':''}>📖 Reading</option></select>
        <input type="number" id="ex-points" placeholder="XP (es. 50)" value="${ex?.points||50}" min="10" max="500">
      </div>
      <textarea id="ex-desc" placeholder="Descrizione breve...">${escHTML(ex?.desc||'')}</textarea>
    </div>
    <div style="margin:18px 0;font-weight:700;font-size:.95rem">📝 Domande del Quiz</div>
    <div id="q-blocks">${qBlocks.map((q,i)=>renderQBlock(q,i)).join('')}</div>
    <button onclick="addQBlock()" style="background:rgba(162,155,254,.12);color:var(--purple);border:none;border-radius:var(--rs);padding:9px 18px;font-family:var(--fb);font-weight:700;font-size:.85rem;cursor:pointer;margin-top:8px">+ Aggiungi domanda</button>
    <div style="margin-top:18px;padding:14px;background:rgba(162,155,254,.07);border-radius:var(--rs);border:2px dashed rgba(162,155,254,.3)">
      <div style="font-weight:700;font-size:.9rem;margin-bottom:10px;color:var(--purple)">📄 Allegato PDF (facoltativo)</div>
      ${ex?.pdfUrl?`<div id="ex-pdf-preview" style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:rgba(162,155,254,.15);border-radius:var(--rs)"><span>📄</span><a href="${ex.pdfUrl}" target="_blank" style="flex:1;font-size:.82rem;color:var(--purple);font-weight:700">PDF allegato</a><button onclick="document.getElementById('ex-pdf-url').value='';document.getElementById('ex-pdf-preview').style.display='none'" style="background:none;border:none;color:var(--coral);cursor:pointer">✕ Rimuovi</button></div>`:''}
      <input type="hidden" id="ex-pdf-url" value="${escAttr(ex?.pdfUrl||'')}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button type="button" onclick="triggerExPdfUpload()" style="background:rgba(162,155,254,.15);color:var(--purple);border:2px solid rgba(162,155,254,.35);border-radius:20px;padding:8px 16px;font-family:var(--fb);font-weight:700;font-size:.8rem;cursor:pointer">📎 Carica PDF</button>
        <span id="ex-pdf-status" style="font-size:.78rem;color:var(--muted)"></span>
      </div>
      <input type="file" id="ex-pdf-input" accept=".pdf" style="display:none" onchange="uploadExPdf(this)">
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn-primary" onclick="saveExercise()" style="background:linear-gradient(135deg,var(--purple),#6c63ff)">💾 ${ex?'Aggiorna':'Pubblica'}</button>
      ${ex?`<button class="btn-secondary" onclick="editingEx=null;qBlocks=[];adminTab='exercises';renderAdmin()">✕ Annulla</button>`:''}
    </div>
  </div>`;
}

function renderQBlock(q,i){
  return `<div style="background:#fff;border-radius:var(--rs);padding:14px;margin-bottom:10px;border:2px solid rgba(0,0,0,.07)" id="qb-${q.id}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <strong style="font-size:.85rem">Domanda ${i+1}</strong>
      <button onclick="removeQBlock(${q.id})" style="background:none;border:none;color:var(--coral);cursor:pointer">🗑️</button>
    </div>
    <input type="text" placeholder="Testo della domanda *" value="${escAttr(q.q||'')}" id="qt-${q.id}" style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:var(--rs);padding:9px 12px;font-family:var(--fb);font-size:.88rem;outline:none;margin-bottom:10px">
    ${[0,1,2,3].map(oi=>`
    <div style="display:flex;gap:7px;margin-bottom:7px;align-items:center">
      <input type="radio" name="cr-${q.id}" value="${oi}" ${(q.correct||0)===oi?'checked':''} id="cr-${q.id}-${oi}" style="accent-color:var(--green);width:16px;height:16px;flex-shrink:0">
      <input type="text" placeholder="Opzione ${oi+1}..." value="${escAttr((q.opts||[])[oi]||'')}" id="qo-${q.id}-${oi}" style="flex:1;border:2px solid rgba(0,0,0,.08);border-radius:var(--rs);padding:8px 11px;font-family:var(--fb);font-size:.85rem;outline:none">
    </div>`).join('')}
    <input type="text" placeholder="Spiegazione / feedback (opzionale)..." value="${escAttr(q.expl||'')}" id="qe-${q.id}" style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:var(--rs);padding:8px 12px;font-family:var(--fb);font-size:.82rem;outline:none;margin-top:4px">
  </div>`;
}

let qIdCounter=100;
function addQBlock(){
  const id=qIdCounter++;
  const block={id,q:'',opts:['','','',''],correct:0,expl:''};
  qBlocks.push(block);
  const container=document.getElementById('q-blocks');
  if(!container)return;
  const div=document.createElement('div');
  div.innerHTML=renderQBlock(block,qBlocks.length-1);
  container.appendChild(div.firstElementChild);
}
function removeQBlock(id){
  qBlocks=qBlocks.filter(q=>q.id!==id);
  document.getElementById('qb-'+id)?.remove();
}

function collectQuestions(){
  const qs=[];
  document.querySelectorAll('[id^="qb-"]').forEach(el=>{
    const id=el.id.replace('qb-','');
    const qText=document.getElementById('qt-'+id)?.value?.trim();
    if(!qText)return;
    const opts=[0,1,2,3].map(oi=>document.getElementById('qo-'+id+'-'+oi)?.value?.trim()||'');
    const cr=document.querySelector(`input[name="cr-${id}"]:checked`);
    const correct=cr?parseInt(cr.value):0;
    const expl=document.getElementById('qe-'+id)?.value?.trim()||'';
    qs.push({q:qText,opts,correct,expl});
  });
  return qs;
}

async function saveExercise(){
  const title=document.getElementById('ex-title')?.value?.trim();
  if(!title){toast('Inserisci un titolo!','error');return;}
  const questions=collectQuestions();
  if(!questions.length){toast('Aggiungi almeno una domanda!','error');return;}
  const pdfUrl=document.getElementById('ex-pdf-url')?.value||null;
  const data={
    title,
    type:document.getElementById('ex-type')?.value||'quiz',
    level:document.getElementById('ex-level')?.value||'A1',
    category:document.getElementById('ex-category')?.value||'Grammatica',
    points:parseInt(document.getElementById('ex-points')?.value)||50,
    desc:document.getElementById('ex-desc')?.value?.trim()||'',
    questions,
    pdfUrl:pdfUrl||null,
  };
  try{
    if(editingEx)await PUT('/api/exercises/'+editingEx._id,data);
    else await POST('/api/exercises',data);
    const wasEditing=!!editingEx;
    editingEx=null;qBlocks=[];
    toast(wasEditing?'Esercizio aggiornato! ✅':'Esercizio pubblicato! 🎉');
    adminTab='exercises';
    renderAdmin();
  }catch(e){toast(e.message,'error');}
}

function triggerExPdfUpload(){
  document.getElementById('ex-pdf-input')?.click();
}

async function uploadExPdf(input){
  const file=input.files[0];
  if(!file)return;
  if(file.type!=='application/pdf'&&!file.name.endsWith('.pdf')){toast('Solo file PDF!','error');return;}
  if(file.size>20*1024*1024){toast('PDF troppo grande (max 20MB)','error');return;}
  const status=document.getElementById('ex-pdf-status');
  if(status)status.textContent='⏳ Caricamento...';
  try{
    const fd=new FormData();
    fd.append('file',file);
    const tok=localStorage.getItem('gc_token');
    const r=await fetch('/api/media/upload-pdf',{method:'POST',headers:{'Authorization':'Bearer '+tok},body:fd});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Upload fallito');
    document.getElementById('ex-pdf-url').value=d.url;
    if(status)status.textContent='✅ '+file.name;
    // Show preview
    const preview=document.getElementById('ex-pdf-preview');
    if(!preview){
      const wrap=document.querySelector('#ex-pdf-input').closest('div').parentNode;
      const prev=document.createElement('div');
      prev.id='ex-pdf-preview';
      prev.style.cssText='display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:rgba(162,155,254,.15);border-radius:12px';
      prev.innerHTML=`<span>📄</span><a href="${d.url}" target="_blank" style="flex:1;font-size:.82rem;color:var(--purple);font-weight:700">${file.name}</a><button onclick="document.getElementById('ex-pdf-url').value='';this.parentNode.remove();document.getElementById('ex-pdf-status').textContent=''" style="background:none;border:none;color:var(--coral);cursor:pointer">✕</button>`;
      wrap.insertBefore(prev,wrap.children[1]||wrap.lastChild);
    }
    toast('PDF caricato! 📄');
  }catch(e){
    if(status)status.textContent='❌ '+e.message;
    toast(e.message,'error');
  }
}

async function editExercise(id){
  try{
    const exercises=await GET('/api/exercises');
    editingEx=exercises.find(e=>e._id===id)||null;
    if(editingEx)qBlocks=editingEx.questions.map((q,i)=>({id:i,...q}));
    qIdCounter=editingEx?.questions?.length||0;
    adminTab='newex';
    renderAdmin();
  }catch(e){toast(e.message,'error');}
}

async function deleteExercise(id){
  if(!confirm('Eliminare questo esercizio?'))return;
  try{
    await DEL('/api/exercises/'+id);
    toast('Eliminato','info');
    renderAdmin();
  }catch(e){toast(e.message,'error');}
}

async function renderAdminBlogList(c){
  c.innerHTML='<div class="spinner"></div>';
  try{
    const posts=await GET('/api/blog/all');
    if(!posts.length){
      c.innerHTML=`<div class="card"><div class="empty-state"><div class="ei">📰</div><h3>Nessun articolo</h3><p>Scrivi il primo articolo del blog!</p></div><button class="btn-primary btn-sm" onclick="adminTab='newpost';renderAdmin()" style="width:auto;padding:10px 22px">✏️ Scrivi</button></div>`;
      return;
    }
    c.innerHTML=`<div class="card">
      <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:14px">📰 Articoli (${posts.length})</h3>
      ${posts.map(b=>`<div class="blog-preview-item">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div><div class="bpt">${escHTML(b.title)}</div><div class="bpd">${fmtDate(b.date)} · ${b.published?'<span style="color:var(--green)">✅ Pubblicato</span>':'<span style="color:var(--orange)">📝 Bozza</span>'}</div></div>
          <button class="btn-del" onclick="deleteBlog('${b._id}')">🗑️</button>
        </div>
        <div class="bpe">${escHTML((b.content||'').slice(0,120))}...</div>
      </div>`).join('')}
      <button class="btn-primary btn-sm" onclick="adminTab='newpost';renderAdmin()" style="margin-top:12px;width:auto;padding:10px 22px">✏️ Nuovo Articolo</button>
    </div>`;
  }catch(e){c.innerHTML=`<p style="color:var(--coral)">${e.message}</p>`;}
}

function renderAdminBlogForm(c){
  c.innerHTML=`<div class="card">
    <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:14px">✏️ Nuovo Articolo</h3>
    <div class="form-col">
      <input type="text" id="blog-title" placeholder="Titolo dell'articolo *">
      <div class="wysiwyg-bar">
        <button class="wysi-btn" onclick="wfmt('bold')"><b>B</b></button>
        <button class="wysi-btn" onclick="wfmt('italic')"><i>I</i></button>
        <button class="wysi-btn" onclick="wfmt('underline')"><u>U</u></button>
        <button class="wysi-btn" onclick="wfmt('formatBlock','h2')">H2</button>
        <button class="wysi-btn" onclick="wfmt('insertUnorderedList')">• Lista</button>
      </div>
      <div id="blog-editor" contenteditable="true" style="border:2px solid rgba(0,0,0,.08);border-radius:var(--rs);padding:14px;min-height:180px;font-family:var(--fb);outline:none;line-height:1.6;background:#fff" placeholder="Scrivi qui l'articolo..."></div>
      <select id="blog-status"><option value="1">✅ Pubblica subito</option><option value="0">📝 Bozza</option></select>
      <div style="display:flex;gap:10px">
        <button class="btn-primary" onclick="saveBlog()" style="background:linear-gradient(135deg,var(--purple),#6c63ff);width:auto;padding:11px 24px">📰 Pubblica</button>
        <button class="btn-secondary btn-sm" onclick="adminTab='blog';renderAdmin()">✕ Annulla</button>
      </div>
    </div>
  </div>`;
}
function wfmt(cmd,val){document.execCommand(cmd,false,val||null);}

async function saveBlog(){
  const title=document.getElementById('blog-title')?.value?.trim();
  const content=document.getElementById('blog-editor')?.innerText?.trim();
  if(!title||!content){toast('Titolo e contenuto richiesti','error');return;}
  const published=document.getElementById('blog-status')?.value==='1';
  try{
    await POST('/api/blog',{title,content,published});
    toast('Articolo salvato! 📰');
    adminTab='blog';renderAdmin();
  }catch(e){toast(e.message,'error');}
}

async function deleteBlog(id){
  if(!confirm('Eliminare questo articolo?'))return;
  try{await DEL('/api/blog/'+id);toast('Eliminato','info');renderAdmin();}
  catch(e){toast(e.message,'error');}
}

/* ============================================================
   SUPERADMIN ANALYTICS
============================================================ */
async function renderSuperadmin(){
  const c=document.getElementById('sa-content');
  if(!ME||ME.role!=='superadmin'){
    c.innerHTML=`<div class="empty-state"><div class="ei">🔒</div><h3>Solo SuperAdmin</h3></div>`;
    return;
  }
  const SA_TABS=['stats','users','messages','logs'];
  const saTab=window._saTab||'stats';
  c.innerHTML=`
    <div class="section-title">📊 Analytics – 👑 ${escHTML(ME.username)}</div>
    <div class="admin-tabs">
      <button class="admin-tab${saTab==='stats'?' active':''}" onclick="window._saTab='stats';renderSuperadmin()">📊 Statistiche</button>
      <button class="admin-tab${saTab==='users'?' active':''}" onclick="window._saTab='users';renderSuperadmin()">👥 Utenti</button>
      <button class="admin-tab${saTab==='messages'?' active':''}" onclick="window._saTab='messages';renderSuperadmin()">✉️ DM Monitor</button>
      <button class="admin-tab${saTab==='logs'?' active':''}" onclick="window._saTab='logs';renderSuperadmin()">🌐 Log IP</button>
    </div>
    <div id="sa-tab-body"><div class="spinner"></div></div>`;
  const body=document.getElementById('sa-tab-body');
  try{
    if(saTab==='stats'){
      const stats=await GET('/api/admin/stats');
      body.innerHTML=`
        <div class="sa-grid">
          <div class="sa-metric"><div class="sa-val">${stats.totalUsers}</div><div class="sa-lbl">👥 Utenti</div><div class="sa-trend">+${stats.recentUsers} oggi</div></div>
          <div class="sa-metric t2"><div class="sa-val">${stats.activeSessions||0}</div><div class="sa-lbl">🟢 Sessioni 24h</div></div>
          <div class="sa-metric t3"><div class="sa-val">${stats.totalPosts}</div><div class="sa-lbl">💬 Post</div><div class="sa-trend">+${stats.recentPosts} oggi</div></div>
          <div class="sa-metric t4"><div class="sa-val">${stats.totalExer}</div><div class="sa-lbl">📚 Esercizi</div></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="export-btn" onclick="exportCSV_async()">📥 Esporta CSV</button>
          <button class="export-btn" onclick="exportJSON()" style="background:linear-gradient(135deg,var(--purple),var(--blue))">📥 Esporta JSON</button>
        </div>`;
    } else if(saTab==='users'){
      const users=await GET('/api/admin/users');
      body.innerHTML=`<div class="card">
        <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:14px">👥 Tutti gli Utenti (${users.length})</h3>
        <div style="overflow-x:auto">
          <table class="sa-table">
            <thead><tr><th>Utente</th><th>Email</th><th>Ruolo</th><th>XP</th><th>IP</th><th>Azioni</th></tr></thead>
            <tbody>
              ${users.map(u=>`<tr>
                <td><span style="font-size:.95rem">${u.avatar||'👤'}</span> <strong>${escHTML(u.username)}</strong></td>
                <td style="font-size:.78rem;color:var(--muted)">${escHTML(u.email)}</td>
                <td><span class="role-pill ${u.banned?'banned':u.role}">${u.banned?'🚫 Ban':u.role==='superadmin'?'👑 Super':u.role==='admin'?'👩‍🏫 Admin':'👤 User'}</span></td>
                <td><strong>${u.xp||0}</strong></td>
                <td style="font-family:monospace;font-size:.75rem;color:var(--muted)">${u.ip||'—'}</td>
                <td>
                  <div style="display:flex;gap:4px;flex-wrap:wrap">
                    ${u.role!=='superadmin'?`<button class="sa-btn ban" onclick="banUser('${u._id}','${escAttr(u.username)}')">${u.banned?'✅ Riattiva':'🚫 Ban'}</button>`:'—'}
                    ${u.role==='user'?`<button class="sa-btn promote" onclick="promoteUser('${u._id}')">👩‍🏫 Promuovi</button>`:''}
                    ${u.role!=='superadmin'?`<button class="sa-btn" onclick="resetUserPassword('${u._id}','${escAttr(u.username)}')" style="background:linear-gradient(135deg,#FF9F43,#F7971E);color:#fff;border:none;font-size:.72rem;padding:5px 8px;border-radius:8px;cursor:pointer;font-weight:700">🔑 Reset PW</button>`:''}
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    } else if(saTab==='messages'){
      const msgs=await GET('/api/admin/messages');
      body.innerHTML=`<div class="card">
        <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:6px">✉️ Monitor DM (${msgs.length} messaggi)</h3>
        <p style="font-size:.76rem;color:var(--muted);margin-bottom:14px">⚠️ Accesso riservato per motivi di sicurezza e moderazione della piattaforma.</p>
        ${!msgs.length?`<div class="empty-state" style="padding:20px"><div class="ei">✉️</div><h3>Nessun messaggio ancora</h3></div>`:
        `<div style="display:flex;flex-direction:column;gap:8px">
          ${msgs.map(m=>`
            <div style="background:#fff;border-radius:var(--rs);padding:12px;border:2px solid rgba(0,0,0,.05)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:1rem">${m.fromUser.avatar||'👤'}</span>
                  <strong style="font-size:.85rem">${escHTML(m.fromUser.username)}</strong>
                  <span style="color:var(--muted);font-size:.8rem">→</span>
                  <span style="font-size:1rem">${m.toUser.avatar||'👤'}</span>
                  <strong style="font-size:.85rem">${escHTML(m.toUser.username)}</strong>
                </div>
                <span style="font-size:.7rem;color:var(--muted)">${timeAgo(m.timestamp)}</span>
              </div>
              <div style="background:rgba(0,0,0,.04);border-radius:8px;padding:8px 12px;font-size:.85rem">${escHTML(m.text)}</div>
            </div>`).join('')}
        </div>`}
      </div>`;
    } else if(saTab==='logs'){
      const stats=await GET('/api/admin/stats');
      const logs = stats.recentLogs || [];
      body.innerHTML=`<div class="card">
        <h3 style="font-family:var(--fh);font-size:1.1rem;margin-bottom:12px">🌐 Log Accessi Recenti</h3>
        <div style="font-size:.76rem;color:var(--muted);margin-bottom:10px">⚠️ Il tracciamento degli IP richiede consenso GDPR esplicito degli utenti.</div>
        ${logs.length===0?`<div class="empty-state" style="padding:20px"><div class="ei">📋</div><h3>Nessuna attivita ancora</h3></div>`:
          logs.slice(0,30).map(log=>`
          <div class="ip-row">
            <span class="ip-addr">${escHTML(log.ip||'?')}</span>
            <div class="ip-info"><strong>${escHTML(log.username||'?')}</strong> · ${escHTML(log.action||'')}</div>
            <span style="font-size:.72rem;color:var(--muted)">${timeAgo(log.timestamp)}</span>
          </div>`).join('')}
      </div>`;
    }
  }catch(e){body.innerHTML=`<p style="color:var(--coral);padding:16px">${e.message}</p>`;}
}

async function banUser(uid,username){
  if(!confirm(`Vuoi bannare/riattivare ${username}?`))return;
  try{
    const r=await POST('/api/admin/users/'+uid+'/ban');
    toast(`${username} ${r.banned?'sospeso 🚫':'riattivato ✅'}`);
    renderSuperadmin();
  }catch(e){toast(e.message,'error');}
}

async function promoteUser(uid){
  if(!confirm('Promuovere questo utente a Admin (Insegnante)?'))return;
  try{
    await PUT('/api/admin/users/'+uid+'/role',{role:'admin'});
    toast('Utente promosso ad Admin! 👩‍🏫');
    renderSuperadmin();
  }catch(e){toast(e.message,'error');}
}

async function resetUserPassword(uid, username){
  if(!confirm('Vuoi reimpostare la password di '+username+'?\n\nLa nuova password sara: cambia26\n\nL\'utente verra disconnesso e dovra rifare il login.'))return;
  try{
    const r=await POST('/api/admin/users/'+uid+'/reset-password');
    toast('Password di '+r.username+' reimpostata a "cambia26"', 'success', 5000);
    renderSuperadmin();
  }catch(e){toast(e.message,'error');}
}

async function exportCSV_async(){
  try{
    const users=await GET('/api/admin/users');
    exportCSV(users);
  }catch(e){toast(e.message,'error');}
}

function exportCSV(users){
  const h='username,email,ruolo,xp,livello,streak,esercizi,data_iscrizione\n';
  const rows=users.map(u=>`"${u.username}","${u.email}","${u.role}",${u.xp||0},"${u.level}",${u.streak||0},${Object.keys(u.progress||{}).length},"${fmtDate(u.joinDate||Date.now())}"`).join('\n');
  const blob=new Blob([h+rows],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='giadacourses_utenti.csv';a.click();
  toast('CSV scaricato! 📥');
}

async function exportJSON(){
  try{
    const [users,posts,exercises]=await Promise.all([GET('/api/admin/users'),GET('/api/posts'),GET('/api/exercises')]);
    const clean=users.map(({passwordHash,...u})=>u);
    const blob=new Blob([JSON.stringify({users:clean,posts,exercises,exportDate:new Date().toISOString()},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='giadacourses_backup.json';a.click();
    toast('JSON scaricato! 📥');
  }catch(e){toast(e.message,'error');}
}

/* ============================================================
   STORIE
============================================================ */
let currentStoryGroup=null, currentStoryIdx=0, storyTimer=null;

async function loadStories(){
  const bar=document.getElementById('stories-bar');
  if(!bar)return;
  try{
    const groups=await GET('/api/stories');
    let html='';
    if(ME){
      html+=`<div class="story-bubble" onclick="openStoryCreator()">
        <div class="story-ring add-new"><div class="story-ring-inner" style="font-size:1.4rem;font-weight:900;color:var(--teal)">+</div></div>
        <span class="story-label">La tua storia</span>
      </div>`;
    }
    if(!groups.length&&!ME){bar.innerHTML=`<p style="font-size:.8rem;color:var(--muted);padding:8px">Nessuna storia attiva. Accedi per crearne una!</p>`;return;}
    groups.forEach((g,gi)=>{
      const first=g.items[0];
      const isOwn=ME&&g.user._id===ME._id;
      html+=`<div class="story-bubble" onclick="viewStoryGroup(${gi})">
        <div class="story-ring${isOwn?' own':''}">
          <div class="story-ring-inner">
            ${first.mediaType==='template'||!first.mediaUrl
              ? `<div style="width:100%;height:100%;background:${first.bgTemplate||'linear-gradient(135deg,#9C7CFF,#FF9ECD)'};border-radius:50%"></div>`
              : first.mediaType==='video'
                ? `<video src="${first.mediaUrl}" muted playsinline style="pointer-events:none" onerror="this.parentElement.style.background='linear-gradient(135deg,#9C7CFF,#FF9ECD)'"></video>`
                : `<img src="${first.mediaUrl}" loading="lazy" onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#9C7CFF,#FF9ECD)'">`
            }
          </div>
        </div>
        <span class="story-label">${isOwn?'Tu':escHTML(g.user.username)}</span>
      </div>`;
    });
    bar.innerHTML=html;
    window._storyGroups=groups;
  }catch(e){if(bar)bar.innerHTML='<p style="font-size:.78rem;color:var(--muted)">Nessuna storia</p>';}
}

function openStoryCreator(){
  if(!ME){openAuth();return;}
  storySelectedFilter='none';storySelectedMusic='none';storyTextLayers=[];
  pendingStoryMedia=null;window._storyBgTemplate=null;
  var showTut = !localStorage.getItem('gc_story_tut_v3');
  var modal=document.createElement('div');
  modal.id='story-creator-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:9700;background:#000;display:flex;flex-direction:column';
  // Build HTML with string concat to avoid template literal nesting issues
  var h = '';
  // Fullscreen preview
  h += '<div id="sc-preview" style="position:absolute;inset:0;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden">';
  h += '<div id="sc-placeholder" style="text-align:center;color:rgba(255,255,255,.3);padding:20px">';
  h += '<div style="font-size:2.5rem;margin-bottom:10px">+</div>';
  h += '<div style="font-weight:700;font-size:.88rem">Carica una foto o un video</div>';
  h += '<div style="font-size:.72rem;opacity:.6;margin-top:4px">oppure scegli uno sfondo</div>';
  h += '</div></div>';
  // Top bar
  h += '<div style="position:absolute;top:0;left:0;right:0;z-index:6;display:flex;align-items:center;justify-content:space-between;padding:calc(14px + var(--sat,0px)) 16px 12px;background:linear-gradient(to bottom,rgba(0,0,0,.5),transparent)">';
  h += '<button onclick="closeStoryCreator()" style="background:rgba(255,255,255,.15);border:none;border-radius:50%;width:38px;height:38px;color:#fff;cursor:pointer;font-size:1.1rem;backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center">x</button>';
  h += '<div style="font-family:var(--fh);font-size:1rem;color:#fff;font-weight:700">Crea Storia</div>';
  h += '<button class="btn-primary" onclick="publishStory()" style="width:auto;padding:9px 20px;font-size:.82rem;border-radius:20px">Pubblica</button>';
  h += '</div>';
  // Bottom bar with media buttons
  h += '<div id="sc-bottom-bar" style="position:absolute;bottom:0;left:0;right:0;z-index:6;padding:10px 16px calc(14px + var(--sab,0px));background:linear-gradient(to top,rgba(0,0,0,.7),transparent)">';
  h += '<input type="text" id="story-caption" placeholder="Didascalia..." style="width:100%;border:1.5px solid rgba(255,255,255,.15);border-radius:24px;padding:10px 16px;font-family:var(--fb);font-size:.84rem;outline:none;background:rgba(255,255,255,.08);color:#fff;backdrop-filter:blur(6px);margin-bottom:10px">';
  h += '<div style="display:flex;gap:8px;align-items:center">';
  h += '<label class="sc-pill-btn" for="sc-img-input">Foto</label>';
  h += '<input type="file" id="sc-img-input" accept="image/*" style="display:none" onchange="handleStoryMedia(this,\'image\')">';
  h += '<label class="sc-pill-btn" for="sc-vid-input">Video</label>';
  h += '<input type="file" id="sc-vid-input" accept="video/*" style="display:none" onchange="handleStoryMedia(this,\'video\')">';
  h += '<button class="sc-pill-btn" onclick="openStoryTemplates()">Sfondo</button>';
  h += '<label class="sc-pill-btn" for="sc-cam-input">Scatta</label>';
  h += '<input type="file" id="sc-cam-input" accept="image/*" capture="environment" style="display:none" onchange="handleStoryMedia(this,\'image\')">';
  h += '<div style="flex:1"></div>';
  h += '<button id="sc-opts-btn" class="sc-pill-btn sc-accent" onclick="toggleStoryOptions()" style="display:none">Opzioni</button>';
  h += '</div></div>';
  // Swipe-up options panel
  h += '<div id="sc-options-panel" class="sc-options-panel">';
  h += '<div style="width:40px;height:4px;background:rgba(255,255,255,.2);border-radius:4px;margin:12px auto 16px;cursor:pointer" onclick="toggleStoryOptions()"></div>';
  // Duration
  h += '<div style="font-weight:700;font-size:.72rem;color:rgba(255,255,255,.4);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Durata</div>';
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;background:rgba(255,255,255,.05);border-radius:14px;padding:10px 14px">';
  h += '<input type="range" id="sc-duration" min="3" max="15" value="15" style="flex:1;accent-color:var(--coral)">';
  h += '<span id="sc-duration-lbl" style="color:#fff;font-weight:800;font-size:.9rem;min-width:30px;text-align:center">15s</span></div>';
  // Filters
  h += '<div style="font-weight:700;font-size:.72rem;color:rgba(255,255,255,.4);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Filtri</div>';
  h += '<div id="sc-filters" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;margin-bottom:16px"></div>';
  // Music
  h += '<div style="font-weight:700;font-size:.72rem;color:rgba(255,255,255,.4);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Musica</div>';
  h += '<div id="sc-music" style="margin-bottom:16px"></div>';
  // Text + Tags
  h += '<div style="display:flex;gap:8px;margin-bottom:16px">';
  h += '<button onclick="addStoryText()" class="sc-pill-btn" style="flex:1">Testo</button>';
  h += '<button onclick="openStoryTagPicker()" class="sc-pill-btn" style="flex:1">Tag</button>';
  h += '</div>';
  // Templates (inside panel)
  h += '<div id="sc-templates-wrap" style="display:none;margin-bottom:16px">';
  h += '<div style="font-weight:700;font-size:.72rem;color:rgba(255,255,255,.4);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Sfondi</div>';
  h += '<div class="sc-template-grid" id="sc-template-grid"></div>';
  h += '</div>';
  h += '</div>';
  // Tutorial overlay (one-time)
  if(showTut){
    h += '<div id="story-tutorial" style="position:absolute;inset:0;z-index:20;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center">';
    h += '<div style="font-family:var(--fh);font-size:1.4rem;color:#fff;margin-bottom:12px">Crea la tua Storia</div>';
    h += '<div style="font-size:.85rem;color:rgba(255,255,255,.7);line-height:1.6;margin-bottom:24px;max-width:300px">';
    h += 'Carica una foto o video, poi tocca <strong style="color:var(--coral)">Opzioni</strong> per aggiungere durata, filtri, musica e testo.</div>';
    h += '<div style="font-size:2rem;margin-bottom:8px;animation:float 2s ease-in-out infinite;color:rgba(255,255,255,.6)">&#x2191;</div>';
    h += '<div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:24px">Swipe up per le opzioni</div>';
    h += '<button onclick="document.getElementById(\'story-tutorial\').remove();localStorage.setItem(\'gc_story_tut_v3\',\'1\')" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:16px;padding:14px 32px;font-family:var(--fb);font-weight:800;font-size:.95rem;cursor:pointer;width:100%;max-width:280px">Ho capito!</button>';
    h += '</div>';
  }
  modal.innerHTML = h;
  document.body.appendChild(modal);
  // Duration slider
  var durSlider=modal.querySelector('#sc-duration');
  var durLbl=modal.querySelector('#sc-duration-lbl');
  if(durSlider&&durLbl){ durSlider.oninput=function(){durLbl.textContent=durSlider.value+'s';}; }
  // Render filters
  var FILTERS=[{n:'Nessuno',c:'none'},{n:'Vivido',c:'saturate(1.5) contrast(1.1)'},{n:'Caldo',c:'sepia(.3) saturate(1.4) brightness(1.05)'},{n:'Freddo',c:'saturate(.9) hue-rotate(15deg) brightness(1.05)'},{n:'B/N',c:'grayscale(1)'},{n:'Vintage',c:'sepia(.5) contrast(.9) brightness(1.1)'},{n:'Drama',c:'contrast(1.4) brightness(.95) saturate(1.2)'},{n:'Neon',c:'brightness(1.1) contrast(1.2) saturate(1.8) hue-rotate(-10deg)'}];
  var fc=modal.querySelector('#sc-filters');
  FILTERS.forEach(function(f,i){var b=document.createElement('button');b.className='sc-filter-chip'+(i===0?' active':'');b.textContent=f.n;b.onclick=function(){storySelectedFilter=f.c;fc.querySelectorAll('button').forEach(function(x){x.classList.remove('active')});b.classList.add('active');var m=modal.querySelector('#sc-preview img,#sc-preview video');if(m)m.style.filter=f.c==='none'?'':f.c;};fc.appendChild(b);});
  // Render music search
  var mc=modal.querySelector('#sc-music');
  mc.innerHTML='<div style="display:flex;gap:8px;width:100%"><input type="text" id="sc-music-q" placeholder="Cerca una canzone..." style="flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px 14px;color:#fff;font-family:var(--fb);font-size:.85rem;outline:none"><button onclick="searchStoryMusic()" style="background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff;border:none;border-radius:12px;padding:10px 16px;font-weight:700;font-size:.85rem;cursor:pointer;flex-shrink:0">Cerca</button></div><div id="sc-music-selected" style="display:none"></div><div id="sc-music-results" style="max-height:200px;overflow-y:auto;scrollbar-width:thin;border-radius:12px;margin-top:8px"></div>';
  mc.querySelector('#sc-music-q').addEventListener('keydown',function(e){if(e.key==='Enter')searchStoryMusic();});
  // Swipe-up gesture for options panel
  _initStoryPanelSwipe(modal);
}

var _storyPanelOpen = false;
function toggleStoryOptions(){
  _storyPanelOpen = !_storyPanelOpen;
  var panel = document.getElementById('sc-options-panel');
  if(panel) panel.style.transform = _storyPanelOpen ? 'translateY(0)' : 'translateY(100%)';
}

function _initStoryPanelSwipe(modal){
  var panel = modal.querySelector('#sc-options-panel');
  if(!panel) return;
  var startY=0, isDrag=false;
  panel.addEventListener('touchstart',function(e){startY=e.touches[0].clientY;isDrag=false;},{passive:true});
  panel.addEventListener('touchmove',function(e){
    var dy=e.touches[0].clientY-startY;
    if(dy>30) isDrag=true;
  },{passive:true});
  panel.addEventListener('touchend',function(e){
    if(isDrag){_storyPanelOpen=false;panel.style.transform='translateY(100%)';}
  },{passive:true});
  // Also detect swipe-up on the preview area to open panel
  var preview = modal.querySelector('#sc-preview');
  if(preview){
    var pStartY=0;
    preview.addEventListener('touchstart',function(e){pStartY=e.touches[0].clientY;},{passive:true});
    preview.addEventListener('touchend',function(e){
      var dy=e.changedTouches[0].clientY-pStartY;
      if(dy<-60){_storyPanelOpen=true;panel.style.transform='translateY(0)';}
    },{passive:true});
  }
}

// Show options button when media is loaded
function _showStoryOptsBtn(){
  var btn = document.getElementById('sc-opts-btn');
  if(btn) btn.style.display = 'inline-flex';
}

function closeStoryCreator(){stopStoryPreview();document.getElementById('story-creator-modal')?.remove();pendingStoryMedia=null;storyTextLayers=[];window._storyBgTemplate=null;_storyPanelOpen=false;}

function showStoryTutorialAgain(){
  const modal = document.getElementById('story-creator-modal');
  if(!modal) return;
  // Rimuovi tutorial precedente se esiste
  document.getElementById('story-tutorial')?.remove();
  const tut = document.createElement('div');
  tut.id = 'story-tutorial';
  tut.style.cssText = 'position:absolute;inset:0;z-index:10;background:rgba(10,10,26,.98);display:flex;align-items:center;justify-content:center;padding:20px';
  tut.innerHTML = '<div style="max-width:340px;text-align:center;color:#fff">' +
    '<div style="font-size:3.5rem;margin-bottom:16px;animation:float 2s ease-in-out infinite">&#x1F4F8;</div>' +
    '<div style="font-family:var(--fh);font-size:1.5rem;margin-bottom:12px">Come creare una Storia</div>' +
    '<div style="font-size:.88rem;line-height:1.6;opacity:.8;margin-bottom:24px">' +
    'Le storie durano <strong style="color:var(--coral)">24 ore</strong> e puoi scegliere la durata da <strong>3 a 15 secondi</strong>.<br><br>' +
    '&#x1F4F7; Carica una <strong>foto</strong> o un <strong>video</strong><br>' +
    '&#x1F3A8; Oppure scegli uno <strong>sfondo colorato</strong><br>' +
    '&#x270D;&#xFE0F; Aggiungi <strong>testo trascinabile</strong><br>' +
    '&#x1F3B5; Scegli una <strong>musica</strong> di sottofondo<br>' +
    '&#x2728; Applica un <strong>filtro</strong> fotografico</div>' +
    '<button onclick="document.getElementById(\'story-tutorial\').remove()" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:16px;padding:14px 32px;font-family:var(--fb);font-weight:800;font-size:1rem;cursor:pointer;width:100%;box-shadow:0 6px 20px rgba(255,107,107,.4)">Ho capito!</button></div>';
  modal.appendChild(tut);
}

const STORY_TEMPLATES=[
  {id:'gc1',bg:'linear-gradient(135deg,#9C7CFF,#FF9ECD)',label:'Viola'},
  {id:'gc2',bg:'linear-gradient(135deg,#FF9ECD,#FFD700)',label:'Rosa'},
  {id:'gc3',bg:'linear-gradient(135deg,#4ADE80,#22C55E)',label:'Verde'},
  {id:'gc4',bg:'linear-gradient(160deg,#1E1E3F,#9C7CFF)',label:'Notte'},
  {id:'gc5',bg:'linear-gradient(135deg,#FF6B6B,#FF9F43)',label:'Fuoco'},
  {id:'gc6',bg:'linear-gradient(135deg,#74B9FF,#9C7CFF)',label:'Oceano'},
  {id:'gc7',bg:'linear-gradient(135deg,#FFD700,#FF6B6B)',label:'Sole'},
  {id:'gc8',bg:'linear-gradient(180deg,#0a0a1a,#1a1a3a)',label:'Buio'},
  {id:'gc9',bg:'linear-gradient(135deg,#667eea,#764ba2)',label:'Indigo'},
  {id:'gc10',bg:'linear-gradient(135deg,#f093fb,#f5576c)',label:'Candy'},
];

function openStoryTemplates(){
  // Open the options panel first (templates are inside it)
  _storyPanelOpen = true;
  var panel = document.getElementById('sc-options-panel');
  if(panel) panel.style.transform = 'translateY(0)';
  var wrap=document.getElementById('sc-templates-wrap');
  var grid=document.getElementById('sc-template-grid');
  if(!wrap||!grid)return;
  wrap.style.display='block';
  if(grid.children.length)return;
  STORY_TEMPLATES.forEach(function(t){
    var el=document.createElement('div');
    el.className='sc-template-item';
    el.style.cssText='background:'+t.bg+';';
    el.innerHTML='<span style="font-size:.65rem;color:#fff;font-weight:800;text-shadow:0 1px 4px rgba(0,0,0,.4)">'+(t.label||'')+'</span>';
    el.onclick=function(){
      grid.querySelectorAll('.sc-template-item').forEach(function(x){x.classList.remove('selected')});
      el.classList.add('selected');
      window._storyBgTemplate=t.bg;
      pendingStoryMedia=null;
      var preview=document.getElementById('sc-preview');
      if(preview){
        preview.style.background=t.bg;
        preview.querySelectorAll('img,video').forEach(function(e){e.remove()});
        var ph=preview.querySelector('#sc-placeholder');
        if(ph)ph.style.display='none';
        var existing=preview.querySelector('.sc-template-overlay');
        if(existing) existing.remove();
      }
      _showStoryOptsBtn();
    };
    grid.appendChild(el);
  });
}

let storySelectedFilter='none',storySelectedMusic='none',storySelectedMusicTitle='',storyTextLayers=[];
let _storyPreviewAudio=null;

async function searchStoryMusic(){
  const q=document.getElementById('sc-music-q')?.value?.trim();
  if(!q)return;
  const res=document.getElementById('sc-music-results');
  if(res) res.innerHTML='<div style="text-align:center;padding:14px;color:rgba(255,255,255,.4);font-size:.82rem"><div class="spinner" style="width:22px;height:22px;margin:0 auto 8px;border-width:2px"></div>Cerco...</div>';
  try{
    const tracks=await GET('/api/music/search?q='+encodeURIComponent(q));
    if(!res)return;
    if(!tracks.length){res.innerHTML='<div style="text-align:center;padding:14px;color:rgba(255,255,255,.4);font-size:.82rem">Nessun risultato per "'+escHTML(q)+'"</div>';return;}
    res.innerHTML=tracks.map(t=>`
      <div class="sc-music-item" data-url="${escAttr(t.preview)}" data-title="${escAttr(t.artist+' - '+t.title)}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;cursor:pointer;transition:all .15s;border:1px solid transparent;margin-bottom:2px">
        <img src="${t.cover}" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.3)" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <div style="color:#fff;font-weight:700;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(t.title)}</div>
          <div style="color:rgba(255,255,255,.5);font-size:.72rem;margin-top:1px">${escHTML(t.artist)}</div>
        </div>
        <button class="sc-music-sel" style="background:linear-gradient(135deg,var(--teal),var(--blue));border:none;color:#fff;border-radius:12px;padding:7px 14px;font-size:.75rem;font-weight:700;cursor:pointer;flex-shrink:0;display:flex;align-items:center;gap:4px">▶ Usa</button>
      </div>`).join('');
    // Attach click handlers
    res.querySelectorAll('.sc-music-item').forEach(item=>{
      item.querySelector('.sc-music-sel').onclick=async(e)=>{
        e.stopPropagation();
        const url=item.dataset.url;
        const title=item.dataset.title;
        const btn=e.target;
        btn.textContent='⏳';btn.disabled=true;
        try{
          // Download MP3 to server so URL doesn't expire
          const dl=await POST('/api/music/download',{url,title});
          storySelectedMusic=dl.localUrl; // /uploads/xxx.mp3
          storySelectedMusicTitle=title;
          // Reset ALL buttons first
          res.querySelectorAll('.sc-music-sel').forEach(b=>{b.textContent='▶ Usa';b.disabled=false;});
          // Highlight selected
          res.querySelectorAll('.sc-music-item').forEach(x=>{x.style.background='transparent';x.style.borderColor='transparent';});
          item.style.background='rgba(78,205,196,.1)';
          item.style.borderColor='rgba(78,205,196,.3)';
          btn.textContent='✓ Aggiunta';btn.disabled=true;
          // Show selected indicator
          const selBox=document.getElementById('sc-music-selected');
          const selTitle=document.getElementById('sc-music-sel-title');
          if(selBox){selBox.style.display='flex';}
          if(selTitle)selTitle.textContent=title;
          // Preview from local
          stopStoryPreview();
          _storyPreviewAudio=new Audio(dl.localUrl);
          _storyPreviewAudio.volume=0.3;
          _storyPreviewAudio.play().catch(()=>{});
          toast('Canzone selezionata','success',2000);
        }catch(err){
          btn.textContent='▶ Usa';btn.disabled=false;
          toast('Errore download musica','error');
        }
      };
      // Tap anywhere on row to preview (from Deezer URL, just for preview)
      item.onclick=()=>{
        stopStoryPreview();
        _storyPreviewAudio=new Audio(item.dataset.url);
        _storyPreviewAudio.volume=0.2;
        _storyPreviewAudio.play().catch(()=>{});
      };
    });
  }catch(e){if(res)res.innerHTML='<div style="padding:14px;text-align:center;color:rgba(255,107,107,.7);font-size:.82rem">Errore di ricerca. Riprova.</div>';}
}

function removeStoryMusic(){
  storySelectedMusic='none';
  storySelectedMusicTitle='';
  stopStoryPreview();
  const selBox=document.getElementById('sc-music-selected');
  if(selBox)selBox.style.display='none';
  const res=document.getElementById('sc-music-results');
  if(res)res.querySelectorAll('.sc-music-item').forEach(x=>{x.style.background='transparent';x.style.borderColor='transparent';});
  toast('Musica rimossa','info',1500);
}

function stopStoryPreview(){try{_storyPreviewAudio?.pause();_storyPreviewAudio=null;}catch{}}

function addStoryText(){
  const text=prompt('Scrivi il testo per la storia:');
  if(!text?.trim())return;
  const preview=document.getElementById('sc-preview');
  if(!preview)return;
  const el=document.createElement('div');
  el.className='sc-text-layer';
  el.textContent=text.trim();
  el.style.top='40%';el.style.left='10%';
  const layerIdx=storyTextLayers.length;
  storyTextLayers.push({text:text.trim(),x:10,y:40});
  // Drag support
  let dragging=false,ox=0,oy=0;
  const startDrag=(cx,cy)=>{dragging=true;const r=el.getBoundingClientRect();ox=cx-r.left;oy=cy-r.top;};
  const moveDrag=(cx,cy)=>{if(!dragging)return;const pr=preview.getBoundingClientRect();const nx=(cx-pr.left-ox)/pr.width*100;const ny=(cy-pr.top-oy)/pr.height*100;el.style.left=nx+'%';el.style.top=ny+'%';};
  const endDrag=()=>{if(dragging){dragging=false;const pr=preview.getBoundingClientRect();const er=el.getBoundingClientRect();const fx=(er.left-pr.left)/pr.width*100;const fy=(er.top-pr.top)/pr.height*100;if(storyTextLayers[layerIdx]){storyTextLayers[layerIdx].x=Math.round(fx*10)/10;storyTextLayers[layerIdx].y=Math.round(fy*10)/10;}}};
  el.addEventListener('mousedown',e=>{e.preventDefault();startDrag(e.clientX,e.clientY);});
  document.addEventListener('mousemove',e=>moveDrag(e.clientX,e.clientY));
  document.addEventListener('mouseup',endDrag);
  el.addEventListener('touchstart',e=>{e.preventDefault();startDrag(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  document.addEventListener('touchmove',e=>{if(dragging)moveDrag(e.touches[0].clientX,e.touches[0].clientY);},{passive:true});
  document.addEventListener('touchend',endDrag);
  preview.appendChild(el);
}

async function openStoryTagPicker(){
  try{
    const users=await GET('/api/leaderboard');
    const name=prompt('Digita il nome utente da taggare:\n\nUtenti: '+users.slice(0,15).map(u=>u.username).join(', '));
    if(!name?.trim())return;
    const found=users.find(u=>u.username.toLowerCase()===name.trim().toLowerCase());
    if(found){
      addStoryTagText('@'+found.username);
      toast('Tag aggiunto: @'+found.username,'success');
    } else toast('Utente non trovato','error');
  }catch{toast('Errore caricamento utenti','error');}
}
function addStoryTagText(text){
  const preview=document.getElementById('sc-preview');
  if(!preview)return;
  const el=document.createElement('div');
  el.className='sc-text-layer';
  el.textContent=text;
  el.style.cssText+='background:rgba(0,0,0,.5);backdrop-filter:blur(4px);padding:5px 12px;border-radius:20px;font-size:.85rem;top:70%;left:15%';
  const layerIdx=storyTextLayers.length;
  storyTextLayers.push({text,x:15,y:70,isTag:true});
  // Drag support for tags
  let dragging=false,ox=0,oy=0;
  const startDrag=(cx,cy)=>{dragging=true;const r=el.getBoundingClientRect();ox=cx-r.left;oy=cy-r.top;};
  const moveDrag=(cx,cy)=>{if(!dragging)return;const pr=preview.getBoundingClientRect();el.style.left=((cx-pr.left-ox)/pr.width*100)+'%';el.style.top=((cy-pr.top-oy)/pr.height*100)+'%';};
  const endDrag=()=>{if(dragging){dragging=false;const pr=preview.getBoundingClientRect();const er=el.getBoundingClientRect();if(storyTextLayers[layerIdx]){storyTextLayers[layerIdx].x=Math.round((er.left-pr.left)/pr.width*1000)/10;storyTextLayers[layerIdx].y=Math.round((er.top-pr.top)/pr.height*1000)/10;}}};
  el.addEventListener('mousedown',e=>{e.preventDefault();startDrag(e.clientX,e.clientY);});
  document.addEventListener('mousemove',e=>moveDrag(e.clientX,e.clientY));
  document.addEventListener('mouseup',endDrag);
  el.addEventListener('touchstart',e=>{e.preventDefault();startDrag(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  document.addEventListener('touchmove',e=>{if(dragging)moveDrag(e.touches[0].clientX,e.touches[0].clientY);},{passive:true});
  document.addEventListener('touchend',endDrag);
  preview.appendChild(el);
}

let pendingStoryMedia=null;
function handleStoryMedia(input,type){
  const file=input.files[0];
  if(!file)return;
  input.value='';
  if(file.size>100*1024*1024){toast('File troppo grande (max 100MB)','error');return;}
  const showInPreview=(blob,url)=>{
    pendingStoryMedia={blob,type,file:blob===file?file:null,localUrl:url};
    window._storyBgTemplate=null;
    const preview=document.getElementById('sc-preview');
    if(!preview)return;
    const ph=document.getElementById('sc-placeholder');if(ph)ph.style.display='none';
    preview.querySelector('.sc-template-overlay')?.remove();
    preview.style.background='#000';
    preview.querySelectorAll('img,video,.sc-media-wrap').forEach(e=>e.remove());
    if(type==='video'){
      const v=document.createElement('video');
      v.src=url; v.autoplay=true; v.loop=true; v.muted=true; v.playsInline=true;
      v.style.cssText='width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
      preview.insertAdjacentElement('afterbegin',v);
    } else {
      // Wrap image in a transformable container for pinch-zoom + drag
      var wrap=document.createElement('div');
      wrap.className='sc-media-wrap';
      wrap.style.cssText='position:absolute;inset:0;overflow:hidden;touch-action:none';
      // Blurred background for small images
      var bgImg=document.createElement('img');
      bgImg.src=url;
      bgImg.style.cssText='position:absolute;inset:-20px;width:calc(100% + 40px);height:calc(100% + 40px);object-fit:cover;filter:blur(30px) brightness(.4);pointer-events:none;z-index:0';
      wrap.appendChild(bgImg);
      var img=document.createElement('img');
      img.src=url;
      img.style.cssText='width:100%;height:100%;object-fit:contain;transform-origin:center center;will-change:transform;pointer-events:none;user-select:none;-webkit-user-drag:none;position:relative;z-index:1';
      img.draggable=false;
      wrap.appendChild(img);
      preview.insertAdjacentElement('afterbegin',wrap);
      // Hint
      var hint=document.createElement('div');
      hint.style.cssText='position:absolute;bottom:8px;left:0;right:0;text-align:center;color:rgba(255,255,255,.5);font-size:.7rem;z-index:3;pointer-events:none';
      hint.textContent='Pizzica per ingrandire, trascina per spostare';
      hint.id='sc-media-hint';
      wrap.appendChild(hint);
      setTimeout(function(){var h=document.getElementById('sc-media-hint');if(h)h.style.display='none';},4000);
      // Gesture state
      var _s={scale:1,tx:0,ty:0,lastDist:0,lastX:0,lastY:0,fingers:0};
      function applyT(){img.style.transform='translate('+_s.tx+'px,'+_s.ty+'px) scale('+_s.scale+')';}
      wrap.addEventListener('touchstart',function(e){
        _s.fingers=e.touches.length;
        if(e.touches.length===2){
          _s.lastDist=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
        } else if(e.touches.length===1){
          _s.lastX=e.touches[0].clientX;_s.lastY=e.touches[0].clientY;
        }
      },{passive:true});
      wrap.addEventListener('touchmove',function(e){
        e.preventDefault();
        if(e.touches.length===2){
          // Pinch zoom
          var dist=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
          if(_s.lastDist>0){
            var ds=dist/_s.lastDist;
            _s.scale=Math.max(0.5,Math.min(5,_s.scale*ds));
          }
          _s.lastDist=dist;
          applyT();
        } else if(e.touches.length===1 && _s.scale>1){
          // Drag (only when zoomed in)
          var dx=e.touches[0].clientX-_s.lastX;
          var dy=e.touches[0].clientY-_s.lastY;
          _s.tx+=dx;_s.ty+=dy;
          _s.lastX=e.touches[0].clientX;_s.lastY=e.touches[0].clientY;
          applyT();
        }
      },{passive:false});
      wrap.addEventListener('touchend',function(e){
        _s.fingers=e.touches.length;
        _s.lastDist=0;
        if(e.touches.length===1){_s.lastX=e.touches[0].clientX;_s.lastY=e.touches[0].clientY;}
      },{passive:true});
      // Double tap to reset
      var _lastTap=0;
      wrap.addEventListener('touchend',function(e){
        if(e.touches.length>0)return;
        var now=Date.now();
        if(now-_lastTap<300){_s.scale=1;_s.tx=0;_s.ty=0;applyT();}
        _lastTap=now;
      },{passive:true});
    }
    _showStoryOptsBtn();
  };
  if(type==='image'){
    compressImage(file,1080,0.85)
      .then(blob=>showInPreview(blob,URL.createObjectURL(blob)))
      .catch(()=>showInPreview(file,URL.createObjectURL(file)));
  } else {
    showInPreview(file,URL.createObjectURL(file));
  }
}

async function publishStory(){
  const hasBgTemplate = window._storyBgTemplate && !pendingStoryMedia;
  if(!pendingStoryMedia && !hasBgTemplate){toast('Seleziona una foto, video o scegli uno sfondo!','error');return;}
  try{
    const fd=new FormData();
    if(pendingStoryMedia){
      if(pendingStoryMedia.blob&&pendingStoryMedia.type==='image') fd.append('file',pendingStoryMedia.blob,'story.jpg');
      else fd.append('file',pendingStoryMedia.file||pendingStoryMedia.blob);
    } else if(hasBgTemplate){
      fd.append('bgTemplate', window._storyBgTemplate);
    }
    const caption=document.getElementById('story-caption')?.value||'';
    fd.append('caption',caption);
    fd.append('filter',storySelectedFilter||'none');
    fd.append('duration', document.getElementById('sc-duration')?.value || '15');
    fd.append('music',storySelectedMusic||'none');
    fd.append('musicTitle',storySelectedMusicTitle||'');
    if(storyTextLayers.length) fd.append('textOverlays',JSON.stringify(storyTextLayers));
    const tok=localStorage.getItem('gc_token');
    const d = await uploadWithProgress('/api/stories', fd, {'Authorization':'Bearer '+tok});
    window._storyBgTemplate=null;
    closeStoryCreator();
    toast('Storia pubblicata!');checkDailyMission('story');
    loadStories();
  }catch(e){toast(e.message,'error');}
}

function viewStoryGroup(groupIdx){
  const groups=window._storyGroups||[];
  if(!groups[groupIdx])return;
  currentStoryGroup=groupIdx;
  currentStoryIdx=0;
  showStory();
}

function showStory(){
  const groups=window._storyGroups||[];
  const group=groups[currentStoryGroup];
  if(!group||currentStoryIdx>=group.items.length){closeStory();return;}
  const story=group.items[currentStoryIdx];
  if(ME)POST('/api/stories/'+story._id+'/view').catch(()=>{});

  document.getElementById('story-viewer')?.remove();
  stopStoryViewerMusic();
  const viewer=document.createElement('div');
  viewer.className='story-viewer';
  viewer.id='story-viewer';
  const progBars=group.items.map((_,i)=>`<div class="story-prog-bar"><div class="story-prog-fill" id="spf-${i}" style="width:${i<currentStoryIdx?'100%':'0%'}"></div></div>`).join('');

  const uAvatar=group.user.avatarUrl
    ?`<img src="${group.user.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    :(group.user.avatar||initials(group.user.username));

  const bgMedia=story.mediaType==='video'
    ?`<video src="${story.mediaUrl}" autoplay muted loop playsinline style="pointer-events:none"></video>`
    :story.mediaType==='template'||!story.mediaUrl
    ?`<div style="position:absolute;inset:0;background:${story.bgTemplate||'linear-gradient(135deg,#9C7CFF,#FF9ECD)'};pointer-events:none"></div>`
    :`<img src="${story.mediaUrl}" alt="" style="pointer-events:none" onerror="this.parentElement.style.background='linear-gradient(135deg,#9C7CFF,#FF9ECD)'">`;

  const filterCSS=story.filter&&story.filter!=='none'?`style="filter:${story.filter}"`:'';
  const mainMedia=story.mediaType==='video'
    ?`<video id="sv-vid" class="story-media-fullscreen" src="${story.mediaUrl}" autoplay playsinline preload="auto" ${filterCSS} oncontextmenu="return false"></video>`
    :story.mediaType==='template'||!story.mediaUrl
    ?`<div class="story-media-fullscreen" style="background:${story.bgTemplate||'linear-gradient(135deg,#9C7CFF,#FF9ECD)'}"></div>`
    :`<img id="sv-img" class="story-media-fullscreen" src="${story.mediaUrl}" loading="eager" draggable="false" ${filterCSS} onerror="this.style.display='none';const bg=this.parentElement?.querySelector('.story-viewer-bg');if(bg)bg.style.opacity='1'">`;

  // Text overlays HTML
  const overlaysHTML=(story.textOverlays||[]).map(t=>{
    const isTag=t.isTag;
    const style=isTag
      ?`top:${t.y||70}%;left:${t.x||15}%;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);padding:5px 12px;border-radius:20px;font-size:.85rem`
      :`top:${t.y||40}%;left:${t.x||10}%`;
    return `<div class="sc-text-layer" style="${style}">${escHTML(t.text)}</div>`;
  }).join('');

  // Music badge
  const musicBadge=story.musicTitle?`<div class="story-music-tap" onclick="retryStoryMusic()" style="position:absolute;bottom:calc(60px + var(--sab,0px));left:12px;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);border-radius:20px;padding:6px 14px;z-index:10;display:flex;align-items:center;gap:6px;cursor:pointer;transition:transform .15s"><span style="animation:spin 3s linear infinite;display:inline-block;font-size:1rem">🎵</span><span style="color:#fff;font-size:.75rem;font-weight:700;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(story.musicTitle)}</span></div>`:'';

  viewer.innerHTML=`
    <div class="story-viewer-bg">${bgMedia}</div>
    ${mainMedia}
    ${overlaysHTML}
    ${musicBadge}
    <div class="story-viewer-progress">${progBars}</div>
    <div class="story-viewer-header">
      <div class="avatar-circle" style="width:38px;height:38px;overflow:hidden;background:${pickColor(group.user.username)};font-size:.92rem;flex-shrink:0;border:2px solid rgba(255,255,255,.45)">${uAvatar}</div>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-weight:700;font-size:.86rem;text-shadow:0 1px 5px rgba(0,0,0,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(group.user.username)}</div>
        <div style="color:rgba(255,255,255,.6);font-size:.68rem">${timeAgo(story.timestamp)}</div>
      </div>
    </div>
    ${story.caption?`<div class="story-caption">${escHTML(story.caption)}</div>`:''}
    <button class="story-viewer-close" onclick="closeStory()">✕</button>
    ${story.mediaType==='video'?`<button class="story-mute-btn" id="sv-mute" onclick="svToggleMute()" title="Audio">${svMuted?'🔇':'🔊'}</button>`:''}
    ${ME&&(ME._id===group.user._id||['admin','superadmin'].includes(ME.role))
      ?`<button onclick="deleteStory('${story._id}')" style="position:absolute;top:calc(16px + var(--sat,0px));right:54px;background:rgba(255,107,107,.4);border:none;border-radius:50%;width:36px;height:36px;color:#fff;font-size:.9rem;cursor:pointer;z-index:5;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">🗑️</button>`:''}
    <div class="story-tap-zone story-tap-left" onpointerdown="storyHoldStart(event)" onpointerup="storyHoldEnd(event,'prev')" onpointercancel="storyHoldEnd(event,null)"></div>
    <div class="story-tap-zone story-tap-right" onpointerdown="storyHoldStart(event)" onpointerup="storyHoldEnd(event,'next')" onpointercancel="storyHoldEnd(event,null)"></div>
    <div class="story-pause-indicator" id="sv-pause-ind">⏸</div>`;

  document.body.appendChild(viewer);

  // Play story music if present
  if(story.music && story.music!=='none' && (story.music.startsWith('http')||story.music.startsWith('/'))){
    stopStoryViewerMusic();
    const src = story.music;
    const tryPlay=()=>{
      if(_storyViewerAudio){ try{_storyViewerAudio.pause();}catch{} }
      _storyViewerAudio=new Audio(src);
      _storyViewerAudio.volume=0.6;
      _storyViewerAudio.loop=true;
      const p=_storyViewerAudio.play();
      if(p instanceof Promise){
        p.catch(()=>{
          // Autoplay blocked - anima il badge come segnale visivo
          const badge=viewer.querySelector('.story-music-tap');
          if(badge){ badge.style.animation='pulse 1s ease infinite'; badge.title='Tocca per attivare la musica'; }
          // Prova di nuovo al primo tocco dell'utente
          const unlock=()=>{
            document.removeEventListener('touchstart',unlock,{once:true});
            document.removeEventListener('click',unlock,{once:true});
            if(_storyViewerAudio) _storyViewerAudio.play().catch(()=>{});
          };
          document.addEventListener('touchstart',unlock,{once:true,passive:true});
          document.addEventListener('click',unlock,{once:true});
        });
      }
    };
    setTimeout(tryPlay,150);
  }

  clearTimeout(storyTimer);
  const bar=document.getElementById('spf-'+currentStoryIdx);

  const startBar=(dur)=>{
    if(bar){bar.style.transition='none';bar.style.width='0%';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.transition=`width ${dur/1000}s linear`;bar.style.width='100%';}));
    }
    storyTimer=setTimeout(nextStory,dur);
  };

  if(story.mediaType==='video'){
    const vid=viewer.querySelector('#sv-vid');
    vid.muted=svMuted;
    vid.addEventListener('loadedmetadata',()=>{
      const dur=Math.min((isFinite(vid.duration)?vid.duration:10),60)*1000;
      startBar(dur);
    },{once:true});
    vid.addEventListener('error',()=>startBar(8000),{once:true});
    setTimeout(()=>{ if(!storyTimer&&bar?.style.width==='0%') startBar(8000); },3500);
  } else {
    // Durata storia immagine: usa il valore scelto dall'utente (default 15s, max 15s)
    const storyDurationMs = (story.duration || 15) * 1000;
    startBar(storyDurationMs);
  }
}

let _storyViewerAudio=null;
function stopStoryViewerMusic(){try{_storyViewerAudio?.pause();_storyViewerAudio=null;}catch{}}
function retryStoryMusic(){
  if(_storyViewerAudio){
    _storyViewerAudio.play().catch(()=>{});
  } else {
    const groups=window._storyGroups||[];
    const group=groups[currentStoryGroup];
    if(!group)return;
    const story=group.items[currentStoryIdx];
    if(story?.music&&story.music!=='none'&&story.music.startsWith('http')){
      _storyViewerAudio=new Audio(story.music);
      _storyViewerAudio.volume=0.4;
      _storyViewerAudio.loop=true;
      _storyViewerAudio.play().catch(()=>{});
    }
  }
}

let svMuted=false;
function svToggleMute(){
  svMuted=!svMuted;
  const vid=document.getElementById('sv-vid');
  if(vid)vid.muted=svMuted;
  const btn=document.getElementById('sv-mute');
  if(btn)btn.textContent=svMuted?'🔇':'🔊';
}

function nextStory(){
  const groups=window._storyGroups||[];
  const group=groups[currentStoryGroup];
  if(!group)return;
  if(currentStoryIdx+1<group.items.length){ currentStoryIdx++; showStory(); }
  else if(currentStoryGroup+1<groups.length){ currentStoryGroup++; currentStoryIdx=0; showStory(); }
  else closeStory();
}
function prevStory(){ if(currentStoryIdx>0){currentStoryIdx--;showStory();} }
function closeStory(){ clearTimeout(storyTimer); storyPauseStart=0; stopStoryViewerMusic(); document.getElementById('story-viewer')?.remove(); }

/* ── Story pause on hold ── */
let storyPauseStart=0, storyHoldTimeout=null;
function storyHoldStart(e){
  e.preventDefault();
  // Long press = pause (dopo 150ms per distinguere da tap)
  storyHoldTimeout=setTimeout(()=>{
    storyPauseStart=Date.now();
    clearTimeout(storyTimer);
    // Pausa video se presente
    const vid=document.querySelector('#sv-vid');
    if(vid)vid.pause();
    // Pausa musica storia
    try{_storyViewerAudio?.pause();}catch{}
    // Pausa progress bar
    const bar=document.getElementById('spf-'+currentStoryIdx);
    if(bar){
      const computed=getComputedStyle(bar).width;
      bar.style.transition='none';
      bar.style.width=computed;
    }
    // Mostra indicatore pausa
    let ind=document.querySelector('.story-pause-indicator');
    if(!ind){
      ind=document.createElement('div');
      ind.className='story-pause-indicator';
      ind.textContent='⏸';
      document.getElementById('story-viewer')?.appendChild(ind);
    }
    ind.classList.add('visible');
  },150);
}
function storyHoldEnd(e,dir){
  e.preventDefault();
  clearTimeout(storyHoldTimeout);
  // Rimuovi indicatore pausa
  document.querySelector('.story-pause-indicator')?.classList.remove('visible');
  if(storyPauseStart>0){
    // Era in pausa: riprendi
    storyPauseStart=0;
    // Riprendi musica storia
    try{_storyViewerAudio?.play().catch(()=>{});}catch{}
    const vid=document.querySelector('#sv-vid');
    if(vid){
      vid.play().catch(()=>{});
      // Ricalcola durata rimanente
      const remaining=(vid.duration-vid.currentTime)*1000;
      const bar=document.getElementById('spf-'+currentStoryIdx);
      if(bar){bar.style.transition=`width ${remaining/1000}s linear`;bar.style.width='100%';}
      storyTimer=setTimeout(nextStory,remaining);
    } else {
      // Foto: riprendi con 5s rimanenti
      const bar=document.getElementById('spf-'+currentStoryIdx);
      if(bar){bar.style.transition='width 2s linear';bar.style.width='100%';}
      storyTimer=setTimeout(nextStory,2000);
    }
  } else {
    // Era un tap normale
    if(dir==='prev') prevStory();
    else if(dir==='next') nextStory();
  }
}
async function deleteStory(id){
  if(!confirm('Eliminare questa storia?'))return;
  try{
    await DEL('/api/stories/'+id);
    toast('Storia eliminata','info');
    closeStory();
    loadStories();
  }catch(e){toast(e.message,'error');}
}

/* ============================================================
   UTILITÀ MEDIA
============================================================ */
// ── MEDIA OPTIMIZATION ENGINE v11 ──
const _uploadQueue = [];
let _uploadActive = 0;
const MAX_CONCURRENT_UPLOADS = 2;

function compressImage(file, maxSize, quality){
  const validTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/heic','image/heif'];
  const validExts = /\.(jpe?g|png|gif|webp|heic|heif)$/i;
  if (!validTypes.includes(file.type) && !validExts.test(file.name)) {
    return Promise.resolve(file);
  }
  return new Promise(resolve=>{
    const img=new Image();
    let objUrl=null;
    const cleanup=()=>{ if(objUrl){URL.revokeObjectURL(objUrl);objUrl=null;} };
    img.onload=()=>{
      try{
        let w=img.width||1, h=img.height||1;
        if(w>maxSize||h>maxSize){
          if(w>h){h=Math.round(h*maxSize/w);w=maxSize;}
          else{w=Math.round(w*maxSize/h);h=maxSize;}
        }
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d');
        if(!ctx){cleanup();resolve(file);return;}
        ctx.drawImage(img,0,0,w,h);
        cleanup();
        canvas.toBlob(blob=>{
          if(blob&&blob.size>0) resolve(blob);
          else resolve(file);
        },'image/jpeg',quality);
      }catch(e){cleanup();resolve(file);}
    };
    img.onerror=()=>{cleanup();resolve(file);};
    try{
      objUrl=URL.createObjectURL(file);
      img.src=objUrl;
    }catch(e){resolve(file);}
  });
}

// Compress media before upload (photos compressed, videos size-checked)
async function prepareMediaForUpload(file, maxImgSize, imgQuality){
  maxImgSize = maxImgSize || 1200;
  imgQuality = imgQuality || 0.82;
  if(file.type.startsWith('image/')){
    const compressed = await compressImage(file, maxImgSize, imgQuality);
    return { file: compressed, name: 'photo.jpg', type: 'image' };
  }
  if(file.type.startsWith('video/')){
    // Check video size — warn if >50MB
    if(file.size > 50*1024*1024){
      toast('Video grande ('+Math.round(file.size/1024/1024)+'MB) — caricamento potrebbe richiedere tempo','info',5000);
    }
    return { file, name: file.name, type: 'video' };
  }
  if(file.type.startsWith('audio/')){
    return { file, name: file.name, type: 'audio' };
  }
  return { file, name: file.name, type: 'file' };
}

// Upload with progress bar
function uploadWithProgress(url, formData, headers, _retryCount){
  _retryCount = _retryCount || 0;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const settle = (fn, val) => { if(!settled){ settled=true; hideUploadProgress(); fn(val); } };
    xhr.open('POST', url);
    Object.keys(headers||{}).forEach(k => xhr.setRequestHeader(k, headers[k]));
    showUploadProgress(0);
    xhr.upload.onprogress = (e) => {
      if(e.lengthComputable) showUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if(xhr.status >= 200 && xhr.status < 300) settle(resolve, data);
        else settle(reject, new Error(data.error || 'Upload fallito ('+xhr.status+')'));
      } catch(e) {
        // Response not JSON — try fallback with fetch
        if(_retryCount < 1){
          console.warn('[UPLOAD] XHR response parse failed, retrying with fetch...');
          hideUploadProgress();
          uploadWithFetch(url, formData, headers).then(resolve).catch(reject);
        } else { settle(reject, new Error('Errore server durante upload')); }
      }
    };
    xhr.onerror = () => {
      if(_retryCount < 2){
        console.warn('[UPLOAD] XHR error, retry '+ (_retryCount+1));
        hideUploadProgress();
        setTimeout(()=>{ uploadWithProgress(url, formData, headers, _retryCount+1).then(resolve).catch(reject); }, 1000);
      } else { settle(reject, new Error('Errore di rete — controlla la connessione')); }
    };
    xhr.onabort = () => { settle(reject, new Error('Upload annullato')); };
    xhr.ontimeout = () => {
      if(_retryCount < 1){
        console.warn('[UPLOAD] XHR timeout, retrying...');
        hideUploadProgress();
        setTimeout(()=>{ uploadWithProgress(url, formData, headers, _retryCount+1).then(resolve).catch(reject); }, 1000);
      } else { settle(reject, new Error('Upload timeout — file troppo grande')); }
    };
    xhr.timeout = 300000;
    xhr.send(formData);
  });
}

// Fetch fallback per quando XHR ha problemi
async function uploadWithFetch(url, formData, headers){
  showUploadProgress(50);
  const r = await fetch(url, { method:'POST', headers: headers||{}, body: formData });
  hideUploadProgress();
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || 'Upload fallito');
  return d;
}

// Global upload progress bar
function showUploadProgress(pct){
  let bar = document.getElementById('gc-upload-progress');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'gc-upload-progress';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;height:3px;background:rgba(139,92,246,.15);pointer-events:none;transition:opacity .3s';
    bar.innerHTML = '<div id="gc-upload-bar" style="height:100%;background:linear-gradient(90deg,#8B5CF6,#EC4899);border-radius:0 2px 2px 0;transition:width .2s ease;width:0%"></div>';
    document.body.appendChild(bar);
  }
  bar.style.opacity = '1';
  const inner = document.getElementById('gc-upload-bar');
  if(inner) inner.style.width = pct + '%';
}
function hideUploadProgress(){
  const bar = document.getElementById('gc-upload-progress');
  if(bar){
    const inner = document.getElementById('gc-upload-bar');
    if(inner) inner.style.width = '100%';
    setTimeout(()=>{ bar.style.opacity = '0'; setTimeout(()=>{ if(inner) inner.style.width = '0%'; }, 300); }, 500);
  }
}

// Queued upload — prevents simultaneous overload
function queueUpload(uploadFn){
  return new Promise((resolve, reject) => {
    _uploadQueue.push({ fn: uploadFn, resolve, reject });
    processUploadQueue();
  });
}
async function processUploadQueue(){
  if(_uploadActive >= MAX_CONCURRENT_UPLOADS || !_uploadQueue.length) return;
  _uploadActive++;
  const { fn, resolve, reject } = _uploadQueue.shift();
  try {
    const result = await fn();
    resolve(result);
  } catch(e) {
    reject(e);
  } finally {
    _uploadActive--;
    if(_uploadQueue.length) processUploadQueue();
  }
}

function openLightbox(src, type='image'){
  const lb=document.createElement('div');
  lb.className='lightbox';
  const media = type==='video'
    ? `<video src="${src}" controls autoplay playsinline></video>`
    : `<img src="${src}" alt="">`;
  lb.innerHTML=`
    <div class="lightbox-blur-bg" style="background-image:url('${type==='image'?src:''}')"></div>
    ${media}
    <button class="lightbox-close" onclick="this.closest('.lightbox').remove()">✕</button>`;
  lb.onclick=e=>{ if(e.target===lb)lb.remove(); };
  document.body.appendChild(lb);
}

/* ============================================================
   DM — DIRECT MESSAGES
============================================================ */
let dmCurrentUser=null;

function openDM(){
  if(!ME){openAuth();return;}
  dmCurrentUser=null;
  renderDMSheet();
  document.getElementById('dm-overlay').classList.add('open');
}

function openDMWith(uid){
  if(!ME){openAuth();return;}
  GET('/api/users/'+uid).then(u=>{
    dmCurrentUser={_id:u._id,username:u.username,avatar:u.avatar};
    renderDMSheet();
    document.getElementById('dm-overlay').classList.add('open');
    loadDMChat(uid);
  }).catch(()=>{});
}

function closeDM(){ document.getElementById('dm-overlay').classList.remove('open'); dmCurrentUser=null; }

async function renderDMSheet(){
  const sheet=document.getElementById('dm-sheet');
  if(!sheet)return;
  if(dmCurrentUser){
    sheet.innerHTML=`
      <div class="dm-chat-header">
        <button onclick="dmCurrentUser=null;renderDMSheet()" style="flex-shrink:0">←</button>
        <div class="avatar-circle" style="width:38px;height:38px;background:${pickColor(dmCurrentUser.username)};font-size:.95rem;overflow:hidden;flex-shrink:0">${dmCurrentUser.avatarUrl?`<img src="${dmCurrentUser.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:dmCurrentUser.avatar||initials(dmCurrentUser.username)}</div>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${escHTML(dmCurrentUser.username)}</strong></div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${IS_NATIVE_APK?`<button class="call-dm-btn" data-dm-uid="${dmCurrentUser._id}" data-dm-un="${escAttr(dmCurrentUser.username)}" data-dm-av="${escAttr(dmCurrentUser.avatar||'👤')}" data-dm-vid="0" title="Chiamata vocale" style="background:rgba(52,199,89,.15);border:1px solid rgba(52,199,89,.3);color:#34C759;border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center">📞</button>
          <button class="call-dm-btn" data-dm-uid="${dmCurrentUser._id}" data-dm-un="${escAttr(dmCurrentUser.username)}" data-dm-av="${escAttr(dmCurrentUser.avatar||'👤')}" data-dm-ch="1" title="Sfida 1v1" style="background:rgba(255,107,107,.15);border:1px solid rgba(255,107,107,.3);color:var(--coral);border-radius:50%;width:34px;height:34px;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center">⚔️</button>`:''}
          <button class="dm-close" onclick="closeDM()">✕</button>
        </div>
      </div>
      <div class="dm-chat" id="dm-chat-body">
        <div class="dm-messages" id="dm-messages"><div class="spinner"></div></div>
        <div class="dm-rec-bar" id="dm-rec-bar">
          <span class="dm-rec-dot"></span>
          <span id="dm-rec-time" style="font-weight:700;font-size:.83rem;color:var(--coral);min-width:30px">0:00</span>
          <span style="flex:1;font-size:.78rem;color:var(--muted)">Registrazione...</span>
          <button onclick="voiceCancelRec()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.82rem;padding:3px">✕</button>
          <button onclick="voiceStopRec()" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:20px;padding:5px 12px;font-size:.78rem;font-weight:700;cursor:pointer">⏹ Invia</button>
        </div>
        <div class="dm-input-row">
          <label class="upload-btn" for="dm-media-input" style="flex-shrink:0;padding:10px;height:42px;box-sizing:border-box;display:flex;align-items:center">📷</label>
          <input type="file" id="dm-media-input" accept="image/*,video/*,audio/*" capture="environment" style="display:none" onchange="sendDMMedia(this)">
          <button id="dm-mic-btn" onclick="voiceToggleRec()" style="display:none;background:rgba(162,155,254,.1);color:var(--purple);border:2px solid rgba(162,155,254,.25);border-radius:50%;width:42px;height:42px;cursor:pointer;font-size:1rem;flex-shrink:0;transition:all .2s;align-items:center;justify-content:center">🎤</button>
          <input class="dm-input" id="dm-input" placeholder="Scrivi un messaggio..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendDM();}">
          <button class="dm-send-btn" onclick="sendDM()">➤</button>
        </div>
      </div>`;
    await loadDMChat(dmCurrentUser._id);
    dmInitMic();
  } else {
    sheet.innerHTML=`
      <div class="dm-header">
        <div class="dm-header-title">✉️ Messaggi</div>
        <button onclick="markAllDMRead()" style="background:none;border:1px solid rgba(139,92,246,.2);color:var(--coral);border-radius:20px;padding:5px 12px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--fb)">Segna letti</button>
        <button class="dm-close" onclick="closeDM()">✕</button>
      </div>
      <div class="dm-list" id="dm-conv-list"><div class="spinner"></div></div>`;
    await loadDMConversations();
  }
}

async function loadDMConversations(){
  const el=document.getElementById('dm-conv-list');
  if(!el)return;
  try{
    const convs=await GET('/api/messages');
    if(!convs.length){
      el.innerHTML=`<div class="dm-empty"><div class="de">✉️</div><p style="font-weight:700;color:var(--dark);margin-bottom:6px">Nessun messaggio ancora</p><p style="font-size:.82rem">Clicca sul profilo di un utente per iniziare!</p></div>`;
      return;
    }
    el.innerHTML=convs.map((c,i)=>`
      <div class="dm-conv-item" data-idx="${i}">
        <div class="avatar-circle" style="width:46px;height:46px;background:${pickColor(c.user.username)};font-size:1.1rem;flex-shrink:0;overflow:hidden">${c.user.avatarUrl?`<img src="${c.user.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:c.user.avatar||initials(c.user.username)}</div>
        <div class="dm-conv-info">
          <div class="dm-conv-name">${escHTML(c.user.username)}</div>
          <div class="dm-conv-preview">${escHTML(c.lastMessage||'')}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="dm-conv-time">${timeAgo(c.timestamp)}</div>
          ${c.unread>0?`<div class="dm-unread-badge">${c.unread}</div>`:''}
          <button class="dm-delete-conv-btn" data-uid="${c.user._id}" onclick="deleteConversation(event,'${c.user._id}','${escAttr(c.user.username)}')" title="Elimina conversazione">🗑️</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('.dm-conv-item').forEach((item,i)=>{
      item.onclick=(e)=>{
        if(e.target.classList.contains('dm-delete-conv-btn')||e.target.closest('.dm-delete-conv-btn'))return;
        dmCurrentUser={_id:convs[i].user._id,username:convs[i].user.username,avatar:convs[i].user.avatar};
        renderDMSheet();
      };
    });
  }catch(e){ if(el)el.innerHTML=`<div class="dm-empty"><p>${e.message}</p></div>`; }
}

async function deleteConversation(e, uid, username){
  e.stopPropagation();
  if(!confirm(`Eliminare la conversazione con ${username}?`)) return;
  try{
    await DEL('/api/messages/'+uid);
    toast('Conversazione eliminata','info');
    await loadDMConversations();
  }catch(err){ toast(err.message,'error'); }
}

function renderDMMessage(m){
  const sent=m.fromId===ME._id;
  let content='';
  if(m.text){
    const txt=escHTML(m.text).replace(/\n/g,'<br>');
    content+=`<span class="dm-text">${txt}</span>`;
  }
  if(m.mediaUrl){
    if(m.mediaType==='audio'){
      // Beautiful voice message player with waveform
      const vid='vp_'+(m._id||Math.random().toString(36).slice(2));
      const bars=Array.from({length:32},(_,i)=>{
        const h=Math.max(18,Math.min(92,32+Math.sin(i*0.65+1.1)*24+Math.sin(i*1.3)*16));
        return `<div class="voice-bar" style="height:${h.toFixed(0)}%"></div>`;
      }).join('');
      content+=`<div class="voice-player" id="${vid}">
        <button class="voice-play-btn" onclick="voicePlayerToggle('${vid}','${m.mediaUrl}')" title="Riproduci">▶</button>
        <div class="voice-bars" onclick="voicePlayerSeek('${vid}',event)">${bars}</div>
        <span class="voice-dur" id="${vid}_dur">0:00</span>
        <audio id="${vid}_audio" src="${m.mediaUrl}" preload="none" style="display:none" onerror="document.getElementById('${vid}')?.querySelector('.voice-play-btn')?.setAttribute('disabled','1')"></audio>
      </div>`;
    } else if(m.mediaType==='video'){
      content+=`<video src="${m.mediaUrl}" controls playsinline preload="none" style="max-width:220px;border-radius:10px;display:block;margin-top:4px"></video>`;
    } else {
      content+=`<img src="${m.mediaUrl}" style="max-width:220px;border-radius:10px;cursor:pointer;display:block;margin-top:4px" onclick="openLightbox('${m.mediaUrl}')" loading="lazy" onerror="this.style.display='none'">`;
    }
  }
  // Time + read receipt
  const readMark=sent?(m.read?'<span class="dm-read-check read">✓✓</span>':'<span class="dm-read-check">✓</span>'):'';
  const meta=`<div class="dm-msg-meta"><span class="dm-time">${timeAgo(m.timestamp)}</span>${readMark}</div>`;
  const msgId=m._id||'';
  const otherId=dmCurrentUser?._id||'';
  const delBtn=msgId&&otherId?`<button class="dm-del-btn" onclick="deleteDMMsg('${msgId}','${otherId}',this)" title="Elimina">🗑</button>`:'';
  return `<div class="dm-msg-wrap ${sent?'sent':'recv'}">${sent?'':delBtn}<div class="dm-msg ${sent?'sent':'recv'}">${content}${meta}</div>${sent?delBtn:''}</div>`;
}

// Voice message player controls
const _vpPlaying=new Map(); // vid → {audio, raf}
function voicePlayerToggle(vid, src){
  const audio=document.getElementById(vid+'_audio');
  const btn=document.querySelector(`#${vid} .voice-play-btn`);
  if(!audio||!btn)return;
  // Stop any other playing
  _vpPlaying.forEach((v,k)=>{if(k!==vid){try{v.audio.pause();v.audio.currentTime=0;}catch{}v.raf&&cancelAnimationFrame(v.raf);_vpStop(k);}});
  if(!audio.paused){
    audio.pause();
    _vpStop(vid);
    return;
  }
  if(!audio.src||audio.src==='undefined')audio.src=src;
  audio.play().then(()=>{
    btn.textContent='⏸';
    _vpPlaying.set(vid,{audio,raf:null});
    function tick(){
      const dur=audio.duration||0;
      const cur=audio.currentTime||0;
      const pct=dur>0?cur/dur:0;
      const bars=document.querySelectorAll(`#${vid} .voice-bar`);
      const played=Math.floor(pct*bars.length);
      bars.forEach((b,i)=>b.classList.toggle('pl',i<played));
      const durEl=document.getElementById(vid+'_dur');
      if(durEl){const m2=Math.floor(cur/60),s2=Math.floor(cur%60);durEl.textContent=m2+':'+(s2<10?'0':'')+s2;}
      if(!audio.paused){const s=_vpPlaying.get(vid);if(s)s.raf=requestAnimationFrame(tick);}
    }
    const s=_vpPlaying.get(vid);if(s)s.raf=requestAnimationFrame(tick);
    audio.onended=()=>_vpStop(vid);
  }).catch(()=>{});
}
function _vpStop(vid){
  const btn=document.querySelector(`#${vid} .voice-play-btn`);
  if(btn)btn.textContent='▶';
  document.querySelectorAll(`#${vid} .voice-bar`).forEach(b=>b.classList.remove('pl'));
  _vpPlaying.delete(vid);
}
function voicePlayerSeek(vid,evt){
  const audio=document.getElementById(vid+'_audio');
  const barsEl=document.querySelector(`#${vid} .voice-bars`);
  if(!audio||!barsEl||!audio.duration)return;
  const rect=barsEl.getBoundingClientRect();
  const pct=(evt.clientX-rect.left)/rect.width;
  audio.currentTime=pct*audio.duration;
}

async function deleteDMMsg(msgId,otherId,btn){
  if(!confirm('Eliminare questo messaggio?'))return;
  try{
    await DEL('/api/messages/'+otherId+'/'+msgId);
    btn.closest('.dm-msg-wrap')?.remove();
    toast('Messaggio eliminato','info',1500);
  }catch(e){toast(e.message,'error');}
}

async function loadDMChat(uid){
  // Bind DM header action buttons safely
  document.querySelectorAll('.call-dm-btn').forEach(btn => {
    btn.onclick = () => {
      const u = btn.dataset.dmUid;
      const n = btn.dataset.dmUn;
      const av = btn.dataset.dmAv;
      if (btn.dataset.dmCh) { challengeUser(u, n, av); }
      else { callUser(u, n, av, !!parseInt(btn.dataset.dmVid || '0')); }
    };
  });
  const el=document.getElementById('dm-messages');
  if(!el)return;
  try{
    const {messages}=await GET('/api/messages/'+uid);
    if(!messages.length){
      el.innerHTML=`<div class="dm-empty"><div class="de">👋</div><p>Inizia la conversazione!</p></div>`;
    } else {
      el.innerHTML=messages.map(m=>renderDMMessage(m)).join('');
    }
    el.scrollTop=el.scrollHeight;
    updateDMBadge();
  }catch(e){if(el)el.innerHTML=`<div class="dm-empty"><p>${e.message}</p></div>`;}
}

async function sendDM(){
  const inp=document.getElementById('dm-input');
  const text=inp?.value?.trim();
  if(!text||!dmCurrentUser)return;
  inp.value='';
  try{
    await POST('/api/messages/'+dmCurrentUser._id,{text});
    appendDMMessage({fromId:ME._id,text,timestamp:Date.now()});
    checkDailyMission('dm');checkDailyMission('dm3');
  }catch(e){toast(e.message,'error');}
}

async function sendDMMedia(input){
  const file=input.files[0];
  if(!file||!dmCurrentUser)return;
  try{
    const prepared = await prepareMediaForUpload(file, 1200, 0.8);
    const fd=new FormData();
    fd.append('file', prepared.file, prepared.name);
    const tok=localStorage.getItem('gc_token');
    const d = await uploadWithProgress('/api/messages/'+dmCurrentUser._id, fd, {'Authorization':'Bearer '+tok});
    appendDMMessage({fromId:ME._id,text:'',mediaUrl:d.mediaUrl,mediaType:d.mediaType,timestamp:Date.now()});
  }catch(e){toast(e.message,'error');}
  input.value='';
}

function appendDMMessage(m){
  const el=document.getElementById('dm-messages');
  if(!el)return;
  const emptyState=el.querySelector('.dm-empty');
  if(emptyState)el.innerHTML='';
  const div=document.createElement('div');
  div.innerHTML=renderDMMessage(m);
  el.appendChild(div.firstElementChild||div);
  el.scrollTop=el.scrollHeight;
}

async function markAllDMRead(){
  try{
    await POST('/api/messages/mark-all-read');
    toast('Tutti i messaggi segnati come letti');
    updateDMBadge();
    renderDMSheet();
  }catch(e){toast(e.message||'Errore','error');}
}

async function updateDMBadge(){
  if(!ME)return;
  try{
    const {count}=await GET('/api/messages/unread/count');
    const badge=document.getElementById('dm-nav-badge');
    if(badge){ badge.textContent=count; badge.style.display=count>0?'flex':'none'; }
  }catch{}
}

/* ============================================================
   SSE — Real-time con notifiche
============================================================ */
/* ============================================================
   VOICE MESSAGES (DM)
============================================================ */
let _vmr=null,_vmChunks=[],_vmInt=null,_vmSec=0;

function dmInitMic(){
  const btn=document.getElementById('dm-mic-btn');
  if(!btn)return;
  // Mostra solo su touch device con MediaRecorder
  if(('ontouchstart' in window||navigator.maxTouchPoints>0)&&window.MediaRecorder)
    btn.style.display='flex';
}

function voiceToggleRec(){
  if(_vmr&&_vmr.state==='recording') voiceStopRec();
  else voiceStartRec();
}

async function voiceStartRec(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    const AUDIO_TYPES=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg',''];
    const mt=AUDIO_TYPES.find(t=>!t||MediaRecorder.isTypeSupported(t))||'';
    _vmr=new MediaRecorder(stream,mt?{mimeType:mt,audioBitsPerSecond:64000}:{audioBitsPerSecond:64000});
    _vmChunks=[];
    _vmr.ondataavailable=e=>{if(e.data?.size>0)_vmChunks.push(e.data);};
    _vmr.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(_vmChunks,{type:_vmr.mimeType||'audio/webm'});
      _vmChunks=[];
      if(blob.size<500){toast('Registrazione troppo breve','error');return;}
      await voiceSend(blob,_vmr.mimeType||'audio/webm');
    };
    _vmr.start(200);
    document.getElementById('dm-rec-bar').style.display='flex';
    document.getElementById('dm-input').style.display='none';
    const mb=document.getElementById('dm-mic-btn');
    if(mb){mb.style.background='rgba(255,107,107,.2)';mb.style.borderColor='var(--coral)';}
    _vmSec=0;
    clearInterval(_vmInt);
    _vmInt=setInterval(()=>{
      _vmSec++;
      const el=document.getElementById('dm-rec-time');
      if(el){const m=Math.floor(_vmSec/60),s=_vmSec%60;el.textContent=m+':'+(s<10?'0':'')+s;}
      if(_vmSec>=120)voiceStopRec();
    },1000);
  }catch(e){
    toast(e.name==='NotAllowedError'?'Permesso microfono negato':'Microfono non disponibile','error');
  }
}

function voiceStopRec(){
  if(_vmr&&_vmr.state!=='inactive'){try{_vmr.stop();}catch{}}
  clearInterval(_vmInt);
  document.getElementById('dm-rec-bar').style.display='none';
  document.getElementById('dm-input').style.display='';
  const mb=document.getElementById('dm-mic-btn');
  if(mb){mb.style.background='';mb.style.borderColor='';}
}

function voiceCancelRec(){
  if(_vmr&&_vmr.state!=='inactive'){
    _vmr.ondataavailable=null;_vmr.onstop=null;
    try{_vmr.stream?.getTracks().forEach(t=>t.stop());_vmr.stop();}catch{}
  }
  _vmChunks=[];
  voiceStopRec();
}

async function voiceSend(blob,mimeType){
  if(!dmCurrentUser)return;
  const mt=mimeType||'audio/webm';
  let ext='.webm';
  if(mt.includes('mp4')||mt.includes('m4a'))ext='.m4a';
  else if(mt.includes('ogg'))ext='.ogg';
  else if(mt.includes('wav'))ext='.wav';
  const fd=new FormData();
  fd.append('file',new File([blob],'voice'+ext,{type:mt}));
  const tok=localStorage.getItem('gc_token');
  try{
    const r=await fetch('/api/messages/'+dmCurrentUser._id,{method:'POST',headers:{'Authorization':'Bearer '+tok},body:fd});
    const ct=r.headers.get('content-type')||'';
    const d=ct.includes('json')?await r.json().catch(()=>({})):{};
    if(!r.ok)throw new Error(d.error||'Errore upload vocale');
    appendDMMessage({_id:d._id,fromId:ME._id,text:'',mediaUrl:d.mediaUrl,mediaType:'audio',timestamp:Date.now()});
    toast('🎤 Messaggio vocale inviato','info',1500);
  }catch(e){toast(e.message,'error');console.warn('[voiceSend]',e);}
}

/* ============================================================
   WEBRTC CALLS
============================================================ */
let callState=null; // null | { callId, peerId, peerName, localStream, pc, isMonitor }
const _pendingIce=new Map(); // callId → RTCIceCandidate[] bufferizzati prima che callState sia pronto

const ICE_SERVERS={iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun2.l.google.com:19302'},
  {urls:'stun:stun.cloudflare.com:3478'},
  {urls:'stun:stun.relay.metered.ca:80'},
  // TURN relay (funziona anche dietro NAT simmetrico)
  {urls:'turn:a.relay.metered.ca:80',username:'e13b6accfab44ae88f8b4cf1',credential:'k4VxHyVntypMId/S'},
  {urls:'turn:a.relay.metered.ca:80?transport=tcp',username:'e13b6accfab44ae88f8b4cf1',credential:'k4VxHyVntypMId/S'},
  {urls:'turn:a.relay.metered.ca:443',username:'e13b6accfab44ae88f8b4cf1',credential:'k4VxHyVntypMId/S'},
  {urls:'turns:a.relay.metered.ca:443?transport=tcp',username:'e13b6accfab44ae88f8b4cf1',credential:'k4VxHyVntypMId/S'},
]};

// Carica ICE config dal server (con TURN reali se configurati)
let _iceConfigLoaded=false;
let _iceConfigExpiry=0;
async function loadIceConfig(){
  if(_iceConfigLoaded && Date.now()<_iceConfigExpiry) return;
  try{
    const r=await GET('/api/ice-servers');
    if(r&&r.iceServers&&r.iceServers.length){
      ICE_SERVERS.iceServers=r.iceServers;
      if(r.iceCandidatePoolSize) ICE_SERVERS.iceCandidatePoolSize=r.iceCandidatePoolSize;
      console.log('[ICE] Config caricata dal server:', r.iceServers.length,'servers');
    }
  }catch{}
  _iceConfigLoaded=true;
  _iceConfigExpiry=Date.now()+3600000; // ricarica ogni ora
}

async function callUser(uid,username,avatar,videoEnabled=false){
  if(!ME){openAuth();return;}
  if(callState){toast('Sei già in una chiamata','error');return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('Chiamate non disponibili su questo browser','error');return;}
  await loadIceConfig();
  try{
    const constraints={audio:true,video:videoEnabled?{facingMode:'user'}:false};
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia(constraints); }
    catch(camErr){
      if(videoEnabled){ toast('📷 Camera non disponibile, solo audio','info',2500); stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); videoEnabled=false; }
      else throw camErr;
    }
    const pc=new RTCPeerConnection(ICE_SERVERS);
    // ── FIX: buffer ICE candidates generated before callId is known ──
    const _earlyIce=[];
    let _callIdKnown=null;

    // ── Set ALL handlers BEFORE any SDP operation ──
    pc.onicecandidate=e=>{
      if(!e.candidate)return;
      if(_callIdKnown) POST('/api/calls/ice',{callId:_callIdKnown,candidate:e.candidate,targetUserId:uid}).catch(()=>{});
      else _earlyIce.push(e.candidate);
    };
    pc.ontrack=e=>{
      const rv=document.getElementById('call-remote-video');
      if(rv&&e.streams[0]){
        rv.srcObject=e.streams[0];
        rv.muted=false;rv.volume=1.0;
        const tryPlay=()=>{rv.play().catch(()=>{
          const wrap=rv.parentElement;
          if(wrap&&!wrap.querySelector('.call-play-overlay')){
            const btn=document.createElement('button');btn.className='call-play-overlay';
            btn.style.cssText='position:absolute;inset:0;margin:auto;width:70px;height:70px;border-radius:50%;background:rgba(255,255,255,.25);border:2px solid #fff;color:#fff;font-size:1.8rem;cursor:pointer;z-index:10;backdrop-filter:blur(4px)';
            btn.textContent='▶';btn.onclick=()=>{rv.play().catch(()=>{});btn.remove();};wrap.appendChild(btn);
          }
        });};
        tryPlay();setTimeout(()=>{if(rv.paused&&rv.srcObject)tryPlay();},500);
        document.getElementById('call-avatar-el').style.display='none';
      }
    };
    pc.onconnectionstatechange=()=>{
      const s=pc.connectionState;
      const lbl=document.getElementById('call-status-lbl');
      if(s==='connected'){
        if(lbl)lbl.textContent='✅ Connesso';
        clearTimeout(callState?._noAnswerTimeout);
        // Forza riproduzione video remoto (anti black screen)
        const rv=document.getElementById('call-remote-video');
        if(rv&&rv.srcObject){rv.play().catch(()=>{});}
      } else if(s==='connecting'){
        if(lbl)lbl.textContent='🔄 Connessione...';
      } else if(s==='disconnected'){
        if(lbl)lbl.textContent='⚠️ Segnale instabile...';
        // Prova ICE restart dopo 3s se ancora disconnesso
        setTimeout(()=>{
          if(callState?.pc===pc&&pc.connectionState==='disconnected'){
            try{pc.restartIce?.();}catch{}
            // Rinegozia se ICE restart non basta
            setTimeout(()=>{
              if(callState?.pc===pc&&pc.connectionState==='disconnected'){
                try{
                  pc.createOffer({iceRestart:true}).then(o=>pc.setLocalDescription(o)).then(()=>{
                    if(callState) POST('/api/calls/invite',{toUserId:uid,offer:pc.localDescription,videoEnabled,iceRestart:true}).catch(()=>{});
                  }).catch(()=>{});
                }catch{}
              }
            },4000);
          }
        },3000);
      } else if(s==='failed'){
        // Tentativo di recupero prima di chiudere
        try{
          pc.restartIce?.();
          pc.createOffer({iceRestart:true}).then(o=>pc.setLocalDescription(o)).then(()=>{
            if(callState) POST('/api/calls/invite',{toUserId:uid,offer:pc.localDescription,videoEnabled,iceRestart:true}).catch(()=>{});
          }).catch(()=>{
            toast('📵 Connessione persa','error',3000);
            callEnd();
          });
        }catch{
          toast('📵 Connessione persa','error',3000);
          callEnd();
        }
      }
    };

    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    // ICE gathering starts here — candidates go to _earlyIce buffer

    const {callId}=await POST('/api/calls/invite',{toUserId:uid,offer:pc.localDescription,videoEnabled});
    _callIdKnown=callId;
    callState={callId,peerId:uid,peerName:username,peerAvatar:avatar,localStream:stream,pc,isMonitor:false,videoEnabled};

    // Also emit via Socket.IO for faster delivery
    if(ioSocket&&ioSocket.connected){
      ioSocket.emit('call:ice_flush',{callId,targetUserId:uid});
    }

    // Drain early ICE candidates now that callId is known
    for(const c of _earlyIce) POST('/api/calls/ice',{callId,candidate:c,targetUserId:uid}).catch(()=>{});
    // Also drain any remote ICE that arrived via SSE before callState was set
    if(_pendingIce.has(callId)){
      for(const c of _pendingIce.get(callId)) try{await pc.addIceCandidate(new RTCIceCandidate(c));}catch{}
      _pendingIce.delete(callId);
    }

    callState._noAnswerTimeout=setTimeout(()=>{
      if(callState?.callId===callId&&document.getElementById('call-status-lbl')?.textContent!=='✅ Connesso'){
        toast('📵 Nessuna risposta','info',3000); callEnd();
      }
    },45000);

    showCallUI(username,avatar,'📞 Chiamata in corso...','outgoing',videoEnabled,stream);
    toast(`📞 Chiamata a ${username}...`,'info',3000);
  }catch(e){toast(e.message,'error');}
}

let _callTimer=null, _callSeconds=0;
function showCallUI(name,avatar,status,mode,videoEnabled,localStream){
  const ov=document.getElementById('call-overlay');
  ov.classList.add('active');
  document.getElementById('call-name-lbl').textContent=name;
  document.getElementById('call-status-lbl').textContent=status;
  // Avvia timer di durata chiamata
  clearInterval(_callTimer); _callSeconds=0;
  _callTimer=setInterval(()=>{
    _callSeconds++;
    const mm=String(Math.floor(_callSeconds/60)).padStart(2,'0');
    const ss=String(_callSeconds%60).padStart(2,'0');
    const lbl=document.getElementById('call-status-lbl');
    if(lbl&&lbl.textContent.startsWith('✅')) lbl.textContent=`✅ ${mm}:${ss}`;
  },1000);
  // Avatar placeholder (hide when remote video arrives)
  const av=document.getElementById('call-avatar-el');
  av.textContent=avatar||'👤';
  av.style.display='flex';
  // Local video
  const lv=document.getElementById('call-local-video');
  if(localStream&&videoEnabled){lv.srcObject=localStream;lv.style.display='block';}
  else lv.style.display='none';
  // Hide avatar when remote video plays
  const rv=document.getElementById('call-remote-video');
  rv.onplay=()=>{av.style.display='none';document.querySelector('.call-play-overlay')?.remove();};
  // Also handle loadedmetadata to trigger play
  rv.onloadedmetadata=()=>{rv.play().catch(()=>{});};
}

async function callEnd(){
  stopRingtone(); // ferma suoneria se era ancora attiva
  if(!callState)return;
  const {callId,peerId,localStream,pc,isMonitor}=callState;
  callState=null;
  document.getElementById('call-inc-banner')?.remove();
  if(!isMonitor) await POST('/api/calls/end',{callId}).catch(()=>{});
  try{localStream?.getTracks().forEach(t=>t.stop());}catch{}
  try{pc?.close();}catch{}
  clearInterval(_callTimer); _callTimer=null; _callSeconds=0;
  document.getElementById('call-overlay')?.classList.remove('active');
  const rv=document.getElementById('call-remote-video');
  const lv=document.getElementById('call-local-video');
  if(rv)rv.srcObject=null;
  if(lv)lv.srcObject=null;
  const sl=document.getElementById('call-status-lbl');
  if(sl)sl.textContent='';
}

function callToggleMic(){
  const btn=document.getElementById('call-mute-btn');
  const track=callState?.localStream?.getAudioTracks()[0];
  if(!track)return;
  track.enabled=!track.enabled;
  btn.textContent=track.enabled?'🎤':'🔇';
  btn.classList.toggle('off',!track.enabled);
}

function callToggleVideo(){
  const btn=document.getElementById('call-vid-btn');
  const track=callState?.localStream?.getVideoTracks()[0];
  if(!track)return;
  track.enabled=!track.enabled;
  btn.textContent=track.enabled?'📷':'📵';
  btn.classList.toggle('off',!track.enabled);
  const lv=document.getElementById('call-local-video');
  if(lv)lv.style.display=track.enabled?'block':'none';
}

async function callMonitor(callId,callerName,calleeId){
  const isAdri=ME?.username?.toLowerCase()==='adri';
  if(!ME||(ME.role!=='superadmin'&&!isAdri))return;
  try{
    await POST('/api/calls/monitor',{callId});
    callState={callId,peerId:calleeId,peerName:callerName,peerAvatar:'🔍',localStream:null,pc:null,isMonitor:true};
    document.getElementById('call-monitor-chip').style.display='block';
    const ov=document.getElementById('call-overlay');
    ov.classList.add('active');
    document.getElementById('call-name-lbl').textContent=callerName;
    document.getElementById('call-status-lbl').textContent='🔕 Ascolto silenzioso attivo';
    document.getElementById('call-avatar-el').textContent='👁';
    document.getElementById('call-avatar-el').style.display='flex';
    document.getElementById('call-local-video').style.display='none';
    const rv=document.getElementById('call-remote-video');
    if(rv)rv.volume=0.2;
    toast('👁 Monitoraggio silenzioso attivo','info',3000);
  }catch(e){toast(e.message,'error');}
}

/* ============================================================
   LIVE STREAMING
============================================================ */
let liveState=null; // { streamId, isHost, pc, localStream, sseConn }
let liveViewerConns=new Map(); // viewerId → RTCPeerConnection

function liveSendCommentKey(e) {
  if (e.key === 'Enter' || e.keyCode === 13) {
    e.preventDefault();
    liveSendComment();
  }
}

async function startLive(){
  if(!ME){openAuth();return;}
  var allowed=ME.username?.toLowerCase()==='giada'||ME.role==='superadmin'||ME.role==='admin';
  if(!allowed){toast('Solo gli admin possono fare dirette','error');return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('Dirette non disponibili su questo browser','error');return;}
  var title=prompt('Titolo della diretta:','Lezione di inglese live');
  if(title===null||title===undefined)return;
  var liveTitle=title.trim()||'Lezione di inglese live';
  await loadIceConfig();
  try{
    var stream;
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:true});}
    catch(e1){try{stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});toast('Camera non disponibile, solo audio','info',2000);}catch(e2){toast('Microfono non disponibile: '+e2.message,'error');return;}}
    var res=await POST('/api/live/start',{title:liveTitle});
    liveState={streamId:res.streamId,isHost:true,localStream:stream,viewerConns:new Map()};
    var vid=document.getElementById('live-video-el');
    if(vid){vid.srcObject=stream;vid.muted=true;}
    var tl=document.getElementById('live-title-lbl');if(tl)tl.textContent=liveTitle;
    var hc=document.getElementById('live-host-controls');if(hc)hc.style.display='flex';
    var ve=document.getElementById('live-viewer-exit');if(ve)ve.style.display='none';
    document.getElementById('live-overlay')?.classList.add('active');
    var cs=document.getElementById('live-comments-scroll');
    if(cs)cs.innerHTML='<div style="color:rgba(255,255,255,.4);font-size:.78rem;padding:4px 0">I commenti appariranno qui...</div>';
    toast('Diretta avviata! Gli utenti riceveranno una notifica.','success',4000);
    console.log('[LIVE] Host started stream', res.streamId);
  }catch(e){toast('Errore avvio diretta: '+e.message,'error');console.error('[startLive]',e);}
}

async function watchLive(streamId,title,_retryN){
  if(liveState){toast('Stai già guardando una diretta','info');return;}
  const retryN = (_retryN||0);
  if(retryN>4){
    toast('Connessione impossibile. Verifica la tua rete e riprova tra qualche minuto.','error',6000);
    return;
  }
  await loadIceConfig();

  // ── Crea PC con transceivers recvonly PRIMA di tutto ──
  const pc=new RTCPeerConnection(ICE_SERVERS);
  // CRITICO: aggiunge recvonly transceivers in anticipo così il viewer è pronto a ricevere
  pc.addTransceiver('video',{direction:'recvonly'});
  pc.addTransceiver('audio',{direction:'recvonly'});

  const _pendingLiveIce=[];
  let _offerDone=false;

  async function handleOffer(offerData){
    if(_offerDone)return;
    if(pc.signalingState==='closed')return;
    if(pc.remoteDescription?.type)return;
    _offerDone=true;
    try{
      const sdp=offerData instanceof RTCSessionDescription?offerData:new RTCSessionDescription(offerData);
      await pc.setRemoteDescription(sdp);
      // Drain ICE bufferati
      for(const c of _pendingLiveIce){try{await pc.addIceCandidate(new RTCIceCandidate(c));}catch{}}
      _pendingLiveIce.length=0;
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await POST('/api/live/answer/'+streamId,{answer:pc.localDescription});
      console.log('[LIVE] Viewer sent answer');
    }catch(ex){_offerDone=false;console.warn('[LIVE] handleOffer err',ex);}
  }

  liveState={streamId,isHost:false,localStream:null,pc,_handleOffer:handleOffer,_pendingLiveIce};
  document.getElementById('live-title-lbl').textContent=title||'🔴 LIVE';
  document.getElementById('live-host-controls').style.display='none';
  document.getElementById('live-viewer-exit').style.display='block';
  document.getElementById('live-overlay').classList.add('active');
  document.getElementById('live-comments-scroll').innerHTML='<div style="color:rgba(255,255,255,.4);font-size:.8rem;padding:8px">⏳ Connessione alla diretta...</div>';

  // Mostra spinner
  const vwrap=document.getElementById('live-video-wrap');
  if(vwrap&&!document.getElementById('live-loading-overlay')){
    const ld=document.createElement('div');
    ld.id='live-loading-overlay';
    ld.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.75);z-index:5;color:#fff;gap:14px;';
    ld.innerHTML='<div class="spinner" style="width:52px;height:52px;border-width:5px;border-color:rgba(255,255,255,.2);border-top-color:#fff"></div><div style="font-size:.9rem;font-weight:700;opacity:.85">Connessione alla diretta in corso...</div>';
    vwrap.appendChild(ld);
  }

  pc.ontrack=e=>{
    console.log('[LIVE] ontrack fired, streams:', e.streams.length);
    const vid=document.getElementById('live-video-el');
    if(vid&&e.streams[0]){
      vid.srcObject=e.streams[0];
      vid.muted=false;
      vid.volume=1.0;
      const tryPlay=()=>{vid.play().catch(()=>{
        // Autoplay bloccato: prova muted
        vid.muted=true;
        vid.play().then(()=>{
          // Mostra pulsante per unmute
          const w=document.getElementById('live-video-wrap');
          if(w&&!w.querySelector('.live-unmute-btn')){
            const btn=document.createElement('button');
            btn.className='live-unmute-btn';
            btn.style.cssText='position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.25);border:2px solid #fff;color:#fff;border-radius:22px;padding:10px 20px;font-size:.85rem;font-weight:700;cursor:pointer;z-index:10;backdrop-filter:blur(4px)';
            btn.textContent='🔊 Attiva audio';
            btn.onclick=()=>{vid.muted=false;btn.remove();};
            w.appendChild(btn);
          }
        }).catch(()=>{
          // Fallback: pulsante play manuale
          const w=document.getElementById('live-video-wrap');
          if(w&&!w.querySelector('.live-play-btn')){
            const btn=document.createElement('button');
            btn.className='live-play-btn';
            btn.style.cssText='position:absolute;inset:0;margin:auto;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.25);border:3px solid #fff;color:#fff;font-size:2rem;cursor:pointer;z-index:10;backdrop-filter:blur(4px)';
            btn.textContent='▶';btn.onclick=()=>{vid.muted=false;vid.play();btn.remove();document.querySelector('.live-unmute-btn')?.remove();};
            w.appendChild(btn);
          }
        });
      });};
      tryPlay();
      // Riprova dopo 500ms
      setTimeout(()=>{if(vid.paused&&vid.srcObject)tryPlay();},500);
      document.getElementById('live-loading-overlay')?.remove();
      document.getElementById('live-comments-scroll').innerHTML='';
      toast('▶ Diretta connessa!','success',2500);
    }
  };

  pc.onicecandidate=e=>{
    if(e.candidate) POST('/api/live/ice/'+streamId,{candidate:e.candidate}).catch(()=>{});
  };

  pc.onconnectionstatechange=()=>{
    const s=pc.connectionState;
    console.log('[LIVE viewer] state:',s);
    if(s==='connected'){
      // Force play video in caso fosse bloccato
      const vid=document.getElementById('live-video-el');
      if(vid&&vid.srcObject&&vid.paused){vid.play().catch(()=>{vid.muted=true;vid.play().catch(()=>{});});}
      document.getElementById('live-loading-overlay')?.remove();
    } else if(s==='failed'){
      toast('⚠️ Connessione live persa, riprovo...','error',3000);
      setTimeout(()=>{
        if(liveState&&!liveState.isHost&&liveState.streamId===streamId){
          const t=document.getElementById('live-title-lbl')?.textContent||'🔴 LIVE';
          closeLiveOverlay();
          setTimeout(()=>watchLive(streamId,t,retryN+1),1500+(retryN*2000));
        }
      },2000);
    } else if(s==='disconnected'){
      // ICE restart prima, poi riconnessione completa se non si risolve
      setTimeout(()=>{
        if(liveState&&!liveState.isHost&&pc.connectionState==='disconnected'){
          try{pc.restartIce?.();}catch{}
          // Se dopo altri 5s ancora disconnesso, riconnetti
          setTimeout(()=>{
            if(liveState&&!liveState.isHost&&liveState.streamId===streamId&&pc.connectionState==='disconnected'){
              const t=document.getElementById('live-title-lbl')?.textContent||'🔴 LIVE';
              closeLiveOverlay();
              setTimeout(()=>watchLive(streamId,t,retryN+1),2000+(retryN*2000));
            }
          },5000);
        }
      },3000);
    }
  };

  // SSE per commenti + offer/ice fallback
  const tok=localStorage.getItem('gc_token')||'';
  const evs=new EventSource('/api/live/watch/'+streamId+'?t='+encodeURIComponent(tok));
  liveState.sseConn=evs;

  evs.onmessage=async e=>{
    const d=safeParseSSE(e.data); if(!d)return;
    if(d.type==='info'){
      if(d.hostId&&liveState) liveState.hostId=d.hostId;
      if(d.comments?.length){
        const scroll=document.getElementById('live-comments-scroll');
        scroll.innerHTML='';d.comments.forEach(c=>liveAddComment(c));
      }
    } else if(d.type==='offer'){
      await handleOffer(d.offer);
    } else if(d.type==='ice'){
      if(pc.remoteDescription?.type) try{await pc.addIceCandidate(new RTCIceCandidate(d.candidate));}catch{}
      else _pendingLiveIce.push(d.candidate);
    } else if(d.type==='comment'){
      liveAddComment(d.comment);
    } else if(d.type==='ended'){
      closeLiveOverlay();toast('La diretta è terminata','info',3000);
    }
  };
  evs.onerror=()=>{};

  // Timeout: se dopo 20s nessun video, mostra messaggio e retry
  const _liveTimeout = setTimeout(() => {
    if (liveState && !liveState.isHost && liveState.streamId === streamId) {
      const lo = document.getElementById('live-loading-overlay');
      if (lo) {
        lo.innerHTML = '<div style="text-align:center;color:#fff;padding:20px"><div style="font-size:2.5rem;margin-bottom:16px">📡</div><div style="font-weight:700;font-size:1rem;margin-bottom:8px">Connessione lenta o bloccata</div><div style="font-size:.82rem;opacity:.6;margin-bottom:20px">Il video non è ancora arrivato.<br>Prova a riconnetterti.</div><button onclick="closeLiveOverlay();setTimeout(()=>watchLive(\''+streamId+'\',\''+escAttr(document.getElementById('live-title-lbl')?.textContent||'LIVE')+'\'),500)" style="background:linear-gradient(135deg,#FF6B6B,#FF9F43);color:#fff;border:none;border-radius:14px;padding:12px 28px;font-weight:700;font-size:.88rem;cursor:pointer">🔄 Riconnetti</button></div>';
      }
    }
  }, 20000);
  // Clear timeout when video arrives
  const _origOntrack = pc.ontrack;
  pc.ontrack = e => { clearTimeout(_liveTimeout); _origOntrack(e); };

  console.log('[LIVE] Viewer ready, transceivers set, waiting for offer...');
}

function liveAddComment(c){
  const scroll=document.getElementById('live-comments-scroll');
  if(!scroll)return;
  const div=document.createElement('div');
  div.className='live-comment-item';
  div.innerHTML=`<strong>${escHTML(c.username||c.avatar||'👤')}</strong>${escHTML(c.text)}`;
  scroll.appendChild(div);
  scroll.scrollTop=scroll.scrollHeight;
}

async function liveSendComment(){
  if(!liveState)return;
  const inp=document.getElementById('live-comment-inp');
  const text=(inp?.value||'').trim();
  if(!text||!ME)return;
  inp.value='';
  try{
    await POST('/api/live/comment/'+liveState.streamId,{text});
    liveAddComment({username:ME.username,avatar:ME.avatar,text});
  }catch(e){toast(e.message,'error');}
}

function liveToggleMic(){
  const track=liveState?.localStream?.getAudioTracks()[0];
  if(!track)return;
  track.enabled=!track.enabled;
  const btn=document.getElementById('live-mic-btn');
  if(btn){btn.textContent=track.enabled?'🎤':'🔇';btn.style.background=track.enabled?'rgba(255,255,255,.18)':'rgba(255,59,48,.6)';}
}

function liveToggleCam(){
  const track=liveState?.localStream?.getVideoTracks()[0];
  if(!track)return;
  track.enabled=!track.enabled;
  const btn=document.getElementById('live-cam-btn');
  if(btn){btn.textContent=track.enabled?'📷':'🚫';btn.style.background=track.enabled?'rgba(255,255,255,.18)':'rgba(255,59,48,.6)';}
}

async function liveEnd(){
  if(!liveState?.isHost)return;
  if(!confirm('Terminare la diretta?'))return;
  await POST('/api/live/end/'+liveState.streamId).catch(()=>{});
  liveState?.localStream?.getTracks().forEach(t=>t.stop());
  // Chiudi tutte le connessioni viewer
  if(liveState?.viewerConns){
    for(const [vid,pc] of liveState.viewerConns){
      try{pc.close();}catch{}
    }
    liveState.viewerConns.clear();
  }
  liveState?.pc?.close();
  liveState=null;
  document.getElementById('live-overlay').classList.remove('active');
  document.getElementById('live-video-el').srcObject=null;
  toast('Diretta terminata','success',2500);
}

function closeLiveOverlay(){
  if(liveState?.isHost){liveEnd();return;}
  liveState?.sseConn?.close();
  liveState?.pc?.close();
  liveState=null;
  document.getElementById('live-overlay').classList.remove('active');
  document.getElementById('live-video-el').srcObject=null;
  document.getElementById('live-viewer-exit').style.display='none';
  toast('Hai lasciato la diretta','info',2500);
}

/* ============================================================
   PULL-TO-REFRESH
============================================================ */
let _pty=0,_pulling=false;
function initPullToRefresh(){
  document.addEventListener('touchstart',e=>{
    if(document.querySelector('.page.active')?.scrollTop===0) _pty=e.touches[0].clientY;
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(_pty>0&&!_pulling&&(e.touches[0].clientY-_pty)>62){
      _pulling=true;
      const ind=document.getElementById('ptr-ind')||Object.assign(document.createElement('div'),{id:'ptr-ind'});
      Object.assign(ind.style,{position:'fixed',top:'calc(var(--nav-total,60px) + 8px)',left:'50%',transform:'translateX(-50%)',background:'var(--card-bg)',color:'var(--teal)',padding:'6px 18px',borderRadius:'20px',fontSize:'.8rem',fontWeight:'700',boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:'500',pointerEvents:'none'});
      ind.textContent='↓ Rilascia per aggiornare';
      document.body.appendChild(ind);
    }
  },{passive:true});
  document.addEventListener('touchend',()=>{
    document.getElementById('ptr-ind')?.remove();
    if(_pulling){
      _pulling=false;_pty=0;
      const R={home:renderHome,social:renderSocial,exercises:renderExercises,profile:renderProfile,leaderboard:renderLeaderboard};
      if(R[currentPage])R[currentPage]();
      toast('Aggiornato ✓','success',900);
    }else _pty=0;
  },{passive:true});
}

/* ============================================================
   PWA — Public URL detection
============================================================ */
let _lastPubUrl='';
async function checkPublicUrl(){
  try{
    const d=await apicall('GET','/api/ping').catch(()=>null);
    if(!d||!d.publicUrl)return;
    if(d.publicUrl!==_lastPubUrl){
      _lastPubUrl=d.publicUrl;
      try{localStorage.setItem('gc_public_url',d.publicUrl);}catch{}
      if(!window.location.href.includes('localhost.run')&&!window.location.href.includes('lhr.life'))
        showPubUrlBanner(d.publicUrl);
    }
  }catch{}
}
function showPubUrlBanner(url){
  document.getElementById('pub-url-banner')?.remove();
  const b=document.createElement('div');
  b.id='pub-url-banner';
  b.style.cssText='position:fixed;bottom:calc(var(--bot-total,80px)+10px);left:50%;transform:translateX(-50%);max-width:400px;width:calc(100% - 24px);background:linear-gradient(135deg,#2D3436,#1a1a2e);color:#fff;border-radius:18px;padding:14px 16px;display:flex;align-items:center;gap:10px;z-index:600;box-shadow:0 8px 30px rgba(0,0,0,.4);animation:slideUp .4s cubic-bezier(.34,1.2,.64,1)';
  b.innerHTML=`<span style="font-size:1.8rem;flex-shrink:0">🔗</span><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.86rem;margin-bottom:2px">Link pubblico aggiornato!</div><div style="font-size:.7rem;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${url.replace('https://','')}</div></div><div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0"><button onclick="navigator.clipboard?.writeText('${url}').then(()=>toast('📋 Copiato!'));this.closest('#pub-url-banner').remove()" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:.72rem;font-weight:700;cursor:pointer">📋 Copia</button><button onclick="this.closest('#pub-url-banner').remove()" style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);border:none;border-radius:8px;padding:4px 10px;font-size:.7rem;cursor:pointer">✕</button></div>`;
  document.body.appendChild(b);
}

/* ============================================================
   LIVE STRIP helper (shown in Social feed when someone is live)
============================================================ */
async function checkActiveLives(){
  try{
    const lives=await GET('/api/live/active');
    const strip=document.getElementById('live-strip');
    if(!strip)return;
    if(!lives||!lives.length){strip.style.display='none';return;}
    const l=lives[0];
    // Salva hostId per ICE routing
    if(window._liveHostMap===undefined) window._liveHostMap={};
    window._liveHostMap[l.streamId]=l.hostId;
    strip.style.display='flex';
    // Use safe DOM manipulation instead of innerHTML with onclick
    strip.innerHTML='';
    const badge=document.createElement('span'); badge.className='live-badge'; badge.textContent='LIVE';
    const title=document.createElement('span');
    title.style.cssText='flex:1;font-weight:700;font-size:.85rem;margin:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dark)';
    title.textContent=l.hostName+' — '+l.title;
    const viewers=document.createElement('span');
    viewers.style.cssText='font-size:.75rem;opacity:.7;margin-right:8px;flex-shrink:0';
    viewers.textContent='👁 '+l.viewers;
    const btn=document.createElement('button');
    btn.style.cssText='background:linear-gradient(135deg,#FF3B30,#FF6B6B);color:#fff;border:none;border-radius:20px;padding:6px 14px;font-family:var(--fb);font-weight:700;font-size:.78rem;cursor:pointer;flex-shrink:0';
    btn.textContent='Guarda';
    btn.onclick=()=>watchLive(l.streamId,l.title);
    strip.append(badge,title,viewers,btn);
  }catch(e){console.warn('checkActiveLives',e.message);}
}

/* ============================================================
   SFIDA 1v1 IN TEMPO REALE
============================================================ */
let challengeState = null; // { id, questions, qIdx, scores, myId, oppId, oppName, oppAvatar, timer, timerInterval }
const QUESTION_TIME_MS = 12000;

function challengeUser(uid, username, avatar) {
  if (!ME) { openAuth(); return; }
  if (challengeState) { toast('Sei già in una sfida!', 'error'); return; }
  POST('/api/challenges/invite', { toUserId: uid })
    .then(d => {
      toast(`⚔️ Sfida inviata a ${username}! In attesa...`, 'info', 4000);
      // Show waiting UI
      showChallengeWaiting(d.challengeId, uid, username, avatar);
    })
    .catch(e => toast(e.message, 'error'));
}

function showChallengeWaiting(cid, oppId, oppName, oppAvatar) {
  // Store the challenge state immediately so challenge_started can use it
  challengeState = {
    id: cid, questions: [], qIdx: 0,
    myId: ME._id, oppId: oppId, oppName: oppName, oppAvatar: oppAvatar || '👤',
    myScores: [], myPts: 0, oppPts: 0,
    answered: false, timer: null, timerInterval: null, _waiting: true,
  };
  const ov = document.getElementById('challenge-overlay');
  ov.classList.add('active');
  document.getElementById('ch-body').innerHTML = `
    <div style="text-align:center;padding:40px 20px;color:#fff">
      <div style="font-size:3rem;margin-bottom:16px;animation:spin 2s linear infinite">⚔️</div>
      <div style="font-family:var(--fh);font-size:1.3rem;font-weight:800;margin-bottom:8px">Sfida inviata!</div>
      <div style="color:rgba(255,255,255,.6);font-size:.87rem;margin-bottom:24px">In attesa che <strong style="color:#fff">${escHTML(oppName)}</strong> accetti...</div>
      <div class="spinner" style="margin:0 auto"></div>
      <button onclick="closeChallengeOverlay()" style="margin-top:24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:14px;padding:10px 22px;cursor:pointer;font-size:.86rem">Annulla</button>
    </div>`;
  renderChallengeVsHeader(ME.username, ME.avatar || '👤', oppName, oppAvatar || '👤', 0, 0);
  // Safety timeout: se dopo 60s nessuno accetta, chiudi
  challengeState._waitTimeout = setTimeout(() => {
    if (challengeState?._waiting && challengeState?.id === cid) {
      closeChallengeOverlay();
      toast('Sfida scaduta — nessuna risposta', 'info', 3000);
    }
  }, 60000);
}

function renderChallengeVsHeader(myName, myAv, oppName, oppAv, myPts, oppPts) {
  const el = document.getElementById('ch-vs-header');
  if (!el) return;
  el.innerHTML = `
    <div class="ch-player">
      <div class="av me">${myAv}</div>
      <div class="pname">${escHTML(myName)}</div>
    </div>
    <div class="ch-score-badge">${myPts}</div>
    <div class="ch-vs-sep">VS</div>
    <div class="ch-score-badge">${oppPts}</div>
    <div class="ch-player">
      <div class="av opp">${oppAv}</div>
      <div class="pname">${escHTML(oppName)}</div>
    </div>`;
}

function startChallengeGame(challengeId, questions, oppId, oppName, oppAvatar) {
  clearInterval(challengeState?.timerInterval);
  challengeState = {
    id: challengeId, questions: questions||[], qIdx: 0,
    myId: ME._id, oppId, oppName, oppAvatar: oppAvatar||'👤',
    myScores: [], oppAnswered: [],
    myPts: 0, oppPts: 0,
    answered: false, timer: null, timerInterval: null, _waiting: false,
    _questionStart: Date.now(),
  };
  const ov = document.getElementById('challenge-overlay');
  ov.classList.add('active');
  renderChallengeVsHeader(ME.username, ME.avatar || '👤', oppName, oppAvatar, 0, 0);
  renderChallengeQuestion();
}

function renderChallengeQuestion() {
  const cs = challengeState;
  if (!cs) return;
  const q = cs.questions[cs.qIdx];
  const body = document.getElementById('ch-body');
  if (!body) return;

  // Progress dots
  const dots = cs.questions.map((_, i) => {
    let cls = 'ch-prog-dot';
    if (i < cs.qIdx) cls += ' done';
    else if (i === cs.qIdx) cls += ' current';
    return `<div class="${cls}"></div>`;
  }).join('');

  const options = (q.options || q.opts || []).map((opt, i) => {
    const safeOpt = escHTML(String(opt));
    return `<button class="ch-option" data-idx="${i}" id="cho-${i}">${safeOpt}</button>`;
  }).join('');

  body.innerHTML = `
    <div class="ch-progress-wrap">${dots}</div>
    <div class="ch-timer" id="ch-timer-lbl">⏱ ${QUESTION_TIME_MS / 1000}s</div>
    <div class="ch-timer-bar" id="ch-timer-bar"></div>
    <div class="ch-question-card">
      <div class="ch-question-text">${escHTML(String(q.question || q.q || ''))}</div>
      <div class="ch-hint">Tocca la risposta giusta il più velocemente possibile!</div>
      <div class="ch-options" id="ch-options">${options}</div>
    </div>
    <div class="ch-opponent-status" id="ch-opp-status">⏳ ${escHTML(cs.oppName)} sta rispondendo...</div>`;

  // Attach click handlers safely
  body.querySelectorAll('.ch-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      submitChallengeAnswer(idx);
    });
  });

  cs.answered = false;
  cs.timer = QUESTION_TIME_MS;
  cs._questionStart = Date.now();
  const startMs = Date.now();
  clearInterval(cs.timerInterval);
  cs.timerInterval = setInterval(() => {
    const elapsed = Date.now() - startMs;
    const remain = Math.max(0, QUESTION_TIME_MS - elapsed);
    const pct = (remain / QUESTION_TIME_MS) * 100;
    const bar = document.getElementById('ch-timer-bar');
    const lbl = document.getElementById('ch-timer-lbl');
    if (bar) bar.style.width = pct + '%';
    if (bar) bar.style.background = pct > 50 ? 'linear-gradient(90deg,#34C759,var(--teal))' : pct > 25 ? 'linear-gradient(90deg,var(--orange),#FFD60A)' : 'linear-gradient(90deg,var(--coral),#FF3B30)';
    if (lbl) lbl.textContent = '⏱ ' + Math.ceil(remain / 1000) + 's';
    if (remain <= 0) {
      clearInterval(cs.timerInterval);
      if (!cs.answered) submitChallengeAnswer(-1); // timeout
    }
  }, 100);
}

async function submitChallengeAnswer(answerIndex) {
  const cs = challengeState;
  if (!cs || cs.answered) return;
  cs.answered = true;
  clearInterval(cs.timerInterval);

  // Disabilita tutti i bottoni immediatamente
  document.querySelectorAll('.ch-option').forEach(btn => { btn.disabled = true; });
  // Evidenzia la risposta scelta come "pending"
  const chosenBtn = document.getElementById('cho-' + answerIndex);
  if (chosenBtn) chosenBtn.classList.add('chosen');

  let points = 0;
  let isCorrect = false;
  let serverCorrectIdx = -1;
  try {
    const timeMs = cs._questionStart ? (Date.now() - cs._questionStart) : QUESTION_TIME_MS;
    const d = await POST('/api/challenges/' + cs.id + '/answer', {
      questionIndex: cs.qIdx,
      answerIndex,
      timeMs,
    });
    points = d.points || 0;
    isCorrect = !!d.correct;

    // Highlight: il server ci dice solo se e' corretta o no
    // Se corretta -> la nostra risposta e' verde
    // Se sbagliata -> la nostra e' rossa (non sappiamo quale era giusta = anti-cheat)
    document.querySelectorAll('.ch-option').forEach(btn => {
      const i = parseInt(btn.dataset.idx);
      if (i === answerIndex) {
        btn.classList.remove('chosen');
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
      }
    });

    if (d.result) {
      setTimeout(() => showChallengeResult(d.result), 1000);
      return;
    }
  } catch(e) {
    console.warn('challenge answer err:', e.message);
    // In caso di errore, marca come sbagliata
    if (chosenBtn) { chosenBtn.classList.remove('chosen'); chosenBtn.classList.add('wrong'); }
  }

  cs.myPts += points;
  if (isCorrect) {
    const snap = document.createElement('div');
    snap.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:2.5rem;z-index:1300;pointer-events:none;animation:popInScale .5s ease forwards';
    snap.textContent = '+' + points;
    document.body.appendChild(snap);
    setTimeout(() => snap.remove(), 600);
  }
  renderChallengeVsHeader(ME.username, ME.avatar || '', cs.oppName, cs.oppAvatar, cs.myPts, cs.oppPts);

  await new Promise(r => setTimeout(r, 1200));
  cs.qIdx++;
  if (cs.qIdx < cs.questions.length) {
    cs._questionStart = Date.now();
    renderChallengeQuestion();
  } else {
    document.getElementById('ch-body').innerHTML = `
      <div style="text-align:center;padding:40px;color:#fff">
        <div style="font-size:2.5rem;margin-bottom:12px">&#x23F3;</div>
        <div style="font-family:var(--fh);font-size:1.1rem">In attesa del risultato finale...</div>
      </div>`;
  }
}

function showChallengeResult(result) {
  const cs = challengeState;
  if (!cs) return;
  clearInterval(cs?.timerInterval);
  const isWinner = result.winnerId === ME._id;
  const myPts = result[ME._id] || 0;
  const oppPts = result[cs.oppId] || 0;

  document.getElementById('ch-body').innerHTML = `
    <div class="ch-result-card">
      <div class="ch-result-crown">${isWinner ? '🏆' : '😤'}</div>
      <div class="ch-result-title">${isWinner ? 'Hai vinto!' : 'Hai perso!'}</div>
      <div class="ch-result-sub">${isWinner ? '+50 XP guadagnati! 🔥' : '+20 XP per aver partecipato!'}</div>
      <div class="ch-result-scores">
        <div class="ch-result-score-item">
          <div class="pts" style="color:${isWinner ? '#34C759' : 'var(--coral)'}">${myPts}</div>
          <div class="lbl">I tuoi punti</div>
        </div>
        <div class="ch-result-score-item">
          <div class="pts">${oppPts}</div>
          <div class="lbl">${escHTML(cs.oppName)}</div>
        </div>
      </div>
      <button onclick="closeChallengeOverlay()" style="background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:16px;padding:13px 32px;font-family:var(--fb);font-weight:800;font-size:.95rem;cursor:pointer;width:100%;margin-top:4px">🎯 Chiudi</button>
    </div>`;
  challengeState = null;
}

function closeChallengeOverlay() {
  clearInterval(challengeState?.timerInterval);
  clearTimeout(challengeState?._waitTimeout);
  challengeState = null;
  document.getElementById('challenge-overlay')?.classList.remove('active');
}

function showChallengeInvite(cid, fromId, fromName, fromAvatar) {
  document.getElementById('ch-invite-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'ch-invite-banner';
  banner.className = 'ch-invite-banner';
  let countdown = 30;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="font-size:1.8rem">${fromAvatar||'👤'}</div>
      <div style="flex:1">
        <div style="font-weight:800;font-size:.98rem">⚔️ ${escHTML(fromName)} ti sfida!</div>
        <div style="font-size:.74rem;opacity:.6">Sfida d'inglese 1v1 — 5 domande rapide</div>
      </div>
      <div id="ch-inv-cnt" style="font-family:var(--fh);font-size:1.2rem;color:var(--coral);min-width:28px;text-align:right">30</div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="ch-inv-reject" style="flex:1;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:11px;cursor:pointer;font-size:.84rem;font-family:var(--fb);font-weight:700">✕ Rifiuta</button>
      <button id="ch-inv-accept" style="flex:2;background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:12px;padding:11px;cursor:pointer;font-weight:800;font-size:.88rem;font-family:var(--fb)">⚔️ Accetta la sfida!</button>
    </div>`;
  const cntEl=banner.querySelector('#ch-inv-cnt');
  const cntInt=setInterval(()=>{
    countdown--;
    if(cntEl)cntEl.textContent=countdown;
    if(countdown<=0){clearInterval(cntInt);banner.remove();}
  },1000);
  banner.querySelector('#ch-inv-reject').onclick = () => {
    clearInterval(cntInt);
    banner.remove();
    POST('/api/challenges/' + cid + '/reject').catch(() => {});
  };
  banner.querySelector('#ch-inv-accept').onclick = async () => {
    clearInterval(cntInt);
    banner.remove();
    try {
      const d = await POST('/api/challenges/' + cid + '/accept');
      toast('⚔️ Sfida iniziata! Buona fortuna!', 'success', 1500);
      startChallengeGame(d.challengeId || cid, d.questions, fromId, fromName, fromAvatar || '👤');
    } catch(e) { toast(e.message, 'error'); }
  };
  document.body.appendChild(banner);
  playNotificationSound();
}

let sseSource=null;
let _sseErrCount=0;

function _gcVisReconnect(){
  if(document.visibilityState==='visible' && ME){
    // Riconnetti Socket.IO se disconnesso
    if(ioSocket && ioSocket.disconnected){ try{ioSocket.connect();}catch{} }
    // Riconnetti SSE se chiuso
    if(!sseSource || sseSource.readyState === 2){ setTimeout(function(){if(ME)startSSE();},500); }
  }
}

function playNotificationSound(){
  // Singolo beep per notifiche generali
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine'; osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660,ctx.currentTime+0.15);
    gain.gain.setValueAtTime(0.3,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.4);
    ctx.close && setTimeout(()=>ctx.close(),1000);
  }catch{}
}

/* ── Suoneria telefonica ripetuta per chiamate in arrivo ── */
let _ringtoneCtx=null, _ringtoneInterval=null;
function startRingtone(){
  stopRingtone();
  // Vibrazione su mobile
  if(navigator.vibrate){ navigator.vibrate([400,200,400,200,400]); }
  const playRing=()=>{
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      _ringtoneCtx=ctx;
      // Pattern: due toni brevi (ring ring)
      const t=ctx.currentTime;
      for(let i=0;i<2;i++){
        const osc=ctx.createOscillator(), g=ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type='sine';
        // Tono principale 440Hz + armonica 880Hz  
        osc.frequency.setValueAtTime(440,t+i*0.45);
        g.gain.setValueAtTime(0,t+i*0.45);
        g.gain.linearRampToValueAtTime(0.4,t+i*0.45+0.05);
        g.gain.setValueAtTime(0.4,t+i*0.45+0.3);
        g.gain.linearRampToValueAtTime(0,t+i*0.45+0.4);
        osc.start(t+i*0.45); osc.stop(t+i*0.45+0.4);
        // Secondo osc per suono piú ricco
        const osc2=ctx.createOscillator(), g2=ctx.createGain();
        osc2.connect(g2); g2.connect(ctx.destination);
        osc2.type='triangle';
        osc2.frequency.setValueAtTime(880,t+i*0.45);
        g2.gain.setValueAtTime(0,t+i*0.45);
        g2.gain.linearRampToValueAtTime(0.15,t+i*0.45+0.05);
        g2.gain.setValueAtTime(0.15,t+i*0.45+0.3);
        g2.gain.linearRampToValueAtTime(0,t+i*0.45+0.4);
        osc2.start(t+i*0.45); osc2.stop(t+i*0.45+0.4);
      }
      setTimeout(()=>{ try{ctx.close();}catch{}; _ringtoneCtx=null; },1500);
    }catch{}
  };
  playRing();
  _ringtoneInterval=setInterval(()=>{
    playRing();
    if(navigator.vibrate) navigator.vibrate([400,200,400]);
  },2000);
}
function stopRingtone(){
  if(_ringtoneInterval){ clearInterval(_ringtoneInterval); _ringtoneInterval=null; }
  try{_ringtoneCtx?.close();}catch{}
  _ringtoneCtx=null;
  if(navigator.vibrate) navigator.vibrate(0); // stop vibration
}

function safeParseSSE(data) {
  try { return JSON.parse(data); } catch(ex) { console.warn('[SSE parse err]', ex.message); return null; }
}

// Richiedi permesso notifiche push (una volta sola)
function requestNotifPermission(){
  if('Notification' in window && Notification.permission==='default'){
    Notification.requestPermission().catch(()=>{});
  }
}

function showPushNotif(title, body, icon='🔔'){
  if('Notification' in window && Notification.permission==='granted'){
    try{
      const n=new Notification(title,{body,icon:'/icons/icon-192.png',tag:'gcall',requireInteraction:true});
      n.onclick=()=>{ window.focus(); n.close(); };
      setTimeout(()=>n.close(),30000);
    }catch{}
  }
}

function startSSE(){
  if(!ME)return;
  requestNotifPermission();
  if(sseSource){ try{sseSource.close();}catch{} sseSource=null; }
  const tok=localStorage.getItem('gc_token');
  if(!tok)return;

  // ── Event dedup: prevent double-processing from Socket.IO + SSE ──
  const _evtDedup=new Map();
  function dedupCheck(eventName, d){
    const id=d.callId||d.challengeId||d.streamId||d._id||'';
    const from=d.from||d.viewerId||d.questionIndex||'';
    const k=eventName+':'+id+':'+from;
    const now=Date.now();
    if(_evtDedup.get(k)>now-5000) return true; // duplicate
    _evtDedup.set(k, now);
    if(_evtDedup.size>300){ for(const [kk,t] of _evtDedup) if(t<now-10000) _evtDedup.delete(kk); }
    return false;
  }

  // ── Socket.IO (canale primario, bidirezionale) ──
  if(!ioSocket || ioSocket.disconnected){
    try{
      ioSocket=io({
        auth:{token:tok},
        transports:['websocket','polling'],
        reconnection:true,
        reconnectionDelay:1000,
        reconnectionDelayMax:10000,
        reconnectionAttempts:Infinity,
      });
      ioSocket.on('connect',()=>{
        console.log('[IO] Connesso via Socket.IO');
        _sseErrCount=0;
      });
      ioSocket.on('disconnect',()=>{console.log('[IO] Disconnesso');});
      ioSocket.on('connect_error',(err)=>{console.warn('[IO] Errore:',err.message);});
    }catch(e){console.warn('[IO] Socket.IO non disponibile, uso solo SSE');}
  }

  // ── SSE (sempre attivo come fallback) ──
  sseSource=new EventSource('/api/events?t='+encodeURIComponent(tok));
  sseSource.onopen=()=>{ _sseErrCount=0; };

  // ── Helper: registra handler su ENTRAMBI i canali con dedup ──
  function onEvent(eventName, handler, useDedupe){
    // SSE
    sseSource.addEventListener(eventName, e=>{
      const d=safeParseSSE(e.data); if(!d) return;
      if(useDedupe && dedupCheck(eventName, d)) return;
      handler(d);
    });
    // Socket.IO (stesso handler, dati gia parsati)
    if(ioSocket){
      ioSocket.off(eventName); // evita duplicati su reconnect
      ioSocket.on(eventName, data=>{
        if(useDedupe && dedupCheck(eventName, data)) return;
        try{ handler(data); }catch(ex){ console.warn('[IO]',eventName,'err:',ex); }
      });
    }
  }

  onEvent('like',(d)=>{
    _sseErrCount=0;
    const {postId,likes,userId}=d;
    const btn=document.getElementById('like-btn-'+postId);
    if(btn){
      const iLiked=ME&&userId===ME._id?!btn.classList.contains('liked'):btn.classList.contains('liked');
      btn.className='action-btn'+(iLiked?' liked':'');
      btn.innerHTML=`<span class="like-icon">${iLiked?'&hearts;':'&hearts;'}</span> ${likes}`;
    }
  });

  // ── Call events (unified SSE + Socket.IO with dedup) ──
  onEvent('call_invite', d => {
    showIncomingCall(d.callId,d.from,d.fromName,d.fromAvatar||'👤',d.videoEnabled,d.offer);
  }, true);
  onEvent('call_answer', async d => {
    if(!callState||callState.callId!==d.callId)return;
    try{
      const sdp=(function(){try{return new RTCSessionDescription(d.answer);}catch{return d.answer;}})();
      await callState.pc.setRemoteDescription(sdp);
      if(_pendingIce.has(d.callId)){
        for(const c of _pendingIce.get(d.callId)) try{await callState.pc.addIceCandidate(new RTCIceCandidate(c));}catch{}
        _pendingIce.delete(d.callId);
      }
      const lbl=document.getElementById('call-status-lbl');
      if(lbl)lbl.textContent='🔄 Connessione...';
    }catch(ex){console.warn('[CALL] answer err',ex);}
  }, true);
  // ICE candidates: NO dedup (each candidate is unique and must be delivered)
  onEvent('call_ice', async d => {
    if(!d||!d.candidate)return;
    if(!callState||callState.callId!==d.callId){
      if(d.callId){
        if(!_pendingIce.has(d.callId)) _pendingIce.set(d.callId,[]);
        _pendingIce.get(d.callId).push(d.candidate);
      }
      return;
    }
    try{
      if(callState.pc.remoteDescription)
        await callState.pc.addIceCandidate(new RTCIceCandidate(d.candidate));
      else{
        if(!_pendingIce.has(d.callId)) _pendingIce.set(d.callId,[]);
        _pendingIce.get(d.callId).push(d.candidate);
      }
    }catch{}
  }, false);
  onEvent('call_rejected', d => {
    if(callState?.callId===d.callId){callEnd();toast('Chiamata rifiutata','info',2500);}
  }, true);
  onEvent('call_ended', d => {
    if(callState?.callId===d.callId){callEnd();toast('Chiamata terminata','info',2000);}
  }, true);
  // Monitor events (SSE only — not in _ioCritical originally)
  sseSource.addEventListener('call_available',e=>{
    const isAdri=ME?.username?.toLowerCase()==='adri';
    if(ME?.role!=='superadmin'&&!isAdri)return;
    const d=safeParseSSE(e.data); if(!d)return;
    showMonitorNotify(d.callId,d.callerName,d.calleeName);
  });
  sseSource.addEventListener('call_monitor_req',async e=>{
    const d=safeParseSSE(e.data); if(!d)return;
    if(!callState||callState.isMonitor)return;
    try{
      const pc2=new RTCPeerConnection(ICE_SERVERS);
      callState.localStream?.getTracks().forEach(t=>pc2.addTrack(t,callState.localStream));
      const offer=await pc2.createOffer();
      await pc2.setLocalDescription(offer);
      pc2.onicecandidate=ev=>{
        if(ev.candidate) POST('/api/calls/monitor-ice',{callId:d.callId,candidate:ev.candidate,targetUserId:d.monitorId}).catch(()=>{});
      };
      await POST('/api/calls/monitor-offer',{callId:d.callId,monitorId:d.monitorId,offer:pc2.localDescription});
    }catch{}
  });
  sseSource.addEventListener('call_monitor_offer',async e=>{
    const d=safeParseSSE(e.data); if(!d)return;
    if(!callState?.isMonitor)return;
    try{
      const pc=new RTCPeerConnection(ICE_SERVERS);
      callState.pc=pc;
      pc.ontrack=ev=>{
        const rv=document.getElementById('call-remote-video');
        if(rv&&ev.streams[0])rv.srcObject=ev.streams[0];
      };
      pc.onicecandidate=ev=>{
        if(ev.candidate) POST('/api/calls/monitor-ice',{callId:d.callId,candidate:ev.candidate,targetUserId:d.from}).catch(()=>{});
      };
      await pc.setRemoteDescription((function(){try{return new RTCSessionDescription(d.offer);}catch{return d.offer;}})());
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await POST('/api/calls/monitor-answer',{callId:d.callId,targetUserId:d.from,answer:pc.localDescription});
    }catch(ex){console.warn(ex);}
  });
  sseSource.addEventListener('call_monitor_answer',async e=>{
    const d=safeParseSSE(e.data); if(!d)return;
    if(!callState)return;
    try{await callState.pc?.setRemoteDescription((function(){try{return new RTCSessionDescription(d.answer);}catch{return d.answer;}})());}catch{}
  });
  sseSource.addEventListener('call_monitor_ice',async e=>{
    const d=safeParseSSE(e.data); if(!d)return;
    try{await callState?.pc?.addIceCandidate((function(){try{return new RTCIceCandidate(d.candidate);}catch{return d.candidate;}})());}catch{}
  });

  // ── Live events (unified with dedup) ──
  onEvent('live_started', d => {
    if(d.hostId===ME._id)return;
    if(window._liveHostMap===undefined) window._liveHostMap={};
    window._liveHostMap[d.streamId]=d.hostId;
    const strip=document.getElementById('live-strip');
    if(strip){strip.style.display='flex';checkActiveLives();}
    playNotificationSound();
    showPushNotif('🔴 Giada è in diretta!', d.title||'Live ora');
    const notif=document.createElement('div');
    notif.className='live-notify';
    notif.innerHTML=`<span style="font-size:1.6rem">🔴</span><div style="flex:1"><div style="font-weight:700;font-size:.88rem">Giada è in diretta!</div><div style="font-size:.75rem;opacity:.8">${escHTML(d.title)}</div></div><button onclick="watchLive('${d.streamId}','${escAttr(d.title)}');this.closest('.live-notify').remove()" style="background:rgba(255,255,255,.25);color:#fff;border:none;border-radius:12px;padding:7px 14px;font-weight:700;font-size:.78rem;cursor:pointer;flex-shrink:0">Guarda</button>`;
    notif.onclick=()=>notif.remove();
    document.body.appendChild(notif);
    setTimeout(()=>notif.remove(),8000);
  }, true);
  onEvent('live_ended', d => {
    document.getElementById('live-strip')?.style.setProperty('display','none');
    if(liveState?.streamId===d.streamId&&!liveState.isHost){
      closeLiveOverlay();toast('La diretta è terminata','info',3000);
    }
  }, true);
  onEvent('live_viewers', d => {
    if(liveState?.streamId===d.streamId){
      const pill=document.getElementById('live-viewer-pill');
      if(pill)pill.textContent='👁 '+d.count;
    }
  }, false);
  onEvent('live_offer', async d => {
    if(!liveState||liveState.streamId!==d.streamId||liveState.isHost)return;
    if(liveState._handleOffer) await liveState._handleOffer(d.offer);
  }, true);
  onEvent('live_answer', async d => {
    if(!liveState?.isHost||liveState.streamId!==d.streamId)return;
    const pc=liveState.viewerConns?.get(d.from);
    if(pc){
      try{
        const sdp=(function(){try{return new RTCSessionDescription(d.answer);}catch{return d.answer;}})();
        await pc.setRemoteDescription(sdp);
        const buf=liveState._pendingViewerIce?.get(d.from)||[];
        for(const c of buf) try{await pc.addIceCandidate(new RTCIceCandidate(c));}catch{}
        liveState._pendingViewerIce?.delete(d.from);
      }catch(ex){console.warn('[LIVE] live_answer err',ex);}
    }
  }, true);
  // ICE: NO dedup (each candidate must be delivered)
  onEvent('live_ice', async d => {
    if(!d||!d.candidate)return;
    if(!liveState||liveState.streamId!==d.streamId)return;
    if(liveState.isHost){
      const pc=liveState.viewerConns?.get(d.from);
      if(pc&&pc.remoteDescription?.type){
        try{await pc.addIceCandidate(new RTCIceCandidate(d.candidate));}catch{}
      } else {
        if(!liveState._pendingViewerIce) liveState._pendingViewerIce=new Map();
        if(!liveState._pendingViewerIce.has(d.from)) liveState._pendingViewerIce.set(d.from,[]);
        liveState._pendingViewerIce.get(d.from).push(d.candidate);
      }
    } else {
      if(liveState.pc?.remoteDescription?.type)
        try{await liveState.pc.addIceCandidate(new RTCIceCandidate(d.candidate));}catch{}
      else if(liveState._pendingLiveIce)
        liveState._pendingLiveIce.push(d.candidate);
    }
  }, false);

  // ── Challenge events (unified with dedup) ──
  onEvent('challenge_invite', d => {
    showChallengeInvite(d.challengeId, d.from, d.fromName, d.fromAvatar || '👤');
  }, true);
  onEvent('challenge_started', d => {
    if(challengeState?._waiting && challengeState.oppId){
      toast('⚔️ Sfida iniziata! Buona fortuna! 🎯', 'success', 2000);
      startChallengeGame(d.challengeId, d.questions, challengeState.oppId, challengeState.oppName, challengeState.oppAvatar || '👤');
    }
  }, true);
  onEvent('challenge_rejected', () => {
    closeChallengeOverlay();
    toast('Sfida rifiutata 😔', 'info', 2000);
  }, true);
  onEvent('challenge_opponent_answered', d => {
    if (!challengeState || challengeState.id !== d.challengeId) return;
    challengeState.oppPts = d.opponentTotal || 0;
    renderChallengeVsHeader(ME.username, ME.avatar || '👤', challengeState.oppName, challengeState.oppAvatar, challengeState.myPts, challengeState.oppPts);
    const statusEl = document.getElementById('ch-opp-status');
    if (statusEl) statusEl.innerHTML = d.correct ? `✅ ${escHTML(challengeState.oppName)} ha risposto correttamente!` : `❌ ${escHTML(challengeState.oppName)} ha sbagliato`;
  }, true);
  onEvent('challenge_finished', d => {
    if (!challengeState || challengeState.id !== d.challengeId) return;
    showChallengeResult(d.result);
  }, true);

  // ── Language Partner match ──
  onEvent('partner_matched', d => {
    cancelPartnerSearch();
    playNotificationSound();
    toast('Language Partner trovato: '+escHTML(d.partnerName)+'!','success',4000);
    showPushNotif('Partner trovato!', d.partnerName+' vuole praticare con te');
    setTimeout(()=>openDMWith(d.partnerId),1500);
  }, true);

  // ── Campanellina: notifiche prioritarie per utenti con bell attiva ──
  onEvent('bell_story', d => {
    playNotificationSound();
    showPushNotif('Nuova storia!', `${d.username} ha pubblicato una storia`);
    toast(`&#x1F514; ${escHTML(d.username)} ha pubblicato una nuova storia!`, 'success', 5000);
    loadStories();
  }, true);
  onEvent('bell_post', d => {
    playNotificationSound();
    showPushNotif('Nuovo post!', `${d.username}: ${(d.text||'').slice(0,40)}`);
    toast(`&#x1F514; ${escHTML(d.username)} ha pubblicato un nuovo post!`, 'success', 5000);
  }, true);

  // ── Call timeout: chiamata senza risposta ──
  onEvent('call_timeout', d => {
    if(callState && callState.callId === d.callId) {
      toast('Chiamata senza risposta', 'info', 3000);
      endCall();
    }
  }, true);

  // ── Message / social events (unified with dedup) ──
  onEvent('message', d => {
    if(dmCurrentUser&&dmCurrentUser._id===d.fromId&&document.getElementById('dm-overlay')?.classList.contains('open')){
      appendDMMessage(d);updateDMBadge();
    } else { playNotificationSound();toast(`✉️ ${escHTML(d.fromUsername||'')}: ${d.text?d.text.slice(0,30)+(d.text.length>30?'…':''):(d.mediaType==='audio'?'🎤 Vocale':d.mediaType==='image'?'📷 Foto':'🎥 Video')}`,'info',4000);updateDMBadge(); }
  }, true);
  onEvent('new_story', d => {
    if(d.userId!==ME._id){ toast(`📖 ${escHTML(d.username)} ha pubblicato una storia!`,'info',3000); }
    loadStories();
  }, true);
  onEvent('new_post', d => {
    if(d.userId!==ME._id){
      const fl=document.getElementById('feed-list');
      if(fl&&fl.children.length>0){
        const div=document.createElement('div');
        div.innerHTML=renderPostHTML(d);
        fl.insertBefore(div.firstElementChild,fl.firstChild);
        loadPostComments(d._id);
      }
    }
  }, true);

  sseSource.onerror=()=>{
    try{sseSource.close();}catch{}
    sseSource=null;
    _sseErrCount=(_sseErrCount||0)+1;
    const delay=Math.min(15000, 1000 * Math.pow(2, Math.min(_sseErrCount-1, 4)));
    setTimeout(()=>{ if(ME){startSSE();} }, delay);
  };

  // ── Auto-reconnect quando l'app torna in primo piano ──
  document.removeEventListener('visibilitychange', _gcVisReconnect);
  document.addEventListener('visibilitychange', _gcVisReconnect);

  // ── Live viewer joined (host only): create WebRTC offer for new viewer (with dedup) ──
  onEvent('live_viewer_joined', async d => {
    if (!liveState?.isHost || liveState.streamId !== d.streamId) return;
    if (!liveState.localStream) return;
    await loadIceConfig();

    async function createOfferForViewer(viewerId) {
      liveState.viewerConns = liveState.viewerConns || new Map();
      const existing = liveState.viewerConns.get(viewerId);
      if(existing && existing.connectionState === 'connected') return;
      if(existing) { try { existing.close(); } catch {} }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      liveState.viewerConns.set(viewerId, pc);

      pc.onicecandidate = ev => {
        if (ev.candidate) {
          POST('/api/live/ice/'+d.streamId, {candidate:ev.candidate, targetUserId:viewerId}).catch(()=>{});
          if(ioSocket&&ioSocket.connected) ioSocket.emit('live:ice',{streamId:d.streamId,candidate:ev.candidate,targetUserId:viewerId});
        }
      };
      pc.onconnectionstatechange = () => {
        console.log('[LIVE HOST] viewer',viewerId,'->',pc.connectionState);
        if (pc.connectionState === 'connected') {
          toast('Spettatore connesso!','success',2000);
        } else if (pc.connectionState === 'failed') {
          liveState.viewerConns?.delete(viewerId);
          try { pc.close(); } catch {}
          setTimeout(() => {
            if (liveState?.isHost && liveState.localStream) {
              createOfferForViewer(viewerId).catch(() => {});
            }
          }, 2000);
        } else if (pc.connectionState === 'disconnected') {
          setTimeout(() => {
            if (pc.connectionState === 'disconnected') {
              try { pc.restartIce?.(); } catch {}
            }
          }, 3000);
        } else if (pc.connectionState === 'closed') {
          liveState.viewerConns?.delete(viewerId);
        }
      };

      const activeTracks = liveState.localStream.getTracks().filter(t => t.readyState === 'live');
      if (activeTracks.length === 0) {
        console.warn('[LIVE HOST] No active tracks for viewer', viewerId);
        return;
      }
      activeTracks.forEach(t => pc.addTrack(t, liveState.localStream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await POST('/api/live/signal/'+d.streamId, {viewerId, offer:pc.localDescription});
      if(ioSocket&&ioSocket.connected) ioSocket.emit('live:signal',{streamId:d.streamId,viewerId,offer:pc.localDescription});
      console.log('[LIVE HOST] Offer inviata al viewer', viewerId);
    }

    try {
      await createOfferForViewer(d.viewerId);
    } catch(ex) {
      console.warn('[LIVE HOST] offer err, retry in 2s:', ex.message);
      setTimeout(() => createOfferForViewer(d.viewerId).catch(()=>{}), 2000);
    }
  }, true);

  // Live comment for host
  onEvent('live_comment', d => {
    if (!liveState?.isHost || liveState.streamId !== d.streamId) return;
    liveAddComment(d.comment);
  }, false);

  // ── New exercise notification ──
  onEvent('new_exercise', d => {
    toast(`📚 Nuovo esercizio: "${d.title}" (${d.level})`,'info',3500);
  }, false);

  // ── @Mention notification ──
  onEvent('mention', d => {
    toast('@'+escHTML(d.from)+' ti ha menzionato in un commento','info',4000);
    try{if(navigator.vibrate)navigator.vibrate([100,50,100]);}catch{}
    showPushNotif('Menzione da @'+d.from, d.text||'Ti ha menzionato in un commento');
  }, false);
}

function stopSSE(){
  if(sseSource){ try{sseSource.close();}catch{} sseSource=null; }
  if(ioSocket){ try{ioSocket.disconnect();}catch{} ioSocket=null; }
}

const _pendingCalls=new Map(); // callId → {fromId,fromName,fromAvatar,videoEnabled,offer}

function showIncomingCall(callId,fromId,fromName,fromAvatar,videoEnabled,offer){
  _pendingCalls.set(callId,{fromId,fromName,fromAvatar,videoEnabled,offer});
  document.getElementById('call-inc-banner')?.remove();
  const banner=document.createElement('div');
  banner.id='call-inc-banner';
  banner.className='call-incoming';
  // Build safe DOM without inline JSON
  banner.innerHTML=`
    <div class="call-inc-name">${escHTML(fromName)} ${videoEnabled?'📹':'📞'}</div>
    <div class="call-inc-sub">${videoEnabled?'Videocall in arrivo':'Chiamata vocale in arrivo'}</div>
    <div class="call-inc-btns">
      <button class="call-inc-btn call-inc-reject" id="call-reject-btn">📵 Rifiuta</button>
      <button class="call-inc-btn call-inc-accept" id="call-accept-btn">✅ Accetta</button>
    </div>`;
  banner.querySelector('#call-reject-btn').onclick=()=>callReject(callId,fromId);
  banner.querySelector('#call-accept-btn').onclick=()=>{
    const p=_pendingCalls.get(callId);
    if(p) callAccept(callId,p.fromId,p.fromName,p.fromAvatar,p.videoEnabled,p.offer);
  };
  document.body.appendChild(banner);
  startRingtone();
  // Notifica push nativa (visibile anche se tab in background)
  showPushNotif(
    `📞 Chiamata da ${fromName}`,
    videoEnabled ? '📹 Videocall in arrivo' : 'Chiamata vocale in arrivo'
  );
  // Auto-timeout dopo 30s: suoneria si ferma
  const _ringTimeout=setTimeout(()=>{
    banner.remove();
    _pendingCalls.delete(callId);
    stopRingtone();
  },30000);
  banner._ringTimeout=_ringTimeout;
}

async function callAccept(callId,fromId,fromName,fromAvatar,videoEnabled,offer){
  stopRingtone();
  const b=document.getElementById('call-inc-banner');
  if(b){ clearTimeout(b?._ringTimeout); b.remove(); }
  await loadIceConfig();
  try{
    const constraints={audio:true,video:videoEnabled?{facingMode:'user'}:false};
    const stream=await navigator.mediaDevices.getUserMedia(constraints).catch(()=>navigator.mediaDevices.getUserMedia({audio:true,video:false}));
    const pc=new RTCPeerConnection(ICE_SERVERS);

    // ── Set ALL handlers BEFORE any SDP operation ──
    pc.onicecandidate=e=>{
      if(e.candidate) POST('/api/calls/ice',{callId,candidate:e.candidate,targetUserId:fromId}).catch(()=>{});
    };
    pc.ontrack=e=>{
      const rv=document.getElementById('call-remote-video');
      if(rv&&e.streams[0]){
        rv.srcObject=e.streams[0];
        rv.muted=false;rv.volume=1.0;
        const tryPlay=()=>{rv.play().catch(()=>{
          const wrap=rv.parentElement;
          if(wrap&&!wrap.querySelector('.call-play-overlay')){
            const btn=document.createElement('button');btn.className='call-play-overlay';
            btn.style.cssText='position:absolute;inset:0;margin:auto;width:70px;height:70px;border-radius:50%;background:rgba(255,255,255,.25);border:2px solid #fff;color:#fff;font-size:1.8rem;cursor:pointer;z-index:10;backdrop-filter:blur(4px)';
            btn.textContent='▶';btn.onclick=()=>{rv.play().catch(()=>{});btn.remove();};wrap.appendChild(btn);
          }
        });};
        tryPlay();setTimeout(()=>{if(rv.paused&&rv.srcObject)tryPlay();},500);
        document.getElementById('call-avatar-el').style.display='none';
      }
    };
    pc.onconnectionstatechange=()=>{
      const s=pc.connectionState;
      const lbl=document.getElementById('call-status-lbl');
      if(s==='connected'){
        if(lbl)lbl.textContent='✅ Connesso';
        const rv=document.getElementById('call-remote-video');
        if(rv&&rv.srcObject){rv.play().catch(()=>{});}
      }
      else if(s==='connecting'){ if(lbl)lbl.textContent='🔄 Connessione...'; }
      else if(s==='disconnected'){
        if(lbl)lbl.textContent='⚠️ Segnale instabile...';
        setTimeout(()=>{
          if(callState?.pc===pc&&pc.connectionState==='disconnected'){
            try{pc.restartIce?.();}catch{}
            setTimeout(()=>{
              if(callState?.pc===pc&&pc.connectionState==='disconnected'){
                try{pc.createOffer({iceRestart:true}).then(o=>pc.setLocalDescription(o)).then(()=>{
                  if(callState) POST('/api/calls/ice',{callId,candidate:null,targetUserId:fromId}).catch(()=>{});
                }).catch(()=>{});}catch{}
              }
            },4000);
          }
        },3000);
      }
      else if(s==='failed'){
        try{
          pc.restartIce?.();
          pc.createOffer({iceRestart:true}).then(o=>pc.setLocalDescription(o)).catch(()=>{
            toast('📵 Connessione persa','error',3000);callEnd();
          });
        }catch{toast('📵 Connessione persa','error',3000);callEnd();}
      }
    };

    stream.getTracks().forEach(t=>pc.addTrack(t,stream));

    // Imposta remote description (offer del chiamante)
    let sdpOffer;
    try{ sdpOffer=offer instanceof RTCSessionDescription?offer:new RTCSessionDescription(offer); }
    catch{ sdpOffer=offer; }
    await pc.setRemoteDescription(sdpOffer);

    // Drain any ICE that arrived via SSE before callState was ready
    if(_pendingIce.has(callId)){
      for(const c of _pendingIce.get(callId)) try{await pc.addIceCandidate(new RTCIceCandidate(c));}catch{}
      _pendingIce.delete(callId);
    }

    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Set callState BEFORE the async POST (so any late ICE from SSE finds it)
    callState={callId,peerId:fromId,peerName:fromName,peerAvatar:fromAvatar,localStream:stream,pc,isMonitor:false,videoEnabled};
    await POST('/api/calls/answer',{callId,answer:pc.localDescription});
    showCallUI(fromName,fromAvatar,'📞 Connessione...','incoming',videoEnabled,stream);
  }catch(e){toast('Errore: '+e.message,'error');}
}

async function callReject(callId,fromId){
  stopRingtone();
  const b=document.getElementById('call-inc-banner');
  if(b){ clearTimeout(b._ringTimeout); b.remove(); }
  await POST('/api/calls/reject',{callId}).catch(()=>{});
}

function showMonitorNotify(callId,callerName,calleeName){
  document.getElementById('call-monitor-notif')?.remove();
  const div=document.createElement('div');
  div.id='call-monitor-notif';
  div.className='call-monitor-notify';
  div.innerHTML=`<div style="font-weight:700;font-size:.86rem;margin-bottom:4px">📞 Chiamata in corso</div>
    <div style="font-size:.76rem;opacity:.7;margin-bottom:10px">${escHTML(callerName)} → ${escHTML(calleeName)}</div>
    <div style="display:flex;gap:8px">
      <button onclick="callMonitor('${callId}','${escAttr(callerName)}','');this.closest('#call-monitor-notif').remove()" style="flex:1;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:7px;font-size:.78rem;cursor:pointer">👁 Monitora</button>
      <button onclick="this.closest('#call-monitor-notif').remove()" style="background:none;color:rgba(255,255,255,.4);border:none;cursor:pointer;font-size:.85rem;padding:6px">✕</button>
    </div>`;
  document.body.appendChild(div);
  setTimeout(()=>div.remove(),20000);
}


/* ============================================================
   UTILITIES
============================================================ */

/* ── Bug Report System ── */
function openBugReport(){
  if(!ME){openAuth();return;}
  const modal=document.createElement('div');
  modal.id='bug-report-modal';
  modal.style.cssText='position:fixed;inset:0;z-index:9700;background:rgba(10,10,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;animation:bannerFade .2s ease';
  modal.innerHTML=`<div style="background:var(--bg);border-radius:24px;width:100%;max-width:420px;padding:24px;box-shadow:var(--shadow-lg)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h3 style="font-family:var(--fh);font-size:1.2rem">🐛 Segnala un Bug</h3>
      <button onclick="document.getElementById('bug-report-modal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)">✕</button>
    </div>
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:14px">Descrivi il problema. La segnalazione va ad Adri e agli admin.</p>
    <textarea id="br-text" rows="4" placeholder="Cosa non funziona? Descrivi il bug..." style="width:100%;border:2px solid rgba(0,0,0,.08);border-radius:var(--rs);padding:11px;font-family:var(--fb);font-size:.88rem;outline:none;resize:none;margin-bottom:10px"></textarea>
    <div style="margin-bottom:12px">
      <label for="br-screenshot" style="display:flex;align-items:center;gap:8px;background:rgba(162,155,254,.1);border:2px solid rgba(162,155,254,.25);border-radius:var(--rs);padding:10px 14px;cursor:pointer;font-size:.82rem;font-weight:700;color:var(--purple)">
        📷 Allega Screenshot (opzionale)
      </label>
      <input type="file" id="br-screenshot" accept="image/*" style="display:none" onchange="document.getElementById('br-file-name').textContent=this.files[0]?.name||''">
      <div id="br-file-name" style="font-size:.72rem;color:var(--muted);margin-top:4px"></div>
    </div>
    <div style="font-size:.72rem;color:var(--muted);margin-bottom:12px">Pagina: <strong>${currentPage||'home'}</strong></div>
    <button onclick="submitBugReport()" style="width:100%;background:linear-gradient(135deg,var(--purple),var(--blue));color:#fff;border:none;border-radius:var(--rs);padding:13px;font-family:var(--fb);font-weight:800;font-size:.92rem;cursor:pointer">📩 Invia Segnalazione</button>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
}
async function submitBugReport(){
  const text=document.getElementById('br-text')?.value?.trim();
  if(!text){toast('Scrivi una descrizione del bug!','error');return;}
  try{
    const fd=new FormData();
    fd.append('text',text);
    fd.append('page',currentPage||'home');
    const fileInput=document.getElementById('br-screenshot');
    if(fileInput?.files[0]) fd.append('file',fileInput.files[0]);
    const tok=localStorage.getItem('gc_token');
    const r=await fetch('/api/bug-report',{method:'POST',headers:{'Authorization':'Bearer '+tok},body:fd});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Errore');
    document.getElementById('bug-report-modal')?.remove();
    toast('🐛 Bug segnalato! Grazie!','success',4000);
  }catch(e){toast(e.message,'error');}
}
// Global error → suggerisce segnalazione
let _lastBugToast=0;
window.addEventListener('error',e=>{
  if(Date.now()-_lastBugToast<15000)return;
  const msg=e.message||'';
  if(['Script error','ResizeObserver','Non-Error'].some(s=>msg.includes(s)))return;
  _lastBugToast=Date.now();
  console.warn('[GC]',msg);
  if(ME){
    const t=document.createElement('div');t.className='toast error';t.style.pointerEvents='auto';
    t.innerHTML='⚠️ Errore <button onclick="this.parentElement.remove();openBugReport()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:8px;padding:3px 10px;margin-left:8px;font-size:.75rem;font-weight:700;cursor:pointer">Segnala</button>';
    document.getElementById('toast-container')?.appendChild(t);
    setTimeout(()=>{t.classList?.add('out');setTimeout(()=>t.remove(),400);},6000);
  }
},{capture:true});

function escHTML(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function renderMentions(html){return html.replace(/@(\w+)/g,'<span style="color:var(--purple);font-weight:700;cursor:pointer" onclick="searchAndViewUser(\'$1\')">@$1</span>');}
function searchAndViewUser(username){
  GET('/api/users/search?q='+encodeURIComponent(username)).then(function(users){
    if(users&&users.length) viewUser(users[0]._id);
    else toast('Utente non trovato','error');
  }).catch(function(){});
}

// Close modals on outside click
document.addEventListener('click',e=>{
  const uo=document.getElementById('user-overlay');
  if(uo.classList.contains('open')&&e.target===uo)closeUserModal();
  const ao=document.getElementById('auth-overlay');
  if(ao.classList.contains('open')&&e.target===ao)closeAuth();
});

// Enter key in auth fields
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const lf=document.getElementById('login-form');
    const rf=document.getElementById('register-form');
    if(lf&&!lf.classList.contains('hidden'))doLogin();
    else if(rf&&!rf.classList.contains('hidden'))doRegister();
  }
});

/* ============================================================
   APP INIT
============================================================ */
// Global unhandled rejection suppressor
window.addEventListener('unhandledrejection',e=>{
  const msg=String(e.reason?.message||e.reason||'');
  const suppress=['The string did not match','AbortError','NetworkError','NotAllowedError',
    'NotFoundError','OverconstrainedError','iceCandidateError','DTLS','SRTP'];
  if(suppress.some(s=>msg.includes(s))){e.preventDefault();return;}
  e.preventDefault();
  console.warn('[GC unhandled]',msg);
});
window.addEventListener('error',e=>{
  const msg=e.message||'';
  if(msg.includes('Script error')||msg.includes('ResizeObserver')) return;
  console.warn('[GC error]',msg);
});

const APP_VERSION='v5.2';
function showUpdateGuide(){
  const lastVer=localStorage.getItem('gc_app_ver');
  // Show guide if: first visit, or version changed, and user is on mobile
  if(lastVer===APP_VERSION) return;
  localStorage.setItem('gc_app_ver',APP_VERSION);
  if(!lastVer) return; // first visit, no need to show update
  // Version changed — show reinstall guide
  setTimeout(()=>{
    const isIos=isIOS();
    const banner=document.createElement('div');
    banner.id='update-guide';
    banner.style.cssText='position:fixed;inset:0;z-index:9900;background:rgba(10,10,26,.92);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px;animation:bannerFade .3s ease';
    banner.innerHTML=`<div style="background:linear-gradient(160deg,#1a1a2e,#2D2D4E);border-radius:28px;padding:28px 22px;max-width:380px;width:100%;color:#fff;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.5)">
      <div style="font-size:3rem;margin-bottom:14px">🔄</div>
      <h2 style="font-family:var(--fh);font-size:1.4rem;margin-bottom:8px">Aggiornamento Disponibile!</h2>
      <p style="color:rgba(255,255,255,.6);font-size:.85rem;line-height:1.6;margin-bottom:20px">GiadaCourses è stato aggiornato alla versione ${APP_VERSION}. Per un'esperienza ottimale, reinstalla l'app.</p>
      ${isIos?`
        <div style="background:rgba(255,255,255,.06);border-radius:16px;padding:16px;text-align:left;margin-bottom:16px">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:10px">📱 Su iPhone/iPad:</div>
          <div style="font-size:.8rem;color:rgba(255,255,255,.7);line-height:1.7">
            1. Tieni premuto l'icona GiadaCourses<br>
            2. Tocca <strong style="color:#fff">Rimuovi app</strong><br>
            3. Apri Safari e torna su questo link<br>
            4. Tocca <strong style="color:#fff">Condividi ⎙ → Aggiungi a Home</strong><br>
            5. Apri dalla nuova icona!
          </div>
        </div>
      `:`
        <div style="background:rgba(255,255,255,.06);border-radius:16px;padding:16px;text-align:left;margin-bottom:16px">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:10px">📱 Su Android:</div>
          <div style="font-size:.8rem;color:rgba(255,255,255,.7);line-height:1.7">
            1. Disinstalla la vecchia app GiadaCourses<br>
            2. Torna su questo link con Chrome<br>
            3. Tocca il banner <strong style="color:#fff">"Installa App"</strong><br>
            4. Oppure: Menu ⋮ → <strong style="color:#fff">Installa app</strong>
          </div>
        </div>
      `}
      <button onclick="document.getElementById('update-guide').remove()" style="width:100%;background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:16px;padding:14px;font-family:var(--fb);font-weight:800;font-size:.95rem;cursor:pointer;margin-bottom:8px">✅ Ho capito, continua</button>
      <button onclick="localStorage.setItem('gc_skip_update','1');document.getElementById('update-guide').remove()" style="width:100%;background:none;border:none;color:rgba(255,255,255,.4);font-size:.78rem;cursor:pointer;padding:6px">Non mostrare più</button>
    </div>`;
    if(!localStorage.getItem('gc_skip_update')) document.body.appendChild(banner);
  },2000);
}

async function init(){
  // SAFETY: always hide splash after max 3s even if init fails
  const splashTimeout = setTimeout(()=>{
    const s=document.getElementById('splash');
    if(s)s.classList.add('hidden');
  }, 3000);
  
  try {
    const token=localStorage.getItem('gc_token');
    if(token){
      try{ME=await GET('/api/auth/me');}
      catch(e){
        console.warn('[INIT] Auth failed:', e.message);
        localStorage.removeItem('gc_token');ME=null;
      }
    }
    renderNavUser();
    renderHome();
    if(ME)startSSE();
    try {
      document.getElementById('dm-overlay').addEventListener('click',e=>{
        if(e.target===document.getElementById('dm-overlay'))closeDM();
      });
    } catch {}
    initPullToRefresh();
    checkPublicUrl();
    setInterval(checkPublicUrl,30000);
    setInterval(checkActiveLives,60000);
  } catch(e) {
    console.error('[INIT] Errore critico:', e);
  }
  
  // Hide splash
  clearTimeout(splashTimeout);
  setTimeout(()=>{
    const s=document.getElementById('splash');
    if(s)s.classList.add('hidden');
    // Init completed successfully: release the SW reload guard
    // so future SW updates can trigger a reload again
    sessionStorage.removeItem('sw_reloading');
  },800);
  // Show PWA install pill on mobile non-standalone after 2.5s
  if(isMobile()&&!isStandalone()){
    const dismissed=localStorage.getItem('pwa_dismissed');
    const dismissedAt=dismissed?parseInt(dismissed):0;
    const dayMs=86400000;
    // Show again after 24h even if dismissed
    if(!dismissed||(Date.now()-dismissedAt>dayMs)){
      setTimeout(()=>pwaPillShow(),2500);
    }
  }
  // PWA Update guide: suggest reinstall if app version changed
  showUpdateGuide();
}

window.addEventListener('DOMContentLoaded',()=>{
  initPWA();
});

/* ============================================================
   PWA — Installazione non-bloccante
   Init SEMPRE eseguito. Il panel è opzionale.
============================================================ */
let _pwaPrompt=null; // beforeinstallprompt event (Android Chrome)

function isMobile(){
  return /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(navigator.userAgent);
}
function isStandalone(){
  return window.matchMedia('(display-mode:standalone)').matches
    ||window.navigator.standalone===true
    ||document.referrer.startsWith('android-app://');
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
}
function isAndroidChrome(){
  return /Android/.test(navigator.userAgent)&&/Chrome/.test(navigator.userAgent);
}

function initPWA(){
  // Capture BEFORE registering: true only if a SW was already controlling the page.
  // This distinguishes "first install" (no reload needed) from "SW update" (reload needed).
  const hadController = !!navigator.serviceWorker.controller;
  // Register Service Worker
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js',{scope:'/'})
      .then(reg=>{
        reg.addEventListener('updatefound',()=>{
          const sw=reg.installing;
          sw.addEventListener('statechange',()=>{
            if(sw.state==='installed'&&navigator.serviceWorker.controller){
              sw.postMessage('skipWaiting');
              if(!sessionStorage.getItem('sw_reloading')){
                sessionStorage.setItem('sw_reloading','1');
                setTimeout(()=>window.location.reload(),800);
              }
            }
          });
        });
        reg.update().catch(()=>{});
      }).catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      // Guard: only reload on SW *update*, never on first install
      if(!hadController) return;
      if(sessionStorage.getItem('sw_reloading')) return;
      sessionStorage.setItem('sw_reloading','1');
      window.location.reload();
    });
    // Auto-reload quando il nuovo SW notifica l'aggiornamento
    navigator.serviceWorker.addEventListener('message', event => {
      if(event.data?.type === 'SW_UPDATED'){
        console.log('[SW] Aggiornamento rilevato:', event.data.version);
        // Only reload on actual update, not on first install
        if(!hadController) return;
        if(sessionStorage.getItem('sw_reloading')) return;
        sessionStorage.setItem('sw_reloading','1');
        window.location.reload();
      }
    });
    // Controlla aggiornamenti SW ogni 30 minuti
    setInterval(()=>{
      navigator.serviceWorker.getRegistration().then(reg=>{
        if(reg) reg.update().catch(()=>{});
      });
    }, 1800000);
  }

  // Capture install prompt on Android Chrome
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    _pwaPrompt=e;
    // Update button text if panel is already open
    const btn=document.getElementById('pp-android-btn');
    if(btn)btn.textContent='📲 Installa adesso — 1 tap!';
  });

  // App was successfully installed
  window.addEventListener('appinstalled',()=>{
    _pwaPrompt=null;
    pwaDismiss();
    toast('✅ App aggiunta alla schermata home!','success',4000);
  });

  // ALWAYS start the app immediately — no blocking gate
  init();
}

// ── PWA Panel (bottom sheet) ──
function pwaShow(){
  if(IS_NATIVE_APK) return; // APK users don't need install prompt
  const panel=document.getElementById('pwa-panel');
  if(!panel)return;
  // Show correct instructions
  document.getElementById('pp-android').style.display='none';
  document.getElementById('pp-ios').style.display='none';
  document.getElementById('pp-generic').style.display='none';
  if(isIOS()){
    document.getElementById('pp-ios').style.display='block';
  } else if(_pwaPrompt||isAndroidChrome()){
    document.getElementById('pp-android').style.display='block';
    if(_pwaPrompt){
      const btn=document.getElementById('pp-android-btn');
      if(btn)btn.textContent='📲 Installa adesso — 1 tap!';
    }
  } else {
    document.getElementById('pp-generic').style.display='block';
  }
  panel.classList.add('visible');
  // Close on outside tap
  setTimeout(()=>{
    document.addEventListener('click',_pwaOutsideTap,{once:true,capture:true});
  },300);
}

function _pwaOutsideTap(e){
  const panel=document.getElementById('pwa-panel');
  if(panel&&!panel.contains(e.target)){
    pwaClose();
  }
}

function pwaClose(){
  const panel=document.getElementById('pwa-panel');
  if(panel)panel.classList.remove('visible');
  document.removeEventListener('click',_pwaOutsideTap,{capture:true});
}

function pwaDismiss(){
  pwaClose();
  localStorage.setItem('pwa_dismissed',String(Date.now()));
  const pill=document.getElementById('pwa-pill');
  if(pill)pill.style.display='none';
}

function pwaPillShow(){
  if(IS_NATIVE_APK || isStandalone())return;
  const pill=document.getElementById('pwa-pill');
  if(pill){
    pill.style.display='flex';
    if(!localStorage.getItem('pwa_dismissed')){
      setTimeout(()=>pwaShow(),1000);
    }
  }
}

async function pwaInstallAndroid(){
  if(_pwaPrompt){
    _pwaPrompt.prompt();
    const {outcome}=await _pwaPrompt.userChoice;
    _pwaPrompt=null;
    if(outcome==='accepted'){
      pwaClose();
      const pill=document.getElementById('pwa-pill');
      if(pill)pill.style.display='none';
    } else {
      const btn=document.getElementById('pp-android-btn');
      if(btn){btn.textContent='📲 Riprova';btn.style.opacity='.7';}
    }
  } else {
    // No prompt available — show manual instructions
    document.getElementById('pp-android').style.display='none';
    document.getElementById('pp-generic').style.display='block';
  }
}
// ============================================================
//  GLOBAL ERROR LOGGING — invia crash al server (punto 8)
// ============================================================
(function(){
  const _origErr=console.error.bind(console);
  const _errBuf=[];
  let _lastSent=0;
  function sendErrLog(msg){
    if(!msg||Date.now()-_lastSent<3000)return;
    _lastSent=Date.now();
    try{
      fetch('/api/client-log',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+(localStorage.getItem('gc_token')||'')},
        body:JSON.stringify({level:'error',msg:String(msg).slice(0,800),ua:navigator.userAgent,url:location.href,ts:Date.now()})
      }).catch(()=>{});
    }catch{}
  }
  console.error=function(...a){
    _origErr(...a);
    sendErrLog(a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' '));
  };
  window.onerror=function(msg,src,line,col,err){
    sendErrLog(`[onerror] ${msg} @ ${src}:${line}:${col} — ${err?.stack||''}`);
  };
  window.onunhandledrejection=function(e){
    sendErrLog(`[unhandledRejection] ${e.reason?.message||e.reason||'unknown'}`);
  };
  // Espone buffer per debug manuale
  window._errBuf=_errBuf;
  window._showLogs=function(){
    const s=_errBuf.slice(-30).join('\n');
    alert(s||'Nessun errore recente');
  };
})();

// ============================================================
//  FIX SFIDE: notifica sonora + vibrazione + auto-dismiss safe
// ============================================================
const _origShowChallengeInvite=window.showChallengeInvite;
window.showChallengeInvite=function(cid,fromId,fromName,fromAvatar){
  document.getElementById('ch-invite-banner')?.remove();
  const banner=document.createElement('div');
  banner.id='ch-invite-banner';
  banner.className='ch-invite-banner';
  let cd=30;
  banner.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="font-size:2rem">${fromAvatar||'👤'}</div>
      <div style="flex:1">
        <div style="font-weight:800;font-size:1rem;color:#fff">⚔️ ${escHTML(fromName)} ti sfida!</div>
        <div style="font-size:.75rem;opacity:.6;color:#fff">5 domande di inglese rapide — hai 30 secondi</div>
      </div>
      <div id="ch-cd" style="font-family:var(--fh);font-size:1.3rem;color:var(--coral);min-width:28px;text-align:right">30</div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="ch-rej" style="flex:1;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:12px;cursor:pointer;font-weight:700;font-size:.88rem">Rifiuta</button>
      <button id="ch-acc" style="flex:2;background:linear-gradient(135deg,var(--coral),var(--orange));color:#fff;border:none;border-radius:12px;padding:12px;cursor:pointer;font-weight:800;font-size:.9rem">⚔️ Accetta!</button>
    </div>`;
  const cntEl=banner.querySelector('#ch-cd');
  const cntInt=setInterval(()=>{cd--;if(cntEl)cntEl.textContent=cd;if(cd<=0){clearInterval(cntInt);banner.remove();}},1000);
  banner.querySelector('#ch-rej').onclick=()=>{clearInterval(cntInt);banner.remove();POST('/api/challenges/'+cid+'/reject').catch(()=>{});};
  banner.querySelector('#ch-acc').onclick=async()=>{
    clearInterval(cntInt);banner.remove();
    try{
      const d=await POST('/api/challenges/'+cid+'/accept');
      toast('Sfida iniziata! Buona fortuna!','success',1500);
      startChallengeGame(d.challengeId||cid,d.questions,fromId,fromName,fromAvatar||'👤');
    }catch(e){toast(e.message,'error');}
  };
  document.body.appendChild(banner);
  // Suono + vibrazione
  try{playNotificationSound();}catch{}
  try{if(navigator.vibrate)navigator.vibrate([200,100,200]);}catch{}
  // Push notification
  try{showPushNotif('⚔️ Sfida da '+fromName,'Tocca per accettare la sfida 1v1!');}catch{}
};

// ============================================================
//  FIX CHIAMATE: notifica push + vibrazione
// ============================================================
const _origShowIncomingCall=window.showIncomingCall;
window.showIncomingCall=function(callId,fromId,fromName,fromAvatar,videoEnabled,offer){
  // Vibrazione prolungata
  try{if(navigator.vibrate)navigator.vibrate([500,200,500,200,500,200,500]);}catch{}
  // Chiama l'originale
  if(_origShowIncomingCall) _origShowIncomingCall(callId,fromId,fromName,fromAvatar,videoEnabled,offer);
};

// ============================================================
//  AGGIORNAMENTO AUTOMATICO CLASSIFICA ogni 60s se attiva
// ============================================================
setInterval(()=>{
  if(currentPage==='leaderboard'&&document.getElementById('lb-list')){
    loadLeaderboard().catch(()=>{});
  }
},60000);




// ============================================================
//  v10 NEW FEATURES
// ============================================================

// ── APP GATE: Android = APK obbligatorio, iOS = PWA ──
(function(){
  var isPWA = IS_NATIVE_APK || IS_PWA;
  if (isPWA) return;

  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);

  function createGate() {
    var b = document.getElementById('gc-app-gate');
    if (!b) { b = document.createElement('div'); b.id = 'gc-app-gate'; document.body.insertBefore(b, document.body.firstChild); }
    b.style.cssText = 'position:fixed;inset:0;z-index:999999;background:linear-gradient(160deg,#0a0a1a 0%,#1E1E3F 40%,#2a1a4a 100%);display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:30px;overflow-y:auto';
    var content = '<div style="max-width:380px;width:100%">';
    content += '<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#9C7CFF,#FF9ECD);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;box-shadow:0 8px 24px rgba(156,124,255,.3)">GC</div>';
    content += '<div style="font-family:Poppins,sans-serif;font-size:1.6rem;font-weight:800;margin-bottom:8px">GiadaCourses</div>';
    if (isAndroid) {
      content += '<div style="font-size:.9rem;opacity:.7;line-height:1.6;margin-bottom:24px">Per utilizzare GiadaCourses su Android scarica l\'app ufficiale.</div>';
      content += '<a href="/api/download-apk" download="GiadaCourses.apk" style="display:block;width:100%;background:linear-gradient(135deg,#4ADE80,#22C55E);color:#fff;border:none;border-radius:16px;padding:16px;font-family:Poppins,sans-serif;font-weight:800;font-size:1rem;cursor:pointer;margin-bottom:14px;box-shadow:0 6px 20px rgba(74,222,128,.35);text-decoration:none;text-align:center">Scarica App Android</a>';
      content += '<div style="background:rgba(255,255,255,.06);border-radius:14px;padding:16px;text-align:left">';
      content += '<div style="font-weight:700;font-size:.85rem;margin-bottom:12px">Come installare:</div>';
      content += '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px"><div style="background:rgba(74,222,128,.3);border-radius:6px;padding:2px 8px;font-weight:800;flex-shrink:0;font-size:.8rem">1</div><div style="font-size:.82rem;opacity:.85">Tocca <strong>Scarica App Android</strong> qui sopra</div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px"><div style="background:rgba(74,222,128,.3);border-radius:6px;padding:2px 8px;font-weight:800;flex-shrink:0;font-size:.8rem">2</div><div style="font-size:.82rem;opacity:.85">Apri il file <strong>GiadaCourses.apk</strong></div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px"><div style="background:rgba(74,222,128,.3);border-radius:6px;padding:2px 8px;font-weight:800;flex-shrink:0;font-size:.8rem">3</div><div style="font-size:.82rem;opacity:.85">Se richiesto, abilita <strong>Installa da fonti sconosciute</strong></div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:8px"><div style="background:rgba(74,222,128,.3);border-radius:6px;padding:2px 8px;font-weight:800;flex-shrink:0;font-size:.8rem">4</div><div style="font-size:.82rem;opacity:.85">Tocca <strong>Installa</strong> e apri l\'app</div></div>';
      content += '</div>';
    } else if (isIOS) {
      var isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
      content += '<div style="font-size:.9rem;opacity:.7;line-height:1.6;margin-bottom:24px">Aggiungi l\'app alla schermata home del tuo iPhone.</div>';
      content += '<div style="background:rgba(255,255,255,.08);border-radius:16px;padding:18px;text-align:left;margin-bottom:14px">';
      if(!isSafari){ content += '<div style="background:rgba(255,107,107,.15);border:1px solid rgba(255,107,107,.3);border-radius:12px;padding:12px;margin-bottom:14px;font-size:.82rem">Apri questa pagina in <strong>Safari</strong>.</div>'; }
      content += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px"><div style="background:rgba(156,124,255,.3);border-radius:8px;padding:4px 10px;font-weight:800;flex-shrink:0">1</div><div style="font-size:.84rem;opacity:.9">Tocca i <strong>tre puntini</strong> (...) in basso a destra</div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px"><div style="background:rgba(156,124,255,.3);border-radius:8px;padding:4px 10px;font-weight:800;flex-shrink:0">2</div><div style="font-size:.84rem;opacity:.9">Tocca <strong>Condividi</strong> (freccia verso l\'alto)</div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px"><div style="background:rgba(156,124,255,.3);border-radius:8px;padding:4px 10px;font-weight:800;flex-shrink:0">3</div><div style="font-size:.84rem;opacity:.9">Scorri e tocca <strong>Aggiungi alla schermata Home</strong></div></div>';
      content += '<div style="display:flex;align-items:flex-start;gap:10px"><div style="background:rgba(156,124,255,.3);border-radius:8px;padding:4px 10px;font-weight:800;flex-shrink:0">4</div><div style="font-size:.84rem;opacity:.9">Tocca <strong>Aggiungi</strong> in alto a destra</div></div>';
      content += '</div>';
    } else {
      content += '<div style="font-size:.9rem;opacity:.7;line-height:1.6;margin-bottom:16px">Apri dal tuo smartphone per scaricare l\'app.</div>';
      content += '<a href="/api/download-apk" download style="display:inline-block;background:linear-gradient(135deg,#4ADE80,#22C55E);color:#fff;padding:12px 28px;border-radius:14px;font-weight:700;text-decoration:none">Scarica per Android</a>';
    }
    content += '</div>';
    b.innerHTML = content;
    document.body.style.overflow = 'hidden';
  }
  function nukeContent() { document.querySelectorAll('body > *').forEach(function(el) { if (el.id !== 'gc-app-gate') el.remove(); }); }
  createGate(); nukeContent();
  var _gateGuard = new MutationObserver(function() { var b = document.getElementById('gc-app-gate'); if (!b || getComputedStyle(b).display === 'none') { createGate(); nukeContent(); } });
  _gateGuard.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  setInterval(function() { var b = document.getElementById('gc-app-gate'); if (!b || getComputedStyle(b).display === 'none') { createGate(); nukeContent(); } document.body.style.overflow = 'hidden'; }, 500);
  document.addEventListener('contextmenu', function(e) { var inChat = e.target.closest('.dm-sheet, .comment-input, [contenteditable], textarea, input[type="text"]'); if (!inChat) e.preventDefault(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'F12') { e.preventDefault(); return false; } if (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key.toUpperCase())) { e.preventDefault(); return false; } if (e.ctrlKey && e.key.toUpperCase() === 'U') { e.preventDefault(); return false; } });
})();


// ── Dark Mode Toggle ──
function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('gc_theme', newTheme);
  if(ME) POST('/api/users/me', { theme: newTheme }).catch(()=>{});
}
// Applica tema salvato all'avvio
(function(){
  const saved = localStorage.getItem('gc_theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ── Incoming Call Full-Screen UI ──
function showIncomingCallUI(callId, fromName, fromAvatar, fromAvatarUrl, videoEnabled) {
  // Rimuovi UI precedente
  document.getElementById('incoming-call-ui')?.remove();
  
  // Push notification browser
  showPushNotif(fromName + ' ti sta chiamando', videoEnabled ? 'Videochiamata in arrivo' : 'Chiamata audio in arrivo');
  
  // Vibrazione
  try { navigator.vibrate([200,100,200,100,200]); } catch {}
  
  const overlay = document.createElement('div');
  overlay.id = 'incoming-call-ui';
  overlay.className = 'incoming-call-overlay';
  
  const avatarContent = fromAvatarUrl 
    ? '<img src="' + fromAvatarUrl + '" alt="">'
    : (fromAvatar || fromName?.charAt(0) || '?');
  
  overlay.innerHTML = 
    '<div class="call-avatar-ring">' + avatarContent + '</div>' +
    '<div style="font-family:var(--fh);font-size:1.5rem;font-weight:800">' + escHTML(fromName) + '</div>' +
    '<div style="font-size:.9rem;opacity:.6">' + (videoEnabled ? 'Videochiamata in arrivo...' : 'Chiamata in arrivo...') + '</div>' +
    '<div class="call-actions">' +
      '<button class="call-btn-reject" id="call-reject-btn" title="Rifiuta">&#x260E;</button>' +
      '<button class="call-btn-accept" id="call-accept-btn" title="Rispondi">&#x260E;</button>' +
    '</div>';
  
  document.body.appendChild(overlay);
  
  // Ringtone audio
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    function ring() {
      if (!document.getElementById('incoming-call-ui')) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.start(); osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => {
        if (!document.getElementById('incoming-call-ui')) return;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = 554;
        gain2.gain.value = 0.15;
        osc2.start(); osc2.stop(ctx.currentTime + 0.3);
      }, 350);
    }
    ring();
    const ringInterval = setInterval(() => {
      if (!document.getElementById('incoming-call-ui')) { clearInterval(ringInterval); return; }
      ring();
    }, 2000);
    overlay._ringInterval = ringInterval;
    overlay._audioCtx = ctx;
  } catch {}
  
  return { overlay, callId };
}

function dismissIncomingCallUI() {
  const ui = document.getElementById('incoming-call-ui');
  if (ui) {
    if (ui._ringInterval) clearInterval(ui._ringInterval);
    try { navigator.vibrate(0); } catch {}
    ui.remove();
  }
}

// ============================================================
//  PERFORMANCE OPTIMIZATIONS
// ============================================================

// Debounce helper
function _debounce(fn, ms) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

// Lazy-load images con IntersectionObserver
(function(){
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });

  // Osserva nuove immagini aggiunte al DOM
  const mo = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          node.querySelectorAll?.('img[data-src]')?.forEach(img => observer.observe(img));
          if (node.tagName === 'IMG' && node.dataset.src) observer.observe(node);
        }
      });
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();

// Ottimizza scroll performance
(function(){
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => { ticking = false; });
      ticking = true;
    }
  }, { passive: true });
})();

// Pre-cache delle pagine visitate per navigazione istantanea
const _pageCache = new Map();
const _origShowPage = typeof showPage === 'function' ? showPage : null;
if (_origShowPage) {
  // Noop - showPage e' gia definita, il caching si integra lato rendering
}

// Memory cleanup: rimuovi vecchi dati ogni 5 minuti
setInterval(() => {
  if (_pageCache.size > 20) _pageCache.clear();
}, 300000);
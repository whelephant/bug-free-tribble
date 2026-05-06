// ── CONFIG ────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://gdxrfbjavtuivaarzvjl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkeHJmYmphdnR1aXZhYXJ6dmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNTAxNDUsImV4cCI6MjA5MDgyNjE0NX0.UwTbld0t0L6_tYRiiI0OsOQIkvUdnfRfxI-EXviXfTI';
const STORAGE_BUCKET    = 'resources';
// VCE Methods exam date — update when VCAA confirms the 2026 timetable.
const EXAM_DATE  = '2026-10-29';
const EXAM_LABEL = 'Methods Exam 1';
// ─────────────────────────────────────────────────────────────────────

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let homeworkItems = [];
let progressMap = {};
let schedData = [];
let hwData = [];
let currentScheduleRows = [];
let studyAreas = [];
let studyPoints = [];
let studyStatusMap = {};

// ── SCREEN HELPER ─────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── STARTUP ───────────────────────────────────────────────────────────
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await enterApp();
  }
})();

// ── ADMIN ─────────────────────────────────────────────────────────────
document.getElementById('admin-email').addEventListener('keydown', e => { if (e.key === 'Enter') checkAdmin(); });
document.getElementById('admin-pw').addEventListener('keydown', e => { if (e.key === 'Enter') checkAdmin(); });

async function checkAdmin() {
  const email = document.getElementById('admin-email').value.trim();
  const pw    = document.getElementById('admin-pw').value;
  const errEl = document.getElementById('admin-login-err');
  const btn   = document.getElementById('admin-login-btn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { errEl.textContent = error.message; return; }
    const { data: isAdmin, error: rpcErr } = await sb.rpc('is_admin');
    if (rpcErr) { errEl.textContent = rpcErr.message; await sb.auth.signOut(); return; }
    if (!isAdmin) { errEl.textContent = 'This account is not an admin.'; await sb.auth.signOut(); return; }
    currentUser = data.user;
    document.getElementById('admin-pw').value = '';
    showScreen('screen-admin');
    await loadAdminData();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enter Admin Panel';
  }
}

async function exitAdmin() {
  await sb.auth.signOut();
  currentUser = null;
  showScreen('screen-login');
}

// ── REGISTER ──────────────────────────────────────────────────────────
async function doRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw    = document.getElementById('reg-pw').value;
  const msgEl = document.getElementById('reg-msg');
  const btn   = document.getElementById('reg-btn');
  if (!name)         { showMsg(msgEl, 'Please enter your name.', 'error'); return; }
  if (!email)        { showMsg(msgEl, 'Please enter your email.', 'error'); return; }
  if (pw.length < 6) { showMsg(msgEl, 'Password must be at least 6 characters.', 'error'); return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account…';
  const { error } = await sb.auth.signUp({ email, password: pw, options: { data: { display_name: name } } });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) { showMsg(msgEl, error.message, 'error'); return; }
  showMsg(msgEl, 'Account created! Check your email to confirm, then sign in.', 'success');
}

// ── LOGIN ─────────────────────────────────────────────────────────────
document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { showMsg(errEl, error.message, 'error'); return; }
  errEl.textContent = '';
  currentUser = data.user;
  await enterApp();
}

// ── LOGOUT ────────────────────────────────────────────────────────────
async function doLogout() {
  await sb.auth.signOut();
  currentUser = null;
  showScreen('screen-login');
}

// ── APP ENTRY ─────────────────────────────────────────────────────────
async function enterApp() {
  const name = currentUser.user_metadata?.display_name || currentUser.email;
  document.getElementById('user-label').textContent = name;
  showScreen('screen-app');
  updateExamCountdown();
  await Promise.all([loadSchedule(), loadHomework(), loadStudyDesign()]);
}

function updateExamCountdown() {
  const el = document.getElementById('exam-countdown');
  if (!el || !EXAM_DATE) return;
  const exam  = new Date(EXAM_DATE + 'T00:00:00');
  if (isNaN(exam)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((exam - today) / 86400000);
  let num;
  if (days > 0)       num = `${days} day${days === 1 ? '' : 's'}`;
  else if (days === 0) num = 'today';
  else                 num = `${-days} day${days === -1 ? '' : 's'} ago`;
  el.classList.toggle('past', days < 0);
  el.innerHTML = `<span class="ec-label">${escapeHtml(EXAM_LABEL)}</span><span class="ec-num">${num}</span>`;
  el.hidden = false;
}

// ── TABS ──────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ── FILE UTILS ────────────────────────────────────────────────────────
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return '📄';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['ppt','pptx'].includes(ext)) return '📊';
  if (['xls','xlsx'].includes(ext)) return '📈';
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return '🖼️';
  return '📎';
}

function storagePath(rowId, fileName) {
  return `week-${rowId}/${fileName}`;
}

function getPublicUrl(path) {
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ── FILE MODAL ────────────────────────────────────────────────────────
// iOS Safari and most mobile browsers refuse to scroll PDFs rendered inside
// an <iframe> — only the first page is shown. Detect that case and hand the
// file off to the OS-level viewer in a new tab instead.
function isMobileDevice() {
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  if (navigator.userAgent.includes('Mac') && 'ontouchend' in document) return true;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function openModal(url, name) {
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  } catch { return; }
  const isPdf = /\.pdf$/i.test(parsed.pathname) || /\.pdf$/i.test(String(name || ''));
  if (isPdf && isMobileDevice()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  document.getElementById('modal-title').textContent = name;
  document.getElementById('modal-frame').src = url;
  document.getElementById('file-modal').classList.add('open');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe interpolation of user data inside inline JS handlers (e.g. onclick="fn(${jsAttr(x)})").
// JSON.stringify gives a safe JS string literal; escapeHtml then makes it safe inside an HTML attribute.
function jsAttr(s) {
  return escapeHtml(JSON.stringify(String(s ?? '')));
}

function formatNotes(text) {
  if (!text) return '';
  let safe = escapeHtml(text);
  // images: ![alt](url) — must run before link regex
  safe = safe.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" referrerpolicy="no-referrer" loading="lazy" style="max-width:100%;height:auto;display:block;margin:0.5rem 0;border:1px solid #e5e7eb;">');
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  safe = safe.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');
  safe = safe.replace(/__([\s\S]+?)__/g, '<u>$1</u>');
  return safe.replace(/\n/g, '<br>');
}

function getYoutubeEmbed(url) {
  try {
    const parsed = new URL(url);
    let id = null;
    if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) {
      id = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com')) {
      id = new URLSearchParams(parsed.search).get('v');
      if (!id && parsed.pathname.startsWith('/embed/')) {
        id = parsed.pathname.slice('/embed/'.length).split('/')[0];
      }
    }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return `https://www.youtube.com/embed/${id}?rel=0`;
  } catch { return null; }
}

function openVideo(event, url, title) {
  event.stopPropagation();
  if (!url) return;
  const embedUrl = getYoutubeEmbed(url);
  if (!embedUrl) { alert('Only YouTube URLs are supported for inline playback.'); return; }
  openModal(embedUrl, title);
}

function closeModal(e) {
  if (e.target === document.getElementById('file-modal')) closeModalDirect();
}

function closeModalDirect() {
  document.getElementById('file-modal').classList.remove('open');
  document.getElementById('modal-frame').src = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalDirect(); });

// ── SCHEDULE: LOAD FILES FOR A ROW ────────────────────────────────────
const _fileCache = new Map();  // rowId -> files[] (per-session)

async function loadRowFiles(rowId, { force = false } = {}) {
  if (!force && _fileCache.has(rowId)) return _fileCache.get(rowId);
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).list(`week-${rowId}`);
  if (error || !data) return [];
  const files = data.filter(f => f.name && !f.name.startsWith('.'));
  _fileCache.set(rowId, files);
  return files;
}

function renderFileChips(files, rowId, row) {
  const notesHtml = row?.notes ? `<div class="week-note"><strong>Class Notes</strong><br>${formatNotes(row.notes)}</div>` : '';
  if (!files.length) {
    return '<span class="file-drawer-empty">No files uploaded for this week yet.</span>' + notesHtml;
  }
  return files.map(f => {
    const url = getPublicUrl(storagePath(rowId, f.name));
    const icon = fileIcon(f.name);
    return `<a class="file-chip" onclick="openModal(${jsAttr(url)}, ${jsAttr(f.name)})">
      <span class="file-chip-icon">${icon}</span>${escapeHtml(f.name)}
    </a>`;
  }).join('') + notesHtml;
}

// ── SCHEDULE (student view) ───────────────────────────────────────────
async function loadSchedule() {
  const { data, error } = await sb.from('schedule').select('*').eq('published', true).order('sort_order');
  if (error) { document.getElementById('schedule-content').innerHTML = '<div class="empty-state">Error loading schedule.</div>'; return; }
  currentScheduleRows = data || [];
  renderSchedule(currentScheduleRows);
}

const TERM_META = { 1:{label:'Term 1',cls:'t1'}, 2:{label:'Term 2',cls:'t2'}, 3:{label:'Term 3',cls:'t3'}, 4:{label:'Term 4',cls:'t4'} };

function renderSchedule(rows) {
  let html = '';
  [1,2,3,4].forEach(t => {
    const group = rows.filter(r => r.term === t);
    if (!group.length) return;
    const { label, cls } = TERM_META[t];
    const hasDates = group.some(r => r.week_commencing);
    const hasVcaa  = group.some(r => r.vcaa_exam);
    const hasYoutube = group.some(r => r.youtube_link);
    const colCount = (hasDates ? 1 : 0) + 3 + (hasVcaa ? 1 : 0) + (hasYoutube ? 1 : 0);

    html += `<div class="term-block collapsed" data-term="${t}"><div class="term-label ${cls}" onclick="toggleTerm(${t})">${label}</div>
    <table class="schedule-table"><thead><tr>`;
    if (hasDates) html += `<th>Week Commencing</th>`;
    html += `<th>Week</th><th>Content</th><th>Homework</th>`;
    if (hasVcaa)  html += `<th>VCAA Exam</th>`;
    if (hasYoutube) html += `<th>Recording</th>`;
    html += `</tr></thead><tbody>`;

    group.forEach(r => {
      const rid = r.id;
      html += `<tr class="week-row" onclick="toggleDrawer(${jsAttr(rid)}, ${colCount})">`;
      if (hasDates) html += `<td class="dt" data-label="Week Commencing">${escapeHtml(r.week_commencing||'')}</td>`;
      html += `<td class="wk" data-label="Week">Week ${escapeHtml(r.week_number||'')}</td><td data-label="Content">${escapeHtml(r.content||'')}</td><td data-label="Homework">${escapeHtml(r.homework||'')}</td>`;
      if (hasVcaa)  html += `<td data-label="VCAA Exam">${escapeHtml(r.vcaa_exam||'')}</td>`;
      if (hasYoutube) html += `<td data-label="Recording">${r.youtube_link ? `<button class="btn-files" onclick="openVideo(event, ${jsAttr(r.youtube_link)}, 'Lesson video')">▶ Watch</button>` : ''}</td>`;
      html += `</tr>`;
      // file drawer row (hidden until clicked)
      html += `<tr class="file-drawer-row" id="drawer-${escapeHtml(rid)}">
        <td colspan="${colCount}">
          <div class="file-drawer">
            <div class="file-drawer-inner" id="drawer-inner-${escapeHtml(rid)}">
              <span class="file-drawer-loading"><span class="spinner"></span> Loading files…</span>
            </div>
          </div>
        </td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  if (!html) html = '<div class="empty-state">No schedule yet — check back soon.</div>';
  document.getElementById('schedule-content').innerHTML = html;
}

function toggleTerm(t) {
  const block = document.querySelector(`.term-block[data-term="${t}"]`);
  if (block) block.classList.toggle('collapsed');
}

async function toggleDrawer(rowId, colCount) {
  const drawerRow = document.getElementById(`drawer-${rowId}`);
  const weekRow   = drawerRow.previousElementSibling;
  const isOpen    = drawerRow.classList.contains('open');

  // Accordion: close any other open drawer before opening this one
  document.querySelectorAll('.file-drawer-row.open').forEach(d => {
    if (d !== drawerRow) {
      d.classList.remove('open');
      d.previousElementSibling?.classList.remove('open');
    }
  });

  if (isOpen) {
    drawerRow.classList.remove('open');
    weekRow.classList.remove('open');
    return;
  }

  drawerRow.classList.add('open');
  weekRow.classList.add('open');

  const inner = document.getElementById(`drawer-inner-${rowId}`);
  const row = currentScheduleRows.find(r => String(r.id) === String(rowId));

  // Use cache if available (no spinner flash on re-open)
  if (_fileCache.has(rowId)) {
    inner.innerHTML = renderFileChips(_fileCache.get(rowId), rowId, row);
    return;
  }

  inner.innerHTML = '<span class="file-drawer-loading"><span class="spinner"></span> Loading files…</span>';
  const files = await loadRowFiles(rowId);
  inner.innerHTML = renderFileChips(files, rowId, row);
}

// ── HOMEWORK ──────────────────────────────────────────────────────────
async function loadHomework() {
  const [itemsRes, progressRes] = await Promise.all([
    sb.from('homework_items').select('*').order('sort_order'),
    sb.from('homework_progress').select('*').eq('user_id', currentUser.id)
  ]);
  homeworkItems = itemsRes.data || [];
  progressMap = {};
  (progressRes.data || []).forEach(p => { progressMap[p.homework_id] = p.completed; });
  renderHomework();
}

function renderHomework() {
  const list = document.getElementById('hw-list');
  if (!homeworkItems.length) { list.innerHTML = '<div class="empty-state">No homework items yet.</div>'; updateProgress(); return; }
  list.innerHTML = '';
  homeworkItems.forEach(item => {
    const done = !!progressMap[item.id];
    const div = document.createElement('div');
    div.className = 'hw-item' + (done ? ' done' : '');
    div.dataset.id = item.id;
    div.innerHTML = `<div class="hw-check">${done?'✓':''}</div><div><div class="hw-text">${escapeHtml(item.text||'')}</div><span class="hw-tag t${parseInt(item.term)||1}">${escapeHtml(item.week_label||'')}</span></div>`;
    div.addEventListener('click', () => toggleHW(item.id));
    list.appendChild(div);
  });
  updateProgress();
}

async function toggleHW(id) {
  const newVal = !progressMap[id];
  progressMap[id] = newVal;
  const el = document.querySelector(`.hw-item[data-id="${id}"]`);
  el.classList.toggle('done', newVal);
  el.querySelector('.hw-check').textContent = newVal ? '✓' : '';
  updateProgress();
  await sb.from('homework_progress').upsert(
    { user_id: currentUser.id, homework_id: id, completed: newVal, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,homework_id' }
  );
}

function updateProgress() {
  const total = homeworkItems.length;
  const done  = homeworkItems.filter(h => progressMap[h.id]).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  document.getElementById('hw-fill').style.width = pct + '%';
  document.getElementById('hw-count').textContent = `${done} of ${total} complete`;
  document.getElementById('hw-pct').textContent = total ? pct + '%' : '';
}

async function resetHomework() {
  if (!confirm('Reset all your homework progress?')) return;
  homeworkItems.forEach(h => { progressMap[h.id] = false; });
  await sb.from('homework_progress').delete().eq('user_id', currentUser.id);
  renderHomework();
}

// ── STUDY DESIGN TRACKER ──────────────────────────────────────────────
const SD_AOS_META = { 1: 't1', 2: 't2', 3: 't3', 4: 't4' };

async function loadStudyDesign() {
  const [areasRes, pointsRes, progressRes] = await Promise.all([
    sb.from('study_areas').select('*').order('aos'),
    sb.from('study_points').select('*').order('aos').order('sort_order'),
    sb.from('study_progress').select('*').eq('user_id', currentUser.id)
  ]);
  if (areasRes.error || pointsRes.error) {
    document.getElementById('sd-content').innerHTML = '<div class="empty-state">Error loading study design.</div>';
    return;
  }
  studyAreas = areasRes.data || [];
  studyPoints = pointsRes.data || [];
  studyStatusMap = {};
  (progressRes.data || []).forEach(p => { studyStatusMap[p.point_id] = p.status; });
  renderStudyDesign();
}

function renderStudyDesign() {
  const container = document.getElementById('sd-content');
  if (!studyAreas.length || !studyPoints.length) {
    container.innerHTML = '<div class="empty-state">Study design not seeded yet. Run study_design_seed.sql against Supabase.</div>';
    updateStudyProgress();
    return;
  }
  let html = '';
  studyAreas.forEach(area => {
    const cls = SD_AOS_META[area.aos] || 't1';
    const points = studyPoints.filter(p => p.aos === area.aos);
    html += `<div class="term-block collapsed" data-sd-aos="${area.aos}">
      <div class="term-label ${cls}" onclick="toggleSdBlock(${area.aos})">AOS ${area.aos} · ${escapeHtml(area.title)}</div>
      <div class="sd-intro">${escapeHtml(area.intro)}</div>
      <div class="sd-list">`;
    points.forEach(p => {
      if (p.is_header) {
        html += `<div class="sd-group-head">${escapeHtml(p.text)}</div>`;
      } else {
        const cur = studyStatusMap[p.id] || '';
        html += `<div class="sd-item" data-sd-id="${escapeHtml(p.id)}">
          <div class="sd-text">${escapeHtml(p.text)}</div>
          <div class="tl-pill" role="radiogroup" aria-label="Confidence">
            <button class="tl red${cur==='red'?' active':''}"     onclick="cycleStatus(${jsAttr(p.id)},'red')"   aria-label="Needs work"     title="Needs work"></button>
            <button class="tl amber${cur==='amber'?' active':''}" onclick="cycleStatus(${jsAttr(p.id)},'amber')" aria-label="Getting there" title="Getting there"></button>
            <button class="tl green${cur==='green'?' active':''}" onclick="cycleStatus(${jsAttr(p.id)},'green')" aria-label="Confident"     title="Confident"></button>
          </div>
        </div>`;
      }
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;
  updateStudyProgress();
  ensureKatex().then(renderStudyDesignMath);
}

// Lazy-load KaTeX (CSS + JS + auto-render) on first Study Design render.
let _katexLoading = null;
function ensureKatex() {
  if (window.renderMathInElement) return Promise.resolve();
  if (_katexLoading) return _katexLoading;
  _katexLoading = new Promise(resolve => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    js.onload = () => {
      const ar = document.createElement('script');
      ar.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';
      ar.onload = resolve;
      document.head.appendChild(ar);
    };
    document.head.appendChild(js);
  });
  return _katexLoading;
}

function renderStudyDesignMath() {
  const el = document.getElementById('sd-content');
  if (!el || !window.renderMathInElement) return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false }
      ],
      throwOnError: false,
      ignoredTags: ['script','noscript','style','textarea','pre','code']
    });
  } catch (e) { console.warn('KaTeX render failed', e); }
}

function toggleSdBlock(aos) {
  const block = document.querySelector(`.term-block[data-sd-aos="${aos}"]`);
  if (block) block.classList.toggle('collapsed');
}

async function cycleStatus(pointId, target) {
  const current = studyStatusMap[pointId];
  const newStatus = (current === target) ? null : target;
  // Optimistic UI update
  if (newStatus === null) delete studyStatusMap[pointId];
  else studyStatusMap[pointId] = newStatus;
  applyStatusToRow(pointId, newStatus);
  updateStudyProgress();
  // Persist
  if (newStatus === null) {
    await sb.from('study_progress').delete().eq('user_id', currentUser.id).eq('point_id', pointId);
  } else {
    await sb.from('study_progress').upsert(
      { user_id: currentUser.id, point_id: pointId, status: newStatus, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,point_id' }
    );
  }
}

function applyStatusToRow(pointId, status) {
  const row = document.querySelector(`.sd-item[data-sd-id="${CSS.escape(pointId)}"]`);
  if (!row) return;
  row.querySelectorAll('.tl').forEach(btn => btn.classList.remove('active'));
  if (!status) return;
  const active = row.querySelector(`.tl.${status}`);
  if (active) active.classList.add('active');
}

function updateStudyProgress() {
  const trackable = studyPoints.filter(p => !p.is_header);
  const total = trackable.length;
  let red = 0, amber = 0, green = 0;
  trackable.forEach(p => {
    const s = studyStatusMap[p.id];
    if (s === 'red')   red++;
    else if (s === 'amber') amber++;
    else if (s === 'green') green++;
  });
  const untouched = total - red - amber - green;
  document.getElementById('sd-fill-green').style.width = total ? `${(green/total)*100}%` : '0%';
  document.getElementById('sd-fill-amber').style.width = total ? `${(amber/total)*100}%` : '0%';
  document.getElementById('sd-fill-red').style.width   = total ? `${(red  /total)*100}%` : '0%';
  const pct = total ? Math.round((green/total)*100) : 0;
  document.getElementById('sd-pct').textContent = total ? `${pct}% green` : '';
  document.getElementById('sd-summary').innerHTML = total
    ? `<span class="sd-summary-pills">
        <span class="sd-summary-pill green">${green} green</span>
        <span class="sd-summary-pill amber">${amber} amber</span>
        <span class="sd-summary-pill red">${red} red</span>
        <span class="sd-summary-pill muted">${untouched} untouched</span>
      </span>`
    : 'Loading…';
}

async function resetStudyDesign() {
  if (!confirm('Reset all your study design progress?')) return;
  studyStatusMap = {};
  await sb.from('study_progress').delete().eq('user_id', currentUser.id);
  renderStudyDesign();
}

// ── ADMIN: LOAD ───────────────────────────────────────────────────────
// `only` may be 'schedule' | 'homework' | undefined (load both).
async function loadAdminData(only) {
  const ops = [];
  if (only !== 'homework') ops.push(sb.from('schedule').select('*').order('sort_order'));
  if (only !== 'schedule') ops.push(sb.from('homework_items').select('*').order('sort_order'));
  const results = await Promise.all(ops);
  let i = 0;
  if (only !== 'homework') renderAdminSchedule(results[i++].data || []);
  if (only !== 'schedule') renderAdminHomework(results[i++].data || []);
}

// ── ADMIN: SCHEDULE ───────────────────────────────────────────────────
function renderAdminSchedule(rows) {
  schedData = rows.map(r => ({...r}));
  redrawSchedTable();
}

// Track which term groups the admin has collapsed in the schedule editor.
// Persists across redraws within the session so collapse state survives edits.
const _adminSchedCollapsed = new Set();

function redrawSchedTableWithFiles() {
  const tbody = document.getElementById('sched-tbody');
  const visible = schedData.filter(r => !r._deleted);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No rows yet. Click + Add Row.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  [1, 2, 3, 4].forEach(t => {
    const groupCount = schedData.filter(r => !r._deleted && r.term === t).length;
    if (!groupCount) return;
    const collapsed = _adminSchedCollapsed.has(t);

    const draftCount = schedData.filter(r => !r._deleted && r.term === t && r.published === false).length;
    const draftHtml = draftCount ? `<span class="draft-count">${draftCount} draft${draftCount === 1 ? '' : 's'}</span>` : '';

    const headerTr = document.createElement('tr');
    headerTr.className = `admin-term-header t${t}${collapsed ? ' collapsed' : ''}`;
    headerTr.dataset.term = t;
    headerTr.innerHTML = `<td colspan="10" onclick="toggleAdminSchedTerm(${t})">Term ${t}<span class="admin-term-count">${groupCount} ${groupCount === 1 ? 'row' : 'rows'}${draftHtml}</span></td>`;
    tbody.appendChild(headerTr);

    schedData.forEach((r, i) => {
      if (r._deleted || r.term !== t) return;
      const tr = makeSchedRow(r, i);
      tr.classList.add('admin-term-row');
      tr.dataset.termRow = t;
      if (collapsed) tr.classList.add('collapsed');
      tbody.appendChild(tr);
      if (tr._fileRow) {
        tr._fileRow.dataset.termRow = t;
        if (collapsed) tr._fileRow.classList.add('collapsed');
        tbody.appendChild(tr._fileRow);
      }
    });
  });
}

function toggleAdminSchedTerm(t) {
  const willCollapse = !_adminSchedCollapsed.has(t);
  if (willCollapse) _adminSchedCollapsed.add(t); else _adminSchedCollapsed.delete(t);
  const tbody = document.getElementById('sched-tbody');
  tbody.querySelector(`.admin-term-header[data-term="${t}"]`)?.classList.toggle('collapsed', willCollapse);
  tbody.querySelectorAll(`tr[data-term-row="${t}"]`).forEach(r => r.classList.toggle('collapsed', willCollapse));
}

// redrawSchedTable is an alias for redrawSchedTableWithFiles
function redrawSchedTable() { redrawSchedTableWithFiles(); }

function makeSchedRow(r, i) {
  const tr = document.createElement('tr');
  if (r._new) tr.classList.add('new-row');
  if (r.published === false) tr.classList.add('draft-row');
  tr.ondragover = (e) => onRowDragOver(e, i, 'sched');
  tr.ondrop     = (e) => onRowDrop(e, i, 'sched');
  tr.ondragleave = (e) => onRowDragLeave(e);
  const visibleIndex = schedData.filter((row, idx) => !row._deleted && idx <= i).length - 1;
  const visibleTotal = schedData.filter(row => !row._deleted).length;
  const isLive = r.published !== false;
  const publishBtn = `<button class="btn-publish ${isLive ? 'live' : 'draft'}" onclick="togglePublished(${i})" title="${isLive ? 'Visible to students — click to hide' : 'Hidden from students — click to publish'}">${isLive ? '● LIVE' : '○ DRAFT'}</button>`;
  tr.innerHTML = `
    <td><select class="admin-select" onchange="onSchedTermChange(${i}, this.value)">
      <option value="1" ${r.term===1?'selected':''}>Term 1</option>
      <option value="2" ${r.term===2?'selected':''}>Term 2</option>
      <option value="3" ${r.term===3?'selected':''}>Term 3</option>
      <option value="4" ${r.term===4?'selected':''}>Term 4</option>
    </select></td>
    <td><input class="admin-input" type="number" value="${escapeHtml(r.week_number||'')}" oninput="schedData[${i}].week_number=parseInt(this.value)||0" style="width:48px"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.week_commencing||'')}" placeholder="d/m/yyyy" oninput="schedData[${i}].week_commencing=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.content||'')}" oninput="schedData[${i}].content=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.homework||'')}" oninput="schedData[${i}].homework=this.value"></td>
    <td>${notesButtonHtml(i, r.notes)}</td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.vcaa_exam||'')}" oninput="schedData[${i}].vcaa_exam=this.value"></td>
    <td><input class="admin-input" type="url" value="${escapeHtml(r.youtube_link||'')}" placeholder="https://youtube.com/..." oninput="schedData[${i}].youtube_link=this.value"></td>
    <td>${r.id && !r._new ? `<button class="btn-files" onclick="toggleAdminFiles(${jsAttr(r.id)}, ${i})">📎 Files</button>` : '<span style="font-size:0.75rem;color:var(--dim)">Save first</span>'}</td>
    <td style="display:flex;gap:0.3rem;align-items:center;">
      ${publishBtn}
      <span class="drag-handle" draggable="true" ondragstart="onRowDragStart(event, ${i}, 'sched')" ondragend="onRowDragEnd(event)" title="Drag to reorder">⋮⋮</span>
      ${visibleIndex > 0 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveSchedRow(${i},-1)" title="Move up">▲</button>` : '<span style="width:1.8rem"></span>'}
      ${visibleIndex < visibleTotal - 1 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveSchedRow(${i},1)" title="Move down">▼</button>` : '<span style="width:1.8rem"></span>'}
      <button class="btn-delete" onclick="deleteSchedRow(${i})">✕</button>
    </td>`;

  // Append the file panel row right after (only for saved rows)
  if (r.id && !r._new) {
    const fileRow = document.createElement('tr');
    fileRow.className = 'admin-file-row';
    fileRow.id = `admin-file-row-${r.id}`;
    fileRow.innerHTML = `<td colspan="10"><div class="admin-file-panel" id="admin-file-panel-${r.id}"></div></td>`;
    tr._fileRow = fileRow;
  }

  return tr;
}

async function toggleAdminFiles(rowId, idx) {
  const fileRow   = document.getElementById(`admin-file-row-${rowId}`);
  const filePanel = document.getElementById(`admin-file-panel-${rowId}`);
  if (!fileRow) return;

  const isOpen = fileRow.classList.contains('open');
  if (isOpen) { fileRow.classList.remove('open'); return; }

  fileRow.classList.add('open');
  filePanel.innerHTML = '<span class="upload-status"><span class="spinner"></span> Loading…</span>';

  const files = await loadRowFiles(rowId);
  renderAdminFilePanel(filePanel, rowId, files);
}

function renderAdminFilePanel(panel, rowId, files) {
  panel.innerHTML = `
    <div class="admin-file-list" id="admin-chips-${rowId}">${renderAdminChips(rowId, files)}</div>
    <div class="admin-upload-area drop-zone" id="dropzone-${rowId}"
         ondragover="dropZoneOver(event)" ondragleave="dropZoneLeave(event)" ondrop="dropZoneDrop(event, ${jsAttr(rowId)})">
      <input type="file" id="admin-upload-input-${rowId}" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg">
      <button class="btn-upload" id="admin-upload-btn-${rowId}" onclick="adminUploadFiles(${jsAttr(rowId)})">Upload</button>
      <span class="drop-hint">or drop files here</span>
      <span class="upload-status" id="admin-upload-status-${rowId}"></span>
    </div>`;
}

function renderAdminChips(rowId, files) {
  return files.length
    ? files.map(f => `
        <div class="admin-file-chip">
          ${fileIcon(f.name)} ${escapeHtml(f.name)}
          <button onclick="adminDeleteFile(${jsAttr(rowId)}, ${jsAttr(f.name)}, this)" title="Delete">✕</button>
        </div>`).join('')
    : '<span class="upload-status" style="font-style:italic">No files yet.</span>';
}

async function uploadFilesToRow(rowId, files) {
  const btn    = document.getElementById(`admin-upload-btn-${rowId}`);
  const status = document.getElementById(`admin-upload-status-${rowId}`);
  const input  = document.getElementById(`admin-upload-input-${rowId}`);
  if (!files.length) { if (status) status.textContent = 'No files selected.'; return; }

  if (btn) btn.disabled = true;
  if (status) status.textContent = `Uploading ${files.length} file(s)…`;

  const results = await Promise.all(files.map(file =>
    sb.storage.from(STORAGE_BUCKET).upload(storagePath(rowId, file.name), file, { upsert: true })
  ));

  const failed = results.filter(r => r.error);
  if (status) {
    if (failed.length) {
      status.textContent = `${failed.length} upload(s) failed. Check console.`;
      failed.forEach(r => console.error(r.error));
    } else {
      status.textContent = '✓ Uploaded!';
      if (input) input.value = '';
    }
  }

  if (btn) btn.disabled = false;
  _fileCache.delete(rowId);
  const updatedFiles = await loadRowFiles(rowId, { force: true });
  const chipsEl = document.getElementById(`admin-chips-${rowId}`);
  if (chipsEl) chipsEl.innerHTML = renderAdminChips(rowId, updatedFiles);

  setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

async function adminUploadFiles(rowId) {
  const input = document.getElementById(`admin-upload-input-${rowId}`);
  await uploadFilesToRow(rowId, Array.from(input?.files || []));
}

async function adminDeleteFile(rowId, fileName, btn) {
  if (!confirm(`Delete "${fileName}"?`)) return;
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([storagePath(rowId, fileName)]);
  if (error) { alert('Delete failed: ' + error.message); return; }
  _fileCache.delete(rowId);
  btn.closest('.admin-file-chip').remove();
}

// ── ADMIN: ADD / DELETE SCHEDULE ROW ─────────────────────────────────

// Safe ID generator that works in all contexts (no crypto.randomUUID dependency)
function generateSchedTempId() {
  return 'sched-new-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
}

function addScheduleRow() {
  schedData.push({
    id: null,
    term: 2,
    week_number: schedData.filter(r => !r._deleted).length,
    week_commencing: '', content: '', homework: '', notes: '', vcaa_exam: '',
    youtube_link: '', sort_order: schedData.length, _new: true,
    published: false  // start as draft so admins can plan without it going live
  });
  // Make sure the user can see the row they just added.
  _adminSchedCollapsed.delete(2);
  redrawSchedTable();
}

function togglePublished(i) {
  schedData[i].published = schedData[i].published === false ? true : false;
  redrawSchedTable();
}

function onSchedTermChange(i, value) {
  schedData[i].term = parseInt(value);
  // Expand the destination term so the moved row stays visible.
  _adminSchedCollapsed.delete(schedData[i].term);
  redrawSchedTable();
}

function deleteSchedRow(i) {
  schedData[i]._deleted = true;
  redrawSchedTable();
}

function moveSchedRow(i, direction) {
  const visibleIndices = schedData.map((r, idx) => !r._deleted ? idx : null).filter(idx => idx !== null);
  const currentPos = visibleIndices.indexOf(i);

  if (direction === -1 && currentPos > 0) {
    const swapIdx = visibleIndices[currentPos - 1];
    [schedData[i], schedData[swapIdx]] = [schedData[swapIdx], schedData[i]];
    redrawSchedTable();
  } else if (direction === 1 && currentPos < visibleIndices.length - 1) {
    const swapIdx = visibleIndices[currentPos + 1];
    [schedData[i], schedData[swapIdx]] = [schedData[swapIdx], schedData[i]];
    redrawSchedTable();
  }
}

async function saveSchedule() {
  const statusEl = document.getElementById('sched-saved');
  const toDelete = schedData.filter(r => r._deleted && r.id);
  const toUpsert = schedData.filter(r => !r._deleted).map((r, i) => {
    // Only assign a UUID at save time, not before
    const id = r.id || (
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : generateSchedTempId()
    );
    return {
      id,
      term: r.term, week_number: r.week_number,
      week_commencing: r.week_commencing || null,
      content: r.content || null, homework: r.homework || null,
      notes: r.notes || null, vcaa_exam: r.vcaa_exam || null,
      youtube_link: r.youtube_link || null, sort_order: i,
      published: r.published !== false
    };
  });
  const ops = [];
  if (toDelete.length) ops.push(sb.from('schedule').delete().in('id', toDelete.map(r => r.id)));
  if (toUpsert.length) ops.push(sb.from('schedule').upsert(toUpsert));
  try {
    const results = await Promise.all(ops);
    const failed = results.find(r => r?.error);
    if (failed) throw failed.error;
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2500);
    await loadAdminData('schedule');
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}

// ── ADMIN: HOMEWORK ───────────────────────────────────────────────────
function renderAdminHomework(rows) {
  hwData = rows.map(r => ({...r}));
  redrawHwTable();
}

// Track which term groups the admin has collapsed in the homework editor.
const _adminHwCollapsed = new Set();

function redrawHwTable() {
  const tbody = document.getElementById('hw-tbody');
  const visible = hwData.filter(r => !r._deleted);
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1.5rem;font-style:italic;color:var(--dim)">No items yet. Click + Add Item.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  [1, 2, 3, 4].forEach(t => {
    const groupCount = hwData.filter(r => !r._deleted && r.term === t).length;
    if (!groupCount) return;
    const collapsed = _adminHwCollapsed.has(t);

    const headerTr = document.createElement('tr');
    headerTr.className = `admin-term-header t${t}${collapsed ? ' collapsed' : ''}`;
    headerTr.dataset.term = t;
    headerTr.innerHTML = `<td colspan="4" onclick="toggleAdminHwTerm(${t})">Term ${t}<span class="admin-term-count">${groupCount} ${groupCount === 1 ? 'item' : 'items'}</span></td>`;
    tbody.appendChild(headerTr);

    hwData.forEach((r, i) => {
      if (r._deleted || r.term !== t) return;
      const tr = makeHwRow(r, i);
      tr.classList.add('admin-term-row');
      tr.dataset.termRow = t;
      if (collapsed) tr.classList.add('collapsed');
      tbody.appendChild(tr);
    });
  });
}

function toggleAdminHwTerm(t) {
  const willCollapse = !_adminHwCollapsed.has(t);
  if (willCollapse) _adminHwCollapsed.add(t); else _adminHwCollapsed.delete(t);
  const tbody = document.getElementById('hw-tbody');
  tbody.querySelector(`.admin-term-header[data-term="${t}"]`)?.classList.toggle('collapsed', willCollapse);
  tbody.querySelectorAll(`tr[data-term-row="${t}"]`).forEach(r => r.classList.toggle('collapsed', willCollapse));
}

function makeHwRow(r, i) {
  const tr = document.createElement('tr');
  if (r._new) tr.classList.add('new-row');
  tr.ondragover = (e) => onRowDragOver(e, i, 'hw');
  tr.ondrop     = (e) => onRowDrop(e, i, 'hw');
  tr.ondragleave = (e) => onRowDragLeave(e);
  const visibleIndex = hwData.filter((row, idx) => !row._deleted && idx <= i).length - 1;
  const visibleTotal = hwData.filter(row => !row._deleted).length;
  tr.innerHTML = `
    <td><select class="admin-select" onchange="onHwTermChange(${i}, this.value)">
      <option value="1" ${r.term===1?'selected':''}>Term 1</option>
      <option value="2" ${r.term===2?'selected':''}>Term 2</option>
      <option value="3" ${r.term===3?'selected':''}>Term 3</option>
      <option value="4" ${r.term===4?'selected':''}>Term 4</option>
    </select></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.week_label||'')}" placeholder="T2 · Week 3" oninput="hwData[${i}].week_label=this.value"></td>
    <td><input class="admin-input" type="text" value="${escapeHtml(r.text||'')}" oninput="hwData[${i}].text=this.value"></td>
    <td style="display:flex;gap:0.3rem;align-items:center;">
      <span class="drag-handle" draggable="true" ondragstart="onRowDragStart(event, ${i}, 'hw')" ondragend="onRowDragEnd(event)" title="Drag to reorder">⋮⋮</span>
      ${visibleIndex > 0 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveHwRow(${i},-1)" title="Move up">▲</button>` : '<span style="width:1.8rem"></span>'}
      ${visibleIndex < visibleTotal - 1 ? `<button class="btn-delete" style="padding:0.2rem 0.4rem;color:var(--blue);" onclick="moveHwRow(${i},1)" title="Move down">▼</button>` : '<span style="width:1.8rem"></span>'}
      <button class="btn-delete" onclick="deleteHwRow(${i})">✕</button>
    </td>`;
  return tr;
}

function addHomeworkRow() {
  hwData.push({ id: null, term: 2, week_label: '', text: '', sort_order: hwData.length, _new: true });
  _adminHwCollapsed.delete(2);
  redrawHwTable();
}

function onHwTermChange(i, value) {
  hwData[i].term = parseInt(value);
  _adminHwCollapsed.delete(hwData[i].term);
  redrawHwTable();
}

function deleteHwRow(i) {
  hwData[i]._deleted = true;
  redrawHwTable();
}

function moveHwRow(i, direction) {
  const visibleIndices = hwData.map((r, idx) => !r._deleted ? idx : null).filter(idx => idx !== null);
  const currentPos = visibleIndices.indexOf(i);

  if (direction === -1 && currentPos > 0) {
    const swapIdx = visibleIndices[currentPos - 1];
    [hwData[i], hwData[swapIdx]] = [hwData[swapIdx], hwData[i]];
    redrawHwTable();
  } else if (direction === 1 && currentPos < visibleIndices.length - 1) {
    const swapIdx = visibleIndices[currentPos + 1];
    [hwData[i], hwData[swapIdx]] = [hwData[swapIdx], hwData[i]];
    redrawHwTable();
  }
}

async function saveHomework() {
  const statusEl = document.getElementById('hw-saved');
  const toDelete  = hwData.filter(r => r._deleted && r.id && !r._new);
  const toInsert  = hwData.filter(r => !r._deleted && r._new).map((r, i) => ({
    id: generateHomeworkId(),
    term: r.term, week_label: r.week_label || null, text: r.text || '', sort_order: i
  }));
  const toUpdate  = hwData.filter(r => !r._deleted && !r._new && r.id).map((r, i) => ({
    id: r.id, term: r.term, week_label: r.week_label || null, text: r.text || '', sort_order: i
  }));
  try {
    if (toDelete.length) {
      const { error } = await sb.from('homework_items').delete().in('id', toDelete.map(r=>r.id));
      if (error) throw error;
    }
    if (toInsert.length) {
      const { error } = await sb.from('homework_items').insert(toInsert);
      if (error) throw error;
    }
    if (toUpdate.length) {
      const { error } = await sb.from('homework_items').upsert(toUpdate);
      if (error) throw error;
    }
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2500);
    await loadAdminData('homework');
  } catch (err) {
    console.error(err);
    alert('Save failed: ' + (err?.message || err));
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────
function generateHomeworkId() {
  const existingIds = hwData.map(r => r.id).filter(id => id && id.startsWith('hw')).map(id => parseInt(id.replace('hw', '')) || 0);
  const maxNum = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  return 'hw' + (maxNum + 1);
}

function showMsg(el, text, type) { el.textContent = text; el.className = 'msg ' + type; }

// ── NOTES EDITOR ──────────────────────────────────────────────────────
let notesEditingIdx = null;

function notesButtonHtml(i, notes) {
  if (notes && notes.trim()) {
    const trimmed = notes.replace(/\s+/g, ' ').trim();
    const snippet = trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    return `<button type="button" class="btn-notes-edit" onclick="openNotesEditor(${i})" title="Click to edit notes"><span class="notes-snippet">${escapeHtml(snippet)}</span></button>`;
  }
  return `<button type="button" class="btn-notes-edit" onclick="openNotesEditor(${i})"><span class="notes-empty">+ Add notes</span></button>`;
}

function openNotesEditor(idx) {
  notesEditingIdx = idx;
  const ta = document.getElementById('notes-editor');
  ta.value = schedData[idx]?.notes || '';
  updateNotesPreview();
  document.getElementById('notes-modal').classList.add('open');
  setTimeout(() => ta.focus(), 50);
}

function closeNotesEditor() {
  document.getElementById('notes-modal').classList.remove('open');
  notesEditingIdx = null;
}

function notesModalBackdrop(e) {
  if (e.target.id === 'notes-modal') closeNotesEditor();
}

function saveNotesEditor() {
  if (notesEditingIdx == null) return;
  schedData[notesEditingIdx].notes = document.getElementById('notes-editor').value;
  closeNotesEditor();
  redrawSchedTable();
}

function updateNotesPreview() {
  const text = document.getElementById('notes-editor').value;
  const out = formatNotes(text);
  document.getElementById('notes-preview').innerHTML = out || '<span class="preview-empty">Preview will appear here…</span>';
}

function notesFmt(type) {
  const ta = document.getElementById('notes-editor');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const sel = text.slice(start, end);

  if (type === 'link') {
    const url = prompt('Link URL:', 'https://');
    if (!url) return;
    const label = sel || prompt('Link text:', 'click here') || 'link';
    const inserted = `[${label}](${url})`;
    ta.value = text.slice(0, start) + inserted + text.slice(end);
    const pos = start + inserted.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    updateNotesPreview();
    return;
  }
  if (type === 'image') {
    const url = prompt('Image URL (must be a public link):', 'https://');
    if (!url) return;
    const alt = prompt('Alt text (optional):', '') || '';
    const inserted = `![${alt}](${url})`;
    ta.value = text.slice(0, start) + inserted + text.slice(end);
    const pos = start + inserted.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    updateNotesPreview();
    return;
  }

  let before = '', after = '', placeholder = '';
  if      (type === 'bold')      { before = '**'; after = '**'; placeholder = 'bold text'; }
  else if (type === 'italic')    { before = '*';  after = '*';  placeholder = 'italic text'; }
  else if (type === 'underline') { before = '__'; after = '__'; placeholder = 'underlined text'; }
  else return;

  const inner = sel || placeholder;
  ta.value = text.slice(0, start) + before + inner + after + text.slice(end);
  ta.focus();
  ta.setSelectionRange(start + before.length, start + before.length + inner.length);
  updateNotesPreview();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('notes-modal')?.classList.contains('open')) {
    closeNotesEditor();
  }
});

// ── THEME ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', 'light'); } catch(e) {}
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', 'dark'); } catch(e) {}
  }
}

// ── DRAG-AND-DROP: ROW REORDER ────────────────────────────────────────
let _dragSrcIdx = null;
let _dragKind = null;  // 'sched' | 'hw'

function onRowDragStart(e, idx, kind) {
  _dragSrcIdx = idx;
  _dragKind = kind;
  e.dataTransfer.effectAllowed = 'move';
  // setData is required by Firefox to actually start the drag
  try { e.dataTransfer.setData('text/plain', String(idx)); } catch(_) {}
  const tr = e.currentTarget.closest('tr');
  if (tr) tr.classList.add('dragging');
}

function onRowDragOver(e, idx, kind) {
  if (_dragKind !== kind || _dragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (idx === _dragSrcIdx) return;
  const tbody = e.currentTarget.parentNode;
  if (!tbody) return;
  tbody.querySelectorAll('tr.drop-target').forEach(el => el.classList.remove('drop-target'));
  e.currentTarget.classList.add('drop-target');
}

function onRowDragLeave(e) {
  // Only clear if we're actually leaving the row (not entering a child)
  if (e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drop-target');
}

function onRowDrop(e, idx, kind) {
  e.preventDefault();
  const srcIdx = _dragSrcIdx;
  const srcKind = _dragKind;
  cleanupDragState();
  if (srcKind !== kind || srcIdx === null || srcIdx === idx) return;
  const arr = kind === 'sched' ? schedData : hwData;
  if (srcIdx < 0 || srcIdx >= arr.length || idx < 0 || idx >= arr.length) return;
  const [moved] = arr.splice(srcIdx, 1);
  const insertAt = srcIdx < idx ? idx - 1 : idx;
  arr.splice(insertAt, 0, moved);
  if (kind === 'sched') redrawSchedTable();
  else redrawHwTable();
}

function onRowDragEnd(e) {
  cleanupDragState();
}

function cleanupDragState() {
  document.querySelectorAll('tr.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('tr.drop-target').forEach(el => el.classList.remove('drop-target'));
  _dragSrcIdx = null;
  _dragKind = null;
}

// ── DRAG-AND-DROP: FILE UPLOAD ────────────────────────────────────────
function dropZoneOver(e) {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function dropZoneLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
}
async function dropZoneDrop(e, rowId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  await uploadFilesToRow(rowId, files);
}

// Prevent the browser from navigating away when files are dropped outside a drop zone
window.addEventListener('dragover', e => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
});
window.addEventListener('drop', e => {
  if (!e.target.closest?.('.drop-zone')) {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
  }
});

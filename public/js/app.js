/* BXH Cầu lông — SPA vanilla JS (hash router) */
'use strict';

const $app = document.getElementById('app');

/* ================= Đăng nhập ================= */
// AUTH.required = server có bật mật khẩu không; AUTH.logged_in = token hợp lệ.
// Guest (required && !logged_in) chỉ được XEM: BXH, VĐV, lịch sử đấu.
const AUTH = { required: false, logged_in: true };
const canEdit = () => !AUTH.required || AUTH.logged_in;

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem('auth_token');
  if (t) h['X-Auth-Token'] = t;
  return h;
}

/** Hỏi server trạng thái đăng nhập (token trong localStorage còn hợp lệ không). */
async function loadAuth() {
  try {
    const res = await fetch('/api/auth', { headers: authHeaders() });
    Object.assign(AUTH, await res.json());
  } catch {
    // Không hỏi được server → cứ để mặc định, các API sau sẽ tự báo lỗi
  }
  updateNavAuth();
}

/** Ẩn/hiện các mục nav theo quyền: .need-auth chỉ khi được ghi, .guest-only khi là Guest. */
function updateNavAuth() {
  document.querySelectorAll('.need-auth').forEach((el) => { el.hidden = !canEdit(); });
  document.querySelectorAll('.guest-only').forEach((el) => { el.hidden = canEdit(); });
}

function logout() {
  localStorage.removeItem('auth_token');
  AUTH.logged_in = false;
  updateNavAuth();
  toast('Đã đăng xuất');
  location.hash = '#/';
  if (location.hash === '#/') router(); // hash không đổi thì tự render lại
}

/* ================= API helper ================= */
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      // Token hết hiệu lực (vd đổi mật khẩu) → về trang đăng nhập
      localStorage.removeItem('auth_token');
      AUTH.logged_in = false;
      updateNavAuth();
      location.hash = '#/login';
    }
    throw new Error(data?.error || `Lỗi ${res.status}`);
  }
  return data;
}

/* ================= Utils ================= */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}
const rnd = (x) => Math.round(x); // ELO lưu float, hiển thị làm tròn
function fmtDelta(d) {
  if (d == null) return '';
  const v = rnd(d);
  const cls = v >= 0 ? 'pos' : 'neg';
  return `<span class="delta ${cls}">${v >= 0 ? '+' : ''}${v}</span>`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function avatar(p, lg = false) {
  const cls = 'avatar' + (lg ? ' lg' : '');
  if (p.avatar_url) {
    // Fallback khi ảnh lỗi: HTML thay thế để trong data-fb (esc() làm sạch
    // toàn bộ nháy/ngoặc nên an toàn khi nằm trong attribute)
    return `<img class="${cls}" src="${esc(p.avatar_url)}" alt=""
      data-fb="${esc(avatarInitial(p, lg))}" onerror="this.outerHTML=this.dataset.fb">`;
  }
  return avatarInitial(p, lg);
}
function avatarInitial(p, lg) {
  const initial = (p.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar${lg ? ' lg' : ''}">${esc(initial)}</span>`;
}
const pct = (r) => (r == null ? '–' : Math.round(r * 100) + '%');

/* ================= Router ================= */
const routes = [
  { re: /^#?\/?$/, view: viewLeaderboard, nav: 'home' },
  { re: /^#\/new$/, view: () => viewMatchForm(null), nav: 'new' },
  { re: /^#\/edit\/(\d+)$/, view: (m) => viewMatchForm(Number(m[1])), nav: 'matches' },
  { re: /^#\/arena$/, view: viewArena, nav: 'arena' },
  { re: /^#\/arena\/new$/, view: () => viewScheduleForm(null), nav: 'arena' },
  { re: /^#\/arena\/edit\/(\d+)$/, view: (m) => viewScheduleForm(Number(m[1])), nav: 'arena' },
  { re: /^#\/players$/, view: viewPlayers, nav: 'players' },
  { re: /^#\/player\/(\d+)$/, view: (m) => viewPlayerDetail(Number(m[1])), nav: 'players' },
  { re: /^#\/matches$/, view: viewMatches, nav: 'matches' },
  { re: /^#\/settings$/, view: viewSettings, nav: 'settings' },
  { re: /^#\/login$/, view: viewLogin, nav: 'login' },
  { re: /^#\/counter$/, view: viewCounter, nav: 'new' },
];

/* Giữ màn hình luôn sáng khi đang dùng bộ đếm điểm (Wake Lock API).
   Trình duyệt không hỗ trợ thì bỏ qua trong im lặng. */
let _wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !_wakeLock) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    } else if (!on && _wakeLock) {
      await _wakeLock.release();
      _wakeLock = null;
    }
  } catch { /* không hỗ trợ / bị từ chối — không sao */ }
}
document.addEventListener('visibilitychange', () => {
  // Màn hình bật lại (mở khoá điện thoại) → xin giữ sáng tiếp nếu vẫn ở bộ đếm
  if (document.visibilityState === 'visible' && location.hash === '#/counter') keepAwake(true);
});

async function router() {
  const hash = location.hash || '#/';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      document.querySelectorAll('[data-nav]').forEach((a) =>
        a.classList.toggle('active', a.dataset.nav === r.nav)
      );
      keepAwake(hash === '#/counter'); // rời bộ đếm thì thả wake lock
      $app.onclick = null; // reset handler của view trước
      $app.innerHTML = '<p class="muted">Đang tải…</p>';
      try {
        await r.view(m);
      } catch (e) {
        $app.innerHTML = `<div class="card"><b>Lỗi:</b> ${esc(e.message)}</div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  $app.innerHTML = '<div class="empty">Không tìm thấy trang</div>';
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  await loadAuth(); // biết quyền trước khi render trang đầu tiên
  router();
});

/* ================= 1. Bảng xếp hạng ================= */
async function viewLeaderboard() {
  const players = await api('GET', '/players');
  const ranked = players.filter((p) => p.matches_played > 0);
  const unranked = players.filter((p) => p.matches_played === 0);

  let html = '<h1>🏆 Bảng xếp hạng</h1>';
  if (players.length === 0) {
    html += `<div class="empty">Chưa có VĐV nào.<br><br><a class="btn" href="#/players">＋ Thêm VĐV</a></div>`;
  } else if (ranked.length === 0) {
    html += `<div class="empty">Chưa có trận đấu nào được ghi nhận.<br><br><a class="btn" href="#/new">＋ Ghi trận đầu tiên</a></div>`;
  }
  html += ranked
    .map((p, i) => {
      const rank = i + 1;
      const medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
      return `
      <a class="lb-row" href="#/player/${p.id}">
        <span class="lb-rank top${rank}">${medal}</span>
        ${avatar(p)}
        <span class="lb-main">
          <span class="lb-name">${esc(p.name)}</span>
          <span class="lb-sub">${p.matches_played} trận · ${p.wins} thắng · ${p.losses} thua</span>
        </span>
        <span class="lb-elo">${rnd(p.elo)}<span class="wr">${pct(p.win_rate)} thắng</span></span>
      </a>`;
    })
    .join('');

  if (unranked.length > 0) {
    html += `<h2 class="muted">Chưa xếp hạng (chưa đấu trận nào)</h2>`;
    html += unranked
      .map(
        (p) => `
      <a class="lb-row" href="#/player/${p.id}">
        <span class="lb-rank">–</span>
        ${avatar(p)}
        <span class="lb-main"><span class="lb-name">${esc(p.name)}</span>
          <span class="lb-sub">ELO khởi điểm</span></span>
        <span class="lb-elo">${rnd(p.elo)}</span>
      </a>`
      )
      .join('');
  }
  $app.innerHTML = html;
}

/* ================= 2. Form ghi / sửa trận đấu ================= */
// Scoreboard: chuỗi lưu DB "21-15, 18-21" <-> mảng ván [{a:21,b:15},...]
function parseScore(str) {
  if (!str) return [];
  return str.split(',').map((part) => {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    return m ? { a: m[1], b: m[2] } : { a: '', b: '' };
  });
}
function buildScore(sets) {
  const done = sets.filter((s) => s.a !== '' && s.b !== '');
  return done.length ? done.map((s) => `${Number(s.a)}-${Number(s.b)}`).join(', ') : '';
}

async function viewMatchForm(editId) {
  if (!canEdit()) { location.hash = '#/login'; return; }
  const players = await api('GET', '/players');
  if (players.length < 2) {
    $app.innerHTML = `<h1>➕ Ghi nhận trận đấu</h1>
      <div class="empty">Cần ít nhất 2 VĐV để ghi trận đấu.<br>Hiện có ${players.length}.<br><br>
      <a class="btn" href="#/players">＋ Thêm VĐV</a></div>`;
    return;
  }

  let match = null;
  if (editId) match = await api('GET', '/matches/' + editId);

  let scheduleDraft = null;
  if (!editId) {
    try { scheduleDraft = JSON.parse(sessionStorage.getItem('schedule_match_draft') || 'null'); } catch {}
    sessionStorage.removeItem('schedule_match_draft');
  }
  let scheduleId = Number(scheduleDraft?.id) || null;

  const state = {
    match_type: match?.match_type || scheduleDraft?.match_type || 'doubles',
    rated: match ? Number(match.rated) !== 0 : scheduleDraft ? Number(scheduleDraft.rated) !== 0 : true,
    a1: match?.a1 || scheduleDraft?.a1 || '', a2: match?.a2 || scheduleDraft?.a2 || '',
    b1: match?.b1 || scheduleDraft?.b1 || '', b2: match?.b2 || scheduleDraft?.b2 || '',
    winner: match?.winner || '',
    // Scoreboard: tối thiểu 1 ván, tối đa 3 (cầu lông đánh best-of-3)
    sets: (() => {
      const s = parseScore(match?.score);
      return s.length ? s : [{ a: '', b: '' }];
    })(),
  };

  // Khôi phục NHÁP của form (đã lưu khi mở Bộ đếm) — giữ nguyên 4 VĐV,
  // đội thắng, ngày giờ, các ván khi đi sang bộ đếm rồi quay lại
  let draftDate = scheduleDraft?.scheduled_at?.slice(0, 16) || null;
  try {
    const draft = JSON.parse(sessionStorage.getItem('match_draft') || 'null');
    if (draft && (draft.editId || null) === (editId || null)) {
      state.match_type = draft.match_type || state.match_type;
      state.rated = draft.rated !== false;
      scheduleId = Number(draft.schedule_id) || scheduleId;
      state.a1 = draft.a1; state.a2 = draft.a2;
      state.b1 = draft.b1; state.b2 = draft.b2;
      state.winner = draft.winner || '';
      if (draft.sets?.length) state.sets = draft.sets;
      draftDate = draft.date || null;
    }
  } catch {}
  sessionStorage.removeItem('match_draft'); // dùng 1 lần

  // Điểm chuyển sang từ Bộ đếm (#/counter) → thay toàn bộ các ván
  let fromCounter = false;
  try {
    const cs = JSON.parse(localStorage.getItem('counter_sets') || 'null');
    if (cs?.sets?.length && Date.now() - cs.t < 2 * 3600 * 1000) {
      state.sets = cs.sets.slice(0, 3).map((s) => ({ a: String(s.a), b: String(s.b) }));
      fromCounter = true;
    }
  } catch {}
  localStorage.removeItem('counter_sets'); // dùng 1 lần

  const slotLabels = { a1: 'VĐV', a2: 'VĐV 2', b1: 'VĐV', b2: 'VĐV 2' };
  const playerOptions = (slot) => {
    const activeSlots = state.match_type === 'singles' ? ['a1', 'b1'] : ['a1', 'a2', 'b1', 'b2'];
    const takenElsewhere = activeSlots
      .filter((s) => s !== slot)
      .map((s) => Number(state[s]))
      .filter(Boolean);
    return (
      `<option value="">— Chọn ${slotLabels[slot]} —</option>` +
      players
        .filter((p) => !takenElsewhere.includes(p.id))
        .map(
          (p) =>
            `<option value="${p.id}" ${Number(state[slot]) === p.id ? 'selected' : ''}>${esc(p.name)} (${rnd(p.elo)})</option>`
        )
        .join('')
    );
  };

  // datetime-local cần "YYYY-MM-DDTHH:mm"; nháp (nếu có) được ưu tiên
  const dateVal = draftDate || (match?.date ? match.date.slice(0, 16) : nowLocalInput());

  $app.innerHTML = `
    <h1>${editId ? '✏️ Sửa trận đấu' : '➕ Ghi nhận trận đấu'}</h1>
    <form id="matchForm" class="card">
      <label class="field">Loại trận đấu
        <select id="matchType">
          <option value="doubles" ${state.match_type === 'doubles' ? 'selected' : ''}>Đánh đôi (2 vs 2)</option>
          <option value="singles" ${state.match_type === 'singles' ? 'selected' : ''}>Đánh đơn (1 vs 1)</option>
        </select>
      </label>
      <label class="elo-check">
        <input type="checkbox" id="matchRated" ${state.rated ? 'checked' : ''}>
        <span class="elo-check-box">✓</span>
        <span><b>Tính ELO cho trận này</b><small>Bỏ tích để chỉ lưu kết quả, ELO không thay đổi</small></span>
      </label>
      <div class="team-box" id="boxA">
        <h3 id="titleA">Đội A <span class="win-badge" hidden>THẮNG</span></h3>
        <label class="field"><select id="sel-a1">${playerOptions('a1')}</select></label>
        <label class="field doubles-slot"><select id="sel-a2">${playerOptions('a2')}</select></label>
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-box" id="boxB">
        <h3 id="titleB">Đội B <span class="win-badge" hidden>THẮNG</span></h3>
        <label class="field"><select id="sel-b1">${playerOptions('b1')}</select></label>
        <label class="field doubles-slot"><select id="sel-b2">${playerOptions('b2')}</select></label>
      </div>

      <p style="margin:0 0 6px;font-weight:600;font-size:.9rem">Đội thắng <span class="req">*</span></p>
      <div class="winner-toggle">
        <button type="button" id="winA">Đội A thắng</button>
        <button type="button" id="winB">Đội B thắng</button>
      </div>

      <p style="margin:0 0 6px;font-weight:600;font-size:.9rem;display:flex;justify-content:space-between;align-items:center">
        Tỷ số từng ván (tuỳ chọn)
        <a class="btn sm secondary" href="#/counter" id="openCounter"
          title="Bộ đếm điểm fullscreen dùng tại sân">🔢 Bộ đếm điểm</a>
      </p>
      <div class="scoreboard" id="scoreboard"></div>

      <label class="field">Ngày giờ thi đấu
        <input type="datetime-local" id="date" value="${dateVal}">
      </label>
      <button class="btn block" type="submit">${editId ? '💾 Lưu thay đổi' : '✔ Ghi nhận trận đấu'}</button>
    </form>`;

  // Chọn VĐV: cập nhật state + render lại option các slot khác (loại người đã chọn)
  for (const slot of ['a1', 'a2', 'b1', 'b2']) {
    const sel = document.getElementById('sel-' + slot);
    sel.addEventListener('change', () => {
      state[slot] = sel.value;
      for (const other of ['a1', 'a2', 'b1', 'b2']) {
        if (other !== slot) {
          document.getElementById('sel-' + other).innerHTML = playerOptions(other);
        }
      }
    });
  }

  const updateMatchType = () => {
    const singles = state.match_type === 'singles';
    document.querySelectorAll('.doubles-slot').forEach((el) => { el.hidden = singles; });
    document.getElementById('titleA').firstChild.textContent = singles ? 'Người chơi A ' : 'Đội A ';
    document.getElementById('titleB').firstChild.textContent = singles ? 'Người chơi B ' : 'Đội B ';
    for (const slot of ['a1', 'a2', 'b1', 'b2']) {
      document.getElementById('sel-' + slot).innerHTML = playerOptions(slot);
    }
  };
  document.getElementById('matchType').addEventListener('change', (e) => {
    state.match_type = e.target.value;
    updateMatchType();
  });
  updateMatchType();

  const winA = document.getElementById('winA');
  const winB = document.getElementById('winB');
  function setWinner(w) {
    state.winner = w;
    winA.classList.toggle('selected', w === 'A');
    winB.classList.toggle('selected', w === 'B');
    document.getElementById('boxA').classList.toggle('winner', w === 'A');
    document.getElementById('boxB').classList.toggle('winner', w === 'B');
    document.querySelector('#boxA .win-badge').hidden = w !== 'A';
    document.querySelector('#boxB .win-badge').hidden = w !== 'B';
  }
  winA.addEventListener('click', () => setWinner('A'));
  winB.addEventListener('click', () => setWinner('B'));
  if (state.winner) setWinner(state.winner);

  // ---------- Scoreboard: nhập điểm từng ván ----------
  // Đếm ván thắng của mỗi đội (chỉ tính ván đã nhập đủ 2 ô và không hoà)
  const setsWon = () => {
    let a = 0, b = 0;
    for (const s of state.sets) {
      if (s.a === '' || s.b === '') continue;
      const na = Number(s.a), nb = Number(s.b);
      if (na > nb) a++;
      else if (nb > na) b++;
    }
    return { a, b };
  };

  // Nhập điểm xong → tự chọn đội thắng theo số ván (vẫn bấm tay đè được).
  // userTyped=false (lúc mở form sửa): chỉ cập nhật summary, KHÔNG đè
  // đội thắng đã lưu trong DB.
  const onScoreChange = (userTyped = true) => {
    const w = setsWon();
    if (userTyped && w.a !== w.b) setWinner(w.a > w.b ? 'A' : 'B');
    const sum = document.getElementById('setSum');
    if (sum) {
      sum.textContent = w.a + w.b > 0 ? `Ván: Đội A ${w.a} – ${w.b} Đội B` : '';
    }
  };

  function renderScoreboard() {
    const sb = document.getElementById('scoreboard');
    sb.innerHTML =
      state.sets
        .map(
          (s, i) => `
      <div class="set-row" data-i="${i}">
        <span class="set-label">Ván ${i + 1}</span>
        <input type="number" min="0" max="99" inputmode="numeric" class="set-a"
          value="${esc(s.a)}" placeholder="21" aria-label="Điểm đội A ván ${i + 1}">
        <span class="set-dash">–</span>
        <input type="number" min="0" max="99" inputmode="numeric" class="set-b"
          value="${esc(s.b)}" placeholder="15" aria-label="Điểm đội B ván ${i + 1}">
        <button type="button" class="set-del" title="Xoá ván ${i + 1}"
          ${state.sets.length <= 1 ? 'disabled' : ''}>✕</button>
      </div>`
        )
        .join('') +
      `<div class="set-foot">
        ${state.sets.length < 3 ? '<button type="button" class="btn sm secondary" id="addSet">＋ Thêm ván</button>' : ''}
        <span class="muted" id="setSum"></span>
      </div>`;

    sb.querySelectorAll('.set-row').forEach((row) => {
      const i = Number(row.dataset.i);
      // Gõ điểm chỉ cập nhật state + summary (không re-render để không mất focus)
      row.querySelector('.set-a').addEventListener('input', (e) => {
        state.sets[i].a = e.target.value;
        onScoreChange();
      });
      row.querySelector('.set-b').addEventListener('input', (e) => {
        state.sets[i].b = e.target.value;
        onScoreChange();
      });
      row.querySelector('.set-del').addEventListener('click', () => {
        state.sets.splice(i, 1);
        renderScoreboard();
        onScoreChange();
      });
    });
    const add = sb.querySelector('#addSet');
    if (add) {
      add.addEventListener('click', () => {
        state.sets.push({ a: '', b: '' });
        renderScoreboard();
        sb.querySelector(`.set-row[data-i="${state.sets.length - 1}"] .set-a`).focus();
      });
    }
    onScoreChange(false); // render lại chỉ cập nhật summary
  }
  renderScoreboard();
  if (fromCounter) {
    onScoreChange(true); // điểm từ bộ đếm → tự chọn luôn đội thắng theo ván
    toast('Đã cập nhật tỷ số từ bộ đếm');
  }

  // Mở Bộ đếm → lưu nháp toàn bộ form trước để quay lại không mất gì
  document.getElementById('openCounter').addEventListener('click', () => {
    sessionStorage.setItem('match_draft', JSON.stringify({
      editId: editId || null,
      schedule_id: scheduleId,
      match_type: state.match_type,
      rated: document.getElementById('matchRated').checked,
      a1: state.a1, a2: state.a2, b1: state.b1, b2: state.b2,
      winner: state.winner,
      sets: state.sets,
      date: document.getElementById('date').value,
    }));
  });

  document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Ván nhập dở (mới có điểm 1 bên) → bắt nhập nốt thay vì lặng lẽ bỏ qua
    const incomplete = state.sets.findIndex((s) => (s.a === '') !== (s.b === ''));
    if (incomplete >= 0) return toast(`Ván ${incomplete + 1} nhập thiếu điểm một đội`, true);

    const payload = {
      match_type: state.match_type,
      rated: document.getElementById('matchRated').checked,
      a1: Number(state.a1), a2: Number(state.a2),
      b1: Number(state.b1), b2: Number(state.b2),
      winner: state.winner,
      score: buildScore(state.sets),
      date: document.getElementById('date').value,
    };
    if (!payload.a1 || !payload.b1 || (payload.match_type === 'doubles' && (!payload.a2 || !payload.b2)))
      return toast(`Hãy chọn đủ ${payload.match_type === 'singles' ? 2 : 4} VĐV`, true);
    if (!payload.winner) return toast('Hãy chọn đội thắng', true);

    // Cảnh báo nếu đội thắng chọn ngược với tỷ số các ván
    const w = setsWon();
    if (w.a !== w.b && (w.a > w.b ? 'A' : 'B') !== payload.winner) {
      if (!confirm('Đội thắng đang chọn NGƯỢC với tỷ số các ván. Vẫn lưu chứ?')) return;
    }
    try {
      if (editId) {
        await api('PUT', '/matches/' + editId, payload);
        toast('Đã cập nhật trận đấu, ELO đã được tính lại');
        location.hash = '#/matches';
      } else {
        const r = await api('POST', '/matches', payload);
        if (scheduleId) await api('PUT', `/schedule/${scheduleId}/complete`, { match_id: r.id });
        const winDelta = r.deltas.find((d) => d.delta >= 0);
        toast(payload.rated
          ? `Đã ghi nhận! Đội thắng ${winDelta ? '+' + rnd(winDelta.delta) : ''} điểm ELO`
          : 'Đã ghi nhận trận giao hữu — ELO không thay đổi');
        location.hash = scheduleId ? '#/arena' : '#/';
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ================= 3. Quản lý VĐV ================= */
/**
 * Đọc file ảnh người dùng chọn → crop vuông giữa ảnh → resize 256×256
 * → nén JPEG (~10-20KB) → trả về data-URL. Ảnh lưu thẳng vào DB dưới dạng
 * text nên không cần dịch vụ lưu file — sống sót qua mọi lần redeploy.
 */
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('File không phải ảnh'));
    const draw = (img, w, h) => {
      const S = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = S;
      const side = Math.min(w, h); // crop vuông chính giữa
      canvas.getContext('2d').drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
      return canvas.toDataURL('image/jpeg', 0.85);
    };
    // createImageBitmap tự xoay ảnh theo EXIF (ảnh chụp dọc từ điện thoại)
    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then((bmp) => resolve(draw(bmp, bmp.width, bmp.height)))
        .catch(reject);
    } else {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(draw(img, img.width, img.height)); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
      img.src = url;
    }
  });
}

async function viewPlayers() {
  const players = await api('GET', '/players');
  // State của form (dùng chung cho Thêm mới và Sửa)
  let avatarData = null; // data-URL hoặc http URL hiện tại, null = không có ảnh
  let editingId = null;  // null = đang ở chế độ thêm mới

  $app.innerHTML = `
    <h1>👥 ${canEdit() ? 'Quản lý VĐV' : 'Danh sách VĐV'}</h1>
    ${canEdit() ? `
    <div class="card">
      <h2 id="pf-title" style="margin-top:0">Thêm VĐV mới</h2>
      <form id="pf">
        <label class="field">Tên VĐV <span class="req">*</span>
          <input type="text" id="pf-name" placeholder="Nguyễn Văn A" required>
        </label>
        <div class="field">Ảnh đại diện (tuỳ chọn)
          <div class="avatar-pick">
            <span id="pf-preview"><span class="avatar lg">?</span></span>
            <label class="btn sm secondary" for="pf-file">📷 Chọn ảnh</label>
            <input type="file" id="pf-file" accept="image/*" hidden>
            <button type="button" class="btn sm danger" id="pf-clearimg" hidden>Xoá ảnh</button>
          </div>
        </div>
        <label class="field">Ghi chú (tuỳ chọn)
          <input type="text" id="pf-note" placeholder="VD: tay vợt chủ lực">
        </label>
        <div style="display:flex;gap:8px">
          <button class="btn" type="submit" id="pf-submit" style="flex:1">＋ Thêm VĐV</button>
          <button class="btn secondary" type="button" id="pf-cancel" hidden>Huỷ</button>
        </div>
      </form>
    </div>` : ''}
    <div class="card" id="playerList">
      ${players.length === 0 ? '<div class="empty">Chưa có VĐV nào</div>' : ''}
      ${players
        .map(
          (p) => `
        <div class="p-row" data-id="${p.id}">
          ${avatar(p)}
          <a class="info" href="#/player/${p.id}">
            <div class="nm">${esc(p.name)} <span class="muted">· ELO ${rnd(p.elo)}</span></div>
            <div class="nt">${p.matches_played} trận${p.note ? ' · ' + esc(p.note) : ''}</div>
          </a>
          ${canEdit() ? `
          <button class="btn sm secondary" data-act="edit">Sửa</button>
          <button class="btn sm danger" data-act="del">Xoá</button>` : ''}
        </div>`
        )
        .join('')}
    </div>`;

  if (!canEdit()) return; // Guest: chỉ xem danh sách, không gắn handler ghi

  const $ = (id) => document.getElementById(id);
  const renderPreview = (name) => {
    $('pf-preview').innerHTML = avatarData
      ? `<img class="avatar lg" src="${esc(avatarData)}" alt="">`
      : avatarInitial({ name: name || '?' }, true);
    $('pf-clearimg').hidden = !avatarData;
  };
  const resetForm = () => {
    editingId = null;
    avatarData = null;
    $('pf').reset();
    $('pf-title').textContent = 'Thêm VĐV mới';
    $('pf-submit').textContent = '＋ Thêm VĐV';
    $('pf-cancel').hidden = true;
    renderPreview();
  };

  $('pf-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      avatarData = await fileToAvatar(file);
      renderPreview($('pf-name').value);
    } catch (err) {
      toast(err.message || 'Không đọc được ảnh', true);
    }
    e.target.value = ''; // cho phép chọn lại cùng 1 file
  });
  $('pf-clearimg').addEventListener('click', () => {
    avatarData = null;
    renderPreview($('pf-name').value);
  });
  $('pf-cancel').addEventListener('click', resetForm);

  $('pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: $('pf-name').value,
      note: $('pf-note').value,
      avatar_url: avatarData || '',
    };
    try {
      if (editingId) {
        await api('PUT', '/players/' + editingId, body);
        toast('Đã cập nhật VĐV');
      } else {
        await api('POST', '/players', body);
        toast('Đã thêm VĐV');
      }
      viewPlayers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('playerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.p-row').dataset.id);
    const p = players.find((x) => x.id === id);
    if (btn.dataset.act === 'del') {
      if (!confirm(`Xoá VĐV "${p.name}"?`)) return;
      try {
        await api('DELETE', '/players/' + id);
        toast('Đã xoá VĐV');
        viewPlayers();
      } catch (err) {
        toast(err.message, true);
      }
    } else if (btn.dataset.act === 'edit') {
      // Đưa dữ liệu VĐV vào form phía trên để sửa (kể cả đổi/xoá ảnh)
      editingId = id;
      avatarData = p.avatar_url || null;
      $('pf-name').value = p.name;
      $('pf-note').value = p.note || '';
      $('pf-title').textContent = 'Sửa VĐV: ' + p.name;
      $('pf-submit').textContent = '💾 Lưu thay đổi';
      $('pf-cancel').hidden = false;
      renderPreview(p.name);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/* ================= 4. Đấu trường — lịch thi đấu ================= */
function arenaCountdown(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff)) return '';
  if (diff <= 0) return 'ĐÃ TỚI GIỜ';
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `CÒN ${days} NGÀY ${hours % 24} GIỜ`;
  const minutes = Math.max(1, Math.floor(diff / 60000));
  return hours > 0 ? `CÒN ${hours} GIỜ ${minutes % 60} PHÚT` : `CÒN ${minutes} PHÚT`;
}

function arenaCard(m) {
  const side = (letter) => {
    const fighters = letter === 'A'
      ? [
          { name: m.a1_name, avatar_url: m.a1_avatar_url, elo: m.a1_elo },
          { name: m.a2_name, avatar_url: m.a2_avatar_url, elo: m.a2_elo },
        ]
      : [
          { name: m.b1_name, avatar_url: m.b1_avatar_url, elo: m.b1_elo },
          { name: m.b2_name, avatar_url: m.b2_avatar_url, elo: m.b2_elo },
        ];
    return `<div class="arena-side side-${letter.toLowerCase()}">
      <div class="arena-fighters">${fighters.filter((fighter) => fighter.name).map((fighter) => `
        <div class="arena-fighter">${avatar(fighter)}<div class="arena-fighter-info">
          <strong>${esc(fighter.name)}</strong><span>ELO ${rnd(fighter.elo)}</span>
        </div></div>`).join('')}</div>
    </div>`;
  };
  const statusLabel = m.status === 'completed' ? 'ĐÃ PHÂN THẮNG BẠI' : m.status === 'cancelled' ? 'KÈO ĐÃ HỦY' : arenaCountdown(m.scheduled_at);
  return `<article class="arena-card status-${m.status}" data-id="${m.id}">
    <div class="arena-countdown-line"><span>⏱ ${statusLabel}</span></div>
    <div class="arena-fight">
      ${side('A')}
      <div class="arena-vs"><b>VS</b><span>⚡</span></div>
      ${side('B')}
    </div>
    <div class="arena-intel">
      <span>🗓 ${fmtDate(m.scheduled_at)}</span>
      ${m.venue ? `<span>📍 ${esc(m.venue)}</span>` : ''}
      ${m.stakes ? `<span class="arena-stakes">💰 KÈO: ${esc(m.stakes)}</span>` : ''}
      ${m.note ? `<span>📜 ${esc(m.note)}</span>` : ''}
    </div>
    ${canEdit() && m.status !== 'completed' ? `<div class="arena-actions">
      ${m.status === 'scheduled' ? '<button class="btn arena-primary sm" data-arena="start">⚔️ Vào trận</button>' : ''}
      <a class="btn arena-ghost sm" href="#/arena/edit/${m.id}">✏️ Chỉnh kèo</a>
      ${m.status === 'scheduled' ? '<button class="btn arena-ghost sm" data-arena="cancel">Hủy kèo</button>' : ''}
      <button class="btn arena-danger sm" data-arena="delete">Xóa</button>
    </div>` : ''}
  </article>`;
}

async function viewArena() {
  const matches = await api('GET', '/schedule');
  const active = matches.filter((m) => m.status === 'scheduled');
  const closed = matches.filter((m) => m.status !== 'scheduled');
  const byId = new Map(matches.map((m) => [Number(m.id), m]));
  $app.innerHTML = `<div class="arena-page">
    <section class="arena-hero">
      <span class="arena-kicker">CLB BADMINTON · FIGHT NIGHT</span>
      <h1>ĐẤU TRƯỜNG</h1>
      <p>Lên lịch. Chốt kèo. Bước vào sân và để ELO phán xét.</p>
      ${canEdit() ? '<a class="btn arena-cta" href="#/arena/new">＋ LÊN KÈO MỚI</a>' : ''}
    </section>
    <div class="arena-section-title"><span>SẮP KHAI CHIẾN</span><b>${active.length}</b></div>
    ${active.length ? active.map((m) => arenaCard(m)).join('') : '<div class="arena-empty">Chưa có kèo nào trên bảng đấu.</div>'}
    ${closed.length ? `<div class="arena-section-title subdued"><span>HẠ MÀN</span><b>${closed.length}</b></div>${closed.map((m) => arenaCard(m)).join('')}` : ''}
  </div>`;

  $app.onclick = async (event) => {
    const button = event.target.closest('[data-arena]');
    if (!button) return;
    const card = button.closest('.arena-card');
    const item = byId.get(Number(card?.dataset.id));
    if (!item) return;
    try {
      if (button.dataset.arena === 'start') {
        sessionStorage.setItem('schedule_match_draft', JSON.stringify(item));
        location.hash = '#/new';
        return;
      }
      if (button.dataset.arena === 'cancel') {
        if (!confirm('Hủy kèo đấu này?')) return;
        await api('PUT', '/schedule/' + item.id, { ...item, status: 'cancelled' });
        toast('Đã hủy kèo đấu');
      }
      if (button.dataset.arena === 'delete') {
        if (!confirm('Xóa vĩnh viễn lịch đấu này?')) return;
        await api('DELETE', '/schedule/' + item.id);
        toast('Đã xóa lịch đấu');
      }
      viewArena();
    } catch (err) { toast(err.message, true); }
  };
}

async function viewScheduleForm(editId) {
  if (!canEdit()) { location.hash = '#/login'; return; }
  const [players, current] = await Promise.all([
    api('GET', '/players'),
    editId ? api('GET', '/schedule/' + editId) : Promise.resolve(null),
  ]);
  if (players.length < 2) {
    $app.innerHTML = '<div class="empty">Cần ít nhất 2 VĐV để lên lịch đấu.</div>';
    return;
  }
  const future = new Date(Date.now() + 24 * 3600000);
  future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
  const state = {
    match_type: current?.match_type || 'singles',
    a1: current?.a1 || '', a2: current?.a2 || '',
    b1: current?.b1 || '', b2: current?.b2 || '',
  };
  const slots = () => state.match_type === 'singles' ? ['a1', 'b1'] : ['a1', 'a2', 'b1', 'b2'];
  const options = (slot) => {
    const taken = slots().filter((key) => key !== slot).map((key) => Number(state[key])).filter(Boolean);
    return '<option value="">— Chọn chiến binh —</option>' + players
      .filter((p) => !taken.includes(p.id))
      .map((p) => `<option value="${p.id}" ${Number(state[slot]) === p.id ? 'selected' : ''}>${esc(p.name)} · ELO ${rnd(p.elo)}</option>`)
      .join('');
  };

  $app.innerHTML = `<div class="arena-page arena-form-page">
    <a class="arena-back" href="#/arena">← Trở lại Đấu trường</a>
    <section class="arena-hero compact">
      <span class="arena-kicker">MATCH MAKING</span>
      <h1>${editId ? 'CHỈNH KÈO ĐẤU' : 'LÊN KÈO MỚI'}</h1>
    </section>
    <form id="scheduleForm" class="arena-form">
      <div class="arena-format" id="scheduleType">
        <button type="button" data-type="singles">SOLO · 1 VS 1</button>
        <button type="button" data-type="doubles">SONG ĐẤU · 2 VS 2</button>
      </div>
      <div class="arena-form-fight">
        <div class="arena-pick"><b>GÓC A</b><label>Chiến binh 1<select id="sch-a1"></select></label><label class="sch-double">Chiến binh 2<select id="sch-a2"></select></label></div>
        <div class="arena-form-vs">VS</div>
        <div class="arena-pick"><b>GÓC B</b><label>Chiến binh 1<select id="sch-b1"></select></label><label class="sch-double">Chiến binh 2<select id="sch-b2"></select></label></div>
      </div>
      <div class="arena-fields">
        <label class="elo-check arena-elo-check">
          <input type="checkbox" id="sch-rated" ${!current || Number(current.rated) !== 0 ? 'checked' : ''}>
          <span class="elo-check-box">✓</span>
          <span><b>Tính ELO khi chốt kết quả</b><small>Bỏ tích nếu đây là trận giao hữu hoặc kèo không tính hạng</small></span>
        </label>
        <label>🗓 Giờ khai chiến<input id="sch-date" type="datetime-local" value="${esc(current?.scheduled_at?.slice(0, 16) || future.toISOString().slice(0, 16))}" required></label>
        <label>📍 Sàn đấu<input id="sch-venue" type="text" maxlength="120" value="${esc(current?.venue || '')}" placeholder="Sân số 3, CLB..."></label>
        <label class="arena-wager">💰 Kèo cược<input id="sch-stakes" type="text" maxlength="200" value="${esc(current?.stakes || '')}" placeholder="500K, chầu bia, 20 quả cầu..."></label>
        <label>📜 Tuyên chiến / ghi chú<textarea id="sch-note" maxlength="500" rows="3" placeholder="Luật kèo, lời thách đấu...">${esc(current?.note || '')}</textarea></label>
        ${editId ? `<label>Trạng thái<select id="sch-status"><option value="scheduled" ${current.status === 'scheduled' ? 'selected' : ''}>Sẵn sàng chiến</option><option value="cancelled" ${current.status === 'cancelled' ? 'selected' : ''}>Đã hủy kèo</option></select></label>` : ''}
      </div>
      <button class="btn arena-cta block" type="submit">${editId ? '💾 CẬP NHẬT KÈO' : '🔥 CHỐT KÈO · LÊN LỊCH'}</button>
    </form>
  </div>`;

  const renderPicks = () => {
    document.querySelectorAll('#scheduleType button').forEach((button) => button.classList.toggle('active', button.dataset.type === state.match_type));
    document.querySelectorAll('.sch-double').forEach((label) => { label.hidden = state.match_type === 'singles'; });
    for (const slot of ['a1', 'a2', 'b1', 'b2']) document.getElementById('sch-' + slot).innerHTML = options(slot);
  };
  document.getElementById('scheduleType').addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    state.match_type = button.dataset.type;
    renderPicks();
  });
  for (const slot of ['a1', 'a2', 'b1', 'b2']) {
    document.getElementById('sch-' + slot).addEventListener('change', (event) => {
      state[slot] = event.target.value;
      renderPicks();
    });
  }
  renderPicks();

  document.getElementById('scheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      ...state,
      rated: document.getElementById('sch-rated').checked,
      scheduled_at: document.getElementById('sch-date').value,
      venue: document.getElementById('sch-venue').value,
      stakes: document.getElementById('sch-stakes').value,
      note: document.getElementById('sch-note').value,
      status: document.getElementById('sch-status')?.value || 'scheduled',
    };
    if (!body.a1 || !body.b1 || (body.match_type === 'doubles' && (!body.a2 || !body.b2))) {
      return toast(`Hãy chọn đủ ${body.match_type === 'singles' ? 2 : 4} VĐV`, true);
    }
    try {
      await api(editId ? 'PUT' : 'POST', editId ? '/schedule/' + editId : '/schedule', body);
      toast(editId ? 'Đã cập nhật kèo đấu' : 'Đã chốt kèo và lên lịch');
      location.hash = '#/arena';
    } catch (err) { toast(err.message, true); }
  });
}

/* ================= 5. Lịch sử trận đấu ================= */
function matchCard(m, opts = {}) {
  const names = (t) =>
    t === 'A'
      ? [m.a1_name, m.a2_name].filter(Boolean).map(esc).join('<br>')
      : [m.b1_name, m.b2_name].filter(Boolean).map(esc).join('<br>');
  const teamHtml = (t) => {
    const won = m.winner === t;
    // delta của đội = delta của thành viên đầu tiên đội đó (2 người thường bằng nhau,
    // chỉ khác khi K khác nhau — hiển thị từng người ở trang chi tiết VĐV)
    const memberIds = (t === 'A' ? [m.a1, m.a2] : [m.b1, m.b2]).filter(Boolean);
    const deltas = m.deltas
      ? memberIds.map((id) => m.deltas[id]?.delta).filter((d) => d != null)
      : [];
    const deltaStr = deltas.length
      ? [...new Set(deltas.map(rnd))].map((v) => (v >= 0 ? '+' + v : v)).join('/')
      : '';
    return `
      <div class="match-team ${won ? '' : 'loser'}">
        <span class="tag ${won ? 'win' : 'lose'}">${won ? '✓ Thắng' : 'Thua'}
          ${deltaStr ? `· <span class="delta ${m.winner === t ? 'pos' : 'neg'}">${deltaStr}</span>` : ''}</span>
        <div class="names">${names(t)}</div>
      </div>`;
  };
  return `
    <div class="card match-card" data-id="${m.id}">
      <div class="match-head">
        <span>📅 ${fmtDate(m.date)}</span>
        <span>${m.match_type === 'singles' ? 'Đơn' : 'Đôi'} · ${Number(m.rated) === 0 ? 'Giao hữu' : 'Tính ELO'} · #${m.id}</span>
      </div>
      <div class="match-teams">
        ${teamHtml('A')}
        <div class="match-score">${m.score ? esc(m.score).split(',').join('<br>') : 'vs'}</div>
        ${teamHtml('B')}
      </div>
      ${
        opts.actions
          ? `<div class="match-actions">
              <a class="btn sm secondary" href="#/edit/${m.id}">✏️ Sửa</a>
              <button class="btn sm danger" data-act="del">🗑 Xoá</button>
            </div>`
          : ''
      }
    </div>`;
}

async function viewMatches() {
  const matches = await api('GET', '/matches');
  $app.innerHTML = `
    <h1>📋 Lịch sử trận đấu <span class="muted" style="font-weight:400;font-size:.9rem">(${matches.length} trận)</span></h1>
    ${
      matches.length === 0
        ? '<div class="empty">Chưa có trận nào.' +
          (canEdit() ? '<br><br><a class="btn" href="#/new">＋ Ghi trận đầu tiên</a>' : '') +
          '</div>'
        : matches.map((m) => matchCard(m, { actions: canEdit() })).join('')
    }`;

  // Gán onclick (không dùng addEventListener) để không tích luỹ listener khi vào lại trang
  $app.onclick = async (e) => {
    const btn = e.target.closest('button[data-act="del"]');
    if (!btn) return;
    const id = Number(btn.closest('.match-card').dataset.id);
    if (!confirm(`Xoá trận #${id}? ELO của các VĐV liên quan sẽ được tính lại.`)) return;
    try {
      await api('DELETE', '/matches/' + id);
      toast('Đã xoá trận, ELO đã được tính lại');
      viewMatches();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

/* ================= 5. Chi tiết VĐV ================= */
function eloChartSVG(history, initialElo) {
  // Vẽ biểu đồ đường bằng SVG thuần: trục X = thứ tự trận, trục Y = ELO
  const points = [
    { elo: history.length ? history[0].elo_before : initialElo }, // điểm khởi đầu
    ...history.map((h) => ({ elo: h.elo_after, date: h.date, delta: h.delta })),
  ];
  const W = Math.max(320, Math.min(760, 60 + points.length * 40));
  const H = 220;
  const PAD = { l: 44, r: 12, t: 14, b: 24 };
  const elos = points.map((p) => p.elo);
  let min = Math.min(...elos), max = Math.max(...elos);
  if (max - min < 40) { const mid = (max + min) / 2; min = mid - 20; max = mid + 20; }
  const range = max - min;
  min -= range * 0.1; max += range * 0.1;

  const x = (i) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  // Đường lưới ngang + nhãn
  const gridLines = [];
  const step = Math.max(10, Math.ceil((max - min) / 4 / 10) * 10);
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    gridLines.push(
      `<line x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" stroke="#e3e9e5"/>` +
      `<text x="${PAD.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8a978f">${v}</text>`
    );
  }

  const poly = points.map((p, i) => `${x(i)},${y(p.elo)}`).join(' ');
  const dots = points
    .map((p, i) => {
      const color = i === 0 ? '#8a978f' : p.delta >= 0 ? '#178a4c' : '#c8452c';
      return `<circle cx="${x(i)}" cy="${y(p.elo)}" r="3.5" fill="${color}">
        <title>${i === 0 ? 'Khởi điểm' : 'Trận ' + i + (p.date ? ' · ' + fmtDate(p.date) : '')}: ${rnd(p.elo)}</title>
      </circle>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Biểu đồ ELO">
    ${gridLines.join('')}
    <polyline points="${poly}" fill="none" stroke="#16643f" stroke-width="2.5"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${(PAD.l + W - PAD.r) / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#8a978f">Số trận đã đấu →</text>
  </svg>`;
}

async function viewPlayerDetail(id) {
  const d = await api('GET', '/players/' + id);
  const p = d.player;
  const settings = await api('GET', '/settings');

  const topList = (items) =>
    items.length === 0
      ? '<span class="muted">Chưa có</span>'
      : items
          .map(
            (t) =>
              `<a href="#/player/${t.id}">${esc(t.name)}</a> <span class="muted">(${t.games} trận, thắng ${t.wins})</span>`
          )
          .join('<br>');

  $app.innerHTML = `
    <div class="card player-head">
      ${avatar(p, true)}
      <div style="flex:1;min-width:0">
        <h1 style="margin:0">${esc(p.name)}</h1>
        ${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}
      </div>
      <div class="lb-elo" style="font-size:1.6rem">${rnd(p.elo)}<span class="wr">ELO hiện tại</span></div>
    </div>

    <div class="stat-grid">
      <div class="stat"><b>${p.matches_played}</b><span>Tổng trận</span></div>
      <div class="stat"><b>${p.wins}</b><span>Thắng</span></div>
      <div class="stat"><b>${p.losses}</b><span>Thua</span></div>
      <div class="stat"><b>${pct(p.win_rate)}</b><span>Tỷ lệ thắng</span></div>
    </div>

    <h2>📈 Diễn biến ELO</h2>
    <div class="card chart-wrap">
      ${
        d.elo_history.length === 0
          ? '<div class="empty">Chưa có trận nào</div>'
          : eloChartSVG(d.elo_history, settings.initial_elo)
      }
    </div>

    <div class="card">
      <h2 style="margin-top:0">🤝 Đồng đội thường gặp</h2>
      ${topList(d.top_partners)}
      <h2>⚔️ Đối thủ thường gặp</h2>
      ${topList(d.top_opponents)}
    </div>

    <h2>🕐 Lịch sử thi đấu</h2>
    ${
      d.matches.length === 0
        ? '<div class="empty">Chưa có trận nào</div>'
        : d.matches
            .map((m) => {
              const onA = m.a1 === id || m.a2 === id;
              const won = (m.winner === 'A') === onA;
              const partner = onA
                ? (m.a1 === id ? m.a2_name : m.a1_name)
                : (m.b1 === id ? m.b2_name : m.b1_name);
              const opps = (onA ? [m.b1_name, m.b2_name] : [m.a1_name, m.a2_name]).filter(Boolean);
              const matchup = m.match_type === 'singles'
                ? `Đấu đơn với <b>${esc(opps[0])}</b>`
                : `Cùng <b>${esc(partner)}</b> đấu với <b>${esc(opps[0])}</b> &amp; <b>${esc(opps[1])}</b>`;
              return `
              <div class="card match-card">
                <div class="match-head">
                  <span>📅 ${fmtDate(m.date)}</span>
                  <span class="tag ${won ? 'win' : 'lose'}" style="padding:1px 8px;border-radius:20px;font-size:.72rem;${won ? 'background:#e2f5ea;color:#178a4c;font-weight:700' : 'background:#f2f2f2'}">
                    ${won ? '✓ Thắng' : '✗ Thua'} ${fmtDelta(m.delta)}
                  </span>
                </div>
                <div style="font-size:.9rem">
                  ${matchup}
                  ${m.score ? `<div class="muted">Tỷ số: ${esc(m.score)}</div>` : ''}
                  <div class="muted">ELO sau trận: ${m.elo_after != null ? rnd(m.elo_after) : '–'}</div>
                </div>
              </div>`;
            })
            .join('')
    }`;
}

/* ================= 6. Cài đặt ================= */
async function viewSettings() {
  if (!canEdit()) { location.hash = '#/login'; return; }
  const s = await api('GET', '/settings');
  $app.innerHTML = `
    <h1>⚙️ Cài đặt hệ thống ELO</h1>
    <form class="card" id="settingsForm">
      <label class="field">ELO khởi điểm cho VĐV mới
        <input type="number" name="initial_elo" value="${s.initial_elo}" step="1" min="0">
      </label>
      <label class="field">Hệ số K (mặc định 32)
        <input type="number" name="k_base" value="${s.k_base}" step="1" min="1">
      </label>
      <label class="field">Hệ số K cho VĐV mới
        <input type="number" name="k_new" value="${s.k_new}" step="1" min="1">
        <span class="muted" style="font-weight:400">Áp dụng khi VĐV đấu chưa đủ số trận bên dưới. Để bằng K mặc định nếu không dùng.</span>
      </label>
      <label class="field">Ngưỡng số trận của "VĐV mới"
        <input type="number" name="new_threshold" value="${s.new_threshold}" step="1" min="0">
      </label>
      <label class="field">ELO sàn (không cho tụt dưới)
        <input type="number" name="min_elo" value="${s.min_elo}" step="1" min="0">
      </label>
      <button class="btn block" type="submit">💾 Lưu &amp; tính lại toàn bộ ELO</button>
      <p class="muted" style="margin-bottom:0">⚠ Thay đổi cấu hình sẽ tính lại ELO của toàn bộ lịch sử trận đấu.</p>
    </form>`;

  // Nút đăng xuất (chỉ có ý nghĩa khi server bật đăng nhập)
  if (AUTH.required) {
    $app.insertAdjacentHTML(
      'beforeend',
      `<div class="card" style="text-align:center">
        <button class="btn danger" id="logoutBtn">🚪 Đăng xuất</button>
        <p class="muted" style="margin-bottom:0">Sau khi đăng xuất bạn chỉ xem được BXH, VĐV và lịch sử đấu.</p>
      </div>`
    );
    document.getElementById('logoutBtn').addEventListener('click', logout);
  }

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, Number(v)]));
    try {
      await api('PUT', '/settings', body);
      toast('Đã lưu cấu hình, ELO đã được tính lại toàn bộ');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ================= 7. Bộ đếm điểm (dùng tại sân) ================= */
// Fullscreen, chạm nửa màn hình để +1 điểm. MỖI LẦN MỞ LÀ ĐẾM MỚI —
// không nhớ trạng thái của lần đếm trước. Nếu mở từ form Ghi trận thì nạp
// các ván ĐANG CÓ TRONG FORM (để đếm tiếp ván kế), điểm ván hiện tại về 0-0.
function viewCounter() {
  localStorage.removeItem('counter_state'); // dọn key của bản cũ (nếu còn)

  // Được mở từ form Ghi trận? (form đã lưu nháp trước khi chuyển sang đây)
  // → mọi nút thoát đều quay VỀ FORM, kèm tỷ số các ván đã chốt.
  const draft = (() => {
    try { return JSON.parse(sessionStorage.getItem('match_draft') || 'null'); } catch { return null; }
  })();

  const st = { a: 0, b: 0, sets: [] };
  // Nạp các ván đã nhập đủ 2 ô trong form (nguồn chân lý là form, không phải bộ nhớ cũ)
  if (draft?.sets) {
    st.sets = draft.sets
      .filter((s) => s.a !== '' && s.b !== '')
      .slice(0, 3)
      .map((s) => ({ a: Number(s.a), b: Number(s.b) }));
  }
  const backToForm = (sets) => {
    if (sets.length) {
      localStorage.setItem('counter_sets', JSON.stringify({ t: Date.now(), sets }));
    }
    location.hash = draft?.editId ? '#/edit/' + draft.editId : '#/new';
  };

  $app.innerHTML = `
    <div class="counter">
      <div class="c-half c-a" id="cA">
        <div class="c-name">Đội A</div>
        <div class="c-score" id="scoreA">${st.a}</div>
        <button type="button" class="c-minus" id="minusA">−1</button>
      </div>
      <div class="c-half c-b" id="cB">
        <div class="c-name">Đội B</div>
        <div class="c-score" id="scoreB">${st.b}</div>
        <button type="button" class="c-minus" id="minusB">−1</button>
      </div>
      <div class="c-sets" id="cSets" hidden></div>
      <div class="c-bar">
        <button type="button" class="c-btn c-btn-main" id="cEndSet">🏁 Xong ván</button>
        <button type="button" class="c-btn" id="cSwap" title="Đổi bên">⇄</button>
        <button type="button" class="c-btn" id="cReset" title="Làm mới">⟲</button>
        <button type="button" class="c-btn" id="cExit" title="Thoát">✕</button>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);

  const render = () => {
    $('scoreA').textContent = st.a;
    $('scoreB').textContent = st.b;
    // Chip các ván đã xong: "21-15 · 18-21"
    $('cSets').hidden = st.sets.length === 0;
    $('cSets').textContent = st.sets.map((s) => `${s.a}-${s.b}`).join(' · ');
    // Tới điểm kết thúc ván (≥21 cách 2, hoặc chạm 30) → nhấp nháy nút Xong ván
    const setPoint =
      ((st.a >= 21 || st.b >= 21) && Math.abs(st.a - st.b) >= 2) || st.a === 30 || st.b === 30;
    $('cEndSet').classList.toggle('pulse', setPoint && st.a !== st.b);
  };

  const bump = (side, delta) => {
    st[side] = Math.max(0, Math.min(99, st[side] + delta));
    render();
  };
  // Chạm cả nửa màn hình = +1 (trừ khi bấm đúng nút −1)
  $('cA').addEventListener('click', (e) => { if (e.target.id !== 'minusA') bump('a', 1); });
  $('cB').addEventListener('click', (e) => { if (e.target.id !== 'minusB') bump('b', 1); });
  $('minusA').addEventListener('click', () => bump('a', -1));
  $('minusB').addEventListener('click', () => bump('b', -1));

  // 🏁 Xong ván: chốt ván hiện tại. Nếu đến từ form → quay về form luôn
  // (mở lại bộ đếm sẽ đếm tiếp ván sau, các ván cũ vẫn còn).
  $('cEndSet').addEventListener('click', () => {
    if (st.a + st.b === 0) return toast('Ván chưa có điểm nào', true);
    if (st.a === st.b) return toast('Đang hoà — ván phải có đội thắng', true);
    if (st.sets.length >= 3) return toast('Đã đủ 3 ván', true);
    st.sets.push({ a: st.a, b: st.b });
    st.a = 0;
    st.b = 0;
    render();
    if (draft) return backToForm([...st.sets]);
    toast(`Xong ván ${st.sets.length}: ${st.sets[st.sets.length - 1].a}-${st.sets[st.sets.length - 1].b}`);
  });

  // ✕ Thoát: về form (nếu đến từ form) kèm các ván ĐÃ chốt; điểm ván đang
  // đếm dở bị bỏ (mở lại bộ đếm là đếm mới). Mở trực tiếp thì về trang chủ.
  $('cExit').addEventListener('click', () => {
    if (draft) return backToForm([...st.sets]);
    location.hash = '#/';
  });

  // ⇄ Đổi bên: chỉ đảo VỊ TRÍ hiển thị hai đội trên màn hình (như đổi sân
  // giữa ván) — điểm, tên đội, dữ liệu ghi nhận không đổi
  let flipped = false;
  $('cSwap').addEventListener('click', () => {
    flipped = !flipped;
    $('cA').style.order = flipped ? 2 : 1;
    $('cB').style.order = flipped ? 1 : 2;
  });

  // ⟲ Làm mới: xoá điểm + các ván đã đếm ngay, không hỏi lại
  $('cReset').addEventListener('click', () => {
    st.a = 0; st.b = 0; st.sets = [];
    render();
  });

  render();
  keepAwake(true);
}

/* ================= 8. Đăng nhập ================= */
async function viewLogin() {
  if (canEdit()) {
    // Đã đăng nhập rồi (hoặc server ở chế độ mở) → không cần trang này
    $app.innerHTML = `<div class="empty">Bạn đang có toàn quyền chỉnh sửa.<br><br>
      <a class="btn" href="#/">Về bảng xếp hạng</a></div>`;
    return;
  }
  $app.innerHTML = `
    <h1>🔑 Đăng nhập</h1>
    <form class="card" id="loginForm">
      <p class="muted" style="margin-top:0">Đăng nhập để ghi trận đấu, quản lý VĐV và cài đặt.
        Không đăng nhập vẫn xem được bảng xếp hạng, VĐV và lịch sử đấu.</p>
      <label class="field">Tên đăng nhập
        <input type="text" id="login-user" autocomplete="username" required autofocus
          autocapitalize="none" spellcheck="false">
      </label>
      <label class="field">Mật khẩu
        <input type="password" id="login-pw" autocomplete="current-password" required>
      </label>
      <button class="btn block" type="submit">Đăng nhập</button>
    </form>`;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Dùng fetch thường (không qua api()) để 401 "sai mật khẩu" không bị
    // xử lý như phiên hết hạn
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('login-user').value.trim(),
          password: document.getElementById('login-pw').value,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Lỗi ${res.status}`);
      localStorage.setItem('auth_token', data.token);
      AUTH.logged_in = true;
      updateNavAuth();
      toast('Đăng nhập thành công');
      location.hash = '#/';
    } catch (err) {
      toast(err.message, true);
    }
  });
}

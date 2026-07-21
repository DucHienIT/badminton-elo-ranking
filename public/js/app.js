/* BXH Cầu lông — SPA vanilla JS (hash router) */
'use strict';

const $app = document.getElementById('app');

/* ================= API helper ================= */
// Nếu server bật ADMIN_PASSWORD, thao tác ghi trả 401 → hỏi mật khẩu 1 lần,
// lưu localStorage và tự thử lại. Không bật thì luồng này không bao giờ chạy.
async function api(method, path, body) {
  const doFetch = () => {
    const headers = { 'Content-Type': 'application/json' };
    const pw = localStorage.getItem('admin_pw');
    if (pw) headers['X-Admin-Password'] = pw;
    return fetch('/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };
  let res = await doFetch();
  if (res.status === 401) {
    const pw = prompt('Thao tác này cần mật khẩu admin:');
    if (pw) {
      localStorage.setItem('admin_pw', pw);
      res = await doFetch();
    }
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) localStorage.removeItem('admin_pw'); // mật khẩu sai → nhập lại lần sau
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
    return `<img class="${cls}" src="${esc(p.avatar_url)}" alt="" onerror="this.outerHTML='${avatarInitial(p, lg).replace(/'/g, '&#39;')}'">`;
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
  { re: /^#\/players$/, view: viewPlayers, nav: 'players' },
  { re: /^#\/player\/(\d+)$/, view: (m) => viewPlayerDetail(Number(m[1])), nav: 'players' },
  { re: /^#\/matches$/, view: viewMatches, nav: 'matches' },
  { re: /^#\/settings$/, view: viewSettings, nav: 'settings' },
];

async function router() {
  const hash = location.hash || '#/';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      document.querySelectorAll('[data-nav]').forEach((a) =>
        a.classList.toggle('active', a.dataset.nav === r.nav)
      );
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
window.addEventListener('DOMContentLoaded', router);

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
async function viewMatchForm(editId) {
  const players = await api('GET', '/players');
  if (players.length < 4) {
    $app.innerHTML = `<h1>➕ Ghi nhận trận đấu</h1>
      <div class="empty">Cần ít nhất 4 VĐV để ghi trận đấu.<br>Hiện có ${players.length}.<br><br>
      <a class="btn" href="#/players">＋ Thêm VĐV</a></div>`;
    return;
  }

  let match = null;
  if (editId) match = await api('GET', '/matches/' + editId);

  const state = {
    a1: match?.a1 || '', a2: match?.a2 || '',
    b1: match?.b1 || '', b2: match?.b2 || '',
    winner: match?.winner || '',
  };

  const slotLabels = { a1: 'VĐV 1', a2: 'VĐV 2', b1: 'VĐV 1', b2: 'VĐV 2' };
  const playerOptions = (slot) => {
    const takenElsewhere = ['a1', 'a2', 'b1', 'b2']
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

  // datetime-local cần "YYYY-MM-DDTHH:mm"
  const dateVal = match?.date ? match.date.slice(0, 16) : nowLocalInput();

  $app.innerHTML = `
    <h1>${editId ? '✏️ Sửa trận đấu' : '➕ Ghi nhận trận đấu'}</h1>
    <form id="matchForm" class="card">
      <div class="team-box" id="boxA">
        <h3>Đội A <span class="win-badge" hidden>THẮNG</span></h3>
        <label class="field"><select id="sel-a1">${playerOptions('a1')}</select></label>
        <label class="field"><select id="sel-a2">${playerOptions('a2')}</select></label>
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-box" id="boxB">
        <h3>Đội B <span class="win-badge" hidden>THẮNG</span></h3>
        <label class="field"><select id="sel-b1">${playerOptions('b1')}</select></label>
        <label class="field"><select id="sel-b2">${playerOptions('b2')}</select></label>
      </div>

      <p style="margin:0 0 6px;font-weight:600;font-size:.9rem">Đội thắng <span class="req">*</span></p>
      <div class="winner-toggle">
        <button type="button" id="winA">Đội A thắng</button>
        <button type="button" id="winB">Đội B thắng</button>
      </div>

      <label class="field">Tỷ số từng ván (tuỳ chọn)
        <input type="text" id="score" placeholder="21-15, 18-21, 21-19"
          value="${esc(match?.score || '')}" inputmode="numeric">
      </label>
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

  document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      a1: Number(state.a1), a2: Number(state.a2),
      b1: Number(state.b1), b2: Number(state.b2),
      winner: state.winner,
      score: document.getElementById('score').value,
      date: document.getElementById('date').value,
    };
    if (!payload.a1 || !payload.a2 || !payload.b1 || !payload.b2)
      return toast('Hãy chọn đủ 4 VĐV', true);
    if (!payload.winner) return toast('Hãy chọn đội thắng', true);
    try {
      if (editId) {
        await api('PUT', '/matches/' + editId, payload);
        toast('Đã cập nhật trận đấu, ELO đã được tính lại');
        location.hash = '#/matches';
      } else {
        const r = await api('POST', '/matches', payload);
        const winDelta = r.deltas.find((d) => d.delta >= 0);
        toast(`Đã ghi nhận! Đội thắng ${winDelta ? '+' + rnd(winDelta.delta) : ''} điểm ELO`);
        location.hash = '#/';
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ================= 3. Quản lý VĐV ================= */
async function viewPlayers() {
  const players = await api('GET', '/players');
  $app.innerHTML = `
    <h1>👥 Quản lý VĐV</h1>
    <div class="card">
      <form id="addForm">
        <label class="field">Tên VĐV <span class="req">*</span>
          <input type="text" id="np-name" placeholder="Nguyễn Văn A" required>
        </label>
        <label class="field">Ảnh đại diện (URL, tuỳ chọn)
          <input type="url" id="np-avatar" placeholder="https://...">
        </label>
        <label class="field">Ghi chú (tuỳ chọn)
          <input type="text" id="np-note" placeholder="VD: tay vợt chủ lực">
        </label>
        <button class="btn block" type="submit">＋ Thêm VĐV</button>
      </form>
    </div>
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
          <button class="btn sm secondary" data-act="edit">Sửa</button>
          <button class="btn sm danger" data-act="del">Xoá</button>
        </div>`
        )
        .join('')}
    </div>`;

  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/players', {
        name: document.getElementById('np-name').value,
        avatar_url: document.getElementById('np-avatar').value,
        note: document.getElementById('np-note').value,
      });
      toast('Đã thêm VĐV');
      viewPlayers();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('playerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.p-row');
    const id = Number(row.dataset.id);
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
      const name = prompt('Tên VĐV:', p.name);
      if (name === null) return;
      const note = prompt('Ghi chú:', p.note || '');
      if (note === null) return;
      const avatar_url = prompt('URL ảnh đại diện (bỏ trống nếu không có):', p.avatar_url || '');
      if (avatar_url === null) return;
      try {
        await api('PUT', '/players/' + id, { name, note, avatar_url });
        toast('Đã cập nhật');
        viewPlayers();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
}

/* ================= 4. Lịch sử trận đấu ================= */
function matchCard(m, opts = {}) {
  const names = (t) =>
    t === 'A'
      ? `${esc(m.a1_name)}<br>${esc(m.a2_name)}`
      : `${esc(m.b1_name)}<br>${esc(m.b2_name)}`;
  const teamHtml = (t) => {
    const won = m.winner === t;
    // delta của đội = delta của thành viên đầu tiên đội đó (2 người thường bằng nhau,
    // chỉ khác khi K khác nhau — hiển thị từng người ở trang chi tiết VĐV)
    const memberIds = t === 'A' ? [m.a1, m.a2] : [m.b1, m.b2];
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
        <span>#${m.id}</span>
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
        ? '<div class="empty">Chưa có trận nào.<br><br><a class="btn" href="#/new">＋ Ghi trận đầu tiên</a></div>'
        : matches.map((m) => matchCard(m, { actions: true })).join('')
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
              const opps = onA ? [m.b1_name, m.b2_name] : [m.a1_name, m.a2_name];
              return `
              <div class="card match-card">
                <div class="match-head">
                  <span>📅 ${fmtDate(m.date)}</span>
                  <span class="tag ${won ? 'win' : 'lose'}" style="padding:1px 8px;border-radius:20px;font-size:.72rem;${won ? 'background:#e2f5ea;color:#178a4c;font-weight:700' : 'background:#f2f2f2'}">
                    ${won ? '✓ Thắng' : '✗ Thua'} ${fmtDelta(m.delta)}
                  </span>
                </div>
                <div style="font-size:.9rem">
                  Cùng <b>${esc(partner)}</b> đấu với <b>${esc(opps[0])}</b> &amp; <b>${esc(opps[1])}</b>
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

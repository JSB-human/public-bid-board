// "마감·결과"와 "업체" 화면. 진행 중 공고 화면(index.html 안 스크립트)의 공용 함수
// (esc, won, svg, ICONS, kindOf, parseDeadline, dueLabel …)를 같이 쓴다.

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const data = { results: null, companies: null, byBizno: new Map() };
const rs = { q: '', filter: 'all', open: new Set() };
const cs = { q: '', sort: 'wins' };

// ---------- 공용 ----------
async function load(name) {
  if (data[name]) return data[name];
  const r = await fetch(`data/${name}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  data[name] = await r.json();
  if (name === 'companies') for (const c of data.companies.items) data.byBizno.set(c.bizno, c);
  return data[name];
}
const shortDay = (s) => { const t = parseDeadline(s); if (t === null) return ''; const d = new Date(t + 9 * 3600000); return `${d.getUTCFullYear() % 100}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`; };
const eok = (n) => (n == null ? '-' : n >= 1e8 ? (n / 1e8).toFixed(n >= 1e10 ? 0 : 1) + '억' : Math.round(n / 1e4).toLocaleString('ko-KR') + '만');
const pct = (n) => (n == null ? '' : `${Number(n).toFixed(2).replace(/\.?0+$/, '')}%`);
const bizFmt = (b) => (b && b.length === 10 ? `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` : b || '');
const coLink = (bizno, name) => (bizno ? `<a class="co" href="#company/${esc(bizno)}">${esc(name)}</a>` : esc(name));
const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_CO = '<path d="M3 21h18M6 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M15 9h3a1 1 0 0 1 1 1v11M9 8h2M9 12h2M9 16h2"/>';

function emptyState(title, msg) {
  return `<div class="empty"><b>${esc(title)}</b>${esc(msg)}</div>`;
}

// 결과 상태 → 표시 이름과 색
function statusOf(r) {
  if (r.contract) return ['계약', 'ok'];
  if (r.status === '개찰완료' && r.winner) return ['낙찰', 'ok'];
  if (r.status === '개찰완료') return ['개찰 완료', ''];
  if (r.status === '유찰') return ['유찰', 'bad'];
  if (!r.status || r.status === '개찰 전') return ['결과 대기', 'wait'];
  return [r.status, ''];
}

// ---------- 마감·결과 ----------
async function renderResults() {
  const root = $('view-results');
  if (!root.dataset.ready) {
    root.dataset.ready = '1';
    root.innerHTML = `
      <section class="hero"><h1>마감된 공고와<br>누가 가져갔는지</h1>
        <p>진행 중 목록과 같은 조건에 맞던 공고의 참여 업체·낙찰·계약 결과예요.</p></section>
      <section class="stats" id="rStats"></section>
      <section class="dash" id="rDash"></section>
      <div class="toolbar"><div class="inner">
        <div class="search">${SEARCH}<input type="search" id="rq" placeholder="사업명·발주기관·업체명으로 검색" aria-label="결과 검색"></div>
        <div class="chips" id="rChips">
          <button class="chip" data-f="all">전체</button><button class="chip" data-f="won">낙찰·계약</button>
          <button class="chip" data-f="joint">공동계약</button><button class="chip" data-f="failed">유찰</button><button class="chip" data-f="wait">결과 대기</button>
        </div></div></div>
      <div class="count" id="rCount"></div><div id="rList" class="list-grid"></div>
      <footer id="rFoot"></footer>`;
    $('rq').addEventListener('input', (e) => { rs.q = e.target.value.trim().toLowerCase(); drawResults(); });
    $('rChips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { rs.filter = b.dataset.f; drawResults(); } });
    $('rList').addEventListener('click', (e) => {
      const h = e.target.closest('button.head');
      if (!h) return;
      const id = h.dataset.id;
      rs.open.has(id) ? rs.open.delete(id) : rs.open.add(id);
      drawResults();
    });
  }
  try {
    const d = await load('results');
    const items = d.items;
    const won = items.filter((r) => r.winner || r.contract).length;
    $('rStats').innerHTML = [
      ['마감 공고', items.length + '<small>건</small>'],
      ['낙찰·계약', won + '<small>건</small>'],
      ['유찰', items.filter((r) => r.status === '유찰').length + '<small>건</small>'],
      ['평균 참여', (() => { const p = items.filter((r) => r.participants); return p.length ? (p.reduce((s, r) => s + r.participants, 0) / p.length).toFixed(1) + '<small>곳</small>' : '-'; })()],
    ].map(([k, v]) => `<div class="stat" role="presentation"><div class="label">${k}</div><div class="value">${v}</div></div>`).join('');
    $('rDash').innerHTML = dashboard(items);
    $('rFoot').textContent = `출처: ${d.source || '-'} · 갱신 ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}`;
    drawResults();
  } catch (e) {
    $('rList').innerHTML = emptyState('아직 결과 데이터가 없어요', '다음 자동 갱신 때 모아요.');
  }
}

// 한눈에 보기: 월별 결과, 많이 따 간 회사, 많이 발주한 기관
function dashboard(items) {
  const months = new Map();
  for (const r of items) {
    const t = parseDeadline(r.openedAt || r.deadline);
    if (t === null) continue;
    const d = new Date(t + 9 * 3600000);
    const k = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = months.get(k) || { won: 0, failed: 0, wait: 0 };
    if (r.winner || r.contract) m.won++; else if (r.status === '유찰') m.failed++; else m.wait++;
    months.set(k, m);
  }
  const ms = [...months].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const maxM = Math.max(1, ...ms.map(([, m]) => m.won + m.failed + m.wait));
  const bars = ms.map(([k, m]) => {
    const h = (v) => `${(v / maxM) * 100}%`;
    return `<div class="mb" title="${k} · 낙찰 ${m.won} · 유찰 ${m.failed} · 대기 ${m.wait}"><div class="mb-col">
      <i class="w" style="height:${h(m.wait)}"></i><i class="f" style="height:${h(m.failed)}"></i><i class="o" style="height:${h(m.won)}"></i></div>
      <span>${k.slice(2).replace('.', '/')}</span><b>${m.won + m.failed + m.wait}</b></div>`;
  }).join('');
  // 회사별 수주 (계약 구성사 지분 기준, 없으면 낙찰자)
  const co = new Map();
  for (const r of items) {
    const mem = r.contract?.members?.length ? r.contract.members : r.winner ? [{ ...r.winner, share: 100 }] : [];
    const total = r.contract?.amount || r.winner?.amount || 0;
    for (const m of mem) {
      if (!m.bizno) continue;
      const e = co.get(m.bizno) || { bizno: m.bizno, name: m.name, n: 0, amt: 0 };
      e.n++; e.amt += (total * (m.share ?? 100)) / 100;
      co.set(m.bizno, e);
    }
  }
  const topCo = [...co.values()].sort((a, b) => b.amt - a.amt).slice(0, 6);
  const maxCo = Math.max(1, ...topCo.map((x) => x.amt));
  const org = new Map();
  for (const r of items) { const e = org.get(r.org) || { name: r.org, n: 0, amt: 0 }; e.n++; e.amt += r.amount || 0; org.set(r.org, e); }
  const topOrg = [...org.values()].sort((a, b) => b.n - a.n || b.amt - a.amt).slice(0, 6);
  const maxOrg = Math.max(1, ...topOrg.map((x) => x.n));
  const hbar = (list, val, max, label, link) => list.map((x, i) => `<${link ? `a href="#company/${esc(x.bizno)}"` : 'div'} class="hb">
      <span class="hb-i">${i + 1}</span><span class="hb-n">${esc(short(x.name))}</span>
      <span class="hb-bar"><i style="width:${(val(x) / max) * 100}%"></i></span><span class="hb-v">${label(x)}</span></${link ? 'a' : 'div'}>`).join('');
  return `
    <div class="dash-card wide"><div class="dash-h"><b>월별 결과</b><span class="legend"><i class="lg-o"></i>낙찰·계약 <i class="lg-f"></i>유찰 <i class="lg-w"></i>결과 대기</span></div><div class="mbars">${bars}</div></div>
    <div class="dash-card"><div class="dash-h"><b>많이 따 간 회사</b><span>지분 기준 금액</span></div>${hbar(topCo, (x) => x.amt, maxCo, (x) => `${eok(x.amt)} · ${x.n}건`, true) || '<div class="note">아직 없어요.</div>'}</div>
    <div class="dash-card"><div class="dash-h"><b>많이 발주한 기관</b><span>건수</span></div>${hbar(topOrg, (x) => x.n, maxOrg, (x) => `${x.n}건`, false)}</div>`;
}

function drawResults() {
  const items = data.results?.items || [];
  document.querySelectorAll('#rChips [data-f]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === rs.filter));
  const rows = items.filter((r) => {
    if (rs.filter === 'won' && !(r.winner || r.contract)) return false;
    if (rs.filter === 'joint' && !r.contract?.joint) return false;
    if (rs.filter === 'failed' && r.status !== '유찰') return false;
    if (rs.filter === 'wait' && (r.winner || r.contract || r.status === '유찰')) return false;
    if (rs.q) {
      const hay = [r.title, r.org, r.winner?.name, ...(r.bidders || []).map((b) => b.name), ...(r.contract?.members || []).map((m) => m.name)].join(' ').toLowerCase();
      if (!hay.includes(rs.q)) return false;
    }
    return true;
  });
  $('rCount').innerHTML = `<span><b>${rows.length}</b>건</span>`;
  $('rList').innerHTML = rows.length ? rows.map(resultCard).join('') : emptyState('조건에 맞는 결과가 없어요', '검색어나 필터를 바꿔 보세요.');
}

function resultCard(r) {
  const open = rs.open.has(r.id);
  const [st, cls] = statusOf(r);
  // 금액이 0 으로 등록된 계약(해외 사업 등)은 금액이 없는 것으로 본다.
  const amount = r.contract?.amount || r.winner?.amount || r.amount;
  const amountLabel = r.contract?.amount ? '계약' : r.winner?.amount ? '낙찰' : '추정';
  const lead = r.contract?.members?.[0] || r.winner;
  const who = lead ? `<span class="who">${esc(lead.name)}${r.contract?.members?.length > 1 ? ` 외 ${r.contract.members.length - 1}곳` : ''}</span>` : '';
  const kind = kindOf(r);
  return `<article class="card ${open ? 'open' : ''}">
    <button class="head" data-id="${esc(r.id)}" aria-expanded="${open}">
      <span class="icon i-${kind}">${svg(ICONS[kind])}</span>
      <span class="body">
        <span class="title">${esc(r.title)}</span>
        <span class="meta"><span>${esc(r.org)}</span>${r.openedAt ? `<span class="dot">${shortDay(r.openedAt)} 개찰</span>` : ''}${r.participants ? `<span class="dot">${r.participants}곳 참여</span>` : ''}</span>
        <span class="badges"><span class="badge st-${cls}">${st}</span>${r.contract?.joint ? '<span class="badge rg">공동계약</span>' : ''}${who}</span>
      </span>
      <span class="side"><span class="amount">${won(amount)}</span><span class="sub"><span class="alabel">${amountLabel}</span>${svg(CHEV, 'chev')}</span></span>
    </button>
    ${open ? resultDetail(r) : ''}
  </article>`;
}

function resultDetail(r) {
  const parts = [];
  if (r.contract) {
    const k = r.contract;
    const members = (k.members || []).map((m) => `<div class="member">
        <span class="role ${/주계약|대표/.test(m.role) ? 'lead' : ''}">${esc(m.role || '구성사')}</span>
        <span class="mname">${coLink(m.bizno, m.name)}<small>${esc(m.ceo || '')}</small></span>
        <span class="share"><span class="bar"><i style="width:${Math.max(2, m.share ?? 0)}%"></i></span><b>${m.share ?? '-'}%</b></span>
        <span class="mamt">${k.amount && m.share != null ? eok((k.amount * m.share) / 100) : ''}</span>
      </div>`).join('');
    parts.push(`<div class="section-title">계약 ${k.joint ? '· 공동계약' : ''}</div>
      <div class="tiles">
        <div class="tile"><div class="k">계약금액</div><div class="v">${k.amount ? won(k.amount) : '등록 안 됨'}</div></div>
        <div class="tile"><div class="k">계약일</div><div class="v">${esc(k.date || '-')}</div></div>
        <div class="tile wide"><div class="k">계약방법</div><div class="v">${esc(k.method || '-')}${k.reason ? `<small class="reason">${esc(k.reason)}</small>` : ''}</div></div>
      </div>
      <div class="members">${members}</div>`);
  } else if (r.winner) {
    parts.push(`<div class="section-title">낙찰</div><div class="tiles">
      <div class="tile"><div class="k">낙찰 업체</div><div class="v">${coLink(r.winner.bizno, r.winner.name)}</div></div>
      <div class="tile"><div class="k">낙찰금액 · 투찰률</div><div class="v">${won(r.winner.amount)} · ${pct(r.winner.rate)}</div></div></div>
      <div class="note">계약이 등록되면 컨소시엄 구성사와 지분이 함께 나와요.</div>`);
  }
  if (r.bidders?.length) {
    const winBiz = new Set([r.winner?.bizno, ...(r.contract?.members || []).map((m) => m.bizno)].filter(Boolean));
    parts.push(`<div class="section-title">참여 업체 ${r.bidders.length}곳 <small>입찰은 대표사 이름으로 나와요</small></div>
      <div class="rank-wrap"><table class="rank"><thead><tr><th>순위</th><th>업체</th><th class="num">투찰금액</th><th class="num">투찰률</th><th>비고</th></tr></thead><tbody>
      ${r.bidders.map((b) => `<tr class="${winBiz.has(b.bizno) ? 'win' : ''}"><td>${b.rank ?? '-'}</td><td>${coLink(b.bizno, b.name)}<small>${esc(b.ceo || '')}</small></td>
        <td class="num">${b.amount != null ? b.amount.toLocaleString('ko-KR') : '-'}</td><td class="num">${pct(b.rate)}</td><td>${esc(b.note || '')}</td></tr>`).join('')}
      </tbody></table></div>
      ${/협상/.test(r.award || '') ? '<div class="note">협상에 의한 계약이라 가격 순위와 실제 낙찰자가 다를 수 있어요.</div>' : ''}`);
  } else if (r.status === '유찰') {
    parts.push(`<div class="section-title">유찰</div><div class="note">${esc(r.note || '응찰 업체가 없거나 조건을 갖춘 업체가 없어 유찰됐어요.')}</div>`);
  } else if (!r.bidders) {
    parts.push('<div class="note">아직 개찰 결과가 등록되지 않았어요.</div>');
  }
  const links = [`<a class="cta" href="${esc(r.url)}" target="_blank" rel="noopener">나라장터 공고 보기 ${svg(OUT)}</a>`];
  if (r.contract?.url) links.push(`<a class="cta ghost" href="${esc(r.contract.url)}" target="_blank" rel="noopener">계약 상세 ${svg(OUT)}</a>`);
  const facts = [
    r.amount != null && ['추정가격', won(r.amount)],
    r.method && ['계약방법(공고)', esc(r.method)],
    r.award && ['낙찰방법', esc(r.award.replace(/^협상에의한계약-/, ''))],
    r.deadline && ['입찰 마감', esc(dueLabel(parseDeadline(r.deadline)))],
  ].filter(Boolean);
  return `<div class="detail">
    <div class="tiles">${facts.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    ${parts.join('')}
    <div class="cta-row">${links.join('')}</div>
  </div>`;
}

// ---------- 업체 ----------
async function renderCompanies() {
  const root = $('view-companies');
  if (!root.dataset.ready) {
    root.dataset.ready = '1';
    root.innerHTML = `<div id="cList"></div><div id="cDetail" hidden></div>`;
  }
  try {
    await load('companies');
  } catch {
    $('cList').innerHTML = `<section class="hero"><h1>업체</h1></section>${emptyState('아직 업체 데이터가 없어요', '마감 공고 결과가 모이면 함께 만들어져요.')}`;
    return;
  }
  const m = location.hash.match(/^#company\/(\d+)/);
  if (m) { $('cList').hidden = true; $('cDetail').hidden = false; drawCompany(m[1]); }
  else { $('cDetail').hidden = true; $('cList').hidden = false; drawCompanyList(); }
}

function drawCompanyList() {
  const el = $('cList');
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    const all = data.companies.items;
    const won = all.filter((c) => c.stats.wins).length;
    el.innerHTML = `
      <section class="hero"><h1>공고에 나온 업체 <em>${all.length}</em>곳</h1>
        <p>수주한 회사 ${won}곳 · 컨소시엄으로 이어진 회사 ${all.filter((c) => c.partners.length).length}곳. 줄을 누르면 그 회사로 가요.</p></section>
      <a class="gx-teaser" href="#galaxy">
        <span class="gx-teaser-t"><b>관계도에서 한눈에 보기</b><span>업체와 발주기관을 별처럼 띄워, 누가 어디서 일을 받고 누구와 손잡는지 따라가 볼 수 있어요.</span></span>
        <span class="gx-teaser-go">열기 →</span></a>
      <div class="toolbar"><div class="inner">
        <div class="search">${SEARCH}<input type="search" id="cq" placeholder="회사명·대표자·사업자번호로 검색" aria-label="업체 검색"></div>
        <div class="chips" id="cChips"><button class="chip" data-s="wins">수주 많은 순</button><button class="chip" data-s="amount">수주액 순</button>
          <button class="chip" data-s="bids">참여 많은 순</button><button class="chip" data-s="rate">수주율 순</button><button class="chip" data-s="recent">최근 활동 순</button></div></div></div>
      <div class="count" id="cCount"></div><div id="cRows"></div>`;
    $('cq').addEventListener('input', (e) => { cs.q = e.target.value.trim().toLowerCase(); drawCompanyRows(); });
    $('cChips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { cs.sort = b.dataset.s; drawCompanyRows(); } });
    $('cRows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-biz]'); if (tr && !e.target.closest('a')) location.hash = 'company/' + tr.dataset.biz; });
  }
  drawCompanyRows();
}

function drawCompanyRows() {
  document.querySelectorAll('#cChips [data-s]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === cs.sort));
  const rate = (c) => (c.stats.bids ? c.stats.wins / c.stats.bids : 0);
  const key = { wins: (c) => c.stats.wins * 1e6 + c.stats.wonAmount / 1e6, bids: (c) => c.stats.bids, amount: (c) => c.stats.wonAmount, rate: (c) => (c.stats.bids >= 2 ? rate(c) * 1000 + c.stats.bids : rate(c)), recent: (c) => parseDeadline(c.stats.lastAt) || 0 }[cs.sort];
  const rows = data.companies.items
    .filter((c) => !cs.q || [c.name, c.ceo, c.bizno, c.basic?.region].join(' ').toLowerCase().includes(cs.q.replace(/-/g, '')))
    .sort((a, b) => key(b) - key(a));
  const maxAmt = Math.max(1, ...rows.map((c) => c.stats.wonAmount));
  $('cCount').innerHTML = `<span><b>${rows.length}</b>곳</span>`;
  if (!rows.length) { $('cRows').innerHTML = emptyState('찾는 업체가 없어요', '이름이나 사업자번호를 확인해 보세요.'); return; }
  $('cRows').innerHTML = `<div class="board"><table class="lead">
    <thead><tr><th class="num">#</th><th>회사</th><th class="num">참여</th><th class="num">수주</th><th>수주율</th><th>수주액</th><th class="num hide-s">파트너</th><th class="num hide-s">직원</th></tr></thead><tbody>
    ${rows.slice(0, 300).map((c, i) => {
      const r = rate(c), emp = c.nps?.length ? c.nps[c.nps.length - 1].cnt : c.basic?.employees;
      return `<tr data-biz="${esc(c.bizno)}">
        <td class="num rk">${i + 1}</td>
        <td><a class="co" href="#company/${esc(c.bizno)}">${esc(c.name)}</a><small>${esc([c.basic?.region?.split(' ').slice(0, 2).join(' '), c.ceo].filter(Boolean).join(' · '))}</small></td>
        <td class="num">${c.stats.bids}</td><td class="num">${c.stats.wins ? `<b class="ok">${c.stats.wins}</b>` : '<span class="mute">0</span>'}</td>
        <td><span class="rate"><i style="width:${Math.round(r * 100)}%"></i></span><span class="rate-t">${Math.round(r * 100)}%</span></td>
        <td><span class="amt-bar"><i style="width:${(c.stats.wonAmount / maxAmt) * 100}%"></i></span><span class="amt-t">${c.stats.wonAmount ? eok(c.stats.wonAmount) : '-'}</span></td>
        <td class="num hide-s">${c.stats.partners || '<span class="mute">-</span>'}</td><td class="num hide-s">${emp ?? '<span class="mute">-</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function drawCompany(bizno) {
  const c = data.byBizno.get(bizno);
  const el = $('cDetail');
  if (!c) { el.innerHTML = `<p class="back"><a href="#companies">← 업체 목록</a></p>${emptyState('업체를 찾지 못했어요', '목록에서 다시 골라 주세요.')}`; return; }
  const s = c.stats;
  const winRate = s.bids ? Math.round((s.wins / s.bids) * 100) : null;
  const emp = c.nps?.length ? c.nps[c.nps.length - 1].cnt : c.basic?.employees;
  const tiles = [
    ['참여', `${s.bids}<small>건</small>`], ['수주', `${s.wins}<small>건</small>`],
    ['수주율', winRate != null ? `${winRate}<small>%</small>` : '-'], ['수주액(지분 기준)', s.wonAmount ? eok(s.wonAmount) : '-'],
  ];
  const info = [
    ['대표자', esc(c.ceo || '-')], ['사업자번호', bizFmt(c.bizno)],
    c.basic?.opened && ['설립', esc(c.basic.opened)], emp != null && ['직원', `${emp}명`], c.basic?.address && ['주소', esc(c.basic.address)],
    c.basic?.homepage && ['홈페이지', `<a href="${esc(/^https?:/.test(c.basic.homepage) ? c.basic.homepage : 'http://' + c.basic.homepage)}" target="_blank" rel="noopener">${esc(c.basic.homepage)}</a>`],
    c.industries?.length && ['등록 업종', c.industries.map((i) => `<span class="lic">${esc(i.name)}</span>`).join('')],
  ].filter(Boolean);
  el.innerHTML = `
    <p class="back"><a href="#companies">← 업체 목록</a></p>
    <section class="hero co-hero"><h1>${esc(c.name)}</h1><p>${[c.basic?.region, c.basic?.kinds].filter(Boolean).map(esc).join(' · ') || '조달 등록 정보 없음'}</p></section>
    <section class="stats">${tiles.map(([k, v]) => `<div class="stat" role="presentation"><div class="label">${k}</div><div class="value">${v}</div></div>`).join('')}</section>
    <section class="panel"><div class="section-title panel-h"><span>관계도 <small>컨소시엄 파트너와 그 파트너, 같은 공고에서 겨룬 회사</small></span><a class="more" href="#galaxy/c:${esc(c.bizno)}">우주에서 보기 →</a></div><div class="net ego" id="egoGraph"></div>
      <div class="rel-cols">
        <div><div class="sub-title">함께한 회사 (컨소시엄)</div>${relList(c.partners, '공동계약', true)}</div>
        <div><div class="sub-title">같은 공고에서 겨룬 회사</div>${relList(c.rivals, '공고')}</div>
      </div></section>
    <div class="two-col">
      <section class="panel"><div class="section-title">기본 정보</div><div class="facts">${info.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div></section>
      <section class="panel"><div class="section-title">직원 수 추이 <small>국민연금 가입자 기준</small></div>${npsChart(c)}</section>
    </div>
    <section class="panel"><div class="section-title">재무 <small>DART · 외부감사 대상만</small></div>${dartTable(c)}</section>
    <section class="panel"><div class="section-title">참여 이력 ${c.history.length}건</div>${historyTable(c)}</section>`;
  drawEgo($('egoGraph'), c);
  window.scrollTo(0, 0);
}


function relList(list, unit, withShare) {
  if (!list?.length) return '<div class="note">아직 없어요.</div>';
  return `<div class="rel">${list.map((p) => `<a href="#company/${esc(p.bizno)}"><span>${esc(p.name)}</span><small>${p.count}${unit === '공고' ? '번' : '건'}${withShare && p.share != null ? ` · 지분 ${p.share}%` : ''}</small></a>`).join('')}</div>`;
}

function historyTable(c) {
  if (!c.history.length) return '<div class="note">이력이 없어요.</div>';
  return `<div class="rank-wrap"><table class="rank hist"><thead><tr><th>개찰</th><th>공고</th><th>역할·순위</th><th class="num">금액</th><th>결과</th></tr></thead><tbody>
    ${c.history.map((h) => `<tr class="${h.won ? 'win' : ''}"><td>${shortDay(h.openedAt)}</td>
      <td><a class="co" href="#results" data-goto="${esc(h.id)}">${esc(h.title)}</a><small>${esc(h.org || '')}</small></td>
      <td>${h.rank != null ? `${h.rank}위` : esc(h.role || '')}${h.share != null && h.share < 100 ? ` · ${h.share}%` : ''}</td>
      <td class="num">${h.contractAmount ? eok(h.contractAmount) : h.bidAmount ? eok(h.bidAmount) : '-'}</td>
      <td>${h.won ? '<span class="badge st-ok">수주</span>' : h.status === '유찰' ? '<span class="badge st-bad">유찰</span>' : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function npsChart(c) {
  const pts = c.nps || [];
  if (pts.length < 2) {
    const one = pts[0] ? `${pts[0].cnt}명 (${pts[0].ym.slice(0, 4)}.${pts[0].ym.slice(4)})` : c.basic?.employees ? `조달청 등록 직원 수 ${c.basic.employees}명` : '';
    return `<div class="note">${one ? esc(one) + ' · ' : ''}${pts.length ? '추이를 그리려면 몇 달치가 더 필요해요.' : '국민연금 가입 사업장에서 찾지 못했어요(3인 미만 법인 등).'}</div>`;
  }
  const W = 640, H = 160, P = 28;
  // 세로축은 0부터 시작해 작은 변화를 부풀리지 않는다.
  const max = Math.max(...pts.map((p) => p.cnt)), min = 0;
  const span = Math.max(1, max - min);
  const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
  const line = pts.map((p, i) => `${x(i)},${y(p.cnt)}`).join(' ');
  const first = pts[0].cnt, last = pts[pts.length - 1].cnt, diff = last - first;
  return `<div class="nps-head"><b>${last}명</b><span class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${diff}명 (${pts.length}개월)</span></div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="직원 수 추이">
      <polyline points="${P},${H - P} ${line} ${W - P},${H - P}" class="area"/>
      <polyline points="${line}" class="line"/>
      ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.cnt)}" r="3.5"><title>${p.ym.slice(0, 4)}.${p.ym.slice(4)} ${p.cnt}명</title></circle>`).join('')}
      <text x="${P}" y="${H - 6}">${pts[0].ym.slice(2, 4)}.${pts[0].ym.slice(4)}</text>
      <text x="${W - P}" y="${H - 6}" text-anchor="end">${pts[pts.length - 1].ym.slice(2, 4)}.${pts[pts.length - 1].ym.slice(4)}</text>
    </svg>`;
}

function dartTable(c) {
  const ys = c.dart || [];
  if (!ys.length) return '<div class="note">DART 공시 재무가 없어요. 외부감사 대상이 아닌 회사는 공시하지 않아요.</div>';
  const rows = ['매출액', '영업이익', '당기순이익', '자산총계', '부채총계', '자본총계'];
  const sorted = [...ys].sort((a, b) => a.year - b.year);
  return `<div class="rank-wrap"><table class="rank"><thead><tr><th></th>${sorted.map((y) => `<th class="num">${y.year}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r}</td>${sorted.map((y) => `<td class="num">${y[r] != null ? eok(y[r]) : '-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- 그래프 ----------
const short = (n) => String(n || '').replace(/주식회사|\(주\)|㈜/g, '').trim();
const scoreOf = (c) => c.stats.wins * 3 + Math.log10(1 + c.stats.wonAmount / 1e7) * 2 + c.stats.bids * 0.5;
// 회사 → 그래프 점. 크기는 수주(건수·금액)와 참여로 정한다.
function toNode(c, max) {
  return { id: c.bizno, name: c.name, bids: c.stats.bids, wins: c.stats.wins, amountText: c.stats.wonAmount ? '수주 ' + eok(c.stats.wonAmount) : '', sub: c.basic?.region || '', size: Math.min(1, scoreOf(c) / max) };
}
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// 한 회사 중심: 파트너, 파트너의 파트너, 겨룬 회사(상위 14곳)
async function drawEgo(el, c) {
  const by = data.byBizno;
  const set = new Set([c.bizno]);
  const links = new Map();
  const addP = (a, p) => { if (!by.has(p.bizno)) return; set.add(p.bizno); links.set(pairKey(a, p.bizno) + '|p', { source: a, target: p.bizno, kind: 'partner', count: p.count, share: p.share != null ? p.share + '%' : '' }); };
  for (const p of c.partners || []) addP(c.bizno, p);
  for (const p of c.partners || []) for (const q of by.get(p.bizno)?.partners || []) addP(p.bizno, q);
  for (const r of (c.rivals || []).slice(0, 14)) { if (!by.has(r.bizno)) continue; set.add(r.bizno); links.set(pairKey(c.bizno, r.bizno) + '|r', { source: c.bizno, target: r.bizno, kind: 'rival', count: r.count }); }
  if (set.size < 2) { el.innerHTML = '<div class="note pad">이어진 회사가 아직 없어요.</div>'; return; }
  const list = [...set].map((b) => by.get(b));
  const max = Math.max(1, ...list.map(scoreOf));
  const { networkGraph } = await import('./graph.js');
  networkGraph(el, { nodes: list.map((x) => toNode(x, max)), links: [...links.values()], focus: c.bizno, height: 420, onOpen: (id) => id !== c.bizno && (location.hash = 'company/' + id) });
}


// ---------- 메뉴 이동 ----------
// ---------- 관계도 (우주 보기) ----------
let galaxy = null;
async function renderGalaxy() {
  const root = $('view-galaxy');
  const want = decodeURIComponent((location.hash.match(/^#galaxy\/(.+)/) || [])[1] || '');
  try {
    if (!galaxy) {
      root.innerHTML = '<div class="gx-state"><div class="v-spin"></div>별을 띄우는 중이에요</div>';
      galaxy = (async () => {
        const [c, r] = await Promise.all([load('companies'), load('results')]);
        const { openGalaxy } = await import('./galaxy.js');
        return openGalaxy(root, { companies: c.items, results: r.items });
      })();
    }
    const g = await galaxy;
    if ($('view-galaxy').hidden) { g.pause(); return; }
    g.resume();
    if (want) g.focus(want);
  } catch (e) {
    galaxy = null;
    console.error(e);
    root.innerHTML = '<div class="gx-state"><b>관계도를 열지 못했어요</b>이 브라우저에서 3D 그래픽(WebGL)을 쓸 수 없거나 데이터가 아직 없어요.<a class="gx-cta" href="#companies">업체 목록으로</a></div>';
  }
}

function route() {
  const h = location.hash;
  const tab = /^#results/.test(h) ? 'results' : /^#compan/.test(h) ? 'companies' : /^#galaxy/.test(h) ? 'galaxy' : 'open';
  for (const t of ['open', 'results', 'companies', 'galaxy']) $('view-' + t).hidden = t !== tab;
  document.body.classList.toggle('space', tab === 'galaxy');
  if (tab === 'galaxy') renderGalaxy(); else galaxy?.then((g) => g.pause()).catch(() => {});
  document.querySelectorAll('.tabs [data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (tab === 'results') renderResults();
  if (tab === 'companies') renderCompanies();
}
// 업체 이력에서 공고를 누르면 결과 화면에서 그 공고를 펼친다.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto]');
  if (!a) return;
  rs.open.add(a.dataset.goto);
  rs.q = '';
  setTimeout(() => {
    const card = document.querySelector(`#rList button.head[data-id="${CSS.escape(a.dataset.goto)}"]`);
    card?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -120);
  }, 150);
});
window.addEventListener('hashchange', () => { route(); if (!/^#company\//.test(location.hash)) window.scrollTo(0, 0); });
route();

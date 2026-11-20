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
    $('rFoot').textContent = `출처: ${d.source || '-'} · 갱신 ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}`;
    drawResults();
  } catch (e) {
    $('rList').innerHTML = emptyState('아직 결과 데이터가 없어요', '다음 자동 갱신 때 모아요.');
  }
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
    el.innerHTML = `
      <section class="hero"><h1>공고에 나온 업체 <em>${all.length}</em>곳</h1>
        <p>참여·수주 이력과 함께한 회사, 겨룬 회사를 모았어요. 점을 누르면 그 회사로 가요.</p></section>
      <section class="graph-card"><div class="graph-head"><b>관계도</b><span class="legend"><i class="lg-p"></i>컨소시엄 <i class="lg-r"></i>같은 공고에서 경쟁</span></div>
        <div id="netGraph" class="net"></div></section>
      <div class="toolbar"><div class="inner">
        <div class="search">${SEARCH}<input type="search" id="cq" placeholder="회사명·대표자·사업자번호로 검색" aria-label="업체 검색"></div>
        <div class="chips" id="cChips"><button class="chip" data-s="wins">수주 많은 순</button><button class="chip" data-s="bids">참여 많은 순</button>
          <button class="chip" data-s="amount">수주액 순</button><button class="chip" data-s="recent">최근 활동 순</button></div></div></div>
      <div class="count" id="cCount"></div><div id="cRows" class="list-grid"></div>`;
    $('cq').addEventListener('input', (e) => { cs.q = e.target.value.trim().toLowerCase(); drawCompanyRows(); });
    $('cChips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { cs.sort = b.dataset.s; drawCompanyRows(); } });
    drawNetwork($('netGraph'), all);
  }
  drawCompanyRows();
}

function drawCompanyRows() {
  document.querySelectorAll('#cChips [data-s]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === cs.sort));
  const key = { wins: (c) => c.stats.wins * 1000 + c.stats.bids, bids: (c) => c.stats.bids, amount: (c) => c.stats.wonAmount, recent: (c) => parseDeadline(c.stats.lastAt) || 0 }[cs.sort];
  const rows = data.companies.items
    .filter((c) => !cs.q || [c.name, c.ceo, c.bizno, c.basic?.region].join(' ').toLowerCase().includes(cs.q.replace(/-/g, '')))
    .sort((a, b) => key(b) - key(a));
  $('cCount').innerHTML = `<span><b>${rows.length}</b>곳</span>`;
  $('cRows').innerHTML = rows.slice(0, 300).map((c) => `<a class="card co-card" href="#company/${esc(c.bizno)}">
      <span class="icon i-${c.stats.wins ? 'map' : 'etc'}">${svg(ICON_CO)}</span>
      <span class="body"><span class="title">${esc(c.name)}</span>
        <span class="meta"><span>${esc(c.ceo || '')}</span>${c.basic?.region ? `<span class="dot">${esc(c.basic.region)}</span>` : ''}${c.nps?.length ? `<span class="dot">직원 ${c.nps[c.nps.length - 1].cnt}명</span>` : c.basic?.employees ? `<span class="dot">직원 ${c.basic.employees}명</span>` : ''}</span>
        <span class="badges"><span class="badge">참여 ${c.stats.bids}</span>${c.stats.wins ? `<span class="badge st-ok">수주 ${c.stats.wins}</span>` : ''}${c.stats.partners ? `<span class="badge rg">파트너 ${c.stats.partners}</span>` : ''}</span></span>
      <span class="side"><span class="amount">${c.stats.wonAmount ? eok(c.stats.wonAmount) : '-'}</span><span class="sub"><span class="alabel">수주액</span></span></span>
    </a>`).join('') || emptyState('찾는 업체가 없어요', '이름이나 사업자번호를 확인해 보세요.');
}

function drawCompany(bizno) {
  const c = data.byBizno.get(bizno);
  const el = $('cDetail');
  if (!c) { el.innerHTML = `<p class="back"><a href="#companies">← 업체 목록</a></p>${emptyState('업체를 찾지 못했어요', '목록에서 다시 골라 주세요.')}`; return; }
  const s = c.stats;
  const winRate = s.bids ? Math.round((s.wins / s.bids) * 100) : null;
  const tiles = [
    ['참여', `${s.bids}<small>건</small>`], ['수주', `${s.wins}<small>건</small>`],
    ['수주율', winRate != null ? `${winRate}<small>%</small>` : '-'], ['수주액(지분 기준)', s.wonAmount ? eok(s.wonAmount) : '-'],
  ];
  const info = [
    ['대표자', esc(c.ceo || '-')], ['사업자번호', bizFmt(c.bizno)],
    c.basic?.opened && ['설립', esc(c.basic.opened)], c.basic?.address && ['주소', esc(c.basic.address)],
    c.basic?.homepage && ['홈페이지', `<a href="${esc(/^https?:/.test(c.basic.homepage) ? c.basic.homepage : 'http://' + c.basic.homepage)}" target="_blank" rel="noopener">${esc(c.basic.homepage)}</a>`],
    c.industries?.length && ['등록 업종', c.industries.map((i) => `<span class="lic">${esc(i.name)}</span>`).join('')],
  ].filter(Boolean);
  el.innerHTML = `
    <p class="back"><a href="#companies">← 업체 목록</a></p>
    <section class="hero co-hero"><h1>${esc(c.name)}</h1><p>${[c.basic?.region, c.basic?.kinds].filter(Boolean).map(esc).join(' · ') || '조달 등록 정보 없음'}</p></section>
    <section class="stats">${tiles.map(([k, v]) => `<div class="stat" role="presentation"><div class="label">${k}</div><div class="value">${v}</div></div>`).join('')}</section>
    <section class="panel"><div class="section-title">기본 정보</div><div class="facts">${info.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div></section>
    <section class="panel"><div class="section-title">직원 수 추이 <small>국민연금 가입자 기준</small></div>${npsChart(c)}</section>
    <section class="panel"><div class="section-title">재무 <small>DART · 외부감사 대상만</small></div>${dartTable(c)}</section>
    <section class="panel"><div class="section-title">관계도</div><div class="ego" id="egoGraph"></div>
      <div class="rel-cols">
        <div><div class="sub-title">함께한 회사 (컨소시엄)</div>${relList(c.partners, '공동계약', true)}</div>
        <div><div class="sub-title">같은 공고에서 겨룬 회사</div>${relList(c.rivals, '공고')}</div>
      </div></section>
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
const NS = 'http://www.w3.org/2000/svg';
// 한 회사를 가운데 두고, 안쪽 원에 컨소시엄 파트너, 바깥 원에 경쟁사를 놓는다.
function drawEgo(el, c) {
  const partners = (c.partners || []).slice(0, 10), rivals = (c.rivals || []).slice(0, 12);
  if (!partners.length && !rivals.length) { el.innerHTML = '<div class="note">이어진 회사가 아직 없어요.</div>'; return; }
  const W = 640, H = 420, cx = W / 2, cy = H / 2;
  const nodes = [{ ...c, x: cx, y: cy, kind: 'me' }];
  const ring = (list, r, kind, off) => list.forEach((p, i) => {
    const a = off + (i / list.length) * Math.PI * 2;
    nodes.push({ ...p, x: cx + Math.cos(a) * r * 1.35, y: cy + Math.sin(a) * r, kind });
  });
  ring(partners, 110, 'partner', -Math.PI / 2);
  ring(rivals, 180, 'rival', -Math.PI / 2 + Math.PI / Math.max(rivals.length, 1));
  const maxCount = Math.max(1, ...nodes.slice(1).map((n) => n.count || 1));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="graph" role="img" aria-label="${esc(c.name)} 관계도">`;
  for (const n of nodes.slice(1)) s += `<line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" class="e-${n.kind}" stroke-width="${1 + (3 * (n.count || 1)) / maxCount}"/>`;
  for (const n of nodes) {
    const r = n.kind === 'me' ? 16 : 7 + (6 * (n.count || 1)) / maxCount;
    const label = n.name.replace(/주식회사|\(주\)|㈜/g, '').trim();
    s += `<a href="#company/${esc(n.bizno)}"><g class="n-${n.kind}"><circle cx="${n.x}" cy="${n.y}" r="${r}"/><text x="${n.x}" y="${n.y + r + 13}" text-anchor="middle">${esc(label.length > 10 ? label.slice(0, 10) + '…' : label)}</text><title>${esc(n.name)}${n.count ? ` · ${n.count}` : ''}</title></g></a>`;
  }
  el.innerHTML = s + '</svg>';
}

// 활동이 많은 회사들의 전체 관계도. 간단한 힘 배치(force layout)로 자리를 잡는다.
function drawNetwork(el, all) {
  // 이어진 회사만 그린다: 컨소시엄은 모두, 경쟁은 두 번 이상 겨뤘거나 둘 다 자주 나오는 회사끼리.
  const by = new Map(all.map((c) => [c.bizno, c]));
  const active = (b) => (by.get(b)?.stats.bids || 0) >= 3;
  const raw = [];
  for (const c of all) {
    for (const p of c.partners || []) if (by.has(p.bizno) && c.bizno < p.bizno) raw.push({ a: c.bizno, b: p.bizno, w: p.count, kind: 'partner' });
    for (const p of c.rivals || []) if (by.has(p.bizno) && c.bizno < p.bizno && (p.count >= 2 || (active(c.bizno) && active(p.bizno)))) raw.push({ a: c.bizno, b: p.bizno, w: p.count, kind: 'rival' });
  }
  const deg = new Map();
  for (const e of raw) for (const k of [e.a, e.b]) deg.set(k, (deg.get(k) || 0) + (e.kind === 'partner' ? 3 : 1));
  const top = [...deg.keys()].map((b) => by.get(b))
    .sort((x, y) => deg.get(y.bizno) + y.stats.wins * 2 + y.stats.bids - (deg.get(x.bizno) + x.stats.wins * 2 + x.stats.bids)).slice(0, 60);
  const idx = new Map(top.map((c, i) => [c.bizno, i]));
  const edges = raw.filter((e) => idx.has(e.a) && idx.has(e.b)).map((e) => ({ ...e, a: idx.get(e.a), b: idx.get(e.b) }));
  if (top.length < 2) { el.innerHTML = '<div class="note">관계도를 그릴 만큼 이어진 업체가 아직 없어요.</div>'; return; }
  const W = 900, H = 460;
  // 처음 자리는 원 위에, 이후 반발력·스프링·중심 인력으로 다듬는다(결과는 매번 같다).
  const N = top.map((c, i) => ({ c, x: W / 2 + Math.cos((i / top.length) * 6.283) * 180, y: H / 2 + Math.sin((i / top.length) * 6.283) * 160, vx: 0, vy: 0, r: 5 + Math.min(12, c.stats.bids + c.stats.wins * 2) }));
  for (let it = 0; it < 320; it++) {
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const a = N[i], b = N[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
      const f = 2600 / d2, d = Math.sqrt(d2);
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const e of edges) {
      const a = N[e.a], b = N[e.b];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const k = (e.kind === 'partner' ? 0.04 : 0.012) * (d - (e.kind === 'partner' ? 60 : 110));
      a.vx += (dx / d) * k; a.vy += (dy / d) * k; b.vx -= (dx / d) * k; b.vy -= (dy / d) * k;
    }
    for (const n of N) {
      n.vx += (W / 2 - n.x) * 0.004; n.vy += (H / 2 - n.y) * 0.006;
      n.x += Math.max(-8, Math.min(8, n.vx)); n.y += Math.max(-8, Math.min(8, n.vy));
      n.vx *= 0.6; n.vy *= 0.6;
      n.x = Math.max(40, Math.min(W - 40, n.x)); n.y = Math.max(24, Math.min(H - 30, n.y));
    }
  }
  const maxW = Math.max(1, ...edges.map((e) => e.w));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="graph" role="img" aria-label="업체 관계도">`;
  for (const e of edges.sort((x, y) => (x.kind === 'rival' ? -1 : 1))) s += `<line x1="${N[e.a].x}" y1="${N[e.a].y}" x2="${N[e.b].x}" y2="${N[e.b].y}" class="e-${e.kind}" stroke-width="${0.8 + (2.5 * e.w) / maxW}"/>`;
  for (const n of N) {
    const label = n.c.name.replace(/주식회사|\(주\)|㈜/g, '').trim();
    s += `<a href="#company/${esc(n.c.bizno)}"><g class="n-${n.c.stats.wins ? 'win' : 'plain'}"><circle cx="${n.x}" cy="${n.y}" r="${n.r}"/><text x="${n.x}" y="${n.y + n.r + 12}" text-anchor="middle">${esc(label.length > 8 ? label.slice(0, 8) + '…' : label)}</text><title>${esc(n.c.name)} · 참여 ${n.c.stats.bids} · 수주 ${n.c.stats.wins}</title></g></a>`;
  }
  el.innerHTML = s + '</svg>';
}

// ---------- 메뉴 이동 ----------
function route() {
  const h = location.hash;
  const tab = /^#results/.test(h) ? 'results' : /^#compan/.test(h) ? 'companies' : 'open';
  for (const t of ['open', 'results', 'companies']) $('view-' + t).hidden = t !== tab;
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

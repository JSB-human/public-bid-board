// "마감·결과"와 "업체" 화면. 진행 중 공고 화면(index.html 안 스크립트)의 공용 함수
// (esc, won, svg, ICONS, kindOf, parseDeadline, dueLabel …)를 같이 쓴다.

import { companyHistoryStats } from './company-stats.js';

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const data = { results: null, companies: null, byBizno: new Map() };
const pending = {};
const rs = { org: '', open: new Set(), sel: null };
const resultSearch = new WeakMap();
const cs = { q: '', sort: 'wins', limit: 300 };

// ---------- 공용 ----------
async function load(name) {
  if (data[name]) return data[name];
  pending[name] ??= fetch(`data/${name}.json`, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((payload) => {
      if (name === 'companies') for (const c of payload.items) data.byBizno.set(c.bizno, c);
      return (data[name] = payload);
    })
    .finally(() => { delete pending[name]; });
  return pending[name];
}
const shortDay = (s) => { const t = parseDeadline(s); if (t === null) return ''; const d = new Date(t + 9 * 3600000); return `${d.getUTCFullYear() % 100}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`; };
const eok = (n) => (n == null ? '-' : n >= 1e8 ? (n / 1e8).toFixed(n >= 1e10 ? 0 : 1) + '억' : Math.round(n / 1e4).toLocaleString('ko-KR') + '만');
// 큰 합계는 조·억으로 끊어 읽기 쉽게 (13426억 → 1조 3,426억)
const eokLong = (n) => { const e = Math.round(n / 1e8), jo = Math.floor(e / 1e4); return (jo ? `${jo}<small>조</small> ` : '') + `${(e % 1e4).toLocaleString('ko-KR')}<small>억</small>`; };
const pct = (n) => (n == null ? '' : `${Number(n).toFixed(2).replace(/\.?0+$/, '')}%`);
const bizFmt = (b) => (b && b.length === 10 ? `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` : b || '');
const coLink = (bizno, name) => (bizno ? `<a class="co" href="#company/${esc(bizno)}">${esc(name)}</a>` : esc(name));
const short = (name) => String(name || '').replace(/주식회사|\(주\)|㈜/g, '').trim();
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
      <div class="board-workspace">
        <div class="split board-split">
          <section class="col-list" aria-labelledby="resultListTitle">
        <div class="board-page-head"><h1>마감·결과</h1><p>진행 중 목록과 같은 조건에 맞던 공고의 참여 업체·낙찰·계약 결과예요.</p></div>
          <details class="overview board-overview" id="resultOverview" open>
            <summary>마감·결과 통계</summary>
            <div class="board-overview-content"><section class="stats" id="rStats" aria-label="검색 조건의 공고 통계"></section>
              <section class="dash" id="rDash"></section></div>
          </details>
        <div class="toolbar board-toolbar">
          <div class="board-filters">
          <div class="search">${SEARCH}<input type="search" id="rq" placeholder="사업명·발주기관·업체명·공고번호 검색" aria-label="결과 검색"><kbd aria-hidden="true">/</kbd></div>
          <div class="filter-fields board-primary-filters">
            <label>개찰 연도 <select id="rYear"><option value="">전체 연도</option></select></label>
            <label>결과 <select id="rStatus"><option value="">전체 결과</option><option value="won">낙찰·계약</option><option value="joint">공동계약</option><option value="failed">유찰</option><option value="wait">결과 대기</option><option value="rebid">재입찰</option></select></label>
          </div>
          </div>
          <div class="filter-foot board-options">
          <details class="filter-more" id="rMore"><summary>상세 조건</summary><div class="filter-fields">
            <label>개찰 월 <select id="rMonth"><option value="">전체 월</option>${Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}월</option>`).join('')}</select></label>
            <label>공공조달 분류 <select id="rCategory"><option value="">전체 분류</option></select></label>
            <label>계약 방법 <select id="rMethod"><option value="">전체 계약 방법</option></select></label>
          </div></details>
          </div>
        </div>
<div class="list-card">
            <div class="board-list-head"><h2 id="resultListTitle">결과 목록</h2><span id="resultListCount" aria-live="polite"></span></div>
            <div class="list-overview" id="rSummary"></div>
            <div class="count" id="rCount" hidden></div>
            <div id="rList" class="rows" tabindex="0" role="region" aria-label="마감 공고 목록"></div>
          </div><footer id="rFoot"></footer></section>
          <aside class="pane board-detail" id="rPane" aria-label="고른 공고 결과"></aside>
        </div>
      </div>`;
    $('rq').addEventListener('input', drawResults);
    resultSelects().forEach((el) => el.addEventListener('change', drawResults));
    $('rCount').addEventListener('click', (e) => {
      if (e.target.id !== 'rReset') return;
      resetResultFilters();
      history.replaceState(null, '', '#results');
      $('rq').focus();
      drawResults();
    });
    $('resultOverview').addEventListener('toggle', renderResultStats);
    root.addEventListener('input', filterBidderList);
    $('rList').addEventListener('click', (e) => {
      if (e.target.closest('.more-btn')) { appendResults(); return; }
      const h = e.target.closest('button.row');
      if (h) selectResult(h.dataset.id);
    });
    window.addEventListener('layoutchange', () => { if (!root.hidden) drawResults(); });
  }
  try {
    const d = await load('results');
    if ($('rYear').options.length === 1) {
      setOptions($('rYear'), yearsOf(d.items, resultDate).map((year) => [year, `${year}년`]));
      setOptions($('rCategory'), groupedOptions(d.items.map(categoryOf)));
      setOptions($('rMethod'), groupedOptions(d.items.map((r) => r.method)));
    }
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const org = params.get('org');
    if (gotoResult) {
      resetResultFilters();
      $('rq').value = gotoResult;
    } else if (org) {
      resetResultFilters();
      rs.org = org;
      const year = params.get('year');
      if (year && [...$('rYear').options].some((option) => option.value === year)) $('rYear').value = year;
    } else rs.org = '';
    $('rFoot').textContent = `출처: ${d.source || '-'} · 갱신 ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}`;
    drawResults();
  } catch (e) {
    $('rList').innerHTML = emptyState('아직 결과 데이터가 없어요', '다음 자동 갱신 때 모아요.');
  }
}

const resultSelects = () => ['rYear', 'rStatus', 'rMonth', 'rCategory', 'rMethod'].map($);

function resetResultFilters() {
  rs.org = '';
  if (!$('rq')) return;
  $('rq').value = '';
  for (const select of resultSelects()) select.selectedIndex = 0;
}

const resultGroup = (r) => r.winner || r.contract ? 'won' : r.status === '유찰' ? 'failed' : 'wait';

function resultTotals(items) {
  const totals = { won: 0, failed: 0, wait: 0, joint: 0, contractAmount: 0, participants: 0, counted: 0 };
  for (const r of items) {
    totals[resultGroup(r)]++;
    if (r.contract?.joint) totals.joint++;
    if (Number.isFinite(r.contract?.amount)) totals.contractAmount += r.contract.amount;
    if (Number.isFinite(r.participants)) { totals.participants += r.participants; totals.counted++; }
  }
  return totals;
}

function renderResultStats() {
  if (!$('resultOverview').open || !data.results) return;
  const items = rView.rows;
  const totals = resultTotals(items);
  const average = totals.counted
    ? (totals.participants / totals.counted).toFixed(1) + '<small>곳</small>'
    : '-';
  $('rStats').innerHTML = [
    ['공동계약', countText(totals.joint) + '<small>건</small>'],
    ['참여 수 확인', countText(totals.counted) + '<small>건</small>'],
    ['평균 참여', average],
    ['계약금액 합계', totals.contractAmount ? eokLong(totals.contractAmount) : '-'],
  ].map(([k, v]) => `<div class="stat" role="presentation"><div class="label">${k}</div><div class="value">${v}</div></div>`).join('');
  $('rDash').innerHTML = dashboard(items, $('rYear').value);
}

// 한눈에 보기: 월별 결과, 많이 따 간 회사, 많이 발주한 기관
function dashboard(items, year) {
  const periods = new Map();
  for (const r of items) {
    const date = resultDate(r);
    const key = yearOf(date) ? date.slice(0, year ? 7 : 4) : '';
    const p = periods.get(key) || { total: 0, won: 0, failed: 0, wait: 0 };
    p.total++;
    p[resultGroup(r)]++;
    periods.set(key, p);
  }
  const periodRows = [...periods].sort((a, b) => b[0].localeCompare(a[0])).map(([key, p]) =>
    `<tr><th scope="row">${key ? year ? `${Number(key.slice(5))}월` : `${esc(key)}년` : '미등록'}</th><td>${countText(p.total)}</td><td>${countText(p.won)}</td><td>${countText(p.failed)}</td><td>${countText(p.wait)}</td>
      <td class="pt-bar"><span class="pbar" title="낙찰·계약 ${countText(p.won)} · 유찰 ${countText(p.failed)} · 대기 ${countText(p.wait)}"><i class="o" style="flex:${p.won}"></i><i class="f" style="flex:${p.failed}"></i><i class="w" style="flex:${p.wait}"></i></span></td></tr>`).join('');
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
    <div class="dash-card wide"><div class="dash-h"><b>${year ? `${esc(year)}년 월별 결과` : '연도별 결과'}</b></div>
      <table class="period-table"><thead><tr><th>기간</th><th>공고</th><th><i class="lgd o"></i>낙찰·계약</th><th><i class="lgd f"></i>유찰</th><th><i class="lgd w"></i>대기</th><th class="pt-bar" aria-label="결과 비율"></th></tr></thead><tbody>${periodRows}</tbody></table>
      <div class="note">개찰일 기준이며 개찰일이 없으면 입찰 마감일을 사용해요.</div></div>
    <div class="dash-card"><div class="dash-h"><b>많이 따 간 회사</b><span>지분 기준 금액</span></div>${hbar(topCo, (x) => x.amt, maxCo, (x) => `${eok(x.amt)} · ${x.n}건`, true) || '<div class="note">아직 없어요.</div>'}</div>
    <div class="dash-card"><div class="dash-h"><b>많이 발주한 기관</b><span>건수</span></div>${hbar(topOrg, (x) => x.n, maxOrg, (x) => `${x.n}건`, false)}</div>`;
}

function drawResults() {
  const items = data.results?.items || [];
  const [year, status, month, category, method] = resultSelects().map((el) => el.value);
  const terms = searchTerms($('rq').value);
  const rows = items.filter((r) => {
    const date = resultDate(r);
    if (year && yearOf(date) !== year || month && date.slice(5, 7) !== month) return false;
    if (rs.org && r.org !== rs.org || category && categoryOf(r) !== category || method && r.method !== method) return false;
    if (status === 'joint' && !r.contract?.joint) return false;
    if (status === 'rebid' && r.status !== '재입찰') return false;
    if (status && status !== 'joint' && status !== 'rebid' && resultGroup(r) !== status) return false;
    if (terms.length) {
      if (!resultSearch.has(r)) resultSearch.set(r, searchKey([
        r.title, r.org, r.id, `${r.id}-${r.ord}`, categoryOf(r), r.winner?.name,
        ...(r.bidders || []).map((b) => b.name), ...(r.contract?.members || []).map((m) => m.name),
      ].join(' ')));
      if (!terms.every((term) => resultSearch.get(r).includes(term))) return false;
    }
    return true;
  });
  const W = wide();
  const moreCount = [month, category, method].filter(Boolean).length;
  $('rMore').querySelector('summary').textContent = moreCount ? `상세 조건 (${moreCount})` : '상세 조건';
  const totals = resultTotals(rows);
  $('resultListCount').textContent = `${countText(rows.length)}건`;
  $('rSummary').innerHTML = listOverview('', [
    ['낙찰·계약', `${countText(totals.won)}건`],
    ['유찰', `${countText(totals.failed)}건`], ['결과 대기', `${countText(totals.wait)}건`],
  ]);
  const active = !!(terms.length || year || status || moreCount || rs.org);
  $('rCount').hidden = !active;
  $('rCount').innerHTML = `<span>${esc(rs.org)}</span>${active ? '<button class="chip" id="rReset" style="height:28px;font-size:13px">검색 조건 초기화</button>' : ''}`;
  $('rList').scrollTop = 0;
  if (!rows.length) {
    $('rList').innerHTML = emptyState('조건에 맞는 결과가 없어요', '검색어나 필터를 바꿔 보세요.');
    rView = { rows, shown: 0, W };
    watchMore();
    showPane(null);
    renderResultStats();
    return;
  }
  if (W && !rows.some((r) => r.id === rs.sel)) rs.sel = rows[0].id;
  // 수천 건을 한 번에 그리면 화면이 버벅인다. 처음엔 조금만 그리고, 끝에 닿을 때마다 이어 붙인다(무한 스크롤).
  // 선택한 공고가 첫 묶음에 가까우면 함께 표시한다.
  const at = rows.findIndex((r) => r.id === rs.sel);
  rView = { rows, shown: Math.min(rows.length, at < R_CHUNK * 2 ? Math.max(R_CHUNK, at + 20) : R_CHUNK), W };
  $('rList').innerHTML = rows.slice(0, rView.shown).map((r) => resultRow(r, W)).join('') + moreSentinel();
  watchMore();
  showPane(W ? rows.find((r) => r.id === rs.sel) : null);
  renderResultStats();
  if (gotoResult && !$('view-results').hidden) {
    $('rList').querySelector(`button.row[data-id="${CSS.escape(gotoResult)}"]`)?.scrollIntoView({ block: 'center' });
    gotoResult = null;
  }
}

const R_CHUNK = 60;
let rView = { rows: [], shown: 0, W: false };
let rObserver = null;
let gotoResult = null;
const moreSentinel = () => (rView.shown < rView.rows.length
  ? `<div class="more-sentinel"><button class="more-btn">${rView.rows.length - rView.shown}건 더 보기</button></div>` : '');

function appendResults() {
  const s = $('rList').querySelector('.more-sentinel');
  if (!s) return;
  const next = rView.rows.slice(rView.shown, rView.shown + R_CHUNK);
  rView.shown += next.length;
  s.insertAdjacentHTML('beforebegin', next.map((r) => resultRow(r, rView.W)).join(''));
  if (rView.shown >= rView.rows.length) s.remove();
  else s.querySelector('.more-btn').textContent = `${rView.rows.length - rView.shown}건 더 보기`;
}

// 목록 끝이 화면 가까이 오면 다음 묶음을 붙인다. 감시가 안 되는 환경에서는 "더 보기" 버튼으로 넘긴다.
function watchMore() {
  rObserver?.disconnect();
  const s = $('rList').querySelector('.more-sentinel');
  if (!s || !('IntersectionObserver' in window)) return;
  const list = $('rList');
  const root = getComputedStyle(list).overflowY === 'auto' ? list : null;
  rObserver = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) appendResults(); }, { root, rootMargin: '800px 0px' });
  rObserver.observe(s);
}
// 감시가 늦거나 안 될 때를 위한 예비: 스크롤할 때 끝이 가까우면 붙인다(목록 칸 안 스크롤도 잡도록 capture).
let rScrollTick = false;
document.addEventListener('scroll', () => {
  if (rScrollTick) return;
  rScrollTick = true;
  setTimeout(() => {
    rScrollTick = false;
    const s = document.querySelector('#rList .more-sentinel');
    if (!s?.offsetParent) return;
    const list = $('rList');
    const bottom = getComputedStyle(list).overflowY === 'auto' ? list.getBoundingClientRect().bottom : innerHeight;
    if (s.getBoundingClientRect().top < bottom + 800) appendResults();
  }, 120);
}, { capture: true, passive: true });

function showPane(cur) {
  if ($('rPane').dataset.id === (cur ? cur.id : '')) return;
  $('rPane').innerHTML = cur ? resultPane(cur) : '';
  $('rPane').dataset.id = cur ? cur.id : '';
  $('rPane').scrollTop = 0;
}

// 줄을 누르면 목록 전체를 다시 그리지 않고 그 줄(넓은 화면이면 선택 표시와 오른쪽 상세)만 바꾼다.
function selectResult(id) {
  const r = rView.rows.find((x) => x.id === id);
  if (!r) return;
  const btnOf = (x) => $('rList').querySelector(`button.row[data-id="${CSS.escape(x)}"]`);
  if (rView.W) {
    const prev = rs.sel && btnOf(rs.sel);
    if (prev) { prev.closest('article').classList.remove('sel'); prev.setAttribute('aria-current', 'false'); }
    rs.sel = id;
    const b = btnOf(id);
    if (b) { b.closest('article').classList.add('sel'); b.setAttribute('aria-current', 'true'); }
    showPane(r);
  } else {
    rs.open.has(id) ? rs.open.delete(id) : rs.open.add(id);
    const b = btnOf(id);
    if (b) b.closest('article').outerHTML = resultRow(r, false);
  }
}

// 넓은 화면: 위·아래 화살표(또는 j·k)로 결과를 넘겨 본다. 아직 안 그린 줄이면 이어 붙이고 간다.
document.addEventListener('keydown', (e) => {
  if (!wide() || $('view-results').hidden || !(e.target instanceof Element) || e.target.closest('input, textarea, select') || document.querySelector('.viewer.show')) return;
  const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
  if (!step || !rView.rows.length || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = rView.rows.findIndex((r) => r.id === rs.sel), j = Math.max(0, Math.min(rView.rows.length - 1, i + step));
  if (j === i) return;
  e.preventDefault();
  while (j >= rView.shown) appendResults();
  selectResult(rView.rows[j].id);
  $('rList').querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
});

const leadOf = (r) => r.contract?.members?.[0] || r.winner;
const whoOf = (r) => { const l = leadOf(r); return l ? short(l.name) + (r.contract?.members?.length > 1 ? ` 외 ${r.contract.members.length - 1}곳` : '') : ''; };
const amountOf = (r) => [r.contract?.amount || r.winner?.amount || r.amount, r.contract?.amount ? '계약' : r.winner?.amount ? '낙찰' : '추정'];

function resultRow(r, W) {
  const on = W ? rs.sel === r.id : rs.open.has(r.id);
  const [st, cls] = statusOf(r);
  // 금액이 0 으로 등록된 계약(해외 사업 등)은 금액이 없는 것으로 본다.
  const [amount, amountLabel] = amountOf(r);
  const who = whoOf(r);
  // 왼쪽 칸: 결과(낙찰·유찰·계약…)와 개찰일. 오른쪽: 금액. 가운데 셋째 줄: 누가 가져갔는지.
  const day = shortDay(r.openedAt || r.deadline).replace(/^\d+\./, '').replace('.', '/');
  const shortSt = { '개찰 완료': '개찰', '결과 대기': '대기', '재입찰': '재입찰' }[st] || st;
  return `<article class="item ${on ? (W ? 'sel' : 'open') : ''}">
    <button class="row" data-id="${esc(r.id)}" ${W ? `aria-current="${on}"` : `aria-expanded="${on}"`}>
      <span class="when st-${cls || 'none'}"><b>${esc(shortSt)}</b><small>${day}</small></span>
      <span class="rbody">
        <span class="rtitle">${esc(r.title)}</span>
        <span class="rmeta"><span>${esc(r.org)}</span>${r.participants != null ? `<span class="rkind">${r.participants}곳 참여</span>` : ''}</span>
        ${who ? `<span class="rwho">${esc(who)}${r.contract?.joint ? '<span class="flag rg">공동</span>' : ''}</span>` : ''}
      </span>
      <span class="rside"><b>${eok(amount)}</b><small>${amountLabel}</small></span>
    </button>
    ${!W && on ? resultDetail(r) : ''}
  </article>`;
}

// 오른쪽 상세의 머리: 결과를 한 줄로
function resultPane(r) {
  const [st, cls] = statusOf(r);
  const [amount, amountLabel] = amountOf(r);
  const kind = kindOf(r), lead = leadOf(r);
  const companies = r.contract?.members?.length || 0;
  const checks = [
    r.participants != null && ['참여', r.participants + '곳', ''],
    r.winner?.rate != null && ['투찰률', pct(r.winner.rate), ''],
    r.contract && ['계약 형태', r.contract.joint ? `공동 ${r.contract.members?.length || ''}곳` : '단독', ''],
  ].filter(Boolean);
  return `<div class="pane-h">
      <div class="pane-tags"><span class="badge"><i class="kd k-${kind}"></i>${KINDS[kind]}</span><span class="badge st-${cls}">${st}</span>${r.reNotice ? '<span class="badge re">재공고</span>' : ''}</div>
      <h2>${esc(r.title)}</h2>
      <div class="pane-org">${esc(r.org)}${r.openedAt ? ` · ${shortDay(r.openedAt)} 개찰` : ''}</div>
    </div>
    ${resultDetail(r)}`;
}

const bidderNameKey = (name) => String(name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function filterBidderList(e) {
  if (!e.target.matches('[data-bidder-search]')) return;
  const list = e.target.closest('.bidder-list');
  const query = bidderNameKey(e.target.value);
  const rows = list.querySelectorAll('[data-bidder-name]');
  let matchCount = 0;
  for (const row of rows) {
    row.hidden = !row.dataset.bidderName.includes(query);
    if (!row.hidden) matchCount++;
  }
  list.querySelector('.bidder-count').textContent = query ? `${matchCount}곳 / 전체 ${rows.length}곳` : `${rows.length}곳`;
  list.querySelector('.rank-wrap').hidden = !matchCount;
  list.querySelector('.bidder-empty').hidden = !!matchCount;
}

function resultDetail(r) {
  const parts = [];
  const outcome = [];
  if (r.contract) {
    const k = r.contract;
    const members = (k.members || []).map((m) => `<div class="member">
        <span class="role ${/주계약|대표/.test(m.role) ? 'lead' : ''}">${esc(m.role || '구성사')}</span>
        <span class="mname">${coLink(m.bizno, m.name)}<small>${esc(m.ceo || '')}</small></span>
        <span class="share"><span class="bar"><i style="width:${Math.max(2, m.share ?? 0)}%"></i></span><b>${m.share ?? '-'}%</b></span>
        <span class="mamt">${k.amount && m.share != null ? eok((k.amount * m.share) / 100) : ''}</span>
      </div>`).join('');
    outcome.push(`<div class="section-title">계약 ${k.joint ? '· 공동계약' : ''}</div>
      <div class="tiles">
        <div class="tile"><div class="k">계약금액</div><div class="v">${k.amount ? won(k.amount) : '등록 안 됨'}</div></div>
        <div class="tile"><div class="k">계약일</div><div class="v">${esc(k.date || '-')}</div></div>
        <div class="tile wide"><div class="k">계약방법</div><div class="v">${esc(k.method || '-')}${k.reason ? `<small class="reason">${esc(k.reason)}</small>` : ''}</div></div>
      </div>
      <div class="members">${members}</div>`);
  } else if (r.winner) {
    // 낙찰 업체·금액은 위 한눈에 칸에 이미 있다. 여기서는 계약 전이라는 것만 알린다.
    outcome.push(`<div class="note">${coLink(r.winner.bizno, r.winner.name)}가 ${won(r.winner.amount)}(투찰률 ${pct(r.winner.rate)})에 낙찰됐어요. 계약이 등록되면 컨소시엄 구성사와 지분이 함께 나와요.</div>`);
  }
  if (r.status === '유찰') {
    outcome.push(`<div class="section-title">유찰</div><div class="note">${esc(r.note || '응찰 업체가 없거나 조건을 갖춘 업체가 없어 유찰됐어요.')}</div>`);
  }
  if (r.bidders?.length) {
    const winBiz = new Set([r.winner?.bizno, ...(r.contract?.members || []).map((m) => m.bizno)].filter(Boolean));
    parts.push(`<section class="bidder-list">
      <div class="bidder-header">
        <h3>참여 업체 <span class="bidder-count" aria-live="polite">${r.bidders.length}곳</span></h3>
        <div class="search bidder-search">${SEARCH}<input type="search" data-bidder-search placeholder="업체명 검색" aria-label="참여 업체명 검색"></div>
      </div>
      <div class="rank-wrap"><table class="rank"><thead><tr><th>순위</th><th>업체</th><th class="num">투찰금액</th><th class="num">투찰률</th><th>비고</th></tr></thead><tbody>
      ${r.bidders.map((b) => `<tr data-bidder-name="${esc(bidderNameKey(b.name))}" class="${winBiz.has(b.bizno) ? 'win' : ''}"><td>${b.rank ?? '-'}</td><td>${coLink(b.bizno, b.name)}<small>${esc(b.ceo || '')}</small></td>
        <td class="num">${b.amount != null ? b.amount.toLocaleString('ko-KR') : '-'}</td><td class="num">${pct(b.rate)}</td><td>${esc(b.note || '')}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="note bidder-empty" hidden>일치하는 업체가 없어요.</div>
      <div class="note">입찰은 대표사 이름으로 나와요.</div>
      ${/협상/.test(r.award || '') ? '<div class="note">협상에 의한 계약이라 가격 순위와 실제 낙찰자가 다를 수 있어요.</div>' : ''}
      </section>`);
  } else if (r.participants > 0) {
    parts.push('<div class="note">나라장터 참여 업체 명단 확인 중이에요.</div>');
  } else if (!r.bidders && r.status !== '유찰') {
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
  // 한눈에: 금액 · 누가 가져갔나 · 몇 곳이 들어왔나
  const [st, cls] = statusOf(r);
  const [amount, amountLabel] = amountOf(r);
  const lead = leadOf(r), companies = r.contract?.members?.length || 0;
  const keyrow = `<div class="keyrow">
      <div class="kf kf-amt"><small>${amountLabel === '추정' ? '추정가격' : `${amountLabel}금액`}</small><b>${won(amount)}</b>${amountLabel !== '추정' && r.amount ? `<span>추정 ${eok(r.amount)}</span>` : ''}</div>
      <div class="kf ${cls === 'bad' ? 'soon' : ''}"><small>${lead ? (r.contract ? '계약 업체' : '낙찰 업체') : '결과'}</small><b class="kf-who">${lead ? coLink(lead.bizno, short(lead.name)) : esc(st)}</b><span>${companies > 1 ? `공동 ${companies}곳` : lead ? esc(st) : ''}</span></div>
      <div class="kf"><small>참여</small><b>${r.participants != null ? r.participants + '곳' : '-'}</b><span>${r.winner?.rate != null ? '투찰률 ' + pct(r.winner.rate) : ''}</span></div>
    </div>
    <div class="pane-actions">${links.join('')}</div>`;
  return `<div class="detail">
    ${keyrow}
    ${outcome.length ? `<h3 class="psec">누가 가져갔나요</h3>${outcome.join('').replace(/<div class="section-title">[^<]*<\/div>/g, '')}` : ''}
    ${parts.join('')}
    <h3 class="psec">공고 정보</h3>
    <div class="tiles">${facts.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
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
      <section class="hero"><h1>공고에 나온 업체 <em>${countText(all.length)}</em>곳</h1>
        <p>수주한 회사 ${countText(won)}곳 · 컨소시엄으로 이어진 회사 ${countText(all.filter((c) => c.partners.length).length)}곳. 줄을 누르면 그 회사로 가요.</p></section>
      <a class="gx-teaser" href="#galaxy">
        <span class="gx-teaser-t"><b>관계도에서 한눈에 보기</b><span>업체와 발주기관을 별처럼 띄워, 누가 어디서 일을 받고 누구와 손잡는지 따라가 볼 수 있어요.</span></span>
        <span class="gx-teaser-go">열기 →</span></a>
      <div class="toolbar"><div class="inner">
        <div class="search">${SEARCH}<input type="search" id="cq" placeholder="회사명·대표자·사업자번호로 검색" aria-label="업체 검색"><kbd aria-hidden="true">/</kbd></div>
        <div class="chips" id="cChips"><button class="chip" data-s="wins">수주 많은 순</button><button class="chip" data-s="amount">수주액 순</button>
          <button class="chip" data-s="bids">참여 많은 순</button><button class="chip" data-s="rate">수주율 순</button><button class="chip" data-s="recent">최근 활동 순</button></div></div></div>
      <div class="count" id="cCount"></div><div id="cRows"></div>`;
    $('cq').addEventListener('input', (e) => { cs.q = e.target.value.trim().toLowerCase(); cs.limit = 300; drawCompanyRows(); });
    $('cChips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { cs.sort = b.dataset.s; cs.limit = 300; drawCompanyRows(); } });
    $('cRows').addEventListener('click', (e) => { if (e.target.closest('#cMore')) { cs.limit += 300; drawCompanyRows(); return; } const tr = e.target.closest('tr[data-biz]'); if (tr && !e.target.closest('a')) location.hash = 'company/' + tr.dataset.biz; });
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
  $('cCount').innerHTML = `<span><b>${countText(rows.length)}</b>곳${rows.length > cs.limit ? ` 가운데 위 ${countText(cs.limit)}곳` : ''}</span>`;
  if (!rows.length) { $('cRows').innerHTML = emptyState('찾는 업체가 없어요', '이름이나 사업자번호를 확인해 보세요.'); return; }
  $('cRows').innerHTML = `<div class="board" tabindex="0" role="region" aria-label="업체 목록"><table class="lead">
    <thead><tr><th class="num">#</th><th>회사</th><th class="num">참여</th><th class="num">수주</th><th>수주율</th><th>수주액</th><th class="num hide-s">파트너</th><th class="num hide-s">직원</th></tr></thead><tbody>
    ${rows.slice(0, cs.limit).map((c, i) => {
      const r = rate(c), emp = c.nps?.length ? c.nps[c.nps.length - 1].cnt : c.basic?.employees;
      return `<tr data-biz="${esc(c.bizno)}">
        <td class="num rk">${i + 1}</td>
        <td><a class="co" href="#company/${esc(c.bizno)}">${esc(c.name)}</a><small>${esc([c.basic?.region?.split(' ').slice(0, 2).join(' '), c.ceo].filter(Boolean).join(' · '))}</small></td>
        <td class="num">${c.stats.bids}</td><td class="num">${c.stats.wins ? `<b class="ok">${c.stats.wins}</b>` : '<span class="mute">0</span>'}</td>
        <td><span class="rate"><i style="width:${Math.round(r * 100)}%"></i></span><span class="rate-t">${Math.round(r * 100)}%</span></td>
        <td><span class="amt-bar"><i style="width:${(c.stats.wonAmount / maxAmt) * 100}%"></i></span><span class="amt-t">${c.stats.wonAmount ? eok(c.stats.wonAmount) : '-'}</span></td>
        <td class="num hide-s">${c.stats.partners || '<span class="mute">-</span>'}</td><td class="num hide-s">${emp ?? '<span class="mute">-</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>${rows.length > cs.limit ? `<button class="more-btn" id="cMore">${countText(Math.min(300, rows.length - cs.limit))}곳 더 보기 (남은 ${countText(rows.length - cs.limit)}곳)</button>` : ''}`;
}

function drawCompany(bizno) {
  const c = data.byBizno.get(bizno);
  const el = $('cDetail');
  if (!c) { el.innerHTML = `<p class="back"><a href="#companies">← 업체 목록</a></p>${emptyState('업체를 찾지 못했어요', '목록에서 다시 골라 주세요.')}`; return; }
  const region = c.basic?.region;
  const kinds = c.basic?.kinds?.split(',').map((kind) => kind.trim()).filter(Boolean) || [];
  const historyByYear = new Map();
  for (const bid of c.history) {
    const year = yearOf(resultDate(bid));
    if (!year) continue;
    if (!historyByYear.has(year)) historyByYear.set(year, []);
    historyByYear.get(year).push(bid);
  }
  const years = [...historyByYear.keys()].sort();
  const yearlyStats = new Map(years.map((year) => [year, companyHistoryStats(historyByYear.get(year))]));
  const allStats = companyHistoryStats(c.history);
  const emp = c.nps?.length ? c.nps[c.nps.length - 1].cnt : c.basic?.employees;
  const info = [
    ['대표자', esc(c.ceo || '-')], ['사업자번호', bizFmt(c.bizno)],
    c.basic?.opened && ['설립', esc(c.basic.opened)], emp != null && ['직원', `${emp}명`], c.basic?.address && ['주소', esc(c.basic.address)],
    c.basic?.homepage && ['홈페이지', `<a href="${esc(/^https?:/.test(c.basic.homepage) ? c.basic.homepage : 'http://' + c.basic.homepage)}" target="_blank" rel="noopener">${esc(c.basic.homepage)}</a>`],
    c.industries?.length && ['등록 업종', c.industries.map((i) => `<span class="lic">${esc(i.name)}</span>`).join('')],
  ].filter(Boolean);
  el.innerHTML = `
    <div class="company-header board-page-head">
      <div class="company-identity">
        <h1 id="companyName">${esc(c.name)}</h1>
        <div class="company-meta">${region ? `<span>${esc(region)}</span>` : ''}${kinds.length ? `<span>${kinds.map(esc).join(' · ')}</span>` : ''}${!region && !kinds.length ? '<span>조달 등록 정보 없음</span>' : ''}</div>
      </div>
      <div class="company-identity-actions">
        <a class="company-back" href="#companies">← 업체 목록</a>
        <label class="company-period">실적 연도 <select class="year-pick" id="companyYear" aria-controls="companyPerformance companyHistoryRows"><option value="">전체 연도</option></select></label>
      </div>
    </div>
    <section class="company-hero" aria-label="조달 실적 요약">
      <div id="companyPerformance" aria-live="polite">
        <div class="company-primary-stat">
          <p class="company-amount-label"><span id="companyPeriodLabel">전체</span> 수주액</p>
          <p class="company-amount" id="companyWonAmount"></p>
          <p class="company-amount-basis">업체 지분 기준</p>
        </div>
        <dl class="company-metrics" id="companyMetrics" aria-label="업체 실적"></dl>
      </div>
      ${companyAwardTrend(yearlyStats, data.companies.updatedAt)}
    </section>
    <div class="company-workspace board-split">
        <section class="company-history" id="companyHistory">
          <div class="company-section-head board-list-head"><h2>참여 이력</h2><span id="companyHistoryCount"></span></div>
          <div id="companyHistoryRows"></div>
        </section>
      <div class="company-column board-detail" aria-label="업체 정보" role="region">
        <section class="company-relations">
          <div class="company-section-head"><h2>협력·경쟁 업체</h2><a class="more" href="#galaxy/c:${esc(c.bizno)}">전체 관계도</a></div>
          <div class="company-relation-headings"><h3 id="companyPartners">협력 업체</h3><h3 id="companyRivals">경쟁 업체</h3></div>
          <div class="company-relation-lists" aria-label="전체 기간 협력·경쟁 업체 목록" role="region" tabindex="0">
            ${relList(c.partners, 'companyPartners', true)}${relList(c.rivals, 'companyRivals')}
          </div>
        </section>
        <section class="company-workforce">
          <div class="company-section-head"><h2>직원 수 추이</h2><span>국민연금 가입자 기준</span></div>
          ${npsChart(c)}
        </section>
        <section class="company-finance">
          <div class="company-section-head"><h2>재무</h2><span>DART 공시 · 억 원</span></div>
          ${dartTable(c)}
        </section>
      </div>
    </div>
    <section class="company-basics"><h2>기본 정보</h2><dl class="company-facts">${info.map(([k, v]) => `<div${k === '주소' || k === '등록 업종' ? ' class="wide-fact"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
  const yearPick = $('companyYear');
  setOptions(yearPick, years.slice().reverse().map((year) => [year, `${year}년`]));
  const drawPerformance = () => {
    const year = yearPick.value;
    const rows = historyByYear.get(year) ?? c.history;
    const { bids, wins, wonAmount } = yearlyStats.get(year) ?? allStats;
    const rate = bids ? Math.round(wins / bids * 100) : null;
    const amount = wonAmount ? eok(wonAmount) : '';
    const tiles = [
      ['참여', `${countText(bids)}<small>건</small>`],
      ['수주', `${countText(wins)}<small>건</small>`],
      ['수주율', rate == null ? '–' : `${rate}<small>%</small>`],
    ];
    $('companyPeriodLabel').textContent = year ? `${year}년` : '전체';
    $('companyWonAmount').innerHTML = amount ? `<span title="${countText(wonAmount)}원">${amount.slice(0, -1)}<small>${amount.slice(-1)} 원</small></span>` : wins ? '–' : '0<small>원</small>';
    $('companyMetrics').innerHTML = tiles.map(([label, value]) => `<div class="company-metric"><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    $('companyHistoryCount').textContent = `${countText(bids)}건`;
    $('companyHistoryRows').innerHTML = historyTable(rows);
    for (const bar of el.querySelectorAll('.company-award-bar')) bar.classList.toggle('is-current', bar.dataset.year === year);
  };
  yearPick.addEventListener('change', drawPerformance);
  drawPerformance();
  window.scrollTo(0, 0);
}

function companyAwardTrend(yearlyStats, updatedAt) {
  if (!yearlyStats.size) return '<p class="note">연도별 수주액을 확인할 수 없어요.</p>';
  const values = [...yearlyStats].map(([year, stats]) => [year, stats.wonAmount]);
  const scale = 1.6 * Math.max(1, ...values.map(([, amount]) => amount));
  const snapshot = Date.parse(updatedAt);
  const date = Number.isFinite(snapshot) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(snapshot) : '';
  const labels = values.map(([year, amount]) => `${year}년 ${countText(amount)}원`).join(', ');
  return `<figure class="company-awards"><figcaption><strong>연도별 수주액</strong><span>억 원${date ? ` · ${esc(date)} 기준` : ''}</span></figcaption>
    <div class="company-award-bars" role="img" aria-label="연도별 수주액. ${esc(labels)}" style="--award-count:${values.length}">
      ${values.map(([year, amount]) => `<div class="company-award-bar" data-year="${esc(year)}" title="${countText(amount)}원"><div class="company-award-track"><div class="company-award-fill" style="--award-height:${amount / scale * 100}%"><b>${companyEokNumber(amount)}</b></div></div><span>${esc(year)}</span></div>`).join('')}
    </div></figure>`;
}

function companyEokNumber(amount) {
  const value = Math.abs(amount) / 1e8;
  const decimals = value >= 100 ? 0 : value >= 1 ? 1 : 4;
  return `${amount < 0 ? '−' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: decimals })}`;
}

function relList(list, label, withShare) {
  if (!list?.length) return '<div class="note">기록 없음</div>';
  return `<ul class="company-relation-list" aria-labelledby="${label}">${list.map((p) => {
    const note = `${p.name} · ${p.count}건${withShare && p.share != null ? ` · 지분 ${p.share}%` : ''}`;
    const name = short(p.name) || p.name;
    return `<li><a href="#company/${esc(p.bizno)}" aria-label="${esc(note)}" title="${esc(note)}"><span>${esc(name)}</span><small>${countText(p.count)}건</small></a></li>`;
  }).join('')}</ul>`;
}

function historyTable(rows) {
  if (!rows.length) return '<div class="note">이력이 없어요.</div>';
  return `<div class="company-history-scroll" tabindex="0" role="region" aria-label="업체 참여 이력 전체 목록"><table class="rank hist"><thead><tr><th scope="col">공고 및 발주기관</th><th scope="col" class="num history-amount">금액 · 결과</th></tr></thead><tbody>
    ${rows.map((h) => {
      const role = (h.rank != null ? `${h.rank}위` : esc(h.role || '')) + (h.share != null && h.share < 100 ? ` · ${h.share}%` : '');
      const amount = h.contractAmount || h.bidAmount;
      const status = h.won ? '수주' : ['유찰', '재입찰'].includes(h.status) ? h.status : '참여';
      const date = shortDay(h.openedAt);
      return `<tr>
        <td><a class="co" href="#results" data-goto="${esc(h.id)}">${esc(h.title)}</a><small class="company-bid-meta">${[date && `개찰 ${date}`, esc(h.org || ''), role].filter(Boolean).join(' · ')}</small></td>
        <td class="num history-amount">${amount ? `<strong title="${countText(amount)}원">${eok(amount)}</strong>` : '–'}<small class="company-outcome${h.won ? ' is-won' : status !== '참여' ? ' is-failed' : ''}">${status}</small></td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function npsChart(c) {
  const pts = c.nps || [];
  if (pts.length < 2) {
    const one = pts[0] ? `${pts[0].cnt}명 (${pts[0].ym.slice(0, 4)}.${pts[0].ym.slice(4)})` : c.basic?.employees ? `조달청 등록 직원 수 ${c.basic.employees}명` : '';
    return `<p class="note">${one ? esc(one) + ' · ' : ''}${pts.length ? '월별 기록 1건' : '국민연금 가입자 기록 없음'}</p>`;
  }
  const W = 360, H = 70, left = 36, right = W - 9, top = 10, bottom = H - 18;
  const max = Math.max(10, ...pts.map((p) => p.cnt));
  const x = (i) => left + i * (right - left) / (pts.length - 1);
  const y = (v) => bottom - v / max * (bottom - top);
  const line = pts.map((p, i) => `${x(i)},${y(p.cnt)}`).join(' ');
  const first = pts[0].cnt, last = pts[pts.length - 1].cnt, diff = last - first;
  const start = pts[0].ym, end = pts[pts.length - 1].ym;
  return `<div class="company-staff-body"><div class="nps-head"><b>${countText(last)}<small>명</small></b><span>${pts.length}개월간 <strong class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${countText(diff)}명</strong></span></div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${start.slice(0, 4)}년 ${Number(start.slice(4))}월 ${first}명에서 ${end.slice(0, 4)}년 ${Number(end.slice(4))}월 ${last}명으로 변화">
      ${[max, 0].map((tick) => `<line class="gridline" x1="${left}" x2="${right}" y1="${y(tick)}" y2="${y(tick)}"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end">${countText(tick)}</text>`).join('')}
      <polyline points="${left},${bottom} ${line} ${right},${bottom}" class="area"/>
      <polyline points="${line}" class="line"/>
      ${pts.map((p, i) => `<circle${i === pts.length - 1 ? ' class="current"' : ''} cx="${x(i)}" cy="${y(p.cnt)}" r="${i === pts.length - 1 ? 3.5 : 2}"><title>${p.ym.slice(0, 4)}.${p.ym.slice(4)} ${p.cnt}명</title></circle>`).join('')}
      <text x="${left}" y="${H - 3}">${start.slice(2, 4)}.${start.slice(4)}</text>
      <text x="${right}" y="${H - 3}" text-anchor="end">${end.slice(2, 4)}.${end.slice(4)}</text>
    </svg></div>`;
}

function dartTable(c) {
  const ys = c.dart || [];
  if (!ys.length) return '<p class="note">확인된 DART 재무 공시가 없어요.</p>';
  const rows = ['매출액', '영업이익', '당기순이익', '자산총계', '부채총계', '자본총계'];
  const sorted = [...ys].sort((a, b) => a.year - b.year);
  return `<div class="rank-wrap"><table class="rank" aria-label="연도별 공시 재무, 단위 억 원"><thead><tr><th scope="col">항목</th>${sorted.map((y) => `<th scope="col" class="num">${y.year}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><th scope="row">${r}</th>${sorted.map((y) => {
      const value = y[r];
      return value == null ? '<td class="num">–</td>' : `<td class="num${value < 0 ? ' negative' : ''}" title="${countText(value)}원">${companyEokNumber(value)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
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
        const { openGalaxy } = await import('./galaxy.js?v=20261123-rival');
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
  if (tab === 'open') loadOrgHistory();
}
// 업체 이력에서 공고를 누르면 결과 화면에서 그 공고를 펼친다.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto]');
  if (!a) return;
  gotoResult = a.dataset.goto;
  rs.open.add(gotoResult);
  rs.sel = gotoResult;
  if (data.results && !$('view-results').hidden) {
    resetResultFilters();
    $('rq').value = gotoResult;
    drawResults();
  }
});
window.addEventListener('hashchange', () => { route(); if (!/^#company\//.test(location.hash)) window.scrollTo(0, 0); });
route();

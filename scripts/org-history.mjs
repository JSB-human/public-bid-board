// 진행 중 공고 상세에 필요한 기관별 통계와 최근 공고 5건을 만든다.
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../site/data/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const [bids, results] = await Promise.all([read('bids.json'), read('results.json')]);
const orgs = new Set(bids.items.map((bid) => bid.org));
const history = new Map();

for (const r of results.items) {
  if (!orgs.has(r.org)) continue;
  if (!history.has(r.org)) history.set(r.org, { total: 0, won: 0, failed: 0, counted: 0, participants: 0, recent: [] });
  const h = history.get(r.org);
  h.total++;
  if (r.winner || r.contract) h.won++;
  if (r.status === '유찰') h.failed++;
  if (r.participants) {
    h.counted++;
    h.participants += r.participants;
  }
  if (h.recent.length === 5) continue;
  const members = r.contract?.members;
  const lead = members?.[0] || r.winner;
  h.recent.push({
    id: r.id, title: r.title, failed: r.status === '유찰', participants: r.participants,
    amount: r.contract?.amount || r.winner?.amount || r.amount,
    lead: lead ? { name: lead.name, others: Math.max(0, (members?.length || 1) - 1) } : null,
  });
}

const entries = [...history].map(([org, { counted, participants, ...h }]) => [
  org, { ...h, average: counted ? participants / counted : null },
]);
await writeFile(new URL('org-history.json', dir), `[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);
console.log(`발주기관 이력 요약: ${entries.length}곳`);

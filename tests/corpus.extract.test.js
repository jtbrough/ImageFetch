const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const { extractCandidates, limitTotalCandidates } = require('../server.js');

const corpusDir = path.join(__dirname, 'fixtures', 'corpus');
const indexPath = path.join(corpusDir, 'index.tsv');

function parseIndex(tsv) {
  const lines = String(tsv || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
    if (cols.length < 4) continue;
    rows.push({
      id: cols[0],
      url: cols[1],
      file: cols[2],
      status: cols[3],
    });
  }
  return rows;
}

test('corpus extraction stays stable for fetched snapshots', { skip: !existsSync(indexPath) }, (t) => {
  const rows = parseIndex(readFileSync(indexPath, 'utf8')).filter((r) => r.status === 'ok');
  if (rows.length === 0) {
    t.skip('No successful corpus rows found. Run scripts/fetch-corpus.sh in a network-enabled environment.');
    return;
  }

  for (const row of rows) {
    const fixturePath = path.join(corpusDir, row.file);
    assert.ok(existsSync(fixturePath), `Fixture missing: ${row.file}`);
    const html = readFileSync(fixturePath, 'utf8');

    const groups = extractCandidates(html, row.url, 3);
    assert.equal(groups.length, 3, `Expected 3 groups for ${row.url}`);

    const limited = limitTotalCandidates(groups, 6);
    const total = limited.reduce((sum, g) => sum + g.items.length, 0);
    assert.ok(total > 0, `No candidates extracted for ${row.url}`);
    assert.ok(total <= 6, `Candidate limit exceeded for ${row.url}`);

    for (const group of limited) {
      for (const item of group.items) {
        assert.equal(typeof item.url, 'string', `Invalid item URL for ${row.url}`);
        assert.ok(item.url.length > 0, `Empty item URL for ${row.url}`);
        assert.equal(typeof item.filename, 'string', `Invalid filename for ${row.url}`);
      }
    }
  }
});

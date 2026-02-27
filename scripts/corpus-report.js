#!/usr/bin/env node
'use strict';

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { extractCandidates } = require('../server.js');

const corpusDir = path.join(__dirname, '..', 'tests', 'fixtures', 'corpus');
const indexPath = path.join(corpusDir, 'index.tsv');
const outPath = path.join(corpusDir, 'report.tsv');

function parseIndex(tsv) {
  const lines = String(tsv || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
    out.push({
      id: cols[0] || '',
      url: cols[1] || '',
      file: cols[2] || '',
      status: cols[3] || '',
      detail: cols[4] || '',
    });
  }
  return out;
}

if (!existsSync(indexPath)) {
  console.error(`Missing corpus index: ${indexPath}`);
  process.exit(1);
}

const rows = parseIndex(readFileSync(indexPath, 'utf8')).filter((r) => r.status === 'ok');
if (rows.length === 0) {
  console.error('No successful corpus rows. Run: just corpus-fetch');
  process.exit(2);
}

const reportLines = ['id\turl\tgroup\tsourceType\tfilename\tassetUrl'];
let totalAssets = 0;
for (const row of rows) {
  const fixturePath = path.join(corpusDir, row.file);
  if (!existsSync(fixturePath)) continue;
  const html = readFileSync(fixturePath, 'utf8');
  const groups = extractCandidates(html, row.url, 3);
  for (const group of groups) {
    for (const item of group.items) {
      totalAssets += 1;
      reportLines.push([
        row.id,
        row.url,
        group.key,
        item.sourceType || '',
        item.filename || '',
        item.url || '',
      ].join('\t'));
    }
  }
}

writeFileSync(outPath, `${reportLines.join('\n')}\n`, 'utf8');
console.log(`Corpus report written: ${outPath}`);
console.log(`Sites: ${rows.length}, Assets: ${totalAssets}`);

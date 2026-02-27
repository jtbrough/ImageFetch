const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { extractCandidates } = require('../server.js');

function loadFixture(name) {
  const p = path.join(__dirname, 'fixtures', name);
  return readFileSync(p, 'utf8');
}

function group(groups, key) {
  return groups.find((g) => g.key === key) || { items: [] };
}

function urls(items) {
  return items.map((i) => i.url);
}

test('google head: extracts favicon and image meta', () => {
  const html = loadFixture('google-head.html');
  const groups = extractCandidates(html, 'https://www.google.com/', 3);

  const favicons = urls(group(groups, 'favicon').items);
  const header = urls(group(groups, 'header-images').items);

  assert.ok(favicons.includes('https://www.gstatic.com/images/branding/searchlogo/ico/favicon.ico'));
  assert.ok(header.includes('https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png'));
});

test('github head: extracts explicit icon links', () => {
  const html = loadFixture('github-head.html');
  const groups = extractCandidates(html, 'https://github.com/', 3);

  const favicons = urls(group(groups, 'favicon').items);
  assert.ok(favicons.includes('https://github.githubassets.com/favicons/favicon.png'));
  assert.ok(favicons.includes('https://github.githubassets.com/favicons/favicon.svg'));
});

test('hacker news head: resolves relative favicon path', () => {
  const html = loadFixture('hn-head.html');
  const groups = extractCandidates(html, 'https://news.ycombinator.com/', 3);

  const favicons = urls(group(groups, 'favicon').items);
  assert.ok(favicons.includes('https://news.ycombinator.com/y18.svg'));
});

test('techmeme head: extracts shortcut icon, apple touch, and image_src', () => {
  const html = loadFixture('techmeme-head.html');
  const groups = extractCandidates(html, 'https://www.techmeme.com/', 3);

  const favicons = urls(group(groups, 'favicon').items);
  const apple = urls(group(groups, 'apple-touch-icon').items);
  const header = urls(group(groups, 'header-images').items);

  assert.ok(favicons.includes('https://www.techmeme.com/img/favicon.ico'));
  assert.ok(apple.includes('https://www.techmeme.com/m/config/tech/iicon.gif'));
  assert.ok(header.includes('https://www.techmeme.com/m/config/tech/iicon.gif'));
});

test('inline svg in header: emits a data-url header image candidate', () => {
  const html = loadFixture('inline-svg-header.html');
  const groups = extractCandidates(html, 'https://example.com/', 3);
  const headerItems = group(groups, 'header-images').items;
  const inline = headerItems.find((i) => i.sourceType === 'inline-svg');

  assert.ok(inline);
  assert.ok(inline.url.startsWith('data:image/svg+xml;base64,'));
  assert.equal(inline.filename, 'inline-logo.svg');
});

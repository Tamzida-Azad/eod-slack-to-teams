const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatEod } = require('../lib/format-eod');

const goldenDir = path.join(__dirname, 'fixtures', 'golden');

describe('golden format fixtures', () => {
  it('matches locked payloadText for sample EOD messages', () => {
    const sample = JSON.parse(
      fs.readFileSync(path.join(goldenDir, 'format-sample-input.json'), 'utf8')
    );
    const expected = fs.readFileSync(path.join(goldenDir, 'format-payload-text.txt'), 'utf8');
    const stats = JSON.parse(fs.readFileSync(path.join(goldenDir, 'format-stats.json'), 'utf8'));

    const formatted = formatEod(sample, { date: new Date('2026-09-03T17:00:00+06:00') });

    assert.equal(formatted.payloadText, expected);
    assert.equal(formatted.date, stats.date);
    assert.equal(formatted.personCount, stats.personCount);
    assert.equal(formatted.updateCount, stats.updateCount);
  });

  it('matches catch-up footer line', () => {
    const sample = JSON.parse(
      fs.readFileSync(path.join(goldenDir, 'format-sample-input.json'), 'utf8')
    );
    const expectedFooter = fs
      .readFileSync(path.join(goldenDir, 'format-payload-catchup-footer.txt'), 'utf8')
      .trim();
    const formatted = formatEod(sample, {
      date: new Date('2026-09-03T17:00:00+06:00'),
      catchUp: true,
    });
    const last = formatted.payloadText.split('\n').slice(-1)[0];
    assert.equal(last, expectedFooter);
  });
});

/**
 * Slack scrape via Web API (primary). Filter helpers re-exported for tests.
 */
const scrape = require('../lib/scrape-slack');
const windowHelpers = require('../lib/message-window');

module.exports = {
  ...windowHelpers,
  scrapeSlackEod: scrape.scrapeSlackEod,
  getDateWindow: windowHelpers.getDateWindow,
};

if (require.main === module) {
  const target = process.env.EOD_TARGET_DATE
    ? (() => {
        const [y, m, d] = process.env.EOD_TARGET_DATE.split('-').map(Number);
        return { year: y, month: m, day: d };
      })()
    : null;
  scrape
    .scrapeSlackEod({ targetDate: target })
    .then((r) => {
      console.log(JSON.stringify(r.stats || r, null, 2));
      console.log('Wrote messages JSON');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

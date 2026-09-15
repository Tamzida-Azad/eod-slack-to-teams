const { postToTeams, blocksToAdaptiveCard } = require('../lib/post-teams');

module.exports = { postToTeams, blocksToAdaptiveCard };

if (require.main === module) {
  const fs = require('fs');
  const config = require('../lib/config');
  const text = fs.readFileSync(config.paths.payloadTxt, 'utf8');
  const html = fs.existsSync(config.paths.payloadHtml)
    ? fs.readFileSync(config.paths.payloadHtml, 'utf8')
    : '';
  postToTeams(text, html)
    .then((r) => console.log(r))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

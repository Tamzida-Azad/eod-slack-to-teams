/** Re-export shared formatter */
module.exports = require('../lib/format-eod');

if (require.main === module) {
  require('../lib/format-eod');
}

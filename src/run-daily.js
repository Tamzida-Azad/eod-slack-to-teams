const {
  main,
  runDaily,
  attemptDay,
  processDayWithRetries,
  processDayOnce,
} = require('../lib/run-daily');

module.exports = {
  main,
  runDaily,
  attemptDay,
  processDayWithRetries,
  processDayOnce,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

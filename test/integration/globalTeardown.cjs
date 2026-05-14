const { teardown } = require('./_teardown.cjs');

module.exports = async function globalTeardown() {
    teardown();
};

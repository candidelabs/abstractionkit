// Shared constants between globalSetup (no status file yet) and _runnable
// (reads status file). Anything else that needs symbols both before and after
// the suite has booted should live here too.
module.exports = {
    SUPPORTED_ENTRYPOINTS: ['v6', 'v7', 'v8', 'v9'],
};

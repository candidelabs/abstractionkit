const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PID_FILE = path.join(os.tmpdir(), 'abstractionkit-anvil.pid');

module.exports = async function globalTeardown() {
    if (!fs.existsSync(PID_FILE)) return;
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    fs.unlinkSync(PID_FILE);
    try {
        process.kill(pid, 'SIGTERM');
    } catch {}
};

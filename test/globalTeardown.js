const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function globalTeardown() {
  console.log('Stopping test infrastructure...');
  try {
    execSync('docker compose -f docker-compose.test.yml down', { stdio: 'inherit' });
  } catch {}

  // Clean up config file
  const configPath = path.join(__dirname, '.test-config.json');
  try { fs.unlinkSync(configPath); } catch {}
};

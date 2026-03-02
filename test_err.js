const { execSync } = require('child_process');
try {
    execSync('npm run build', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
    require('fs').writeFileSync('build_err.txt', e.stdout + '\n' + e.stderr);
}

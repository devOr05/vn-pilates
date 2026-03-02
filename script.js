const esbuild = require('esbuild');
esbuild.build({ entryPoints: ['src/App.jsx'], outfile: 'out.js' })
    .catch((e) => {
        require('fs').writeFileSync('esbuild_err.json', JSON.stringify(e.errors, null, 2));
        process.exit(1);
    });

// Loads src/ethereUtils.ts directly so tests always run against the current
// source rather than a possibly-stale build artifact. We use TypeScript's
// `transpileModule` to strip types (no type-checking) and compile the result
// inline as a CommonJS module — fast (~50ms) and zero-config.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const srcPath = path.resolve(__dirname, '../src/ethereUtils.ts');
const source = fs.readFileSync(srcPath, 'utf8');

const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        removeComments: true,
    },
    fileName: srcPath,
});

const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(outputText, srcPath);

module.exports = m.exports;

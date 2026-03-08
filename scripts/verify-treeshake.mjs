/**
 * Verify that importing only `distill` from dom-distill does NOT
 * pull in the React Fiber integration code.
 *
 * Uses esbuild's metafile analysis to inspect which source modules
 * end up in the bundle.
 */

import { build } from 'esbuild';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 1. Create a temp entry that imports only distill
const entry = join(root, '__treeshake_test_entry.mjs');
writeFileSync(entry, `import { distill, filter, compress } from './dist/index.mjs';\nconsole.log(distill, filter, compress);\n`);

try {
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        metafile: true,
        treeShaking: true,
        // Mark node built-ins as external so they don't fail
        external: ['fs', 'path', 'url'],
    });

    const inputs = Object.keys(result.metafile.inputs);
    const fiberIncluded = inputs.some(
        (f) => f.includes('fiber') || f.includes('Fiber')
    );

    // Also check the actual output text for fiber-specific strings
    const outputText = new TextDecoder().decode(result.outputFiles[0].contents);
    const hasFiberCode =
        outputText.includes('__reactFiber') ||
        outputText.includes('__reactInternalInstance') ||
        outputText.includes('enhanceTreeWithFiber');

    if (fiberIncluded || hasFiberCode) {
        console.error('❌ Tree-shake FAILED: fiber.ts code is included in the bundle when only distill/filter/compress are imported.');
        if (fiberIncluded) {
            console.error('   Fiber modules found in metafile inputs:', inputs.filter(f => f.includes('fiber')));
        }
        if (hasFiberCode) {
            console.error('   Fiber-specific strings found in bundle output.');
        }
        process.exit(1);
    }

    console.log('✅ Tree-shake PASSED: fiber.ts is NOT included when only distill/filter/compress are imported.');
    console.log(`   Bundle inputs: ${inputs.length} modules`);
    console.log(`   Bundle size: ${result.outputFiles[0].contents.length} bytes`);
} finally {
    if (existsSync(entry)) unlinkSync(entry);
}

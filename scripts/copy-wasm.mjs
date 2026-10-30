import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/sql.js/dist/sql-wasm.wasm';
if (existsSync(src)) { mkdirSync('public', { recursive: true }); copyFileSync(src, 'public/sql-wasm.wasm'); console.log('copied sql-wasm.wasm to public/'); }

import { configureWasm } from '@/engine/sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
configureWasm({ wasmBinary: readFileSync(path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')) });
export {};

// Entry point for the portable single-file build (vite.portable.config.ts).
// The SQLite WebAssembly binary is embedded in the page, so DBWOW runs from one
// HTML file with no server (USB stick, classroom PC, hosted page).
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { configureWasm } from '@/engine/sqlite';
import App from '@/ui/App';

function dataUrlToBytes(u: string): Uint8Array {
  const b64 = u.slice(u.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

configureWasm(wasmUrl.startsWith('data:') ? { wasmBinary: dataUrlToBytes(wasmUrl) } : { locateFile: () => wasmUrl });
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

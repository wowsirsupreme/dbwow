'use client';
import dynamic from 'next/dynamic';
import { configureWasm } from '@/engine/sqlite';

// The SQLite WebAssembly binary is served from /public (copied there on install).
configureWasm({ locateFile: (f: string) => f });

const App = dynamic(() => import('@/ui/App'), { ssr: false, loading: () => <div style={{ padding: 40, fontFamily: 'Segoe UI, sans-serif' }}>Loading DBWOW…</div> });

export default function Page() {
  return <App />;
}

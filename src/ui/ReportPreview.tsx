'use client';
import { trackEvent } from './learning';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WowProject } from '@/engine/project';
import type { ReportDef } from '@/engine/types';
import { layoutReport, reportToPdf, type ReportLayout } from '@/engine/report';
import { useApp } from './store';
import { useEditorCommands } from './commands';
import { askParameters, errorBox, messageBox } from './dialogs';
import { downloadBytes, safeFileName, isHosted } from '@/engine/persistence';
import { ctlStyle } from './designers/DesignCanvas';

export function ReportPreview({ project: p, def, tabId, active, embedded, onClose }: { project: WowProject; def: ReportDef; tabId?: string; active?: boolean; embedded?: boolean; onClose?: () => void }) {
  const version = useApp((s) => s.version);
  const [params, setParams] = useState<Record<string, unknown> | null>(null);
  const [zoom, setZoom] = useState(embedded ? 0.6 : 0.9);
  const [printing, setPrinting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = def.recordSource ? p.sourceSql(def.recordSource) : { params: [] as { prompt: string }[] };
        if (s.params.length && !embedded) { const v = await askParameters(s.params.map((x) => x.prompt)); if (!cancelled) setParams(v ?? {}); }
        else setParams({});
      } catch (e) { setErr((e as Error).message); setParams({}); }
    })();
    return () => { cancelled = true; };
  }, [def.recordSource, p, embedded]);

  const layout: ReportLayout | null = useMemo(() => {
    if (params === null) return null;
    try { setErr(null); return layoutReport(p, def, params); } catch (e) { setErr((e as Error).message); return null; }
  }, [p, def, params, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportPdf = () => {
    if (!layout) return;
    try {
      const doc = reportToPdf(layout, def.caption || def.name);
      downloadBytes(new Uint8Array(doc.output('arraybuffer')), `${safeFileName(def.name)}.pdf`, 'application/pdf');
      useApp.getState().setStatus(`Exported ${layout.pages.length} page(s) to ${def.name}.pdf`); trackEvent('pdf');
    } catch (e) { void errorBox(e, 'PDF export failed'); }
  };
  const print = () => { if (isHosted()) { void messageBox('Printing is not available inside the hosted page. Use PDF to save the report, then print the PDF.', 'Print'); return; } setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 150); };

  if (tabId && !embedded) {
    useEditorCommands(tabId, !!active, { // eslint-disable-line react-hooks/rules-of-hooks
      'pp.print': { run: print, enabled: !!layout }, 'ext.exportPdf': { run: exportPdf, enabled: !!layout },
      'pp.zoomIn': () => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2))), 'pp.zoomOut': () => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2))), 'pp.zoom100': () => setZoom(1),
      'pp.refresh': () => setParams(params ? { ...params } : {}),
      ...(onClose ? { 'pp.close': onClose } : {}),
    }, 'preview');
  }

  const pages = layout?.pages ?? [];
  const Pages = ({ scale }: { scale: number }) => (
    <>
      {pages.map((pg) => (
        <div key={pg.number} className="page" style={{ width: layout!.width * scale, height: layout!.height * scale }} data-testid="report-page">
          <div style={{ width: layout!.width, height: layout!.height, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative' }}>
            {pg.bands.filter((b) => b.section.backColor && b.section.backColor.toLowerCase() !== '#ffffff').map((b, i) => <div key={i} style={{ position: 'absolute', left: layout!.margin, top: b.y, width: layout!.width - layout!.margin * 2, height: b.height, background: b.section.backColor }} />)}
            {pg.items.map((it, i) => {
              const c = it.control;
              const st: React.CSSProperties = { ...ctlStyle(c), left: it.x, top: it.y, width: c.w, height: c.h, textAlign: String(c.props.textAlign ?? 'Left').toLowerCase() as React.CSSProperties['textAlign'], display: 'block', paddingTop: 2 };
              if (c.type === 'line') return <svg key={i} className="page-item" style={{ left: it.x, top: it.y, width: c.w, height: c.h, overflow: 'visible' }}>{c.w >= c.h ? <line x1={0} y1={c.h / 2} x2={c.w} y2={c.h / 2} stroke={String(c.props.borderColor ?? '#000')} strokeWidth={Number(c.props.borderWidth ?? 1)} /> : <line x1={c.w / 2} y1={0} x2={c.w / 2} y2={c.h} stroke={String(c.props.borderColor ?? '#000')} strokeWidth={Number(c.props.borderWidth ?? 1)} />}</svg>;
              if (c.type === 'image') return <div key={i} className="page-item" style={st}>{String(c.props.picture ?? '').startsWith('data:') && <img src={String(c.props.picture)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}</div>;
              return <div key={i} className="page-item" style={st}>{it.text}</div>;
            })}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="preview" style={embedded ? { padding: 8 } : undefined} data-testid="report-preview">
      {err && <div className="banner err" style={{ marginBottom: 10 }}>{err}</div>}
      {layout && !embedded && <div style={{ color: '#fff', textAlign: 'center', marginBottom: 10, fontSize: 12 }}>{layout.pages.length} page(s) · {layout.recordCount} record(s) · {def.page.size} {def.page.orientation} · {Math.round(zoom * 100)}%</div>}
      <Pages scale={zoom} />
      {printing && layout && typeof document !== 'undefined' && createPortal(<div className="print-root"><Pages scale={1} /></div>, document.body)}
    </div>
  );
}

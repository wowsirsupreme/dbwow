'use client';
// Canvas of draggable table boxes with connector lines. Used by the
// Relationships window and the Query Designer upper pane.
import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';

export interface BoxDef { id: string; name: string; label?: string; x: number; y: number; }
export interface BoxField { name: string; pk: boolean; type?: string; }
export interface LinkDef { id: string; from: { box: string; field: string }; to: { box: string; field: string }; fromLabel?: string; toLabel?: string; kind?: 'inner' | 'left' | 'right'; dashed?: boolean; }
export interface FieldDragInfo { box: BoxDef; field: string; clientX: number; clientY: number; }

const TITLE_H = 25;
const ROW_H = 20;
const BOX_W = 180;
const MAX_FIELDS_H = 262;

interface Props {
  boxes: BoxDef[];
  fieldsOf: (b: BoxDef) => BoxField[];
  links: LinkDef[];
  zoom: number;
  setZoom?: (z: number) => void;
  showStar?: boolean;
  selectedBox?: string | null;
  selectedLink?: string | null;
  onSelectBox?: (id: string | null) => void;
  onSelectLink?: (id: string | null) => void;
  onMove: (id: string, x: number, y: number, done: boolean) => void;
  onRemoveBox?: (id: string) => void;
  onLinkDblClick?: (id: string) => void;
  onLinkContext?: (id: string, e: React.MouseEvent) => void;
  onBoxContext?: (id: string, e: React.MouseEvent) => void;
  /** Field dragged onto another field (relationship / join). */
  onFieldLink?: (from: { box: BoxDef; field: string }, to: { box: BoxDef; field: string }) => void;
  /** Field dropped outside the canvas (e.g. on the query grid). Return true if handled. */
  onFieldDropOutside?: (info: FieldDragInfo, target: Element | null) => boolean;
  onFieldDblClick?: (box: BoxDef, field: string) => void;
  /** Object dragged in from the Navigation Pane. */
  onDropObject?: (name: string, x: number, y: number) => void;
  validLinkTarget?: (from: { box: BoxDef; field: string }, to: { box: BoxDef; field: string }) => boolean;
  emptyText?: string;
  testId?: string;
}

export function TableCanvas(props: Props) {
  const { boxes, fieldsOf, links, zoom } = props;
  const areaRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const scrollTops = useRef<Record<string, number>>({});
  const [drag, setDrag] = useState<{ from: { box: BoxDef; field: string }; x: number; y: number; over?: { box: string; field: string; ok: boolean } } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const fieldY = (b: BoxDef, field: string): number => {
    const fs = fieldsOf(b);
    const idx = fs.findIndex((f) => f.name.toLowerCase() === field.toLowerCase()) + (props.showStar ? 1 : 0);
    const st = scrollTops.current[b.id] ?? 0;
    const visibleH = Math.min(MAX_FIELDS_H, (fs.length + (props.showStar ? 1 : 0)) * ROW_H + 2);
    let y = TITLE_H + idx * ROW_H + ROW_H / 2 - st;
    y = Math.max(TITLE_H + 4, Math.min(TITLE_H + visibleH - 4, y));
    return b.y + y;
  };
  const boxH = (b: BoxDef) => TITLE_H + Math.min(MAX_FIELDS_H, (fieldsOf(b).length + (props.showStar ? 1 : 0)) * ROW_H + 2) + 2;

  const startBoxDrag = (e: React.PointerEvent, b: BoxDef) => {
    if (e.button !== 0) return;
    e.preventDefault();
    props.onSelectBox?.(b.id);
    const x0 = e.clientX, y0 = e.clientY, bx = b.x, by = b.y;
    let nx = bx, ny = by;
    const move = (ev: PointerEvent) => { nx = Math.max(0, Math.round(bx + (ev.clientX - x0) / zoom)); ny = Math.max(0, Math.round(by + (ev.clientY - y0) / zoom)); props.onMove(b.id, nx, ny, false); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); props.onMove(b.id, nx, ny, true); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const startFieldDrag = (e: React.PointerEvent, b: BoxDef, field: string) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const from = { box: b, field };
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      started = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const fe = el?.closest('[data-box-field]') as HTMLElement | null;
      let over: { box: string; field: string; ok: boolean } | undefined;
      if (fe) {
        const tb = boxes.find((x) => x.id === fe.dataset.box);
        const tf = fe.dataset.boxField!;
        if (tb && !(tb.id === b.id && tf === field) && tf !== '*') over = { box: tb.id, field: tf, ok: props.validLinkTarget ? props.validLinkTarget(from, { box: tb, field: tf }) : tb.id !== b.id };
      }
      // highlight query grid drop targets
      document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      const gt = el?.closest('[data-qgrid-col]');
      if (gt) gt.classList.add('drop-target');
      setDrag({ from, x: ev.clientX, y: ev.clientY, over });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      setDrag(null);
      if (!started) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const fe = el?.closest('[data-box-field]') as HTMLElement | null;
      if (fe && areaRef.current?.contains(fe)) {
        const tb = boxes.find((x) => x.id === fe.dataset.box);
        const tf = fe.dataset.boxField!;
        if (tb && !(tb.id === b.id && tf === field) && tf !== '*') props.onFieldLink?.(from, { box: tb, field: tf });
        return;
      }
      props.onFieldDropOutside?.({ box: b, field, clientX: ev.clientX, clientY: ev.clientY }, el);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const startPan = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('canvas-inner')) return;
    props.onSelectBox?.(null); props.onSelectLink?.(null);
    const el = areaRef.current; if (!el) return;
    const x0 = e.clientX, y0 = e.clientY, sl = el.scrollLeft, st = el.scrollTop;
    const move = (ev: PointerEvent) => { el.scrollLeft = sl - (ev.clientX - x0); el.scrollTop = st - (ev.clientY - y0); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    const el = areaRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { if (e.ctrlKey && props.setZoom) { e.preventDefault(); props.setZoom(Math.max(0.4, Math.min(2, +(zoom - Math.sign(e.deltaY) * 0.1).toFixed(2)))); } };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoom, props]);

  const extentW = Math.max(900, ...boxes.map((b) => b.x + BOX_W + 80));
  const extentH = Math.max(420, ...boxes.map((b) => b.y + boxH(b) + 80));

  const linkPath = (l: LinkDef) => {
    const a = boxes.find((b) => b.id === l.from.box), b = boxes.find((x) => x.id === l.to.box);
    if (!a || !b) return null;
    const ay = fieldY(a, l.from.field), by = fieldY(b, l.to.field);
    let ax: number, bx: number, dirA: number, dirB: number;
    if (a.id === b.id) { ax = a.x + BOX_W; bx = a.x + BOX_W; dirA = 1; dirB = 1; }
    else if (a.x + BOX_W < b.x) { ax = a.x + BOX_W; bx = b.x; dirA = 1; dirB = -1; }
    else if (b.x + BOX_W < a.x) { ax = a.x; bx = b.x + BOX_W; dirA = -1; dirB = 1; }
    else { ax = a.x + BOX_W; bx = b.x + BOX_W; dirA = 1; dirB = 1; }
    const s = 18;
    const d = a.id === b.id ? `M${ax},${ay} h${s} C${ax + 60},${ay} ${bx + 60},${by} ${bx + s},${by} h${-s}` : `M${ax},${ay} h${dirA * s} L${bx + dirB * s},${by} h${-dirB * s}`;
    return { d, ax, ay, bx, by, dirA, dirB };
  };

  return (
    <div className={'canvas-area' + (dropHover ? ' drop-hover' : '')} ref={areaRef} onPointerDown={startPan} data-testid={props.testId}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-wowdb-object')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropHover(true); } }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false);
        const raw = e.dataTransfer.getData('application/x-wowdb-object'); if (!raw) return;
        e.preventDefault();
        const o = JSON.parse(raw) as { type: string; name: string };
        const r = areaRef.current!.getBoundingClientRect();
        props.onDropObject?.(o.name, Math.max(0, Math.round((e.clientX - r.left + areaRef.current!.scrollLeft) / zoom - 40)), Math.max(0, Math.round((e.clientY - r.top + areaRef.current!.scrollTop) / zoom - 10)));
      }}>
      <div className="canvas-inner" style={{ width: extentW, height: extentH, transform: `scale(${zoom})` }} onPointerDown={startPan}>
        <svg className="rel-svg" width={extentW} height={extentH}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#333" /></marker>
          </defs>
          {links.map((l) => {
            const g = linkPath(l); if (!g) return null;
            const sel = props.selectedLink === l.id;
            const arrowEnd = l.kind === 'left' ? 'url(#arrow)' : undefined;
            const arrowStart = l.kind === 'right' ? 'url(#arrow)' : undefined;
            return (
              <g key={l.id}>
                <path d={g.d} fill="none" stroke={sel ? '#1f5fae' : '#333'} strokeWidth={sel ? 3 : 1.6} strokeDasharray={l.dashed ? '5 4' : undefined} markerEnd={arrowEnd} markerStart={arrowStart} />
                <path className="hit" d={g.d} fill="none" stroke="transparent" strokeWidth={12}
                  onPointerDown={(e) => { e.stopPropagation(); props.onSelectLink?.(l.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); props.onLinkDblClick?.(l.id); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); props.onSelectLink?.(l.id); props.onLinkContext?.(l.id, e); }} />
                {l.fromLabel && <text x={g.ax + g.dirA * 5 - (g.dirA < 0 ? 8 : 0)} y={g.ay - 4} fontSize={l.fromLabel === '∞' ? 15 : 11} fontWeight={700}>{l.fromLabel}</text>}
                {l.toLabel && <text x={g.bx + g.dirB * 5 - (g.dirB < 0 ? 12 : 0)} y={g.by - 4} fontSize={l.toLabel === '∞' ? 15 : 11} fontWeight={700}>{l.toLabel}</text>}
              </g>
            );
          })}
        </svg>
        {boxes.map((b) => {
          const fs = fieldsOf(b);
          return (
            <div key={b.id} className={'tbox' + (props.selectedBox === b.id ? ' is-sel' : '')} style={{ left: b.x, top: b.y, width: BOX_W }} data-testid={`tbox-${b.name}`}
              onContextMenu={(e) => { e.preventDefault(); props.onSelectBox?.(b.id); props.onBoxContext?.(b.id, e); }}>
              <div className="tbox-title" onPointerDown={(e) => startBoxDrag(e, b)} title={b.name}>
                <span className="nm">{b.label ?? b.name}</span>
                {props.onRemoveBox && <button className="icon-btn" style={{ width: 16, height: 16 }} onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onRemoveBox!(b.id)} aria-label={`Remove ${b.name}`}><X size={11} /></button>}
              </div>
              <div className="tbox-fields" onScroll={(e) => { scrollTops.current[b.id] = e.currentTarget.scrollTop; setTick((t) => t + 1); }}>
                {props.showStar && <div className="tbox-field star" data-box={b.id} data-box-field="*" onPointerDown={(e) => startFieldDrag(e, b, '*')} onDoubleClick={() => props.onFieldDblClick?.(b, '*')}>*</div>}
                {fs.map((f) => {
                  const over = drag?.over && drag.over.box === b.id && drag.over.field === f.name;
                  return (
                    <div key={f.name} className={'tbox-field' + (over ? (drag!.over!.ok ? ' drop-ok' : ' drop-bad') : '')} data-box={b.id} data-box-field={f.name} title={f.type ? `${f.name} (${f.type})` : f.name}
                      onPointerDown={(e) => startFieldDrag(e, b, f.name)} onDoubleClick={() => props.onFieldDblClick?.(b, f.name)}>
                      {f.pk && <KeyRound size={11} className="k" />}{f.name}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!boxes.length && <div className="muted" style={{ position: 'absolute', left: 30, top: 30, maxWidth: 520 }}>{props.emptyText}</div>}
      </div>
      {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>{drag.from.box.label ?? drag.from.box.name}.{drag.from.field}</div>}
    </div>
  );
}

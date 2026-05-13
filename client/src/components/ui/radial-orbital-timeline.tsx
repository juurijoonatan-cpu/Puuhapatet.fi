import React, { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: number;
  title: string;
  date: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  status: "completed" | "in-progress" | "pending";
  energy: number;
  content: string;
  category: string;
  relatedIds: number[];
}

const STATUS_STROKE: Record<string, string> = {
  completed:   "rgba(255,255,255,0.7)",
  "in-progress": "rgba(255,255,255,0.35)",
  pending:     "rgba(255,255,255,0.12)",
};

const CX = 200;
const CY = 200;
const R  = 140;

function getPos(i: number, n: number, rotDeg: number) {
  const base  = (2 * Math.PI * i) / n - Math.PI / 2;
  const total = base + (rotDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(total), y: CY + R * Math.sin(total) };
}

export function RadialOrbitalTimeline({ timelineData }: { timelineData: TimelineItem[] }) {
  const [activeId, setActiveId] = useState<number>(timelineData[0]?.id ?? 1);
  const [rot, setRot]           = useState(0);
  const timerRef                = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timerRef.current = setInterval(() => setRot(r => (r + 0.25) % 360), 60);
    return () => clearInterval(timerRef.current);
  }, []);

  const activeItem = timelineData.find(t => t.id === activeId);
  const n          = timelineData.length;

  const positions = useMemo(
    () => timelineData.map((item, i) => ({ item, ...getPos(i, n, rot) })),
    [timelineData, n, rot]
  );

  return (
    <div className="w-full py-6">
      <div className="flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16">
        {/* ── Orbital canvas ── */}
        <div className="relative flex-shrink-0" style={{ width: 400, height: 400 }}>
          {/* SVG: rings + connector lines only */}
          <svg
            width="400"
            height="400"
            className="absolute inset-0 pointer-events-none"
            aria-hidden
          >
            {/* Outer orbit ring */}
            <circle
              cx={CX} cy={CY} r={R}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            {/* Inner dashed ring */}
            <circle
              cx={CX} cy={CY} r={R * 0.5}
              fill="none"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="1"
              strokeDasharray="3 10"
            />
            {/* Connector lines from center to active + related nodes */}
            {activeItem &&
              positions.map(({ item, x, y }) => {
                if (item.id !== activeId && !activeItem.relatedIds.includes(item.id)) return null;
                return (
                  <line
                    key={item.id}
                    x1={CX} y1={CY} x2={x} y2={y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1"
                    strokeDasharray="4 8"
                  />
                );
              })}
            {/* Center hub */}
            <circle cx={CX} cy={CY} r={20} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={3}  fill="rgba(255,255,255,0.55)" />
          </svg>

          {/* Absolutely-positioned node buttons */}
          {positions.map(({ item, x, y }) => {
            const isActive = item.id === activeId;
            const Icon     = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveId(item.id)}
                title={item.title}
                className={cn(
                  "absolute flex items-center justify-center rounded-full border transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  isActive
                    ? "w-12 h-12 bg-white/10 shadow-[0_0_16px_rgba(255,255,255,0.12)]"
                    : "w-9 h-9 bg-zinc-950 hover:bg-zinc-900"
                )}
                style={{
                  left: x,
                  top:  y,
                  transform: "translate(-50%, -50%)",
                  borderColor: STATUS_STROKE[item.status],
                }}
              >
                <Icon
                  size={isActive ? 16 : 13}
                  className={isActive ? "text-white" : "text-zinc-500"}
                />
              </button>
            );
          })}
        </div>

        {/* ── Detail panel ── */}
        {activeItem && (
          <div className="w-full max-w-xs">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                {activeItem.category}
              </span>
              <span className="text-[10px] font-mono text-zinc-700">·</span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                {activeItem.date}
              </span>
            </div>
            <h3 className="text-white text-2xl font-bold tracking-tight mb-3">
              {activeItem.title}
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-5">
              {activeItem.content}
            </p>
            {activeItem.relatedIds.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {activeItem.relatedIds.map(rid => {
                  const rel = timelineData.find(t => t.id === rid);
                  return rel ? (
                    <button
                      key={rid}
                      onClick={() => setActiveId(rid)}
                      className="text-[11px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
                    >
                      → {rel.title}
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Node pill list ── */}
      <div className="flex flex-wrap justify-center gap-1.5 mt-8">
        {timelineData.map(item => {
          const isActive = item.id === activeId;
          const Icon     = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveId(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
                isActive
                  ? "bg-white/8 border border-white/15 text-white"
                  : "border border-transparent text-zinc-600 hover:text-zinc-400"
              )}
            >
              <Icon size={9} />
              {item.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

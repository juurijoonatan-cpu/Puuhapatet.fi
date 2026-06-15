"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "./Navbar";
import Dashboard from "./Dashboard";
import FloorView from "./FloorView";
import HoursView from "./HoursView";

export type Tab = "dashboard" | "floor" | "hours";
export type Status = "ei" | "kesken" | "pesty";

export interface Mark { p: 1 | 2; x: number; y: number; }
export interface FloorData { marks: Mark[]; }
export type MarksData = Record<string, FloorData>;
export interface CustomMark { key: string; p: 1 | 2; x: number; y: number; }
export interface LogEntry { floor: string; key: string; p: 1 | 2; status: Status; ts: number; }
export interface HourEntry { worker: "matias" | "joonatan"; delta: number; ts: number; }

const STORAGE_KEY = "fr8_ikkuna_v1";

function loadStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; }
  catch { return {}; }
}

function persist(data: object) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

export default function AppShell() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [activeFloor, setActiveFloor] = useState("K");
  const [marks, setMarks] = useState<MarksData | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => loadStorage().statuses || {});
  const [posOverrides, setPosOverrides] = useState<Record<string, { x: number; y: number }>>(() => loadStorage().posOverrides || {});
  const [customMarks, setCustomMarks] = useState<Record<string, CustomMark[]>>(() => loadStorage().customMarks || {});
  const [deleted, setDeleted] = useState<Record<string, boolean>>(() => loadStorage().deleted || {});
  const [hours, setHours] = useState<{ matias: number; joonatan: number }>(() => loadStorage().hours || { matias: 0, joonatan: 0 });
  const [log, setLog] = useState<LogEntry[]>(() => loadStorage().log || []);
  const [hourLog, setHourLog] = useState<HourEntry[]>(() => loadStorage().hourLog || []);

  // Fetch marks data
  useEffect(() => {
    fetch("/marks_data.json")
      .then((r) => r.json())
      .then(setMarks)
      .catch(() => setMarks({}));
  }, []);

  // Auto-save
  useEffect(() => {
    persist({ statuses, hours, log, hourLog, posOverrides, customMarks, deleted });
  }, [statuses, hours, log, hourLog, posOverrides, customMarks, deleted]);

  // Get priority of a window key
  const getPriority = useCallback((key: string): 1 | 2 => {
    if (key.includes("#c")) {
      const f = key.split("#")[0];
      return (customMarks[f] || []).find((c) => c.key === key)?.p ?? 1;
    }
    const [f, idx] = key.split("#");
    return marks?.[f]?.marks[parseInt(idx, 10)]?.p ?? 1;
  }, [marks, customMarks]);

  const onStatusChange = useCallback((key: string, status: Status) => {
    const nextStatuses = { ...statuses };
    if (status === "ei") delete nextStatuses[key];
    else nextStatuses[key] = status;
    const p = getPriority(key);
    const floor = key.split("#")[0];
    const newLog = [{ floor, key, p, status, ts: Date.now() }, ...log].slice(0, 60);
    setStatuses(nextStatuses);
    setLog(newLog);
  }, [statuses, log, getPriority]);

  const onAddCustomMark = useCallback((floor: string, x: number, y: number, p: 1 | 2) => {
    const key = `${floor}#c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    setCustomMarks((prev) => ({ ...prev, [floor]: [...(prev[floor] || []), { key, p, x, y }] }));
  }, []);

  const onDeleteMark = useCallback((key: string) => {
    const f = key.split("#")[0];
    const newPo = { ...posOverrides }; delete newPo[key];
    const newSt = { ...statuses }; delete newSt[key];
    if (key.includes("#c")) {
      const newCm = { ...customMarks, [f]: (customMarks[f] || []).filter((c) => c.key !== key) };
      setCustomMarks(newCm);
    } else {
      setDeleted((prev) => ({ ...prev, [key]: true }));
    }
    setPosOverrides(newPo);
    setStatuses(newSt);
  }, [posOverrides, statuses, customMarks]);

  const onMoveMark = useCallback((key: string, x: number, y: number) => {
    setPosOverrides((prev) => ({ ...prev, [key]: { x, y } }));
  }, []);

  const onMoveMarkCommit = useCallback((key: string, x: number, y: number) => {
    setPosOverrides((prev) => ({ ...prev, [key]: { x, y } }));
  }, []);

  const onResetFloor = useCallback((floor: string) => {
    const newPo = Object.fromEntries(Object.entries(posOverrides).filter(([k]) => !k.startsWith(floor + "#")));
    const newDel = Object.fromEntries(Object.entries(deleted).filter(([k]) => !(k.startsWith(floor + "#") && !k.includes("#c"))));
    const newCm = { ...customMarks, [floor]: [] };
    setPosOverrides(newPo);
    setDeleted(newDel);
    setCustomMarks(newCm);
  }, [posOverrides, deleted, customMarks]);

  const onAddHours = useCallback((worker: "matias" | "joonatan", delta: number) => {
    const newHours = { ...hours, [worker]: Math.max(0, +(hours[worker] + delta).toFixed(2)) };
    const newHourLog = [{ worker, delta, ts: Date.now() }, ...hourLog].slice(0, 40);
    setHours(newHours);
    setHourLog(newHourLog);
  }, [hours, hourLog]);

  const onGoToFloor = useCallback((floor: string) => {
    setActiveFloor(floor);
    setTab("floor");
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", color: "#fff", overflow: "hidden", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      <div className="anim-drift" style={{ position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)", width: "1100px", height: "700px", background: "radial-gradient(ellipse at center, rgba(120,120,160,0.10), transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-20%", right: "-5%", width: "700px", height: "600px", background: "radial-gradient(ellipse at center, rgba(80,90,120,0.08), transparent 65%)", pointerEvents: "none" }} />

      <Navbar activeTab={tab} onTabChange={setTab} />

      <main style={{ position: "relative", zIndex: 10, height: "calc(100% - 62px)" }}>
        {tab === "dashboard" && (
          <Dashboard marks={marks} statuses={statuses} customMarks={customMarks} deleted={deleted} log={log} onGoToFloor={onGoToFloor} />
        )}
        {tab === "floor" && (
          <FloorView
            marks={marks}
            statuses={statuses}
            posOverrides={posOverrides}
            customMarks={customMarks}
            deleted={deleted}
            initialFloor={activeFloor}
            onStatusChange={onStatusChange}
            onAddCustomMark={onAddCustomMark}
            onDeleteMark={onDeleteMark}
            onMoveMark={onMoveMark}
            onMoveMarkCommit={onMoveMarkCommit}
            onResetFloor={onResetFloor}
          />
        )}
        {tab === "hours" && (
          <HoursView hours={hours} hourLog={hourLog} onAddHours={onAddHours} />
        )}
      </main>
    </div>
  );
}

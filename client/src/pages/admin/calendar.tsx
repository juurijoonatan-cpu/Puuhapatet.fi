/**
 * Admin Calendar — scheduled jobs view
 * Mobile-first: list view default, week grid on wider screens
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type ViewMode = "list" | "week" | "day";

const DAYS_FI = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];

interface JobRow {
  job: {
    id: number;
    status: string;
    description: string;
    agreedPrice: number;
    scheduledAt: string | null;
    createdAt: string;
  };
  customer: { name: string; address: string; phone?: string } | null;
}

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getJobs().then((res) => {
      if (res.ok && res.data) {
        const rows = res.data as JobRow[];
        setJobs(rows.filter(r => r.job.scheduledAt && r.job.status !== "cancelled" && r.job.status !== "done"));
      }
      setLoading(false);
    });
  }, []);

  const dateKey = (d: Date) => d.toISOString().slice(0, 10);

  const jobsByDate: Record<string, JobRow[]> = {};
  for (const row of jobs) {
    if (!row.job.scheduledAt) continue;
    const key = dateKey(new Date(row.job.scheduledAt));
    if (!jobsByDate[key]) jobsByDate[key] = [];
    jobsByDate[key].push(row);
  }

  const upcomingJobs = [...jobs]
    .filter(r => r.job.scheduledAt)
    .sort((a, b) => new Date(a.job.scheduledAt!).getTime() - new Date(b.job.scheduledAt!).getTime());

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  const getWeekDates = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return Array.from({ length: 7 }, (_, i) => {
      const wd = new Date(d);
      wd.setDate(d.getDate() + i);
      return wd;
    });
  };

  const weekDates = getWeekDates(new Date(currentDate));

  const goPrev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - (viewMode === "week" ? 7 : 1));
    setCurrentDate(d);
  };

  const goNext = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + (viewMode === "week" ? 7 : 1));
    setCurrentDate(d);
  };

  const formatWeekRange = () => {
    const start = weekDates[0];
    const end = weekDates[6];
    const sm = start.toLocaleDateString("fi-FI", { month: "short" });
    const em = end.toLocaleDateString("fi-FI", { month: "short" });
    return sm === em
      ? `${start.getDate()}–${end.getDate()} ${sm}`
      : `${start.getDate()} ${sm} – ${end.getDate()} ${em}`;
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

  const statusLabel = (s: string) => {
    switch (s) {
      case "scheduled":   return "Ajoitettu";
      case "in_progress": return "Käynnissä";
      case "lead":        return "Liidi";
      default:            return s;
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "scheduled":   return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300";
      case "in_progress": return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300";
      case "lead":        return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
      default:            return "bg-muted text-muted-foreground";
    }
  };

  // Group upcoming jobs by date for list view
  const grouped: { dateStr: string; date: Date; rows: JobRow[] }[] = [];
  const seen = new Set<string>();
  for (const row of upcomingJobs) {
    if (!row.job.scheduledAt) continue;
    const d = new Date(row.job.scheduledAt);
    const key = dateKey(d);
    if (!seen.has(key)) {
      seen.add(key);
      grouped.push({ dateStr: key, date: d, rows: [] });
    }
    grouped.find(g => g.dateStr === key)!.rows.push(row);
  }

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Kalenteri</h1>
              <p className="text-sm text-muted-foreground">
                {loading ? "Ladataan…"
                  : viewMode === "list" ? `${upcomingJobs.length} tulevaa keikkaa`
                  : formatWeekRange()}
              </p>
            </div>
          </div>
          <Link href="/admin/new">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Uusi
            </Button>
          </Link>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 mb-6">
          {viewMode !== "list" && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={goPrev} data-testid="btn-prev">
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} data-testid="btn-today">
                Tänään
              </Button>
              <Button variant="ghost" size="icon" onClick={goNext} data-testid="btn-next">
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1 bg-muted rounded-lg p-1">
            {(["list", "week", "day"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  viewMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                )}
                data-testid={`btn-view-${mode}`}
              >
                {mode === "list" ? "Lista" : mode === "week" ? "Viikko" : "Päivä"}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* List view */}
        {!loading && viewMode === "list" && (
          <div className="space-y-6">
            {grouped.length === 0 ? (
              <Card className="p-10 text-center bg-card border-0 premium-shadow">
                <CalendarIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground font-medium">Ei tulevia aikataulutettuja keikkoja</p>
                <p className="text-xs text-muted-foreground mt-1">Aikatauluta keikkoja Keikat-sivulta</p>
              </Card>
            ) : (
              grouped.map(group => (
                <div key={group.dateStr}>
                  {/* Date header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className={cn(
                      "w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0",
                      isToday(group.date) ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <span className="text-xs font-medium leading-none">
                        {group.date.toLocaleDateString("fi-FI", { weekday: "short" })}
                      </span>
                      <span className="text-base font-bold leading-none mt-0.5">
                        {group.date.getDate()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {isToday(group.date) ? "Tänään · " : ""}
                        {group.date.toLocaleDateString("fi-FI", { day: "numeric", month: "long" })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.rows.length} keikka{group.rows.length !== 1 ? "a" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Job cards */}
                  <div className="space-y-2">
                    {group.rows.map(row => (
                      <Link href="/admin/jobs" key={row.job.id}>
                        <Card className="p-4 bg-card border-0 premium-shadow cursor-pointer hover:opacity-90 transition-opacity">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="font-semibold text-foreground truncate">
                                  {row.customer?.name ?? "Tuntematon"}
                                </p>
                                <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", statusColor(row.job.status))}>
                                  {statusLabel(row.job.status)}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground truncate">{row.job.description}</p>
                              {row.customer?.address && (
                                <div className="flex items-center gap-1 mt-1">
                                  <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <p className="text-xs text-muted-foreground truncate">{row.customer.address}</p>
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs text-muted-foreground font-medium">
                                {formatTime(row.job.scheduledAt!)}
                              </p>
                              <p className="text-sm font-bold text-foreground">
                                {(row.job.agreedPrice / 100).toLocaleString("fi-FI", {
                                  style: "currency", currency: "EUR", maximumFractionDigits: 0,
                                })}
                              </p>
                            </div>
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Week view */}
        {!loading && viewMode === "week" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <div className="grid grid-cols-7 gap-2 min-w-[560px]">
              {weekDates.map((date, index) => {
                const key = dateKey(date);
                const dayJobs = jobsByDate[key] ?? [];
                return (
                  <div key={index} className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">{DAYS_FI[index]}</div>
                    <div className={cn(
                      "w-9 h-9 mx-auto rounded-full flex items-center justify-center text-sm font-medium mb-2",
                      isToday(date) ? "bg-primary text-primary-foreground" : "text-foreground"
                    )}>
                      {date.getDate()}
                    </div>
                    <Card className="min-h-24 p-1.5 bg-card border-0 premium-shadow">
                      {dayJobs.length === 0 ? (
                        <div className="text-muted-foreground/30 text-center py-6 text-lg">·</div>
                      ) : (
                        <div className="space-y-1">
                          {dayJobs.map(row => (
                            <Link href="/admin/jobs" key={row.job.id}>
                              <div className="px-1.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer">
                                <p className="text-xs font-semibold text-foreground leading-tight truncate">
                                  {formatTime(row.job.scheduledAt!)}
                                </p>
                                <p className="text-xs text-muted-foreground leading-tight truncate">
                                  {row.customer?.name ?? "—"}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Day view */}
        {!loading && viewMode === "day" && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className={cn(
                "w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0",
                isToday(currentDate) ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                <span className="text-xs font-medium leading-none">
                  {currentDate.toLocaleDateString("fi-FI", { weekday: "short" })}
                </span>
                <span className="text-lg font-bold leading-none mt-0.5">{currentDate.getDate()}</span>
              </div>
              <p className="text-base font-semibold text-foreground">
                {currentDate.toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
            {(() => {
              const key = dateKey(currentDate);
              const dayJobs = jobsByDate[key] ?? [];
              return dayJobs.length === 0 ? (
                <Card className="p-8 text-center bg-card border-0 premium-shadow">
                  <p className="text-muted-foreground">Ei keikkoja tälle päivälle</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {dayJobs.map(row => (
                    <Link href="/admin/jobs" key={row.job.id}>
                      <Card className="p-4 bg-card border-0 premium-shadow cursor-pointer hover:opacity-90 transition-opacity">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">{formatTime(row.job.scheduledAt!)}</p>
                            <p className="font-semibold text-foreground">{row.customer?.name ?? "—"}</p>
                            <p className="text-sm text-muted-foreground truncate">{row.job.description}</p>
                            {row.customer?.address && (
                              <p className="text-xs text-muted-foreground mt-1">{row.customer.address}</p>
                            )}
                          </div>
                          <p className="text-sm font-bold text-foreground shrink-0">
                            {(row.job.agreedPrice / 100).toLocaleString("fi-FI", {
                              style: "currency", currency: "EUR", maximumFractionDigits: 0,
                            })}
                          </p>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

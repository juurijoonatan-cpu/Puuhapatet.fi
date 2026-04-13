/**
 * Admin Calendar — scheduled jobs view
 * Mobile: list view + day view with week-strip navigation
 * Desktop: list / week grid / day views
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus,
  Calendar as CalendarIcon, MapPin, Loader2, Phone, Share2, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "list" | "week" | "day";

const DAYS_FI = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];
const MONTHS_FI = [
  "tammikuu","helmikuu","maaliskuu","huhtikuu","toukokuu","kesäkuu",
  "heinäkuu","elokuu","syyskuu","lokakuu","marraskuu","joulukuu",
];

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
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const icsUrl = `${window.location.origin}/api/calendar.ics`;
  const webcalUrl = icsUrl.replace(/^https?:\/\//, "webcal://");

  const handleSubscribe = () => {
    // iOS requires a real anchor click to trigger Calendar subscription prompt
    const a = document.createElement("a");
    a.href = webcalUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(icsUrl);
      setCopied(true);
      toast({ title: "Linkki kopioitu!", description: "Avaa Kalenteri-app → Lisää tili → Tilattu kalenteri → liitä linkki." });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: "Kopioi manuaalisesti", description: icsUrl });
    }
  };

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

  const goToday = () => setCurrentDate(new Date());

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

  // Reusable job card (used in list, day, and mobile week views)
  const JobCard = ({ row, showTime = true }: { row: JobRow; showTime?: boolean }) => (
    <Link href="/admin/jobs" key={row.job.id}>
      <Card className="p-4 bg-card border-0 premium-shadow cursor-pointer active:opacity-80 hover:opacity-90 transition-opacity">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {showTime && row.job.scheduledAt && (
                <span className="text-xs font-bold text-primary tabular-nums">
                  {formatTime(row.job.scheduledAt)}
                </span>
              )}
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
            {row.customer?.phone && (
              <div className="flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">{row.customer.phone}</p>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-foreground">
              {(row.job.agreedPrice / 100).toLocaleString("fi-FI", {
                style: "currency", currency: "EUR", maximumFractionDigits: 0,
              })}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );

  // Week strip (shared between mobile week+day views)
  const WeekStrip = () => (
    <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
      {weekDates.map((date, idx) => {
        const key = dateKey(date);
        const hasJobs = (jobsByDate[key] ?? []).length > 0;
        const isSelected = dateKey(date) === dateKey(currentDate);
        return (
          <button
            key={idx}
            onClick={() => setCurrentDate(date)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-xl shrink-0 min-w-[44px] transition-all",
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm"
                : isToday(date)
                ? "bg-primary/15 text-primary"
                : "bg-muted text-foreground",
            )}
          >
            <span className="text-[11px] font-medium">{DAYS_FI[idx]}</span>
            <span className="text-base font-bold leading-none">{date.getDate()}</span>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full mt-0.5",
              hasJobs
                ? isSelected ? "bg-primary-foreground" : "bg-primary"
                : "bg-transparent",
            )} />
          </button>
        );
      })}
    </div>
  );

  // Day content (used in both day view and mobile week view)
  const DayContent = () => {
    const key = dateKey(currentDate);
    const dayJobs = jobsByDate[key] ?? [];
    return dayJobs.length === 0 ? (
      <Card className="p-8 text-center bg-card border-0 premium-shadow">
        <p className="text-muted-foreground">Ei keikkoja tälle päivälle</p>
      </Card>
    ) : (
      <div className="space-y-2">
        {dayJobs.map(row => <JobCard key={row.job.id} row={row} showTime />)}
      </div>
    );
  };

  const navTitle = () => {
    if (viewMode === "list") return `${upcomingJobs.length} tulevaa keikkaa`;
    if (viewMode === "week") return formatWeekRange();
    return currentDate.toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "long" });
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-foreground">Kalenteri</h1>
              <p className="text-xs md:text-sm text-muted-foreground">
                {loading ? "Ladataan…" : navTitle()}
              </p>
            </div>
          </div>
          <Link href="/admin/new">
            <Button size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Uusi keikka</span>
              <span className="sm:hidden">Uusi</span>
            </Button>
          </Link>
        </div>

        {/* ── Controls ── */}
        <div className="flex items-center justify-between gap-2 mb-5">
          {/* Nav arrows — show for week/day views */}
          {viewMode !== "list" ? (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={goPrev} data-testid="btn-prev">
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToday}
                className="text-xs px-3"
                data-testid="btn-today"
              >
                Tänään
              </Button>
              <Button variant="ghost" size="icon" onClick={goNext} data-testid="btn-next">
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          ) : (
            <div /> /* spacer */
          )}

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-1">
            {(["list", "week", "day"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors",
                  viewMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                data-testid={`btn-view-${mode}`}
              >
                {mode === "list" ? "Lista" : mode === "week" ? "Viikko" : "Päivä"}
              </button>
            ))}
          </div>
        </div>

        {/* ── iOS Calendar subscribe ── */}
        <Card className="flex items-center justify-between gap-3 px-4 py-3 bg-card border-0 premium-shadow mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">iOS Kalenteri</p>
              <p className="text-xs text-muted-foreground truncate">Synkronoi keikat suoraan puhelimeen</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs"
              onClick={handleSubscribe}
            >
              <Share2 className="w-3.5 h-3.5" />
              Tilaa
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={handleCopyUrl}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Share2 className="w-3.5 h-3.5" />}
              {copied ? "Kopioitu" : "Kopioi"}
            </Button>
          </div>
        </Card>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ── LIST VIEW ── */}
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
                      isToday(group.date) ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}>
                      <span className="text-[10px] font-semibold leading-none uppercase">
                        {group.date.toLocaleDateString("fi-FI", { weekday: "short" })}
                      </span>
                      <span className="text-base font-bold leading-none mt-0.5">
                        {group.date.getDate()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {isToday(group.date) ? "Tänään — " : ""}
                        {group.date.getDate()}. {MONTHS_FI[group.date.getMonth()]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.rows.length} keikka{group.rows.length !== 1 ? "a" : ""}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.rows.map(row => <JobCard key={row.job.id} row={row} showTime />)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── WEEK VIEW ── */}
        {!loading && viewMode === "week" && (
          <>
            {/* Mobile: week strip + day jobs */}
            <div className="md:hidden">
              <WeekStrip />
              <div className="flex items-center gap-2 mb-4">
                <div className={cn(
                  "w-9 h-9 rounded-xl flex flex-col items-center justify-center shrink-0 text-center",
                  isToday(currentDate) ? "bg-primary text-primary-foreground" : "bg-muted",
                )}>
                  <span className="text-[9px] font-semibold leading-none uppercase">
                    {currentDate.toLocaleDateString("fi-FI", { weekday: "short" })}
                  </span>
                  <span className="text-sm font-bold leading-none mt-0.5">
                    {currentDate.getDate()}
                  </span>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {isToday(currentDate) ? "Tänään — " : ""}
                  {currentDate.getDate()}. {MONTHS_FI[currentDate.getMonth()]}
                  {" "}
                  <span className="text-muted-foreground font-normal">
                    {(jobsByDate[dateKey(currentDate)] ?? []).length} keikka{(jobsByDate[dateKey(currentDate)] ?? []).length !== 1 ? "a" : ""}
                  </span>
                </p>
              </div>
              <DayContent />
            </div>

            {/* Desktop: 7-column grid */}
            <div className="hidden md:block overflow-x-auto -mx-4 px-4">
              <div className="grid grid-cols-7 gap-2 min-w-[560px]">
                {weekDates.map((date, index) => {
                  const key = dateKey(date);
                  const dayJobs = jobsByDate[key] ?? [];
                  return (
                    <div key={index} className="text-center">
                      <div className="text-xs text-muted-foreground mb-1">{DAYS_FI[index]}</div>
                      <div className={cn(
                        "w-9 h-9 mx-auto rounded-full flex items-center justify-center text-sm font-medium mb-2",
                        isToday(date) ? "bg-primary text-primary-foreground" : "text-foreground",
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
          </>
        )}

        {/* ── DAY VIEW ── */}
        {!loading && viewMode === "day" && (
          <div>
            {/* Mobile also gets week strip for quick date jumping */}
            <WeekStrip />
            <div className="flex items-center gap-3 mb-4">
              <div className={cn(
                "w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0",
                isToday(currentDate) ? "bg-primary text-primary-foreground" : "bg-muted",
              )}>
                <span className="text-[10px] font-semibold leading-none uppercase">
                  {currentDate.toLocaleDateString("fi-FI", { weekday: "short" })}
                </span>
                <span className="text-lg font-bold leading-none mt-0.5">{currentDate.getDate()}</span>
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {isToday(currentDate) ? "Tänään" : currentDate.toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "long" })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(jobsByDate[dateKey(currentDate)] ?? []).length} keikkaa
                </p>
              </div>
            </div>
            <DayContent />
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * Admin Calendar
 * 
 * Simple scheduling tool for jobs.
 * Week view default, day view toggle.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ViewMode = "week" | "day";

const DAYS_FI = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());

  const getWeekDates = (date: Date) => {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  };

  const weekDates = getWeekDates(new Date(currentDate));
  const today = new Date();

  const goToToday = () => setCurrentDate(new Date());
  
  const goPrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    setCurrentDate(newDate);
  };

  const goNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  };

  const formatWeekRange = () => {
    const start = weekDates[0];
    const end = weekDates[6];
    const startMonth = start.toLocaleDateString("fi-FI", { month: "short" });
    const endMonth = end.toLocaleDateString("fi-FI", { month: "short" });
    
    if (startMonth === endMonth) {
      return `${start.getDate()}–${end.getDate()} ${startMonth}`;
    }
    return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
  };

  const isToday = (date: Date) => {
    return date.toDateString() === today.toDateString();
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Kalenteri
              </h1>
              <p className="text-sm text-muted-foreground">
                {formatWeekRange()}
              </p>
            </div>
          </div>

          <Button data-testid="btn-new-event">
            <Plus className="w-4 h-4 mr-2" />
            Uusi tapahtuma
          </Button>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              data-testid="btn-today"
            >
              Tänään
            </Button>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={goPrev}
                data-testid="btn-prev"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={goNext}
                data-testid="btn-next"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setViewMode("week")}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                viewMode === "week"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
              data-testid="btn-view-week"
            >
              Viikko
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                viewMode === "day"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
              data-testid="btn-view-day"
            >
              Päivä
            </button>
          </div>
        </div>

        {viewMode === "week" && (
          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date, index) => (
              <div key={index} className="text-center">
                <div className="text-xs text-muted-foreground mb-1">
                  {DAYS_FI[index]}
                </div>
                <div
                  className={cn(
                    "w-10 h-10 mx-auto rounded-full flex items-center justify-center text-sm font-medium mb-2",
                    isToday(date)
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground"
                  )}
                >
                  {date.getDate()}
                </div>
                <Card className="min-h-32 p-2 bg-card border-0 premium-shadow">
                  <div className="text-xs text-muted-foreground text-center py-8">
                    Ei tapahtumia
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}

        {viewMode === "day" && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <div className="text-center">
              <CalendarIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium text-foreground mb-2">
                {currentDate.toLocaleDateString("fi-FI", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h2>
              <p className="text-muted-foreground">
                Ei tapahtumia tälle päivälle
              </p>
            </div>
          </Card>
        )}

        <Card className="mt-6 p-4 bg-muted/30 border-0">
          <p className="text-xs text-muted-foreground text-center">
            Kalenteritoiminnot (tapahtumien luonti, linkitys keikkoihin) 
            rakennetaan Phase C:ssä.
          </p>
        </Card>
      </div>
    </div>
  );
}

import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ClipboardList, 
  Package, 
  Settings, 
  TrendingUp, 
  Clock,
  AlertCircle,
  ArrowRight
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";

const statsCards = [
  {
    title: "Uudet tilaukset",
    value: "-",
    icon: ClipboardList,
    description: "Odottaa list_jobs -rajapintaa",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  {
    title: "Tänään",
    value: "-",
    icon: Clock,
    description: "Päivän työt",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  {
    title: "Viikko",
    value: "-",
    icon: TrendingUp,
    description: "Viikon tilaukset",
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
];

const quickLinks = [
  {
    title: "Hae tilaus",
    description: "Hae tilaus tilausnumerolla",
    href: "/admin/jobs",
    icon: ClipboardList,
  },
  {
    title: "Paketit",
    description: "Näytä palvelupaketit",
    href: "/admin/packages",
    icon: Package,
  },
  {
    title: "Asetukset",
    description: "API-diagnostiikka ja asetukset",
    href: "/admin/settings",
    icon: Settings,
  },
];

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
            Hallintapaneeli
          </h1>
          <p className="text-muted-foreground">
            Tervetuloa Puuhapatet-ylläpitoon
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {statsCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card 
                key={index} 
                className="p-5 bg-card border-0 premium-shadow"
                data-testid={`stat-card-${index}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-semibold text-foreground mb-1">
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground">{stat.title}</p>
                <p className="text-xs text-muted-foreground/70 mt-1">{stat.description}</p>
              </Card>
            );
          })}
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow mb-8">
          <EmptyState
            icon={AlertCircle}
            title="Töiden listaus tulossa"
            description="Töiden listaus-rajapinta (list_jobs) ei ole vielä käytettävissä. Voit hakea yksittäisiä tilauksia tilausnumerolla."
            actionLabel="Hae tilaus"
            onAction={() => window.location.href = "/admin/jobs"}
          />
        </Card>

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Pikatoiminnot</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickLinks.map((link, index) => {
              const Icon = link.icon;
              return (
                <Link key={index} href={link.href}>
                  <Card 
                    className="p-5 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
                    data-testid={`quick-link-${index}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium text-foreground">{link.title}</h3>
                          <p className="text-sm text-muted-foreground">{link.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Package, Clock, RefreshCw } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PackageCardSkeleton } from "@/components/loading-skeleton";
import { EmptyState } from "@/components/empty-state";
import { api, normalizePackage, type NormalizedPackage } from "@/lib/api";

export default function AdminPackagesPage() {
  const packagesQuery = useQuery({
    queryKey: ["/api/packages"],
    queryFn: async (): Promise<NormalizedPackage[]> => {
      const result = await api.packages();
      if (!result.ok || !result.data?.ok) {
        throw new Error(result.error || "Failed to fetch packages");
      }
      return (result.data.packages || []).map(normalizePackage);
    },
    retry: 2,
  });

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
                Palvelupaketit
              </h1>
              <p className="text-muted-foreground">
                Näytä ja hallinnoi palvelupaketteja
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => packagesQuery.refetch()}
            disabled={packagesQuery.isRefetching}
            data-testid="refresh-packages"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${packagesQuery.isRefetching ? 'animate-spin' : ''}`} />
            Päivitä
          </Button>
        </div>

        {packagesQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <PackageCardSkeleton />
            <PackageCardSkeleton />
            <PackageCardSkeleton />
            <PackageCardSkeleton />
          </div>
        ) : packagesQuery.isError ? (
          <EmptyState
            icon={Package}
            title="Pakettien lataus epäonnistui"
            description="Emme pystyneet lataamaan palvelupaketteja. Yritä uudelleen."
            actionLabel="Yritä uudelleen"
            onAction={() => packagesQuery.refetch()}
          />
        ) : packagesQuery.data?.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Ei palvelupaketteja"
            description="Palvelupaketteja ei ole vielä lisätty järjestelmään."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {packagesQuery.data?.map((pkg) => (
              <Card 
                key={pkg.id} 
                className="p-5 bg-card border-0 premium-shadow"
                data-testid={`admin-package-card-${pkg.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        {pkg.name}
                      </h3>
                      {pkg.active ? (
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-900/30 dark:border-green-800">
                          Aktiivinen
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500">
                          Ei käytössä
                        </Badge>
                      )}
                    </div>
                    {pkg.category && (
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        {pkg.category}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {pkg.description}
                </p>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>{pkg.durationMinutes} min</span>
                  </div>
                  <p className="text-xl font-semibold text-primary">
                    {pkg.price} €
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-8 p-4 bg-muted/30 border-0">
          <p className="text-sm text-muted-foreground text-center">
            Palvelupakettien muokkaus tapahtuu Google Sheets -taulukossa. 
            Muutokset päivittyvät automaattisesti.
          </p>
        </Card>
      </div>
    </div>
  );
}

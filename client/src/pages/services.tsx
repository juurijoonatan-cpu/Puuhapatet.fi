import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sparkles, Snowflake, Smartphone, Building2, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function ServicesPage() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t("services.title")}
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("services.subtitle")}
          </p>
        </div>

        <div className="space-y-6 mb-12">
          <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-basic">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-foreground mb-3">
                  {t("service.basic.title")}
                </h2>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{t("service.basic.1")}</span>
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{t("service.basic.2")}</span>
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{t("service.basic.3")}</span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          <Card 
            id="talvikiilto"
            className="p-6 md:p-8 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-0 premium-shadow" 
            data-testid="service-talvikiilto"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Snowflake className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("service.talvikiilto.title")}
                  </h2>
                </div>
                <p className="text-muted-foreground mb-3">
                  {t("service.talvikiilto.desc")}
                </p>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-4">
                  {t("service.talvikiilto.why")}
                </p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2 text-muted-foreground text-sm">
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <span>{t("service.talvikiilto.1")}</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground text-sm">
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <span>{t("service.talvikiilto.2")}</span>
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground text-sm">
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <span>{t("service.talvikiilto.3")}</span>
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          <Card className="p-6 md:p-8 bg-card border-0 premium-shadow opacity-80" data-testid="service-senior">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-xl font-semibold text-foreground">
                    {t("service.senior.title")}
                  </h2>
                  <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-900/30 dark:border-purple-800">
                    {t("service.senior.coming")}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {t("service.senior.desc")}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 md:p-8 bg-card border-0 premium-shadow" data-testid="service-special">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  {t("service.special.title")}
                </h2>
                <p className="text-muted-foreground">
                  {t("service.special.desc")}
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-2 text-center">
            {t("packages.title")}
          </h2>
          <p className="text-muted-foreground text-center mb-6">
            <Badge variant="outline" className="mr-2">
              {t("packages.coming")}
            </Badge>
            {t("packages.note")}
          </p>
          
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-single">
              <h3 className="font-semibold text-foreground mb-2">
                {t("package.single.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("package.single.desc")}
              </p>
            </Card>
            
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-recurring">
              <h3 className="font-semibold text-foreground mb-2">
                {t("package.recurring.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("package.recurring.desc")}
              </p>
            </Card>
            
            <Card className="p-5 bg-card border-0 premium-shadow opacity-80" data-testid="package-kiilto">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-foreground">
                  {t("package.kiilto.title")}
                </h3>
                <Badge variant="outline" className="text-xs">
                  {t("packages.coming")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("package.kiilto.desc")}
              </p>
            </Card>
          </div>
        </div>

        <div className="text-center">
          <Link href="/tilaus">
            <Button size="lg" data-testid="services-cta">
              {t("hero.cta")}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

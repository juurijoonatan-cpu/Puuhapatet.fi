import { Link } from "wouter";
import { Home, AlertCircle, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <Card className="p-8 bg-card border-0 premium-shadow">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
          </div>
          <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Sivua ei löytynyt
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Etsimääsi sivua ei valitettavasti löytynyt. 
            Se on ehkä siirretty tai poistettu.
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/">
              <Button data-testid="not-found-home" className="w-full">
                <Home className="w-4 h-4 mr-2" />
                Palaa etusivulle
              </Button>
            </Link>
            <Link href="/rekry">
              <Button variant="outline" className="w-full">
                <Briefcase className="w-4 h-4 mr-2" />
                Etsitkö rekrysivua?
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

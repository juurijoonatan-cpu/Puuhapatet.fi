import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle, Home, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BookingData {
  jobId: string;
  response: {
    ok: boolean;
    data?: {
      ok: boolean;
      jobId?: string;
      message?: string;
      error?: string;
    };
    error?: string;
  };
  job: Record<string, unknown>;
  timestamp: string;
}

export default function ConfirmationPage() {
  const [bookingData, setBookingData] = useState<BookingData | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const stored = sessionStorage.getItem("lastBooking");
    if (stored) {
      try {
        setBookingData(JSON.parse(stored));
      } catch {
        console.error("Failed to parse booking data");
      }
    }
  }, []);

  const copyJobId = () => {
    if (bookingData?.jobId) {
      navigator.clipboard.writeText(bookingData.jobId);
      toast({
        title: "Kopioitu!",
        description: "Tilausnumero kopioitu leikepöydälle.",
      });
    }
  };

  if (!bookingData) {
    return (
      <div className="min-h-screen bg-background pt-24 md:pt-32 pb-28">
        <div className="container mx-auto px-4 max-w-lg text-center">
          <Card className="p-8 bg-card border-0 premium-shadow">
            <p className="text-muted-foreground mb-4">
              Tilaustietoja ei löytynyt. Olet ehkä jo poistutnut sivulta.
            </p>
            <Link href="/">
              <Button data-testid="back-home">
                <Home className="w-4 h-4 mr-2" />
                Palaa etusivulle
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  const isSuccess = bookingData.response.ok && bookingData.response.data?.ok;

  return (
    <div className="min-h-screen bg-background pt-12 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-lg">
        <div className="text-center mb-8">
          <div 
            className={cn(
              "w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center",
              isSuccess ? "bg-green-100 dark:bg-green-900/30" : "bg-orange-100 dark:bg-orange-900/30"
            )}
          >
            <CheckCircle 
              className={cn(
                "w-10 h-10",
                isSuccess ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"
              )} 
            />
          </div>
          
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-3">
            {isSuccess ? "Kiitos tilauksestasi!" : "Tilaus lähetetty"}
          </h1>
          <p className="text-muted-foreground text-lg">
            {isSuccess 
              ? "Olemme vastaanottaneet tilauksesi ja otamme sinuun yhteyttä pian."
              : "Tilauksesi on lähetetty käsittelyyn."
            }
          </p>
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Tilausnumero</p>
            <div className="flex items-center justify-center gap-2">
              <span 
                className="text-2xl font-semibold text-primary font-mono tracking-wider"
                data-testid="job-id-display"
              >
                {bookingData.jobId}
              </span>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={copyJobId}
                className="text-muted-foreground"
                data-testid="copy-job-id"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Säilytä tämä numero yhteydenottoja varten
            </p>
          </div>
        </Card>

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Mitä seuraavaksi?</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">1</span>
              <span className="text-muted-foreground">Käsittelemme tilauksesi ja tarkistamme tiedot.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">2</span>
              <span className="text-muted-foreground">Otamme sinuun yhteyttä vahvistaaksemme ajankohdan.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">3</span>
              <span className="text-muted-foreground">Saavumme paikalle sovittuna aikana.</span>
            </li>
          </ul>
        </Card>

        <div className="mb-6">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2"
            data-testid="toggle-debug"
          >
            {showDebug ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDebug ? "Piilota tekniset tiedot" : "Näytä tekniset tiedot (debug)"}
          </button>
          
          {showDebug && (
            <Card className="mt-3 p-4 bg-muted/50 border border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                API Response (Debug)
              </h3>
              <pre 
                className="text-xs text-foreground bg-background p-3 rounded-lg overflow-x-auto font-mono"
                data-testid="debug-response"
              >
                {JSON.stringify(bookingData.response, null, 2)}
              </pre>
              
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-3">
                Sent Job Data
              </h3>
              <pre 
                className="text-xs text-foreground bg-background p-3 rounded-lg overflow-x-auto font-mono"
                data-testid="debug-job"
              >
                {JSON.stringify(bookingData.job, null, 2)}
              </pre>
              
              <p className="text-xs text-muted-foreground mt-3">
                Lähetetty: {new Date(bookingData.timestamp).toLocaleString("fi-FI")}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button variant="outline" className="w-full sm:w-auto" data-testid="back-home-btn">
              <Home className="w-4 h-4 mr-2" />
              Palaa etusivulle
            </Button>
          </Link>
          <Link href="/tilaus">
            <Button className="w-full sm:w-auto" data-testid="new-booking-btn">
              Tee uusi tilaus
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

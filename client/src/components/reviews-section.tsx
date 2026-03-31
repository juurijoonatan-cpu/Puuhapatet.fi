import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/animated-counter";
import { useI18n } from "@/lib/i18n";
import { Star, Quote, MapPin, Sparkle, ExternalLink } from "lucide-react";

const FALLBACK_RATING = 4.8;
const FALLBACK_RECOMMEND = 96;

const GOOGLE_REVIEW_URL = "https://g.page/r/CQo_lx1fQ57lEAE/review";

interface GoogleReview {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

interface ReviewsApiResponse {
  ok: boolean;
  configured: boolean;
  rating: number;
  totalRatings: number;
  reviews: GoogleReview[];
}

// Google "G" logo SVG
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const w = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${w} ${i <= rating ? "fill-[#FBBC05] text-[#FBBC05]" : "fill-muted text-muted"}`}
        />
      ))}
    </div>
  );
}

export function ReviewsSection() {
  const { t } = useI18n();
  const [apiData, setApiData] = useState<ReviewsApiResponse | null>(null);

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((data: ReviewsApiResponse) => setApiData(data))
      .catch(() => {/* fall through to fallback */});
  }, []);

  const rating = apiData?.rating ?? FALLBACK_RATING;
  const totalRatings = apiData?.totalRatings ?? 0;
  const liveReviews = apiData?.configured && apiData.reviews.length > 0 ? apiData.reviews : null;

  const fallbackReviews = [
    { textKey: "reviews.sample.1.text", nameKey: "reviews.sample.1.name", locationKey: "reviews.sample.1.location", rating: 5 },
    { textKey: "reviews.sample.2.text", nameKey: "reviews.sample.2.name", locationKey: "reviews.sample.2.location", rating: 5 },
    { textKey: "reviews.sample.3.text", nameKey: "reviews.sample.3.name", locationKey: "reviews.sample.3.location", rating: 5 },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Sparkle className="w-4 h-4" />
            <span>{t("reviews.subtitle")}</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-foreground">
            {t("reviews.title")}
          </h2>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-6 mb-12 max-w-2xl mx-auto">
          <Card className="p-6 text-center bg-card border-0 premium-shadow">
            <div className="flex items-center justify-center gap-2 mb-2">
              <AnimatedCounter end={rating} decimals={1} duration={2000} className="text-4xl md:text-5xl font-bold text-primary" />
              <span className="text-4xl md:text-5xl font-bold text-primary">/5</span>
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <GoogleLogo className="w-4 h-4" />
              <p className="text-sm text-muted-foreground">{t("reviews.stats.google")}</p>
            </div>
            {totalRatings > 0 && (
              <p className="text-xs text-muted-foreground">{totalRatings} {t("reviews.stats.total")}</p>
            )}
          </Card>
          <Card className="p-6 text-center bg-card border-0 premium-shadow">
            <div className="text-4xl md:text-5xl font-bold text-primary mb-2">
              <AnimatedCounter end={FALLBACK_RECOMMEND} suffix="%" duration={2000} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("reviews.stats.recommend")}
            </p>
          </Card>
        </div>

        {/* Reviews grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {liveReviews
            ? liveReviews.slice(0, 3).map((review, index) => (
                <Card
                  key={index}
                  className="p-6 bg-card border-0 premium-shadow flex flex-col"
                  data-testid={`review-card-${index}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {review.profile_photo_url ? (
                        <img
                          src={review.profile_photo_url}
                          alt={review.author_name}
                          className="w-10 h-10 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                          {review.author_name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-foreground text-sm leading-tight">{review.author_name}</p>
                        <p className="text-xs text-muted-foreground">{review.relative_time_description}</p>
                      </div>
                    </div>
                    <GoogleLogo className="w-5 h-5 flex-shrink-0" />
                  </div>
                  <StarRating rating={review.rating} />
                  {review.text && (
                    <p className="text-foreground mt-3 leading-relaxed text-sm flex-1">
                      "{review.text}"
                    </p>
                  )}
                </Card>
              ))
            : fallbackReviews.map((review, index) => (
                <Card
                  key={index}
                  className="p-6 bg-card border-0 premium-shadow"
                  data-testid={`review-card-${index}`}
                >
                  <Quote className="w-8 h-8 text-primary/20 mb-4" />
                  <p className="text-foreground mb-4 leading-relaxed">
                    "{t(review.textKey)}"
                  </p>
                  <StarRating rating={review.rating} />
                  <div className="flex items-center justify-between mt-3">
                    <span className="font-medium text-foreground text-sm">
                      {t(review.nameKey)}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {t(review.locationKey)}
                    </span>
                  </div>
                </Card>
              ))}
        </div>

        {/* Google CTA */}
        <Card className="p-8 bg-card border-0 premium-shadow max-w-xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <GoogleLogo className="w-7 h-7" />
            <span className="text-lg font-semibold text-foreground">{t("reviews.google.badge")}</span>
          </div>
          <p className="text-muted-foreground mb-6 text-sm">
            {t("reviews.google.prompt")}
          </p>
          <Button
            size="lg"
            className="gap-2 w-full sm:w-auto"
            onClick={() => window.open(GOOGLE_REVIEW_URL, "_blank", "noopener,noreferrer")}
          >
            <GoogleLogo className="w-5 h-5" />
            {t("reviews.google.cta")}
            <ExternalLink className="w-4 h-4 opacity-70" />
          </Button>
        </Card>

      </div>
    </section>
  );
}

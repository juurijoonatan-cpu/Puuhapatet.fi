import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedCounter } from "@/components/animated-counter";
import { useI18n } from "@/lib/i18n";
import { Star, Quote, CheckCircle, Sparkle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const GOOGLE_RATING = 4.8;
const RECOMMEND_PERCENT = 96;

interface ReviewFormData {
  rating: number | null;
  service: string | null;
  comment: string;
}

export function ReviewsSection() {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<ReviewFormData>({
    rating: null,
    service: null,
    comment: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const handleRatingSelect = (rating: number) => {
    setFormData({ ...formData, rating });
    setStep(2);
  };

  const handleServiceSelect = (service: string) => {
    setFormData({ ...formData, service });
    setStep(3);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setStep(1);
      setFormData({ rating: null, service: null, comment: "" });
    }, 3000);
  };

  const sampleReviews = [
    { textKey: "reviews.sample.1.text", nameKey: "reviews.sample.1.name", locationKey: "reviews.sample.1.location", rating: 5 },
    { textKey: "reviews.sample.2.text", nameKey: "reviews.sample.2.name", locationKey: "reviews.sample.2.location", rating: 5 },
    { textKey: "reviews.sample.3.text", nameKey: "reviews.sample.3.name", locationKey: "reviews.sample.3.location", rating: 5 },
  ];

  const services = [
    { key: "windows", labelKey: "reviews.leave.service.windows" },
    { key: "balcony", labelKey: "reviews.leave.service.balcony" },
    { key: "talvikiilto", labelKey: "reviews.leave.service.talvikiilto" },
    { key: "other", labelKey: "reviews.leave.service.other" },
  ];

  return (
    <section className="py-16 md:py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Sparkle className="w-4 h-4" />
            <span>{t("reviews.subtitle")}</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-foreground">
            {t("reviews.title")}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-12 max-w-2xl mx-auto">
          <Card className="p-6 text-center bg-card border-0 premium-shadow">
            <div className="text-4xl md:text-5xl font-bold text-primary mb-2">
              <AnimatedCounter end={RECOMMEND_PERCENT} suffix="%" duration={2000} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("reviews.stats.recommend")}
            </p>
          </Card>
          <Card className="p-6 text-center bg-card border-0 premium-shadow">
            <div className="text-4xl md:text-5xl font-bold text-primary mb-2">
              <AnimatedCounter end={GOOGLE_RATING} decimals={1} suffix="/5" duration={2000} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("reviews.stats.google")}
            </p>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {sampleReviews.map((review, index) => (
            <Card 
              key={index} 
              className="p-6 bg-card border-0 premium-shadow"
              data-testid={`review-card-${index}`}
            >
              <Quote className="w-8 h-8 text-primary/20 mb-4" />
              <p className="text-foreground mb-4 leading-relaxed">
                "{t(review.textKey)}"
              </p>
              <div className="flex items-center gap-1 mb-3">
                {[...Array(review.rating)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>
              <div className="flex items-center justify-between">
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

        <Card className="p-6 md:p-8 bg-card border-0 premium-shadow max-w-xl mx-auto">
          <h3 className="text-xl font-semibold text-foreground text-center mb-6">
            {t("reviews.leave.title")}
          </h3>

          {submitted ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-lg font-medium text-foreground">
                {t("reviews.leave.thanks")}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 mb-6">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={cn(
                      "w-8 h-1 rounded-full transition-colors",
                      step >= s ? "bg-primary" : "bg-muted"
                    )}
                  />
                ))}
              </div>

              {step === 1 && (
                <div className="space-y-4">
                  <p className="text-center text-muted-foreground mb-4">
                    {t("reviews.leave.step1")}
                  </p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        onClick={() => handleRatingSelect(rating)}
                        className={cn(
                          "w-14 h-14 md:w-16 md:h-16 rounded-xl flex items-center justify-center transition-all duration-200",
                          "bg-muted hover:bg-primary/10 hover:scale-105 active:scale-95"
                        )}
                        data-testid={`rating-${rating}`}
                      >
                        <span className="text-2xl font-bold text-foreground">{rating}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-center text-muted-foreground mb-4">
                    {t("reviews.leave.step2")}
                  </p>
                  {services.map((service) => (
                    <button
                      key={service.key}
                      onClick={() => handleServiceSelect(service.key)}
                      className={cn(
                        "w-full p-4 rounded-xl text-left transition-all duration-200",
                        "bg-muted hover:bg-primary/10 text-foreground font-medium"
                      )}
                      data-testid={`service-${service.key}`}
                    >
                      {t(service.labelKey)}
                    </button>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-center text-muted-foreground mb-2">
                    {t("reviews.leave.step3")}{" "}
                    <span className="text-xs">{t("reviews.leave.optional")}</span>
                  </p>
                  <Textarea
                    value={formData.comment}
                    onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                    placeholder={t("reviews.leave.placeholder")}
                    className="min-h-24 resize-none"
                    data-testid="review-comment"
                  />
                  <Button 
                    onClick={handleSubmit} 
                    className="w-full"
                    size="lg"
                    data-testid="submit-review"
                  >
                    {t("reviews.leave.submit")}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

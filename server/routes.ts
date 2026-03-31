import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

interface GoogleReview {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

interface ReviewsData {
  rating: number;
  totalRatings: number;
  reviews: GoogleReview[];
}

interface ReviewsCache {
  data: ReviewsData;
  fetchedAt: number;
}

let reviewsCache: ReviewsCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/reviews", async (_req, res) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const placeId = process.env.GOOGLE_PLACE_ID;

    if (!apiKey || !placeId) {
      return res.json({ ok: true, configured: false, reviews: [], rating: 4.8, totalRatings: 0 });
    }

    if (reviewsCache && Date.now() - reviewsCache.fetchedAt < CACHE_TTL_MS) {
      return res.json({ ok: true, configured: true, ...reviewsCache.data });
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total,reviews&key=${apiKey}&language=fi&reviews_sort=newest`;
      const response = await fetch(url);
      const json = await response.json() as any;

      if (json.status !== "OK") {
        return res.json({ ok: false, error: json.status, reviews: [], rating: 4.8, totalRatings: 0 });
      }

      const data: ReviewsData = {
        rating: json.result.rating ?? 4.8,
        totalRatings: json.result.user_ratings_total ?? 0,
        reviews: (json.result.reviews ?? []) as GoogleReview[],
      };

      reviewsCache = { data, fetchedAt: Date.now() };
      return res.json({ ok: true, configured: true, ...data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to fetch reviews", reviews: [], rating: 4.8, totalRatings: 0 });
    }
  });

  return httpServer;
}

export interface Review {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  date: string; // ISO date string — relative time computed dynamically
  text: string;
}

export const GOOGLE_RATING = 5.0;
export const GOOGLE_REVIEW_COUNT = 3;

export const reviews: Review[] = [
  {
    author_name: "Ilari Sell",
    rating: 5,
    date: "2026-04-20",
    text: "Loistava palvelu ja laadukasta jälkeä. Suosittelen!",
  },
  {
    author_name: "Lisbeth Österman",
    rating: 5,
    date: "2026-03-23",
    text: "Todella hyvä ikkunapesu, iloista, ammattitaitoista tekemistä, ja upea tulos! Kohtuu hinta",
  },
  {
    author_name: "Niilo T",
    rating: 5,
    date: "2026-03-23",
    text: "Hoitivat kevään ikkunan pesun mallikkaasti! Aian sopiminen hoitui kätevästi 👍",
  },
];

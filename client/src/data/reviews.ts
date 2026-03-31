/**
 * Google Reviews — päivitä manuaalisesti muutaman kuukauden välein.
 *
 * Kuinka päivittää:
 * 1. Avaa Google Maps ja etsi Puuhapatet
 * 2. Kopioi haluamasi arvostelut tähän tiedostoon
 * 3. Päivitä GOOGLE_RATING ja GOOGLE_REVIEW_COUNT vastaamaan nykyisiä lukuja
 * 4. Commitoi muutos
 */

export interface Review {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
}

export const GOOGLE_RATING = 5.0;
export const GOOGLE_REVIEW_COUNT = 3;

export const reviews: Review[] = [
  {
    author_name: "Lisbeth Österman",
    rating: 5,
    relative_time_description: "5 päivää sitten",
    text: "Todella hyvä ikkunapesu, iloista, ammattitaitoista tekemistä, ja upea tulos! Kohtuu hinta",
  },
  {
    author_name: "Niilo T",
    rating: 5,
    relative_time_description: "6 päivää sitten",
    text: "Hoitivat kevään ikkunan pesun mallikkaasti! Aian sopiminen hoitui kätevästi 👍",
  },
];

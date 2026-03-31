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
  profile_photo_url?: string; // jätä tyhjäksi tai lisää URL Google-profiilikuvaan
  rating: number;
  relative_time_description: string; // esim. "kuukausi sitten", "2 viikkoa sitten"
  text: string;
}

// Päivitä nämä luvut Google-sivulta kun muuttuvat
export const GOOGLE_RATING = 5.0;
export const GOOGLE_REVIEW_COUNT = 1;

// Kopioi oikeat arvostelut tähän Google Mapsista
export const reviews: Review[] = [
  {
    author_name: "Juuri Joonatan",
    rating: 5,
    relative_time_description: "juuri äsken",
    text: "Korvaa tämä oikeilla Google-arvosteluillasi. Avaa Google Maps → etsi Puuhapatet → arvostelut → kopioi tähän.",
  },
];

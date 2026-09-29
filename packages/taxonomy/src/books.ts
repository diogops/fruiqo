import type { GenreKey } from './genres.js';
import { normalizeMoodText } from './text.js';

// RF-48 (D-21): assuntos da Open Library (texto livre, CC0, multilíngue) → gêneros próprios.
// Local e determinístico. "Romance" em português é o gênero literário (narrativa longa), não
// história de amor: só "love stories"/"romance fiction"/"histórias de amor" contam como romance.

const SUBJECT_RULES: { genre: GenreKey; terms: string[] }[] = [
  { genre: 'scifi', terms: ['science fiction', 'ficcao cientifica', 'dystopia', 'distopia', 'dystopias', 'space opera', 'time travel'] },
  { genre: 'fantasy', terms: ['fantasy', 'fantasia', 'magic', 'magia', 'dragons', 'wizards'] },
  { genre: 'horror', terms: ['horror', 'terror', 'ghost stories', 'vampires', 'zombies'] },
  { genre: 'thriller', terms: ['thriller', 'thrillers', 'suspense', 'psychological fiction'] },
  { genre: 'mystery', terms: ['mystery', 'mysteries', 'detective and mystery stories', 'detective', 'misterio', 'romance policial'] },
  { genre: 'crime', terms: ['crime', 'criminals', 'police', 'policial', 'murder'] },
  { genre: 'romance', terms: ['love stories', 'romance fiction', 'historias de amor', 'romantic fiction'] },
  { genre: 'history', terms: ['history', 'historia', 'historical fiction', 'ficcao historica', 'world war', 'guerra mundial'] },
  { genre: 'war', terms: ['war stories', 'war', 'guerra', 'military'] },
  { genre: 'comedy', terms: ['humor', 'humorous stories', 'satire', 'satira', 'comedy'] },
  { genre: 'drama', terms: ['domestic fiction', 'psychological fiction', 'family life', 'coming of age', 'brazilian fiction', 'ficcao brasileira', 'romance brasileiro', 'fiction'] },
  { genre: 'family', terms: ['children', 'infantil', 'juvenile fiction', 'picture books'] },
  { genre: 'young_adult', terms: ['young adult', 'juvenile fiction', 'infantojuvenil', 'literatura juvenil'] },
  { genre: 'biography', terms: ['biography', 'biografia', 'autobiography', 'autobiografia', 'memoirs', 'memorias'] },
  { genre: 'nonfiction', terms: ['essays', 'ensaios', 'journalism', 'jornalismo', 'philosophy', 'filosofia', 'popular science', 'divulgacao cientifica', 'politics', 'politica', 'economics', 'sociology'] },
  { genre: 'poetry', terms: ['poetry', 'poesia', 'poems', 'poemas'] },
  { genre: 'self_help', terms: ['self-help', 'self help', 'autoajuda', 'personal development', 'success', 'habits'] },
];

const CRITICISM = [' criticism ', ' critica ', ' study guides '];

/** Máximo de gêneros derivados por livro (evita "tudo" num livro com 80 assuntos). */
export const MAX_BOOK_GENRES = 3;

export function genresFromSubjects(subjects: readonly string[]): GenreKey[] {
  const counts = new Map<GenreKey, number>();
  const normalized = subjects
    .slice(0, 60)
    .map((s) => ` ${normalizeMoodText(s)} `)
    // estudo sobre a obra ("History and criticism") não diz o gênero dela
    .filter((s) => !CRITICISM.some((c) => s.includes(c)));
  for (const rule of SUBJECT_RULES) {
    let hits = 0;
    for (const subj of normalized) {
      if (rule.terms.some((t) => subj.includes(` ${normalizeMoodText(t)} `))) hits++;
    }
    if (hits > 0) counts.set(rule.genre, hits);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  // "drama" genérico (ficção) só entra se nada mais específico apareceu
  const specific = ranked.filter((g) => g !== 'drama');
  return (specific.length > 0 ? specific : ranked).slice(0, MAX_BOOK_GENRES);
}

# Consulta ao TMDB sobre a Seção 1.C (C-15 / D-07)

Rascunho para o dono do produto enviar pela conta dele no TMDB (suporte em https://www.themoviedb.org/talk ou pelo contato indicado nas configurações de API). Registre a resposta, com data, neste arquivo e na decision-matrix (§7.2). Com resposta favorável e escrita, a D-07 permite definir `TMDB_AI_CLEARANCE=confirmed`.

---

**Subject:** Clarification on API Terms of Use, Section 1.C ("AI based Application")

Hello TMDB team,

I'm building a personal, non-commercial app (single user today, no monetization) that helps me organize movie and TV recommendations I save from social media. I use the TMDB API with attribution to search titles, show genres, overview, posters and Brazilian watch providers (crediting JustWatch on every display), and I cache data for at most 6 months.

Section 1.C of the API Terms of Use says developers may not "use the TMDB APIs or TMDB Content in connection with, including for training, a machine learning (ML) or artificial intelligence (AI) based Application." I'd like to confirm how this applies to my case before enabling any AI feature:

1. The app may use a third-party LLM (Anthropic's API) **only** to (a) extract candidate titles from text the user shared (e.g., a caption or OCR of a screenshot) and (b) interpret a short free-text mood typed by the user ("I'm sad, I want something uplifting") into structured criteria such as genres and tone.
2. **No TMDB data is ever sent to the LLM** — not titles, genres, keywords, overviews, images, providers, IDs or anything derived from them. The LLM never sees TMDB Content, and TMDB Content is never used to train or fine-tune any model.
3. After the LLM step, the app queries TMDB normally and ranks results with deterministic, local rules (no ML model).

Questions:
- A. Does an app with this architecture count as an "AI based Application" under Section 1.C, making TMDB use prohibited?
- B. If not, is the separation above (no TMDB Content ever sent to or processed by the LLM) sufficient for compliance?
- C. Would the answer change if the app were later distributed to other users (still free)?

Thank you for the clarification.

---

## Registro da resposta

| Data | Canal | Resumo da resposta | Efeito |
|---|---|---|---|
| — | — | Aguardando envio | D-07 em vigor: TMDB ativo, toda IA desligada |

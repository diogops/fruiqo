-- Notas de meia em meia estrela (0,5 a 5). A nota alimenta o perfil de gosto (sinal `rated`) e o
-- encaixe na fila; os CHECKs trocam o intervalo inteiro 1..5 pelo de meias estrelas.
ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_rating_check";--> statement-breakpoint
ALTER TABLE "taste_favorites" DROP CONSTRAINT "taste_favorites_rating_check";--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "rating" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "taste_favorites" ALTER COLUMN "rating" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_rating_check" CHECK ("rating" IS NULL OR ("rating" BETWEEN 0.5 AND 5 AND "rating" * 2 = floor("rating" * 2)));--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_rating_check" CHECK ("rating" IS NULL OR ("rating" BETWEEN 0.5 AND 5 AND "rating" * 2 = floor("rating" * 2)));

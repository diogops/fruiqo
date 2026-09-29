import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateShareRequest } from '@fruiqo/contracts';
import { z } from 'zod';

// Leitura das fixtures (RF-21). Formato em fixtures/README.md.

const ExpectedItemSchema = z.object({
  title: z.string(),
  kind: z.string(),
  year: z.number().int().optional(),
  creator: z.string().optional(),
  tmdbId: z.string().optional(),
});
export type ExpectedItem = z.infer<typeof ExpectedItemSchema>;

const ExpectedShareSchema = z.object({
  status: z.enum(['done', 'failed', 'rejected']).optional(),
  items: z.array(ExpectedItemSchema).default([]),
  forbidden: z.array(z.string()).default([]),
  source: z.object({ platform: z.string(), url: z.string().optional() }).optional(),
  dedup: z.object({ pagesIgnored: z.number().int(), itemsAlreadyInList: z.number().int() }).optional(),
  knownLimitation: z.string().optional(),
});
export type ExpectedShare = z.infer<typeof ExpectedShareSchema>;

const MoodCaseSchema = z.object({
  text: z.string(),
  risk: z.boolean(),
  intent: z
    .object({
      need: z.string().optional(),
      energy: z.string().optional(),
      maxRuntimeMin: z.number().optional(),
      avoidIncludes: z.array(z.string()).optional(),
      schemaOnly: z.boolean().optional(),
    })
    .optional(),
});
export type MoodCase = z.infer<typeof MoodCaseSchema>;

const MetaSchema = z.object({
  id: z.string(),
  kind: z.enum(['screenshot', 'text', 'url', 'sequence', 'mood-set', 'text_file']),
  description: z.string().default(''),
  synthetic: z.boolean(),
});

export type PipelineFixture = {
  id: string;
  set: 'public' | 'private';
  kind: 'screenshot' | 'text' | 'url' | 'sequence' | 'text_file';
  description: string;
  /** um ou mais shares, na ordem; sem clientShareId (o eval gera) */
  shares: Omit<CreateShareRequest, 'clientShareId'>[];
  expected: ExpectedShare[];
};

export type MoodFixture = { id: string; set: 'public' | 'private'; kind: 'mood-set'; description: string; cases: MoodCase[] };

export type Fixture = PipelineFixture | MoodFixture;

/** RF-47: `.txt` importado; `file` é o arquivo dentro da pasta da fixture */
const TextFileInputSchema = z.object({ name: z.string(), file: z.string().regex(/^[\w.-]+\.txt$/) });

const InputSchema = z.object({
  pages: z.array(z.string()).optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  textFile: TextFileInputSchema.optional(),
  shares: z
    .array(z.object({ pages: z.array(z.string()).optional(), url: z.string().optional(), text: z.string().optional(), textFile: TextFileInputSchema.optional() }))
    .optional(),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** `pages` na entrada são nomes (page-1); o texto vem do page-N.ocr.txt (o que o OCR do device mandaria). */
function toRequest(
  dir: string,
  input: { pages?: string[]; url?: string; text?: string; textFile?: { name: string; file: string } },
): Omit<CreateShareRequest, 'clientShareId'> {
  return {
    ...(input.pages ? { pages: input.pages.map((p) => readFileSync(join(dir, `${p}.ocr.txt`), 'utf8').trim()) } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.text ? { text: input.text } : {}),
    // o conteúdo vai como o navegador/app leria o arquivo (sem normalizar quebras de linha)
    ...(input.textFile ? { textFile: { name: input.textFile.name, content: readFileSync(join(dir, input.textFile.file), 'utf8') } } : {}),
  };
}

export function loadFixtures(dirs: { dir: string; set: 'public' | 'private' }[]): Fixture[] {
  const out: Fixture[] = [];
  for (const { dir, set } of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const fdir = join(dir, name);
      if (!statSync(fdir).isDirectory() || !existsSync(join(fdir, 'meta.json'))) continue;
      const meta = MetaSchema.parse(readJson(join(fdir, 'meta.json')));
      const expectedRaw = readJson(join(fdir, 'expected.json')) as Record<string, unknown>;

      if (meta.kind === 'mood-set') {
        out.push({ id: meta.id, set, kind: 'mood-set', description: meta.description, cases: z.array(MoodCaseSchema).parse(expectedRaw.cases) });
        continue;
      }

      const input = InputSchema.parse(
        existsSync(join(fdir, 'input.json')) ? readJson(join(fdir, 'input.json')) : { text: readFileSync(join(fdir, 'input.txt'), 'utf8').trim() },
      );
      if (meta.kind === 'sequence') {
        out.push({
          id: meta.id,
          set,
          kind: 'sequence',
          description: meta.description,
          shares: (input.shares ?? []).map((s) => toRequest(fdir, s)),
          expected: z.array(ExpectedShareSchema).parse(expectedRaw.shares),
        });
      } else {
        out.push({
          id: meta.id,
          set,
          kind: meta.kind,
          description: meta.description,
          shares: [toRequest(fdir, input)],
          expected: [ExpectedShareSchema.parse(expectedRaw)],
        });
      }
    }
  }
  return out;
}

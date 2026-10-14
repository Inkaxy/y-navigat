import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EVAL_MODELS, EVAL_PIPELINE_VERSION, INVOICE_EXTRACTION_SCHEMA_VERSION, isEvalModel } from "../../supabase/functions/_shared/modelEval";
import { isCatalogModel } from "../../supabase/functions/_shared/aiModelCatalog";

describe("modell-eval bundet til katalog", () => {
  it("har nøyaktig tre valg, alle i OpenAI-katalogen", () => {
    expect([...EVAL_MODELS]).toEqual(["gpt-4o", "gpt-6.1-sol", "gpt-6-luna"]);
    for (const m of EVAL_MODELS) expect(isCatalogModel("openai", m)).toBe(true);
    expect(isEvalModel("gpt-4.1")).toBe(false);
  });
  it("ny schema-/pipelineprofil skiller fra før-resultater", () => {
    expect(INVOICE_EXTRACTION_SCHEMA_VERSION).not.toBe("strict-v2-2026-10-14");
    expect(EVAL_PIPELINE_VERSION).toMatch(/^eval-pipeline-v2/);
  });
  it("eval bruker felles originalhjelper med frist, ingen egen nedlasting", () => {
    const src = readFileSync("supabase/functions/invoice-model-eval/index.ts", "utf8");
    expect(src).toContain("fetchVerifiedOriginal(supabaseOriginalDeps(");
    expect(src).not.toMatch(/storage\.from\("invoice-pdfs"\)\.download/);
    expect(src).toContain("pipeline: EVAL_PIPELINE_VERSION");
  });
});

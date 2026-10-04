#!/usr/bin/env node
/**
 * Server-only seed script for demo data.
 * Runs real AI assessment + 4 examiner stages for each demo sample.
 * Saves to demos table. NOT a public endpoint.
 */
import { createLLMClient, MODEL_ID } from '../src/lib/llm';
import { buildAssessmentPrompt, buildExaminerPrompt, getCriterionLabels } from '../src/lib/prompts';
import { computeOverall, splitParagraphs } from '../src/lib/scoring';
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { parseExaminerOutput, validateExaminerOutput } from '../src/lib/examiner-validation';
import samples from '../demo-samples.json';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Assessment, TaskType } from '../src/lib/types';

type Criterion = 'ta_tr' | 'cc' | 'lr' | 'gra';
const CRITERION_ORDER: Criterion[] = ['ta_tr', 'cc', 'lr', 'gra'];

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' | 'low' } };

/** Same flat output schema as the real HTTP /assess endpoint. */
const flatAssessmentSchema = z.object({
  ta_tr: z.number().int().min(0).max(9),
  cc: z.number().int().min(0).max(9),
  lr: z.number().int().min(0).max(9),
  gra: z.number().int().min(0).max(9),
  diagnosisZh: z.string().min(10),
  diagnosisEn: z.string().min(10),
});

/** Load the real PNG chart as an inline data URL for vision calls. */
function chartDataUrl(): string {
  const png = fs.readFileSync(path.join(process.cwd(), 'public', 'demo-chart.png'));
  const sig = png.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw new Error('public/demo-chart.png is not a valid PNG');
  }
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function runAssessment(
  taskType: string,
  promptText: string,
  originalText: string,
  chartUrl: string | null
) {
  const llm = createLLMClient({});
  let chartSourceData: string | undefined;
  if (taskType === 'academic1') {
    chartSourceData = `Commuters using public transport (%):\n- Alder: 2010=40%, 2020=55%\n- Brook: 2010=25%, 2020=45%\n- Cedar: 2010=15%, 2020=25%`;
  }
  const prompt = buildAssessmentPrompt(taskType as TaskType, promptText, originalText, chartUrl !== null, chartSourceData);

  const contentParts: ContentPart[] = [{ type: 'text', text: prompt }];
  if (chartUrl) {
    contentParts.push({ type: 'image_url', image_url: { url: chartUrl, detail: 'high' } });
  }

  let attempts = 0;
  const maxAttempts = 2; // initial + one malformed-output retry, same as HTTP /assess
  const startedAt = Date.now();

  while (attempts < maxAttempts) {
    try {
      let invokeMessages: { role: 'user' | 'assistant'; content: string }[];
      if (attempts === 0) {
        invokeMessages = [{ role: 'user', content: contentParts as unknown as string }];
      } else {
        // Malformed-output repair turns, identical to the real HTTP /assess endpoint.
        invokeMessages = [
          { role: 'user', content: contentParts as unknown as string },
          { role: 'assistant', content: 'I need to provide the assessment in the exact JSON format requested.' },
          { role: 'user', content: 'Your previous output was not valid JSON. Output ONLY a single valid JSON object matching the requested schema, with no markdown or commentary.' },
        ];
      }
      const response = await llm.invoke(invokeMessages, {
        model: MODEL_ID,
        temperature: attempts === 0 ? 0.2 : 0.1,
        thinking: 'disabled' as const,
        caching: 'disabled' as const,
      });
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.content.trim();
      const parsed = flatAssessmentSchema.parse(JSON.parse(jsonStr));
      const overall = computeOverall([parsed.ta_tr, parsed.cc, parsed.lr, parsed.gra]);
      const labels = getCriterionLabels(taskType as TaskType);
      // Persist the exact same nested schema as the real HTTP /assess endpoint.
      const assessment: Assessment = {
        scores: {
          ta_tr: { score: parsed.ta_tr, labelZh: labels.ta_tr.labelZh, labelEn: labels.ta_tr.labelEn },
          cc: { score: parsed.cc, labelZh: labels.cc.labelZh, labelEn: labels.cc.labelEn },
          lr: { score: parsed.lr, labelZh: labels.lr.labelZh, labelEn: labels.lr.labelEn },
          gra: { score: parsed.gra, labelZh: labels.gra.labelZh, labelEn: labels.gra.labelEn },
        },
        overall,
        diagnosisZh: parsed.diagnosisZh,
        diagnosisEn: parsed.diagnosisEn,
        provider_model: MODEL_ID,
        duration_ms: Date.now() - startedAt,
      };
      return assessment;
    } catch (err) {
      attempts++;
      console.log(`  Assessment retry ${attempts}/${maxAttempts}...`);
      if (attempts === maxAttempts) throw err;
    }
  }
  throw new Error(`Assessment failed after ${maxAttempts} attempts`);
}

async function runExaminerStage(
  taskType: string,
  criterion: Criterion,
  promptText: string,
  paragraphs: { id: string; text: string }[],
  assessment: Assessment,
  chartUrl: string | null
) {
  const llm = createLLMClient({});

  // For Task1, provide authoritative chart source data to prevent false data claims
  let chartSourceData: string | undefined;
  if (taskType === 'academic1') {
    chartSourceData = `Commuters using public transport (%):\n- Alder: 2010=40%, 2020=55%\n- Brook: 2010=25%, 2020=45%\n- Cedar: 2010=15%, 2020=25%`;
  }

  const prompt = buildExaminerPrompt(
    taskType as TaskType,
    criterion,
    promptText,
    paragraphs,
    assessment.scores,
    chartUrl !== null,
    chartSourceData
  );

  const contentParts: ContentPart[] = [{ type: 'text', text: prompt }];
  if (chartUrl) {
    contentParts.push({ type: 'image_url', image_url: { url: chartUrl, detail: 'high' } });
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const response = await llm.invoke(
        [{ role: 'user', content: contentParts as unknown as string }],
        {
          model: MODEL_ID,
          temperature: 0.2,
          thinking: 'disabled' as const,
          caching: 'disabled' as const,
        }
      );

      const raw = parseExaminerOutput(response.content);
      const normalizedParagraphs = validateExaminerOutput(
        raw,
        paragraphs,
        criterion
      );

      return {
        criterion,
        diagnosisZh: raw.diagnosisZh,
        diagnosisEn: raw.diagnosisEn,
        paragraphs: normalizedParagraphs,
        duration_ms: 0,
        provider_model: MODEL_ID,
      };
    } catch (err) {
      attempts++;
      console.log(`  Retry ${attempts}/${maxAttempts} for ${criterion}...`, (err as Error).message);
      if (attempts === maxAttempts) throw err;
    }
  }
  throw new Error(`Failed after ${maxAttempts} attempts`);
}

async function seedDemo(slug: string, sample: any) {
  console.log(`\n=== Seeding demo: ${slug} ===`);
  const paragraphs = splitParagraphs(sample.originalText);
  console.log(`Paragraphs: ${paragraphs.length}`);

  const chartUrl = sample.taskType === 'academic1' ? chartDataUrl() : null;

  // Run assessment (real model; chart included for Academic Task 1)
  console.log('Running assessment...');
  const assessStart = Date.now();
  const assessment = await runAssessment(
    sample.taskType,
    sample.promptText,
    sample.originalText,
    chartUrl
  );
  console.log(
    `Assessment done in ${Date.now() - assessStart}ms. Scores: ta_tr=${assessment.scores.ta_tr.score}, cc=${assessment.scores.cc.score}, lr=${assessment.scores.lr.score}, gra=${assessment.scores.gra.score}, overall=${assessment.overall}`
  );

  // Run 4 examiner stages; each starts from the previous saved document.
  const stages = [];
  let currentParagraphs = paragraphs;
  for (const criterion of CRITERION_ORDER) {
    const stageChart = criterion === 'ta_tr' ? chartUrl : null;
    console.log(`Running examiner stage: ${criterion}...`);
    const stageStart = Date.now();
    const stage = await runExaminerStage(
      sample.taskType,
      criterion,
      sample.promptText,
      currentParagraphs,
      assessment,
      stageChart
    );
    stage.duration_ms = Date.now() - stageStart;
    console.log(`  ${criterion} done in ${stage.duration_ms}ms`);
    stages.push(stage);
    currentParagraphs = stage.paragraphs.map((p: { paragraphId: string; correctedText: string }) => ({
      id: p.paragraphId,
      text: p.correctedText,
    }));
  }

  // Save to demos table
  const client = getSupabaseClient();
  const { error } = await client.from('demos').upsert({
    slug,
    task_type: sample.taskType,
    prompt_text: sample.promptText,
    original_text: sample.originalText,
    task_image_url: chartUrl ? '/demo-chart.png' : null,
    paragraphs,
    assessment,
    correction: { stages },
  });

  if (error) {
    console.error(`Error saving demo ${slug}:`, error.message);
    throw error;
  }
  console.log(`Demo ${slug} saved successfully.`);
}

async function main() {
  console.log('Starting demo seed...');
  const only = process.argv[2];
  if (only === 'task1' || only === 'task2') {
    await seedDemo(only, samples[only]);
  } else {
    await seedDemo('task1', samples.task1);
    await seedDemo('task2', samples.task2);
  }
  console.log('\n=== Demo seed complete ===');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Server-only seed script for demo data.
 * Runs real AI assessment + 4 examiner stages for each demo sample.
 * Saves to demos table. NOT a public endpoint.
 */
import { createLLMClient, MODEL_ID } from '../src/lib/llm';
import { buildAssessmentPrompt, buildExaminerPrompt } from '../src/lib/prompts';
import { roundToHalf } from '../src/lib/scoring';
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { parseExaminerOutput, validateExaminerOutput } from '../src/lib/examiner-validation';
import samples from '../demo-samples.json';
import fs from 'node:fs';
import path from 'node:path';

type Criterion = 'ta_tr' | 'cc' | 'lr' | 'gra';
const CRITERION_ORDER: Criterion[] = ['ta_tr', 'cc', 'lr', 'gra'];

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' | 'low' } };

/** Load the real PNG chart as an inline data URL for vision calls. */
function chartDataUrl(): string {
  const png = fs.readFileSync(path.join(process.cwd(), 'public', 'demo-chart.png'));
  const sig = png.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw new Error('public/demo-chart.png is not a valid PNG');
  }
  return `data:image/png;base64,${png.toString('base64')}`;
}

function splitParagraphs(text: string) {
  return text.split(/\n\n+/).filter(p => p.trim()).map((text, i) => ({ id: `p${i + 1}`, text: text.trim() }));
}

async function runAssessment(
  taskType: string,
  promptText: string,
  originalText: string,
  chartUrl: string | null
) {
  const llm = createLLMClient({});
  const prompt = buildAssessmentPrompt(taskType as any, promptText, originalText, chartUrl !== null);

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
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.content.trim();
      const parsed = JSON.parse(jsonStr);
      const scores = {
        ta_tr: parsed.ta_tr,
        cc: parsed.cc,
        lr: parsed.lr,
        gra: parsed.gra,
      };
      const overall = roundToHalf((scores.ta_tr + scores.cc + scores.lr + scores.gra) / 4);
      return {
        scores,
        overall,
        diagnosisZh: parsed.diagnosisZh,
        diagnosisEn: parsed.diagnosisEn,
      };
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
  assessment: { scores: Record<string, number> },
  chartUrl: string | null
) {
  const llm = createLLMClient({});

  // For Task1, provide authoritative chart source data to prevent false data claims
  let chartSourceData: string | undefined;
  if (taskType === 'academic1') {
    chartSourceData = `Commuters using public transport (%):\n- Alder: 2010=40%, 2020=55%\n- Brook: 2010=25%, 2020=45%\n- Cedar: 2010=15%, 2020=25%`;
  }

  const prompt = buildExaminerPrompt(
    taskType as any,
    criterion,
    promptText,
    paragraphs,
    Object.fromEntries(
      Object.entries(assessment.scores).map(([k, v]) => [k, { score: v }])
    ),
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
    `Assessment done in ${Date.now() - assessStart}ms. Scores: ta_tr=${assessment.scores.ta_tr}, cc=${assessment.scores.cc}, lr=${assessment.scores.lr}, gra=${assessment.scores.gra}, overall=${assessment.overall}`
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

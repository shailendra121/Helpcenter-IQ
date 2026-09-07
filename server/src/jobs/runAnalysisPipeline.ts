import {
  ANALYSIS_STAGES,
  completeAnalysisRun,
  completeAnalysisStage,
  failRunAtStage,
  getAnalysisRun,
  startAnalysisStage,
} from "../db/models/analysisRuns.js";
import { findZendeskAccountById } from "../db/models/zendeskAccounts.js";

import { ingestTickets } from "../zendesk/ingestTickets.js";
import { ingestGuideArticles } from "../zendesk/ingestGuideArticles.js";
import { runClustering } from "../clustering/runClustering.js";
import { runGapClassification } from "../classification/runGapClassification.js";
import { runRecommendationGeneration } from "../recommendations/runRecommendationGeneration.js";

export async function runAnalysisPipeline(runId: number): Promise<void> {
  const run = await getAnalysisRun(runId);

  if (!run) {
    throw new Error(`Analysis run ${runId} not found`);
  }

  const account = await findZendeskAccountById(run.zendesk_account_id);

  if (!account) {
    throw new Error(
      `Zendesk account ${run.zendesk_account_id} not found`
    );
  }

  const completedStages = new Set(
    ANALYSIS_STAGES.filter(
      (stage) => run.stage_timestamps?.[stage]?.completed_at
    )
  );

  for (const stage of ANALYSIS_STAGES) {
    if (completedStages.has(stage)) {
      continue;
    }
    try{
         await startAnalysisStage(runId, stage);
    
      switch (stage) {
        case "ticket_ingestion":
          await ingestTickets(
            run.zendesk_account_id,
            account.subdomain,
            run.window_days as 30 | 60 | 90,
            runId
          );
          break;

        case "guide_ingestion":
          await ingestGuideArticles(
            run.zendesk_account_id,
            account.subdomain
          );
          break;

        case "clustering":
          await runClustering(
            run.zendesk_account_id,
            runId
          );
          break;

        case "classification":
          await runGapClassification(
            run.zendesk_account_id,
            runId
          );
          break;

        case "recommendation":
          await runRecommendationGeneration(
            run.zendesk_account_id,
            runId
          );
          break;
      }

      await completeAnalysisStage(runId, stage);
    } catch (error) {
      await failRunAtStage(runId, stage, error);
      throw error;
    }
  }

  await completeAnalysisRun(runId);
}
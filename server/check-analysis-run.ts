import "dotenv/config";
import { pool } from "./src/db/pool.js";

async function main() {
  console.log("1. Testing jsonb_set directly...");

  const expression = await pool.query(`
    SELECT jsonb_set(
      '{}'::jsonb,
      ARRAY['ticket_ingestion'],
      '{}'::jsonb || jsonb_build_object('started_at', now()),
      true
    ) AS result
  `);

  console.log(JSON.stringify(expression.rows, null, 2));

  console.log("\n2. Checking analysis_runs column...");

  const column = await pool.query(`
    SELECT
      column_name,
      data_type,
      column_default,
      is_nullable
    FROM information_schema.columns
    WHERE table_name = 'analysis_runs'
      AND column_name = 'stage_timestamps'
  `);

  console.log(JSON.stringify(column.rows, null, 2));

  console.log("\n3. Checking triggers...");

  const triggers = await pool.query(`
    SELECT
      trigger_name,
      event_manipulation,
      action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'analysis_runs'
  `);

  console.log(JSON.stringify(triggers.rows, null, 2));

  console.log("\n4. Checking analysis run 6...");

  const run = await pool.query(`
    SELECT
      id,
      status,
      current_stage,
      error_stage,
      error_message,
      stage_timestamps
    FROM analysis_runs
    WHERE id = 6
  `);

  console.log(JSON.stringify(run.rows, null, 2));
}

main()
  .catch((error) => {
    console.error("\nDB CHECK FAILED:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    console.log("\nDB connection closed.");
  });
import { pool } from "../pool.js";

/**
 * Records a one-time OAuth state id. Returns true the first time a jti is
 * seen (OK to proceed), and false if it has already been used (replay).
 * ON CONFLICT DO NOTHING makes this atomic across instances / scale-to-zero.
 */
export async function consumeOAuthState(jti: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO oauth_state_used (jti) VALUES ($1)
     ON CONFLICT (jti) DO NOTHING
     RETURNING jti`,
    [jti],
  );
  return (result.rowCount ?? 0) > 0;
}
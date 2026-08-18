/**
 * Cosine similarity between two vectors — 1 = identical direction,
 * 0 = orthogonal, -1 = opposite. Used to compare ticket embeddings
 * against cluster centroids during clustering.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Computes the centroid (element-wise average) of a set of vectors —
 * used to represent a cluster's "center" as new tickets are added.
 */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot compute centroid of an empty set of vectors");
  }

  const dimension = vectors[0].length;
  const centroid = new Array(dimension).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += vector[i];
    }
  }

  return centroid.map((sum) => sum / vectors.length);
}

/**
 * Parses pgvector's string representation ("[0.1,0.2,...]") back into
 * a number array.
 */
export function parseVector(pgVectorString: string): number[] {
  return pgVectorString
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}
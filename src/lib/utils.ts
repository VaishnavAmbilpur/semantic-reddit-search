import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculates the cosine similarity between two vectors.
 * Returns a value between 0 and 1 (1 being identical).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }
  
  const magnitude = Math.sqrt(mA) * Math.sqrt(mB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

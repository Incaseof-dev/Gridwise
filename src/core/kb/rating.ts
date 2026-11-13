/** Site ratings from wiki text. Dependency-free. */

/** EVE University's anomaly class from "Rating: Class 4" (also "Tier 9", "Class 8 Level 3"); null when absent. */
export function anomalyClassOf(notes: string[]): number | null {
  for (const n of notes) {
    const m = /^Rating:\s*(?:class|tier)\s*(\d+)\b/i.exec(n.trim());
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) return Number(m[1]);
  }
  return null;
}

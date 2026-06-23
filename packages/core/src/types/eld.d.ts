/**
 * Minimal ambient declaration for `eld` (efficient-language-detector), which ships
 * no TypeScript types. Declares only the surface the EG-4 language guard uses.
 *
 * @see packages/core/src/domain/extraction/language.ts
 */
declare module 'eld' {
  interface EldDetectResult {
    /** ISO-639-1 code (e.g. `en`, `pt`), or '' when undetected. */
    readonly language: string;
    /** Confidence signal — true when the detector is confident in `language`. */
    isReliable(): boolean;
    /** Per-language scores for the input (highest is `language`). */
    getScores(): Record<string, number>;
  }
  export const eld: {
    detect(text: string): EldDetectResult;
  };
}

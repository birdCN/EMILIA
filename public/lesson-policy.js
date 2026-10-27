// Shared by the browser and server. Legacy 20-minute sessions remain readable.
export const LESSON_DURATIONS = Object.freeze([30, 60]);
export const DEFAULT_LESSON_DURATION = 30;
export function normalizeLessonDuration(value) {
  const minutes = Number(value);
  return LESSON_DURATIONS.includes(minutes) ? minutes : DEFAULT_LESSON_DURATION;
}
export function lessonTiming(value = DEFAULT_LESSON_DURATION) {
  const minutes = Number(value) === 20 ? 20 : normalizeLessonDuration(value);
  return minutes === 60 ? [6, 16, 18, 20] : minutes === 30 ? [4, 8, 8, 10] : [3, 5, 7, 5];
}
export function learningDay(value = new Date().toISOString()) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
}

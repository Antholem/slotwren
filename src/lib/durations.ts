/** 45 → "45 min", 60 → "1 h", 105 → "1 h 45 min". */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * How much calendar a service blocks, as the service sheet explains it:
 * "Blocks 1 h 45 min in the calendar (90 min + 15 min clean-up). Next start
 * rounds up to the half hour."
 */
export function blockedTimeSummary({
  durationMin,
  bufferBeforeMin,
  bufferAfterMin,
  slotIntervalMin,
}: {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  slotIntervalMin: number;
}): string {
  const total = bufferBeforeMin + durationMin + bufferAfterMin;
  const parts = [
    bufferBeforeMin ? `${bufferBeforeMin} min prep` : null,
    `${durationMin} min`,
    bufferAfterMin ? `${bufferAfterMin} min clean-up` : null,
  ].filter(Boolean);
  const breakdown = parts.length > 1 ? ` (${parts.join(" + ")})` : "";
  const sentence = `Blocks ${formatMinutes(total)} in the calendar${breakdown}.`;
  if (total % slotIntervalMin === 0) return sentence;
  const unit =
    slotIntervalMin === 30
      ? "half hour"
      : slotIntervalMin === 15
        ? "quarter hour"
        : `next ${slotIntervalMin} minutes`;
  return `${sentence} Next start rounds up to the ${unit}.`;
}

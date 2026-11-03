/** Whether the runtime knows this IANA zone. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** All IANA zones the runtime supports, plus UTC. */
export function listTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** "GMT+8", "GMT-3:30", "GMT" for `zone` at `at`. */
export function gmtOffset(zone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  // Runtimes disagree on zero: some say "GMT", some "GMT+0".
  return !part || part.value === "GMT+0" ? "GMT" : part.value;
}

/** "Asia/Singapore (GMT+8)" */
export function timeZoneLabel(zone: string, at?: Date): string {
  return `${zone.replaceAll("_", " ")} (${gmtOffset(zone, at)})`;
}

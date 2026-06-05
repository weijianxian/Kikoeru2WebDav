export function isAsmrTrackIdSegment(value) {
  return /^(?:RJ)?\d{5,}$/i.test(String(value || ""));
}

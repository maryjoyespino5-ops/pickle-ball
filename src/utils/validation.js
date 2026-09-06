export function isRequired(value) {
  return String(value ?? "").trim().length > 0;
}

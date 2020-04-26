/**
 * Ensure alphanumeric ids
 */
export function validateId(id: string): boolean {
  // Allow empty ids
  return !id || /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id);
}

export function randomToken(): string {
  return Math.random().toString(36).substr(2);
}

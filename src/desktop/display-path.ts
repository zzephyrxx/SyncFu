/**
 * Hide Windows' extended-length filesystem prefix in labels and tooltips.
 * Keep the original path for all transport calls, IDs and filesystem access.
 */
export function displayPath(path: string): string {
  if (!path.startsWith('\\\\?\\')) return path;
  const rest = path.slice(4);
  if (/^[a-z]:\\/i.test(rest)) return rest;
  if (/^UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(rest)) return '\\' + rest.slice(3);
  // Device/volume namespaces are not interchangeable with ordinary paths.
  return path;
}

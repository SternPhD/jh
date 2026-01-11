/**
 * Convert a string to a URL-friendly slug suitable for git branch names
 */
export function slugify(text: string, maxLength: number = 50): string {
  return text
    .toLowerCase()
    // Replace special characters with their ASCII equivalents
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Replace spaces and underscores with hyphens
    .replace(/[\s_]+/g, '-')
    // Remove any characters that aren't alphanumeric or hyphens
    .replace(/[^a-z0-9-]/g, '')
    // Collapse multiple hyphens into one
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Truncate to max length (at word boundary if possible)
    .substring(0, maxLength)
    // Remove trailing hyphen if truncation created one
    .replace(/-+$/, '');
}

/**
 * Generate a branch name from a ticket ID and title
 */
export function generateBranchName(
  ticketId: string,
  title: string,
  maxSlugLength: number = 50
): string {
  const slug = slugify(title, maxSlugLength);
  return `${ticketId}/${slug}`;
}

/**
 * Extract ticket ID from branch name if present
 */
export function extractTicketId(branchName: string): string | null {
  // Match patterns like "PROJ-123/description" or "PROJ-123-description"
  const match = branchName.match(/^([A-Z][A-Z0-9]*-\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract the description part from a branch name
 */
export function extractBranchDescription(branchName: string): string | null {
  // Remove ticket ID prefix if present
  const withoutTicket = branchName.replace(/^[A-Z][A-Z0-9]*-\d+[/-]/, '');
  if (withoutTicket === branchName) {
    // No ticket ID found, return the whole branch name
    return branchName;
  }
  return withoutTicket || null;
}

/**
 * Parse a ticket key into its project and number parts
 */
function parseTicketKey(key: string): { project: string; number: number } {
  const match = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
  if (match) {
    return { project: match[1], number: parseInt(match[2], 10) };
  }
  return { project: key, number: 0 };
}

/**
 * Sort tickets by key: alphabetically by project, then descending by number
 * (most recent/highest numbers first)
 */
export function sortTicketsByKey<T extends { key: string }>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const parsedA = parseTicketKey(a.key);
    const parsedB = parseTicketKey(b.key);

    // First sort alphabetically by project
    const projectCompare = parsedA.project.localeCompare(parsedB.project);
    if (projectCompare !== 0) {
      return projectCompare;
    }

    // Then sort descending by number (higher numbers = more recent = first)
    return parsedB.number - parsedA.number;
  });
}

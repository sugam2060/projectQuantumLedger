/** Stable slug for a role name: "Release Manager!" -> "release-manager". */
export function roleKeyFromName(name: string): string {
  const key = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return key || 'role';
}

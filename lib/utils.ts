/**
 * Merges Tailwind class names, filtering out falsy values.
 * Lightweight alternative to clsx + tailwind-merge for this project.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

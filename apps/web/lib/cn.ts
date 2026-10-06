import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class merger for server components. `@m2m-payments/ui` exports one too, but that bundle is client-only. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom size tokens must be registered: otherwise text-micro is treated as a
// color and discarded when a component also sets text-white/text-neutral.
const mergeClasses = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["micro"] }] } },
});

// Helper padrão do shadcn/ui para compor classes Tailwind.
export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}

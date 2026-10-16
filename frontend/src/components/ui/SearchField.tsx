import { forwardRef, type InputHTMLAttributes } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, X } from "lucide-react";
import { FADE_OUT, GLIDE } from "../../lib/motion";

/**
 * SearchField is a page's search, as a Mac's: a rounded field led by the
 * magnifier, its clear button springing in once something's typed. It
 * takes an input's props and ref, so a combobox can be built on it.
 */
export const SearchField = forwardRef<
  HTMLInputElement,
  { value: string; onClear: () => void; clearLabel: string; className?: string } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "className"
  >
>(function SearchField({ value, onClear, clearLabel, className = "", ...rest }, ref) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        className="input h-10 rounded-xl pr-10 pl-10"
        value={value}
        spellCheck={false}
        autoComplete="off"
        {...rest}
      />
      <AnimatePresence>
        {value && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
            transition={GLIDE}
            className="absolute top-1/2 right-2.5 -mt-3 grid size-6 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
            onClick={onClear}
            aria-label={clearLabel}
          >
            <X className="size-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});

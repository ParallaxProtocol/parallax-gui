import { createContext, useContext } from "react";

/**
 * Whether the user turned animations off in Settings. App provides it;
 * components that animate values on their own (counters, the block lane)
 * read it to jump straight to the new value instead.
 */
export const AnimationsOff = createContext(false);

export function useAnimationsOff() {
  return useContext(AnimationsOff);
}

import { createContext, useContext } from "react";

/**
 * Whether the user turned animations off in Settings. App provides it;
 * components that animate on their own (rolling digits, chart sweeps)
 * read it to render still instead.
 */
export const AnimationsOff = createContext(false);

export function useAnimationsOff() {
  return useContext(AnimationsOff);
}

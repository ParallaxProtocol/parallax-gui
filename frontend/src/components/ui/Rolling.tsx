import { useState } from "react";
import { useAnimationsOff } from "../../lib/prefs";

const DIGIT = /\d/;

/**
 * Rolling shows a figure whose digits roll when it changes: the old digit
 * rises out as the new one rises in. Slots are keyed from the right, so
 * units after the number stay put and a number gaining a digit only moves
 * the digits that changed. Only digits roll; words, units and punctuation
 * simply change. What it shows on first render does not move.
 *
 * The roll is two CSS keyframe animations on transform and opacity
 * (digit-in, digit-out in styles.css), which the compositor runs on its
 * own: no per-frame JavaScript and no filter, both of which made figures
 * that change every poll stutter in WebKitGTK.
 */
export function Rolling({ value }: { value: string }) {
  const still = useAnimationsOff();
  // The previous value and a counter of changes, kept in state so the
  // digits that differ remount, and so replay their animation, once
  const [roll, setRoll] = useState({ value, prev: value, n: 0 });
  if (roll.value !== value) setRoll({ value, prev: roll.value, n: roll.n + 1 });

  if (still) return <span>{value}</span>;

  const chars = [...value];
  const prevChars = [...roll.prev];

  return (
    <span>
      <span className="sr-only">{value}</span>
      <span aria-hidden>
        {chars.map((char, i) => {
          const slot = chars.length - i;
          if (!DIGIT.test(char)) return <span key={`${slot}c`}>{char}</span>;
          const before = prevChars[prevChars.length - slot];
          const changed = roll.n > 0 && before !== char;
          if (!changed) {
            return (
              <span key={`${slot}s`} className="inline-block">
                {char}
              </span>
            );
          }
          return (
            <span key={`${slot}r${roll.n}`} className="relative inline-block">
              <span className="digit-in inline-block">{char}</span>
              {before !== undefined && DIGIT.test(before) && (
                <span className="digit-out absolute inset-0">{before}</span>
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}

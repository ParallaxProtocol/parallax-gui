import { useMemo } from "react";
import makeBlockie from "ethereum-blockies-base64";
import { addressSeed, jazzicon } from "../../lib/jazzicon";
import { useAvatarStyle, type AvatarStyle } from "../../lib/prefs";

/**
 * AddressAvatar is an address's identicon, in the style chosen in Settings:
 * Jazzicon, MetaMask's default (lib/jazzicon.ts), or Blockies, as Etherscan
 * and many wallets draw them. Both are computed from the address the way
 * those wallets compute them, so an account looks the same here as there.
 * It is a quick check that an address is the one expected, not a proof:
 * always read the address itself before sending.
 */
export function AddressAvatar({
  address,
  size = 24,
  style,
  className = "",
}: {
  address: string;
  size?: number;
  /** Overrides the chosen style, for a preview of the other. */
  style?: AvatarStyle;
  className?: string;
}) {
  const chosen = useAvatarStyle();
  const kind = style ?? chosen;
  const box = `inline-flex shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-black/10 ${className}`;
  return kind === "blockies" ? (
    <Blockie address={address} size={size} className={box} />
  ) : (
    <Jazz address={address} size={size} className={box} />
  );
}

function Jazz({ address, size, className }: { address: string; size: number; className: string }) {
  const icon = useMemo(() => {
    const seed = addressSeed(address);
    return Number.isNaN(seed) ? null : jazzicon(size, seed);
  }, [address, size]);
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {icon && (
        <>
          <rect width={size} height={size} fill={icon.background} />
          {icon.shapes.map((s, i) => (
            <rect key={i} x={0} y={0} width={size} height={size} transform={s.transform} fill={s.fill} />
          ))}
        </>
      )}
    </svg>
  );
}

function Blockie({ address, size, className }: { address: string; size: number; className: string }) {
  // A small PNG as a data: URL, which the window's content policy allows
  const src = useMemo(() => (address ? makeBlockie(address) : ""), [address]);
  return (
    <img
      aria-hidden
      alt=""
      src={src}
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

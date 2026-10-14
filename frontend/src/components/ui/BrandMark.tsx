import logo from "../../assets/logo.svg";

/**
 * BrandMark is the logo lit from behind: a soft glow in the accent that
 * breathes, for the few moments that are about the app itself (the
 * splash, the offline node).
 */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <span className="relative grid place-items-center" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="breathe absolute -inset-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
      />
      <img src={logo} alt="" className="relative" style={{ width: size, height: size }} />
    </span>
  );
}

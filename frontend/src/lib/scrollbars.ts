/**
 * Scrollbars that show only while scrolling, as on macOS: whatever scrolls is
 * marked with data-scrolling, which styles.css fades its thumb in on, and the
 * mark comes off again a moment after the scrolling stops.
 */
const LINGER_MS = 800;

const timers = new WeakMap<Element, number>();

function scrolled(e: Event) {
  const el = e.target instanceof Element ? e.target : document.documentElement;
  el.setAttribute("data-scrolling", "");
  window.clearTimeout(timers.get(el));
  timers.set(
    el,
    window.setTimeout(() => {
      el.removeAttribute("data-scrolling");
      timers.delete(el);
    }, LINGER_MS),
  );
}

// Scroll events don't bubble, so they're caught on the way down
document.addEventListener("scroll", scrolled, { capture: true, passive: true });

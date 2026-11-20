/**
 * Apple Design § Springs — critically damped, interruptible animations.
 * Wraps Motion library for panel/drawer/menu.
 */
import { animate } from "motion";

interface SpringAnimationState {
  controls?: ReturnType<typeof animate>;
  element: HTMLElement;
}

const activeAnimations = new WeakMap<HTMLElement, SpringAnimationState>();

/**
 * Apple Design § Rubber-banding — soft boundaries.
 * The further past bound, the less element follows — real things slow before stopping.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot === 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Apply rubberband to position if outside bounds.
 */
export function rubberbandClamp(value: number, min: number, max: number, dimension: number): number {
  if (value < min) {
    return min + rubberband(value - min, dimension);
  }
  if (value > max) {
    return max + rubberband(value - max, dimension);
  }
  return value;
}

/**
 * Apple Design § Momentum projection — project where gesture is *going*, not where it stopped.
 * decelerationRate ≈ 0.998 for normal scroll feel.
 */
function projectMomentum(initialVelocity: number, decelerationRate = 0.998): number {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/**
 * Calculate velocity from pointer history (px/s).
 * Uses last ~100ms of movement for accurate velocity at release.
 */
export function calculateVelocity(history: Array<{ x: number; y: number; time: number }>): { vx: number; vy: number } {
  if (history.length < 2) return { vx: 0, vy: 0 };

  const last = history[history.length - 1];
  const first = history[0];
  const dt = last.time - first.time;

  if (dt === 0) return { vx: 0, vy: 0 };

  // px/ms → px/s
  const vx = ((last.x - first.x) / dt) * 1000;
  const vy = ((last.y - first.y) / dt) * 1000;

  return { vx, vy };
}

/**
 * Animate panel with momentum after drag release.
 * Projects final position from velocity, clamps to bounds, then springs with velocity handoff.
 * Apple Design § Reduced motion — jump to the projected target instead of springing.
 */
export function animatePanelMomentum(
  panel: HTMLElement,
  currentLeft: number,
  currentTop: number,
  velocityX: number,
  velocityY: number,
  panelWidth: number,
  panelHeight: number,
  onComplete: () => void,
  reducedMotion = false
): void {
  stopPanelAnimation(panel);

  // Project momentum
  const projectedLeft = currentLeft + projectMomentum(velocityX);
  const projectedTop = currentTop + projectMomentum(velocityY);

  // Clamp to bounds using actual panel dimensions
  const targetLeft = Math.max(8, Math.min(projectedLeft, window.innerWidth - panelWidth - 8));
  const targetTop = Math.max(8, Math.min(projectedTop, window.innerHeight - panelHeight - 8));

  const deltaX = targetLeft - currentLeft;
  const deltaY = targetTop - currentTop;

  if (reducedMotion) {
    // Jump straight to the projected target — same final position, no spring.
    panel.style.left = `${targetLeft}px`;
    panel.style.top = `${targetTop}px`;
    panel.style.transform = "";
    activeAnimations.delete(panel);
    onComplete();
    return;
  }

  // Spring with velocity handoff (damping 1.0 for critically damped)
  // Motion library: velocity as single number for composite transform
  const velocity = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  const controls = animate(
    panel,
    { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
    {
      type: "spring",
      bounce: 0,
      duration: 0.4,
      velocity: velocity
    }
  );

  controls.finished.then(() => {
    // Commit final position to left/top, clear transform
    panel.style.left = `${targetLeft}px`;
    panel.style.top = `${targetTop}px`;
    panel.style.transform = "";
    activeAnimations.delete(panel);
    onComplete();
  }).catch(() => {
    // Animation interrupted - commit current position
    const computed = getComputedStyle(panel);
    const matrix = new DOMMatrix(computed.transform);
    panel.style.left = `${currentLeft + matrix.m41}px`;
    panel.style.top = `${currentTop + matrix.m42}px`;
    panel.style.transform = "";
    activeAnimations.delete(panel);
    onComplete();
  });

  activeAnimations.set(panel, { controls, element: panel });
}

/**
 * Animate panel open with spring (damping 1.0, response 0.4s).
 * Interruptible — calling animatePanelClose mid-flight reverses smoothly.
 * Apple Design § Reduced motion — cross-fade instead of slide/spring.
 */
export function animatePanelOpen(panel: HTMLElement, reducedMotion = false): void {
  stopPanelAnimation(panel);

  if (reducedMotion) {
    // Apple Design § Reduced motion — opacity cross-fade via CSS transition
    panel.style.opacity = "0";
    panel.style.transform = "none";
    panel.style.transition = "opacity 0.2s ease-out";

    // Trigger reflow
    panel.getBoundingClientRect();

    panel.style.opacity = "1";

    // Clear transition after animation
    const cleanup = () => {
      panel.style.transition = "";
    };
    panel.addEventListener("transitionend", cleanup, { once: true });

    // Fake controls for WeakMap
    activeAnimations.set(panel, { element: panel });
    return;
  }

  // Normal spring animation
  panel.style.opacity = "0";
  panel.style.transform = "translateY(-4px) scale(0.98)";

  const controls = animate(
    panel,
    { transform: "translateY(0) scale(1)" },
    {
      type: "spring",
      bounce: 0, // critically damped
      duration: 0.4
    }
  );

  // Fade in opacity via CSS
  panel.style.transition = "opacity 0.2s ease-out";
  panel.getBoundingClientRect();
  panel.style.opacity = "1";
  setTimeout(() => { panel.style.transition = ""; }, 200);

  activeAnimations.set(panel, { controls, element: panel });
}

/**
 * Animate panel close with spring (damping 1.0, response 0.3s).
 * Apple Design § Reduced motion — opacity fade instead of slide/spring.
 */
export function animatePanelClose(panel: HTMLElement, onComplete: () => void, reducedMotion = false): void {
  stopPanelAnimation(panel);

  if (reducedMotion) {
    // Apple Design § Reduced motion — opacity fade out via CSS transition
    panel.style.transition = "opacity 0.15s ease-out";
    panel.style.opacity = "0";

    const complete = () => {
      panel.style.transition = "";
      activeAnimations.delete(panel);
      onComplete();
    };
    panel.addEventListener("transitionend", complete, { once: true });

    activeAnimations.set(panel, { element: panel });
    return;
  }

  // Normal spring animation
  const controls = animate(
    panel,
    { transform: "translateY(-4px) scale(0.98)" },
    {
      type: "spring",
      bounce: 0,
      duration: 0.3
    }
  );

  // Fade out opacity via CSS
  panel.style.transition = "opacity 0.15s ease-out";
  panel.style.opacity = "0";

  controls.finished.then(() => {
    panel.style.transition = "";
    activeAnimations.delete(panel);
    onComplete();
  }).catch(() => {
    // Animation interrupted
  });

  activeAnimations.set(panel, { controls, element: panel });
}


/**
 * Stop ongoing spring animation on element.
 */
export function stopPanelAnimation(element: HTMLElement): void {
  const state = activeAnimations.get(element);
  if (!state?.controls) return;
  state.controls.stop();
  activeAnimations.delete(element);
}

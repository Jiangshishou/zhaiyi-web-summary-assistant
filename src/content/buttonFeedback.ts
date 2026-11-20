/**
 * Apple Design § Response — instant feedback on pointerdown.
 * Attaches pointerdown highlight + click handler to avoid click-only delay.
 *
 * Apple Design § Multimodal feedback — adds subtle haptic confirmation on tap.
 */
export function attachButtonWithInstantFeedback(
  button: HTMLElement,
  onClick: () => void
): void {
  let pressed = false;

  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 只响应主按钮
    pressed = true;
    button.classList.add("pressed");
  });

  button.addEventListener("pointerup", () => {
    if (!pressed) return;
    pressed = false;
    button.classList.remove("pressed");
  });

  button.addEventListener("pointercancel", () => {
    if (!pressed) return;
    pressed = false;
    button.classList.remove("pressed");
  });

  button.addEventListener("pointerleave", () => {
    if (!pressed) return;
    pressed = false;
    button.classList.remove("pressed");
  });

  button.addEventListener("click", () => {
    onClick();
    // Apple Design § Multimodal feedback — subtle haptic on tap (mobile only)
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {
        // Vibration API may fail silently in some contexts
      }
    }
  });
}

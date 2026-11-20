import { calculateVelocity, animatePanelMomentum, rubberbandClamp, stopPanelAnimation } from "./springAnimations";
import { clamp, prefersReducedMotion } from "./panelDom";
import { animate } from "motion";

export interface PanelGeometryOptions {
  element: HTMLElement;
  root: ShadowRoot;
  onPersist: () => void;
}

interface PointerGestureState {
  pointerId: number;
  captureTarget: HTMLElement;
}

interface DragState extends PointerGestureState {
  startX: number;
  startY: number;
  left: number;
  top: number;
  nextLeft: number;
  nextTop: number;
  moved: boolean;
  // Apple Design § Velocity handoff — track position/time history
  history: Array<{ x: number; y: number; time: number }>;
  // Cache panel dimensions to avoid reflow on every handleDrag
  panelWidth: number;
  panelHeight: number;
  // Track raw (unclamped) position to detect rubberband
  rawLeft: number;
  rawTop: number;
  // Apple Design § Reduced motion — decided once per gesture
  reducedMotion: boolean;
}

type ResizeEdge = "left" | "right" | "bottom";

interface ResizeState extends PointerGestureState {
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startLeft: number;
}

/**
 * Pointer drag + edge resize (left/right/bottom).
 * Owns all geometry state so the panel class stays free of drag/resize bookkeeping.
 */
export class PanelGeometryController {
  private readonly element: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly onPersist: () => void;
  private dragging?: DragState;
  private resizing?: ResizeState;
  private userResizedHeight = false;

  constructor(options: PanelGeometryOptions) {
    this.element = options.element;
    this.root = options.root;
    this.onPersist = options.onPersist;
  }

  get userResizedPanelHeight(): boolean {
    return this.userResizedHeight;
  }

  startDrag(event: Event): void {
    const pointer = event as PointerEvent;
    if (this.dragging || this.resizing) return;
    if ((pointer.target as HTMLElement).closest("button, select, label, input, textarea, a, summary, [role='button'], [role='option'], [role='switch']")) return;

    const captureTarget = pointer.currentTarget instanceof HTMLElement
      ? pointer.currentTarget
      : pointer.target instanceof HTMLElement
        ? pointer.target
        : this.element;
    const pointerId = readPointerId(pointer);

    // Cache panel dimensions to avoid reflow on every handleDrag
    const panelWidth = this.element.offsetWidth || 400;
    const panelHeight = this.element.offsetHeight || 600;

    this.dragging = {
      pointerId,
      captureTarget,
      startX: pointer.clientX,
      startY: pointer.clientY,
      left: this.element.offsetLeft,
      top: this.element.offsetTop,
      nextLeft: this.element.offsetLeft,
      nextTop: this.element.offsetTop,
      moved: false,
      history: [{ x: pointer.clientX, y: pointer.clientY, time: performance.now() }],
      panelWidth,
      panelHeight,
      rawLeft: this.element.offsetLeft,
      rawTop: this.element.offsetTop,
      reducedMotion: prefersReducedMotion()
    };
    this.element.style.willChange = "transform";
    try {
      captureTarget.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture can fail when the target is already detached.
    }

    window.addEventListener("pointermove", this.handleDrag);
    window.addEventListener("pointerup", this.stopDrag);
    window.addEventListener("pointercancel", this.stopDrag);
    window.addEventListener("blur", this.stopDrag);
    captureTarget.addEventListener("lostpointercapture", this.stopDrag);
  }

  private readonly handleDrag = (event: PointerEvent): void => {
    if (!this.dragging || !matchesPointer(event, this.dragging.pointerId)) return;

    // Apple Design § Rubber-banding — soft boundaries instead of hard clamp
    const rawLeft = this.dragging.left + event.clientX - this.dragging.startX;
    const rawTop = this.dragging.top + event.clientY - this.dragging.startY;

    // Use cached panel dimensions to calculate correct boundaries
    const maxLeft = window.innerWidth - this.dragging.panelWidth - 8;
    const maxTop = window.innerHeight - this.dragging.panelHeight - 8;
    // Rubberband dimension should be the draggable range, not the full viewport
    const draggableWidth = maxLeft - 8;
    const draggableHeight = maxTop - 8;
    // Apple Design § Reduced motion — hard clamp instead of rubber-banding
    const nextLeft = this.dragging.reducedMotion
      ? clamp(rawLeft, 8, maxLeft)
      : rubberbandClamp(rawLeft, 8, maxLeft, draggableWidth);
    const nextTop = this.dragging.reducedMotion
      ? clamp(rawTop, 8, maxTop)
      : rubberbandClamp(rawTop, 8, maxTop, draggableHeight);

    this.dragging.rawLeft = rawLeft;
    this.dragging.rawTop = rawTop;
    this.dragging.nextLeft = nextLeft;
    this.dragging.nextTop = nextTop;
    this.dragging.moved = this.dragging.moved || nextLeft !== this.dragging.left || nextTop !== this.dragging.top;
    this.element.style.transform = `translate3d(${nextLeft - this.dragging.left}px, ${nextTop - this.dragging.top}px, 0)`;

    // Apple Design § Velocity handoff — track last ~100ms for velocity calc
    const now = performance.now();
    this.dragging.history.push({ x: event.clientX, y: event.clientY, time: now });
    // Keep only recent history (last 5 points or 100ms window)
    while (this.dragging.history.length > 5 || (this.dragging.history.length > 1 && now - this.dragging.history[0].time > 100)) {
      this.dragging.history.shift();
    }
  };

  private readonly stopDrag = (event?: Event): void => {
    const dragging = this.dragging;
    if (!dragging || !matchesPointer(event, dragging.pointerId)) return;
    window.removeEventListener("pointermove", this.handleDrag);
    window.removeEventListener("pointerup", this.stopDrag);
    window.removeEventListener("pointercancel", this.stopDrag);
    window.removeEventListener("blur", this.stopDrag);
    dragging.captureTarget.removeEventListener("lostpointercapture", this.stopDrag);

    // Clear willChange immediately when drag stops
    this.element.style.willChange = "";

    if (dragging.moved) {
      // Apple Design § Velocity handoff + momentum projection
      const { vx, vy } = calculateVelocity(dragging.history);
      const velocityThreshold = 50; // px/s

      // Check if user dragged past bounds (rubberband was active)
      const maxLeft = window.innerWidth - dragging.panelWidth - 8;
      const maxTop = window.innerHeight - dragging.panelHeight - 8;
      const wasRubberbanded = dragging.rawLeft < 8 || dragging.rawLeft > maxLeft ||
                              dragging.rawTop < 8 || dragging.rawTop > maxTop;

      // Rubberband snap-back: always animate to bounds, ignore velocity
      if (wasRubberbanded) {
        stopPanelAnimation(this.element);

        // Clamp to exact bounds
        const targetLeft = Math.max(8, Math.min(dragging.nextLeft, maxLeft));
        const targetTop = Math.max(8, Math.min(dragging.nextTop, maxTop));

        if (dragging.reducedMotion) {
          // Apple Design § Reduced motion — land on the bounds, no spring
          this.element.style.left = `${targetLeft}px`;
          this.element.style.top = `${targetTop}px`;
          this.element.style.right = "auto";
          this.element.style.transform = "";
          this.element.style.willChange = "";
          this.onPersist();
        } else {
          // Set element position to current rubberbanded position
          this.element.style.left = `${dragging.nextLeft}px`;
          this.element.style.top = `${dragging.nextTop}px`;
          this.element.style.right = "auto";
          this.element.style.transform = "";

          // Animate from rubberbanded position to target bounds
          const deltaX = targetLeft - dragging.nextLeft;
          const deltaY = targetTop - dragging.nextTop;

          const controls = animate(
            this.element,
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            {
              type: "spring",
              bounce: 0,
              duration: 0.35
            }
          );

          controls.finished.then(() => {
            // Batch style updates to avoid flash
            requestAnimationFrame(() => {
              this.element.style.left = `${targetLeft}px`;
              this.element.style.top = `${targetTop}px`;
              this.element.style.right = "auto";
              this.element.style.transform = "";
              this.element.style.willChange = "";
              this.onPersist();
            });
          }).catch(() => {
            // Animation interrupted - commit current position
            const computed = getComputedStyle(this.element);
            const matrix = new DOMMatrix(computed.transform);
            requestAnimationFrame(() => {
              this.element.style.left = `${dragging.nextLeft + matrix.m41}px`;
              this.element.style.top = `${dragging.nextTop + matrix.m42}px`;
              this.element.style.right = "auto";
              this.element.style.transform = "";
              this.element.style.willChange = "";
              this.onPersist();
            });
          });
        }
      } else if (Math.abs(vx) > velocityThreshold || Math.abs(vy) > velocityThreshold) {
        // Has momentum — animate with spring + velocity
        this.element.style.left = `${dragging.nextLeft}px`;
        this.element.style.top = `${dragging.nextTop}px`;
        this.element.style.right = "auto";
        this.element.style.transform = "";

        animatePanelMomentum(
          this.element,
          dragging.nextLeft,
          dragging.nextTop,
          vx,
          vy,
          dragging.panelWidth,
          dragging.panelHeight,
          () => {
            this.element.style.willChange = "";
            this.onPersist();
          },
          dragging.reducedMotion
        );
      } else {
        // No momentum — instant commit
        this.element.style.left = `${dragging.nextLeft}px`;
        this.element.style.top = `${dragging.nextTop}px`;
        this.element.style.right = "auto";
        this.element.style.transform = "";
        this.element.style.willChange = "";
        this.onPersist();
      }
    } else {
      this.element.style.transform = "";
      this.element.style.willChange = "";
    }

    this.dragging = undefined;
    try {
      dragging.captureTarget.releasePointerCapture?.(dragging.pointerId);
    } catch {
      // Capture may already be gone after pointercancel/lostpointercapture.
    }
  };

  updateResizeCursor(event: PointerEvent): void {
    if (this.dragging || this.resizing) return;
    const edge = resolveResizeEdge(this.element.getBoundingClientRect(), event.clientX, event.clientY);
    this.root.querySelector(".panel")?.classList.remove("resize-right");

    if (edge === "left" || edge === "right") {
      this.element.style.cursor = "ew-resize";
    } else if (edge === "bottom") {
      this.element.style.cursor = "ns-resize";
    } else {
      this.element.style.cursor = "";
    }
  }

  startResize(event: PointerEvent): void {
    if (this.dragging || this.resizing) return;

    const rect = this.element.getBoundingClientRect();
    const edge = resolveResizeEdge(rect, event.clientX, event.clientY);
    if (!edge) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerId = readPointerId(event);

    this.resizing = {
      pointerId,
      captureTarget: this.element,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startLeft: rect.left
    };

    this.bindResizeLifecycle(this.resizing);
  }

  private readonly handleResize = (event: PointerEvent): void => {
    if (!this.resizing || !matchesPointer(event, this.resizing.pointerId)) return;

    const deltaX = event.clientX - this.resizing.startX;
    const deltaY = event.clientY - this.resizing.startY;

    if (this.resizing.edge === "left") {
      // Keep right edge fixed: grow width = move left edge left, shrink = move right.
      const newWidth = Math.max(300, Math.min(600, this.resizing.startWidth - deltaX));
      const widthDelta = this.resizing.startWidth - newWidth;
      const newLeft = this.resizing.startLeft + widthDelta;
      this.element.style.width = `${newWidth}px`;
      this.element.style.left = `${newLeft}px`;
      this.element.style.right = "auto";
    } else if (this.resizing.edge === "right") {
      const newWidth = Math.max(300, Math.min(600, this.resizing.startWidth + deltaX));
      this.element.style.width = `${newWidth}px`;
    } else if (this.resizing.edge === "bottom") {
      const newHeight = Math.max(400, Math.min(window.innerHeight - 40, this.resizing.startHeight + deltaY));
      this.element.style.height = `${newHeight}px`;
      this.userResizedHeight = true;
    }
  };

  private readonly stopResize = (event?: Event): void => {
    const resizing = this.resizing;
    if (!resizing || !matchesPointer(event, resizing.pointerId)) return;
    window.removeEventListener("pointermove", this.handleResize);
    window.removeEventListener("pointerup", this.stopResize);
    window.removeEventListener("pointercancel", this.stopResize);
    window.removeEventListener("blur", this.stopResize);
    resizing.captureTarget.removeEventListener("lostpointercapture", this.stopResize);
    this.resizing = undefined;
    try {
      resizing.captureTarget.releasePointerCapture?.(resizing.pointerId);
    } catch {
      // Capture may already be gone after pointercancel/lostpointercapture.
    }
    this.element.style.cursor = "";
    this.root.querySelector(".panel")?.classList.remove("resize-right");
  };

  private bindResizeLifecycle(resizing: ResizeState): void {
    try {
      resizing.captureTarget.setPointerCapture?.(resizing.pointerId);
    } catch {
      // Pointer capture can fail when the target is already detached.
    }
    window.addEventListener("pointermove", this.handleResize);
    window.addEventListener("pointerup", this.stopResize);
    window.addEventListener("pointercancel", this.stopResize);
    window.addEventListener("blur", this.stopResize);
    resizing.captureTarget.addEventListener("lostpointercapture", this.stopResize);
  }
}


function readPointerId(event: PointerEvent): number {
  return typeof event.pointerId === "number" ? event.pointerId : 0;
}

function matchesPointer(event: Event | undefined, pointerId: number): boolean {
  if (!event) return true;
  const eventPointerId = (event as PointerEvent).pointerId;
  return typeof eventPointerId !== "number" || eventPointerId === pointerId;
}

/**
 * 可缩放边的命中判定——光标提示与缩放启动的唯一来源。
 * 优先级：左 > 右 > 下（重叠区域取前者），与重构前两处副本的三元链语义一致。
 */
function resolveResizeEdge(rect: DOMRect, clientX: number, clientY: number): ResizeEdge | undefined {
  const edgeHitPx = 12;
  const rightEdgeHitPx = 24;
  const outsideGutterPx = 6;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const withinVerticalBounds = y >= 0 && y <= rect.height + outsideGutterPx;

  if (withinVerticalBounds && x >= -outsideGutterPx && x <= edgeHitPx) return "left";
  if (withinVerticalBounds && x >= rect.width - rightEdgeHitPx && x <= rect.width + outsideGutterPx) return "right";
  if (x >= 0 && x <= rect.width && y >= rect.height - edgeHitPx && y <= rect.height + outsideGutterPx) return "bottom";
  return undefined;
}

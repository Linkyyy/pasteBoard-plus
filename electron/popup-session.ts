import type { Box } from '../shared/popup-position';
import type { FocusContext } from './windows-focus';

interface PopupHost {
  setBounds(bounds: Box, animate?: boolean): void;
  hide(): void;
}

/** Position once per invocation. Focus checks must never move a visible popup. */
export class PopupSession {
  readonly target: Readonly<FocusContext> | null;
  readonly bounds: Readonly<Box>;
  private active = true;

  constructor(private host: PopupHost, bounds: Box, target: FocusContext | null) {
    this.bounds = Object.freeze({ ...bounds });
    this.target = target ? Object.freeze({ ...target }) : null;
    host.setBounds({ ...bounds }, false);
  }

  observe(current: FocusContext): boolean {
    if (!this.active || !this.target) return false;
    const original = this.target;
    if (current.window !== original.window || current.process !== original.process
      || current.control !== original.control
      || (original.elementKey && current.elementKey !== original.elementKey)) {
      this.end();
      this.host.hide();
      return false;
    }
    // Caret blinking, accessibility fallback and mouse movement are not placement events.
    return true;
  }

  end() { this.active = false; }
}

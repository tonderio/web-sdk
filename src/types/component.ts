/**
 * Shared contract for every component handle `tonder.create()` returns.
 *
 * Lives in its own module rather than in `card.ts` on purpose: once a second
 * component type exists, `card.ts` has to import that component's types for the
 * component maps while the component's own module already imports this base — a
 * `card.ts` ↔ sibling module cycle. Keeping the base here keeps the graph
 * acyclic without a later refactor.
 */

/** Base contract for every handle returned by `tonder.create()`. */
export interface TonderMountableComponent {
  /** Mount this component into its container(s). Requires `init()` to have completed. */
  mount(): Promise<void>;
  /** Unmount this component and release its resources. */
  unmount(): void;
}

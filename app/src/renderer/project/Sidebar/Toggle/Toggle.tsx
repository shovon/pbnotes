/**
 * The button that shows and hides the sidebar, first in the title-bar strip.
 * The same picture open or closed, as in VS Code and Notes: the sidebar
 * appearing is what says which. Its label says what a click will do.
 */
type Props = {
  collapsed: boolean;
  /** Whether this is macOS, for the shortcut the label names. */
  mac: boolean;
  onToggle: () => void;
};

export default function Toggle({ collapsed, mac, onToggle }: Props) {
  const label = `${collapsed ? 'Show' : 'Hide'} sidebar (${mac ? '⌘\\' : 'Ctrl+\\'})`;
  return (
    <button
      type="button"
      // Borderless until pointed at, like the picker beside it.
      className="app-region-no-drag mr-0.5 flex cursor-pointer items-center rounded-md border border-transparent p-1 text-muted hover:border-accent hover:text-accent"
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      title={label}
      onClick={onToggle}
    >
      {/* A window with a narrow column down its left: the usual picture. */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        aria-hidden
      >
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
        <line x1="6" y1="2.5" x2="6" y2="13.5" />
      </svg>
    </button>
  );
}

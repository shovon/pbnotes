/**
 * The fresh install, and the state you are back in after removing the last
 * project: there is nothing to open, so the only thing on screen is how to
 * start.
 */
export default function Welcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-[20vh] text-center leading-relaxed text-muted">
      <h1 className="mb-2 text-2xl font-bold text-fg">Pb Notes</h1>
      <p className="mx-auto mb-6 max-w-md">
        Pick a project directory to write in. Nothing is copied — notes live in
        a <code>gnotes</code> folder inside the directory you choose, so they
        move, sync and back up with the work they describe.
      </p>
      <button
        className="cursor-pointer rounded-md bg-accent px-3.5 py-2 whitespace-nowrap text-on-accent hover:brightness-110"
        onClick={onAdd}
      >
        Open project…
      </button>
    </div>
  );
}

/**
 * The fresh install, and the state you are back in after removing the last
 * project: there is nothing to open, so the only thing on screen is how to
 * start.
 */
export default function Welcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="welcome">
      <h1>gnotes</h1>
      <p>
        Pick a project directory to write in. Nothing is copied — notes live in
        a <code>gnotes</code> folder inside the directory you choose, so they
        move, sync and back up with the work they describe.
      </p>
      <button className="primary" onClick={onAdd}>
        Open project…
      </button>
    </div>
  );
}

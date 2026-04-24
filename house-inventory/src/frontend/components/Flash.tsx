import { useFlash } from "../hooks/useFlash.ts";

export function FlashContainer() {
  const { flashes, dismiss } = useFlash();
  if (flashes.length === 0) return null;
  return (
    <>
      {flashes.map((f) => (
        <div key={f.id} className={`flash ${f.kind}`}>
          <span>{f.text}</span>
          <button className="dismiss" onClick={() => dismiss(f.id)}>
            &times;
          </button>
        </div>
      ))}
    </>
  );
}

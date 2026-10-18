import { useInspectorDetail } from "../../workbench/detail.ts";

/** Shows media types, sizes, hashes and ids in the tabs that have them. */
export function TechSwitch() {
  const { technical, setTechnical } = useInspectorDetail();
  return (
    <label className="tech-switch">
      <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
      Technical
    </label>
  );
}

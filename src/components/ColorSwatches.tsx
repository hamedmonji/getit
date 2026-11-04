import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * A row of colour swatches to pick one of `options` by id, then a swatch that
 * opens the system's colour picker for a custom #rrggbb, unless `custom` is false.
 */
export function ColorSwatches({
  options,
  value,
  onChange,
  custom: allowCustom = true,
}: {
  options: { id: string; label: string; color: string }[];
  value: string;
  onChange: (value: string) => void;
  /** Whether it ends with the swatch for a custom colour. */
  custom?: boolean;
}) {
  const custom = options.some((o) => o.id === value) ? null : value;
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup type="single" spacing={2} value={custom ? "" : value} onValueChange={(v) => v && onChange(v)}>
        {options.map((o) => (
          <ToggleGroupItem
            key={o.id}
            value={o.id}
            aria-label={o.label}
            title={o.label}
            className="accent-swatch"
            style={{ background: o.color }}
          />
        ))}
      </ToggleGroup>
      {/* No shadcn colour picker; the system's opens from this swatch. */}
      {allowCustom && (
        <label
          className="accent-swatch accent-custom"
          data-state={custom ? "on" : "off"}
          title="Custom color"
          style={custom ? { background: custom } : undefined}
        >
          <input
            type="color"
            aria-label="Custom color"
            value={custom ?? "#888888"}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
        </label>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { engine, type DownloadItem, type QueueSettings, type RenameRule } from "../lib/engine";
import {
  EXAMPLE_NAME,
  PREVIEW_ROWS,
  RULE_LABELS,
  applyLabel,
  changeOp,
  limitMode,
  limitSummary,
  limitUnit,
  newRule,
  parseCount,
  previewRows,
  removeRule,
  renameSource,
  replaceRule,
  retriesHint,
  rulePlaceholders,
  rulesKey,
  stepLimit,
  stepRetries,
  withLimit,
  type LimitMode,
  type PreviewRow,
  type RenameOp,
} from "../lib/queueSettings";
import { CloseIcon, PlusIcon } from "./icons";

/** How long typing in a rule waits before the rules are saved. */
const SAVE_DELAY = 400;

/**
 * A queue's settings, in sections: how many downloads run at once, how many
 * times they retry, and the auto rename rules for new downloads' names, with
 * a preview on the queue's unfinished files and a button to rename them too.
 * Each change is saved as it's made; rules once typing pauses.
 */
export function QueueSettingsForm({
  settings,
  items,
  rememberedLimit,
  onChange,
  onRememberLimit,
  onRename,
}: {
  settings: QueueSettings;
  /** The queue's unfinished downloads, in queue order. */
  items: DownloadItem[];
  /** The limit the queue had before it went unlimited, if it did here. */
  rememberedLimit: number | undefined;
  onChange: (settings: QueueSettings) => void;
  onRememberLimit: (limit: number) => void;
  /** Renames downloads already in the queue. */
  onRename: (renames: { id: string; name: string }[]) => void;
}) {
  const limit = settings.max_concurrent;
  const setMode = (mode: LimitMode) => {
    if (mode === "none" && limit !== null) onRememberLimit(limit);
    onChange(withLimit(settings, mode, undefined, rememberedLimit));
  };
  return (
    <div className="queue-settings-body">
      <section className="qs-section">
        <div className="qs-row">
          <span className="qs-label">At a time</span>
          <Segmented
            value={limitMode(settings)}
            options={[
              ["none", "No limit"],
              ["limit", "Limited"],
            ]}
            onChange={(mode) => setMode(mode as LimitMode)}
          />
        </div>
        {limit !== null && (
          <div className="qs-row">
            <LimitStepper
              value={limit}
              onStep={(delta) => onChange(stepLimit(settings, delta))}
              onSet={(n) => onChange(withLimit(settings, "limit", n))}
            />
            <span className="qs-hint">{limitUnit(limit)}</span>
          </div>
        )}
        <p className="qs-hint">{limitSummary(limit)}</p>
      </section>

      <section className="qs-section qs-row">
        <div className="flex-1">
          <div className="qs-label">Retries</div>
          <div className="qs-hint qs-sub">{retriesHint(settings.retries)}</div>
        </div>
        <ButtonGroup className="qs-stepper">
          <Button variant="ghost" title="Fewer retries" onClick={() => onChange(stepRetries(settings, -1))}>
            −
          </Button>
          <span className="qs-stepper-value">{settings.retries}</span>
          <Button variant="ghost" title="More retries" onClick={() => onChange(stepRetries(settings, 1))}>
            +
          </Button>
        </ButtonGroup>
      </section>

      <section className="qs-section">
        <div>
          <div className="qs-label">Auto rename</div>
          <div className="qs-hint qs-sub">Rules run in order on every new link. Extension is kept.</div>
        </div>
        <RenameRules settings={settings} items={items} onChange={onChange} onRename={onRename} />
      </section>
    </div>
  );
}

/** The design's small segmented control, from a shadcn toggle group. */
function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={0}
      className="qs-segmented"
      value={value}
      onValueChange={(v) => v && onChange(v)}
    >
      {options.map(([v, label]) => (
        <ToggleGroupItem key={v} value={v}>
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** − and + around the limit, which can also be typed: any whole number from 1 up. */
function LimitStepper({
  value,
  onStep,
  onSet,
}: {
  value: number;
  onStep: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseCount(text, 1);
    if (n === null) setText(String(value));
    else if (n !== value) onSet(n);
  };
  return (
    <ButtonGroup className="qs-stepper">
      <Button variant="ghost" title="Fewer at a time" onClick={() => onStep(-1)}>
        −
      </Button>
      <Input
        className="qs-stepper-input"
        inputMode="numeric"
        aria-label="Downloads at a time"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <Button variant="ghost" title="More at a time" onClick={() => onStep(1)}>
        +
      </Button>
    </ButtonGroup>
  );
}

/**
 * The rules being edited, applied top to bottom, then a preview of what they
 * make of the queue's files and a button to rename those. Edits are saved
 * once typing pauses.
 */
function RenameRules({
  settings,
  items,
  onChange,
  onRename,
}: {
  settings: QueueSettings;
  items: DownloadItem[];
  onChange: (settings: QueueSettings) => void;
  onRename: (renames: { id: string; name: string }[]) => void;
}) {
  const [rules, setRules] = useState(settings.rename);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [example, setExample] = useState(EXAMPLE_NAME);
  const [exampleResult, setExampleResult] = useState(EXAMPLE_NAME);
  // The settings as they are when a delayed save runs.
  const latest = useRef(settings);
  latest.current = settings;

  const key = rulesKey(rules);
  const itemsKey = items.map((item) => `${item.id}\n${renameSource(item)}\n${item.file_name}`).join("\n");
  useEffect(() => {
    if (key === rulesKey(latest.current.rename)) return;
    const timer = setTimeout(() => onChange({ ...latest.current, rename: rules }), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [key]);
  useEffect(() => {
    let live = true;
    // The example goes first, then the queue's files.
    engine.previewRename([example, ...items.map(renameSource)], rules).then(
      ({ names: [exampleName, ...names], errors }) => {
        if (!live) return;
        setErrors(errors);
        setExampleResult(exampleName ?? example);
        setRows(previewRows(items, names));
      },
      (e) => console.error(e),
    );
    return () => {
      live = false;
    };
  }, [key, itemsKey, example]);

  const changed = rows.filter((row) => row.changed);
  return (
    <>
      {rules.map((rule, i) => (
        <RuleCard
          key={i}
          index={i}
          rule={rule}
          error={errors[i] ?? null}
          onChange={(r) => setRules(replaceRule(rules, i, r))}
          onRemove={() => setRules(removeRule(rules, i))}
        />
      ))}
      <Button variant="outline" className="qs-add-rule" onClick={() => setRules([...rules, newRule("prefix")])}>
        <PlusIcon size={10} /> Add rule
      </Button>
      {rules.length > 0 && (
        <div className="qs-example">
          <span className="qs-label">Example</span>
          <Input
            className="qs-rule-input"
            aria-label="Example name to try the rules on"
            placeholder="Type a file name to try"
            value={example}
            onChange={(e) => setExample(e.target.value)}
          />
          <span className="qs-preview-to">→ {exampleResult}</span>
        </div>
      )}
      {rules.length > 0 && rows.length > 0 && (
        <div className="qs-preview">
          <span className="qs-label qs-preview-heading">Preview · this queue</span>
          {rows.slice(0, PREVIEW_ROWS).map((row) => (
            <div key={row.id} className="qs-preview-row">
              <span className={"qs-preview-from" + (row.changed ? " changed" : "")}>{row.from}</span>
              {row.changed && <span className="qs-preview-to">→ {row.to}</span>}
            </div>
          ))}
        </div>
      )}
      {rules.length > 0 && changed.length > 0 && (
        <Button className="qs-apply" onClick={() => onRename(changed.map((row) => ({ id: row.id, name: row.to })))}>
          {applyLabel(changed.length)}
        </Button>
      )}
    </>
  );
}

function RuleCard({
  index,
  rule,
  error,
  onChange,
  onRemove,
}: {
  index: number;
  rule: RenameRule;
  /** What's wrong with its regex, if anything. */
  error: string | null;
  onChange: (rule: RenameRule) => void;
  onRemove: () => void;
}) {
  const placeholders = rulePlaceholders(rule);
  return (
    <div className="qs-rule">
      <div className="qs-rule-head">
        <span className="qs-rule-index">{index + 1}</span>
        <Select value={rule.op} onValueChange={(op) => onChange(changeOp(rule, op as RenameOp))}>
          <SelectTrigger size="sm" className="qs-rule-op" aria-label="Rule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RULE_LABELS) as RenameOp[]).map((op) => (
              <SelectItem key={op} value={op}>
                {RULE_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" className="qs-icon-button" title="Remove rule" onClick={onRemove}>
          <CloseIcon />
        </Button>
      </div>
      {rule.op === "replace" ? (
        <>
          <div className="flex gap-1.5">
            <Input
              className="qs-rule-input"
              placeholder={placeholders.text}
              aria-invalid={!!error}
              title={error ?? undefined}
              value={rule.pattern.text}
              onChange={(e) => onChange({ ...rule, pattern: { ...rule.pattern, text: e.target.value } })}
            />
            <Toggle
              className="qs-regex"
              title="Use regular expression"
              pressed={rule.pattern.regex}
              onPressedChange={(regex) => onChange({ ...rule, pattern: { ...rule.pattern, regex } })}
            >
              .*
            </Toggle>
          </div>
          <Input
            className="qs-rule-input"
            placeholder={placeholders.with}
            value={rule.with}
            onChange={(e) => onChange({ ...rule, with: e.target.value })}
          />
          {error && <div className="qs-error">Not a valid pattern. This rule is skipped.</div>}
        </>
      ) : (
        <Input
          className="qs-rule-input"
          placeholder={placeholders.text}
          value={"text" in rule ? rule.text : rule.pattern.text}
          onChange={(e) =>
            onChange("text" in rule ? { ...rule, text: e.target.value } : { ...rule, pattern: { ...rule.pattern, text: e.target.value } })
          }
        />
      )}
    </div>
  );
}

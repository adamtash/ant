import React, { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Card, Badge, Button } from "../base";

type JsonEditorProps = {
  title: string;
  value: string;
  onChange: (next: string) => void;
  height?: number;
  footer?: React.ReactNode;
};

export const JsonEditor: React.FC<JsonEditorProps> = ({ title, value, onChange, height = 360, footer }) => {
  const parseResult = useMemo(() => {
    try {
      JSON.parse(value);
      return { ok: true as const, error: null as string | null };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [value]);

  const format = () => {
    try {
      const next = JSON.stringify(JSON.parse(value), null, 2);
      onChange(next);
    } catch {
      // ignore
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">{title}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <Badge variant={parseResult.ok ? "nurse" : "soldier"} size="sm" dot pulse={parseResult.ok}>
              {parseResult.ok ? "Valid JSON" : "Invalid JSON"}
            </Badge>
            {!parseResult.ok && <span className="truncate">{parseResult.error}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={format}>
            Format
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-chamber-wall overflow-hidden">
        <CodeMirror
          value={value}
          height={`${height}px`}
          extensions={[json()]}
          theme="dark"
          onChange={(next) => onChange(next)}
        />
      </div>

      {footer ? <div className="mt-3">{footer}</div> : null}
      {parseResult.ok ? null : null}
    </Card>
  );
};

import React, { useMemo, useState } from "react";
import JsonView from "@uiw/react-json-view";
import { Card, Badge, Button } from "../base";

type JsonPanelProps = {
  title: string;
  value: unknown;
  endpoint?: string;
  className?: string;
};

export const JsonPanel: React.FC<JsonPanelProps> = ({ title, value, endpoint, className }) => {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">{title}</h3>
          {endpoint && (
            <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
              <Badge variant="default" size="sm">
                source
              </Badge>
              <span className="font-mono truncate">{endpoint}</span>
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="rounded-lg border border-chamber-wall bg-chamber-dark/50 overflow-auto">
        <div className="p-3 text-xs">
          <JsonView value={value as any} collapsed={2} displayDataTypes={false} enableClipboard={false} />
        </div>
      </div>
    </Card>
  );
};


import React, { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";

export type CommandPalettePage = {
  id: string;
  label: string;
  path: string;
  icon?: React.ReactNode;
  description?: string;
};

export type CommandPaletteAction = {
  id: string;
  group: string;
  label: string;
  icon?: React.ReactNode;
  keywords?: string[];
  onSelect: () => void | Promise<void>;
};

type CommandPaletteProps = {
  pages: CommandPalettePage[];
  actions?: CommandPaletteAction[];
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ pages, actions = [] }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groupedActions = useMemo(() => {
    const groups = new Map<string, CommandPaletteAction[]>();
    for (const action of actions) {
      const list = groups.get(action.group) ?? [];
      list.push(action);
      groups.set(action.group, list);
    }
    return Array.from(groups.entries());
  }, [actions]);

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command Palette">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-start justify-center pt-24 px-4">
        <div className="w-full max-w-2xl rounded-xl border border-chamber-wall bg-chamber-tunnel shadow-2xl overflow-hidden">
          <Command className="w-full">
            <div className="border-b border-chamber-wall px-4 py-3">
              <Command.Input
                autoFocus
                placeholder="Type a command or search…"
                className="w-full bg-transparent outline-none text-white placeholder:text-gray-500"
              />
              <div className="mt-1 text-xs text-gray-500">Tip: Cmd/Ctrl+K</div>
            </div>

            <Command.List className="max-h-[60vh] overflow-auto p-2">
              <Command.Empty className="p-4 text-sm text-gray-500">No results.</Command.Empty>

              <Command.Group heading="Navigate" className="px-2 py-2 text-xs text-gray-400">
                {pages.map((p) => (
                  <Command.Item
                    key={p.id}
                    value={[p.label, p.description, p.path].filter(Boolean).join(" ")}
                    onSelect={() => {
                      navigate(p.path);
                      setOpen(false);
                    }}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm text-gray-200 aria-selected:bg-chamber-wall/50 aria-selected:text-white"
                  >
                    <span className="w-6 text-center">{p.icon ?? "↗"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{p.label}</div>
                      {p.description && <div className="text-xs text-gray-500 truncate">{p.description}</div>}
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate">{p.path}</div>
                  </Command.Item>
                ))}
              </Command.Group>

              {groupedActions.map(([group, list]) => (
                <Command.Group key={group} heading={group} className="px-2 py-2 text-xs text-gray-400">
                  {list.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={[a.label, ...(a.keywords ?? [])].join(" ")}
                      onSelect={async () => {
                        await a.onSelect();
                        setOpen(false);
                      }}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm text-gray-200 aria-selected:bg-chamber-wall/50 aria-selected:text-white"
                    >
                      <span className="w-6 text-center">{a.icon ?? "⚡"}</span>
                      <div className="truncate">{a.label}</div>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>
      </div>
    </Command.Dialog>
  );
};

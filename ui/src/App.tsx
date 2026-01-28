import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Colony from "./pages/Colony";
import Logs from "./pages/Logs";
import Sessions from "./pages/Sessions";
import Config from "./pages/Config";
import Tools from "./pages/Tools";
import System from "./pages/System";

const navItems = [
  { label: "Dashboard", to: "/" },
  { label: "Colony", to: "/colony" },
  { label: "Logs", to: "/logs" },
  { label: "Sessions", to: "/sessions" },
  { label: "Config", to: "/config" },
  { label: "Tools", to: "/tools" },
  { label: "System", to: "/system" },
];

export default function App() {
  return (
    <div className="min-h-screen text-slate-100">
      <header className="px-8 py-6 border-b border-slate-800/60 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-slate-200 flex items-center justify-center font-black text-slate-950">
              A
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">ANT Control</h1>
              <p className="text-sm text-slate-400">Local runtime dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              local-only
            </span>
          </div>
        </div>
        <nav className="mt-6 flex flex-wrap gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "rounded-full px-4 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-500 text-white shadow-lg shadow-brand-500/30"
                    : "bg-slate-900 text-slate-300 hover:bg-slate-800",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/colony" element={<Colony />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/config" element={<Config />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/system" element={<System />} />
        </Routes>
      </main>
    </div>
  );
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Ant Colony Theme
        queen: {
          amber: "#F59E0B",
          gold: "#D97706",
          glow: "rgba(245, 158, 11, 0.3)",
        },
        worker: {
          earth: "#8B7355",
          brown: "#A8896C",
          worn: "#6B5B4F",
        },
        soldier: {
          rust: "#DC2626",
          dark: "#B91C1C",
          alert: "#EF4444",
        },
        nurse: {
          sage: "#84CC16",
          green: "#10B981",
          soft: "#A3E635",
        },
        architect: {
          sky: "#0EA5E9",
          blue: "#3B82F6",
          light: "#38BDF8",
        },
        forager: {
          ochre: "#EA8A3A",
          orange: "#F97316",
          gold: "#FBBF24",
        },
        drone: {
          violet: "#A855F7",
          purple: "#9333EA",
          light: "#C084FC",
        },
        pheromone: {
          trail: "#10B981",
          alarm: "#EF4444",
          queen: "#F59E0B",
        },
        chamber: {
          dark: "#0B1120",
          darker: "#050810",
          tunnel: "#1E293B",
          wall: "#334155",
        },
        fungus: {
          cyan: "#06B6D4",
        },
        // Legacy brand colors (kept for compatibility)
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        accent: {
          500: "#f97316",
          600: "#ea580c",
        },
      },
      animation: {
        "queen-pulse": "queenPulse 2s ease-in-out infinite",
        "egg-laying": "eggLaying 1.5s ease-in-out infinite",
        spawn: "spawnWorker 0.5s ease-out forwards",
        retire: "retireWorker 0.3s ease-in forwards",
        antennae: "antennaTwitch 0.8s ease-in-out infinite",
        legs: "legCycle 0.2s linear infinite",
        pheromone: "pheromoneShimmer 2s linear infinite",
        evaporate: "pheromoneEvaporate 3s ease-out forwards",
        alarm: "alarmFlash 0.3s ease-in-out infinite",
        "error-shake": "errorShake 0.5s ease-in-out",
        success: "successPulse 0.6s ease-out",
        thinking: "thinkingGlow 1.5s ease-in-out infinite",
        chamber: "chamberGlow 4s ease-in-out infinite",
        tunnel: "tunnelFlow 7s linear infinite",
        drift: "antDrift 6s ease-in-out infinite",
        orbit: "orbit 20s linear infinite",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Fira Code", "Consolas", "Monaco", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(245, 158, 11, 0.3)",
        "glow-lg": "0 0 40px rgba(245, 158, 11, 0.5)",
        alarm: "0 0 20px rgba(239, 68, 68, 0.5)",
        success: "0 0 20px rgba(16, 185, 129, 0.5)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

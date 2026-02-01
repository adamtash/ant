import React, { useEffect, useRef, useState } from 'react';
import { openLogStream } from '../api/client';
import { Button } from '../components/base';

export const Logs: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    // Open log stream
    eventSourceRef.current = openLogStream((line) => {
      if (!isPaused) {
        setLogs((prev) => {
          const next = [...prev, line];
          return next.slice(-2000); // Keep last 2000
        });
      }
    });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [isPaused]);

  useEffect(() => {
    if (!isPaused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const prettify = (line: string) => {
    try {
      if (line.trim().startsWith('{')) {
        const data = JSON.parse(line);
        // Custom formatting for pino logs
        const ts = new Date(data.time || Date.now()).toLocaleTimeString();
        const level = data.level >= 50 ? 'ERA' : data.level >= 40 ? 'WRN' : data.level >= 30 ? 'INF' : 'DBG';
        const color = data.level >= 50 ? 'text-red-500' : data.level >= 40 ? 'text-yellow-500' : data.level >= 30 ? 'text-blue-400' : 'text-gray-500';
        
        return (
          <div className="flex gap-2">
            <span className="text-gray-500 shrink-0">{ts}</span>
            <span className={`font-bold shrink-0 w-8 ${color}`}>{level}</span>
            <span className="text-gray-300 break-words">{data.msg || line}</span>
            {data.error && <span className="text-red-400 ml-2">{data.error}</span>}
          </div>
        );
      }
    } catch {
      // ignore
    }
    return <span className="text-gray-300">{line}</span>;
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📜</span> System Logs
          </h1>
          <p className="text-gray-400">Live stream of system operations</p>
        </div>
        <div className="flex gap-2">
           <Button variant="ghost" onClick={() => setLogs([])}>Clear</Button>
           <Button variant="outline" onClick={() => setIsPaused(!isPaused)}>
             {isPaused ? 'Resume' : 'Pause'}
           </Button>
        </div>
      </header>

      <div className="flex-1 bg-black/50 rounded-lg p-4 overflow-y-auto font-mono text-xs border border-chamber-wall" 
           style={{ scrollBehavior: 'smooth' }}>
        {logs.map((log, i) => (
          <div key={i} className="border-b border-white/5 py-0.5 whitespace-pre-wrap">
             {prettify(log)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

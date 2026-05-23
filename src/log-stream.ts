import { EventEmitter } from "events";

export interface LogEntry {
  timestamp: string;
  level: "info" | "success" | "warn" | "error" | "bold";
  message: string;
}

const MAX_LOG_ENTRIES = 1000;
const logBuffer: LogEntry[] = [];
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

let originalConsole: Partial<typeof console> = {};
let captured = false;

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function clean(msg: string): string {
  return msg.replace(ANSI_REGEX, "");
}

function determineLevel(msg: string): LogEntry["level"] {
  if (/\[ERROR\]|error|fail|crash/i.test(msg) && !/\[(SCAN|CONFIG|NETWORK|WALLET|BALANCE|STATUS)\]/i.test(msg)) return "error";
  if (/\[WARN\]|warning|depleted/i.test(msg)) return "warn";
  if (/\[EXECUTE\]|✓|Bet placed|executed|COMPLETE|LIVE\]/i.test(msg)) return "success";
  if (/^[═=#]+$|CYCLE|START|Running|Final/i.test(msg)) return "bold";
  return "info";
}

function addLog(level: LogEntry["level"], message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  logEmitter.emit("log", entry);
}

export function getLogHistory(): LogEntry[] {
  return [...logBuffer];
}

export function onLog(callback: (entry: LogEntry) => void): () => void {
  logEmitter.on("log", callback);
  return () => { logEmitter.off("log", callback); };
}

export function captureConsole(): void {
  if (captured) return;
  captured = true;

  originalConsole.log = console.log;
  originalConsole.error = console.error;
  originalConsole.warn = console.warn;

  console.log = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    const cleaned = clean(msg);
    if (cleaned.trim()) addLog(determineLevel(cleaned), cleaned);
    if (originalConsole.log) originalConsole.log(...args);
  };

  console.error = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    const cleaned = clean(msg);
    if (cleaned.trim()) addLog("error", cleaned);
    if (originalConsole.error) originalConsole.error(...args);
  };

  console.warn = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    const cleaned = clean(msg);
    if (cleaned.trim()) addLog("warn", cleaned);
    if (originalConsole.warn) originalConsole.warn(...args);
  };
}

export function restoreConsole(): void {
  if (!captured) return;
  captured = false;
  console.log = originalConsole.log ?? console.log;
  console.error = originalConsole.error ?? console.error;
  console.warn = originalConsole.warn ?? console.warn;
  originalConsole = {};
}

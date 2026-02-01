/**
 * Output Formatter - Pretty CLI output with colors using chalk
 */

import chalk from "chalk";

export type LogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: "left" | "right" | "center";
}

/**
 * Output formatter for consistent CLI output
 */
export class OutputFormatter {
  private readonly quiet: boolean;
  private readonly noColor: boolean;

  constructor(options: { quiet?: boolean; noColor?: boolean } = {}) {
    this.quiet = options.quiet ?? false;
    this.noColor = options.noColor ?? !process.stdout.isTTY;
  }

  /**
   * Print a message with appropriate styling
   */
  print(message: string, level: LogLevel = "info"): void {
    if (this.quiet && level !== "error") return;

    const styled = this.noColor ? message : this.styleMessage(message, level);
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(styled + "\n");
  }

  /**
   * Print a success message
   */
  success(message: string): void {
    this.print(message, "success");
  }

  /**
   * Print an info message
   */
  info(message: string): void {
    this.print(message, "info");
  }

  /**
   * Print a warning message
   */
  warn(message: string): void {
    this.print(message, "warning");
  }

  /**
   * Print an error message
   */
  error(message: string): void {
    this.print(message, "error");
  }

  /**
   * Print a debug message (only in verbose mode)
   */
  debug(message: string): void {
    this.print(message, "debug");
  }

  /**
   * Print a header/title
   */
  header(title: string): void {
    if (this.quiet) return;
    const styled = this.noColor ? `\n${title}\n${"=".repeat(title.length)}` : `\n${chalk.bold.cyan(title)}\n${chalk.dim("=".repeat(title.length))}`;
    console.log(styled);
  }

  /**
   * Print a section header
   */
  section(title: string): void {
    if (this.quiet) return;
    const styled = this.noColor ? `\n${title}:` : `\n${chalk.bold(title)}:`;
    console.log(styled);
  }

  /**
   * Print a key-value pair
   */
  keyValue(key: string, value: string | number | boolean): void {
    if (this.quiet) return;
    const formattedKey = this.noColor ? `  ${key}:` : chalk.dim(`  ${key}:`);
    const formattedValue = this.noColor ? ` ${value}` : ` ${chalk.white(String(value))}`;
    console.log(formattedKey + formattedValue);
  }

  /**
   * Print a list item
   */
  listItem(item: string, indent = 0): void {
    if (this.quiet) return;
    const prefix = "  ".repeat(indent) + "• ";
    const styled = this.noColor ? `${prefix}${item}` : `${chalk.dim(prefix)}${item}`;
    console.log(styled);
  }

  /**
   * Print a numbered list item
   */
  numberedItem(index: number, item: string): void {
    if (this.quiet) return;
    const prefix = `  ${index}. `;
    const styled = this.noColor ? `${prefix}${item}` : `${chalk.dim(prefix)}${item}`;
    console.log(styled);
  }

  /**
   * Print a simple table
   */
  table<T extends Record<string, unknown>>(data: T[], columns: TableColumn[]): void {
    if (this.quiet || data.length === 0) return;

    // Calculate column widths
    const widths = columns.map((col) => {
      const headerWidth = col.header.length;
      const maxDataWidth = Math.max(...data.map((row) => String(row[col.key] ?? "").length));
      return col.width ?? Math.max(headerWidth, maxDataWidth);
    });

    // Print header
    const headerRow = columns.map((col, i) => this.padCell(col.header, widths[i], col.align ?? "left")).join("  ");
    const separator = widths.map((w) => "-".repeat(w)).join("  ");

    if (this.noColor) {
      console.log(headerRow);
      console.log(separator);
    } else {
      console.log(chalk.bold(headerRow));
      console.log(chalk.dim(separator));
    }

    // Print data rows
    for (const row of data) {
      const rowStr = columns.map((col, i) => this.padCell(String(row[col.key] ?? ""), widths[i], col.align ?? "left")).join("  ");
      console.log(rowStr);
    }
  }

  /**
   * Print a spinner-like progress indicator
   */
  progress(message: string): () => void {
    if (this.quiet || !process.stdout.isTTY) {
      console.log(message);
      return () => {};
    }

    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const interval = setInterval(() => {
      const frame = this.noColor ? "-" : chalk.cyan(frames[i % frames.length]);
      process.stdout.write(`\r${frame} ${message}`);
      i++;
    }, 80);

    return () => {
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(message.length + 3) + "\r");
    };
  }

  /**
   * Print a box around content
   */
  box(content: string, title?: string): void {
    if (this.quiet) return;

    const lines = content.split("\n");
    const maxLen = Math.max(...lines.map((l) => l.length), title?.length ?? 0);
    const width = maxLen + 2;

    const top = title ? `┌─ ${title} ${"─".repeat(Math.max(0, width - title.length - 4))}┐` : `┌${"─".repeat(width)}┐`;
    const bottom = `└${"─".repeat(width)}┘`;

    if (this.noColor) {
      console.log(top);
      for (const line of lines) {
        console.log(`│ ${line.padEnd(maxLen)} │`);
      }
      console.log(bottom);
    } else {
      console.log(chalk.dim(top));
      for (const line of lines) {
        console.log(chalk.dim("│ ") + line.padEnd(maxLen) + chalk.dim(" │"));
      }
      console.log(chalk.dim(bottom));
    }
  }

  /**
   * Print JSON output
   */
  json(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  }

  /**
   * Print a status badge
   */
  status(label: string, status: "running" | "stopped" | "error" | "pending" | "success"): void {
    if (this.quiet) return;

    const badges: Record<string, string> = {
      running: this.noColor ? "[RUNNING]" : chalk.bgGreen.black(" RUNNING "),
      stopped: this.noColor ? "[STOPPED]" : chalk.bgGray.white(" STOPPED "),
      error: this.noColor ? "[ERROR]" : chalk.bgRed.white(" ERROR "),
      pending: this.noColor ? "[PENDING]" : chalk.bgYellow.black(" PENDING "),
      success: this.noColor ? "[SUCCESS]" : chalk.bgGreen.black(" SUCCESS "),
    };

    console.log(`${label}: ${badges[status]}`);
  }

  /**
   * Print an empty line
   */
  newline(): void {
    if (this.quiet) return;
    console.log();
  }

  /**
   * Format a duration in ms to human readable
   */
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  /**
   * Format a timestamp to human readable
   */
  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private styleMessage(message: string, level: LogLevel): string {
    switch (level) {
      case "success":
        return chalk.green("✓ ") + message;
      case "warning":
        return chalk.yellow("⚠ ") + message;
      case "error":
        return chalk.red("✗ ") + message;
      case "debug":
        return chalk.dim("› ") + chalk.dim(message);
      default:
        return chalk.blue("ℹ ") + message;
    }
  }

  private padCell(value: string, width: number, align: "left" | "right" | "center"): string {
    if (value.length >= width) return value.slice(0, width);

    switch (align) {
      case "right":
        return value.padStart(width);
      case "center": {
        const left = Math.floor((width - value.length) / 2);
        return " ".repeat(left) + value + " ".repeat(width - value.length - left);
      }
      default:
        return value.padEnd(width);
    }
  }
}

/**
 * Default formatter instance
 */
export const formatter = new OutputFormatter();

/**
 * Convenience exports
 */
export const print = formatter.print.bind(formatter);
export const success = formatter.success.bind(formatter);
export const info = formatter.info.bind(formatter);
export const warn = formatter.warn.bind(formatter);
export const error = formatter.error.bind(formatter);

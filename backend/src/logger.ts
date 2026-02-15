export interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'POLICY_VIOLATION';
    message: string;
    details?: unknown;
}

export interface DecisionLog {
    event: "AI_DECISION";
    reason: string;
    confidence: number;
    metrics: Record<string, number>;
    recommendedReplicas: number;
}

const logs: LogEntry[] = [];

export const logger = {
    info: (message: string, details?: unknown) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message,
            details,
        };
        logs.push(entry);
        // CRITICAL: Use stderr only. stdout is reserved for MCP Stdio transport.
        console.error(JSON.stringify(entry));
    },
    warn: (message: string, details?: unknown) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'WARN',
            message,
            details,
        };
        logs.push(entry);
        console.error(JSON.stringify(entry));
    },
    error: (message: string, details?: unknown) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message,
            details,
        };
        logs.push(entry);
        console.error(JSON.stringify(entry));
    },
    policyViolation: (message: string, details?: unknown) => {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'POLICY_VIOLATION',
            message,
            details,
        };
        logs.push(entry);
        console.error(JSON.stringify(entry));
    },
    getLogs: (): LogEntry[] => [...logs],
    clearLogs: () => {
        logs.length = 0;
    },
};

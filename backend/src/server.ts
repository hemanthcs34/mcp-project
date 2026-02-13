import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { logger } from "./logger.js";
import { policy } from "./policy.js";
import * as registry from "./registry.js";

// --- State ---
let systemStatus: "HEALTHY" | "CRITICAL" | "DEGRADED" = "HEALTHY";
let activeReplicas = 3;
let lastAlertTime: string | null = null;

// --- Shared tool execution logic ---
async function executeMonitor() {
    const service = registry.getApprovedService();

    if (service) {
        // Proxy to registered service
        try {
            logger.info("Calling external monitor endpoint", {
                serviceName: service.serviceName,
                endpoint: service.monitorEndpoint,
            });
            const response = await fetch(service.monitorEndpoint, {
                headers: {
                    Authorization: `Bearer ${service.apiKey}`,
                },
            });
            const data = await response.json();
            logger.info("External monitor response received", { status: response.status });
            return data;
        } catch (error) {
            logger.error("Failed to call external monitor endpoint", {
                error: error instanceof Error ? error.message : String(error),
            });
            // Fallback to simulation
        }
    }

    // Simulation mode (fallback)
    const cpu = systemStatus === "CRITICAL" ? 98 : 45;
    const memory = systemStatus === "CRITICAL" ? 85 : 40;
    logger.info("monitor_tool executed (simulation)", { cpu, memory, systemStatus });
    return {
        status: systemStatus,
        cpu_load: cpu,
        memory_usage: memory,
        replicas: activeReplicas,
        alert_active: systemStatus === "CRITICAL",
    };
}

async function executeScale(replicas: number): Promise<{ success: boolean; message: string }> {
    // Policy check ALWAYS runs first
    const policyCheck = policy.validateScale({ replicas });
    if (!policyCheck.allowed) {
        return { success: false, message: `Action Blocked: ${policyCheck.reason}` };
    }

    const service = registry.getApprovedService();

    if (service) {
        // Proxy to registered service
        try {
            logger.info("Calling external scale endpoint", {
                serviceName: service.serviceName,
                endpoint: service.scaleEndpoint,
                replicas,
            });
            const response = await fetch(service.scaleEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${service.apiKey}`,
                },
                body: JSON.stringify({ replicas }),
            });
            const data = await response.json();
            logger.info("External scale response received", { status: response.status });

            if (response.ok) {
                // Update local state to reflect successful external scaling
                activeReplicas = replicas;

                // If system was critical, assume it recovered
                if (systemStatus === "CRITICAL") {
                    systemStatus = "HEALTHY";
                    const remediationTime = new Date().toISOString();
                    logger.info("System stabilized after external scaling", {
                        remediationTime,
                        alertStarted: lastAlertTime,
                    });
                    lastAlertTime = null;
                }
            }

            return {
                success: response.ok,
                message: data.message || `External service scaled to ${replicas} replicas`,
            };
        } catch (error) {
            logger.error("Failed to call external scale endpoint", {
                error: error instanceof Error ? error.message : String(error),
            });
            return { success: false, message: "Failed to call external service" };
        }
    }

    // Simulation mode (fallback)
    activeReplicas = replicas;
    if (systemStatus === "CRITICAL" && replicas > 3) {
        systemStatus = "HEALTHY";
        const remediationTime = new Date().toISOString();
        logger.info("System stabilized after scaling", {
            remediationTime,
            alertStarted: lastAlertTime,
        });
        lastAlertTime = null;
    }

    logger.info("scale_tool executed (simulation)", { replicas });
    return { success: true, message: `Successfully scaled to ${replicas} replicas.` };
}

async function executeRollback(): Promise<{ success: boolean; message: string }> {
    policy.validateRollback();

    const service = registry.getApprovedService();

    if (service) {
        // Proxy to registered service
        try {
            logger.info("Calling external rollback endpoint", {
                serviceName: service.serviceName,
                endpoint: service.rollbackEndpoint,
            });
            const response = await fetch(service.rollbackEndpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${service.apiKey}`,
                },
            });
            const data = await response.json();
            logger.info("External rollback response received", { status: response.status });

            if (response.ok) {
                // Assume rollback fixes the issue
                const previousStatus = systemStatus;
                systemStatus = "HEALTHY";
                activeReplicas = 3; // Reset replicas
                lastAlertTime = null;
                logger.info("System stabilized after external rollback", { previousStatus });
            }

            return {
                success: response.ok,
                message: data.message || "External service rollback successful",
            };
        } catch (error) {
            logger.error("Failed to call external rollback endpoint", {
                error: error instanceof Error ? error.message : String(error),
            });
            return { success: false, message: "Failed to call external service" };
        }
    }

    // Simulation mode (fallback)
    const previousStatus = systemStatus;
    systemStatus = "HEALTHY";
    activeReplicas = 3;
    lastAlertTime = null;
    logger.info("Rollback executed (simulation)", { previousStatus, restoredTo: "HEALTHY" });
    return { success: true, message: "Rollback successful. Version restored." };
}

// --- Express App for Frontend ---
const app = express();
app.use(cors());
app.use(express.json());

// API Endpoints
app.get("/api/status", (_req: Request, res: Response) => {
    res.json({
        status: systemStatus,
        replicas: activeReplicas,
        lastAlertTime,
    });
});

app.get("/api/logs", (_req: Request, res: Response) => {
    res.json(logger.getLogs());
});

app.post("/api/trigger-alert", (_req: Request, res: Response) => {
    if (systemStatus === "CRITICAL") {
        res.status(409).json({ error: "Alert already active" });
        return;
    }
    systemStatus = "CRITICAL";
    lastAlertTime = new Date().toISOString();
    logger.error("CRITICAL INFRA ALERT: CPU Load > 95%", {
        source: "Simulated Infra",
    });
    res.json({ message: "Alert triggered", lastAlertTime });
});

app.post("/api/scale", async (req: Request, res: Response) => {
    const schema = z.object({ replicas: z.number() });
    const parseResult = schema.safeParse(req.body);

    if (!parseResult.success) {
        logger.error("Invalid arguments for scale API", {
            errors: parseResult.error.issues,
        });
        res.status(400).json({ error: "Invalid input", details: parseResult.error.issues });
        return;
    }

    const result = await executeScale(parseResult.data.replicas);
    if (!result.success) {
        res.status(403).json({ error: result.message });
        return;
    }
    res.json({ message: result.message, replicas: activeReplicas, status: systemStatus });
});

app.post("/api/rollback", async (_req: Request, res: Response) => {
    const result = await executeRollback();
    res.json({ message: result.message, status: systemStatus });
});

// --- Admin Endpoints for Service Registration ---

app.post("/api/register", (req: Request, res: Response) => {
    const parseResult = registry.registerSchema.safeParse(req.body);

    if (!parseResult.success) {
        logger.error("Invalid service registration", {
            errors: parseResult.error.issues,
        });
        res.status(400).json({ error: "Invalid input", details: parseResult.error.issues });
        return;
    }

    const service = registry.registerService(parseResult.data);
    res.json({ message: "Service registered (pending approval)", service });
});

app.get("/api/services", (_req: Request, res: Response) => {
    res.json(registry.getAllServices());
});

app.get("/api/service", (_req: Request, res: Response) => {
    const service = registry.getApprovedService();
    if (!service) {
        res.json({ service: null });
        return;
    }
    const { apiKey: _key, ...safe } = service;
    res.json({ service: safe });
});

app.post("/api/services/:id/approve", (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid service ID" });
        return;
    }

    const service = registry.approveService(id);
    if (!service) {
        res.status(404).json({ error: "Service not found" });
        return;
    }

    res.json({ message: "Service approved", service });
});

app.post("/api/services/:id/reject", (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid service ID" });
        return;
    }

    const service = registry.rejectService(id);
    if (!service) {
        res.status(404).json({ error: "Service not found" });
        return;
    }

    res.json({ message: "Service rejected", service });
});


// Start Express
const HTTP_PORT = 3001;
app.listen(HTTP_PORT, () => {
    console.error(`Control Plane API running on http://localhost:${HTTP_PORT}`);
});

// --- MCP Server ---
const mcpServer = new Server(
    {
        name: "autopilot-agent",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define Tools
const TOOLS: Tool[] = [
    {
        name: "monitor_tool",
        description: "Get current system metrics (CPU, Memory, status)",
        inputSchema: {
            type: "object" as const,
            properties: {},
        },
    },
    {
        name: "scale_tool",
        description: "Scale service replicas. Requires policy approval.",
        inputSchema: {
            type: "object" as const,
            properties: {
                replicas: {
                    type: "number" as const,
                    description: "Target number of replicas (1-10)",
                },
            },
            required: ["replicas"],
        },
    },
    {
        name: "rollback_tool",
        description: "Rollback to previous stable version",
        inputSchema: {
            type: "object" as const,
            properties: {},
        },
    },
];

// Handle List Tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

// Handle Call Tool
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
        case "monitor_tool": {
            const metrics = await executeMonitor();
            return {
                content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }],
            };
        }

        case "scale_tool": {
            const schema = z.object({ replicas: z.number() });
            const parseResult = schema.safeParse(args);

            if (!parseResult.success) {
                logger.error("Invalid arguments for scale_tool", {
                    errors: parseResult.error.issues,
                });
                return {
                    content: [{ type: "text" as const, text: "Invalid arguments: replicas must be a number" }],
                    isError: true,
                };
            }

            const result = await executeScale(parseResult.data.replicas);
            return {
                content: [{ type: "text" as const, text: result.message }],
                isError: !result.success,
            };
        }

        case "rollback_tool": {
            const result = await executeRollback();
            return {
                content: [{ type: "text" as const, text: result.message }],
            };
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});

// Start MCP Server
async function startMcpServer() {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP Server running on Stdio");
}

startMcpServer().catch((error) => {
    console.error("MCP Server error:", error);
    process.exit(1);
});

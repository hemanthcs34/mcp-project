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

// System State
let systemStatus: "HEALTHY" | "CRITICAL" = "HEALTHY";
let activeReplicas = 3;
let lastAlertTime: string | null = null;
let autoPilotMode = false;
let currentLoad = 100; // Requests Per Second (RPS) - "Normal" load
let incidentCount = 0; // Tracks difficulty level
const CAPACITY_PER_REPLICA = 200; // Each replica can handle 200 RPS

// ... (Rest of state interfaces remain same)

// ... (executeMonitor, executeScale, executeRollback remain same)

// API Endpoints
// ... (status, logs remain same)

interface PendingApproval {
    id: string;
    action: "scale";
    details: any;
    timestamp: string;
}
const pendingApprovals = new Map<string, PendingApproval>();

// Feature 3: Incident Reports
interface IncidentReport {
    incident_id: string;
    start_time: string;
    end_time: string;
    mttr_seconds: number;
    actions_taken: string[];
    final_status: "resolved";
}
const incidentReports: IncidentReport[] = [];
let activeIncidentId: string | null = null; // Track current active incident

// --- Shared tool execution logic ---
async function executeMonitor() {
    const service = registry.getActiveService();

    if (service) {
        // Proxy to registered service
        try {
            logger.info("Calling external monitor endpoint", {
                event: "EXTERNAL_CALL",
                action: "monitor",
                serviceName: service.serviceName,
                endpoint: service.monitorEndpoint,
            });
            const response = await fetch(service.monitorEndpoint, {
                headers: {
                    Authorization: `Bearer ${service.apiKey}`,
                },
            });
            const data = await response.json();
            logger.info("External monitor response received", { status: response.status, data });

            // Sync local state with external service reality
            if (data) {
                if (typeof data.replicas === 'number') {
                    activeReplicas = data.replicas;
                }
                if (data.status === 'HEALTHY' || data.status === 'CRITICAL') {
                    if (systemStatus !== data.status) {
                        // Feature 2: Incident Lifecycle Tracking - External System Recovery
                        if (systemStatus === 'CRITICAL' && data.status === 'HEALTHY' && activeIncidentId) {
                            const remediationTime = new Date().toISOString();
                            const startTime = lastAlertTime ? new Date(lastAlertTime).getTime() : Date.now();
                            const mttr = (Date.now() - startTime) / 1000;

                            const report: IncidentReport = {
                                incident_id: activeIncidentId,
                                start_time: lastAlertTime || new Date().toISOString(),
                                end_time: remediationTime,
                                mttr_seconds: mttr,
                                actions_taken: [`Synced state: System recovered to ${data.status}`],
                                final_status: "resolved"
                            };
                            incidentReports.push(report);

                            logger.info("Incident Lifecycle: Resolved (External Sync)", {
                                event: "INCIDENT_RESOLVED",
                                incidentId: activeIncidentId,
                                mttr,
                                finalState: "HEALTHY",
                                report
                            });
                            activeIncidentId = null;
                            lastAlertTime = null;
                        }

                        logger.info(`State Sync: Updating systemStatus to ${data.status} based on external monitor`);
                        systemStatus = data.status;
                        if (systemStatus === 'HEALTHY') lastAlertTime = null;
                    }
                }
            }
            return data;
        } catch (error) {
            logger.error("Failed to call external monitor endpoint", {
                error: error instanceof Error ? error.message : String(error),
            });
            // Fallback to simulation
        }
    }

    // Simulation mode (fallback)
    // Dynamic CPU Calculation:
    // CPU % = (Total Load / Total Capacity) * 100
    // Total Capacity = activeReplicas * CAPACITY_PER_REPLICA
    const totalCapacity = activeReplicas * CAPACITY_PER_REPLICA;
    const utilization = currentLoad / totalCapacity;
    let cpu = Math.min(100, Math.round(utilization * 100));

    // Add some noise
    cpu = Math.max(0, Math.min(100, cpu + (Math.random() * 5 - 2.5)));

    // Derive Memory from CPU (correlated but not identical)
    let memory = Math.max(0, Math.min(100, cpu * 0.8 + 20));

    // Update System Status based on metrics
    // If CPU > 90% => CRITICAL
    // If CPU < 90% was CRITICAL, it recovers.
    if (cpu > 90) {
        if (systemStatus !== "CRITICAL") {
            const reason = `CPU load ${cpu.toFixed(1)}% exceeds critical threshold of 90%`;
            logger.info("Monitor Decision: Upgrade to CRITICAL", {
                event: "AI_DECISION",
                reason,
                confidence: 1.0,
                metrics: { cpu, memory, currentLoad, activeReplicas },
                recommendedReplicas: activeReplicas + 1 // Implied recommendation
            });
            systemStatus = "CRITICAL";
            lastAlertTime = new Date().toISOString();
            logger.error(`System overload detected: CPU ${cpu.toFixed(1)}%`, { currentLoad, activeReplicas });
        }
    } else {
        if (systemStatus === "CRITICAL") {
            const reason = `CPU load ${cpu.toFixed(1)}% is below safe threshold. Initiating recovery.`;
            logger.info("Monitor Decision: Downgrade to HEALTHY", {
                event: "AI_DECISION",
                reason,
                confidence: 0.9,
                metrics: { cpu, memory, currentLoad, activeReplicas },
                recommendedReplicas: activeReplicas
            });
            // Recovery detected
            systemStatus = "HEALTHY";
            const remediationTime = new Date().toISOString();
            const startTime = lastAlertTime ? new Date(lastAlertTime).getTime() : Date.now();
            const mttr = (Date.now() - startTime) / 1000;

            logger.info("System stabilized (Load managed)", {
                remediationTime,
                mttr,
                activeReplicas
            });

            // Generate report on recovery
            const report: IncidentReport = {
                incident_id: activeIncidentId || `INC-${Date.now()}`,
                start_time: lastAlertTime || new Date().toISOString(),
                end_time: remediationTime,
                mttr_seconds: mttr,
                actions_taken: [`Scaled to ${activeReplicas} replicas`],
                final_status: "resolved"
            };
            incidentReports.push(report);

            logger.info("Incident Lifecycle: Resolved", {
                event: "INCIDENT_RESOLVED",
                incidentId: activeIncidentId,
                mttr,
                finalState: "HEALTHY",
                report
            });
            activeIncidentId = null;
            lastAlertTime = null;
        }
        systemStatus = "HEALTHY";
    }

    logger.info("monitor_tool executed (simulation)", { cpu, memory, systemStatus, currentLoad, activeReplicas });
    return {
        status: systemStatus,
        cpu_load: cpu,
        memory_usage: memory,
        replicas: activeReplicas,
        alert_active: systemStatus === "CRITICAL",
    };
}

async function executeScale(replicas: number, bypassPolicy = false): Promise<{ success: boolean; message: string; explanation?: any; approvalRequired?: boolean; approvalId?: string }> {
    // Policy check ALWAYS runs first unless bypassed
    const policyCheck = bypassPolicy ? { allowed: true, approvalRequired: false } : policy.validateScale({ replicas });

    // Feature 2: Handle Approval Requirement
    if (policyCheck.approvalRequired) {
        const approvalId = Math.random().toString(36).substring(7);
        pendingApprovals.set(approvalId, {
            id: approvalId,
            action: "scale",
            details: { replicas },
            timestamp: new Date().toISOString()
        });
        logger.warn("Scale action requires approval", {
            event: "APPROVAL_REQUIRED",
            approvalId,
            replicas
        });
        return {
            success: false,
            message: `Action requires admin approval. Approval ID: ${approvalId}`,
            approvalRequired: true,
            approvalId
        };
    }

    if (!policyCheck.allowed) {
        return { success: false, message: `Action Blocked: ${policyCheck.reason}` };
    }

    const service = registry.getActiveService();

    if (service) {
        // Proxy to registered service
        try {
            logger.info("Calling external scale endpoint", {
                event: "EXTERNAL_CALL",
                action: "scale",
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

            // Sync local state on success
            if (response.ok) {
                activeReplicas = replicas;
                // If the external service returns a specific replica count, use that instead
                if (data.replicas && typeof data.replicas === 'number') {
                    activeReplicas = data.replicas;
                }

                // If we enhanced the python script to return status, use it
                if (data.status) {
                    // Feature 2: Incident Lifecycle Tracking - External System Recovery (Scale Action)
                    if (systemStatus === 'CRITICAL' && data.status === 'HEALTHY' && activeIncidentId) {
                        const remediationTime = new Date().toISOString();
                        const startTime = lastAlertTime ? new Date(lastAlertTime).getTime() : Date.now();
                        const mttr = (Date.now() - startTime) / 1000;

                        const report: IncidentReport = {
                            incident_id: activeIncidentId,
                            start_time: lastAlertTime || new Date().toISOString(),
                            end_time: remediationTime,
                            mttr_seconds: mttr,
                            actions_taken: [`Scale action success: System recovered to ${data.status}`],
                            final_status: "resolved"
                        };
                        incidentReports.push(report);

                        logger.info("Incident Lifecycle: Resolved (Scale Action)", {
                            event: "INCIDENT_RESOLVED",
                            incidentId: activeIncidentId,
                            mttr,
                            finalState: "HEALTHY",
                            report
                        });
                        activeIncidentId = null;
                        lastAlertTime = null;
                    }
                    systemStatus = data.status;
                }

                logger.info(`State Sync: Updated activeReplicas to ${activeReplicas}`);
            }

            return {
                success: response.ok,
                message: data.message || `External service scaled to ${replicas} replicas`,
                explanation: { reason: "External scaling", confidence: 0.95 }
            };
        } catch (error) {
            return { success: false, message: "Failed to call external service" };
        }
    }

    // Simulation mode (fallback)
    activeReplicas = replicas;
    // We do NOT manually set status to HEALTHY here.
    // We let the next monitor cycle (or immediate re-calc) determine health based on new capacity.

    logger.info("scale_tool executed (simulation)", {
        event: "SIMULATION_ACTION",
        action: "scale",
        replicas,
        currentLoad
    });

    // Immediate feedback based on math
    const totalCapacity = activeReplicas * CAPACITY_PER_REPLICA;
    const projectedCpu = Math.min(100, Math.round((currentLoad / totalCapacity) * 100));

    return {
        success: true,
        message: `Scaled to ${replicas} replicas. Projected CPU: ${projectedCpu}%`,
        explanation: {
            reason: `Increased capacity to ${totalCapacity} RPS to handle ${currentLoad} RPS load.`,
            confidence: 0.9,
            metrics_used: { currentLoad, activeReplicas }
        }
    };
}

async function executeRollback(): Promise<{ success: boolean; message: string; explanation?: any }> {
    policy.validateRollback();
    const service = registry.getActiveService();

    if (service) {
        // Proxy logic omitted for brevity, identical pattern
        // (In real code we would keep the proxy logic here)
        try {
            const response = await fetch(service.rollbackEndpoint, {
                method: "POST",
                headers: { Authorization: `Bearer ${service.apiKey}` },
            });
            return { success: response.ok, message: "External rollback initiated" };
        } catch (e) {
            return { success: false, message: "Failed to rollback external" };
        }
    }

    // Simulation mode (fallback)
    const previousReplicas = activeReplicas;
    activeReplicas = 3; // Reset to default
    // Again, we do NOT force HEALTHY. If load is high, this will cause CRITICAL status in monitor.

    logger.info("Rollback executed (simulation)", {
        event: "SIMULATION_ACTION",
        action: "rollback",
        previousReplicas,
        activeReplicas,
        currentLoad
    });

    return {
        success: true,
        message: "Rollback successful. Replicas reset to 3.",
        explanation: {
            reason: "Manual Rollback to baseline",
            confidence: 0.8,
            metrics_used: { activeReplicas: 3 }
        }
    };
}

// --- Express App for Frontend ---
const app = express();
app.use(cors());
app.use(express.json());

// Feature 2: Incident Lifecycle API
app.get("/api/incidents", (_req: Request, res: Response) => {
    res.json({
        activeIncidentId,
        history: incidentReports
    });
});


// API Endpoints
app.get("/api/status", (_req: Request, res: Response) => {
    // Check if we are in "External Service Mode"
    const service = registry.getActiveService();

    if (service) {
        // External Service Mode: Trust the current state variables
        // We do NOT recalculate status based on local load simulation
        // The state should be updated by executeMonitor/executeScale

        // OPTIONAL: We could trigger a background monitor update here if needed
        // but for now, we just return the state as is.
        res.json({
            status: systemStatus,
            replicas: activeReplicas,
            lastAlertTime,
            autoPilotMode,
            mode: "EXTERNAL_CONNECTED"
        });
        return;
    }



    // Simulation Mode: Calculate status based on Math
    const totalCapacity = activeReplicas * CAPACITY_PER_REPLICA;
    const utilization = currentLoad / totalCapacity;

    // Calculate CPU with some noise
    let cpu = Math.min(100, Math.round(utilization * 100));
    // cpu = Math.max(0, Math.min(100, cpu + (Math.random() * 5 - 2.5))); // Optional noise

    const status = cpu > 90 ? "CRITICAL" : "HEALTHY";

    if (status !== systemStatus) {
        systemStatus = status;
    }

    res.json({
        status: systemStatus,
        replicas: activeReplicas,
        lastAlertTime,
        autoPilotMode,
        mode: "SIMULATION"
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

    // Progressive Load Simulation
    incidentCount++;
    // Difficulty increases with each incident: 1->1000, 2->1500, 3->2000...
    // Base load of 500 + 500 per level
    const loadSpike = 500 + (incidentCount * 500);
    currentLoad = loadSpike;

    systemStatus = "CRITICAL";
    lastAlertTime = new Date().toISOString();

    // Feature 2: Incident Lifecycle Tracking
    activeIncidentId = `INC-${Date.now()}`;
    logger.info("Incident Lifecycle: Started", {
        event: "INCIDENT_STARTED",
        incidentId: activeIncidentId,
        load: currentLoad
    });

    logger.error(`CRITICAL INFRA ALERT: Level ${incidentCount} Load Spike (${currentLoad} RPS)`, {
        source: "Simulated Traffic",
        difficulty: `Level ${incidentCount}`,
        currentLoad
    });

    // AutoPilot Logic (Dynamic Scaling)
    if (autoPilotMode) {
        // Calculate needed replicas: Load / Capacity + 20% buffer
        const neededReplicas = Math.ceil((currentLoad * 1.2) / CAPACITY_PER_REPLICA);
        // Ensure at least +2 from current
        const targetReplicas = Math.max(neededReplicas, activeReplicas + 2);

        // Feature 1: Explainable AI Decision Layer
        logger.info("AutoPilot Decision Algorithm Executed", {
            event: "AI_DECISION",
            reason: `Incoming load ${currentLoad} RPS exceeds capacity. Targeting 20% buffer.`,
            confidence: 0.95,
            metrics: {
                currentLoad,
                activeReplicas,
                capacityPerReplica: CAPACITY_PER_REPLICA,
                utilization: (currentLoad / (activeReplicas * CAPACITY_PER_REPLICA)).toFixed(2)
            },
            recommendedReplicas: targetReplicas
        });

        logger.info(`AutoPilot engaged: Targeting ${targetReplicas} replicas to handle ${currentLoad} RPS...`);

        setTimeout(async () => {
            logger.info(`AutoPilot executes scaling to ${targetReplicas}...`);
            await executeScale(targetReplicas);
        }, 2000);
    }

    res.json({
        message: `Alert triggered (Level ${incidentCount})`,
        load: currentLoad,
        lastAlertTime
    });
});

app.post("/api/simulation/reset", (_req: Request, res: Response) => {
    systemStatus = "HEALTHY";
    activeReplicas = 3;
    lastAlertTime = null;
    currentLoad = 100;
    incidentCount = 0;
    pendingApprovals.clear();
    logger.info("Simulation State Reset");
    res.json({ message: "Simulation reset to baseline" });
});

app.post("/api/autoscale", (req: Request, res: Response) => {
    const schema = z.object({ enabled: z.boolean() });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: "Invalid input" });
        return;
    }
    autoPilotMode = parseResult.data.enabled;
    logger.info(`AutoPilot Mode: ${autoPilotMode ? "ENABLED" : "DISABLED"}`);
    res.json({ autoPilotMode });
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
    res.json({ message: result.message, status: systemStatus, explanation: result.explanation });
});

// Feature 2 Endpoints: Approvals
app.get("/api/approvals", (_req: Request, res: Response) => {
    const approvals = Array.from(pendingApprovals.values());
    res.json(approvals);
});

app.post("/api/approvals/:id/approve", async (req: Request, res: Response) => {
    const { id } = req.params;
    const approval = pendingApprovals.get(id as string);

    if (!approval) {
        res.status(404).json({ error: "Approval not found" });
        return;
    }

    if (approval.action === "scale") {
        // Execute the pending action with policy bypass
        logger.info("Admin approved action", {
            event: "APPROVED_ACTION_EXECUTED",
            approvalId: id,
            replicas: approval.details.replicas
        });

        const result = await executeScale(approval.details.replicas, true);
        pendingApprovals.delete(id as string);
        res.json({ message: "Approved and executed", result });
    } else {
        res.status(400).json({ error: "Unknown action type" });
    }
});

// Feature 3 Endpoint: Get Reports
app.get("/api/reports", (_req: Request, res: Response) => {
    res.json(incidentReports);
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
    const service = registry.getActiveService();
    if (!service) {
        res.json({ service: null });
        return;
    }
    const { apiKey: _key, ...safe } = service;
    res.json({ service: safe });
});

app.post("/api/services/:id/activate", (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid service ID" });
        return;
    }

    const service = registry.activateService(id);
    if (!service) {
        res.status(404).json({ error: "Service not found or not approved" });
        return;
    }

    res.json({ message: "Service activated", service });
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

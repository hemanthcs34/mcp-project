import { z } from "zod";
import { logger } from "./logger.js";

// --- Types ---
export interface ServiceConfig {
    id: number;
    serviceName: string;
    monitorEndpoint: string;
    scaleEndpoint: string;
    rollbackEndpoint: string;
    apiKey: string;
    status: "pending" | "approved" | "rejected";
    registeredAt: string;
}

/** Safe view of a service (no API key) */
export type ServicePublic = Omit<ServiceConfig, "apiKey">;

// --- Validation ---
const urlSchema = z.string().url().refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    { message: "Endpoint must be an HTTP or HTTPS URL" }
);

export const registerSchema = z.object({
    serviceName: z.string().min(1, "Service name is required").max(100),
    monitorEndpoint: urlSchema,
    scaleEndpoint: urlSchema,
    rollbackEndpoint: urlSchema,
    apiKey: z.string().min(1, "API key is required"),
});

// --- Storage ---
let nextId = 1;
const services: ServiceConfig[] = [];

// --- Registry Functions ---

export function registerService(
    input: z.infer<typeof registerSchema>
): ServicePublic {
    const config: ServiceConfig = {
        id: nextId++,
        ...input,
        status: "pending",
        registeredAt: new Date().toISOString(),
    };
    services.push(config);

    logger.info("Service registered (pending approval)", {
        id: config.id,
        serviceName: config.serviceName,
        monitorEndpoint: config.monitorEndpoint,
        scaleEndpoint: config.scaleEndpoint,
        rollbackEndpoint: config.rollbackEndpoint,
        apiKey: "[REDACTED]",
    });

    return stripApiKey(config);
}

/** Get the currently approved service (first approved one), or null */
export function getApprovedService(): ServiceConfig | null {
    return services.find((s) => s.status === "approved") ?? null;
}

/** Get all services (safe view, no API keys) */
export function getAllServices(): ServicePublic[] {
    return services.map(stripApiKey);
}

/** Approve a pending service by ID. Returns the safe view or null if not found. */
export function approveService(id: number): ServicePublic | null {
    const service = services.find((s) => s.id === id);
    if (!service) return null;

    // Reject any currently approved service (only one active at a time)
    for (const s of services) {
        if (s.status === "approved") {
            s.status = "rejected";
            logger.info("Previous service deactivated", {
                id: s.id,
                serviceName: s.serviceName,
            });
        }
    }

    service.status = "approved";
    logger.info("Service approved", {
        id: service.id,
        serviceName: service.serviceName,
    });
    return stripApiKey(service);
}

/** Reject a pending service by ID */
export function rejectService(id: number): ServicePublic | null {
    const service = services.find((s) => s.id === id);
    if (!service) return null;

    service.status = "rejected";
    logger.info("Service rejected", {
        id: service.id,
        serviceName: service.serviceName,
    });
    return stripApiKey(service);
}

// --- Helpers ---
function stripApiKey(config: ServiceConfig): ServicePublic {
    const { apiKey: _key, ...safe } = config;
    return safe;
}

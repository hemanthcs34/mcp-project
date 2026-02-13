import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

// --- Types ---

export const ServiceConfigSchema = z.object({
    id: z.number().optional(), // ID assigned on registration
    serviceName: z.string().min(1),
    monitorEndpoint: z.string().url(),
    scaleEndpoint: z.string().url(),
    rollbackEndpoint: z.string().url(),
    apiKey: z.string().min(1),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    registeredAt: z.string().optional(),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

// Public view of service (no API key)
export type ServicePublic = Omit<ServiceConfig, "apiKey"> & { isActive: boolean };

// --- Storage ---
const DATA_FILE = path.join(process.cwd(), "services.json");

interface RegistryData {
    services: ServiceConfig[];
    activeServiceId: number | null;
}

// Initial state
let state: RegistryData = {
    services: [],
    activeServiceId: null,
};

// --- Persistence Helpers ---
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, "utf-8");
            const data = JSON.parse(raw);
            state = {
                services: data.services || [],
                activeServiceId: data.activeServiceId || null,
            };
            logger.info(`[Registry] Loaded ${state.services.length} services from disk.`);
        }
    } catch (error) {
        logger.error("[Registry] Failed to load services", { error: String(error) });
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        logger.error("[Registry] Failed to save services", { error: String(error) });
    }
}

// Load on startup
loadData();

// --- Functions ---

export function registerService(input: unknown): ServiceConfig {
    const config = ServiceConfigSchema.parse(input);

    const newService: ServiceConfig = {
        ...config,
        id: Date.now(), // Simple ID generation
        status: "pending",
        registeredAt: new Date().toISOString(),
    };

    state.services.push(newService);
    saveData();

    logger.info("Service registered", { name: newService.serviceName, id: newService.id });
    return newService;
}

export function getAllServices(): ServicePublic[] {
    return state.services.map(s => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey, ...rest } = s;
        return {
            ...rest,
            isActive: s.id === state.activeServiceId
        };
    });
}

export function getApprovedServices(): ServiceConfig[] {
    return state.services.filter(s => s.status === "approved");
}

export function getActiveService(): ServiceConfig | null {
    if (!state.activeServiceId) return null;
    return state.services.find(s => s.id === state.activeServiceId) || null;
}

export function approveService(id: number): ServiceConfig | undefined {
    const service = state.services.find(s => s.id === id);
    if (service) {
        service.status = "approved";

        // Auto-activate if it's the only approved service
        const approvedCount = state.services.filter(s => s.status === "approved").length;
        if (approvedCount === 1) {
            state.activeServiceId = id;
            logger.info("Auto-activated service", { name: service.serviceName });
        }

        saveData();
        logger.info("Service approved", { name: service.serviceName, id });
    }
    return service;
}

export function rejectService(id: number): ServiceConfig | undefined {
    const service = state.services.find(s => s.id === id);
    if (service) {
        service.status = "rejected";
        if (state.activeServiceId === id) {
            state.activeServiceId = null;
            logger.info("Active service rejected, system now simulation-only");
        }
        saveData();
    }
    return service;
}

export function activateService(id: number): ServiceConfig | undefined {
    const service = state.services.find(s => s.id === id);
    if (service && service.status === "approved") {
        state.activeServiceId = id;
        saveData();
        logger.info("Service activated", { name: service.serviceName, id });
        return service;
    }
    return undefined;
}

// --- Validation Export ---
export const registerSchema = ServiceConfigSchema.omit({ id: true, status: true, registeredAt: true });
